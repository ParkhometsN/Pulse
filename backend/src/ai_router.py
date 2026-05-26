from __future__ import annotations

import asyncio
import json
import math
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from aiohttp import ClientSession, ClientTimeout
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.auth_router import get_current_user
from src.config import settings
from src.database import get_database_pool
from src.init import bybit_client, moex_client
from src.router import get_coinmarketcap_icon_url, get_cryptocurrency
from src.stocks_router import (
    calculate_percent_change,
    format_stock,
    get_stock,
    get_stock_candles,
    table_to_dicts,
    to_float,
)
from src.wallets_router import (
    _enrich_tbank_share_with_moex_history,
    _find_active_wallet,
    _find_tbank_share_by_symbol,
    _format_tbank_share,
    _get_tbank_icon_url,
    _get_tbank_trading_status,
)


router = APIRouter(tags=["ai"])
MOSCOW_TZ = timezone(timedelta(hours=3))
PAPER_START_CAPITAL = 100_000.0
PAPER_USD_RUB_RATE = 92.0
PAPER_STRATEGY_SCHEMA_VERSION = 8
PAPER_STRATEGY_IDS = ("ai-short", "ai-long", "ai-short-long")
PAPER_UNIVERSES = {"crypto", "stocks", "mixed"}
PAPER_RISK_PROFILES = {"careful", "balanced", "active"}
PAPER_CAPITAL_CURRENCIES = {"RUB", "USDT", "USD"}
PAPER_MARGIN_MODES = {"none", "spot_cross", "linear_cross", "linear_isolated"}
CORE_CRYPTO_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TONUSDT"}
CORE_STOCK_SYMBOLS = {"SBER", "GAZP", "LKOH", "YDEX", "GMKN", "ROSN", "NVTK", "TATN", "PLZL", "AFLT"}
PAPER_MIN_CAPITAL_RUB = 5_000.0
PAPER_TAKE_PROFIT_PERCENT = 2.0
PAPER_STOP_LOSS_PERCENT = -6.0
PAPER_DCA_STEP_PERCENT = -2.0
PAPER_DCA_ADD_RATIO = 0.45
PAPER_MAX_SCALE_INS = 2
PAPER_MAX_HOLD_MINUTES = 240
PAPER_SCALP_TAKE_PROFIT_PERCENT = 1.0
PAPER_SCALP_STOP_LOSS_PERCENT = -1.8
PAPER_SCALP_DCA_STEP_PERCENT = -0.9
PAPER_SCALP_MAX_HOLD_MINUTES = 55
PAPER_SCALP_MOMENTUM_FADE_PROBABILITY = 54
PAPER_SCALP_PROFIT_LOCK_PERCENT = 0.45
PAPER_CRYPTO_FEE_RATE = 0.001
PAPER_STOCK_FEE_RATE = 0.0005
PAPER_REENTRY_COOLDOWN_MINUTES = 20
PAPER_CHART_POINT_INTERVAL_SECONDS = 60
PAPER_SCHEDULER_INTERVAL_SECONDS = 60
PAPER_SCHEDULER_STARTUP_DELAY_SECONDS = 20
PAPER_MAX_DAILY_TRADES = 240
STRATEGY_MEMORY_SCORE_LIMIT = 15
STRATEGY_GPT_REVIEW_COOLDOWN_HOURS = 12
STRATEGY_CANDIDATES_CACHE_TTL_SECONDS = 45
STRATEGY_RESPONSE_CACHE_TTL_SECONDS = 12
STRATEGY_SNAPSHOT_TIMEOUT_SECONDS = 2.0
_strategy_candidates_cache: dict[str, dict[str, Any]] = {}
_strategy_response_cache: dict[str, dict[str, Any]] = {}
_strategy_response_refresh_tasks: dict[str, asyncio.Task] = {}
PAPER_RISK_MAX_ALLOCATION = {
    "careful": 0.10,
    "balanced": 0.14,
    "active": 0.18,
}


class SaveAISettingsRequest(BaseModel):
    provider: str = Field(default="openai", max_length=40)
    api_key: str | None = Field(default=None, max_length=255)
    model: str = Field(default="gpt-4.1-mini", max_length=120)


class ConnectPaperStrategyRequest(BaseModel):
    virtual_capital: float = Field(default=PAPER_START_CAPITAL, gt=0, le=100_000_000)
    universe: str = Field(default="mixed", max_length=30)
    risk_profile: str = Field(default="balanced", max_length=30)
    capital_currency: str = Field(default="RUB", max_length=12)
    margin_enabled: bool = False
    margin_mode: str = Field(default="none", max_length=30)
    leverage: float = Field(default=1, ge=1, le=10)


def _mask_api_key(value: str | None) -> str | None:
    if not value:
        return None

    if len(value) <= 10:
        return "••••"

    return f"{value[:4]}••••{value[-4:]}"


def _clamp(value: float, minimum: float, maximum: float) -> float:
    if not math.isfinite(value):
        return minimum

    return max(minimum, min(maximum, value))


def _format_signal(score: float, confidence: float) -> str:
    if confidence < 45:
        return "NO_SIGNAL"

    if score >= 60:
        return "BUY"

    if score <= 35:
        return "SELL"

    return "HOLD"


def _point_close(point: dict[str, Any]) -> float:
    return to_float(point.get("close") or point.get("price"))


def _calculate_asset_score(asset: dict[str, Any]) -> dict[str, Any]:
    chart = [point for point in asset.get("chart") or asset.get("chart7d") or [] if isinstance(point, dict)]
    current_price = to_float(asset.get("price"))
    if current_price <= 0 and chart:
        current_price = _point_close(chart[-1])

    change_1d = to_float(asset.get("priceChangePercent24h"))
    change_7d = to_float(asset.get("priceChangePercent7d"))
    change_30d = to_float(asset.get("priceChangePercent30d"))

    closes = [_point_close(point) for point in chart if _point_close(point) > 0]
    returns = [
        (closes[index] - closes[index - 1]) / closes[index - 1] * 100
        for index in range(1, len(closes))
        if closes[index - 1] > 0
    ]
    volatility = math.sqrt(sum(value * value for value in returns) / len(returns)) if returns else abs(change_1d)
    positive_days = sum(1 for value in returns if value > 0)
    trend_quality = positive_days / len(returns) * 100 if returns else 50
    turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))

    momentum_score = _clamp(50 + change_1d * 1.8 + change_7d * 1.1 + change_30d * 0.45, 0, 100)
    liquidity_score = _clamp(35 + math.log10(max(turnover, 1)) * 9, 0, 100)
    risk_score = _clamp(100 - volatility * 6, 0, 100)
    quality_score = _clamp((trend_quality * 0.7) + (risk_score * 0.3), 0, 100)
    composite = (
        momentum_score * 0.42
        + liquidity_score * 0.20
        + risk_score * 0.18
        + quality_score * 0.20
    )
    symbol = str(asset.get("symbol") or "").upper()
    if symbol in CORE_CRYPTO_SYMBOLS or symbol in CORE_STOCK_SYMBOLS:
        composite += 4
        liquidity_score = min(liquidity_score + 5, 100)

    if turnover > 0 and turnover < 100_000 and asset.get("assetType") == "crypto":
        composite -= 12

    composite = _clamp(composite, 0, 100)
    data_flags: list[str] = []

    if len(closes) < 3:
        data_flags.append("short_chart_history")

    if turnover <= 0:
        data_flags.append("missing_turnover")

    if volatility > 14:
        data_flags.append("high_volatility")

    confidence = _clamp(88 - len(data_flags) * 14 - max(volatility - 10, 0) * 1.7, 20, 92)
    signal = _format_signal(composite, confidence)
    target_move = _clamp((composite - 50) / 100 * max(6, volatility * 1.8), -18, 18)
    target_price = current_price * (1 + target_move / 100) if current_price > 0 else 0
    range_width = max(abs(target_move) * 0.38, min(max(volatility, 1.2), 8))
    target_range_low = target_price * (1 - range_width / 100) if target_price > 0 else 0
    target_range_high = target_price * (1 + range_width / 100) if target_price > 0 else 0

    return {
        "score": round(composite, 2),
        "signal": signal,
        "confidence": round(confidence, 2),
        "targetPrice": round(target_price, 8),
        "targetMovePercent": round(target_move, 2),
        "targetDelta": round(target_price - current_price, 8),
        "targetRangeLow": round(min(target_range_low, target_range_high), 8),
        "targetRangeHigh": round(max(target_range_low, target_range_high), 8),
        "factors": {
            "momentum": round(momentum_score, 2),
            "liquidity": round(liquidity_score, 2),
            "risk": round(risk_score, 2),
            "quality": round(quality_score, 2),
            "volatility": round(volatility, 2),
            "change1d": round(change_1d, 2),
            "change7d": round(change_7d, 2),
            "change30d": round(change_30d, 2),
        },
        "dataQualityFlags": data_flags,
    }


async def _load_user_ai_settings(user_id: Any) -> dict[str, Any]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """
            select provider, api_key, model, updated_at
            from user_ai_settings
            where user_id = $1
            """,
            user_id,
        )

    return dict(row) if row else {}


async def _get_openai_key_for_user(user_id: Any) -> tuple[str | None, str]:
    user_settings = await _load_user_ai_settings(user_id)
    api_key = user_settings.get("api_key") or settings.resolved_openai_api_key
    model = user_settings.get("model") or settings.openai_model

    return api_key, model


def _extract_json_object(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


async def _call_openai_asset_review(
    api_key: str | None,
    model: str,
    asset: dict[str, Any],
    score_payload: dict[str, Any],
) -> dict[str, Any] | None:
    if not api_key:
        return None

    prompt = {
        "task": "Верни только JSON. Это research-сигнал, не персональная инвестиционная рекомендация.",
        "asset": {
            "symbol": asset.get("symbol"),
            "name": asset.get("name"),
            "assetType": asset.get("assetType") or asset.get("type"),
            "price": asset.get("price"),
            "change24h": asset.get("priceChangePercent24h"),
            "change7d": asset.get("priceChangePercent7d"),
            "change30d": asset.get("priceChangePercent30d"),
            "turnover24h": asset.get("turnover24h"),
        },
        "computed_score": score_payload,
        "required_schema": {
            "score_adjustment": "number from -8 to 8",
            "summary": "short Russian explanation",
            "risk_flags": ["strings"],
            "source_manifest": ["short source names"],
        },
    }
    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "Ты multi-asset research orchestrator. "
                    "Не выдумывай числа, не давай персональных советов, "
                    "используй NO_SIGNAL при слабом качестве данных."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "tools": [{"type": "web_search_preview"}],
    }

    try:
        async with ClientSession(timeout=ClientTimeout(total=24, connect=5, sock_read=18)) as session:
            async with session.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                data = await response.json(content_type=None)

                if response.status >= 400:
                    return None

                output_text = data.get("output_text")
                if not output_text:
                    output_text = "\n".join(
                        content.get("text", "")
                        for item in data.get("output", [])
                        for content in item.get("content", [])
                        if isinstance(content, dict)
                    )

                return _extract_json_object(output_text or "")
    except Exception:
        return None


async def _call_openai_asset_summary(
    api_key: str | None,
    model: str,
    asset: dict[str, Any],
    score_payload: dict[str, Any],
) -> str | None:
    if not api_key:
        return None

    prompt = {
        "task": (
            "Сделай короткую, понятную русскую сводку по активу для модального окна приложения. "
            "Это research-summary, не персональная инвестиционная рекомендация."
        ),
        "asset": {
            "symbol": asset.get("symbol"),
            "name": asset.get("name"),
            "assetType": asset.get("assetType") or asset.get("type"),
            "price": asset.get("price"),
            "change24h": asset.get("priceChangePercent24h"),
            "change7d": asset.get("priceChangePercent7d"),
            "change30d": asset.get("priceChangePercent30d"),
            "turnover24h": asset.get("turnover24h"),
        },
        "model_forecast": score_payload,
        "format": (
            "4-6 небольших абзацев. Объясни драйверы, риски, качество данных и почему сигнал BUY/HOLD/SELL/NO_SIGNAL. "
            "Не выдумывай точные факты без источников. Если данных мало, прямо скажи об этом."
        ),
    }
    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "Ты аккуратный финансовый research-аналитик. "
                    "Не даешь персональных советов, отделяешь факты от интерпретации, "
                    "а при слабых данных честно пишешь об ограничениях."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "tools": [{"type": "web_search_preview"}],
    }

    try:
        async with ClientSession(timeout=ClientTimeout(total=28, connect=5, sock_read=22)) as session:
            async with session.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                data = await response.json(content_type=None)

                if response.status >= 400:
                    return None

                output_text = data.get("output_text")
                if output_text:
                    return output_text.strip()

                return "\n".join(
                    content.get("text", "")
                    for item in data.get("output", [])
                    for content in item.get("content", [])
                    if isinstance(content, dict)
                ).strip() or None
    except Exception:
        return None


