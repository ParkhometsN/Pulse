import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import LoaderAnimation from "../components/ui/loaderAnimation";
import CoinIcon from "../components/ui/coinIcon";
import api from "../lib/api";
import { useCallback, useEffect, useState } from "react";
import AreYouShure from "../components/ui/DilogShure";
import { Dialog } from "radix-ui";
import { Link } from "react-router-dom";

export default function AppLayout() {
    const [currencies, setCurrencies] = useState([]);
    const [isCurrenciesLoading, setIsCurrenciesLoading] = useState(true);
    const [alertDilog, setalertdilog] = useState(false)
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

    const fetchCurrency = useCallback(() => {
      api.get("/cryptocurrencies", {
        params: {
          limit: 15,
          offset: 0,
        },
      })
      .then((response) => {
        const data = Array.isArray(response.data)
          ? response.data
          : response.data.items || [];
        setCurrencies(data.slice(0, 15).map(normalizeCurrency));
      })
      .catch(() => {
        setCurrencies([]);
      })
      .finally(() => {
        setIsCurrenciesLoading(false);
      });
    }, [normalizeCurrency]);

    useEffect(() => {
      fetchCurrency();
    }, [fetchCurrency]);


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
          onClickShureAlert = {() => navigation('/')}
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
