from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.auth_router import get_current_user
from src.database import get_database_pool
from src.http_client import UpstreamHTTPError
from src.init import bybit_client, tbank_client
from src.router import get_coin_name, get_coinmarketcap_icon_url
from src.stocks_router import get_stock_icon_url
from src.tbank_client import TBankAPIError, normalize_tbank_token, proto_decimal, proto_number


router = APIRouter(tags=["wallets"])

BYBIT_ACCOUNT_TYPES = ("UNIFIED", "SPOT", "CONTRACT")
BYBIT_SOFT_ACCOUNT_ERRORS = {10001, 110001, 110004}
USD_RUB_FALLBACK_RATE = Decimal("90")
_usd_rub_rate_cache: dict[str, Any] = {
    "value": None,
    "expires_at": None,
}
_tbank_instrument_cache: dict[str, dict[str, Any]] = {}


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


class ConnectTBankRequest(BaseModel):
    api_token: str = Field(min_length=10, max_length=4096)


class ConnectBybitRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=255)
    api_secret: str = Field(min_length=8, max_length=255)


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


async def _serialize_tbank_asset(token: str, position: dict[str, Any]) -> dict[str, Any]:
    figi = position.get("figi")
    instrument = await _get_tbank_instrument(token, figi)
    quantity = proto_number(_get(position, "quantity"))
    current_price = proto_decimal(_get(position, "currentPrice", "current_price"))
    expected_yield = proto_decimal(_get(position, "expectedYield", "expected_yield"))
    asset_value = current_price * Decimal(str(quantity))
    ticker = instrument.get("ticker") or position.get("ticker") or figi
    instrument_type = (
        instrument.get("instrumentType")
        or instrument.get("instrument_type")
        or position.get("instrumentType")
        or position.get("instrument_type")
    )
    normalized_type = _normalize_asset_type(instrument_type)
    expected_yield_percent = (
        expected_yield / (asset_value - expected_yield) * Decimal("100")
        if asset_value - expected_yield > 0
        else Decimal("0")
    )

    return {
        "figi": figi,
        "symbol": ticker,
        "name": instrument.get("name") or ticker or "Актив",
        "shortName": ticker,
        "type": normalized_type,
        "provider": "tbank",
        "providerLabel": PROVIDER_LABELS["tbank"],
        "iconUrl": get_stock_icon_url(ticker) if normalized_type == "stock" else None,
        "instrumentType": instrument_type,
        "quantity": quantity,
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
    assets = await asyncio.gather(
        *[
            _serialize_tbank_asset(row["api_key"], position)
            for position in positions
            if isinstance(position, dict)
        ]
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
        "assets": assets[:12],
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
        "currentPriceUsd": _decimal_to_float(current_price_usd),
        "currentPriceRub": _decimal_to_float(current_price_usd * usd_rub_rate),
        "valueUsd": _decimal_to_float(value_usd),
        "valueRub": _decimal_to_float(value_rub),
    }


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
        "assets": assets[:12],
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

    return {"message": "Кошелек удален."}


@router.get("/portfolio/analytics")
async def get_portfolio_analytics(current_user=Depends(get_current_user)):
    pool = get_database_pool()
    today = date.today()
    activity_start = today - timedelta(days=30)
    month_start = today - timedelta(days=30)
    week_start = today - timedelta(days=6)

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
        daily_rows = await connection.fetch(
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
            month_start,
        )
        intraday_rows = await connection.fetch(
            """
            select snapshot_time, sum(total_value) as total_value
            from (
                select distinct on (wallet_connection_id, date_trunc('hour', created_at))
                       date_trunc('hour', created_at) as snapshot_time,
                       wallet_connection_id,
                       total_value
                from portfolio_snapshots
                where user_id = $1 and created_at >= now() - interval '24 hours'
                order by wallet_connection_id, date_trunc('hour', created_at), created_at desc
            ) latest_wallet_snapshots
            group by snapshot_time
            order by snapshot_time asc
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
    daily_points = [
        {
            "date": row["snapshot_day"].isoformat(),
            "label": _format_day_label(row["snapshot_day"]),
            "value": _decimal_to_float(Decimal(str(row["total_value"] or 0))),
        }
        for row in daily_rows
    ]
    week_points = [
        point
        for point in daily_points
        if date.fromisoformat(point["date"]) >= week_start
    ]
    intraday_points = [
        {
            "date": row["snapshot_time"].isoformat(),
            "label": row["snapshot_time"].strftime("%H:%M"),
            "value": _decimal_to_float(Decimal(str(row["total_value"] or 0))),
        }
        for row in intraday_rows
    ]

    return {
        "activityGrid": activity_grid,
        "chart": {
            "month": _pick_chart_points(daily_points, 7),
            "week": _pick_chart_points(week_points, 7),
            "day": _pick_chart_points(intraday_points, 7),
        },
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/portfolio/summary")
async def get_portfolio_summary(current_user=Depends(get_current_user)):
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
        return {
            "totalValueRub": 0,
            "changeRub": 0,
            "changePercent": 0,
            "wallets": [],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

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

    return {
        "totalValueRub": _decimal_to_float(total_value),
        "changeRub": _decimal_to_float(total_change),
        "changePercent": round(float(change_percent), 2),
        "wallets": wallets,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
