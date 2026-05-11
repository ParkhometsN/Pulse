import asyncio
import email.utils
import hashlib
import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.parse import urlparse

from aiohttp import ClientError, ClientSession, ClientTimeout
from fastapi import APIRouter, Query

router = APIRouter(prefix="/news")

NEWS_CACHE_TTL_SECONDS = 180
_news_cache: dict[str, object] = {
    "expires_at": 0,
    "items": [],
}
_news_cache_lock = asyncio.Lock()
_market_mood_cache: dict[str, object] = {
    "expires_at": 0,
    "payload": None,
}
_market_mood_cache_lock = asyncio.Lock()

NEWS_SOURCES = [
    {
        "name": "Коммерсантъ Бизнес",
        "url": "https://www.kommersant.ru/RSS/section-business.xml",
        "site": "kommersant.ru",
        "category": "markets",
        "priority": 4,
    },
    {
        "name": "Интерфакс",
        "url": "https://www.interfax.ru/rss",
        "site": "interfax.ru",
        "category": "markets",
        "priority": 3,
    },
    {
        "name": "Smart-Lab",
        "url": "https://smart-lab.ru/news/rss/",
        "site": "smart-lab.ru",
        "category": "stocks",
        "priority": 4,
    },
    {
        "name": "Финам Компании",
        "url": "https://www.finam.ru/analysis/conews/rsspoint/",
        "site": "finam.ru",
        "category": "stocks",
        "priority": 5,
    },
    {
        "name": "Финам Комментарии",
        "url": "https://www.finam.ru/analysis/nslent/rsspoint/",
        "site": "finam.ru",
        "category": "stocks",
        "priority": 4,
    },
    {
        "name": "Финам Мировые рынки",
        "url": "https://www.finam.ru/international/advanced/rsspoint/",
        "site": "finam.ru",
        "category": "markets",
        "priority": 3,
    },
    {
        "name": "ForkLog",
        "url": "https://forklog.com/feed/",
        "site": "forklog.com",
        "category": "crypto",
        "priority": 4,
    },
]

