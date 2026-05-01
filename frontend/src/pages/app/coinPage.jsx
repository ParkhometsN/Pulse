import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";

import LoaderAnimation from "@/components/ui/loaderAnimation.jsx";

const formatMoney = (value, currencySymbol) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return `${currencySymbol}0`;
  }

  return `${currencySymbol}${number.toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  })}`;
};

const formatPercent = (value) => {
  const number = Number(value) || 0;

  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
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

export default function CoinPage() {
  const [searchParams] = useSearchParams();
  const assetType = searchParams.get("type") || "crypto";
  const symbol = searchParams.get("symbol") || "";
  const [requestState, setRequestState] = useState({
    endpoint: null,
    asset: null,
    error: "",
  });

  const endpoint = useMemo(() => {
    if (!symbol) {
      return null;
    }

    if (assetType === "stock") {
      return `http://127.0.0.1:8000/stocks/${symbol}`;
    }

    return `http://127.0.0.1:8000/cryptocurrencies/${symbol}`;
  }, [assetType, symbol]);

  useEffect(() => {
    if (!endpoint) {
      return;
    }

    const controller = new AbortController();

    axios
      .get(endpoint, { signal: controller.signal })
      .then((response) => {
        setRequestState({
          endpoint,
          asset: response.data,
          error: "",
        });
      })
      .catch((requestError) => {
        if (requestError.code === "ERR_CANCELED") {
          return;
        }

        setRequestState({
          endpoint,
          asset: null,
          error: "Не удалось загрузить актив",
        });
      });

    return () => controller.abort();
  }, [endpoint]);

  const asset = requestState.endpoint === endpoint ? requestState.asset : null;
  const error = !endpoint
    ? "Актив не найден"
    : requestState.endpoint === endpoint
      ? requestState.error
      : "";
  const isLoading = Boolean(endpoint && requestState.endpoint !== endpoint);
  const isStock = assetType === "stock";
  const assetName = asset?.name || asset?.baseCoin || symbol;
  const shortName = asset?.shortName || asset?.baseCoin || asset?.symbol || symbol;
  const quoteCurrency = isStock ? "RUB" : asset?.quoteCoin || "USD";
  const baseCurrency = isStock ? shortName : asset?.baseCoin || shortName;
  const currencySymbol = isStock ? "₽" : "$";
  const price = formatMoney(asset?.price, currencySymbol);
  const changePercent = Number(asset?.priceChangePercent24h) || 0;
  const todayChange = Number(asset?.price) * (changePercent / 100);
  const todayChangeText = `${todayChange > 0 ? "+" : ""}${todayChange.toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  })} (${formatPercent(changePercent)})`;
  const mood = asset?.sentiment;

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items Pagecoin_cpntainer">
          <div className="dashboard_container coin_page_container ">
            {isLoading ? (
              <LoaderAnimation />
            ) : error ? (
              <div className="market_error">
                <p>{error}</p>
              </div>
            ) : (
              <div>
                <p>
                  {isStock ? "Акция" : "Криптовалюта"} · {assetName}
                </p>

                <h1>{assetName}</h1>

                <p>
                  {shortName} {formatDateTime(asset?.updatedAt)} ·{" "}
                  {quoteCurrency}/{baseCurrency} {price}
                </p>

                <p>Сегодня</p>
                <p>{todayChangeText}</p>

                {mood && (
                  <div>
                    <p>Текущее настроение:</p>
                    <p>{mood.negative}%</p>
                    <p>{mood.positive}%</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
