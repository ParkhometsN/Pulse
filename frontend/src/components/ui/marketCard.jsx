import Buttons from "../../components/ui/buttons";
import PulseSvgTag from "../../assets/svg/tagpulsegray.svg";


export default function MarketCardBot({
    titleCardstrategi,
    desritioncardStrategy,
    onClick,
    contentBottomCard,
    ImgContentCard
}) {
  return (
    <>
    <div className="marketcard_container">
        <div className="market_card_content">
            <div className="imageCard">
                {ImgContentCard}
            </div>
            <div className="titleCardMarket">
                <div className="textOfcard">
                    <h1>{titleCardstrategi}</h1>
                    <p>{desritioncardStrategy}</p>
                </div>
                <Buttons onClick={onClick} type='primary-icon'>
                    <span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="15" viewBox="0 0 14 15" fill="none">
                        <path d="M3 11.25L10.5 3M10.5 3H4.875M10.5 3V9.1875" stroke="white" strokeWidth="1.875" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </span>
                </Buttons>
            </div>
            <div className="wejwedf">
              <div className="linee"></div>
            </div>
            <div className="tagcardMarket">
                <div className="miniifcard">
                    {contentBottomCard}
                </div>
                <img src={PulseSvgTag} alt="tag" />
            </div>
        </div>
    </div>
    </>
  );
}
