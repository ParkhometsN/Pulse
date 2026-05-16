import { Link, useLocation } from "react-router-dom";
import LogoSvg from "../assets/svg/pulse_logo.svg";
import UserIcon from "../assets/svg/user_icon.svg";
import BagDash from "../assets/svg/bag_icon.svg";
import BurgerIconSvg from "../assets/svg/burger_icon_svg.svg";
import Buttons from "./UI/buttons";
import { useCallback, useEffect, useState } from "react";
import api from "../lib/api";
import { getStoredUser, saveStoredUser } from "../lib/auth";

const formatPercent = (value) => {
  const number = Number(value) || 0;
  const sign = number > 0 ? "+" : "";

  return `${sign}${number.toFixed(2).replace(".", ",")}%`;
};

const getPercentTone = (value) => {
  const number = Number(value) || 0;

  if (number > 0) {
    return "positive";
  }

  if (number < 0) {
    return "negative";
  }

  return "neutral";
};

export default function Sidebar({ButtonExit}) {


  const location = useLocation();
  const [isopen, setIsopen] = useState(true);
  const [user, setUser] = useState(() => getStoredUser());
  const [portfolioChangePercent, setPortfolioChangePercent] = useState(0);

  const userName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
    : "Pulse Investor";


  useEffect(() => {
    const syncUser = () => setUser(getStoredUser());
    window.addEventListener("pulse:user-updated", syncUser);

    api.get("/auth/me")
      .then((response) => {
        saveStoredUser(response.data.user);
        setUser(response.data.user);
      })
      .catch(() => {});

    return () => window.removeEventListener("pulse:user-updated", syncUser);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadPortfolioChange = () => {
      api.get("/portfolio/summary")
        .then((response) => {
          if (isMounted) {
            setPortfolioChangePercent(Number(response.data?.changePercent) || 0);
          }
        })
        .catch(() => {});
    };

    loadPortfolioChange();
    const intervalId = window.setInterval(loadPortfolioChange, 60000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
      const handleResize = () => {
        if (window.innerWidth <= 1100) {
          setIsopen(false);
        }else if(window.innerWidth > 1100){
          setIsopen(true)
        }
      };
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);


    }, []);

  useEffect(() => {
    const handleGlobalClick = (event) => {
      const target = event.target.closest('.ListenerHandle');
      if (target && window.innerWidth <= 871) {
        setIsopen(false);
      }
    };
    document.addEventListener('click', handleGlobalClick);
    
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  const toogleSidebar = useCallback(() => {
      setIsopen(prev => !prev)
      
  }, []);


  const isActive = (path) => {
    return location.pathname === path
  }
  const portfolioPercentText = formatPercent(portfolioChangePercent);
  const portfolioPercentTone = getPercentTone(portfolioChangePercent);


  return (

    <>
    <div className="desctop_sidebar">
      {isopen && (
          <div className="container-sidebar">
            <div className="main_contentSidebar">
              <div className="logo_burger">
              <div className="logo_blokc_sidebar">
                <img src={LogoSvg} alt="Pulse logo" />
                <p className="DisabledItemsSideBar" >Pulse</p>
              </div>
              <Buttons onClick={toogleSidebar} type="black_prymary-t">
                <img src={BurgerIconSvg} alt="Menu" />
              </Buttons>
              </div>
              <Link to='/app/profile'>
                <div className={`account_button ListenerHandle ${isActive('/app/profile') ? 'active' : ''}`}>
                  <div className="account_item">
                      <img src={UserIcon} alt="UserIcon" />
                      <div className={['text_account', 'DisabledItemsSideBar'].join(' ')}>
                        <p className="Name_Account">{userName}</p>
                        <p className="Destination">{user?.email || "Аккаунт Pulse"}</p>
                        <p className={`PersentMoney PersentMoney_${portfolioPercentTone}`}>
                          {portfolioPercentText}
                        </p>
                      </div>
                  </div>
                </div>
              </Link>
              <div className="minicontainerapp">
                <nav className="NavigationAPP">
                  <p className={['NavTitle', 'DisabledItemsSideBar'].join(' ')}>Главное меню</p>
                  <Link to="/app">
                    <Buttons type={`navigation_But ListenerHandle ${isActive('/app') ? 'active' : ''}`}>
                      <div className="iconBut">
                        <span className={`IconSvgNav ${isActive('/app') ? 'active' : ''}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
                            <path d="M15.1875 10.6125V13.8C15.1875 14.6205 14.5973 15.327 13.7835 15.435C12.2183 15.6427 10.6215 15.75 9.00004 15.75C7.37854 15.75 5.78179 15.6427 4.21654 15.435C3.40279 15.327 2.81254 14.6205 2.81254 13.8V10.6125M15.1875 10.6125C15.3656 10.4577 15.5081 10.2663 15.6052 10.0512C15.7023 9.83619 15.7517 9.60269 15.75 9.36675V6.5295C15.75 5.71875 15.174 5.01825 14.3723 4.89825C13.5228 4.77106 12.669 4.67425 11.8125 4.608M15.1875 10.6125C15.042 10.7362 14.8725 10.8337 14.6828 10.8975C12.85 11.5056 10.9311 11.8146 9.00004 11.8125C7.01404 11.8125 5.10379 11.4907 3.31729 10.8975C3.13224 10.8359 2.96084 10.7392 2.81254 10.6125M2.81254 10.6125C2.63445 10.4577 2.49196 10.2663 2.39487 10.0512C2.29777 9.83619 2.24836 9.60269 2.25004 9.36675V6.5295C2.25004 5.71875 2.82604 5.01825 3.62779 4.89825C4.47731 4.77106 5.33111 4.67425 6.18754 4.608M11.8125 4.608V3.9375C11.8125 3.48995 11.6348 3.06072 11.3183 2.74426C11.0018 2.42779 10.5726 2.25 10.125 2.25H7.87504C7.42749 2.25 6.99827 2.42779 6.6818 2.74426C6.36533 3.06072 6.18754 3.48995 6.18754 3.9375V4.608M11.8125 4.608C9.94033 4.46331 8.05975 4.46331 6.18754 4.608M9.00004 9.5625H9.00604V9.5685H9.00004V9.5625Z"  strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                        <p>Портфель</p>
                      </div>
                    </Buttons>
                  </Link>
                  <Link to="/app/market">
                    <Buttons type={`navigation_But ListenerHandle ${isActive('/app/market') ? 'active' : ''}`}>
                      <div className="iconBut">
                        <span className={`IconSvgNav ${isActive('/app/market') ? 'active' : ''}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M1.6875 6.1875H16.3125M1.6875 6.75H16.3125M3.9375 10.6875H8.4375M3.9375 12.375H6.1875M3.375 14.625H14.625C15.0726 14.625 15.5018 14.4472 15.8182 14.1307C16.1347 13.8143 16.3125 13.3851 16.3125 12.9375V5.0625C16.3125 4.61495 16.1347 4.18573 15.8182 3.86926C15.5018 3.55279 15.0726 3.375 14.625 3.375H3.375C2.92745 3.375 2.49822 3.55279 2.18176 3.86926C1.86529 4.18573 1.6875 4.61495 1.6875 5.0625V12.9375C1.6875 13.3851 1.86529 13.8143 2.18176 14.1307C2.49822 14.4472 2.92745 14.625 3.375 14.625Z" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                        <p>Торговая площадка</p>
                      </div>
                    </Buttons>
                  </Link>
                  <Link to="/app/news">
                    <Buttons type={`navigation_But ListenerHandle ${isActive('/app/news') ? 'active' : ''}`}>
                      <div className="iconBut">
                        <span className={`IconSvgNav ${isActive('/app/news') ? 'active' : ''}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M9 5.625H10.125M9 7.875H10.125M4.5 10.125H10.125M4.5 12.375H10.125M12.375 5.625H14.9062C15.372 5.625 15.75 6.003 15.75 6.46875V13.5C15.75 13.9476 15.5722 14.3768 15.2557 14.6932C14.9393 15.0097 14.5101 15.1875 14.0625 15.1875M12.375 5.625V13.5C12.375 13.9476 12.5528 14.3768 12.8693 14.6932C13.1857 15.0097 13.6149 15.1875 14.0625 15.1875M12.375 5.625V3.65625C12.375 3.1905 11.997 2.8125 11.5312 2.8125H3.09375C2.628 2.8125 2.25 3.1905 2.25 3.65625V13.5C2.25 13.9476 2.42779 14.3768 2.74426 14.6932C3.06072 15.0097 3.48995 15.1875 3.9375 15.1875H14.0625M4.5 5.625H6.75V7.875H4.5V5.625Z" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                        <p>Новости</p>
                      </div>
                    </Buttons>
                  </Link>
                  <p className={['NavTitle', 'DisabledItemsSideBar'].join(' ')}>Параметры</p>
                  <Link to="/app/settings">
                    <Buttons type={`navigation_But ListenerHandle ${isActive('/app/settings') ? 'active' : ''}`}>
                      <div className="iconBut">
                        <span className={`IconSvgNav ${isActive('/app/settings') ? 'active' : ''}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" strokeWidth="1.5" >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                          </svg>
                        </span>
                        <p>Настройки</p>
                      </div>
                    </Buttons>
                  </Link>
                </nav>
              </div>
            </div>
            <Buttons onClick={ButtonExit} type='navigation_But_exit sidebardown'>
                <div className="iconBut">
                  <span className="IconSvgNav-exit">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                    </svg>
                  </span>
                  <p>Выйти из аккаунта</p>
                </div>
            </Buttons>
          </div>
      )}
      
      {!isopen && (
         <div className="container-sidebar-hidden">
            <div className="logo_burger">
              <div className="logo_blokc_sidebar">
              </div>
              <Buttons onClick={toogleSidebar} type="black_prymary-t">
                <img src={BurgerIconSvg} alt="Menu" />
              </Buttons>
            </div>
            <Link to='/app/profile'>
              <div className={`account_button ${isActive('/app/profile') ? 'active' : ''}`}>
                <div className="account_item-hidden-sidebar">
                    <img src={UserIcon} alt="UserIcon" />
                </div>
              </div>
            </Link>
            <div className="minicontainerapp exitappPcoinwe">
              <nav className="NavigationAPP">
                <Link to="/app">
                  <Buttons type={`navigation_But ${isActive('/app') ? 'active' : ''}`}>
                    <div className="iconBut">
                      <span className="IconSvgNav hiddenside">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">
                          <path d="M15.1875 10.6125V13.8C15.1875 14.6205 14.5973 15.327 13.7835 15.435C12.2183 15.6427 10.6215 15.75 9.00004 15.75C7.37854 15.75 5.78179 15.6427 4.21654 15.435C3.40279 15.327 2.81254 14.6205 2.81254 13.8V10.6125M15.1875 10.6125C15.3656 10.4577 15.5081 10.2663 15.6052 10.0512C15.7023 9.83619 15.7517 9.60269 15.75 9.36675V6.5295C15.75 5.71875 15.174 5.01825 14.3723 4.89825C13.5228 4.77106 12.669 4.67425 11.8125 4.608M15.1875 10.6125C15.042 10.7362 14.8725 10.8337 14.6828 10.8975C12.85 11.5056 10.9311 11.8146 9.00004 11.8125C7.01404 11.8125 5.10379 11.4907 3.31729 10.8975C3.13224 10.8359 2.96084 10.7392 2.81254 10.6125M2.81254 10.6125C2.63445 10.4577 2.49196 10.2663 2.39487 10.0512C2.29777 9.83619 2.24836 9.60269 2.25004 9.36675V6.5295C2.25004 5.71875 2.82604 5.01825 3.62779 4.89825C4.47731 4.77106 5.33111 4.67425 6.18754 4.608M11.8125 4.608V3.9375C11.8125 3.48995 11.6348 3.06072 11.3183 2.74426C11.0018 2.42779 10.5726 2.25 10.125 2.25H7.87504C7.42749 2.25 6.99827 2.42779 6.6818 2.74426C6.36533 3.06072 6.18754 3.48995 6.18754 3.9375V4.608M11.8125 4.608C9.94033 4.46331 8.05975 4.46331 6.18754 4.608M9.00004 9.5625H9.00604V9.5685H9.00004V9.5625Z"  strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </div>
                  </Buttons>
                </Link>
                <Link to="/app/market">
                  <Buttons type={`navigation_But ${isActive('/app/market') ? 'active' : ''}`}>
                    <div className="iconBut">
                      <span className="IconSvgNav hiddenside">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none">
                          <path d="M1.6875 6.1875H16.3125M1.6875 6.75H16.3125M3.9375 10.6875H8.4375M3.9375 12.375H6.1875M3.375 14.625H14.625C15.0726 14.625 15.5018 14.4472 15.8182 14.1307C16.1347 13.8143 16.3125 13.3851 16.3125 12.9375V5.0625C16.3125 4.61495 16.1347 4.18573 15.8182 3.86926C15.5018 3.55279 15.0726 3.375 14.625 3.375H3.375C2.92745 3.375 2.49822 3.55279 2.18176 3.86926C1.86529 4.18573 1.6875 4.61495 1.6875 5.0625V12.9375C1.6875 13.3851 1.86529 13.8143 2.18176 14.1307C2.49822 14.4472 2.92745 14.625 3.375 14.625Z" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </div>
                  </Buttons>
                </Link>
                <Link to="/app/news">
                  <Buttons type={`navigation_But ${isActive('/app/news') ? 'active' : ''}`}>
                    <div className="iconBut">
                      <span className="IconSvgNav hiddenside">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none">
                          <path d="M9 5.625H10.125M9 7.875H10.125M4.5 10.125H10.125M4.5 12.375H10.125M12.375 5.625H14.9062C15.372 5.625 15.75 6.003 15.75 6.46875V13.5C15.75 13.9476 15.5722 14.3768 15.2557 14.6932C14.9393 15.0097 14.5101 15.1875 14.0625 15.1875M12.375 5.625V13.5C12.375 13.9476 12.5528 14.3768 12.8693 14.6932C13.1857 15.0097 13.6149 15.1875 14.0625 15.1875M12.375 5.625V3.65625C12.375 3.1905 11.997 2.8125 11.5312 2.8125H3.09375C2.628 2.8125 2.25 3.1905 2.25 3.65625V13.5C2.25 13.9476 2.42779 14.3768 2.74426 14.6932C3.06072 15.0097 3.48995 15.1875 3.9375 15.1875H14.0625M4.5 5.625H6.75V7.875H4.5V5.625Z" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </div>
                  </Buttons>
                </Link>
                <Link to="/app/settings">
                  <Buttons type={`navigation_But ${isActive('/app/settings') ? 'active' : ''}`}>
                    <div className="iconBut">
                      <span className="IconSvgNav hiddenside">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" strokeWidth="1.5" >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                        </svg>
                      </span>
                    </div>
                  </Buttons>
                </Link>
              </nav>
              <Buttons onClick={ButtonExit} type='navigation_But_exit sidebardown'>
                  <div className="iconBut">
                    <span className="IconSvgNav-exit">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6" >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                      </svg>
                    </span>
                  </div>
                </Buttons>
            </div>
            
          </div>
      )}
      <div className="container-sidebar-mobile">
        <div className="logo_burger">
          <div className="logo_blokc_sidebar">
            <img src={LogoSvg} alt="Pulse logo" />
            <p className="DisabledItemsSideBar" >Pulse</p>
          </div>
          <Link to='/app' className="pr-[3vw]">
            <div className={`TodayMoney TodayMoney_${portfolioPercentTone}`}>
              <p className={`persent_money persent_money_${portfolioPercentTone}`}>
                ({portfolioPercentText})
              </p>
            </div>
          </Link>
          <Buttons onClick={toogleSidebar} type="black_prymary-t">
            <img src={BurgerIconSvg} alt="Menu" />
          </Buttons>
        </div>
      </div>
    </div>
     
    </>
    
  );
}
