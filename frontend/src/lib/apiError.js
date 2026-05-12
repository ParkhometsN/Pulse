const FIELD_LABELS = {
  email: "Почта",
  password: "Пароль",
  password_confirm: "Повтор пароля",
  first_name: "Имя",
  last_name: "Фамилия",
  code: "Код",
};

const MESSAGE_LABELS = {
  "Field required": "обязательное поле",
  "String should have at least 8 characters": "минимум 8 символов",
  "String should have at most 128 characters": "слишком длинное значение",
  "String should have at most 255 characters": "слишком длинное значение",
};

function normalizeValidationMessage(errorItem) {
  const field = Array.isArray(errorItem?.loc)
    ? errorItem.loc[errorItem.loc.length - 1]
    : null;
  const fieldLabel = FIELD_LABELS[field] || field || "Поле";
  const message = MESSAGE_LABELS[errorItem?.msg] || errorItem?.msg || "заполнено неверно";

  return `${fieldLabel}: ${message}`;
}

export function getApiErrorMessage(error, fallback = "Что-то пошло не так.") {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail.map(normalizeValidationMessage).join(". ");
  }

  if (detail && typeof detail === "object") {
    return detail.message || fallback;
  }

  return error?.message || fallback;
}
