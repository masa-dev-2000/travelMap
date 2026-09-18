const firebaseConfig = {
  apiKey: "AIzaSyBtUbgKYgFwrQmES7rmZSCN0TaAV3aPKKI",
  authDomain: "sharetravelinfolikedq.firebaseapp.com",
  projectId: "sharetravelinfolikedq"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const categoriesCollectionRef = db.collection("categories");

const createRateLimitedFetch = (intervalMs = 1500) => {
  let lastTime = 0;
  let queue = Promise.resolve();
  return (url, options) => {
    const run = queue.then(async () => {
      const elapsed = Date.now() - lastTime;
      const wait = Math.max(0, intervalMs - elapsed);
      if (wait) {
        await new Promise(resolve => setTimeout(resolve, wait));
      }
      lastTime = Date.now();
      return fetch(url, options);
    });
    queue = run.catch(() => {});
    return run;
  };
};

const rateLimitedFetch = createRateLimitedFetch(1500);

const toJsDate = (value) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toNumber = (value) => {
  if (typeof value === "number") return value;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : NaN;
};

const DEFAULT_CATEGORY_SETTINGS = {
  食費: { color: '#e74c3c' },
  交通費: { color: '#3498db' },
  作業: { color: '#2ecc71' },
  温泉: { color: '#e67e22' },
  観光費: { color: '#9b59b6' },
  買い物: { color: '#ff1493' },
  宿泊費: { color: '#1abc9c' },
  その他: { color: '#bdc3c7' },
  起床: { color: '#fffb96' },
  就寝: { color: '#6c5ce7' },
  給油: { color: '#f1c40f' }
};
const HIDDEN_MARKER_CATEGORIES = new Set(["移動"]);
let categoryColors = { ...DEFAULT_CATEGORY_SETTINGS };

const getCategoryEntries = () => {
  const entries = Object.entries(categoryColors);
  if (entries.length) return entries;
  return Object.entries(DEFAULT_CATEGORY_SETTINGS);
};

const getCategoryColor = (category) => {
  return categoryColors[category]?.color || DEFAULT_CATEGORY_SETTINGS[category]?.color || "#999";
};

const buildLegendHtml = () => {
  let html = "<b>カテゴリ凡例</b><br>";
  getCategoryEntries().forEach(([name, config]) => {
    html += `<i style="background:${config.color};width:12px;height:12px;display:inline-block;margin-right:6px;"></i>${name}<br>`;
  });
  return html;
};

const map = L.map("map", { zoomControl: false }).setView([35.6812, 139.7671], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
L.control.zoom({ position: "bottomright" }).addTo(map);

const latestMarkerIcon = L.icon({
  iconUrl: "generated-icon.png",
  iconSize: [72, 72],
  iconAnchor: [36, 58],
  popupAnchor: [0, -50],
  className: "latest-marker-icon"
});

const legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "info legend");
  div.innerHTML = buildLegendHtml();
  return div;
};
const updateLegendContent = () => {
  const legendEl = document.querySelector(".info.legend");
  if (legendEl) {
    legendEl.innerHTML = buildLegendHtml();
  }
};
window.addEventListener("load", () => {
  setTimeout(() => map.invalidateSize(), 800);
});

const rangeDescription = document.getElementById("rangeDescription");
const categoryFilter = document.getElementById("categoryFilter");
const rangeQuickButtons = document.querySelectorAll("[data-range-shortcut]");
const legendToggle = document.getElementById("legendToggle");

const statsCategoryFilterEl = document.getElementById("statsCategoryFilter");
const statsQuickRangeButtons = document.querySelectorAll("[data-stats-range]");
const statsRangeDescription = document.getElementById("statsRangeDescription");
const statsMetricsEl = document.getElementById("statsMetrics");
const dailyChartCanvas = document.getElementById("dailyChart");
const expenseChartCanvas = document.getElementById("expenseChart");
const statsTabs = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll(".tab-panel");
const mainTabButtons = document.querySelectorAll("[data-main-tab]");
const mainTabPanels = document.querySelectorAll(".main-tab-panel");

const budgetMonthLabel = document.getElementById("budgetMonthLabel");
const budgetPrevBtn = document.getElementById("budgetPrevMonth");
const budgetNextBtn = document.getElementById("budgetNextMonth");
const budgetListEl = document.getElementById("budgetList");
const budgetSummaryEl = document.getElementById("budgetSummary");

const prophecyContentEl = document.getElementById("prophecyContent");
const investmentSummaryEl = document.getElementById("investmentSummary");
const investmentTopListEl = document.getElementById("investmentTopList");

