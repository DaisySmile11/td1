// assets/js/app.js
// Dashboard (index.html):
// - Dropdown chọn thiết bị + range (day/yesterday/month/year)
// - KPI realtime từ Firestore: devices/{id}/stats/latest
// - Alert bars (2 màu): ALERT (đỏ) + WARN (vàng) + OFFLINE (xám)
// - System Status box tổng hợp: độ mặn / nhiệt độ / pH / pin + chú thích ngưỡng
// - Gọi chart render từ charts.js (renderIndexMainChart)
// - Đồng bộ danh sách device cho map.js kiểu cũ (window.devices)

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

import { renderIndexMainChart } from "./charts.js";

// =====================
// Firebase config
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
// Thresholds (bạn chỉnh ở đây)
// =====================
const THRESHOLDS = {
  // Salinity (‰)
  SAL_WARN: 30,
  SAL_ALERT: 35,

  // pH
  PH_LOW: 6.5,
  PH_HIGH: 8.5,
  PH_LOW_ALERT: 6.0,
  PH_HIGH_ALERT: 9.0,

  // Temperature (°C)
  TEMP_LOW: 20,
  TEMP_HIGH: 32,
  TEMP_LOW_ALERT: 15,
  TEMP_HIGH_ALERT: 35,

  // Battery (%)
  BAT_LOW: 20,
  BAT_ALERT: 10,

  // Offline: nếu updated/measured quá lâu
  OFFLINE_AFTER_SEC: 10 * 60, // 10 phút
};

// =====================
// Device display name + lat/lng mapping
// 👉 chỗ đổi tên & vị trí thiết bị
// =====================
const DEVICE_META = {
  bien_hoa: { name: "Biên Hòa", lat: 10.9574, lng: 106.8427 },
  binh_duong: { name: "Bình Dương", lat: 11.3254, lng: 106.4770 },
  HoChiMinh_city: { name: "Hồ Chí Minh", lat: 10.8231, lng: 106.6297 },

  // demo (tạm)
  demo_1: { name: "Demo Long Xuyên", lat: 10.391895, lng: 105.431071 },
  demo_2: { name: "Demo Cần Thơ", lat: 10.066987, lng: 105.777952 },
  demo_wifi_1: { name: "Demo Bạc Liêu", lat: 9.207590, lng: 105.741604 },
  demo_wifi_2: { name: "Demo Rạch Giá", lat: 10.009880, lng: 105.070804 },

};


