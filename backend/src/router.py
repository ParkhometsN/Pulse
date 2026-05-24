import asyncio
import time

from fastapi import APIRouter, HTTPException, Query

from src.init import bybit_client, coingecko_client

router = APIRouter(prefix="/cryptocurrencies")
CACHE_TTL_SECONDS = 10
CHART_CACHE_TTL_SECONDS = 60
ORDERBOOK_CACHE_TTL_SECONDS = 1
ICON_CACHE_TTL_SECONDS = 60 * 60 * 24
MAX_MARKET_CACHE_ITEMS = 240
_market_cache: dict[str, dict] = {}
_market_cache_locks: dict[str, asyncio.Lock] = {}

COIN_NAMES = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "USDC": "USD Coin",
    "USDT": "Tether",
    "XRP": "XRP",
    "DOGE": "Dogecoin",
    "SOL": "Solana",
    "BNB": "BNB",
    "ADA": "Cardano",
    "TRX": "TRON",
    "TON": "Toncoin",
    "DOT": "Polkadot",
    "MATIC": "Polygon",
    "AVAX": "Avalanche",
    "LINK": "Chainlink",
    "LTC": "Litecoin",
    "BCH": "Bitcoin Cash",
    "SHIB": "Shiba Inu",
    "UNI": "Uniswap",
    "ETC": "Ethereum Classic",
}

COINMARKETCAP_IDS = {
    "BTC": 1,
    "LTC": 2,
    "XRP": 52,
    "DOGE": 74,
    "ETC": 1321,
    "BCH": 1831,
    "BNB": 1839,
    "LINK": 1975,
    "ADA": 2010,
    "ETH": 1027,
    "USDT": 825,
    "XLM": 512,
    "TRX": 1958,
    "MATIC": 3890,
    "HBAR": 4642,
    "USDC": 3408,
    "ATOM": 3794,
    "FIL": 2280,
    "DAI": 4943,
    "SOL": 5426,
    "AVAX": 5805,
    "SHIB": 5994,
    "NEAR": 6535,
    "DOT": 6636,
    "UNI": 7083,
    "AAVE": 7278,
    "INJ": 7226,
    "ICP": 8916,
    "ARB": 11841,
    "OP": 11840,
    "TON": 11419,
    "SUI": 20947,
    "APT": 21794,
    "PEPE": 24478,
}


