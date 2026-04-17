import Buttons from "../../components/UI/buttons";
import ChartUP from "../../assets/svg/cartUP.svg";
import SVGplus from "../../assets/svg/plus_blue.svg";

export default function Dashboard() {
  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <div className="dashboard_content">
              <div className="dashboard_container">
                <div className="left_block_dsh">
                  <div className="title_ds">
                    <p>Ваш портфель</p>
                    <Buttons type='text'><h5>₽</h5></Buttons>
                  </div>
                  <div className="moneyAll">
                    <p>17 430 021,12 ₽</p>
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
                  <div className="blockf black_box"></div>
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