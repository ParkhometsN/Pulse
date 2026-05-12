export const ACCESS_TOKEN_KEY = "pulse_access_token";
export const USER_STORAGE_KEY = "pulse_user";

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveAuthSession(accessToken, user) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent("pulse:user-updated", { detail: user }));
}

export function saveStoredUser(user) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent("pulse:user-updated", { detail: user }));
}

export function clearAuthSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  window.dispatchEvent(new Event("pulse:user-updated"));
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}