async def _call_openai_strategy_memory_review(
    api_key: str | None,
    model: str,
    memory_item: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any] | None:
    if not api_key:
        return None

    prompt = {
        "task": (
            "Верни только JSON. Проанализируй paper-сделку стратегии и сформулируй урок "
            "для будущих входов. Это исследовательская симуляция, не персональный совет."
        ),
        "memory": memory_item,
        "latest_event": event,
        "required_schema": {
            "summary": "1 short Russian sentence",
            "mistake": "what went wrong or null",
            "rule_update": "concrete rule for next entries",
            "risk_note": "short risk note",
            "confidence": "number 0-100",
        },
    }
    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "Ты осторожный quantitative trading reviewer. "
                    "Не обещай доходность, не выдумывай внешние факты, "
                    "делай короткие проверяемые правила по данным сделки."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
    }

    try:
        async with ClientSession(timeout=ClientTimeout(total=18, connect=5, sock_read=12)) as session:
            async with session.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                data = await response.json(content_type=None)

                if response.status >= 400:
                    return None

                output_text = data.get("output_text")
                if not output_text:
                    output_text = "\n".join(
                        content.get("text", "")
                        for item in data.get("output", [])
                        for content in item.get("content", [])
                        if isinstance(content, dict)
                    )

                return _extract_json_object(output_text or "")
    except Exception:
        return None


async def _load_tbank_stock_for_user(user_id: Any, symbol: str, figi: str | None = None) -> dict[str, Any] | None:
    wallet = await _find_active_wallet(user_id, "tbank")
    if not wallet:
        return None

    instrument = await _find_tbank_share_by_symbol(wallet["api_key"], symbol, figi)
    if not instrument:
        return None

    price_map = {}
    try:
        from src.init import tbank_client
        from src.tbank_client import proto_decimal

        price_response = await tbank_client.get_last_prices(wallet["api_key"], [instrument["figi"]])
        price_map = {
            item.get("figi"): proto_decimal(item.get("price"))
            for item in price_response.get("lastPrices", [])
            if isinstance(item, dict) and item.get("figi")
        }
    except Exception:
        price_map = {}

    try:
        trading_status = await _get_tbank_trading_status(wallet["api_key"], instrument)
    except Exception:
        trading_status = None

    formatted = _format_tbank_share(instrument, price_map, trading_status)
    if not formatted:
        return None

    enriched = await _enrich_tbank_share_with_moex_history(formatted)
    return {**enriched, "assetType": "stock"}


async def _load_asset_for_score(
    asset_type: str,
    symbol: str,
    user_id: Any | None = None,
    figi: str | None = None,
) -> dict[str, Any]:
    normalized_type = asset_type.lower()
    normalized_symbol = symbol.upper()

    if normalized_type == "stock":
        if user_id:
            tbank_asset = await _load_tbank_stock_for_user(user_id, normalized_symbol, figi)
            if tbank_asset:
                return tbank_asset

        asset = await get_stock(normalized_symbol)
        return {**asset, "assetType": "stock"}

    if normalized_symbol in {"RUB", "USD"}:
        price = 1 if normalized_symbol == "USD" else 1
        return {
            "assetType": "currency",
            "symbol": normalized_symbol,
            "name": "Доллар США" if normalized_symbol == "USD" else "Российский рубль",
            "price": price,
            "priceChangePercent24h": 0,
            "priceChangePercent7d": 0,
            "priceChangePercent30d": 0,
            "chart7d": [],
            "turnover24h": 0,
        }

    try:
        asset = await get_cryptocurrency(normalized_symbol)
        return {**asset, "assetType": "crypto"}
    except HTTPException:
        if not normalized_symbol.endswith("USDT"):
            raise

        ticker = await bybit_client.get_ticker(normalized_symbol, "spot")
        if not ticker:
            raise

        base_symbol = normalized_symbol.removesuffix("USDT")
        price = to_float(ticker.get("lastPrice"))
        change_1d = to_float(ticker.get("price24hPcnt")) * 100

        return {
            "assetType": "crypto",
            "symbol": normalized_symbol,
            "name": base_symbol,
            "shortName": base_symbol,
            "baseCoin": base_symbol,
            "quoteCoin": "USDT",
            "iconUrl": get_coinmarketcap_icon_url(base_symbol),
            "price": price,
            "priceChangePercent24h": change_1d,
            "priceChangePercent7d": change_1d,
            "priceChangePercent30d": change_1d,
            "turnover24h": to_float(ticker.get("turnover24h")),
            "volume24h": to_float(ticker.get("volume24h")),
            "chart7d": [],
            "dataQualityFlags": ["ticker_only_fallback"],
        }


