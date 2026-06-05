from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from aiohttp import ClientSession, ClientTimeout
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.auth_router import get_current_user
from src.ai_trading_brain import (
    AITradeDecision,
    AITradingConfig,
    FinalAction,
    MarketRegime,
    RiskContext,
    StrategyType,
    build_market_features,
    evaluate_dca,
    run_backtest,
    select_strategy_decision,
)
from src.config import settings
from src.database import get_database_pool
from src.init import bybit_client, moex_client
from src.news_router import get_cached_market_mood, get_cached_news
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
logger = logging.getLogger(__name__)
MOSCOW_TZ = timezone(timedelta(hours=3))
PAPER_START_CAPITAL = 100_000.0
PAPER_USD_RUB_RATE = 92.0
PAPER_STRATEGY_SCHEMA_VERSION = 9
PAPER_STRATEGY_IDS = ("ai-short", "ai-long", "ai-short-long")
PAPER_UNIVERSES = {"crypto", "stocks", "mixed"}
PAPER_RISK_PROFILES = {"careful", "balanced", "active"}
PAPER_CAPITAL_CURRENCIES = {"RUB", "USDT", "USD"}
PAPER_MARGIN_MODES = {"none", "spot_cross", "linear_cross", "linear_isolated"}
PAPER_AUTONOMOUS_DEFAULT_UNIVERSE = "crypto"
PAPER_AUTONOMOUS_DEFAULT_RISK_PROFILE = "active"
PAPER_AUTONOMOUS_DEFAULT_CAPITAL_CURRENCY = "RUB"
CORE_CRYPTO_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "TONUSDT"}
CORE_STOCK_SYMBOLS = {"SBER", "GAZP", "LKOH", "YDEX", "GMKN", "ROSN", "NVTK", "TATN", "PLZL", "AFLT"}
PAPER_MIN_CAPITAL_RUB = 5_000.0
PAPER_TAKE_PROFIT_PERCENT = 2.0
PAPER_STOP_LOSS_PERCENT = -3.0
PAPER_DCA_STEP_PERCENT = -1.4
PAPER_DCA_ADD_RATIO = 0.45
PAPER_MAX_SCALE_INS = 1
PAPER_MAX_HOLD_MINUTES = 180
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
PAPER_MAX_DAILY_TRADES = 320
STRATEGY_MEMORY_SCORE_LIMIT = 15
STRATEGY_GPT_REVIEW_COOLDOWN_HOURS = 12
ASSET_SCORE_MODEL = "deterministic-v3"
STRATEGY_CANDIDATES_CACHE_TTL_SECONDS = 45
STRATEGY_RESPONSE_CACHE_TTL_SECONDS = 12
STRATEGY_SNAPSHOT_TIMEOUT_SECONDS = 2.0
STRATEGY_CRYPTO_KLINE_TIMEOUT_SECONDS = 2.5
STRATEGY_STOCK_CANDLES_TIMEOUT_SECONDS = 2.5
STRATEGY_TBANK_LOOKUP_TIMEOUT_SECONDS = 2.0
STRATEGY_CRYPTO_KLINE_CANDIDATES_LIMIT = 20
STRATEGY_STOCK_CANDIDATES_LIMIT = 18
STRATEGY_MARKET_CONTEXT_TTL_SECONDS = 180
_strategy_candidates_cache: dict[str, dict[str, Any]] = {}
_strategy_response_cache: dict[str, dict[str, Any]] = {}
_strategy_response_refresh_tasks: dict[str, asyncio.Task] = {}
_strategy_market_context_cache: dict[str, Any] = {
    "created_at": 0,
    "payload": None,
}
PAPER_RISK_MAX_ALLOCATION = {
    "careful": 0.18,
    "balanced": 0.24,
    "active": 0.32,
}
PAPER_RISK_MAX_OPEN_EXPOSURE = {
    "careful": 0.72,
    "balanced": 0.90,
    "active": 0.98,
}
PAPER_RISK_MAX_OPEN_POSITIONS = {
    "careful": 4,
    "balanced": 5,
    "active": 6,
}
PAPER_RISK_BOLDNESS = {
    "careful": 35,
    "balanced": 65,
    "active": 90,
}
PAPER_REGROUP_DRAWDOWN_PERCENT = -2.0
PAPER_DEFENSIVE_DRAWDOWN_PERCENT = -5.0
PAPER_REGROUP_LOSS_STREAK = 3
PAPER_DEFENSIVE_LOSS_STREAK = 5
NEWS_POSITIVE_TERMS = (
    "раст", "рост", "выше", "подорож", "прибыл", "выручк", "дивиденд", "байбек",
    "buyback", "одобр", "рекорд", "ускор", "позитив", "прорыв", "листинг",
    "approval", "approve", "surge", "rally", "gain", "bull", "strong",
)
NEWS_NEGATIVE_TERMS = (
    "пад", "сниж", "ниже", "убыт", "санкц", "штраф", "расслед", "обвал",
    "банкрот", "дефолт", "запрет", "хак", "взлом", "отток", "risk", "bear",
    "drop", "loss", "lawsuit", "hack", "exploit", "ban",
)


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


class AIScanRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, max_length=80)
    asset_type: str = Field(default="crypto", pattern="^(crypto|stock|currency)$")
    strategy_type: StrategyType = StrategyType.LONG_SHORT
    limit: int = Field(default=20, ge=1, le=80)
    include_no_trade: bool = True


class ExecuteAIDecisionRequest(BaseModel):
    decision: AITradeDecision
    strategy_id: str | None = Field(default=None, max_length=80)
    virtual_capital: float = Field(default=PAPER_START_CAPITAL, gt=0, le=100_000_000)


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


def _ai_trading_config() -> AITradingConfig:
    return AITradingConfig(
        ai_trading_enabled=settings.ai_trading_enabled,
        ai_auto_execution_enabled=settings.ai_auto_execution_enabled,
        min_probability_tp_before_sl=settings.min_probability_tp_before_sl,
        min_risk_reward=settings.min_risk_reward,
        min_expected_value_percent=settings.min_expected_value_percent,
        max_spread_percent=settings.max_spread_percent,
        min_liquidity_score=settings.min_liquidity_score,
        max_risk_per_trade_percent=settings.max_risk_per_trade_percent,
        max_daily_drawdown_percent=settings.max_daily_drawdown_percent,
        max_open_positions=settings.max_open_positions,
        dca_enabled=settings.dca_enabled,
        max_dca_count=settings.max_dca_count,
        dca_require_positive_ev=settings.dca_require_positive_ev,
        default_fee_percent=settings.default_fee_percent,
        default_slippage_percent=settings.default_slippage_percent,
        counter_trend_probability_multiplier=settings.counter_trend_probability_multiplier,
        high_volatility_position_size_multiplier=settings.high_volatility_position_size_multiplier,
    )


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


def _point_turnover(point: dict[str, Any]) -> float:
    return to_float(point.get("turnover") or point.get("volume"))


def _calculate_asset_score(asset: dict[str, Any]) -> dict[str, Any]:
    chart = [point for point in asset.get("chart") or asset.get("chart7d") or [] if isinstance(point, dict)]
    current_price = to_float(asset.get("price"))
    if current_price <= 0 and chart:
        current_price = _point_close(chart[-1])

    change_1d = to_float(asset.get("priceChangePercent24h"))
    change_7d = to_float(asset.get("priceChangePercent7d"))
    change_30d = to_float(asset.get("priceChangePercent30d"))
    change_1h = to_float(asset.get("priceChangePercent1h"))
    change_4h = to_float(asset.get("priceChangePercent4h"))
    spread_percent = abs(to_float(asset.get("bidAskSpreadPercent")))
    range_position = to_float(asset.get("rangePosition"), 0.5)
    volume_ratio = to_float(asset.get("volumeTrendRatio"), 1)

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
    intraday_confirmation = (
        (change_1h > 0.05 and change_4h > 0.15)
        or (asset.get("assetType") != "crypto" and change_1d > 0)
    )
    volume_confirmation = _clamp((volume_ratio - 1) * 18, -8, 12)
    range_confirmation = _clamp((range_position - 0.45) * 18, -6, 8)
    spread_penalty = min(spread_percent * 22, 14)

    momentum_score = _clamp(
        46
        + change_1h * 5.2
        + change_4h * 3.4
        + change_1d * 0.9
        + change_7d * 0.45
        + change_30d * 0.18
        + volume_confirmation
        + range_confirmation,
        0,
        100,
    )
    liquidity_score = _clamp(35 + math.log10(max(turnover, 1)) * 9, 0, 100)
    risk_score = _clamp(100 - volatility * 4.2 - spread_penalty, 0, 100)
    quality_score = _clamp((trend_quality * 0.7) + (risk_score * 0.3), 0, 100)
    composite = (
        momentum_score * 0.46
        + liquidity_score * 0.18
        + risk_score * 0.18
        + quality_score * 0.18
    )
    symbol = str(asset.get("symbol") or "").upper()
    if symbol in CORE_CRYPTO_SYMBOLS or symbol in CORE_STOCK_SYMBOLS:
        composite += 4
        liquidity_score = min(liquidity_score + 5, 100)

    if turnover > 0 and turnover < 100_000 and asset.get("assetType") == "crypto":
        composite -= 12

    if asset.get("assetType") == "crypto":
        if not intraday_confirmation:
            composite -= 18

        if spread_percent > 0.35:
            composite -= 10

        if change_1d > 18 and change_1h < 0:
            composite -= 14

    composite = _clamp(composite, 0, 100)
    data_flags: list[str] = [
        str(flag)
        for flag in (asset.get("dataQualityFlags") or [])
        if flag
    ]

    if len(closes) < 3:
        data_flags.append("short_chart_history")

    if asset.get("assetType") == "crypto" and (change_1h == 0 and change_4h == 0):
        data_flags.append("missing_intraday_confirmation")

    if turnover <= 0:
        data_flags.append("missing_turnover")

    if volatility > 14:
        data_flags.append("high_volatility")

    if spread_percent > 0.35:
        data_flags.append("wide_spread")

    confidence = _clamp(
        88
        - len(data_flags) * 12
        - max(volatility - 10, 0) * 1.4
        + (6 if intraday_confirmation else -8),
        20,
        94,
    )
    signal = _format_signal(composite, confidence)
    target_move = _clamp((composite - 50) / 100 * max(6, volatility * 1.8), -18, 18)

    severe_data_flags = {
        "ticker_only_fallback",
        "short_chart_history",
        "missing_intraday_confirmation",
        "missing_turnover",
    }
    if any(flag in severe_data_flags for flag in data_flags):
        # При слабом покрытии данных таргет должен быть осторожным:
        # лучше узкий research-сценарий, чем уверенный прогноз из одного тикера.
        target_move *= 0.45

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
            "change1h": round(change_1h, 2),
            "change4h": round(change_4h, 2),
            "change1d": round(change_1d, 2),
            "change7d": round(change_7d, 2),
            "change30d": round(change_30d, 2),
            "spreadPercent": round(spread_percent, 4),
            "rangePosition": round(range_position, 4),
            "volumeTrendRatio": round(volume_ratio, 4),
            "intradayConfirmation": intraday_confirmation,
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
            "5 коротких блоков с заголовками: Коротко, Что поддерживает сценарий, Что против, "
            "Качество данных, Итог. Не повторяй один и тот же шаблон; адаптируй текст под цифры актива. "
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
        "model": ASSET_SCORE_MODEL,
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


