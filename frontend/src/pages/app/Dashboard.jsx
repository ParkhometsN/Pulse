import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import Buttons from "../../components/UI/buttons";
import ChartUP from "../../assets/svg/cartUP.svg";
import SVGplus from "../../assets/svg/plus_blue.svg";
import axios from "axios";

export default function Dashboard() {
  const [rates, setRates] = useState(null);

  const [currency, setCurrency] = useState({
    code: "USD",
    symbol: "$",
  });

  const baseMoneyInRub = 17430021.12;

  const getCurrencyRates = () => {
    axios
      .get("https://v6.exchangerate-api.com/v6/2207ed7f5bb763d1047a266b/latest/USD")
      .then((response) => {
        setRates(response.data.conversion_rates);
      })
      .catch((error) => {
        console.error("Ошибка при получении курса валют:", error);
      });
  };

  useEffect(() => {
    getCurrencyRates();
  }, []);

  const changeCurrency = () => {
    setCurrency((prev) => {
      if (prev.code === "USD") {
        return { code: "EUR", symbol: "€" };
      } else if (prev.code === "EUR") {
        return { code: "RUB", symbol: "₽" };
      } else {
        return { code: "USD", symbol: "$" };
      }
    });
  };

  const getConvertedMoney = () => {
    if (!rates) {
      return null;
    }

    if (currency.code === "RUB") {
      return baseMoneyInRub.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    const moneyInUSD = baseMoneyInRub / rates.RUB;
    const converted = moneyInUSD * rates[currency.code];

    return converted.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="dashboard_content">
            <div
              className={
                rates
                  ? "dashboard_container"
                  : "dashboard_container container_loading_element"
              }
            >
              <div className="left_block_dsh">
                <div className="title_ds">
                  <p>Ваш портфель</p>

                  <Buttons onClick={changeCurrency} type="text">
                    <h5>{currency.symbol}</h5>
                  </Buttons>
                </div>

                <div className="moneyAll">
                  <p className="titlePriceDAsh">
                    {rates ? `${getConvertedMoney()} ${currency.symbol}` : ""}
                  </p>

                  <div className="changes_to_day">
                    <p
                      style={{
                        opacity: 0.5,
                        fontSize: "12px",
                        fontWeight: 400,
                      }}
                    >
                      за сегодня
                    </p>

                    <div className="changes">
                      <img src={ChartUP} alt="chartup" />
                      <p>+0,58 ₽ (0,87%)</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="Right_block_dsh">
                <Drawer>
                  <DrawerTrigger asChild>
                    <div className="button_addBag">
                      <img src={SVGplus} alt="plus" />
                      <h5>Добавьте портфели</h5>
                      <p>Которыми вы хотите автоматически торговать</p>
                    </div>
                  </DrawerTrigger>

                  <DrawerContent className="bg-black-s text-white border border-black-t rounded-t-2xl">
                    <center>
                      <div className="lineDrawer"></div>
                    </center>

                    <DrawerHeader>
                      <DrawerTitle>Are you absolutely sure?</DrawerTitle>
                      <DrawerDescription>
                        This action cannot be undone.
                      </DrawerDescription>
                    </DrawerHeader>

                    <DrawerFooter>
                      <Buttons>Submit</Buttons>
                      <DrawerClose>
                        <Buttons>Cancel</Buttons>
                      </DrawerClose>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              </div>
            </div>

            <div className="dashboard_analytycs">
              <div className="containerAnalic">
                <div className="blockf black_box">
                  <Drawer>
                    <DrawerTrigger asChild>
                      <Buttons type="nm_black_prymary">История</Buttons>
                    </DrawerTrigger>

                    <DrawerContent className="bg-black-s text-white border border-black-t rounded-t-2xl">
                      <center>
                        <div className="lineDrawer"></div>
                      </center>

                      <DrawerHeader>
                        <DrawerTitle>Are you absolutely sure?</DrawerTitle>
                        <DrawerDescription>
                          This action cannot be undone.
                        </DrawerDescription>
                      </DrawerHeader>

                      <DrawerFooter>
                        <Buttons>Submit</Buttons>
                        <DrawerClose>
                          <Buttons>Cancel</Buttons>
                        </DrawerClose>
                      </DrawerFooter>
                    </DrawerContent>
                  </Drawer>
                </div>

                <div className="blocks black_box"></div>
                <div className="block black_box"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