def _build_unavailable_score_payload(symbol: str, asset_type: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "assetType": asset_type,
        "score": 50,
        "signal": "NO_SIGNAL",
        "confidence": 35,
        "targetPrice": 0,
        "targetRangeLow": 0,
        "targetRangeHigh": 0,
        "model": "deterministic-v2",
        "summary": "AI-прогноз временно ограничен: рыночный провайдер не ответил. На фронте используется локальный дневной расчет по последним данным актива.",
        "factors": {},
        "riskFlags": ["market_provider_unavailable"],
        "sourceManifest": ["fallback"],
        "dataQualityFlags": ["market_provider_unavailable"],
        "cached": False,
        "providerUnavailable": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


async def _store_asset_score(
    user_id: Any,
    asset_type: str,
    symbol: str,
    figi: str | None,
    payload: dict[str, Any],
) -> None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_asset_scores (
                user_id, asset_type, symbol, figi, score, signal, confidence,
                target_price, model, summary, factors, source_manifest, data_quality_flags
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
            """,
            user_id,
            asset_type,
            symbol,
            figi,
            payload["score"],
            payload["signal"],
            payload["confidence"],
            payload.get("targetPrice"),
            payload.get("model"),
            payload.get("summary"),
            json.dumps(payload.get("factors", {})),
            json.dumps(payload.get("sourceManifest", [])),
            json.dumps(payload.get("dataQualityFlags", [])),
        )


async def _load_strategy_connection(user_id: Any, strategy_id: str) -> dict[str, Any] | None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """
            select strategy_id, virtual_capital, universe, risk_profile, capital_currency,
                   margin_enabled, margin_mode, leverage, is_active, connected_at, updated_at
            from ai_strategy_connections
            where user_id = $1 and strategy_id = $2 and is_active = true
            """,
            user_id,
            strategy_id,
        )

    if not row:
        return None

    return {
        "strategyId": row["strategy_id"],
        "virtualCapital": float(row["virtual_capital"] or PAPER_START_CAPITAL),
        "universe": row["universe"],
        "riskProfile": row["risk_profile"],
        "capitalCurrency": row["capital_currency"] or "RUB",
        "marginEnabled": bool(row["margin_enabled"]),
        "marginMode": row["margin_mode"] or "none",
        "leverage": float(row["leverage"] or 1),
        "isActive": row["is_active"],
        "connectedAt": row["connected_at"].isoformat() if row["connected_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


async def _record_paper_strategy_trades(user_id: Any, strategy_id: str, payload: dict[str, Any]) -> None:
    # Strategy trades live in ai_paper_strategy_runs. Keeping them out of the
    # portfolio trade feed avoids mixing simulations with real broker history.
    return


def _strategy_run_date() -> date:
    now = datetime.now(MOSCOW_TZ)
    current_day = now.date()

    return current_day if now.hour >= 13 else current_day - timedelta(days=1)


def _strategy_start_datetime(run_date: date) -> datetime:
    return datetime(
        year=run_date.year,
        month=run_date.month,
        day=run_date.day,
        hour=13,
        minute=0,
        tzinfo=MOSCOW_TZ,
    )


def _strategy_now() -> datetime:
    return datetime.now(MOSCOW_TZ)


def _strategy_asset_matches_universe(asset: dict[str, Any], universe: str) -> bool:
    asset_type = asset.get("assetType") or "crypto"

    if universe == "crypto":
        return asset_type == "crypto"

    if universe == "stocks":
        return asset_type == "stock"

    return asset_type in {"crypto", "stock"}


def _paper_price_rate(asset_type: str, quote_currency: str) -> float:
    if asset_type == "stock" or quote_currency == "RUB":
        return 1.0

    return PAPER_USD_RUB_RATE


def _paper_fee_rate(asset_type: str) -> float:
    return PAPER_STOCK_FEE_RATE if asset_type == "stock" else PAPER_CRYPTO_FEE_RATE


def _calculate_paper_trade_pnl(
    side: str,
    asset_type: str,
    quote_currency: str,
    entry_price: float,
    current_price: float,
    quantity: float,
) -> dict[str, float]:
    if entry_price <= 0 or current_price <= 0 or quantity <= 0:
        return {
            "grossResultAmount": 0.0,
            "feesAmount": 0.0,
            "resultAmount": 0.0,
        }

    price_currency_rate = _paper_price_rate(asset_type, quote_currency)
    entry_value = entry_price * quantity * price_currency_rate
    exit_value = current_price * quantity * price_currency_rate
    gross_pnl = (
        entry_value - exit_value
        if side == "Short"
        else exit_value - entry_value
    )
    fees = (entry_value + exit_value) * _paper_fee_rate(asset_type)

    return {
        "grossResultAmount": gross_pnl,
        "feesAmount": fees,
        "resultAmount": gross_pnl - fees,
    }


def _capital_currency_rate(currency: str) -> float:
    normalized_currency = str(currency or "RUB").upper()

    if normalized_currency == "RUB":
        return 1.0

    return PAPER_USD_RUB_RATE


def _capital_to_rub(amount: float, currency: str) -> float:
    return max(float(amount or 0), 0) * _capital_currency_rate(currency)


def _parse_strategy_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value

    if not isinstance(value, str) or not value:
        return None

    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=MOSCOW_TZ)
    except ValueError:
        return None


def _strategy_candidates_by_symbol(candidates: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(candidate.get("symbol") or "").upper(): candidate
        for candidate in candidates
        if candidate.get("symbol")
    }


def _calculate_short_term_probability(score_payload: dict[str, Any], asset: dict[str, Any]) -> float:
    factors = score_payload.get("factors") or {}
    change_1d = to_float(factors.get("change1d"))
    change_7d = to_float(factors.get("change7d"))
    change_30d = to_float(factors.get("change30d"))
    liquidity = to_float(factors.get("liquidity"))
    risk = to_float(factors.get("risk"))
    volatility = to_float(factors.get("volatility"))
    symbol = str(asset.get("symbol") or "").upper()
    turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))
    core_bonus = 6 if symbol in CORE_CRYPTO_SYMBOLS or symbol in CORE_STOCK_SYMBOLS else 0
    liquidity_bonus = (liquidity - 50) * 0.28
    turnover_bonus = _clamp(math.log10(max(turnover, 1)) - 6, 0, 3.5) * 1.8
    breakout_bonus = 0
    if 1.2 <= change_1d <= 14 and change_7d >= -8:
        breakout_bonus += min(change_1d * 0.9, 8)
    if 14 < change_1d <= 28 and liquidity >= 58:
        breakout_bonus += 4
    momentum = (
        max(change_1d, 0) * 2.55
        + max(change_7d, 0) * 0.8
        + max(change_30d, 0) * 0.2
    )
    weak_trend_penalty = (
        max(-change_1d, 0) * 2.0
        + max(-change_7d, 0) * 0.7
    )
    overheating_penalty = max(change_1d - 18, 0) * 0.85 + max(volatility - 18, 0) * 1.2
    micro_liquidity_penalty = 14 if asset.get("assetType") == "crypto" and 0 < turnover < 1_000_000 else 0

    return _clamp(
        48
        + momentum
        + liquidity_bonus
        + turnover_bonus
        + breakout_bonus
        + (risk - 50) * 0.06
        + core_bonus
        - weak_trend_penalty
        - overheating_penalty
        - micro_liquidity_penalty,
        0,
        100,
    )


def _calculate_short_probability(score_payload: dict[str, Any]) -> float:
    factors = score_payload.get("factors") or {}
    change_1d = to_float(factors.get("change1d"))
    change_7d = to_float(factors.get("change7d"))
    change_30d = to_float(factors.get("change30d"))
    liquidity = to_float(factors.get("liquidity"))
    risk = to_float(factors.get("risk"))
    bearish_momentum = (
        max(-change_1d, 0) * 2.4
        + max(-change_7d, 0) * 1.15
        + max(-change_30d, 0) * 0.45
    )
    bullish_penalty = (
        max(change_1d, 0) * 1.35
        + max(change_7d, 0) * 0.65
        + max(change_30d, 0) * 0.25
    )

    return _clamp(
        50 + bearish_momentum - bullish_penalty + (liquidity - 50) * 0.12 + (risk - 50) * 0.08,
        0,
        100,
    )


def _strategy_config(strategy_id: str) -> dict[str, str]:
    return {
        "ai-short": {"title": "ИИ торговля Short", "mode": "scalp", "color": "var(--green)"},
        "ai-long": {"title": "ИИ торговля Long", "mode": "long", "color": "var(--green)"},
        "ai-short-long": {"title": "ИИ торговля Short + Long", "mode": "hybrid", "color": "var(--primary-blue)"},
    }[strategy_id]


def _strategy_trade_rules(payload: dict[str, Any], trade: dict[str, Any]) -> dict[str, float | None]:
    mode = str(payload.get("mode") or "").lower()
    strategy_leg = str(
        trade.get("strategyLeg")
        or (trade.get("entryContext") or {}).get("strategyLeg")
        or ""
    ).lower()

    if mode == "scalp" or strategy_leg == "scalp":
        return {
            "takeProfit": PAPER_SCALP_TAKE_PROFIT_PERCENT,
            "stopLoss": PAPER_SCALP_STOP_LOSS_PERCENT,
            "dcaStep": PAPER_SCALP_DCA_STEP_PERCENT,
            "maxHoldMinutes": PAPER_SCALP_MAX_HOLD_MINUTES,
            "fadeProbability": PAPER_SCALP_MOMENTUM_FADE_PROBABILITY,
            "minFadeHoldMinutes": 7,
            "profitLock": PAPER_SCALP_PROFIT_LOCK_PERCENT,
        }

    if trade.get("side") == "Short":
        return {
            "takeProfit": 1.4,
            "stopLoss": -2.6,
            "dcaStep": -1.2,
            "maxHoldMinutes": 120,
            "fadeProbability": 52,
            "minFadeHoldMinutes": 12,
            "profitLock": 0.65,
        }

    return {
        "takeProfit": PAPER_TAKE_PROFIT_PERCENT,
        "stopLoss": PAPER_STOP_LOSS_PERCENT,
        "dcaStep": PAPER_DCA_STEP_PERCENT,
        "maxHoldMinutes": PAPER_MAX_HOLD_MINUTES,
        "fadeProbability": None,
        "minFadeHoldMinutes": 20,
        "profitLock": None,
    }


def _calculate_trade_live_probability(
    payload: dict[str, Any],
    trade: dict[str, Any],
    candidate: dict[str, Any] | None,
) -> float | None:
    if not candidate:
        return None

    score_payload = _calculate_asset_score(candidate)
    mode = str(payload.get("mode") or "").lower()
    strategy_leg = str(
        trade.get("strategyLeg")
        or (trade.get("entryContext") or {}).get("strategyLeg")
        or ""
    ).lower()

    if mode == "scalp" or strategy_leg == "scalp":
        return _calculate_short_term_probability(score_payload, candidate)

    if trade.get("side") == "Short":
        return _calculate_short_probability(score_payload)

    return to_float(score_payload.get("score"))


def _is_recent_strategy_trade(trade: dict[str, Any], cooldown_minutes: int = PAPER_REENTRY_COOLDOWN_MINUTES) -> bool:
    last_activity = _parse_strategy_datetime(
        trade.get("closedAt") or trade.get("updatedAt") or trade.get("executedAt")
    )

    if not last_activity:
        return False

    return (_strategy_now() - last_activity).total_seconds() < cooldown_minutes * 60


def _format_strategy_memory_row(row: Any) -> dict[str, Any]:
    return {
        "assetSymbol": row["asset_symbol"],
        "strategyId": row["strategy_id"],
        "tradesCount": int(row["trades_count"] or 0),
        "winsCount": int(row["wins_count"] or 0),
        "lossesCount": int(row["losses_count"] or 0),
        "netResultAmount": float(row["net_result_amount"] or 0),
        "avgResultPercent": float(row["avg_result_percent"] or 0),
        "memoryScore": float(row["memory_score"] or 0),
        "lastEventType": row["last_event_type"],
        "lastLesson": _safe_json_payload(row["last_lesson"], {}),
        "gptReview": _safe_json_payload(row["gpt_review"], {}),
        "lastReviewedAt": row["last_reviewed_at"].isoformat() if row["last_reviewed_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


async def _load_strategy_memory(user_id: Any, strategy_id: str) -> dict[str, dict[str, Any]]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id, asset_symbol, trades_count, wins_count, losses_count,
                   net_result_amount, avg_result_percent, memory_score,
                   last_event_type, last_lesson, gpt_review, last_reviewed_at, updated_at
            from ai_strategy_memory
            where user_id = $1 and strategy_id = $2
            order by abs(memory_score) desc, updated_at desc
            limit 80
            """,
            user_id,
            strategy_id,
        )

    return {
        row["asset_symbol"].upper(): _format_strategy_memory_row(row)
        for row in rows
    }


async def _load_strategy_events(user_id: Any, strategy_id: str, limit: int = 12) -> list[dict[str, Any]]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id, asset_symbol, event_type, severity, result_percent,
                   result_amount, close_reason, context, lesson, created_at
            from ai_strategy_events
            where user_id = $1 and strategy_id = $2
            order by created_at desc
            limit $3
            """,
            user_id,
            strategy_id,
            limit,
        )

    return [
        {
            "strategyId": row["strategy_id"],
            "assetSymbol": row["asset_symbol"],
            "eventType": row["event_type"],
            "severity": float(row["severity"] or 0),
            "resultPercent": float(row["result_percent"] or 0),
            "resultAmount": float(row["result_amount"] or 0),
            "closeReason": row["close_reason"],
            "context": _safe_json_payload(row["context"], {}),
            "lesson": _safe_json_payload(row["lesson"], {}),
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]


def _memory_score_adjustment(memory_item: dict[str, Any] | None) -> float:
    if not memory_item:
        return 0

    score = to_float(memory_item.get("memoryScore"))
    trades_count = int(memory_item.get("tradesCount") or 0)
    losses_count = int(memory_item.get("lossesCount") or 0)
    wins_count = int(memory_item.get("winsCount") or 0)
    confidence_multiplier = min(trades_count / 5, 1)
    loss_bias = min(max(losses_count - wins_count, 0) * 0.9, 3)

    return _clamp(score * 0.55 * confidence_multiplier - loss_bias, -10, 10)


def _memory_blocks_entry(memory_item: dict[str, Any] | None, raw_probability: float) -> bool:
    if not memory_item:
        return False

    trades_count = int(memory_item.get("tradesCount") or 0)
    losses_count = int(memory_item.get("lossesCount") or 0)
    memory_score = to_float(memory_item.get("memoryScore"))

    return trades_count >= 3 and losses_count >= 2 and memory_score <= -8 and raw_probability < 82


def _build_strategy_lesson(trade: dict[str, Any], payload: dict[str, Any]) -> tuple[str, float, dict[str, Any]]:
    result_percent = to_float(trade.get("resultPercent"))
    close_reason = str(trade.get("closeReason") or "")
    side = str(trade.get("side") or "Long")
    probability = to_float(trade.get("probability"))
    current_probability = to_float(trade.get("currentProbability") or probability)
    event_type = "profit_capture" if result_percent > 0 else "flat_exit"
    severity = abs(result_percent)
    rule_update = "Повторять похожий вход только при подтвержденной ликвидности и сохранении импульса."
    mistake = None

    if result_percent < 0:
        if close_reason == "stop_loss":
            event_type = "loss_stop"
            mistake = "Позиция дошла до стопа: вход или усреднение были слишком ранними."
            rule_update = "Снижать вероятность повторного входа в этот актив, пока новый momentum не станет существенно сильнее."
            severity += 2.5
        elif close_reason == "momentum_fade":
            event_type = "momentum_fade_loss"
            mistake = "Импульс погас до фиксации прибыли."
            rule_update = "Для похожих входов быстрее фиксировать малую прибыль и не держать при падении live probability."
            severity += 1.4
        elif close_reason == "time_exit":
            event_type = "slow_trade_loss"
            mistake = "Сделка не дала продолжения за отведенное время."
            rule_update = "Понижать вес активов, где импульс не развивается после входа."
            severity += 1.0
        else:
            event_type = "loss_exit"
            mistake = "Закрытие в минус без сильного подтверждения импульса."
            rule_update = "Требовать более высокий score и меньшую волатильность для повторного входа."
            severity += 1.0
    elif close_reason == "take_profit":
        rule_update = "Похожий паттерн можно повторять, но не увеличивать риск без роста win-rate."
    elif close_reason == "momentum_fade":
        event_type = "profit_lock"
        rule_update = "Фиксация при затухании импульса сработала, сохранять правило раннего выхода."

    return event_type, round(severity, 4), {
        "summary": (
            f"{trade.get('asset')} {side}: {result_percent:.2f}% за сделку; "
            f"выход {close_reason or 'manual/model'}."
        ),
        "mistake": mistake,
        "ruleUpdate": rule_update,
        "probabilityAtEntry": round(probability, 2),
        "probabilityAtExit": round(current_probability, 2),
        "strategyMode": payload.get("mode"),
    }


def _select_strategy_entries(
    strategy_id: str,
    candidates: list[dict[str, Any]],
    connection: dict[str, Any] | None = None,
    limit: int = 5,
    excluded_symbols: set[str] | None = None,
    memory: dict[str, dict[str, Any]] | None = None,
) -> list[tuple[float, str, dict[str, Any], dict[str, Any]]]:
    config = _strategy_config(strategy_id)
    scalp_ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
    long_ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
    short_ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
    connection = connection or {}
    memory = memory or {}
    universe = str(connection.get("universe") or "mixed").lower()
    excluded_symbols = excluded_symbols or set()

    for asset in candidates:
        symbol = str(asset.get("symbol") or "").upper()
        if not symbol or symbol in excluded_symbols:
            continue

        if not _strategy_asset_matches_universe(asset, universe):
            continue

        score_payload = _calculate_asset_score(asset)
        if score_payload["confidence"] < 45:
            continue

        turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))
        if asset.get("assetType") == "crypto" and 0 < turnover < 500_000:
            continue

        long_probability = score_payload["score"]
        short_term_probability = _calculate_short_term_probability(score_payload, asset)
        short_probability = _calculate_short_probability(score_payload)
        mode = config["mode"]
        memory_item = memory.get(symbol)
        memory_adjustment = _memory_score_adjustment(memory_item)
        memory_payload = {
            "rawLongProbability": round(long_probability, 2),
            "rawScalpProbability": round(short_term_probability, 2),
            "rawShortProbability": round(short_probability, 2),
            "memoryAdjustment": round(memory_adjustment, 2),
            "memoryScore": round(to_float(memory_item.get("memoryScore")) if memory_item else 0, 2),
            "tradesCount": int(memory_item.get("tradesCount") or 0) if memory_item else 0,
        }

        if _memory_blocks_entry(memory_item, max(long_probability, short_term_probability, short_probability)):
            continue

        long_probability = _clamp(long_probability + memory_adjustment, 0, 100)
        short_term_probability = _clamp(short_term_probability + memory_adjustment, 0, 100)
        short_probability = _clamp(short_probability + memory_adjustment * 0.45, 0, 100)
        score_payload = {
            **score_payload,
            "memory": memory_payload,
        }

        if mode == "scalp" and short_term_probability >= 60:
            scalp_ranked.append((short_term_probability, "Long", asset, {**score_payload, "strategyLeg": "scalp"}))

        if mode in {"long", "hybrid"} and long_probability >= 60:
            long_ranked.append((long_probability, "Long", asset, {**score_payload, "strategyLeg": "long"}))

        if mode == "hybrid" and short_term_probability >= 60:
            scalp_ranked.append((short_term_probability, "Long", asset, {**score_payload, "strategyLeg": "scalp"}))

        if (
            mode in {"short", "hybrid"}
            and short_probability >= 60
            and long_probability <= 48
            and to_float((score_payload.get("factors") or {}).get("change1d")) <= -0.8
        ):
            short_ranked.append((short_probability, "Short", asset, {**score_payload, "strategyLeg": "short"}))

    scalp_ranked.sort(key=lambda item: item[0], reverse=True)
    long_ranked.sort(key=lambda item: item[0], reverse=True)
    short_ranked.sort(key=lambda item: item[0], reverse=True)

    if config["mode"] == "scalp":
        return scalp_ranked[:limit]

    if config["mode"] == "hybrid":
        selected: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
        selected_symbols: set[str] = set()

        def add_unique(items: list[tuple[float, str, dict[str, Any], dict[str, Any]]], max_items: int) -> None:
            for item in items:
                symbol = str(item[2].get("symbol") or "").upper()
                if not symbol or symbol in selected_symbols:
                    continue

                selected.append(item)
                selected_symbols.add(symbol)

                if len(selected) >= max_items:
                    return

        add_unique(scalp_ranked[:3], limit)
        add_unique(long_ranked[:3], limit)
        if len(selected) < max(2, min(limit, 4)):
            add_unique(short_ranked[:2], limit)

        rest = sorted([*scalp_ranked, *long_ranked, *short_ranked], key=lambda item: item[0], reverse=True)
        for item in rest:
            if len(selected) >= limit:
                break
            symbol = str(item[2].get("symbol") or "").upper()
            if symbol and symbol not in selected_symbols:
                selected.append(item)
                selected_symbols.add(symbol)
        return selected[:limit]

    return (short_ranked if config["mode"] == "short" else long_ranked)[:limit]


def _build_strategy_trade(
    probability: float,
    side: str,
    asset: dict[str, Any],
    score_payload: dict[str, Any],
    allocation_rub: float,
    executed_at: datetime,
) -> dict[str, Any]:
    entry_price = to_float(asset.get("price"))
    asset_type = asset.get("assetType") or "crypto"
    quote_currency = "RUB" if asset_type == "stock" else "USDT"
    price_currency_rate = _paper_price_rate(asset_type, quote_currency)
    quantity = allocation_rub / (entry_price * price_currency_rate) if entry_price > 0 else 0

    return {
        "asset": asset.get("symbol"),
        "name": asset.get("name") or asset.get("shortName") or asset.get("symbol"),
        "assetType": asset_type,
        "side": side,
        "strategyLeg": score_payload.get("strategyLeg") or ("short" if side == "Short" else "long"),
        "probability": round(probability, 2),
        "entryPrice": round(entry_price, 8),
        "currentPrice": round(entry_price, 8),
        "exitPrice": round(entry_price, 8),
        "quantity": round(quantity, 10),
        "quoteCurrency": quote_currency,
        "settlementCurrency": "RUB",
        "virtualAmount": round(allocation_rub, 2),
        "resultPercent": 0,
        "resultAmount": 0,
        "signal": score_payload["signal"],
        "entryContext": {
            "score": score_payload.get("score"),
            "confidence": score_payload.get("confidence"),
            "factors": score_payload.get("factors") or {},
            "memory": score_payload.get("memory") or {},
            "strategyLeg": score_payload.get("strategyLeg") or ("short" if side == "Short" else "long"),
        },
        "status": "open",
        "closeReason": None,
        "scaleInCount": 0,
        "events": [],
        "iconUrl": asset.get("iconUrl"),
        "executedAt": executed_at.isoformat(),
        "routeSymbol": asset.get("symbol"),
    }


async def _load_strategy_candidates(user_id: Any | None = None) -> list[dict[str, Any]]:
    cache_key = str(user_id or "anonymous")
    cached = _strategy_candidates_cache.get(cache_key)
    now_monotonic = time.monotonic()

    if cached and now_monotonic - cached["created_at"] < STRATEGY_CANDIDATES_CACHE_TTL_SECONDS:
        return cached["items"]

    candidates: list[dict[str, Any]] = []
    tbank_token: str | None = None

    if user_id:
        try:
            tbank_wallet = await _find_active_wallet(user_id, "tbank")
            tbank_token = tbank_wallet["api_key"] if tbank_wallet else None
        except Exception:
            tbank_token = None

    try:
        tickers = await bybit_client.get_tickers("spot")
        tradable_tickers = [
            item for item in tickers
            if str(item.get("symbol") or "").endswith("USDT")
            and str(item.get("symbol") or "").removesuffix("USDT") not in {"USDT", "USDC", "DAI", "BUSD"}
        ]
        liquid_tickers = [
            item for item in tradable_tickers
            if to_float(item.get("turnover24h")) >= 1_000_000
        ]
        top_by_turnover = sorted(
            tradable_tickers,
            key=lambda item: to_float(item.get("turnover24h")),
            reverse=True,
        )[:24]
        top_fallers = sorted(
            liquid_tickers,
            key=lambda item: to_float(item.get("price24hPcnt")),
        )[:12]
        top_gainers = sorted(
            liquid_tickers,
            key=lambda item: to_float(item.get("price24hPcnt")),
            reverse=True,
        )[:18]
        core_tickers = [
            item for item in tradable_tickers
            if str(item.get("symbol") or "").upper() in CORE_CRYPTO_SYMBOLS
        ]
        crypto_tickers = {
            str(item.get("symbol") or ""): item
            for item in [*core_tickers, *top_by_turnover, *top_gainers, *top_fallers]
            if item.get("symbol")
        }.values()

        for item in crypto_tickers:
            symbol = str(item.get("symbol") or "")
            base = symbol.removesuffix("USDT")
            change = to_float(item.get("price24hPcnt")) * 100
            candidates.append({
                "assetType": "crypto",
                "symbol": symbol,
                "name": base,
                "price": to_float(item.get("lastPrice")),
                "priceChangePercent24h": change,
                "priceChangePercent7d": change,
                "priceChangePercent30d": change,
                "turnover24h": to_float(item.get("turnover24h")),
                "iconUrl": get_coinmarketcap_icon_url(base),
                "chart7d": [],
            })
    except Exception:
        pass

    try:
        moex_payload = await moex_client.get_stocks(board="TQBR")
        securities = table_to_dicts(moex_payload, "securities")
        marketdata = table_to_dicts(moex_payload, "marketdata")
        securities_map = {item.get("SECID"): item for item in securities}
        core_marketdata = [
            item for item in marketdata
            if str(item.get("SECID") or "").upper() in CORE_STOCK_SYMBOLS
            and item.get("SECID") in securities_map
            and to_float(item.get("LAST") or item.get("LCURRENTPRICE")) > 0
        ]
        top_by_turnover = sorted(
            [
                item for item in marketdata
                if item.get("SECID") in securities_map
                and to_float(item.get("LAST") or item.get("LCURRENTPRICE")) > 0
            ],
            key=lambda item: to_float(item.get("VALTODAY")),
            reverse=True,
        )[:14]
        top_gainers = sorted(
            [
                item for item in marketdata
                if item.get("SECID") in securities_map
                and to_float(item.get("LAST") or item.get("LCURRENTPRICE")) > 0
            ],
            key=lambda item: to_float(item.get("LASTTOPREVPRICE")),
            reverse=True,
        )[:10]
        liquid_marketdata = {
            item.get("SECID"): item
            for item in [*core_marketdata, *top_by_turnover, *top_gainers]
            if item.get("SECID")
        }.values()

        async def format_candidate(item: dict[str, Any]) -> dict[str, Any] | None:
            try:
                candles = await get_stock_candles(item["SECID"], "TQBR", days=35)
                stock = format_stock(securities_map[item["SECID"]], item, candles)
                if tbank_token:
                    try:
                        instrument = await _find_tbank_share_by_symbol(tbank_token, item["SECID"])
                        if instrument:
                            stock["figi"] = instrument.get("figi")
                            stock["lotSize"] = int(instrument.get("lot") or stock.get("lotSize") or 1)
                            stock["iconUrl"] = _get_tbank_icon_url(instrument, stock["symbol"], "stock")
                            stock["provider"] = "tbank"
                    except Exception:
                        pass
                return {**stock, "assetType": "stock"}
            except Exception:
                return None

        stock_candidates = await asyncio.gather(*[format_candidate(item) for item in liquid_marketdata])
        candidates.extend([item for item in stock_candidates if item])
    except Exception:
        pass

    if len(_strategy_candidates_cache) > 300:
        oldest_key = min(
            _strategy_candidates_cache,
            key=lambda key: _strategy_candidates_cache[key]["created_at"],
        )
        _strategy_candidates_cache.pop(oldest_key, None)

    _strategy_candidates_cache[cache_key] = {
        "created_at": time.monotonic(),
        "items": candidates,
    }

    return candidates


def _build_strategy_payload(
    strategy_id: str,
    candidates: list[dict[str, Any]],
    run_date: date,
    start_capital: float = PAPER_START_CAPITAL,
    connection: dict[str, Any] | None = None,
    memory: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    config = _strategy_config(strategy_id)
    connection = connection or {}
    risk_profile = str(connection.get("riskProfile") or connection.get("risk_profile") or "balanced").lower()
    max_allocation = PAPER_RISK_MAX_ALLOCATION.get(risk_profile, PAPER_RISK_MAX_ALLOCATION["balanced"])
    selected = _select_strategy_entries(strategy_id, candidates, connection, limit=5, memory=memory)

    now = _strategy_now()
    scheduled_at = _strategy_start_datetime(run_date)
    start_at = now if run_date == now.date() else scheduled_at
    normalized_start_capital = max(float(start_capital or PAPER_START_CAPITAL), 1)
    capital = normalized_start_capital
    chart = [round(capital, 2)]
    chart_points = [{
        "time": start_at.isoformat(),
        "value": round(capital, 2),
        "label": "Старт",
    }]
    trades = []

    for index, (probability, side, asset, score_payload) in enumerate(selected):
        allocation = normalized_start_capital * min(max_allocation, 0.055 + max(probability - 60, 0) / 900)
        executed_at = start_at + timedelta(seconds=index + 1)
        trades.append(_build_strategy_trade(probability, side, asset, score_payload, allocation, executed_at))

    if not trades:
        chart.extend([normalized_start_capital] * 4)
        chart_points.append({
            "time": (start_at + timedelta(seconds=1)).isoformat(),
            "value": round(capital, 2),
            "label": "Нет сигнала",
        })
    else:
        chart.append(round(capital, 2))
        chart_points.append({
            "time": (start_at + timedelta(seconds=max(len(trades), 1))).isoformat(),
            "value": round(capital, 2),
            "label": "Позиции открыты",
        })

    profit = capital - normalized_start_capital
    roi = (profit / normalized_start_capital) * 100
    wins = sum(1 for trade in trades if trade["resultAmount"] > 0)
    accuracy = wins / len(trades) * 100 if trades else 0
    peak = chart[0]
    max_drawdown = 0
    for value in chart:
        peak = max(peak, value)
        drawdown = (value - peak) / peak * 100 if peak else 0
        max_drawdown = min(max_drawdown, drawdown)

    return {
        "id": strategy_id,
        "title": config["title"],
        "mode": config["mode"],
        "chartColor": config["color"],
        "startCapital": round(normalized_start_capital, 2),
        "currentCapital": round(capital, 2),
        "profit": round(profit, 2),
        "realizedProfit": 0,
        "unrealizedProfit": 0,
        "equityProfit": round(profit, 2),
        "roi": round(roi, 2),
        "realizedRoi": 0,
        "accuracy": round(accuracy, 2),
        "maxDrawdown": round(max_drawdown, 2),
        "openTradesCount": len(trades),
        "closedTradesCount": 0,
        "totalTradesCount": len(trades),
        "chart": chart,
        "chartPoints": chart_points,
        "trades": trades,
        "threshold": 60,
        "schemaVersion": PAPER_STRATEGY_SCHEMA_VERSION,
        "connection": connection,
        "capitalCurrency": connection.get("capitalCurrency") or "RUB",
        "margin": {
            "enabled": bool(connection.get("marginEnabled")),
            "mode": connection.get("marginMode") or "none",
            "leverage": float(connection.get("leverage") or 1),
        },
        "startedAt": start_at.isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _mark_strategy_to_market(
    payload: dict[str, Any],
    candidates: list[dict[str, Any]],
    memory: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    candidate_map = _strategy_candidates_by_symbol(candidates)
    start_capital = float(payload.get("startCapital") or PAPER_START_CAPITAL)
    updated_trades = []
    max_open_exposure = start_capital * 0.95
    planned_open_exposure = sum(
        to_float(trade.get("virtualAmount"))
        for trade in payload.get("trades") or []
        if trade.get("status") != "closed"
    )

    for trade in payload.get("trades") or []:
        if trade.get("status") == "closed":
            updated_trades.append(trade)
            continue

        symbol = str(trade.get("routeSymbol") or trade.get("asset") or "").upper()
        candidate = candidate_map.get(symbol)
        current_price = to_float(candidate.get("price")) if candidate else to_float(trade.get("currentPrice") or trade.get("entryPrice"))
        entry_price = to_float(trade.get("entryPrice"))
        quantity = to_float(trade.get("quantity"))
        virtual_amount = to_float(trade.get("virtualAmount"))
        asset_type = trade.get("assetType") or "crypto"
        quote_currency = trade.get("quoteCurrency") or ("RUB" if asset_type == "stock" else "USDT")
        rules = _strategy_trade_rules(payload, trade)
        live_probability = _calculate_trade_live_probability(payload, trade, candidate)
        pnl_payload = _calculate_paper_trade_pnl(
            str(trade.get("side") or "Long"),
            asset_type,
            quote_currency,
            entry_price,
            current_price,
            quantity,
        )
        pnl = pnl_payload["resultAmount"]

        result_percent = (pnl / virtual_amount) * 100 if virtual_amount else 0
        scale_in_count = int(trade.get("scaleInCount") or 0)
        events = list(trade.get("events") or [])

        if (
            result_percent <= float(rules["dcaStep"] or PAPER_DCA_STEP_PERCENT)
            and scale_in_count < PAPER_MAX_SCALE_INS
            and current_price > 0
            and virtual_amount > 0
        ):
            available_exposure = max(max_open_exposure - planned_open_exposure, 0)
            add_amount = min(virtual_amount * PAPER_DCA_ADD_RATIO, available_exposure)
            price_currency_rate = _paper_price_rate(asset_type, quote_currency)
            add_quantity = add_amount / (current_price * price_currency_rate)
            next_quantity = quantity + add_quantity

            if add_amount > 10 and next_quantity > 0:
                entry_price = ((entry_price * quantity) + (current_price * add_quantity)) / next_quantity
                quantity = next_quantity
                virtual_amount += add_amount
                planned_open_exposure += add_amount
                scale_in_count += 1
                events.append({
                    "type": "scale_in",
                    "price": round(current_price, 8),
                    "amount": round(add_amount, 2),
                    "createdAt": _strategy_now().isoformat(),
                    "label": "Усреднение позиции",
                })

                pnl_payload = _calculate_paper_trade_pnl(
                    str(trade.get("side") or "Long"),
                    asset_type,
                    quote_currency,
                    entry_price,
                    current_price,
                    quantity,
                )
                pnl = pnl_payload["resultAmount"]

                result_percent = (pnl / virtual_amount) * 100 if virtual_amount else 0

        status_value = "open"
        close_reason = None
        closed_at = None
        opened_at = _parse_strategy_datetime(trade.get("executedAt"))
        hold_minutes = ((_strategy_now() - opened_at).total_seconds() / 60) if opened_at else 0
        fade_probability = rules.get("fadeProbability")
        min_fade_hold_minutes = float(rules.get("minFadeHoldMinutes") or 0)
        profit_lock = rules.get("profitLock")

        if result_percent >= float(rules["takeProfit"] or PAPER_TAKE_PROFIT_PERCENT):
            status_value = "closed"
            close_reason = "take_profit"
            closed_at = _strategy_now().isoformat()
        elif result_percent <= float(rules["stopLoss"] or PAPER_STOP_LOSS_PERCENT):
            status_value = "closed"
            close_reason = "stop_loss"
            closed_at = _strategy_now().isoformat()
        elif (
            fade_probability is not None
            and live_probability is not None
            and live_probability < float(fade_probability)
            and hold_minutes >= min_fade_hold_minutes
            and result_percent > float(rules["stopLoss"] or PAPER_STOP_LOSS_PERCENT) * 0.75
        ):
            status_value = "closed"
            close_reason = "momentum_fade"
            closed_at = _strategy_now().isoformat()
        elif (
            profit_lock is not None
            and live_probability is not None
            and result_percent >= float(profit_lock)
            and live_probability < 64
            and hold_minutes >= min_fade_hold_minutes
        ):
            status_value = "closed"
            close_reason = "profit_lock"
            closed_at = _strategy_now().isoformat()
        elif hold_minutes >= float(rules["maxHoldMinutes"] or PAPER_MAX_HOLD_MINUTES) and abs(result_percent) >= 0.12:
            status_value = "closed"
            close_reason = "time_exit"
            closed_at = _strategy_now().isoformat()

        updated_trades.append({
            **trade,
            "entryPrice": round(entry_price, 8),
            "currentPrice": round(current_price, 8),
            "exitPrice": round(current_price, 8),
            "quantity": round(quantity, 10),
            "virtualAmount": round(virtual_amount, 2),
            "grossResultAmount": round(pnl_payload["grossResultAmount"], 2),
            "feesAmount": round(pnl_payload["feesAmount"], 2),
            "resultPercent": round(result_percent, 2),
            "resultAmount": round(pnl, 2),
            "status": status_value,
            "closeReason": close_reason,
            "closedAt": closed_at,
            "currentProbability": round(live_probability, 2) if live_probability is not None else trade.get("currentProbability"),
            "scaleInCount": scale_in_count,
            "events": events,
            "updatedAt": _strategy_now().isoformat(),
        })

    open_symbols = {
        str(trade.get("routeSymbol") or trade.get("asset") or "").upper()
        for trade in updated_trades
        if trade.get("status") != "closed"
    }
    known_symbols = {
        str(trade.get("routeSymbol") or trade.get("asset") or "").upper()
        for trade in updated_trades
        if trade.get("status") != "closed" or _is_recent_strategy_trade(trade)
    }
    connection = payload.get("connection") or {}
    max_open_positions = 5

    if len(open_symbols) < max_open_positions and len(updated_trades) < PAPER_MAX_DAILY_TRADES:
        risk_profile = str(connection.get("riskProfile") or connection.get("risk_profile") or "balanced").lower()
        max_allocation = PAPER_RISK_MAX_ALLOCATION.get(risk_profile, PAPER_RISK_MAX_ALLOCATION["balanced"])
        new_entries = _select_strategy_entries(
            str(payload.get("id") or ""),
            candidates,
            connection,
            limit=max_open_positions - len(open_symbols),
            excluded_symbols=known_symbols,
            memory=memory,
        )

        open_exposure = sum(
            to_float(trade.get("virtualAmount"))
            for trade in updated_trades
            if trade.get("status") != "closed"
        )
        free_exposure = max(max_open_exposure - open_exposure, 0)

        for index, (probability, side, asset, score_payload) in enumerate(new_entries):
            remaining_slots = max(len(new_entries) - index, 1)
            allocation = min(
                start_capital * min(max_allocation, 0.045 + max(probability - 60, 0) / 1000),
                free_exposure / remaining_slots if free_exposure > 0 else 0,
            )
            if allocation < 100:
                continue

            free_exposure = max(free_exposure - allocation, 0)
            updated_trades.append(
                _build_strategy_trade(
                    probability,
                    side,
                    asset,
                    score_payload,
                    allocation,
                    _strategy_now() + timedelta(seconds=index + 1),
                )
            )

    realized_pnl = sum(
        to_float(trade.get("resultAmount"))
        for trade in updated_trades
        if trade.get("status") == "closed"
    )
    unrealized_pnl = sum(
        to_float(trade.get("resultAmount"))
        for trade in updated_trades
        if trade.get("status") != "closed"
    )
    equity_pnl = realized_pnl + unrealized_pnl
    current_capital = start_capital + equity_pnl
    chart = payload.get("chart") if isinstance(payload.get("chart"), list) else []
    chart = [float(value) for value in chart if isinstance(value, (int, float))]
    chart_points = payload.get("chartPoints") if isinstance(payload.get("chartPoints"), list) else []
    now = _strategy_now()
    last_point_time = _parse_strategy_datetime(chart_points[-1].get("time")) if chart_points else None
    next_point = {
        "time": now.isoformat(),
        "value": round(current_capital, 2),
        "label": "Переоценка",
    }

    if not chart:
        chart = [round(start_capital, 2)]

    if not chart_points:
        started_at = _parse_strategy_datetime(payload.get("startedAt")) or now
        chart_points = [{
            "time": started_at.isoformat(),
            "value": round(start_capital, 2),
            "label": "Старт",
        }]

    if not last_point_time or (now - last_point_time).total_seconds() >= PAPER_CHART_POINT_INTERVAL_SECONDS:
        chart.append(round(current_capital, 2))
        chart_points.append(next_point)
    else:
        chart[-1] = round(current_capital, 2)
        chart_points[-1] = {
            **chart_points[-1],
            **next_point,
        }

    closed_trades = [trade for trade in updated_trades if trade.get("status") == "closed"]
    wins = sum(1 for trade in closed_trades if to_float(trade.get("resultAmount")) > 0)
    accuracy = wins / len(closed_trades) * 100 if closed_trades else 0
    peak = chart[0] if chart else start_capital
    max_drawdown = 0.0

    for value in chart:
        peak = max(peak, value)
        drawdown = (value - peak) / peak * 100 if peak else 0
        max_drawdown = min(max_drawdown, drawdown)

    return {
        **payload,
        "currentCapital": round(current_capital, 2),
        "profit": round(realized_pnl, 2),
        "realizedProfit": round(realized_pnl, 2),
        "unrealizedProfit": round(unrealized_pnl, 2),
        "equityProfit": round(equity_pnl, 2),
        "roi": round((equity_pnl / start_capital) * 100 if start_capital else 0, 2),
        "realizedRoi": round((realized_pnl / start_capital) * 100 if start_capital else 0, 2),
        "accuracy": round(accuracy, 2),
        "maxDrawdown": round(max_drawdown, 2),
        "openTradesCount": sum(1 for trade in updated_trades if trade.get("status") != "closed"),
        "closedTradesCount": len(closed_trades),
        "totalTradesCount": len(updated_trades),
        "chart": chart,
        "chartPoints": chart_points,
        "trades": updated_trades,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def _persist_strategy_run(user_id: Any, strategy_id: str, run_date: date, payload: dict[str, Any]) -> None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_paper_strategy_runs (
                user_id, strategy_id, run_date, start_capital, current_capital,
                roi, accuracy, max_drawdown, chart, trades, metadata
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
            on conflict (user_id, strategy_id, run_date) do update set
                start_capital = excluded.start_capital,
                current_capital = excluded.current_capital,
                roi = excluded.roi,
                accuracy = excluded.accuracy,
                max_drawdown = excluded.max_drawdown,
                chart = excluded.chart,
                trades = excluded.trades,
                metadata = excluded.metadata
            """,
            user_id,
            strategy_id,
            run_date,
            payload["startCapital"],
            payload["currentCapital"],
            payload["roi"],
            payload["accuracy"],
            payload["maxDrawdown"],
            json.dumps(payload["chart"]),
            json.dumps(payload["trades"]),
            json.dumps(payload),
        )


