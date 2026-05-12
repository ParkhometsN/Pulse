import Buttons from "../../components/UI/buttons";
import Checkbox from "../../components/UI/checkbox";
import Inputs from "../../components/UI/inputs";
import pulseImagerr from '../../assets/img/singin.png';
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "../../lib/api";
import { saveAuthSession } from "../../lib/auth";
import { getApiErrorMessage } from "../../lib/apiError";


export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    password: "",
    passwordConfirm: "",
  });
  const [authAlert, setAuthAlert] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);

  const updateField = (field) => (event) => {
    setForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));
  };

  const checkEmailExists = async () => {
    const email = form.email.trim();

    if (!email) {
      return false;
    }

    setIsCheckingEmail(true);

    try {
      const response = await api.post("/auth/check-email", { email });

      if (response.data.exists) {
        setAuthAlert({
          type: "error",
          text: "Пользователь с такой почтой уже существует. Попробуйте войти.",
        });
        return true;
      }

      return false;
    } catch (error) {
      setAuthAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось проверить почту."),
      });
      return true;
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAuthAlert(null);

    if (form.password !== form.passwordConfirm) {
      setAuthAlert({ type: "error", text: "Пароли не совпадают." });
      return;
    }

    if (!acceptedPolicy) {
      setAuthAlert({
        type: "error",
        text: "Перед регистрацией нужно поставить чекбокс согласия с политикой обработки данных.",
      });
      return;
    }

    const emailExists = await checkEmailExists();
    if (emailExists) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await api.post("/auth/register", {
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email,
        password: form.password,
        password_confirm: form.passwordConfirm,
      });
      saveAuthSession(response.data.accessToken, response.data.user);
      navigate("/app", { replace: true });
    } catch (error) {
      setAuthAlert({
        type: "error",
        text: error.response?.status === 409
          ? "Пользователь с такой почтой уже существует. Попробуйте войти."
          : getApiErrorMessage(error, "Не удалось создать аккаунт."),
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
                      onBlur={checkEmailExists}
                      autoComplete="email"
                      required
                    />
                    <div className="flex items-center gap-[8px]">
                      <div className="flex flex-col gap-[8px]">
                        <label className="pl-[10px]" htmlFor="firstName" >Имя</label>
                        <Inputs
                          id="firstName"
                          variant="primary"
                          type="text"
                          placeholder="Иван"
                          value={form.firstName}
                          onChange={updateField("firstName")}
                          autoComplete="given-name"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <label className="pl-[10px]" htmlFor="lastName" >Фамилия</label>
                        <Inputs
                          id="lastName"
                          variant="primary"
                          type="text"
                          placeholder="Иванов"
                          value={form.lastName}
                          onChange={updateField("lastName")}
                          autoComplete="family-name"
                          required
                        />
                      </div>
                    </div>
                    <label className="pl-[10px]" htmlFor="password" >Пароль</label>
                    <Inputs
                      id="password"
                      variant="primary"
                      type="password"
                      placeholder="Пароль"
                      value={form.password}
                      onChange={updateField("password")}
                      autoComplete="new-password"
                      required
                    />
                    <label className="pl-[10px]" htmlFor="passwordConfirm" >Повторите пароль</label>
                    <Inputs
                      id="passwordConfirm"
                      variant="primary"
                      type="password"
                      placeholder="Повторите пароль"
                      value={form.passwordConfirm}
                      onChange={updateField("passwordConfirm")}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="pt-[24px]">
                     <div className="flex items-center justify-between pb-[24px]">
                        <Checkbox
                          id="acceptedPolicy"
                          textCheckbox="Продолжая вы соглашаетесь с политикой обработкой данных"
                          checked={acceptedPolicy}
                          onChange={(event) => setAcceptedPolicy(event.target.checked)}
                        />
                      </div>
                      <Buttons
                        className="btn_signIn"
                        type="primary-full"
                        htmlType="submit"
                        disabled={isSubmitting || isCheckingEmail}
                      >
                        {isSubmitting ? "Создаём..." : isCheckingEmail ? "Проверяем..." : "Зарегистрироваться"}
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
