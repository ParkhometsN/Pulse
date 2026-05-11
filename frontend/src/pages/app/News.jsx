import { useCallback, useEffect, useRef, useState } from "react";

import NewsCard from "@/components/ui/newsCard";
import LoaderAnimation from "../../components/ui/loaderAnimation";
import api from "../../lib/api";
import { readCachedValue, writeCachedValue } from "../../lib/clientCache";

const NEWS_PAGE_SIZE = 5;
const NEWS_CACHE_KEY = "pulse:news:feed:v1";
const MARKET_MOOD_CACHE_KEY = "pulse:news:market-mood:v1";
const NEWS_CACHE_MAX_AGE = 1000 * 60 * 30;
const MARKET_MOOD_CACHE_MAX_AGE = 1000 * 60 * 10;

const DEFAULT_MARKET_MOOD = {
  current: { value: 50, label: "Нейтрально", date: "2026-05-11" },
  history: {
    yesterday: { value: 50, label: "Нейтрально", date: "2026-05-10" },
    weekAgo: { value: 50, label: "Нейтрально", date: "2026-05-04" },
    monthAgo: { value: 50, label: "Нейтрально", date: "2026-04-11" },
  },
  year: {
    max: { value: 50, label: "Нейтрально", date: "2026-05-11" },
    min: { value: 50, label: "Нейтрально", date: "2026-05-11" },
  },
};

const NEWS_SOURCES = [
  {
    title: "Рынок акций и паев",
    site: "moex.com",
    url: "https://www.moex.com/s1161",
    icon: "https://www.moex.com/favicon.svg",
  },
  {
    title: "Бизнес и рынки",
    site: "kommersant.ru",
    url: "https://www.kommersant.ru/business",
    icon: "https://www.kommersant.ru/favicon.ico",
  },
  {
    title: "Экономика и компании",
    site: "interfax.ru",
    url: "https://www.interfax.ru/business/",
    icon: "https://www.interfax.ru/favicon.ico",
  },
  {
    title: "Акции, облигации, идеи",
    site: "smart-lab.ru",
    url: "https://smart-lab.ru/news/",
    icon: "https://smart-lab.ru/favicon.ico",
  },
  {
    title: "Компании и аналитика",
    site: "finam.ru",
    url: "https://www.finam.ru/publications/",
    icon: "https://www.finam.ru/favicon.ico",
  },
  {
    title: "Российский рынок",
    site: "bcs-express.ru",
    url: "https://bcs-express.ru/category/rossijskij-rynok",
    icon: "https://bcs-express.ru/favicon.ico",
  } 
];

function NewsListLoader() {
  return (
    <div className="news_loader_stack">
      {Array.from({ length: 3 }).map((_, index) => (
        <LoaderAnimation key={index} height={180} rounded="16px" />
      ))}
    </div>
  );
}

const formatMoodValue = (item) => `${item.label} - ${item.value}`;

const formatMoodDate = (value) => {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
};

const moodBadgeClass = (value) => {
  if (value <= 44) {
    return "brTimeNews sellbad";
  }

  if (value >= 55) {
    return "brTimeNews buygood";
  }

  return "brTimeNews";
};

const getInitialNewsFeed = () => readCachedValue(NEWS_CACHE_KEY, NEWS_CACHE_MAX_AGE) || {
  hasMore: true,
  items: [],
};