async def _load_active_strategy_ids(user_id: Any) -> list[str]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id
            from ai_strategy_connections
            where user_id = $1
              and is_active = true
              and strategy_id = any($2::varchar[])
            order by updated_at desc, connected_at desc
            """,
            user_id,
            list(PAPER_STRATEGY_IDS),
        )

    return [
        row["strategy_id"]
        for row in rows
        if row["strategy_id"] in PAPER_STRATEGY_IDS
    ]


async def _ensure_autonomous_strategy_connections(user_id: Any) -> list[str]:
    if not settings.ai_trading_enabled or not settings.ai_autonomous_paper_strategies_enabled:
        return await _load_active_strategy_ids(user_id)

    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_id
            from ai_strategy_connections
            where user_id = $1
              and strategy_id = any($2::varchar[])
            """,
            user_id,
            list(PAPER_STRATEGY_IDS),
        )
        existing_strategy_ids = {row["strategy_id"] for row in rows}
        missing_strategy_ids = [
            strategy_id
            for strategy_id in PAPER_STRATEGY_IDS
            if strategy_id not in existing_strategy_ids
        ]

        if missing_strategy_ids:
            await connection.executemany(
                """
                insert into ai_strategy_connections (
                    user_id, strategy_id, virtual_capital, universe, risk_profile,
                    capital_currency, margin_enabled, margin_mode, leverage, is_active
                )
                values ($1, $2, $3, $4, $5, $6, false, 'none', 1, true)
                on conflict (user_id, strategy_id) do nothing
                """,
                [
                    (
                        user_id,
                        strategy_id,
                        PAPER_START_CAPITAL,
                        PAPER_AUTONOMOUS_DEFAULT_UNIVERSE,
                        PAPER_AUTONOMOUS_DEFAULT_RISK_PROFILE,
                        PAPER_AUTONOMOUS_DEFAULT_CAPITAL_CURRENCY,
                    )
                    for strategy_id in missing_strategy_ids
                ],
            )
            logger.info(
                "Bootstrapped autonomous AI paper strategies",
                extra={
                    "user_id": str(user_id),
                    "strategy_ids": ",".join(missing_strategy_ids),
                },
            )

    return await _load_active_strategy_ids(user_id)


async def _ensure_autonomous_strategy_connections_for_all_users(limit: int = 100) -> None:
    if not settings.ai_trading_enabled or not settings.ai_autonomous_paper_strategies_enabled:
        return

    pool = get_database_pool()

    async with pool.acquire() as connection:
        user_rows = await connection.fetch(
            """
            select id
            from users
            order by created_at desc
            limit $1
            """,
            limit,
        )

    if not user_rows:
        logger.info("Paper strategy scheduler idle: no users found")
        return

    results = await asyncio.gather(*[
        _ensure_autonomous_strategy_connections(row["id"])
        for row in user_rows
    ], return_exceptions=True)

    failed = sum(1 for result in results if isinstance(result, Exception))
    if failed:
        logger.warning("Autonomous strategy bootstrap had failures", extra={"failed_count": failed})


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


def _news_symbol_keys(symbol: str | None) -> set[str]:
    normalized = str(symbol or "").upper()
    if not normalized:
        return set()

    keys = {normalized}
    if normalized.endswith("USDT"):
        keys.add(normalized.removesuffix("USDT"))
    else:
        keys.add(f"{normalized}USDT")

    return keys


def _score_news_sentiment(item: dict[str, Any]) -> float:
    text = f"{item.get('title') or ''} {item.get('summary') or ''}".lower().replace("ё", "е")
    positive = sum(1 for term in NEWS_POSITIVE_TERMS if term in text)
    negative = sum(1 for term in NEWS_NEGATIVE_TERMS if term in text)

    if positive == negative:
        return 0

    return _clamp((positive - negative) / 5, -1, 1)


def _freshness_weight(published_ts: Any) -> float:
    timestamp = to_float(published_ts)
    if timestamp <= 0:
        return 0.45

    age_hours = max((time.time() - timestamp) / 3600, 0)
    if age_hours <= 6:
        return 1.0
    if age_hours <= 24:
        return 0.72
    if age_hours <= 72:
        return 0.42
    return 0.18


def _aggregate_weighted_sentiment(values: list[tuple[float, float]]) -> float | None:
    total_weight = sum(weight for _, weight in values if weight > 0)
    if total_weight <= 0:
        return None

    return _clamp(sum(value * weight for value, weight in values) / total_weight, -1, 1)


def _build_tradingview_style_rating(asset: dict[str, Any]) -> dict[str, Any]:
    chart = asset.get("chart7d") if isinstance(asset.get("chart7d"), list) else []
    closes = [to_float(point.get("close")) for point in chart if isinstance(point, dict) and to_float(point.get("close")) > 0]
    price = to_float(asset.get("price")) or (closes[-1] if closes else 0)
    change_1h = to_float(asset.get("priceChangePercent1h"))
    change_4h = to_float(asset.get("priceChangePercent4h"))
    change_24h = to_float(asset.get("priceChangePercent24h"))
    volume_ratio = to_float(asset.get("volumeTrendRatio"), 1)
    range_position = to_float(asset.get("rangePosition"), 0.5)
    spread = to_float(asset.get("bidAskSpreadPercent"))
    score = 0.0

    if len(closes) >= 8:
        ema_fast = sum(closes[-8:]) / 8
        ema_slow = sum(closes[-21:]) / min(len(closes), 21)
        if price > ema_fast > ema_slow:
            score += 0.24
        elif price < ema_fast < ema_slow:
            score -= 0.24

    score += _clamp(change_1h / 6, -0.18, 0.18)
    score += _clamp(change_4h / 14, -0.16, 0.16)
    score += _clamp(change_24h / 35, -0.13, 0.13)

    if volume_ratio >= 1.15 and change_1h > 0:
        score += 0.08
    elif volume_ratio >= 1.15 and change_1h < 0:
        score -= 0.08

    if 0.35 <= range_position <= 0.82:
        score += 0.04
    elif range_position > 0.94:
        score -= 0.05

    if spread > 0.2:
        score -= min(spread / 3, 0.12)

    normalized_score = _clamp(score, -1, 1)
    if normalized_score >= 0.55:
        signal = "strong_buy"
    elif normalized_score >= 0.18:
        signal = "buy"
    elif normalized_score <= -0.55:
        signal = "strong_sell"
    elif normalized_score <= -0.18:
        signal = "sell"
    else:
        signal = "neutral"

    return {
        "score": round(normalized_score, 4),
        "signal": signal,
        "source": "pulse_tradingview_style_rating",
    }