def to_float(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def calculate_percent_change(current_price, old_price):
    current_price = to_float(current_price)
    old_price = to_float(old_price)

    if old_price == 0:
        return 0

    return ((current_price - old_price) / old_price) * 100


def get_chart_price_change(price, chart: list, days: int):
    if not chart:
        return 0

    point_index = max(len(chart) - days - 1, 0)
    old_price = chart[point_index].get("close")

    return calculate_percent_change(price, old_price)


def get_coinmarketcap_icon_url(base_coin: str | None):
    if not base_coin:
        return None

    coinmarketcap_id = COINMARKETCAP_IDS.get(base_coin.upper())

    if coinmarketcap_id:
        return (
            "https://s2.coinmarketcap.com/static/img/coins/64x64/"
            f"{coinmarketcap_id}.png"
        )

    return None


def get_best_coingecko_icon(base_coin: str, payload: dict):
    coins = payload.get("coins", [])
    normalized_base_coin = base_coin.upper()

    exact_matches = [
        coin
        for coin in coins
        if str(coin.get("symbol", "")).upper() == normalized_base_coin
    ]
    search_results = exact_matches or coins

    for coin in search_results:
        image_url = coin.get("large") or coin.get("thumb")

        if image_url:
            return image_url

    return None


async def get_icon_url(base_coin: str | None):
    if not base_coin:
        return None

    coinmarketcap_icon_url = get_coinmarketcap_icon_url(base_coin)

    if coinmarketcap_icon_url:
        return coinmarketcap_icon_url

    async def load_icon_url():
        payload = await coingecko_client.search(base_coin)
        return get_best_coingecko_icon(base_coin, payload)

    try:
        return await get_cached_bybit_list(
            cache_key=f"icon:coingecko:{base_coin.upper()}",
            loader=load_icon_url,
            ttl_seconds=ICON_CACHE_TTL_SECONDS
        )
    except Exception:
        return None


def get_coin_name(base_coin: str | None):
    if not base_coin:
        return None

    return COIN_NAMES.get(base_coin.upper(), base_coin)


def format_chart_item(item: list):
    return {
        "time": int(item[0]),
        "open": to_float(item[1]),
        "high": to_float(item[2]),
        "low": to_float(item[3]),
        "close": to_float(item[4]),
        "volume": to_float(item[5]),
        "turnover": to_float(item[6]),
    }


def format_coin(
    instrument: dict,
    ticker: dict,
    chart: list | None = None,
    icon_url: str | None = None
):
    price = to_float(ticker.get("lastPrice"))
    change_24h = to_float(ticker.get("price24hPcnt")) * 100
    lot_size_filter = instrument.get("lotSizeFilter") or {}

    change_7d = get_chart_price_change(price, chart, 7)
    change_30d = get_chart_price_change(price, chart, 30)
    base_coin = instrument.get("baseCoin")

    return {
        "id": instrument.get("symbolId"),
        "symbol": instrument.get("symbol"),
        "name": get_coin_name(base_coin),
        "shortName": base_coin,
        "baseCoin": base_coin,
        "quoteCoin": instrument.get("quoteCoin"),
        "status": instrument.get("status"),
        "iconUrl": icon_url,
        "minOrderAmount": to_float(
            lot_size_filter.get("minOrderAmt")
            or lot_size_filter.get("minOrderAmount")
            or lot_size_filter.get("minNotionalValue")
        ),
        "minOrderQuantity": to_float(lot_size_filter.get("minOrderQty")),
        "quantityStep": to_float(lot_size_filter.get("basePrecision") or lot_size_filter.get("qtyStep")),

        "price": price,
        "priceChangePercent24h": change_24h,
        "priceChangePercent7d": change_7d,
        "priceChangePercent30d": change_30d,

        "highPrice24h": to_float(ticker.get("highPrice24h")),
        "lowPrice24h": to_float(ticker.get("lowPrice24h")),
        "volume24h": to_float(ticker.get("volume24h")),
        "turnover24h": to_float(ticker.get("turnover24h")),
        "bidPrice": to_float(ticker.get("bid1Price")),
        "askPrice": to_float(ticker.get("ask1Price")),

        "chart7d": (chart or [])[-7:]
    }


async def get_coin_chart(symbol: str, category: str):
    try:
        raw_chart = await get_cached_bybit_list(
            cache_key=f"kline:{category}:{symbol}:D:31",
            loader=lambda: bybit_client.get_kline(
                symbol=symbol,
                category=category,
                interval="D",
                limit=31
            ),
            ttl_seconds=CHART_CACHE_TTL_SECONDS
        )
    except Exception:
        return []

    chart = [format_chart_item(item) for item in raw_chart]
    chart.reverse()

    return chart


async def get_coin_orderbook(symbol: str, category: str):
    try:
        return await get_cached_bybit_list(
            cache_key=f"orderbook:{category}:{symbol}:50",
            loader=lambda: bybit_client.get_orderbook(
                symbol=symbol,
                category=category,
                limit=50
            ),
            ttl_seconds=ORDERBOOK_CACHE_TTL_SECONDS
        )
    except Exception:
        return {}


async def find_instrument(currency_id: str, category: str = "spot"):
    instruments = await get_cached_bybit_list(
        cache_key=f"instruments:{category}",
        loader=lambda: bybit_client.get_instruments(category=category)
    )

    for item in instruments:
        if str(item.get("symbolId")) == currency_id:
            return item

        if item.get("symbol", "").upper() == currency_id.upper():
            return item

    return None


async def get_cached_bybit_list(
    cache_key: str,
    loader,
    ttl_seconds: int = CACHE_TTL_SECONDS
):
    cached = _market_cache.get(cache_key)
    now = time.monotonic()

    if cached and now - cached["created_at"] < ttl_seconds:
        return cached["data"]

    lock = _market_cache_locks.setdefault(cache_key, asyncio.Lock())

    async with lock:
        cached = _market_cache.get(cache_key)
        now = time.monotonic()

        if cached and now - cached["created_at"] < ttl_seconds:
            return cached["data"]

        try:
            data = await loader()
        except Exception:
            if cached:
                return cached["data"]

            raise

        if len(_market_cache) >= MAX_MARKET_CACHE_ITEMS and cache_key not in _market_cache:
            oldest_key = min(_market_cache, key=lambda key: _market_cache[key]["created_at"])
            _market_cache.pop(oldest_key, None)
            _market_cache_locks.pop(oldest_key, None)

        _market_cache[cache_key] = {
            "created_at": time.monotonic(),
            "data": data,
        }

        return data


def build_market_response(items: list, total: int, limit: int, offset: int):
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "hasMore": offset + limit < total
    }


def raise_crypto_provider_unavailable():
    raise HTTPException(
        status_code=502,
        detail="Cryptocurrency provider is temporarily unavailable"
    ) from None