const floatingWindows = {};
document.querySelectorAll(".floating-window").forEach(win => {
  floatingWindows[win.id] = win;
});

const updateViewportClass = () => {
  const isPortrait = window.innerHeight >= window.innerWidth;
  const narrowSide = Math.min(window.innerWidth, window.innerHeight);
  const shouldMobile = isPortrait && narrowSide < 900;
  document.body.classList.toggle("is-mobile-portrait", shouldMobile);
};

updateViewportClass();
window.addEventListener("resize", updateViewportClass);
window.addEventListener("orientationchange", updateViewportClass);

const initializeWindowPosition = (win) => {
  if (!win || win.dataset.initialized === "true") return;
  const defaultTop = Number(win.dataset.defaultTop);
  const topValue = Number.isFinite(defaultTop) ? defaultTop : 0;
  win.style.top = `${topValue}px`;
  win.style.left = "50%";
  win.style.transform = "translateX(-50%)";
  win.dataset.initialized = "true";
  win.dataset.freePosition = "false";
};

const ensureWindowFreePosition = (win, rect) => {
  if (!win) return rect;
  if (win.dataset.freePosition === "true") return rect;
  const parentRect = win.offsetParent?.getBoundingClientRect();
  const offsetLeft = rect.left - (parentRect?.left || 0);
  const offsetTop = rect.top - (parentRect?.top || 0);
  win.style.left = `${offsetLeft}px`;
  win.style.top = `${offsetTop}px`;
  win.style.transform = "none";
  win.dataset.freePosition = "true";
  return win.getBoundingClientRect();
};

Object.values(floatingWindows).forEach(win => initializeWindowPosition(win));

let highestWindowZ = 1400;
let dragState = null;

const bringToFront = (win) => {
  highestWindowZ += 1;
  win.style.zIndex = highestWindowZ;
};

const setWindowVisibility = (id, open) => {
  const win = floatingWindows[id];
  if (!win) return;
  if (open) {
    initializeWindowPosition(win);
    win.classList.add("open");
    win.setAttribute("aria-hidden", "false");
    bringToFront(win);
  } else {
    win.classList.remove("open");
    win.setAttribute("aria-hidden", "true");
  }
};

document.querySelectorAll("[data-window-target]").forEach(btn => {
  btn.addEventListener("click", () => setWindowVisibility(btn.dataset.windowTarget, true));
});
document.querySelectorAll("[data-close-target]").forEach(btn => {
  btn.addEventListener("click", () => setWindowVisibility(btn.dataset.closeTarget, false));
});

const startDrag = (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const header = event.currentTarget;
  const closeButton = header.querySelector(".window-close");
  if (closeButton && closeButton.contains(event.target)) return;
  const win = header.closest(".floating-window");
  if (!win) return;
  bringToFront(win);
  let rect = win.getBoundingClientRect();
  rect = ensureWindowFreePosition(win, rect);
  const parentRect = win.offsetParent?.getBoundingClientRect();
  const currentLeft = parseFloat(win.style.left);
  const currentTop = parseFloat(win.style.top);
  const startLeft = Number.isFinite(currentLeft) ? currentLeft : rect.left - (parentRect?.left || 0);
  const startTop = Number.isFinite(currentTop) ? currentTop : rect.top - (parentRect?.top || 0);
  dragState = {
    win,
    pointerStartX: event.clientX,
    pointerStartY: event.clientY,
    startLeft,
    startTop
  };
  if (typeof header.setPointerCapture === "function" && event.pointerId !== undefined) {
    header.setPointerCapture(event.pointerId);
  }
  header.addEventListener("pointermove", handleDrag);
  header.addEventListener("pointerup", stopDrag, { once: true });
  header.addEventListener("pointercancel", stopDrag, { once: true });
};

const handleDrag = (event) => {
  if (!dragState) return;
  const win = dragState.win;
  const deltaX = event.clientX - dragState.pointerStartX;
  const deltaY = event.clientY - dragState.pointerStartY;
  const left = dragState.startLeft + deltaX;
  const top = dragState.startTop + deltaY;
  win.style.left = `${left}px`;
  win.style.top = `${top}px`;
};

const stopDrag = (event) => {
  const header = event.currentTarget;
  header.removeEventListener("pointermove", handleDrag);
  if (typeof header.releasePointerCapture === "function" && event.pointerId !== undefined) {
    try {
      header.releasePointerCapture(event.pointerId);
    } catch (error) {
      // ignore release errors
    }
  }
  dragState = null;
};

document.querySelectorAll(".floating-window .window-header").forEach(header => {
  header.addEventListener("pointerdown", startDrag);
});

