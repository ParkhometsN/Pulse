const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60;

const isStorageAvailable = () => typeof window !== "undefined" && window.localStorage;

export const readCachedValue = (key, maxAgeMs = DEFAULT_MAX_AGE_MS) => {
  if (!isStorageAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return null;
    }

    const cached = JSON.parse(rawValue);
    const isExpired = maxAgeMs !== Infinity && Date.now() - cached.savedAt > maxAgeMs;

    return isExpired ? null : cached.value;
  } catch {
    return null;
  }
};

export const writeCachedValue = (key, value) => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        value,
      })
    );
  } catch {
    // localStorage can be full or blocked; cache failures should never break UI.
  }
};
