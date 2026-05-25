import { useState } from "react";

const makeCurrencyIcon = (label, background, color = "#ffffff") => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="80" fill="${background}"/>
      <text x="80" y="92" text-anchor="middle" font-size="42" font-family="Arial, sans-serif" font-weight="700" fill="${color}">${label}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

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
  TIA: "celestia-tia",
};

const CRYPTO_COINMARKETCAP_IDS = {
  BTC: 1,
  ETH: 1027,
  USDT: 825,
  BNB: 1839,
  SOL: 5426,
  XRP: 52,
  DOGE: 74,
  ADA: 2010,
  TRX: 1958,
  TON: 11419,
  AVAX: 5805,
  LINK: 1975,
  DOT: 6636,
  LTC: 2,
  BCH: 1831,
  SHIB: 5994,
  UNI: 7083,
  ETC: 1321,
  NEAR: 6535,
  APT: 21794,
  ARB: 11841,
  OP: 11840,
  FIL: 2280,
  ATOM: 3794,
  ICP: 8916,
  INJ: 7226,
  AAVE: 7278,
  SUI: 20947,
  PEPE: 24478,
  TIA: 22861,
  MNT: 27075,
};

const STATIC_ICON_SOURCES = {
  RUB: [makeCurrencyIcon("RUB", "#111827")],
  RUR: [makeCurrencyIcon("RUB", "#111827")],
  USD: [makeCurrencyIcon("USD", "#16a34a")],
  EUR: [makeCurrencyIcon("EUR", "#2563eb")],
  USDT: ["https://cryptologos.cc/logos/tether-usdt-logo.svg"],
  USDC: ["https://cryptologos.cc/logos/usd-coin-usdc-logo.svg"],
};

const FALLBACK_REPOSITORY_ICON_PATTERN =
  /(spothq\/cryptocurrency-icons|raw\.githubusercontent\.com\/spothq\/cryptocurrency-icons|assets\.coincap\.io|s3-symbol-logo\.tradingview\.com)/i;

const getCryptoIconSources = (coinCode, iconUrl) => {
  const lowerCode = coinCode.toLowerCase();
  const cryptoLogoSlug = CRYPTO_LOGO_SLUGS[coinCode];
  const coinmarketcapId = CRYPTO_COINMARKETCAP_IDS[coinCode];
  const hasVerifiedSource = Boolean(coinmarketcapId || cryptoLogoSlug);
  const deferProvidedIcon =
    iconUrl && hasVerifiedSource && FALLBACK_REPOSITORY_ICON_PATTERN.test(iconUrl);
  const sources = deferProvidedIcon ? [] : [iconUrl];

  if (coinmarketcapId) {
    sources.push(
      `https://s2.coinmarketcap.com/static/img/coins/64x64/${coinmarketcapId}.png`
    );
  }

  if (cryptoLogoSlug) {
    sources.push(`https://cryptologos.cc/logos/${cryptoLogoSlug}-logo.svg`);
  }

  if (!iconUrl && !coinmarketcapId && !cryptoLogoSlug) {
    sources.push(
      `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${lowerCode}.svg`,
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${lowerCode}.svg`,
      `https://assets.coincap.io/assets/icons/${lowerCode}@2x.png`,
      `https://s3-symbol-logo.tradingview.com/crypto/XTVC${coinCode}.svg`
    );
  }

  if (deferProvidedIcon) {
    sources.push(iconUrl);
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
  const normalizedCryptoCode = rawCode.endsWith("USDT") && rawCode.length > 4
    ? rawCode.slice(0, -4)
    : rawCode;
  const coinCode = type === "stock"
    ? rawCode.slice(0, 5)
    : normalizedCryptoCode;
  const fallbackCode = coinCode.length > 5 ? coinCode.slice(0, 5) : coinCode;
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
        {fallbackCode}
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