const setLegendVisibility = (visible) => {
  legendVisible = Boolean(visible);
  if (legendVisible) {
    legend.addTo(map);
  } else if (legend._map) {
    legend.remove();
  }
  if (legendToggle) {
    legendToggle.checked = legendVisible;
  }
};

const updateCategoryFilterOptions = () => {
  const names = getCategoryEntries().map(([name]) => name);
  const applyOptions = (selectEl) => {
    if (!selectEl) return;
    const previous = selectEl.value;
    selectEl.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "すべて";
    selectEl.appendChild(allOption);
    names.forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      selectEl.appendChild(option);
    });
    if (previous && (previous === "all" || names.includes(previous))) {
      selectEl.value = previous;
    } else {
      selectEl.value = "all";
    }
  };
  applyOptions(categoryFilter);
  applyOptions(statsCategoryFilterEl);
};

updateCategoryFilterOptions();

const formatInputDate = (date) => date.toISOString().slice(0, 10);
const formatRangeLabel = (date) => `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
const formatCurrency = (value = 0) => `¥${Math.round(value).toLocaleString()}`;
const formatDateYMD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const formatTimeHM = (date) => {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const formatRating = (value) => {
  if (typeof value === "string" && value.trim()) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "未評価";
  return "★".repeat(Math.min(5, numeric));
};

let cachedLogs = [];
let markers = [];
let basePolyline;
let highlightLayer;
let latestMarker;

let activeRange = { start: null, end: null };
let activeCategory = "all";
let displayPresetKey = "30";

let statsRange = { start: null, end: null };
let statsCategory = "all";
let expenseChart;
let dailyChart;

const PLAYER_STATUS_DEFAULTS = {
  level: "???",
  hp: "???",
  mp: "???",
  gold: "???",
  condition: "未設定"
};

let playerStatusState = { ...PLAYER_STATUS_DEFAULTS };

let budgetsData = {};
let budgetCursor = { year: null, month: null };
let legendVisible = false;
let unsubscribeCategorySettings = null;

const updatePlayerStatus = (partial = {}) => {
  playerStatusState = { ...playerStatusState, ...partial };
  const statusEl = document.getElementById("status");
  const formatValue = (value) => (value === null || value === undefined || value === "") ? "???" : value;
  statusEl.innerHTML = `
    <div class="status-row"><span class="status-label">Lv</span><span class="status-colon">:</span><span class="status-value">${formatValue(playerStatusState.level)}</span></div>
    <div class="status-row"><span class="status-label">Cal</span><span class="status-colon">:</span><span class="status-value">${formatValue(playerStatusState.calories)}</span></div>
    <div class="status-row"><span class="status-label">Slp</span><span class="status-colon">:</span><span class="status-value">${formatValue(playerStatusState.sleep)}</span></div>
    <div class="status-row"><span class="status-label">G</span><span class="status-colon">:</span><span class="status-value">${formatValue(playerStatusState.gold)}</span></div>
    <div class="status-row"><span class="status-label">縛り</span><span class="status-colon">:</span><span class="status-value">${formatValue(playerStatusState.restriction)}</span></div>
  `;
};

window.updatePlayerStatus = updatePlayerStatus;
updatePlayerStatus();

const subscribeCategorySettings = () => {
  if (unsubscribeCategorySettings) return;
  unsubscribeCategorySettings = categoriesCollectionRef.orderBy("name").onSnapshot(snapshot => {
    if (snapshot.empty) {
      categoryColors = { ...DEFAULT_CATEGORY_SETTINGS };
    } else {
      const next = {};
      snapshot.forEach(doc => {
        const data = doc.data() || {};
        const name = data.name || doc.id;
        if (!name) return;
        next[name] = { color: data.color || DEFAULT_CATEGORY_SETTINGS[name]?.color || "#999" };
      });
      categoryColors = Object.keys(next).length ? next : { ...DEFAULT_CATEGORY_SETTINGS };
    }
    updateLegendContent();
    updateCategoryFilterOptions();
    renderLogs();
    renderExpenseStats();
    renderBudgetView();
  }, (error) => {
    console.error("カテゴリの取得に失敗しました:", error);
    categoryColors = { ...DEFAULT_CATEGORY_SETTINGS };
    updateLegendContent();
    updateCategoryFilterOptions();
  });
};

const setDisplayRangeByPreset = (key, options = {}) => {
  displayPresetKey = key;
  rangeQuickButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.rangeShortcut === key);
  });
  if (key === "all") {
    activeRange = { start: null, end: null };
  } else {
    const days = Number(key);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    activeRange = { start, end };
  }
  updateRangeDescription();
  if (!options.skipRender) {
    renderLogs();
  }
};

const setDefaultRange = () => {
  setDisplayRangeByPreset(displayPresetKey || "30", { skipRender: true });
};

const updateRangeDescription = (message) => {
  if (message) {
    rangeDescription.textContent = message;
    return;
  }
  if (!activeRange.start && !activeRange.end) {
    rangeDescription.textContent = "全期間を表示中";
  } else {
    const start = activeRange.start ? formatRangeLabel(activeRange.start) : "----";
    const end = activeRange.end ? formatRangeLabel(activeRange.end) : "----";
    rangeDescription.textContent = `表示期間：${start} 〜 ${end}`;
  }
};

if (categoryFilter) {
  categoryFilter.addEventListener("change", () => {
    activeCategory = categoryFilter.value || "all";
    renderLogs();
  });
}
rangeQuickButtons.forEach(btn => {
  btn.addEventListener("click", () => setDisplayRangeByPreset(btn.dataset.rangeShortcut));
});

const updateStatsRangeDescription = () => {
  if (!statsRangeDescription) return;
  if (!statsRange.start && !statsRange.end) {
    statsRangeDescription.textContent = "集計期間：全期間";
  } else {
    const start = statsRange.start ? formatRangeLabel(statsRange.start) : "----";
    const end = statsRange.end ? formatRangeLabel(statsRange.end) : "----";
    statsRangeDescription.textContent = `集計期間：${start} 〜 ${end}`;
  }
};

const setStatsRangeByPreset = (key, skipRender = false) => {
  statsQuickRangeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.statsRange === key));
  if (key === "all") {
    statsRange = { start: null, end: null };
  } else {
    const days = Number(key);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    statsRange = { start, end };
  }
  updateStatsRangeDescription();
  if (!skipRender) renderExpenseStats();
};

statsQuickRangeButtons.forEach(btn => {
  btn.addEventListener("click", () => setStatsRangeByPreset(btn.dataset.statsRange));
});

if (statsCategoryFilterEl) {
  statsCategoryFilterEl.addEventListener("change", () => {
    statsCategory = statsCategoryFilterEl.value || "all";
    renderExpenseStats();
  });
}

statsTabs.forEach(btn => {
  btn.addEventListener("click", () => activateStatsTab(btn.dataset.tabTarget));
});

const activateStatsTab = (targetId) => {
  statsTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tabTarget === targetId));
  tabPanels.forEach(panel => panel.classList.toggle("active", panel.id === targetId));
};

const activateMainTab = (targetId) => {
  mainTabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.mainTab === targetId));
  mainTabPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.mainPanel === targetId));
  if (targetId === "budget") {
    updateBudgetMonthLabel();
    renderBudgetView();
  }
};

mainTabButtons.forEach(btn => {
  btn.addEventListener("click", () => activateMainTab(btn.dataset.mainTab));
});

const changeBudgetMonth = (delta) => {
  if (budgetCursor.year === null || budgetCursor.month === null) {
    const now = new Date();
    budgetCursor.year = now.getFullYear();
    budgetCursor.month = now.getMonth();
  }
  budgetCursor.month += delta;
  if (budgetCursor.month < 0) {
    budgetCursor.month = 11;
    budgetCursor.year -= 1;
  } else if (budgetCursor.month > 11) {
    budgetCursor.month = 0;
    budgetCursor.year += 1;
  }
  updateBudgetMonthLabel();
  renderBudgetView();
};

const updateBudgetMonthLabel = () => {
  if (!budgetMonthLabel) return;
  if (budgetCursor.year === null || budgetCursor.month === null) {
    const now = new Date();
    budgetCursor.year = now.getFullYear();
    budgetCursor.month = now.getMonth();
  }
  budgetMonthLabel.textContent = `${budgetCursor.year}年${String(budgetCursor.month + 1).padStart(2, "0")}月`;
};

if (budgetPrevBtn) budgetPrevBtn.addEventListener("click", () => changeBudgetMonth(-1));
if (budgetNextBtn) budgetNextBtn.addEventListener("click", () => changeBudgetMonth(1));

setLegendVisibility(false);
if (legendToggle) {
  legendToggle.addEventListener("change", () => setLegendVisibility(legendToggle.checked));
}

const playerStatusDocRef = db.collection("meta").doc("playerStatus");
playerStatusDocRef.onSnapshot(doc => {
  if (doc.exists) {
    updatePlayerStatus(doc.data());
  } else {
    updatePlayerStatus({ ...PLAYER_STATUS_DEFAULTS });
  }
});

const budgetsDocRef = db.collection("meta").doc("budgets");
budgetsDocRef.onSnapshot(doc => {
  budgetsData = doc.exists ? doc.data() || {} : {};
  renderBudgetView();
});

const logsRef = db.collection("logs").orderBy("timestamp");
logsRef.onSnapshot(snapshot => {
  cachedLogs = snapshot.docs.map(doc => {
    const data = doc.data();
    const timestamp = toJsDate(data.timestamp);
    if (!timestamp) return null;
    return {
      id: doc.id,
      ...data,
      timestamp,
      lat: toNumber(data.lat),
      lng: toNumber(data.lng),
      amount: toNumber(data.amount) || 0
    };
  }).filter(Boolean);
  renderLogs();
});

const cleanupMapLayers = () => {
  if (basePolyline) {
    map.removeLayer(basePolyline);
    basePolyline = null;
  }
  if (highlightLayer) {
    map.removeLayer(highlightLayer);
    highlightLayer = null;
  }
  if (latestMarker) {
    map.removeLayer(latestMarker);
    latestMarker = null;
  }
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
};

const matchesDisplayFilters = (logDate, category) => {
  if (activeRange.start && logDate < activeRange.start) return false;
  if (activeRange.end && logDate > activeRange.end) return false;
  if (activeCategory !== "all" && (category || "その他") !== activeCategory) return false;
  return true;
};

const gradientStops = [
  { r: 255, g: 255, b: 255 },  // pure white (oldest)
  { r: 255, g: 140, b: 0 }     // vivid orange (latest)
];

const mixGradientColor = (ratio) => {
  const sections = gradientStops.length - 1;
  const clamped = Math.min(0.9999, Math.max(0, ratio));
  const scaled = clamped * sections;
  const index = Math.min(sections - 1, Math.floor(scaled));
  const localRatio = scaled - index;
  const start = gradientStops[index];
  const end = gradientStops[index + 1];

  const r = Math.round(start.r + (end.r - start.r) * localRatio);
  const g = Math.round(start.g + (end.g - start.g) * localRatio);
  const b = Math.round(start.b + (end.b - start.b) * localRatio);

  return `rgb(${r}, ${g}, ${b})`;
};

const renderLogs = async () => {
  if (!cachedLogs.length) return;
  cleanupMapLayers();

  const pathLogs = cachedLogs
    .filter(log => Number.isFinite(log.lat) && Number.isFinite(log.lng))
    .sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp;
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || "").localeCompare(String(b.id || ""), "en");
    });

  if (pathLogs.length > 1) {
    const latlngsAll = pathLogs.map(log => [log.lat, log.lng]);
    basePolyline = L.polyline(latlngsAll, {
      color: "#ffffff",
      weight: 4,
      opacity: 0.2
    }).addTo(map);
  }

  const rangeLogs = pathLogs.filter(log => {
    if (activeRange.start && log.timestamp < activeRange.start) return false;
    if (activeRange.end && log.timestamp > activeRange.end) return false;
    return true;
  });

  if (rangeLogs.length > 1) {
    highlightLayer = L.layerGroup().addTo(map);
    const firstTs = rangeLogs[0].timestamp.getTime();
    const lastTs = rangeLogs[rangeLogs.length - 1].timestamp.getTime();
    const span = Math.max(1, lastTs - firstTs);
    for (let i = 1; i < rangeLogs.length; i++) {
      const prev = rangeLogs[i - 1];
      const curr = rangeLogs[i];
      const prevRatio = (prev.timestamp.getTime() - firstTs) / span;
      const currRatio = (curr.timestamp.getTime() - firstTs) / span;
      const color = mixGradientColor(Math.min(1, Math.max(0, (prevRatio + currRatio) / 2)));
      L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], {
        color,
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(highlightLayer);
    }
  }

  const visibleLogs = [];
  const markerLogs = [];
  cachedLogs.forEach(log => {
    if (!Number.isFinite(log.lat) || !Number.isFinite(log.lng)) return;
    const category = log.amount_category || "その他";
    if (!matchesDisplayFilters(log.timestamp, category)) return;
    if (HIDDEN_MARKER_CATEGORIES.has(category)) return;
    visibleLogs.push(log);
    markerLogs.push(log);
    const logDate = log.timestamp;
    const logDateStr = formatDateYMD(logDate);
    const logTimeStr = formatTimeHM(logDate);
    const locationText = log.locationName || "不明な場所";
    const popupHtml = `
      <div class="log-popup">
        <div class="log-popup-row">日付：${logDateStr}</div>
        <div class="log-popup-row">時刻：${logTimeStr}</div>
        <div class="log-popup-row">場所：${locationText}</div>
        <div class="log-popup-row">メモ：${log.memo || "（メモなし）"}</div>
        <div class="log-popup-row">評価：${formatRating(log.stars)}</div>
        <div class="log-popup-row">出費：${formatCurrency(log.amount)}</div>
      </div>
    `;
    const fillColor = getCategoryColor(category);
    const marker = L.marker([log.lat, log.lng], {
      icon: L.divIcon({
        className: "log-marker",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        html: `<span class="log-marker-dot" style="background:${fillColor};"></span>`
      })
    }).addTo(map).bindPopup(popupHtml);
    markers.push(marker);
  });

  const latestCandidate = markerLogs[markerLogs.length - 1] || [...cachedLogs].reverse().find(log => {
    const cat = log.amount_category || "その他";
    return !HIDDEN_MARKER_CATEGORIES.has(cat) && Number.isFinite(log.lat) && Number.isFinite(log.lng);
  });
  if (latestCandidate && Number.isFinite(latestCandidate.lat) && Number.isFinite(latestCandidate.lng)) {
    const jst = latestCandidate.timestamp;
    const dateStr = formatDateYMD(jst);
    const timeStr = formatTimeHM(jst);
    let addressText = "取得中...";
    try {
      const res = await rateLimitedFetch(`https://nominatim.openstreetmap.org/reverse?lat=${latestCandidate.lat}&lon=${latestCandidate.lng}&format=json`);
      const data = await res.json();
      const addr = data.address || {};
      addressText = [addr.state, addr.city || addr.town || addr.village].filter(Boolean).join(" ");
    } catch (error) {
      addressText = "住所取得エラー";
    }
    const popupLocation = latestCandidate.locationName || addressText || "不明な場所";
    const popupHtml = `
      <div class="log-popup">
        <div class="log-popup-row">日付：${dateStr}</div>
        <div class="log-popup-row">時刻：${timeStr}</div>
        <div class="log-popup-row">場所：${popupLocation}</div>
        <div class="log-popup-row">メモ：${latestCandidate.memo || "（メモなし）"}</div>
        <div class="log-popup-row">評価：${formatRating(latestCandidate.stars)}</div>
        <div class="log-popup-row">出費：${formatCurrency(latestCandidate.amount)}</div>
      </div>
    `;
    if (latestMarker) map.removeLayer(latestMarker);
    latestMarker = L.marker([latestCandidate.lat, latestCandidate.lng], { icon: latestMarkerIcon }).addTo(map)
      .bindPopup(popupHtml)
      .openPopup();
    map.setView([latestCandidate.lat + 0.1, latestCandidate.lng], 10);
  }
  setTimeout(() => map.invalidateSize(), 500);
  renderExpenseStats();
  renderBudgetView();
  renderProphecy();
  renderInvestment();
};