ASSET_KEYWORDS = [
    {
        "symbol": "BTC",
        "name": "Bitcoin",
        "type": "crypto",
        "routeSymbol": "BTCUSDT",
        "icon": "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
        "keywords": ["bitcoin", "btc", "биткоин", "биткойн"],
    },
    {
        "symbol": "ETH",
        "name": "Ethereum",
        "type": "crypto",
        "routeSymbol": "ETHUSDT",
        "icon": "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
        "keywords": ["ethereum", "ether", "eth", "эфириум", "эфир"],
    },
    {
        "symbol": "SOL",
        "name": "Solana",
        "type": "crypto",
        "routeSymbol": "SOLUSDT",
        "icon": "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
        "keywords": ["solana", "sol", "солана"],
    },
    {
        "symbol": "XRP",
        "name": "XRP",
        "type": "crypto",
        "routeSymbol": "XRPUSDT",
        "icon": "https://s2.coinmarketcap.com/static/img/coins/64x64/52.png",
        "keywords": ["xrp", "ripple", "рипл"],
    },
    {
        "symbol": "BNB",
        "name": "BNB",
        "type": "crypto",
        "routeSymbol": "BNBUSDT",
        "icon": "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
        "keywords": ["bnb", "binance", "бинанс"],
    },
    {
        "symbol": "SBER",
        "name": "Сбер",
        "type": "stock",
        "routeSymbol": "SBER",
        "icon": "https://www.sberbank.com/favicon.ico",
        "keywords": ["sber", "sberbank", "сбер", "сбера", "сберу"],
    },
    {
        "symbol": "GAZP",
        "name": "Газпром",
        "type": "stock",
        "routeSymbol": "GAZP",
        "icon": "https://www.gazprom.com/favicon.ico",
        "keywords": ["gazprom", "газпром", "газпрома", "gazp"],
    },
    {
        "symbol": "LKOH",
        "name": "Лукойл",
        "type": "stock",
        "routeSymbol": "LKOH",
        "icon": "https://lukoil.com/favicon.ico",
        "keywords": ["lukoil", "лукойл", "лукойла", "lkoh"],
    },
    {
        "symbol": "YDEX",
        "name": "Yandex",
        "type": "stock",
        "routeSymbol": "YDEX",
        "icon": "https://yandex.ru/favicon.ico",
        "keywords": ["yandex", "яндекс", "ydex"],
    },
    {
        "symbol": "ROSN",
        "name": "Роснефть",
        "type": "stock",
        "routeSymbol": "ROSN",
        "icon": "https://www.rosneft.ru/favicon.ico",
        "keywords": ["rosneft", "роснефть", "роснефти", "rosn"],
    },
    {
        "symbol": "TCSG",
        "name": "Т-Технологии",
        "type": "stock",
        "routeSymbol": "TCSG",
        "icon": "https://www.tbank.ru/favicon.ico",
        "keywords": ["tbank", "t-bank", "тинькофф", "т-банк", "т-технологии", "tcsg"],
    },
    {
        "symbol": "OZON",
        "name": "Ozon",
        "type": "stock",
        "routeSymbol": "OZON",
        "icon": "https://www.ozon.ru/favicon.ico",
        "keywords": ["ozon", "озон", "озона"],
    },
    {
        "symbol": "GMKN",
        "name": "Норникель",
        "type": "stock",
        "routeSymbol": "GMKN",
        "icon": "https://www.nornickel.com/favicon.ico",
        "keywords": ["норникель", "nornickel", "gmkn"],
    },
    {
        "symbol": "VTBR",
        "name": "ВТБ",
        "type": "stock",
        "routeSymbol": "VTBR",
        "icon": "https://www.vtb.ru/favicon.ico",
        "keywords": ["втб", "vtb", "vtbr"],
    },
    {
        "symbol": "MGNT",
        "name": "Магнит",
        "type": "stock",
        "routeSymbol": "MGNT",
        "icon": "https://magnit.ru/favicon.ico",
        "keywords": ["магнит", "магнита", "magnit", "mgnt"],
    },
    {
        "symbol": "AFLT",
        "name": "Аэрофлот",
        "type": "stock",
        "routeSymbol": "AFLT",
        "icon": "https://www.aeroflot.ru/favicon.ico",
        "keywords": ["аэрофлот", "аэрофлота", "aeroflot", "aflt"],
    },
    {
        "symbol": "BSPB",
        "name": "Банк Санкт-Петербург",
        "type": "stock",
        "routeSymbol": "BSPB",
        "icon": "https://www.bspb.ru/favicon.ico",
        "keywords": ["банк санкт-петербург", "банк санкт петербург", "bspb"],
    },
    {
        "symbol": "HEAD",
        "name": "HeadHunter",
        "type": "stock",
        "routeSymbol": "HEAD",
        "icon": "https://hh.ru/favicon.ico",
        "keywords": ["headhunter", "хэдхантер", "head"],
    },
    {
        "symbol": "TRNFP",
        "name": "Транснефть",
        "type": "stock",
        "routeSymbol": "TRNFP",
        "icon": "https://www.transneft.ru/favicon.ico",
        "keywords": ["транснефть", "транснефти", "transneft", "trnfp"],
    },
    {
        "symbol": "NVTK",
        "name": "Новатэк",
        "type": "stock",
        "routeSymbol": "NVTK",
        "icon": "https://www.novatek.ru/favicon.ico",
        "keywords": ["новатэк", "novatek", "nvtk"],
    },
    {
        "symbol": "PLZL",
        "name": "Полюс",
        "type": "stock",
        "routeSymbol": "PLZL",
        "icon": "https://www.polyus.com/favicon.ico",
        "keywords": ["полюс", "polyus", "plzl"],
    },
    {
        "symbol": "ALRS",
        "name": "Алроса",
        "type": "stock",
        "routeSymbol": "ALRS",
        "icon": "https://www.alrosa.ru/favicon.ico",
        "keywords": ["алроса", "alrosa", "alrs"],
    },
]

