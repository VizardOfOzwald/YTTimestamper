(function () {
  "use strict";

  const EXT_API =
    typeof browser !== "undefined"
      ? browser
      : typeof chrome !== "undefined"
      ? chrome
      : null;

  const ui = {
    status: document.getElementById("status"),
    openPanelBtn: document.getElementById("openPanelBtn"),
    addMarkerBtn: document.getElementById("addMarkerBtn"),
    typedTimestampInput: document.getElementById("typedTimestampInput"),
    addTypedMarkerBtn: document.getElementById("addTypedMarkerBtn"),
    startSelect: document.getElementById("startSelect"),
    endSelect: document.getElementById("endSelect"),
    jumpStartBtn: document.getElementById("jumpStartBtn"),
    jumpEndBtn: document.getElementById("jumpEndBtn"),
    toggleLoopBtn: document.getElementById("toggleLoopBtn"),
    themeColorInput: document.getElementById("themeColorInput")
  };

  let activeTabId = null;
  let snapshot = null;
  const TIMESTAMP_HELP_TEXT = "Use ss, mm:ss, or hh:mm:ss";
  const DEFAULT_THEME_COLOR = "#5865f2";

  function promisifyTabsQuery(queryInfo) {
    if (!EXT_API || !EXT_API.tabs) return Promise.resolve([]);
    if (typeof browser !== "undefined" && browser.tabs) {
      return browser.tabs.query(queryInfo);
    }
    return new Promise((resolve) => {
      EXT_API.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
    });
  }

  function sendMessageToTab(tabId, message) {
    if (!EXT_API || !EXT_API.tabs || typeof tabId !== "number") {
      return Promise.resolve(null);
    }
    if (typeof browser !== "undefined" && browser.tabs) {
      return browser.tabs.sendMessage(tabId, message).catch(() => null);
    }
    return new Promise((resolve) => {
      EXT_API.tabs.sendMessage(tabId, message, (response) => {
        resolve(response || null);
      });
    });
  }

  function isYouTubeWatchUrl(url) {
    return typeof url === "string" && url.includes("https://www.youtube.com/watch");
  }

  function setDisabled(isDisabled) {
    ui.openPanelBtn.disabled = isDisabled;
    ui.addMarkerBtn.disabled = isDisabled;
    ui.typedTimestampInput.disabled = isDisabled;
    ui.addTypedMarkerBtn.disabled = isDisabled;
    ui.startSelect.disabled = isDisabled;
    ui.endSelect.disabled = isDisabled;
    ui.jumpStartBtn.disabled = isDisabled;
    ui.jumpEndBtn.disabled = isDisabled;
    ui.toggleLoopBtn.disabled = isDisabled;
    ui.themeColorInput.disabled = isDisabled;
    refreshTypedInputValidity();
  }

  function normalizeThemeColor(value) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    return DEFAULT_THEME_COLOR;
  }

  function formatTimestampForInput(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function parseTimestampInput(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (!/^\d+(?::\d+){0,2}$/.test(raw)) return null;
    const parts = raw.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 1) {
      return parts[0];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  function sanitizeTimestampInput(value) {
    const filtered = String(value || "").replace(/[^\d:]/g, "");
    const segments = filtered.split(":");
    const limited = segments.slice(0, 3);
    return limited.join(":");
  }

  function isTimestampInputValid(value) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (!/^\d+(?::\d+){0,2}$/.test(raw)) return false;
    const parts = raw.split(":");
    if (parts.length >= 2 && parts[parts.length - 1].length > 2) return false;
    if (parts.length === 3 && parts[1].length > 2) return false;
    if (parts.length >= 2) {
      const sec = Number(parts[parts.length - 1]);
      if (!Number.isFinite(sec) || sec > 59) return false;
    }
    if (parts.length === 3) {
      const min = Number(parts[1]);
      if (!Number.isFinite(min) || min > 59) return false;
    }
    return parseTimestampInput(raw) !== null;
  }

  function refreshTypedInputValidity() {
    const canEdit = !ui.typedTimestampInput.disabled;
    const valid = isTimestampInputValid(ui.typedTimestampInput.value);
    ui.addTypedMarkerBtn.disabled = !canEdit || !valid;
    if (canEdit && ui.typedTimestampInput.value.trim() && !valid) {
      ui.status.textContent = `Invalid timestamp. ${TIMESTAMP_HELP_TEXT}.`;
    }
  }

  function fillSelect(selectEl, selectedId, markers, placeholder) {
    selectEl.innerHTML = "";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);
    for (const marker of markers) {
      const option = document.createElement("option");
      option.value = marker.id;
      option.textContent = marker.label
        ? `${marker.timeLabel} (${marker.label})`
        : marker.timeLabel;
      option.selected = marker.id === selectedId;
      selectEl.appendChild(option);
    }
  }

  function updateUiFromSnapshot() {
    if (!snapshot) return;
    const markers = snapshot.markers || [];
    fillSelect(ui.startSelect, snapshot.startMarkerId, markers, "Start marker");
    fillSelect(ui.endSelect, snapshot.endMarkerId, markers, "End marker");
    ui.status.textContent = `Markers: ${snapshot.markerCount}`;
    ui.toggleLoopBtn.textContent = snapshot.loopEnabled ? "Stop loop" : "Start loop";
    ui.jumpStartBtn.disabled = !snapshot.startMarkerId;
    ui.jumpEndBtn.disabled = !snapshot.endMarkerId;
    ui.toggleLoopBtn.disabled = !snapshot.startMarkerId || !snapshot.endMarkerId;
    ui.themeColorInput.value = normalizeThemeColor(snapshot.themeColor);
  }

  async function refreshState() {
    if (activeTabId === null) return;
    const response = await sendMessageToTab(activeTabId, { type: "YTL_GET_STATE" });
    if (!response || !response.ok) {
      ui.status.textContent = "Open a YouTube watch tab first.";
      setDisabled(true);
      return;
    }
    snapshot = response.state;
    setDisabled(false);
    updateUiFromSnapshot();
  }

  async function sendAndRefresh(message) {
    if (activeTabId === null) return;
    await sendMessageToTab(activeTabId, message);
    await refreshState();
  }

  async function init() {
    const tabs = await promisifyTabsQuery({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !isYouTubeWatchUrl(tab.url)) {
      ui.status.textContent = "Switch to a YouTube video tab.";
      setDisabled(true);
      return;
    }
    activeTabId = tab.id;
    setDisabled(false);
    await refreshState();
  }

  ui.openPanelBtn.addEventListener("click", () => sendAndRefresh({ type: "YTL_SHOW_PANEL" }));
  ui.addMarkerBtn.addEventListener("click", () => sendAndRefresh({ type: "YTL_ADD_MARKER" }));
  ui.addTypedMarkerBtn.addEventListener("click", async () => {
    const seconds = parseTimestampInput(ui.typedTimestampInput.value);
    if (seconds === null) {
      ui.status.textContent = `Invalid timestamp. ${TIMESTAMP_HELP_TEXT}.`;
      return;
    }
    await sendAndRefresh({ type: "YTL_ADD_MARKER_AT_TIME", seconds });
    ui.typedTimestampInput.value = "";
    refreshTypedInputValidity();
  });
  ui.jumpStartBtn.addEventListener("click", () => sendAndRefresh({ type: "YTL_JUMP_START" }));
  ui.jumpEndBtn.addEventListener("click", () => sendAndRefresh({ type: "YTL_JUMP_END" }));
  ui.toggleLoopBtn.addEventListener("click", () => sendAndRefresh({ type: "YTL_TOGGLE_LOOP" }));
  ui.themeColorInput.addEventListener("input", () => {
    sendAndRefresh({
      type: "YTL_SET_THEME_COLOR",
      themeColor: normalizeThemeColor(ui.themeColorInput.value)
    });
  });

  ui.startSelect.addEventListener("change", () => {
    sendAndRefresh({
      type: "YTL_SET_RANGE",
      startMarkerId: ui.startSelect.value,
      endMarkerId: ui.endSelect.value
    });
  });

  ui.endSelect.addEventListener("change", () => {
    sendAndRefresh({
      type: "YTL_SET_RANGE",
      startMarkerId: ui.startSelect.value,
      endMarkerId: ui.endSelect.value
    });
  });

  ui.typedTimestampInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    ui.addTypedMarkerBtn.click();
  });

  ui.typedTimestampInput.addEventListener("input", () => {
    const sanitized = sanitizeTimestampInput(ui.typedTimestampInput.value);
    if (sanitized !== ui.typedTimestampInput.value) {
      ui.typedTimestampInput.value = sanitized;
    }
    refreshTypedInputValidity();
  });

  ui.typedTimestampInput.addEventListener("blur", () => {
    const seconds = parseTimestampInput(ui.typedTimestampInput.value);
    if (seconds !== null) {
      ui.typedTimestampInput.value = formatTimestampForInput(seconds);
    }
    refreshTypedInputValidity();
  });

  init();
})();