@router.get("")
async def get_cryptocurrencies(
    category: str = Query(default="spot"),
    quote_coin: str = Query(default="USDT"),
    limit: int = Query(default=15, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    try:
        tickers, instruments = await asyncio.gather(
            get_cached_bybit_list(
                cache_key=f"tickers:{category}",
                loader=lambda: bybit_client.get_tickers(category=category)
            ),
            get_cached_bybit_list(
                cache_key=f"instruments:{category}",
                loader=lambda: bybit_client.get_instruments(category=category)
            )
        )
    except Exception:
        raise_crypto_provider_unavailable()

    instruments_map = {
        item["symbol"]: item
        for item in instruments
        if item.get("quoteCoin") == quote_coin and item.get("status") == "Trading"
    }

    coin_sources = []

    for ticker in tickers:
        symbol = ticker.get("symbol")
        instrument = instruments_map.get(symbol)

        if not instrument:
            continue

        coin_sources.append((instrument, ticker))

    coin_sources.sort(
        key=lambda item: to_float(item[1].get("turnover24h")),
        reverse=True
    )
    total = len(coin_sources)
    page_sources = coin_sources[offset:offset + limit]

    semaphore = asyncio.Semaphore(4)

    async def format_coin_with_chart(instrument: dict, ticker: dict):
        async with semaphore:
            chart, icon_url = await asyncio.gather(
                get_coin_chart(instrument["symbol"], category),
                get_icon_url(instrument.get("baseCoin"))
            )

        return format_coin(instrument, ticker, chart, icon_url)

    try:
        items = await asyncio.gather(*[
            format_coin_with_chart(instrument, ticker)
            for instrument, ticker in page_sources
        ])
    except Exception:
        raise_crypto_provider_unavailable()

    return build_market_response(items, total, limit, offset)


@router.get("/search-index")
async def get_cryptocurrencies_search_index(
    category: str = Query(default="spot"),
    quote_coin: str = Query(default="USDT")
):
    try:
        tickers, instruments = await asyncio.gather(
            get_cached_bybit_list(
                cache_key=f"tickers:{category}",
                loader=lambda: bybit_client.get_tickers(category=category)
            ),
            get_cached_bybit_list(
                cache_key=f"instruments:{category}",
                loader=lambda: bybit_client.get_instruments(category=category)
            )
        )
    except Exception:
        raise_crypto_provider_unavailable()

    tickers_map = {
        item.get("symbol"): item
        for item in tickers
    }
    items = [
        {
            "type": "crypto",
            "symbol": item.get("symbol"),
            "name": get_coin_name(item.get("baseCoin")),
            "shortName": item.get("baseCoin"),
            "baseCoin": item.get("baseCoin"),
            "quoteCoin": item.get("quoteCoin"),
            "iconUrl": get_coinmarketcap_icon_url(item.get("baseCoin")),
            "turnover24h": to_float(
                tickers_map.get(item.get("symbol"), {}).get("turnover24h")
            ),
        }
        for item in instruments
        if item.get("quoteCoin") == quote_coin and item.get("status") == "Trading"
    ]
    items.sort(key=lambda item: item["turnover24h"], reverse=True)

    return {"items": items, "total": len(items)}


@router.get("/{currency_id}")
async def get_cryptocurrency(
    currency_id: str,
    category: str = Query(default="spot")
):
    try:
        instrument = await find_instrument(currency_id, category)
    except Exception:
        raise_crypto_provider_unavailable()

    if instrument is None:
        raise HTTPException(
            status_code=404,
            detail="Cryptocurrency not found"
        )

    try:
        ticker = await bybit_client.get_ticker(
            symbol=instrument["symbol"],
            category=category
        )
    except Exception:
        raise_crypto_provider_unavailable()

    if ticker is None:
        raise HTTPException(
            status_code=404,
            detail="Ticker not found"
        )

    chart, icon_url, orderbook = await asyncio.gather(
        get_coin_chart(instrument["symbol"], category),
        get_icon_url(instrument.get("baseCoin")),
        get_coin_orderbook(instrument["symbol"], category)
    )

    return {
        **format_coin(instrument, ticker, chart, icon_url),
        "orderbook": orderbook,
    }


@router.get("/{currency_id}/chart")
async def get_cryptocurrency_chart(
    currency_id: str,
    category: str = Query(default="spot"),
    interval: str = Query(default="D"),
    days: int = Query(default=7)
):
    try:
        instrument = await find_instrument(currency_id, category)
    except Exception:
        raise_crypto_provider_unavailable()

    if instrument is None:
        raise HTTPException(
            status_code=404,
            detail="Cryptocurrency not found"
        )

    try:
        raw_chart = await get_cached_bybit_list(
            cache_key=f"kline:{category}:{instrument['symbol']}:{interval}:{days}",
            loader=lambda: bybit_client.get_kline(
                symbol=instrument["symbol"],
                category=category,
                interval=interval,
                limit=days
            ),
            ttl_seconds=CHART_CACHE_TTL_SECONDS
        )
    except Exception:
        raise_crypto_provider_unavailable()

    chart = [format_chart_item(item) for item in raw_chart]
    chart.reverse()

    return {
        "id": instrument.get("symbolId"),
        "symbol": instrument.get("symbol"),
        "baseCoin": instrument.get("baseCoin"),
        "quoteCoin": instrument.get("quoteCoin"),
        "interval": interval,
        "days": days,
        "chart": chart
    }
