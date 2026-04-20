import Buttons from "../../components/UI/buttons";

export default function Profile() {
  return (
    <div className="app_pages">
      <div className="app_content settingsContend">
        <div className="app_items">
        <div className="container_settings">
            <div className="content_settings">
              <div className="title_pages_st">
                <p>Parkhomets Nikitaя</p>
                <h5>Настройки аккаунта</h5>
              </div>
              <div className="line"></div>
              <div className="contentSettings">
                <div className="title_pages_stetttt">
                  <p>Настройки приложения</p>
                </div>
              </div>
              <div className="line"></div>
              <div className="FAQ">
                <div className="title_pages_stetttt">
                  <p>Ошибки приложения?</p>
                </div>
              </div>
              <Buttons className='ewriu' type='nm_black_prymary'> <a href="mailto:parkhometsniktia@gmail.com">Написать тикет</a></Buttons>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}