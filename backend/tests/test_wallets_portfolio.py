from __future__ import annotations

from decimal import Decimal
import unittest

from src.wallets_router import (
    _merge_wallet_assets_by_identity,
    _yield_percent_from_change,
)


class WalletPortfolioTest(unittest.TestCase):
    def test_tbank_expected_yield_percent_uses_money_value(self):
        percent = _yield_percent_from_change(Decimal("60.92"), Decimal("3.24"))

        self.assertEqual(round(float(percent), 2), 5.62)

    def test_merge_tbank_cash_and_money_position_deduplicates_usd_asset(self):
        merged_assets = _merge_wallet_assets_by_identity([
            {
                "figi": None,
                "symbol": "USD",
                "shortName": "USD",
                "name": "Доллар США",
                "type": "currency",
                "provider": "tbank",
                "quantity": 0.82,
                "availableQuantity": 0.82,
                "valueRub": 60.92,
                "changeRub": 0,
            },
            {
                "figi": "USD000UTSTOM",
                "symbol": "USD000UTSTOM",
                "shortName": "USD000UTSTOM",
                "name": "USD000UTSTOM",
                "type": "currency",
                "provider": "tbank",
                "quantity": 0.82,
                "availableQuantity": 0,
                "valueRub": 60.37,
                "changeRub": 3.24,
            },
        ])

        self.assertEqual(len(merged_assets), 1)
        self.assertEqual(merged_assets[0]["symbol"], "USD")
        self.assertEqual(merged_assets[0]["shortName"], "USD")
        self.assertAlmostEqual(merged_assets[0]["quantity"], 0.82)
        self.assertAlmostEqual(merged_assets[0]["valueRub"], 60.92)
        self.assertAlmostEqual(merged_assets[0]["changeRub"], 3.24)
        self.assertAlmostEqual(merged_assets[0]["changePercent"], 5.62)


if __name__ == "__main__":
    unittest.main()