const getStatsFilteredLogs = () => {
  return cachedLogs.filter(log => {
    const ts = log.timestamp;
    if (statsRange.start && ts < statsRange.start) return false;
    if (statsRange.end && ts > statsRange.end) return false;
    if (statsCategory !== "all") {
      const cat = log.amount_category || "その他";
      if (cat !== statsCategory) return false;
    }
    return true;
  });
};

const renderExpenseStats = () => {
  if (!statsMetricsEl) return;
  const filtered = getStatsFilteredLogs();
  const categoryTotals = getCategoryTotals(filtered);
  updateStatsRangeDescription();
  updateStatsMetrics(filtered);
  updateExpenseChart(filtered, categoryTotals);
  updateDailyChart(filtered);
};

const updateStatsMetrics = (logs) => {
  if (!logs.length) {
    statsMetricsEl.innerHTML = `<div class="stat-card"><span class="stat-label">データなし</span><strong class="stat-value">¥0</strong><span class="stat-subtext">集計対象のログがありません。</span></div>`;
    return;
  }
  const total = logs.reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const entryCount = logs.length;
  const dayKeys = new Set(logs.map(log => formatInputDate(log.timestamp)));
  const dayCount = dayKeys.size || 1;
  const avgPerDay = total / dayCount;
  const avgPerEntry = entryCount ? total / entryCount : 0;
  const maxEntry = logs.reduce((prev, current) => (current.amount || 0) > (prev.amount || 0) ? current : prev, logs[0]);
  statsMetricsEl.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">総額</span>
      <strong class="stat-value">${formatCurrency(total)}</strong>
      <span class="stat-subtext">${entryCount}件 / ${dayCount}日</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">1日あたり</span>
      <strong class="stat-value">${formatCurrency(avgPerDay)}</strong>
      <span class="stat-subtext">平均支出</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">1件あたり</span>
      <strong class="stat-value">${formatCurrency(avgPerEntry)}</strong>
      <span class="stat-subtext">平均支出額</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">最大支出</span>
      <strong class="stat-value">${formatCurrency(maxEntry.amount || 0)}</strong>
      <span class="stat-subtext">${maxEntry.locationName || maxEntry.memo || "名称なし"}</span>
    </div>
  `;
};

function getCategoryTotals(logs = []) {
  return logs.reduce((acc, log) => {
    const cat = log.amount_category || "その他";
    acc[cat] = (acc[cat] || 0) + (Number(log.amount) || 0);
    return acc;
  }, {});
}

function updateExpenseChart(logs, totals) {
  if (!expenseChartCanvas || typeof Chart === "undefined") return;
  const ctx = expenseChartCanvas.getContext("2d");
  const breakdown = totals || getCategoryTotals(logs);
  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const labels = sorted.length ? sorted.map(([cat]) => cat) : ["データなし"];
  const data = sorted.length ? sorted.map(([, value]) => value) : [0];
  const colors = labels.map(cat => getCategoryColor(cat) || "#7f8c8d");
  const counts = logs.reduce((acc, log) => {
    const cat = log.amount_category || "その他";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  if (!expenseChart) {
    expenseChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctxVal) => {
                const label = ctxVal.label || "";
                return `${label}: ${formatCurrency(ctxVal.raw || 0)}${counts[label] ? ` / ${counts[label]}件` : ""}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: "#d3f0ff" },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          y: {
            ticks: { color: "#d3f0ff" },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    });
  } else {
    expenseChart.data.labels = labels;
    expenseChart.data.datasets[0].data = data;
    expenseChart.data.datasets[0].backgroundColor = colors;
    expenseChart.update();
  }
}

