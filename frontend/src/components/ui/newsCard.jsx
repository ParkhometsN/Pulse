import React, { useState, useRef, useEffect } from 'react';
import { Link } from "react-router-dom";

export default function NewsCard({ text }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isLongText, setIsLongText] = useState(false);
    const textRef = useRef(null);

    // Если text не передан через пропсы, используем этот длинный текст для теста
    const displayText = text || ' Судья санкционировал перевод 71 млн долларов в ETH в пользу Aave, поскольку процесс возврата rsETH вступает в заключительную фазу Федеральный судья США санкционировал перевод примерно 30 765 ETH на сумму около 71 млн долларов на кошелек, контролируемый Aave, устранив тем самым последнее юридическое препятствие в рамках самой сложной на сегодняшний день операции по возвращению средств в сфере децентрализованных финансов. 9 мая судья Маргарет Гарнетт вынесла постановление, изменяющее ранее наложенный арест активов, разрешив Совету безопасности Arbitrum перевести примерно 30 765 ETH на сумму около 71 млн долларов на адрес кошелька, контролируемого Aave LLC. Это постановление также разрешает перевод дополнительных средств.';

    useEffect(() => {
        if (textRef.current) {
            const lineHeight = parseInt(getComputedStyle(textRef.current).lineHeight);
            const maxHeight = lineHeight * 7; // 7 строк
            const scrollHeight = textRef.current.scrollHeight;
            const isLong = scrollHeight > maxHeight;
            setIsLongText(isLong);
            
            // Отладка - проверьте в консоли браузера
            console.log('lineHeight:', lineHeight);
            console.log('maxHeight:', maxHeight);
            console.log('scrollHeight:', scrollHeight);
            console.log('isLongText:', isLong);
        }
    }, [displayText]); // ← важно: зависимость от displayText, а не от text

    return (
        <div className="containerNewCard">
            <div className="containerCardNews">
                <div className="upNews">
                    <a href="#" className='websiteLink'><h5>Binance.com</h5></a>
                    <p style={{opacity: 0.5, fontSize: '13px' }}>сегодня в 10:58</p>
                </div>
                <div className="bannerNewsImg">
                    <img src="https://news.bitcoin.com/_next/image/?url=https%3A%2F%2Fstatic.news.bitcoin.com%2Fwp-content%2Fuploads%2F2026%2F05%2Fjudge-clears-71m-eth-transfer-to-aave-as-rseth-recovery-enters-final-phase-1.jpg&w=1920&q=75" alt="bannerNews" />
                </div>
                <div className="text-block">
                    <div className="text-wrapper">
                        <div
                            ref={textRef}
                            className={`text-container ${!isExpanded ? 'collapsed' : 'expanded'}`}
                        >
                            {displayText}
                        </div>
                        {/* Кнопка "ещё" - появляется если текст длинный И НЕ развернут */}
                        {isLongText && !isExpanded && (
                            <button 
                                onClick={() => setIsExpanded(true)} 
                                className="toggle-btn inline-btn"
                            >
                                ещё
                            </button>
                        )}
                    </div>
                    {/* Кнопка "свернуть" - появляется если текст развернут */}
                    {isExpanded && (
                        <button 
                            onClick={() => setIsExpanded(false)} 
                            className="toggle-btn closeBitn"
                        >
                            свернуть
                        </button>
                    )}
                </div>
                <div className="coinlist">
                    <Link to='app/market'>
                        <div className="coinList">
                            <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png" alt="" />
                            <p>Ethereum</p>
                            <p style={{color: 'var(--green)'}}>3.75%</p>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}