// assets/js/app.js
// Dashboard (index.html)
// - Dropdown chọn thiết bị + range
// - KPI realtime từ Firestore: devices/{id}/stats/latest
// - Alert bar 4 dòng: Độ mặn / pH / Pin / Offline (ẩn dòng nếu không có cảnh báo)
// - Gọi chart render từ charts.js (renderIndexMainChart)
// - Đồng bộ device cho map.js: window.devices (có offline/salinityAbnormal/batteryLow)

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { renderIndexMainChart } from "./charts.js";
import {
  db,
  THRESHOLDS,
  DEVICE_OVERRIDES,
  safeNum,
  fmtDateTime,
  getDeviceMeta,
  isOfflineFromLatest,
} from "./data.js";

// =====================
// DOM helpers
// =====================
const $ = (id) => document.getElementById(id);

// =====================
// Firestore reads
// =====================
async function listDeviceIds() {
  const q = query(collection(db, "devices"), limit(200));
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
// Device dropdown
// =====================
let allDevices = []; // [{id,name,location,lat,lng}]
let latestMap = new Map(); // deviceId => latest

async function populateDeviceSelect() {
  const select = $("deviceSelect");
  if (!select) return;

  select.innerHTML = "";

  let ids = [];
  try {
    ids = (await listDeviceIds()).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    // fallback if rules block listing
    ids = Object.keys(DEVICE_OVERRIDES);
  }

  allDevices = ids.map((id) => {
    const meta = getDeviceMeta(id, {});
    const lat = Number.isFinite(meta.lat) ? meta.lat : 10.8;
    const lng = Number.isFinite(meta.lng) ? meta.lng : 106.7;
    return { id, name: meta.name, location: meta.location || meta.name, lat, lng };
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
  const d = allDevices.find((x) => x.id === deviceId);
  el.textContent = d?.name || "Chưa chọn trạm";
}

function updateDetailLink(deviceId) {
  const a = $("detailLink");
  if (!a) return;
  a.href = `device.html?device=${encodeURIComponent(deviceId)}`;
}

// =====================
// Fetch all latest in one shot (avoid re-fetching)
// =====================
async function fetchAllLatest() {
  const entries = await Promise.all(
    allDevices.map(async (d) => [d.id, await readLatest(d.id)])
  );
  latestMap = new Map(entries);
  window.__latestMap = latestMap; // (debug/optional)
}

// =====================
// KPI + System Status
// =====================

async function updateKpisForSelected(deviceId) {
  const latest = latestMap.get(deviceId) ?? (await readLatest(deviceId));

  const salEl = $("kpiSalinity");
  const tempEl = $("kpiTemperature");
  const phEl = $("kpiPh");
  const batEl = $("kpiBattery");

  const salNote = $("kpiSalinityNote");     // ✅ giữ lại
  const tempNote = $("kpiTemperatureNote"); // ❌ bỏ
  const phNote = $("kpiPhNote");            // ❌ bỏ
  const batNote = $("kpiBatteryNote");      // ❌ bỏ

  const statusEl = $("kpiStatus");          // ✅ hiển thị trạng thái thật
  const statusNoteEl = $("kpiStatusNote");  // ❌ bỏ dòng nhỏ dưới trạng thái

  // Helper: clear small notes except salinity
  const clearSmallNotes = () => {
    if (tempNote) tempNote.textContent = "";
    if (phNote) phNote.textContent = "";
    if (batNote) batNote.textContent = "";
    if (statusNoteEl) statusNoteEl.textContent = "";
  };

  if (!latest) {
    if (salEl) salEl.textContent = "-- ‰";
    if (tempEl) tempEl.textContent = "-- °C";
    if (phEl) phEl.textContent = "--";
    if (batEl) batEl.textContent = "-- %";

    if (salNote) salNote.textContent = "Chưa có dữ liệu.";
    clearSmallNotes();

    if (statusEl) statusEl.textContent = "--";
    return;
  }

  const sal = safeNum(latest.salinity, null);
  const temp = safeNum(latest.temperature, null);
  const ph = safeNum(latest.ph, null);
  const bat = safeNum(latest.batteryPct, null);

  const updated = fmtDateTime(latest.updatedAt ?? latest.measuredAt ?? null);

  // KPI values
  if (salEl) salEl.textContent = sal == null ? "-- ‰" : `${sal.toFixed(1)} ‰`;
  if (tempEl) tempEl.textContent = temp == null ? "-- °C" : `${temp.toFixed(1)} °C`;
  if (phEl) phEl.textContent = ph == null ? "--" : `${ph.toFixed(2)}`;
  if (batEl) batEl.textContent = bat == null ? "-- %" : `${bat.toFixed(0)} %`;

  // ✅ Chỉ giữ dòng nhỏ ở ô Độ mặn
  if (salNote) salNote.textContent = `Cập nhật: ${updated}`;

  // ❌ Xóa dòng nhỏ ở Nhiệt độ / pH / Pin / Trạng thái
  clearSmallNotes();

  // ==========================
  // Trạng thái hệ thống "thật"
  // ==========================
  if (!statusEl) return;

  // Offline ưu tiên
  if (isOfflineFromLatest(latest, THRESHOLDS.OFFLINE_MINUTES)) {
    statusEl.textContent = "Offline";
    return;
  }

  const statuses = [];

  // Độ mặn
  if (sal != null) {
    if (sal > THRESHOLDS.SAL_HIGH) statuses.push("Độ mặn cao");
    else if (sal < THRESHOLDS.SAL_LOW) statuses.push("Độ mặn thấp");
  }

  // pH
  if (ph != null) {
    if (ph > THRESHOLDS.PH_HIGH) statuses.push("pH cao");
    else if (ph < THRESHOLDS.PH_LOW) statuses.push("pH thấp");
  }

  // Nhiệt độ
  if (temp != null) {
    if (temp > THRESHOLDS.TEMP_HIGH) statuses.push("Nhiệt độ cao");
    else if (temp < THRESHOLDS.TEMP_LOW) statuses.push("Nhiệt độ thấp");
  }

  // Pin
<<<<<<< HEAD
  if (bat != null && bat <= THRESHOLDS.BAT_LOW) statuses.push("Pin yếu");
=======
  if (bat != null && bat < THRESHOLDS.BAT_LOW) statuses.push("Pin yếu");
>>>>>>> 05601b8cf60beba4f7133b7e4b310ac1692fdeea

  // Nếu không có cảnh báo nào
  statusEl.textContent = statuses.length ? statuses.join(" • ") : "Bình thường";
}



// =====================
// Alert helpers (✅ TOP-LEVEL để không bị mất scope)
// =====================
function linkDevice(id, name) {
  const href = `device.html?device=${encodeURIComponent(id)}`;
  return `<a class="alert-link" href="${href}">${name}</a>`;
}

function joinDeviceLinks(items) {
  return items.map((x) => linkDevice(x.id, x.name)).join(", ");
}

function setAlertLine(elId, label, htmlMessage) {
  const el = document.getElementById(elId);
  if (!el) return;

  // Không có cảnh báo => ẩn dòng
  if (!htmlMessage || !String(htmlMessage).trim()) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  el.style.display = "flex";
  el.innerHTML = `
    <span class="alert-tag">${label}</span>
    <span class="alert-msg">${htmlMessage}</span>
  `;
}

function buildTwoSideMessage(highItems, lowItems, highText, lowText) {
  const parts = [];
  if (highItems.length) parts.push(`${joinDeviceLinks(highItems)} ${highText}`);
  if (lowItems.length) parts.push(`${joinDeviceLinks(lowItems)} ${lowText}`);
  return parts.join("; ");
}

// =====================
// Alert bar 4 dòng
// =====================
function renderFourLineAlertBars() {
  const salHigh = [];
  const salLow = [];
  const phHigh = [];
  const phLow = [];
  const batLow = [];
  const offline = [];

  allDevices.forEach((d) => {
    const latest = latestMap.get(d.id);
    if (!latest) return;

    if (isOfflineFromLatest(latest, THRESHOLDS.OFFLINE_MINUTES)) {
      offline.push({ id: d.id, name: d.name });
      return;
    }

    const sal = safeNum(latest.salinity, null);
    const ph = safeNum(latest.ph, null);
    const bat = safeNum(latest.batteryPct, null);

    if (sal != null) {
      if (sal > THRESHOLDS.SAL_HIGH) salHigh.push({ id: d.id, name: d.name });
      else if (sal < THRESHOLDS.SAL_LOW) salLow.push({ id: d.id, name: d.name });
    }

    if (ph != null) {
      if (ph > THRESHOLDS.PH_HIGH) phHigh.push({ id: d.id, name: d.name });
      else if (ph < THRESHOLDS.PH_LOW) phLow.push({ id: d.id, name: d.name });
    }

<<<<<<< HEAD
    if (bat != null && bat <= THRESHOLDS.BAT_LOW) {
=======
    if (bat != null && bat < THRESHOLDS.BAT_LOW) {
>>>>>>> 05601b8cf60beba4f7133b7e4b310ac1692fdeea
      batLow.push({ id: d.id, name: d.name });
    }
  });

  const salMsg = buildTwoSideMessage(
    salHigh,
    salLow,
    "đang có độ mặn cao",
    "đang có độ mặn thấp"
  );
  setAlertLine("alertSalinity", "Độ mặn", salMsg ? `${salMsg}.` : "");

  const phMsg = buildTwoSideMessage(
    phHigh,
    phLow,
    "đang có pH cao",
    "đang có pH thấp"
  );
  setAlertLine("alertPh", "pH", phMsg ? `${phMsg}.` : "");

  const batMsg = batLow.length
<<<<<<< HEAD
    ? `${joinDeviceLinks(batLow)} pin còn \u2264 ${THRESHOLDS.BAT_LOW}%.`
=======
    ? `${joinDeviceLinks(batLow)} pin còn dưới ${THRESHOLDS.BAT_LOW}%.`
>>>>>>> 05601b8cf60beba4f7133b7e4b310ac1692fdeea
    : "";
  setAlertLine("alertBattery", "Pin", batMsg);

  const offMsg = offline.length
    ? `${joinDeviceLinks(offline)} đã ngắt kết nối.`
    : "";
  setAlertLine("alertOffline", "Offline", offMsg);
}

// =====================
// Map sync: window.devices for map.js
// =====================
function syncDevicesForMap() {
  window.devices = allDevices.map((d) => {
    const latest = latestMap.get(d.id);

    const offlineFlag = isOfflineFromLatest(latest, THRESHOLDS.OFFLINE_MINUTES);

    const sal = safeNum(latest?.salinity, null);
    const bat = safeNum(latest?.batteryPct, null);
    const temp = safeNum(latest?.temperature, null);
    const ph = safeNum(latest?.ph, null);

    const salinityAbnormal =
      sal != null && (sal > THRESHOLDS.SAL_HIGH || sal < THRESHOLDS.SAL_LOW);

<<<<<<< HEAD
    const batteryLow = bat != null && bat <= THRESHOLDS.BAT_LOW;
=======
    const batteryLow = bat != null && bat < THRESHOLDS.BAT_LOW;
>>>>>>> 05601b8cf60beba4f7133b7e4b310ac1692fdeea

    const lastOnline =
      latest?.updatedAt?.toDate
        ? latest.updatedAt.toDate()
        : latest?.measuredAt?.toDate
        ? latest.measuredAt.toDate()
        : latest?.updatedAt || latest?.measuredAt || null;

    return {
      id: d.id,
      name: d.name,
      location: d.location || d.name,
      lat: d.lat,
      lng: d.lng,
      salinity: sal ?? 0,
      temperature: temp ?? 0,
      ph: ph ?? 0,
      battery: bat ?? 0,
      lastOnline: lastOnline || new Date(0),
      offline: !!offlineFlag,
      salinityAbnormal: !!salinityAbnormal,
      batteryLow: !!batteryLow,
    };
  });
}

// =====================
// Dashboard update
// =====================
async function updateDashboard() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return;

  updateStationHeader(deviceId);
  updateDetailLink(deviceId);

  await fetchAllLatest();
  await updateKpisForSelected(deviceId);
  await renderIndexMainChart(deviceId);

  // ✅ alerts
  renderFourLineAlertBars();

  // ✅ map refresh
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
  await fetchAllLatest();
  syncDevicesForMap();
  if (typeof window.initMap === "function") {
    window.initMap();
  }

  $("deviceSelect")?.addEventListener("change", updateDashboard);
  $("timeRange")?.addEventListener("change", updateDashboard);

  await updateDashboard();

  setInterval(() => {
    updateDashboard().catch(() => {});
  }, 60 * 1000);
});