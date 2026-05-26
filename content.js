(function () {
  "use strict";

  const ROOT_ID = "yt-timestamp-looper-root";
  const STORAGE_KEY = "ytTimestampLooperData";
  const SETTINGS_KEY = "ytTimestampLooperSettings";
  const LOOP_THRESHOLD_SECONDS = 0.18;
  const DEFAULT_THEME_COLOR = "#5865f2";
  const EXT_API =
    typeof browser !== "undefined"
      ? browser
      : typeof chrome !== "undefined"
      ? chrome
      : null;

  let videoElement = null;
  let currentVideoId = null;
  function createEmptyJumpModule() {
    return { fromMarkerId: "", toMarkerId: "" };
  }

  let state = {
    markers: [],
    loopEnabled: false,
    startMarkerId: "",
    endMarkerId: "",
    minimized: false,
    fullyHidden: false,
    themeColor: DEFAULT_THEME_COLOR,
    clickAddMode: false,
    autoJumpEnabled: false,
    jumpModules: [createEmptyJumpModule()]
  };
  let ui = {};
  let saveTimer = null;
  let autoHideTimer = null;
  let mountedForPath = "";
  let previousVideoTime = 0;
  const MIN_AUTO_HIDE_SECONDS = 3;
  const MAX_AUTO_HIDE_SECONDS = 120;

  function createId() {
    return `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  function parseVideoId() {
    const url = new URL(window.location.href);
    return url.searchParams.get("v") || "";
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function getVideoElement() {
    const video = document.querySelector("video");
    return video instanceof HTMLVideoElement ? video : null;
  }

  function storageGet(keys) {
    if (!EXT_API || !EXT_API.storage || !EXT_API.storage.local) {
      return Promise.resolve({});
    }
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      return browser.storage.local.get(keys);
    }
    return new Promise((resolve, reject) => {
      try {
        EXT_API.storage.local.get(keys, (result) => {
          const runtimeError =
            EXT_API.runtime && EXT_API.runtime.lastError
              ? EXT_API.runtime.lastError
              : null;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    if (!EXT_API || !EXT_API.storage || !EXT_API.storage.local) {
      return Promise.resolve();
    }
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      return browser.storage.local.set(value);
    }
    return new Promise((resolve, reject) => {
      try {
        EXT_API.storage.local.set(value, () => {
          const runtimeError =
            EXT_API.runtime && EXT_API.runtime.lastError
              ? EXT_API.runtime.lastError
              : null;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function normalizeThemeColor(value) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
      return raw.toLowerCase();
    }
    return DEFAULT_THEME_COLOR;
  }

  function hexToRgb(hex) {
    const normalized = normalizeThemeColor(hex);
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    return { r, g, b };
  }

  function applyThemeColorToRoot() {
    if (!ui.root) return;
    const color = normalizeThemeColor(state.themeColor);
    const { r, g, b } = hexToRgb(color);
    ui.root.style.setProperty("--ytl-accent", color);
    ui.root.style.setProperty("--ytl-accent-border", `rgba(${r}, ${g}, ${b}, 0.75)`);
    ui.root.style.setProperty("--ytl-accent-soft", `rgba(${r}, ${g}, ${b}, 0.24)`);
  }

  function scheduleSave() {
    if (!currentVideoId) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(async () => {
      const stored = await storageGet([STORAGE_KEY]);
      const data = stored[STORAGE_KEY] || {};
      data[currentVideoId] = {
        markers: state.markers,
        minimized: state.minimized,
        fullyHidden: state.fullyHidden,
        jumpModules: state.jumpModules
      };
      await storageSet({
        [STORAGE_KEY]: data,
        [SETTINGS_KEY]: { themeColor: state.themeColor }
      });
    }, 150);
  }

  async function loadStateForVideo(videoId) {
    const stored = await storageGet([STORAGE_KEY, SETTINGS_KEY]);
    const data = stored[STORAGE_KEY] || {};
    const settings = stored[SETTINGS_KEY] || {};
    const record = data[videoId] || {};
    const markers = Array.isArray(record.markers) ? record.markers : [];
    const savedJumpModules = Array.isArray(record.jumpModules)
      ? record.jumpModules
          .map((moduleState) => ({
            fromMarkerId:
              typeof moduleState?.fromMarkerId === "string"
                ? moduleState.fromMarkerId
                : typeof moduleState?.startMarkerId === "string"
                ? moduleState.startMarkerId
                : "",
            toMarkerId:
              typeof moduleState?.toMarkerId === "string"
                ? moduleState.toMarkerId
                : typeof moduleState?.endMarkerId === "string"
                ? moduleState.endMarkerId
                : ""
          }))
          .filter((moduleState) => moduleState.fromMarkerId || moduleState.toMarkerId)
      : [];
    const jumpModules = savedJumpModules.length > 0 ? savedJumpModules : [createEmptyJumpModule()];
    state = {
      markers: markers
        .filter((m) => typeof m.time === "number" && Number.isFinite(m.time))
        .map((m) => ({
          id: typeof m.id === "string" ? m.id : createId(),
          time: m.time,
          label: typeof m.label === "string" ? m.label : ""
        }))
        .sort((a, b) => a.time - b.time),
      loopEnabled: false,
      startMarkerId: "",
      endMarkerId: "",
      minimized: Boolean(record.minimized),
      fullyHidden: Boolean(record.fullyHidden),
      themeColor: normalizeThemeColor(settings.themeColor),
      clickAddMode: false,
      autoJumpEnabled: false,
      jumpModules
    };
    previousVideoTime = 0;
  }

  function findMarkerById(id) {
    return state.markers.find((m) => m.id === id) || null;
  }

  function getSelectedRange() {
    const start = findMarkerById(state.startMarkerId);
    const end = findMarkerById(state.endMarkerId);
    if (!start || !end) return null;
    if (start.time >= end.time) return null;
    return { start, end };
  }

  function getJumpModuleRange(moduleIndex) {
    const moduleState = state.jumpModules[moduleIndex];
    if (!moduleState) return null;
    const from = findMarkerById(moduleState.fromMarkerId);
    const to = findMarkerById(moduleState.toMarkerId);
    if (!from || !to) return null;
    if (from.id === to.id) return null;
    return { from, to, moduleIndex };
  }

  function getValidJumpModules() {
    return state.jumpModules
      .map((_, index) => getJumpModuleRange(index))
      .filter((range) => Boolean(range));
  }

  function onVideoTimeUpdate() {
    if (!videoElement) return;
    const currentTime = videoElement.currentTime;

    if (state.loopEnabled) {
      const range = getSelectedRange();
      if (range && currentTime >= range.end.time - LOOP_THRESHOLD_SECONDS) {
        videoElement.currentTime = range.start.time;
        if (videoElement.paused) {
          videoElement.play().catch(() => {});
        }
      }
    }

    if (!state.autoJumpEnabled) return;
    const validModules = getValidJumpModules();
    if (validModules.length === 0) {
      state.autoJumpEnabled = false;
      render();
      return;
    }

    const crossedRules = validModules
      .filter(
        (rule) =>
          previousVideoTime < rule.from.time - LOOP_THRESHOLD_SECONDS &&
          currentTime >= rule.from.time - LOOP_THRESHOLD_SECONDS
      )
      .sort((a, b) => a.from.time - b.from.time);

    const firstRule = crossedRules[0];
    if (firstRule) {
      videoElement.currentTime = firstRule.to.time;
      if (videoElement.paused) {
        videoElement.play().catch(() => {});
      }
      previousVideoTime = firstRule.to.time;
      render();
      return;
    }

    previousVideoTime = currentTime;
  }

  function setDefaultRangeIfPossible() {
    if (state.markers.length < 2) {
      state.startMarkerId = "";
      state.endMarkerId = "";
      state.loopEnabled = false;
      return;
    }
    if (!findMarkerById(state.startMarkerId)) {
      state.startMarkerId = state.markers[0].id;
    }
    if (!findMarkerById(state.endMarkerId)) {
      state.endMarkerId = state.markers[1].id;
    }
    const range = getSelectedRange();
    if (!range) {
      state.startMarkerId = state.markers[0].id;
      state.endMarkerId = state.markers[state.markers.length - 1].id;
    }

    for (const moduleState of state.jumpModules) {
      if (!findMarkerById(moduleState.fromMarkerId)) {
        moduleState.fromMarkerId = "";
      }
      if (!findMarkerById(moduleState.toMarkerId)) {
        moduleState.toMarkerId = "";
      }
    }
  }

  function addMarkerAtTime(rawTime) {
    if (!videoElement || !Number.isFinite(rawTime)) return;
    const clampedTime = Math.max(0, Math.min(videoElement.duration || rawTime, rawTime));
    const existingNear = state.markers.find(
      (m) => Math.abs(m.time - clampedTime) < 0.4
    );
    if (existingNear) return;
    state.markers.push({
      id: createId(),
      time: Number(clampedTime.toFixed(2)),
      label: ""
    });
    state.markers.sort((a, b) => a.time - b.time);
    setDefaultRangeIfPossible();
    scheduleSave();
    render();
  }

  function addMarkerAtCurrentTime() {
    if (!videoElement) return;
    addMarkerAtTime(videoElement.currentTime);
  }

  function removeMarker(markerId) {
    state.markers = state.markers.filter((m) => m.id !== markerId);
    setDefaultRangeIfPossible();
    scheduleSave();
    render();
  }

  function jumpToMarker(markerId) {
    const marker = findMarkerById(markerId);
    if (!marker || !videoElement) return;
    videoElement.currentTime = marker.time;
    videoElement.play().catch(() => {});
  }

  function jumpToStartMarker() {
    if (!state.startMarkerId) return;
    jumpToMarker(state.startMarkerId);
  }

  function jumpToEndMarker() {
    if (!state.endMarkerId) return;
    jumpToMarker(state.endMarkerId);
  }

  function updateMarkerLabel(markerId, label) {
    const marker = findMarkerById(markerId);
    if (!marker) return;
    marker.label = label.trim();
    scheduleSave();
  }

  function clearAutoHideTimer() {
    if (!autoHideTimer) return;
    window.clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  function setFullyHidden(hidden) {
    state.fullyHidden = Boolean(hidden);
    if (!ui.root) return;
    ui.root.classList.toggle("ytl-fully-hidden", state.fullyHidden);
  }

  function normalizeAutoHideSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return MIN_AUTO_HIDE_SECONDS;
    return Math.min(MAX_AUTO_HIDE_SECONDS, Math.max(MIN_AUTO_HIDE_SECONDS, Math.floor(parsed)));
  }

  function scheduleAutoHide() {
    clearAutoHideTimer();
    if (!ui.root) return;
    if (state.fullyHidden) return;
    if (state.minimized) {
      autoHideTimer = window.setTimeout(() => {
        setFullyHidden(true);
      }, 8 * 1000);
      return;
    }
    autoHideTimer = window.setTimeout(() => {
      state.minimized = true;
      scheduleSave();
      render();
    }, 8 * 1000);
  }

  function onPanelInteraction() {
    if (state.fullyHidden) return;
    scheduleAutoHide();
  }

  function setThemeColor(rawColor) {
    state.themeColor = normalizeThemeColor(rawColor);
    scheduleSave();
    render();
  }

  function toggleMinimize() {
    state.minimized = !state.minimized;
    if (!state.minimized) {
      setFullyHidden(false);
    }
    scheduleSave();
    render();
  }

  function clearAllMarkers() {
    state.markers = [];
    state.loopEnabled = false;
    state.autoJumpEnabled = false;
    state.startMarkerId = "";
    state.endMarkerId = "";
    state.jumpModules = [createEmptyJumpModule()];
    previousVideoTime = 0;
    scheduleSave();
    render();
  }

  function updateJumpModule(moduleIndex, part, markerId) {
    const moduleState = state.jumpModules[moduleIndex];
    if (!moduleState) return;
    moduleState[part] = markerId || "";
    const validModules = getValidJumpModules();
    if (validModules.length === 0) {
      state.autoJumpEnabled = false;
    }
    previousVideoTime = videoElement ? videoElement.currentTime : 0;
    scheduleSave();
    render();
  }

  function addJumpModule() {
    state.jumpModules.push(createEmptyJumpModule());
    scheduleSave();
    render();
  }

  function removeJumpModule(moduleIndex) {
    if (state.jumpModules.length <= 1) return;
    state.jumpModules.splice(moduleIndex, 1);
    const validModules = getValidJumpModules();
    if (validModules.length === 0) {
      state.autoJumpEnabled = false;
    }
    previousVideoTime = videoElement ? videoElement.currentTime : 0;
    scheduleSave();
    render();
  }

  function toggleAutoJumpEnabled() {
    const validModules = getValidJumpModules();
    if (validModules.length === 0) return;
    state.autoJumpEnabled = !state.autoJumpEnabled;
    previousVideoTime = videoElement ? videoElement.currentTime : 0;
    render();
  }

  function toggleClickAddMode() {
    state.clickAddMode = !state.clickAddMode;
    render();
  }

  function buildUI() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();

    const root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "YouTube timestamp looper panel");

    const header = document.createElement("div");
    header.className = "ytl-header";

    const title = document.createElement("div");
    title.className = "ytl-title";
    title.textContent = "Timestamp Looper";

    const miniBtn = document.createElement("button");
    miniBtn.className = "ytl-minimize-btn";
    miniBtn.type = "button";
    miniBtn.textContent = state.minimized ? "Open" : "Hide";
    miniBtn.addEventListener("click", toggleMinimize);

    header.append(title, miniBtn);

    const content = document.createElement("div");
    content.className = "ytl-content";

    const row1 = document.createElement("div");
    row1.className = "ytl-row";
    const addBtn = document.createElement("button");
    addBtn.className = "ytl-btn";
    addBtn.type = "button";
    addBtn.textContent = "Add marker";
    addBtn.addEventListener("click", addMarkerAtCurrentTime);
    const clearBtn = document.createElement("button");
    clearBtn.className = "ytl-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear all";
    clearBtn.addEventListener("click", clearAllMarkers);
    row1.append(addBtn, clearBtn);

    const startSelect = document.createElement("select");
    startSelect.className = "ytl-select";
    startSelect.addEventListener("change", (e) => {
      state.startMarkerId = e.target.value;
      const range = getSelectedRange();
      state.loopEnabled = Boolean(range && state.loopEnabled);
      render();
    });

    const endSelect = document.createElement("select");
    endSelect.className = "ytl-select";
    endSelect.addEventListener("change", (e) => {
      state.endMarkerId = e.target.value;
      const range = getSelectedRange();
      state.loopEnabled = Boolean(range && state.loopEnabled);
      render();
    });

    const row2 = document.createElement("div");
    row2.className = "ytl-row";
    row2.append(startSelect);

    const row3 = document.createElement("div");
    row3.className = "ytl-row";
    row3.append(endSelect);

    const row4 = document.createElement("div");
    row4.className = "ytl-row";
    const loopBtn = document.createElement("button");
    loopBtn.className = "ytl-btn";
    loopBtn.type = "button";
    loopBtn.textContent = "Start loop";
    loopBtn.addEventListener("click", () => {
      const range = getSelectedRange();
      if (!range) return;
      state.loopEnabled = !state.loopEnabled;
      if (state.loopEnabled && videoElement) {
        videoElement.currentTime = range.start.time;
        videoElement.play().catch(() => {});
      }
      render();
    });
    row4.append(loopBtn);

    const row5 = document.createElement("div");
    row5.className = "ytl-row";
    const jumpFromBtn = document.createElement("button");
    jumpFromBtn.className = "ytl-btn";
    jumpFromBtn.type = "button";
    jumpFromBtn.textContent = "Jump to start";
    jumpFromBtn.addEventListener("click", jumpToStartMarker);
    const jumpToBtn = document.createElement("button");
    jumpToBtn.className = "ytl-btn";
    jumpToBtn.type = "button";
    jumpToBtn.textContent = "Jump to end";
    jumpToBtn.addEventListener("click", jumpToEndMarker);
    row5.append(jumpFromBtn, jumpToBtn);

    const row6 = document.createElement("div");
    row6.className = "ytl-row";
    const clickModeBtn = document.createElement("button");
    clickModeBtn.className = "ytl-btn";
    clickModeBtn.type = "button";
    clickModeBtn.textContent = "Timeline click add: Off";
    clickModeBtn.addEventListener("click", toggleClickAddMode);
    row6.append(clickModeBtn);

    const jumpTimelineWrap = document.createElement("div");
    jumpTimelineWrap.className = "ytl-markers";
    const jumpTimelineMeta = document.createElement("div");
    jumpTimelineMeta.className = "ytl-meta";
    jumpTimelineMeta.textContent = "Auto Jump Timeline";
    jumpTimelineWrap.appendChild(jumpTimelineMeta);

    const jumpModulesContainer = document.createElement("div");
    jumpTimelineWrap.appendChild(jumpModulesContainer);

    const jumpModuleActionRow = document.createElement("div");
    jumpModuleActionRow.className = "ytl-row";
    const addJumpModuleBtn = document.createElement("button");
    addJumpModuleBtn.className = "ytl-btn";
    addJumpModuleBtn.type = "button";
    addJumpModuleBtn.textContent = "Add jump module";
    addJumpModuleBtn.addEventListener("click", addJumpModule);
    jumpModuleActionRow.append(addJumpModuleBtn);
    jumpTimelineWrap.appendChild(jumpModuleActionRow);

    const jumpControlRow = document.createElement("div");
    jumpControlRow.className = "ytl-row";
    const autoJumpBtn = document.createElement("button");
    autoJumpBtn.className = "ytl-btn";
    autoJumpBtn.type = "button";
    autoJumpBtn.textContent = "Start auto jump";
    autoJumpBtn.addEventListener("click", toggleAutoJumpEnabled);
    jumpControlRow.append(autoJumpBtn);
    jumpTimelineWrap.appendChild(jumpControlRow);

    const meta = document.createElement("div");
    meta.className = "ytl-meta";

    const markersWrap = document.createElement("div");
    markersWrap.className = "ytl-markers";

    content.append(
      row1,
      row2,
      row3,
      row4,
      row5,
      row6,
      jumpTimelineWrap,
      meta,
      markersWrap
    );

    root.append(header, content);
    if (state.minimized) {
      root.classList.add("ytl-hidden");
    }

    document.body.appendChild(root);

    ui = {
      root,
      miniBtn,
      startSelect,
      endSelect,
      loopBtn,
      jumpFromBtn,
      jumpToBtn,
      clickModeBtn,
      jumpModulesContainer,
      addJumpModuleBtn,
      autoJumpBtn,
      meta,
      markersWrap
    };

    root.addEventListener("pointerdown", onPanelInteraction, { passive: true });
    root.addEventListener("focusin", onPanelInteraction);
    root.addEventListener("input", onPanelInteraction);
  }

  function fillMarkerSelect(selectEl, selectedId, placeholder) {
    selectEl.innerHTML = "";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);
    for (const marker of state.markers) {
      const option = document.createElement("option");
      option.value = marker.id;
      const suffix = marker.label ? ` (${marker.label})` : "";
      option.textContent = `${formatTime(marker.time)}${suffix}`;
      if (marker.id === selectedId) option.selected = true;
      selectEl.appendChild(option);
    }
  }

  function renderMarkersList() {
    ui.markersWrap.innerHTML = "";
    for (const marker of state.markers) {
      const item = document.createElement("div");
      item.className = "ytl-marker-item";

      const jumpBtn = document.createElement("button");
      jumpBtn.className = "ytl-btn";
      jumpBtn.type = "button";
      jumpBtn.textContent = formatTime(marker.time);
      jumpBtn.addEventListener("click", () => jumpToMarker(marker.id));

      const labelInput = document.createElement("input");
      labelInput.className = "ytl-input";
      labelInput.type = "text";
      labelInput.placeholder = "Optional label";
      labelInput.value = marker.label;
      labelInput.addEventListener("change", (e) => {
        updateMarkerLabel(marker.id, e.target.value);
        render();
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "ytl-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "Delete";
      removeBtn.addEventListener("click", () => removeMarker(marker.id));

      item.append(jumpBtn, labelInput, removeBtn);
      ui.markersWrap.appendChild(item);
    }
  }

  function renderJumpModuleRows() {
    ui.jumpModulesContainer.innerHTML = "";
    for (let i = 0; i < state.jumpModules.length; i += 1) {
      const moduleState = state.jumpModules[i];

      const row = document.createElement("div");
      row.className = "ytl-row";

      const startSelect = document.createElement("select");
      startSelect.className = "ytl-select";
      startSelect.addEventListener("change", (event) => {
        updateJumpModule(i, "fromMarkerId", event.target.value);
      });
      fillMarkerSelect(startSelect, moduleState.fromMarkerId, `Jump ${i + 1} from`);

      const endSelect = document.createElement("select");
      endSelect.className = "ytl-select";
      endSelect.addEventListener("change", (event) => {
        updateJumpModule(i, "toMarkerId", event.target.value);
      });
      fillMarkerSelect(endSelect, moduleState.toMarkerId, `Jump ${i + 1} to`);

      const removeBtn = document.createElement("button");
      removeBtn.className = "ytl-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.disabled = state.jumpModules.length <= 1;
      removeBtn.addEventListener("click", () => removeJumpModule(i));

      row.append(startSelect, endSelect, removeBtn);
      ui.jumpModulesContainer.appendChild(row);
    }
  }

  function render() {
    if (!ui.root) return;
    applyThemeColorToRoot();
    if (state.minimized) {
      ui.root.classList.add("ytl-hidden");
    } else {
      ui.root.classList.remove("ytl-hidden");
    }
    setFullyHidden(state.fullyHidden);
    ui.miniBtn.textContent = state.minimized ? "Open" : "Hide";

    fillMarkerSelect(ui.startSelect, state.startMarkerId, "Start marker");
    fillMarkerSelect(ui.endSelect, state.endMarkerId, "End marker");

    const range = getSelectedRange();
    if (!range) {
      state.loopEnabled = false;
    }
    ui.loopBtn.disabled = !range;
    ui.loopBtn.textContent = state.loopEnabled ? "Stop loop" : "Start loop";
    ui.jumpFromBtn.disabled = !findMarkerById(state.startMarkerId);
    ui.jumpToBtn.disabled = !findMarkerById(state.endMarkerId);
    ui.clickModeBtn.textContent = `Timeline click add: ${state.clickAddMode ? "On" : "Off"}`;

    const validJumpModules = getValidJumpModules();
    if (validJumpModules.length === 0) {
      state.autoJumpEnabled = false;
    }
    ui.autoJumpBtn.disabled = validJumpModules.length === 0;
    ui.autoJumpBtn.textContent = state.autoJumpEnabled ? "Stop auto jump" : "Start auto jump";

    renderJumpModuleRows();

    if (range) {
      ui.meta.textContent = `Looping range: ${formatTime(range.start.time)} -> ${formatTime(
        range.end.time
      )} | Timeline click add: ${state.clickAddMode ? "On" : "Off"} | Auto jumps: ${
        state.autoJumpEnabled ? "On" : "Off"
      }`;
    } else if (state.markers.length >= 2) {
      ui.meta.textContent = `Select a valid range (start must be before end). Timeline click add: ${
        state.clickAddMode ? "On" : "Off"
      } | Auto jumps: ${state.autoJumpEnabled ? "On" : "Off"}`;
    } else {
      ui.meta.textContent = `Add at least two markers to loop. Timeline click add: ${
        state.clickAddMode ? "On" : "Off"
      } | Auto jumps: ${state.autoJumpEnabled ? "On" : "Off"}`;
    }

    renderMarkersList();
    scheduleAutoHide();
  }

  function attachVideoListeners(video) {
    video.removeEventListener("timeupdate", onVideoTimeUpdate);
    video.addEventListener("timeupdate", onVideoTimeUpdate, { passive: true });
  }

  function onDocumentClickCapture(event) {
    if (!state.clickAddMode || !videoElement) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const timeline = target.closest(".ytp-progress-bar, .ytp-progress-bar-container");
    if (!timeline) return;
    window.setTimeout(() => {
      addMarkerAtCurrentTime();
    }, 0);
  }

  function getSnapshot() {
    return {
      videoId: currentVideoId,
      markerCount: state.markers.length,
      loopEnabled: state.loopEnabled,
      startMarkerId: state.startMarkerId,
      endMarkerId: state.endMarkerId,
      markers: state.markers.map((marker) => ({
        id: marker.id,
        time: marker.time,
        timeLabel: formatTime(marker.time),
        label: marker.label
      })),
      autoJumpEnabled: state.autoJumpEnabled,
      themeColor: state.themeColor,
      jumpModules: state.jumpModules
    };
  }

  function setRangeFromMessage(startMarkerId, endMarkerId) {
    state.startMarkerId = startMarkerId || "";
    state.endMarkerId = endMarkerId || "";
    const range = getSelectedRange();
    if (!range) {
      state.loopEnabled = false;
    }
    render();
  }

  function setupMessageBridge() {
    if (!EXT_API || !EXT_API.runtime || !EXT_API.runtime.onMessage) return;
    EXT_API.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return;
      if (message.type === "YTL_GET_STATE") {
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_ADD_MARKER") {
        addMarkerAtCurrentTime();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_ADD_MARKER_AT_TIME") {
        addMarkerAtTime(Number(message.seconds));
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_SET_THEME_COLOR") {
        setThemeColor(message.themeColor);
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_TOGGLE_LOOP") {
        const range = getSelectedRange();
        if (range) {
          state.loopEnabled = !state.loopEnabled;
          if (state.loopEnabled && videoElement) {
            videoElement.currentTime = range.start.time;
            videoElement.play().catch(() => {});
          }
        }
        render();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_TOGGLE_AUTO_JUMP") {
        toggleAutoJumpEnabled();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_SET_RANGE") {
        setRangeFromMessage(message.startMarkerId, message.endMarkerId);
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_JUMP_START") {
        jumpToStartMarker();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_JUMP_END") {
        jumpToEndMarker();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_SHOW_PANEL") {
        state.minimized = false;
        setFullyHidden(false);
        render();
        onPanelInteraction();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
      if (message.type === "YTL_HIDE_PANEL") {
        setFullyHidden(true);
        render();
        sendResponse({ ok: true, state: getSnapshot() });
        return;
      }
    });
  }

  async function mountForCurrentVideo() {
    const videoId = parseVideoId();
    const video = getVideoElement();
    if (!videoId || !video) return;

    const wasFullyHidden = state.fullyHidden;
    
    currentVideoId = videoId;
    videoElement = video;
    await loadStateForVideo(videoId);
    previousVideoTime = video.currentTime || 0;
    setDefaultRangeIfPossible();
    buildUI();
    render();
    attachVideoListeners(videoElement);
    
    if (wasFullyHidden) {
      setFullyHidden(true);
    }
  }

  async function refreshWhenNavigationChanges() {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath === mountedForPath) return;
    mountedForPath = currentPath;
    await mountForCurrentVideo();
  }

  function init() {
    if (!window.location.href.includes("youtube.com/watch")) return;

    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      await refreshWhenNavigationChanges();
      if (ui.root || attempts > 40) {
        clearInterval(timer);
      }
    }, 250);

    const observer = new MutationObserver(() => {
      refreshWhenNavigationChanges().catch(() => {});
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true
    });
    document.addEventListener("click", onDocumentClickCapture, true);
    setupMessageBridge();
  }

  init();
})();
