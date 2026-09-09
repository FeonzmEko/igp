export const SETTINGS_KEY = "jingxian-route-settings-v1";

export function loadSettings(key = SETTINGS_KEY, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const raw = target?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings, key = SETTINGS_KEY, storage) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target?.setItem) return false;
    target.setItem(key, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** Owns route-generation ids and AbortControllers so stale responses cannot update UI. */
export function createGenerationStore() {
  let nextId = 0;
  let active = null;

  function begin() {
    active?.controller.abort();
    const id = ++nextId;
    const controller = new AbortController();
    active = { id, controller };
    return { id, controller, signal: controller.signal };
  }

  function cancel(id = active?.id) {
    if (!active || (id !== undefined && id !== active.id)) return false;
    active.controller.abort();
    active = null;
    return true;
  }

  function isCurrent(id) {
    return Boolean(active && active.id === id && !active.controller.signal.aborted);
  }

  function finish(id) {
    if (!active || active.id !== id) return false;
    active = null;
    return true;
  }

  function signal(id = active?.id) {
    return active?.id === id ? active.controller.signal : undefined;
  }

  return {
    begin,
    cancel,
    isCurrent,
    finish,
    signal,
    get activeId() { return active?.id ?? null; },
  };
}
