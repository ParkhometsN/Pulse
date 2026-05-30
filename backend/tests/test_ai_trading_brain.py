from __future__ import annotations

import unittest

from src.ai_trading_brain import (
    AITradingConfig,
    MarketRegime,
    RiskContext,
    StrategyType,
    build_market_features,
    calculate_expected_value_percent,
    calculate_probability_tp_before_sl,
    evaluate_dca,
    select_strategy_decision,
)


def sample_asset(direction: str = "up", spread: float = 0.04, turnover: float = 5_000_000):
    price = 100.0
    candles = []
    for index in range(48):
        drift = index * (0.18 if direction == "up" else -0.18)
        close = price + drift
        candles.append({
            "open": close - 0.08,
            "high": close + 0.25,
            "low": close - 0.25,
            "close": close,
            "turnover": 100_000 + index * 1_000,
        })

    return {
        "assetType": "crypto",
        "symbol": "TESTUSDT",
        "name": "TEST",
        "price": candles[-1]["close"],
        "priceChangePercent24h": 5.2 if direction == "up" else -5.2,
        "priceChangePercent7d": 8.0 if direction == "up" else -8.0,
        "priceChangePercent30d": 12.0 if direction == "up" else -12.0,
        "turnover24h": turnover,
        "bidAskSpreadPercent": spread,
        "chart7d": candles,
    }


class AITradingBrainTest(unittest.TestCase):
    def test_ev_positive_and_negative_with_costs(self):
        positive = calculate_expected_value_percent(0.65, 100, 102, 99, StrategyType.LONG, 0.2, 0.05, 0.04)
        negative = calculate_expected_value_percent(0.35, 100, 102, 99, StrategyType.LONG, 0.2, 0.05, 0.04)

        self.assertGreater(positive, 0)
        self.assertLess(negative, 0)

    def test_probability_range_and_liquidity_penalty(self):
        good_features = build_market_features(sample_asset(turnover=5_000_000))
        weak_features = build_market_features(sample_asset(turnover=10_000))
        good_probability = calculate_probability_tp_before_sl(good_features, StrategyType.LONG)
        weak_probability = calculate_probability_tp_before_sl(weak_features, StrategyType.LONG)

        self.assertGreaterEqual(good_probability, 0.01)
        self.assertLessEqual(good_probability, 0.99)
        self.assertLess(weak_probability, good_probability)

    def test_market_regime_affects_probability(self):
        bull_features = build_market_features(sample_asset("up"))
        bear_features = build_market_features(sample_asset("down"))
        long_bull = calculate_probability_tp_before_sl(bull_features, StrategyType.LONG)
        long_bear = calculate_probability_tp_before_sl(bear_features, StrategyType.LONG)

        self.assertGreater(long_bull, long_bear)

    def test_risk_manager_blocks_bad_spread(self):
        features = build_market_features(sample_asset(spread=1.2))
        decision = select_strategy_decision(features, AITradingConfig(), StrategyType.LONG)

        self.assertFalse(decision.risk_manager_passed)
        self.assertIn("spread", decision.rejection_reason or "")

    def test_high_volatility_reduces_position_size(self):
        asset = sample_asset("up")
        for point in asset["chart7d"][-8:]:
            point["high"] *= 1.08
            point["low"] *= 0.92

        features = build_market_features(asset)
        decision = select_strategy_decision(features, AITradingConfig(), StrategyType.LONG)

        self.assertLessEqual(decision.position_size_percent, 7)

    def test_strategy_selector_long_short_no_trade(self):
        long_decision = select_strategy_decision(build_market_features(sample_asset("up")), AITradingConfig(), StrategyType.LONG_SHORT)
        short_decision = select_strategy_decision(build_market_features(sample_asset("down")), AITradingConfig(), StrategyType.LONG_SHORT)
        no_trade_features = build_market_features(sample_asset("up", spread=2.0, turnover=1_000))
        no_trade = select_strategy_decision(no_trade_features, AITradingConfig(), StrategyType.LONG_SHORT)

        self.assertIn(long_decision.final_action.value, {"OPEN_LONG", "NO_TRADE"})
        self.assertIn(short_decision.final_action.value, {"OPEN_SHORT", "NO_TRADE"})
        self.assertEqual(no_trade.final_action.value, "NO_TRADE")

    def test_dca_requires_positive_ev_and_limits(self):
        features = build_market_features(sample_asset("up"))
        decision = select_strategy_decision(features, AITradingConfig(dca_enabled=True), StrategyType.LONG)
        bad_features = build_market_features(sample_asset("down"))
        blocked = evaluate_dca(decision, bad_features, 100, 1.0, 0, AITradingConfig(dca_enabled=True))
        limit_blocked = evaluate_dca(decision, features, 100, 1.0, 1, AITradingConfig(dca_enabled=True, max_dca_count=1))

        self.assertFalse(blocked.dca_allowed)
        self.assertFalse(limit_blocked.dca_allowed)

    def test_loss_streak_reduces_or_blocks_position(self):
        features = build_market_features(sample_asset("up"))
        normal = select_strategy_decision(features, AITradingConfig(), StrategyType.LONG)
        reduced = select_strategy_decision(
            features,
            AITradingConfig(),
            StrategyType.LONG,
            RiskContext(loss_streak=3),
        )

        self.assertLessEqual(reduced.position_size_percent, normal.position_size_percent)


if __name__ == "__main__":
    unittest.main()
