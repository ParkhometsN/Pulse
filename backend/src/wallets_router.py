from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from typing import Any, Callable
from uuid import UUID

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from src.auth_router import get_current_user
from src.database import get_database_pool
from src.http_client import UpstreamHTTPError
from src.init import bybit_client, tbank_client
from src.router import get_coin_name, get_coinmarketcap_icon_url
from src.stocks_router import (
    calculate_percent_change,
    get_change_from_candles,
    get_stock_candles,
    get_stock_icon_url,
)
from src.tbank_client import TBankAPIError, normalize_tbank_token, proto_decimal, proto_number


router = APIRouter(tags=["wallets"])
logger = logging.getLogger(__name__)

BYBIT_ACCOUNT_TYPES = ("UNIFIED", "SPOT", "CONTRACT")
BYBIT_SOFT_ACCOUNT_ERRORS = {10001, 110001, 110004}
USD_RUB_FALLBACK_RATE = Decimal("90")
_usd_rub_rate_cache: dict[str, Any] = {
    "value": None,
    "expires_at": None,
}
_tbank_instrument_cache: dict[str, dict[str, Any]] = {}
_tbank_shares_cache: dict[str, dict[str, Any]] = {}
_tbank_trading_status_cache: dict[str, dict[str, Any]] = {}
_portfolio_summary_cache: dict[str, dict[str, Any]] = {}
PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS = 45
TBANK_TRADING_STATUS_CACHE_TTL_SECONDS = 60


ACCOUNT_TYPE_LABELS = {
    "ACCOUNT_TYPE_TINKOFF": "брокерский счет",
    "ACCOUNT_TYPE_TINKOFF_IIS": "ИИС",
    "ACCOUNT_TYPE_INVEST_BOX": "инвесткопилка",
    "ACCOUNT_TYPE_INVEST_FUND": "фонд",
}

PROVIDER_LABELS = {
    "tbank": "Т Банк",
    "bybit": "Bybit",
}
BYBIT_STABLE_COINS = {"USDT", "USDC", "DAI", "USD", "BUSD"}
TBANK_MONEY_FIGI_CODES = {
    "RUB000UTSTOM": ("RUB", "Российский рубль"),
    "USD000UTSTOM": ("USD", "Доллар США"),
    "EUR_RUB__TOM": ("EUR", "Евро"),
}
MONEY_ICON_URLS = {
    "RUB": "https://invest-brands.cdn-tinkoff.ru/rublex160.png",
    "RUR": "https://invest-brands.cdn-tinkoff.ru/rublex160.png",
    "USD": "https://invest-brands.cdn-tinkoff.ru/dollarx160.png",
    "USDT": "https://cryptologos.cc/logos/tether-usdt-logo.svg",
    "USDC": "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg",
    "EUR": "https://invest-brands.cdn-tinkoff.ru/eurox160.png",
}
TBANK_BUY_OPERATION_TYPES = {
    "OPERATION_TYPE_BUY",
    "OPERATION_TYPE_BUY_CARD",
    "OPERATION_TYPE_BUY_MARGIN",
}
TBANK_SELL_OPERATION_TYPES = {
    "OPERATION_TYPE_SELL",
    "OPERATION_TYPE_SELL_MARGIN",
}
TBANK_TRADING_STATUS_LABELS = {
    "SECURITY_TRADING_STATUS_UNSPECIFIED": "статус торгов не определен",
    "SECURITY_TRADING_STATUS_NOT_AVAILABLE_FOR_TRADING": "торги недоступны",
    "SECURITY_TRADING_STATUS_OPENING_PERIOD": "период открытия торгов",
    "SECURITY_TRADING_STATUS_CLOSING_PERIOD": "период закрытия торгов",
    "SECURITY_TRADING_STATUS_BREAK_IN_TRADING": "перерыв в торговле",
    "SECURITY_TRADING_STATUS_NORMAL_TRADING": "нормальная торговля",
    "SECURITY_TRADING_STATUS_CLOSING_AUCTION": "аукцион закрытия",
    "SECURITY_TRADING_STATUS_OPENING_AUCTION_PERIOD": "аукцион открытия",
    "SECURITY_TRADING_STATUS_SESSION_ASSIGNED": "торговая сессия назначена",
    "SECURITY_TRADING_STATUS_SESSION_CLOSE": "торговая сессия закрыта",
    "SECURITY_TRADING_STATUS_SESSION_OPEN": "торговая сессия открыта",
    "SECURITY_TRADING_STATUS_DEALER_NORMAL_TRADING": "торги через внутреннюю ликвидность брокера",
    "SECURITY_TRADING_STATUS_DEALER_BREAK_IN_TRADING": "перерыв торговли через внутреннюю ликвидность брокера",
    "SECURITY_TRADING_STATUS_DEALER_NOT_AVAILABLE_FOR_TRADING": "внутренняя ликвидность брокера недоступна",
}


class ConnectTBankRequest(BaseModel):
    api_token: str = Field(min_length=10, max_length=4096)


class ConnectBybitRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=255)
    api_secret: str = Field(min_length=8, max_length=255)


class TradeRequest(BaseModel):
    asset_type: str = Field(pattern="^(crypto|stock)$")
    symbol: str = Field(min_length=1, max_length=40)
    side: str = Field(pattern="^(buy|sell)$")
    amount: Decimal | None = Field(default=None, gt=0)
    quantity: Decimal | None = Field(default=None, gt=0)
    lots: int | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, gt=0)
    asset_name: str | None = Field(default=None, max_length=120)
    figi: str | None = Field(default=None, max_length=64)

    @field_validator("asset_type", "side", mode="before")
    @classmethod
    def _normalize_choice_text(cls, value: Any) -> str:
        return str(value or "").strip().lower()

    @field_validator("symbol", mode="before")
    @classmethod
    def _normalize_symbol_text(cls, value: Any) -> str:
        if isinstance(value, (dict, list, tuple)):
            return ""

        return str(value or "").strip()[:40]

    @field_validator("asset_name", mode="before")
    @classmethod
    def _normalize_asset_name_text(cls, value: Any) -> str | None:
        if value is None:
            return None

        if isinstance(value, (dict, list, tuple)):
            return None

        text = str(value).strip()
        return text[:120] if text else None

    @field_validator("figi", mode="before")
    @classmethod
    def _normalize_figi_text(cls, value: Any) -> str | None:
        if value is None:
            return None

        if isinstance(value, (dict, list, tuple)):
            return None

        text = str(value).strip()
        return text[:64] if text else None


