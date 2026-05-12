import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Buttons from "../../components/UI/buttons";
import Inputs from "../../components/UI/inputs";
import api from "../../lib/api";
import { clearAuthSession, getStoredUser } from "../../lib/auth";
import { getApiErrorMessage } from "../../lib/apiError";

const SETTINGS_STORAGE_KEY = "pulse:settings:v1";

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

export default function Settings() {
  const navigate = useNavigate();
  const storedSettings = readSettings();
  const user = getStoredUser();
  const [aiProvider, setAiProvider] = React.useState(storedSettings.aiProvider || "Deepseek");
  const [aiApiKey, setAiApiKey] = React.useState(storedSettings.aiApiKey || "");
  const [deletePassword, setDeletePassword] = React.useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isSavingSettings, setIsSavingSettings] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [alert, setAlert] = React.useState(null);

  const saveSettings = (event) => {
    event.preventDefault();
    setAlert(null);
    setIsSavingSettings(true);

    window.setTimeout(() => {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ aiProvider, aiApiKey })
      );
      setIsSavingSettings(false);
      setAlert({ type: "success", text: "Настройки сохранены." });
    }, 250);
  };

  const deleteAccount = async (event) => {
    event.preventDefault();
    setAlert(null);

    if (!deletePassword) {
      setAlert({ type: "error", text: "Введите пароль, чтобы удалить аккаунт." });
      return;
    }

    setIsDeleting(true);

    try {
      await api.delete("/auth/me", { data: { password: deletePassword } });
      clearAuthSession();
      navigate("/", { replace: true });
    } catch (error) {
      setAlert({
        type: "error",
        text: getApiErrorMessage(error, "Не удалось удалить аккаунт."),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="app_pages">
      <div className="app_content settingsContend">
        <div className="app_items">
          <div className="container_settings profilesett">
            <div className="content_settingsss">
              <div className="title_pages_st">
                <p>Настройки приложения</p>
                <h5>{user?.email || "Настройте приложение под себя"}</h5>
              </div>
              <div className="line"></div>
              {alert && (
                <div className={`auth_alert auth_alert_${alert.type}`}>
                  {alert.text}
                </div>
              )}
              <form className="contentSettings" onSubmit={saveSettings}>
                <div className="title_pages_stetttt">
                  <p>AI и ключи</p>
                </div>
                <div className="dinamic_buttons">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className="butBAck">
                        <Buttons type="nm_black_prymary flex items-center">
                          {aiProvider}
                          <span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
                              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                            </svg>
                          </span>
                        </Buttons>
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-32">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>AI provider</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={aiProvider} onValueChange={setAiProvider}>
                          <DropdownMenuRadioItem value="Deepseek">Deepseek</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="Chat GPT">Chat GPT</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="Claude">Claude</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="settings_api_key">
                    <Inputs
                      variant="primary"
                      type="password"
                      placeholder="API KEY"
                      value={aiApiKey}
                      onChange={(event) => setAiApiKey(event.target.value)}
                    />
                  </div>
                </div>
                <Buttons type="primary-full" htmlType="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? "Сохраняем..." : "Сохранить настройки"}
                </Buttons>
              </form>
              <div className="line"></div>
              <div className="FAQ">
                <div className="title_pages_stetttt">
                  <p>Ошибки приложения?</p>
                </div>
                <Accordion type="single" collapsible defaultValue="item-1">
                  <AccordionItem value="item-1">
                    <AccordionTrigger style={{opacity: 0.5}}>Будет ли приложение работать на моём телефоне?</AccordionTrigger>
                    <AccordionContent>
                      Да. Приложение адаптируется под любой экран: телефон, планшет или компьютер.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-2">
                    <AccordionTrigger style={{opacity: 0.5}}>Что случится, если пропадёт интернет?</AccordionTrigger>
                    <AccordionContent>
                      Уже загруженные данные останутся на экране, но для обновления котировок и новостей интернет понадобится снова.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
              <Buttons className="ewriu" type="nm_black_prymary">
                <a href="mailto:parkhometsniktia@gmail.com">Написать тикет</a>
              </Buttons>
              <div className="deleteAccount">
                {!showDeleteConfirm ? (
                  <Buttons onClick={() => setShowDeleteConfirm(true)} type="primary-danger">
                    Удалить аккаунт
                  </Buttons>
                ) : (
                  <form className="delete_account_form" onSubmit={deleteAccount}>
                    <p>Это действие удалит аккаунт и связанные данные. Введите пароль для подтверждения.</p>
                    <Inputs
                      variant="primary"
                      type="password"
                      placeholder="Пароль"
                      value={deletePassword}
                      onChange={(event) => setDeletePassword(event.target.value)}
                    />
                    <div className="delete_account_actions">
                      <Buttons type="black_prymary-widht" onClick={() => setShowDeleteConfirm(false)}>
                        Отмена
                      </Buttons>
                      <Buttons type="primary-danger" htmlType="submit" disabled={isDeleting}>
                        {isDeleting ? "Удаляем..." : "Удалить навсегда"}
                      </Buttons>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