def _strategy_memory_delta(event_type: str, result_percent: float, close_reason: str | None) -> float:
    delta = _clamp(result_percent * 1.35, -6, 6)

    if event_type in {"loss_stop", "momentum_fade_loss", "slow_trade_loss", "loss_exit"}:
        delta -= 2.2

    if close_reason == "stop_loss":
        delta -= 1.8

    if event_type == "profit_capture":
        delta += 1.4

    if event_type == "profit_lock":
        delta += 1.0

    return _clamp(delta, -8, 8)


async def _maybe_refresh_strategy_memory_review(
    user_id: Any,
    strategy_id: str,
    asset_symbol: str,
    event_payload: dict[str, Any],
) -> None:
    api_key, model = await _get_openai_key_for_user(user_id)
    if not api_key:
        return

    pool = get_database_pool()

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """
            select strategy_id, asset_symbol, trades_count, wins_count, losses_count,
                   net_result_amount, avg_result_percent, memory_score,
                   last_event_type, last_lesson, gpt_review, last_reviewed_at, updated_at
            from ai_strategy_memory
            where user_id = $1 and strategy_id = $2 and asset_symbol = $3
              and (
                last_reviewed_at is null
                or last_reviewed_at < now() - ($4::text)::interval
              )
              and (losses_count > 0 or trades_count % 5 = 0)
            """,
            user_id,
            strategy_id,
            asset_symbol,
            f"{STRATEGY_GPT_REVIEW_COOLDOWN_HOURS} hours",
        )

    if not row:
        return

    memory_item = _format_strategy_memory_row(row)
    review = await _call_openai_strategy_memory_review(api_key, model, memory_item, event_payload)
    if not review:
        return

    async with pool.acquire() as connection:
        await connection.execute(
            """
            update ai_strategy_memory
            set gpt_review = $4::jsonb,
                last_reviewed_at = now(),
                updated_at = now()
            where user_id = $1 and strategy_id = $2 and asset_symbol = $3
            """,
            user_id,
            strategy_id,
            asset_symbol,
            json.dumps(review),
        )


