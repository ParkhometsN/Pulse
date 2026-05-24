import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import LoaderAnimation from "../components/ui/loaderAnimation";
import CoinIcon from "../components/ui/coinIcon";
import api from "../lib/api";
import { readCachedValue, writeCachedValue } from "../lib/clientCache";
import { clearAuthSession, getAccessToken, saveStoredUser } from "../lib/auth";
import { useCallback, useEffect, useState } from "react";
import AreYouShure from "../components/ui/DilogShure";

const MARQUEE_CACHE_KEY = "pulse:app-layout:marquee:v1";
const MARQUEE_CACHE_MAX_AGE = 1000 * 60 * 10;
const MARQUEE_REFRESH_INTERVAL = 1000 * 60;

export default function AppLayout() {
    const [currencies, setCurrencies] = useState(
      () => readCachedValue(MARQUEE_CACHE_KEY, MARQUEE_CACHE_MAX_AGE) || []
    );
    const [isCurrenciesLoading, setIsCurrenciesLoading] = useState(currencies.length === 0);
    const [alertDilog, setalertdilog] = useState(false)
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const navigation = useNavigate();


    const AddEvenlistenerAlertFilog = () => {
      setalertdilog(true)
    }


    const normalizeCurrency = useCallback((coin) => {
      const quoteUsd = coin?.quote?.USD;

      return {
        id: coin?.id,
        name: coin?.name || coin?.baseCoin || coin?.symbol,
        baseCoin: coin?.baseCoin,
        iconUrl: coin?.iconUrl,
        change24h:
          coin?.priceChangePercent24h ?? quoteUsd?.percent_change_24h ?? 0,
      };
    }, []);

    const fetchCurrency = useCallback((signal) => {
      api.get("/cryptocurrencies", {
        params: {
          limit: 15,
          offset: 0,
        },
        signal,
      })
      .then((response) => {
        if (signal?.aborted) {
          return;
        }

        const data = Array.isArray(response.data)
          ? response.data
          : response.data.items || [];
        const nextCurrencies = data.slice(0, 15).map(normalizeCurrency);
        setCurrencies(nextCurrencies);
        writeCachedValue(MARQUEE_CACHE_KEY, nextCurrencies);
      })
      .catch((error) => {
        if (signal?.aborted || error?.code === "ERR_CANCELED") {
          return;
        }

        setCurrencies((currentCurrencies) => currentCurrencies);
      })
      .finally(() => {
        if (!signal?.aborted) {
          setIsCurrenciesLoading(false);
        }
      });
    }, [normalizeCurrency]);

    useEffect(() => {
      if (!getAccessToken()) {
        clearAuthSession();
        navigation('/login', { replace: true });
        return;
      }

      let isMounted = true;

      api.get('/auth/me')
        .then((response) => {
          if (!isMounted) {
            return;
          }

          saveStoredUser(response.data.user);
          setIsAuthChecking(false);
        })
        .catch(() => {
          if (!isMounted) {
            return;
          }

          clearAuthSession();
          navigation('/login', { replace: true });
        });

      return () => {
        isMounted = false;
      };
    }, [navigation]);

    useEffect(() => {
      let controller = new AbortController();

      const refreshCurrencies = () => {
        controller.abort();
        controller = new AbortController();
        fetchCurrency(controller.signal);
      };

      refreshCurrencies();

      const refreshInterval = window.setInterval(() => {
        if (!document.hidden) {
          refreshCurrencies();
        }
      }, MARQUEE_REFRESH_INTERVAL);

      return () => {
        controller.abort();
        window.clearInterval(refreshInterval);
      };
    }, [fetchCurrency]);

  if (isAuthChecking) {
    return (
      <div className="route_auth_check">
        <LoaderAnimation className="route_auth_loader" variant="spinner" label="Проверяем сессию" />
      </div>
    );
  }

  return (
    <div className="MainAppScreen">
      <Sidebar 
      ButtonExit = {AddEvenlistenerAlertFilog}
      />
      {alertDilog && <AreYouShure 
          TitledilogAlert = "Подтверждение выхода"
          Descriptionactive = "Все несохранённые изменения будут потеряны. Для продолжения работы потребуется войти заново."
          BackButtonAlertText = "Отмена"
          ShureButtonAlertText = "Выход"
          onClickBackAlert = {() => setalertdilog(false)}
          onClickShureAlert = {() => {
            clearAuthSession();
            navigation('/login', { replace: true });
          }}
      />}
      <main className="MainContentApp">
        <div className="marquee">
          {isCurrenciesLoading ? (
            <div className="marquee_loading">
              <LoaderAnimation />
            </div>
          ) : (
            <div className="marquee-content">
              {currencies.map((coin, index) => {
                const change24h = Number(coin.change24h) || 0;
                const color =
                  change24h === 0 ? "#969696" : change24h > 0 ? "#00e0a4" : "#ff3b30";

                return (
                  <div className="coin_mn" key={coin.id || coin.name || index}>
                    <CoinIcon
                      baseCoin={coin.baseCoin}
                      iconUrl={coin.iconUrl}
                      label={coin.name}
                    />

                    <p>{coin.name}</p>

                    <p className="persent_money" style={{ color }}>
                      {change24h.toFixed(2)}%
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="app_outlet_wrapper">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
