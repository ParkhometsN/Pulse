import asyncio
import time
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from src.init import moex_client

router = APIRouter(prefix="/stocks")
STOCK_LIST_CACHE_TTL_SECONDS = 10
STOCK_CANDLES_CACHE_TTL_SECONDS = 60
_stocks_cache: dict[str, dict] = {}
_stocks_cache_locks: dict[str, asyncio.Lock] = {}

STOCK_DOMAINS = {
    "AFLT": "aeroflot.ru",
    "AFKS": "sistema.ru",
    "AKRN": "acron.ru",
    "ALRS": "alrosa.ru",
    "ASTR": "astralinux.ru",
    "BANE": "bashneft.ru",
    "BANEP": "bashneft.ru",
    "BELU": "belugagroup.ru",
    "CBOM": "mkb.ru",
    "CHMF": "severstal.com",
    "ENPG": "enplusgroup.com",
    "FEES": "rosseti.ru",
    "FIVE": "x5.ru",
    "FIXP": "fix-price.com",
    "GAZP": "gazprom.ru",
    "GMKN": "nornickel.ru",
    "HEAD": "hh.ru",
    "HYDR": "rushydro.ru",
    "IRAO": "interrao.ru",
    "LKOH": "lukoil.ru",
    "MAGN": "mmk.ru",
    "MGNT": "magnit.com",
    "MOEX": "moex.com",
    "MTLR": "mechel.ru",
    "MTLRP": "mechel.ru",
    "MTSS": "mts.ru",
    "NLMK": "nlmk.com",
    "NVTK": "novatek.ru",
    "OZON": "ozon.ru",
    "PHOR": "phosagro.ru",
    "PIKK": "pik.ru",
    "PLZL": "polyus.com",
    "POSI": "positive-tech.com",
    "RENI": "renins.ru",
    "ROSN": "rosneft.ru",
    "RTKM": "rt.ru",
    "RTKMP": "rt.ru",
    "RUAL": "rusal.ru",
    "SBER": "sberbank.com",
    "SBERP": "sberbank.com",
    "SELG": "seligdar.ru",
    "SFIN": "esfg.ru",
    "SNGS": "surgutneftegas.ru",
    "SNGSP": "surgutneftegas.ru",
    "TATN": "tatneft.ru",
    "TATNP": "tatneft.ru",
    "TCSG": "tbank.ru",
    "TRNFP": "transneft.ru",
    "UPRO": "unipro.energy",
    "VKCO": "vk.company",
    "VTBR": "vtb.ru",
    "X5": "x5.ru",
    "YDEX": "yandex.ru",
}


def table_to_dicts(payload: dict, table_name: str):
    table = payload.get(table_name, {})
    columns = table.get("columns", [])

    return [
        dict(zip(columns, row))
        for row in table.get("data", [])
    ]


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


def normalize_candle(item: dict):
    return {
        "time": item.get("begin"),
        "open": to_float(item.get("open")),
        "high": to_float(item.get("high")),
        "low": to_float(item.get("low")),
        "close": to_float(item.get("close")),
        "volume": to_float(item.get("volume")),
        "value": to_float(item.get("value")),
    }


def get_change_from_candles(price, candles: list, days: int):
    if not candles:
        return 0

    point_index = max(len(candles) - days - 1, 0)
    old_price = candles[point_index].get("close")

    return calculate_percent_change(price, old_price)


def get_stock_icon_url(secid: str | None):
    if not secid:
        return None

    domain = STOCK_DOMAINS.get(secid.upper())

    if not domain:
        return None

    return f"https://icons.duckduckgo.com/ip3/{domain}.ico"


async def get_cached_moex_data(cache_key: str, loader, ttl_seconds: int):
    cached = _stocks_cache.get(cache_key)
    now = time.monotonic()

    if cached and now - cached["created_at"] < ttl_seconds:
        return cached["data"]

    lock = _stocks_cache_locks.setdefault(cache_key, asyncio.Lock())

    async with lock:
        cached = _stocks_cache.get(cache_key)
        now = time.monotonic()

        if cached and now - cached["created_at"] < ttl_seconds:
            return cached["data"]

        try:
            data = await loader()
        except Exception:
            if cached:
                return cached["data"]

            raise

        _stocks_cache[cache_key] = {
            "created_at": time.monotonic(),
            "data": data,
        }

        return data


async def get_stock_candles(
    secid: str,
    board: str,
    days: int = 35,
    date_from: date | None = None,
    interval: int = 24
):
    today = date.today()
    candle_date_from = date_from or today - timedelta(days=days)

    payload = await get_cached_moex_data(
        cache_key=(
            f"candles:{board}:{secid}:{candle_date_from.isoformat()}:"
            f"{today.isoformat()}:{interval}"
        ),
        loader=lambda: moex_client.get_candles(
            secid=secid,
            board=board,
            date_from=candle_date_from.isoformat(),
            date_to=today.isoformat(),
            interval=interval
        ),
        ttl_seconds=STOCK_CANDLES_CACHE_TTL_SECONDS
    )
    candles = [normalize_candle(item) for item in table_to_dicts(payload, "candles")]

    return candles


