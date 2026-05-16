import Buttons from "../../components/ui/buttons";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Inputs from "../../components/ui/inputs";

export default function Profile() {
  return (
    <div className="app_pages">
      <div className="app_content settingsContend">
        <div className="app_items">
        <div className="container_settings profilesett">
            <div className="content_settings qwiouefhjioui">
              <div className="title_pages_st">
                <p>Parkhomets Nikitaя</p>
                <h5>Настройки аккаунта</h5>
              </div>
              <div className="line"></div>
              <div className="contentSettingsssss">
                  <div className="boxCurrency">
                      <div className="title_box">
                          <p>Доходность за 12 месяцев</p>
                      </div>
                      <div className="currencyBOX">
                        <h5>30 000₽</h5>
                        <p>+0,87%</p>
                      </div>
                  </div>
                  <div className="boxCurrency">
                    <div className="title_box">
                          <p>Доходность за 12 месяцев</p>
                      </div>
                      <div className="currencyBOX">
                        <h5>30 000₽</h5>
                        <p>+0,87%</p>
                      </div>
                  </div>
                  <div className="boxCurrency">
                      <div className="title_box">
                          <p>Доходность за 12 месяцев</p>
                      </div>
                      <div className="currencyBOX">
                        <h5>30 000₽</h5>
                        <p>+0,87%</p>
                      </div>
                  </div>
                  <div className="boxCurrency">
                      <div className="title_box">
                          <p>Доходность за 12 месяцев</p>
                      </div>
                      <div className="currencyBOX">
                        <h5>30 000₽</h5>
                        <p>+0,87%</p>
                      </div>
                  </div>
              </div>
              <div className="line"></div>
              <div className="FAQ">
                <div className="title_pages_stetttt">
                  <p>Персональная информация</p>
                </div>
              </div>
              <form className="infipqowiuefh" action="submit">
                  <div className="frominpeuts">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs variant="primary" type="email" placeholder="example@gmail.com" />
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs variant="primary" type="password" placeholder="Пароль" />
                  </div>
                  <div className="frominpeuts">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs variant="primary" type="email" placeholder="example@gmail.com" />
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs variant="primary" type="password" placeholder="Пароль" />
                  </div>
              </form>
              <Buttons disabled="disabled" onClick={() => alert('Войти с помощью Google')} type="black_prymary-widht">
                <div className="flex items-center justify-center gap-[8px]">
                  <img src={GoogleSvg} alt="Google" />
                    Включить Google Auntificator
                </div>
              </Buttons>
              <div className="buttons_Log_delete">
                <Buttons type='text'>Выйти из аккаунта</Buttons>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
