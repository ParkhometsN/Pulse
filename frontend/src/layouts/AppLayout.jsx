import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import TestUI from "../components/UI/TestUI";

export default function AppLayout() {
  return (
    <div className="MainAppScreen">
      <Sidebar />
      
      <main className="MainContentApp">
        <div className="marquee">
          <div className="marquee-content">
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
            <div className="coin_mn">
              <img src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.png" alt="coin_icon" />
              <p>Bitcoin</p>
              <p className="persent_money">+0,87%</p>
            </div>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
