from __future__ import annotations

import asyncio
import json
import math
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
PAPER_STRATEGY_SCHEMA_VERSION = 4
PAPER_STRATEGY_IDS = ("ai-short", "ai-long", "ai-short-long")
PAPER_UNIVERSES = {"crypto", "stocks", "mixed"}
PAPER_RISK_PROFILES = {"careful", "balanced", "active"}
PAPER_TAKE_PROFIT_PERCENT = 1.2
PAPER_STOP_LOSS_PERCENT = -0.8
PAPER_MAX_HOLD_MINUTES = 240
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
            select strategy_id, virtual_capital, universe, risk_profile, is_active, connected_at, updated_at
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
        "isActive": row["is_active"],
        "connectedAt": row["connected_at"].isoformat() if row["connected_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


async def _record_paper_strategy_trades(user_id: Any, strategy_id: str, payload: dict[str, Any]) -> None:
    trades = payload.get("trades") or []
    if not trades:
        return

    pool = get_database_pool()

    async with pool.acquire() as connection:
        for trade in trades:
            trade_key = (
                f"paper_strategy:{strategy_id}:{payload.get('runDate')}:"
                f"{trade.get('asset')}:{trade.get('side')}:{trade.get('executedAt')}"
            )
            executed_at = trade.get("executedAt") or payload.get("startedAt")
            if isinstance(executed_at, str):
                try:
                    executed_at = datetime.fromisoformat(executed_at)
                except ValueError:
                    executed_at = datetime.now(timezone.utc)

            await connection.execute(
                """
                insert into ai_trade_history (
                    user_id, wallet_connection_id, asset_type, asset_symbol, asset_name,
                    action, quantity, price, total_amount, currency, ai_strategy,
                    ai_reason, status, executed_at
                )
                select $1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12
                where not exists (
                    select 1
                    from ai_trade_history
                    where user_id = $1 and ai_reason = $11
                )
                """,
                user_id,
                trade.get("assetType") or "crypto",
                trade.get("asset"),
                trade.get("name") or trade.get("asset"),
                "sell" if trade.get("side") == "Short" else "buy",
                trade.get("quantity") or 0,
                trade.get("entryPrice") or 0,
                trade.get("virtualAmount") or 0,
                trade.get("settlementCurrency") or "RUB",
                f"paper_{strategy_id}",
                trade_key,
                executed_at or datetime.now(timezone.utc),
            )

            if trade.get("status") != "closed" or not trade.get("closedAt"):
                continue

            close_key = (
                f"paper_strategy_close:{strategy_id}:{payload.get('runDate')}:"
                f"{trade.get('asset')}:{trade.get('side')}:{trade.get('closedAt')}"
            )
            closed_at = trade.get("closedAt")
            if isinstance(closed_at, str):
                try:
                    closed_at = datetime.fromisoformat(closed_at)
                except ValueError:
                    closed_at = datetime.now(timezone.utc)

            await connection.execute(
                """
                insert into ai_trade_history (
                    user_id, wallet_connection_id, asset_type, asset_symbol, asset_name,
                    action, quantity, price, total_amount, currency, ai_strategy,
                    ai_reason, status, executed_at
                )
                select $1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12
                where not exists (
                    select 1
                    from ai_trade_history
                    where user_id = $1 and ai_reason = $11
                )
                """,
                user_id,
                trade.get("assetType") or "crypto",
                trade.get("asset"),
                trade.get("name") or trade.get("asset"),
                "buy" if trade.get("side") == "Short" else "sell",
                trade.get("quantity") or 0,
                trade.get("currentPrice") or trade.get("exitPrice") or trade.get("entryPrice") or 0,
                (trade.get("virtualAmount") or 0) + (trade.get("resultAmount") or 0),
                trade.get("settlementCurrency") or "RUB",
                f"paper_{strategy_id}",
                close_key,
                closed_at or datetime.now(timezone.utc),
            )


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


async def _load_strategy_candidates(user_id: Any | None = None) -> list[dict[str, Any]]:
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
        top_by_turnover = sorted(
            tradable_tickers,
            key=lambda item: to_float(item.get("turnover24h")),
            reverse=True,
        )[:18]
        top_fallers = sorted(
            tradable_tickers,
            key=lambda item: to_float(item.get("price24hPcnt")),
        )[:18]
        crypto_tickers = {
            str(item.get("symbol") or ""): item
            for item in [*top_by_turnover, *top_fallers]
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
        liquid_marketdata = sorted(
            [
                item for item in marketdata
                if item.get("SECID") in securities_map
                and to_float(item.get("LAST") or item.get("LCURRENTPRICE")) > 0
            ],
            key=lambda item: to_float(item.get("VALTODAY")),
            reverse=True,
        )[:12]

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

    return candidates


def _build_strategy_payload(
    strategy_id: str,
    candidates: list[dict[str, Any]],
    run_date: date,
    start_capital: float = PAPER_START_CAPITAL,
    connection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = {
        "ai-short": {"title": "ИИ торговля Short", "mode": "short", "color": "var(--red)"},
        "ai-long": {"title": "ИИ торговля Long", "mode": "long", "color": "var(--green)"},
        "ai-short-long": {"title": "ИИ торговля Short + Long", "mode": "hybrid", "color": "var(--primary-blue)"},
    }[strategy_id]
    long_ranked = []
    short_ranked = []
    connection = connection or {}
    universe = str(connection.get("universe") or "mixed").lower()
    risk_profile = str(connection.get("riskProfile") or connection.get("risk_profile") or "balanced").lower()
    max_allocation = PAPER_RISK_MAX_ALLOCATION.get(risk_profile, PAPER_RISK_MAX_ALLOCATION["balanced"])

    for asset in candidates:
        if not _strategy_asset_matches_universe(asset, universe):
            continue

        score_payload = _calculate_asset_score(asset)
        long_probability = score_payload["score"]
        short_probability = _calculate_short_probability(score_payload)
        mode = config["mode"]

        if mode in {"long", "hybrid"} and long_probability >= 60:
            long_ranked.append((long_probability, "Long", asset, score_payload))

        if mode in {"short", "hybrid"} and short_probability >= 60:
            short_ranked.append((short_probability, "Short", asset, score_payload))

    long_ranked.sort(key=lambda item: item[0], reverse=True)
    short_ranked.sort(key=lambda item: item[0], reverse=True)

    if config["mode"] == "hybrid":
        selected = [*long_ranked[:1], *short_ranked[:1]]
        rest = sorted(
            [*long_ranked[1:4], *short_ranked[1:4]],
            key=lambda item: item[0],
            reverse=True,
        )
        for item in rest:
            if len(selected) >= 5:
                break
            selected.append(item)
    else:
        selected = (short_ranked if config["mode"] == "short" else long_ranked)[:5]

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
        entry_price = to_float(asset.get("price"))
        allocation = normalized_start_capital * min(max_allocation, 0.055 + max(probability - 60, 0) / 900)
        asset_type = asset.get("assetType") or "crypto"
        quote_currency = "RUB" if asset_type == "stock" else "USDT"
        price_currency_rate = _paper_price_rate(asset_type, quote_currency)
        quantity = allocation / (entry_price * price_currency_rate) if entry_price > 0 else 0
        executed_at = start_at + timedelta(seconds=index + 1)
        trades.append({
            "asset": asset.get("symbol"),
            "name": asset.get("name") or asset.get("shortName") or asset.get("symbol"),
            "assetType": asset_type,
            "side": side,
            "probability": round(probability, 2),
            "entryPrice": round(entry_price, 8),
            "currentPrice": round(entry_price, 8),
            "exitPrice": round(entry_price, 8),
            "quantity": round(quantity, 10),
            "quoteCurrency": quote_currency,
            "settlementCurrency": "RUB",
            "virtualAmount": round(allocation, 2),
            "resultPercent": 0,
            "resultAmount": 0,
            "signal": score_payload["signal"],
            "status": "open",
            "closeReason": None,
            "iconUrl": asset.get("iconUrl"),
            "executedAt": executed_at.isoformat(),
            "routeSymbol": asset.get("symbol"),
        })

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
        "roi": round(roi, 2),
        "accuracy": round(accuracy, 2),
        "maxDrawdown": round(max_drawdown, 2),
        "chart": chart[:12],
        "chartPoints": chart_points[:12],
        "trades": trades,
        "threshold": 60,
        "schemaVersion": PAPER_STRATEGY_SCHEMA_VERSION,
        "connection": connection,
        "startedAt": start_at.isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _mark_strategy_to_market(payload: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    candidate_map = _strategy_candidates_by_symbol(candidates)
    start_capital = float(payload.get("startCapital") or PAPER_START_CAPITAL)
    updated_trades = []
    total_pnl = 0.0

    for trade in payload.get("trades") or []:
        if trade.get("status") == "closed":
            total_pnl += to_float(trade.get("resultAmount"))
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
        price_currency_rate = _paper_price_rate(asset_type, quote_currency)

        if entry_price <= 0 or current_price <= 0 or quantity <= 0:
            pnl = 0.0
        elif trade.get("side") == "Short":
            pnl = quantity * (entry_price - current_price) * price_currency_rate
        else:
            pnl = quantity * (current_price - entry_price) * price_currency_rate

        result_percent = (pnl / virtual_amount) * 100 if virtual_amount else 0
        status_value = "open"
        close_reason = None
        closed_at = None
        opened_at = _parse_strategy_datetime(trade.get("executedAt"))
        hold_minutes = ((_strategy_now() - opened_at).total_seconds() / 60) if opened_at else 0

        if result_percent >= PAPER_TAKE_PROFIT_PERCENT:
            status_value = "closed"
            close_reason = "take_profit"
            closed_at = _strategy_now().isoformat()
        elif result_percent <= PAPER_STOP_LOSS_PERCENT:
            status_value = "closed"
            close_reason = "stop_loss"
            closed_at = _strategy_now().isoformat()
        elif hold_minutes >= PAPER_MAX_HOLD_MINUTES and abs(result_percent) >= 0.25:
            status_value = "closed"
            close_reason = "time_exit"
            closed_at = _strategy_now().isoformat()

        total_pnl += pnl
        updated_trades.append({
            **trade,
            "currentPrice": round(current_price, 8),
            "exitPrice": round(current_price, 8),
            "resultPercent": round(result_percent, 2),
            "resultAmount": round(pnl, 2),
            "status": status_value,
            "closeReason": close_reason,
            "closedAt": closed_at,
            "updatedAt": _strategy_now().isoformat(),
        })

    current_capital = start_capital + total_pnl
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

    if not last_point_time or (now - last_point_time).total_seconds() >= 60 * 10:
        chart.append(round(current_capital, 2))
        chart_points.append(next_point)
    else:
        chart[-1] = round(current_capital, 2)
        chart_points[-1] = {
            **chart_points[-1],
            **next_point,
        }

    chart = chart[-48:]
    chart_points = chart_points[-48:]
    wins = sum(1 for trade in updated_trades if to_float(trade.get("resultAmount")) > 0)
    accuracy = wins / len(updated_trades) * 100 if updated_trades else 0
    peak = chart[0] if chart else start_capital
    max_drawdown = 0.0

    for value in chart:
        peak = max(peak, value)
        drawdown = (value - peak) / peak * 100 if peak else 0
        max_drawdown = min(max_drawdown, drawdown)

    profit = current_capital - start_capital

    return {
        **payload,
        "currentCapital": round(current_capital, 2),
        "profit": round(profit, 2),
        "roi": round((profit / start_capital) * 100 if start_capital else 0, 2),
        "accuracy": round(accuracy, 2),
        "maxDrawdown": round(max_drawdown, 2),
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


async def _get_or_create_strategy_run(
    user_id: Any,
    strategy_id: str,
    start_capital: float | None = None,
    force_reset: bool = False,
) -> dict[str, Any]:
    run_date = _strategy_run_date()
    pool = get_database_pool()
    connection_settings = await _load_strategy_connection(user_id, strategy_id)
    configured_capital = float(
        start_capital
        or (connection_settings.get("virtualCapital") if connection_settings else None)
        or PAPER_START_CAPITAL
    )

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
            candidates = await _load_strategy_candidates(user_id)
            updated_payload = _mark_strategy_to_market(strategy_payload, candidates)
            await _persist_strategy_run(user_id, strategy_id, run_date, updated_payload)
            await _record_paper_strategy_trades(user_id, strategy_id, updated_payload)
            return {
                **updated_payload,
            }

    candidates = await _load_strategy_candidates(user_id)
    payload = _build_strategy_payload(
        strategy_id,
        candidates,
        run_date,
        configured_capital,
        connection_settings,
    )
    payload["runDate"] = run_date.isoformat()

    await _persist_strategy_run(user_id, strategy_id, run_date, payload)
    await _record_paper_strategy_trades(user_id, strategy_id, payload)

    return {**payload, "runDate": run_date.isoformat()}


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
    items = await asyncio.gather(*[
        _get_or_create_strategy_run(current_user["id"], strategy_id)
        for strategy_id in PAPER_STRATEGY_IDS
    ])

    return {
        "items": items,
        "runDate": _strategy_run_date().isoformat(),
        "threshold": 60,
        "paperCapital": PAPER_START_CAPITAL,
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

    if universe not in PAPER_UNIVERSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный рынок стратегии")

    if risk_profile not in PAPER_RISK_PROFILES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный риск-профиль")

    virtual_capital = max(float(payload.virtual_capital), 1.0)
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_strategy_connections (
                user_id, strategy_id, virtual_capital, universe, risk_profile, is_active
            )
            values ($1, $2, $3, $4, $5, true)
            on conflict (user_id, strategy_id) do update set
                virtual_capital = excluded.virtual_capital,
                universe = excluded.universe,
                risk_profile = excluded.risk_profile,
                is_active = true,
                updated_at = now()
            """,
            current_user["id"],
            strategy_id,
            virtual_capital,
            universe,
            risk_profile,
        )

    strategy_run = await _get_or_create_strategy_run(
        current_user["id"],
        strategy_id,
        virtual_capital,
        force_reset=True,
    )

    return {
        "connected": True,
        "strategyId": strategy_id,
        "connection": {
            "virtualCapital": virtual_capital,
            "universe": universe,
            "riskProfile": risk_profile,
        },
        "strategy": strategy_run,
    }


async def run_due_paper_strategies_for_all_users() -> None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch("select id from users")

    for row in rows:
        user_id = row["id"]
        await asyncio.gather(*[
            _get_or_create_strategy_run(user_id, strategy_id)
            for strategy_id in PAPER_STRATEGY_IDS
        ], return_exceptions=True)


async def paper_strategy_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_due_paper_strategies_for_all_users()
        except Exception:
            pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=60 * 60)
        except asyncio.TimeoutError:
            continue