async def _record_strategy_learning(user_id: Any, strategy_id: str, payload: dict[str, Any]) -> None:
    closed_trades = [
        trade for trade in payload.get("trades") or []
        if isinstance(trade, dict) and trade.get("status") == "closed" and trade.get("closedAt")
    ]

    if not closed_trades:
        return

    pool = get_database_pool()
    inserted_events: list[dict[str, Any]] = []

    async with pool.acquire() as connection:
        async with connection.transaction():
            for trade in closed_trades:
                asset_symbol = str(trade.get("routeSymbol") or trade.get("asset") or "").upper()
                if not asset_symbol:
                    continue

                result_percent = to_float(trade.get("resultPercent"))
                result_amount = to_float(trade.get("resultAmount"))
                close_reason = trade.get("closeReason")
                event_type, severity, lesson = _build_strategy_lesson(trade, payload)
                event_key = ":".join([
                    strategy_id,
                    asset_symbol,
                    str(trade.get("executedAt") or ""),
                    str(trade.get("closedAt") or ""),
                    str(close_reason or ""),
                ])
                context = {
                    "side": trade.get("side"),
                    "entryPrice": trade.get("entryPrice"),
                    "exitPrice": trade.get("exitPrice"),
                    "quantity": trade.get("quantity"),
                    "virtualAmount": trade.get("virtualAmount"),
                    "probability": trade.get("probability"),
                    "currentProbability": trade.get("currentProbability"),
                    "entryContext": trade.get("entryContext") or {},
                    "events": trade.get("events") or [],
                }
                inserted = await connection.fetchrow(
                    """
                    insert into ai_strategy_events (
                        user_id, strategy_id, event_key, asset_symbol, event_type,
                        severity, result_percent, result_amount, close_reason,
                        context, lesson
                    )
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
                    on conflict (user_id, event_key) do nothing
                    returning id
                    """,
                    user_id,
                    strategy_id,
                    event_key,
                    asset_symbol,
                    event_type,
                    severity,
                    result_percent,
                    result_amount,
                    close_reason,
                    json.dumps(context),
                    json.dumps(lesson),
                )

                if not inserted:
                    continue

                memory_delta = _strategy_memory_delta(event_type, result_percent, close_reason)
                win = 1 if result_percent > 0 else 0
                loss = 1 if result_percent < 0 else 0
                await connection.execute(
                    """
                    insert into ai_strategy_memory (
                        user_id, strategy_id, asset_symbol, trades_count, wins_count,
                        losses_count, net_result_amount, avg_result_percent,
                        memory_score, last_event_type, last_lesson
                    )
                    values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10::jsonb)
                    on conflict (user_id, strategy_id, asset_symbol) do update set
                        avg_result_percent = (
                            (ai_strategy_memory.avg_result_percent * ai_strategy_memory.trades_count + excluded.avg_result_percent)
                            / nullif(ai_strategy_memory.trades_count + 1, 0)
                        ),
                        trades_count = ai_strategy_memory.trades_count + 1,
                        wins_count = ai_strategy_memory.wins_count + excluded.wins_count,
                        losses_count = ai_strategy_memory.losses_count + excluded.losses_count,
                        net_result_amount = ai_strategy_memory.net_result_amount + excluded.net_result_amount,
                        memory_score = least($11::numeric, greatest(-$11::numeric, ai_strategy_memory.memory_score + excluded.memory_score)),
                        last_event_type = excluded.last_event_type,
                        last_lesson = excluded.last_lesson,
                        updated_at = now()
                    """,
                    user_id,
                    strategy_id,
                    asset_symbol,
                    win,
                    loss,
                    result_amount,
                    result_percent,
                    memory_delta,
                    event_type,
                    json.dumps(lesson),
                    STRATEGY_MEMORY_SCORE_LIMIT,
                )
                inserted_events.append({
                    "assetSymbol": asset_symbol,
                    "eventType": event_type,
                    "severity": severity,
                    "resultPercent": result_percent,
                    "resultAmount": result_amount,
                    "closeReason": close_reason,
                    "lesson": lesson,
                    "context": context,
                })

    for event in inserted_events[:2]:
        await _maybe_refresh_strategy_memory_review(
            user_id,
            strategy_id,
            event["assetSymbol"],
            event,
        )


