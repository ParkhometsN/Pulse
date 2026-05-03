import CoinIcon from "./coinIcon.jsx";

const getSmoothPath = (points) => {
  if (points.length < 2) {
    return "";
  }

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }

    const previous = points[index - 1];
    const beforePrevious = points[index - 2] || previous;
    const next = points[index + 1] || point;
    const controlOneX = previous.x + (point.x - beforePrevious.x) / 6;
    const controlOneY = previous.y + (point.y - beforePrevious.y) / 6;
    const controlTwoX = point.x - (next.x - previous.x) / 6;
    const controlTwoY = point.y - (next.y - previous.y) / 6;

    return `${path} C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${point.x} ${point.y}`;
  }, "");
};

function MiniChart({ price, change24h, change7d, change30d, chartData }) {
  const width = 100;
  const height = 30;
  const padding = 2;

  const safePrice = Number(price) || 0;

  const makePrice = (percent) => {
    const value = Number(percent) || 0;
    return safePrice / (1 + value / 100);
  };

  const chartPrices = Array.isArray(chartData)
    ? chartData
      .slice(-7)
      .map((item) => Number(item.close))
      .filter(Number.isFinite)
    : [];
  const pointsData = chartPrices.length > 1
    ? chartPrices
    : [
      makePrice(change30d),
      makePrice((Number(change30d) + Number(change7d)) / 2),
      makePrice(change7d),
      makePrice((Number(change7d) + Number(change24h)) / 2),
      makePrice(change24h),
      safePrice * 0.995,
      safePrice,
    ];

  const min = Math.min(...pointsData);
  const max = Math.max(...pointsData);

  const chartPoints = pointsData
    .map((value, index) => {
      const x = padding + (index / (pointsData.length - 1)) * (width - padding * 2);
      const y = padding + (1 - ((value - min) / (max - min || 1))) * (height - padding * 2);
      return { x, y };
    });
  const linePath = getSmoothPath(chartPoints);
  const lastPoint = chartPoints[chartPoints.length - 1];

  const trend = pointsData[pointsData.length - 1] - pointsData[0];
  const color = trend === 0 ? "#969696" : trend > 0 ? "#00e0a4" : "#ff3b30";
  const gradientId = `mini_chart_gradient_${color.replace("#", "")}`;
  const areaPath = `${linePath} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="0"
          y2={height}
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={color} stopOpacity="0.2" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter
          id="mini_chart_point_shadow"
          x="-4"
          y="-4"
          width="108"
          height="38"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <feOffset dy="2"/>
          <feGaussianBlur stdDeviation="2"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0.268354 0 0 0 0 0.268354 0 0 0 0 0.31049 0 0 0 0.15 0"/>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow"/>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape"/>
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastPoint && (
        <g filter="url(#mini_chart_point_shadow)">
          <rect
            x={lastPoint.x - 5}
            y={lastPoint.y - 5}
            width="10"
            height="10"
            rx="5"
            fill={color}
          />
          <rect
            x={lastPoint.x - 4}
            y={lastPoint.y - 4}
            width="8"
            height="8"
            rx="4"
            stroke="white"
            strokeWidth="2"
          />
        </g>
      )}
    </svg>
  );
}

const formatMoney = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "$0";
  }

  return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

const formatPercent = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0.00%";
  }

  return `${number.toFixed(2)}%`;
};

const getPercentClass = (value) => {
  const number = Number(value) || 0;

  if (number === 0) {
    return "gray";
  }

  return number > 0 ? "green" : "red";
};

export default function CointButtonMarket({
  NameCoin,
  NMC,
  baseCoin,
  iconUrl,
  assetType = "crypto",
  currencySymbol = "$",
  chartData,
  onClick,
  priceCoin,
  percent_change_24h,
  percent_change_7d,
  percent_change_30d,
  isFavorite = false,
  onToggleFavorite,
}) {
  return (
    <div onClick={onClick} className="containerbutton">


      <div className="idificatorCoint">
        <div className="count_star">
          <button
            className={isFavorite ? "buttonStar buttonStar_active" : "buttonStar"}
            type="button"
            aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite?.();
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M11.4802 3.49897C11.5225 3.3958 11.5945 3.30755 11.6871 3.24543C11.7797 3.18331 11.8887 3.15015 12.0002 3.15015C12.1117 3.15015 12.2206 3.18331 12.3132 3.24543C12.4058 3.30755 12.4779 3.3958 12.5202 3.49897L14.6452 8.60997C14.6849 8.70561 14.7503 8.78841 14.8341 8.84928C14.9179 8.91015 15.0169 8.94672 15.1202 8.95497L20.6382 9.39697C21.1372 9.43697 21.3392 10.06 20.9592 10.385L16.7552 13.987C16.6766 14.0542 16.6181 14.1417 16.586 14.2399C16.5539 14.3382 16.5494 14.4434 16.5732 14.544L17.8582 19.929C17.884 20.037 17.8772 20.1503 17.8387 20.2545C17.8002 20.3587 17.7317 20.4491 17.6418 20.5144C17.5519 20.5797 17.4447 20.6168 17.3337 20.6212C17.2227 20.6256 17.1129 20.597 17.0182 20.539L12.2932 17.654C12.2049 17.6001 12.1036 17.5715 12.0002 17.5715C11.8968 17.5715 11.7954 17.6001 11.7072 17.654L6.98216 20.54C6.88742 20.598 6.77762 20.6266 6.66662 20.6222C6.55562 20.6178 6.44841 20.5807 6.35853 20.5154C6.26865 20.4501 6.20013 20.3597 6.16162 20.2555C6.12311 20.1513 6.11634 20.038 6.14216 19.93L7.42716 14.544C7.451 14.4434 7.44661 14.3381 7.4145 14.2399C7.38239 14.1416 7.3238 14.0541 7.24516 13.987L3.04116 10.385C2.95651 10.3128 2.89517 10.2171 2.86492 10.1101C2.83468 10.003 2.83688 9.88942 2.87125 9.78362C2.90563 9.67782 2.97062 9.58461 3.05802 9.51578C3.14541 9.44695 3.25126 9.4056 3.36216 9.39697L8.88016 8.95497C8.98341 8.94672 9.08239 8.91015 9.16619 8.84928C9.25 8.78841 9.31539 8.70561 9.35516 8.60997L11.4802 3.49897Z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <CoinIcon
          baseCoin={baseCoin}
          iconUrl={iconUrl}
          label={NMC || NameCoin}
          type={assetType}
        />

        <div className="name_coin">
          <h1>{NameCoin}</h1>
          <p className="NMC">{NMC}</p>
        </div>
      </div>
    <div className="coinlistprice">
        <p className="coin_price">
            {formatMoney(priceCoin).replace("$", currencySymbol)}
        </p>

        <p className={getPercentClass(percent_change_24h)}>
            {formatPercent(percent_change_24h)}
        </p>

        <p className={`disMob  ${getPercentClass(percent_change_7d)}`}>
            {formatPercent(percent_change_7d)}
        </p>

        <p className={`disMob ${getPercentClass(percent_change_30d)}`}>
            {formatPercent(percent_change_30d)}
        </p>
    </div>
      <div className="mini_chart disMob tabletdis">
        <MiniChart
          price={priceCoin}
          change24h={percent_change_24h}
          change7d={percent_change_7d}
          change30d={percent_change_30d}
          chartData={chartData}
        />
      </div>
    </div>
  );
}
