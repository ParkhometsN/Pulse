
import LogoSvg from "../../assets/svg/pulse_logo.svg";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Buttons from "../../components/UI/buttons";
import Checkbox from "../../components/UI/checkbox";
import Inputs from "../../components/UI/inputs";
import pulseImagerr from '../../assets/img/singin.png';
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "../../lib/api";
import { saveAuthSession } from "../../lib/auth";
import { getApiErrorMessage } from "../../lib/apiError";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [rememberMe, setRememberMe] = useState(false);
  const [authAlert, setAuthAlert] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field) => (event) => {
    setForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAuthAlert(null);
    setIsSubmitting(true);

    try {
      const response = await api.post("/auth/login", form);
      saveAuthSession(response.data.accessToken, response.data.user);
      navigate("/app", { replace: true });
    } catch (error) {
      setAuthAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось войти. Попробуйте ещё раз."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
              {authAlert && (
                <div className={`auth_alert auth_alert_${authAlert.type}`}>
                  {authAlert.text}
                </div>
              )}
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                  <div className="flex flex-col gap-[8px]">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs
                      id="email"
                      variant="primary"
                      type="email"
                      placeholder="example@gmail.com"
                      value={form.email}
                      onChange={updateField("email")}
                      autoComplete="email"
                      required
                    />
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs
                      id="password"
                      variant="primary"
                      type="password"
                      placeholder="Пароль"
                      value={form.password}
                      onChange={updateField("password")}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div className="pt-[24px]">
                     <div className="flex items-center justify-between pb-[24px]">
                        <Checkbox
                          id="rememberMe"
                          textCheckbox="Запомнить меня"
                          checked={rememberMe}
                          onChange={(event) => setRememberMe(event.target.checked)}
                        />
                        <Link to="/forgot-password"><Buttons type="text-blue-underline">Забыли пароль?</Buttons></Link>
                      </div>
                      <Buttons
                        className="btn_signIn"
                        type="primary-full"
                        htmlType="submit"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Загрузка..." : "Войти"}
                      </Buttons>
                      <div className="line"></div>
                      <Buttons disabled="disabled" onClick={() => window.alert('Войти с помощью Google')} type="black_prymary-widht">
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
