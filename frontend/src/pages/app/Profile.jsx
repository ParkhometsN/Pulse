import Buttons from "../../components/UI/buttons";
import { Link } from "react-router-dom";

export default function Profile() {
  return (
    <div className="app_pages">
      <div className="app_content">
        <div className="app_items">
          <h1>Страница аккаунта</h1>
          <Link to="/"> 
            <Buttons type="primary-danger">Выход</Buttons>
          </Link>
          
        </div>
      </div>
    </div>
  );
}