async def _load_strategy_market_context() -> dict[str, Any]:
    cached = _strategy_market_context_cache.get("payload")
    created_at = to_float(_strategy_market_context_cache.get("created_at"))

    if cached and time.monotonic() - created_at < STRATEGY_MARKET_CONTEXT_TTL_SECONDS:
        return cached

    news_items: list[dict[str, Any]] = []
    market_mood: dict[str, Any] = {}
    try:
        news_items, market_mood = await asyncio.gather(
            get_cached_news(),
            get_cached_market_mood(),
        )
    except Exception:
        try:
            news_items = await get_cached_news()
        except Exception:
            news_items = []
        try:
            market_mood = await get_cached_market_mood()
        except Exception:
            market_mood = {}

    asset_sentiment: dict[str, list[tuple[float, float]]] = {}
    category_sentiment: dict[str, list[tuple[float, float]]] = {
        "crypto": [],
        "stocks": [],
        "markets": [],
    }
    asset_news_counts: dict[str, int] = {}

    for item in news_items if isinstance(news_items, list) else []:
        sentiment = _score_news_sentiment(item)
        weight = _freshness_weight(item.get("publishedTs")) * max(to_float(item.get("score"), 1), 1)
        category = str(item.get("category") or "markets").lower()
        category_sentiment.setdefault(category, []).append((sentiment, weight))
        related_assets = item.get("relatedAssets") if isinstance(item.get("relatedAssets"), list) else []

        for related_asset in related_assets:
            if not isinstance(related_asset, dict):
                continue

            for key in _news_symbol_keys(related_asset.get("routeSymbol") or related_asset.get("symbol")):
                asset_sentiment.setdefault(key, []).append((sentiment, weight + 2))
                asset_news_counts[key] = asset_news_counts.get(key, 0) + 1

    current_mood = market_mood.get("current") if isinstance(market_mood, dict) else {}
    fear_greed = to_float((current_mood or {}).get("value"), 50)
    fear_greed_sentiment = _clamp((fear_greed - 50) / 50, -1, 1)
    payload = {
        "fearGreedIndex": fear_greed,
        "fearGreedSentiment": round(fear_greed_sentiment, 4),
        "assetSentiment": {
            symbol: round(value, 4)
            for symbol, values in asset_sentiment.items()
            if (value := _aggregate_weighted_sentiment(values)) is not None
        },
        "assetNewsCounts": asset_news_counts,
        "categorySentiment": {
            category: round(value, 4)
            for category, values in category_sentiment.items()
            if (value := _aggregate_weighted_sentiment(values)) is not None
        },
        "sourceManifest": ["pulse_news_feed", "fear_greed_index", "pulse_tradingview_style_rating"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    _strategy_market_context_cache["payload"] = payload
    _strategy_market_context_cache["created_at"] = time.monotonic()
    return payload


def _enrich_strategy_candidate_with_context(asset: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    asset_type = str(asset.get("assetType") or "crypto").lower()
    symbol_keys = _news_symbol_keys(asset.get("symbol"))
    asset_sentiment_map = context.get("assetSentiment") if isinstance(context.get("assetSentiment"), dict) else {}
    news_counts = context.get("assetNewsCounts") if isinstance(context.get("assetNewsCounts"), dict) else {}
    category_sentiment = context.get("categorySentiment") if isinstance(context.get("categorySentiment"), dict) else {}
    direct_values = [
        to_float(asset_sentiment_map.get(symbol_key))
        for symbol_key in symbol_keys
        if asset_sentiment_map.get(symbol_key) is not None
    ]
    direct_sentiment = sum(direct_values) / len(direct_values) if direct_values else None
    category_key = "crypto" if asset_type == "crypto" else "stocks"
    fallback_sentiment = (
        to_float(category_sentiment.get(category_key))
        if category_sentiment.get(category_key) is not None
        else None
    )
    market_sentiment = to_float(category_sentiment.get("markets"))
    fear_greed_sentiment = to_float(context.get("fearGreedSentiment"))
    combined_sentiment = direct_sentiment

    if combined_sentiment is None:
        combined_sentiment = fallback_sentiment if fallback_sentiment is not None else 0

    if asset_type == "crypto":
        combined_sentiment = combined_sentiment * 0.65 + fear_greed_sentiment * 0.25 + market_sentiment * 0.10
    else:
        combined_sentiment = combined_sentiment * 0.75 + market_sentiment * 0.25

    technical_rating = _build_tradingview_style_rating(asset)
    source_manifest = [
        *list(asset.get("sourceManifest") or []),
        *list(context.get("sourceManifest") or []),
    ]

    return {
        **asset,
        "newsSentiment": round(_clamp(combined_sentiment, -1, 1), 4),
        "assetNewsCount": sum(int(news_counts.get(symbol_key) or 0) for symbol_key in symbol_keys),
        "fearGreedIndex": context.get("fearGreedIndex") if asset_type == "crypto" else asset.get("fearGreedIndex"),
        "marketContext": {
            "directNewsSentiment": direct_sentiment,
            "categorySentiment": fallback_sentiment,
            "marketSentiment": market_sentiment,
            "fearGreedSentiment": fear_greed_sentiment if asset_type == "crypto" else None,
            "sourceManifest": context.get("sourceManifest") or [],
        },
        "tradingViewTechnicalScore": technical_rating["score"],
        "tradingViewSignal": technical_rating["signal"],
        "sourceManifest": list(dict.fromkeys(source_manifest)),
    }


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


def _normalize_bybit_kline_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, list) or len(item) < 6:
        return None

    timestamp_ms = to_float(item[0])
    open_price = to_float(item[1])
    high = to_float(item[2])
    low = to_float(item[3])
    close = to_float(item[4])
    volume = to_float(item[5])
    turnover = to_float(item[6]) if len(item) > 6 else 0

    if close <= 0:
        return None

    return {
        "time": datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat() if timestamp_ms else None,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "turnover": turnover,
    }


def _build_crypto_intraday_features(price: float, raw_klines: list[Any]) -> dict[str, Any]:
    candles = [
        candle for candle in (
            _normalize_bybit_kline_item(item)
            for item in raw_klines
        )
        if candle
    ]
    candles.sort(key=lambda item: item.get("time") or "")

    closes = [_point_close(point) for point in candles if _point_close(point) > 0]
    if len(closes) < 2:
        return {
            "chart7d": candles,
            "priceChangePercent1h": 0,
            "priceChangePercent4h": 0,
            "volumeTrendRatio": 1,
            "rangePosition": 0.5,
        }

    current_price = price if price > 0 else closes[-1]
    previous_1h = closes[-2]
    previous_4h = closes[-5] if len(closes) >= 5 else closes[0]
    recent_turnover = sum(_point_turnover(point) for point in candles[-4:])
    previous_turnover = sum(_point_turnover(point) for point in candles[-8:-4])
    highs = [to_float(point.get("high")) for point in candles[-24:] if to_float(point.get("high")) > 0]
    lows = [to_float(point.get("low")) for point in candles[-24:] if to_float(point.get("low")) > 0]
    high = max(highs) if highs else current_price
    low = min(lows) if lows else current_price
    range_position = (current_price - low) / (high - low) if high > low else 0.5

    return {
        "chart7d": candles,
        "priceChangePercent1h": calculate_percent_change(current_price, previous_1h),
        "priceChangePercent4h": calculate_percent_change(current_price, previous_4h),
        "volumeTrendRatio": recent_turnover / previous_turnover if previous_turnover > 0 else 1,
        "rangePosition": _clamp(range_position, 0, 1),
    }


def _strategy_type_for_strategy_id(strategy_id: str) -> StrategyType:
    if strategy_id == "ai-long":
        return StrategyType.LONG

    if strategy_id == "ai-short":
        # The UI "Short" strategy is a short-term scalp/momentum mode, not a
        # permanent bearish short. It should buy strong impulse and exit fast.
        return StrategyType.LONG

    return StrategyType.LONG_SHORT


async def _load_asset_for_decision(
    asset_type: str,
    symbol: str,
    user_id: Any | None = None,
    figi: str | None = None,
) -> dict[str, Any]:
    normalized_type = asset_type.lower()
    normalized_symbol = symbol.upper()
    asset = await _load_asset_for_score(normalized_type, normalized_symbol, user_id, figi)

    if normalized_type != "crypto":
        return asset

    route_symbol = normalized_symbol if normalized_symbol.endswith("USDT") else f"{normalized_symbol}USDT"

    try:
        ticker = await bybit_client.get_ticker(route_symbol, "spot")
        if ticker:
            price = to_float(ticker.get("lastPrice")) or to_float(asset.get("price"))
            bid = to_float(ticker.get("bid1Price"))
            ask = to_float(ticker.get("ask1Price"))
            spread_percent = ((ask - bid) / price * 100) if price > 0 and ask > 0 and bid > 0 else 0
            asset = {
                **asset,
                "symbol": route_symbol,
                "routeSymbol": route_symbol,
                "price": price,
                "priceChangePercent24h": to_float(ticker.get("price24hPcnt")) * 100,
                "turnover24h": to_float(ticker.get("turnover24h")) or asset.get("turnover24h"),
                "volume24h": to_float(ticker.get("volume24h")) or asset.get("volume24h"),
                "bidAskSpreadPercent": round(max(spread_percent, 0), 4),
            }
    except Exception:
        pass

    try:
        raw_klines = await bybit_client.get_kline(
            symbol=route_symbol,
            category="spot",
            interval="60",
            limit=48,
        )
        intraday_features = _build_crypto_intraday_features(to_float(asset.get("price")), raw_klines)
        asset = {**asset, **intraday_features}
    except Exception:
        asset = {
            **asset,
            "dataQualityFlags": [
                *(asset.get("dataQualityFlags") or []),
                "intraday_provider_unavailable",
            ],
        }

    return asset


async def _build_ai_trade_decision(
    asset_type: str,
    symbol: str,
    user_id: Any | None = None,
    figi: str | None = None,
    strategy_type: StrategyType = StrategyType.LONG_SHORT,
    risk_context: RiskContext | None = None,
) -> AITradeDecision:
    asset = await _load_asset_for_decision(asset_type, symbol, user_id, figi)
    features = build_market_features(asset)
    return select_strategy_decision(
        features,
        _ai_trading_config(),
        strategy_type,
        risk_context,
    )


async def _store_ai_trade_decision(
    user_id: Any,
    decision: AITradeDecision,
    strategy_id: str | None = None,
    asset_type: str | None = None,
    result: str | None = None,
) -> None:
    pool = get_database_pool()
    payload = decision.model_dump(mode="json")

    async with pool.acquire() as connection:
        await connection.execute(
            """
            insert into ai_trade_decisions (
                id, user_id, strategy_id, symbol, asset, asset_type,
                strategy_type, final_action, confidence, probability_tp_before_sl,
                probability_long_success, probability_short_success, market_regime,
                technical_score, news_score, sentiment_score, risk_score,
                liquidity_score, volatility_score, entry_price, take_profit,
                stop_loss, risk_reward, expected_value_percent,
                estimated_fees_percent, estimated_slippage_percent,
                position_size_percent, max_risk_percent_of_deposit,
                validator_passed, risk_manager_passed, rejection_reason,
                reasons_for, reasons_against, raw_features, decision_payload,
                result, created_by, created_at
            )
            values (
                $1::uuid, $2, $3, $4, $5, $6,
                $7, $8, $9, $10,
                $11, $12, $13,
                $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24,
                $25, $26,
                $27, $28,
                $29, $30, $31,
                $32::jsonb, $33::jsonb, $34::jsonb, $35::jsonb,
                $36, $37, $38
            )
            on conflict (id) do nothing
            """,
            decision.id,
            user_id,
            strategy_id,
            decision.symbol,
            decision.asset,
            asset_type or decision.raw_features.get("asset_type") or "crypto",
            decision.strategy_type.value,
            decision.final_action.value,
            decision.confidence,
            decision.probability_tp_before_sl,
            decision.probability_long_success,
            decision.probability_short_success,
            decision.market_regime.value,
            decision.technical_score,
            decision.news_score,
            decision.sentiment_score,
            decision.risk_score,
            decision.liquidity_score,
            decision.volatility_score,
            decision.entry_price,
            decision.take_profit,
            decision.stop_loss,
            decision.risk_reward,
            decision.expected_value_percent,
            decision.estimated_fees_percent,
            decision.estimated_slippage_percent,
            decision.position_size_percent,
            decision.max_risk_percent_of_deposit,
            decision.validator_passed,
            decision.risk_manager_passed,
            decision.rejection_reason,
            json.dumps(decision.reasons_for),
            json.dumps(decision.reasons_against),
            json.dumps(decision.raw_features),
            json.dumps(payload),
            result,
            decision.created_by,
            decision.timestamp,
        )


def _calculate_short_term_probability(score_payload: dict[str, Any], asset: dict[str, Any]) -> float:
    factors = score_payload.get("factors") or {}
    change_1h = to_float(factors.get("change1h"))
    change_4h = to_float(factors.get("change4h"))
    change_1d = to_float(factors.get("change1d"))
    change_7d = to_float(factors.get("change7d"))
    change_30d = to_float(factors.get("change30d"))
    liquidity = to_float(factors.get("liquidity"))
    risk = to_float(factors.get("risk"))
    volatility = to_float(factors.get("volatility"))
    spread_percent = to_float(factors.get("spreadPercent"))
    volume_ratio = to_float(factors.get("volumeTrendRatio"), 1)
    range_position = to_float(factors.get("rangePosition"), 0.5)
    symbol = str(asset.get("symbol") or "").upper()
    turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))
    core_bonus = 6 if symbol in CORE_CRYPTO_SYMBOLS or symbol in CORE_STOCK_SYMBOLS else 0
    liquidity_bonus = (liquidity - 50) * 0.28
    turnover_bonus = _clamp(math.log10(max(turnover, 1)) - 6, 0, 3.5) * 1.8
    breakout_bonus = 0
    if 0.18 <= change_1h <= 4 and 0.45 <= change_4h <= 10 and 1.2 <= change_1d <= 14:
        breakout_bonus += min(change_1d * 0.9, 8)
    if 14 < change_1d <= 28 and liquidity >= 58 and change_1h > 0:
        breakout_bonus += 4
    confirmation_bonus = 0
    if change_1h > 0 and change_4h > 0:
        confirmation_bonus += 8
    if volume_ratio >= 1.12:
        confirmation_bonus += min((volume_ratio - 1) * 10, 8)
    if 0.52 <= range_position <= 0.92:
        confirmation_bonus += 5
    momentum = (
        max(change_1h, 0) * 6.2
        + max(change_4h, 0) * 3.8
        + max(change_1d, 0) * 1.0
        + max(change_7d, 0) * 0.35
        + max(change_30d, 0) * 0.12
    )
    weak_trend_penalty = (
        max(-change_1h, 0) * 7.5
        + max(-change_4h, 0) * 4.2
        + max(-change_1d, 0) * 2.0
        + max(-change_7d, 0) * 0.7
    )
    overheating_penalty = (
        max(change_1d - 18, 0) * 0.85
        + max(change_1h - 5, 0) * 4
        + max(volatility - 18, 0) * 1.2
    )
    micro_liquidity_penalty = 14 if asset.get("assetType") == "crypto" and 0 < turnover < 1_000_000 else 0
    spread_penalty = min(spread_percent * 24, 16)

    return _clamp(
        44
        + momentum
        + liquidity_bonus
        + turnover_bonus
        + breakout_bonus
        + confirmation_bonus
        + (risk - 50) * 0.06
        + core_bonus
        - weak_trend_penalty
        - overheating_penalty
        - micro_liquidity_penalty
        - spread_penalty,
        0,
        100,
    )