def _safe_json_payload(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value

    try:
        return json.loads(value)
    except Exception:
        return fallback


def _build_strategy_audit_issues(strategy_id: str, run_date: date | None, payload: dict[str, Any]) -> list[dict[str, Any]]:
    trades = [trade for trade in payload.get("trades") or [] if isinstance(trade, dict)]
    start_capital = to_float(payload.get("startCapital"), PAPER_START_CAPITAL)
    reported_current = to_float(payload.get("currentCapital"), start_capital)
    issues: list[dict[str, Any]] = []
    realized_profit = 0.0
    unrealized_profit = 0.0
    open_exposure = 0.0

    for trade in trades:
        asset_symbol = str(trade.get("routeSymbol") or trade.get("asset") or "UNKNOWN").upper()
        asset_type = trade.get("assetType") or "crypto"
        quote_currency = trade.get("quoteCurrency") or ("RUB" if asset_type == "stock" else "USDT")
        entry_price = to_float(trade.get("entryPrice"))
        mark_price = to_float(
            trade.get("exitPrice")
            if trade.get("status") == "closed"
            else trade.get("currentPrice") or trade.get("exitPrice")
        )
        quantity = to_float(trade.get("quantity"))
        virtual_amount = to_float(trade.get("virtualAmount"))
        stored_result = to_float(trade.get("resultAmount"))
        recalculated = _calculate_paper_trade_pnl(
            str(trade.get("side") or "Long"),
            asset_type,
            quote_currency,
            entry_price,
            mark_price,
            quantity,
        )
        diff = abs(stored_result - recalculated["resultAmount"])

        if trade.get("status") == "closed":
            realized_profit += stored_result
        else:
            unrealized_profit += stored_result
            open_exposure += virtual_amount

        if diff > 1:
            issues.append({
                "auditKey": ":".join([
                    strategy_id,
                    str(run_date or payload.get("runDate") or ""),
                    "pnl_mismatch",
                    asset_symbol,
                    str(trade.get("executedAt") or ""),
                    str(trade.get("closedAt") or trade.get("updatedAt") or ""),
                ])[:255],
                "severity": "error",
                "code": "pnl_mismatch",
                "message": f"PnL сделки {asset_symbol} не сходится с ценой входа/выхода.",
                "payload": {
                    "asset": asset_symbol,
                    "status": trade.get("status"),
                    "side": trade.get("side"),
                    "entryPrice": entry_price,
                    "markPrice": mark_price,
                    "quantity": quantity,
                    "storedResultAmount": round(stored_result, 6),
                    "recalculatedResultAmount": round(recalculated["resultAmount"], 6),
                    "diff": round(diff, 6),
                    "feesAmount": round(recalculated["feesAmount"], 6),
                },
            })

    equity_profit = realized_profit + unrealized_profit
    expected_current = start_capital + equity_profit
    capital_diff = abs(reported_current - expected_current)

    if capital_diff > max(5, start_capital * 0.0005):
        issues.append({
            "auditKey": ":".join([
                strategy_id,
                str(run_date or payload.get("runDate") or ""),
                "capital_mismatch",
                str(int(reported_current)),
                str(int(expected_current)),
            ])[:255],
            "severity": "error",
            "code": "capital_mismatch",
            "message": "Капитал стратегии не сходится с суммой закрытого и открытого PnL.",
            "payload": {
                "startCapital": round(start_capital, 2),
                "reportedCurrentCapital": round(reported_current, 2),
                "expectedCurrentCapital": round(expected_current, 2),
                "realizedProfit": round(realized_profit, 2),
                "unrealizedProfit": round(unrealized_profit, 2),
                "diff": round(capital_diff, 2),
            },
        })

    if open_exposure > start_capital * 1.01:
        issues.append({
            "auditKey": f"{strategy_id}:{run_date or payload.get('runDate')}:exposure_limit:{int(open_exposure)}"[:255],
            "severity": "warning",
            "code": "exposure_limit",
            "message": "Открытая экспозиция стратегии выше стартового капитала.",
            "payload": {
                "startCapital": round(start_capital, 2),
                "openExposure": round(open_exposure, 2),
            },
        })

    return issues


async def _record_strategy_audit_logs(
    user_id: Any,
    strategy_id: str,
    run_date: date | None,
    payload: dict[str, Any],
) -> None:
    issues = _build_strategy_audit_issues(strategy_id, run_date, payload)
    if not issues:
        return

    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.executemany(
            """
            insert into ai_strategy_audit_logs (
                user_id, strategy_id, run_date, audit_key,
                severity, code, message, payload
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            on conflict (user_id, audit_key) do nothing
            """,
            [
                (
                    user_id,
                    strategy_id,
                    run_date,
                    issue["auditKey"],
                    issue["severity"],
                    issue["code"],
                    issue["message"],
                    json.dumps(issue["payload"]),
                )
                for issue in issues
            ],
        )


async def _load_strategy_lifetime(user_id: Any, strategy_id: str) -> dict[str, Any]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id, run_date, start_capital, current_capital, roi,
                   accuracy, max_drawdown, chart, trades, metadata, created_at
            from ai_paper_strategy_runs
            where user_id = $1 and strategy_id = $2
            order by run_date asc, created_at asc
            """,
            user_id,
            strategy_id,
        )

    chart_points: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    seen_points: set[str] = set()
    first_start_capital: float | None = None

    for row in rows:
        if first_start_capital is None:
            first_start_capital = float(row["start_capital"] or PAPER_START_CAPITAL)

        metadata = _safe_json_payload(row["metadata"], {})
        row_chart_points = metadata.get("chartPoints") if isinstance(metadata, dict) else None
        row_trades = row["trades"] if isinstance(row["trades"], list) else _safe_json_payload(row["trades"], [])

        if not isinstance(row_chart_points, list):
            row_chart = row["chart"] if isinstance(row["chart"], list) else _safe_json_payload(row["chart"], [])
            row_chart_points = [
                {
                    "time": datetime.combine(row["run_date"], datetime.min.time(), tzinfo=MOSCOW_TZ).isoformat(),
                    "value": float(row_chart[0] if row_chart else row["start_capital"] or PAPER_START_CAPITAL),
                    "label": "Старт дня",
                },
                {
                    "time": datetime.combine(row["run_date"], datetime.max.time(), tzinfo=MOSCOW_TZ).isoformat(),
                    "value": float(row["current_capital"] or PAPER_START_CAPITAL),
                    "label": "Финиш дня",
                },
            ]

        row_start_candidates = []
        if isinstance(metadata, dict):
            row_start_candidates.extend([
                (metadata.get("connection") or {}).get("connectedAt"),
                metadata.get("startedAt"),
            ])
        row_start_candidates.extend([
            trade.get("executedAt") or trade.get("closedAt") or trade.get("updatedAt")
            for trade in row_trades
            if isinstance(trade, dict)
        ])
        row_start_times = [
            parsed_time
            for value in row_start_candidates
            if (parsed_time := _parse_strategy_datetime(value))
        ]
        row_start_time = (
            min(row_start_times)
            if row_start_times
            else datetime.combine(row["run_date"], datetime.min.time(), tzinfo=MOSCOW_TZ)
        )
        first_point_time = _parse_strategy_datetime(row_chart_points[0].get("time")) if row_chart_points else None
        if (
            row_start_time
            and (
                not first_point_time
                or (first_point_time - row_start_time).total_seconds() > 60
            )
        ):
            row_chart_points = [
                {
                    "time": row_start_time.isoformat(),
                    "value": float(row["start_capital"] or PAPER_START_CAPITAL),
                    "label": "Старт стратегии",
                },
                *row_chart_points,
            ]

        for point in row_chart_points:
            if not isinstance(point, dict):
                continue

            point_time = str(point.get("time") or "")
            if point_time and point_time not in seen_points:
                seen_points.add(point_time)
                chart_points.append(point)

        for trade in row_trades if isinstance(row_trades, list) else []:
            if not isinstance(trade, dict):
                continue

            trades.append({
                **trade,
                "strategyId": row["strategy_id"],
                "runDate": row["run_date"].isoformat(),
            })

    chart_points.sort(key=lambda point: point.get("time") or "")
    trades.sort(
        key=lambda trade: trade.get("closedAt") or trade.get("updatedAt") or trade.get("executedAt") or "",
        reverse=True,
    )

    chart_values = [
        float(point.get("value"))
        for point in chart_points
        if isinstance(point.get("value"), (int, float)) or str(point.get("value") or "").replace(".", "", 1).isdigit()
    ]
    lifetime_start_capital = first_start_capital or (chart_values[0] if chart_values else PAPER_START_CAPITAL)
    lifetime_realized_profit = sum(
        to_float(trade.get("resultAmount"))
        for trade in trades
        if trade.get("status") == "closed"
    )
    lifetime_unrealized_profit = sum(
        to_float(trade.get("resultAmount"))
        for trade in trades
        if trade.get("status") != "closed"
    )
    lifetime_equity_profit = lifetime_realized_profit + lifetime_unrealized_profit
    lifetime_current_capital = lifetime_start_capital + lifetime_equity_profit
    lifetime_roi = (lifetime_equity_profit / lifetime_start_capital) * 100 if lifetime_start_capital else 0
    lifetime_realized_roi = (lifetime_realized_profit / lifetime_start_capital) * 100 if lifetime_start_capital else 0
    closed_trades_count = sum(1 for trade in trades if trade.get("status") == "closed")
    open_trades_count = sum(1 for trade in trades if trade.get("status") != "closed")

    return {
        "chart": chart_values,
        "chartPoints": chart_points,
        "trades": trades[:160],
        "runsCount": len(rows),
        "startCapital": round(lifetime_start_capital, 2),
        "currentCapital": round(lifetime_current_capital, 2),
        "profit": round(lifetime_realized_profit, 2),
        "realizedProfit": round(lifetime_realized_profit, 2),
        "unrealizedProfit": round(lifetime_unrealized_profit, 2),
        "equityProfit": round(lifetime_equity_profit, 2),
        "roi": round(lifetime_roi, 2),
        "realizedRoi": round(lifetime_realized_roi, 2),
        "openTradesCount": open_trades_count,
        "closedTradesCount": closed_trades_count,
        "totalTradesCount": len(trades),
    }


async def _attach_strategy_lifetime(
    user_id: Any,
    payload: dict[str, Any],
    include_learning: bool = False,
) -> dict[str, Any]:
    lifetime = await _load_strategy_lifetime(user_id, str(payload.get("id") or ""))
    learning_payload: dict[str, Any] = {}

    if include_learning:
        memory = await _load_strategy_memory(user_id, str(payload.get("id") or ""))
        events = await _load_strategy_events(user_id, str(payload.get("id") or ""))
        learning_payload = {
            "memory": list(memory.values())[:8],
            "errorLog": events,
        }

    if len(lifetime["chartPoints"]) > 1:
        payload = {
            **payload,
            "chart": lifetime["chart"],
            "chartPoints": lifetime["chartPoints"],
        }

    return {
        **payload,
        "startCapital": lifetime["startCapital"],
        "currentCapital": lifetime["currentCapital"],
        "profit": lifetime["profit"],
        "realizedProfit": lifetime["realizedProfit"],
        "unrealizedProfit": lifetime["unrealizedProfit"],
        "equityProfit": lifetime["equityProfit"],
        "roi": lifetime["roi"],
        "realizedRoi": lifetime["realizedRoi"],
        "historyAllTime": lifetime["trades"],
        "runsCount": lifetime["runsCount"],
        "openTradesCount": lifetime["openTradesCount"],
        "closedTradesCount": lifetime["closedTradesCount"],
        "totalTradesCount": lifetime["totalTradesCount"],
        **learning_payload,
    }


async def _get_or_create_strategy_run(
    user_id: Any,
    strategy_id: str,
    start_capital: float | None = None,
    force_reset: bool = False,
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    run_date = _strategy_run_date()
    pool = get_database_pool()
    connection_settings = await _load_strategy_connection(user_id, strategy_id)
    strategy_memory = await _load_strategy_memory(user_id, strategy_id)
    configured_capital_amount = float(
        start_capital
        or (connection_settings.get("virtualCapital") if connection_settings else None)
        or PAPER_START_CAPITAL
    )
    configured_capital_currency = (
        connection_settings.get("capitalCurrency")
        if connection_settings
        else "RUB"
    )
    configured_capital = _capital_to_rub(configured_capital_amount, configured_capital_currency)

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """
            select strategy_id, run_date, start_capital, current_capital, roi,
                   accuracy, max_drawdown, chart, trades, metadata, created_at
            from ai_paper_strategy_runs
            where user_id = $1 and strategy_id = $2 and run_date = $3
            """,
            user_id,
            strategy_id,
            run_date,
        )

    if row and not force_reset:
        metadata = row["metadata"] if isinstance(row["metadata"], dict) else json.loads(row["metadata"])
        existing_capital = float(metadata.get("startCapital") or row["start_capital"] or PAPER_START_CAPITAL)
        should_reuse = (
            metadata.get("schemaVersion") == PAPER_STRATEGY_SCHEMA_VERSION
            and abs(existing_capital - configured_capital) < 0.01
        )
        if should_reuse:
            strategy_payload = {
                **metadata,
                "id": row["strategy_id"],
                "runDate": row["run_date"].isoformat(),
                "chart": row["chart"] if isinstance(row["chart"], list) else json.loads(row["chart"]),
                "trades": row["trades"] if isinstance(row["trades"], list) else json.loads(row["trades"]),
                "connection": connection_settings or metadata.get("connection"),
            }
            candidates = candidates if candidates is not None else await _load_strategy_candidates(user_id)
            updated_payload = _mark_strategy_to_market(strategy_payload, candidates, strategy_memory)
            await _persist_strategy_run(user_id, strategy_id, run_date, updated_payload)
            await _record_strategy_audit_logs(user_id, strategy_id, run_date, updated_payload)
            await _record_strategy_learning(user_id, strategy_id, updated_payload)
            await _record_paper_strategy_trades(user_id, strategy_id, updated_payload)
            return await _attach_strategy_lifetime(user_id, updated_payload)

    candidates = candidates if candidates is not None else await _load_strategy_candidates(user_id)
    payload = _build_strategy_payload(
        strategy_id,
        candidates,
        run_date,
        configured_capital,
        connection_settings,
        strategy_memory,
    )
    payload["runDate"] = run_date.isoformat()

    await _persist_strategy_run(user_id, strategy_id, run_date, payload)
    await _record_strategy_audit_logs(user_id, strategy_id, run_date, payload)
    await _record_strategy_learning(user_id, strategy_id, payload)
    await _record_paper_strategy_trades(user_id, strategy_id, payload)

    return await _attach_strategy_lifetime(user_id, {**payload, "runDate": run_date.isoformat()})


def _build_strategy_response(items: list[dict[str, Any]], refreshing: bool = False) -> dict[str, Any]:
    return {
        "items": items,
        "runDate": _strategy_run_date().isoformat(),
        "threshold": 60,
        "paperCapital": PAPER_START_CAPITAL,
        "refreshing": refreshing,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _get_cached_strategy_response(user_id: Any) -> dict[str, Any] | None:
    cache_key = str(user_id)
    cached = _strategy_response_cache.get(cache_key)

    if not cached:
        return None

    if time.monotonic() - cached["created_at"] > STRATEGY_RESPONSE_CACHE_TTL_SECONDS:
        return None

    return cached["payload"]


def _set_cached_strategy_response(user_id: Any, payload: dict[str, Any]) -> None:
    cache_key = str(user_id)
    _strategy_response_cache[cache_key] = {
        "created_at": time.monotonic(),
        "payload": payload,
    }

    if len(_strategy_response_cache) > 300:
        oldest_key = min(
            _strategy_response_cache,
            key=lambda key: _strategy_response_cache[key]["created_at"],
        )
        _strategy_response_cache.pop(oldest_key, None)


def _invalidate_strategy_response_cache(user_id: Any) -> None:
    _strategy_response_cache.pop(str(user_id), None)


async def _load_strategy_snapshot_from_database(user_id: Any) -> list[dict[str, Any]]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select distinct on (strategy_id)
                   strategy_id, run_date, start_capital, current_capital, roi,
                   accuracy, max_drawdown, chart, trades, metadata, created_at
            from ai_paper_strategy_runs
            where user_id = $1 and strategy_id = any($2::varchar[])
            order by strategy_id, run_date desc, created_at desc
            """,
            user_id,
            list(PAPER_STRATEGY_IDS),
        )

    if not rows:
        return []

    latest_rows = {row["strategy_id"]: row for row in rows}
    lifetimes = await asyncio.gather(*[
        _load_strategy_lifetime(user_id, strategy_id)
        for strategy_id in latest_rows
    ], return_exceptions=True)

    items: list[dict[str, Any]] = []

    for strategy_id, lifetime_result in zip(latest_rows, lifetimes):
        row = latest_rows[strategy_id]
        metadata = _safe_json_payload(row["metadata"], {})
        chart = row["chart"] if isinstance(row["chart"], list) else _safe_json_payload(row["chart"], [])
        trades = row["trades"] if isinstance(row["trades"], list) else _safe_json_payload(row["trades"], [])

        payload = {
            **(metadata if isinstance(metadata, dict) else {}),
            "id": row["strategy_id"],
            "runDate": row["run_date"].isoformat(),
            "chart": chart,
            "trades": trades,
            "startCapital": round(to_float(row["start_capital"], PAPER_START_CAPITAL), 2),
            "currentCapital": round(to_float(row["current_capital"], PAPER_START_CAPITAL), 2),
            "roi": round(to_float(row["roi"]), 2),
        }

        if isinstance(lifetime_result, dict):
            if len(lifetime_result["chartPoints"]) > 1:
                payload["chart"] = lifetime_result["chart"]
                payload["chartPoints"] = lifetime_result["chartPoints"]

            payload.update({
                "startCapital": lifetime_result["startCapital"],
                "currentCapital": lifetime_result["currentCapital"],
                "profit": lifetime_result["profit"],
                "realizedProfit": lifetime_result["realizedProfit"],
                "unrealizedProfit": lifetime_result["unrealizedProfit"],
                "equityProfit": lifetime_result["equityProfit"],
                "roi": lifetime_result["roi"],
                "realizedRoi": lifetime_result["realizedRoi"],
                "historyAllTime": lifetime_result["trades"],
                "runsCount": lifetime_result["runsCount"],
                "openTradesCount": lifetime_result["openTradesCount"],
                "closedTradesCount": lifetime_result["closedTradesCount"],
                "totalTradesCount": lifetime_result["totalTradesCount"],
            })

        items.append(payload)

    return items


