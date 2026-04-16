import LogoSvg from "../../assets/svg/pulse_logo.svg";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Buttons from "../../components/UI/buttons.jsx";
import Checkbox from "../../components/UI/checkbox.jsx";
import Inputs from "../../components/UI/inputs.jsx";
import pulseImagerr from '../../assets/img/singin.png';
import { Link } from "react-router-dom";
import Preloader from "../../components/UI/preloader.jsx";




export default function ForgotPassword() {
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
                <div className="logo_blokc">
                  <img src={LogoSvg} alt="Pulse logo" />
                  <p >Pulse</p>
                </div>
                <div className="loginInacctext">
                  <h1 >Восстановление пароля</h1>
                  <div className="flex items-center justify-center gap-[8px] text-center">
                    <p>Введите адрес электронной почты, на который зарегистрирован ваш аккаунт</p>
                  </div>
                </div>
              </div>
              <form className="flex flex-col gap-4" action="submit">
                  <div className="flex flex-col gap-[8px]">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs variant="primary" type="email" placeholder="example@gmail.com" />
                  </div>
                  <div className="pt-[24px]">
                      <Buttons className="btn_signIn" type="primary-full">Отправить код</Buttons>
                      <div className="line"></div>
                      <center>
                        <Link to="/login">
                          <Buttons type="text-blue-underline"> &crarr; Вернуться ко входу</Buttons>
                        </Link>
                      </center>
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