def format_stock(security: dict, marketdata: dict, candles: list):
    secid = security.get("SECID")
    price = to_float(marketdata.get("LAST") or marketdata.get("LCURRENTPRICE"))

    if price == 0 and candles:
        price = candles[-1].get("close", 0)

    return {
        "id": secid,
        "symbol": secid,
        "name": security.get("SECNAME") or security.get("SHORTNAME") or secid,
        "shortName": security.get("SHORTNAME") or secid,
        "baseCoin": secid,
        "iconUrl": get_stock_icon_url(secid),
        "price": price,
        "priceChangePercent24h": to_float(marketdata.get("LASTCHANGEPRCNT")),
        "priceChangePercent7d": get_change_from_candles(price, candles, 7),
        "priceChangePercent30d": get_change_from_candles(price, candles, 30),
        "turnover24h": to_float(marketdata.get("VALTODAY")),
        "updatedAt": marketdata.get("UPDATETIME"),
        "chart7d": candles[-7:],
    }


def handle_moex_error(error: Exception):
    raise HTTPException(status_code=502, detail=str(error))


@router.get("")
async def get_stocks(
    board: str = Query(default="TQBR"),
    limit: int = Query(default=15, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    try:
        payload = await get_cached_moex_data(
            cache_key=f"stocks:{board}",
            loader=lambda: moex_client.get_stocks(board=board),
            ttl_seconds=STOCK_LIST_CACHE_TTL_SECONDS
        )
        securities = table_to_dicts(payload, "securities")
        marketdata = table_to_dicts(payload, "marketdata")
        securities_map = {item.get("SECID"): item for item in securities}
        marketdata = [
            item
            for item in marketdata
            if item.get("SECID") in securities_map and to_float(item.get("LAST") or item.get("LCURRENTPRICE")) > 0
        ]
        total = len(marketdata)
        page_marketdata = marketdata[offset:offset + limit]

        semaphore = asyncio.Semaphore(8)

        async def format_stock_with_chart(item: dict):
            async with semaphore:
                candles = await get_stock_candles(item["SECID"], board)

            return format_stock(securities_map[item["SECID"]], item, candles)

        items = await asyncio.gather(*[
            format_stock_with_chart(item)
            for item in page_marketdata
        ])

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasMore": offset + limit < total
        }
    except Exception as error:
        handle_moex_error(error)


@router.get("/search-index")
async def get_stocks_search_index(
    board: str = Query(default="TQBR")
):
    try:
        payload = await get_cached_moex_data(
            cache_key=f"stocks:{board}",
            loader=lambda: moex_client.get_stocks(board=board),
            ttl_seconds=STOCK_LIST_CACHE_TTL_SECONDS
        )
        securities = table_to_dicts(payload, "securities")
        marketdata = table_to_dicts(payload, "marketdata")
        securities_map = {item.get("SECID"): item for item in securities}
        items = [
            {
                "type": "stock",
                "symbol": item.get("SECID"),
                "name": securities_map[item.get("SECID")].get("SECNAME")
                or securities_map[item.get("SECID")].get("SHORTNAME")
                or item.get("SECID"),
                "shortName": securities_map[item.get("SECID")].get("SHORTNAME")
                or item.get("SECID"),
                "baseCoin": item.get("SECID"),
                "iconUrl": get_stock_icon_url(item.get("SECID")),
                "turnover24h": to_float(item.get("VALTODAY")),
            }
            for item in marketdata
            if item.get("SECID") in securities_map
        ]
        items.sort(key=lambda item: item["turnover24h"], reverse=True)

        return {"items": items, "total": len(items)}
    except Exception as error:
        handle_moex_error(error)


@router.get("/{secid}/chart")
async def get_stock_chart(
    secid: str,
    board: str = Query(default="TQBR"),
    days: int = Query(default=7, ge=1, le=3650),
    interval: int = Query(default=24)
):
    try:
        candles = await get_stock_candles(
            secid=secid,
            board=board,
            days=days,
            interval=interval
        )

        return {
            "symbol": secid.upper(),
            "interval": interval,
            "days": days,
            "chart": candles,
        }
    except Exception as error:
        handle_moex_error(error)


@router.get("/{secid}")
async def get_stock(
    secid: str,
    board: str = Query(default="TQBR")
):
    try:
        stock_payload = await moex_client.get_stock(secid=secid, board=board)
        security = (table_to_dicts(stock_payload, "securities") or [{}])[0]
        marketdata = (table_to_dicts(stock_payload, "marketdata") or [{}])[0]
        candles = await get_stock_candles(
            secid,
            board,
            date_from=date(1997, 1, 1)
        )

        try:
            orderbook_payload = await moex_client.get_orderbook(secid=secid, board=board)
            orderbook = table_to_dicts(orderbook_payload, "orderbook")
        except Exception:
            orderbook = []

        return {
            **format_stock(security, marketdata, candles),
            "chart": candles,
            "orderbook": orderbook,
        }
    except Exception as error:
        handle_moex_error(error)