def _calculate_short_probability(score_payload: dict[str, Any]) -> float:
    factors = score_payload.get("factors") or {}
    change_1h = to_float(factors.get("change1h"))
    change_4h = to_float(factors.get("change4h"))
    change_1d = to_float(factors.get("change1d"))
    change_7d = to_float(factors.get("change7d"))
    change_30d = to_float(factors.get("change30d"))
    liquidity = to_float(factors.get("liquidity"))
    risk = to_float(factors.get("risk"))
    spread_percent = to_float(factors.get("spreadPercent"))
    volume_ratio = to_float(factors.get("volumeTrendRatio"), 1)
    bearish_momentum = (
        max(-change_1h, 0) * 7.0
        + max(-change_4h, 0) * 4.2
        + max(-change_1d, 0) * 1.4
        + max(-change_7d, 0) * 1.15
        + max(-change_30d, 0) * 0.45
    )
    bullish_penalty = (
        max(change_1h, 0) * 6.0
        + max(change_4h, 0) * 3.2
        + max(change_1d, 0) * 1.35
        + max(change_7d, 0) * 0.65
        + max(change_30d, 0) * 0.25
    )
    confirmation_bonus = 0

    if change_1h <= -0.12 and change_4h <= -0.35:
        confirmation_bonus += 8

    if volume_ratio >= 1.1:
        confirmation_bonus += min((volume_ratio - 1) * 8, 6)

    spread_penalty = min(spread_percent * 22, 14)

    return _clamp(
        44
        + bearish_momentum
        + confirmation_bonus
        - bullish_penalty
        + (liquidity - 50) * 0.12
        + (risk - 50) * 0.08
        - spread_penalty,
        0,
        100,
    )


def _strategy_config(strategy_id: str) -> dict[str, str]:
    return {
        "ai-short": {"title": "ИИ торговля Short", "mode": "scalp", "color": "var(--green)"},
        "ai-long": {"title": "ИИ торговля Long", "mode": "long", "color": "var(--green)"},
        "ai-short-long": {"title": "ИИ торговля Short + Long", "mode": "hybrid", "color": "var(--primary-blue)"},
    }[strategy_id]


def _strategy_risk_settings(risk_profile: str | None) -> dict[str, float | int]:
    normalized_profile = str(risk_profile or "balanced").lower()

    if normalized_profile not in PAPER_RISK_PROFILES:
        normalized_profile = "balanced"

    return {
        "max_allocation": PAPER_RISK_MAX_ALLOCATION[normalized_profile],
        "max_open_exposure": PAPER_RISK_MAX_OPEN_EXPOSURE[normalized_profile],
        "max_open_positions": PAPER_RISK_MAX_OPEN_POSITIONS[normalized_profile],
        "boldness": PAPER_RISK_BOLDNESS[normalized_profile],
    }


def _score_payload_ai_decision(score_payload: dict[str, Any]) -> dict[str, Any]:
    ai_decision = score_payload.get("aiDecision")
    return ai_decision if isinstance(ai_decision, dict) else {}


def _score_payload_factors(score_payload: dict[str, Any]) -> dict[str, Any]:
    factors = score_payload.get("factors")
    return factors if isinstance(factors, dict) else {}


def _normalized_liquidity(value: Any) -> float:
    liquidity = to_float(value)
    if liquidity > 1:
        liquidity /= 100
    return _clamp(liquidity, 0, 1)


def _strategy_entry_rank(item: tuple[float, str, dict[str, Any], dict[str, Any]]) -> float:
    probability, side, asset, score_payload = item
    ai_decision = _score_payload_ai_decision(score_payload)
    factors = _score_payload_factors(score_payload)
    liquidity = _normalized_liquidity(
        ai_decision.get("liquidity_score")
        or ai_decision.get("liquidityScore")
        or factors.get("liquidity_score")
        or factors.get("liquidityScore")
        or factors.get("liquidity")
    )
    expected_value = to_float(ai_decision.get("expected_value_percent") or ai_decision.get("expectedValuePercent"))
    risk_reward = to_float(ai_decision.get("risk_reward") or ai_decision.get("riskReward"), 1)
    spread = to_float(factors.get("spread_percent") or factors.get("spreadPercent") or asset.get("bidAskSpreadPercent"))
    volume_change = to_float(factors.get("volume_change_24h") or factors.get("volumeChange24h"))
    change_1h = to_float(factors.get("price_change_1h") or factors.get("priceChange1h") or asset.get("priceChangePercent1h"))
    turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))
    turnover_bonus = _clamp((math.log10(max(turnover, 1)) - 5) * 1.4, -2.5, 6)
    momentum_bonus = 0.0

    if side == "Long" and change_1h > 0:
        momentum_bonus += _clamp(change_1h * 0.65, 0, 4.5)
    elif side == "Short" and change_1h < 0:
        momentum_bonus += _clamp(abs(change_1h) * 0.65, 0, 4.5)

    if volume_change > 0:
        momentum_bonus += _clamp(volume_change / 35, 0, 3)

    return (
        probability
        + expected_value * 10
        + max(risk_reward - 1.2, 0) * 6
        + liquidity * 8
        + turnover_bonus
        + momentum_bonus
        - spread * 14
    )


def _strategy_entry_weight(item: tuple[float, str, dict[str, Any], dict[str, Any]]) -> float:
    probability, side, asset, score_payload = item
    ai_decision = _score_payload_ai_decision(score_payload)
    factors = _score_payload_factors(score_payload)
    liquidity = _normalized_liquidity(
        ai_decision.get("liquidity_score")
        or ai_decision.get("liquidityScore")
        or factors.get("liquidity_score")
        or factors.get("liquidityScore")
        or factors.get("liquidity")
    )
    expected_value = to_float(ai_decision.get("expected_value_percent") or ai_decision.get("expectedValuePercent"))
    risk_reward = to_float(ai_decision.get("risk_reward") or ai_decision.get("riskReward"), 1)
    position_size = to_float(ai_decision.get("position_size_percent") or ai_decision.get("positionSizePercent"))
    volatility = to_float(
        factors.get("volatility_atr")
        or factors.get("volatilityAtr")
        or factors.get("volatility")
    )
    change_1h = to_float(factors.get("price_change_1h") or factors.get("priceChange1h") or asset.get("priceChangePercent1h"))
    volume_change = to_float(factors.get("volume_change_24h") or factors.get("volumeChange24h"))
    scalp_bonus = 0.0

    if score_payload.get("strategyLeg") == "scalp" and side == "Long" and change_1h > 0:
        scalp_bonus = 0.65

    weight = (
        0.8
        + max(probability - 60, 0) / 12
        + max(expected_value, 0) * 2.8
        + max(risk_reward - 1.2, 0) * 1.4
        + liquidity * 1.25
        + position_size / 18
        + _clamp(volume_change / 80, -0.25, 0.75)
        + scalp_bonus
        - max(volatility - 4, 0) * 0.16
    )

    return _clamp(weight, 0.05, 8)


def _allocate_strategy_entries(
    selected: list[tuple[float, str, dict[str, Any], dict[str, Any]]],
    start_capital: float,
    risk_profile: str | None,
    available_exposure: float | None = None,
) -> list[float]:
    if not selected or start_capital <= 0:
        return []

    settings_payload = _strategy_risk_settings(risk_profile)
    max_single = start_capital * float(settings_payload["max_allocation"])
    exposure_budget = start_capital * float(settings_payload["max_open_exposure"])

    if available_exposure is not None:
        exposure_budget = min(exposure_budget, max(available_exposure, 0))

    min_single = min(max(start_capital * 0.005, 250), 1_000)
    weights = [_strategy_entry_weight(item) for item in selected]
    allocations = [0.0 for _ in selected]
    remaining_indices = set(range(len(selected)))
    remaining_budget = exposure_budget

    while remaining_indices and remaining_budget > min_single:
        total_weight = sum(weights[index] for index in remaining_indices)
        if total_weight <= 0:
            break

        capped_indices: list[int] = []
        for index in list(remaining_indices):
            proposed = remaining_budget * weights[index] / total_weight
            if proposed >= max_single:
                allocations[index] = max_single
                remaining_budget -= max_single
                capped_indices.append(index)

        if not capped_indices:
            for index in remaining_indices:
                allocations[index] = remaining_budget * weights[index] / total_weight
            break

        for index in capped_indices:
            remaining_indices.discard(index)

    return [
        round(allocation, 2) if allocation >= min_single else 0
        for allocation in allocations
    ]


def _strategy_closed_loss_streak(trades: list[dict[str, Any]]) -> int:
    closed_trades = [
        trade
        for trade in trades
        if isinstance(trade, dict) and trade.get("status") == "closed"
    ]
    closed_trades.sort(
        key=lambda trade: trade.get("closedAt") or trade.get("updatedAt") or trade.get("executedAt") or "",
        reverse=True,
    )

    streak = 0
    for trade in closed_trades:
        if to_float(trade.get("resultAmount")) < 0:
            streak += 1
            continue

        break

    return streak