NEWS_STRONG_KEYWORDS = [
    "акци", "рынок акций", "мосбирж", "моэкс", "moex", "котиров", "дивиденд",
    "облигац", "пиф", "бпиф", "etf", "эмитент", "ipo", "фьючерс", "ставк",
    "фрс", "цб", "инфляц", "отчетност", "прибыл", "выручк", "капитализац",
    "биткоин", "биткойн", "ethereum", "эфириум", "крипт", "токен",
    "блокчейн", "bitcoin", "crypto", "stock", "stocks", "brent", "s&p",
    "s&p 500", "sp 500", "nasdaq", "dow jones", "фондов", "золот", "серебр",
    "rgbi",
]

NEWS_SOFT_KEYWORDS = [
    "бирж", "рынок", "рынк", "индекс", "инвест", "портфел", "трейд",
    "доллар", "рубл", "нефт", "газ", "банк", "выкуп", "размещен",
    "прогноз", "волатильн", "стоимост", "цена", "дорожает", "снижается",
]

NEWS_NOISE_KEYWORDS = [
    "цска", "рпл", "кубка гагарина", "хоккей", "футбол", "матч", "песков",
    "путин", "трамп", "бпла", "атака", "погиб", "ранен", "танкер", "судно",
    "ормуз", "санкции против", "войн",
]

CORE_MARKET_KEYWORDS = [
    "акци", "бирж", "индекс", "ставк", "фрс", "цб", "инфляц", "облигац",
    "дивиденд", "отчетност", "прибыл", "выручк", "котиров", "фьючерс",
    "нефт", "brent", "рубл", "доллар", "биткоин", "крипт", "ethereum",
    "s&p", "nasdaq", "dow jones", "золот", "серебр",
]

CRYPTO_CONTEXT_KEYWORDS = [
    "крипт", "биткоин", "биткойн", "bitcoin", "ethereum", "эфириум", "токен",
    "блокчейн", "стейблкоин", "stablecoin", "usdt", "usdc", "defi", "web3",
    "майнинг", "майнер", "кошелек", "кошельк", "binance", "bybit",
    "solana", "xrp", "ripple", "circle",
]

SIMILARITY_STOP_WORDS = {
    "и", "в", "во", "на", "по", "с", "со", "для", "из", "за", "к", "ко",
    "от", "о", "об", "под", "при", "а", "но", "что", "как", "это", "его",
    "ее", "их", "у", "не", "или", "же", "до", "после", "фоне", "на фоне",
}


def clean_text(value: str | None, limit: int | None = None):
    if not value:
        return ""

    without_tags = re.sub(r"<[^>]+>", " ", value)
    normalized = re.sub(r"\s+", " ", html.unescape(without_tags)).strip()
    normalized = re.sub(r"(?:\s+\S+){1,2}(?:\.{3}|…)$", "", normalized).strip()

    if limit and len(normalized) > limit:
        return f"{normalized[:limit].rstrip()}..."

    return normalized


def normalize_for_similarity(value: str | None):
    normalized = clean_text(value).lower().replace("ё", "е")
    normalized = re.sub(r"https?://\S+", " ", normalized)
    normalized = re.sub(
        r"[$€₽]?\d+(?:[.,]\d+)?\s*(?:тыс|млн|млрд|трл|%|к|k|п\.?п\.?|б\.?п\.?)?",
        " ",
        normalized,
    )
    normalized = re.sub(r"[^a-zа-я0-9]+", " ", normalized)
    words = [
        word
        for word in normalized.split()
        if len(word) > 1 and word not in SIMILARITY_STOP_WORDS
    ]

    return " ".join(words)


