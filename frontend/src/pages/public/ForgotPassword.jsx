import LogoSvg from "../../assets/svg/pulse_logo.svg";
import Buttons from "../../components/UI/buttons";
import Inputs from "../../components/UI/inputs";
import pulseImagerr from '../../assets/img/singin.png';
import { Link } from "react-router-dom";
import { useState } from "react";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/apiError";


export default function ForgotPassword() {
  const [step, setStep] = useState("email");
  const [form, setForm] = useState({
    email: "",
    code: "",
    password: "",
    passwordConfirm: "",
  });
  const [authAlert, setAuthAlert] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field) => (event) => {
    setForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));
  };

  const requestCode = async (event) => {
    event.preventDefault();
    setAuthAlert(null);
    setIsSubmitting(true);

    try {
      const response = await api.post("/auth/password/forgot", { email: form.email });
      setStep("reset");
      setAuthAlert({
        type: "success",
        text: response.data.devCode
          ? `Код для теста: ${response.data.devCode}`
          : response.data.message,
      });
    } catch (error) {
      setAuthAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось отправить код."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setAuthAlert(null);

    if (form.password !== form.passwordConfirm) {
      setAuthAlert({ type: "error", text: "Пароли не совпадают." });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await api.post("/auth/password/reset", {
        email: form.email,
        code: form.code,
        password: form.password,
        password_confirm: form.passwordConfirm,
      });
      setAuthAlert({ type: "success", text: response.data.message });
      setForm((currentForm) => ({
        ...currentForm,
        code: "",
        password: "",
        passwordConfirm: "",
      }));
    } catch (error) {
      setAuthAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось обновить пароль."),
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
                  <h1 >Восстановление пароля</h1>
                  <div className="flex items-center justify-center gap-[8px] text-center">
                    <p>Введите адрес электронной почты, на который зарегистрирован ваш аккаунт</p>
                  </div>
                </div>
              </div>
              {authAlert && (
                <div className={`auth_alert auth_alert_${authAlert.type}`}>
                  {authAlert.text}
                </div>
              )}
              <form
                className="flex flex-col gap-4"
                onSubmit={step === "email" ? requestCode : resetPassword}
              >
                  <div className="flex flex-col gap-[8px]">
                    <label className="pl-[10px]" htmlFor="email" >Почта</label>
                    <Inputs
                      id="email"
                      variant="primary"
                      type="email"
                      placeholder="example@gmail.com"
                      value={form.email}
                      onChange={updateField("email")}
                      disabled={step === "reset"}
                    />
                    {step === "reset" && (
                      <>
                        <label className="pl-[10px]" htmlFor="code" >Код из письма</label>
                        <Inputs
                          id="code"
                          variant="primary"
                          type="text"
                          placeholder="000000"
                          value={form.code}
                          onChange={updateField("code")}
                        />
                        <label className="pl-[10px]" htmlFor="password" >Новый пароль</label>
                        <Inputs
                          id="password"
                          variant="primary"
                          type="password"
                          placeholder="Новый пароль"
                          value={form.password}
                          onChange={updateField("password")}
                        />
                        <label className="pl-[10px]" htmlFor="passwordConfirm" >Повторите пароль</label>
                        <Inputs
                          id="passwordConfirm"
                          variant="primary"
                          type="password"
                          placeholder="Повторите пароль"
                          value={form.passwordConfirm}
                          onChange={updateField("passwordConfirm")}
                        />
                      </>
                    )}
                  </div>
                  <div className="pt-[24px]">
                      <Buttons
                        className="btn_signIn"
                        type="primary-full"
                        htmlType="submit"
                        disabled={isSubmitting}
                      >
                        {step === "email"
                          ? (isSubmitting ? "Отправляем..." : "Отправить код")
                          : (isSubmitting ? "Обновляем..." : "Обновить пароль")}
                      </Buttons>
                      {step === "reset" && (
                        <Buttons
                          type="text-blue-underline"
                          onClick={() => {
                            setStep("email");
                            setAuthAlert(null);
                          }}
                        >
                          Изменить почту
                        </Buttons>
                      )}
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
