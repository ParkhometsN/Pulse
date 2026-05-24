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

const ITEMS_PER_PAGE = 15;
const MARKET_REFRESH_INTERVAL = 10000;
const STRATEGY_REFRESH_INTERVAL = 10000;
const FAVORITES_STORAGE_KEY = "pulse_market_favorites";
const MARKET_CACHE_MAX_AGE = 1000 * 60 * 5;
const marketCacheKey = (type, page, source = "default") => `pulse:market:${type}:${source}:page:${page}:v6`;
const STABLE_CRYPTO_SYMBOLS = new Set(["USDT", "USDC", "DAI", "USD", "BUSD"]);
const STOCK_SOURCE_TBANK = "tbank";
const STOCK_SOURCE_MOEX = "moex";

const MARKET_STRATEGIES = [
  {
    id: "ai-short",
    title: "ИИ торговля Short",
    description:
      "Автоматическая торговля с помощью ИИ, оптимизированная для получения прибыли в условиях падающего рынка.",
    tag: "Short",
    direction: "Падает",
    chartColor: "var(--red)",
    chart: [100000, 101800, 100900, 103400, 105200, 104700, 108300, 109900, 111600, 113200, 115800, 117400],
    stats: [
      { label: "Модель", value: "Bear AI" },
      { label: "Сделок за 30 дней", value: "38" },
      { label: "Точность сигналов", value: "67%" },
      { label: "Просадка", value: "-4.8%" },
    ],
    history: [
      { date: "12 мая, 15:10", asset: "BTCUSDT", side: "Short", result: "+1.8%" },
      { date: "12 мая, 11:42", asset: "ETHUSDT", side: "Short", result: "+0.9%" },
      { date: "11 мая, 18:24", asset: "SOLUSDT", side: "Short", result: "-0.4%" },
    ],
    aggression: 42,
    note: "Лучше подходит для периодов высокой волатильности и слабого тренда рынка.",
  },
  {
    id: "ai-long",
    title: "ИИ торговля Long",
    description:
      "Виртуальная стратегия ищет активы с сильным восходящим импульсом и открывает long-сделки только при вероятности сигнала от 60%.",
    tag: "Long",
    direction: "Растет",
    chartColor: "var(--green)",
    chart: [150000, 151200, 153800, 152900, 156400, 159700, 161900, 166300, 169400, 172600, 176200, 181800],
    stats: [
      { label: "Модель", value: "Growth AI" },
      { label: "Сделок за 30 дней", value: "24" },
      { label: "Точность сигналов", value: "72%" },
      { label: "Просадка", value: "-3.1%" },
    ],
    history: [
      { date: "12 мая, 14:36", asset: "SBER", side: "Long", result: "+1.2%" },
      { date: "12 мая, 10:05", asset: "GAZP", side: "Long", result: "+0.6%" },
      { date: "10 мая, 16:50", asset: "LKOH", side: "Long", result: "+1.5%" },
    ],
    aggression: 58,
    note: "Сценарий для спокойного набора позиции, когда рынок показывает устойчивый спрос.",
  },
  {
    id: "ai-short-long",
    title: "ИИ торговля Short + Long",
    description:
      "Гибридная стратегия сравнивает вероятность роста и падения, выбирает более сильное направление и ведет paper-портфель на 100 000 ₽.",
    tag: "Hybrid",
    direction: "Смешанный",
    chartColor: "#95959C",
    chart: [120000, 122400, 121700, 125800, 127100, 130900, 132400, 136300, 135700, 139200, 142800, 146100],
    stats: [
      { label: "Модель", value: "Hybrid AI" },
      { label: "Сделок за 30 дней", value: "51" },
      { label: "Точность сигналов", value: "69%" },
      { label: "Просадка", value: "-5.2%" },
    ],
    history: [
      { date: "12 мая, 16:02", asset: "BTCUSDT", side: "Long", result: "+0.8%" },
      { date: "12 мая, 13:18", asset: "NVTK", side: "Short", result: "+0.5%" },
      { date: "11 мая, 19:40", asset: "ETHUSDT", side: "Long", result: "-0.2%" },
    ],
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

const formatSignedStrategyMoney = (value) => `${value >= 0 ? "+" : ""}${formatStrategyMoney(value)}`;

const getStrategyCapital = (strategy) => {
  const initial = strategy.chart[0] || 0;
  const current = strategy.chart[strategy.chart.length - 1] || initial;
  const profit = current - initial;
  const roi = initial ? (profit / initial) * 100 : 0;

  return {
    current,
    initial,
    profit,
    roi,
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

const formatStrategyPrice = (value, currency = "USDT") => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return `0 ${currency}`;
  }

  return `${number.toLocaleString("ru-RU", {
    maximumFractionDigits: number >= 100 ? 2 : 6,
  })} ${currency}`;
};

const formatStrategyQuantity = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("ru-RU", {
    maximumFractionDigits: number >= 1 ? 4 : 8,
  });
};

const getStrategyTradeBase = (trade) => {
  const symbol = String(trade.asset || trade.routeSymbol || "").toUpperCase();

  return symbol.endsWith("USDT") ? symbol.replace(/USDT$/, "") : symbol;
};

const getStrategyTradeStatusText = (trade) => {
  if (trade.status !== "closed") {
    return "Открыта";
  }

  if (trade.closeReason === "take_profit") {
    return "Тейк-профит";
  }

  if (trade.closeReason === "stop_loss") {
    return "Стоп-лосс";
  }

  if (trade.closeReason === "time_exit") {
    return "Выход по времени";
  }

  return "Зафиксировано";
};

const getStrategyChartPoints = (strategy) => {
  if (Array.isArray(strategy.chartPoints) && strategy.chartPoints.length > 1) {
    return strategy.chartPoints;
  }

  const startDate = strategy.startedAt ? new Date(strategy.startedAt) : new Date();

  return (strategy.chart || []).map((value, index) => ({
    value,
    time: new Date(startDate.getTime() + index * 11 * 60 * 1000).toISOString(),
    label: index === 0 ? "Старт" : `Шаг ${index}`,
  }));
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
  const history = trades.length
    ? trades.map((trade, index) => ({
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
      result: "Вероятность ниже 60%",
    }];

  return {
    ...baseStrategy,
    chart: Array.isArray(run.chart) && run.chart.length > 1 ? run.chart : baseStrategy.chart,
    chartPoints: Array.isArray(run.chartPoints) && run.chartPoints.length > 1 ? run.chartPoints : null,
    chartColor: getStrategyToneColor(getStrategyTone(run.roi ?? getChartRoi(run.chart))),
    startedAt: run.startedAt,
    history,
    stats: [
      { label: "Модель", value: baseStrategy.stats[0]?.value || "Pulse AI" },
      { label: "Paper-режим", value: formatStrategyMoney(run.startCapital || 100000) },
      { label: "Сделок сегодня", value: String(trades.length) },
      { label: "Точность сигналов", value: `${formatNumberLike(run.accuracy)}%` },
      { label: "Просадка", value: formatSignedStrategyPercent(run.maxDrawdown) },
      { label: "Порог входа", value: `${run.threshold || 60}%` },
    ],
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
  const chartPoints = getStrategyChartPoints(strategy)
    .map((point) => ({
      ...point,
      value: Number(point.value),
      date: point.time ? new Date(point.time) : null,
    }))
    .filter((point) => Number.isFinite(point.value));
  const width = 620;
  const height = 250;
  const padding = { top: 18, right: 86, bottom: 36, left: 18 };

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
  const tooltipGoesLeft = hoveredPoint ? hoveredPoint.x > width - 230 : false;

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const nearestPoint = points.reduce((nearest, point) => (
      Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest
    ), points[0]);

    setHoveredPoint(nearestPoint);
  };

  return (
    <div className="strategy_capital_chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
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
              <text x={width - padding.right + 10} y={y + 4} className="strategy_capital_axis">
                {formatStrategyMoney(value)}
              </text>
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
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(Math.min(Math.max(hoveredPoint.y, 72), height - 66) / height) * 100}%`,
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
  const universeLabels = {
    crypto: "Криптовалюта",
    stocks: "Ценные бумаги",
    mixed: "Смешанный рынок",
  };
  const riskLabels = {
    careful: "Осторожный",
    balanced: "Баланс",
    active: "Активный",
  };

  return (
    <div className="strategy_connect_panel">
      <div className="strategy_section_title">
        <h3>Подключение стратегии</h3>
        <p>Paper-режим. Стратегия открывает виртуальные позиции, реальные заявки брокеру или бирже не отправляются.</p>
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
            onClick={() => onChange({ universe: value })}
            aria-pressed={form.universe === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="strategy_trade_balance_grid">
        <div>
          <span>Виртуальный капитал</span>
          <p>{formatStrategyMoney(normalizedAmount || 100000)}</p>
        </div>
        <div className="border_blue">
          <span>Порог входа</span>
          <p>60%</p>
        </div>
      </div>

      <label className="strategy_trade_input_label">
        <span>Сумма стратегии, RUB</span>
        <input
          value={form.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
          inputMode="decimal"
          placeholder="100000"
        />
      </label>

      <div className="strategy_trade_quick_amounts" aria-label="Быстрый выбор суммы стратегии">
        {[
          ["25000", "25%"],
          ["50000", "50%"],
          ["100000", "Макс."],
        ].map(([value, label]) => (
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
          <span>Риск-профиль</span>
          <strong>{riskLabels[form.risk]}</strong>
        </div>
      </div>

      <div className="strategy_connect_field strategy_connect_risk_box">
        <span>Риск-профиль</span>
        <div className="strategy_connect_chips">
          {[
            ["careful", "Осторожный"],
            ["balanced", "Баланс"],
            ["active", "Активный"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={form.risk === value ? "active" : ""}
              onClick={() => onChange({ risk: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {message ? <p className="strategy_connect_message">{message}</p> : null}
      {!message ? (
        <p className="strategy_connect_hint">
          После подключения стратегия стартует с нулевым PnL и будет переоценивать позиции от цены входа.
        </p>
      ) : null}

      <div className="strategy_connect_actions">
        <Buttons type="text" onClick={onBack}>Назад</Buttons>
        <Buttons type="primary-full" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? "Подключаем..." : "Подключить стратегию"}
        </Buttons>
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
  isConnecting,
  onConnectFormChange,
  onOpenConnect,
  onBackToOverview,
  onConnectStrategy,
  onOpenAsset,
  onClose,
}) {
  if (!strategy) {
    return null;
  }

  const capital = getStrategyCapital(strategy);
  const capitalTone = capital.profit >= 0 ? "positive" : "negative";
  const strategyStats = [
    { label: "Стартовый капитал", value: formatStrategyMoney(capital.initial) },
    { label: "Текущий капитал", value: formatStrategyMoney(capital.current), tone: capitalTone },
    { label: "Заработано", value: formatSignedStrategyMoney(capital.profit), accent: true },
    ...strategy.stats.filter((item) => item.label !== "Модель"),
  ];
  const startedAtLabel = formatStrategyDateTime(strategy.startedAt || strategy.paperRun?.startedAt);

  return (
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
        <div className="strategy_drawer_hero">
          {mode === "connect" ? (
            <div className="strategy_connect_hero">
              <span>{strategy.tag}</span>
              <h2>{strategy.title}</h2>
              <p>Подключение paper-стратегии без реальных заявок и риска для счета.</p>
            </div>
          ) : (
            <StrategyCapitalChart strategy={strategy} color={strategy.chartColor} />
          )}
          <button className="strategy_drawer_close" type="button" onClick={onClose} aria-label="Закрыть стратегию">
            ×
          </button>
        </div>

        {mode === "connect" ? (
          <StrategyConnectPanel
            strategy={strategy}
            form={connectForm}
            message={connectMessage}
            isConnecting={isConnecting}
            onChange={onConnectFormChange}
            onBack={onBackToOverview}
            onConnect={onConnectStrategy}
          />
        ) : (
          <>
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
                <h3>История торговли</h3>
                <p>Последние виртуальные сделки стратегии</p>
              </div>
              <div className="strategy_history_list">
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
                            <h4>Сигналов пока нет</h4>
                            <p>{item.result || "Вероятность входа ниже 60%"}</p>
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
                          <p>{item.date}</p>
                        </div>
                      </div>
                      <div className="strategy_history_prices">
                        <span>{formatStrategyQuantity(item.quantity)} {baseAsset}</span>
                        <small>
                          {formatStrategyMoney(item.virtualAmount || 0)} · вход {formatStrategyPrice(item.entryPrice, item.quoteCurrency)}
                        </small>
                        <small>
                          {getStrategyTradeStatusText(item)} · {item.status === "closed" ? "выход" : "сейчас"}{" "}
                          {formatStrategyPrice(item.currentPrice || item.exitPrice, item.quoteCurrency)}
                        </small>
                      </div>
                      <strong className={`strategy_history_result strategy_history_result_${tone}`}>
                        {formatSignedStrategyPercent(item.resultPercent)}
                        <small>{formatSignedStrategyMoney(item.resultAmount || 0)}</small>
                      </strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <Buttons type="primary-full" className="strategy_connect_button" onClick={onOpenConnect}>
              Подключить стратегию
            </Buttons>
            <p className="strategy_warning">
              Это виртуальная торговля без реальных заявок. Сигналы нужны для проверки гипотез и не являются инвестиционной рекомендацией.
            </p>
          </>
        )}
      </aside>
    </div>
  );
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
	  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [strategyRuns, setStrategyRuns] = useState([]);
  const [isStrategiesLoading, setIsStrategiesLoading] = useState(activePage === "strategies");
  const [strategiesError, setStrategiesError] = useState("");
		  const [selectedStrategy, setSelectedStrategy] = useState(null);
		  const [isStrategyDrawerOpen, setIsStrategyDrawerOpen] = useState(false);
		  const [strategyDrawerMode, setStrategyDrawerMode] = useState("overview");
		  const [strategyConnectForm, setStrategyConnectForm] = useState({
		    amount: "100000",
		    universe: "mixed",
		    risk: "balanced",
		  });
		  const [strategyConnectMessage, setStrategyConnectMessage] = useState("");
		  const [isConnectingStrategy, setIsConnectingStrategy] = useState(false);
  const cryptoAbortRef = useRef(null);
  const stocksAbortRef = useRef(null);
  const cryptoRequestIdRef = useRef(0);
  const stocksRequestIdRef = useRef(0);
  const strategiesRequestIdRef = useRef(0);
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
	    const normalizedAmount = Number.isFinite(amount) && amount > 0 ? amount : 100000;
	    const universeLabels = {
	      crypto: "криптовалютам",
	      stocks: "ценным бумагам",
	      mixed: "смешанному рынку",
	    };

	    setIsConnectingStrategy(true);
	    setStrategyConnectMessage("");

	    try {
	      const response = await api.post(`/ai/strategies/${selectedStrategy.id}/connect`, {
	        virtual_capital: normalizedAmount,
	        universe: strategyConnectForm.universe,
	        risk_profile: strategyConnectForm.risk,
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
	        `Paper-стратегия подключена на ${formatStrategyMoney(normalizedAmount)} по ${universeLabels[strategyConnectForm.universe] || "рынку"}.`
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
	    strategyConnectForm.risk,
	    strategyConnectForm.universe,
	  ]);

	  const applyStrategyRuns = useCallback((nextRuns) => {
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
	    const requestId = strategiesRequestIdRef.current + 1;
	    strategiesRequestIdRef.current = requestId;

	    if (showLoading) {
	      setIsStrategiesLoading(true);
	    }

	    return api
	      .get("/ai/strategies")
	      .then((response) => {
	        if (requestId !== strategiesRequestIdRef.current) {
	          return;
	        }

	        applyStrategyRuns(response.data?.items || []);
	        setStrategiesError("");
	      })
	      .catch(() => {
	        if (requestId === strategiesRequestIdRef.current) {
	          setStrategiesError("Не удалось обновить paper-стратегии. Показываю последнюю локальную модель.");
	        }
	      })
	      .finally(() => {
	        if (showLoading && requestId === strategiesRequestIdRef.current) {
	          setIsStrategiesLoading(false);
	        }
	      });
	  }, [applyStrategyRuns]);

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
			                    {isStrategiesLoading && !strategyRuns.length ? (
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
    if (searchIndex.length > 0) {
      return searchIndex;
    }

    setIsSearchLoading(true);

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
      return nextIndex;
    } catch {
      setSearchIndex([]);
      return [];
    } finally {
      setIsSearchLoading(false);
    }
  }, [searchIndex]);

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
                    setSearchQuery(event.target.value);
                  }}
                  onFocus={() => {
                    setIsSearchFocused(true);

                    if (searchIndex.length === 0) {
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
                    {isSearchLoading ? (
                      <div className="market_search_empty">
                        Ищем активы...
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
		                isConnecting={isConnectingStrategy}
		                onConnectFormChange={updateStrategyConnectForm}
		                onOpenConnect={() => setStrategyDrawerMode("connect")}
		                onBackToOverview={() => {
		                  setStrategyDrawerMode("overview");
		                  setStrategyConnectMessage("");
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
