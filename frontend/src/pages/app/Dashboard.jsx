import { useEffect, useMemo, useState } from "react";
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
import { readCachedValue, writeCachedValue } from "../../lib/clientCache";

const GUIDE_PDF_URL = "/docs/bybitisruction.pdf";
const TOTAL_CAPITAL = 17430021.12;
const DASHBOARD_TOP_GROWTH_CACHE_KEY = "pulse:dashboard:top-growth:v1";
const DASHBOARD_TOP_GROWTH_CACHE_MAX_AGE = 1000 * 60 * 5;

const ACTIVITY_GRID = [
  0, 1, 0, 2, 1, 3, 0, 1,
  2, 1, 0, 2, 3, 4, 2, 1,
  0, 1, 2, 1, 3, 2, 0, 1,
  2, 4, 3, 1, 2, 0, 1,
];
const ACTIVITY_WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"];

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

const pieData = [
  { name: "Криптовалюта", value: 38 },
  { name: "Акции", value: 34 },
  { name: "Металлы", value: 28 },
];

const CHART_YEARS = [2024, 2025, 2026, 2027];

const BASE_YEAR_SERIES = {
  month: [
    { label: "1", value: 13.2 },
    { label: "5", value: 13.8 },
    { label: "10", value: 14.5 },
    { label: "15", value: 15.4 },
    { label: "20", value: 16.7 },
    { label: "25", value: 17.2 },
    { label: "28", value: 17.9 },
  ],
  week: [
    { label: "1", value: 16.1 },
    { label: "5", value: 16.8 },
    { label: "10", value: 16.4 },
    { label: "15", value: 17.3 },
    { label: "20", value: 17.9 },
    { label: "25", value: 18.6 },
    { label: "28", value: 19.1 },
  ],
  day: [
    { label: "1", value: 18.2 },
    { label: "5", value: 18.55 },
    { label: "10", value: 18.42 },
    { label: "15", value: 18.9 },
    { label: "20", value: 19.05 },
    { label: "25", value: 19.33 },
    { label: "28", value: 19.52 },
  ],
};

