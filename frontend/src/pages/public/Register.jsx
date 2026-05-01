import LogoSvg from "../../assets/svg/pulse_logo.svg";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Buttons from "../../components/ui/buttons.jsx";
import Checkbox from "../../components/ui/checkbox.jsx";
import Inputs from "../../components/ui/inputs.jsx";
import pulseImagerr from '../../assets/img/singin.png';
import { Link } from "react-router-dom";
import Preloader from "../../components/ui/preloader.jsx";






export default function Register() {
  return (
    <div className="container-Login">
      <div className="hero_content_login">
          <img src={pulseImagerr} alt="Pulse" />
      </div>
      <div className="container_content_Login">
        <div className="signIn">
          <div className="sinin_conatainer">
            <div className="signIn_content">
              <div className="flex flex-col gap-[14px] pb-[32px]">
                <div className="loginInacctext">
                  <h1 >Регистрация</h1>
                  <div className="flex items-center justify-center gap-[8px]">
                    <p>У вас уже есть аккаунт?</p>
                    <Link to="/login">
                        <Buttons type="text-blue-underline">Войти</Buttons>
                    </Link>
                  </div>
                </div>
              </div>
              <form className="flex flex-col gap-4" action="submit">
                  <div className="flex flex-col gap-[8px]">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs variant="primary" type="email" placeholder="example@gmail.com" />
                    <div className="flex items-center gap-[8px]">
                      <div className="flex flex-col gap-[8px]">
                        <label className="pl-[10px]" htmlFor="email" >Имя</label>
                        <Inputs variant="primary" type="email" placeholder="Иван Иванушка" />
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <label className="pl-[10px]" htmlFor="email" >Фамилия</label>
                        <Inputs variant="primary" type="email" placeholder="Иванов" />
                      </div>
                    </div>
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs variant="primary" type="password" placeholder="Пароль" />
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs variant="primary" type="password" placeholder="Пароль" />
                  </div>
                  <div className="pt-[24px]">
                     <div className="flex items-center justify-between pb-[24px]">
                        <Checkbox textCheckbox="Продолжая вы соглашаетесь с политикой обработкой данных" />
                      </div>
                      <Link to="/app">
                        <Buttons className="btn_signIn" type="primary-full">Войти</Buttons>
                      </Link>
                  </div>
              </form>
              <center>
                <div className="signachore">
                  <p>© Parkhomets</p>
                </div>
              </center>
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
