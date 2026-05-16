import { useCallback, useEffect, useRef, useState } from "react";
import Inputs from "../../components/ui/inputs";
import SearchIcon from "../../assets/svg/searchicon.svg";
import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";
import Buttons from "../../components/ui/buttons";
import MarketCardBot from "../../components/ui/marketCard";
import CointButtonMarket from "../../components/ui/cointmarketButton";
import CoinIcon from "../../components/ui/coinIcon";
import api from "../../lib/api";
import LoaderAnimation from "../../components/ui/loaderAnimation";
import { useNavigate } from "react-router-dom";

const ITEMS_PER_PAGE = 15;
const MARKET_REFRESH_INTERVAL = 3000;
const FAVORITES_STORAGE_KEY = "pulse_market_favorites";

const getInitialFavorites = () => {
  try {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);

    return savedFavorites ? JSON.parse(savedFavorites) : [];
  } catch {
    return [];
  }
};


export default function Market() {
  const [activePage, setActivePage] = useState("strategies");
  const [currencies, setCurrencies] = useState([]);
  const [currenciesError, setCurrenciesError] = useState("");
  const [isCurrenciesLoading, setIsCurrenciesLoading] = useState(true);
  const [stocks, setStocks] = useState([]);
  const [stocksError, setStocksError] = useState("");
  const [isStocksLoading, setIsStocksLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [cryptoPage, setCryptoPage] = useState(1);
  const [stocksPage, setStocksPage] = useState(1);
  const [cryptoTotal, setCryptoTotal] = useState(0);
  const [stocksTotal, setStocksTotal] = useState(0);
  const [favorites, setFavorites] = useState(getInitialFavorites);
  const [searchIndex, setSearchIndex] = useState([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const cryptoAbortRef = useRef(null);
  const stocksAbortRef = useRef(null);
  const cryptoRequestIdRef = useRef(0);
  const stocksRequestIdRef = useRef(0);
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
      symbol,
      name: asset.name,
      shortName: asset.shortName || asset.baseCoin || asset.symbol,
      baseCoin: asset.baseCoin || asset.symbol,
      iconUrl: asset.iconUrl,
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

  const openAssetPage = useCallback((type, symbol) => {
    navigate(`coin-page?type=${type}&symbol=${encodeURIComponent(symbol)}`);
  }, [navigate]);

  const openSearchResult = useCallback((asset) => {
    setSearchQuery("");
    setIsSearchFocused(false);
    openAssetPage(asset.type, asset.symbol);
  }, [openAssetPage]);

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
                  <div className="cardmarketblocklist">
                    <MarketCardBot
                    titleCardstrategi = 'Фавориты 2026 года'
                    desritioncardStrategy = 'Портфель сбалансирован по отраслям экономики, а фокус внимания на недооцененных бумагах с перспективой улучшения кредитного качества.'
                    onClick={null}
                    contentBottomCard={null}
                    />
                    <MarketCardBot
                    titleCardstrategi = 'Фавориты 2026 года'
                    desritioncardStrategy = 'Портфель сбалансирован по отраслям экономики, а фокус внимания на недооцененных бумагах с перспективой улучшения кредитного качества.'
                    onClick={null}
                    contentBottomCard={null}
                    />
                    <MarketCardBot
                    titleCardstrategi = 'Фавориты 2026 года'
                    desritioncardStrategy = 'Портфель сбалансирован по отраслям экономики, а фокус внимания на недооцененных бумагах с перспективой улучшения кредитного качества.'
                    onClick={null}
                    contentBottomCard={null}
                    />
                  </div>
                </div>

                <div className="titlemarket">
                  <p>Пассивный доход</p>
                </div>

                <div className="cardList_marketbot">
                  <div className="cardmarketblocklist">
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
                        openAssetPage("stock", stock.symbol);
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
                      openAssetPage(asset.type, asset.symbol);
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
    };
  }, []);

  const normalizeStock = useCallback((stock) => {
    return {
      id: stock?.id,
      symbol: stock?.symbol,
      name: stock?.name || stock?.shortName || stock?.symbol,
      shortName: stock?.shortName || stock?.symbol,
      baseCoin: stock?.symbol,
      iconUrl: stock?.iconUrl,
      price: stock?.price,
      priceChangePercent24h: stock?.priceChangePercent24h,
      priceChangePercent7d: stock?.priceChangePercent7d,
      priceChangePercent30d: stock?.priceChangePercent30d,
      chart7d: stock?.chart7d || [],
    };
  }, []);

  const fetchCurrency = useCallback(() => {
    cryptoAbortRef.current?.abort();

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
        setCurrencies(data.map(normalizeCurrency));
        setCryptoTotal(response.data.total || data.length);
        setCurrenciesError("");
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setCurrencies([]);
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

    const controller = new AbortController();
    const requestId = stocksRequestIdRef.current + 1;

    stocksAbortRef.current = controller;
    stocksRequestIdRef.current = requestId;

    api
      .get("/stocks", {
        params: {
          limit: ITEMS_PER_PAGE,
          offset: (stocksPage - 1) * ITEMS_PER_PAGE,
        },
        signal: controller.signal,
      })
      .then((response) => {
        if (requestId !== stocksRequestIdRef.current) {
          return;
        }

        const data = Array.isArray(response.data)
          ? response.data
          : response.data.items || [];
        setStocks(data.map(normalizeStock));
        setStocksTotal(response.data.total || data.length);
        setStocksError("");
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setStocks([]);
        setStocksError("Не удалось загрузить акции");
      })
      .finally(() => {
        if (requestId !== stocksRequestIdRef.current) {
          return;
        }

        setIsStocksLoading(false);
      });
  }, [normalizeStock, stocksPage]);

  const fetchSearchIndex = useCallback(() => {
    const controller = new AbortController();

    api
      .all([
        api.get("/cryptocurrencies/search-index", {
          signal: controller.signal,
        }),
        api.get("/stocks/search-index", {
          signal: controller.signal,
        }),
      ])
      .then(([cryptoResponse, stocksResponse]) => {
        const cryptoItems = cryptoResponse.data?.items || [];
        const stockItems = stocksResponse.data?.items || [];

        setSearchIndex([...cryptoItems, ...stockItems]);
      })
      .catch((error) => {
        if (error.code === "ERR_CANCELED") {
          return;
        }

        setSearchIndex([]);
      });

    return () => controller.abort();
  }, []);

  const getSearchRank = useCallback((asset) => {
    const query = searchQuery.trim().toLowerCase();

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

  const sortedCurrencies = currencies;

  const sortedStocks = stocks;

  const searchResults = searchIndex
    .map((asset, index) => ({
      asset,
      index,
      rank: getSearchRank(asset),
    }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => {
      if (b.rank !== a.rank) {
        return b.rank - a.rank;
      }

      return a.index - b.index;
    })
    .slice(0, 8)
    .map((item) => item.asset);

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

    fetchCurrency();

    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }

      fetchCurrency();
    }, MARKET_REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      cryptoAbortRef.current?.abort();
    };
  }, [activePage, fetchCurrency]);

  useEffect(() => {
    if (activePage !== "stocks") {
      stocksAbortRef.current?.abort();
      return;
    }

    fetchStocks();

    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }

      fetchStocks();
    }, MARKET_REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      stocksAbortRef.current?.abort();
    };
  }, [activePage, fetchStocks]);

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
                  onBlur={() => {
                    setTimeout(() => setIsSearchFocused(false), 120);
                  }}
                  id="market-search"
                  name="market-search"
                  placeholder="Название или тикер"
                />
                {isSearchFocused && searchQuery.trim() && (
                  <div className="market_search_results">
                    {searchResults.length > 0 ? (
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
