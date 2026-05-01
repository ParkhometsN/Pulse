import asyncio

from aiohttp import ClientError, ClientSession, ClientTimeout


class UpstreamHTTPError(Exception):
    pass


class BybitHTTPClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._session: ClientSession | None = None

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession(
                base_url=self.base_url,
                timeout=ClientTimeout(total=25, connect=8, sock_read=20)
            )

        return self._session

    async def _get(self, endpoint: str, params: dict | None = None):
        session = await self._get_session()

        for attempt in range(2):
            try:
                async with session.get(endpoint, params=params) as response:
                    result = await response.json(content_type=None)

                    if response.status != 200:
                        raise UpstreamHTTPError(
                            f"Bybit HTTP error: {response.status}, {result}"
                        )

                    if result.get("retCode") != 0:
                        raise UpstreamHTTPError(f"Bybit API error: {result}")

                    return result["result"]
            except (asyncio.TimeoutError, ClientError) as error:
                if attempt == 1:
                    raise UpstreamHTTPError("Bybit request timed out") from error

                await asyncio.sleep(0.4)

        raise UpstreamHTTPError("Bybit request failed")

    async def get_tickers(self, category: str = "spot"):
        result = await self._get(
            "/v5/market/tickers",
            params={"category": category}
        )

        return result.get("list", [])

    async def get_ticker(self, symbol: str, category: str = "spot"):
        result = await self._get(
            "/v5/market/tickers",
            params={
                "category": category,
                "symbol": symbol.upper()
            }
        )

        data = result.get("list", [])
        return data[0] if data else None

    async def get_instruments(self, category: str = "spot"):
        result = await self._get(
            "/v5/market/instruments-info",
            params={"category": category}
        )

        return result.get("list", [])

    async def get_kline(
        self,
        symbol: str,
        category: str = "spot",
        interval: str = "D",
        limit: int = 7
    ):
        result = await self._get(
            "/v5/market/kline",
            params={
                "category": category,
                "symbol": symbol.upper(),
                "interval": interval,
                "limit": limit
            }
        )

        return result.get("list", [])

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


class MoexHTTPClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._session: ClientSession | None = None

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession(
                base_url=self.base_url,
                timeout=ClientTimeout(total=20)
            )

        return self._session

    async def _get(self, endpoint: str, params: dict | None = None):
        session = await self._get_session()
        query_params = {"iss.meta": "off", **(params or {})}

        async with session.get(endpoint, params=query_params) as response:
            result = await response.json(content_type=None)

            if response.status != 200:
                raise Exception(f"MOEX HTTP error: {response.status}, {result}")

            return result

    async def get_stocks(self, board: str = "TQBR", start: int = 0):
        return await self._get(
            f"/iss/engines/stock/markets/shares/boards/{board}/securities.json",
            params={
                "start": start,
                "iss.only": "securities,marketdata",
                "securities.columns": "SECID,SHORTNAME,SECNAME",
                "marketdata.columns": (
                    "SECID,LAST,LCURRENTPRICE,LASTCHANGEPRCNT,"
                    "VALTODAY,UPDATETIME"
                )
            }
        )

    async def get_stock(self, secid: str, board: str = "TQBR"):
        return await self._get(
            f"/iss/engines/stock/markets/shares/boards/{board}/securities/{secid.upper()}.json",
            params={"iss.only": "securities,marketdata"}
        )

    async def get_candles(
        self,
        secid: str,
        date_from: str,
        date_to: str,
        board: str = "TQBR",
        interval: int = 24
    ):
        return await self._get(
            f"/iss/engines/stock/markets/shares/boards/{board}/securities/{secid.upper()}/candles.json",
            params={
                "from": date_from,
                "till": date_to,
                "interval": interval
            }
        )

    async def get_orderbook(self, secid: str, board: str = "TQBR"):
        return await self._get(
            f"/iss/engines/stock/markets/shares/boards/{board}/securities/{secid.upper()}/orderbook.json"
        )

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


class CoinGeckoHTTPClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._session: ClientSession | None = None

    async def _get_session(self) -> ClientSession:
        if self._session is None or self._session.closed:
            self._session = ClientSession(
                base_url=self.base_url,
                timeout=ClientTimeout(total=12, connect=5, sock_read=10)
            )

        return self._session

    async def search(self, query: str):
        session = await self._get_session()

        async with session.get("/api/v3/search", params={"query": query}) as response:
            result = await response.json(content_type=None)

            if response.status != 200:
                raise UpstreamHTTPError(
                    f"CoinGecko HTTP error: {response.status}, {result}"
                )

            return result

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
