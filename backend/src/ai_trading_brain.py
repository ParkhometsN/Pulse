from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from enum import Enum
from statistics import mean
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class StrategyType(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    LONG_SHORT = "LONG_SHORT"
    NO_TRADE = "NO_TRADE"


class FinalAction(str, Enum):
    OPEN_LONG = "OPEN_LONG"
    OPEN_SHORT = "OPEN_SHORT"
    CLOSE_POSITION = "CLOSE_POSITION"
    HOLD = "HOLD"
    NO_TRADE = "NO_TRADE"


class MarketRegime(str, Enum):
    BULL_TREND = "BULL_TREND"
    BEAR_TREND = "BEAR_TREND"
    RANGE = "RANGE"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    LOW_VOLATILITY = "LOW_VOLATILITY"
    PANIC = "PANIC"
    EUPHORIA = "EUPHORIA"
    NEWS_DRIVEN = "NEWS_DRIVEN"
    UNKNOWN = "UNKNOWN"


class RiskManagerResult(BaseModel):
    allowed: bool
    adjusted_position_size_percent: float = 0
    rejection_reason: str | None = None
    warnings: list[str] = Field(default_factory=list)


class AITradeDecision(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    asset: str
    symbol: str
    strategy_type: StrategyType
    final_action: FinalAction
    confidence: float = Field(ge=0, le=1)
    probability_tp_before_sl: float = Field(ge=0.01, le=0.99)
    probability_long_success: float | None = Field(default=None, ge=0.01, le=0.99)
    probability_short_success: float | None = Field(default=None, ge=0.01, le=0.99)
    market_regime: MarketRegime
    technical_score: float = Field(ge=0, le=1)
    news_score: float | None = Field(default=None, ge=-1, le=1)
    sentiment_score: float | None = Field(default=None, ge=-1, le=1)
    risk_score: float = Field(ge=0, le=1)
    liquidity_score: float = Field(ge=0, le=1)
    volatility_score: float = Field(ge=0, le=1)
    entry_price: float
    take_profit: float
    stop_loss: float
    risk_reward: float
    expected_value_percent: float
    estimated_fees_percent: float
    estimated_slippage_percent: float
    position_size_percent: float
    max_risk_percent_of_deposit: float
    reasons_for: list[str] = Field(default_factory=list)
    reasons_against: list[str] = Field(default_factory=list)
    validator_passed: bool
    risk_manager_passed: bool
    rejection_reason: str | None = None
    raw_features: dict[str, Any] = Field(default_factory=dict)
    created_by: str = "ai_brain_v1"


class MarketFeatures(BaseModel):
    asset_type: str
    symbol: str
    name: str | None = None
    price: float
    price_change_5m: float | None = None
    price_change_15m: float | None = None
    price_change_1h: float | None = None
    price_change_4h: float | None = None
    price_change_1d: float | None = None
    price_change_7d: float | None = None
    price_change_30d: float | None = None
    volume_change_1h: float | None = None
    volume_change_24h: float | None = None
    volatility_atr: float | None = None
    range_position: float | None = None
    spread_percent: float | None = None
    liquidity_score: float = Field(ge=0, le=1)
    rsi: float | None = None
    macd_signal: float | None = None
    ema_fast: float | None = None
    ema_slow: float | None = None
    ema_trend: str | None = None
    support_distance_percent: float | None = None
    resistance_distance_percent: float | None = None
    market_regime: MarketRegime = MarketRegime.UNKNOWN
    fear_greed_index: float | None = None
    news_sentiment: float | None = None
    funding_rate: float | None = None
    open_interest_change: float | None = None
    turnover_24h: float | None = None
    stale: bool = False
    data_quality_flags: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class AITradingConfig(BaseModel):
    ai_trading_enabled: bool = True
    ai_auto_execution_enabled: bool = False
    min_probability_tp_before_sl: float = 0.58
    min_risk_reward: float = 1.2
    min_expected_value_percent: float = 0.05
    max_spread_percent: float = 0.25
    min_liquidity_score: float = 0.45
    max_risk_per_trade_percent: float = 1.0
    max_daily_drawdown_percent: float = 3.0
    max_open_positions: int = 4
    dca_enabled: bool = False
    max_dca_count: int = 1
    dca_require_positive_ev: bool = True
    default_fee_percent: float = 0.20
    default_slippage_percent: float = 0.05
    counter_trend_probability_multiplier: float = 1.08
    high_volatility_position_size_multiplier: float = 0.55


class RiskContext(BaseModel):
    daily_drawdown_percent: float = 0
    open_positions_count: int = 0
    loss_streak: int = 0
    existing_position_risk_percent: float = 0


class DCAEvaluation(BaseModel):
    dca_allowed: bool
    dca_reason: str
    dca_new_average_price: float | None = None
    dca_total_risk_percent: float | None = None


class BacktestMetrics(BaseModel):
    total_return: float = 0
    winrate: float = 0
    average_win: float = 0
    average_loss: float = 0
    profit_factor: float = 0
    max_drawdown: float = 0
    expectancy_per_trade: float = 0
    number_of_trades: int = 0
    number_of_no_trade_decisions: int = 0
    long_pnl: float = 0
    short_pnl: float = 0
    pnl_by_market_regime: dict[str, float] = Field(default_factory=dict)
    pnl_by_asset: dict[str, float] = Field(default_factory=dict)
    dca_impact: float = 0


def clamp(value: float, minimum: float, maximum: float) -> float:
    if not math.isfinite(value):
        return minimum

    return max(minimum, min(maximum, value))


def to_number(value: Any, default: float = 0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default

    return number if math.isfinite(number) else default


def percent_change(current: float, previous: float) -> float:
    if previous <= 0:
        return 0

    return (current - previous) / previous * 100


def _extract_candles(asset: dict[str, Any]) -> list[dict[str, float]]:
    raw_chart = asset.get("chart") or asset.get("chart7d") or []
    candles: list[dict[str, float]] = []

    for point in raw_chart if isinstance(raw_chart, list) else []:
        if not isinstance(point, dict):
            continue

        close = to_number(point.get("close") or point.get("price"))
        if close <= 0:
            continue

        candles.append({
            "open": to_number(point.get("open"), close),
            "high": to_number(point.get("high"), close),
            "low": to_number(point.get("low"), close),
            "close": close,
            "volume": to_number(point.get("turnover") or point.get("volume")),
        })

    return candles


def _ema(values: list[float], period: int) -> float | None:
    if not values:
        return None

    multiplier = 2 / (period + 1)
    ema_value = values[0]

    for value in values[1:]:
        ema_value = value * multiplier + ema_value * (1 - multiplier)

    return ema_value


def _rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None

    gains: list[float] = []
    losses: list[float] = []

    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))

    avg_gain = mean(gains[-period:]) if gains[-period:] else 0
    avg_loss = mean(losses[-period:]) if losses[-period:] else 0

    if avg_loss == 0:
        return 100

    relative_strength = avg_gain / avg_loss
    return 100 - (100 / (1 + relative_strength))


def _atr_percent(candles: list[dict[str, float]], period: int = 14) -> float | None:
    if len(candles) < 2:
        return None

    true_ranges: list[float] = []

    for index in range(1, len(candles)):
        current = candles[index]
        previous_close = candles[index - 1]["close"]
        true_range = max(
            current["high"] - current["low"],
            abs(current["high"] - previous_close),
            abs(current["low"] - previous_close),
        )
        true_ranges.append(true_range)

    if not true_ranges:
        return None

    current_price = candles[-1]["close"]
    if current_price <= 0:
        return None

    return mean(true_ranges[-period:]) / current_price * 100


def _range_position(price: float, candles: list[dict[str, float]], lookback: int = 24) -> float | None:
    if not candles:
        return None

    recent = candles[-lookback:]
    high = max(point["high"] for point in recent)
    low = min(point["low"] for point in recent)

    if high <= low:
        return 0.5

    return clamp((price - low) / (high - low), 0, 1)


def _distance_to_level_percent(price: float, level: float, direction: str) -> float | None:
    if price <= 0 or level <= 0:
        return None

    if direction == "support":
        return max((price - level) / price * 100, 0)

    return max((level - price) / price * 100, 0)


def detect_market_regime(features: MarketFeatures) -> MarketRegime:
    change_1h = features.price_change_1h or 0
    change_4h = features.price_change_4h or 0
    change_1d = features.price_change_1d or 0
    atr = features.volatility_atr or 0
    rsi = features.rsi
    ema_trend = features.ema_trend
    range_position = features.range_position if features.range_position is not None else 0.5

    if features.news_sentiment is not None and abs(features.news_sentiment) >= 0.75:
        return MarketRegime.NEWS_DRIVEN

    if change_1d <= -8 and atr >= 4:
        return MarketRegime.PANIC

    if change_1d >= 10 and range_position >= 0.82 and (rsi or 0) >= 68:
        return MarketRegime.EUPHORIA

    if atr >= 5 or abs(change_1h) >= 3.5 or abs(change_4h) >= 8:
        return MarketRegime.HIGH_VOLATILITY

    if ema_trend == "bullish" and change_4h > 0 and change_1d > 0:
        return MarketRegime.BULL_TREND

    if ema_trend == "bearish" and change_4h < 0 and change_1d < 0:
        return MarketRegime.BEAR_TREND

    if atr <= 0.8 and abs(change_1d) <= 1.2:
        return MarketRegime.LOW_VOLATILITY

    return MarketRegime.RANGE


def build_market_features(asset: dict[str, Any]) -> MarketFeatures:
    candles = _extract_candles(asset)
    closes = [point["close"] for point in candles]
    price = to_number(asset.get("price")) or (closes[-1] if closes else 0)
    turnover_24h = to_number(asset.get("turnover24h") or asset.get("volume24h"))
    ema_fast = _ema(closes[-12:], 8) if closes else None
    ema_slow = _ema(closes[-30:], 21) if closes else None
    ema_trend = None

    if ema_fast and ema_slow:
        ema_trend = "bullish" if ema_fast > ema_slow else "bearish" if ema_fast < ema_slow else "flat"

    macd_fast = _ema(closes[-30:], 12) if closes else None
    macd_slow = _ema(closes[-30:], 26) if closes else None
    macd_signal = (macd_fast - macd_slow) / price * 100 if macd_fast and macd_slow and price > 0 else None
    atr = _atr_percent(candles)
    range_position = to_number(asset.get("rangePosition"), -1)
    if range_position < 0:
        range_position = _range_position(price, candles) if candles else 0.5

    spread_percent = abs(to_number(asset.get("bidAskSpreadPercent")))
    if spread_percent == 0:
        bid = to_number(asset.get("bidPrice") or asset.get("bid1Price"))
        ask = to_number(asset.get("askPrice") or asset.get("ask1Price"))
        spread_percent = ((ask - bid) / price * 100) if price > 0 and ask > 0 and bid > 0 else 0

    recent_volume = mean([point["volume"] for point in candles[-4:] if point["volume"] > 0]) if candles[-4:] else 0
    previous_volume = mean([point["volume"] for point in candles[-8:-4] if point["volume"] > 0]) if candles[-8:-4] else 0
    volume_change_1h = percent_change(candles[-1]["volume"], candles[-2]["volume"]) if len(candles) >= 2 else None
    volume_change_24h = percent_change(recent_volume, previous_volume) if previous_volume > 0 else None
    highs = [point["high"] for point in candles[-24:]]
    lows = [point["low"] for point in candles[-24:]]
    support = min(lows) if lows else 0
    resistance = max(highs) if highs else 0
    liquidity_score = clamp((math.log10(max(turnover_24h, 1)) - 4) / 5, 0, 1)
    data_quality_flags = list(asset.get("dataQualityFlags") or [])

    if price <= 0:
        data_quality_flags.append("missing_price")

    if turnover_24h <= 0:
        data_quality_flags.append("missing_turnover")

    if len(candles) < 6:
        data_quality_flags.append("short_intraday_history")

    features = MarketFeatures(
        asset_type=str(asset.get("assetType") or "crypto"),
        symbol=str(asset.get("symbol") or asset.get("baseCoin") or "").upper(),
        name=asset.get("name") or asset.get("shortName"),
        price=price,
        price_change_5m=None,
        price_change_15m=None,
        price_change_1h=to_number(asset.get("priceChangePercent1h"), percent_change(price, closes[-2]) if len(closes) >= 2 else 0),
        price_change_4h=to_number(asset.get("priceChangePercent4h"), percent_change(price, closes[-5]) if len(closes) >= 5 else 0),
        price_change_1d=to_number(asset.get("priceChangePercent24h")),
        price_change_7d=to_number(asset.get("priceChangePercent7d")),
        price_change_30d=to_number(asset.get("priceChangePercent30d")),
        volume_change_1h=volume_change_1h,
        volume_change_24h=volume_change_24h,
        volatility_atr=atr,
        range_position=range_position,
        spread_percent=spread_percent,
        liquidity_score=liquidity_score,
        rsi=_rsi(closes),
        macd_signal=macd_signal,
        ema_fast=ema_fast,
        ema_slow=ema_slow,
        ema_trend=ema_trend,
        support_distance_percent=_distance_to_level_percent(price, support, "support"),
        resistance_distance_percent=_distance_to_level_percent(price, resistance, "resistance"),
        market_regime=MarketRegime.UNKNOWN,
        fear_greed_index=asset.get("fearGreedIndex"),
        news_sentiment=asset.get("newsSentiment"),
        funding_rate=asset.get("fundingRate"),
        open_interest_change=asset.get("openInterestChange"),
        turnover_24h=turnover_24h,
        stale=bool(asset.get("stale")),
        data_quality_flags=data_quality_flags,
        raw={
            "asset": asset,
            "candlesCount": len(candles),
            "support": support,
            "resistance": resistance,
        },
    )
    features.market_regime = detect_market_regime(features)
    return features


def _direction_alignment(features: MarketFeatures, direction: StrategyType) -> bool:
    if direction == StrategyType.LONG:
        return features.market_regime in {MarketRegime.BULL_TREND, MarketRegime.EUPHORIA}

    if direction == StrategyType.SHORT:
        return features.market_regime in {MarketRegime.BEAR_TREND, MarketRegime.PANIC}

    return False


def _is_counter_trend(features: MarketFeatures, direction: StrategyType) -> bool:
    if direction == StrategyType.LONG:
        return features.market_regime in {MarketRegime.BEAR_TREND, MarketRegime.PANIC}

    if direction == StrategyType.SHORT:
        return features.market_regime in {MarketRegime.BULL_TREND, MarketRegime.EUPHORIA}

    return False


def calculate_technical_score(features: MarketFeatures, direction: StrategyType) -> float:
    change_1h = features.price_change_1h or 0
    change_4h = features.price_change_4h or 0
    change_1d = features.price_change_1d or 0
    volume_24h = features.volume_change_24h or 0
    macd = features.macd_signal or 0
    rsi = features.rsi
    range_position = features.range_position if features.range_position is not None else 0.5
    sign = 1 if direction == StrategyType.LONG else -1
    score = 0.5

    score += clamp(sign * change_1h / 8, -0.10, 0.10)
    score += clamp(sign * change_4h / 16, -0.13, 0.13)
    score += clamp(sign * change_1d / 28, -0.12, 0.12)
    score += clamp(volume_24h / 250, -0.04, 0.05)
    score += clamp(sign * macd / 6, -0.04, 0.04)

    if direction == StrategyType.LONG:
        if features.ema_trend == "bullish":
            score += 0.06
        elif features.ema_trend == "bearish":
            score -= 0.06

        if rsi is not None:
            if 42 <= rsi <= 68:
                score += 0.04
            elif rsi > 78:
                score -= 0.08
    else:
        if features.ema_trend == "bearish":
            score += 0.06
        elif features.ema_trend == "bullish":
            score -= 0.06

        if rsi is not None:
            if 32 <= rsi <= 58:
                score += 0.04
            elif rsi < 22:
                score -= 0.08

    if direction == StrategyType.LONG and 0.45 <= range_position <= 0.88:
        score += 0.03
    elif direction == StrategyType.SHORT and 0.12 <= range_position <= 0.55:
        score += 0.03

    return clamp(score, 0, 1)


def calculate_probability_tp_before_sl(
    features: MarketFeatures,
    direction: StrategyType,
    technical_score: float | None = None,
) -> float:
    score = technical_score if technical_score is not None else calculate_technical_score(features, direction)
    probability = 0.46 + (score - 0.5) * 0.72

    if _direction_alignment(features, direction):
        probability += 0.055

    if _is_counter_trend(features, direction):
        probability -= 0.065

    if features.liquidity_score >= 0.65:
        probability += 0.025
    elif features.liquidity_score < 0.35:
        probability -= 0.05

    spread = features.spread_percent or 0
    if spread > 0.2:
        probability -= min(spread / 100 * 12, 0.06)

    atr = features.volatility_atr or 0
    if features.market_regime == MarketRegime.HIGH_VOLATILITY:
        probability -= 0.035
    elif features.market_regime == MarketRegime.LOW_VOLATILITY:
        probability -= 0.015

    if atr > 8:
        probability -= 0.04

    if features.stale:
        probability -= 0.16

    return clamp(probability, 0.01, 0.99)


def calculate_trade_levels(features: MarketFeatures, direction: StrategyType) -> tuple[float, float, float]:
    price = max(features.price, 0)
    atr = features.volatility_atr if features.volatility_atr is not None else abs(features.price_change_1d or 1.2)
    stop_percent = clamp(max(atr * 0.85, 0.65), 0.55, 4.2)
    risk_reward = 1.35

    if features.market_regime in {MarketRegime.HIGH_VOLATILITY, MarketRegime.PANIC, MarketRegime.EUPHORIA}:
        stop_percent = clamp(stop_percent * 1.15, 0.75, 4.8)
        risk_reward = 1.45

    take_percent = stop_percent * risk_reward

    if direction == StrategyType.SHORT:
        take_profit = price * (1 - take_percent / 100)
        stop_loss = price * (1 + stop_percent / 100)
    else:
        take_profit = price * (1 + take_percent / 100)
        stop_loss = price * (1 - stop_percent / 100)

    return take_profit, stop_loss, risk_reward


def calculate_expected_value_percent(
    probability_tp_before_sl: float,
    entry_price: float,
    take_profit: float,
    stop_loss: float,
    direction: StrategyType,
    estimated_fees_percent: float,
    estimated_slippage_percent: float,
    spread_percent: float,
) -> float:
    if entry_price <= 0:
        return -999

    if direction == StrategyType.SHORT:
        avg_win = max((entry_price - take_profit) / entry_price * 100, 0)
        avg_loss = max((stop_loss - entry_price) / entry_price * 100, 0)
    else:
        avg_win = max((take_profit - entry_price) / entry_price * 100, 0)
        avg_loss = max((entry_price - stop_loss) / entry_price * 100, 0)

    costs = estimated_fees_percent + estimated_slippage_percent + max(spread_percent, 0)
    return probability_tp_before_sl * avg_win - (1 - probability_tp_before_sl) * avg_loss - costs


def _risk_score(features: MarketFeatures) -> float:
    atr = features.volatility_atr or abs(features.price_change_1d or 0)
    spread = features.spread_percent or 0
    return clamp(1 - atr / 12 - spread / 1.5, 0, 1)


def _volatility_score(features: MarketFeatures) -> float:
    atr = features.volatility_atr or abs(features.price_change_1d or 0)
    return clamp(1 - atr / 10, 0, 1)


def _position_size_percent(
    features: MarketFeatures,
    direction: StrategyType,
    probability: float,
    risk_reward: float,
    config: AITradingConfig,
    risk_context: RiskContext,
) -> float:
    base = 3 + max(probability - config.min_probability_tp_before_sl, 0) * 32 + max(risk_reward - 1.2, 0) * 3

    if features.market_regime == MarketRegime.HIGH_VOLATILITY:
        base *= config.high_volatility_position_size_multiplier

    if _is_counter_trend(features, direction):
        base *= 0.55

    if risk_context.loss_streak >= 2:
        base *= 0.65

    return round(clamp(base, 0, 12), 2)


def validate_trade_candidate(
    probability: float,
    expected_value_percent: float,
    risk_reward: float,
    features: MarketFeatures,
    direction: StrategyType,
    config: AITradingConfig,
) -> tuple[bool, str | None, list[str]]:
    reasons: list[str] = []
    min_probability = config.min_probability_tp_before_sl
    min_ev = config.min_expected_value_percent

    if _is_counter_trend(features, direction):
        min_probability *= config.counter_trend_probability_multiplier
        min_ev *= config.counter_trend_probability_multiplier

    if features.stale:
        reasons.append("рыночные данные устарели")

    if features.price <= 0:
        reasons.append("нет корректной цены")

    if probability < min_probability:
        reasons.append(f"вероятность TP раньше SL ниже порога {min_probability:.2f}")

    if expected_value_percent < min_ev:
        reasons.append(f"EV ниже порога {min_ev:.2f}%")

    if risk_reward < config.min_risk_reward:
        reasons.append(f"risk/reward ниже {config.min_risk_reward:.2f}")

    if (features.spread_percent or 0) > config.max_spread_percent:
        reasons.append(f"spread выше {config.max_spread_percent:.2f}%")

    if features.liquidity_score < config.min_liquidity_score:
        reasons.append("ликвидность ниже минимального порога")

    if MarketRegime.UNKNOWN == features.market_regime:
        reasons.append("режим рынка не определен")

    return not reasons, "; ".join(reasons) if reasons else None, reasons


def apply_risk_manager(
    decision: AITradeDecision,
    features: MarketFeatures,
    config: AITradingConfig,
    risk_context: RiskContext | None = None,
) -> RiskManagerResult:
    context = risk_context or RiskContext()
    warnings: list[str] = []
    position_size = decision.position_size_percent

    if not config.ai_trading_enabled:
        return RiskManagerResult(
            allowed=False,
            rejection_reason="AI trading выключен в конфигурации.",
            warnings=warnings,
        )

    if context.daily_drawdown_percent <= -abs(config.max_daily_drawdown_percent):
        return RiskManagerResult(
            allowed=False,
            rejection_reason="достигнут дневной лимит просадки",
            warnings=warnings,
        )

    if context.open_positions_count >= config.max_open_positions:
        return RiskManagerResult(
            allowed=False,
            rejection_reason="достигнут лимит открытых позиций",
            warnings=warnings,
        )

    if not decision.validator_passed:
        return RiskManagerResult(
            allowed=False,
            rejection_reason=decision.rejection_reason or "валидатор сделки не пройден",
            warnings=warnings,
        )

    if decision.expected_value_percent <= 0:
        return RiskManagerResult(
            allowed=False,
            rejection_reason="EV сделки отрицательный или нулевой",
            warnings=warnings,
        )

    if features.market_regime == MarketRegime.HIGH_VOLATILITY:
        position_size *= config.high_volatility_position_size_multiplier
        warnings.append("позиция уменьшена из-за высокой волатильности")

    if context.loss_streak >= 3:
        position_size *= 0.5
        warnings.append("позиция уменьшена после серии убыточных сделок")

    return RiskManagerResult(
        allowed=True,
        adjusted_position_size_percent=round(clamp(position_size, 0, 12), 2),
        warnings=warnings,
    )


def _build_reasons(features: MarketFeatures, direction: StrategyType, probability: float, ev: float) -> tuple[list[str], list[str]]:
    reasons_for: list[str] = []
    reasons_against: list[str] = []

    if _direction_alignment(features, direction):
        reasons_for.append("режим рынка совпадает с направлением сделки")
    elif _is_counter_trend(features, direction):
        reasons_against.append("сделка идет против текущего режима рынка")

    if features.ema_trend:
        if (direction == StrategyType.LONG and features.ema_trend == "bullish") or (
            direction == StrategyType.SHORT and features.ema_trend == "bearish"
        ):
            reasons_for.append("EMA fast/slow подтверждают направление")
        else:
            reasons_against.append("EMA trend не подтверждает направление")

    if features.liquidity_score >= 0.65:
        reasons_for.append("ликвидность достаточная для paper-входа")
    elif features.liquidity_score < 0.45:
        reasons_against.append("ликвидность слабая")

    if (features.spread_percent or 0) <= 0.15:
        reasons_for.append("spread находится в допустимом диапазоне")
    else:
        reasons_against.append("spread ухудшает матожидание")

    if probability >= 0.6:
        reasons_for.append("вероятность TP раньше SL выше базового порога")

    if ev > 0:
        reasons_for.append("expected value после комиссий положительный")
    else:
        reasons_against.append("expected value после комиссий неположительный")

    if features.market_regime in {MarketRegime.HIGH_VOLATILITY, MarketRegime.PANIC, MarketRegime.EUPHORIA}:
        reasons_against.append("волатильный режим требует меньшей позиции")

    if features.data_quality_flags:
        reasons_against.append(f"ограничения качества данных: {', '.join(features.data_quality_flags[:4])}")

    return reasons_for, reasons_against


def _build_direction_decision(
    features: MarketFeatures,
    direction: StrategyType,
    config: AITradingConfig,
    risk_context: RiskContext,
) -> AITradeDecision:
    technical_score = calculate_technical_score(features, direction)
    probability = calculate_probability_tp_before_sl(features, direction, technical_score)
    take_profit, stop_loss, risk_reward = calculate_trade_levels(features, direction)
    estimated_fees = config.default_fee_percent
    estimated_slippage = config.default_slippage_percent
    spread = features.spread_percent or 0
    ev = calculate_expected_value_percent(
        probability,
        features.price,
        take_profit,
        stop_loss,
        direction,
        estimated_fees,
        estimated_slippage,
        spread,
    )
    validator_passed, rejection_reason, validation_reasons = validate_trade_candidate(
        probability,
        ev,
        risk_reward,
        features,
        direction,
        config,
    )
    final_action = FinalAction.OPEN_LONG if direction == StrategyType.LONG else FinalAction.OPEN_SHORT
    reasons_for, reasons_against = _build_reasons(features, direction, probability, ev)
    reasons_against.extend(reason for reason in validation_reasons if reason not in reasons_against)
    position_size = _position_size_percent(features, direction, probability, risk_reward, config, risk_context)
    risk_score = _risk_score(features)
    confidence = clamp(
        0.42
        + abs(probability - 0.5) * 0.55
        + features.liquidity_score * 0.15
        + risk_score * 0.12
        - len(features.data_quality_flags) * 0.04,
        0,
        1,
    )

    decision = AITradeDecision(
        asset=features.name or features.symbol,
        symbol=features.symbol,
        strategy_type=direction,
        final_action=final_action if validator_passed else FinalAction.NO_TRADE,
        confidence=round(confidence, 4),
        probability_tp_before_sl=round(probability, 4),
        probability_long_success=round(probability, 4) if direction == StrategyType.LONG else None,
        probability_short_success=round(probability, 4) if direction == StrategyType.SHORT else None,
        market_regime=features.market_regime,
        technical_score=round(technical_score, 4),
        news_score=features.news_sentiment,
        sentiment_score=features.news_sentiment,
        risk_score=round(risk_score, 4),
        liquidity_score=round(features.liquidity_score, 4),
        volatility_score=round(_volatility_score(features), 4),
        entry_price=round(features.price, 10),
        take_profit=round(take_profit, 10),
        stop_loss=round(stop_loss, 10),
        risk_reward=round(risk_reward, 4),
        expected_value_percent=round(ev, 4),
        estimated_fees_percent=round(estimated_fees, 4),
        estimated_slippage_percent=round(estimated_slippage, 4),
        position_size_percent=position_size,
        max_risk_percent_of_deposit=config.max_risk_per_trade_percent,
        reasons_for=reasons_for,
        reasons_against=reasons_against,
        validator_passed=validator_passed,
        risk_manager_passed=False,
        rejection_reason=rejection_reason,
        raw_features=features.model_dump(mode="json"),
    )
    risk_result = apply_risk_manager(decision, features, config, risk_context)

    return decision.model_copy(update={
        "risk_manager_passed": risk_result.allowed,
        "position_size_percent": risk_result.adjusted_position_size_percent if risk_result.allowed else 0,
        "final_action": final_action if risk_result.allowed else FinalAction.NO_TRADE,
        "rejection_reason": risk_result.rejection_reason or decision.rejection_reason,
        "reasons_against": [
            *decision.reasons_against,
            *[warning for warning in risk_result.warnings if warning not in decision.reasons_against],
        ],
    })


def build_no_trade_decision(
    features: MarketFeatures,
    config: AITradingConfig,
    reason: str,
    long_probability: float | None = None,
    short_probability: float | None = None,
) -> AITradeDecision:
    return AITradeDecision(
        asset=features.name or features.symbol,
        symbol=features.symbol,
        strategy_type=StrategyType.NO_TRADE,
        final_action=FinalAction.NO_TRADE,
        confidence=0.55,
        probability_tp_before_sl=0.01,
        probability_long_success=long_probability,
        probability_short_success=short_probability,
        market_regime=features.market_regime,
        technical_score=0,
        news_score=features.news_sentiment,
        sentiment_score=features.news_sentiment,
        risk_score=round(_risk_score(features), 4),
        liquidity_score=round(features.liquidity_score, 4),
        volatility_score=round(_volatility_score(features), 4),
        entry_price=round(features.price, 10),
        take_profit=0,
        stop_loss=0,
        risk_reward=0,
        expected_value_percent=0,
        estimated_fees_percent=config.default_fee_percent,
        estimated_slippage_percent=config.default_slippage_percent,
        position_size_percent=0,
        max_risk_percent_of_deposit=config.max_risk_per_trade_percent,
        reasons_for=[],
        reasons_against=[reason],
        validator_passed=False,
        risk_manager_passed=False,
        rejection_reason=reason,
        raw_features=features.model_dump(mode="json"),
    )


def select_strategy_decision(
    features: MarketFeatures,
    config: AITradingConfig | None = None,
    preferred_strategy: StrategyType | None = None,
    risk_context: RiskContext | None = None,
) -> AITradeDecision:
    resolved_config = config or AITradingConfig()
    context = risk_context or RiskContext()

    if not resolved_config.ai_trading_enabled:
        return build_no_trade_decision(features, resolved_config, "AI trading disabled")

    if preferred_strategy == StrategyType.NO_TRADE:
        return build_no_trade_decision(features, resolved_config, "strategy explicitly requested NO_TRADE")

    if preferred_strategy == StrategyType.LONG:
        return _build_direction_decision(features, StrategyType.LONG, resolved_config, context)

    if preferred_strategy == StrategyType.SHORT:
        return _build_direction_decision(features, StrategyType.SHORT, resolved_config, context)

    long_decision = _build_direction_decision(features, StrategyType.LONG, resolved_config, context)
    short_decision = _build_direction_decision(features, StrategyType.SHORT, resolved_config, context)
    long_probability = long_decision.probability_tp_before_sl
    short_probability = short_decision.probability_tp_before_sl
    candidates = [
        decision for decision in [long_decision, short_decision]
        if decision.validator_passed and decision.risk_manager_passed and decision.expected_value_percent > 0
    ]

    if not candidates:
        best = max([long_decision, short_decision], key=lambda item: item.expected_value_percent)
        reason = best.rejection_reason or "ни LONG, ни SHORT не прошли EV/Risk фильтры"
        return build_no_trade_decision(features, resolved_config, reason, long_probability, short_probability)

    selected = max(candidates, key=lambda item: (item.expected_value_percent, item.probability_tp_before_sl))

    return selected.model_copy(update={
        "strategy_type": StrategyType.LONG_SHORT if preferred_strategy == StrategyType.LONG_SHORT else selected.strategy_type,
        "probability_long_success": long_probability,
        "probability_short_success": short_probability,
    })


def evaluate_dca(
    current_decision: AITradeDecision,
    new_features: MarketFeatures,
    current_average_price: float,
    current_risk_percent: float,
    scale_in_count: int,
    config: AITradingConfig | None = None,
) -> DCAEvaluation:
    resolved_config = config or AITradingConfig()
    if not resolved_config.dca_enabled:
        return DCAEvaluation(dca_allowed=False, dca_reason="DCA выключен в конфигурации")

    if scale_in_count >= resolved_config.max_dca_count:
        return DCAEvaluation(dca_allowed=False, dca_reason="достигнут лимит DCA")

    if current_decision.strategy_type not in {StrategyType.LONG, StrategyType.SHORT, StrategyType.LONG_SHORT}:
        return DCAEvaluation(dca_allowed=False, dca_reason="нет активной торговой идеи для DCA")

    direction = StrategyType.SHORT if current_decision.final_action == FinalAction.OPEN_SHORT else StrategyType.LONG
    refreshed_decision = select_strategy_decision(new_features, resolved_config, direction)
    total_risk = current_risk_percent + resolved_config.max_risk_per_trade_percent * 0.5

    if resolved_config.dca_require_positive_ev and refreshed_decision.expected_value_percent <= 0:
        return DCAEvaluation(dca_allowed=False, dca_reason="EV после докупки неположительный")

    if not refreshed_decision.risk_manager_passed:
        return DCAEvaluation(
            dca_allowed=False,
            dca_reason=refreshed_decision.rejection_reason or "Risk Manager запретил DCA",
        )

    if total_risk > resolved_config.max_risk_per_trade_percent * 1.5:
        return DCAEvaluation(dca_allowed=False, dca_reason="общий риск позиции превышает лимит")

    new_average = (current_average_price + new_features.price) / 2 if current_average_price > 0 else new_features.price
    return DCAEvaluation(
        dca_allowed=True,
        dca_reason="торговая идея сохранена, EV положительный, риск в лимите",
        dca_new_average_price=round(new_average, 10),
        dca_total_risk_percent=round(total_risk, 4),
    )


def run_backtest(
    candles: list[dict[str, Any]],
    asset_template: dict[str, Any] | None = None,
    config: AITradingConfig | None = None,
) -> BacktestMetrics:
    resolved_config = config or AITradingConfig()
    trades: list[float] = []
    no_trades = 0
    equity = 100.0
    peak = equity
    max_drawdown = 0.0
    long_pnl = 0.0
    short_pnl = 0.0
    pnl_by_regime: dict[str, float] = defaultdict(float)
    pnl_by_asset: dict[str, float] = defaultdict(float)
    template = asset_template or {}
    symbol = str(template.get("symbol") or "BACKTEST")

    for index in range(30, max(len(candles) - 8, 30)):
        window = candles[:index]
        current = window[-1]
        asset = {
            **template,
            "symbol": symbol,
            "price": to_number(current.get("close") or current.get("price")),
            "chart7d": window[-60:],
            "turnover24h": to_number(template.get("turnover24h"), 1_000_000),
        }
        features = build_market_features(asset)
        decision = select_strategy_decision(features, resolved_config, StrategyType.LONG_SHORT)

        if not decision.risk_manager_passed or decision.final_action == FinalAction.NO_TRADE:
            no_trades += 1
            continue

        future = candles[index:index + 8]
        exit_percent = 0.0
        for point in future:
            high = to_number(point.get("high") or point.get("close"))
            low = to_number(point.get("low") or point.get("close"))
            if decision.final_action == FinalAction.OPEN_LONG:
                if low <= decision.stop_loss:
                    exit_percent = -abs((decision.entry_price - decision.stop_loss) / decision.entry_price * 100)
                    break
                if high >= decision.take_profit:
                    exit_percent = abs((decision.take_profit - decision.entry_price) / decision.entry_price * 100)
                    break
            elif decision.final_action == FinalAction.OPEN_SHORT:
                if high >= decision.stop_loss:
                    exit_percent = -abs((decision.stop_loss - decision.entry_price) / decision.entry_price * 100)
                    break
                if low <= decision.take_profit:
                    exit_percent = abs((decision.entry_price - decision.take_profit) / decision.entry_price * 100)
                    break

        if exit_percent == 0 and future:
            final_price = to_number(future[-1].get("close") or future[-1].get("price"))
            if decision.final_action == FinalAction.OPEN_SHORT:
                exit_percent = (decision.entry_price - final_price) / decision.entry_price * 100
            else:
                exit_percent = (final_price - decision.entry_price) / decision.entry_price * 100

        exit_percent -= decision.estimated_fees_percent + decision.estimated_slippage_percent
        trades.append(exit_percent)
        equity *= 1 + (exit_percent * decision.position_size_percent / 10000)
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, (equity - peak) / peak * 100 if peak else 0)
        pnl_by_regime[decision.market_regime.value] += exit_percent
        pnl_by_asset[symbol] += exit_percent
        if decision.final_action == FinalAction.OPEN_SHORT:
            short_pnl += exit_percent
        else:
            long_pnl += exit_percent

    wins = [item for item in trades if item > 0]
    losses = [item for item in trades if item < 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    return BacktestMetrics(
        total_return=round(equity - 100, 4),
        winrate=round(len(wins) / len(trades) * 100, 4) if trades else 0,
        average_win=round(mean(wins), 4) if wins else 0,
        average_loss=round(mean(losses), 4) if losses else 0,
        profit_factor=round(gross_win / gross_loss, 4) if gross_loss else (round(gross_win, 4) if gross_win else 0),
        max_drawdown=round(max_drawdown, 4),
        expectancy_per_trade=round(mean(trades), 4) if trades else 0,
        number_of_trades=len(trades),
        number_of_no_trade_decisions=no_trades,
        long_pnl=round(long_pnl, 4),
        short_pnl=round(short_pnl, 4),
        pnl_by_market_regime={key: round(value, 4) for key, value in pnl_by_regime.items()},
        pnl_by_asset={key: round(value, 4) for key, value in pnl_by_asset.items()},
        dca_impact=0,
    )
