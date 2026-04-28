function MiniChart({ price, change24h, change7d, change30d }) {
  const width = 140;
  const height = 45;

  const safePrice = Number(price) || 0;

  const makePrice = (percent) => {
    const value = Number(percent) || 0;
    return safePrice / (1 + value / 100);
  };

  const pointsData = [
    makePrice(change30d),
    makePrice(change7d),
    makePrice(change24h),
    safePrice * 0.995,
    safePrice,
  ];

  const min = Math.min(...pointsData);
  const max = Math.max(...pointsData);

  const points = pointsData
    .map((value, index) => {
      const x = (index / (pointsData.length - 1)) * width;
      const y = height - ((value - min) / (max - min || 1)) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const isUp = Number(change24h) >= 0;
  const color = isUp ? "#00e0a4" : "#ff3b30";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CointButtonMarket({
  NameCoin,
  NMC,
  countCoin,
  coinId,
  onClick,
  priceCoin,
  percent_change_24h,
  percent_change_7d,
  percent_change_30d,
}) {
  return (
    <div onClick={onClick} className="containerbutton">


      <div className="idificatorCoint">
        <div className="count_star">
            <p>{countCoin}</p>
        </div>
        <img
          alt="coin_icon"
          src={`https://s2.coinmarketcap.com/static/img/coins/64x64/${coinId}.png`}
        />

        <div className="name_coin">
          <h1>{NameCoin}</h1>
          <p>{NMC}</p>
        </div>
      </div>
    <div className="coinlistprice">
        <p className="coin_price">
            ${priceCoin?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </p>

        <p className={percent_change_24h >= 0 ? "green" : "red"}>
            {percent_change_24h?.toFixed(2)}%
        </p>

        <p className={`disMob ${percent_change_7d >= 0 ? "green" : "red"}`}>
            {percent_change_7d?.toFixed(2)}%
        </p>

        <p className={`disMob ${percent_change_30d >= 0 ? "green" : "red"}`}>
            {percent_change_30d?.toFixed(2)}%
        </p>
    </div>
      <div className="mini_chart disMob">
        <MiniChart
          price={priceCoin}
          change24h={percent_change_24h}
          change7d={percent_change_7d}
          change30d={percent_change_30d}
        />
      </div>
    </div>
  );
}