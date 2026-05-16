import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Link, useNavigate } from "react-router-dom";

import Buttons from "../../components/UI/buttons";
import Inputs from "../../components/UI/inputs";
import LoaderAnimation from "../../components/ui/loaderAnimation";
import AreYouShure from "../../components/ui/DilogShure";
import KebabMenu from "@/components/ui/cebab";
import RadioButtins from "@/components/ui/radioButton";
import BuysellCardMinicard from "@/components/ui/buysellCardMinicard";
import CoinIcon from "../../components/ui/coinIcon";

import ChartUP from "../../assets/svg/cartUP.svg";
import SVGplus from "../../assets/svg/plus_blue.svg";
import Tbankicon from "../../assets/svg/tbanklogoicon.svg";
import BybitIcon from "../../assets/svg/bybiticon.svg";

import axios from "axios";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/apiError";
import { readCachedValue, writeCachedValue } from "../../lib/clientCache";

const GUIDE_PDF_URL = "/docs/bybitisruction.pdf";
const TBANK_GUIDE_PDF_URL = "/docs/TBANKAPIINSTUCTIONS.pdf";
const DASHBOARD_TOP_GROWTH_CACHE_KEY = "pulse:dashboard:top-growth:v1";
const DASHBOARD_PORTFOLIO_CACHE_KEY = "pulse:dashboard:portfolio-summary:v2";
const DASHBOARD_ANALYTICS_CACHE_KEY = "pulse:dashboard:portfolio-analytics:v1";
const DASHBOARD_TRADES_CACHE_KEY = "pulse:dashboard:portfolio-trades:v2";
const DASHBOARD_TOP_GROWTH_CACHE_MAX_AGE = 1000 * 60 * 5;
const DASHBOARD_PORTFOLIO_CACHE_MAX_AGE = 1000 * 30;
const DASHBOARD_ANALYTICS_CACHE_MAX_AGE = 1000 * 60;
const DASHBOARD_TRADES_CACHE_MAX_AGE = 1000 * 60;
const DASHBOARD_PORTFOLIO_REFRESH_INTERVAL = 1000 * 60;

const EMPTY_PORTFOLIO_SUMMARY = {
  totalValueRub: 0,
  changeRub: 0,
  changePercent: 0,
  wallets: [],
  updatedAt: null,
};

const EMPTY_PORTFOLIO_ANALYTICS = {
  activityGrid: [],
  chart: {
    month: [],
    week: [],
    day: [],
  },
  availableYears: [],
  updatedAt: null,
};
const EMPTY_PORTFOLIO_TRADES = {
  items: [],
  updatedAt: null,
};

const ACTIVITY_GRID = [
  0, 1, 0, 2, 1, 3, 0, 1,
  2, 1, 0, 2, 3, 4, 2, 1,
  0, 1, 2, 1, 3, 2, 0, 1,
  2, 4, 3, 1, 2, 0, 1,
];
const ACTIVITY_WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const getMonthActivityCells = (activityGrid) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const todayDay = today.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const mondayFirstOffset = (firstDay + 6) % 7;
  const normalizedGrid = Array.isArray(activityGrid) ? activityGrid : [];
  const monthValues = new Map();

  Array.from({ length: todayDay }, (_, index) => index + 1).forEach((day, index) => {
    const valueIndex = normalizedGrid.length - todayDay + index;
    const value = normalizedGrid[valueIndex] ?? 0;

    monthValues.set(day, Math.min(Math.max(Number(value) || 0, 0), 4));
  });

  return [
    ...Array.from({ length: mondayFirstOffset }, (_, index) => ({
      id: `empty-${index}`,
      isEmpty: true,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;

      return {
        id: `day-${day}`,
        day,
        value: monthValues.get(day) || 0,
        isToday: day === todayDay,
        isFuture: day > todayDay,
      };
    }),
  ];
};

const TRADE_FEED = [
  {
    id: "eth-1",
    source: "bybit",
    sourceLabel: "Bybit",
    action: "Покупка",
    assetType: "crypto",
    name: "Ethereum",
    symbol: "ETH",
    routeSymbol: "ETHUSDT",
    priceFrom: "283 940 ₽",
    priceTo: "289 280 ₽",
    change: "+1,86%",
    time: "12:14",
    icon: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  },
  {
    id: "sber-1",
    source: "tbank",
    sourceLabel: "Т Банк",
    action: "Покупка",
    assetType: "stock",
    name: "Сбер",
    symbol: "SBER",
    priceFrom: "284,10 ₽",
    priceTo: "286,80 ₽",
    change: "+0,95%",
    time: "11:42",
    icon: null,
  },
  {
    id: "sol-1",
    source: "bybit",
    sourceLabel: "Bybit",
    action: "Продажа",
    assetType: "crypto",
    name: "Solana",
    symbol: "SOL",
    routeSymbol: "SOLUSDT",
    priceFrom: "18 200 ₽",
    priceTo: "18 880 ₽",
    change: "+3,73%",
    time: "10:08",
    icon: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  },
  {
    id: "lkoh-1",
    source: "tbank",
    sourceLabel: "Т Банк",
    action: "Покупка",
    assetType: "stock",
    name: "Лукойл",
    symbol: "LKOH",
    priceFrom: "6 705 ₽",
    priceTo: "6 834 ₽",
    change: "+1,92%",
    time: "08:35",
    icon: null,
  },
];

const TRADE_HISTORY = [
  {
    id: "hist-1",
    date: "11 мая 2026",
    items: [
      {
        id: "hist-1-1",
        action: "Покупка",
        name: "Bitcoin",
        symbol: "BTC",
        routeSymbol: "BTCUSDT",
        sourceLabel: "Bybit",
        source: "bybit",
        assetType: "crypto",
        time: "13:02",
        amount: "0,018 BTC",
      },
      {
        id: "hist-1-2",
        action: "Продажа",
        name: "Yandex",
        symbol: "YDEX",
        sourceLabel: "Т Банк",
        source: "tbank",
        assetType: "stock",
        time: "15:17",
        amount: "2 лота",
      },
    ],
  },
  {
    id: "hist-2",
    date: "10 мая 2026",
    items: [
      {
        id: "hist-2-1",
        action: "Покупка",
        name: "Toncoin",
        symbol: "TON",
        routeSymbol: "TONUSDT",
        sourceLabel: "Bybit",
        source: "bybit",
        assetType: "crypto",
        time: "09:26",
        amount: "24 TON",
      },
    ],
  },
];

const FALLBACK_PIE_DATA = [
  { name: "Криптовалюта", value: 38 },
  { name: "Акции", value: 34 },
  { name: "металлы", value: 28 },
];

const CHART_YEARS = [2024, 2025, 2026, 2027];

const BASE_YEAR_SERIES = {
  month: [
    "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
  ].map((label) => ({ label, value: 0, hasData: false })),
  week: [
    "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс",
  ].map((label) => ({ label, value: 0, hasData: false })),
  day: [
    "00:00", "02:00", "04:00", "06:00", "08:00", "10:00",
    "12:00", "14:00", "16:00", "18:00", "20:00", "22:00",
  ].map((label) => ({ label, value: 0, hasData: false })),
};