function updateDailyChart(logs) {
  if (!dailyChartCanvas || typeof Chart === "undefined") return;
  const ctx = dailyChartCanvas.getContext("2d");
  const totals = logs.reduce((acc, log) => {
    const dateKey = formatInputDate(log.timestamp);
    acc[dateKey] = (acc[dateKey] || 0) + (Number(log.amount) || 0);
    return acc;
  }, {});

  const determineBoundary = (type) => {
    if (statsRange[type]) return new Date(statsRange[type]);
    if (logs.length) {
      const sorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
      return new Date(type === "start" ? sorted[0].timestamp : sorted[sorted.length - 1].timestamp);
    }
    return new Date();
  };

  let startDate = determineBoundary("start");
  let endDate = determineBoundary("end");
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  const labels = [];
  const data = [];
  const iterator = new Date(startDate);
  while (iterator <= endDate) {
    const key = formatInputDate(iterator);
    labels.push(key.replace(/-/g, "/"));
    data.push(totals[key] || 0);
    iterator.setDate(iterator.getDate() + 1);
  }
  if (!labels.length) {
    const today = formatInputDate(new Date()).replace(/-/g, "/");
    labels.push(today);
    data.push(0);
  }

  if (!dailyChart) {
    dailyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: "#ffdf74",
          backgroundColor: "rgba(255, 223, 116, 0.15)",
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctxVal) => `${ctxVal.label}: ${formatCurrency(ctxVal.raw || 0)}`
            }
          }
        },
        scales: {
          x: { ticks: { color: "#d3f0ff" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#d3f0ff" }, grid: { color: "rgba(255,255,255,0.05)" } }
        }
      }
    });
  } else {
    dailyChart.data.labels = labels;
    dailyChart.data.datasets[0].data = data;
    dailyChart.update();
  }
}

