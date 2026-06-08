import * as React from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Buttons from "../../components/UI/buttons";
import Inputs from "../../components/UI/inputs";
import LoaderAnimation from "../../components/ui/loaderAnimation";
import api from "../../lib/api";
import { clearAuthSession, getStoredUser } from "../../lib/auth";
import { getApiErrorMessage } from "../../lib/apiError";

const AI_PROVIDER_OPTIONS = [
  {
    id: "openai",
    label: "ChatGPT",
    model: "gpt-4.1-mini",
    placeholder: "OpenAI API key",
    hint: "Ключ ChatGPT используется для сводок, прогнозов и AI Trading Brain.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-chat",
    placeholder: "DeepSeek API key",
    hint: "Подготовлено для DeepSeek: ключ сохранится в базе, интеграцию можно расширять без изменения UI.",
  },
  {
    id: "anthropic",
    label: "Claude",
    model: "claude-3-5-sonnet-latest",
    placeholder: "Anthropic API key",
    hint: "Подготовлено для Claude: ключ сохранится в базе для будущего AI-провайдера.",
  },
];

const getAIProviderOption = (provider) => {
  const normalizedProvider = String(provider || "").toLowerCase();

  if (normalizedProvider === "chatgpt") {
    return AI_PROVIDER_OPTIONS[0];
  }

  return AI_PROVIDER_OPTIONS.find((item) => item.id === normalizedProvider) || AI_PROVIDER_OPTIONS[0];
};

export default function Settings() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [aiApiKey, setAiApiKey] = React.useState("");
  const [aiModel, setAiModel] = React.useState("gpt-4.1-mini");
  const [savedAISettings, setSavedAISettings] = React.useState(null);
  const [deletePassword, setDeletePassword] = React.useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isSavingSettings, setIsSavingSettings] = React.useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = React.useState(true);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [alert, setAlert] = React.useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(AI_PROVIDER_OPTIONS[0]);

  const toggleDropdown = () => setIsOpen(!isOpen);
  const savedProvider = getAIProviderOption(savedAISettings?.provider);
  const hasSelectedProviderKey = Boolean(savedAISettings?.hasApiKey && savedProvider.id === selectedProvider.id);

  const handleSelect = (option) => {
    setSelectedProvider(option);
    setAiModel(option.model);
    setIsOpen(false);
  };

  useEffect(() => {
    let isMounted = true;

    api.get("/settings/ai")
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setSavedAISettings(response.data);
        const providerOption = getAIProviderOption(response.data?.provider);
        setSelectedProvider(providerOption);
        setAiModel(response.data?.model || providerOption.model);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setAlert({
          type: "error",
          text: getApiErrorMessage(error, "Не удалось загрузить настройки AI."),
        });
      })
      .finally(() => {
        if (isMounted) {
          setIsSettingsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const saveSettings = async (event) => {
    event.preventDefault();
    setAlert(null);
    setIsSavingSettings(true);

    try {
      const response = await api.put("/settings/ai", {
        provider: selectedProvider.id,
        api_key: aiApiKey,
        model: aiModel || selectedProvider.model,
      });
      setSavedAISettings(response.data);
      setAiApiKey("");
      setAlert({ type: "success", text: response.data?.message || `Ключ ${selectedProvider.label} сохранен.` });
    } catch (error) {
      setAlert({
        type: "error",
        text: getApiErrorMessage(error, `Не удалось сохранить ключ ${selectedProvider.label}.`),
      });
    } finally {
      setIsSavingSettings(false);
    }
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
                <div className="settings_ai_key_row">
                  <div className="settings_ai_provider_select">
                    <Buttons type="nm_black_prymary" onClick={toggleDropdown}>
                      <div className="settings_ai_provider_button">
                        <p>{selectedProvider.label}</p>
                      <span
                        className={`transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : 'rotate-0'
                        }`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="1.5"
                          stroke="currentColor"
                          className="size-4"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m19.5 8.25-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      </span>
                    </div>
                    </Buttons>

                  {isOpen && (
                    <>
                        <div className="settings_ai_provider_menu">
                          {AI_PROVIDER_OPTIONS.map((option) => (
	                          <button
	                            key={option.id}
	                            type="button"
	                            onClick={() => handleSelect(option)}
                          >
                              <strong>{option.label}</strong>
                              <span>{option.model}</span>
                          </button>
                        ))}
                      </div>
                      <div
                          className="settings_ai_provider_backdrop"
                        onClick={() => setIsOpen(false)}
                      />
                    </>
                  )}
                  </div>
	                  <div className="settings_api_key">
                    {isSettingsLoading ? (
                      <div className="settings_api_hint settings_api_loading">
                        <LoaderAnimation height={34} rounded="12px" />
                        <span>Проверяем сохраненный ключ...</span>
                      </div>
                    ) : hasSelectedProviderKey ? (
                      <p className="settings_api_hint settings_api_hint_success">
                          {selectedProvider.label}: ключ подключен{savedAISettings.maskedApiKey ? `: ${savedAISettings.maskedApiKey}` : " через .env"}.
                      </p>
                    ) : (
                      <p className="settings_api_hint">
                          {selectedProvider.hint}
                      </p>
                    )}
	                  <Inputs
	                    variant="primary"
	                    type="password"
	                      placeholder={selectedProvider.placeholder}
	                    value={aiApiKey}
	                    onChange={(event) => setAiApiKey(event.target.value)}
	                  />
	                </div>
                </div>
                
                <Buttons type="primary-full" htmlType="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? "Загрузка..." : "Сохранить API"}
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
