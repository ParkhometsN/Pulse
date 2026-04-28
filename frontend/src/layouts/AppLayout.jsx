import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import axios from "axios";
import { useEffect, useState } from "react";

export default function AppLayout() {
    const [currenciies, setcurrenciies] = useState([])

    const FetchCurrency = () => {
      axios.get('http://127.0.0.1:8000/cryptocurrencies')
      .then(r => {
        setcurrenciies(r.data.slice(0, 15)) 
      })
    }

    useEffect(() => {
      FetchCurrency();
    }, []);


  return (
    <div className="MainAppScreen">
      <Sidebar />
      
      <main className="MainContentApp">
        <div className="marquee">
          <div className="marquee-content">
            {currenciies.map((coin) => {
                const change24h = coin.quote.USD.percent_change_24h;
                const isUp = Number(change24h) >= 0;
                const color = isUp ? "#00e0a4" : "#ff3b30";

                return (
                  <div className="coin_mn" key={coin.id}>
                    <img
                      alt="coin_icon"
                      src={`https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`}
                    />

                    <p>{coin.name}</p>

                    <p className="persent_money" style={{ color }}>
                      {change24h?.toFixed(2)}%
                    </p>
                  </div>
                );
              })}
            
          </div>
        </div>
        <div className="app_outlet_wrapper">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
