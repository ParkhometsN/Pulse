import Inputs from "../../components/UI/Inputs.jsx";
import SearchIcon from "../../assets/svg/searchicon.svg";
import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";
import Buttons from "@/components/ui/buttons.jsx";
import MarketCardBot from "@/components/ui/marketCard.jsx";

export default function Market() {
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
                  <Buttons type='page_choise'>Криптовалюта</Buttons>
                  <Buttons type='page_choise'>Акции</Buttons>
                  <Buttons type='page_choise'>Облигации</Buttons>
                  <Buttons type='page_choise'>Стратегии</Buttons>
                  <Buttons type='page_choise'>Фьючерсы</Buttons>
                  <Buttons type='page_choise'>Избранные</Buttons>
                </div>
                <div className="wejwedf">
                  <div className="line"></div>
                </div>
                <div className="renderInformationBlcok">
                  <div className="titlemarket">
                    <p>Топ стратегий</p>
                    <img src={PulseSvgTag} alt="tag" />
                  </div>
                  <div className="cardList_marketbot">
                    <div className="cardmarketblocklist">
                      <MarketCardBot/>
                      <MarketCardBot/>
                      <MarketCardBot/>
                    </div>
                  </div>
                  <div className="titlemarket">
                    <p>Пассивный доход</p>
                  </div>
                  <div className="cardList_marketbot">
                    <div className="cardmarketblocklist">
                      <MarketCardBot/>
                      <MarketCardBot/>
                      <MarketCardBot/>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}