def text_similarity(left: str | None, right: str | None):
    normalized_left = normalize_for_similarity(left)
    normalized_right = normalize_for_similarity(right)

    if not normalized_left or not normalized_right:
        return 0

    return SequenceMatcher(None, normalized_left, normalized_right).ratio()


def clean_summary(title: str, summary: str | None):
    normalized_summary = clean_text(summary)
    normalized_title = clean_text(title)

    if not normalized_summary:
        return ""

    for _ in range(3):
        if normalized_summary.lower().startswith(normalized_title.lower()):
            normalized_summary = normalized_summary[len(normalized_title):].lstrip(" —–-:.,")
        else:
            break

    if not normalized_summary:
        return ""

    if text_similarity(normalized_title, normalized_summary) >= 0.74:
        return ""

    if len(normalized_summary) < 56 and text_similarity(normalized_title, normalized_summary) >= 0.48:
        return ""

    return normalized_summary


def has_news_keyword(text: str, keyword: str):
    if keyword == "акци":
        return bool(re.search(r"(^|[^a-zа-я0-9])(акци(и|я|ю|ей|ями|ях)|акционер|акционерн)", text))

    return keyword in text


def child_text(item: ET.Element, names: list[str]):
    for child in list(item):
        tag_name = child.tag.split("}")[-1].lower()
        if tag_name in names and child.text:
            return child.text

    return ""


def is_good_image_url(url: str | None):
    if not url:
        return None

    normalized_url = html.unescape(url).strip()
    lower_url = normalized_url.lower()
    blocked_parts = ["favicon", "logo", "avatar", "icon", "counter", "pixel", "1x1"]

    if any(part in lower_url for part in blocked_parts):
        return None

    if not re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", lower_url):
        return None

    return normalized_url


def get_image_url_from_html(value: str | None):
    if not value:
        return None

    for match in re.finditer(r'(?:src|data-src)=["\']([^"\']+)["\']', value, flags=re.IGNORECASE):
        image_url = is_good_image_url(match.group(1))

        if image_url:
            return image_url

    return None


def get_image_url(item: ET.Element, fallback_html: str | None = None):
    for child in list(item):
        tag_name = child.tag.split("}")[-1].lower()
        url = child.attrib.get("url") or child.attrib.get("href")

        if tag_name in {"content", "thumbnail", "enclosure"}:
            image_url = is_good_image_url(url)
            if image_url:
                return image_url

        if tag_name == "image" and child.text:
            image_url = is_good_image_url(child.text)
            if image_url:
                return image_url

    return get_image_url_from_html(fallback_html)


def parse_date(value: str | None):
    if not value:
        return None

    normalized_value = value.strip()

    try:
        parsed = email.utils.parsedate_to_datetime(normalized_value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass

    date_formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%d.%m.%Y %H:%M",
    ]

    for date_format in date_formats:
        try:
            parsed = datetime.strptime(normalized_value, date_format)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            continue

    return None


def find_related_assets(title: str, summary: str):
    text = f"{title} {summary}".lower()
    found_assets = []

    for asset in ASSET_KEYWORDS:
        if any(re.search(rf"(^|[^a-zа-я0-9]){re.escape(keyword)}([^a-zа-я0-9]|$)", text) for keyword in asset["keywords"]):
            found_assets.append({
                "symbol": asset["symbol"],
                "name": asset["name"],
                "type": asset["type"],
                "routeSymbol": asset["routeSymbol"],
                "icon": asset["icon"],
            })

    return found_assets[:4]