async def _refresh_strategy_response_cache(user_id: Any) -> dict[str, Any] | None:
    try:
        candidates = await _load_strategy_candidates(user_id)
        results = await asyncio.gather(*[
            _get_or_create_strategy_run(user_id, strategy_id, candidates=candidates)
            for strategy_id in PAPER_STRATEGY_IDS
        ], return_exceptions=True)
        items = [item for item in results if isinstance(item, dict)]
        payload = _build_strategy_response(items, refreshing=False)
        _set_cached_strategy_response(user_id, payload)
        return payload
    except Exception:
        return None


def _schedule_strategy_response_refresh(user_id: Any) -> None:
    cache_key = str(user_id)
    current_task = _strategy_response_refresh_tasks.get(cache_key)

    if current_task and not current_task.done():
        return

    task = asyncio.create_task(_refresh_strategy_response_cache(user_id))
    _strategy_response_refresh_tasks[cache_key] = task

    def cleanup(_: asyncio.Task) -> None:
        _strategy_response_refresh_tasks.pop(cache_key, None)

    task.add_done_callback(cleanup)


@router.get("/settings/ai")
async def get_ai_settings(current_user=Depends(get_current_user)):
    user_settings = await _load_user_ai_settings(current_user["id"])
    api_key = user_settings.get("api_key")

    return {
        "provider": user_settings.get("provider") or "openai",
        "model": user_settings.get("model") or settings.openai_model,
        "hasApiKey": bool(api_key or settings.resolved_openai_api_key),
        "savedInDatabase": bool(api_key),
        "maskedApiKey": _mask_api_key(api_key),
        "updatedAt": user_settings.get("updated_at").isoformat() if user_settings.get("updated_at") else None,
    }


