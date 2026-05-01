import LogoSvg from "../../assets/svg/pulse_logo.svg";
import Buttons from "../../components/ui/buttons.jsx";
import pulseImage from '../../assets/img/promo_page_pulse.png';
import { Link } from "react-router-dom";



export default function Landing() {

  return (
    <>
      <div className="container-landing">
        <div className="container_content">
          <header>
            <div className="container_inforamtuin_weapp black_box">
              <div className="logo_blokc">
                <img src={LogoSvg} alt="Pulse logo" />
                <p >Pulse</p>
              </div>
              <div className="flex items-center gap-4">
                <Link to="/register" className="Mb-disabled">
                  <Buttons type="text">Зарегистрироваться</Buttons>
                </Link>
                <Link to="/login">
                  <Buttons type="primary">Войти</Buttons>
                </Link>
              </div>
            </div>
          </header>
          </div>
          <div className="content_hero flex flex-col">
              <div className="title_hero">
                <p>Pulse</p>
              </div>
              <div className="description">
                <p>Единый центр управления инвестициями. Подключайте любые портфели и управляйте активами в режиме одного окна.</p>
              </div>
              <Link to="/register">
                <Buttons type="black_prymary" className="button_icon">
                  <p>Начать инвестировать</p>
                </Buttons>
              </Link>
          </div>
          <div className="hero_content">
            <img src={pulseImage} alt="Pulse" />
          </div>
        </div>
    </>
  );
}
