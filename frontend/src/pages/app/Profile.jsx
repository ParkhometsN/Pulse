import { useEffect, useState } from "react";
import Buttons from "../../components/UI/buttons";
import GoogleSvg from "../../assets/svg/svg_google.svg";
import Inputs from "../../components/UI/inputs";
import api from "../../lib/api";
import { getStoredUser, saveStoredUser } from "../../lib/auth";
import { getApiErrorMessage } from "../../lib/apiError";

const formatPercent = (value) => {
  const number = Number(value) || 0;
  const sign = number > 0 ? "+" : "";

  return `${sign}${number.toFixed(2).replace(".", ",")}%`;
};

const formatRub = (value) => {
  const number = Number(value) || 0;

  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(number)}₽`;
};

export default function Profile() {
  const [user, setUser] = useState(() => getStoredUser());
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    password: "",
    passwordConfirm: "",
  });
  const [alert, setAlert] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [portfolioSummary, setPortfolioSummary] = useState({
    totalValueRub: 0,
    changePercent: 0,
    wallets: [],
  });

  useEffect(() => {
    api.get("/auth/me")
      .then((response) => {
        const nextUser = response.data.user;
        setUser(nextUser);
        saveStoredUser(nextUser);
        setProfileForm({
          firstName: nextUser.firstName || "",
          lastName: nextUser.lastName || "",
          email: nextUser.email || "",
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/portfolio/summary")
      .then((response) => {
        setPortfolioSummary({
          totalValueRub: Number(response.data?.totalValueRub) || 0,
          changePercent: Number(response.data?.changePercent) || 0,
          wallets: response.data?.wallets || [],
        });
      })
      .catch(() => {});
  }, []);

  const fullName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
    : "Профиль";

  const updateProfileField = (field) => (event) => {
    setProfileForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));
  };

  const updatePasswordField = (field) => (event) => {
    setPasswordForm((currentForm) => ({ ...currentForm, [field]: event.target.value }));
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setAlert(null);
    setIsSavingProfile(true);

    try {
      const response = await api.patch("/auth/me", {
        first_name: profileForm.firstName,
        last_name: profileForm.lastName,
      });
      setUser(response.data.user);
      saveStoredUser(response.data.user);
      setAlert({ type: "success", text: "Профиль обновлён." });
    } catch (error) {
      setAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось обновить профиль."),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setAlert(null);

    if (passwordForm.password !== passwordForm.passwordConfirm) {
      setAlert({ type: "error", text: "Пароли не совпадают." });
      return;
    }

    setIsSavingPassword(true);

    try {
      const response = await api.patch("/auth/password", {
        current_password: passwordForm.currentPassword,
        password: passwordForm.password,
        password_confirm: passwordForm.passwordConfirm,
      });
      setPasswordForm({ currentPassword: "", password: "", passwordConfirm: "" });
      setAlert({ type: "success", text: response.data.message });
    } catch (error) {
      setAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось обновить пароль."),
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className="app_pages">
      <div className="app_content settingsContend">
        <div className="app_items rfwsadqwdfrt">
          <div className="container_settings profilesett">
            <div className="content_settings qwiouefhjioui">
              <div className="title_pages_st">
                <p>{fullName}</p>
                <h5>{user?.email || "Настройки аккаунта"}</h5>
              </div>
              <div className="line"></div>
              <div className="contentSettingsssss">
                <div className="boxCurrency">
                  <div className="title_box">
                    <p>Доходность за 12 месяцев</p>
                  </div>
	                  <div className="currencyBOX">
	                    <h5>{formatRub(portfolioSummary.totalValueRub)}</h5>
	                    <p>{formatPercent(portfolioSummary.changePercent)}</p>
	                  </div>
	                </div>
                <div className="boxCurrency">
                  <div className="title_box">
                    <p>Подключенные портфели</p>
                  </div>
	                  <div className="currencyBOX">
	                    <h5>{portfolioSummary.wallets.length}</h5>
	                    <p>активных</p>
	                  </div>
                </div>
                <div className="boxCurrency">
                  <div className="title_box">
                    <p>AI сделки</p>
                  </div>
                  <div className="currencyBOX">
                    <h5>0</h5>
                    <p>история</p>
                  </div>
                </div>
              </div>
              <div className="line"></div>
              {alert && (
                <div className={`auth_alert auth_alert_${alert.type}`}>
                  {alert.text}
                </div>
              )}
              <div className="ioooisssddd">
                <div className="w-full" >
                  <div className="FAQ">
                    <div className="title_pages_stetttt">
                      <p>Персональная информация</p>
                    </div>
                  </div>
                  <form className="infipqowiuefh" onSubmit={handleProfileSubmit}>
                    <div className="frominpeuts">
                      <label className="pl-[10px]" htmlFor="profileEmail">Почта</label>
                      <Inputs
                        id="profileEmail"
                        variant="primary"
                        type="email"
                        placeholder="example@gmail.com"
                        value={profileForm.email}
                        disabled
                      />
                      <label className="pl-[10px]" htmlFor="profileFirstName">Имя</label>
                      <Inputs
                        id="profileFirstName"
                        variant="primary"
                        type="text"
                        placeholder="Имя"
                        value={profileForm.firstName}
                        onChange={updateProfileField("firstName")}
                      />
                    </div>
                    <div className="frominpeuts">
                      <label className="pl-[10px]" htmlFor="profileLastName">Фамилия</label>
                      <Inputs
                        id="profileLastName"
                        variant="primary"
                        type="text"
                        placeholder="Фамилия"
                        value={profileForm.lastName}
                        onChange={updateProfileField("lastName")}
                      />
                      <div className="profile_form_action">
                        <Buttons type="primary-full" htmlType="submit" disabled={isSavingProfile}>
                          {isSavingProfile ? "Сохраняем..." : "Сохранить профиль"}
                        </Buttons>
                      </div>
                    </div>
                  </form>
                </div>
                <div className="w-full">
                  <div className="FAQ">
                    <div className="title_pages_stetttt">
                      <p>Безопасность</p>
                    </div>
                  </div>
                  <form className="infipqowiuefh" onSubmit={handlePasswordSubmit}>
                    <div className="frominpeuts">
                      <label className="pl-[10px]" htmlFor="currentPassword">Текущий пароль</label>
                      <Inputs
                        id="currentPassword"
                        variant="primary"
                        type="password"
                        placeholder="Текущий пароль"
                        value={passwordForm.currentPassword}
                        onChange={updatePasswordField("currentPassword")}
                      />
                      <label className="pl-[10px]" htmlFor="newPassword">Новый пароль</label>
                      <Inputs
                        id="newPassword"
                        variant="primary"
                        type="password"
                        placeholder="Новый пароль"
                        value={passwordForm.password}
                        onChange={updatePasswordField("password")}
                      />
                    </div>
                    <div className="frominpeuts">
                      <label className="pl-[10px]" htmlFor="newPasswordConfirm">Повторите пароль</label>
                      <Inputs
                        id="newPasswordConfirm"
                        variant="primary"
                        type="password"
                        placeholder="Повторите пароль"
                        value={passwordForm.passwordConfirm}
                        onChange={updatePasswordField("passwordConfirm")}
                      />
                      <div className="profile_form_action">
                        <Buttons type="primary-full" htmlType="submit" disabled={isSavingPassword}>
                          {isSavingPassword ? "Обновляем..." : "Обновить пароль"}
                        </Buttons>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
              
              
              <div className="line"></div>
              <div className="pb-[40px]">
                <Buttons disabled="disabled" onClick={() => window.alert("Google Authenticator скоро появится")} type="black_prymary-widht">
                  <div className="flex items-center justify-center gap-[8px]">
                    <img src={GoogleSvg} alt="Google" />
                    Включить Google Authenticator
                  </div>
                </Buttons>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
