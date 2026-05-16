import { useState } from "react";

const CRYPTO_LOGO_SLUGS = {
  BTC: "bitcoin-btc",
  ETH: "ethereum-eth",
  USDT: "tether-usdt",
  USDC: "usd-coin-usdc",
  XRP: "xrp-xrp",
  DOGE: "dogecoin-doge",
  SOL: "solana-sol",
  BNB: "bnb-bnb",
  ADA: "cardano-ada",
  TRX: "tron-trx",
  TON: "toncoin-ton",
  DOT: "polkadot-new-dot",
  MATIC: "polygon-matic",
  POL: "polygon-ecosystem-token-pol",
  AVAX: "avalanche-avax",
  LINK: "chainlink-link",
  LTC: "litecoin-ltc",
  BCH: "bitcoin-cash-bch",
  SHIB: "shiba-inu-shib",
  UNI: "uniswap-uni",
  ETC: "ethereum-classic-etc",
  NEAR: "near-protocol-near",
  APT: "aptos-apt",
  ARB: "arbitrum-arb",
  OP: "optimism-ethereum-op",
  FIL: "filecoin-fil",
  ATOM: "cosmos-atom",
  ICP: "internet-computer-icp",
  INJ: "injective-inj",
  AAVE: "aave-aave",
  SUI: "sui-sui",
  PEPE: "pepe-pepe",
  MNT: "mantle-mnt",
};

const STATIC_ICON_SOURCES = {
  RUB: ["https://invest-brands.cdn-tinkoff.ru/rublex160.png"],
  RUR: ["https://invest-brands.cdn-tinkoff.ru/rublex160.png"],
  USD: [
    "https://invest-brands.cdn-tinkoff.ru/dollarx160.png",
    "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/usd.svg",
  ],
  EUR: ["https://invest-brands.cdn-tinkoff.ru/eurox160.png"],
  USDT: ["https://cryptologos.cc/logos/tether-usdt-logo.svg"],
  USDC: ["https://cryptologos.cc/logos/usd-coin-usdc-logo.svg"],
};

const getCryptoIconSources = (coinCode, iconUrl) => {
  const lowerCode = coinCode.toLowerCase();
  const cryptoLogoSlug = CRYPTO_LOGO_SLUGS[coinCode];
  const sources = [iconUrl];

  if (!iconUrl && cryptoLogoSlug) {
    sources.push(
      `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${lowerCode}.svg`,
      `https://assets.coincap.io/assets/icons/${lowerCode}@2x.png`
    );
  }

  if (cryptoLogoSlug) {
    sources.push(`https://cryptologos.cc/logos/${cryptoLogoSlug}-logo.svg`);
  }

  return [...new Set(sources.filter(Boolean))];
};

const getStockIconSources = (iconUrl) => {
  if (
    !iconUrl ||
    (!iconUrl.includes("invest-brands.cdn-tinkoff.ru") && !iconUrl.startsWith("data:image/"))
  ) {
    return [];
  }

  return [iconUrl];
};

const getIconSources = (type, coinCode, iconUrl) => {
  const staticSources = STATIC_ICON_SOURCES[coinCode] || [];

  if (staticSources.length) {
    return staticSources;
  }

  return type === "stock"
    ? getStockIconSources(iconUrl)
    : getCryptoIconSources(coinCode, iconUrl);
};

const getFallbackStyle = (coinCode, type) => {
  if (type === "stock") {
    return {
      background: "#ffffff",
      borderColor: "rgba(17, 24, 39, 0.12)",
      color: "#111827",
    };
  }

  const colors = [
    ["#1E75FF", "#00E0A4"],
    ["#7C5CFF", "#1E75FF"],
    ["#FF3B30", "#FF9F0A"],
    ["#00E0A4", "#0A84FF"],
    ["#AF52DE", "#FF2D55"],
  ];
  const hash = coinCode
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const [from, to] = colors[hash % colors.length];

  return {
    background: `linear-gradient(135deg, ${from}, ${to})`,
    borderColor: from,
    color: "white",
  };
};

export default function CoinIcon({
  baseCoin,
  iconUrl,
  label,
  type = "crypto",
  className = "",
}) {
  const rawCode = String(baseCoin || label || "?").toUpperCase();
  const coinCode = type === "stock"
    ? rawCode.slice(0, 5)
    : (rawCode.endsWith("USDT") && rawCode.length > 4
      ? rawCode.slice(0, -4)
      : rawCode
    ).slice(0, 4);
  const iconKey = `${type}:${coinCode}:${iconUrl || ""}`;
  const [sourceState, setSourceState] = useState({
    key: iconKey,
    index: 0,
  });
  const iconSources = getIconSources(type, coinCode, iconUrl);
  const sourceIndex = sourceState.key === iconKey ? sourceState.index : 0;

  if (sourceIndex >= iconSources.length) {
    return (
      <span
        className={`coin_icon coin_icon_fallback ${className}`}
        style={getFallbackStyle(coinCode, type)}
      >
        {coinCode}
      </span>
    );
  }

  return (
    <img
      className={`coin_icon ${className}`}
      alt={`${coinCode} icon`}
      src={iconSources[sourceIndex]}
      onError={() => {
        setSourceState((currentState) => ({
          key: iconKey,
          index: currentState.key === iconKey ? currentState.index + 1 : 1,
        }));
      }}
    />
  );
}
