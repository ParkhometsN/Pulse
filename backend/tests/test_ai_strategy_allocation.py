from __future__ import annotations

import unittest

from src.ai_router import (
    _allocate_strategy_entries,
    _build_strategy_recovery_state,
    _build_trade_exit_plan,
    _calibration_probability_adjustment,
    _enrich_strategy_candidate_with_context,
    _entry_quality_rejection_reason,
    _merge_external_signal_with_rating,
    _memory_blocks_entry,
    _memory_score_adjustment,
    _strategy_config,
    _strategy_type_for_strategy_id,
)
from src.ai_trading_brain import StrategyType


def make_entry(
    symbol: str,
    probability: float = 72,
    expected_value: float = 0.32,
    risk_reward: float = 1.45,
    liquidity: float = 0.8,
):
    return (
        probability,
        "Long",
        {
            "symbol": symbol,
            "turnover24h": 8_000_000,
            "priceChangePercent1h": 1.2,
            "bidAskSpreadPercent": 0.04,
        },
        {
            "strategyLeg": "scalp",
            "aiDecision": {
                "expected_value_percent": expected_value,
                "risk_reward": risk_reward,
                "liquidity_score": liquidity,
                "position_size_percent": 15,
            },
            "factors": {
                "price_change_1h": 1.2,
                "volume_change_24h": 35,
                "volatility_atr": 2.2,
                "spread_percent": 0.04,
            },
        },
    )