const LEGACY_TBANK_MONEY_SYMBOLS = {
  RUB000UTSTOM: "RUB",
  USD000UTSTOM: "USD",
  EUR_RUB__TOM: "EUR",
};

const LEGACY_TBANK_MONEY_NAMES = {
  RUB000UTSTOM: "Российский рубль",
  USD000UTSTOM: "Доллар США",
  EUR_RUB__TOM: "Евро",
};

const getSafeChangeTone = (value) => {
  const number = Number(value) || 0;

  if (number > 0) {
    return "positive";
  }

  if (number < 0) {
    return "negative";
  }

  return "neutral";
};

const getChartTooltipText = (value) =>
  `${formatRub(value)} ₽`;

const getLegacyDisplaySymbol = (symbol) =>
  LEGACY_TBANK_MONEY_SYMBOLS[symbol] || symbol;

const getLegacyDisplayName = (name, symbol) =>
  LEGACY_TBANK_MONEY_NAMES[name] || LEGACY_TBANK_MONEY_NAMES[symbol] || name;

const formatRub = (value) =>
  Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatSignedMoney = (value, symbol = "₽") => {
  const number = Number(value) || 0;
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";

  return `${sign}${formatRub(Math.abs(number))} ${symbol}`;
};

const formatCompactNumber = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("ru-RU", {
    maximumFractionDigits: number >= 10 ? 2 : 6,
  });
};

const normalizeDisplaySymbol = (symbol) => {
  if (!symbol) {
    return "";
  }

  return getLegacyDisplaySymbol(symbol);
};

const formatTradeDate = (value) => {
  if (!value) {
    return "Недавно";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
};

const formatTradeTime = (value, fallback = "") => {
  if (!value) {
    return fallback || "Недавно";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback || "Недавно";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatTradeMoney = (value, tradeCurrency = "RUB") => {
  const symbolMap = {
    RUB: "₽",
    RUR: "₽",
    USD: "$",
    USDT: "$",
    EUR: "€",
  };
  const symbol = symbolMap[String(tradeCurrency).toUpperCase()] || tradeCurrency;

  return `${formatRub(value)} ${symbol}`;
};

const groupTradesByDate = (items) => {
  const groups = new Map();

  items.forEach((item) => {
    const label = formatTradeDate(item.executedAt);
    const group = groups.get(label) || {
      id: label,
      date: label,
      items: [],
    };

    group.items.push(item);
    groups.set(label, group);
  });

  return Array.from(groups.values());
};

const formatPercent = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0,00%";
  }

  return `${number > 0 ? "+" : ""}${number.toFixed(2).replace(".", ",")}%`;
};

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const item = payload[0];

  return (
    <div className="pieTooltip">
      <div className="pieTooltip__label">{item.name}</div>
      <div className="pieTooltip__value">{item.value}%</div>
    </div>
  );
};

const getProviderIcon = (provider) => {
  if (provider === "tbank") {
    return Tbankicon;
  }

  return BybitIcon;
};

const getChangeTone = (value) => {
  const number = Number(value) || 0;

  if (number > 0) {
    return "positive";
  }

  if (number < 0) {
    return "negative";
  }

  return "neutral";
};

const getAssetRouteType = (asset) => {
  const rawType = String(asset?.type || asset?.assetType || asset?.instrumentType || "").toLowerCase();

  if (rawType === "currency") {
    return "currency";
  }

  if (asset?.provider === "bybit" || rawType === "crypto") {
    return "crypto";
  }

  return "stock";
};

const getPortfolioAssetKey = (asset) => [
  asset.provider || "",
  getAssetRouteType(asset),
  normalizeDisplaySymbol(asset.shortName || asset.symbol || asset.coin || asset.figi).toUpperCase(),
].join(":");

const mergePortfolioAssets = (assets) => {
  const mergedAssets = new Map();

  assets.forEach((asset) => {
    const key = getPortfolioAssetKey(asset);
    const currentAsset = mergedAssets.get(key);

    if (!currentAsset) {
      mergedAssets.set(key, { ...asset });
      return;
    }

    const quantity = Number(currentAsset.quantity || 0) + Number(asset.quantity || 0);
    const availableQuantity =
      Number(currentAsset.availableQuantity || 0) + Number(asset.availableQuantity || 0);
    const valueRub = Number(currentAsset.valueRub || 0) + Number(asset.valueRub || 0);
    const valueUsd = Number(currentAsset.valueUsd || 0) + Number(asset.valueUsd || 0);
    const changeRub = Number(currentAsset.changeRub || 0) + Number(asset.changeRub || 0);
    const baseValue = valueRub - changeRub;

    mergedAssets.set(key, {
      ...currentAsset,
      iconUrl: currentAsset.iconUrl || asset.iconUrl,
      currentPriceRub: currentAsset.currentPriceRub || asset.currentPriceRub,
      currentPriceUsd: currentAsset.currentPriceUsd || asset.currentPriceUsd,
      quantity,
      availableQuantity,
      valueRub,
      valueUsd,
      changeRub,
      changePercent: baseValue > 0 ? (changeRub / baseValue) * 100 : 0,
    });
  });

  return Array.from(mergedAssets.values());
};

function SectionLoader({ height = 160, className = "" }) {
  return (
    <div className={`section_loader_shell ${className}`.trim()}>
      <LoaderAnimation height={height} rounded="18px" />
    </div>
  );
}

function Sparkline({ values = [] }) {
  const width = 110;
  const height = 36;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const y = height - ((value - min) / range) * (height - 4) - 2;

    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const lastPoint = points[points.length - 1] || { x: width, y: height / 2 };

  return (
    <svg className="topGrowthSpark" viewBox={`0 0 ${width} ${height}`} fill="none">
      <path d={path} stroke="#10B981" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPoint.x} cy={lastPoint.y} r="3.8" fill="#10B981" stroke="#fff" strokeWidth="1.3" />
    </svg>
  );
}

