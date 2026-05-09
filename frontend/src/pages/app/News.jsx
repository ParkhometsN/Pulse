import NewsCard from "@/components/ui/newsCard";

export default function News() {
  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="news_container">
              <div className="blockMoodSales">
                <div className="blockS ioiui">
                  <div className="InesscareInformation">
                    <div className="titleObblocknews">
                      <h2>Индекс страха и жадности CMC</h2>
                      <p>Портфель сбалансирован по отраслям экономики</p>
                    </div>
                    <span className="HoverTootlip">
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path fillRule="evenodd" clipRule="evenodd" d="M0 6.5C0 2.91 2.91 0 6.5 0C10.09 0 13 2.91 13 6.5C13 10.09 10.09 13 6.5 13C2.91 13 0 10.09 0 6.5ZM7.58533 3.88867C6.992 3.37067 6.008 3.37067 5.41533 3.88867C5.31552 3.97601 5.1851 4.02013 5.05277 4.01132C4.92043 4.0025 4.79701 3.94148 4.70967 3.84167C4.62232 3.74186 4.5782 3.61144 4.58702 3.4791C4.59583 3.34676 4.65686 3.22334 4.75667 3.136C5.726 2.288 7.274 2.288 8.24333 3.136C9.252 4.01867 9.252 5.48133 8.24333 6.364C8.07464 6.51109 7.88697 6.63486 7.68533 6.732C7.23467 6.95067 7 7.248 7 7.5V8C7 8.13261 6.94732 8.25979 6.85355 8.35355C6.75979 8.44732 6.63261 8.5 6.5 8.5C6.36739 8.5 6.24022 8.44732 6.14645 8.35355C6.05268 8.25979 6 8.13261 6 8V7.5C6 6.64733 6.70667 6.09533 7.25 5.832C7.37133 5.77333 7.484 5.69933 7.58533 5.61133C8.13867 5.12667 8.13867 4.37333 7.58533 3.88867ZM6.5 10.5C6.63261 10.5 6.75979 10.4473 6.85355 10.3536C6.94732 10.2598 7 10.1326 7 10C7 9.86739 6.94732 9.74021 6.85355 9.64645C6.75979 9.55268 6.63261 9.5 6.5 9.5C6.36739 9.5 6.24022 9.55268 6.14645 9.64645C6.05268 9.74021 6 9.86739 6 10C6 10.1326 6.05268 10.2598 6.14645 10.3536C6.24022 10.4473 6.36739 10.5 6.5 10.5Z" fill="#95959C"/>
                      </svg>
                      <div className="asset_chart_tooltipSVG">
                        <p>Блок использует ИИ и методы теории вероятности для анализа рыночных данных, прогнозирования изменения стоимости актива и формирования рекомендации о целесообразности его покупки.</p>
                      </div>
                    </span>
                  </div>
                  <div className="sercleChart">
                      <div className="secleBody">
                          <div className="chartindexScare">
                            <div className="serlcePoint"></div>
                          </div>
                      </div>
                  </div>
                  <div className="downMood">
                    <h5 className="IndexscareSercle">50</h5>
                    <p>Нейтральное</p>
                  </div>
                </div>
                <div className="blockS ioiui">
                  <h2>Исторические значения</h2>
                  <div className="params">
                      <div className="timeBl">
                        <h4>Вчера</h4>
                        <div className="brTimeNews">
                          <h5>Нейтрально - 40</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Прошлая неделя</h4>
                        <div className="brTimeNews">
                          <h5>Нейтрально - 43</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Прошлый месяц</h4>
                        <div className="brTimeNews sellbad">
                          <h5>страх - 32</h5>
                        </div>
                      </div>
                  </div>
                </div>
                <div className="blockS ioiui">
                  <h2>Максимум и минимум года</h2>
                  <div className="paramsyear">
                      <div className="timeBl">
                        <h4>Максимум года (May 23, 2026)</h4>
                        <div className="brTimeNews">
                          <h5>Жадность - 76</h5>
                        </div>
                      </div>
                      <div className="timeBl">
                        <h4>Минимум года <br /> (May 23, 2026)</h4>
                        <div className="brTimeNews sellbad">
                          <h5>сильный страх - 5</h5>
                        </div>
                      </div>
                  </div>
                </div>
              </div>
              <div className="linee"></div>
              <div className="news_blcok">
                <div className="newsListBlock">
                  <NewsCard/>
                  <NewsCard/>
                  <NewsCard/>
                  <NewsCard/>
                </div>
                <div className="blockNewsAnalitycs">
                  <div className="blNew">
                    <h2>Топ источников</h2>
                    <div className="linee"></div>
                    <div className="listOfSites">
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      <a href="https://www.moex.com/s1161" target="_blank">
                        <div className="linkItem">
                          <img src="https://www.moex.com/favicon.svg" alt="favicon" />
                          <div className="textofLinkNews">
                            <p>moex.com</p>
                            <h5>Рынок акций и паев</h5>
                          </div>
                        </div>
                      </a>
                      
                    </div>
                  </div>
                  <p className="n">Любая информация в приложении <span style={{color: 'var(--primary-blue)'}}>Pulse</span> не являеться инвестиционной рекомендацией</p>
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}