def _build_strategy_recovery_state(
    trades: list[dict[str, Any]],
    start_capital: float,
    equity_pnl: float,
    risk_settings: dict[str, float | int],
) -> dict[str, Any]:
    drawdown_percent = (equity_pnl / start_capital) * 100 if start_capital else 0
    loss_streak = _strategy_closed_loss_streak(trades)
    base_boldness = float(risk_settings.get("boldness") or 65)
    state = "normal"
    label = "Рабочий режим"
    reason = "Сигналы проходят стандартные EV/Risk фильтры."
    exposure_multiplier = 1.0
    probability_bonus = 0.0
    max_open_positions = int(risk_settings.get("max_open_positions") or 5)

    if drawdown_percent <= PAPER_DEFENSIVE_DRAWDOWN_PERCENT or loss_streak >= PAPER_DEFENSIVE_LOSS_STREAK:
        state = "defensive"
        label = "Защитная пересборка"
        reason = "Просадка или серия убытков высокая: стратегия режет риск и берет только самые сильные входы."
        exposure_multiplier = 0.28
        probability_bonus = 8.0
        max_open_positions = max(1, min(max_open_positions, 2))
    elif drawdown_percent <= PAPER_REGROUP_DRAWDOWN_PERCENT or loss_streak >= PAPER_REGROUP_LOSS_STREAK:
        state = "regroup"
        label = "Пересборка"
        reason = "Стратегия ушла в минус: снижаем смелость, повышаем порог входа и убираем слабые позиции."
        exposure_multiplier = 0.58
        probability_bonus = 4.0
        max_open_positions = max(2, min(max_open_positions, 3))

    return {
        "state": state,
        "label": label,
        "reason": reason,
        "drawdownPercent": round(drawdown_percent, 2),
        "lossStreak": loss_streak,
        "exposureMultiplier": exposure_multiplier,
        "probabilityBonus": probability_bonus,
        "maxOpenPositions": max_open_positions,
        "baseBoldness": round(base_boldness, 2),
        "effectiveBoldness": round(base_boldness * exposure_multiplier, 2),
    }


def _entry_passes_recovery_filter(
    item: tuple[float, str, dict[str, Any], dict[str, Any]],
    recovery_state: dict[str, Any],
) -> bool:
    probability, _, _, score_payload = item
    if recovery_state.get("state") == "normal":
        return True

    ai_decision = _score_payload_ai_decision(score_payload)
    min_probability = 60 + to_float(recovery_state.get("probabilityBonus"))
    min_ev = 0.08 if recovery_state.get("state") == "regroup" else 0.16
    expected_value = to_float(ai_decision.get("expected_value_percent") or ai_decision.get("expectedValuePercent"))
    risk_reward = to_float(ai_decision.get("risk_reward") or ai_decision.get("riskReward"), 1)

    return probability >= min_probability and expected_value >= min_ev and risk_reward >= 1.25


