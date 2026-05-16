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

import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";
import LogoSvg from "../../assets/svg/pulse_logo.svg";
import TbankIcon from "../../assets/svg/tbanklogoicon.svg";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
import { readCachedValue, writeCachedValue } from "../../lib/clientCache";
import { Link} from "react-router-dom";

import LoaderAnimation from "../../components/ui/loaderAnimation";
import Buttons from "../../components/UI/buttons";
import CoinIcon from "../../components/ui/coinIcon";
import TextAlert from "../../components/ui/TextAlert";
import NewsCard from "@/components/ui/newsCard";

const ASSET_REFRESH_INTERVAL = 10000;
const ASSET_BACKGROUND_REFRESH_INTERVAL = 60000;
const ASSET_CACHE_MAX_AGE = 1000 * 60 * 5;
const CHART_CACHE_MAX_AGE = 1000 * 60 * 10;
const ASSET_NEWS_CACHE_MAX_AGE = 1000 * 60 * 15;
const assetCacheKey = (endpoint) => `pulse:asset:${endpoint}:v3`;
const chartCacheKey = (key) => `pulse:asset-chart:${key}:v2`;
const assetNewsCacheKey = (key) => `pulse:asset-news:${key}:v1`;
const aiScoreCacheKey = (key) => `pulse:asset-ai-score:${new Date().toLocaleDateString("en-CA")}:${key}:v1`;
const TRADE_PORTFOLIO_CACHE_KEY = "pulse:trade:portfolio-summary:v3";
const FAVORITES_STORAGE_KEY = "pulse_market_favorites";
const NEWS_SEEN_KEY = "pulse:news:seen:v1";
const ASSET_NEWS_PAGE_SIZE = 20;
const STABLE_CRYPTO_SYMBOLS = new Set(["USDT", "USDC", "DAI", "USD", "BUSD", "RUB", "RUR"]);
const STABLE_CRYPTO_NAMES = {
  USDT: "Tether",
  USDC: "USD Coin",
  DAI: "Dai",
  USD: "US Dollar",
  BUSD: "Binance USD",
  RUB: "Российский рубль",
  RUR: "Российский рубль",
};
const CHART_RANGES = {
  "1D": { days: 1, interval: "60", stockInterval: 60, points: 24, showTime: true },
  "5D": { days: 5, interval: "60", stockInterval: 60, points: 120, showTime: true },
  "1M": { days: 30, interval: "D", stockInterval: 24 },
  "6M": { days: 183, interval: "D", stockInterval: 24 },
  YTD: { ytd: true },
  "1Y": { days: 365, interval: "D", stockInterval: 24 },
  "5Y": { days: 365 * 5, interval: "D", stockInterval: 24 },
  ALL: { all: true, interval: "D", stockInterval: 24 },
};
const USD_TO_RUB_RATE = 92;

const getPriceDecimals = (value) => {
  const number = Math.abs(Number(value));

  if (!Number.isFinite(number) || number === 0) {
    return 2;
  }

  if (number >= 1000) {
    return 2;
  }

  if (number >= 100) {
    return 3;
  }

  if (number >= 1) {
    return 5;
  }

  if (number >= 0.01) {
    return 6;
  }

  return 8;
};

const formatNumber = (value, maximumFractionDigits = getPriceDecimals(value), minimumFractionDigits = 0) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("ru-RU", {
    maximumFractionDigits,
    minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits),
  });
};

const formatMoney = (value, currencySymbol) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return `${currencySymbol}0`;
  }

  const maximumFractionDigits = getPriceDecimals(number);
  const minimumFractionDigits = number >= 1 && number < 1000
    ? Math.min(2, maximumFractionDigits)
    : number > 0 && number < 1
      ? Math.min(4, maximumFractionDigits)
      : 0;

  return `${currencySymbol}${formatNumber(number, maximumFractionDigits, minimumFractionDigits)}`;
};

const formatTradeInputValue = (value, digits = 8) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }

  return number
    .toFixed(digits)
    .replace(/\.?0+$/, "");
};

const formatRubleEquivalent = (value, quoteCurrency) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "≈₽0";
  }

  const normalizedQuoteCurrency = String(quoteCurrency || "").toUpperCase();
  const rubValue = normalizedQuoteCurrency === "RUB"
    ? number
    : number * USD_TO_RUB_RATE;

  return `${normalizedQuoteCurrency === "RUB" ? "" : "≈"}${formatMoney(rubValue, "₽")}`;
};

const normalizeSearchText = (value) => String(value || "").trim().toLowerCase();

const getAssetNewsAliases = (asset, symbol, shortName, assetName, baseCurrency) => {
  return [
    symbol,
    asset?.symbol,
    asset?.baseCoin,
    asset?.shortName,
    shortName,
    assetName,
    baseCurrency,
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
};

const newsMatchesAsset = (news, aliases) => {
  if (!news || !aliases.length) {
    return false;
  }

  const relatedAssets = Array.isArray(news.relatedAssets) ? news.relatedAssets : [];
  const hasRelatedAsset = relatedAssets.some((relatedAsset) => {
    const relatedValues = [
      relatedAsset.symbol,
      relatedAsset.routeSymbol,
      relatedAsset.name,
    ].map(normalizeSearchText);

    return relatedValues.some((value) => value && aliases.includes(value));
  });

  if (hasRelatedAsset) {
    return true;
  }

  const text = normalizeSearchText(`${news.title || ""} ${news.summary || ""}`);

  return aliases.some((alias) => alias.length >= 3 && text.includes(alias));
};

const formatPercent = (value) => {
  const number = Number(value) || 0;

  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

const formatSignedMoney = (value, currencySymbol) => {
  const number = Number(value) || 0;
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";

  return `${sign}${currencySymbol}${formatNumber(Math.abs(number))}`;
};

const formatChartValue = (value, currencySymbol, options = {}) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  if (options.compact && Math.abs(number) >= 1000) {
    return `${currencySymbol}${Intl.NumberFormat("ru-RU", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(number)}`;
  }

  return `${currencySymbol}${formatNumber(number, options.maximumFractionDigits ?? getPriceDecimals(number))}`;
};

const formatDateTime = (value) => {
  const date = value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value)
    : new Date();

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getApiErrorText = (error, fallback = "Не удалось отправить заявку") => {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const fieldName = Array.isArray(item?.loc)
          ? item.loc.filter((part) => part !== "body").join(".")
          : "";
        const message = item?.msg || item?.message || "Некорректные данные заявки";

        return fieldName ? `${fieldName}: ${message}` : message;
      })
      .join(". ");
  }

  if (detail && typeof detail === "object") {
    return detail.message || detail.msg || fallback;
  }

  return fallback;
};

const normalizeTextContent = (value, fallback = "") => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTextContent(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    return value.message || value.msg || value.detail || fallback;
  }

  return fallback;
};

const calculateLocalDailyAiScore = (asset, assetType, symbol) => {
  const chart = (asset?.chart || asset?.chart7d || [])
    .map((point) => Number(point?.close || point?.price))
    .filter((value) => Number.isFinite(value) && value > 0);
  const currentPrice = Number(asset?.price) || chart[chart.length - 1] || 0;
  const change1d = Number(asset?.priceChangePercent24h) || 0;
  const change7d = Number(asset?.priceChangePercent7d) || 0;
  const change30d = Number(asset?.priceChangePercent30d) || 0;
  const returns = chart
    .slice(1)
    .map((value, index) => {
      const previousValue = chart[index];
      return previousValue > 0 ? ((value - previousValue) / previousValue) * 100 : 0;
    })
    .filter(Number.isFinite);
  const volatility = returns.length
    ? Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length)
    : Math.abs(change1d);
  const positiveDays = returns.filter((value) => value > 0).length;
  const trendQuality = returns.length ? (positiveDays / returns.length) * 100 : 50;
  const turnover = Number(asset?.turnover24h || asset?.volume24h || 0);
  const momentumScore = clamp(50 + change1d * 1.8 + change7d * 1.1 + change30d * 0.45, 0, 100);
  const liquidityScore = clamp(35 + Math.log10(Math.max(turnover, 1)) * 9, 0, 100);
  const riskScore = clamp(100 - volatility * 6, 0, 100);
  const qualityScore = clamp(trendQuality * 0.7 + riskScore * 0.3, 0, 100);
  const score = clamp(
    momentumScore * 0.42 + liquidityScore * 0.2 + riskScore * 0.18 + qualityScore * 0.2,
    0,
    100
  );
  const targetMove = clamp(((score - 50) / 100) * Math.max(6, volatility * 1.8), -18, 18);
  const targetPrice = currentPrice > 0 ? currentPrice * (1 + targetMove / 100) : 0;
  const rangeWidth = Math.max(Math.abs(targetMove) * 0.38, Math.min(Math.max(volatility, 1.2), 8));
  const confidence = clamp(82 - (chart.length < 3 ? 14 : 0) - (turnover <= 0 ? 10 : 0), 35, 88);
  const signal = confidence < 45
    ? "NO_SIGNAL"
    : score >= 60
      ? "BUY"
      : score <= 35
        ? "SELL"
        : "HOLD";

  return {
    symbol,
    assetType,
    score: Number(score.toFixed(2)),
    signal,
    confidence: Number(confidence.toFixed(2)),
    targetPrice: Number(targetPrice.toFixed(8)),
    targetRangeLow: Number((targetPrice * (1 - rangeWidth / 100)).toFixed(8)),
    targetRangeHigh: Number((targetPrice * (1 + rangeWidth / 100)).toFixed(8)),
    summary: "Локальный дневной прогноз рассчитан по momentum, волатильности, ликвидности и качеству тренда.",
    sourceManifest: ["local_market_features"],
    dataQualityFlags: chart.length < 3 ? ["short_chart_history"] : [],
    cached: true,
    localFallback: true,
    createdAt: new Date().toISOString(),
  };
};

const getPointTime = (point) => {
  const rawTime = point?.time || point?.begin;
  const date = rawTime ? new Date(rawTime) : null;

  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const formatChartDate = (date, showTime = false) => {
  if (!date) {
    return "";
  }

  if (showTime) {
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};

const formatChartDateTime = (date) => {
  if (!date) {
    return "";
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getLinePath = (points) => {
  if (points.length < 2) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
};

const getTradeMarkerTime = (marker) => {
  const date = marker?.executedAt ? new Date(marker.executedAt) : null;

  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const getTradeMarkerPrice = (marker) => {
  const explicitPrice = Number(marker?.price);

  if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
    return explicitPrice;
  }

  const totalAmount = Number(marker?.totalAmount);
  const quantity = Number(marker?.quantity);

  return Number.isFinite(totalAmount) && totalAmount > 0 && Number.isFinite(quantity) && quantity > 0
    ? totalAmount / quantity
    : null;
};

const getMedianInterval = (timeValues) => {
  const intervals = timeValues
    .slice(1)
    .map((value, index) => value - timeValues[index])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((firstValue, secondValue) => firstValue - secondValue);

  if (!intervals.length) {
    return 0;
  }

  return intervals[Math.floor(intervals.length / 2)];
};

const filterChartByRange = (chartData, range) => {
  const data = Array.isArray(chartData) ? chartData : [];

  if (range === "ALL") {
    return data;
  }

  const rangeSettings = CHART_RANGES[range] || CHART_RANGES["5D"];
  const now = new Date();
  const fromDate = new Date(now);

  if (rangeSettings.ytd) {
    fromDate.setMonth(0, 1);
    fromDate.setHours(0, 0, 0, 0);
  } else {
    fromDate.setDate(fromDate.getDate() - rangeSettings.days);
  }

  return data.filter((point) => {
    const pointDate = getPointTime(point);

    return pointDate ? pointDate >= fromDate : true;
  });
};

const getInitialFavorites = () => {
  try {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);

    return savedFavorites ? JSON.parse(savedFavorites) : [];
  } catch {
    return [];
  }
};

function AssetChart({ data, currencySymbol, activeRange, currentPrice, tradeMarkers = [] }) {
  const [chartSize, setChartSize] = useState({
    width: 640,
    height: 320,
  });
  const height = Math.max(300, chartSize.height);
  const padding = {
    top: 14,
    right: 96,
    bottom: 34,
    left: 12,
  };
  const chartContainerRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    scrollLeft: 0,
  });
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [selectedTradeMarker, setSelectedTradeMarker] = useState(null);
  const chartData = useMemo(() => {
    return (Array.isArray(data) ? data : [])
      .map((point) => {
        const close = Number(point.close);
        const open = Number.isFinite(Number(point.open)) ? Number(point.open) : close;
        const high = Number.isFinite(Number(point.high)) ? Number(point.high) : close;
        const low = Number.isFinite(Number(point.low)) ? Number(point.low) : close;

        return {
          ...point,
          close,
          high,
          low,
          open,
          volume: Number(point.volume),
          time: getPointTime(point),
        };
      })
      .filter((point) => Number.isFinite(point.close))
      .sort((firstPoint, secondPoint) => {
        const firstTime = firstPoint.time?.getTime() || 0;
        const secondTime = secondPoint.time?.getTime() || 0;

        return firstTime - secondTime;
      });
  }, [data]);
  const currentPriceNumber = Number(currentPrice);
  const timeValues = chartData
    .map((point) => point.time?.getTime())
    .filter(Number.isFinite);
  const minTime = Math.min(...timeValues);
  const maxTime = Math.max(...timeValues);
  const hasTimeScale = Number.isFinite(minTime) && Number.isFinite(maxTime) && maxTime > minTime;
  const chartIntervalMs = getMedianInterval(timeValues);
  const visibleWindowStart = hasTimeScale
    ? minTime - (chartIntervalMs || 0)
    : null;
  const visibleWindowEnd = hasTimeScale
    ? maxTime + (chartIntervalMs || 0)
    : null;
  const preparedTradeMarkers = (Array.isArray(tradeMarkers) ? tradeMarkers : [])
    .map((marker) => {
      const markerTime = getTradeMarkerTime(marker);
      const markerTimeMs = markerTime?.getTime();
      const markerPrice = getTradeMarkerPrice(marker);

      return {
        ...marker,
        markerTime,
        markerTimeMs,
        markerPrice,
      };
    })
    .filter((marker) => Number.isFinite(marker.markerTimeMs));
  const visibleTradeMarkers = preparedTradeMarkers.filter((marker) => {
    if (!hasTimeScale) {
      return true;
    }

    return marker.markerTimeMs >= visibleWindowStart && marker.markerTimeMs <= visibleWindowEnd;
  });
  const tradeMarkerPrices = visibleTradeMarkers
    .map((marker) => marker.markerPrice)
    .filter(Number.isFinite);
  const prices = [
    ...chartData.flatMap((point) => [point.close, point.high, point.low]),
    currentPriceNumber,
    ...tradeMarkerPrices,
  ].filter(Number.isFinite);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);

  useEffect(() => {
    const element = chartContainerRef.current;

    if (!element) {
      return;
    }

    const updateChartSize = () => {
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.max(320, Math.round(rect.width || 640)),
        height: Math.max(300, Math.round(rect.height || 320)),
      };

      setChartSize((currentSize) => {
        if (
          currentSize.width === nextSize.width &&
          currentSize.height === nextSize.height
        ) {
          return currentSize;
        }

        return nextSize;
      });
    };

    updateChartSize();

    const resizeObserver = new ResizeObserver(updateChartSize);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [chartData.length]);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      left: element.scrollWidth,
      behavior: "smooth",
    });
  }, [activeRange, chartData.length]);

  if (chartData.length < 2 || !Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return (
      <div className="chart_empty">
        Недостаточно данных для графика
      </div>
    );
  }

  const width = chartSize.width;
  const chartHeight = height - padding.top - padding.bottom;
  const chartWidth = width - padding.left - padding.right;
  const axisRight = width - padding.right;
  const rawRange = rawMax - rawMin;
  const visualPadding = rawRange > 0
    ? rawRange * 0.12
    : Math.max(Math.abs(rawMax) * 0.001, 1);
  const min = rawMin - visualPadding;
  const max = rawMax + visualPadding;
  const valueRange = max - min || 1;
  const getXByTime = (time, index) => {
    const timeMs = time?.getTime();

    if (hasTimeScale && Number.isFinite(timeMs)) {
      return padding.left + ((timeMs - minTime) / (maxTime - minTime)) * chartWidth;
    }

    return padding.left + (index / (chartData.length - 1)) * chartWidth;
  };
  const points = chartData.map((point, index) => {
    const x = getXByTime(point.time, index);
    const y = padding.top + (1 - ((point.close - min) / valueRange)) * chartHeight;

    const previousClose = index > 0 ? chartData[index - 1].close : point.open;
    const change = point.close - previousClose;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;

    return { ...point, x, y, change, changePercent };
  });
  const currentPriceY = clamp(padding.top + (
    1 - ((currentPriceNumber - min) / valueRange)
  ) * chartHeight, padding.top, height - padding.bottom);
  const hasCurrentPrice = Number.isFinite(currentPriceNumber);
  const linePath = getLinePath(points);
  const areaPath = `${linePath} L ${axisRight} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;
  const firstPrice = points[0].close;
  const lastPrice = points[points.length - 1].close;
  const color = lastPrice >= firstPrice ? "#00e0a4" : "#ff3b30";
  const gradientId = `asset-chart-gradient-${activeRange}`;
  const showTime = Boolean(CHART_RANGES[activeRange]?.showTime);
  const priceLabels = [max, max - valueRange * 0.25, (max + min) / 2, min + valueRange * 0.25, min];
  const gridLines = priceLabels.map((label) => {
    const y = padding.top + (1 - ((label - min) / valueRange)) * chartHeight;

    return { label, y };
  });
  const tickCount = Math.min(6, points.length);
  const dateLabels = Array.from({ length: tickCount }, (_, index) => {
    const pointIndex = Math.round((index / (tickCount - 1 || 1)) * (points.length - 1));

    return points[pointIndex];
  });
  const tooltipGoesLeft = hoveredPoint ? hoveredPoint.x > width - 226 : false;
  const tooltipTop = hoveredPoint
    ? Math.min(Math.max(hoveredPoint.y, 78), height - 64)
    : 0;
  const markerPoints = visibleTradeMarkers
    .map((marker) => {
      if (
        !marker.markerTime ||
        !Number.isFinite(marker.markerTimeMs) ||
        !hasTimeScale
      ) {
        return null;
      }

      const nearestPoint = points.reduce((nearest, point) => (
        Math.abs((point.time?.getTime() || 0) - marker.markerTimeMs) <
        Math.abs((nearest.time?.getTime() || 0) - marker.markerTimeMs)
          ? point
          : nearest
      ), points[0]);
      const markerValue = Number.isFinite(marker.markerPrice) ? marker.markerPrice : nearestPoint.close;
      const x = padding.left + ((marker.markerTimeMs - minTime) / (maxTime - minTime)) * chartWidth;
      const y = padding.top + (1 - ((markerValue - min) / valueRange)) * chartHeight;

      return {
        ...marker,
        markerValue,
        x: clamp(x, padding.left, axisRight),
        y: clamp(y, padding.top, height - padding.bottom),
      };
    })
    .filter(Boolean);
  const hiddenTradeMarkerCount = Math.max(preparedTradeMarkers.length - markerPoints.length, 0);
  const tradeTooltip = selectedTradeMarker && markerPoints.find((marker) => {
    const currentKey = marker.id || marker.executedAt;
    const selectedKey = selectedTradeMarker.id || selectedTradeMarker.executedAt;

    return currentKey && selectedKey
      ? currentKey === selectedKey
      : marker.executedAt === selectedTradeMarker.executedAt;
  });
  const tradeTooltipGoesLeft = tradeTooltip ? tradeTooltip.x > width - 236 : false;
  const tradeTooltipTop = tradeTooltip
    ? Math.min(Math.max(tradeTooltip.y, 82), height - 74)
    : 0;

  const updateHoveredPoint = (event) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const nearestPoint = points.reduce((nearest, point) => {
      return Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest;
    }, points[0]);

    setHoveredPoint(nearestPoint);
  };

  const startDrag = (event) => {
    if (!scrollRef.current) {
      return;
    }

    dragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: scrollRef.current.scrollLeft,
    };
    scrollRef.current.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    if (!dragRef.current.active || !scrollRef.current) {
      return;
    }

    const distance = event.clientX - dragRef.current.startX;
    scrollRef.current.scrollLeft = dragRef.current.scrollLeft - distance;
  };

  const stopDrag = (event) => {
    dragRef.current.active = false;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="asset_chart" ref={chartContainerRef}>
      <div
        className="asset_chart_scroll"
        ref={scrollRef}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerLeave={(event) => {
          stopDrag(event);
          setHoveredPoint(null);
          setSelectedTradeMarker(null);
        }}
      >
        <div className="asset_chart_inner" style={{ width, minWidth: width, height }}>
          <svg
            className="asset_chart_svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMinYMin meet"
            onPointerMove={updateHoveredPoint}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop stopColor={color} stopOpacity="0.2" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridLines.map((line) => (
              <line
                key={line.label}
                x1={padding.left}
                x2={axisRight}
                y1={line.y}
                y2={line.y}
                className="asset_chart_grid_line"
              />
            ))}
            {gridLines.map((line, index) => (
              <text
                key={`price-label-${line.label}-${index}`}
                x={axisRight + 8}
                y={line.y + 4}
                className="asset_chart_axis_label asset_chart_price_label"
              >
                {formatChartValue(line.label, currencySymbol, { compact: true })}
              </text>
            ))}
            {dateLabels.map((point, index) => (
              <text
                key={`date-label-${point?.time?.toISOString() || index}`}
                x={point?.x || padding.left}
                y={height - 9}
                className="asset_chart_axis_label asset_chart_date_label"
                textAnchor={index === 0 ? "start" : index === dateLabels.length - 1 ? "end" : "middle"}
              >
                {formatChartDate(point?.time, showTime)}
              </text>
            ))}
            {hasCurrentPrice && (
              <>
                <line
                  x1={padding.left}
                  x2={axisRight}
                  y1={currentPriceY}
                  y2={currentPriceY}
                  className="asset_chart_current_price_line"
                />
              </>
            )}
            <path className="asset_chart_area" d={areaPath} fill={`url(#${gradientId})`} />
            <path
              className="asset_chart_line"
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="1"
            />
            {markerPoints.map((marker, index) => {
              const isSell = String(marker.action || "").toLowerCase().includes("прод");
              const markerKey = `${marker.id || marker.executedAt || index}-marker`;
              const markerFill = isSell ? "#ff3b30" : "#10B981";

              return (
                <g
                  key={markerKey}
                  className={`asset_chart_trade_marker asset_chart_trade_marker_${isSell ? "sell" : "buy"}`}
                  role="button"
                  tabIndex="0"
                  aria-label={`${isSell ? "Продажа" : "Покупка"} ${formatNumber(marker.quantity, 8)} по ${formatMoney(marker.markerValue, currencySymbol)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTradeMarker(marker);
                  }}
                  onPointerEnter={() => {
                    setSelectedTradeMarker(marker);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedTradeMarker(marker);
                    }
                  }}
                >
                  <rect
                    x={marker.x - 5}
                    y={marker.y - 5}
                    width="10"
                    height="10.3704"
                    rx="5"
                    fill={markerFill}
                  />
                  <rect
                    x={marker.x - 4}
                    y={marker.y - 4}
                    width="8"
                    height="8.3704"
                    rx="4"
                    stroke="white"
                    strokeWidth="2"
                    fill="none"
                  />
                </g>
              );
            })}
            {hoveredPoint && !tradeTooltip && (
              <>
                <line
                  x1={hoveredPoint.x}
                  x2={hoveredPoint.x}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  className="asset_chart_hover_line"
                />
                <circle
                  cx={hoveredPoint.x}
                  cy={hoveredPoint.y}
                  r="5"
                  fill={color}
                  stroke="white"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>

          {hoveredPoint && !tradeTooltip && (
            <div
              className={`asset_chart_tooltip ${tooltipGoesLeft ? "asset_chart_tooltip_left" : ""}`}
              style={{
                left: tooltipGoesLeft ? hoveredPoint.x - 18 : hoveredPoint.x + 18,
                top: tooltipTop,
              }}
            >
              <p>{formatMoney(hoveredPoint.close, currencySymbol)}</p>
              <span>{formatChartDateTime(hoveredPoint.time)}</span>
              <div className="asset_chart_tooltip_grid">
                <span>O {formatChartValue(hoveredPoint.open, currencySymbol)}</span>
                <span>H {formatChartValue(hoveredPoint.high, currencySymbol)}</span>
                <span>L {formatChartValue(hoveredPoint.low, currencySymbol)}</span>
                <span>C {formatChartValue(hoveredPoint.close, currencySymbol)}</span>
              </div>
              <span style={{color}}>
                {formatSignedMoney(hoveredPoint.change, currencySymbol)} ({formatPercent(hoveredPoint.changePercent)})
              </span>
              {Number.isFinite(hoveredPoint.volume) && (
                <span>
                  Vol {hoveredPoint.volume.toLocaleString("ru-RU", {
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
            </div>
          )}
          {tradeTooltip && (
            <div
              className={`asset_chart_tooltip asset_chart_trade_tooltip ${tradeTooltipGoesLeft ? "asset_chart_tooltip_left" : ""}`}
              style={{
                left: tradeTooltipGoesLeft ? tradeTooltip.x - 18 : tradeTooltip.x + 18,
                top: tradeTooltipTop,
              }}
            >
              <p>{String(tradeTooltip.action || "").toLowerCase().includes("прод") ? "Продажа" : "Покупка"}</p>
              <span>{formatDateTime(tradeTooltip.executedAt)}</span>
              <div className="asset_chart_tooltip_grid">
                <span>Цена {formatMoney(tradeTooltip.markerValue, currencySymbol)}</span>
                <span>Кол-во {formatNumber(tradeTooltip.quantity, 8)}</span>
                <span>Сумма {formatMoney(tradeTooltip.totalAmount, currencySymbol)}</span>
                <span>{tradeTooltip.sourceLabel || tradeTooltip.source || "Pulse"}</span>
              </div>
            </div>
          )}
          {hiddenTradeMarkerCount > 0 ? (
            <div className="asset_chart_marker_notice">
              {hiddenTradeMarkerCount} сдел. вне выбранного диапазона
            </div>
          ) : null}
        </div>
      </div>
      {hasCurrentPrice && (
        <span
          className="asset_chart_fixed_price"
          style={{ top: `${clamp((currentPriceY / height) * 100, 7, 93)}%` }}
        >
          {formatChartValue(currentPriceNumber, currencySymbol)}
        </span>
      )}
    </div>
  );
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseOrderbookNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(String(value).replace(",", "."));

  return Number.isFinite(number) ? number : null;
};

const normalizeOrderbookRow = (row) => {
  if (Array.isArray(row)) {
    const price = parseOrderbookNumber(row[0]);
    const quantity = parseOrderbookNumber(row[1]);

    return price && quantity ? { price, quantity } : null;
  }

  if (!row || typeof row !== "object") {
    return null;
  }

  const price = parseOrderbookNumber(
    row.price ?? row.PRICE ?? row.Price ?? row.p
  );
  const quantity = parseOrderbookNumber(
    row.quantity ?? row.QUANTITY ?? row.qty ?? row.QTY ?? row.volume ?? row.VOLUME ?? row.size
  );

  return price && quantity ? { price, quantity } : null;
};

const getOrderbookSide = (row, currentPrice) => {
  const rawSide = String(
    row?.side ?? row?.SIDE ?? row?.BUYSELL ?? row?.buySell ?? row?.type ?? ""
  ).toLowerCase();

  if (["buy", "bid", "b", "покупка"].some((side) => rawSide.includes(side))) {
    return "bid";
  }

  if (["sell", "ask", "s", "продажа"].some((side) => rawSide.includes(side))) {
    return "ask";
  }

  const normalizedRow = normalizeOrderbookRow(row);

  if (!normalizedRow || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  return normalizedRow.price <= currentPrice ? "bid" : "ask";
};

const normalizeOrderbook = (asset, currentPrice) => {
  const rawOrderbook = asset?.orderbook;
  const bidsSource = rawOrderbook?.b || rawOrderbook?.bids || rawOrderbook?.bid || [];
  const asksSource = rawOrderbook?.a || rawOrderbook?.asks || rawOrderbook?.ask || [];
  let bids = [];
  let asks = [];

  if (Array.isArray(bidsSource) || Array.isArray(asksSource)) {
    bids = (Array.isArray(bidsSource) ? bidsSource : [])
      .map(normalizeOrderbookRow)
      .filter(Boolean);
    asks = (Array.isArray(asksSource) ? asksSource : [])
      .map(normalizeOrderbookRow)
      .filter(Boolean);
  }

  if (!bids.length && !asks.length && Array.isArray(rawOrderbook)) {
    rawOrderbook.forEach((row) => {
      const normalizedRow = normalizeOrderbookRow(row);
      const side = getOrderbookSide(row, currentPrice);

      if (!normalizedRow || !side) {
        return;
      }

      if (side === "bid") {
        bids.push(normalizedRow);
      } else {
        asks.push(normalizedRow);
      }
    });
  }

  const bidPrice = parseOrderbookNumber(asset?.bidPrice);
  const askPrice = parseOrderbookNumber(asset?.askPrice);
  const fallbackQuantity = Math.max(parseOrderbookNumber(asset?.volume24h) || 0, 1);

  if (!bids.length && bidPrice) {
    bids = [{ price: bidPrice, quantity: fallbackQuantity }];
  }

  if (!asks.length && askPrice) {
    asks = [{ price: askPrice, quantity: fallbackQuantity }];
  }

  bids = bids
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.quantity))
    .sort((firstRow, secondRow) => secondRow.price - firstRow.price)
    .slice(0, 12);

  asks = asks
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.quantity))
    .sort((firstRow, secondRow) => firstRow.price - secondRow.price)
    .slice(0, 12);

  const totalBid = bids.reduce((sum, row) => sum + row.quantity, 0);
  const totalAsk = asks.reduce((sum, row) => sum + row.quantity, 0);

  return {
    bids,
    asks,
    totalBid,
    totalAsk,
    hasRows: Boolean(bids.length || asks.length),
  };
};

function OrderBook({ orderbook, currentPrice, currencySymbol, baseCurrency, quoteCurrency }) {
  const asks = orderbook.asks.slice(0, 7);
  const bids = orderbook.bids.slice(0, 7);
  const maxQuantity = Math.max(
    ...asks.map((row) => row.quantity),
    ...bids.map((row) => row.quantity),
    1
  );

  const renderRows = (rows, keyPrefix, field, side) => {
    const filledRows = rows.length
      ? rows
      : Array.from({ length: 7 }, () => null);

    return filledRows.slice(0, 7).map((row, index) => {
      const depth = row
        ? clamp((row.quantity / maxQuantity) * 100, 5, 100)
        : 0;
      const isPriceField = field === "price";

      return (
        <p
          key={`${keyPrefix}-${row?.price || index}`}
          className={isPriceField ? `glass_depth_row glass_depth_row_${side}` : ""}
          style={isPriceField ? { "--depth": `${depth}%` } : undefined}
        >
          {row
            ? isPriceField
              ? formatChartValue(row.price, currencySymbol)
              : formatNumber(row.quantity, 6)
            : "-"}
        </p>
      );
    });
  };

  return (
    <div className="GlassOfBuySell">
      <div className="priceUpGlass">
        <div className="priceBorder">
          <p>{formatChartValue(currentPrice, currencySymbol)}</p>
        </div>
        <p className="orderbook_rub_price">
          {formatRubleEquivalent(currentPrice, quoteCurrency)}
        </p>
      </div>

      {!orderbook.hasRows ? (
        <p className="orderbook_empty_message">
          Стакан сейчас пуст или недоступен. Для акций это часто происходит вне торговой сессии биржи.
        </p>
      ) : null}

      <div className="glassSellBuy">
        <div className="buyGlass">
          <div className="QTYBTC">
            <p style={{ opacity: 0.5 }}>QTY({baseCurrency})</p>
            {renderRows(bids, "bid-qty", "quantity", "bid")}
          </div>
          <div className="PriceUSDC">
            <h5 style={{ opacity: 0.5 }}>Price({quoteCurrency})</h5>
            {renderRows(bids, "bid-price", "price", "bid")}
          </div>
        </div>
        <div className="lineHeight"></div>
        <div className="sellGlass">
          <div className="PriceUSDCSell">
            <h5 style={{ opacity: 0.5 }}>Price({quoteCurrency})</h5>
            {renderRows(asks, "ask-price", "price", "ask")}
          </div>
          <div className="QTYBTC">
            <p style={{ opacity: 0.5 }}>QTY({baseCurrency})</p>
            {renderRows(asks, "ask-qty", "quantity", "ask")}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniSparkline({ data }) {
  const width = 100;
  const height = 30;
  const padding = 2;
  const pointsData = (Array.isArray(data) ? data : [])
    .map((point) => ({
      close: Number(point.close),
      time: getPointTime(point),
    }))
    .filter((point) => Number.isFinite(point.close))
    .sort((firstPoint, secondPoint) => {
      const firstTime = firstPoint.time?.getTime() || 0;
      const secondTime = secondPoint.time?.getTime() || 0;

      return firstTime - secondTime;
    });

  if (pointsData.length < 2) {
    return <span className="mini_sparkline_empty" />;
  }

  const min = Math.min(...pointsData.map((point) => point.close));
  const max = Math.max(...pointsData.map((point) => point.close));
  const valueRange = max - min || 1;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const points = pointsData.map((point, index) => {
    const x = padding + (index / (pointsData.length - 1)) * chartWidth;
    const y = padding + (1 - ((point.close - min) / valueRange)) * chartHeight;

    return { x, y, close: point.close };
  });
  const path = getLinePath(points);
  const firstClose = points[0].close;
  const lastPoint = points[points.length - 1];
  const color = lastPoint.close >= firstClose ? "#00e0a4" : "#ff3b30";

  return (
    <span className="mini_sparkline">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="4"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

function CoinPageHeroLoader() {
  return (
    <div className="coin_page_loader_hero" aria-hidden="true">
      <div className="coin_page_loader_hero_top">
        <LoaderAnimation height={36} rounded="12px" />
        <LoaderAnimation height={36} rounded="12px" />
      </div>
      <div className="coin_page_loader_hero_main">
        <LoaderAnimation className="coin_page_loader_icon" height={96} rounded="50%" />
        <div className="coin_page_loader_hero_text">
          <LoaderAnimation height={58} rounded="18px" />
          <LoaderAnimation height={74} rounded="18px" />
        </div>
        <div className="coin_page_loader_actions">
          <LoaderAnimation height={48} rounded="999px" />
          <LoaderAnimation height={48} rounded="999px" />
          <LoaderAnimation height={48} rounded="999px" />
        </div>
      </div>
    </div>
  );
}

function CoinPageOverviewLoader() {
  return (
    <div className="coin_page_overview_loader" aria-hidden="true">
      <div className="coin_page_loader_chart_side">
        <div className="coin_page_loader_controls">
          <LoaderAnimation height={56} rounded="16px" />
          <LoaderAnimation height={56} rounded="16px" />
        </div>
        <LoaderAnimation className="coin_page_loader_chart" height={370} rounded="18px" />
      </div>
      <div className="coin_page_loader_info_side">
        <LoaderAnimation height={260} rounded="18px" />
        <LoaderAnimation height={210} rounded="18px" />
      </div>
    </div>
  );
}

export default function CoinPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const assetTypeParam = (searchParams.get("type") || "").toLowerCase();
  const symbol = searchParams.get("symbol") || "";
  const figiParam = searchParams.get("figi") || "";
  const isCurrencyAssetParam = assetTypeParam === "currency";
  const isStockAsset = assetTypeParam === "stock"
    || assetTypeParam === "stocks"
    || (!assetTypeParam && symbol && !symbol.toUpperCase().endsWith("USDT"));
  const assetType = isStockAsset ? "stock" : isCurrencyAssetParam ? "currency" : "crypto";
  const [requestState, setRequestState] = useState({
    endpoint: null,
    asset: null,
    error: "",
  });
  const [activeChartRange, setActiveChartRange] = useState("5D");
  const [chartState, setChartState] = useState({
    key: "",
    data: [],
    isLoading: false,
  });
  const [favorites, setFavorites] = useState(getInitialFavorites);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const activeEndpointRef = useRef(null);
  const isRequestRunningRef = useRef(false);
  const isCoinPageRoute = location.pathname.endsWith("/market/coin-page");

  const [textAlert, setTesxtAlert] = useState(false);
  const [tradeSuccessAlert, setTradeSuccessAlert] = useState(null);
  const [isTradeDrawerOpen, setIsTradeDrawerOpen] = useState(false);
  const [tradeSide, setTradeSide] = useState("buy");
  const [tradeAmount, setTradeAmount] = useState("");
  const [assetNews, setAssetNews] = useState([]);
  const [isAssetNewsLoading, setIsAssetNewsLoading] = useState(false);
  const [assetNewsError, setAssetNewsError] = useState("");
  const [assetTradeMarkers, setAssetTradeMarkers] = useState([]);
	  const [aiScoreState, setAiScoreState] = useState({
	    key: "",
	    data: null,
	    isLoading: false,
	  });
  const [aiSummaryState, setAiSummaryState] = useState({
    key: "",
    title: "Сводка GPT",
    text: "",
    isLoading: false,
    error: "",
  });
  const [stockTradingStatus, setStockTradingStatus] = useState(null);
  const [seenNewsIds, setSeenNewsIds] = useState(() => readCachedValue(NEWS_SEEN_KEY, Infinity) || []);
  const [portfolioSummary, setPortfolioSummary] = useState(
    () => readCachedValue(TRADE_PORTFOLIO_CACHE_KEY, ASSET_CACHE_MAX_AGE) || null
  );
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(!portfolioSummary);
  const [tradeState, setTradeState] = useState({
    isSubmitting: false,
    message: "",
    error: "",
  });
  const [activeButton, setActiveButton] = useState('Обзор');
  const isOverviewTab = activeButton === "Обзор";

	  const endpoint = useMemo(() => {
    if (!symbol) {
      return null;
    }

    if (assetType === "currency") {
      return `stable:${symbol.toUpperCase()}`;
    }

	    if (assetType === "stock") {
	      const stockParams = new URLSearchParams();

	      if (figiParam) {
	        stockParams.set("figi", figiParam);
	      }

	      return `/portfolio/tbank/stocks/${encodeURIComponent(symbol)}${stockParams.toString() ? `?${stockParams.toString()}` : ""}`;
	    }

    if (STABLE_CRYPTO_SYMBOLS.has(symbol.toUpperCase())) {
      return `stable:${symbol.toUpperCase()}`;
    }

    return `/cryptocurrencies/${symbol}`;
	  }, [assetType, figiParam, symbol]);

  const fetchAsset = useCallback((targetEndpoint) => {
    if (
      !targetEndpoint ||
      !isCoinPageRoute ||
      activeEndpointRef.current !== targetEndpoint
    ) {
      return;
    }

    if (targetEndpoint.startsWith("stable:")) {
        const stableSymbol = targetEndpoint.replace("stable:", "").toUpperCase();
      const isRubStable = stableSymbol === "RUB" || stableSymbol === "RUR";
      setRequestState({
        endpoint: targetEndpoint,
        asset: {
          id: stableSymbol,
          symbol: stableSymbol,
          name: STABLE_CRYPTO_NAMES[stableSymbol] || stableSymbol,
          shortName: stableSymbol,
          baseCoin: stableSymbol,
          quoteCoin: isRubStable ? "RUB" : "USD",
          iconUrl: stableSymbol === "USDT"
            ? "https://cryptologos.cc/logos/tether-usdt-logo.svg"
            : null,
          price: 1,
          priceChangePercent24h: 0,
          priceChangePercent7d: 0,
          priceChangePercent30d: 0,
          chart7d: [],
          orderbook: { bids: [], asks: [] },
          isStableAsset: true,
          isCurrencyAsset: isRubStable || stableSymbol === "USD",
        },
        error: "",
      });
      return;
    }

    if (isRequestRunningRef.current) {
      return;
    }

    const cachedAsset = readCachedValue(assetCacheKey(targetEndpoint), ASSET_CACHE_MAX_AGE);

    if (cachedAsset) {
      setRequestState({
        endpoint: targetEndpoint,
        asset: cachedAsset,
        error: "",
      });
    }

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;

    requestControllerRef.current = controller;
    requestIdRef.current = requestId;
    isRequestRunningRef.current = true;

    api
      .get(targetEndpoint, { signal: controller.signal })
      .then((response) => {
        if (
          requestId !== requestIdRef.current ||
          activeEndpointRef.current !== targetEndpoint
        ) {
          return;
        }

        setRequestState({
          endpoint: targetEndpoint,
          asset: response.data,
          error: "",
        });
        writeCachedValue(assetCacheKey(targetEndpoint), response.data);
      })
      .catch((requestError) => {
        if (requestError.code === "ERR_CANCELED") {
          return;
        }

        if (
          requestId !== requestIdRef.current ||
          activeEndpointRef.current !== targetEndpoint
        ) {
          return;
        }

        if (targetEndpoint.startsWith("/portfolio/tbank/stocks/") && symbol) {
          return api
            .get(`/stocks/${symbol}`, { signal: controller.signal })
            .then((fallbackResponse) => {
              if (
                requestId !== requestIdRef.current ||
                activeEndpointRef.current !== targetEndpoint
              ) {
                return;
              }

              setRequestState({
                endpoint: targetEndpoint,
                asset: fallbackResponse.data,
                error: "",
              });
              writeCachedValue(assetCacheKey(targetEndpoint), fallbackResponse.data);
            })
            .catch(() => {
              setRequestState((currentState) => ({
                endpoint: targetEndpoint,
                asset: currentState.asset,
                error: currentState.asset
                  ? "Данные временно не обновились"
                  : "Не удалось загрузить актив",
              }));
            });
        }

        setRequestState((currentState) => ({
          endpoint: targetEndpoint,
          asset: currentState.asset,
          error: currentState.asset
            ? "Данные временно не обновились"
            : "Не удалось загрузить актив",
        }));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          isRequestRunningRef.current = false;
        }
      });
  }, [isCoinPageRoute, symbol]);

  useEffect(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    requestControllerRef.current?.abort();
    requestIdRef.current += 1;
    isRequestRunningRef.current = false;
    activeEndpointRef.current = endpoint;

    if (!isCoinPageRoute) {
      activeEndpointRef.current = null;
      return;
    }

    const initialFetchTimer = window.setTimeout(() => fetchAsset(endpoint), 0);

    const refreshInterval = isOverviewTab
      ? ASSET_REFRESH_INTERVAL
      : ASSET_BACKGROUND_REFRESH_INTERVAL;
    const interval = setInterval(() => {
      if (
        document.hidden ||
        !isCoinPageRoute ||
        activeEndpointRef.current !== endpoint
      ) {
        return;
      }

      fetchAsset(endpoint);
    }, refreshInterval);

    pollingIntervalRef.current = interval;

    return () => {
      window.clearTimeout(initialFetchTimer);
      clearInterval(interval);
      if (pollingIntervalRef.current === interval) {
        pollingIntervalRef.current = null;
      }
      requestControllerRef.current?.abort();
      requestIdRef.current += 1;
      isRequestRunningRef.current = false;
    };
  }, [endpoint, fetchAsset, isCoinPageRoute, isOverviewTab]);

  const asset = requestState.endpoint === endpoint ? requestState.asset : null;
  const error = !endpoint
    ? "Актив не найден"
    : requestState.endpoint === endpoint
      ? requestState.error
      : "";
  const isLoading = Boolean(endpoint && requestState.endpoint !== endpoint);
  const isBlockingError = Boolean(error && !asset);
  const isStock = assetType === "stock";
  const isCurrency = assetType === "currency" || asset?.isCurrencyAsset || asset?.assetType === "currency";
  const assetName = asset?.name || asset?.baseCoin || symbol;
  const shortName = asset?.shortName || asset?.baseCoin || asset?.symbol || symbol;
  const pageTitleName = isStock ? shortName : assetName;
  const pageSubtitleSymbol = isStock ? asset?.symbol || symbol : shortName;
  const quoteCurrency = isStock ? "RUB" : isCurrency ? asset?.quoteCoin || shortName : asset?.quoteCoin || "USD";
  const tradeQuoteCurrency = isStock ? "RUB" : "USDT";
  const baseCurrency = isStock ? shortName : asset?.baseCoin || shortName;
  const currencySymbol = isStock || baseCurrency === "RUB" || quoteCurrency === "RUB" ? "₽" : "$";
  const price = formatMoney(asset?.price, currencySymbol);
  const changePercent = Number(asset?.priceChangePercent24h) || 0;
  const currentPrice = Number(asset?.price) || 0;
  const previousPrice = changePercent === -100
    ? 0
    : currentPrice / (1 + changePercent / 100);
  const todayChange = currentPrice - previousPrice;
  const todayChangeText = `${formatSignedMoney(todayChange, currencySymbol)} (${formatPercent(changePercent)})`;
  const orderbook = useMemo(() => {
    return normalizeOrderbook(asset, currentPrice);
  }, [asset, currentPrice]);
  const sentiment = asset?.sentiment || asset?.mood;
  const derivedSentiment = useMemo(() => {
    const directPositive = Number(sentiment?.positive ?? sentiment?.bullish);
    const directNegative = Number(sentiment?.negative ?? sentiment?.bearish);

    if (Number.isFinite(directPositive) && Number.isFinite(directNegative)) {
      const total = directPositive + directNegative || 100;
      const positive = Math.round((directPositive / total) * 100);

      return {
        positive: clamp(positive, 0, 100),
        negative: clamp(100 - positive, 0, 100),
      };
    }

    const totalDepth = orderbook.totalBid + orderbook.totalAsk;
    const depthBias = totalDepth
      ? ((orderbook.totalBid - orderbook.totalAsk) / totalDepth) * 24
      : 0;
    const momentumBias = clamp(changePercent * 1.8, -24, 24);
    const positive = Math.round(clamp(50 + depthBias + momentumBias, 5, 95));

    return {
      positive,
      negative: 100 - positive,
    };
  }, [changePercent, orderbook, sentiment]);
  const positiveMood = derivedSentiment.positive;
  const negativeMood = derivedSentiment.negative;
  const hasMood = Boolean(asset);
  const tradeWallet = useMemo(() => {
    const targetProvider = isStock ? "tbank" : "bybit";

    return (portfolioSummary?.wallets || []).find(
      (wallet) => wallet.provider === targetProvider && wallet.status === "active"
    );
  }, [isStock, portfolioSummary]);
  const walletAssets = tradeWallet?.assets || [];
  const normalizedBaseCurrency = String(baseCurrency || "").toUpperCase();
  const quoteAsset = walletAssets.find((item) => {
    const assetSymbol = String(item.symbol || item.shortName || item.coin || "").toUpperCase();
    const assetType = String(item.type || "").toLowerCase();

    return isStock
      ? assetSymbol === "RUB" || assetType === "currency"
      : assetSymbol === "USDT" || assetSymbol === "USDC";
  });
	  const positionAsset = walletAssets.find((item) => {
	    const assetSymbol = String(item.symbol || item.shortName || item.coin || "").toUpperCase();
	    const routeSymbol = String(item.routeSymbol || "").toUpperCase();
	    const itemFigi = String(item.figi || item.id || "").toUpperCase();
	    const pageSymbol = String(asset?.symbol || symbol).toUpperCase();
	    const pageFigi = String(asset?.figi || figiParam || asset?.id || "").toUpperCase();

    return assetSymbol === normalizedBaseCurrency
      || assetSymbol === pageSymbol
      || routeSymbol === pageSymbol
      || (pageFigi && itemFigi === pageFigi);
  });
  const availableMoneyRaw = isStock
    ? quoteAsset?.valueRub
    : quoteAsset?.valueUsd ?? quoteAsset?.currentPriceUsd;
  const availableMoney = Number.isFinite(Number(availableMoneyRaw))
    ? Number(availableMoneyRaw)
    : 0;
  const availableAssetAmountRaw = positionAsset?.availableQuantity ?? positionAsset?.quantity;
  const availableAssetAmount = Number.isFinite(Number(availableAssetAmountRaw))
    ? Number(availableAssetAmountRaw)
    : 0;
  const hasTradeWallet = Boolean(tradeWallet);
  const tradeAmountNumber = Number(String(tradeAmount).replace(",", "."));
  const normalizedTradeAmount = Number.isFinite(tradeAmountNumber) ? Math.max(tradeAmountNumber, 0) : 0;
  const stockLotSize = Math.max(Number(asset?.lotSize || asset?.lot || 1) || 1, 1);
  const stockLotValue = currentPrice * stockLotSize;
  const normalizedTradeLots = Math.floor(normalizedTradeAmount);
  const isStockLotInputInvalid = isStock && normalizedTradeAmount > 0 && normalizedTradeAmount !== normalizedTradeLots;
  const cryptoTradingPair = isStock ? "" : `${String(asset?.baseCoin || baseCurrency).toUpperCase()}/${tradeQuoteCurrency}`;
  const cryptoMinOrderAmount = !isStock
    ? Number(asset?.minOrderAmount || asset?.minNotionalValue || 5)
    : 0;
  const cryptoMinSellQuantity = !isStock && currentPrice > 0 && cryptoMinOrderAmount > 0
    ? cryptoMinOrderAmount / currentPrice
    : 0;
  const estimatedTradeQuantity = isStock
    ? normalizedTradeLots * stockLotSize
    : tradeSide === "sell"
      ? normalizedTradeAmount
      : currentPrice > 0
      ? normalizedTradeAmount / currentPrice
      : 0;
  const estimatedTradeValue = estimatedTradeQuantity * currentPrice;
  const maxBuyLots = currentPrice > 0
    ? Math.floor(availableMoney / (currentPrice * stockLotSize))
    : 0;
  const maxSellLots = Math.floor(availableAssetAmount / stockLotSize);
  const stockBuyShortfall = Math.max(stockLotValue - availableMoney, 0);
  const tradeButtonText = tradeSide === "buy"
    ? `Купить ${shortName}`
    : `Продать ${shortName}`;
  const maxTradeAmount = isStock
    ? tradeSide === "buy"
      ? maxBuyLots
      : maxSellLots
    : tradeSide === "buy"
      ? availableMoney
      : availableAssetAmount;
  const tradeAmountError = (() => {
    if (isPortfolioLoading && !portfolioSummary) {
      return "Загружаем баланс";
    }

    if (!hasTradeWallet) {
      return `Подключите ${isStock ? "Т-Банк" : "Bybit"} в настройках`;
    }

    if (!isStock && asset?.isStableAsset) {
      return `${baseCurrency} используется как расчетная валюта. Для сделки откройте торговую пару, например BTC/USDT.`;
    }

    if (isStockLotInputInvalid) {
      return "Введите целое количество лотов";
    }

    if (isStock && tradeSide === "buy" && normalizedTradeLots > maxBuyLots) {
      if (maxBuyLots <= 0 && stockLotValue > 0) {
        return `Для покупки 1 лота нужно примерно ${formatMoney(stockLotValue, currencySymbol)}. Сейчас доступно ${formatMoney(availableMoney, currencySymbol)}, не хватает ${formatMoney(stockBuyShortfall, currencySymbol)}.`;
      }

      return "Количество больше доступных лотов";
    }

    if (isStock && tradeSide === "sell" && normalizedTradeLots > maxSellLots) {
      return "Количество больше позиции";
    }

    if (!isStock && tradeSide === "buy" && normalizedTradeAmount > availableMoney) {
      return "Сумма больше доступных средств";
    }

    if (!isStock && tradeSide === "sell" && cryptoMinOrderAmount > 0 && estimatedTradeValue > 0 && estimatedTradeValue < cryptoMinOrderAmount) {
      return `Минимальная продажа для ${cryptoTradingPair} — ${formatMoney(cryptoMinOrderAmount, currencySymbol)}. Нужно примерно ${formatNumber(cryptoMinSellQuantity, 8)} ${baseCurrency}.`;
    }

    if (!isStock && tradeSide === "sell" && normalizedTradeAmount > availableAssetAmount) {
      return "Количество больше позиции";
    }

    return "";
  })();
  const tradeAvailabilityHint = (() => {
    if (!hasTradeWallet || isPortfolioLoading || tradeAmountError) {
      return "";
    }

    if (isStock && tradeSide === "buy" && currentPrice > 0 && maxBuyLots <= 0) {
      return `Минимальная покупка — 1 лот (${stockLotSize} шт.) примерно за ${formatMoney(stockLotValue, currencySymbol)}. Сейчас доступно ${formatMoney(availableMoney, currencySymbol)}, не хватает ${formatMoney(stockBuyShortfall, currencySymbol)}.`;
    }

    if (isStock && tradeSide === "sell" && maxSellLots <= 0) {
      return `Для продажи нужен минимум 1 полный лот (${stockLotSize} шт.). В позиции сейчас ${formatNumber(availableAssetAmount, 8)} ${baseCurrency}.`;
    }

    if (!isStock && tradeSide === "buy" && availableMoney <= 0) {
      return `Для покупки нужен свободный баланс ${tradeQuoteCurrency} на подключенном Bybit-аккаунте.`;
    }

    if (!isStock && tradeSide === "sell" && availableAssetAmount <= 0) {
      return `Для продажи нужен свободный баланс ${baseCurrency} на подключенном Bybit-аккаунте.`;
    }

    if (!isStock && tradeSide === "sell" && cryptoMinOrderAmount > 0 && availableAssetAmount > 0 && availableAssetAmount * currentPrice < cryptoMinOrderAmount) {
      return `Вся позиция меньше минимума Bybit: доступно ${formatNumber(availableAssetAmount, 8)} ${baseCurrency}, нужно примерно ${formatNumber(cryptoMinSellQuantity, 8)} ${baseCurrency}.`;
    }

    return "";
  })();
  const assetNewsAliases = useMemo(() => {
    return getAssetNewsAliases(asset, symbol, shortName, assetName, baseCurrency);
  }, [asset, assetName, baseCurrency, shortName, symbol]);
  const assetNewsAliasSignature = assetNewsAliases.join("|");
  const favoriteSymbol = asset?.symbol || symbol;
  const assetNewsKey = `${assetType}:${String(favoriteSymbol || symbol || "").toUpperCase()}`;
  const favoriteKey = `${assetType}:${String(favoriteSymbol || "").toUpperCase()}`;
  const isFavoriteAsset = favorites.some((item) => item.favoriteKey === favoriteKey);
  const isStockExchangeClosed = Boolean(
    isStock &&
    stockTradingStatus &&
    (!stockTradingStatus.isOpen ||
      !stockTradingStatus.isMarketOrderAvailable ||
      !stockTradingStatus.isApiTradeAvailable)
  );

  const toggleFavorite = useCallback(() => {
    if (!asset || !favoriteSymbol) {
      return;
    }

    const favoriteAsset = {
      favoriteKey,
      type: assetType,
      id: asset.id,
      symbol: favoriteSymbol,
      name: asset.name || assetName,
      shortName: asset.shortName || asset.baseCoin || asset.symbol || shortName,
      baseCoin: asset.baseCoin || asset.symbol || favoriteSymbol,
      iconUrl: asset.iconUrl,
      price: asset.price,
      priceChangePercent24h: asset.priceChangePercent24h,
      priceChangePercent7d: asset.priceChangePercent7d,
      priceChangePercent30d: asset.priceChangePercent30d,
      chart7d: asset.chart7d || [],
    };

    setFavorites((currentFavorites) => {
      const isAlreadyFavorite = currentFavorites.some(
        (item) => item.favoriteKey === favoriteKey
      );
      const nextFavorites = isAlreadyFavorite
        ? currentFavorites.filter((item) => item.favoriteKey !== favoriteKey)
        : [favoriteAsset, ...currentFavorites];

      localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        JSON.stringify(nextFavorites)
      );

      return nextFavorites;
    });
  }, [
    asset,
    assetName,
    assetType,
    favoriteKey,
    favoriteSymbol,
    shortName,
  ]);

  const markNewsAsSeen = useCallback((newsId) => {
    if (!newsId) {
      return;
    }

    setSeenNewsIds((currentIds) => {
      if (currentIds.includes(newsId)) {
        return currentIds;
      }

      const nextIds = [newsId, ...currentIds].slice(0, 300);
      writeCachedValue(NEWS_SEEN_KEY, nextIds);

      return nextIds;
    });
  }, []);

  const getRightColor = (value) => {
    if (value < 0) return 'var(--red)';
    if (value > 0) return 'var(--green)';
    return 'gray'; 
  };

  const fetchPortfolioSummary = useCallback(({ forceRefresh = false } = {}) => {
    setIsPortfolioLoading(true);

    return api.get("/portfolio/summary", {
      params: forceRefresh ? { force_refresh: true } : undefined,
    })
      .then((response) => {
        setPortfolioSummary(response.data);
        writeCachedValue(TRADE_PORTFOLIO_CACHE_KEY, response.data);

        return response.data;
      })
      .catch(() => {
        setPortfolioSummary((currentSummary) => currentSummary);
        return null;
      })
      .finally(() => {
        setIsPortfolioLoading(false);
      });
  }, []);

  const loadAssetTradeMarkers = useCallback(() => {
    if (!asset || !symbol) {
      setAssetTradeMarkers([]);
      return;
    }

	    const routeType = isStock ? "stock" : "crypto";
	    const matches = new Set([
	      String(symbol || "").toUpperCase(),
	      String(asset.symbol || "").toUpperCase(),
	      String(asset.baseCoin || "").toUpperCase(),
	      String(figiParam || "").toUpperCase(),
	      String(asset.figi || asset.id || "").toUpperCase(),
	    ].filter(Boolean));

    if (!isStock) {
      const base = String(asset.baseCoin || symbol || "").replace(/USDT$/i, "").toUpperCase();
      if (base) {
        matches.add(base);
        matches.add(`${base}USDT`);
      }
    }

    api.get("/portfolio/trades")
      .then((response) => {
        const markers = (response.data?.items || [])
          .filter((item) => {
            const itemType = String(item.assetType || "").toLowerCase();
            const itemSymbols = [
              item.symbol,
              item.routeSymbol,
              item.figi,
            ].map((value) => String(value || "").toUpperCase());

            return itemType === routeType && itemSymbols.some((value) => matches.has(value));
          })
          .slice(0, 40);

        setAssetTradeMarkers(markers);
      })
      .catch(() => {
        setAssetTradeMarkers([]);
      });
  }, [asset, figiParam, isStock, symbol]);

  const loadStockTradingStatus = useCallback(() => {
    if (!isStock || !hasTradeWallet || !asset) {
      setStockTradingStatus(null);
      return;
    }

    api.get("/portfolio/tbank/trading-status", {
      params: {
        symbol: asset.symbol || symbol,
        figi: asset.figi || figiParam || undefined,
      },
    })
      .then((response) => {
        setStockTradingStatus(response.data);
      })
      .catch(() => {
        setStockTradingStatus(null);
      });
  }, [asset, figiParam, hasTradeWallet, isStock, symbol]);

  const setTradeAmountPercent = useCallback((percent) => {
    const nextAmount = maxTradeAmount * percent;

    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setTradeAmount("");
      setTradeState({ isSubmitting: false, message: "", error: "" });
      return;
    }

    setTradeAmount(isStock
      ? String(Math.max(Math.floor(nextAmount), 1))
      : tradeSide === "sell"
        ? formatTradeInputValue(nextAmount, 8)
        : formatTradeInputValue(nextAmount, 2)
    );
    setTradeState({ isSubmitting: false, message: "", error: "" });
  }, [isStock, maxTradeAmount, tradeSide]);

  const submitTrade = useCallback(() => {
    const canSubmitStock = isStock && normalizedTradeLots > 0;
    const canSubmitCrypto = !isStock && normalizedTradeAmount > 0;

    if (tradeAmountError || (!canSubmitStock && !canSubmitCrypto) || !asset || currentPrice <= 0) {
      return;
    }

    setTradeState({
      isSubmitting: true,
      message: "",
      error: "",
    });

    const normalizedSymbol = String(asset.symbol || symbol || "").trim().toUpperCase();
    const tradePayload = {
      asset_type: assetType,
      symbol: normalizedSymbol,
      side: tradeSide,
      ...(isStock
        ? { lots: normalizedTradeLots }
        : tradeSide === "buy"
          ? { amount: normalizedTradeAmount }
          : { quantity: normalizedTradeAmount }),
      price: currentPrice,
      asset_name: String(assetName || shortName || normalizedSymbol).slice(0, 120),
    };

	    if (isStock) {
	      const figi = String(asset.figi || figiParam || "").trim();

      if (figi) {
        tradePayload.figi = figi.slice(0, 64);
      }
    }

    api.post("/portfolio/trade", tradePayload)
      .then((response) => {
        const quantity = Number(response.data?.quantity);
        const lots = Number(response.data?.lots);
        const quantityText = isStock && Number.isFinite(lots)
          ? `${formatNumber(lots, 0)} лот. (${formatNumber(quantity, 8)} ${baseCurrency})`
          : Number.isFinite(quantity)
          ? `${formatNumber(quantity, 8)} ${baseCurrency}`
          : baseCurrency;

        setTradeState({
          isSubmitting: false,
          message: `${response.data?.message || "Заявка отправлена."} Количество: ${quantityText}`,
          error: "",
        });
        setTradeSuccessAlert({
          title: tradeSide === "buy" ? "Покупка отправлена" : "Продажа отправлена",
          text: `${response.data?.message || "Заявка отправлена."} ${quantityText}`,
        });
        setIsTradeDrawerOpen(false);
        setActiveButton("Депозиты");
        setTradeAmount("");
        fetchAsset(endpoint);
	        fetchPortfolioSummary({ forceRefresh: true });
        loadAssetTradeMarkers();
      })
      .catch((error) => {
        setTradeState({
          isSubmitting: false,
          message: "",
          error: getApiErrorText(error),
        });
      });
  }, [
    asset,
    assetName,
    assetType,
    baseCurrency,
    currentPrice,
    endpoint,
	    fetchAsset,
	    fetchPortfolioSummary,
	    figiParam,
    isStock,
    loadAssetTradeMarkers,
    normalizedTradeAmount,
    normalizedTradeLots,
    shortName,
    symbol,
    tradeAmountError,
    tradeSide,
  ]);

  useEffect(() => {
    if (!tradeSuccessAlert) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setTradeSuccessAlert(null);
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [tradeSuccessAlert]);

  useEffect(() => {
    const timer = window.setTimeout(fetchPortfolioSummary, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchPortfolioSummary]);

  useEffect(() => {
    const timer = window.setTimeout(loadAssetTradeMarkers, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadAssetTradeMarkers]);

  useEffect(() => {
    const timer = window.setTimeout(loadStockTradingStatus, 0);
    const interval = window.setInterval(loadStockTradingStatus, 120000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [loadStockTradingStatus]);

  useEffect(() => {
    if (activeButton !== "Новости" || !assetNewsKey || !assetNewsAliasSignature) {
      return undefined;
    }

    const aliases = assetNewsAliasSignature.split("|").filter(Boolean);
    const cachedNews = readCachedValue(assetNewsCacheKey(assetNewsKey), ASSET_NEWS_CACHE_MAX_AGE);
    const controller = new AbortController();
    let isActive = true;
    const stateTimer = window.setTimeout(() => {
      if (!isActive) {
        return;
      }

      if (cachedNews) {
        setAssetNews(cachedNews);
      } else {
        setAssetNews([]);
      }

      setIsAssetNewsLoading(!cachedNews);
      setAssetNewsError("");
    }, 0);

    const loadAssetNews = async () => {
      const matchedItems = [];
      const matchedIds = new Set();

      for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
        const response = await api.get("/news", {
          params: {
            limit: ASSET_NEWS_PAGE_SIZE,
            offset: pageIndex * ASSET_NEWS_PAGE_SIZE,
          },
          signal: controller.signal,
        });

        const items = response.data?.items || [];
        const filteredItems = items.filter((news) => newsMatchesAsset(news, aliases));

        filteredItems.forEach((news) => {
          if (!matchedIds.has(news.id)) {
            matchedIds.add(news.id);
            matchedItems.push(news);
          }
        });

        if (matchedItems.length >= 8 || !response.data?.hasMore) {
          break;
        }
      }

      return matchedItems.slice(0, 8);
    };

    loadAssetNews()
      .then((filteredItems) => {
        if (!isActive) {
          return;
        }

        setAssetNews(filteredItems);
        writeCachedValue(assetNewsCacheKey(assetNewsKey), filteredItems);
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED" || !isActive) {
          return;
        }

        setAssetNewsError("Не получилось загрузить новости по активу");
      })
      .finally(() => {
        if (isActive) {
          setIsAssetNewsLoading(false);
        }
      });

    return () => {
      isActive = false;
      window.clearTimeout(stateTimer);
      controller.abort();
    };
  }, [activeButton, assetNewsAliasSignature, assetNewsKey]);
  const chartKey = `${assetType}:${symbol}:${activeChartRange}`;
  const assetLoadedKey = requestState.endpoint === endpoint && requestState.asset
    ? endpoint
    : "";
  const aiScoreKey = `${assetType}:${symbol}:${figiParam || ""}`;
  const dailyAiScoreCacheKey = aiScoreCacheKey(aiScoreKey);

  useEffect(() => {
		    if (!assetLoadedKey || !symbol || (asset?.isStableAsset && !isCurrency)) {
	      return;
	    }

		    let isActive = true;
    const cachedScore = readCachedValue(dailyAiScoreCacheKey, Infinity);
    const fallbackScore = cachedScore || calculateLocalDailyAiScore(asset, assetType, symbol);
		    const loadingTimer = window.setTimeout(() => {
		      if (!isActive) {
		        return;
		      }

		      setAiScoreState((currentState) => ({
		        key: aiScoreKey,
		        data: currentState.key === aiScoreKey ? currentState.data || fallbackScore : fallbackScore,
		        isLoading: true,
		      }));
		    }, 0);

    api.get("/ai/asset-score", {
      params: {
        asset_type: isStock ? "stock" : isCurrency ? "currency" : "crypto",
        symbol,
        figi: figiParam || undefined,
      },
    })
	      .then((response) => {
	        if (!isActive) {
	          return;
	        }

        const nextAiScore = response.data?.providerUnavailable
          ? fallbackScore
          : response.data;

	        setAiScoreState({
	          key: aiScoreKey,
	          data: nextAiScore,
	          isLoading: false,
	        });
        writeCachedValue(dailyAiScoreCacheKey, nextAiScore);
	      })
	      .catch(() => {
	        if (!isActive) {
	          return;
	        }

        writeCachedValue(dailyAiScoreCacheKey, fallbackScore);
	        setAiScoreState((currentState) => ({
	          key: aiScoreKey,
	          data: currentState.key === aiScoreKey ? currentState.data || fallbackScore : fallbackScore,
	          isLoading: false,
	        }));
	      });

	    return () => {
	      isActive = false;
	      window.clearTimeout(loadingTimer);
	    };
  }, [aiScoreKey, asset, asset?.isStableAsset, assetLoadedKey, assetType, dailyAiScoreCacheKey, figiParam, isCurrency, isStock, symbol]);

  const aiScore = aiScoreState.key === aiScoreKey ? aiScoreState.data : null;
  const isAiScoreLoading = aiScoreState.key === aiScoreKey && aiScoreState.isLoading;
  const hasAiScore = Number.isFinite(Number(aiScore?.score));
  const aiProbability = hasAiScore
    ? Math.min(Math.max(Math.round(Number(aiScore.score)), 0), 100)
    : null;
  const aiSignal = hasAiScore
    ? aiScore?.signal || (aiProbability >= 60 ? "BUY" : aiProbability <= 35 ? "SELL" : "HOLD")
    : "NO_SIGNAL";
	  const aiSignalLabel = {
	    BUY: "Покупать",
	    HOLD: "Наблюдать",
	    SELL: "Продавать",
	    NO_SIGNAL: "Нет сигнала",
	  }[aiSignal] || "Наблюдать";
	  const aiSignalTone = aiSignal === "BUY" ? "positive" : aiSignal === "SELL" ? "negative" : "neutral";
  const forecastTargetPrice = Number(aiScore?.targetPrice) > 0
    ? Number(aiScore.targetPrice)
    : currentPrice;
  const forecastDelta = forecastTargetPrice - currentPrice;
  const forecastDeltaPercent = currentPrice > 0 ? (forecastDelta / currentPrice) * 100 : 0;
  const forecastRangeLow = Number(aiScore?.targetRangeLow) > 0
    ? Number(aiScore.targetRangeLow)
    : forecastTargetPrice * (1 - Math.max(Math.abs(forecastDeltaPercent) * 0.35, 1.2) / 100);
  const forecastRangeHigh = Number(aiScore?.targetRangeHigh) > 0
    ? Number(aiScore.targetRangeHigh)
    : forecastTargetPrice * (1 + Math.max(Math.abs(forecastDeltaPercent) * 0.35, 1.2) / 100);
  const aiForecastTone = !hasAiScore
    ? "neutral"
    : aiProbability >= 60
    ? "positive"
    : aiProbability <= 35
      ? "negative"
      : "neutral";
	  const aiForecastColor = aiForecastTone === "positive"
	    ? "var(--green)"
	    : aiForecastTone === "negative"
	      ? "var(--red)"
	      : "var(--gray)";
  const getTextAlert = () => {
    if (!assetLoadedKey || !symbol) {
      return;
    }

    setTesxtAlert(true);
    setAiSummaryState((currentState) => ({
      key: aiScoreKey,
      title: currentState.key === aiScoreKey ? currentState.title : "Сводка GPT",
      text: currentState.key === aiScoreKey ? currentState.text : "",
      error: "",
      isLoading: true,
    }));

    api.get("/ai/asset-summary", {
      params: {
        asset_type: isStock ? "stock" : isCurrency ? "currency" : "crypto",
        symbol,
        figi: figiParam || undefined,
      },
    })
      .then((response) => {
        setAiSummaryState({
          key: aiScoreKey,
          title: response.data?.title || `Сводка GPT · ${assetName}`,
          text: response.data?.summary || "GPT не вернул текст сводки.",
          error: "",
          isLoading: false,
        });
      })
      .catch((error) => {
        setAiSummaryState({
          key: aiScoreKey,
          title: `Сводка GPT · ${assetName}`,
          text: "",
          error: getApiErrorText(error, "Не удалось загрузить GPT-сводку."),
          isLoading: false,
        });
      });
  };
	  const baseChartData = chartState.key === chartKey
    ? chartState.data
    : filterChartByRange(
      asset?.chart || asset?.chart7d || [],
      activeChartRange
    );
  const chartData = baseChartData.length > 0
    ? baseChartData
    : filterChartByRange(asset?.chart7d || [], "5D");
  const isChartLoading = Boolean(
    isOverviewTab &&
    asset &&
    chartState.key === chartKey &&
    chartState.isLoading &&
    chartData.length < 2
  );
  const selectedRangeStats = useMemo(() => {
    const preparedData = (Array.isArray(chartData) ? chartData : [])
      .map((point) => ({
        close: Number(point.close),
        time: getPointTime(point),
      }))
      .filter((point) => Number.isFinite(point.close));

    if (preparedData.length < 2) {
      return {
        money: 0,
        percent: 0,
      };
    }

    const first = preparedData[0].close;
    const last = preparedData[preparedData.length - 1].close;
    const money = last - first;
    const percent = first ? (money / first) * 100 : 0;

    return { money, percent };
  }, [chartData]);
  const rangeStatsText = `${formatSignedMoney(selectedRangeStats.money, currencySymbol)} (${formatPercent(selectedRangeStats.percent)})`;
  const renderContent = useMemo(() => {
	    const assetKind = isStock ? "акция" : isCurrency ? "валюта" : "криптовалюта";
    const infoMetrics = [
      { label: "Текущая цена", value: price },
      { label: "Изменение за 24 часа", value: formatPercent(changePercent) },
      { label: "Максимум 24ч", value: formatMoney(asset?.highPrice24h, currencySymbol) },
      { label: "Минимум 24ч", value: formatMoney(asset?.lowPrice24h, currencySymbol) },
      { label: "Объем 24ч", value: formatNumber(asset?.volume24h, 2) },
      { label: "Оборот 24ч", value: formatMoney(asset?.turnover24h, currencySymbol) },
    ];

    if (activeButton === "Новости") {
      return (
        <div className="coin_tab_content coin_asset_news_content">
          <div className="coin_asset_news_header">
            <div>
              <p className="coin_tab_title">Новости по активу</p>
              <span>
                Подбираем материалы, где упоминается {assetName} или тикер {shortName}.
              </span>
            </div>
            <Link to="/app/news">
              <Buttons type="text">Вся лента</Buttons>
            </Link>
          </div>

          <div className="coin_asset_news_list">
            {assetNews.map((news) => (
              <NewsCard
                key={news.id}
                news={news}
                isSeen={seenNewsIds.includes(news.id)}
                onSeen={markNewsAsSeen}
              />
            ))}

            {isAssetNewsLoading ? (
              <div className="coin_asset_news_loader">
                <LoaderAnimation height={150} rounded="16px" />
              </div>
            ) : null}

            {!isAssetNewsLoading && !assetNews.length ? (
              <div className="coin_tab_panel coin_asset_news_empty">
                <p className="coin_tab_title">Пока нет точных новостей</p>
                <span>
                  В общей ленте новости есть, но по текущему активу совпадений пока не нашлось.
                </span>
              </div>
            ) : null}

            {assetNewsError ? <div className="news_error">{assetNewsError}</div> : null}
          </div>
        </div>
      );
    }

    if (activeButton === "Депозиты") {
      const hasCurrentPosition = Boolean(positionAsset && availableAssetAmount > 0);
      const currentPositionValue = availableAssetAmount * currentPrice;
      const positionChangePercent = Number(positionAsset?.changePercent || asset?.priceChangePercent24h || 0);
      const positionChangeValue = Number(positionAsset?.changeRub || 0);
      const positionChangeTone = positionChangePercent > 0 || positionChangeValue > 0
        ? "positive"
        : positionChangePercent < 0 || positionChangeValue < 0
          ? "negative"
          : "neutral";

      return (
        <div className="coin_tab_content">
          <div className="coin_tab_panel coin_deposit_panel">
            <p className="coin_tab_title">Депозиты</p>
            {hasCurrentPosition ? (
              <div className="coin_deposit_position_card">
                <div className="coin_deposit_position_metrics">
                  <div>
                    <span>Актив в портфеле</span>
                    <strong>{formatNumber(availableAssetAmount, 8)} {baseCurrency}</strong>
                  </div>
                  <div>
                    <span>Оценка позиции</span>
                    <strong>{formatMoney(currentPositionValue, currencySymbol)}</strong>
                  </div>
                  <div>
                    <span>{isStock ? "Доступно лотами" : "Торговая пара"}</span>
                    <strong>{isStock ? `${formatNumber(maxSellLots, 0)} лот.` : cryptoTradingPair}</strong>
                  </div>
                  <div>
                    <span>Динамика</span>
                    <strong className={`coin_deposit_change coin_deposit_change_${positionChangeTone}`}>
                      {formatPercent(positionChangePercent)}
                    </strong>
                  </div>
                </div>
                <Buttons
                  type="primary-danger"
                  onClick={() => {
                    setTradeSide("sell");
                    setTradeAmount("");
                    setTradeState({ isSubmitting: false, message: "", error: "" });
                    setIsTradeDrawerOpen(true);
                  }}
                >
                  Продать
                </Buttons>
              </div>
            ) : (
              <span>По этому активу пока нет позиции в подключенном портфеле</span>
            )}
          </div>
        </div>
      );
    }

    if (activeButton === "Информация") {
      return (
        <div className="coin_tab_content">
          <div className="coin_tab_panel coin_info_text coin_info_long">
            <div className="coin_info_hero">
              <div>
                <p className="coin_tab_title">О активе</p>
                <h3>{assetName}</h3>
                <span>
                  {shortName} · {assetKind} · расчеты в {quoteCurrency}
                </span>
              </div>
              <div className="coin_info_sentiment">
                <span>Настроение</span>
                <p>{positiveMood}% покупателей</p>
              </div>
            </div>

            <div className="coin_info_grid">
              {infoMetrics.map((item) => (
                <div className="coin_info_metric" key={item.label}>
                  <span>{item.label}</span>
                  <p>{item.value}</p>
                </div>
              ))}
            </div>

            <div className="coin_info_article">
              <p>
                {assetName} ({shortName}) сейчас торгуется по цене {price}. За последние 24 часа
                изменение составило {formatPercent(changePercent)}, а текущая динамика по выбранному
                периоду: {rangeStatsText}. Эти данные помогают быстро понять, где находится актив:
                в импульсе, коррекции или спокойном боковом движении.
              </p>
              <p>
	                {isCurrency
	                  ? "Для валют в портфеле важнее курс, доля в капитале и назначение как расчетной позиции. Стакан для таких активов в Pulse не отображается, если брокер или биржа не возвращают по ним реальные уровни заявок."
	                  : isStock
	                  ? "Для акций особенно важны ликвидность, обороты, корпоративные события, дивиденды, отчеты и общий фон российского рынка. Перед покупкой стоит смотреть не только цену, но и объем торгов, новости эмитента и состояние сектора."
	                  : "Для криптовалют особенно важны ликвидность пары, глубина стакана, волатильность, объем торгов и новостной фон вокруг сети или токена. Сильный перекос заявок в стакане может показывать краткосрочное давление покупателей или продавцов."}
	              </p>
	              {orderbook.hasRows ? (
	                <p>
	                  Стакан справа показывает ближайшие заявки на покупку и продажу. Зеленая сторона
	                  отражает спрос, красная - предложение. Чем шире заливка за ценой, тем больше объем
	                  заявки относительно других уровней в текущем стакане.
	                </p>
	              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return null;
  }, [
    activeButton,
    asset,
    assetName,
    assetNews,
    assetNewsError,
    availableAssetAmount,
    baseCurrency,
    changePercent,
    cryptoTradingPair,
    currencySymbol,
    currentPrice,
	    isAssetNewsLoading,
	    isCurrency,
	    isStock,
    markNewsAsSeen,
	    maxSellLots,
	    orderbook.hasRows,
	    positiveMood,
    positionAsset,
    price,
    quoteCurrency,
    rangeStatsText,
    seenNewsIds,
    shortName,
  ]);

  useEffect(() => {
    if (!assetLoadedKey || !symbol || !isOverviewTab) {
      return;
    }

    if (asset?.isStableAsset) {
      const now = Date.now();
      const stableChart = Array.from({ length: 6 }, (_, index) => ({
        time: now - (5 - index) * 60 * 60 * 1000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 0,
        turnover: 0,
      }));
      const stableChartTimer = window.setTimeout(() => {
        setChartState({
          key: chartKey,
          data: stableChart,
          isLoading: false,
        });
      }, 0);

      return () => {
        window.clearTimeout(stableChartTimer);
      };
    }

    const rangeSettings = CHART_RANGES[activeChartRange] || CHART_RANGES["5D"];
    const rawDays = rangeSettings.all ? 1000 : rangeSettings.ytd
      ? Math.max(
        1,
        Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000)
      )
      : rangeSettings.days;
    const days = Math.min(rawDays, 1000);
    const controller = new AbortController();
    const chartEndpoint = isStock
      ? `/stocks/${symbol}/chart`
      : `/cryptocurrencies/${symbol}/chart`;
    const params = isStock
      ? {
        days,
        interval: rangeSettings.stockInterval || 24,
      }
      : {
        days: rangeSettings.points || days,
        interval: rangeSettings.interval || "D",
      };
    const cachedChart = readCachedValue(chartCacheKey(chartKey), CHART_CACHE_MAX_AGE);
    let cachedChartTimer = null;
    let chartLoadingTimer = null;

    if (cachedChart) {
      cachedChartTimer = window.setTimeout(() => {
        setChartState({
          key: chartKey,
          data: cachedChart,
          isLoading: false,
        });
      }, 0);
    } else {
      chartLoadingTimer = window.setTimeout(() => {
        setChartState((currentState) => {
          if (currentState.key === chartKey && currentState.data.length > 0) {
            return currentState;
          }

          return {
            key: chartKey,
            data: [],
            isLoading: true,
          };
        });
      }, 0);
    }

    api
      .get(chartEndpoint, {
        params,
        signal: controller.signal,
      })
      .then((response) => {
        setChartState({
          key: chartKey,
          data: response.data?.chart || [],
          isLoading: false,
        });
        writeCachedValue(chartCacheKey(chartKey), response.data?.chart || []);
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setChartState({
          key: chartKey,
          data: [],
          isLoading: false,
        });
      });

    return () => {
      if (cachedChartTimer) {
        window.clearTimeout(cachedChartTimer);
      }

      if (chartLoadingTimer) {
        window.clearTimeout(chartLoadingTimer);
      }

      controller.abort();
    };
  }, [activeChartRange, asset, assetLoadedKey, chartKey, isOverviewTab, isStock, symbol]);


  return (
    <div className="app_pages">
	          <div className="app_content">
		        {textAlert && (
		            <TextAlert
		              TextAlertButton = {() => setTesxtAlert(false)}
		              title={aiSummaryState.title}
		              isLoading={aiSummaryState.isLoading}
		              error={aiSummaryState.error}
		            >
		              {normalizeTextContent(aiSummaryState.text, "Сводка пока не загружена.")
		                .split(/\n+/)
		                .filter(Boolean)
		                .map((paragraph, index) => (
	                  <p key={`ai-summary-${index}`}>{paragraph}</p>
	                ))}
	            </TextAlert>
	        )}

        {tradeSuccessAlert ? (
          <div className="trade_success_toast" role="status">
            <div className="trade_success_toast_icon">✓</div>
            <div>
              <strong>{tradeSuccessAlert.title}</strong>
              <span>{tradeSuccessAlert.text}</span>
            </div>
          </div>
        ) : null}

        <div className="app_items Pagecoin_cpntainer">
          <div className="dashboard_container coin_page_container ">
            {isLoading ? (
              <CoinPageHeroLoader />
            ) : isBlockingError ? (
              <div className="market_error">
                <p>{error}</p>
              </div>
            ) : (
              <div style={{width: '100%'}}>

                <div className="content_container">
                  <div className="uPContainerPageCoin disabledCpinpage">


	                    <Link to={`/app/market?tab=${isStock ? "stocks" : "crypto"}`}>
	                      <Buttons type='text'>
	                          <p style={{opacity: 0.5}}>
	                            {isStock ? "Акция " : isCurrency ? "Валюта " : "Криптовалюта "}
	                          </p>
                      </Buttons>
                    </Link>


                    <div className="NameCoin">
                      · {pageTitleName}
                    </div>

                  </div>
                  
                    {hasMood ? (
                    <div className="fnsizw flex items-center gap-[10px]">
                      <p className="disabledCpinpage">Текущее настроение:</p>
                      <div className="moodCoim">
                          
                        <p style={{color: 'var(--green)'}} className="bordeInf flex items-center gap-[5px]">
                          <span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="13" viewBox="0 0 21 13" fill="none">
                              <path d="M0.75 11.7502L7.29003 5.27288L11.4621 9.40496C12.6683 7.05023 14.658 5.17992 17.0952 4.10984L19.75 2.93911M19.75 2.93911L13.9948 0.750244M19.75 2.93911L17.5409 8.63919" stroke="#00FFAA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                          {positiveMood}%
                        </p>
                        
                        <div className="moodIndication">
                            <div className="greenLine" style={{ width: `${positiveMood}%` }}></div>
                            <div className="redLine" style={{ width: `${negativeMood}%` }}></div>
                        </div>

                        <p style={{color: 'var(--red)'}} className="bordeInf flex items-center gap-[5px]">
                          <span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="13" viewBox="0 0 21 13" fill="none">
                              <path d="M0.75 0.75L7.29003 7.22736L11.4621 3.09529C12.6683 5.45001 14.658 7.32033 17.0952 8.39041L19.75 9.56113M19.75 9.56113L13.9948 11.75M19.75 9.56113L17.5409 3.86105" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                          {negativeMood}%
                        </p>
                      </div>
                      
                    </div>
                    ) : (
                      <p className="disabledCpinpage fnsizw">
                        Текущее настроение: нет данных
                      </p>
                    )}
                </div>
                
                <div className="ourBlockdown">

                  <div className="midleBlockOfCoin">

                    <div className="titleBlockCoinPage">

                      <div className="coinStokIMg">
                        <CoinIcon
                          baseCoin={asset?.baseCoin || asset?.symbol}
	                          iconUrl={asset?.iconUrl}
	                          label={shortName}
	                          type={isStock ? "stock" : "crypto"}
	                          className="coin_page_icon"
	                        />
                      </div>

                      <div className="textinfCoun">
                        <div className="ttcoin">
                          <h1>{assetName}</h1>
                          <p>{pageSubtitleSymbol}</p>
                        </div>
                        <p className="disabledCpinpagemobile" style={{opacity: 0.5}}>
                          {formatDateTime(asset?.updatedAt)} ·{" "}
                          {quoteCurrency}/{isStock ? asset?.symbol || symbol : baseCurrency}
                        </p>
                      </div>
                      
                    </div>

                    <div className="PriceBlock">

                        <h1>{price}</h1>
                        <div className="PersentChanges">
                          <p className="disabledCpinpage" style={{opacity: 0.5}}>Сегодня</p>
                          <p style={{color: getRightColor(todayChange)}}>{todayChangeText}</p>
                        </div>
                        
                    </div>


                  </div>
                  
                  <div className="downBlockCoinPage">
                    

                    <div className="elemetsOfContriroll">

                      <Buttons type="iconButton">
                        <span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
                            <path d="M4.96669 9.3692C4.72455 8.93351 4.34459 8.59056 3.88646 8.39418C3.42832 8.1978 2.91794 8.15911 2.43544 8.28418C1.95293 8.40925 1.52562 8.691 1.22057 9.0852C0.915516 9.4794 0.75 9.96375 0.75 10.4622C0.75 10.9606 0.915516 11.445 1.22057 11.8392C1.52562 12.2334 1.95293 12.5151 2.43544 12.6402C2.91794 12.7653 3.42832 12.7266 3.88646 12.5302C4.34459 12.3338 4.72455 11.9909 4.96669 11.5552M4.96669 9.3692C5.14669 9.6932 5.24969 10.0652 5.24969 10.4622C5.24969 10.8592 5.14669 11.2322 4.96669 11.5552M4.96669 9.3692L14.5327 4.0552M4.96669 11.5552L14.5327 16.8692M14.5327 4.0552C14.6729 4.31934 14.8644 4.55286 15.096 4.74213C15.3276 4.93139 15.5945 5.07259 15.8813 5.15747C16.1681 5.24236 16.4689 5.26922 16.7661 5.23649C17.0634 5.20376 17.3512 5.1121 17.6126 4.96686C17.874 4.82162 18.1039 4.62572 18.2887 4.39061C18.4736 4.1555 18.6097 3.88591 18.6891 3.59758C18.7685 3.30925 18.7897 3.00799 18.7513 2.71139C18.713 2.4148 18.6159 2.12883 18.4657 1.8702C18.1698 1.36054 17.6857 0.987334 17.1175 0.83081C16.5493 0.674287 15.9424 0.746939 15.4272 1.03315C14.912 1.31936 14.5297 1.79628 14.3624 2.36139C14.1952 2.9265 14.2563 3.53468 14.5327 4.0552ZM14.5327 16.8692C14.3892 17.1276 14.2979 17.4117 14.2642 17.7053C14.2304 17.999 14.2549 18.2964 14.3361 18.5806C14.4173 18.8648 14.5537 19.1302 14.7375 19.3617C14.9212 19.5931 15.1488 19.7862 15.4072 19.9297C15.6656 20.0732 15.9497 20.1645 16.2433 20.1982C16.537 20.2319 16.8344 20.2075 17.1185 20.1263C17.4027 20.0451 17.6682 19.9087 17.8996 19.7249C18.1311 19.5411 18.3242 19.3136 18.4677 19.0552C18.7576 18.5334 18.8283 17.9178 18.6643 17.3438C18.5003 16.7699 18.115 16.2846 17.5932 15.9947C17.0714 15.7048 16.4558 15.6341 15.8818 15.7981C15.3079 15.9621 14.8226 16.3474 14.5327 16.8692Z" stroke="#1E75FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                        
                      </Buttons>

                      <Buttons
                        type={isFavoriteAsset ? "iconButton favorite-active" : "iconButton"}
                        onClick={toggleFavorite}
                      >
                        <span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="19" viewBox="0 0 20 19" fill="none">
                            <path d="M9.38641 1.09882C9.42871 0.995655 9.50074 0.907399 9.59333 0.845283C9.68593 0.783168 9.79491 0.75 9.90641 0.75C10.0179 0.75 10.1269 0.783168 10.2195 0.845283C10.3121 0.907399 10.3841 0.995655 10.4264 1.09882L12.5514 6.20982C12.5912 6.30546 12.6566 6.38827 12.7404 6.44914C12.8242 6.51001 12.9232 6.54658 13.0264 6.55482L18.5444 6.99682C19.0434 7.03682 19.2454 7.65982 18.8654 7.98482L14.6614 11.5868C14.5829 11.654 14.5243 11.7415 14.4922 11.8398C14.4601 11.938 14.4557 12.0432 14.4794 12.1438L15.7644 17.5288C15.7902 17.6369 15.7835 17.7501 15.745 17.8543C15.7065 17.9585 15.6379 18.049 15.548 18.1142C15.4582 18.1795 15.351 18.2167 15.24 18.2211C15.129 18.2254 15.0192 18.1968 14.9244 18.1388L10.1994 15.2538C10.1112 15.1999 10.0098 15.1714 9.90641 15.1714C9.80303 15.1714 9.70164 15.1999 9.61341 15.2538L4.88841 18.1398C4.79367 18.1978 4.68387 18.2264 4.57287 18.2221C4.46187 18.2177 4.35466 18.1805 4.26478 18.1152C4.1749 18.05 4.10638 17.9595 4.06787 17.8553C4.02936 17.7511 4.02259 17.6379 4.04841 17.5298L5.33341 12.1438C5.35725 12.0432 5.35286 11.938 5.32075 11.8397C5.28864 11.7415 5.23005 11.6539 5.15141 11.5868L0.947414 7.98482C0.862757 7.91266 0.801421 7.81699 0.771174 7.70994C0.740927 7.60289 0.743129 7.48927 0.777503 7.38347C0.811877 7.27768 0.876875 7.18446 0.964265 7.11563C1.05166 7.0468 1.15751 7.00545 1.26841 6.99682L6.78641 6.55482C6.88966 6.54658 6.98864 6.51001 7.07244 6.44914C7.15625 6.38827 7.22164 6.30546 7.26141 6.20982L9.38641 1.09882Z" fill={isFavoriteAsset ? "#1E75FF" : "transparent"} stroke="#1E75FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      </Buttons>

                      
	                      {!isCurrency ? (
	                      <Drawer open={isTradeDrawerOpen} onOpenChange={setIsTradeDrawerOpen}>
                        <div className="ContwainerBagsAdd">
                          <DrawerTrigger asChild>
                          <Buttons type='primary-buy' >

                            <div className="flex">
                              <p>Купить/продать</p>
                              <span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
                                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                              </span>
                            </div>
                            
                          </Buttons>
                        </DrawerTrigger>

                        <DrawerContent className="bg-black-s text-white border border-black-t rounded-t-2xl trade_drawer ">
                          <div className="trade_drawer_panel">
                            <center>
                            <div className="lineDrawer"></div>
                            </center>

                            <DrawerHeader className="trade_drawer_header">
                              <DrawerTitle>Сделка с {shortName}</DrawerTitle>
                              <DrawerDescription>
                                {isStock
                                  ? "Введите количество лотов. Итоговое исполнение зависит от стакана и подключенного брокера."
                                  : `Торговая пара ${cryptoTradingPair}. Покупка идет за ${tradeQuoteCurrency}, продажа списывает ${baseCurrency}.`}
                              </DrawerDescription>
                              {isStockExchangeClosed ? (
                                <div className="tbank_market_status_banner">
                                  <div className="tbank_market_status_provider">
                                    <img src={TbankIcon} alt="Т-Банк" />
                                    <span>Т-Банк</span>
                                  </div>
                                  <p>
                                    Биржа закрыта: {stockTradingStatus?.statusLabel || "торги сейчас недоступны"}.
                                    Заявку можно отправить, когда торговая сессия снова откроется.
                                  </p>
                                </div>
                              ) : null}
                            </DrawerHeader>

                            <div className="trade_drawer_body">
                              <div className="trade_side_switch">
                                <button
                                  type="button"
                                  className={tradeSide === "buy" ? "active" : ""}
                                  onClick={() => {
                                    setTradeSide("buy");
                                    setTradeState({ isSubmitting: false, message: "", error: "" });
                                  }}
                                  aria-pressed={tradeSide === "buy"}
                                >
                                  Купить
                                </button>
                                <button
                                  type="button"
                                  className={tradeSide === "sell" ? "active" : ""}
                                  onClick={() => {
                                    setTradeSide("sell");
                                    setTradeState({ isSubmitting: false, message: "", error: "" });
                                  }}
                                  aria-pressed={tradeSide === "sell"}
                                >
                                  Продать
                                </button>
                              </div>

                              <div className="trade_balance_grid ">
                                <div>
                                  <span>{isPortfolioLoading ? "Обновляем баланс" : "Доступные деньги"}</span>
                                  <p>{formatMoney(availableMoney, currencySymbol)}</p>
                                </div>
                                <div className="border_blue">
                                  <span >{isStock ? tradeSide === "buy" ? "Доступно к покупке" : "Доступно к продаже" : "В позиции"}</span>
                                  <p style={{color: 'var(--primary-blue)'}}>
                                    {isStock
                                      ? `${formatNumber(tradeSide === "buy" ? maxBuyLots : maxSellLots, 0)} лот.`
                                      : `${formatNumber(availableAssetAmount, 8)} ${baseCurrency}`}
                                  </p>
                                </div>
                              </div>

                              <label className="trade_input_label">
                                <span>{isStock ? "Количество лотов" : tradeSide === "buy" ? `Сумма покупки, ${tradeQuoteCurrency}` : `Количество к продаже, ${baseCurrency}`}</span>
                                <input
                                  type="text"
                                  inputMode={isStock ? "numeric" : "decimal"}
                                  value={tradeAmount}
                                  onChange={(event) => {
                                    setTradeAmount(event.target.value);
                                    setTradeState({ isSubmitting: false, message: "", error: "" });
                                  }}
                                  placeholder="0"
                                />
                              </label>

                              <div className="trade_quick_amounts" aria-label="Быстрый выбор суммы сделки">
                                {[0.25, 0.5, 1].map((percent) => (
                                  <button
                                    key={percent}
                                    type="button"
                                    onClick={() => setTradeAmountPercent(percent)}
                                    disabled={maxTradeAmount <= 0}
                                  >
                                    {percent === 1 ? "Макс." : `${percent * 100}%`}
                                  </button>
                                ))}
                              </div>

                              <div className="trade_result_card">
                                {!isStock ? (
                                  <div>
                                    <span>Торговая пара</span>
                                    <p>{cryptoTradingPair}</p>
                                  </div>
                                ) : null}
                                <div>
                                  <span>{isStock ? `Цена за 1 акцию · лот ${stockLotSize} шт.` : "Текущая цена"}</span>
                                  <p>{formatMoney(currentPrice, currencySymbol)}</p>
                                </div>
                                <div>
                                  <span>{isStock ? "Акций в заявке" : tradeSide === "buy" ? "Можно купить" : "Будет списано"}</span>
                                  <p>
                                    {formatNumber(estimatedTradeQuantity, 8)} {baseCurrency}
                                  </p>
                                </div>
                                {isStock ? (
                                  <div>
                                    <span>Примерная сумма</span>
                                    <p>{formatMoney(estimatedTradeValue, currencySymbol)}</p>
                                  </div>
                                ) : null}
                              </div>

                              {tradeAmountError ? (
                                <p className="trade_error">{tradeAmountError}</p>
                              ) : tradeState.error ? (
                                <p className="trade_error">{tradeState.error}</p>
                              ) : tradeState.message ? (
                                <p className="trade_success">{tradeState.message}</p>
                              ) : tradeAvailabilityHint ? (
                                <p className="trade_hint">{tradeAvailabilityHint}</p>
                              ) : (
                                <p className="trade_hint">
                                  Комиссия и финальное количество уточняются при реальном исполнении заявки.
                                </p>
                              )}
                            </div>

                            <DrawerFooter className="trade_drawer_footer">
                              <Buttons
                                type={tradeSide === "buy" ? "primary-buy" : "primary-sell"}
                                disabled={Boolean(tradeAmountError) || (isStock ? normalizedTradeLots <= 0 : normalizedTradeAmount <= 0) || tradeState.isSubmitting || isPortfolioLoading}
                                onClick={submitTrade}
                              >
                                {tradeState.isSubmitting ? "Отправляем заявку..." : tradeButtonText}
                              </Buttons>
                              {/* <DrawerClose asChild>
                                <Buttons type="text">Закрыть</Buttons>
                              </DrawerClose> */}
                            </DrawerFooter>
                          </div>
                        </DrawerContent>
                        </div>
                        
	                      </Drawer>
	                      ) : (
	                        <div className="currency_trade_notice">
	                          Расчетная валюта. Сделки и стакан для нее не отображаются.
	                        </div>
	                      )}

                    </div>
                  </div>

                </div>
                
                
              </div>
              
            )}
          </div>
          {isLoading ? (
            <CoinPageOverviewLoader />
          ) : isBlockingError ? null : (
          <div className="containerInformaton_about_coin">
            <div className="containerInformaton_about_coin_content">
              <div className="buttons_loader_contentIn_container">
                <Buttons 
                  type={activeButton === 'Обзор' ? 'text_choosevariant active' : 'text_choosevariant'}
                  onClick={() => setActiveButton('Обзор')}
                  aria-pressed={activeButton === 'Обзор'}
                >
                  Обзор
                </Buttons>
                <Buttons 
                  type={activeButton === 'Новости' ? 'text_choosevariant active' : 'text_choosevariant'}
                  onClick={() => setActiveButton('Новости')}
                  aria-pressed={activeButton === 'Новости'}
                >
                  Новости
                </Buttons>
                <Buttons 
                  type={activeButton === 'Депозиты' ? 'text_choosevariant active' : 'text_choosevariant'}
                  onClick={() => setActiveButton('Депозиты')}
                  aria-pressed={activeButton === 'Депозиты'}
                >
                  Депозиты
                </Buttons>
                <Buttons 
                  type={activeButton === 'Информация' ? 'text_choosevariant active' : 'text_choosevariant'}
                  onClick={() => setActiveButton('Информация')}
                  aria-pressed={activeButton === 'Информация'}
                >
                  Информация
                </Buttons>
              </div>
              <div className="line_variant"></div>
            </div>
            <div className="renderContent">
              {isOverviewTab ? (
                <>
                <div className="chartUserContainer">
                  <div className="usV">
                    <div className="chartuser">
                    <div className="chartuser_container">
                      <div className="flex gap-[8px] items-center ">
                        <p style={{color: getRightColor(selectedRangeStats.money), fontSize: '13px'}}>{rangeStatsText}</p>
                        <p style={{opacity: 0.5, fontSize: '13px'}}>{activeChartRange}</p>
                      </div>
                      <MiniSparkline data={chartData} />
                    </div>
                    <div className="buttonChart">
                      <div className="buttonChart_container">
                        {Object.keys(CHART_RANGES).map((range) => (
                          <Buttons
                            key={range}
                            type={activeChartRange === range ? "chartBuy active" : "chartBuy"}
                            onClick={() => setActiveChartRange(range)}
                          >
                            {range}
                          </Buttons>
                        ))}
                      </div>
                    </div>
                    </div>
                    <div className="chart">
                      <div className="container-Chart">
                        <div className="chart_content">
                          <div className="lineChart">
                            {isChartLoading ? (
                              <LoaderAnimation height={320} rounded="18px" />
                            ) : (
                              <AssetChart
                                key={`${chartKey}:${chartData.length}`}
                                data={chartData}
                                currencySymbol={currencySymbol}
                                activeRange={activeChartRange}
                                currentPrice={currentPrice}
                                tradeMarkers={assetTradeMarkers}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                    <div className="ContainerRightINF">
                      {asset?.isStableAsset ? (
                        <>
                          <div className="AiPrognathation_content stable_asset_card">
                            <div className="titleUPAI ">
                              <div className="flex items-center gap-[8px]">
                                <CoinIcon
                                  baseCoin={baseCurrency}
                                  iconUrl={asset?.iconUrl}
                                  label={baseCurrency}
                                  type="crypto"
                                />
                                <p>{baseCurrency} как расчетная валюта</p>
                              </div>
                            </div>
                            <div className="stable_asset_metrics">
                              <div>
                                <span>Ориентировочная цена</span>
                                <strong>{formatMoney(currentPrice, currencySymbol)}</strong>
                              </div>
                              <div>
                                <span>Рублевый эквивалент</span>
                                <strong>{formatRubleEquivalent(currentPrice, quoteCurrency)}</strong>
                              </div>
                              <div>
                                <span>Назначение</span>
                                <strong>Покупка пар вроде BTC/USDT</strong>
                              </div>
                            </div>
                          </div>
	                        </>
	                      ) : (
                        <>
                      <div className="AiPrognathation_content">
                          <div className="titleUPAI ">
                            <div className="flex items-center gap-[8px]">
                              <img src={LogoSvg} alt="Логотип" />
                              <p>Сводный прогноз</p>
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
	                          <div className="modleBlock">
	                            <div className="textItems">
	                              {isAiScoreLoading && !aiScore ? (
	                                <LoaderAnimation height={96} rounded="16px" />
	                              ) : (
		                                <>
		                                  <div className="tAI">
		                                    <p>Прогнозная цена</p>
		                                    <div className="flex gap-[4px]">
		                                      <h5>{formatMoney(forecastTargetPrice, currencySymbol)}</h5>
		                                      <h5 className={`forecast_delta forecast_delta_${aiForecastTone}`}>
		                                        {formatSignedMoney(forecastDelta, currencySymbol)} ({formatPercent(forecastDeltaPercent)})
		                                      </h5>
		                                    </div>
		                                  </div>
		                                  <div className="tAI">
		                                    <p>Диапазон</p>
		                                    <h5>{formatMoney(forecastRangeLow, currencySymbol)} - {formatMoney(forecastRangeHigh, currencySymbol)}</h5>
		                                  </div>
		                                  {/* <div className="tAI">
		                                    <p>Сигнал</p>
		                                    <h5 className={`ai_signal_text ai_signal_text_${aiSignalTone}`}>{aiSignalLabel}</h5>
		                                  </div> */}
		                                </>
		                              )}
		                            </div>
		                            <div className="SerckeChart">
		                              <div
		                                className={`SecleChartContainer SecleChartContainer_${aiForecastTone}`}
		                                style={{ "--forecast-color": aiForecastColor }}
		                              >
		                                  <div className="midleSercle">
		                                      <div className="centerPersent">
			                                          <p>{hasAiScore ? `${aiProbability}%` : "—"}</p>
	                                      </div>
	                                  </div>
	                              </div>
	                            </div>
	                          </div>
	                          <div className="downAIBlock">
	                            <div className="tbysell flex items-center gap-[8px]">
	                              <p className={`ai_signal_text ai_signal_text_${aiSignalTone}`}>{aiSignalLabel}</p>
	                              <Buttons onClick ={getTextAlert}  type='nm_black_prymary'>Сводка</Buttons>
	                            </div>
                            <div className="LogoPulseSmall">
                              <img src={PulseSvgTag} alt="pulseimg" />
                            </div>
                            
                          </div>
                      </div>
                      {/* <div className="AiPrognathation">
                        
                      </div> */}
	                      {orderbook.hasRows ? (
	                        <OrderBook
	                          orderbook={orderbook}
	                          currentPrice={currentPrice}
	                          currencySymbol={currencySymbol}
	                          baseCurrency={baseCurrency}
	                          quoteCurrency={quoteCurrency}
	                        />
	                      ) : null}
                        </>
                      )}
                    </div>
                </div>
                  
                </>
              ) : (
                renderContent
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
