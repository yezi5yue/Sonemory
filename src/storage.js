/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const KEYS = {
  pack: "sonemory.pack.v1",
  settings: "sonemory.settings.v2",
  session: "sonemory.session.v1",
  history: "sonemory.history.v1",
  progress: "sonemory.progress.v1"
};

const LEGACY_KEYS = {
  pack: ["openrecall.pack.v1"],
  settings: ["openrecall.settings.v2", "openrecall.settings.v1"],
  session: ["openrecall.session.v1"],
  history: ["openrecall.history.v1"],
  progress: ["openrecall.progress.v1"]
};

function migrateLegacyData() {
  if (typeof localStorage === "undefined") return;
  try {
    for (const [name, key] of Object.entries(KEYS)) {
      if (localStorage.getItem(key) !== null) continue;
      const legacyValue = LEGACY_KEYS[name]
        .map((legacyKey) => localStorage.getItem(legacyKey))
        .find((value) => value !== null);
      if (legacyValue !== undefined) localStorage.setItem(key, legacyValue);
    }
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

migrateLegacyData();

function read(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  getPack: () => read(KEYS.pack),
  setPack(pack) {
    write(KEYS.pack, pack);
    localStorage.removeItem(KEYS.session);
  },
  getSettings: () => read(KEYS.settings, {
    dailyCount: 5,
    retryGap: 3,
    recognitionLocale: "auto",
    voiceLocale: "en-US"
  }),
  setSettings(settings) {
    write(KEYS.settings, settings);
  },
  getSession: () => read(KEYS.session),
  setSession(session) {
    write(KEYS.session, session);
  },
  clearSession() {
    localStorage.removeItem(KEYS.session);
  },
  getHistory: () => read(KEYS.history, []),
  addHistory(entry) {
    const history = read(KEYS.history, []);
    history.unshift(entry);
    write(KEYS.history, history.slice(0, 30));
  },
  getProgress(packId) {
    return read(KEYS.progress, {})[packId] ?? { nextOffset: 0, mastery: {} };
  },
  setProgress(packId, progress) {
    const allProgress = read(KEYS.progress, {});
    allProgress[packId] = progress;
    write(KEYS.progress, allProgress);
  },
  clearAll() {
    const legacyKeys = Object.values(LEGACY_KEYS).flat();
    [...Object.values(KEYS), ...legacyKeys].forEach((key) => localStorage.removeItem(key));
  }
};