function renderBudgetView() {
  if (!budgetListEl) return;
  if (budgetCursor.year === null || budgetCursor.month === null) {
    const now = new Date();
    budgetCursor = { year: now.getFullYear(), month: now.getMonth() };
    updateBudgetMonthLabel();
  }
  const { year, month } = budgetCursor;
  const monthlyLogs = cachedLogs.filter(log => log.timestamp.getFullYear() === year && log.timestamp.getMonth() === month);
  const usage = monthlyLogs.reduce((acc, log) => {
    const cat = log.amount_category || "その他";
    acc[cat] = (acc[cat] || 0) + (Number(log.amount) || 0);
    return acc;
  }, {});

  let categories = Object.keys(categoryColors);
  if (!categories.length) {
    categories = Object.keys(DEFAULT_CATEGORY_SETTINGS);
  }
  if (!categories.length) {
    budgetListEl.innerHTML = "<li>カテゴリが見つかりません。</li>";
    return;
  }
  const budgets = budgetsData || {};
  const configured = Object.keys(budgets).length;
  if (budgetSummaryEl) {
    if (!configured) {
      budgetSummaryEl.textContent = "予算が設定されていません。";
    } else {
      const totalBudget = Object.values(budgets).reduce((sum, value) => sum + (Number(value) || 0), 0);
      budgetSummaryEl.textContent = `設定カテゴリ：${configured} / 合計予算 ${formatCurrency(totalBudget)}`;
    }
  }

  budgetListEl.innerHTML = categories.map(cat => {
    const used = usage[cat] || 0;
    const budgetValue = Number(budgets[cat]);
    const hasBudget = Number.isFinite(budgetValue) && budgetValue > 0;
    const remaining = hasBudget ? budgetValue - used : null;
    const ratio = hasBudget ? Math.min(999, Math.max(0, (used / budgetValue) * 100)) : 0;
    const statusClass = hasBudget ? (remaining >= 0 ? "budget-ok" : "budget-over") : "";
    const text = hasBudget ? `${formatCurrency(budgetValue)} / 使用率 ${(ratio).toFixed(1)}% ${remaining >= 0 ? "残" : "超過"} ${formatCurrency(Math.abs(remaining))}` : "未設定";
    const bar = hasBudget ? `<div class="budget-bar"><div class="budget-bar-fill" style="width:${Math.min(100, ratio)}%"></div></div>` : "";
    return `
      <li>
        <div class="budget-row">
          <span><strong>${cat}</strong></span>
          <span class="${statusClass}">使用：${formatCurrency(used)} / ${text}</span>
        </div>
        ${bar}
      </li>
    `;
  }).join("");
}