def is_market_news(title: str, summary: str, related_assets: list[dict] | None = None, category: str = "markets"):
    text = f"{title} {summary}".lower()
    related_assets_count = len(related_assets or find_related_assets(title, summary))
    score = related_assets_count * 4
    score += sum(2 for keyword in NEWS_STRONG_KEYWORDS if has_news_keyword(text, keyword))
    score += sum(1 for keyword in NEWS_SOFT_KEYWORDS if has_news_keyword(text, keyword))
    has_noise = any(has_news_keyword(text, keyword) for keyword in NEWS_NOISE_KEYWORDS)
    has_core_market_context = any(has_news_keyword(text, keyword) for keyword in CORE_MARKET_KEYWORDS)
    has_crypto_context = any(has_news_keyword(text, keyword) for keyword in CRYPTO_CONTEXT_KEYWORDS)

    if category == "crypto" and not related_assets_count and not has_crypto_context:
        return False

    if not related_assets_count and not has_core_market_context:
        return False

    if has_noise and not related_assets_count and not has_core_market_context:
        return False

    if has_noise and score < 6:
        return False

    if category in {"stocks", "crypto"} and score >= 2:
        return True

    return score >= 3


def detect_category(source: dict, related_assets: list[dict], title: str, summary: str):
    text = f"{title} {summary}".lower()

    if any(asset.get("type") == "stock" for asset in related_assets):
        return "stocks"

    if any(asset.get("type") == "crypto" for asset in related_assets):
        return "crypto"

    if any(has_news_keyword(text, keyword) for keyword in CRYPTO_CONTEXT_KEYWORDS):
        return "crypto"

    if any(has_news_keyword(text, keyword) for keyword in ["акци", "дивиденд", "эмитент", "мосбирж", "отчетност", "ipo"]):
        return "stocks"

    return source.get("category") or "markets"


def score_news_item(source: dict, title: str, summary: str, related_assets: list[dict], image: str | None):
    text = f"{title} {summary}".lower()
    score = int(source.get("priority") or 1)
    score += len(related_assets) * 3
    score += sum(2 for keyword in NEWS_STRONG_KEYWORDS if has_news_keyword(text, keyword))
    score += sum(1 for keyword in NEWS_SOFT_KEYWORDS if has_news_keyword(text, keyword))

    if summary:
        score += 1

    if image:
        score += 1

    if any(has_news_keyword(text, keyword) for keyword in NEWS_NOISE_KEYWORDS):
        score -= 2

    return score


def is_similar_news(current_item: dict, saved_item: dict):
    current_title = current_item.get("normalizedTitle") or normalize_for_similarity(current_item.get("title"))
    saved_title = saved_item.get("normalizedTitle") or normalize_for_similarity(saved_item.get("title"))

    if not current_title or not saved_title:
        return False

    if current_title == saved_title:
        return True

    similarity = SequenceMatcher(None, current_title, saved_title).ratio()

    if similarity >= 0.74:
        return True

    current_assets = {asset.get("symbol") for asset in current_item.get("relatedAssets", [])}
    saved_assets = {asset.get("symbol") for asset in saved_item.get("relatedAssets", [])}
    has_shared_asset = bool(current_assets.intersection(saved_assets))

    if has_shared_asset and similarity >= 0.43:
        return True

    if current_item.get("sourceSite") == saved_item.get("sourceSite") and similarity >= 0.62:
        return True

    current_tokens = set(current_title.split())
    saved_tokens = set(saved_title.split())
    token_base = min(len(current_tokens), len(saved_tokens))

    if token_base >= 5 and len(current_tokens.intersection(saved_tokens)) / token_base >= 0.5:
        return True

    return False


def news_quality(item: dict):
    title_length = len(item.get("title") or "")
    title_penalty = 2 if title_length > 150 else 0

    return (item.get("score") or 0) + (5 if item.get("summary") else 0) + (2 if item.get("image") else 0) - title_penalty


