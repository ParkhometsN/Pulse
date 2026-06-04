from __future__ import annotations

import unittest

from src.ai_router import (
    _allocate_strategy_entries,
    _build_strategy_recovery_state,
    _enrich_strategy_candidate_with_context,
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
    def test_balanced_profile_deploys_most_capital_without_overallocating(self):
        entries = [make_entry(f"TEST{i}USDT") for i in range(5)]
        allocations = _allocate_strategy_entries(entries, 100_000, "balanced")

        self.assertEqual(len(allocations), 5)
        self.assertGreaterEqual(sum(allocations), 88_000)
        self.assertLessEqual(sum(allocations), 90_000)
        self.assertTrue(all(value <= 24_000 for value in allocations))

    def test_active_profile_can_use_almost_all_capital(self):
        entries = [make_entry(f"TEST{i}USDT", probability=78) for i in range(6)]
        allocations = _allocate_strategy_entries(entries, 100_000, "active")

        self.assertGreaterEqual(sum(allocations), 96_000)
        self.assertLessEqual(sum(allocations), 98_000)
        self.assertTrue(all(value <= 32_000 for value in allocations))

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
        self.assertLessEqual(state["maxOpenPositions"], 3)

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