@router.put("/settings/ai")
async def save_ai_settings(payload: SaveAISettingsRequest, current_user=Depends(get_current_user)):
    provider = "openai" if payload.provider.lower() in {"chatgpt", "openai"} else payload.provider.lower()
    api_key = (payload.api_key or "").strip() or None
    model = payload.model.strip() or settings.openai_model
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into user_ai_settings (user_id, provider, api_key, model)
            values ($1, $2, $3, $4)
            on conflict (user_id) do update set
                provider = excluded.provider,
                api_key = coalesce(excluded.api_key, user_ai_settings.api_key),
                model = excluded.model,
                updated_at = now()
            """,
            current_user["id"],
            provider,
            api_key,
            model,
        )

    saved_settings = await _load_user_ai_settings(current_user["id"])
    saved_api_key = saved_settings.get("api_key") or api_key

    return {
        "provider": provider,
        "model": model,
        "hasApiKey": bool(saved_api_key or settings.resolved_openai_api_key),
        "savedInDatabase": bool(saved_api_key),
        "maskedApiKey": _mask_api_key(saved_api_key),
        "message": "Ключ ChatGPT сохранен в базе данных.",
    }


@router.get("/ai/asset-score")
async def get_ai_asset_score(
    asset_type: str = Query(..., pattern="^(crypto|stock|currency)$"),
    symbol: str = Query(..., min_length=1, max_length=40),
    figi: str | None = Query(default=None, max_length=64),
    current_user=Depends(get_current_user),
):
    normalized_symbol = symbol.upper()
    pool = get_database_pool()

    async with pool.acquire() as connection:
        cached = await connection.fetchrow(
            """
            select score, signal, confidence, target_price, model, summary,
                   factors, source_manifest, data_quality_flags, created_at
            from ai_asset_scores
            where user_id = $1 and asset_type = $2 and symbol = $3
              and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
            order by created_at desc
            limit 1
            """,
            current_user["id"],
            asset_type,
            normalized_symbol,
        )

    if cached:
        return {
            "symbol": normalized_symbol,
            "assetType": asset_type,
            "score": float(cached["score"]),
            "signal": cached["signal"],
            "confidence": float(cached["confidence"]),
            "targetPrice": float(cached["target_price"] or 0),
            "summary": cached["summary"],
            "factors": cached["factors"],
            "sourceManifest": cached["source_manifest"],
            "dataQualityFlags": cached["data_quality_flags"],
            "cached": True,
            "createdAt": cached["created_at"].isoformat(),
        }

    try:
        asset = await _load_asset_for_score(asset_type, normalized_symbol, current_user["id"], figi)
    except HTTPException:
        return _build_unavailable_score_payload(normalized_symbol, asset_type)
    except Exception as error:
        return _build_unavailable_score_payload(normalized_symbol, asset_type)

    score_payload = _calculate_asset_score(asset)
    model = "deterministic-v2"
    final_score = _clamp(score_payload["score"], 0, 100)
    final_payload = {
        **score_payload,
        "score": round(final_score, 2),
        "signal": _format_signal(final_score, score_payload["confidence"]),
        "targetPrice": score_payload["targetPrice"],
        "model": model,
        "summary": "Вероятность рассчитана по momentum, ликвидности, волатильности и качеству доступных данных.",
        "riskFlags": [],
        "sourceManifest": ["market_data", "computed_features"],
        "cached": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    final_payload["confidence"] = score_payload["confidence"]

    await _store_asset_score(current_user["id"], asset_type, normalized_symbol, figi, final_payload)

    return {
        "symbol": normalized_symbol,
        "assetType": asset_type,
        **final_payload,
    }


@router.get("/ai/asset-summary")
async def get_ai_asset_summary(
    asset_type: str = Query(..., pattern="^(crypto|stock|currency)$"),
    symbol: str = Query(..., min_length=1, max_length=40),
    figi: str | None = Query(default=None, max_length=64),
    current_user=Depends(get_current_user),
):
    normalized_symbol = symbol.upper()

    try:
        asset = await _load_asset_for_score(asset_type, normalized_symbol, current_user["id"], figi)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось загрузить рыночные данные для GPT-сводки.",
        ) from error

    score_payload = _calculate_asset_score(asset)
    api_key, model = await _get_openai_key_for_user(current_user["id"])
    summary = await _call_openai_asset_summary(api_key, model, asset, score_payload)

    if not summary:
        flags = score_payload.get("dataQualityFlags") or []
        signal = score_payload.get("signal") or "NO_SIGNAL"
        summary = (
            f"{asset.get('name') or normalized_symbol}: модельный сигнал {signal}, "
            f"вероятность {score_payload.get('score')}%. "
            "Расчет построен на динамике цены, волатильности, ликвидности и устойчивости тренда. "
            "GPT-расширение сейчас недоступно или ключ не подключен, поэтому показана локальная сводка. "
            f"Флаги качества данных: {', '.join(flags) if flags else 'критичных ограничений не найдено'}."
        )

    return {
        "symbol": normalized_symbol,
        "assetType": asset_type,
        "title": f"Сводка GPT · {asset.get('name') or normalized_symbol}",
        "summary": summary,
        "model": model if api_key else "deterministic-v2",
        "score": score_payload["score"],
        "signal": score_payload["signal"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ai/strategies")
async def get_ai_strategies(current_user=Depends(get_current_user)):
    cached_response = _get_cached_strategy_response(current_user["id"])

    if cached_response:
        return cached_response

    try:
        snapshot_items = await asyncio.wait_for(
            _load_strategy_snapshot_from_database(current_user["id"]),
            timeout=STRATEGY_SNAPSHOT_TIMEOUT_SECONDS,
        )
    except Exception:
        snapshot_items = []

    _schedule_strategy_response_refresh(current_user["id"])

    response = _build_strategy_response(snapshot_items, refreshing=True)

    if snapshot_items:
        _set_cached_strategy_response(current_user["id"], response)

    return response


@router.get("/ai/strategies/history")
async def get_ai_strategy_history(
    strategy_id: str | None = Query(default=None, max_length=80),
    current_user=Depends(get_current_user),
):
    strategy_ids = [strategy_id] if strategy_id in PAPER_STRATEGY_IDS else list(PAPER_STRATEGY_IDS)
    cached_candidates = _strategy_candidates_cache.get(str(current_user["id"]))
    if cached_candidates and time.monotonic() - cached_candidates["created_at"] < STRATEGY_CANDIDATES_CACHE_TTL_SECONDS:
        await asyncio.gather(*[
            _get_or_create_strategy_run(current_user["id"], item, candidates=cached_candidates["items"])
            for item in strategy_ids
        ], return_exceptions=True)
    else:
        _schedule_strategy_response_refresh(current_user["id"])

    lifetime_items = await asyncio.gather(*[
        _load_strategy_lifetime(current_user["id"], item)
        for item in strategy_ids
    ])
    items: list[dict[str, Any]] = []

    for item_strategy_id, lifetime in zip(strategy_ids, lifetime_items):
        for trade in lifetime["trades"]:
            items.append({
                **trade,
                "strategyId": item_strategy_id,
            })

    items.sort(
        key=lambda trade: trade.get("closedAt") or trade.get("updatedAt") or trade.get("executedAt") or "",
        reverse=True,
    )

    return {
        "items": items[:200],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ai/strategies/memory")
async def get_ai_strategy_memory(
    strategy_id: str | None = Query(default=None, max_length=80),
    current_user=Depends(get_current_user),
):
    strategy_ids = [strategy_id] if strategy_id in PAPER_STRATEGY_IDS else list(PAPER_STRATEGY_IDS)
    memory_payload = []
    event_payload = []

    for item_strategy_id in strategy_ids:
        memory = await _load_strategy_memory(current_user["id"], item_strategy_id)
        events = await _load_strategy_events(current_user["id"], item_strategy_id, limit=20)
        memory_payload.extend(memory.values())
        event_payload.extend(events)

    memory_payload.sort(key=lambda item: abs(to_float(item.get("memoryScore"))), reverse=True)
    event_payload.sort(key=lambda item: item.get("createdAt") or "", reverse=True)

    return {
        "items": memory_payload[:80],
        "events": event_payload[:80],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ai/strategies/audit")
async def get_ai_strategy_audit(
    strategy_id: str | None = Query(default=None, max_length=80),
    current_user=Depends(get_current_user),
):
    pool = get_database_pool()
    strategy_ids = [strategy_id] if strategy_id in PAPER_STRATEGY_IDS else list(PAPER_STRATEGY_IDS)

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id, run_date, severity, code, message, payload, created_at
            from ai_strategy_audit_logs
            where user_id = $1 and strategy_id = any($2::varchar[])
            order by created_at desc
            limit 120
            """,
            current_user["id"],
            strategy_ids,
        )

    current_items = await asyncio.gather(*[
        _load_strategy_snapshot_from_database(current_user["id"])
    ], return_exceptions=True)
    current_issues: list[dict[str, Any]] = []
    if current_items and isinstance(current_items[0], list):
        for item in current_items[0]:
            if strategy_id and item.get("id") != strategy_id:
                continue
            current_issues.extend(
                _build_strategy_audit_issues(
                    str(item.get("id") or ""),
                    _strategy_run_date(),
                    item,
                )
            )

    return {
        "items": [
            {
                "strategyId": row["strategy_id"],
                "runDate": row["run_date"].isoformat() if row["run_date"] else None,
                "severity": row["severity"],
                "code": row["code"],
                "message": row["message"],
                "payload": _safe_json_payload(row["payload"], {}),
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ],
        "currentIssues": current_issues,
        "isConsistentNow": not current_issues,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/ai/strategies/history")
async def reset_ai_strategy_history(
    strategy_id: str | None = Query(default=None, max_length=80),
    current_user=Depends(get_current_user),
):
    pool = get_database_pool()
    strategy_ids = [strategy_id] if strategy_id in PAPER_STRATEGY_IDS else list(PAPER_STRATEGY_IDS)

    async with pool.acquire() as connection:
        result = await connection.execute(
            """
            delete from ai_paper_strategy_runs
            where user_id = $1 and strategy_id = any($2::varchar[])
            """,
            current_user["id"],
            strategy_ids,
        )
        await connection.execute(
            """
            delete from ai_strategy_events
            where user_id = $1 and strategy_id = any($2::varchar[])
            """,
            current_user["id"],
            strategy_ids,
        )
        await connection.execute(
            """
            delete from ai_strategy_memory
            where user_id = $1 and strategy_id = any($2::varchar[])
            """,
            current_user["id"],
            strategy_ids,
        )
        await connection.execute(
            """
            delete from ai_strategy_audit_logs
            where user_id = $1 and strategy_id = any($2::varchar[])
            """,
            current_user["id"],
            strategy_ids,
        )

    _strategy_candidates_cache.pop(str(current_user["id"]), None)
    _invalidate_strategy_response_cache(current_user["id"])

    return {
        "reset": True,
        "strategyIds": strategy_ids,
        "status": result,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/ai/strategies/{strategy_id}/connect")
async def connect_ai_strategy(
    strategy_id: str,
    payload: ConnectPaperStrategyRequest,
    current_user=Depends(get_current_user),
):
    if strategy_id not in PAPER_STRATEGY_IDS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Стратегия не найдена")

    universe = payload.universe.strip().lower()
    risk_profile = payload.risk_profile.strip().lower()
    capital_currency = payload.capital_currency.strip().upper()
    margin_mode = payload.margin_mode.strip().lower()
    leverage = max(min(float(payload.leverage or 1), 10), 1)

    if universe not in PAPER_UNIVERSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный рынок стратегии")

    if risk_profile not in PAPER_RISK_PROFILES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный риск-профиль")

    if capital_currency not in PAPER_CAPITAL_CURRENCIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестная валюта капитала")

    if margin_mode not in PAPER_MARGIN_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный режим маржи")

    if payload.margin_enabled and universe == "stocks":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Маржинальный режим в стратегии сейчас доступен только для криптовалютного рынка.",
        )

    if not payload.margin_enabled:
        margin_mode = "none"
        leverage = 1

    virtual_capital = max(float(payload.virtual_capital), 1.0)
    capital_rub = _capital_to_rub(virtual_capital, capital_currency)

    if capital_rub < PAPER_MIN_CAPITAL_RUB:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Минимальная сумма подключения стратегии — 5 000 ₽.",
        )

    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_strategy_connections (
                user_id, strategy_id, virtual_capital, universe, risk_profile,
                capital_currency, margin_enabled, margin_mode, leverage, is_active
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
            on conflict (user_id, strategy_id) do update set
                virtual_capital = excluded.virtual_capital,
                universe = excluded.universe,
                risk_profile = excluded.risk_profile,
                capital_currency = excluded.capital_currency,
                margin_enabled = excluded.margin_enabled,
                margin_mode = excluded.margin_mode,
                leverage = excluded.leverage,
                is_active = true,
                updated_at = now()
            """,
            current_user["id"],
            strategy_id,
            virtual_capital,
            universe,
            risk_profile,
            capital_currency,
            bool(payload.margin_enabled),
            margin_mode,
            leverage,
        )

    candidates = await _load_strategy_candidates(current_user["id"])
    strategy_run = await _get_or_create_strategy_run(
        current_user["id"],
        strategy_id,
        virtual_capital,
        force_reset=True,
        candidates=candidates,
    )
    _invalidate_strategy_response_cache(current_user["id"])
    try:
        snapshot_items = await _load_strategy_snapshot_from_database(current_user["id"])
        _set_cached_strategy_response(
            current_user["id"],
            _build_strategy_response(snapshot_items, refreshing=False),
        )
    except Exception:
        pass

    return {
        "connected": True,
        "strategyId": strategy_id,
        "connection": {
            "virtualCapital": virtual_capital,
            "universe": universe,
            "riskProfile": risk_profile,
            "capitalCurrency": capital_currency,
            "capitalRub": round(capital_rub, 2),
            "marginEnabled": bool(payload.margin_enabled),
            "marginMode": margin_mode,
            "leverage": leverage,
        },
        "strategy": strategy_run,
    }


async def run_due_paper_strategies_for_all_users() -> None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select
                users.id as user_id,
                coalesce(
                    array_agg(distinct ai_strategy_connections.strategy_id)
                        filter (where ai_strategy_connections.is_active = true),
                    array[]::varchar[]
                ) as strategy_ids
            from users
            left join ai_strategy_connections
                on ai_strategy_connections.user_id = users.id
            where users.id in (
                select user_id from ai_strategy_connections where is_active = true
                union
                select user_id from ai_paper_strategy_runs
                union
                select user_id from user_ai_settings
            )
            group by users.id
            limit 100
            """
        )

    for row in rows:
        user_id = row["user_id"]
        active_strategy_ids = [
            strategy_id
            for strategy_id in (row["strategy_ids"] or [])
            if strategy_id in PAPER_STRATEGY_IDS
        ]
        strategy_ids = list(dict.fromkeys([*active_strategy_ids, *PAPER_STRATEGY_IDS]))

        if not strategy_ids:
            continue

        candidates = await _load_strategy_candidates(user_id)
        results = await asyncio.gather(*[
            _get_or_create_strategy_run(user_id, strategy_id, candidates=candidates)
            for strategy_id in strategy_ids
        ], return_exceptions=True)
        items = [item for item in results if isinstance(item, dict)]
        if items:
            _set_cached_strategy_response(user_id, _build_strategy_response(items, refreshing=False))


async def paper_strategy_scheduler(stop_event: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=PAPER_SCHEDULER_STARTUP_DELAY_SECONDS)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            await run_due_paper_strategies_for_all_users()
        except Exception:
            pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=PAPER_SCHEDULER_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue
