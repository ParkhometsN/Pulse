import { useEffect, useState } from "react";
import Inputs from "../../components/UI/inputs.jsx";
import SearchIcon from "../../assets/svg/searchicon.svg";
import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";
import Buttons from "../../components/UI/buttons";
import MarketCardBot from "../../components/ui/marketCard.jsx";
import CointButtonMarket from "@/components/ui/cointmarketButton.jsx";
import axios from "axios";


export default function Market() {
  const [activePage, setActivePage] = useState("strategies");
  const [currenciies, setcurrenciies] = useState([])

  const pages = [
    { id: "strategies", label: "Стратегии" },
    { id: "crypto", label: "Криптовалюта" },
    { id: "stocks", label: "Акции" },
    { id: "bonds", label: "Облигации", disabled: true },
    { id: "futures", label: "Фьючерсы", disabled: true },
    { id: "favorites", label: "Избранные" },
  ];

  const renderInformationBlock = () => {
    switch (activePage) {
      case "strategies":
        return (
          <>
            <div className="titlemarket">
              <p>Топ стратегий</p>
              <img src={PulseSvgTag} alt="tag" />
            </div>

            <div className="cardList_marketbot">
              <div className="cardmarketblocklist">
                <MarketCardBot />
                <MarketCardBot />
                <MarketCardBot />
              </div>
            </div>

            <div className="titlemarket">
              <p>Пассивный доход</p>
            </div>

            <div className="cardList_marketbot">
              <div className="cardmarketblocklist">
                <MarketCardBot />
                <MarketCardBot />
                <MarketCardBot />
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
                <p className="disMob">Последние 5 дней</p>
            </div>
            <div className="lineeeee"></div>
            <div className="coins_list">
              {currenciies.map((coin, index) => {
                return (
                  <CointButtonMarket
                    key={coin.id}
                    countCoin={index + 1}
                    NameCoin={coin.name}
                    NMC={coin.symbol}
                    coinId={coin.id}
                    priceCoin={coin.quote.USD.price}
                    percent_change_24h={coin.quote.USD.percent_change_24h}
                    percent_change_7d={coin.quote.USD.percent_change_7d}
                    percent_change_30d={coin.quote.USD.percent_change_30d}
                  />
                );
              })}
            </div>
          </div>
        </div>;

      case "stocks":
        return <div>Тут будут акции</div>;

      case "favorites":
        return <div>Тут будет избранное</div>;

      default:
        return null;
    }
  };




  const FetchCurrency = () => {
    axios.get('http://127.0.0.1:8000/cryptocurrencies')
    .then(r => {
      setcurrenciies(r.data) 
    })
  }

  useEffect(() => {
    FetchCurrency();
  }, []);

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="market_container">
            <div className="market_content">
              <div className="search_coins">
                <Inputs
                  variant="market"
                  type="text"
                  icon={SearchIcon}
                  placeholder="Название или тикер"
                />
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
                    onClick={() => setActivePage(page.id)}
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