class AIStrategyAllocationTest(unittest.TestCase):
    def test_balanced_profile_keeps_cash_buffer_without_overallocating(self):
        entries = [make_entry(f"TEST{i}USDT") for i in range(5)]
        allocations = _allocate_strategy_entries(entries, 100_000, "balanced")

        self.assertEqual(len(allocations), 5)
        self.assertGreaterEqual(sum(allocations), 57_000)
        self.assertLessEqual(sum(allocations), 58_500)
        self.assertTrue(all(value <= 16_000 for value in allocations))

    def test_active_profile_uses_capital_but_keeps_risk_buffer(self):
        entries = [make_entry(f"TEST{i}USDT", probability=78) for i in range(6)]
        allocations = _allocate_strategy_entries(entries, 100_000, "active")

        self.assertGreaterEqual(sum(allocations), 95_000)
        self.assertLessEqual(sum(allocations), 96_500)
        self.assertTrue(all(value <= 22_000 for value in allocations))

    def test_short_card_is_short_term_scalp_not_bearish_only(self):
        self.assertEqual(_strategy_config("ai-short")["mode"], "scalp")
        self.assertEqual(_strategy_type_for_strategy_id("ai-short"), StrategyType.LONG)

    def test_recovery_state_reduces_effective_boldness_after_losses(self):
        trades = [
            {
                "status": "closed",
                "resultAmount": -120,
                "closedAt": f"2026-06-04T10:0{index}:00+03:00",
            }
            for index in range(3)
        ]
        state = _build_strategy_recovery_state(
            trades,
            100_000,
            -2_500,
            {
                "boldness": 90,
                "max_open_positions": 6,
            },
        )

        self.assertEqual(state["state"], "regroup")
        self.assertLess(state["effectiveBoldness"], state["baseBoldness"])
        self.assertLessEqual(state["maxOpenPositions"], 4)

    def test_strategy_memory_adjusts_and_blocks_repeated_bad_patterns(self):
        good_memory = {
            "memoryScore": 12,
            "tradesCount": 6,
            "winsCount": 5,
            "lossesCount": 1,
        }
        bad_memory = {
            "memoryScore": -12,
            "tradesCount": 5,
            "winsCount": 1,
            "lossesCount": 4,
        }

        self.assertGreater(_memory_score_adjustment(good_memory), 0)
        self.assertLess(_memory_score_adjustment(bad_memory), 0)
        self.assertTrue(_memory_blocks_entry(bad_memory, 70))
        self.assertFalse(_memory_blocks_entry(bad_memory, 84))

    def test_probability_calibration_penalizes_bad_realized_history(self):
        bad_memory = {
            "tradesCount": 8,
            "winsCount": 2,
            "lossesCount": 6,
            "netResultAmount": -900,
            "avgResultPercent": -0.7,
        }

        self.assertLess(_calibration_probability_adjustment(bad_memory, 72), 0)

    def test_external_signal_merges_into_technical_rating(self):
        merged = _merge_external_signal_with_rating(
            {"score": 0.1, "signal": "neutral"},
            {"direction": "LONG", "strength": 0.9},
        )

        self.assertGreater(merged["score"], 0.1)
        self.assertEqual(merged["externalSignal"]["direction"], "LONG")

    def test_trade_exit_plan_contains_tp_sl_trailing_and_time_stop(self):
        plan = _build_trade_exit_plan(
            "Long",
            "scalp",
            100,
            {
                "take_profit": 101.4,
                "stop_loss": 98.9,
                "expected_value_percent": 0.42,
                "risk_reward": 1.35,
            },
        )

        self.assertEqual(plan["policy"], "tp_sl_trailing_time_stop")
        self.assertEqual(plan["takeProfit"], 101.4)
        self.assertEqual(plan["stopLoss"], 98.9)
        self.assertGreater(plan["trailingActivationPercent"], 0)

    def test_strategy_quality_gate_blocks_weak_edge(self):
        reason = _entry_quality_rejection_reason(
            "scalp",
            "Long",
            {
                "symbol": "WEAKUSDT",
                "turnover24h": 2_000_000,
                "bidAskSpreadPercent": 0.22,
                "priceChangePercent1h": -0.1,
                "priceChangePercent4h": -0.4,
            },
            {
                "aiDecision": {
                    "expected_value_percent": 0.08,
                    "risk_reward": 1.2,
                    "liquidity_score": 0.4,
                },
                "factors": {
                    "price_change_1h": -0.1,
                    "price_change_4h": -0.4,
                    "volume_change_24h": -25,
                    "volatility_atr": 5,
                    "spread_percent": 0.22,
                },
            },
            64,
        )

        self.assertIsNotNone(reason)

    def test_strategy_quality_gate_blocks_late_overheated_scalp_entry(self):
        reason = _entry_quality_rejection_reason(
            "scalp",
            "Long",
            {
                "symbol": "HOTUSDT",
                "turnover24h": 8_000_000,
                "bidAskSpreadPercent": 0.04,
                "priceChangePercent1h": 3.8,
                "priceChangePercent4h": 6.0,
                "priceChangePercent24h": 13.0,
                "rangePosition": 0.91,
                "volumeTrendRatio": 1.3,
            },
            {
                "aiDecision": {
                    "expected_value_percent": 0.6,
                    "risk_reward": 1.5,
                    "liquidity_score": 0.8,
                },
                "factors": {
                    "price_change_1h": 3.8,
                    "price_change_4h": 6.0,
                    "price_change_1d": 13.0,
                    "volume_trend_ratio": 1.3,
                    "volatility_atr": 4.0,
                    "spread_percent": 0.04,
                    "range_position": 0.91,
                },
            },
            82,
        )

        self.assertEqual(reason, "актив слишком близко к верхней границе диапазона")

    def test_market_context_enriches_strategy_candidate(self):
        enriched = _enrich_strategy_candidate_with_context(
            {
                "assetType": "crypto",
                "symbol": "BTCUSDT",
                "price": 100,
                "priceChangePercent1h": 1.2,
                "priceChangePercent4h": 2.4,
                "priceChangePercent24h": 4.8,
                "turnover24h": 10_000_000,
                "bidAskSpreadPercent": 0.03,
                "volumeTrendRatio": 1.3,
                "chart7d": [
                    {"close": 90 + index, "volume": 1000 + index}
                    for index in range(24)
                ],
            },
            {
                "fearGreedIndex": 68,
                "fearGreedSentiment": 0.36,
                "assetSentiment": {"BTC": 0.6, "BTCUSDT": 0.6},
                "assetNewsCounts": {"BTC": 2, "BTCUSDT": 2},
                "categorySentiment": {"crypto": 0.2, "markets": 0.1},
                "sourceManifest": ["pulse_news_feed", "fear_greed_index"],
            },
        )

        self.assertGreater(enriched["newsSentiment"], 0)
        self.assertEqual(enriched["assetNewsCount"], 4)
        self.assertIn("tradingViewTechnicalScore", enriched)
        self.assertIn("pulse_news_feed", enriched["sourceManifest"])


if __name__ == "__main__":
    unittest.main()