def _jsonb(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value

    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {}
        except json.JSONDecodeError:
            return {}

    return {}


def _get(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]

    return None


def _decimal_to_float(value: Decimal) -> float:
    return round(float(value), 2)


def _decimal_to_precise_float(value: Decimal, digits: int = 8) -> float:
    return round(float(value), digits)


def _decimal_from_string(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal("0")


def _normalize_asset_type(instrument_type: str | None) -> str:
    normalized_type = str(instrument_type or "").lower()

    if normalized_type in {"share", "stock"}:
        return "stock"

    if normalized_type in {"currency", "crypto"}:
        return "currency"

    return normalized_type or "asset"


def _normalize_tbank_symbol(figi: str | None, ticker: str | None, instrument: dict[str, Any]) -> str:
    if figi in TBANK_MONEY_FIGI_CODES:
        return TBANK_MONEY_FIGI_CODES[figi][0]

    normalized_ticker = str(ticker or "").strip().upper()

    if normalized_ticker:
        return normalized_ticker

    currency = (
        instrument.get("isoCurrencyName")
        or instrument.get("iso_currency_name")
        or instrument.get("currency")
    )

    if currency:
        return str(currency).upper()

    return str(figi or "ASSET").upper()


def _normalize_tbank_name(figi: str | None, symbol: str, instrument: dict[str, Any]) -> str:
    if figi in TBANK_MONEY_FIGI_CODES:
        return TBANK_MONEY_FIGI_CODES[figi][1]

    return instrument.get("name") or instrument.get("shortName") or instrument.get("short_name") or symbol


def _get_tbank_icon_url(instrument: dict[str, Any], symbol: str, asset_type: str) -> str | None:
    normalized_symbol = str(symbol or "").upper()

    if normalized_symbol in MONEY_ICON_URLS:
        return MONEY_ICON_URLS[normalized_symbol]

    brand = instrument.get("brand") if isinstance(instrument.get("brand"), dict) else {}
    logo_name = (
        brand.get("logoName")
        or brand.get("logo_name")
        or instrument.get("logoName")
        or instrument.get("logo_name")
    )

    if logo_name:
        normalized_logo_name = str(logo_name)
        logo_file = (
            normalized_logo_name.replace(".png", "x160.png")
            if normalized_logo_name.endswith(".png")
            else f"{normalized_logo_name}x160.png"
        )

        return f"https://invest-brands.cdn-tinkoff.ru/{logo_file}"

    if asset_type == "stock":
        return get_stock_icon_url(symbol)

    return None


def _get_money_icon_url(currency: str | None) -> str | None:
    return MONEY_ICON_URLS.get(str(currency or "").upper())


def _is_supported_tbank_market_share(instrument: dict[str, Any]) -> bool:
    ticker = str(instrument.get("ticker") or "").strip().upper()
    currency = str(instrument.get("currency") or "").strip().lower()
    country = str(
        instrument.get("countryOfRisk")
        or instrument.get("country_of_risk")
        or ""
    ).strip().upper()
    exchange = str(
        instrument.get("exchange")
        or instrument.get("realExchange")
        or instrument.get("real_exchange")
        or ""
    ).strip().upper()

    if not instrument.get("figi") or not ticker:
        return False

    if not any(char.isalpha() for char in ticker):
        return False

    if currency and currency not in {"rub", "rur"}:
        return False

    if country and country not in {"RU", "RUS", "RUSSIA"}:
        return False

    if exchange and any(marker in exchange for marker in ("SPB", "HK", "NASDAQ", "NYSE", "LSE")):
        return False

    return bool(instrument.get("apiTradeAvailableFlag", True))


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value

    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 10_000_000_000 else value, timezone.utc)

    if isinstance(value, str):
        normalized_value = value.strip()

        if normalized_value.isdigit():
            timestamp = int(normalized_value)

            return datetime.fromtimestamp(
                timestamp / 1000 if timestamp > 10_000_000_000 else timestamp,
                timezone.utc,
            )

        try:
            return datetime.fromisoformat(normalized_value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)

    return datetime.now(timezone.utc)


async def _get_tbank_instrument(token: str, figi: str | None) -> dict[str, Any]:
    if not figi:
        return {}

    if figi in _tbank_instrument_cache:
        return _tbank_instrument_cache[figi]

    try:
        response = await tbank_client.get_instrument_by_figi(token, figi)
        instrument = response.get("instrument", {})
    except TBankAPIError:
        instrument = {}

    if isinstance(instrument, dict) and not instrument.get("brand"):
        instrument_type = str(
            instrument.get("instrumentType")
            or instrument.get("instrument_type")
            or ""
        ).lower()

        try:
            if instrument_type == "share":
                details = await tbank_client.get_share_by_figi(token, figi)
                instrument = {**instrument, **(details.get("instrument") or {})}
            elif instrument_type == "currency":
                details = await tbank_client.get_currency_by_figi(token, figi)
                instrument = {**instrument, **(details.get("instrument") or {})}
        except TBankAPIError:
            pass

    if isinstance(instrument, dict):
        _tbank_instrument_cache[figi] = instrument
        return instrument

    return {}


async def _get_bybit_coin_change_percent(coin: str) -> Decimal:
    normalized_coin = (coin or "").upper()

    if not normalized_coin or normalized_coin in BYBIT_STABLE_COINS:
        return Decimal("0")

    try:
        ticker = await bybit_client.get_ticker(f"{normalized_coin}USDT", category="spot")
    except UpstreamHTTPError:
        return Decimal("0")

    if not ticker:
        return Decimal("0")

    return _decimal_from_string(ticker.get("price24hPcnt")) * Decimal("100")


async def _calculate_bybit_spot_change(assets: list[dict[str, Any]]) -> tuple[Decimal, Decimal]:
    if not assets:
        return Decimal("0"), Decimal("0")

    change_pairs = await asyncio.gather(
        *[
            _get_bybit_coin_change_percent(asset.get("coin"))
            for asset in assets[:24]
        ],
        return_exceptions=True,
    )
    total_current_value = Decimal("0")
    total_previous_value = Decimal("0")

    for asset, change_percent_result in zip(assets[:24], change_pairs):
        current_value = _decimal_from_string(asset.get("valueUsd"))
        change_percent = (
            change_percent_result
            if isinstance(change_percent_result, Decimal)
            else Decimal("0")
        )
        multiplier = Decimal("1") + (change_percent / Decimal("100"))
        previous_value = current_value / multiplier if multiplier > 0 else current_value
        asset_change_usd = current_value - previous_value

        asset["changeUsd"] = _decimal_to_float(asset_change_usd)
        asset["changeRub"] = _decimal_to_float(
            asset_change_usd * _decimal_from_string(asset.get("currentPriceRub")) / (
                _decimal_from_string(asset.get("currentPriceUsd")) or Decimal("1")
            )
        )
        asset["changePercent"] = round(float(change_percent), 2)

        total_current_value += current_value
        total_previous_value += previous_value

    change_value = total_current_value - total_previous_value
    base_value = total_previous_value
    change_percent = (change_value / base_value * Decimal("100")) if base_value > 0 else Decimal("0")

    return change_value, change_percent


async def _get_usd_rub_rate() -> Decimal:
    now = datetime.now(timezone.utc)
    cached_value = _usd_rub_rate_cache.get("value")
    expires_at = _usd_rub_rate_cache.get("expires_at")

    if isinstance(cached_value, Decimal) and expires_at and expires_at > now:
        return cached_value

    try:
        async with ClientSession(timeout=ClientTimeout(total=6, connect=2, sock_read=4)) as session:
            async with session.get("https://open.er-api.com/v6/latest/USD") as response:
                data = await response.json(content_type=None)
                rate_raw = data.get("rates", {}).get("RUB")
                if rate_raw is None:
                    raise ValueError("RUB rate is missing")

                rate = Decimal(str(rate_raw))

                if rate > 0:
                    _usd_rub_rate_cache["value"] = rate
                    _usd_rub_rate_cache["expires_at"] = now.replace(
                        minute=(now.minute // 10) * 10,
                        second=0,
                        microsecond=0,
                    ) + timedelta(minutes=10)
                    return rate
    except Exception:
        pass

    return cached_value if isinstance(cached_value, Decimal) else USD_RUB_FALLBACK_RATE


def _portfolio_change_value(total_value: Decimal, expected_yield_percent: Decimal) -> Decimal:
    denominator = Decimal("100") + expected_yield_percent

    if denominator <= 0:
        return Decimal("0")

    return (total_value * expected_yield_percent) / denominator


def _activity_level(count: int) -> int:
    if count <= 0:
        return 0

    if count == 1:
        return 1

    if count <= 3:
        return 2

    if count <= 6:
        return 3

    return 4


def _pick_chart_points(rows: list[dict[str, Any]], target_count: int = 7) -> list[dict[str, Any]]:
    if not rows:
        return []

    if len(rows) <= target_count:
        return rows

    selected_indexes = {
        round(index * (len(rows) - 1) / (target_count - 1))
        for index in range(target_count)
    }

    return [
        row
        for index, row in enumerate(rows)
        if index in selected_indexes
    ]


def _format_day_label(value: date) -> str:
    return str(value.day)


def _chart_point(label: str, value: Decimal | int | float = Decimal("0"), has_data: bool = False) -> dict[str, Any]:
    return {
        "label": label,
        "value": _decimal_to_float(Decimal(str(value or 0))),
        "hasData": has_data,
    }


def _cache_token_key(token: str) -> str:
    return hashlib.sha256(normalize_tbank_token(token).encode("utf-8")).hexdigest()


def _portfolio_summary_cache_key(user_id: Any) -> str:
    return str(user_id)


def _clear_portfolio_summary_cache(user_id: Any) -> None:
    _portfolio_summary_cache.pop(_portfolio_summary_cache_key(user_id), None)


async def _get_tbank_trading_status(token: str, instrument: dict[str, Any]) -> dict[str, Any]:
    figi = instrument.get("figi")
    instrument_id = instrument.get("uid") or figi

    if not instrument_id:
        return {}

    token_key = _cache_token_key(token)
    cache_key = f"{token_key}:{instrument_id}"
    now = datetime.now(timezone.utc)
    cached = _tbank_trading_status_cache.get(cache_key)

    if cached and cached["expires_at"] > now:
        return cached["data"]

    trading_status = await tbank_client.get_trading_status(token, instrument_id)
    _tbank_trading_status_cache[cache_key] = {
        "data": trading_status,
        "expires_at": now + timedelta(seconds=TBANK_TRADING_STATUS_CACHE_TTL_SECONDS),
    }

    return trading_status


def _serialize_tbank_trading_status(
    instrument: dict[str, Any],
    trading_status: dict[str, Any] | None,
    symbol: str,
) -> dict[str, Any]:
    status_payload = trading_status or {}
    status_code_value = str(status_payload.get("tradingStatus") or "")
    is_market_order_available = status_payload.get("marketOrderAvailableFlag") is not False
    is_api_trade_available = (
        instrument.get("apiTradeAvailableFlag") is not False
        and status_payload.get("apiTradeAvailableFlag") is not False
    )
    is_buy_available = instrument.get("buyAvailableFlag") is not False
    is_sell_available = instrument.get("sellAvailableFlag") is not False
    is_open = is_api_trade_available and is_market_order_available and (
        status_code_value in {
            "SECURITY_TRADING_STATUS_NORMAL_TRADING",
            "SECURITY_TRADING_STATUS_DEALER_NORMAL_TRADING",
        }
    )

    return {
        "symbol": symbol,
        "figi": instrument.get("figi"),
        "instrumentId": instrument.get("uid") or instrument.get("figi"),
        "status": status_code_value,
        "statusLabel": TBANK_TRADING_STATUS_LABELS.get(
            status_code_value,
            status_code_value or "неизвестный статус",
        ),
        "isOpen": is_open,
        "isMarketOrderAvailable": is_market_order_available,
        "isApiTradeAvailable": is_api_trade_available,
        "isBuyAvailable": is_buy_available,
        "isSellAvailable": is_sell_available,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _format_tbank_share(
    instrument: dict[str, Any],
    price_map: dict[str, Decimal],
    trading_status: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    figi = instrument.get("figi")
    ticker = instrument.get("ticker")
    symbol = _normalize_tbank_symbol(figi, ticker, instrument)
    if not symbol or not figi:
        return None

    price = price_map.get(figi, Decimal("0"))
    status_payload = _serialize_tbank_trading_status(instrument, trading_status, symbol)
    return {
        "id": figi,
        "figi": figi,
        "symbol": symbol,
        "name": _normalize_tbank_name(figi, symbol, instrument),
        "shortName": instrument.get("name") or symbol,
        "baseCoin": symbol,
        "iconUrl": _get_tbank_icon_url(instrument, symbol, "stock"),
        "price": _decimal_to_float(price),
        "lotSize": int(instrument.get("lot") or 1),
        "priceChangePercent24h": 0,
        "priceChangePercent7d": 0,
        "priceChangePercent30d": 0,
        "chart7d": [],
        "provider": "tbank",
        "providerLabel": PROVIDER_LABELS["tbank"],
        "tradingStatus": status_payload,
        "isTradable": status_payload["isApiTradeAvailable"],
        "isTradingOpen": status_payload["isOpen"],
    }


async def _enrich_tbank_share_with_moex_history(share: dict[str, Any]) -> dict[str, Any]:
    symbol = str(share.get("symbol") or "").upper()

    if not symbol:
        return share

    try:
        candles = await get_stock_candles(symbol, "TQBR", days=35)
    except Exception:
        return share

    if not candles:
        return share

    price = _decimal_from_string(share.get("price")) or _decimal_from_string(candles[-1].get("close"))
    previous_close = candles[-2].get("close") if len(candles) >= 2 else candles[0].get("open")

    share["price"] = _decimal_to_float(price)
    share["priceChangePercent24h"] = round(calculate_percent_change(price, previous_close), 2)
    share["priceChangePercent7d"] = round(get_change_from_candles(price, candles, 7), 2)
    share["priceChangePercent30d"] = round(get_change_from_candles(price, candles, 30), 2)
    share["chart7d"] = candles[-7:]

    return share


def _is_usable_tbank_account(account: dict[str, Any]) -> bool:
    status_value = account.get("status")
    access_level = account.get("accessLevel") or account.get("access_level")

    if status_value and status_value != "ACCOUNT_STATUS_OPEN":
        return False

    return access_level != "ACCOUNT_ACCESS_LEVEL_NO_ACCESS"


def _account_permissions(account: dict[str, Any]) -> dict[str, Any]:
    account_type = account.get("type") or account.get("accountType")

    return {
        "accountId": account.get("id"),
        "accountName": account.get("name") or "Инвестиционный счет",
        "accountType": account_type,
        "accountTypeLabel": ACCOUNT_TYPE_LABELS.get(account_type, "инвестиционный счет"),
        "accessLevel": account.get("accessLevel") or account.get("access_level"),
        "openedDate": account.get("openedDate") or account.get("opened_date"),
    }


async def _load_tbank_accounts(token: str) -> list[dict[str, Any]]:
    response = await tbank_client.get_accounts(token)
    accounts = response.get("accounts", [])

    if not isinstance(accounts, list):
        return []

    return [account for account in accounts if isinstance(account, dict) and _is_usable_tbank_account(account)]


async def _resolve_tbank_account(row) -> dict[str, Any]:
    permissions = _jsonb(row["permissions"])
    account_id = permissions.get("accountId") or permissions.get("account_id")

    if account_id:
        return permissions

    accounts = await _load_tbank_accounts(row["api_key"])
    if not accounts:
        raise TBankAPIError("У токена нет доступных открытых счетов.")

    return _account_permissions(accounts[0])


def _format_decimal_for_provider(value: Decimal, max_places: int = 8) -> str:
    quantizer = Decimal("1").scaleb(-max_places)
    normalized = value.quantize(quantizer, rounding=ROUND_DOWN).normalize()
    text = format(normalized, "f")

    return text if "." not in text else text.rstrip("0").rstrip(".")


def _get_bybit_coin_balance(balances: list[dict[str, Any]], coin_code: str) -> Decimal:
    normalized_coin_code = coin_code.upper()
    best_value = Decimal("0")

    for balance in balances:
        for coin in balance.get("coin", []):
            if not isinstance(coin, dict):
                continue

            if str(coin.get("coin") or "").upper() != normalized_coin_code:
                continue

            candidates = [
                coin.get("availableToWithdraw"),
                coin.get("walletBalance"),
                coin.get("equity"),
            ]

            for candidate in candidates:
                value = _decimal_from_string(candidate)
                if value > best_value:
                    best_value = value

    return best_value


async def _get_bybit_trade_price(symbol: str, side: str) -> Decimal:
    ticker = await bybit_client.get_ticker(symbol, category="spot")

    if not ticker:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось получить актуальную цену Bybit.",
        )

    price_key = "ask1Price" if side == "buy" else "bid1Price"
    price = _decimal_from_string(ticker.get(price_key) or ticker.get("lastPrice"))

    if price <= 0:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Bybit вернул некорректную цену инструмента.",
        )

    return price


async def _get_bybit_spot_rules(symbol: str) -> dict[str, Any]:
    instruments = await bybit_client.get_instruments(category="spot")
    normalized_symbol = symbol.upper()

    for instrument in instruments:
        if str(instrument.get("symbol") or "").upper() == normalized_symbol:
            return instrument

    return {}


def _get_money_amount(items: list[dict[str, Any]], currency: str) -> Decimal:
    normalized_currency = currency.upper()

    for item in items:
        if not isinstance(item, dict):
            continue

        if str(item.get("currency") or "").upper() == normalized_currency:
            return proto_decimal(item)

    return Decimal("0")


async def _load_tbank_cash_assets(token: str, account_id: str) -> list[dict[str, Any]]:
    try:
        limits = await tbank_client.get_withdraw_limits(token, account_id)
    except TBankAPIError:
        return []

    money = [item for item in limits.get("money", []) if isinstance(item, dict)]
    blocked = [item for item in limits.get("blocked", []) if isinstance(item, dict)]
    usd_rub_rate = await _get_usd_rub_rate()
    assets: list[dict[str, Any]] = []

    for item in money:
        currency = str(item.get("currency") or "").upper()
        if not currency:
            continue

        amount = proto_decimal(item)
        blocked_amount = _get_money_amount(blocked, currency)
        available_amount = max(amount - blocked_amount, Decimal("0"))

        if available_amount <= 0:
            continue

        rub_rate = Decimal("1") if currency == "RUB" else usd_rub_rate
        value_rub = available_amount * rub_rate

        assets.append({
            "figi": None,
            "symbol": currency,
            "name": {
                "RUB": "Российский рубль",
                "USD": "Доллар США",
                "EUR": "Евро",
            }.get(currency, currency),
            "shortName": currency,
            "type": "currency",
            "provider": "tbank",
            "providerLabel": PROVIDER_LABELS["tbank"],
            "iconUrl": _get_money_icon_url(currency),
            "instrumentType": "currency",
            "quantity": _decimal_to_precise_float(available_amount, 8),
            "availableQuantity": _decimal_to_precise_float(available_amount, 8),
            "currentPriceRub": _decimal_to_precise_float(rub_rate, 8),
            "valueRub": _decimal_to_float(value_rub),
            "changeRub": 0,
            "changePercent": 0,
        })

    return assets


async def _get_tbank_trade_price(token: str, figi: str, fallback_price: Decimal) -> Decimal:
    try:
        response = await tbank_client.get_last_prices(token, [figi])
    except TBankAPIError:
        response = {}

    for item in response.get("lastPrices", []):
        if not isinstance(item, dict) or item.get("figi") != figi:
            continue

        price = proto_decimal(item.get("price"))
        if price > 0:
            return price

    if fallback_price > 0:
        return fallback_price

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Не удалось получить актуальную цену Т-Банка.",
    )


async def _get_tbank_position_quantity(token: str, account_id: str, figi: str) -> Decimal:
    try:
        portfolio = await tbank_client.get_portfolio(token, account_id, "RUB")
    except TBankAPIError:
        return Decimal("0")

    for position in portfolio.get("positions", []):
        if not isinstance(position, dict) or position.get("figi") != figi:
            continue

        return Decimal(str(proto_number(_get(position, "quantity"))))

    return Decimal("0")


async def _find_active_wallet(user_id, provider: str):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        return await connection.fetchrow(
            """
            select id, provider, provider_label, api_key, api_secret_encrypted,
                   permissions, status, last_synced_at, created_at, updated_at
            from wallet_connections
            where user_id = $1 and provider = $2 and status = 'active'
            order by created_at asc
            limit 1
            """,
            user_id,
            provider,
        )


async def _find_tbank_share_by_symbol(token: str, symbol: str, figi: str | None = None) -> dict[str, Any] | None:
    normalized_symbol = str(symbol or "").upper()

    if figi:
        try:
            response = await tbank_client.get_share_by_figi(token, figi)
            instrument = response.get("instrument", {})
            if (
                isinstance(instrument, dict)
                and instrument.get("figi")
                and _is_supported_tbank_market_share(instrument)
            ):
                return instrument
        except TBankAPIError:
            pass

    cache_key = _cache_token_key(token)
    now = datetime.now(timezone.utc)
    cached = _tbank_shares_cache.get(cache_key)

    if cached and cached["expires_at"] > now:
        instruments = cached["items"]
    else:
        response = await tbank_client.get_shares(token)
        instruments = [
            item
            for item in response.get("instruments", [])
            if isinstance(item, dict) and _is_supported_tbank_market_share(item)
        ]
        _tbank_shares_cache[cache_key] = {
            "items": instruments,
            "expires_at": now + timedelta(minutes=10),
        }

    for instrument in instruments:
        if (
            _is_supported_tbank_market_share(instrument)
            and str(instrument.get("ticker") or "").upper() == normalized_symbol
        ):
            return instrument

    return None


async def _record_trade(
    user_id,
    wallet_id,
    payload: TradeRequest,
    quantity: Decimal,
    price: Decimal,
    total_amount: Decimal,
    currency: str,
    status_value: str,
    provider_order_id: str | None = None,
):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_trade_history (
                user_id, wallet_connection_id, asset_type, asset_symbol, asset_name,
                action, quantity, price, total_amount, currency, ai_strategy,
                ai_reason, status
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """,
            user_id,
            wallet_id,
            payload.asset_type,
            payload.symbol.upper(),
            payload.asset_name,
            payload.side,
            quantity,
            price,
            total_amount,
            currency,
            "manual_market_order",
            provider_order_id,
            status_value,
        )


async def _safe_record_trade(*args, **kwargs) -> bool:
    try:
        await _record_trade(*args, **kwargs)
        return True
    except Exception:
        logger.exception("Failed to record provider trade in ai_trade_history")
        return False


async def _execute_bybit_trade(payload: TradeRequest, current_user) -> dict[str, Any]:
    wallet = await _find_active_wallet(current_user["id"], "bybit")

    if payload.side == "buy" and payload.amount is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите сумму сделки для криптовалюты.",
        )

    if payload.side == "sell" and payload.quantity is None and payload.amount is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите количество криптовалюты для продажи.",
        )

    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для торговли криптовалютой подключите Bybit в настройках.",
        )

    symbol = payload.symbol.upper()
    if symbol in BYBIT_STABLE_COINS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Стейблкоины нельзя открыть как торговый актив.",
        )

    if not symbol.endswith("USDT"):
        symbol = f"{symbol}USDT"

    try:
        trade_price, instrument_rules, balances = await asyncio.gather(
            _get_bybit_trade_price(symbol, payload.side),
            _get_bybit_spot_rules(symbol),
            _load_bybit_balances(wallet["api_key"], wallet["api_secret_encrypted"]),
        )
    except UpstreamHTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось проверить баланс или цену Bybit.",
        ) from error

    lot_size_filter = instrument_rules.get("lotSizeFilter") or {}
    min_order_amount = _decimal_from_string(
        lot_size_filter.get("minOrderAmt")
        or lot_size_filter.get("minOrderAmount")
        or lot_size_filter.get("minNotionalValue")
    )

    if payload.side == "buy":
        available_quote = _get_bybit_coin_balance(balances, "USDT")

        if min_order_amount > 0 and payload.amount < min_order_amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Минимальная сумма заявки Bybit для {symbol} — "
                    f"{_format_decimal_for_provider(min_order_amount, 8)} USDT. "
                    f"Увеличьте сумму сделки."
                ),
            )

        if payload.amount > available_quote:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Недостаточно USDT для покупки.",
            )

        quantity = payload.amount / trade_price
        provider_qty = _format_decimal_for_provider(payload.amount, 6)
        market_unit = "quoteCoin"
        side = "Buy"
    else:
        base_coin = symbol.removesuffix("USDT")
        quantity = payload.quantity if payload.quantity is not None else payload.amount / trade_price
        order_value = quantity * trade_price
        available_base = _get_bybit_coin_balance(balances, base_coin)

        if quantity > available_base:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Недостаточно {base_coin} для продажи.",
            )

        if min_order_amount > 0 and order_value < min_order_amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Минимальная сумма продажи Bybit для {symbol} — "
                    f"{_format_decimal_for_provider(min_order_amount, 8)} USDT. "
                    f"При текущей цене это примерно "
                    f"{_format_decimal_for_provider(min_order_amount / trade_price, 8)} {base_coin}."
                ),
            )

        provider_qty = _format_decimal_for_provider(quantity, 8)
        market_unit = "baseCoin"
        side = "Sell"

    total_amount = quantity * trade_price

    if quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Количество для заявки должно быть больше нуля.",
        )

    try:
        order = await bybit_client.create_order(
            wallet["api_key"],
            wallet["api_secret_encrypted"],
            symbol=symbol,
            side=side,
            qty=provider_qty,
            market_unit=market_unit,
        )
    except UpstreamHTTPError as error:
        detail = "Bybit отклонил заявку. Проверьте торговые права API-ключа и баланс."
        if error.ret_code == 170140:
            detail = "Bybit отклонил заявку: сумма ниже минимального лимита для этой пары."
        if error.ret_code:
            detail = f"{detail} Код Bybit: {error.ret_code}."
        if error.ret_msg:
            detail = f"{detail} Сообщение Bybit: {error.ret_msg}."

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        ) from error

    history_recorded = await _safe_record_trade(
        current_user["id"],
        wallet["id"],
        payload,
        quantity,
        trade_price,
        total_amount,
        "USDT",
        "completed",
        str(order.get("orderId") or ""),
    )
    _clear_portfolio_summary_cache(current_user["id"])

    return {
        "provider": "bybit",
        "providerLabel": PROVIDER_LABELS["bybit"],
        "orderId": order.get("orderId"),
        "symbol": symbol,
        "side": payload.side,
        "quantity": float(quantity),
        "price": float(trade_price),
        "totalAmount": float(total_amount),
        "currency": "USDT",
        "status": "completed",
        "historyRecorded": history_recorded,
        "message": "Заявка отправлена на Bybit.",
    }


async def _execute_tbank_trade(payload: TradeRequest, current_user) -> dict[str, Any]:
    wallet = await _find_active_wallet(current_user["id"], "tbank")

    if payload.lots is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите количество лотов для акции.",
        )

    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для торговли акциями подключите Т-Банк в настройках.",
        )

    account = await _resolve_tbank_account(wallet)
    account_id = account.get("accountId")

    if not account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не найден счет Т-Банка для выставления заявки.",
        )

    try:
        instrument = await _find_tbank_share_by_symbol(
            wallet["api_key"],
            payload.symbol,
            payload.figi,
        )
    except TBankAPIError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось проверить инструмент в Т-Банке.",
        ) from error

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Инструмент не найден в Т-Банке.",
        )

    instrument_id = instrument.get("uid") or instrument["figi"]
    api_trade_available = instrument.get("apiTradeAvailableFlag") is not False
    side_available = (
        instrument.get("buyAvailableFlag", True)
        if payload.side == "buy"
        else instrument.get("sellAvailableFlag", True)
    ) is not False

    try:
        trading_status = await tbank_client.get_trading_status(wallet["api_key"], instrument_id)
    except TBankAPIError:
        trading_status = {}

    status_code_value = str(trading_status.get("tradingStatus") or "")
    status_label = TBANK_TRADING_STATUS_LABELS.get(status_code_value, status_code_value or "неизвестный статус")
    is_market_order_available = trading_status.get("marketOrderAvailableFlag") is not False
    api_trade_available = api_trade_available and trading_status.get("apiTradeAvailableFlag") is not False

    if not api_trade_available or not side_available:
        action_label = "покупки" if payload.side == "buy" else "продажи"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Т-Банк сейчас не разрешает API-заявки для {action_label} этого инструмента.",
        )

    if not is_market_order_available:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Рыночная заявка сейчас недоступна для этого инструмента в Т-Банке. "
                f"Текущий статус: {status_label}."
            ),
        )

    trade_price = await _get_tbank_trade_price(
        wallet["api_key"],
        instrument["figi"],
        payload.price or Decimal("0"),
    )
    lot = int(instrument.get("lot") or 1)
    lots = payload.lots

    if lots <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Количество лотов должно быть больше нуля.",
        )

    direction = "ORDER_DIRECTION_BUY" if payload.side == "buy" else "ORDER_DIRECTION_SELL"
    quantity = Decimal(str(lots * lot))
    total_amount = quantity * trade_price

    if payload.side == "buy":
        cash_assets = await _load_tbank_cash_assets(wallet["api_key"], account_id)
        available_rub = next(
            (
                Decimal(str(asset.get("availableQuantity") or asset.get("quantity") or "0"))
                for asset in cash_assets
                if asset.get("symbol") == "RUB"
            ),
            Decimal("0"),
        )

        if total_amount > available_rub:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Недостаточно рублей для покупки.",
            )
    else:
        available_quantity = await _get_tbank_position_quantity(
            wallet["api_key"],
            account_id,
            instrument["figi"],
        )

        if quantity > available_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Недостаточно {payload.symbol.upper()} для продажи.",
            )

    try:
        order = await tbank_client.post_order(
            wallet["api_key"],
            account_id,
            instrument_id,
            lots,
            direction,
        )
    except TBankAPIError as error:
        detail = "Т-Банк отклонил заявку. Проверьте торговые права токена, баланс и доступность инструмента."
        if error.detail:
            error_detail_text = str(error.detail)
            if "instrument is not available for trading" in error_detail_text.lower():
                detail = (
                    "Торги по этому инструменту сейчас недоступны в Т-Банке. "
                    f"Текущий статус: {status_label}. Попробуйте во время торговой сессии."
                )
            else:
                detail = f"{detail} Причина T-Invest: {error.detail}."
        if error.status_code:
            detail = f"{detail} Ответ T-Invest API: {error.status_code}."

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        ) from error

    order_id = str(order.get("orderId") or order.get("order_id") or "")

    history_recorded = await _safe_record_trade(
        current_user["id"],
        wallet["id"],
        payload,
        quantity,
        trade_price,
        total_amount,
        "RUB",
        "completed",
        order_id,
    )
    _clear_portfolio_summary_cache(current_user["id"])

    return {
        "provider": "tbank",
        "providerLabel": PROVIDER_LABELS["tbank"],
        "orderId": order_id,
        "symbol": payload.symbol.upper(),
        "side": payload.side,
        "quantity": float(quantity),
        "price": float(trade_price),
        "lots": lots,
        "lot": lot,
        "totalAmount": float(total_amount),
        "currency": "RUB",
        "status": "completed",
        "historyRecorded": history_recorded,
        "message": "Заявка отправлена в Т-Банк.",
    }


async def _serialize_tbank_asset(token: str, position: dict[str, Any]) -> dict[str, Any]:
    figi = position.get("figi")
    instrument = await _get_tbank_instrument(token, figi)
    quantity = proto_number(_get(position, "quantity"))
    current_price = proto_decimal(_get(position, "currentPrice", "current_price"))
    expected_yield = proto_decimal(_get(position, "expectedYield", "expected_yield"))
    asset_value = current_price * Decimal(str(quantity))
    ticker = instrument.get("ticker") or position.get("ticker")
    instrument_type = (
        instrument.get("instrumentType")
        or instrument.get("instrument_type")
        or position.get("instrumentType")
        or position.get("instrument_type")
    )
    normalized_type = _normalize_asset_type(instrument_type)
    symbol = _normalize_tbank_symbol(figi, ticker, instrument)
    expected_yield_percent = (
        expected_yield / (asset_value - expected_yield) * Decimal("100")
        if asset_value - expected_yield > 0
        else Decimal("0")
    )

    return {
        "id": figi,
        "figi": figi,
        "symbol": symbol,
        "routeSymbol": symbol,
        "name": _normalize_tbank_name(figi, symbol, instrument),
        "shortName": symbol,
        "type": normalized_type,
        "provider": "tbank",
        "providerLabel": PROVIDER_LABELS["tbank"],
        "iconUrl": _get_tbank_icon_url(instrument, symbol, normalized_type),
        "instrumentType": instrument_type,
        "quantity": quantity,
        "availableQuantity": quantity,
        "currentPriceRub": _decimal_to_float(current_price),
        "valueRub": _decimal_to_float(asset_value),
        "changeRub": _decimal_to_float(expected_yield),
        "changePercent": round(float(expected_yield_percent), 2),
    }


async def _build_tbank_wallet_summary(row) -> dict[str, Any]:
    account = await _resolve_tbank_account(row)
    account_id = account.get("accountId")

    if not account_id:
        raise TBankAPIError("Не найден идентификатор счета Т-Банка.")

    portfolio = await tbank_client.get_portfolio(row["api_key"], account_id, "RUB")
    total_value = proto_decimal(_get(portfolio, "totalAmountPortfolio", "total_amount_portfolio"))
    expected_yield_percent = proto_decimal(_get(portfolio, "expectedYield", "expected_yield"))
    change_value = _portfolio_change_value(total_value, expected_yield_percent)
    positions = portfolio.get("positions", [])
    position_assets = await asyncio.gather(
        *[
            _serialize_tbank_asset(row["api_key"], position)
            for position in positions
            if isinstance(position, dict)
        ]
    )
    cash_assets = await _load_tbank_cash_assets(row["api_key"], account_id)
    cash_symbols = {asset["symbol"] for asset in cash_assets}
    assets = [
        *cash_assets,
        *[
            asset
            for asset in position_assets
            if asset["symbol"] not in cash_symbols
        ],
    ]
    assets.sort(
        key=lambda asset: Decimal(str(asset.get("valueRub") or "0")),
        reverse=True,
    )

    return {
        "id": str(row["id"]),
        "provider": "tbank",
        "providerLabel": PROVIDER_LABELS["tbank"],
        "accountName": account.get("accountName") or "Инвестиционный счет",
        "accountTypeLabel": account.get("accountTypeLabel") or "брокерский счет",
        "totalValueRub": _decimal_to_float(total_value),
        "changeRub": _decimal_to_float(change_value),
        "changePercent": round(float(expected_yield_percent), 2),
        "assetCount": len([asset for asset in assets if asset["quantity"] != 0]),
        "assets": assets,
        "status": "active",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def _load_bybit_balances(api_key: str, api_secret: str) -> list[dict[str, Any]]:
    loaded_balances = []
    hard_errors: list[UpstreamHTTPError] = []

    for account_type in BYBIT_ACCOUNT_TYPES:
        try:
            balances = await bybit_client.get_wallet_balance(
                api_key,
                api_secret,
                account_type=account_type,
            )
        except UpstreamHTTPError as error:
            if error.ret_code in BYBIT_SOFT_ACCOUNT_ERRORS:
                continue

            hard_errors.append(error)
            continue

        if not balances:
            continue

        for balance in balances:
            if isinstance(balance, dict):
                loaded_balances.append({
                    **balance,
                    "accountType": balance.get("accountType") or account_type,
                })

        if account_type == "UNIFIED":
            return loaded_balances

    if loaded_balances:
        return loaded_balances

    if hard_errors:
        raise hard_errors[0]

    return []


def _serialize_bybit_asset(coin: dict[str, Any], usd_rub_rate: Decimal) -> dict[str, Any]:
    base_coin = str(coin.get("coin") or "").upper()
    value_usd = _decimal_from_string(coin.get("usdValue"))
    equity = _decimal_from_string(coin.get("equity"))
    available_quantity = max(
        _decimal_from_string(coin.get("availableToWithdraw")),
        _decimal_from_string(coin.get("walletBalance")),
        equity,
    )
    current_price_usd = value_usd / equity if equity > 0 else Decimal("0")
    value_rub = value_usd * usd_rub_rate

    return {
        "coin": base_coin,
        "symbol": f"{base_coin}USDT" if base_coin and base_coin not in BYBIT_STABLE_COINS else base_coin,
        "name": get_coin_name(base_coin) or base_coin,
        "shortName": base_coin,
        "type": "crypto",
        "provider": "bybit",
        "providerLabel": PROVIDER_LABELS["bybit"],
        "iconUrl": get_coinmarketcap_icon_url(base_coin),
        "quantity": float(equity),
        "availableQuantity": _decimal_to_precise_float(available_quantity, 8),
        "currentPriceUsd": _decimal_to_precise_float(current_price_usd, 10),
        "currentPriceRub": _decimal_to_precise_float(current_price_usd * usd_rub_rate, 8),
        "valueUsd": _decimal_to_float(value_usd),
        "valueRub": _decimal_to_float(value_rub),
    }


async def _load_tbank_trade_history(row, limit: int = 25) -> list[dict[str, Any]]:
    account = await _resolve_tbank_account(row)
    account_id = account.get("accountId")

    if not account_id:
        return []

    date_to = datetime.now(timezone.utc)
    date_from = date_to - timedelta(days=90)
    response = await tbank_client.get_operations(
        row["api_key"],
        account_id,
        date_from.isoformat(),
        date_to.isoformat(),
    )
    operations = response.get("operations", [])
    items: list[dict[str, Any]] = []

    for operation in operations:
        if not isinstance(operation, dict):
            continue

        operation_type = operation.get("operationType") or operation.get("type")
        if operation_type not in TBANK_BUY_OPERATION_TYPES | TBANK_SELL_OPERATION_TYPES:
            continue

        figi = operation.get("figi")
        instrument = await _get_tbank_instrument(row["api_key"], figi)
        symbol = _normalize_tbank_symbol(figi, instrument.get("ticker"), instrument)
        asset_type = _normalize_asset_type(
            instrument.get("instrumentType")
            or instrument.get("instrument_type")
            or operation.get("instrumentType")
        )
        payment = proto_decimal(operation.get("payment"))
        price = proto_decimal(operation.get("price"))
        quantity = _decimal_from_string(operation.get("quantity"))
        executed_at = _parse_datetime(operation.get("date"))

        items.append({
            "id": str(operation.get("id") or f"tbank-{figi}-{executed_at.isoformat()}"),
            "provider": "tbank",
            "providerLabel": PROVIDER_LABELS["tbank"],
            "action": "Продажа" if operation_type in TBANK_SELL_OPERATION_TYPES else "Покупка",
            "assetType": "stock" if asset_type == "stock" else asset_type,
            "symbol": symbol,
            "routeSymbol": symbol,
            "name": _normalize_tbank_name(figi, symbol, instrument),
            "iconUrl": _get_tbank_icon_url(instrument, symbol, asset_type),
            "quantity": float(quantity),
            "price": _decimal_to_float(price),
            "totalAmount": _decimal_to_float(abs(payment)),
            "currency": "RUB",
            "executedAt": executed_at.isoformat(),
            "time": executed_at.strftime("%H:%M"),
        })

        if len(items) >= limit:
            break

    return items


async def _load_bybit_trade_history(row, limit: int = 25) -> list[dict[str, Any]]:
    try:
        orders = await bybit_client.get_order_history(
            row["api_key"],
            row["api_secret_encrypted"],
            category="spot",
            limit=limit,
        )
    except UpstreamHTTPError:
        return []

    items: list[dict[str, Any]] = []

    for order in orders:
        if not isinstance(order, dict):
            continue

        symbol = str(order.get("symbol") or "").upper()
        base_coin = symbol.removesuffix("USDT") if symbol.endswith("USDT") else symbol
        created_at = _parse_datetime(order.get("createdTime"))
        quantity = _decimal_from_string(order.get("cumExecQty") or order.get("qty"))
        total_amount = _decimal_from_string(order.get("cumExecValue"))
        price = _decimal_from_string(order.get("avgPrice") or order.get("price"))

        if not symbol or quantity <= 0:
            continue

        items.append({
            "id": str(order.get("orderId") or f"bybit-{symbol}-{created_at.isoformat()}"),
            "provider": "bybit",
            "providerLabel": PROVIDER_LABELS["bybit"],
            "action": "Продажа" if order.get("side") == "Sell" else "Покупка",
            "assetType": "crypto",
            "symbol": base_coin,
            "routeSymbol": symbol,
            "name": get_coin_name(base_coin) or base_coin,
            "iconUrl": get_coinmarketcap_icon_url(base_coin),
            "quantity": float(quantity),
            "price": _decimal_to_float(price),
            "totalAmount": _decimal_to_float(total_amount),
            "currency": "USDT",
            "executedAt": created_at.isoformat(),
            "time": created_at.strftime("%H:%M"),
        })

    return items


async def _build_bybit_wallet_summary(row) -> dict[str, Any]:
    balances = await _load_bybit_balances(row["api_key"], row["api_secret_encrypted"])
    usd_rub_rate = await _get_usd_rub_rate()
    total_value_usd = sum(
        _decimal_from_string(balance.get("totalEquity") or balance.get("totalWalletBalance"))
        for balance in balances
    )
    assets = [
        _serialize_bybit_asset(coin, usd_rub_rate)
        for balance in balances
        for coin in balance.get("coin", [])
        if isinstance(coin, dict) and _decimal_from_string(coin.get("equity")) != 0
    ]
    assets.sort(
        key=lambda asset: Decimal(str(asset.get("valueRub") or "0")),
        reverse=True,
    )
    spot_change_usd, spot_change_percent = await _calculate_bybit_spot_change(assets)
    perp_change_usd = sum(
        _decimal_from_string(balance.get("totalPerpUPL"))
        for balance in balances
    )
    total_change_usd = spot_change_usd + perp_change_usd
    total_value_rub = total_value_usd * usd_rub_rate
    total_change_rub = total_change_usd * usd_rub_rate
    base_value_usd = total_value_usd - total_change_usd
    change_percent = (
        total_change_usd / base_value_usd * Decimal("100")
        if base_value_usd > 0
        else spot_change_percent
    )
    account_types = [balance.get("accountType") for balance in balances if balance.get("accountType")]

    return {
        "id": str(row["id"]),
        "provider": "bybit",
        "providerLabel": PROVIDER_LABELS["bybit"],
        "accountName": "Bybit",
        "accountTypeLabel": "биржевой счет",
        "totalValueRub": _decimal_to_float(total_value_rub),
        "changeRub": _decimal_to_float(total_change_rub),
        "changePercent": round(float(change_percent), 2),
        "assetCount": len(assets),
        "assets": assets,
        "status": "active",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "meta": {
            "accountTypes": account_types,
            "usdRubRate": _decimal_to_float(usd_rub_rate),
        },
    }


async def _build_wallet_summary(row) -> dict[str, Any]:
    provider = row["provider"]

    if provider == "tbank":
        return await _build_tbank_wallet_summary(row)

    if provider == "bybit":
        return await _build_bybit_wallet_summary(row)

    permissions = _jsonb(row["permissions"])
    return {
        "id": str(row["id"]),
        "provider": provider,
        "providerLabel": row["provider_label"] or PROVIDER_LABELS.get(provider, provider),
        "accountName": permissions.get("accountName") or "Подключенный счет",
        "accountTypeLabel": "ожидает интеграции",
        "totalValueRub": 0,
        "changeRub": 0,
        "changePercent": 0,
        "assetCount": 0,
        "assets": [],
        "status": "pending",
        "updatedAt": None,
    }


async def _safe_wallet_summary(row) -> dict[str, Any]:
    try:
        return await _build_wallet_summary(row)
    except (TBankAPIError, UpstreamHTTPError) as error:
        permissions = _jsonb(row["permissions"])
        return {
            "id": str(row["id"]),
            "provider": row["provider"],
            "providerLabel": row["provider_label"] or PROVIDER_LABELS.get(row["provider"], row["provider"]),
            "accountName": permissions.get("accountName") or "Подключенный счет",
            "accountTypeLabel": permissions.get("accountTypeLabel") or "ошибка синхронизации",
            "totalValueRub": 0,
            "changeRub": 0,
            "changePercent": 0,
            "assetCount": 0,
            "assets": [],
            "status": "error",
            "error": str(error),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }


@router.post("/wallets/tbank/connect")
async def connect_tbank_wallet(payload: ConnectTBankRequest, current_user=Depends(get_current_user)):
    token = normalize_tbank_token(payload.api_token)

    try:
        accounts = await _load_tbank_accounts(token)
    except TBankAPIError as error:
        detail = "Не удалось проверить токен Т-Банка. Проверьте ключ и доступ к счетам."
        if error.status_code:
            detail = f"{detail} Ответ T-Invest API: {error.status_code}."

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        ) from error

    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="У токена нет открытых инвестиционных счетов с доступом.",
        )

    pool = get_database_pool()
    connected_wallets = []

    async with pool.acquire() as connection:
        async with connection.transaction():
            for account in accounts:
                permissions = _account_permissions(account)
                account_id = permissions["accountId"]
                existing_wallet_id = await connection.fetchval(
                    """
                    select id
                    from wallet_connections
                    where user_id = $1
                      and provider = 'tbank'
                      and permissions->>'accountId' = $2
                    """,
                    current_user["id"],
                    account_id,
                )

                if existing_wallet_id:
                    wallet = await connection.fetchrow(
                        """
                        update wallet_connections
                        set api_key = $1,
                            permissions = $2::jsonb,
                            status = 'active',
                            updated_at = now()
                        where id = $3 and user_id = $4
                        returning id, provider, provider_label, permissions, status, created_at, updated_at
                        """,
                        token,
                        json.dumps(permissions),
                        existing_wallet_id,
                        current_user["id"],
                    )
                else:
                    wallet = await connection.fetchrow(
                        """
                        insert into wallet_connections (
                            user_id, provider, provider_label, api_key, api_secret_encrypted,
                            permissions, status
                        )
                        values ($1, 'tbank', 'Т Банк', $2, '', $3::jsonb, 'active')
                        returning id, provider, provider_label, permissions, status, created_at, updated_at
                        """,
                        current_user["id"],
                        token,
                        json.dumps(permissions),
                    )

                connected_wallets.append(
                    {
                        "id": str(wallet["id"]),
                        "provider": wallet["provider"],
                        "providerLabel": wallet["provider_label"],
                        "accountName": permissions["accountName"],
                        "accountTypeLabel": permissions["accountTypeLabel"],
                        "status": wallet["status"],
                    }
                )

    _clear_portfolio_summary_cache(current_user["id"])

    return {
        "message": "Т Банк подключен.",
        "wallets": connected_wallets,
    }


@router.post("/wallets/bybit/connect")
async def connect_bybit_wallet(payload: ConnectBybitRequest, current_user=Depends(get_current_user)):
    api_key = payload.api_key.strip()
    api_secret = payload.api_secret.strip()

    try:
        balances = await _load_bybit_balances(api_key, api_secret)
    except UpstreamHTTPError as error:
        detail = "Не удалось проверить ключи Bybit. Проверьте API key, API secret и права на чтение аккаунта."
        if error.ret_code:
            detail = f"{detail} Ответ Bybit API: {error.ret_code}."

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        ) from error

    if not balances:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bybit вернул пустой список счетов. Проверьте тип аккаунта и права API-ключа.",
        )

    account_types = [
        balance.get("accountType")
        for balance in balances
        if balance.get("accountType")
    ]
    permissions = {
        "accountName": "Bybit",
        "accountTypeLabel": "биржевой счет",
        "accountTypes": account_types,
    }
    pool = get_database_pool()

    async with pool.acquire() as connection:
        existing_wallet_id = await connection.fetchval(
            """
            select id
            from wallet_connections
            where user_id = $1 and provider = 'bybit'
            """,
            current_user["id"],
        )

        if existing_wallet_id:
            wallet = await connection.fetchrow(
                """
                update wallet_connections
                set api_key = $1,
                    api_secret_encrypted = $2,
                    permissions = $3::jsonb,
                    status = 'active',
                    updated_at = now()
                where id = $4 and user_id = $5
                returning id, provider, provider_label, permissions, status, created_at, updated_at
                """,
                api_key,
                api_secret,
                json.dumps(permissions),
                existing_wallet_id,
                current_user["id"],
            )
        else:
            wallet = await connection.fetchrow(
                """
                insert into wallet_connections (
                    user_id, provider, provider_label, api_key, api_secret_encrypted,
                    permissions, status
                )
                values ($1, 'bybit', 'Bybit', $2, $3, $4::jsonb, 'active')
                returning id, provider, provider_label, permissions, status, created_at, updated_at
                """,
                current_user["id"],
                api_key,
                api_secret,
                json.dumps(permissions),
            )

    _clear_portfolio_summary_cache(current_user["id"])

    return {
        "message": "Bybit подключен.",
        "wallets": [
            {
                "id": str(wallet["id"]),
                "provider": wallet["provider"],
                "providerLabel": wallet["provider_label"],
                "accountName": permissions["accountName"],
                "accountTypeLabel": permissions["accountTypeLabel"],
                "status": wallet["status"],
            }
        ],
    }


@router.delete("/wallets/{wallet_id}")
async def delete_wallet(wallet_id: UUID, current_user=Depends(get_current_user)):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        deleted_id = await connection.fetchval(
            """
            delete from wallet_connections
            where id = $1 and user_id = $2
            returning id
            """,
            wallet_id,
            current_user["id"],
        )

    if not deleted_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Кошелек не найден.",
        )

    _clear_portfolio_summary_cache(current_user["id"])

    return {"message": "Кошелек удален."}


@router.post("/portfolio/trade")
async def create_portfolio_trade(payload: TradeRequest, current_user=Depends(get_current_user)):
    normalized_payload = payload.model_copy(
        update={
            "symbol": payload.symbol.strip().upper(),
            "side": payload.side.lower(),
            "asset_type": payload.asset_type.lower(),
        }
    )

    if normalized_payload.asset_type == "crypto":
        return await _execute_bybit_trade(normalized_payload, current_user)

    return await _execute_tbank_trade(normalized_payload, current_user)


@router.get("/portfolio/trades")
async def get_portfolio_trades(current_user=Depends(get_current_user)):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        wallet_rows = await connection.fetch(
            """
            select id, provider, provider_label, api_key, api_secret_encrypted,
                   permissions, status, last_synced_at, created_at, updated_at
            from wallet_connections
            where user_id = $1 and status = 'active'
            order by created_at asc
            """,
            current_user["id"],
        )
        ai_trade_rows = await connection.fetch(
            """
            select id, wallet_connection_id, asset_type, asset_symbol, asset_name,
                   action, quantity, price, total_amount, currency, status, executed_at,
                   ai_reason
            from ai_trade_history
            where user_id = $1
            order by executed_at desc
            limit 30
            """,
            current_user["id"],
        )

    provider_trade_tasks = []

    for row in wallet_rows:
        if row["provider"] == "tbank":
            provider_trade_tasks.append(_load_tbank_trade_history(row))
        elif row["provider"] == "bybit":
            provider_trade_tasks.append(_load_bybit_trade_history(row))

    provider_trade_results = await asyncio.gather(*provider_trade_tasks, return_exceptions=True)
    provider_trades = [
        trade
        for result in provider_trade_results
        if isinstance(result, list)
        for trade in result
    ]
    ai_trades = [
        {
            "id": str(row["id"]),
            "provider": "pulse-ai",
            "providerLabel": "Pulse AI",
            "action": "Продажа" if str(row["action"]).lower() in {"sell", "продажа"} else "Покупка",
            "assetType": row["asset_type"],
            "symbol": row["asset_symbol"],
            "routeSymbol": row["asset_symbol"],
            "name": row["asset_name"] or row["asset_symbol"],
            "iconUrl": (
                get_coinmarketcap_icon_url(row["asset_symbol"].removesuffix("USDT"))
                if row["asset_type"] == "crypto"
                else get_stock_icon_url(row["asset_symbol"])
            ),
            "quantity": float(row["quantity"] or 0),
            "price": float(row["price"] or 0),
            "totalAmount": float(row["total_amount"] or 0),
            "currency": row["currency"],
            "status": row["status"],
            "executedAt": row["executed_at"].isoformat(),
            "time": row["executed_at"].strftime("%H:%M"),
            "providerOrderId": row["ai_reason"],
        }
        for row in ai_trade_rows
    ]
    provider_order_ids = {
        str(trade.get("id") or "")
        for trade in provider_trades
        if trade.get("id")
    }
    provider_keys = {
        (
            str(trade.get("assetType") or "").lower(),
            str(trade.get("routeSymbol") or trade.get("symbol") or "").upper(),
            str(trade.get("action") or "").lower(),
            round(float(trade.get("quantity") or 0), 8),
            round(float(trade.get("totalAmount") or 0), 2),
        )
        for trade in provider_trades
    }
    ai_trades = [
        trade
        for trade in ai_trades
        if str(trade.get("providerOrderId") or "") not in provider_order_ids
        and (
            str(trade.get("assetType") or "").lower(),
            str(trade.get("routeSymbol") or trade.get("symbol") or "").upper(),
            str(trade.get("action") or "").lower(),
            round(float(trade.get("quantity") or 0), 8),
            round(float(trade.get("totalAmount") or 0), 2),
        ) not in provider_keys
    ]
    trades = sorted(
        [*provider_trades, *ai_trades],
        key=lambda item: item.get("executedAt") or "",
        reverse=True,
    )[:40]

    return {
        "items": trades,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/portfolio/tbank/trading-status")
async def get_tbank_trading_status(
    symbol: str = Query(min_length=1, max_length=40),
    figi: str | None = Query(default=None, max_length=64),
    current_user=Depends(get_current_user),
):
    wallet = await _find_active_wallet(current_user["id"], "tbank")

    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Для проверки статуса торгов подключите Т-Банк.",
        )

    try:
        instrument = await _find_tbank_share_by_symbol(wallet["api_key"], symbol, figi)
    except TBankAPIError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось проверить инструмент в Т-Банке.",
        ) from error

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Инструмент не найден в Т-Банке.",
        )

    instrument_id = instrument.get("uid") or instrument["figi"]

    try:
        trading_status = await tbank_client.get_trading_status(wallet["api_key"], instrument_id)
    except TBankAPIError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось получить торговый статус Т-Банка.",
        ) from error

    return _serialize_tbank_trading_status(
        instrument,
        trading_status,
        str(instrument.get("ticker") or symbol).upper(),
    )


async def _load_tbank_market_statuses(
    token: str,
    instruments: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    token_key = _cache_token_key(token)
    now = datetime.now(timezone.utc)
    statuses: dict[str, dict[str, Any]] = {}
    missing_instruments: list[dict[str, Any]] = []

    for instrument in instruments:
        figi = instrument.get("figi")
        instrument_id = instrument.get("uid") or figi

        if not figi or not instrument_id:
            continue

        cache_key = f"{token_key}:{instrument_id}"
        cached = _tbank_trading_status_cache.get(cache_key)

        if cached and cached["expires_at"] > now:
            statuses[figi] = cached["data"]
        else:
            missing_instruments.append(instrument)

    if not missing_instruments:
        return statuses

    semaphore = asyncio.Semaphore(4)

    async def load_status(instrument: dict[str, Any]):
        figi = instrument.get("figi")
        instrument_id = instrument.get("uid") or figi

        if not figi or not instrument_id:
            return None

        async with semaphore:
            try:
                trading_status = await tbank_client.get_trading_status(token, instrument_id)
            except TBankAPIError:
                trading_status = {}

        cache_key = f"{token_key}:{instrument_id}"
        _tbank_trading_status_cache[cache_key] = {
            "data": trading_status,
            "expires_at": datetime.now(timezone.utc) + timedelta(seconds=TBANK_TRADING_STATUS_CACHE_TTL_SECONDS),
        }

        return figi, trading_status

    loaded_statuses = await asyncio.gather(*[
        load_status(instrument)
        for instrument in missing_instruments
    ])

    for result in loaded_statuses:
        if result:
            figi, trading_status = result
            statuses[figi] = trading_status

    return statuses


@router.get("/portfolio/tbank/stocks")
async def get_tbank_market_stocks(
    limit: int = Query(default=15, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    include_trading_status: bool = Query(default=True),
    current_user=Depends(get_current_user),
):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        wallet_row = await connection.fetchrow(
            """
            select id, provider, provider_label, api_key, api_secret_encrypted,
                   permissions, status, last_synced_at, created_at, updated_at
            from wallet_connections
            where user_id = $1 and provider = 'tbank' and status = 'active'
            order by created_at asc
            limit 1
            """,
            current_user["id"],
        )

    if not wallet_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Т Банк не подключен.",
        )

    token = wallet_row["api_key"]
    cache_key = _cache_token_key(token)
    now = datetime.now(timezone.utc)
    cached = _tbank_shares_cache.get(cache_key)

    if cached and cached["expires_at"] > now:
        instruments = cached["items"]
    else:
        try:
            response = await tbank_client.get_shares(token)
        except TBankAPIError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Не удалось загрузить акции из Т-Банка.",
            ) from error

        instruments = [
            item
            for item in response.get("instruments", [])
            if isinstance(item, dict)
            and _is_supported_tbank_market_share(item)
        ]
        instruments.sort(key=lambda item: str(item.get("ticker") or ""))
        _tbank_shares_cache[cache_key] = {
            "items": instruments,
            "expires_at": now + timedelta(minutes=10),
        }

    page_instruments = instruments[offset:offset + limit]
    figis = [item["figi"] for item in page_instruments]
    price_map: dict[str, Decimal] = {}

    if figis:
        try:
            price_response = await tbank_client.get_last_prices(token, figis)
            price_map = {
                item.get("figi"): proto_decimal(item.get("price"))
                for item in price_response.get("lastPrices", [])
                if isinstance(item, dict) and item.get("figi")
            }
        except TBankAPIError:
            price_map = {}

    status_map = await _load_tbank_market_statuses(token, page_instruments) if include_trading_status else {}
    items = [
        formatted
        for instrument in page_instruments
        if (formatted := _format_tbank_share(instrument, price_map, status_map.get(instrument.get("figi"))))
    ]
    items = await asyncio.gather(*[
        _enrich_tbank_share_with_moex_history(item)
        for item in items
    ])

    return {
        "items": items,
        "total": len(instruments),
        "limit": limit,
        "offset": offset,
        "hasMore": offset + limit < len(instruments),
        "source": "tbank",
        "includeTradingStatus": include_trading_status,
    }


@router.get("/portfolio/tbank/stocks/{symbol}")
async def get_tbank_market_stock_detail(
    symbol: str,
    figi: str | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    wallet_row = await _find_active_wallet(current_user["id"], "tbank")

    if not wallet_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Т Банк не подключен.",
        )

    token = wallet_row["api_key"]
    instrument = await _find_tbank_share_by_symbol(token, symbol, figi)

    if not instrument or not _is_supported_tbank_market_share(instrument):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Российская акция не найдена в подключенном портфеле Т-Банка.",
        )

    price_map: dict[str, Decimal] = {}
    instrument_figi = instrument.get("figi")

    try:
        price_response = await tbank_client.get_last_prices(token, [instrument_figi])
        price_map = {
            item.get("figi"): proto_decimal(item.get("price"))
            for item in price_response.get("lastPrices", [])
            if isinstance(item, dict) and item.get("figi")
        }
    except TBankAPIError:
        price_map = {}

    try:
        trading_status = await _get_tbank_trading_status(token, instrument)
    except TBankAPIError:
        trading_status = None

    formatted = _format_tbank_share(instrument, price_map, trading_status)

    if not formatted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Не удалось подготовить данные акции Т-Банка.",
        )

    formatted = await _enrich_tbank_share_with_moex_history(formatted)

    return {
        **formatted,
        "currency": "RUB",
        "quoteCoin": "RUB",
        "orderbook": {"bids": [], "asks": []},
        "source": "tbank",
    }


@router.get("/portfolio/analytics")
async def get_portfolio_analytics(
    year: int = Query(default_factory=lambda: date.today().year, ge=2020, le=2100),
    current_user=Depends(get_current_user),
):
    pool = get_database_pool()
    today = date.today()
    activity_start = today - timedelta(days=30)
    week_start = today - timedelta(days=6)
    year_start = date(year, 1, 1)
    year_end = date(year + 1, 1, 1)

    async with pool.acquire() as connection:
        activity_rows = await connection.fetch(
            """
            select activity_day, count(*) as activity_count
            from (
                select created_at::date as activity_day
                from portfolio_snapshots
                where user_id = $1 and created_at::date >= $2

                union all

                select executed_at::date as activity_day
                from ai_trade_history
                where user_id = $1 and executed_at::date >= $2
            ) activity
            group by activity_day
            """,
            current_user["id"],
            activity_start,
        )
        month_rows = await connection.fetch(
            """
            select snapshot_month, sum(total_value) as total_value
            from (
                select distinct on (wallet_connection_id, date_trunc('month', created_at))
                       date_trunc('month', created_at)::date as snapshot_month,
                       wallet_connection_id,
                       total_value
                from portfolio_snapshots
                where user_id = $1
                  and created_at >= $2
                  and created_at < $3
                order by wallet_connection_id, date_trunc('month', created_at), created_at desc
            ) latest_wallet_snapshots
            group by snapshot_month
            order by snapshot_month asc
            """,
            current_user["id"],
            year_start,
            year_end,
        )
        week_rows = await connection.fetch(
            """
            select snapshot_day, sum(total_value) as total_value
            from (
                select distinct on (wallet_connection_id, created_at::date)
                       created_at::date as snapshot_day,
                       wallet_connection_id,
                       total_value
                from portfolio_snapshots
                where user_id = $1 and created_at::date >= $2
                order by wallet_connection_id, created_at::date, created_at desc
            ) latest_wallet_snapshots
            group by snapshot_day
            order by snapshot_day asc
            """,
            current_user["id"],
            week_start,
        )
        hourly_rows = await connection.fetch(
            """
            select snapshot_hour, sum(total_value) as total_value
            from (
                select distinct on (wallet_connection_id, date_trunc('hour', created_at))
                       date_trunc('hour', created_at) as snapshot_hour,
                       wallet_connection_id,
                       total_value
                from portfolio_snapshots
                where user_id = $1 and created_at >= now() - interval '12 hours'
                order by wallet_connection_id, date_trunc('hour', created_at), created_at desc
            ) latest_wallet_snapshots
            group by snapshot_hour
            order by snapshot_hour asc
            """,
            current_user["id"],
        )
        available_year_rows = await connection.fetch(
            """
            select distinct extract(year from created_at)::int as chart_year
            from portfolio_snapshots
            where user_id = $1
            order by chart_year asc
            """,
            current_user["id"],
        )
        latest_total_row = await connection.fetchrow(
            """
            select sum(total_value) as total_value
            from (
                select distinct on (wallet_connection_id)
                       wallet_connection_id,
                       total_value
                from portfolio_snapshots
                where user_id = $1
                order by wallet_connection_id, created_at desc
            ) latest_wallet_snapshots
            """,
            current_user["id"],
        )

    activity_by_day = {
        row["activity_day"]: int(row["activity_count"] or 0)
        for row in activity_rows
    }
    activity_grid = [
        _activity_level(activity_by_day.get(activity_start + timedelta(days=index), 0))
        for index in range(31)
    ]
    month_labels = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]
    month_by_number = {
        row["snapshot_month"].month: Decimal(str(row["total_value"] or 0))
        for row in month_rows
    }
    week_labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    week_by_day = {
        row["snapshot_day"]: Decimal(str(row["total_value"] or 0))
        for row in week_rows
    }
    now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    hour_slots = [
        now_hour - timedelta(hours=11 - index)
        for index in range(12)
    ]
    hour_by_slot = {
        row["snapshot_hour"].replace(minute=0, second=0, microsecond=0): Decimal(str(row["total_value"] or 0))
        for row in hourly_rows
    }
    available_years = [row["chart_year"] for row in available_year_rows]
    latest_total_value = Decimal(str(latest_total_row["total_value"] or 0)) if latest_total_row else Decimal("0")

    def fill_forward_points(
        labels: list[str],
        values_by_key: dict[Any, Decimal],
        keys: list[Any],
        fallback_value: Decimal,
        is_future_slot: Callable[[Any], bool] | None = None,
    ) -> list[dict[str, Any]]:
        points: list[dict[str, Any]] = []
        last_value = fallback_value if fallback_value > 0 else None

        for label, key in zip(labels, keys):
            if is_future_slot and is_future_slot(key):
                points.append(_chart_point(label, None, False))
                continue

            has_snapshot = key in values_by_key

            if has_snapshot:
                last_value = values_by_key[key]

            points.append(_chart_point(label, last_value, bool(last_value and last_value > 0)))

        return points

    return {
        "activityGrid": activity_grid,
        "chart": {
            "month": fill_forward_points(
                month_labels,
                month_by_number,
                list(range(1, 13)),
                latest_total_value if year == today.year else Decimal("0"),
                lambda month_number: year > today.year or (year == today.year and month_number > today.month),
            ),
            "week": fill_forward_points(
                [
                    week_labels[(week_start + timedelta(days=index)).weekday()]
                    for index in range(7)
                ],
                week_by_day,
                [week_start + timedelta(days=index) for index in range(7)],
                latest_total_value,
            ),
            "day": fill_forward_points(
                [slot.strftime("%H:%M") for slot in hour_slots],
                hour_by_slot,
                hour_slots,
                latest_total_value,
            ),
        },
        "availableYears": available_years,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/portfolio/summary")
async def get_portfolio_summary(
    force_refresh: bool = Query(default=False),
    current_user=Depends(get_current_user),
):
    cache_key = _portfolio_summary_cache_key(current_user["id"])
    now = datetime.now(timezone.utc)
    cached = _portfolio_summary_cache.get(cache_key)

    if not force_refresh and cached and cached["expires_at"] > now:
        return {
            **cached["data"],
            "cached": True,
        }

    pool = get_database_pool()

    async with pool.acquire() as connection:
        wallet_rows = await connection.fetch(
            """
            select id, provider, provider_label, api_key, api_secret_encrypted,
                   permissions, status, last_synced_at, created_at, updated_at
            from wallet_connections
            where user_id = $1 and status = 'active'
            order by created_at asc
            """,
            current_user["id"],
        )

    if not wallet_rows:
        empty_summary = {
            "totalValueRub": 0,
            "changeRub": 0,
            "changePercent": 0,
            "wallets": [],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "cached": False,
        }
        _portfolio_summary_cache[cache_key] = {
            "data": empty_summary,
            "expires_at": now + timedelta(seconds=PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS),
        }

        return empty_summary

    wallets = await asyncio.gather(
        *[_safe_wallet_summary(row) for row in wallet_rows],
    )
    active_wallets = [wallet for wallet in wallets if wallet["status"] == "active"]
    total_value = sum(Decimal(str(wallet["totalValueRub"])) for wallet in active_wallets)
    total_change = sum(Decimal(str(wallet["changeRub"])) for wallet in active_wallets)
    base_value = total_value - total_change
    change_percent = (total_change / base_value * Decimal("100")) if base_value > 0 else Decimal("0")

    async with pool.acquire() as connection:
        async with connection.transaction():
            for wallet in active_wallets:
                await connection.execute(
                    """
                    update wallet_connections
                    set last_synced_at = now(),
                        updated_at = now()
                    where id = $1 and user_id = $2
                    """,
                    UUID(wallet["id"]),
                    current_user["id"],
                )
                await connection.execute(
                    """
                    insert into portfolio_snapshots (
                        user_id, wallet_connection_id, total_value, currency, assets
                    )
                    select $1, $2, $3, 'RUB', $4::jsonb
                    where not exists (
                        select 1
                        from portfolio_snapshots
                        where user_id = $1
                          and wallet_connection_id = $2
                          and created_at > now() - interval '5 minutes'
                    )
                    """,
                    current_user["id"],
                    UUID(wallet["id"]),
                    Decimal(str(wallet["totalValueRub"])),
                    json.dumps(wallet["assets"]),
                )

    summary = {
        "totalValueRub": _decimal_to_float(total_value),
        "changeRub": _decimal_to_float(total_change),
        "changePercent": round(float(change_percent), 2),
        "wallets": wallets,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }
    _portfolio_summary_cache[cache_key] = {
        "data": summary,
        "expires_at": now + timedelta(seconds=PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS),
    }

    return summary
