// assets/js/devices.js
// Devices list page (devices.html)
// - list devices from Firestore
// - read latest for each device
// - show sal/temp/ph/battery/status/updated
// - row color: offline > alert > warn > normal
// - click row -> device.html?device=...

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// =====================
// Firebase config (same as your A)
// =====================
const firebaseConfig = {
  apiKey: "AIzaSyCsnaMLFs_QkO82sNo6_occGQfjpuGyjVs",
  authDomain: "esp32-iot-demo-temphumi.firebaseapp.com",
  databaseURL:
    "https://esp32-iot-demo-temphumi-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "esp32-iot-demo-temphumi",
  storageBucket: "esp32-iot-demo-temphumi.firebasestorage.app",
  messagingSenderId: "843392659912",
  appId: "1:843392659912:web:b8c2e674de0ff989b990fd",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// =====================
// Thresholds (same logic as app.js)
// =====================
const THRESHOLDS = {
  SAL_WARN: 30,
  SAL_ALERT: 35,

  PH_LOW: 6.5,
  PH_HIGH: 8.5,
  PH_LOW_ALERT: 6.0,
  PH_HIGH_ALERT: 9.0,

  TEMP_LOW: 20,
  TEMP_HIGH: 32,
  TEMP_LOW_ALERT: 15,
  TEMP_HIGH_ALERT: 35,

  BAT_LOW: 20,
  BAT_ALERT: 10,

  OFFLINE_AFTER_SEC:  6 * 60,
};

// =====================
// Display name + location
// 👉 đổi tên / vị trí ở đây
// =====================
const DEVICE_META = {
  bien_hoa: { name: "Biên Hòa", location: "Biên Hòa, Đồng Nai" },
  binh_duong: { name: "Bình Dương", location: "Bình Dương" },
  HoChiMinh_city: { name: "Hồ Chí Minh", location: "TP. Hồ Chí Minh" },

  demo_1: { name: "demo_1", location: "—" },
  demo_2: { name: "demo_2", location: "—" },
  demo_wifi_1: { name: "demo_wifi_1", location: "—" },
  demo_wifi_2: { name: "demo_wifi_2", location: "—" },
};

function prettifyId(id) {
  return String(id || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDisplayName(id) {
  return DEVICE_META?.[id]?.name || prettifyId(id);
}

function getLocationText(id) {
  return DEVICE_META?.[id]?.location || "—";
}

const $ = (id) => document.getElementById(id);

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtDateTime(v) {
  if (!v) return "--";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleString("vi-VN", { hour12: false });
}

function isOffline(latest) {
  if (!latest) return true;

  const st = String(latest.status || "").toUpperCase();
  if (st === "OFFLINE") return true;

  const nowSec = Math.floor(Date.now() / 1000);
  const measuredSec =
    safeNum(latest.measuredAtSec, null) ??
    (latest.measuredAt?.seconds ? safeNum(latest.measuredAt.seconds, null) : null);

  const updatedSec =
    (latest.updatedAt?.seconds ? safeNum(latest.updatedAt.seconds, null) : null) ??
    measuredSec;

  const base = updatedSec ?? measuredSec;
  if (base == null) return false;

  return nowSec - base >= THRESHOLDS.OFFLINE_AFTER_SEC;
}

function hasAlertOrWarnFromAlertsArray(latest) {
  const alerts = Array.isArray(latest?.alerts) ? latest.alerts.map(String) : [];
  let hasAlert = false;
  let hasWarn = false;

  alerts.forEach((a) => {
    const s = a.toUpperCase();
    if (s.includes("ALERT")) hasAlert = true;
    else if (s.includes("WARN")) hasWarn = true;
  });

  return { hasAlert, hasWarn };
}

function classifyStatus(latest) {
  if (!latest) return { level: "offline", text: "Không có dữ liệu" };
  if (isOffline(latest)) return { level: "offline", text: "Offline / mất kết nối" };

  // Prefer latest.alerts if exists
  const { hasAlert, hasWarn } = hasAlertOrWarnFromAlertsArray(latest);
  if (hasAlert) return { level: "alert", text: "Cảnh báo ALERT" };
  if (hasWarn) return { level: "warn", text: "Cảnh báo WARN" };

  // Fallback thresholds
  const sal = safeNum(latest.salinity, null);
  const ph = safeNum(latest.ph, null);
  const temp = safeNum(latest.temperature, null);
  const bat = safeNum(latest.batteryPct, null);

  let alert = false;
  let warn = false;

  if (sal != null) {
    if (sal >= THRESHOLDS.SAL_ALERT) alert = true;
    else if (sal >= THRESHOLDS.SAL_WARN) warn = true;
  }

  if (ph != null) {
    if (ph < THRESHOLDS.PH_LOW_ALERT || ph > THRESHOLDS.PH_HIGH_ALERT) alert = true;
    else if (ph < THRESHOLDS.PH_LOW || ph > THRESHOLDS.PH_HIGH) warn = true;
  }

  if (temp != null) {
    if (temp < THRESHOLDS.TEMP_LOW_ALERT || temp > THRESHOLDS.TEMP_HIGH_ALERT) alert = true;
    else if (temp < THRESHOLDS.TEMP_LOW || temp > THRESHOLDS.TEMP_HIGH) warn = true;
  }

  if (bat != null) {
    if (bat < THRESHOLDS.BAT_ALERT) alert = true;
    else if (bat < THRESHOLDS.BAT_LOW) warn = true;
  }

  if (alert) return { level: "alert", text: "Cảnh báo ALERT" };
  if (warn) return { level: "warn", text: "Cảnh báo WARN" };

  return { level: "normal", text: "Bình thường" };
}

function rowClassFromLevel(level) {
  if (level === "offline") return "row-offline";
  if (level === "alert") return "row-danger";
  if (level === "warn") return "row-warning";
  return "row-normal";
}

async function listDeviceIds() {
  const q1 = query(collection(db, "devices"), limit(200));
  const snap = await getDocs(q1);
  return snap.docs.map((d) => d.id).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function readLatest(id) {
  try {
    const ref = doc(db, "devices", id, "stats", "latest");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.warn("readLatest error:", id, e);
    return null;
  }
}

function td(text) {
  const el = document.createElement("td");
  el.textContent = text;
  return el;
}

async function renderTable() {
  const tbody = $("deviceTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="9">Đang tải dữ liệu...</td></tr>`;

  let ids = [];
  try {
    ids = await listDeviceIds();
  } catch (e) {
    // fallback to meta keys
    ids = Object.keys(DEVICE_META);
  }

  // fetch latest for each device (parallel)
  const rows = await Promise.all(
    ids.map(async (id) => {
      const latest = await readLatest(id);
      return { id, latest };
    })
  );

  tbody.innerHTML = "";

  rows.forEach(({ id, latest }) => {
    const name = getDisplayName(id);
    const location = getLocationText(id);

    const sal = safeNum(latest?.salinity, null);
    const temp = safeNum(latest?.temperature, null);
    const ph = safeNum(latest?.ph, null);
    const bat = safeNum(latest?.batteryPct, null);

    const updated = fmtDateTime(latest?.updatedAt ?? latest?.measuredAt ?? null);

    const { level, text } = classifyStatus(latest);

    const tr = document.createElement("tr");
    tr.className = rowClassFromLevel(level);

    tr.appendChild(td(id));
    tr.appendChild(td(name));
    tr.appendChild(td(location));
    tr.appendChild(td(sal == null ? "--" : sal.toFixed(1)));
    tr.appendChild(td(temp == null ? "--" : temp.toFixed(1)));
    tr.appendChild(td(ph == null ? "--" : ph.toFixed(2)));
    tr.appendChild(td(bat == null ? "--" : bat.toFixed(0)));
    tr.appendChild(td(text));
    tr.appendChild(td(updated));

    tr.addEventListener("click", () => {
      window.location.href = `device.html?device=${encodeURIComponent(id)}`;
    });

    tbody.appendChild(tr);
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9">Không có thiết bị.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderTable();

  // auto refresh every 60s
  setInterval(() => {
    renderTable().catch(() => {});
  }, 60 * 1000);
});