function renderProphecy() {
  if (!prophecyContentEl) return;
  if (!cachedLogs.length) {
    prophecyContentEl.innerHTML = "<li>まだ冒険の記録がありません。</li>";
    return;
  }
  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - 14);
  const recentLogs = cachedLogs.filter(log => log.timestamp >= recentStart);
  const messages = [];
  if (!recentLogs.length) {
    messages.push("最近14日間のログがありません。旅の続きを記録しましょう。");
  } else {
    const totals = getCategoryTotals(recentLogs);
    const [topCat, amount] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || [];
    if (topCat) {
      messages.push(`最近の支出は${topCat}が中心（${formatCurrency(amount)}）。装備を整える好機です。`);
    }
    const highStar = recentLogs.find(log => Number(log.stars) >= 4);
    if (highStar) {
      messages.push(`「${highStar.locationName || highStar.memo || "無題"}」で士気が上昇。次の目的地の参考に。`);
    }
  }
  const latest = cachedLogs[cachedLogs.length - 1];
  if (latest) {
    const hoursSince = (now - latest.timestamp) / (1000 * 60 * 60);
    if (hoursSince > 48) {
      messages.push("丸二日以上停滞しています。休息か入力漏れがないか確認を。");
    } else {
      messages.push("旅路は順調。次のログで冒険の書を更新しましょう。");
    }
  }
  prophecyContentEl.innerHTML = messages.map(msg => `<li>${msg}</li>`).join("");
}

