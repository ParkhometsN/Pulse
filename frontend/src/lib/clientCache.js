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

    if (isExpired) {
      window.localStorage.removeItem(key);
      return null;
    }

    return cached.value;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore cleanup failures; cache must never break rendering.
    }

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

export const removeCachedValue = (key) => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore cleanup failures.
  }
};
