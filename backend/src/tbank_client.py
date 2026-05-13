from __future__ import annotations

import asyncio
import ssl
from decimal import Decimal
from typing import Any

import certifi
from aiohttp import ClientError, ClientSession, ClientTimeout, TCPConnector


class TBankAPIError(Exception):
    """Raised when T-Invest API is unavailable or returns an error."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TBankInvestClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.api_prefix = "/rest/tinkoff.public.invest.api.contract.v1."
        self._session: ClientSession | None = None

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            self._session = ClientSession(
                base_url=self.base_url,
                connector=TCPConnector(ssl=ssl_context),
                timeout=ClientTimeout(total=8, connect=3, sock_read=6),
            )

        return self._session

    async def _post(self, method: str, token: str, payload: dict[str, Any] | None = None):
        session = await self._get_session()
        endpoint = f"{self.api_prefix}{method.lstrip('/')}"
        normalized_token = normalize_tbank_token(token)
        headers = {
            "Authorization": f"Bearer {normalized_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        for attempt in range(2):
            try:
                async with session.post(endpoint, json=payload or {}, headers=headers) as response:
                    result = await response.json(content_type=None)

                    if response.status >= 400:
                        detail = result.get("message") or result.get("error") or result
                        raise TBankAPIError(
                            f"T-Bank API error: {response.status}, {detail}",
                            response.status,
                        )

                    return result
            except (asyncio.TimeoutError, ClientError) as error:
                if attempt == 1:
                    raise TBankAPIError("T-Bank provider unavailable") from error

                await asyncio.sleep(0.25)

        raise TBankAPIError("T-Bank request failed")

    async def get_accounts(self, token: str):
        return await self._post(
            "UsersService/GetAccounts",
            token,
            {"status": "ACCOUNT_STATUS_OPEN"},
        )

    async def get_portfolio(self, token: str, account_id: str, currency: str = "RUB"):
        return await self._post(
            "OperationsService/GetPortfolio",
            token,
            {
                "accountId": account_id,
                "currency": currency,
            },
        )

    async def get_instrument_by_figi(self, token: str, figi: str):
        return await self._post(
            "InstrumentsService/GetInstrumentBy",
            token,
            {
                "idType": "INSTRUMENT_ID_TYPE_FIGI",
                "id": figi,
            },
        )

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


def proto_decimal(value: Any) -> Decimal:
    if not isinstance(value, dict):
        return Decimal("0")

    units = value.get("units", 0)
    nano = value.get("nano", 0)

    try:
        return Decimal(str(units)) + Decimal(str(nano)) / Decimal("1000000000")
    except Exception:
        return Decimal("0")


def proto_number(value: Any) -> float:
    return float(proto_decimal(value))


def normalize_tbank_token(token: str) -> str:
    normalized = token.strip()

    if normalized.lower().startswith("bearer "):
        return normalized.split(" ", 1)[1].strip()

    return normalized