const formatCurrency = (value) =>
  value.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatRub = (value) =>
  Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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
  const [selectedProvider, setSelectedProvider] = useState("bybit");
  const [selectedWalletStep, setSelectedWalletStep] = useState(null);
  const [walletDrawerOpen, setWalletDrawerOpen] = useState(false);
  const [tradeSourceFilter, setTradeSourceFilter] = useState("all");
  const [topGrowthAssets, setTopGrowthAssets] = useState(
    () => readCachedValue(DASHBOARD_TOP_GROWTH_CACHE_KEY, DASHBOARD_TOP_GROWTH_CACHE_MAX_AGE) || []
  );
  const [isTopGrowthLoading, setIsTopGrowthLoading] = useState(topGrowthAssets.length === 0);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [currency, setCurrency] = useState({
    code: "USD",
    symbol: "$",
  });
  const navigate = useNavigate();
  const baseMoneyInRub = 17430021.12;

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
    let isMounted = true;

    Promise.allSettled([
      api.get("/cryptocurrencies", { params: { limit: 50 } }),
      api.get("/stocks", { params: { limit: 50 } }),
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
          name: item.shortName || item.name || item.symbol,
          symbol: item.symbol,
          shortName: item.symbol,
          icon: item.iconUrl,
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

  const chartYear = CHART_YEARS[chartYearIndex] || CHART_YEARS[0];
  const chartData = (BASE_YEAR_SERIES[chartPeriod] || BASE_YEAR_SERIES.month).map(
    (point, index) => ({
      ...point,
      value: point.value + (chartYearIndex * 0.5) + (index * 0.08),
    })
  );
  const filteredTrades =
    tradeSourceFilter === "all"
      ? TRADE_FEED
      : TRADE_FEED.filter((item) => item.source === tradeSourceFilter);
  const convertedMoney = useMemo(() => {
    if (!rates) {
      return null;
    }

    if (currency.code === "RUB") {
      return formatRub(baseMoneyInRub);
    }

    const moneyInUSD = baseMoneyInRub / rates.RUB;
    const converted = moneyInUSD * rates[currency.code];

    return formatRub(converted);
  }, [currency.code, rates]);

  const menuItems = [
    { id: 1, label: "Удалить кошелек", danger: true },
  ];

  const handleMenuClick = (item) => {
    console.log("Выбран:", item.label);
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

    navigate(
      `/app/market/coin-page?type=${trade.assetType}&symbol=${encodeURIComponent(symbol)}`
    );
  };

  const openTopGrowthAsset = (asset) => {
    navigate(`/app/market/coin-page?type=${asset.type}&symbol=${encodeURIComponent(asset.symbol)}`);
  };

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="dashboard_content">
            <div className="dashboard_container">
              {!dashboardReady ? (
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
                        {convertedMoney ? `${convertedMoney} ${currency.symbol}` : ""}
                      </p>

                      <div className="changes_to_day">
                        <p className="changes_to_day_label">за сегодня</p>
                        <div className="changes">
                          <img src={ChartUP} alt="chartup" />
                          <p>+0,58 ₽ (0,87%)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="Right_block_dsh">
                    <div className="bagCard">
                      <div className="upcardBag">
                        <div className="titlebag">
                          <div className="iconCard">
                            <img src={Tbankicon} alt="bankIcon" />
                          </div>
                          <p>Т Банк</p>
                        </div>
                        <div className="scoreBag">
                          <p style={{ color: "var(--green)" }}>+0,58 ₽ (0,87%)</p>
                        </div>
                      </div>
                      <div className="downCardBag">
                        <div className="scoreBagDown">
                          <p>брокерский счет</p>
                          <h4>12 763,9 ₽</h4>
                        </div>
                        <KebabMenu
                          items={menuItems}
                          onItemClick={handleMenuClick}
                          position="bottom-right"
                        />
                      </div>
                    </div>

                    <div className="bagCard">
                      <div className="upcardBag">
                        <div className="titlebag">
                          <div className="iconCard">
                            <img src={BybitIcon} alt="bankIcon" />
                          </div>
                          <p>Bybit</p>
                        </div>
                        <div className="scoreBag">
                          <p style={{ color: "var(--green)" }}>+0,58 ₽ (0,87%)</p>
                        </div>
                      </div>
                      <div className="downCardBag">
                        <div className="scoreBagDown">
                          <p>биржевой счет</p>
                          <h4>9 840,2 ₽</h4>
                        </div>
                        <KebabMenu
                          items={menuItems}
                          onItemClick={handleMenuClick}
                          position="bottom-right"
                        />
                      </div>
                    </div>

                    <Drawer
                        open={walletDrawerOpen}
                        onOpenChange={(open) => {
                          setWalletDrawerOpen(open);
                          if (!open) {
                            setSelectedWalletStep(null);
                            setSelectedProvider("bybit");
                            setApiKey("");
                            setApiSecret("");
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
                                  : "Подключение Т Банк"}
                            </DrawerTitle>
                            <DrawerDescription className="drawer_description_dashboard">
                              {!selectedWalletStep
                                ? "Подключите тот сервис, из которого мы будем подтягивать активы."
                                : selectedWalletStep === "bybit"
                                  ? "Так мы получим данные о вашем портфеле и покажем их в портфеле. Доступ можно закрыть в любой момент."
                                  : "Для этого сервиса форма подключения появится позже."}
                            </DrawerDescription>
                          </DrawerHeader>

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
                                    Доступ можно закрыть в любой момент.
                                  </p>
                                </div>
                              </div>

                              <div className="wallet_form">
                                <Inputs
                                  variant="primary"
                                  type="text"
                                  value={apiKey}
                                  onChange={(event) => setApiKey(event.target.value)}
                                  placeholder="API key"
                                />
                                <Inputs
                                  variant="primary"
                                  type="password"
                                  value={apiSecret}
                                  onChange={(event) => setApiSecret(event.target.value)}
                                  placeholder="API secret"
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
                              </div>
                            </div>
                          ) : (
                            <div className="drawer_provider_panel wallet_form_placeholder wallet_form_placeholder_short">
                              <p>Подключение Т Банк появится в следующем обновлении.</p>
                            </div>
                          )}

                          <DrawerFooter className="drawer_footer_dashboard">
                            {selectedWalletStep ? (
                              <DrawerClose asChild>
                                <Buttons type="primary-full">
                                  {selectedWalletStep === "bybit" ? "Добавить портфель" : "Понятно"}
                                </Buttons>
                              </DrawerClose>
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
                          type={tradeSourceFilter === "all" ? "text trade_filter_active" : "text"}
                          onClick={() => setTradeSourceFilter("all")}
                        >
                          <p>Все</p>
                        </Buttons>
                        <Buttons
                          type={tradeSourceFilter === "tbank" ? "text trade_filter_active" : "text"}
                          onClick={() => setTradeSourceFilter("tbank")}
                        >
                          <div className="contentButtonBusell">
                            <img src={Tbankicon} alt="iconbank" />
                            <p>Т Банк</p>
                          </div>
                        </Buttons>
                        <Buttons
                          type={tradeSourceFilter === "bybit" ? "text trade_filter_active" : "text"}
                          onClick={() => setTradeSourceFilter("bybit")}
                        >
                          <div className="contentButtonBusell">
                            <img src={BybitIcon} alt="iconbank" />
                            <p>Bybit</p>
                          </div>
                        </Buttons>
                      </div>
                    </div>

                    <Drawer>
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
                          {TRADE_HISTORY.map((dayBlock) => (
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
                                      <img
                                        src={item.source === "bybit" ? BybitIcon : Tbankicon}
                                        alt={item.sourceLabel}
                                      />
                                      <div>
                                        <h4>{item.name}</h4>
                                        <p>
                                          {item.sourceLabel} · {item.time}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="trade_history_item_meta">
                                      <span
                                        className={`trade_history_badge trade_history_badge_${item.action === "Продажа" ? "sell" : "buy"}`}
                                      >
                                        {item.action}
                                      </span>
                                      <strong>{item.amount}</strong>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <DrawerFooter className="trade_history_footer">
                          <DrawerClose asChild>
                            <Buttons type="primary-full">Смотреть всю историю</Buttons>
                          </DrawerClose>
                        </DrawerFooter>
                      </DrawerContent>
                    </Drawer>
                  </div>

                  <div className="containerBuysellactive">
                    {dashboardReady ? (
                      <div className="contentbsac">
                        {filteredTrades.map((trade) => (
                          <BuysellCardMinicard
                            key={trade.id}
                            sourceLabel={trade.sourceLabel}
                            sourceIcon={trade.source === "bybit" ? BybitIcon : Tbankicon}
                            action={trade.action}
                            name={trade.name}
                            symbol={trade.symbol}
                            icon={trade.icon}
                            priceFrom={trade.priceFrom}
                            priceTo={trade.priceTo}
                            change={trade.change}
                            time={trade.time}
                            onClick={() => openAssetPage(trade)}
                          />
                        ))}
                      </div>
                    ) : (
                      <SectionLoader height={180} />
                    )}

                    {dashboardReady && filteredTrades.length === 0 && (
                      <div className="empty_trades_state">
                        Нет сделок для выбранного фильтра.
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
                          <div className="activity_grid" aria-label="Активность инвестора за 31 день">
                            {ACTIVITY_GRID.map((value, index) => (
                              <span
                                key={`activity-day-${index}`}
                                className={`activity_cell activity_cell_${value}`}
                              />
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
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={70}
                              outerRadius={92}
                              startAngle={90}
                              endAngle={-270}
                              paddingAngle={4}
                              cornerRadius={20}
                              stroke="rgba(255,255,255,0.12)"
                              strokeWidth={2}
                            >
                              {pieData.map((entry, index) => (
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
                              {formatCurrency(TOTAL_CAPITAL)}
                            </text>
                            <text
                              x="50%"
                              y="57.5%"
                              textAnchor="middle"
                              fill="var(--gray)"
                              fontSize={11}
                            >
                              Общий капитал
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
                          fillPct: rawMax ? Math.max(0.08, point.value / rawMax) : 0.08,
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

                                <div className="chart_bars_overlay" aria-hidden>
                                  <div className="chart_bars_cluster">
                                    {bars.slice(-4).map((bar) => (
                                      <div
                                        key={`${bar.label}-${chartYear}`}
                                        className="chart_bar"
                                        style={{ height: `${bar.fillPct * 100}%` }}
                                      />
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