function prettifyId(id) {
  return String(id || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDeviceDisplayName(id) {
  return DEVICE_META?.[id]?.name || prettifyId(id);
}

function getDeviceLatLng(id) {
  const m = DEVICE_META?.[id];
  if (m && Number.isFinite(m.lat) && Number.isFinite(m.lng)) return [m.lat, m.lng];
  // fallback: VN center
  return [10.8, 106.7];
}

// =====================
// Helpers
// =====================
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

function isOfflineFromLatest(latest) {
  if (!latest) return true;

  // if backend explicitly marks OFFLINE
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

function prettyTypeFromAlertCode(code) {
  const s = String(code || "").toUpperCase();
  if (s.includes("SAL")) return "Độ mặn";
  if (s.includes("PH")) return "pH";
  if (s.includes("TEMP")) return "Nhiệt độ";
  if (s.includes("BAT") || s.includes("BATT")) return "Pin";
  return "Cảnh báo";
}

function valueTextByType(type, latest) {
  const t = String(type);
  if (t === "pH") {
    const v = safeNum(latest?.ph, null);
    return v == null ? "" : ` (${v.toFixed(2)})`;
  }
  if (t === "Độ mặn") {
    const v = safeNum(latest?.salinity, null);
    return v == null ? "" : ` (${v.toFixed(1)}‰)`;
  }
  if (t === "Nhiệt độ") {
    const v = safeNum(latest?.temperature, null);
    return v == null ? "" : ` (${v.toFixed(1)}°C)`;
  }
  if (t === "Pin") {
    const v = safeNum(latest?.batteryPct, null);
    return v == null ? "" : ` (${v.toFixed(0)}%)`;
  }
  return "";
}

// =====================
// Firestore reads
// =====================
async function listDeviceIds() {
  const q = query(collection(db, "devices"), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id).filter(Boolean);
}

async function readLatest(deviceId) {
  try {
    const ref = doc(db, "devices", deviceId, "stats", "latest");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.warn("readLatest failed:", deviceId, e);
    return null;
  }
}

// =====================
// UI: device dropdown
// =====================
let allDevices = []; // [{id,name,lat,lng}]

async function populateDeviceSelect() {
  const select = $("deviceSelect");
  if (!select) return;

  select.innerHTML = "";

  let ids = [];
  try {
    ids = (await listDeviceIds()).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    // fallback if list blocked by rules
    ids = Object.keys(DEVICE_META);
  }

  allDevices = ids.map((id) => {
    const [lat, lng] = getDeviceLatLng(id);
    return { id, name: getDeviceDisplayName(id), lat, lng };
  });

  allDevices.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    select.appendChild(opt);
  });

  const params = new URLSearchParams(window.location.search);
  const activeId = params.get("device");

  if (activeId && ids.includes(activeId)) select.value = activeId;
  else if (select.options.length > 0) select.selectedIndex = 0;
}

function getSelectedDeviceId() {
  return $("deviceSelect")?.value || "";
}

function updateStationHeader(deviceId) {
  const el = $("currentStationName");
  if (!el) return;
  el.textContent = getDeviceDisplayName(deviceId) || "Chưa chọn trạm";
}

function updateDetailLink(deviceId) {
  const a = $("detailLink");
  if (!a) return;
  a.href = `device.html?device=${encodeURIComponent(deviceId)}`;
}

// =====================
// Alerts: render + build into 2 buckets (ALERT/WARN) + OFFLINE
// =====================
function renderAlertGroup(listEl, barEl, alerts) {
  if (!listEl || !barEl) return;

  listEl.innerHTML = "";
  if (!alerts.length) {
    barEl.style.display = "none";
    return;
  }

  barEl.style.display = "block";

  alerts.forEach((a) => {
    const li = document.createElement("li");
    li.className = "alert-item";
    li.dataset.deviceId = a.deviceId;
    li.innerHTML = `
      <span class="alert-chip">
        <span class="alert-tag">${a.tag}</span>
        <span>${a.html}</span>
      </span>
    `;

    li.addEventListener("click", () => {
      const select = $("deviceSelect");
      if (select) {
        select.value = a.deviceId;
        select.dispatchEvent(new Event("change"));
      }
    });

    listEl.appendChild(li);
  });
}

async function buildAllAlerts(devices) {
  const out = { alert: [], warn: [], offline: [] };

  const pushItem = (bucket, d, latest, code) => {
    const type = prettyTypeFromAlertCode(code);
    const vText = valueTextByType(type, latest);
    bucket.push({
      deviceId: d.id,
      tag: type,
      html: `<strong>${d.name}</strong>: ${String(code).replaceAll("_", " ")}${vText}`,
    });
  };

  await Promise.all(
    devices.map(async (d) => {
      const latest = await readLatest(d.id);
      if (!latest) return;

      if (isOfflineFromLatest(latest)) {
        out.offline.push({
          deviceId: d.id,
          tag: "Offline",
          html: `<strong>${d.name}</strong> mất kết nối (cập nhật: ${fmtDateTime(
            latest.updatedAt ?? latest.measuredAt ?? null
          )})`,
        });
        return;
      }

      const alerts = Array.isArray(latest.alerts) ? latest.alerts.map(String) : [];

      // Prefer backend alerts[]
      if (alerts.length) {
        alerts.forEach((code) => {
          const c = String(code).toUpperCase();
          if (c.includes("ALERT")) pushItem(out.alert, d, latest, c);
          else if (c.includes("WARN")) pushItem(out.warn, d, latest, c);
        });
        return;
      }

      // Fallback thresholds if no alerts[]
      const sal = safeNum(latest.salinity, null);
      const ph = safeNum(latest.ph, null);
      const temp = safeNum(latest.temperature, null);
      const bat = safeNum(latest.batteryPct, null);

      if (sal != null) {
        if (sal >= THRESHOLDS.SAL_ALERT) pushItem(out.alert, d, latest, "SAL HIGH ALERT");
        else if (sal >= THRESHOLDS.SAL_WARN) pushItem(out.warn, d, latest, "SAL HIGH WARN");
      }

      if (ph != null) {
        if (ph < THRESHOLDS.PH_LOW_ALERT || ph > THRESHOLDS.PH_HIGH_ALERT)
          pushItem(out.alert, d, latest, "PH OUT ALERT");
        else if (ph < THRESHOLDS.PH_LOW || ph > THRESHOLDS.PH_HIGH)
          pushItem(out.warn, d, latest, "PH OUT WARN");
      }

      if (temp != null) {
        if (temp < THRESHOLDS.TEMP_LOW_ALERT || temp > THRESHOLDS.TEMP_HIGH_ALERT)
          pushItem(out.alert, d, latest, "TEMP OUT ALERT");
        else if (temp < THRESHOLDS.TEMP_LOW || temp > THRESHOLDS.TEMP_HIGH)
          pushItem(out.warn, d, latest, "TEMP OUT WARN");
      }

      if (bat != null) {
        if (bat < THRESHOLDS.BAT_ALERT) pushItem(out.alert, d, latest, "BATTERY LOW ALERT");
        else if (bat < THRESHOLDS.BAT_LOW) pushItem(out.warn, d, latest, "BATTERY LOW WARN");
      }
    })
  );

  return out;
}

function renderHomeAlerts() {
  const cache = window.__allAlertsCache || { alert: [], warn: [], offline: [] };

  renderAlertGroup($("alertListAlert"), $("alertBarAlert"), cache.alert);
  renderAlertGroup($("alertListWarn"), $("alertBarWarn"), cache.warn);
  renderAlertGroup($("alertListOffline"), $("alertBarOffline"), cache.offline);
}

// =====================
// KPI + System Status (tổng hợp)
// =====================
async function updateKpisForSelected(deviceId) {
  const latest = await readLatest(deviceId);

  const salEl = $("kpiSalinity");
  const tempEl = $("kpiTemperature");
  const phEl = $("kpiPh");
  const batEl = $("kpiBattery");

  const salNote = $("kpiSalinityNote");
  const tempNote = $("kpiTemperatureNote");
  const phNote = $("kpiPhNote");
  const batNote = $("kpiBatteryNote");

  const statusEl = $("kpiStatus");
  const statusNoteEl = $("kpiStatusNote");

  if (!latest) {
    if (salEl) salEl.textContent = "-- ‰";
    if (tempEl) tempEl.textContent = "-- °C";
    if (phEl) phEl.textContent = "--";
    if (batEl) batEl.textContent = "-- %";

    if (salNote) salNote.textContent = "Chưa có dữ liệu.";
    if (tempNote) tempNote.textContent = "Chưa có dữ liệu.";
    if (phNote) phNote.textContent = "Chưa có dữ liệu.";
    if (batNote) batNote.textContent = "Chưa có dữ liệu.";

    if (statusEl) statusEl.textContent = "--";
    if (statusNoteEl) statusNoteEl.textContent = "Chưa có dữ liệu latest.";
    return;
  }

  const sal = safeNum(latest.salinity, null);
  const temp = safeNum(latest.temperature, null);
  const ph = safeNum(latest.ph, null);
  const bat = safeNum(latest.batteryPct, null);

  const updated = fmtDateTime(latest.updatedAt ?? latest.measuredAt ?? null);

  if (salEl) salEl.textContent = sal == null ? "-- ‰" : `${sal.toFixed(1)} ‰`;
  if (tempEl) tempEl.textContent = temp == null ? "-- °C" : `${temp.toFixed(1)} °C`;
  if (phEl) phEl.textContent = ph == null ? "--" : `${ph.toFixed(2)}`;
  if (batEl) batEl.textContent = bat == null ? "-- %" : `${bat.toFixed(0)} %`;

  if (salNote) salNote.textContent = `Cập nhật: ${updated}`;
  if (tempNote) tempNote.textContent = `Cập nhật: ${updated}`;
  if (phNote) phNote.textContent = `Cập nhật: ${updated}`;
  if (batNote) batNote.textContent = `Cập nhật: ${updated}`;

  // ===== Status box =====
  if (!statusEl || !statusNoteEl) return;

  if (isOfflineFromLatest(latest)) {
    statusEl.textContent = "Thiết bị offline";
    statusNoteEl.textContent = "Mất kết nối / quá lâu không cập nhật dữ liệu.";
    return;
  }

  const alerts = Array.isArray(latest.alerts) ? latest.alerts.map(String) : [];

  let hasAlert = false;
  let hasWarn = false;

  const notes = [];
  const typesSeen = new Set();

  const addThresholdNote = (type) => {
    if (type === "PH")
      notes.push(`pH ngoài [${THRESHOLDS.PH_LOW}..${THRESHOLDS.PH_HIGH}].`);
    if (type === "SAL")
      notes.push(`Độ mặn > ${THRESHOLDS.SAL_WARN}‰ (ALERT > ${THRESHOLDS.SAL_ALERT}‰).`);
    if (type === "TEMP")
      notes.push(
        `Nhiệt độ ngoài [${THRESHOLDS.TEMP_LOW}..${THRESHOLDS.TEMP_HIGH}]°C.`
      );
    if (type === "BAT")
      notes.push(`Pin < ${THRESHOLDS.BAT_LOW}% (ALERT < ${THRESHOLDS.BAT_ALERT}%).`);
  };

  // prefer backend alerts[]
  if (alerts.length) {
    alerts.forEach((code) => {
      const c = String(code).toUpperCase();
      if (c.includes("ALERT")) hasAlert = true;
      else if (c.includes("WARN")) hasWarn = true;

      if (c.includes("PH")) typesSeen.add("PH");
      else if (c.includes("SAL")) typesSeen.add("SAL");
      else if (c.includes("TEMP")) typesSeen.add("TEMP");
      else if (c.includes("BAT") || c.includes("BATT")) typesSeen.add("BAT");
    });

    if (hasAlert) statusEl.textContent = "Cảnh báo ALERT";
    else if (hasWarn) statusEl.textContent = "Cảnh báo WARN";
    else statusEl.textContent = "Thiết bị hoạt động ổn định";

    typesSeen.forEach(addThresholdNote);
    statusNoteEl.textContent = notes.length ? notes.join(" ") : "Không có cảnh báo.";
    return;
  }

  // fallback threshold
  if (sal != null) {
    if (sal >= THRESHOLDS.SAL_ALERT) {
      hasAlert = true;
      addThresholdNote("SAL");
    } else if (sal >= THRESHOLDS.SAL_WARN) {
      hasWarn = true;
      addThresholdNote("SAL");
    }
  }

  if (ph != null) {
    if (ph < THRESHOLDS.PH_LOW_ALERT || ph > THRESHOLDS.PH_HIGH_ALERT) {
      hasAlert = true;
      addThresholdNote("PH");
    } else if (ph < THRESHOLDS.PH_LOW || ph > THRESHOLDS.PH_HIGH) {
      hasWarn = true;
      addThresholdNote("PH");
    }
  }

  if (temp != null) {
    if (temp < THRESHOLDS.TEMP_LOW_ALERT || temp > THRESHOLDS.TEMP_HIGH_ALERT) {
      hasAlert = true;
      addThresholdNote("TEMP");
    } else if (temp < THRESHOLDS.TEMP_LOW || temp > THRESHOLDS.TEMP_HIGH) {
      hasWarn = true;
      addThresholdNote("TEMP");
    }
  }

  if (bat != null) {
    if (bat < THRESHOLDS.BAT_ALERT) {
      hasAlert = true;
      addThresholdNote("BAT");
    } else if (bat < THRESHOLDS.BAT_LOW) {
      hasWarn = true;
      addThresholdNote("BAT");
    }
  }

  if (hasAlert) statusEl.textContent = "Cảnh báo ALERT";
  else if (hasWarn) statusEl.textContent = "Cảnh báo WARN";
  else statusEl.textContent = "Thiết bị hoạt động ổn định";

  statusNoteEl.textContent = notes.length ? notes.join(" ") : "Mọi chỉ số nằm trong ngưỡng.";
}

// =====================
// Map sync for old map.js (uses window.devices)
// =====================
function syncDevicesForMap() {
  // Provide a demo-like structure for map.js to draw markers
  window.devices = allDevices.map((d) => ({
    id: d.id,
    name: d.name,
    location: d.name,
    lat: d.lat,
    lng: d.lng,
    // placeholder values; map.js can read these if needed
    salinity: 0,
    temperature: 0,
    battery: 0,
    lastOnline: new Date(),
  }));
}

// =====================
// Dashboard update
// =====================
async function updateDashboard() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return;

  updateStationHeader(deviceId);
  updateDetailLink(deviceId);

  await updateKpisForSelected(deviceId);

  // chart
  await renderIndexMainChart(deviceId);

  // alerts
  window.__allAlertsCache = await buildAllAlerts(allDevices);
  renderHomeAlerts();

  // map refresh if available
  syncDevicesForMap();
  if (typeof window.refreshDeviceMarkers === "function") {
    window.refreshDeviceMarkers();
  }
}

// =====================
// Boot
// =====================
document.addEventListener("DOMContentLoaded", async () => {
  await populateDeviceSelect();

  // init map if available
  syncDevicesForMap();
  if (typeof window.initMap === "function") {
    window.initMap();
  }

  // listeners
  $("deviceSelect")?.addEventListener("change", updateDashboard);
  $("timeRange")?.addEventListener("change", updateDashboard);

  // initial render
  await updateDashboard();

  // auto refresh every 60s
  setInterval(() => {
    updateDashboard().catch(() => {});
  }, 60 * 1000);
});