export default function Dashboard() {
  const [rates, setRates] = useState(null);
  const [chartPeriod, setChartPeriod] = useState("month");
  const [chartYearIndex, setChartYearIndex] = useState(2);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("tbank");
  const [selectedWalletStep, setSelectedWalletStep] = useState(null);
  const [walletDrawerOpen, setWalletDrawerOpen] = useState(false);
  const [tradeSourceFilter, setTradeSourceFilter] = useState("all");
  const [portfolioSummary, setPortfolioSummary] = useState(
    () => readCachedValue(DASHBOARD_PORTFOLIO_CACHE_KEY, DASHBOARD_PORTFOLIO_CACHE_MAX_AGE)
      || EMPTY_PORTFOLIO_SUMMARY
  );
  const [portfolioAnalytics, setPortfolioAnalytics] = useState(
    () => readCachedValue(DASHBOARD_ANALYTICS_CACHE_KEY, DASHBOARD_ANALYTICS_CACHE_MAX_AGE)
      || EMPTY_PORTFOLIO_ANALYTICS
  );
  const [portfolioTrades, setPortfolioTrades] = useState(
    () => readCachedValue(DASHBOARD_TRADES_CACHE_KEY, DASHBOARD_TRADES_CACHE_MAX_AGE)
      || EMPTY_PORTFOLIO_TRADES
  );
  const [isTradesLoading, setIsTradesLoading] = useState((portfolioTrades.items || []).length === 0);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(false);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(
    () => !readCachedValue(DASHBOARD_PORTFOLIO_CACHE_KEY, DASHBOARD_PORTFOLIO_CACHE_MAX_AGE)
  );
  const [portfolioError, setPortfolioError] = useState("");
  const [topGrowthAssets, setTopGrowthAssets] = useState(
    () => readCachedValue(DASHBOARD_TOP_GROWTH_CACHE_KEY, DASHBOARD_TOP_GROWTH_CACHE_MAX_AGE) || []
  );
  const [isTopGrowthLoading, setIsTopGrowthLoading] = useState(topGrowthAssets.length === 0);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [tbankToken, setTbankToken] = useState("");
  const [isWalletConnecting, setIsWalletConnecting] = useState(false);
  const [isWalletDeleting, setIsWalletDeleting] = useState(false);
  const [walletPendingDelete, setWalletPendingDelete] = useState(null);
  const [walletConnectMessage, setWalletConnectMessage] = useState(null);
  const [hoveredChartBar, setHoveredChartBar] = useState(null);
  const [currency, setCurrency] = useState({
    code: "RUB",
    symbol: "₽",
  });
  const navigate = useNavigate();
  const chartYear = CHART_YEARS[chartYearIndex] || CHART_YEARS[0];

  const fetchPortfolioSummary = useCallback(async ({ silent = false, forceRefresh = false } = {}) => {
    if (!silent) {
      setIsPortfolioLoading(true);
    }

    try {
      const response = await api.get("/portfolio/summary", {
        params: forceRefresh ? { force_refresh: true } : undefined,
      });
      const nextSummary = {
        ...EMPTY_PORTFOLIO_SUMMARY,
        ...response.data,
        wallets: response.data?.wallets || [],
      };

      setPortfolioSummary(nextSummary);
      writeCachedValue(DASHBOARD_PORTFOLIO_CACHE_KEY, nextSummary);
      setPortfolioError("");
    } catch (error) {
      setPortfolioError(getApiErrorMessage(error, "Не удалось загрузить портфель."));
    } finally {
      setIsPortfolioLoading(false);
    }
  }, []);

  const fetchPortfolioAnalytics = useCallback(async () => {
    try {
      const response = await api.get(`/portfolio/analytics?year=${chartYear}`);
      const nextAnalytics = {
        ...EMPTY_PORTFOLIO_ANALYTICS,
        ...response.data,
        chart: {
          ...EMPTY_PORTFOLIO_ANALYTICS.chart,
          ...(response.data?.chart || {}),
        },
      };

      setPortfolioAnalytics(nextAnalytics);
      writeCachedValue(DASHBOARD_ANALYTICS_CACHE_KEY, nextAnalytics);
    } catch {
      setPortfolioAnalytics((currentAnalytics) => currentAnalytics);
    }
  }, [chartYear]);

  const fetchPortfolioTrades = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsTradesLoading(true);
    }

    try {
      const response = await api.get("/portfolio/trades");
      const nextTrades = {
        ...EMPTY_PORTFOLIO_TRADES,
        ...response.data,
        items: response.data?.items || [],
      };

      setPortfolioTrades(nextTrades);
      writeCachedValue(DASHBOARD_TRADES_CACHE_KEY, nextTrades);
    } catch {
      setPortfolioTrades((currentTrades) => currentTrades);
    } finally {
      setIsTradesLoading(false);
    }
  }, []);

  useEffect(() => {
    axios
      .get("https://v6.exchangerate-api.com/v6/2207ed7f5bb763d1047a266b/latest/USD")
      .then((response) => {
        setRates(response.data.conversion_rates);
      })
      .catch((error) => {
        console.error("Ошибка при получении курса валют:", error);
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDashboardReady(true);
    }, 520);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const refreshPortfolioData = async ({ silent = false } = {}) => {
      await fetchPortfolioSummary({ silent });
      await fetchPortfolioAnalytics();
      await fetchPortfolioTrades({ silent });
    };

    const initialRefresh = window.setTimeout(() => {
      refreshPortfolioData();
    }, 0);

    const refreshInterval = window.setInterval(() => {
      refreshPortfolioData({ silent: true });
    }, DASHBOARD_PORTFOLIO_REFRESH_INTERVAL);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(refreshInterval);
    };
  }, [fetchPortfolioAnalytics, fetchPortfolioSummary, fetchPortfolioTrades]);

  useEffect(() => {
    const refreshVisiblePortfolio = async () => {
      if (document.visibilityState === "visible") {
        await fetchPortfolioSummary({ silent: true });
        await fetchPortfolioAnalytics();
        await fetchPortfolioTrades({ silent: true });
      }
    };

    window.addEventListener("focus", refreshVisiblePortfolio);
    document.addEventListener("visibilitychange", refreshVisiblePortfolio);

    return () => {
      window.removeEventListener("focus", refreshVisiblePortfolio);
      document.removeEventListener("visibilitychange", refreshVisiblePortfolio);
    };
  }, [fetchPortfolioAnalytics, fetchPortfolioSummary, fetchPortfolioTrades]);

  useEffect(() => {
    let isMounted = true;

	    Promise.allSettled([
	      api.get("/cryptocurrencies", { params: { limit: 50 } }),
	      api.get("/portfolio/tbank/stocks", {
	        params: { limit: 50, include_trading_status: false },
	      }).catch(() => api.get("/stocks", { params: { limit: 50 } })),
	    ])
      .then(([cryptoResult, stockResult]) => {
        if (!isMounted) {
          return;
        }

        const cryptoItems = cryptoResult.status === "fulfilled"
          ? cryptoResult.value.data?.items || []
          : [];
        const stockItems = stockResult.status === "fulfilled"
          ? stockResult.value.data?.items || []
          : [];

        const normalizedCrypto = cryptoItems.map((item) => ({
          id: `crypto-${item.symbol}`,
          type: "crypto",
          name: item.name || item.baseCoin || item.symbol,
          symbol: item.symbol,
          shortName: item.shortName || item.baseCoin || item.symbol,
          icon: item.iconUrl,
          changeValue: Number(item.priceChangePercent24h) || 0,
          sparkline: item.chart7d?.map((point) => point.close) || [],
        }));
	        const normalizedStocks = stockItems.map((item) => ({
	          id: `stock-${item.symbol}`,
	          type: "stock",
	          figi: item.figi,
	          name: item.shortName || item.name || item.symbol,
	          symbol: item.symbol,
	          shortName: item.symbol,
	          icon: item.iconUrl,
	          provider: item.provider,
	          changeValue: Number(item.priceChangePercent24h) || 0,
	          sparkline: item.chart7d?.map((point) => point.close) || [],
	        }));

        const sortByGrowth = (assets) =>
          assets
            .filter((asset) => asset.symbol && asset.changeValue > 0)
            .sort((firstAsset, secondAsset) => secondAsset.changeValue - firstAsset.changeValue);
        const cryptoTop = sortByGrowth(normalizedCrypto);
        const stocksTop = sortByGrowth(normalizedStocks);
        const balancedTop = [...cryptoTop.slice(0, 4), ...stocksTop.slice(0, 3)];
        const fallbackTop = sortByGrowth([...normalizedCrypto, ...normalizedStocks])
          .filter((asset) => !balancedTop.some((selected) => selected.id === asset.id));

        const nextTopGrowthAssets = [...balancedTop, ...fallbackTop].slice(0, 7);
        setTopGrowthAssets(nextTopGrowthAssets);
        writeCachedValue(DASHBOARD_TOP_GROWTH_CACHE_KEY, nextTopGrowthAssets);
      })
      .catch(() => {
        if (isMounted) {
          setTopGrowthAssets((currentAssets) => currentAssets);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsTopGrowthLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const connectedWallets = portfolioSummary.wallets || [];
  const connectedProviders = Array.from(
    new Set(
      connectedWallets
        .filter((wallet) => wallet.status === "active")
        .map((wallet) => wallet.provider)
    )
  );
  const portfolioAssets = mergePortfolioAssets(connectedWallets.flatMap((wallet) =>
    (wallet.assets || []).map((asset) => ({
      ...asset,
      walletId: wallet.id,
      provider: asset.provider || wallet.provider,
      providerLabel: asset.providerLabel || wallet.providerLabel,
    }))
  ));
  const activeTradeSourceFilter =
    tradeSourceFilter !== "all" && !connectedProviders.includes(tradeSourceFilter)
      ? "all"
      : tradeSourceFilter;
  const portfolioValueRub = Number(portfolioSummary.totalValueRub) || 0;
  const portfolioChangeRub = Number(portfolioSummary.changeRub) || 0;
  const portfolioChangePercent = Number(portfolioSummary.changePercent) || 0;
  const convertRubAmount = useCallback(
    (valueRub) => {
      if (currency.code === "RUB" || !rates?.RUB || !rates?.[currency.code]) {
        return Number(valueRub) || 0;
      }

      const moneyInUSD = (Number(valueRub) || 0) / rates.RUB;
      return moneyInUSD * rates[currency.code];
    },
    [currency.code, rates]
  );
  const convertedMoney = useMemo(() => {
    return formatRub(convertRubAmount(portfolioValueRub));
  }, [convertRubAmount, portfolioValueRub]);
  const convertedPortfolioChange = useMemo(
    () => convertRubAmount(portfolioChangeRub),
    [convertRubAmount, portfolioChangeRub]
  );
  const analyticsChartData = portfolioAnalytics.chart?.[chartPeriod] || [];
  const chartData = analyticsChartData.length
    ? analyticsChartData
    : (BASE_YEAR_SERIES[chartPeriod] || BASE_YEAR_SERIES.month);
  const activityGrid = portfolioAnalytics.activityGrid?.length
    ? portfolioAnalytics.activityGrid
    : ACTIVITY_GRID;
  const activityCalendarCells = useMemo(
    () => getMonthActivityCells(activityGrid),
    [activityGrid]
  );
  const filteredPortfolioAssets =
    activeTradeSourceFilter === "all"
      ? portfolioAssets
      : portfolioAssets.filter((item) => item.provider === activeTradeSourceFilter);
  const boughtAssetsList = filteredPortfolioAssets
    .filter((asset) => Number(asset.valueRub) > 0)
    .sort((firstAsset, secondAsset) => Number(secondAsset.valueRub) - Number(firstAsset.valueRub));
  const tradeHistoryGroups = groupTradesByDate(portfolioTrades.items || []);
	  const portfolioPieData = (() => {
	    const groups = portfolioAssets.reduce((acc, asset) => {
	      const routeType = getAssetRouteType(asset);
	      const label = routeType === "crypto"
	        ? "Криптовалюта"
	        : routeType === "currency"
	          ? "Валюта"
	          : "Акции";
	      acc[label] = (acc[label] || 0) + (Number(asset.valueRub) || 0);
	      return acc;
	    }, {});
    const total = Object.values(groups).reduce((sum, value) => sum + value, 0);

    if (!total) {
      return FALLBACK_PIE_DATA;
    }

    return Object.entries(groups).map(([name, value]) => ({
      name,
      value: Math.round((value / total) * 100),
    }));
  })();

  const portfolioChangeTone = getChangeTone(portfolioChangeRub);
  const portfolioChangeText = `${formatSignedMoney(convertedPortfolioChange, currency.symbol)} (${formatPercent(portfolioChangePercent)})`;
  const dashboardTopLoading = !dashboardReady || (isPortfolioLoading && !portfolioSummary.updatedAt);
  const availableChartYears = portfolioAnalytics.availableYears || [];
  const canGoPrevYear = availableChartYears.includes(CHART_YEARS[chartYearIndex - 1]);
  const canGoNextYear = availableChartYears.includes(CHART_YEARS[chartYearIndex + 1]);

  const menuItems = [
    { id: "delete-wallet", label: "Удалить кошелек", danger: true },
  ];

  const handleMenuClick = async (item, wallet) => {
    if (item.id !== "delete-wallet" || !wallet?.id) {
      return;
    }

    setWalletPendingDelete(wallet);
  };

  const confirmDeleteWallet = async () => {
    if (!walletPendingDelete?.id) {
      setWalletPendingDelete(null);
      return;
    }

    setIsWalletDeleting(true);

    try {
      await api.delete(`/wallets/${walletPendingDelete.id}`);
      setPortfolioSummary((currentSummary) => {
        const nextWallets = (currentSummary.wallets || []).filter(
          (wallet) => wallet.id !== walletPendingDelete.id
        );
        const nextSummary = {
          ...currentSummary,
          wallets: nextWallets,
          totalValueRub: nextWallets.reduce(
            (sum, wallet) => sum + (Number(wallet.totalValueRub) || 0),
            0
          ),
          changeRub: nextWallets.reduce(
            (sum, wallet) => sum + (Number(wallet.changeRub) || 0),
            0
          ),
        };

        writeCachedValue(DASHBOARD_PORTFOLIO_CACHE_KEY, nextSummary);
        return nextSummary;
      });
      setWalletPendingDelete(null);
      await fetchPortfolioSummary({ silent: true, forceRefresh: true });
      await fetchPortfolioAnalytics();
      await fetchPortfolioTrades({ silent: true });
    } catch (error) {
      setPortfolioError(getApiErrorMessage(error, "Не удалось удалить кошелек."));
    } finally {
      setIsWalletDeleting(false);
    }
  };

  const handleChooseProvider = () => {
    if (selectedProvider === "bybit") {
      setSelectedWalletStep("bybit");
      return;
    }

    setSelectedWalletStep(selectedProvider);
  };

  const handleBackToProviders = () => {
    setSelectedWalletStep(null);
    setWalletConnectMessage(null);
  };

  const handleConnectWallet = async () => {
    setWalletConnectMessage(null);

    if (selectedWalletStep === "bybit") {
      if (!apiKey.trim() || !apiSecret.trim()) {
        setWalletConnectMessage({
          type: "error",
          text: "Введите API key и API secret Bybit.",
        });
        return;
      }
    } else if (!tbankToken.trim()) {
      setWalletConnectMessage({
        type: "error",
        text: "Вставьте токен T-Invest API.",
      });
      return;
    }

    setIsWalletConnecting(true);

    try {
      if (selectedWalletStep === "bybit") {
        await api.post("/wallets/bybit/connect", {
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
        });
      } else {
        await api.post("/wallets/tbank/connect", {
          api_token: tbankToken.trim(),
        });
      }

      setWalletConnectMessage({
        type: "success",
        text: selectedWalletStep === "bybit"
          ? "Bybit подключен. Обновляю портфель."
          : "Т Банк подключен. Обновляю портфель.",
      });
      setApiKey("");
      setApiSecret("");
      setTbankToken("");
      await fetchPortfolioSummary({ silent: true, forceRefresh: true });
      await fetchPortfolioAnalytics();
      await fetchPortfolioTrades();
      window.setTimeout(() => {
        setWalletDrawerOpen(false);
        setSelectedWalletStep(null);
        setSelectedProvider("tbank");
        setWalletConnectMessage(null);
      }, 450);
    } catch (error) {
      setWalletConnectMessage({
        type: "error",
        text: getApiErrorMessage(
          error,
          selectedWalletStep === "bybit"
            ? "Не удалось подключить Bybit."
            : "Не удалось подключить Т Банк."
        ),
      });
    } finally {
      setIsWalletConnecting(false);
    }
  };

  const changeCurrency = () => {
    setCurrency((prev) => {
      if (prev.code === "USD") {
        return { code: "EUR", symbol: "€" };
      }

      if (prev.code === "EUR") {
        return { code: "RUB", symbol: "₽" };
      }

      return { code: "USD", symbol: "$" };
    });
  };

	  const openAssetPage = (trade) => {
	    const symbol = trade.routeSymbol || trade.symbol;

	    if (!symbol) {
	      return;
	    }

	    const assetType = getAssetRouteType(trade);
	    const params = new URLSearchParams({
	      type: assetType,
	      symbol,
	    });

	    if (assetType === "stock" && trade.figi) {
	      params.set("figi", trade.figi);
	    }

	    navigate(`/app/market/coin-page?${params.toString()}`);
	  };

	  const openTopGrowthAsset = (asset) => {
	    const params = new URLSearchParams({
	      type: asset.type,
	      symbol: asset.symbol,
	    });

	    if (asset.type === "stock" && asset.figi) {
	      params.set("figi", asset.figi);
	    }

	    if (asset.type === "stock" && asset.provider) {
	      params.set("source", asset.provider);
	    }

	    navigate(`/app/market/coin-page?${params.toString()}`);
	  };

  const openPortfolioAsset = (asset) => {
    const routeType = getAssetRouteType(asset);
    const symbol = asset.symbol || asset.shortName || asset.coin || asset.figi;

    if (!symbol) {
      return;
    }

    const params = new URLSearchParams({
      type: routeType,
      symbol,
    });

    if (routeType === "stock" && asset.figi) {
      params.set("figi", asset.figi);
    }

    navigate(`/app/market/coin-page?${params.toString()}`);
  };

  return (
    <div className="app_pages">
      {walletPendingDelete ? (
        <AreYouShure
          TitledilogAlert="Удалить портфель?"
          Descriptionactive={`Портфель ${walletPendingDelete.providerLabel || "кошелька"} будет отключен от Pulse. Данные счета перестанут обновляться на дашборде.`}
          BackButtonAlertText="Отмена"
          ShureButtonAlertText={isWalletDeleting ? "Удаляем..." : "Удалить"}
          onClickBackAlert={() => {
            if (!isWalletDeleting) {
              setWalletPendingDelete(null);
            }
          }}
          onClickShureAlert={confirmDeleteWallet}
        />
      ) : null}
      <div className="app_content">
        <div className="app_items">
          <div className="dashboard_content">
            <div className="dashboard_container">
              {dashboardTopLoading ? (
                <SectionLoader height={220} className="dashboard_top_loader" />
              ) : (
                <>
                  <div className="left_block_dsh">
                    <div className="title_ds">
                      <p>Ваш портфель</p>
                      <Buttons onClick={changeCurrency} type="text">
                        <h5>{currency.symbol}</h5>
                      </Buttons>
                    </div>

                    <div className="moneyAll">
                      <p className="titlePriceDAsh">
                        {`${convertedMoney} ${currency.symbol}`}
                      </p>

                      <div className="changes_to_day">
                        <p className="changes_to_day_label">За сегодня</p>
                        <div className={`changes changes_${portfolioChangeTone}`}>
                          <img src={ChartUP} alt="chartup" />
                          <p>{portfolioChangeText}</p>
                        </div>
                      </div>
                    </div>

                    {portfolioError ? (
                      <p className="dashboard_portfolio_error">{portfolioError}</p>
                    ) : null}
                  </div>

                  <div className="Right_block_dsh">
                    {connectedWallets.map((wallet) => {
                      const walletTone = getChangeTone(wallet.changeRub);
                      const convertedWalletChange = convertRubAmount(wallet.changeRub);
                      const convertedWalletValue = convertRubAmount(wallet.totalValueRub);
                      const walletChangeText = wallet.status === "error"
                        ? "ошибка синхронизации"
                        : `${formatSignedMoney(convertedWalletChange, currency.symbol)} (${formatPercent(wallet.changePercent)})`;

                      return (
                        <div
                          className={`bagCard bagCard_${wallet.status || "active"}`}
                          key={wallet.id}
                        >
                          <div className="upcardBag">
                            <div className="titlebag">
                              <div className="iconCard">
                                <img src={getProviderIcon(wallet.provider)} alt={wallet.providerLabel} />
                              </div>
                              <p>{wallet.providerLabel}</p>
                            </div>
                            <div className={`scoreBag scoreBag_${walletTone}`}>
                              <p>{walletChangeText}</p>
                            </div>
                          </div>
                          <div className="downCardBag">
                            <div className="scoreBagDown">
                              <p>
                                {wallet.accountTypeLabel}
                              </p>
                              <h4>{formatRub(convertedWalletValue)} {currency.symbol}</h4>
                              {wallet.status === "error" && wallet.error ? (
                                <span className="wallet_card_error">{wallet.error}</span>
                              ) : null}
                            </div>
                            <KebabMenu
                              items={menuItems}
                              onItemClick={(item) => handleMenuClick(item, wallet)}
                              position="bottom-right"
                            />
                          </div>
                        </div>
                      );
                    })}

                    <Drawer
                        open={walletDrawerOpen}
                        onOpenChange={(open) => {
                          setWalletDrawerOpen(open);
                          if (!open) {
                            setSelectedWalletStep(null);
                            setSelectedProvider("tbank");
                            setApiKey("");
                            setApiSecret("");
                            setTbankToken("");
                            setWalletConnectMessage(null);
                          }
                        }}
                      >
                      <DrawerTrigger asChild>
                        <div className="button_addBag">
                          <img src={SVGplus} alt="plus" />
                          <h5>Добавьте портфели</h5>
                          <p>Которыми вы хотите автоматически торговать</p>
                        </div>
                      </DrawerTrigger>

                      <DrawerContent className="drw bg-black-s text-white border border-black-t rounded-t-2xl">
                        <div className="ContwainerBagsAdd">
                          <center>
                            <div className="lineDrawer"></div>
                          </center>

                          <DrawerHeader className="drawer_header_dashboard">
                            <DrawerTitle className="drawer_title_dashboard">
                              {!selectedWalletStep
                                ? "Выберите портфели"
                                : selectedWalletStep === "bybit"
                                  ? "Введите ключи Bybit"
                                  : "Введите токен Т Банка"}
                            </DrawerTitle>
                            <DrawerDescription className="drawer_description_dashboard">
                              {!selectedWalletStep
                                ? "Подключите тот сервис, из которого мы будем подтягивать активы."
                                : selectedWalletStep === "bybit"
                                  ? "Так мы получим данные о вашем портфеле и покажем их в портфеле. Доступ можно закрыть в любой момент."
                                  : "Нужен токен T-Invest API с доступом к чтению портфеля. Доступ можно закрыть в личном кабинете Т Банка."}
                            </DrawerDescription>
                          </DrawerHeader>

                          {walletConnectMessage ? (
                            <div className={`wallet_connection_alert wallet_connection_alert_${walletConnectMessage.type}`}>
                              {walletConnectMessage.text}
                            </div>
                          ) : null}

                          {!selectedWalletStep ? (
                            <div className="drawer_provider_shell">
                              <RadioButtins
                                value={selectedProvider}
                                onValueChange={setSelectedProvider}
                              />
                            </div>
                          ) : selectedWalletStep === "bybit" ? (
                            <div className="drawer_provider_panel">
                              <div className="drawer_provider_title">
                                <img src={BybitIcon} alt="Bybit" />
                                <div>
                                  <h3>Введите ключи Bybit</h3>
                                  <p>
                                    Так мы получим данные о вашем портфеле и покажем их в портфеле.
                                    Доступ можно закрыть в любой момент. Для Pulse достаточно прав чтения.
                                  </p>
                                </div>
                              </div>

                              <form
                                id="wallet-connect-form"
                                className="wallet_form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  handleConnectWallet();
                                }}
                              >
                                <Inputs
                                  variant="primary"
                                  type="text"
                                  value={apiKey}
                                  onChange={(event) => setApiKey(event.target.value)}
                                  placeholder="API key"
                                  autoComplete="off"
                                />
                                <Inputs
                                  variant="primary"
                                  type="password"
                                  value={apiSecret}
                                  onChange={(event) => setApiSecret(event.target.value)}
                                  placeholder="API secret"
                                  autoComplete="off"
                                />

                                <div className="wallet_steps_box">
                                  <div className="wallet_steps_title">
                                    <h4>Как ввести ключи</h4>
                                    <p>
                                      Мы собрали короткую подсказку, чтобы подключение заняло пару минут.
                                    </p>
                                  </div>

                                  <div className="wallet_steps_list">
                                    <div className="wallet_step_item">
                                      <span className="wallet_step_badge">1</span>
                                      <div className="wallet_step_content">
                                        <p>В профиле Bybit создайте ключи доступа API.</p>
                                        <a
                                          href={GUIDE_PDF_URL}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="wallet_step_link"
                                        >
                                          Как создать ключи в Bybit
                                        </a>
                                      </div>
                                    </div>

                                    <div className="wallet_step_item">
                                      <span className="wallet_step_badge">2</span>
                                      <div className="wallet_step_content">
                                        <p>
                                          Скопируйте API key и API secret. Ключи действуют 3 месяца.
                                          Вставьте их в поля, и данные появятся в течение 2 минут.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </form>
                            </div>
                          ) : (
                            <div className="drawer_provider_panel">
                              <div className="drawer_provider_title">
                                <img src={Tbankicon} alt="Т Банк" />
                                <div>
                                  <h3>Подключите Т Банк</h3>
                                  <p>
                                    Pulse подтянет открытые инвестиционные счета и посчитает общий портфель.
                                    Лучше использовать токен только на чтение.
                                  </p>
                                </div>
                              </div>

                              <form
                                id="wallet-connect-form"
                                className="wallet_form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  handleConnectWallet();
                                }}
                              >
                                <Inputs
                                  variant="primary"
                                  type="password"
                                  value={tbankToken}
                                  onChange={(event) => setTbankToken(event.target.value)}
                                  placeholder="T-Invest API token"
                                  autoComplete="off"
                                />

                                <div className="wallet_steps_box">
                                  <div className="wallet_steps_title">
                                    <h4>Как получить токен</h4>
                                    <p>
                                      Инструкция лежит рядом с подсказкой по Bybit, чтобы подключение было без гадания.
                                    </p>
                                  </div>

                                  <div className="wallet_steps_list">
                                    <div className="wallet_step_item">
                                      <span className="wallet_step_badge">1</span>
                                      <div className="wallet_step_content">
                                        <p>Создайте токен T-Invest API в личном кабинете Т Банка.</p>
                                        <a
                                          href={TBANK_GUIDE_PDF_URL}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="wallet_step_link"
                                        >
                                          Как создать токен Т Банка
                                        </a>
                                      </div>
                                    </div>

                                    <div className="wallet_step_item">
                                      <span className="wallet_step_badge">2</span>
                                      <div className="wallet_step_content">
                                        <p>
                                          Вставьте токен в поле выше. Мы проверим открытые счета и покажем карточки
                                          только для тех кошельков, которые есть в базе.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </form>
                            </div>
                          )}

                          <DrawerFooter className="drawer_footer_dashboard">
                            {selectedWalletStep ? (
                              <Buttons
                                type="primary-full"
                                htmlType="submit"
                                form="wallet-connect-form"
                                disabled={isWalletConnecting}
                              >
                                {isWalletConnecting
                                  ? "Подключаем..."
                                  : selectedWalletStep === "bybit"
                                    ? "Подключить Bybit"
                                    : "Подключить Т Банк"}
                              </Buttons>
                            ) : (
                              <Buttons type="primary-full" onClick={handleChooseProvider}>
                                Выбрать
                              </Buttons>
                            )}
                            {selectedWalletStep ? (
                              <Buttons type="text" onClick={handleBackToProviders}>
                                Назад к сервисам
                              </Buttons>
                            ) : null}
                            <p className="wallet_security_note">
                              Данные защищены протоколом безопасности и не передаются третьим лицам.
                            </p>
                          </DrawerFooter>
                        </div>
                      </DrawerContent>
                    </Drawer>
                  </div>
                </>
              )}
            </div>

            <div className="dashboard_analytycs">
              <div className="containerAnalic">
                <div className="block black_box sellbuylistss">
                  <div className="uibusell_container">
                    <div className="choosebag">
                      <div className="listactiveButtons">
                        <Buttons
                          type={activeTradeSourceFilter === "all" ? "text trade_filter_active" : "text"}
                          onClick={() => setTradeSourceFilter("all")}
                        >
                          <p>Все</p>
                        </Buttons>
                        {connectedProviders.includes("tbank") ? (
                          <Buttons
                            type={activeTradeSourceFilter === "tbank" ? "text trade_filter_active" : "text"}
                            onClick={() => setTradeSourceFilter("tbank")}
                          >
                            <div className="contentButtonBusell">
                              <img src={Tbankicon} alt="iconbank" />
                              <p>Т Банк</p>
                            </div>
                          </Buttons>
                        ) : null}
                        {connectedProviders.includes("bybit") ? (
                          <Buttons
                            type={activeTradeSourceFilter === "bybit" ? "text trade_filter_active" : "text"}
                            onClick={() => setTradeSourceFilter("bybit")}
                          >
                            <div className="contentButtonBusell">
                              <img src={BybitIcon} alt="iconbank" />
                              <p>Bybit</p>
                            </div>
                          </Buttons>
                        ) : null}
                      </div>
                    </div>

                    <Drawer
                      open={isTradeHistoryOpen}
                      onOpenChange={(open) => {
                        setIsTradeHistoryOpen(open);

                        if (open) {
                          fetchPortfolioTrades();
                        }
                      }}
                    >
                      <DrawerTrigger asChild>
                        <Buttons type="nm_black_prymary">
                          <p style={{ fontSize: "12px" }}>История</p>
                        </Buttons>
                      </DrawerTrigger>

                      <DrawerContent className="trade_history_drawer bg-black-s text-white border border-black-t rounded-t-2xl">
                        <center>
                          <div className="lineDrawer"></div>
                        </center>

                        <DrawerHeader className="trade_history_header">
                          <DrawerTitle className="trade_history_title">
                            История сделок
                          </DrawerTitle>
                          <DrawerDescription className="trade_history_description">
                            Последние покупки и продажи по всем подключенным сервисам.
                          </DrawerDescription>
                        </DrawerHeader>

                        <div className="trade_history_list">
                          {isTradesLoading && !tradeHistoryGroups.length ? (
                            <SectionLoader height={180} className="trade_history_loader" />
                          ) : tradeHistoryGroups.length ? tradeHistoryGroups.map((dayBlock) => (
                            <div key={dayBlock.id} className="trade_history_day">
                              <p className="trade_history_day_label">{dayBlock.date}</p>
                              <div className="trade_history_day_items">
                                {dayBlock.items.map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className="trade_history_item"
                                    onClick={() => openAssetPage(item)}
                                  >
                                    <div className="trade_history_item_main">
	                                      <CoinIcon
	                                        baseCoin={normalizeDisplaySymbol(item.symbol)}
	                                        iconUrl={item.iconUrl}
	                                        label={item.name}
	                                        type={getAssetRouteType(item)}
	                                        className="trade_history_asset_icon"
	                                      />
                                      <div>
                                        <h4>{getLegacyDisplayName(item.name, item.symbol)}</h4>
                                        <p>
                                          {item.providerLabel || item.sourceLabel} · {formatTradeTime(item.executedAt, item.time)} · {normalizeDisplaySymbol(item.symbol)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="trade_history_item_meta">
                                      <span
                                        className={`trade_history_badge trade_history_badge_${item.action === "Продажа" ? "sell" : "buy"}`}
                                      >
                                        {item.action}
                                      </span>
                                      <strong>
                                        {formatCompactNumber(item.quantity)} · {formatTradeMoney(item.totalAmount, item.currency)}
                                      </strong>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )) : (
                            <div className="empty_trades_state">
                              История сделок пока не найдена.
                            </div>
                          )}
                        </div>

                        <DrawerFooter className="trade_history_footer">
                          {/* <DrawerClose asChild>
                            <Buttons type="primary-full">Смотреть всю историю</Buttons>
                          </DrawerClose> */}
                        </DrawerFooter>
                      </DrawerContent>
                    </Drawer>
                  </div>

                  <div className="containerBuysellactive">
                    {dashboardReady ? (
                      <div className="contentbsac">
                        {boughtAssetsList.map((asset) => {
                          const convertedAssetValue = convertRubAmount(asset.valueRub);
                          const convertedAssetChange = convertRubAmount(asset.changeRub);

                          return (
                            <BuysellCardMinicard
                              key={`${asset.provider}-${asset.symbol || asset.figi || asset.coin}`}
                              sourceLabel={asset.providerLabel}
                              name={getLegacyDisplayName(
                                asset.name || normalizeDisplaySymbol(asset.symbol || asset.shortName),
                                asset.symbol || asset.shortName
                              )}
	                              symbol={normalizeDisplaySymbol(asset.shortName || asset.symbol || asset.coin)}
	                              icon={asset.iconUrl}
	                              assetType={getAssetRouteType(asset)}
	                              priceFrom={formatCompactNumber(asset.quantity)}
                              priceTo={`${formatRub(convertedAssetValue)} ${currency.symbol}`}
                              change={`${formatSignedMoney(convertedAssetChange, currency.symbol)} (${formatPercent(asset.changePercent)})`}
                              changeTone={getSafeChangeTone(asset.changeRub)}
                              onClick={() => openPortfolioAsset(asset)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <SectionLoader height={180} />
                    )}

                    {dashboardReady && boughtAssetsList.length === 0 && (
                      <div className="empty_trades_state">
                        Нет данных
                      </div>
                    )}
                  </div>
                </div>

                <div className="left_blockDash">
                  <div className="block black_box sellingBox">
                    <div className="YouNotHaveAStrategy">
                      <Link to="market">
                        <div className="button_addBagStrategy">
                          <img src={SVGplus} alt="plus" />
                          <h5>Выбрать стратегию</h5>
                          <p>
                            Вы можете выбрать стратегию с определенными рисками и возможностями
                          </p>
                        </div>
                      </Link>
                    </div>
                  </div>

                  <div className="block black_box mini_loader_block">
                    {!dashboardReady || isTopGrowthLoading ? (
                      <SectionLoader height={140} />
                    ) : (
                      <div className="top_growth_block">
                        <div className="top_growth_header">
                          <div>
                            <p>Топ роста за день</p>
                          </div>
                        </div>

                        <div className="top_growth_list">
                          {topGrowthAssets.length ? topGrowthAssets.map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              className="top_growth_item"
                              onClick={() => openTopGrowthAsset(asset)}
                            >
                              <div className="top_growth_item_main">
                                <CoinIcon
                                  baseCoin={asset.shortName}
                                  iconUrl={asset.icon}
                                  label={asset.name}
                                  type={asset.type}
                                  className="top_growth_icon"
                                />
                                <div className="flex items-center gap-[4px]">
                                  <h5>{asset.name}</h5>
                                  <p>{formatPercent(asset.changeValue)}</p>
                                </div>
                              </div>
                              <Sparkline values={asset.sparkline} />
                            </button>
                          )) : (
                            <div className="top_growth_empty">
                              Сейчас нет активов с положительной динамикой.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="BlcoksMidleDahs">
                <div className="AnaBl">
                  <div className="block black_box ActivitiSellbuy">
                    {!dashboardReady ? (
                      <SectionLoader height={240} />
                    ) : (
                      <div className="activity_card">
                        <div className="activity_copy">
                          <h3>Активность инвестора</h3>
                          <p>Покупки и продажи за последние 31 день</p>
                        </div>
                        <div className="activity_grid_wrap">
                          <div className="activity_grid" aria-label="Активность инвестора за текущий месяц">
                            {activityCalendarCells.map((cell) => (
                              <span
                                key={cell.id}
                                className={[
                                  "activity_cell",
                                  cell.isEmpty ? "activity_cell_empty" : `activity_cell_${cell.value}`,
                                  cell.isToday ? "activity_cell_today" : "",
                                  cell.isFuture ? "activity_cell_future" : "",
                                ].filter(Boolean).join(" ")}
                                title={cell.day ? `${cell.day} число: ${cell.value || 0} сделок` : undefined}
                              >
                                {""}
                              </span>
                            ))}
                          </div>
                          <div className="activity_weekdays" aria-hidden="true">
                            {ACTIVITY_WEEK_DAYS.map((day, index) => (
                              <span key={`activity-weekday-${day}-${index}`}>{day}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="block black_box sercleChartiijji">
                    <div className="poopp">
                      <h3>Распределение активов</h3>
                      <p>Просмотр распределения портфеля</p>
                    </div>
                    <div className="RadialChartShape">
                      <div className="pieChartWrapper">
                        <div className="pieChartBackdrop" />
                        <div className="pieChartHalo" />
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={portfolioPieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={70}
                              outerRadius={92}
                              startAngle={90}
                              endAngle={-270}
                              paddingAngle={4}
                              cornerRadius={40}
                              stroke="rgba(255,255,255,0.12)"
                              strokeWidth={2}
                            >
                              {portfolioPieData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill="var(--primary-blue)"
                                />
                              ))}
                            </Pie>
                            <Tooltip content={<CustomPieTooltip />} />
                            <text
                              x="50%"
                              y="47%"
                              textAnchor="middle"
                              fill="#fff"
                              fontSize={13}
                              fontWeight={700}
                            >
                              {convertedMoney}
                            </text>
                            <text
                              x="50%"
                              y="57.5%"
                              textAnchor="middle"
                              fill="var(--gray)"
                              fontSize={11}
                            >
                              {currency.symbol} капитал
                            </text>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="block black_box chartBlock">
                  <div className="chartBlock_surface">
                    {!dashboardReady ? (
                      <SectionLoader height={260} />
                    ) : (
                      (() => {
                        const chartValues = chartData.map((point) => Number(point.value));
                        const rawMax = Math.max(...chartValues);
                        const bars = chartData.map((point) => ({
                          ...point,
                          fillPct: point.hasData && rawMax ? Math.max(0.12, Number(point.value) / rawMax) : 0.08,
                        }));

                        return (
                          <>
                            <div className="upchartdash">
                              <div className="chart_tabs_shell">
                                <div className="buttonlisttime" role="tablist" aria-label="Период графика">
                                  {[
                                    { id: "month", label: "Месяц" },
                                    { id: "week", label: "Неделя" },
                                    { id: "day", label: "День" },
                                  ].map(({ id, label }) => (
                                    <button
                                      key={id}
                                      type="button"
                                      role="tab"
                                      aria-selected={chartPeriod === id}
                                      className={
                                        chartPeriod === id
                                          ? "ButtonChooseChart activeChoose"
                                          : "ButtonChooseChart"
                                      }
                                      onClick={() => setChartPeriod(id)}
                                    >
                                      <span>{label}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="year_list">
                                <button
                                  type="button"
                                  className="chart_year_chevron"
                                  aria-label="Предыдущий год"
                                  disabled={!canGoPrevYear}
                                  onClick={() =>
                                    setChartYearIndex((current) => Math.max(0, current - 1))
                                  }
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="12"
                                    height="16"
                                    viewBox="0 0 9 16"
                                    fill="none"
                                    aria-hidden
                                  >
                                    <path
                                      d="M7.17188 1L1.58609 6.58579C0.805039 7.36684 0.80504 8.63317 1.58609 9.41421L7.17188 15"
                                      stroke="#1E75FF"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                </button>
                                <p className="chart_year_label">{chartYear}</p>
                                <button
                                  type="button"
                                  className="chart_year_chevron"
                                  aria-label="Следующий год"
                                  disabled={!canGoNextYear}
                                  onClick={() =>
                                    setChartYearIndex((current) =>
                                      Math.min(CHART_YEARS.length - 1, current + 1)
                                    )
                                  }
                                >
                                  <span className="rightArrow">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="12"
                                      height="16"
                                      viewBox="0 0 9 16"
                                      fill="none"
                                      aria-hidden
                                    >
                                      <path
                                        d="M7.17188 1L1.58609 6.58579C0.805039 7.36684 0.80504 8.63317 1.58609 9.41421L7.17188 15"
                                        stroke="#1E75FF"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </span>
                                </button>
                              </div>
                            </div>

                            <div className="chart_contentDash chart_contentDash_dynamic">
                              <div className="chart_plot chart_plot_compact chart_plot_old">
                                <div className="chart_bands" aria-hidden>
                                  {[0, 1, 2].map((i) => (
                                    <div key={i} className="chart_band_row" />
                                  ))}
                                </div>

                                <div className="chart_bars_overlay">
                                  <div className="chart_bars_cluster">
                                    {bars.map((bar) => (
                                      <div
                                        key={`${bar.label}-${chartYear}`}
                                        className={`chart_bar ${bar.hasData ? "chart_bar_has_data" : "chart_bar_empty"}`}
                                        style={{ height: `${bar.fillPct * 100}%` }}
                                        onMouseEnter={() => setHoveredChartBar(bar)}
                                        onMouseLeave={() => setHoveredChartBar(null)}
                                      >
                                        {hoveredChartBar?.label === bar.label ? (
                                          <div className="chart_bar_tooltip">
                                            <strong>{getChartTooltipText(bar.value)}</strong>
                                          </div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="chart_axis_labels">
                                {bars.map((bar) => (
                                  <span key={`${bar.label}-${chartYear}`}>{bar.label}</span>
                                ))}
                              </div>
                            </div>
                          </>
                        );
                      })()
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
