import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import Buttons from "../../components/UI/buttons";
import ChartUP from "../../assets/svg/cartUP.svg";
import SVGplus from "../../assets/svg/plus_blue.svg";
import { useState } from "react";

export default function Dashboard() {

   const [currency, setCurrency] = useState({
    symbol: '$',
    rate: 1
  });

  // Храним базовую сумму (например, в рублях)
  const baseMoneyInRub = 17430021.12;

  // Функция смены валюты (меняет только валюту, не трогает сумму)
  const changeCurrency = () => {
    setCurrency(prev => {
      if (prev.symbol === "$") {
        return { symbol: '€', rate: 0.92 };
      } else if (prev.symbol === "€") {
        return { symbol: '₽', rate: 88.5 };
      } else {
        return { symbol: '$', rate: 1 };
      }
    });
  };

  // Функция конвертации (вычисляет сумму на лету)
  const getConvertedMoney = () => {
    // Переводим рубли в доллары, затем в нужную валюту
    const moneyInUSD = baseMoneyInRub / 88.5;
    const converted = moneyInUSD * currency.rate;
    
    // Форматируем с пробелами и копейками
    return converted.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="dashboard_content">
              <div className="dashboard_container">
                <div className="left_block_dsh">
                  <div className="title_ds">
                    <p>Ваш портфель</p>
                    <Buttons onClick={changeCurrency} type='text'><h5>{currency.symbol}</h5></Buttons>
                  </div>
                  <div className="moneyAll">
                    <p className="titlePriceDAsh">{getConvertedMoney()} {currency.symbol}</p>
                    <div className="changes_to_day">
                      <p style={{opacity: 0.5, fontSize: '12px', fontWeight: 400}}>за сегодня</p>
                      <div className="changes">
                        <img src={ChartUP} alt="chartup" />
                        <p>+0,58 ₽ (0,87%)</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="Right_block_dsh">
                  <div className="button_addBag">
                    <img src={SVGplus} alt="plus" />
                    <h5>Добавте портфели</h5>
                    <p>Которыми вы хотите автоматически торговать </p>
                  </div>
                </div>
              </div>
              <div className="dashboard_analytycs">
                <div className="containerAnalic">
                  <div className="blockf black_box">
                    <Drawer>
                      <DrawerTrigger>
                        <Buttons type='nm_black_prymary'>История</Buttons>
                      </DrawerTrigger>
                      <DrawerContent className="bg-black-s text-white border border-black-t rounded-t-2xl">
                        <center>
                            <div className="lineDrawer"></div>
                        </center>
                        <DrawerHeader>
                          <DrawerTitle>Are you absolutely sure?</DrawerTitle>
                          <DrawerDescription>This action cannot be undone.</DrawerDescription>
                        </DrawerHeader>
                        <DrawerFooter>
                          <Buttons>Submit</Buttons>
                          <DrawerClose>
                            <Buttons >Cancel</Buttons>
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