def build_news_feed(raw_items: list[dict]):
    sorted_items = sorted(
        raw_items,
        key=lambda item: ((item.get("publishedTs") or 0), item.get("score") or 0),
        reverse=True,
    )
    deduped_items = []

    for item in sorted_items:
        duplicate_index = next(
            (
                index
                for index, saved_item in enumerate(deduped_items)
                if is_similar_news(item, saved_item)
            ),
            None,
        )

        if duplicate_index is not None:
            if news_quality(item) > news_quality(deduped_items[duplicate_index]):
                deduped_items[duplicate_index] = item
            continue

        deduped_items.append(item)

    buckets = {
        "stocks": [],
        "markets": [],
        "crypto": [],
    }

    for item in deduped_items:
        buckets.setdefault(item.get("category") or "markets", []).append(item)

    for bucket in buckets.values():
        bucket.sort(
            key=lambda item: (
                int((item.get("publishedTs") or 0) // (6 * 60 * 60)),
                news_quality(item),
                item.get("publishedTs") or 0,
            ),
            reverse=True,
        )

    feed = []
    skipped = []
    source_counts: dict[str, int] = {}
    asset_counts: dict[str, int] = {}
    source_limits = {
        "smart-lab.ru": 9,
        "finam.ru": 12,
        "forklog.com": 7,
    }
    category_order = ["stocks", "markets", "crypto"]

    def can_add(item: dict, strict: bool):
        if not strict:
            return True

        source_site = item.get("sourceSite") or ""
        source_limit = source_limits.get(source_site, 10)

        if source_counts.get(source_site, 0) >= source_limit:
            return False

        for asset in item.get("relatedAssets", []):
            symbol = asset.get("symbol")
            asset_limit = 2 if symbol in {"BTC", "ETH", "XRP"} else 3

            if symbol and asset_counts.get(symbol, 0) >= asset_limit:
                return False

        return True

    def append_item(item: dict):
        feed.append(item)
        source_site = item.get("sourceSite") or ""
        source_counts[source_site] = source_counts.get(source_site, 0) + 1

        for asset in item.get("relatedAssets", []):
            symbol = asset.get("symbol")

            if symbol:
                asset_counts[symbol] = asset_counts.get(symbol, 0) + 1

    while any(buckets.get(category) for category in category_order):
        for category in category_order:
            bucket = buckets.get(category) or []

            while bucket:
                candidate = bucket.pop(0)

                if can_add(candidate, strict=True):
                    append_item(candidate)
                    break

                skipped.append(candidate)

    for item in skipped:
        if not any(existing_item["id"] == item["id"] for existing_item in feed):
            append_item(item)

    return feed


def classify_fear_greed(value: int):
    if value <= 24:
        return "Сильный страх"
    if value <= 44:
        return "Страх"
    if value <= 54:
        return "Нейтрально"
    if value <= 74:
        return "Жадность"
    return "Сильная жадность"


def mood_item(raw_item: dict | None):
    if not raw_item:
        return {
            "value": 50,
            "label": "Нейтрально",
            "date": datetime.now(timezone.utc).date().isoformat(),
        }

    value = int(raw_item.get("value") or 50)
    timestamp = int(raw_item.get("timestamp") or time.time())

    return {
        "value": value,
        "label": classify_fear_greed(value),
        "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(),
    }


async def get_cached_market_mood():
    now = time.time()

    if _market_mood_cache["expires_at"] > now and _market_mood_cache["payload"]:
        return _market_mood_cache["payload"]

    async with _market_mood_cache_lock:
        if _market_mood_cache["expires_at"] > now and _market_mood_cache["payload"]:
            return _market_mood_cache["payload"]

        timeout = ClientTimeout(total=10, connect=4, sock_read=8)
        data = []

        try:
            async with ClientSession(timeout=timeout) as session:
                async with session.get(
                    "https://api.alternative.me/fng/",
                    params={"limit": 365, "format": "json"},
                    headers={"User-Agent": "PulseInvest/1.0"},
                ) as response:
                    if response.status == 200:
                        payload = await response.json(content_type=None)
                        data = payload.get("data", [])
        except (asyncio.TimeoutError, ClientError):
            data = []

        current = mood_item(data[0] if len(data) > 0 else None)
        yesterday = mood_item(data[1] if len(data) > 1 else None)
        week_ago = mood_item(data[7] if len(data) > 7 else data[-1] if data else None)
        month_ago = mood_item(data[30] if len(data) > 30 else data[-1] if data else None)
        year_items = [mood_item(item) for item in data] or [current]
        max_item = max(year_items, key=lambda item: item["value"])
        min_item = min(year_items, key=lambda item: item["value"])
        response_payload = {
            "current": current,
            "history": {
                "yesterday": yesterday,
                "weekAgo": week_ago,
                "monthAgo": month_ago,
            },
            "year": {
                "max": max_item,
                "min": min_item,
            },
        }

        _market_mood_cache["payload"] = response_payload
        _market_mood_cache["expires_at"] = now + 60 * 60

        return response_payload


async def fetch_source(session: ClientSession, source: dict):
    try:
        async with session.get(
            source["url"],
            headers={"User-Agent": "PulseInvest/1.0"},
        ) as response:
            if response.status != 200:
                return []

            payload = await response.text()
    except (asyncio.TimeoutError, ClientError):
        return []

    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []

    items = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
    parsed_items = []

    for item in items[:80]:
        title = clean_text(child_text(item, ["title"]), 180)
        link = child_text(item, ["link"]) or item.attrib.get("href") or source["url"]
        description = child_text(item, ["description", "summary", "encoded", "content"])
        raw_summary = clean_text(description)
        summary = clean_summary(title, raw_summary)
        summary_for_detection = summary or raw_summary
        published_raw = child_text(item, ["pubdate", "published", "updated"])
        published_at = parse_date(published_raw)
        image_url = get_image_url(item, description)

        if not title:
            continue

        related_assets = find_related_assets(title, summary_for_detection)
        category = detect_category(source, related_assets, title, summary_for_detection)

        if not is_market_news(title, summary_for_detection, related_assets, category):
            continue

        item_id = hashlib.sha1(f"{source['site']}:{link}:{title}".encode()).hexdigest()
        parsed_items.append({
            "id": item_id,
            "title": title,
            "summary": summary,
            "url": link,
            "image": image_url,
            "sourceName": source["name"],
            "sourceSite": source["site"] or urlparse(link).netloc,
            "publishedAt": published_at.isoformat() if published_at else None,
            "publishedTs": published_at.timestamp() if published_at else 0,
            "relatedAssets": related_assets,
            "category": category,
            "score": score_news_item(source, title, summary_for_detection, related_assets, image_url),
            "normalizedTitle": normalize_for_similarity(title),
        })

    return parsed_items


async def get_cached_news():
    now = time.time()

    if _news_cache["expires_at"] > now:
        return _news_cache["items"]

    async with _news_cache_lock:
        if _news_cache["expires_at"] > now:
            return _news_cache["items"]

        timeout = ClientTimeout(total=16, connect=5, sock_read=10)
        async with ClientSession(timeout=timeout) as session:
            results = await asyncio.gather(
                *(fetch_source(session, source) for source in NEWS_SOURCES)
            )

        items_by_id = {}
        for source_items in results:
            for item in source_items:
                items_by_id[item["id"]] = item

        items = build_news_feed(list(items_by_id.values()))

        _news_cache["items"] = items
        _news_cache["expires_at"] = now + NEWS_CACHE_TTL_SECONDS

        return items


@router.get("")
async def get_news(
    limit: int = Query(default=5, ge=1, le=20),
    offset: int = Query(default=0, ge=0),
):
    items = await get_cached_news()
    page = items[offset:offset + limit]

    return {
        "items": [
            {
                key: value
                for key, value in item.items()
                if key not in {"publishedTs", "score", "normalizedTitle"}
            }
            for item in page
        ],
        "total": len(items),
        "limit": limit,
        "offset": offset,
        "hasMore": offset + limit < len(items),
    }


@router.get("/market-mood")
async def get_market_mood():
    return await get_cached_market_mood()
