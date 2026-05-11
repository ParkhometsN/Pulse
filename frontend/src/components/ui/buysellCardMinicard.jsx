export default function BuysellCardMinicard({
  sourceLabel = "Bybit",
  sourceIcon,
  action = "Покупка",
  name = "Ethereum",
  symbol = "ETH",
  icon = "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  priceFrom = "283₽",
  priceTo = "349₽",
  change = "+0,58 ₽ (0,87%)",
  time = "",
  onClick,
}) {
  return (
    <button type="button" className="containerbuttonbusell" onClick={onClick}>
      <div className="idificatorCointbuysell">
        <div className="itemtitleimg">
          <img src={icon} alt="coinicon" />
          <div className="name_coinbuysell">
            <h1>{name}</h1>
            <p className="NMC">
              {symbol}
              {time ? ` · ${time}` : ""}
            </p>
          </div>
        </div>

        <div className="sellbuyChange">
          {sourceIcon ? <img className="sellbuy_source_icon" src={sourceIcon} alt={sourceLabel} /> : null}
          <p style={{ opacity: 0.5 }}>{priceFrom}</p>
          <span className="arrow-right">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8" fill="none">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M0 4.00007C0 3.80115 0.0790175 3.61039 0.21967 3.46974C0.360322 3.32908 0.551088 3.25007 0.75 3.25007H13.34L11.24 1.30007C11.1678 1.23309 11.1094 1.15255 11.0683 1.06303C11.0272 0.973516 11.0042 0.876781 11.0005 0.778351C10.9968 0.679921 11.0125 0.581723 11.0467 0.489364C11.0809 0.397005 11.133 0.312293 11.2 0.240066C11.3353 0.0941974 11.5229 0.00803496 11.7217 0.000533505C11.8201 -0.00318084 11.9183 0.0125283 12.0107 0.0467643C12.1031 0.0810003 12.1878 0.133092 12.26 0.200066L15.76 3.45007C15.8357 3.52027 15.8961 3.60536 15.9375 3.70001C15.9788 3.79465 16.0001 3.8968 16.0001 4.00007C16.0001 4.10333 15.9788 4.20549 15.9375 4.30013C15.8961 4.39477 15.8357 4.47986 15.76 4.55007L12.26 7.80007C12.1141 7.93533 11.9205 8.0071 11.7217 7.9996C11.5229 7.9921 11.3353 7.90594 11.2 7.76007C11.0647 7.6142 10.993 7.42057 11.0005 7.22178C11.008 7.02299 11.0941 6.83533 11.24 6.70007L13.34 4.75007H0.75C0.551088 4.75007 0.360322 4.67105 0.21967 4.5304C0.0790175 4.38974 0 4.19898 0 4.00007Z"
                fill="white"
              />
            </svg>
          </span>
          <p>{priceTo}</p>
        </div>

        <div className="pricecoinBuy">
          <p>{action}</p>
          <p style={{ fontSize: "11px", color: "var(--green)" }}>{change}</p>
          <p className="pricecoinBuy_source">{sourceLabel}</p>
        </div>
      </div>
    </button>
  );
}