function renderInvestment() {
  if (!investmentSummaryEl || !cachedLogs.length) return;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyLogs = cachedLogs.filter(log => log.timestamp >= monthStart);
  const monthlyExpense = monthlyLogs.reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const remaining = 120000 - monthlyExpense;
  const deltaClass = remaining >= 0 ? "positive" : "negative";
  investmentSummaryEl.innerHTML = `
    <div><strong>今月の出費合計</strong><br>${formatCurrency(monthlyExpense)}</div>
    <div>王の出資枠：${formatCurrency(120000)}</div>
    <div class="investment-delta ${deltaClass}">
      ${remaining >= 0 ? `あと ${formatCurrency(remaining)} 余裕あり` : `${formatCurrency(Math.abs(remaining))} 超過中`}
    </div>
  `;
  const major = monthlyLogs.filter(log => Number(log.amount) > 0)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, 3);
  if (!major.length) {
    investmentTopListEl.innerHTML = "<li>大きな支出はまだありません。</li>";
  } else {
    investmentTopListEl.innerHTML = major.map(log => {
      const date = `${log.timestamp.getMonth() + 1}/${log.timestamp.getDate()}`;
      return `<li>${date}: ${log.locationName || log.memo || "用途不明"} に ${formatCurrency(log.amount)}</li>`;
    }).join("");
  }
}

activateMainTab("stats");
setDefaultRange();
setStatsRangeByPreset("30", true);
subscribeCategorySettings();
renderExpenseStats();
renderBudgetView();
