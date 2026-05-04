
import LogoSvg from "../../assets/svg/pulse_logo.svg";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Buttons from "../../components/UI/buttons";
import Checkbox from "../../components/UI/checkbox";
import Inputs from "../../components/UI/inputs";
import pulseImagerr from '../../assets/img/singin.png';
import { Link } from "react-router-dom";
import Preloader from "../../components/UI/preloader";



export default function Login() {

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
                  <h1 >Войти в свой аккаунт</h1>
                  <div className="flex items-center justify-center gap-[8px]">
                    <p>У вас нет аккаунта?</p>
                    <Link to="/register">
                        <Buttons type="text-blue-underline">Зарегистрироваться</Buttons>
                    </Link>
                  </div>
                </div>
              </div>
              <form className="flex flex-col gap-4" action="submit">
                  <div className="flex flex-col gap-[8px]">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs variant="primary" type="email" placeholder="example@gmail.com" />
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs variant="primary" type="password" placeholder="Пароль" />
                  </div>
                  <div className="pt-[24px]">
                     <div className="flex items-center justify-between pb-[24px]">
                        <Checkbox textCheckbox="Запомнить меня" />
                        <Link to="/forgot-password"><Buttons type="text-blue-underline">Забыли пароль?</Buttons></Link>
                      </div>
                      <Link to="/app">
                        <Buttons className="btn_signIn" type="primary-full">Войти</Buttons>
                      </Link>
                      <div className="line"></div>
                      <Buttons disabled="disabled" onClick={() => alert('Войти с помощью Google')} type="black_prymary-widht">
                        <div className="flex items-center justify-center gap-[8px]">
                           <img src={GoogleSvg} alt="Google" />
                            Войти с помощью Google
                        </div>
                      </Buttons>
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