export default function News() {
  const [newsItems, setNewsItems] = useState(() => getInitialNewsFeed().items);
  const [marketMood, setMarketMood] = useState(
    () => readCachedValue(MARKET_MOOD_CACHE_KEY, MARKET_MOOD_CACHE_MAX_AGE) || DEFAULT_MARKET_MOOD
  );
  const [hasMore, setHasMore] = useState(() => getInitialNewsFeed().hasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const loadMoreRef = useRef(null);
  const offsetRef = useRef(newsItems.length);
  const hasMoreRef = useRef(hasMore);
  const isLoadingRef = useRef(false);

  const loadNews = useCallback(async ({ refresh = false } = {}) => {
    if (isLoadingRef.current || !hasMoreRef.current) {
      if (!refresh) {
        return;
      }
    }

    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    setIsLoading(newsItems.length === 0);
    setError("");

    try {
      const response = await api.get("/news", {
        params: {
          limit: NEWS_PAGE_SIZE,
          offset: refresh ? 0 : offsetRef.current,
        },
      });
      const items = response.data?.items || [];
      const nextHasMore = Boolean(response.data?.hasMore);

      setNewsItems((currentItems) => {
        const baseItems = refresh ? currentItems.slice(NEWS_PAGE_SIZE) : currentItems;
        const seenIds = new Set(items.map((item) => item.id));
        const currentIds = new Set(currentItems.map((current) => current.id));
        const mergedItems = [
          ...items,
          ...baseItems.filter((item) => !seenIds.has(item.id)),
        ];

        const nextItems = refresh ? mergedItems : [
          ...currentItems,
          ...items.filter((item) => !currentIds.has(item.id)),
        ];

        offsetRef.current = nextItems.length;
        writeCachedValue(NEWS_CACHE_KEY, {
          hasMore: nextHasMore,
          items: nextItems,
        });

        return nextItems;
      });

      if (!refresh) {
        hasMoreRef.current = nextHasMore;
      }

      setHasMore(hasMoreRef.current);
    } catch {
      if (newsItems.length === 0) {
        setError("Не получилось загрузить новости. Попробуйте обновить страницу чуть позже.");
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [newsItems.length]);

  const loadMarketMood = useCallback(async () => {
    try {
      const response = await api.get("/news/market-mood");
      const nextMarketMood = response.data || DEFAULT_MARKET_MOOD;
      setMarketMood(nextMarketMood);
      writeCachedValue(MARKET_MOOD_CACHE_KEY, nextMarketMood);
    } catch {
      setMarketMood((currentMood) => currentMood || DEFAULT_MARKET_MOOD);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadNews({ refresh: true });
      loadMarketMood();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMarketMood, loadNews]);

  useEffect(() => {
    const node = loadMoreRef.current;

    if (!node || !hasMore) {
      return undefined;
    }

    const scrollRoot = node.closest(".app_content");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadNews();
        }
      },
      {
        root: scrollRoot,
        rootMargin: "360px 0px",
        threshold: 0.1,
      }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [hasMore, loadNews]);

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="news_container">
              <div className="blockMoodSales">
                <div className="blockS ioiui">
                  <div className="InesscareInformation">
                    <div className="titleObblocknews">
                      <h2>Индекс страха и жадности рынка</h2>
                      <p>Крипторынок сейчас: {marketMood.current.label.toLowerCase()}</p>
                    </div>
                    <span className="HoverTootlip">
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path fillRule="evenodd" clipRule="evenodd" d="M0 6.5C0 2.91 2.91 0 6.5 0C10.09 0 13 2.91 13 6.5C13 10.09 10.09 13 6.5 13C2.91 13 0 10.09 0 6.5ZM7.58533 3.88867C6.992 3.37067 6.008 3.37067 5.41533 3.88867C5.31552 3.97601 5.1851 4.02013 5.05277 4.01132C4.92043 4.0025 4.79701 3.94148 4.70967 3.84167C4.62232 3.74186 4.5782 3.61144 4.58702 3.4791C4.59583 3.34676 4.65686 3.22334 4.75667 3.136C5.726 2.288 7.274 2.288 8.24333 3.136C9.252 4.01867 9.252 5.48133 8.24333 6.364C8.07464 6.51109 7.88697 6.63486 7.68533 6.732C7.23467 6.95067 7 7.248 7 7.5V8C7 8.13261 6.94732 8.25979 6.85355 8.35355C6.75979 8.44732 6.63261 8.5 6.5 8.5C6.36739 8.5 6.24022 8.44732 6.14645 8.35355C6.05268 8.25979 6 8.13261 6 8V7.5C6 6.64733 6.70667 6.09533 7.25 5.832C7.37133 5.77333 7.484 5.69933 7.58533 5.61133C8.13867 5.12667 8.13867 4.37333 7.58533 3.88867ZM6.5 10.5C6.63261 10.5 6.75979 10.4473 6.85355 10.3536C6.94732 10.2598 7 10.1326 7 10C7 9.86739 6.94732 9.74021 6.85355 9.64645C6.75979 9.55268 6.63261 9.5 6.5 9.5C6.36739 9.5 6.24022 9.55268 6.14645 9.64645C6.05268 9.74021 6 9.86739 6 10C6 10.1326 6.05268 10.2598 6.14645 10.3536C6.24022 10.4473 6.36739 10.5 6.5 10.5Z" fill="#95959C"/>
                      </svg>
                      <div className="asset_chart_tooltipSVG">
                        <p>Блок использует ИИ и методы теории вероятности для анализа рыночных данных, прогнозирования изменения стоимости актива и формирования рекомендации о целесообразности его покупки.</p>
                      </div>
                    </span>
                  </div>
                  <div className="sercleChart">
                      <div className="secleBody">
                          <div className="chartindexScare">
                            <div
                              className="serlcePoint"
                              style={{ left: `${marketMood.current.value}%` }}
                            ></div>
                          </div>
                      </div>
                  </div>
                  <div className="downMood">
                    <h5 className="IndexscareSercle">{marketMood.current.value}</h5>
                    <p>{marketMood.current.label}</p>
                  </div>
                </div>
                <div className="blockS ioiui">
                  <h2>Исторические значения</h2>
                  <div className="params">
                      <div className="timeBl">
                        <h4>Вчера</h4>
                        <div className={moodBadgeClass(marketMood.history.yesterday.value)}>
                          <h5>{formatMoodValue(marketMood.history.yesterday)}</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Прошлая неделя</h4>
                        <div className={moodBadgeClass(marketMood.history.weekAgo.value)}>
                          <h5>{formatMoodValue(marketMood.history.weekAgo)}</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Прошлый месяц</h4>
                        <div className={moodBadgeClass(marketMood.history.monthAgo.value)}>
                          <h5>{formatMoodValue(marketMood.history.monthAgo)}</h5>
                        </div>
                      </div>
                  </div>
                </div>
                <div className="blockS ioiui">
                  <h2>Максимум и минимум года</h2>
                  <div className="paramsyear">
                      <div className="timeBl">
                        <h4>Максимум года ({formatMoodDate(marketMood.year.max.date)})</h4>
                        <div className={moodBadgeClass(marketMood.year.max.value)}>
                          <h5>{formatMoodValue(marketMood.year.max)}</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Минимум года <br /> ({formatMoodDate(marketMood.year.min.date)})</h4>
                        <div className={moodBadgeClass(marketMood.year.min.value)}>
                          <h5>{formatMoodValue(marketMood.year.min)}</h5>
                        </div>
                      </div>
                  </div>
                </div>
              </div>
              <div className="linee"></div>
              <div className="news_blcok">
                <div className="newsListBlock">
                  {newsItems.map((news) => (
                    <NewsCard key={news.id} news={news} />
                  ))}

                  {isLoading && newsItems.length === 0 ? <NewsListLoader /> : null}
                  {error ? <div className="news_error">{error}</div> : null}
                  {isLoading && newsItems.length > 0 ? (
                    <div className="news_bottom_loader">
                      <LoaderAnimation height={86} rounded="16px" />
                    </div>
                  ) : null}
                  <div ref={loadMoreRef} className="news_load_more_anchor" />
                </div>
                <aside className="blockNewsAnalitycs">
                  <div className="blNew">
                    <h2>Топ источников</h2>
                    <div className="linee"></div>
                    <div className="listOfSites">
                      {NEWS_SOURCES.map((source) => (
                        <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                          <div className="linkItem">
                            <img src={source.icon} alt="" />
                            <div className="textofLinkNews">
                              <p>{source.site}</p>
                              <h5>{source.title}</h5>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                  <p className="n">Любая информация в приложении <span style={{color: 'var(--primary-blue)'}}>Pulse</span> не являеться инвестиционной рекомендацией</p>
                </aside>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