def _apply_strategy_recovery_actions(
    trades: list[dict[str, Any]],
    recovery_state: dict[str, Any],
) -> list[dict[str, Any]]:
    state = str(recovery_state.get("state") or "normal")
    if state == "normal":
        return trades

    now = _strategy_now().isoformat()
    next_trades: list[dict[str, Any]] = []
    cut_threshold = -0.45 if state == "defensive" else -0.85
    probability_drop = 5 if state == "defensive" else 7

    for trade in trades:
        if trade.get("status") == "closed":
            next_trades.append(trade)
            continue

        result_percent = to_float(trade.get("resultPercent"))
        entry_probability = to_float(trade.get("probability"))
        current_probability = to_float(trade.get("currentProbability"), entry_probability)
        should_cut = (
            result_percent <= cut_threshold
            and current_probability <= max(entry_probability - probability_drop, 54)
        )
        should_lock_small_profit = (
            state == "defensive"
            and result_percent >= 0.25
            and current_probability < 64
        )

        if should_cut or should_lock_small_profit:
            events = list(trade.get("events") or [])
            events.append({
                "type": "recovery_rebalance",
                "createdAt": now,
                "label": "Пересборка стратегии",
                "state": state,
                "reason": recovery_state.get("reason"),
            })
            next_trades.append({
                **trade,
                "status": "closed",
                "closeReason": "recovery_rebalance",
                "closedAt": now,
                "events": events,
                "updatedAt": now,
            })
            continue

        next_trades.append(trade)

    return next_trades


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
    decision_log: list[dict[str, Any]] | None = None,
) -> list[tuple[float, str, dict[str, Any], dict[str, Any]]]:
    config = _strategy_config(strategy_id)
    long_ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
    short_ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
    connection = connection or {}
    universe = str(connection.get("universe") or "mixed").lower()
    risk_profile = str(connection.get("riskProfile") or connection.get("risk_profile") or "balanced").lower()
    risk_settings = _strategy_risk_settings(risk_profile)
    base_ai_config = _ai_trading_config()
    ai_config = base_ai_config.model_copy(update={
        "max_open_positions": max(
            base_ai_config.max_open_positions,
            int(risk_settings["max_open_positions"]),
        ),
    })
    excluded_symbols = excluded_symbols or set()

    for asset in candidates:
        symbol = str(asset.get("symbol") or "").upper()
        if not symbol or symbol in excluded_symbols:
            continue

        if not _strategy_asset_matches_universe(asset, universe):
            continue

        turnover = to_float(asset.get("turnover24h") or asset.get("volume24h"))
        if asset.get("assetType") == "crypto" and 0 < turnover < 500_000:
            continue

        features = build_market_features(asset)
        mode = config["mode"]
        preferred_strategy = _strategy_type_for_strategy_id(strategy_id)
        decision = select_strategy_decision(
            features,
            ai_config,
            preferred_strategy,
            RiskContext(open_positions_count=len(excluded_symbols)),
        )
        if decision_log is not None:
            decision_log.append({
                "assetType": asset.get("assetType") or "crypto",
                "decision": decision.model_dump(mode="json"),
            })

        if decision.final_action == FinalAction.NO_TRADE or not decision.risk_manager_passed:
            continue

        side = "Short" if decision.final_action == FinalAction.OPEN_SHORT else "Long"
        raw_probability = round(decision.probability_tp_before_sl * 100, 2)
        memory_item = (memory or {}).get(symbol)
        if _memory_blocks_entry(memory_item, raw_probability):
            continue

        memory_adjustment = _memory_score_adjustment(memory_item)
        probability = round(_clamp(raw_probability + memory_adjustment, 0, 100), 2)
        if probability < 60:
            continue

        strategy_leg = "short" if side == "Short" else "long"
        if mode == "scalp":
            strategy_leg = "scalp"
        if mode == "hybrid":
            strategy_leg = "hybrid_short" if side == "Short" else "hybrid_long"

        score_payload = {
            "score": probability,
            "signal": decision.final_action.value,
            "confidence": round(decision.confidence * 100, 2),
            "targetPrice": decision.take_profit,
            "targetRangeLow": min(decision.take_profit, decision.stop_loss),
            "targetRangeHigh": max(decision.take_profit, decision.stop_loss),
            "factors": decision.raw_features,
            "dataQualityFlags": decision.raw_features.get("data_quality_flags", []),
            "strategyLeg": strategy_leg,
            "aiDecision": decision.model_dump(mode="json"),
            "memory": {
                "rawLongProbability": round((decision.probability_long_success or 0) * 100, 2),
                "rawShortProbability": round((decision.probability_short_success or 0) * 100, 2),
                "rawProbability": raw_probability,
                "memoryAdjustment": round(memory_adjustment, 2),
                "tradesCount": int((memory_item or {}).get("tradesCount") or 0),
                "winsCount": int((memory_item or {}).get("winsCount") or 0),
                "lossesCount": int((memory_item or {}).get("lossesCount") or 0),
                "note": "strategy_memory_applied" if memory_item else "no_strategy_memory_yet",
            },
        }

        if mode == "short" and side == "Short":
            short_ranked.append((probability, side, asset, score_payload))
        elif mode == "scalp" and side == "Long":
            long_ranked.append((probability, side, asset, score_payload))
        elif mode == "long" and side == "Long":
            long_ranked.append((probability, side, asset, score_payload))
        elif mode == "hybrid":
            if side == "Short":
                short_ranked.append((probability, side, asset, score_payload))
            else:
                long_ranked.append((probability, side, asset, score_payload))

    long_ranked.sort(key=_strategy_entry_rank, reverse=True)
    short_ranked.sort(key=_strategy_entry_rank, reverse=True)

    if config["mode"] == "hybrid":
        selected: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
        selected_symbols: set[str] = set()

        rest = sorted([*long_ranked, *short_ranked], key=_strategy_entry_rank, reverse=True)
        for item in rest:
            if len(selected) >= limit:
                break
            symbol = str(item[2].get("symbol") or "").upper()
            if symbol and symbol not in selected_symbols:
                selected.append(item)
                selected_symbols.add(symbol)
        return selected[:limit]

    if config["mode"] == "short":
        return short_ranked[:limit]

    return long_ranked[:limit]


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
    ai_decision = score_payload.get("aiDecision") or {}

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
        "aiDecisionId": ai_decision.get("id"),
        "takeProfit": ai_decision.get("take_profit") or ai_decision.get("takeProfit"),
        "stopLoss": ai_decision.get("stop_loss") or ai_decision.get("stopLoss"),
        "expectedValuePercent": ai_decision.get("expected_value_percent") or ai_decision.get("expectedValuePercent"),
        "riskReward": ai_decision.get("risk_reward") or ai_decision.get("riskReward"),
        "entryContext": {
            "score": score_payload.get("score"),
            "confidence": score_payload.get("confidence"),
            "factors": score_payload.get("factors") or {},
            "memory": score_payload.get("memory") or {},
            "strategyLeg": score_payload.get("strategyLeg") or ("short" if side == "Short" else "long"),
            "aiDecision": ai_decision,
        },
        "status": "open",
        "closeReason": None,
        "scaleInCount": 0,
        "dcaAllowed": False,
        "dcaReason": "DCA еще не проверялся",
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
        crypto_tickers = list({
            str(item.get("symbol") or ""): item
            for item in [*core_tickers, *top_by_turnover, *top_gainers, *top_fallers]
            if item.get("symbol")
        }.values())

        async def build_crypto_candidate(item: dict[str, Any]) -> dict[str, Any] | None:
            symbol = str(item.get("symbol") or "")
            if not symbol:
                return None

            base = symbol.removesuffix("USDT")
            price = to_float(item.get("lastPrice"))
            change = to_float(item.get("price24hPcnt")) * 100
            bid = to_float(item.get("bid1Price"))
            ask = to_float(item.get("ask1Price"))
            spread_percent = ((ask - bid) / price * 100) if price > 0 and ask > 0 and bid > 0 else 0
            intraday_features: dict[str, Any] = {
                "chart7d": [],
                "priceChangePercent1h": 0,
                "priceChangePercent4h": 0,
                "volumeTrendRatio": 1,
                "rangePosition": 0.5,
            }

            try:
                raw_klines = await asyncio.wait_for(
                    bybit_client.get_kline(
                        symbol=symbol,
                        category="spot",
                        interval="60",
                        limit=24,
                    ),
                    timeout=STRATEGY_CRYPTO_KLINE_TIMEOUT_SECONDS,
                )
                intraday_features = _build_crypto_intraday_features(price, raw_klines)
            except Exception:
                pass

            return {
                "assetType": "crypto",
                "symbol": symbol,
                "name": base,
                "price": price,
                "priceChangePercent24h": change,
                "priceChangePercent7d": change,
                "priceChangePercent30d": change,
                "turnover24h": to_float(item.get("turnover24h")),
                "bidAskSpreadPercent": round(max(spread_percent, 0), 4),
                "iconUrl": get_coinmarketcap_icon_url(base),
                **intraday_features,
            }

        crypto_candidates = await asyncio.gather(*[
            build_crypto_candidate(item) for item in crypto_tickers[:STRATEGY_CRYPTO_KLINE_CANDIDATES_LIMIT]
        ], return_exceptions=True)
        candidates.extend([
            item for item in crypto_candidates
            if isinstance(item, dict)
        ])
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
                try:
                    candles = await asyncio.wait_for(
                        get_stock_candles(item["SECID"], "TQBR", days=35),
                        timeout=STRATEGY_STOCK_CANDLES_TIMEOUT_SECONDS,
                    )
                except Exception:
                    candles = []

                stock = format_stock(securities_map[item["SECID"]], item, candles)
                if tbank_token:
                    try:
                        instrument = await asyncio.wait_for(
                            _find_tbank_share_by_symbol(tbank_token, item["SECID"]),
                            timeout=STRATEGY_TBANK_LOOKUP_TIMEOUT_SECONDS,
                        )
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

        stock_candidates = await asyncio.gather(*[
            format_candidate(item)
            for item in list(liquid_marketdata)[:STRATEGY_STOCK_CANDIDATES_LIMIT]
        ], return_exceptions=True)
        candidates.extend([item for item in stock_candidates if item])
    except Exception:
        pass

    if candidates:
        try:
            market_context = await _load_strategy_market_context()
            candidates = [
                _enrich_strategy_candidate_with_context(candidate, market_context)
                for candidate in candidates
            ]
        except Exception:
            candidates = [
                {
                    **candidate,
                    "sourceManifest": [
                        *list(candidate.get("sourceManifest") or []),
                        "market_context_unavailable",
                    ],
                    "dataQualityFlags": [
                        *list(candidate.get("dataQualityFlags") or []),
                        "market_context_unavailable",
                    ],
                }
                for candidate in candidates
            ]

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
    risk_settings = _strategy_risk_settings(risk_profile)
    decision_log: list[dict[str, Any]] = []
    selected = _select_strategy_entries(
        strategy_id,
        candidates,
        connection,
        limit=int(risk_settings["max_open_positions"]),
        memory=memory,
        decision_log=decision_log,
    )

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
    allocations = _allocate_strategy_entries(selected, normalized_start_capital, risk_profile)
    recovery_state = _build_strategy_recovery_state(trades, normalized_start_capital, 0, risk_settings)

    for index, ((probability, side, asset, score_payload), allocation) in enumerate(zip(selected, allocations)):
        if allocation <= 0:
            continue
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
        "decisionLog": decision_log[:120],
        "threshold": 60,
        "schemaVersion": PAPER_STRATEGY_SCHEMA_VERSION,
        "connection": connection,
        "riskSettings": risk_settings,
        "recoveryState": recovery_state,
        "boldness": risk_settings.get("boldness"),
        "effectiveBoldness": recovery_state.get("effectiveBoldness"),
        "capitalDeploymentPercent": round(
            sum(to_float(trade.get("virtualAmount")) for trade in trades) / normalized_start_capital * 100,
            2,
        ) if normalized_start_capital else 0,
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
    connection = payload.get("connection") or {}
    risk_profile = str(connection.get("riskProfile") or connection.get("risk_profile") or "balanced").lower()
    risk_settings = _strategy_risk_settings(risk_profile)
    updated_trades = []
    max_open_exposure = start_capital * float(risk_settings["max_open_exposure"])
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
        dca_evaluation = {
            "dca_allowed": False,
            "dca_reason": "DCA условия не проверялись: позиция не дошла до DCA-зоны.",
            "dca_new_average_price": None,
            "dca_total_risk_percent": None,
        }

        if (
            result_percent <= float(rules["dcaStep"] or PAPER_DCA_STEP_PERCENT)
            and candidate
            and current_price > 0
            and virtual_amount > 0
        ):
            try:
                current_decision_payload = (trade.get("entryContext") or {}).get("aiDecision") or {}
                current_decision = AITradeDecision.model_validate(current_decision_payload)
                dca_features = build_market_features({**candidate, "price": current_price})
                dca_result = evaluate_dca(
                    current_decision,
                    dca_features,
                    entry_price,
                    abs(result_percent),
                    scale_in_count,
                    _ai_trading_config(),
                )
                dca_evaluation = dca_result.model_dump(mode="json")
            except Exception:
                dca_evaluation = {
                    "dca_allowed": False,
                    "dca_reason": "не удалось проверить DCA через AI Trading Brain",
                    "dca_new_average_price": None,
                    "dca_total_risk_percent": None,
                }

        if (
            result_percent <= float(rules["dcaStep"] or PAPER_DCA_STEP_PERCENT)
            and scale_in_count < PAPER_MAX_SCALE_INS
            and current_price > 0
            and virtual_amount > 0
            and live_probability is not None
            and live_probability >= max(to_float(trade.get("probability")) - 4, 72)
            and dca_evaluation["dca_allowed"]
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
            "dcaAllowed": bool(dca_evaluation["dca_allowed"]),
            "dcaReason": dca_evaluation["dca_reason"],
            "dcaNewAveragePrice": dca_evaluation["dca_new_average_price"],
            "dcaTotalRiskPercent": dca_evaluation["dca_total_risk_percent"],
            "events": events,
            "updatedAt": _strategy_now().isoformat(),
        })

    pre_entry_realized_pnl = sum(
        to_float(trade.get("resultAmount"))
        for trade in updated_trades
        if trade.get("status") == "closed"
    )
    pre_entry_unrealized_pnl = sum(
        to_float(trade.get("resultAmount"))
        for trade in updated_trades
        if trade.get("status") != "closed"
    )
    recovery_state = _build_strategy_recovery_state(
        updated_trades,
        start_capital,
        pre_entry_realized_pnl + pre_entry_unrealized_pnl,
        risk_settings,
    )
    updated_trades = _apply_strategy_recovery_actions(updated_trades, recovery_state)

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
    max_open_positions = int(recovery_state.get("maxOpenPositions") or risk_settings["max_open_positions"])
    max_open_exposure *= float(recovery_state.get("exposureMultiplier") or 1)
    decision_log = list(payload.get("decisionLog") or [])

    if len(open_symbols) < max_open_positions and len(updated_trades) < PAPER_MAX_DAILY_TRADES:
        new_entries = _select_strategy_entries(
            str(payload.get("id") or ""),
            candidates,
            connection,
            limit=max_open_positions - len(open_symbols),
            excluded_symbols=known_symbols,
            memory=memory,
            decision_log=decision_log,
        )
        new_entries = [
            entry
            for entry in new_entries
            if _entry_passes_recovery_filter(entry, recovery_state)
        ]

        open_exposure = sum(
            to_float(trade.get("virtualAmount"))
            for trade in updated_trades
            if trade.get("status") != "closed"
        )
        free_exposure = max(max_open_exposure - open_exposure, 0)
        allocations = _allocate_strategy_entries(
            new_entries,
            start_capital,
            risk_profile,
            available_exposure=free_exposure,
        )

        for index, ((probability, side, asset, score_payload), allocation) in enumerate(zip(new_entries, allocations)):
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
    current_open_exposure = sum(
        to_float(trade.get("virtualAmount"))
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
        "riskSettings": risk_settings,
        "recoveryState": recovery_state,
        "boldness": risk_settings.get("boldness"),
        "effectiveBoldness": recovery_state.get("effectiveBoldness"),
        "openExposure": round(current_open_exposure, 2),
        "capitalDeploymentPercent": round((current_open_exposure / start_capital) * 100 if start_capital else 0, 2),
        "chart": chart,
        "chartPoints": chart_points,
        "trades": updated_trades,
        "decisionLog": decision_log[-240:],
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
                decision_id = str(trade.get("aiDecisionId") or "")
                try:
                    UUID(decision_id)
                except Exception:
                    decision_id = ""

                if decision_id:
                    opened_at = _parse_strategy_datetime(trade.get("executedAt"))
                    closed_at = _parse_strategy_datetime(trade.get("closedAt"))
                    time_to_exit_seconds = (
                        int((closed_at - opened_at).total_seconds())
                        if opened_at and closed_at
                        else None
                    )
                    await connection.execute(
                        """
                        update ai_trade_decisions
                        set result = $4,
                            pnl_percent = $5,
                            pnl_amount = $6,
                            time_to_exit_seconds = $7,
                            exit_reason = $8
                        where id = $1::uuid
                          and user_id = $2
                          and strategy_id = $3
                        """,
                        decision_id,
                        user_id,
                        strategy_id,
                        event_type,
                        result_percent,
                        result_amount,
                        time_to_exit_seconds,
                        close_reason,
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


def _schedule_strategy_learning(user_id: Any, strategy_id: str, payload: dict[str, Any]) -> None:
    try:
        payload_copy = json.loads(json.dumps(payload, default=str))
    except Exception:
        payload_copy = payload

    task = asyncio.create_task(_record_strategy_learning(user_id, strategy_id, payload_copy))

    def _log_learning_error(done_task: asyncio.Task) -> None:
        try:
            done_task.result()
        except Exception:
            logger.exception("Strategy learning task failed", extra={"strategy_id": strategy_id})

    task.add_done_callback(_log_learning_error)


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


async def _record_strategy_ai_decisions(user_id: Any, strategy_id: str, payload: dict[str, Any]) -> None:
    for item in payload.get("decisionLog") or []:
        if not isinstance(item, dict) or not isinstance(item.get("decision"), dict):
            continue

        try:
            decision = AITradeDecision.model_validate(item["decision"])
        except Exception:
            continue

        await _store_ai_trade_decision(
            user_id,
            decision,
            strategy_id=strategy_id,
            asset_type=item.get("assetType") or decision.raw_features.get("asset_type") or "crypto",
            result="strategy_decision",
        )

    for trade in payload.get("trades") or []:
        decision_payload = (trade.get("entryContext") or {}).get("aiDecision") if isinstance(trade, dict) else None
        if not isinstance(decision_payload, dict):
            continue

        try:
            decision = AITradeDecision.model_validate(decision_payload)
        except Exception:
            continue

        await _store_ai_trade_decision(
            user_id,
            decision,
            strategy_id=strategy_id,
            asset_type=trade.get("assetType") or decision.raw_features.get("asset_type") or "crypto",
            result="strategy_signal",
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
    latest_run_date = max((row["run_date"] for row in rows), default=None)

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

            # Older daily runs can contain positions that were open when the day
            # rolled over. They are historical state, not current exposure.
            if trade.get("status") != "closed" and row["run_date"] != latest_run_date:
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


async def _load_strategy_decision_metrics(user_id: Any, strategy_id: str) -> dict[str, Any]:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            """
            select count(*) as decisions_count,
                   count(*) filter (where risk_manager_passed) as allowed_count,
                   count(*) filter (where final_action = 'NO_TRADE') as no_trade_count,
                   avg(expected_value_percent) as avg_ev,
                   avg(probability_tp_before_sl) as avg_probability
            from ai_trade_decisions
            where user_id = $1 and strategy_id = $2
            """,
            user_id,
            strategy_id,
        )

        best_asset = await connection.fetchrow(
            """
            select symbol, sum(coalesce(pnl_amount, 0)) as pnl_amount
            from ai_trade_decisions
            where user_id = $1 and strategy_id = $2
            group by symbol
            order by pnl_amount desc
            limit 1
            """,
            user_id,
            strategy_id,
        )

        worst_asset = await connection.fetchrow(
            """
            select symbol, sum(coalesce(pnl_amount, 0)) as pnl_amount
            from ai_trade_decisions
            where user_id = $1 and strategy_id = $2
            group by symbol
            order by pnl_amount asc
            limit 1
            """,
            user_id,
            strategy_id,
        )

    return {
        "decisionsCount": int(row["decisions_count"] or 0) if row else 0,
        "tradeAllowedCount": int(row["allowed_count"] or 0) if row else 0,
        "noTradeCount": int(row["no_trade_count"] or 0) if row else 0,
        "avgExpectedValue": float(row["avg_ev"] or 0) if row else 0,
        "avgProbability": float(row["avg_probability"] or 0) if row else 0,
        "bestAsset": best_asset["symbol"] if best_asset else None,
        "worstAsset": worst_asset["symbol"] if worst_asset else None,
    }


async def _attach_strategy_lifetime(
    user_id: Any,
    payload: dict[str, Any],
    include_learning: bool = False,
) -> dict[str, Any]:
    strategy_id = str(payload.get("id") or "")
    lifetime = await _load_strategy_lifetime(user_id, strategy_id)
    decision_metrics = await _load_strategy_decision_metrics(user_id, strategy_id)
    learning_payload: dict[str, Any] = {}

    if include_learning:
        memory = await _load_strategy_memory(user_id, strategy_id)
        events = await _load_strategy_events(user_id, strategy_id)
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
        "decisionMetrics": decision_metrics,
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
    strategy_memory: dict[str, dict[str, Any]] = {}
    try:
        strategy_memory = await _load_strategy_memory(user_id, strategy_id)
    except Exception:
        logger.exception("Failed to load strategy memory", extra={"strategy_id": strategy_id})
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
            await _record_strategy_ai_decisions(user_id, strategy_id, updated_payload)
            await _record_paper_strategy_trades(user_id, strategy_id, updated_payload)
            _schedule_strategy_learning(user_id, strategy_id, updated_payload)
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
    await _record_strategy_ai_decisions(user_id, strategy_id, payload)
    await _record_paper_strategy_trades(user_id, strategy_id, payload)
    _schedule_strategy_learning(user_id, strategy_id, payload)

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
        active_strategy_ids = await _ensure_autonomous_strategy_connections(user_id)
        if not active_strategy_ids:
            payload = _build_strategy_response([], refreshing=False)
            _set_cached_strategy_response(user_id, payload)
            return payload

        candidates = await _load_strategy_candidates(user_id)
        results = await asyncio.gather(*[
            _get_or_create_strategy_run(user_id, strategy_id, candidates=candidates)
            for strategy_id in active_strategy_ids
        ], return_exceptions=True)
        items = [item for item in results if isinstance(item, dict)]
        payload = _build_strategy_response(items, refreshing=False)
        _set_cached_strategy_response(user_id, payload)
        return payload
    except Exception:
        logger.exception("Failed to refresh strategy response cache", extra={"user_id": str(user_id)})
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
              and model = $4
              and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
            order by created_at desc
            limit 1
            """,
            current_user["id"],
            asset_type,
            normalized_symbol,
            ASSET_SCORE_MODEL,
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
    model = ASSET_SCORE_MODEL
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
        factors = score_payload.get("factors") or {}
        score = round(float(score_payload.get("score") or 0), 1)
        change_1d = factors.get("change1d")
        volatility = factors.get("volatility")
        liquidity = factors.get("liquidity")
        target_move = score_payload.get("targetMovePercent")
        data_note = (
            "Данных достаточно для базовой оценки."
            if not flags
            else f"Есть ограничения качества данных: {', '.join(flags)}."
        )
        summary = (
            f"Коротко: {asset.get('name') or normalized_symbol} сейчас получает модельную оценку {score}% "
            f"и статус {signal}. Это исследовательский сценарий, а не персональная рекомендация.\n\n"
            f"Что поддерживает сценарий: дневное изменение {change_1d if change_1d is not None else 'н/д'}%, "
            f"ликвидность оценивается на {liquidity if liquidity is not None else 'н/д'} из 100, "
            "а расчет смотрит на momentum, качество тренда и волатильность.\n\n"
            f"Что против: волатильность {volatility if volatility is not None else 'н/д'}% и слабые участки данных "
            "могут быстро менять картину, поэтому сигнал нельзя воспринимать как готовую сделку.\n\n"
            f"Качество данных: {data_note} Если виден fallback по тикеру, прогноз специально сжат и осторожен.\n\n"
            f"Итог: базовый сценарий по модели — движение около {target_move if target_move is not None else 'н/д'}% "
            "от текущей цены. Для входа все равно нужны стакан, спред, риск-лимит и подтверждение объема."
        )

    return {
        "symbol": normalized_symbol,
        "assetType": asset_type,
        "title": f"Сводка GPT · {asset.get('name') or normalized_symbol}",
        "summary": summary,
        "model": model if api_key else ASSET_SCORE_MODEL,
        "score": score_payload["score"],
        "signal": score_payload["signal"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ai/decision/{symbol}")
async def get_ai_trade_decision(
    symbol: str,
    asset_type: str = Query(default="crypto", pattern="^(crypto|stock|currency)$"),
    strategy_type: StrategyType = Query(default=StrategyType.LONG_SHORT),
    figi: str | None = Query(default=None, max_length=64),
    current_user=Depends(get_current_user),
):
    normalized_symbol = symbol.upper()

    try:
        decision = await _build_ai_trade_decision(
            asset_type,
            normalized_symbol,
            current_user["id"],
            figi,
            strategy_type,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось построить AI Trade Decision по рыночным данным.",
        ) from error

    await _store_ai_trade_decision(current_user["id"], decision, asset_type=asset_type, result="decision")
    return decision.model_dump(mode="json")


@router.post("/ai/scan")
async def scan_ai_trade_decisions(
    payload: AIScanRequest,
    current_user=Depends(get_current_user),
):
    decisions: list[AITradeDecision] = []

    if payload.symbols:
        symbols = list(dict.fromkeys(symbol.upper() for symbol in payload.symbols if symbol.strip()))[:payload.limit]
        for symbol in symbols:
            try:
                decision = await _build_ai_trade_decision(
                    payload.asset_type,
                    symbol,
                    current_user["id"],
                    strategy_type=payload.strategy_type,
                )
            except Exception:
                continue

            decisions.append(decision)
    else:
        candidates = await _load_strategy_candidates(current_user["id"])
        for asset in candidates[:payload.limit]:
            try:
                features = build_market_features(asset)
                decision = select_strategy_decision(
                    features,
                    _ai_trading_config(),
                    payload.strategy_type,
                )
            except Exception:
                continue

            decisions.append(decision)

    if not payload.include_no_trade:
        decisions = [decision for decision in decisions if decision.final_action != FinalAction.NO_TRADE]

    decisions.sort(
        key=lambda item: (
            item.risk_manager_passed,
            item.expected_value_percent,
            item.probability_tp_before_sl,
        ),
        reverse=True,
    )

    for decision in decisions:
        await _store_ai_trade_decision(
            current_user["id"],
            decision,
            asset_type=decision.raw_features.get("asset_type") or payload.asset_type,
            result="scan",
        )

    allowed = [decision for decision in decisions if decision.risk_manager_passed]
    no_trade = [decision for decision in decisions if decision.final_action == FinalAction.NO_TRADE]

    return {
        "items": [decision.model_dump(mode="json") for decision in decisions],
        "summary": {
            "evaluated": len(decisions),
            "tradeAllowed": len(allowed),
            "noTrade": len(no_trade),
            "blocked": len(decisions) - len(allowed),
        },
        "config": _ai_trading_config().model_dump(mode="json"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ai/journal")
async def get_ai_trade_journal(
    symbol: str | None = Query(default=None, max_length=40),
    strategy_type: StrategyType | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user=Depends(get_current_user),
):
    query = """
        select id, strategy_id, symbol, asset, asset_type, strategy_type,
               final_action, confidence, probability_tp_before_sl,
               probability_long_success, probability_short_success,
               market_regime, technical_score, news_score, sentiment_score,
               risk_score, liquidity_score, volatility_score, entry_price,
               take_profit, stop_loss, risk_reward, expected_value_percent,
               estimated_fees_percent, estimated_slippage_percent,
               position_size_percent, max_risk_percent_of_deposit,
               validator_passed, risk_manager_passed, rejection_reason,
               reasons_for, reasons_against, raw_features, decision_payload,
               result, pnl_percent, pnl_amount, max_favorable_excursion,
               max_adverse_excursion, time_to_exit_seconds, exit_reason,
               created_by, created_at
        from ai_trade_decisions
        where user_id = $1
          and ($2::varchar is null or symbol = $2)
          and ($3::varchar is null or strategy_type = $3)
        order by created_at desc
        limit $4
    """
    pool = get_database_pool()
    normalized_symbol = symbol.upper() if symbol else None
    strategy_filter = strategy_type.value if strategy_type else None

    async with pool.acquire() as connection:
        rows = await connection.fetch(query, current_user["id"], normalized_symbol, strategy_filter, limit)

    return {
        "items": [
            {
                "id": str(row["id"]),
                "strategyId": row["strategy_id"],
                "symbol": row["symbol"],
                "asset": row["asset"],
                "assetType": row["asset_type"],
                "strategyType": row["strategy_type"],
                "finalAction": row["final_action"],
                "confidence": float(row["confidence"] or 0),
                "probabilityTpBeforeSl": float(row["probability_tp_before_sl"] or 0),
                "probabilityLongSuccess": float(row["probability_long_success"]) if row["probability_long_success"] is not None else None,
                "probabilityShortSuccess": float(row["probability_short_success"]) if row["probability_short_success"] is not None else None,
                "marketRegime": row["market_regime"],
                "technicalScore": float(row["technical_score"] or 0),
                "newsScore": float(row["news_score"]) if row["news_score"] is not None else None,
                "sentimentScore": float(row["sentiment_score"]) if row["sentiment_score"] is not None else None,
                "riskScore": float(row["risk_score"] or 0),
                "liquidityScore": float(row["liquidity_score"] or 0),
                "volatilityScore": float(row["volatility_score"] or 0),
                "entryPrice": float(row["entry_price"] or 0),
                "takeProfit": float(row["take_profit"] or 0),
                "stopLoss": float(row["stop_loss"] or 0),
                "riskReward": float(row["risk_reward"] or 0),
                "expectedValuePercent": float(row["expected_value_percent"] or 0),
                "estimatedFeesPercent": float(row["estimated_fees_percent"] or 0),
                "estimatedSlippagePercent": float(row["estimated_slippage_percent"] or 0),
                "positionSizePercent": float(row["position_size_percent"] or 0),
                "maxRiskPercentOfDeposit": float(row["max_risk_percent_of_deposit"] or 0),
                "validatorPassed": bool(row["validator_passed"]),
                "riskManagerPassed": bool(row["risk_manager_passed"]),
                "rejectionReason": row["rejection_reason"],
                "reasonsFor": _safe_json_payload(row["reasons_for"], []),
                "reasonsAgainst": _safe_json_payload(row["reasons_against"], []),
                "rawFeatures": _safe_json_payload(row["raw_features"], {}),
                "decisionPayload": _safe_json_payload(row["decision_payload"], {}),
                "result": row["result"],
                "pnlPercent": float(row["pnl_percent"]) if row["pnl_percent"] is not None else None,
                "pnlAmount": float(row["pnl_amount"]) if row["pnl_amount"] is not None else None,
                "maxFavorableExcursion": float(row["max_favorable_excursion"]) if row["max_favorable_excursion"] is not None else None,
                "maxAdverseExcursion": float(row["max_adverse_excursion"]) if row["max_adverse_excursion"] is not None else None,
                "timeToExitSeconds": row["time_to_exit_seconds"],
                "exitReason": row["exit_reason"],
                "createdBy": row["created_by"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ],
    }


@router.get("/ai/metrics")
async def get_ai_trade_metrics(current_user=Depends(get_current_user)):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select strategy_type, market_regime,
                   count(*) as decisions_count,
                   count(*) filter (where final_action = 'NO_TRADE') as no_trade_count,
                   count(*) filter (where risk_manager_passed) as allowed_count,
                   avg(expected_value_percent) as avg_ev,
                   avg(probability_tp_before_sl) as avg_probability,
                   avg(pnl_percent) filter (where pnl_percent is not null) as avg_pnl,
                   sum(pnl_amount) filter (where pnl_amount is not null) as pnl_amount
            from ai_trade_decisions
            where user_id = $1
            group by strategy_type, market_regime
            order by decisions_count desc
            """,
            current_user["id"],
        )

    total_decisions = sum(int(row["decisions_count"] or 0) for row in rows)
    total_allowed = sum(int(row["allowed_count"] or 0) for row in rows)
    total_no_trade = sum(int(row["no_trade_count"] or 0) for row in rows)

    return {
        "summary": {
            "decisions": total_decisions,
            "tradeAllowed": total_allowed,
            "noTrade": total_no_trade,
            "blocked": max(total_decisions - total_allowed, 0),
        },
        "byRegimeAndStrategy": [
            {
                "strategyType": row["strategy_type"],
                "marketRegime": row["market_regime"],
                "decisions": int(row["decisions_count"] or 0),
                "noTrade": int(row["no_trade_count"] or 0),
                "tradeAllowed": int(row["allowed_count"] or 0),
                "avgExpectedValue": float(row["avg_ev"] or 0),
                "avgProbability": float(row["avg_probability"] or 0),
                "avgPnl": float(row["avg_pnl"] or 0),
                "pnlAmount": float(row["pnl_amount"] or 0),
            }
            for row in rows
        ],
    }


@router.post("/paper/execute-ai-decision")
async def execute_ai_decision_in_paper(
    payload: ExecuteAIDecisionRequest,
    current_user=Depends(get_current_user),
):
    decision = payload.decision
    if (
        not decision.validator_passed
        or not decision.risk_manager_passed
        or decision.final_action == FinalAction.NO_TRADE
    ):
        await _store_ai_trade_decision(
            current_user["id"],
            decision,
            strategy_id=payload.strategy_id,
            asset_type=decision.raw_features.get("asset_type") or "crypto",
            result="paper_rejected",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=decision.rejection_reason or "Risk Manager не разрешил paper-исполнение.",
        )

    notional = payload.virtual_capital * decision.position_size_percent / 100
    quantity = notional / decision.entry_price if decision.entry_price > 0 else 0
    paper_order = {
        "id": decision.id,
        "symbol": decision.symbol,
        "asset": decision.asset,
        "action": decision.final_action.value,
        "strategyType": decision.strategy_type.value,
        "entryPrice": decision.entry_price,
        "takeProfit": decision.take_profit,
        "stopLoss": decision.stop_loss,
        "quantity": round(quantity, 10),
        "notional": round(notional, 2),
        "expectedValuePercent": decision.expected_value_percent,
        "probabilityTpBeforeSl": decision.probability_tp_before_sl,
        "status": "paper_opened",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await _store_ai_trade_decision(
        current_user["id"],
        decision,
        strategy_id=payload.strategy_id,
        asset_type=decision.raw_features.get("asset_type") or "crypto",
        result="paper_opened",
    )

    return {
        "message": "AI decision исполнено в paper-режиме.",
        "paperOrder": paper_order,
    }


@router.get("/ai/strategies")
async def get_ai_strategies(current_user=Depends(get_current_user)):
    cached_response = _get_cached_strategy_response(current_user["id"])

    if cached_response:
        return cached_response

    try:
        active_strategy_ids = await asyncio.wait_for(
            _ensure_autonomous_strategy_connections(current_user["id"]),
            timeout=STRATEGY_SNAPSHOT_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.exception("Failed to load active strategy ids", extra={"user_id": str(current_user["id"])})
        active_strategy_ids = []

    if not active_strategy_ids:
        return _build_strategy_response([], refreshing=False)

    try:
        snapshot_items = await asyncio.wait_for(
            _load_strategy_snapshot_from_database(current_user["id"]),
            timeout=STRATEGY_SNAPSHOT_TIMEOUT_SECONDS,
        )
        snapshot_items = [
            item for item in snapshot_items
            if item.get("id") in active_strategy_ids
        ]
    except Exception:
        logger.exception("Failed to load strategy snapshot", extra={"user_id": str(current_user["id"])})
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
    await _ensure_autonomous_strategy_connections(current_user["id"])
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
        await connection.execute(
            """
            delete from ai_trade_decisions
            where user_id = $1
              and strategy_id = any($2::varchar[])
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
        active_strategy_ids = await _load_active_strategy_ids(current_user["id"])
        snapshot_items = await _load_strategy_snapshot_from_database(current_user["id"])
        snapshot_items = [
            item for item in snapshot_items
            if item.get("id") in active_strategy_ids
        ]
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


@router.post("/ai/strategies/{strategy_id}/disconnect")
async def disconnect_ai_strategy(
    strategy_id: str,
    current_user=Depends(get_current_user),
):
    if strategy_id not in PAPER_STRATEGY_IDS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Стратегия не найдена")

    pool = get_database_pool()
    async with pool.acquire() as connection:
        result = await connection.execute(
            """
            update ai_strategy_connections
            set is_active = false,
                updated_at = now()
            where user_id = $1 and strategy_id = $2
            """,
            current_user["id"],
            strategy_id,
        )

    _invalidate_strategy_response_cache(current_user["id"])

    return {
        "disconnected": True,
        "strategyId": strategy_id,
        "status": result,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def run_due_paper_strategies_for_all_users() -> None:
    pool = get_database_pool()
    await _ensure_autonomous_strategy_connections_for_all_users()

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select
                users.id as user_id,
                array_agg(distinct ai_strategy_connections.strategy_id) as strategy_ids
            from users
            join ai_strategy_connections
                on ai_strategy_connections.user_id = users.id
               and ai_strategy_connections.is_active = true
               and ai_strategy_connections.strategy_id = any($1::varchar[])
            group by users.id
            limit 100
            """,
            list(PAPER_STRATEGY_IDS),
        )

    if not rows:
        logger.info("Paper strategy scheduler idle: no active autonomous strategies")
        return

    for row in rows:
        user_id = row["user_id"]
        active_strategy_ids = [
            strategy_id
            for strategy_id in (row["strategy_ids"] or [])
            if strategy_id in PAPER_STRATEGY_IDS
        ]
        strategy_ids = list(dict.fromkeys(active_strategy_ids))

        if not strategy_ids:
            continue

        try:
            candidates = await _load_strategy_candidates(user_id)
            results = await asyncio.gather(*[
                _get_or_create_strategy_run(user_id, strategy_id, candidates=candidates)
                for strategy_id in strategy_ids
            ], return_exceptions=True)
        except Exception:
            logger.exception("Failed to run due paper strategies", extra={"user_id": str(user_id)})
            continue

        for result in results:
            if isinstance(result, Exception):
                logger.error(
                    "Paper strategy update failed",
                    exc_info=(type(result), result, result.__traceback__),
                    extra={"user_id": str(user_id)},
                )
        items = [item for item in results if isinstance(item, dict)]
        if items:
            _set_cached_strategy_response(user_id, _build_strategy_response(items, refreshing=False))
            logger.info(
                "Paper strategies updated",
                extra={
                    "user_id": str(user_id),
                    "strategies_count": len(items),
                    "candidates_count": len(candidates),
                },
            )


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
            logger.exception("Paper strategy scheduler iteration failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=PAPER_SCHEDULER_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue
