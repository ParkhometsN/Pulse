import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Inputs from "../../components/UI/inputs";
import SearchIcon from "../../assets/svg/searchicon.svg";
import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";
import Buttons from "../../components/UI/buttons";
import MarketCardBot from "../../components/ui/marketCard";
import CointButtonMarket from "../../components/ui/cointmarketButton";
import CoinIcon from "../../components/ui/coinIcon";
import api from "../../lib/api";
import { readCachedValue, writeCachedValue } from "../../lib/clientCache";
import LoaderAnimation from "../../components/ui/loaderAnimation";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";

const ITEMS_PER_PAGE = 15;
const MARKET_REFRESH_INTERVAL = 10000;
const STRATEGY_REFRESH_INTERVAL = 15000;
const STRATEGY_MIN_CAPITAL_RUB = 5000;
const STRATEGY_USDT_RUB_RATE = 92;
const FAVORITES_STORAGE_KEY = "pulse_market_favorites";
const MARKET_CACHE_MAX_AGE = 1000 * 60 * 5;
const STRATEGY_CACHE_KEY = "pulse:market:strategies:v2";
const STRATEGY_CACHE_MAX_AGE = 1000 * 60 * 15;
const marketCacheKey = (type, page, source = "default") => `pulse:market:${type}:${source}:page:${page}:v6`;
const STABLE_CRYPTO_SYMBOLS = new Set(["USDT", "USDC", "DAI", "USD", "BUSD"]);
const STOCK_SOURCE_TBANK = "tbank";
const STOCK_SOURCE_MOEX = "moex";

const MARKET_STRATEGIES = [
  {
    id: "ai-short",
    title: "ИИ торговля Short",
    description:
      "Короткосрочная momentum-стратегия: ищет ликвидные активы, которые уже ускоряются сегодня, и быстро фиксирует движение.",
    tag: "Scalp",
    direction: "Импульс",
    chartColor: "var(--green)",
    chart: [100000, 100000, 100000, 100000],
    stats: [
      { label: "Модель", value: "Scalp AI" },
      { label: "Сделок сегодня", value: "0" },
      { label: "Точность сигналов", value: "0%" },
      { label: "Просадка", value: "0%" },
    ],
    history: [],
    aggression: 42,
    note: "Лучше подходит для быстрых дневных импульсов и ликвидных активов с подтвержденным оборотом.",
  },
  {
    id: "ai-long",
    title: "ИИ торговля Long",
    description:
      "Стратегия ищет активы с сильным восходящим импульсом и открывает long-сделки только при вероятности сигнала от 60%.",
    tag: "Long",
    direction: "Растет",
    chartColor: "var(--green)",
    chart: [100000, 100000, 100000, 100000],
    stats: [
      { label: "Модель", value: "Growth AI" },
      { label: "Сделок сегодня", value: "0" },
      { label: "Точность сигналов", value: "0%" },
      { label: "Просадка", value: "0%" },
    ],
    history: [],
    aggression: 58,
    note: "Сценарий для спокойного набора позиции, когда рынок показывает устойчивый спрос.",
  },
  {
    id: "ai-short-long",
    title: "ИИ торговля Short + Long",
    description:
      "Гибридная стратегия сравнивает вероятность роста и падения, выбирает более сильное направление и ведет капитал по выбранному рынку.",
    tag: "Hybrid",
    direction: "Смешанный",
    chartColor: "var(--primary-blue)",
    chart: [100000, 100000, 100000, 100000],
    stats: [
      { label: "Модель", value: "Hybrid AI" },
      { label: "Сделок сегодня", value: "0" },
      { label: "Точность сигналов", value: "0%" },
      { label: "Просадка", value: "0%" },
    ],
    history: [],
    aggression: 50,
    note: "Комбинированный режим переключает направление при смене рыночного импульса.",
  },
];

const formatStrategyMoney = (value) => (
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value)
);

const formatStrategyAxisMoney = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0 ₽";
  }

  const abs = Math.abs(number);

  if (abs >= 1_000_000) {
    return `${(number / 1_000_000).toLocaleString("ru-RU", {
      maximumFractionDigits: 1,
    })} млн ₽`;
  }

  if (abs >= 1000) {
    return `${Math.round(number / 1000).toLocaleString("ru-RU")} тыс ₽`;
  }

  return formatStrategyMoney(number);
};

const formatStrategyCapital = (value, currency = "RUB") => {
  const normalizedCurrency = String(currency || "RUB").toUpperCase();
  const number = Number(value) || 0;

  if (normalizedCurrency === "RUB") {
    return formatStrategyMoney(number);
  }

  return `${number.toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  })} ${normalizedCurrency}`;
};

const getStrategyCapitalRub = (value, currency = "RUB") => {
  const number = Number(value) || 0;

  return String(currency || "RUB").toUpperCase() === "RUB"
    ? number
    : number * STRATEGY_USDT_RUB_RATE;
};

const formatSignedStrategyMoney = (value) => `${value >= 0 ? "+" : ""}${formatStrategyMoney(value)}`;

const getStrategyCapital = (strategy) => {
  const backendInitial = Number(strategy.startCapital ?? strategy.paperRun?.startCapital);
  const backendCurrent = Number(strategy.currentCapital ?? strategy.paperRun?.currentCapital);
  const backendRealizedProfit = Number(strategy.realizedProfit ?? strategy.paperRun?.realizedProfit ?? strategy.profit ?? strategy.paperRun?.profit);
  const backendUnrealizedProfit = Number(strategy.unrealizedProfit ?? strategy.paperRun?.unrealizedProfit);
  const backendEquityProfit = Number(strategy.equityProfit ?? strategy.paperRun?.equityProfit);
  const backendRoi = Number(strategy.roi ?? strategy.paperRun?.roi);
  const backendRealizedRoi = Number(strategy.realizedRoi ?? strategy.paperRun?.realizedRoi);

  if (Number.isFinite(backendInitial) && Number.isFinite(backendCurrent)) {
    const equityProfit = Number.isFinite(backendEquityProfit) ? backendEquityProfit : backendCurrent - backendInitial;
    const realizedProfit = Number.isFinite(backendRealizedProfit) ? backendRealizedProfit : equityProfit;
    const unrealizedProfit = Number.isFinite(backendUnrealizedProfit) ? backendUnrealizedProfit : equityProfit - realizedProfit;
    const roi = Number.isFinite(backendRoi) ? backendRoi : (backendInitial ? (equityProfit / backendInitial) * 100 : 0);
    const realizedRoi = Number.isFinite(backendRealizedRoi)
      ? backendRealizedRoi
      : (backendInitial ? (realizedProfit / backendInitial) * 100 : 0);

    return {
      current: backendCurrent,
      initial: backendInitial,
      profit: realizedProfit,
      realizedProfit,
      unrealizedProfit,
      equityProfit,
      roi,
      realizedRoi,
    };
  }

  const initial = strategy.chart[0] || 0;
  const current = strategy.chart[strategy.chart.length - 1] || initial;
  const profit = current - initial;
  const roi = initial ? (profit / initial) * 100 : 0;

  return {
    current,
    initial,
    profit: 0,
    realizedProfit: 0,
    unrealizedProfit: 0,
    equityProfit: profit,
    roi,
    realizedRoi: 0,
  };
};

const formatSignedStrategyPercent = (value) => {
  const number = Number(value) || 0;
  return `${number > 0 ? "+" : ""}${number.toFixed(2).replace(".", ",")}%`;
};

const getStrategyTone = (value) => {
  const number = Number(value) || 0;

  if (number > 0) {
    return "positive";
  }

  if (number < 0) {
    return "negative";
  }

  return "neutral";
};

const getStrategyToneColor = (tone) => {
  if (tone === "positive") {
    return "var(--green)";
  }

  if (tone === "negative") {
    return "var(--red)";
  }

  return "var(--gray)";
};

const getChartRoi = (chart = []) => {
  const firstValue = Number(chart[0]);
  const lastValue = Number(chart[chart.length - 1]);

  if (!Number.isFinite(firstValue) || firstValue <= 0 || !Number.isFinite(lastValue)) {
    return 0;
  }

  return ((lastValue - firstValue) / firstValue) * 100;
};

const formatStrategyRunDate = (runDate) => {
  const date = runDate ? new Date(`${runDate}T13:00:00`) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Сегодня, 13:00";
  }

  return `${date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  })}, 13:00`;
};

const formatStrategyDateTime = (value) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Сегодня, 13:00";
  }

  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatStrategyQuantity = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("ru-RU", {
    maximumFractionDigits: number >= 1000 ? 0 : number >= 1 ? 3 : 6,
  });
};

const getStrategyTradeBase = (trade) => {
  const symbol = String(trade.asset || trade.routeSymbol || "").toUpperCase();

  return symbol.endsWith("USDT") ? symbol.replace(/USDT$/, "") : symbol;
};

const getStrategyTradeActionTime = (trade) => (
  trade.status === "closed"
    ? trade.closedAt || trade.updatedAt || trade.executedAt || trade.date
    : trade.executedAt || trade.updatedAt || trade.date
);

const getStrategyTradeAmountMeta = (trade) => {
  const baseAsset = getStrategyTradeBase(trade);

  return `${formatStrategyQuantity(trade.quantity)} · ${formatStrategyCapital(
    trade.virtualAmount || 0,
    trade.settlementCurrency || "RUB"
  )} · ${baseAsset}`;
};

const getStrategyTradePnlMeta = (trade) => (
  `${formatSignedStrategyPercent(trade.resultPercent)} · ${formatSignedStrategyMoney(trade.resultAmount || 0)}`
);

const formatStrategyPrice = (value, currency = "USDT") => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return `0 ${currency}`;
  }

  return `${number.toLocaleString("ru-RU", {
    maximumFractionDigits: number >= 100 ? 3 : number >= 1 ? 5 : 8,
  })} ${currency}`;
};

const getStrategyTradeExecutionMeta = (trade) => {
  const entry = formatStrategyPrice(trade.entryPrice, trade.quoteCurrency || "USDT");
  const exitLabel = trade.status === "closed" ? "Выход" : "Сейчас";
  const exit = formatStrategyPrice(
    trade.status === "closed" ? trade.exitPrice : trade.currentPrice || trade.exitPrice,
    trade.quoteCurrency || "USDT"
  );
  const fees = Number(trade.feesAmount);

  return `${trade.side === "Short" ? "Вход: продажа" : "Вход: покупка"} · ${entry} · ${exitLabel}: ${exit}${
    Number.isFinite(fees) && fees > 0 ? ` · комиссия ${formatStrategyMoney(fees)}` : ""
  }`;
};

const getStrategyTradeEntryAction = (trade) => (
  trade.side === "Short" ? "Продажа" : "Покупка"
);

const getStrategyTradeExitAction = (trade) => (
  trade.side === "Short" ? "Покупка" : "Продажа"
);

const formatStrategyHistoryDay = (value) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Сегодня";
  }

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const formatStrategyHistoryTime = (value) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Сейчас";
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getStrategyHistoryEventKey = (event) => (
  [
    event.tradeId || event.asset,
    event.type,
    event.time,
    event.action,
  ].filter(Boolean).join(":")
);

const createStrategyHistoryEvent = (trade, type) => {
  const isExit = type === "exit";
  const eventTime = isExit
    ? trade.closedAt || trade.updatedAt || trade.executedAt || trade.date
    : trade.executedAt || trade.date || trade.updatedAt;
  const baseAsset = getStrategyTradeBase(trade);
  const action = isExit ? getStrategyTradeExitAction(trade) : getStrategyTradeEntryAction(trade);
  const date = eventTime ? new Date(eventTime) : new Date();
  const price = isExit
    ? trade.exitPrice || trade.currentPrice || trade.entryPrice
    : trade.entryPrice;

  return {
    ...trade,
    type,
    action,
    baseAsset,
    isExit,
    time: eventTime,
    timestamp: date && !Number.isNaN(date.getTime()) ? date.getTime() : Date.now(),
    dayKey: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "today",
    dayLabel: formatStrategyHistoryDay(eventTime),
    timeLabel: formatStrategyHistoryTime(eventTime),
    price,
    tradeId: trade.id || trade.aiDecisionId || `${trade.asset || "asset"}-${trade.executedAt || trade.date || ""}`,
  };
};

const getStrategyHistoryGroups = (items = []) => {
  const events = [];

  items.forEach((item) => {
    if (!item || item.asset === "NO_SIGNAL") {
      return;
    }

    events.push(createStrategyHistoryEvent(item, "entry"));

    if (item.status === "closed" && (item.closedAt || item.updatedAt)) {
      events.push(createStrategyHistoryEvent(item, "exit"));
    }
  });

  const sortedEvents = events.sort((firstEvent, secondEvent) => secondEvent.timestamp - firstEvent.timestamp);
  const groups = [];
  const groupsByDay = new Map();

  sortedEvents.forEach((event) => {
    if (!groupsByDay.has(event.dayKey)) {
      const group = {
        id: event.dayKey,
        date: event.dayLabel,
        items: [],
      };
      groupsByDay.set(event.dayKey, group);
      groups.push(group);
    }

    groupsByDay.get(event.dayKey).items.push(event);
  });

  return groups;
};

const getStrategyChartPoints = (strategy) => {
  const currentCapital = Number(strategy.currentCapital ?? strategy.paperRun?.currentCapital);
  const initialCapital = Number(strategy.startCapital ?? strategy.paperRun?.startCapital ?? strategy.chart?.[0] ?? 0);
  const strategyTrades = [
    ...(Array.isArray(strategy.historyAllTime) ? strategy.historyAllTime : []),
    ...(Array.isArray(strategy.paperRun?.trades) ? strategy.paperRun.trades : []),
  ];
  const strategyStartDate = [
    strategy.connection?.connectedAt,
    strategy.startedAt,
    strategy.paperRun?.startedAt,
    ...strategyTrades.map((trade) => trade.executedAt || trade.closedAt || trade.updatedAt),
  ]
    .map((value) => (value ? new Date(value) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()))
    .sort((leftDate, rightDate) => leftDate.getTime() - rightDate.getTime())[0];
  const strategyStartAt = strategyStartDate?.toISOString();
  const updatedAt = strategy.updatedAt || strategy.paperRun?.updatedAt || new Date().toISOString();
  const prependStartPoint = (points) => {
    const startDate = strategyStartAt ? new Date(strategyStartAt) : null;
    const firstDate = points[0]?.time ? new Date(points[0].time) : null;

    if (
      !startDate
      || Number.isNaN(startDate.getTime())
      || !firstDate
      || Number.isNaN(firstDate.getTime())
      || firstDate.getTime() - startDate.getTime() <= 60 * 1000
    ) {
      return points;
    }

    return [
      {
        time: startDate.toISOString(),
        value: Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : Number(points[0]?.value) || 0,
        label: "Старт стратегии",
      },
      ...points,
    ];
  };
  const appendCurrentPoint = (points) => {
    if (!Number.isFinite(currentCapital) || !points.length) {
      return points;
    }

    const lastValue = Number(points[points.length - 1]?.value);

    if (Number.isFinite(lastValue) && Math.abs(lastValue - currentCapital) < 0.01) {
      return points;
    }

    return [
      ...points,
      {
        time: updatedAt,
        value: currentCapital,
        label: "Текущий капитал",
      },
    ];
  };

  if (Array.isArray(strategy.chartPoints) && strategy.chartPoints.length > 1) {
    return prependStartPoint(appendCurrentPoint(strategy.chartPoints));
  }

  const startDate = strategyStartAt ? new Date(strategyStartAt) : new Date();

  return prependStartPoint(appendCurrentPoint((strategy.chart || []).map((value, index) => ({
    value,
    time: new Date(startDate.getTime() + index * 11 * 60 * 1000).toISOString(),
    label: index === 0 ? "Старт" : `Шаг ${index}`,
  }))));
};

const formatNumberLike = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toFixed(2).replace(".", ",");
};

const mergeStrategyRun = (baseStrategy, run) => {
  if (!run) {
    return baseStrategy;
  }

  const trades = Array.isArray(run.trades) ? run.trades : [];
  const openTrades = trades.filter((trade) => trade.status !== "closed");
  const history = openTrades.length
    ? openTrades.map((trade, index) => ({
      date: `${formatStrategyDateTime(trade.executedAt || run.startedAt)} · ${Math.round(Number(trade.probability) || 0)}%`,
      asset: trade.asset || trade.name || `Сигнал ${index + 1}`,
      name: trade.name || trade.asset || `Сигнал ${index + 1}`,
      routeSymbol: trade.routeSymbol || trade.asset,
      assetType: trade.assetType || "crypto",
      iconUrl: trade.iconUrl,
      side: trade.side || run.mode || baseStrategy.tag,
      probability: Number(trade.probability) || 0,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      quoteCurrency: trade.quoteCurrency || "USDT",
      settlementCurrency: trade.settlementCurrency || "RUB",
      quantity: trade.quantity,
      virtualAmount: trade.virtualAmount,
      resultPercent: trade.resultPercent,
      resultAmount: trade.resultAmount,
      currentPrice: trade.currentPrice || trade.exitPrice,
      status: trade.status || "open",
      closeReason: trade.closeReason,
      closedAt: trade.closedAt,
      executedAt: trade.executedAt,
      result: `${formatSignedStrategyPercent(trade.resultPercent)} · ${formatStrategyMoney(trade.virtualAmount || 0)}`,
    }))
    : [{
      date: formatStrategyRunDate(run.runDate),
      asset: "NO_SIGNAL",
      side: "Фильтр",
      result: "Открытых позиций сейчас нет",
    }];

  const roi = Number(run.roi ?? getChartRoi(run.chart));
  const decisionMetrics = run.decisionMetrics || {};

  return {
    ...baseStrategy,
    chart: Array.isArray(run.chart) && run.chart.length > 1 ? run.chart : baseStrategy.chart,
    chartPoints: Array.isArray(run.chartPoints) && run.chartPoints.length > 1 ? run.chartPoints : null,
    chartColor: roi === 0 ? baseStrategy.chartColor : getStrategyToneColor(getStrategyTone(roi)),
    startedAt: run.startedAt,
    realizedProfit: Number(run.realizedProfit ?? run.profit ?? 0),
    unrealizedProfit: Number(run.unrealizedProfit ?? 0),
    equityProfit: Number(run.equityProfit ?? ((Number(run.currentCapital) || 0) - (Number(run.startCapital) || 0))),
    realizedRoi: Number(run.realizedRoi ?? 0),
    history,
    stats: [
      { label: "Модель", value: baseStrategy.stats[0]?.value || "Pulse AI" },
      { label: "Решений AI", value: String(decisionMetrics.decisionsCount ?? 0) },
      { label: "NO_TRADE", value: String(decisionMetrics.noTradeCount ?? 0) },
      { label: "Средний EV", value: `${formatNumberLike(decisionMetrics.avgExpectedValue ?? 0)}%` },
      { label: "Сделок сегодня", value: String(run.totalTradesCount ?? trades.length) },
      { label: "Закрытых сделок", value: String(run.closedTradesCount ?? trades.filter((trade) => trade.status === "closed").length) },
      { label: "Точность закрытых", value: `${formatNumberLike(run.accuracy)}%` },
      { label: "Просадка", value: formatSignedStrategyPercent(run.maxDrawdown) },
    ],
    historyAllTime: Array.isArray(run.historyAllTime) ? run.historyAllTime : trades,
    memory: Array.isArray(run.memory) ? run.memory : [],
    errorLog: Array.isArray(run.errorLog) ? run.errorLog : [],
    decisionMetrics,
    connection: run.connection || null,
    margin: run.margin || null,
    capitalCurrency: run.capitalCurrency || run.connection?.capitalCurrency || "RUB",
    paperRun: run,
  };
};

function StrategyCardSkeleton() {
  return (
    <div className="marketcard_container strategy_card_skeleton" aria-label="Загружаем стратегию">
      <div className="market_card_content">
        <div className="imageCard strategy_skeleton_chart">
          <LoaderAnimation height={100} rounded="15px" />
        </div>
        <div className="titleCardMarket">
          <div className="textOfcard strategy_skeleton_text">
            <span />
            <p />
            <p />
          </div>
          <div className="strategy_skeleton_button" />
        </div>
        <div className="wejwedf">
          <div className="lineeeeeee"></div>
        </div>
        <div className="tagcardMarket">
          <div className="strategy_skeleton_meta" />
          <div className="strategy_skeleton_tag" />
        </div>
      </div>
    </div>
  );
}

function StrategyLineChart({ values = [], color = "var(--primary-blue)", size = "compact" }) {
  const chartValues = values.length > 1 ? values : [0, 1];
  const width = size === "hero" ? 520 : 340;
  const height = size === "hero" ? 150 : 100;
  const padding = size === "hero" ? 18 : 12;
  const min = Math.min(...chartValues);
  const max = Math.max(...chartValues);
  const range = max - min || 1;
  const chartPoints = chartValues.map((value, index) => {
      const x = padding + (index / Math.max(chartValues.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);

      return { x, y };
    });
  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  const lastPoint = chartPoints[chartPoints.length - 1];
  const gradientId = `strategy-chart-gradient-${size}-${String(color).replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      className={`strategy_line_chart strategy_line_chart_${size}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="График капитала стратегии"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="strategy_chart_area" d={areaPath} fill={`url(#${gradientId})`} />
      <path
        className="strategy_chart_line"
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={size === "hero" ? "3" : "2.6"}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
      />
      <g className="strategy_chart_last_point">
        <circle cx={lastPoint.x} cy={lastPoint.y} r={size === "hero" ? "6" : "4.5"} fill={color} />
        <circle cx={lastPoint.x} cy={lastPoint.y} r={size === "hero" ? "3" : "2.4"} fill="white" />
      </g>
    </svg>
  );
}

function StrategyCapitalChart({ strategy, color }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const chartRef = useRef(null);
  const chartPoints = getStrategyChartPoints(strategy)
    .map((point) => ({
      ...point,
      value: Number(point.value),
      date: point.time ? new Date(point.time) : null,
    }))
    .filter((point) => Number.isFinite(point.value));
  const width = 900;
  const height = 230;
  const padding = { top: 18, right: 118, bottom: 34, left: 18 };

  if (chartPoints.length < 2) {
    return (
      <div className="strategy_capital_chart strategy_capital_chart_empty">
        <span>График появится после первых сигналов стратегии</span>
      </div>
    );
  }

  const minValue = Math.min(...chartPoints.map((point) => point.value));
  const maxValue = Math.max(...chartPoints.map((point) => point.value));
  const range = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const gradientId = `strategy-capital-gradient-${strategy.id}-${String(color).replace(/[^a-zA-Z0-9]/g, "")}`;
  const visualMin = minValue - range * 0.12;
  const visualMax = maxValue + range * 0.12;
  const visualRange = visualMax - visualMin || 1;
  const points = chartPoints.map((point, index) => {
    const x = padding.left + (index / Math.max(chartPoints.length - 1, 1)) * chartWidth;
    const y = padding.top + (1 - ((point.value - visualMin) / visualRange)) * chartHeight;

    return { ...point, x, y };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${width - padding.right} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;
  const gridValues = [visualMax, visualMax - visualRange * 0.33, visualMax - visualRange * 0.66, visualMin];
  const lastPoint = points[points.length - 1] || { x: padding.left, y: padding.top, value: 0 };
  const tooltipGoesLeft = hoveredPoint ? hoveredPoint.cursorX > hoveredPoint.chartWidth - 220 : false;

  const handlePointerMove = (event) => {
    const svgRect = event.currentTarget.getBoundingClientRect();
    const chartRect = chartRef.current?.getBoundingClientRect() || svgRect;
    const scale = Math.min(svgRect.width / width, svgRect.height / height) || 1;
    const renderedWidth = width * scale;
    const renderedHeight = height * scale;
    const offsetX = (svgRect.width - renderedWidth) / 2;
    const offsetY = (svgRect.height - renderedHeight) / 2;
    const rawX = ((event.clientX - svgRect.left - offsetX) / renderedWidth) * width;
    const rawY = ((event.clientY - svgRect.top - offsetY) / renderedHeight) * height;
    const x = Math.min(Math.max(rawX, 0), width);
    const cursorX = Math.min(Math.max(event.clientX - chartRect.left, 10), Math.max(chartRect.width - 10, 10));
    const cursorY = Math.min(Math.max(event.clientY - chartRect.top, 24), Math.max(chartRect.height - 24, 24));
    const nearestPoint = points.reduce((nearest, point) => (
      Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest
    ), points[0]);

    setHoveredPoint({
      ...nearestPoint,
      cursorX,
      cursorY,
      chartWidth: chartRect.width,
      chartHeight: chartRect.height,
      pointerY: Math.min(Math.max(rawY, 0), height),
    });
  };

  return (
    <div className="strategy_capital_chart" ref={chartRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerEnter={handlePointerMove}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridValues.map((value, index) => {
          const y = padding.top + (1 - ((value - visualMin) / visualRange)) * chartHeight;

          return (
            <g key={`strategy-grid-${index}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="strategy_capital_grid" />
              {index === 0 || index === gridValues.length - 1 ? (
                <text x={width - padding.right + 16} y={y + 4} className="strategy_capital_axis">
                  {formatStrategyAxisMoney(value)}
                </text>
              ) : null}
            </g>
          );
        })}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="strategy_capital_line"
        />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="5" fill={color} stroke="white" strokeWidth="2" />
        {hoveredPoint ? (
          <>
            <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={padding.top} y2={height - padding.bottom} className="strategy_capital_hover" />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" fill={color} stroke="white" strokeWidth="2" />
          </>
        ) : null}
        {points.map((point, index) => (
          <text
            key={`strategy-date-${point.time || index}`}
            x={point.x}
            y={height - 10}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            className="strategy_capital_axis"
          >
            {index === 0 || index === points.length - 1 ? formatStrategyDateTime(point.time).replace(",", "") : ""}
          </text>
        ))}
      </svg>
      {hoveredPoint ? (
        <div
          className={`strategy_capital_tooltip ${tooltipGoesLeft ? "strategy_capital_tooltip_left" : ""}`}
          style={{
            left: `${hoveredPoint.cursorX}px`,
            top: `${hoveredPoint.cursorY}px`,
          }}
        >
          <strong>{formatStrategyMoney(hoveredPoint.value)}</strong>
          <span>{formatStrategyDateTime(hoveredPoint.time)}</span>
          <p>{hoveredPoint.label || "Изменение капитала"}</p>
        </div>
      ) : null}
    </div>
  );
}

function StrategyConnectPanel({
  strategy,
  form,
  message,
  isConnecting,
  onChange,
  onBack,
  onConnect,
}) {
  const amount = Number(String(form.amount).replace(",", "."));
  const normalizedAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const capitalCurrency = String(form.currency || "RUB").toUpperCase();
  const capitalRub = getStrategyCapitalRub(normalizedAmount, capitalCurrency);
  const minAmount = capitalCurrency === "RUB"
    ? STRATEGY_MIN_CAPITAL_RUB
    : Math.ceil((STRATEGY_MIN_CAPITAL_RUB / STRATEGY_USDT_RUB_RATE) * 100) / 100;
  const isCryptoUniverse = form.universe !== "stocks";
  const universeLabels = {
    crypto: "Криптовалюта",
    stocks: "Ценные бумаги",
    mixed: "Смешанный рынок",
  };
  const marginModeLabels = {
    none: "Без маржи",
    spot_cross: "Spot margin",
    linear_cross: "Фьючерсы Cross",
    linear_isolated: "Фьючерсы Isolated",
  };

  return (
    <div className="strategy_connect_panel">
      <div className="strategy_section_title">
        <h3>Подключение стратегии</h3>
        <p>Стратегия подключается к выбранному рынку с лимитом капитала, защитой по минимальной сумме и отдельными параметрами маржинальной торговли.</p>
      </div>

      <div className="strategy_trade_side_switch">
        {[
          ["crypto", "Крипта"],
          ["stocks", "Акции"],
          ["mixed", "Смешанный"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={form.universe === value ? "active" : ""}
            onClick={() => onChange({
              universe: value,
              currency: value === "stocks" ? "RUB" : form.currency,
              marginEnabled: value === "stocks" ? false : form.marginEnabled,
              marginMode: value === "stocks" ? "none" : form.marginMode,
              leverage: value === "stocks" ? "1" : form.leverage,
            })}
            aria-pressed={form.universe === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="strategy_trade_side_switch strategy_trade_currency_switch">
        {[
          ["RUB", "Рубли"],
          ["USDT", "USDT"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={capitalCurrency === value ? "active" : ""}
            disabled={value === "USDT" && form.universe === "stocks"}
            onClick={() => onChange({ currency: value })}
            aria-pressed={capitalCurrency === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="strategy_trade_balance_grid">
        <div>
          <span>Капитал стратегии</span>
          <p>{formatStrategyCapital(normalizedAmount || minAmount, capitalCurrency)}</p>
        </div>
        <div className="border_blue">
          <span>Минимум подключения</span>
          <p>{formatStrategyCapital(minAmount, capitalCurrency)}</p>
        </div>
      </div>

      <label className="strategy_trade_input_label">
        <span>Сумма стратегии, {capitalCurrency}</span>
        <input
          value={form.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
          inputMode="decimal"
          placeholder={String(minAmount)}
        />
      </label>

      <div className="strategy_trade_quick_amounts" aria-label="Быстрый выбор суммы стратегии">
        {(capitalCurrency === "RUB"
          ? [["5000", "5 000 ₽"], ["25000", "25 000 ₽"], ["100000", "100 000 ₽"]]
          : [[String(minAmount), `${minAmount} USDT`], ["250", "250 USDT"], ["1000", "1 000 USDT"]]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange({ amount: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="strategy_trade_result_card">
        <div>
          <span>Стратегия</span>
          <strong>{strategy.title}</strong>
        </div>
        <div>
          <span>Торговый режим</span>
          <strong>{strategy.tag}</strong>
        </div>
        <div>
          <span>Рынок</span>
          <strong>{universeLabels[form.universe]}</strong>
        </div>
        <div>
          <span>Маржа</span>
          <strong>{form.marginEnabled && isCryptoUniverse ? `${marginModeLabels[form.marginMode]} · ${form.leverage}x` : "Выключена"}</strong>
        </div>
      </div>

      {isCryptoUniverse ? (
        <div className="strategy_connect_field strategy_connect_margin_box">
          <div className="strategy_connect_field_header">
            <span>Маржинальная торговля Bybit</span>
            <button
              type="button"
              className={form.marginEnabled ? "strategy_toggle strategy_toggle_active" : "strategy_toggle"}
              onClick={() => onChange({
                marginEnabled: !form.marginEnabled,
                marginMode: !form.marginEnabled ? "spot_cross" : "none",
                leverage: !form.marginEnabled ? form.leverage : "1",
              })}
            >
              {form.marginEnabled ? "Включена" : "Выключена"}
            </button>
          </div>
          <p>
            Spot margin требует включенной маржи на аккаунте Bybit. Фьючерсный режим использует `linear`-контракты и отдельное плечо.
          </p>
          {form.marginEnabled ? (
            <>
              <div className="strategy_connect_chips">
                {[
                  ["spot_cross", "Spot cross"],
                  ["linear_cross", "Linear cross"],
                  ["linear_isolated", "Linear isolated"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={form.marginMode === value ? "active" : ""}
                    onClick={() => onChange({ marginMode: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="strategy_leverage_slider">
                <div>
                  <span>Плечо стратегии</span>
                  <strong>{form.leverage}x</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={form.leverage}
                  onChange={(event) => onChange({ leverage: event.target.value })}
                />
                <div className="strategy_leverage_marks">
                  <span>1x</span>
                  <span>5x</span>
                  <span>10x</span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="strategy_connect_message">{message}</p> : null}
      {!message ? (
        <p className={capitalRub < STRATEGY_MIN_CAPITAL_RUB ? "strategy_connect_hint strategy_connect_hint_error" : "strategy_connect_hint"}>
          {capitalRub < STRATEGY_MIN_CAPITAL_RUB
            ? "Минимальная сумма подключения стратегии — 5 000 ₽."
            : "После подключения стратегия стартует с нулевым PnL, сохраняет сделки отдельно от портфеля и ведет историю за всё время."}
        </p>
      ) : null}

      <div className="strategy_connect_actions">
        <Buttons type="text" onClick={onBack}>Назад</Buttons>
        <Buttons type="primary-full" onClick={onConnect} disabled={isConnecting || capitalRub < STRATEGY_MIN_CAPITAL_RUB}>
          {isConnecting ? "Подключаем..." : "Подключить стратегию"}
        </Buttons>
      </div>
    </div>
  );
}

function StrategyHistoryPanel({
  strategy,
  items,
  isLoading,
  error,
  isResetting,
  onBack,
  onReset,
  onOpenAsset,
}) {
  const historyItems = Array.isArray(items) && items.length
    ? items
    : strategy.historyAllTime || strategy.history || [];
  const historyGroups = getStrategyHistoryGroups(historyItems);

  return (
    <div className="strategy_history_panel">
      <div className="strategy_section_title">
        <h3>История стратегии</h3>
        <p>Отдельная история сигналов и сделок стратегии. Она не смешивается с историей портфеля.</p>
      </div>
      <button
        className="strategy_reset_history_button"
        type="button"
        onClick={onReset}
        disabled={isResetting}
      >
        {isResetting ? "Очищаем..." : "Очистить историю и начать заново"}
      </button>

      {isLoading ? (
        <div className="strategy_history_loading">
          <LoaderAnimation height={96} rounded="16px" />
          <LoaderAnimation height={96} rounded="16px" />
        </div>
      ) : error ? (
        <div className="strategy_history_empty">{error}</div>
      ) : (
        <div className="trade_history_list strategy_trade_history_list">
          {historyGroups.length ? historyGroups.map((dayBlock) => (
            <div key={`${strategy.id}-${dayBlock.id}`} className="trade_history_day">
              <p className="trade_history_day_label">{dayBlock.date}</p>
              <div className="trade_history_day_items">
                {dayBlock.items.map((item) => {
                  const tone = getStrategyTone(item.resultAmount);
                  const isNavigable = item.asset && item.asset !== "NO_SIGNAL";
                  const actionTone = item.action === "Продажа" ? "sell" : "buy";

                  return (
                    <button
                      className="trade_history_item strategy_trade_history_item"
                      key={`${strategy.id}-history-${getStrategyHistoryEventKey(item)}`}
                      type="button"
                      disabled={!isNavigable}
                      onClick={() => {
                        if (isNavigable) {
                          onOpenAsset(item);
                        }
                      }}
                    >
                      <div className="trade_history_item_main">
                        <CoinIcon
                          baseCoin={item.baseAsset || "AI"}
                          iconUrl={item.iconUrl}
                          label={item.name || item.asset || "AI"}
                          type={item.assetType === "stock" ? "stock" : "crypto"}
                        />
                        <div>
                          <h4>{item.name || item.asset || "Нет сигнала"}</h4>
                          <p>
                            Pulse AI · {item.timeLabel} · {item.baseAsset}
                          </p>
                        </div>
                      </div>
                      <div className="trade_history_item_meta strategy_trade_history_meta">
                        <span className={`trade_history_badge trade_history_badge_${actionTone}`}>
                          {item.action}
                        </span>
                        <strong>
                          {getStrategyTradeAmountMeta(item)}
                        </strong>
                        <small className="strategy_trade_history_price">
                          {item.isExit ? "Цена выхода" : "Цена входа"} · {formatStrategyPrice(item.price, item.quoteCurrency || "USDT")}
                        </small>
                        {item.isExit ? (
                          <small className={`strategy_history_pnl strategy_history_result_${tone}`}>
                            {getStrategyTradePnlMeta(item)}
                          </small>
                        ) : (
                          <small className="strategy_history_pnl strategy_history_result_neutral">
                            Вход в позицию
                          </small>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )) : (
            <div className="strategy_history_empty">
              История появится после подключения стратегии и первых сигналов.
            </div>
          )}
        </div>
      )}

      <div className="strategy_connect_actions">
        <Buttons type="text" onClick={onBack}>Назад</Buttons>
      </div>
    </div>
  );
}

function StrategyDrawer({
  strategy,
  isOpen,
  mode,
  connectForm,
  connectMessage,
  historyItems,
  isHistoryLoading,
  historyError,
  isHistoryResetting,
  isConnecting,
  onConnectFormChange,
  onOpenConnect,
  onOpenHistory,
  onResetHistory,
  onBackToOverview,
  onConnectStrategy,
  onOpenAsset,
  onClose,
}) {
  if (!strategy) {
    return null;
  }

  const capital = getStrategyCapital(strategy);
  const strategyStats = [
    { label: "Стартовый капитал", value: formatStrategyMoney(capital.initial) },
    { label: "Текущий капитал", value: formatStrategyMoney(capital.current), tone: getStrategyTone(capital.equityProfit) },
    { label: "Зафиксировано", value: formatSignedStrategyMoney(capital.realizedProfit), accent: true },
    { label: "Открытая переоценка", value: formatSignedStrategyMoney(capital.unrealizedProfit), tone: getStrategyTone(capital.unrealizedProfit) },
    ...strategy.stats.filter((item) => item.label !== "Модель"),
  ];
  const startedAtLabel = formatStrategyDateTime(strategy.startedAt || strategy.paperRun?.startedAt);

  const drawer = (
    <div
      className={`strategy_drawer_overlay ${isOpen ? "strategy_drawer_overlay_open" : ""}`}
      onMouseDown={onClose}
    >
      <aside
        className={`strategy_drawer ${isOpen ? "strategy_drawer_open" : ""}`}
        aria-label={`Стратегия ${strategy.title}`}
        aria-hidden={!isOpen}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {mode !== "history" ? (
          <div className="strategy_drawer_hero">
            {mode === "connect" ? (
              <div className="strategy_connect_hero">
                <span>{strategy.tag}</span>
                <h2>{strategy.title}</h2>
                <p>Настрой капитал, рынок, валюту и маржинальный режим перед подключением стратегии.</p>
              </div>
            ) : (
              <StrategyCapitalChart strategy={strategy} color={strategy.chartColor} />
            )}
            <button className="strategy_drawer_close" type="button" onClick={onClose} aria-label="Закрыть стратегию">
              ×
            </button>
          </div>
        ) : (
          <button
            className="strategy_drawer_close strategy_drawer_close_history"
            type="button"
            onClick={onClose}
            aria-label="Закрыть стратегию"
          >
            ×
          </button>
        )}

        {mode === "connect" ? (
          <div className="strategy_drawer_body">
            <StrategyConnectPanel
              strategy={strategy}
              form={connectForm}
              message={connectMessage}
              isConnecting={isConnecting}
              onChange={onConnectFormChange}
              onBack={onBackToOverview}
              onConnect={onConnectStrategy}
            />
          </div>
        ) : mode === "history" ? (
          <div className="strategy_drawer_body">
            <StrategyHistoryPanel
              strategy={strategy}
              items={historyItems}
              isLoading={isHistoryLoading}
              error={historyError}
              isResetting={isHistoryResetting}
              onBack={onBackToOverview}
              onReset={onResetHistory}
              onOpenAsset={onOpenAsset}
            />
          </div>
        ) : (
          <div className="strategy_drawer_body">
            <div className="strategy_drawer_intro">
              <div className="strategy_drawer_title_row">
                <span>{strategy.tag}</span>
                <h2>{strategy.title}</h2>
              </div>
              <p>{strategy.description}</p>
              <div className="strategy_start_badge">
                <span>Старт стратегии</span>
                <strong>{startedAtLabel}</strong>
              </div>
            </div>

            <div className="strategy_stats_grid">
              {strategyStats.map((item) => (
                <div
                  className={[
                    "strategy_stat_card",
                    item.accent ? "strategy_stat_card_accent" : "",
                    item.tone ? `strategy_stat_card_${item.tone}` : "",
                  ].filter(Boolean).join(" ")}
                  key={`${strategy.id}-${item.label}`}
                >
                  <p>{item.label}</p>
                  <h4>{item.value}</h4>
                </div>
              ))}
            </div>

            <div className="strategy_drawer_section">
              <div className="strategy_section_title">
                <h3>Открытые позиции</h3>
                <p>Что стратегия держит прямо сейчас</p>
              </div>
              <div className="strategy_history_list strategy_history_list_preview">
                {strategy.history.map((item) => {
                  const tone = getStrategyTone(item.resultPercent);
                  const baseAsset = getStrategyTradeBase(item);
                  const isNavigable = item.asset && item.asset !== "NO_SIGNAL";

                  if (!isNavigable) {
                    return (
                      <button
                        className="strategy_history_item"
                        key={`${strategy.id}-${item.date}-${item.asset}`}
                        type="button"
                        disabled
                      >
                        <div className="strategy_history_asset">
                          <CoinIcon baseCoin="AI" label="AI" />
                          <div>
                            <h4>Открытых позиций пока нет</h4>
                            <p>{item.result || "Стратегия ждет подходящий вход"}</p>
                          </div>
                        </div>
                      </button>
                    );
                  }

                  return (
                    <button
                      className="strategy_history_item"
                      key={`${strategy.id}-${item.date}-${item.asset}`}
                      type="button"
                      onClick={() => onOpenAsset(item)}
                    >
                      <div className="strategy_history_asset">
                        <CoinIcon
                          baseCoin={baseAsset}
                          iconUrl={item.iconUrl}
                          label={item.name || item.asset}
                          type={item.assetType === "stock" ? "stock" : "crypto"}
                        />
                        <div>
                          <h4>{item.name || item.asset}</h4>
                          <p>Pulse AI · {formatStrategyDateTime(getStrategyTradeActionTime(item))} · {baseAsset}</p>
                        </div>
                      </div>
                      <div className="strategy_history_prices">
                        <span
                          className={`strategy_history_badge strategy_history_badge_${item.side === "Short" ? "sell" : "buy"}`}
                        >
                          {getStrategyTradeEntryAction(item)}
                        </span>
                        <span>{getStrategyTradeAmountMeta(item)}</span>
                        <em className="strategy_history_execution">
                          {getStrategyTradeExecutionMeta(item)}
                        </em>
                        <small className={`strategy_history_pnl strategy_history_result_${tone}`}>
                          {getStrategyTradePnlMeta(item)}
                        </small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Buttons type="primary-full" className="strategy_connect_button" onClick={onOpenConnect}>
              Подключить стратегию
            </Buttons>
            <Buttons type="black_prymary-widht" className="strategy_history_button" onClick={onOpenHistory}>
              История стратегии
            </Buttons>
            <p className="strategy_warning">
              Сигналы работают по рыночным данным, сохраняются отдельно от портфеля и не являются персональной инвестиционной рекомендацией.
            </p>
          </div>
        )}
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}

const getInitialFavorites = () => {
  try {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);

    return savedFavorites ? JSON.parse(savedFavorites) : [];
  } catch {
    return [];
  }
};


export default function Market() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activePage, setActivePage] = useState(
    ["crypto", "stocks", "favorites", "strategies"].includes(initialTab)
      ? initialTab
      : "strategies"
  );
  const [currencies, setCurrencies] = useState(
    () => readCachedValue(marketCacheKey("crypto", 1), MARKET_CACHE_MAX_AGE)?.items || []
  );
  const [currenciesError, setCurrenciesError] = useState("");
  const [isCurrenciesLoading, setIsCurrenciesLoading] = useState(currencies.length === 0);
  const [stocks, setStocks] = useState(
    () => readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_TBANK), MARKET_CACHE_MAX_AGE)?.items
      || readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_MOEX), MARKET_CACHE_MAX_AGE)?.items
      || []
  );
  const [, setStocksSource] = useState(
    () => readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_TBANK), MARKET_CACHE_MAX_AGE)?.source
      || readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_MOEX), MARKET_CACHE_MAX_AGE)?.source
      || STOCK_SOURCE_MOEX
  );
  const [stocksError, setStocksError] = useState("");
  const [isStocksLoading, setIsStocksLoading] = useState(stocks.length === 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [cryptoPage, setCryptoPage] = useState(1);
  const [stocksPage, setStocksPage] = useState(1);
  const [cryptoTotal, setCryptoTotal] = useState(
    () => readCachedValue(marketCacheKey("crypto", 1), MARKET_CACHE_MAX_AGE)?.total || 0
  );
  const [stocksTotal, setStocksTotal] = useState(
    () => readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_TBANK), MARKET_CACHE_MAX_AGE)?.total
      || readCachedValue(marketCacheKey("stocks", 1, STOCK_SOURCE_MOEX), MARKET_CACHE_MAX_AGE)?.total
      || 0
  );
  const [favorites, setFavorites] = useState(getInitialFavorites);
	  const [searchIndex, setSearchIndex] = useState([]);
	  const [isSearchLoading, setIsSearchLoading] = useState(false);
	  const [hasSearchIndexLoaded, setHasSearchIndexLoaded] = useState(false);
	  const [searchIndexError, setSearchIndexError] = useState("");
	  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [strategyRuns, setStrategyRuns] = useState(
    () => readCachedValue(STRATEGY_CACHE_KEY, STRATEGY_CACHE_MAX_AGE)?.items || []
  );
  const [, setIsStrategiesLoading] = useState(
    activePage === "strategies" && strategyRuns.length === 0
  );
  const [strategiesError, setStrategiesError] = useState("");
		  const [selectedStrategy, setSelectedStrategy] = useState(null);
		  const [isStrategyDrawerOpen, setIsStrategyDrawerOpen] = useState(false);
		  const [strategyDrawerMode, setStrategyDrawerMode] = useState("overview");
		  const [strategyConnectForm, setStrategyConnectForm] = useState({
		    amount: "5000",
		    universe: "mixed",
		    risk: "balanced",
        currency: "RUB",
        marginEnabled: false,
        marginMode: "none",
        leverage: "1",
		  });
		  const [strategyConnectMessage, setStrategyConnectMessage] = useState("");
		  const [isConnectingStrategy, setIsConnectingStrategy] = useState(false);
  const [strategyHistoryItems, setStrategyHistoryItems] = useState([]);
  const [isStrategyHistoryLoading, setIsStrategyHistoryLoading] = useState(false);
  const [isStrategyHistoryResetting, setIsStrategyHistoryResetting] = useState(false);
  const [strategyHistoryError, setStrategyHistoryError] = useState("");
  const cryptoAbortRef = useRef(null);
  const stocksAbortRef = useRef(null);
  const cryptoRequestIdRef = useRef(0);
  const stocksRequestIdRef = useRef(0);
  const strategiesRequestIdRef = useRef(0);
  const strategiesRequestPendingRef = useRef(false);
  const strategyHistoryRequestIdRef = useRef(0);
  const strategyCloseTimerRef = useRef(null);
  const navigate = useNavigate();
  const pages = [
    { id: "strategies", label: "Стратегии" },
    { id: "crypto", label: "Криптовалюта" },
    { id: "stocks", label: "Акции" },
    { id: "bonds", label: "Облигации", disabled: true },
    { id: "futures", label: "Фьючерсы", disabled: true },
    { id: "favorites", label: "Избранные" },
  ];

  const getFavoriteKey = useCallback((type, symbol) => {
    return `${type}:${String(symbol || "").toUpperCase()}`;
  }, []);

  const isFavorite = useCallback((type, symbol) => {
    const favoriteKey = getFavoriteKey(type, symbol);

    return favorites.some((item) => item.favoriteKey === favoriteKey);
  }, [favorites, getFavoriteKey]);

  const createFavoriteAsset = useCallback((type, asset) => {
    const symbol = asset.symbol || asset.baseCoin || asset.shortName;

    return {
      favoriteKey: getFavoriteKey(type, symbol),
      type,
      id: asset.id,
      figi: asset.figi,
      symbol,
      name: asset.name,
      shortName: asset.shortName || asset.baseCoin || asset.symbol,
      baseCoin: asset.baseCoin || asset.symbol,
      iconUrl: asset.iconUrl,
      lotSize: asset.lotSize,
      provider: asset.provider,
      providerLabel: asset.providerLabel,
      tradingStatus: asset.tradingStatus,
      isTradingOpen: asset.isTradingOpen,
      isTradable: asset.isTradable,
      price: asset.price,
      priceChangePercent24h: asset.priceChangePercent24h,
      priceChangePercent7d: asset.priceChangePercent7d,
      priceChangePercent30d: asset.priceChangePercent30d,
      chart7d: asset.chart7d || [],
    };
  }, [getFavoriteKey]);

  const toggleFavorite = useCallback((asset) => {
    setFavorites((currentFavorites) => {
      const isAlreadyFavorite = currentFavorites.some(
        (item) => item.favoriteKey === asset.favoriteKey
      );
      const nextFavorites = isAlreadyFavorite
        ? currentFavorites.filter((item) => item.favoriteKey !== asset.favoriteKey)
        : [asset, ...currentFavorites];

      localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        JSON.stringify(nextFavorites)
      );

      return nextFavorites;
    });
  }, []);

	  const openAssetPage = useCallback((type, assetOrSymbol) => {
	    const asset = typeof assetOrSymbol === "object" && assetOrSymbol !== null
	      ? assetOrSymbol
	      : null;
	    const symbol = asset?.symbol || asset?.baseCoin || assetOrSymbol;
	    const normalizedSymbol = String(symbol || "").trim();

	    if (!normalizedSymbol) {
	      return;
	    }

	    if (type === "crypto" && STABLE_CRYPTO_SYMBOLS.has(normalizedSymbol.toUpperCase())) {
	      return;
	    }

	    const params = new URLSearchParams({
	      type,
	      symbol: normalizedSymbol,
	    });

    if (type === "stock" && asset?.figi) {
      params.set("figi", asset.figi);
    }

    if (type === "stock" && asset?.provider) {
      params.set("source", asset.provider);
    }

    navigate(`/app/market/coin-page?${params.toString()}`);
  }, [navigate]);

	  const openSearchResult = useCallback((asset) => {
	    setSearchQuery("");
	    setIsSearchFocused(false);
	    openAssetPage(asset.type, asset);
	  }, [openAssetPage]);

	  const openStrategyTradeAsset = useCallback((trade) => {
	    const assetType = trade.assetType === "stock" ? "stock" : "crypto";
	    const symbol = trade.routeSymbol || trade.asset;

	    openAssetPage(assetType, {
	      symbol,
	      baseCoin: symbol,
	      name: trade.name || symbol,
	      iconUrl: trade.iconUrl,
	    });
	  }, [openAssetPage]);

	  const openStrategy = useCallback((strategy) => {
	    if (strategyCloseTimerRef.current) {
	      window.clearTimeout(strategyCloseTimerRef.current);
	    }

	    setSelectedStrategy(strategy);
	    setStrategyDrawerMode("overview");
	    setStrategyConnectMessage("");
      setStrategyHistoryItems([]);
      setStrategyHistoryError("");
	    window.requestAnimationFrame(() => setIsStrategyDrawerOpen(true));
	  }, []);

		  const closeStrategy = useCallback(() => {
		    setIsStrategyDrawerOpen(false);

    if (strategyCloseTimerRef.current) {
      window.clearTimeout(strategyCloseTimerRef.current);
    }

	    strategyCloseTimerRef.current = window.setTimeout(() => {
	      setSelectedStrategy(null);
	      setStrategyDrawerMode("overview");
	      setStrategyConnectMessage("");
	      setIsConnectingStrategy(false);
	    }, 260);
		  }, []);

	  const updateStrategyConnectForm = useCallback((patch) => {
	    setStrategyConnectForm((currentForm) => ({
	      ...currentForm,
	      ...patch,
	    }));
	    setStrategyConnectMessage("");
	  }, []);

	  const connectStrategy = useCallback(async () => {
	    if (!selectedStrategy || isConnectingStrategy) {
	      return;
	    }

	    const amount = Number(String(strategyConnectForm.amount).replace(",", "."));
	    const normalizedAmount = Number.isFinite(amount) && amount > 0 ? amount : 5000;
      const capitalCurrency = String(strategyConnectForm.currency || "RUB").toUpperCase();
      const capitalRub = getStrategyCapitalRub(normalizedAmount, capitalCurrency);
	    const universeLabels = {
	      crypto: "криптовалютам",
	      stocks: "ценным бумагам",
	      mixed: "смешанному рынку",
	    };

      if (capitalRub < STRATEGY_MIN_CAPITAL_RUB) {
        setStrategyConnectMessage("Минимальная сумма подключения стратегии — 5 000 ₽.");
        return;
      }

	    setIsConnectingStrategy(true);
	    setStrategyConnectMessage("");

	    try {
	      const response = await api.post(`/ai/strategies/${selectedStrategy.id}/connect`, {
	        virtual_capital: normalizedAmount,
	        universe: strategyConnectForm.universe,
	        risk_profile: strategyConnectForm.risk,
          capital_currency: capitalCurrency,
          margin_enabled: Boolean(strategyConnectForm.marginEnabled),
          margin_mode: strategyConnectForm.marginEnabled ? strategyConnectForm.marginMode : "none",
          leverage: Number(strategyConnectForm.marginEnabled ? strategyConnectForm.leverage : 1),
	      });
	      const nextRun = response.data?.strategy;

	      if (nextRun) {
	        setStrategyRuns((currentRuns) => {
	          const hasRun = currentRuns.some((run) => run.id === nextRun.id);
	          return hasRun
	            ? currentRuns.map((run) => (run.id === nextRun.id ? nextRun : run))
	            : [nextRun, ...currentRuns];
	        });
	        const baseStrategy = MARKET_STRATEGIES.find((strategy) => strategy.id === nextRun.id) || selectedStrategy;
	        setSelectedStrategy(mergeStrategyRun(baseStrategy, nextRun));
	      }

	      setStrategyConnectForm((currentForm) => ({
	        ...currentForm,
	        amount: String(Math.round(normalizedAmount)),
	      }));
	      setStrategyConnectMessage(
	        `Стратегия подключена на ${formatStrategyCapital(normalizedAmount, capitalCurrency)} по ${universeLabels[strategyConnectForm.universe] || "рынку"}.`
	      );
	    } catch {
	      setStrategyConnectMessage("Не удалось сохранить подключение стратегии. Проверьте backend и попробуйте еще раз.");
	    } finally {
	      setIsConnectingStrategy(false);
	    }
	  }, [
	    isConnectingStrategy,
	    selectedStrategy,
	    strategyConnectForm.amount,
      strategyConnectForm.currency,
      strategyConnectForm.leverage,
      strategyConnectForm.marginEnabled,
      strategyConnectForm.marginMode,
	    strategyConnectForm.risk,
	    strategyConnectForm.universe,
	  ]);

	  const applyStrategyRuns = useCallback((nextRuns) => {
      if (!Array.isArray(nextRuns) || nextRuns.length === 0) {
        return;
      }

      writeCachedValue(STRATEGY_CACHE_KEY, { items: nextRuns });
	    setStrategyRuns(nextRuns);
	    setSelectedStrategy((currentStrategy) => {
	      if (!currentStrategy) {
	        return currentStrategy;
	      }

	      const nextRun = nextRuns.find((run) => run.id === currentStrategy.id);
	      if (!nextRun) {
	        return currentStrategy;
	      }

	      const baseStrategy = MARKET_STRATEGIES.find((strategy) => strategy.id === nextRun.id) || currentStrategy;
	      return mergeStrategyRun(baseStrategy, nextRun);
	    });
	  }, []);

	  const fetchStrategies = useCallback((showLoading = false) => {
      if (strategiesRequestPendingRef.current) {
        return Promise.resolve();
      }

	    const requestId = strategiesRequestIdRef.current + 1;
	    strategiesRequestIdRef.current = requestId;
      strategiesRequestPendingRef.current = true;

	    if (showLoading) {
	      setIsStrategiesLoading(true);
	    }

      let keepLoadingAfterResponse = false;

	    return api
	      .get("/ai/strategies")
	      .then((response) => {
	        if (requestId !== strategiesRequestIdRef.current) {
	          return;
	        }

          const items = response.data?.items || [];
          if (items.length) {
            applyStrategyRuns(items);
          } else if (response.data?.refreshing && strategyRuns.length === 0) {
            keepLoadingAfterResponse = true;
          }

	        setStrategiesError("");
	      })
	      .catch(() => {
	        if (requestId === strategiesRequestIdRef.current) {
	          setStrategiesError("Не удалось обновить стратегии. Показываю последнюю локальную модель.");
	        }
	      })
	      .finally(() => {
          strategiesRequestPendingRef.current = false;

	        if (showLoading && requestId === strategiesRequestIdRef.current) {
	          setIsStrategiesLoading(keepLoadingAfterResponse);
	        }
	      });
	  }, [applyStrategyRuns, strategyRuns.length]);

    const fetchStrategyHistory = useCallback((strategyId) => {
      const requestId = strategyHistoryRequestIdRef.current + 1;
      strategyHistoryRequestIdRef.current = requestId;
      setIsStrategyHistoryLoading(true);
      setStrategyHistoryError("");

      return api
        .get("/ai/strategies/history", {
          params: strategyId ? { strategy_id: strategyId } : {},
        })
        .then((response) => {
          if (requestId !== strategyHistoryRequestIdRef.current) {
            return;
          }

          setStrategyHistoryItems(response.data?.items || []);
        })
        .catch(() => {
          if (requestId === strategyHistoryRequestIdRef.current) {
            setStrategyHistoryError("Не удалось загрузить историю стратегии.");
          }
        })
        .finally(() => {
          if (requestId === strategyHistoryRequestIdRef.current) {
            setIsStrategyHistoryLoading(false);
          }
        });
    }, []);

    const openStrategyHistory = useCallback(() => {
      if (!selectedStrategy) {
        return;
      }

      setStrategyDrawerMode("history");
      fetchStrategyHistory(selectedStrategy.id);
    }, [fetchStrategyHistory, selectedStrategy]);

    const resetStrategyHistory = useCallback(async () => {
      if (!selectedStrategy || isStrategyHistoryResetting) {
        return;
      }

      setIsStrategyHistoryResetting(true);
      setStrategyHistoryError("");

      try {
        await api.delete("/ai/strategies/history", {
          params: {
            strategy_id: selectedStrategy.id,
          },
        });
        setStrategyHistoryItems([]);
        await fetchStrategies(true);
        await fetchStrategyHistory(selectedStrategy.id);
      } catch {
        setStrategyHistoryError("Не удалось очистить историю стратегии.");
      } finally {
        setIsStrategyHistoryResetting(false);
      }
    }, [fetchStrategies, fetchStrategyHistory, isStrategyHistoryResetting, selectedStrategy]);

	  const marketStrategies = useMemo(() => {
    const runsById = new Map(strategyRuns.map((run) => [run.id, run]));

    return MARKET_STRATEGIES.map((strategy) => mergeStrategyRun(strategy, runsById.get(strategy.id)));
  }, [strategyRuns]);

  const renderInformationBlock = () => {
    switch (activePage) {
      case "strategies":
        return (
          <>
          <div className="contentmarketstategy">
            <div className="conentpagr">
                <div className="titlemarket">
                  <p>Топ стратегий</p>
                  <img src={PulseSvgTag} alt="tag" />
                </div>

	                <div className="cardList_marketbot">
		                  <div className="cardmarketblocklist cardmarketblocklist_strategies">
                        {strategiesError ? (
                          <p className="market_error">{strategiesError}</p>
                        ) : null}
			                    {strategyRuns.length === 0 ? (
                          MARKET_STRATEGIES.map((strategy) => (
                            <StrategyCardSkeleton key={`strategy-skeleton-${strategy.id}`} />
                          ))
                        ) : marketStrategies.map((strategy) => {
                          const capital = getStrategyCapital(strategy);
                          const tone = getStrategyTone(capital.roi);

                          return (
		                      <MarketCardBot
		                        key={strategy.id}
		                        titleCardstrategi={strategy.title}
		                        desritioncardStrategy={strategy.description}
		                        onClick={() => openStrategy(strategy)}
			                        contentBottomCard={
                              <div className="strategy_card_meta strategy_card_meta_visible">
                                <span>{formatStrategyMoney(capital.current)}</span>
                                <strong className={`strategy_card_roi strategy_card_roi_${tone}`}>
                                  {formatSignedStrategyPercent(capital.roi)}
                                </strong>
                              </div>
                            }
				                        ImgContentCard={
				                          <div className="strategy_chart_preview">
				                            <StrategyLineChart
				                              values={strategy.chart}
				                              color={strategy.chartColor}
				                            />
				                          </div>
				                        }
		                      />
		                    );
                        })}
	                  </div>
	                </div>

                <div className="titlemarket">
                  <p>Пассивный доход</p>
                </div>

	                <div className="cardList_marketbot">
	                  <div className="cardmarketblocklist cardmarketblocklist_strategies cardmarketblocklist_passive">
                    <MarketCardBot
                    titleCardstrategi = 'Bybit Earn '
                    desritioncardStrategy = 'Easy Earn BTC с гибким сроком — это удобный вариант инвестирования без периода блокировки. Можно инвестировать и выводить средства когда угодно.'
                    onClick={null}
                    contentBottomCard={
                      <>
                      <p style={{fontSize: "12px"}}>Прогноз от <span style={{color: "var(--green)"}}>15%</span> годовых</p>
                      </>
                    }
                    ImgContentCard = {
                      <>
                      <img src="https://ru-crypto.com/wp-content/uploads/2025/02/bybit-logo-2025.jpg" alt="telegrambanner" />
                      </>
                    }
                    />
                    <MarketCardBot
                    titleCardstrategi = 'Зарабатывайте с профи'
                    desritioncardStrategy = 'Easy Earn BTC с гибким сроком — это удобный вариант инвестирования без периода блокировки. Можно инвестировать и выводить средства когда угодно.'
                    onClick={null}
                    contentBottomCard={
                      <>
                      <p style={{fontSize: "12px"}}>Прогноз от <span style={{color: "var(--green)"}}>25%</span> годовых</p>
                      </>
                    }
                    ImgContentCard = {
                      <>
                      <img src="https://mir-s3-cdn-cf.behance.net/projects/max_808/e94e21187791493.Y3JvcCwyMDQ1LDE2MDAsMCww.png" alt="telegrambanner" />
                      </>
                    }
                    />
                    <MarketCardBot
                    titleCardstrategi = 'Telegram 17% годовых'
                    desritioncardStrategy = 'Портфель сбалансирован по отраслям экономики, а фокус внимания на недооцененных бумагах с перспективой улучшения кредитного качества.'
                    onClick={null}
                    contentBottomCard={
                      <>
                      <p style={{fontSize: "12px"}}>Прогноз от <span style={{color: "var(--green)"}}>17%</span> годовых</p>
                      </>
                    }
                    ImgContentCard = {
                      <>
                      <img src="https://img.utdstc.com/screen/3d2/4b0/3d24b0630ea30e4e65afab89867431ad0c2d182f295776c6fe3e4940f7441d68:800" alt="telegrambanner" />
                      </>
                    }
                    />
                  </div>
                </div>
            </div>
          </div>
            
          </>
        );

      case "crypto":
        return <div>
          <div className="settcuerrency">
            <div className="infcur">
                <div className="ttcoinww">
                  <div className="qierogiuheo">
                    <p>#</p>
                    <span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="7" viewBox="0 0 13 7" fill="none">
                        <path d="M0.5625 6.1875L6.1875 0.5625L11.8125 6.1875" stroke="#969696" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                  <div className="qierogiuheo">
                    <p>Монета</p>
                    <span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M10.5 6H20.25M10.5 6C10.5 6.39782 10.342 6.77936 10.0607 7.06066C9.77936 7.34196 9.39782 7.5 9 7.5C8.60218 7.5 8.22064 7.34196 7.93934 7.06066C7.65804 6.77936 7.5 6.39782 7.5 6M10.5 6C10.5 5.60218 10.342 5.22064 10.0607 4.93934C9.77936 4.65804 9.39782 4.5 9 4.5C8.60218 4.5 8.22064 4.65804 7.93934 4.93934C7.65804 5.22064 7.5 5.60218 7.5 6M7.5 6H3.75M10.5 18H20.25M10.5 18C10.5 18.3978 10.342 18.7794 10.0607 19.0607C9.77936 19.342 9.39782 19.5 9 19.5C8.60218 19.5 8.22064 19.342 7.93934 19.0607C7.65804 18.7794 7.5 18.3978 7.5 18M10.5 18C10.5 17.6022 10.342 17.2206 10.0607 16.9393C9.77936 16.658 9.39782 16.5 9 16.5C8.60218 16.5 8.22064 16.658 7.93934 16.9393C7.65804 17.2206 7.5 17.6022 7.5 18M7.5 18H3.75M16.5 12H20.25M16.5 12C16.5 12.3978 16.342 12.7794 16.0607 13.0607C15.7794 13.342 15.3978 13.5 15 13.5C14.6022 13.5 14.2206 13.342 13.9393 13.0607C13.658 12.7794 13.5 12.3978 13.5 12M16.5 12C16.5 11.6022 16.342 11.2206 16.0607 10.9393C15.7794 10.658 15.3978 10.5 15 10.5C14.6022 10.5 14.2206 10.658 13.9393 10.9393C13.658 11.2206 13.5 11.6022 13.5 12M13.5 12H3.75" stroke="#1E75FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="priceCoin">
                    <p>Цена</p>
                    <p >1D%</p>
                    <p className="disMob">1W%</p>
                    <p className="disMob">1M%</p>
                </div>
                <p className="disMob tabletdis">Последние 7 дней</p>
            </div>
            <div className="lineeeee"></div>
            {currenciesError && <p className="market_error">{currenciesError}</p>}
            {isCurrenciesLoading ? (
              <div className="maxHei">
                <LoaderAnimation/>
              </div>
              
            ) : (
              <div className="coins_list">
                {sortedCurrencies.map((coin, index) => {
                  return (
                    <CointButtonMarket
                      key={coin.id || coin.symbol || index}
                      onClick={() => {
                        openAssetPage("crypto", coin.symbol || coin.baseCoin);
                      }}
                      NameCoin={coin.name}
                      NMC={coin.shortName || coin.baseCoin}
                      baseCoin={coin.baseCoin}
                      iconUrl={coin.iconUrl}
                      priceCoin={coin.price}
                      percent_change_24h={coin.priceChangePercent24h}
                      percent_change_7d={coin.priceChangePercent7d}
                      percent_change_30d={coin.priceChangePercent30d}
                      chartData={coin.chart7d}
                      isFavorite={isFavorite("crypto", coin.symbol || coin.baseCoin)}
                      onToggleFavorite={() => {
                        toggleFavorite(createFavoriteAsset("crypto", coin));
                      }}
                    />
                  );
                })}
                {renderPagination(
                  cryptoPage,
                  cryptoTotalPages,
                  setCryptoPage,
                  setIsCurrenciesLoading
                )}
              </div>
            )}
          </div>
        </div>;

      case "stocks":
        return <div>
          <div className="settcuerrency">
            <div className="infcur">
                <div className="ttcoinww">
                  <div className="qierogiuheo">
                    <p>#</p>
                    <span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="7" viewBox="0 0 13 7" fill="none">
                        <path d="M0.5625 6.1875L6.1875 0.5625L11.8125 6.1875" stroke="#969696" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                  <div className="qierogiuheo">
                    <p>Акция</p>
                    <span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M10.5 6H20.25M10.5 6C10.5 6.39782 10.342 6.77936 10.0607 7.06066C9.77936 7.34196 9.39782 7.5 9 7.5C8.60218 7.5 8.22064 7.34196 7.93934 7.06066C7.65804 6.77936 7.5 6.39782 7.5 6M10.5 6C10.5 5.60218 10.342 5.22064 10.0607 4.93934C9.77936 4.65804 9.39782 4.5 9 4.5C8.60218 4.5 8.22064 4.65804 7.93934 4.93934C7.65804 5.22064 7.5 5.60218 7.5 6M7.5 6H3.75M10.5 18H20.25M10.5 18C10.5 18.3978 10.342 18.7794 10.0607 19.0607C9.77936 19.342 9.39782 19.5 9 19.5C8.60218 19.5 8.22064 19.342 7.93934 19.0607C7.65804 18.7794 7.5 18.3978 7.5 18M10.5 18C10.5 17.6022 10.342 17.2206 10.0607 16.9393C9.77936 16.658 9.39782 16.5 9 16.5C8.60218 16.5 8.22064 16.658 7.93934 16.9393C7.65804 17.2206 7.5 17.6022 7.5 18M7.5 18H3.75M16.5 12H20.25M16.5 12C16.5 12.3978 16.342 12.7794 16.0607 13.0607C15.7794 13.342 15.3978 13.5 15 13.5C14.6022 13.5 14.2206 13.342 13.9393 13.0607C13.658 12.7794 13.5 12.3978 13.5 12M16.5 12C16.5 11.6022 16.342 11.2206 16.0607 10.9393C15.7794 10.658 15.3978 10.5 15 10.5C14.6022 10.5 14.2206 10.658 13.9393 10.9393C13.658 11.2206 13.5 11.6022 13.5 12M13.5 12H3.75" stroke="#1E75FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="priceCoin">
                    <p>Цена</p>
                    <p>1D%</p>
                    <p className="disMob">1W%</p>
                    <p className="disMob">1M%</p>
                </div>
                <p className="disMob tabletdis">Последние 7 дней</p>
            </div>
            <div className="lineeeee"></div>
            {stocksError && <p className="market_error">{stocksError}</p>}
            {isStocksLoading ? (
              <div className="maxHei">
                <LoaderAnimation/>
              </div>
            ) : (
              <div className="coins_list">
                {sortedStocks.map((stock, index) => {
                  return (
	                    <CointButtonMarket
	                      key={stock.id || stock.symbol || index}
	                      onClick={() => {
	                        openAssetPage("stock", stock);
	                      }}
	                      NameCoin={stock.name}
	                      NMC={stock.shortName || stock.symbol}
		                      baseCoin={stock.symbol}
		                      iconUrl={stock.iconUrl}
		                      assetType="stock"
		                      currencySymbol="₽"
	                      priceCoin={stock.price}
                      percent_change_24h={stock.priceChangePercent24h}
                      percent_change_7d={stock.priceChangePercent7d}
                      percent_change_30d={stock.priceChangePercent30d}
                      chartData={stock.chart7d}
                      isFavorite={isFavorite("stock", stock.symbol)}
                      onToggleFavorite={() => {
                        toggleFavorite(createFavoriteAsset("stock", stock));
                      }}
                    />
                  );
                })}
                {renderPagination(
                  stocksPage,
                  stocksTotalPages,
                  setStocksPage,
                  setIsStocksLoading
                )}
              </div>
            )}
          </div>
        </div>;

      case "favorites":
        return <div>
          <div className="favorite_Container ">
            
            {favorites.length === 0 ? (
              <div className="market_error">
                <p className="p-[16px]">у вас еще нет избранных акций</p>
              </div>
            ) : (
              <div className="coins_list">
                {favorites.map((asset) => (
	                  <CointButtonMarket
	                    key={asset.favoriteKey}
	                    onClick={() => {
	                      openAssetPage(asset.type, asset);
	                    }}
                    NameCoin={asset.name}
                    NMC={asset.shortName}
                    baseCoin={asset.baseCoin}
		                    iconUrl={asset.iconUrl}
		                    assetType={asset.type === "stock" ? "stock" : "crypto"}
		                    currencySymbol={asset.type === "stock" ? "₽" : "$"}
                    priceCoin={asset.price}
                    percent_change_24h={asset.priceChangePercent24h}
                    percent_change_7d={asset.priceChangePercent7d}
                    percent_change_30d={asset.priceChangePercent30d}
                    chartData={asset.chart7d}
                    isFavorite
                    onToggleFavorite={() => {
                      toggleFavorite(asset);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>;

      default:
        return null;
    }
  };

  const normalizeCurrency = useCallback((coin) => {
    const quoteUsd = coin?.quote?.USD;

    return {
      id: coin?.id,
      symbol: coin?.symbol,
      name: coin?.name || coin?.baseCoin || coin?.symbol,
      baseCoin: coin?.baseCoin,
      shortName: coin?.shortName || coin?.baseCoin,
      iconUrl: coin?.iconUrl,
      price: coin?.price ?? quoteUsd?.price,
      priceChangePercent24h:
        coin?.priceChangePercent24h ?? quoteUsd?.percent_change_24h,
      priceChangePercent7d:
        coin?.priceChangePercent7d ?? quoteUsd?.percent_change_7d,
      priceChangePercent30d:
        coin?.priceChangePercent30d ?? quoteUsd?.percent_change_30d,
      chart7d: coin?.chart7d || [],
      quoteCoin: coin?.quoteCoin,
    };
  }, []);

	  const normalizeStock = useCallback((stock) => {
	    return {
	      id: stock?.id,
	      figi: stock?.figi,
	      symbol: stock?.symbol,
	      name: stock?.name || stock?.shortName || stock?.symbol,
	      shortName: stock?.shortName || stock?.symbol,
	      baseCoin: stock?.symbol,
	      iconUrl: stock?.iconUrl,
	      lotSize: stock?.lotSize || stock?.lot || 1,
	      provider: stock?.provider,
	      providerLabel: stock?.providerLabel,
	      tradingStatus: stock?.tradingStatus,
	      isTradingOpen: stock?.isTradingOpen,
	      isTradable: stock?.isTradable,
	      price: stock?.price,
	      priceChangePercent24h: stock?.priceChangePercent24h,
	      priceChangePercent7d: stock?.priceChangePercent7d,
      priceChangePercent30d: stock?.priceChangePercent30d,
      chart7d: stock?.chart7d || [],
    };
  }, []);

  const fetchCurrency = useCallback(() => {
    cryptoAbortRef.current?.abort();
    const cachedPage = readCachedValue(marketCacheKey("crypto", cryptoPage), MARKET_CACHE_MAX_AGE);

    if (cachedPage) {
      setCurrencies(cachedPage.items || []);
      setCryptoTotal(cachedPage.total || 0);
      setIsCurrenciesLoading(false);
    }

    const controller = new AbortController();
    const requestId = cryptoRequestIdRef.current + 1;

    cryptoAbortRef.current = controller;
    cryptoRequestIdRef.current = requestId;

    api
      .get("/cryptocurrencies", {
        params: {
          limit: ITEMS_PER_PAGE,
          offset: (cryptoPage - 1) * ITEMS_PER_PAGE,
        },
        signal: controller.signal,
      })
      .then((response) => {
        if (requestId !== cryptoRequestIdRef.current) {
          return;
        }

        const data = Array.isArray(response.data)
          ? response.data
          : response.data.items || [];
        const nextCurrencies = data.map(normalizeCurrency);
        const nextTotal = response.data.total || data.length;
        setCurrencies(nextCurrencies);
        setCryptoTotal(nextTotal);
        writeCachedValue(marketCacheKey("crypto", cryptoPage), {
          items: nextCurrencies,
          total: nextTotal,
        });
        setCurrenciesError("");
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setCurrenciesError("Не удалось загрузить криптовалюты");
      })
      .finally(() => {
        if (requestId !== cryptoRequestIdRef.current) {
          return;
        }

        setIsCurrenciesLoading(false);
      });
  }, [cryptoPage, normalizeCurrency]);

  const fetchStocks = useCallback(() => {
    stocksAbortRef.current?.abort();
    const cachedPage = readCachedValue(marketCacheKey("stocks", stocksPage, STOCK_SOURCE_TBANK), MARKET_CACHE_MAX_AGE)
      || readCachedValue(marketCacheKey("stocks", stocksPage, STOCK_SOURCE_MOEX), MARKET_CACHE_MAX_AGE);

    if (cachedPage) {
      setStocks(cachedPage.items || []);
      setStocksTotal(cachedPage.total || 0);
      setStocksSource(cachedPage.source || STOCK_SOURCE_MOEX);
      setIsStocksLoading(false);
    }

    const controller = new AbortController();
    const requestId = stocksRequestIdRef.current + 1;

    stocksAbortRef.current = controller;
    stocksRequestIdRef.current = requestId;

    const requestParams = {
      limit: ITEMS_PER_PAGE,
      offset: (stocksPage - 1) * ITEMS_PER_PAGE,
    };
    const loadBrokerStocks = () => api
      .get("/portfolio/tbank/stocks", {
        params: {
          ...requestParams,
          include_trading_status: true,
        },
        signal: controller.signal,
      })
      .then((response) => ({
        response,
        source: STOCK_SOURCE_TBANK,
      }));
    const loadMoexStocks = () => api
      .get("/stocks", {
        params: requestParams,
        signal: controller.signal,
      })
      .then((response) => ({
        response,
        source: STOCK_SOURCE_MOEX,
      }));

    loadBrokerStocks()
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          throw error;
        }

        return loadMoexStocks();
      })
      .then((response) => {
        if (requestId !== stocksRequestIdRef.current) {
          return;
        }

        const source = response.source || STOCK_SOURCE_MOEX;
        const payload = response.response?.data;
        const data = Array.isArray(payload)
          ? payload
          : payload?.items || [];
        const nextStocks = data.map(normalizeStock);
        const nextTotal = payload?.total || data.length;
        setStocks(nextStocks);
        setStocksTotal(nextTotal);
        setStocksSource(source);
        writeCachedValue(marketCacheKey("stocks", stocksPage, source), {
          items: nextStocks,
          total: nextTotal,
          source,
        });
        setStocksError("");
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setStocksError("Не удалось загрузить акции");
      })
      .finally(() => {
        if (requestId !== stocksRequestIdRef.current) {
          return;
        }

        setIsStocksLoading(false);
      });
  }, [normalizeStock, stocksPage]);

  const fetchSearchIndex = useCallback(async () => {
    if (hasSearchIndexLoaded) {
      return searchIndex;
    }

    setIsSearchLoading(true);
    setSearchIndexError("");

	    try {
	      const [cryptoResponse, stocksResponse] = await Promise.all([
	        api.get("/cryptocurrencies/search-index"),
	        api.get("/portfolio/tbank/stocks", {
	          params: {
	            limit: 100,
	            offset: 0,
	            include_trading_status: false,
	          },
	        }).catch(() => api.get("/stocks/search-index")),
	      ]);
	      const cryptoItems = cryptoResponse.data?.items || [];
	      const stockItems = (stocksResponse.data?.items || []).map((stock) => ({
	        ...stock,
	        type: "stock",
	      }));
	      const nextIndex = [...cryptoItems, ...stockItems];

      setSearchIndex(nextIndex);
      setHasSearchIndexLoaded(true);
      return nextIndex;
    } catch {
      setSearchIndex([]);
      setSearchIndexError("Не удалось загрузить поиск. Попробуйте еще раз.");
      return [];
    } finally {
      setIsSearchLoading(false);
    }
  }, [hasSearchIndexLoaded, searchIndex]);

  const getSearchRank = useCallback((asset, rawQuery = searchQuery) => {
    const query = rawQuery.trim().toLowerCase();

    if (!query) {
      return 0;
    }

    const baseCoin = String(asset.baseCoin || asset.name || "").toLowerCase();
    const name = String(asset.name || "").toLowerCase();
    const symbol = String(asset.symbol || asset.shortName || "").toLowerCase();
    const shortName = String(asset.shortName || "").toLowerCase();

    if (
      baseCoin === query ||
      name === query ||
      symbol === query ||
      shortName === query
    ) {
      return 4;
    }

    if (
      baseCoin.startsWith(query) ||
      name.startsWith(query) ||
      symbol.startsWith(query) ||
      shortName.startsWith(query)
    ) {
      return 3;
    }

    if (
      baseCoin.includes(query) ||
      name.includes(query) ||
      symbol.includes(query) ||
      shortName.includes(query)
    ) {
      return 2;
    }

    return 0;
  }, [searchQuery]);

  const getRankedSearchResults = useCallback((items, rawQuery) => {
    return items
      .map((asset, index) => ({
        asset,
        index,
        rank: getSearchRank(asset, rawQuery),
      }))
      .filter((item) => item.rank > 0)
      .sort((a, b) => {
        if (b.rank !== a.rank) {
          return b.rank - a.rank;
        }

        return a.index - b.index;
      })
      .map((item) => item.asset);
  }, [getSearchRank]);

  const runSearchSubmit = useCallback(async () => {
    const query = searchQuery.trim();

    if (!query) {
      return;
    }

    const items = await fetchSearchIndex();
    const [firstResult] = getRankedSearchResults(items, query);

    if (firstResult) {
      openSearchResult(firstResult);
      return;
    }

    setIsSearchFocused(true);
  }, [fetchSearchIndex, getRankedSearchResults, openSearchResult, searchQuery]);

  const sortedCurrencies = currencies;

  const sortedStocks = stocks;

  const searchResults = getRankedSearchResults(searchIndex, searchQuery).slice(0, 8);
  const isSearchPending = Boolean(searchQuery.trim()) && (
    isSearchLoading || (!hasSearchIndexLoaded && !searchIndexError)
  );

  const cryptoTotalPages = Math.max(
    1,
    Math.ceil((cryptoTotal || sortedCurrencies.length) / ITEMS_PER_PAGE)
  );
  const stocksTotalPages = Math.max(
    1,
    Math.ceil((stocksTotal || sortedStocks.length) / ITEMS_PER_PAGE)
  );

  const getVisiblePages = (currentPage, totalPages) => {
    if (totalPages <= 3) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (currentPage <= 2) {
      return [1, 2, 3, totalPages];
    }

    if (currentPage >= totalPages - 1) {
      return [1, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, currentPage, currentPage + 1, totalPages];
  };

  const changePage = (nextPage, currentPage, totalPages, setPage, setLoading) => {
    const normalizedPage = Math.min(Math.max(nextPage, 1), totalPages);

    if (normalizedPage === currentPage) {
      return;
    }

    setLoading(true);
    setPage(normalizedPage);
  };

  const renderPagination = (
    currentPage,
    totalPages,
    setPage,
    setLoading
  ) => {
    if (totalPages <= 1) {
      return null;
    }

    const visiblePages = getVisiblePages(currentPage, totalPages);

    return (
      <nav className="market_pagination" aria-label="Пагинация">
        <button
          className="market_pagination_button market_pagination_prev"
          type="button"
          disabled={currentPage === 1}
          onClick={() => {
            changePage(
              currentPage - 1,
              currentPage,
              totalPages,
              setPage,
              setLoading
            );
          }}
        >
          Назад
        </button>

        <div className="market_pagination_pages">
          {visiblePages.map((page, index) => {
            const previousPage = visiblePages[index - 1];
            const shouldShowEllipsis = previousPage && page - previousPage > 1;

            return (
              <div className="market_pagination_item" key={page}>
                {shouldShowEllipsis && (
                  <span className="market_pagination_ellipsis">...</span>
                )}
                <button
                  className={
                    page === currentPage
                      ? "market_pagination_button market_pagination_button_active"
                      : "market_pagination_button"
                  }
                  type="button"
                  aria-current={page === currentPage ? "page" : undefined}
                  onClick={() => {
                    changePage(
                      page,
                      currentPage,
                      totalPages,
                      setPage,
                      setLoading
                    );
                  }}
                >
                  {page}
                </button>
              </div>
            );
          })}
        </div>

        <button
          className="market_pagination_button market_pagination_next"
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => {
            changePage(
              currentPage + 1,
              currentPage,
              totalPages,
              setPage,
              setLoading
            );
          }}
        >
          Далее
        </button>
      </nav>
    );
  };

  useEffect(() => {
    if (activePage !== "crypto") {
      cryptoAbortRef.current?.abort();
      return;
    }

    const initialFetchTimer = window.setTimeout(fetchCurrency, 0);

    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }

      fetchCurrency();
    }, MARKET_REFRESH_INTERVAL);

    return () => {
      window.clearTimeout(initialFetchTimer);
      clearInterval(interval);
      cryptoAbortRef.current?.abort();
    };
  }, [activePage, fetchCurrency]);

  useEffect(() => {
    if (activePage !== "stocks") {
      stocksAbortRef.current?.abort();
      return;
    }

    const initialFetchTimer = window.setTimeout(fetchStocks, 0);

    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }

      fetchStocks();
    }, MARKET_REFRESH_INTERVAL);

    return () => {
      window.clearTimeout(initialFetchTimer);
      clearInterval(interval);
      stocksAbortRef.current?.abort();
    };
  }, [activePage, fetchStocks]);

		  useEffect(() => {
		    if (activePage !== "strategies") {
		      return;
		    }

		    const initialFetchTimer = window.setTimeout(() => {
		      fetchStrategies(strategyRuns.length === 0);
		    }, 0);
	    const interval = window.setInterval(() => {
	      if (document.hidden) {
	        return;
	      }

		      fetchStrategies(false);
		    }, STRATEGY_REFRESH_INTERVAL);

		    return () => {
	      window.clearTimeout(initialFetchTimer);
	      window.clearInterval(interval);
	    };
	  }, [activePage, fetchStrategies, strategyRuns.length]);

  useEffect(() => {
    return () => {
      if (strategyCloseTimerRef.current) {
        window.clearTimeout(strategyCloseTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="market_container">
            <div className="market_content">
              <div
                className={
                  isSearchFocused && searchQuery.trim()
                    ? "search_coins search_coins_expanded"
                    : "search_coins"
                }
              >
                <Inputs
                  variant="market"
                  type="text"
                  icon={SearchIcon}
                  value={searchQuery}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setSearchQuery(nextValue);
                    if (searchIndexError) {
                      setSearchIndexError("");
                    }
                    if (nextValue.trim() && !hasSearchIndexLoaded && !isSearchLoading) {
                      fetchSearchIndex();
                    }
                  }}
                  onFocus={() => {
                    setIsSearchFocused(true);

                    if (!hasSearchIndexLoaded) {
                      fetchSearchIndex();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runSearchSubmit();
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setIsSearchFocused(false), 120);
                  }}
                  id="market-search"
                  name="market-search"
                  placeholder="Название или тикер"
                />
                {isSearchFocused && searchQuery.trim() && (
                  <div className="market_search_results">
                    {isSearchPending ? (
                      <div className="market_search_loader">
                        <LoaderAnimation variant="spinner" label="Ищем активы" />
                      </div>
                    ) : searchIndexError ? (
                      <div className="market_search_empty">
                        {searchIndexError}
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((asset) => (
                        <button
                          className="market_search_result"
                          key={`${asset.type}:${asset.symbol}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            openSearchResult(asset);
                          }}
                        >
                          <CoinIcon
                            baseCoin={asset.baseCoin || asset.symbol}
                            iconUrl={asset.iconUrl}
                            label={asset.shortName || asset.name}
                            type={asset.type === "stock" ? "stock" : "crypto"}
                          />
                          <span className="market_search_result_text">
                            <span>{asset.name}</span>
                            <span>
                              {asset.type === "stock" ? "Акция" : "Криптовалюта"} ·{" "}
                              {asset.shortName || asset.symbol}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="market_search_empty">
                        Ничего не найдено
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="list_ofCois">
                {pages.map((page) => (
                  <Buttons
                    key={page.id}
                    type={
                      activePage === page.id
                        ? "page_choise-active"
                        : "page_choise"
                    }
                    disabled={page.disabled}
	                    onClick={() => {
	                      setActivePage(page.id);
	                      setCryptoPage(1);
	                      setStocksPage(1);
	                      closeStrategy();
	                    }}
	                  >
                    {page.label}
                  </Buttons>
                ))}
              </div>

              <div className="wejwedf">
                <div className="line io"></div>
              </div>

	              <div className="renderInformationBlcok">
	                {renderInformationBlock()}
	              </div>
		              <StrategyDrawer
		                strategy={selectedStrategy}
		                isOpen={isStrategyDrawerOpen}
		                mode={strategyDrawerMode}
		                connectForm={strategyConnectForm}
		                connectMessage={strategyConnectMessage}
                    historyItems={strategyHistoryItems}
                    isHistoryLoading={isStrategyHistoryLoading}
                    historyError={strategyHistoryError}
                    isHistoryResetting={isStrategyHistoryResetting}
		                isConnecting={isConnectingStrategy}
		                onConnectFormChange={updateStrategyConnectForm}
		                onOpenConnect={() => setStrategyDrawerMode("connect")}
                    onOpenHistory={openStrategyHistory}
                    onResetHistory={resetStrategyHistory}
		                onBackToOverview={() => {
		                  setStrategyDrawerMode("overview");
		                  setStrategyConnectMessage("");
                      setStrategyHistoryError("");
		                }}
		                onConnectStrategy={connectStrategy}
		                onOpenAsset={openStrategyTradeAsset}
		                onClose={closeStrategy}
		              />
	            </div>
	          </div>
        </div>
      </div>
    </div>
  );
}
