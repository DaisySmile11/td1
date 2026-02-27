// assets/js/device.js
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  db,
  THRESHOLDS,
  safeNum,
  fmtDateTime,
  getDeviceMeta,
  isOfflineFromLatest,
} from "./data.js";

import { renderDeviceDetailChart, fetchDeviceSeries } from "./charts.js";

const $ = (id) => document.getElementById(id);

// =====================
// Detail table (history)
// =====================
const historyCache = new Map(); // key: `${deviceId}:${rangeSec}` => normalizedRows
let currentSort = { key: "colDateTime", order: "desc" };

function toDateObj(v) {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return "--";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtTime(d) {
  if (!d) return "--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mi}:${ss}`;
}

function normalizeSeriesRows(rows = []) {
  return rows
    .map((r) => {
      const t =
        r.bucketStart ||
        (r.bucketStartSec ? new Date(r.bucketStartSec * 1000) : null) ||
        r.measuredAt ||
        r.updatedAt ||
        null;

      const d = toDateObj(t);
      const sal = safeNum(r.avgSalinity ?? r.salinity ?? null, null);
      const ph = safeNum(r.avgPh ?? r.ph ?? null, null);
      const temp = safeNum(r.avgTemperature ?? r.temperature ?? null, null);
      // Voltage field in Firestore is batteryVolt (per user spec)
      const voltCandidate = (
        r.avgBatteryVolt ??
        r.batteryVolt ??
        r.batteryVoltAvg ??
        r.avgBatteryVoltage ??
        r.batteryVoltage ??
        r.avgVoltage ??
        r.voltage ??
        null
      );
      let volt = safeNum(voltCandidate, null);
      // Nếu nguồn aggregate không có volt và trả về 0, coi như thiếu dữ liệu (tránh hiển thị 0.00 gây hiểu lầm)
      if (volt === 0 && voltCandidate == null) volt = null;
      const bat = safeNum(r.avgBatteryPct ?? r.batteryPct ?? null, null);

      return {
        colDateTime: d ? d.getTime() : 0,
        time: fmtTime(d),
        date: fmtDate(d),
        salinity: sal,
        ph,
        temperature: temp,
        voltage: volt,
        battery: bat,
      };
    })
    .filter((x) => x.colDateTime !== 0);
}

function setSortIndicator(activeKey, order) {
  const table = document.getElementById("detailDataTable");
  if (!table) return;

  table.querySelectorAll("th.sortable").forEach((th) => {
    const k = th.getAttribute("data-key");
    if (!k) return;
    if (k === activeKey) th.setAttribute("data-order", order);
    else th.removeAttribute("data-order");
  });
}

function sortRows(rows, key, order) {
  const dir = order === "asc" ? 1 : -1;

  const getVal = (r) => {
    switch (key) {
      case "colTime":
        return r.time;
      case "colDate":
        return r.date;
      case "colSal":
        return r.salinity ?? Number.NEGATIVE_INFINITY;
      case "colPh":
        return r.ph ?? Number.NEGATIVE_INFINITY;
      case "colTemp":
        return r.temperature ?? Number.NEGATIVE_INFINITY;
      case "colVolt":
        return r.voltage ?? Number.NEGATIVE_INFINITY;
      case "colBat":
        return r.battery ?? Number.NEGATIVE_INFINITY;
      default:
        return r.colDateTime;
    }
  };

  return [...rows].sort((a, b) => {
    const va = getVal(a);
    const vb = getVal(b);

    // numbers
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;

    // strings
    return String(va).localeCompare(String(vb), "vi") * dir;
  });
}

function renderHistoryTable(rows) {
  const tbody = document.getElementById("detailTableBody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">Không có dữ liệu trong khoảng thời gian này.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.time }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.date }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.salinity == null ? "--" : r.salinity.toFixed(1) }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.ph == null ? "--" : r.ph.toFixed(2) }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.temperature == null ? "--" : r.temperature.toFixed(1) }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.voltage == null ? "--" : r.voltage.toFixed(2) }));
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: r.battery == null ? "--" : r.battery.toFixed(0) }));
    tbody.appendChild(tr);
  });
}

async function loadHistoryTable(deviceId, rangeSec) {
  const hint = document.getElementById("tableHint");
  if (hint) hint.textContent = "Đang tải...";

  const cacheKey = `${deviceId}:${rangeSec}`;
  let normalized = historyCache.get(cacheKey);

  if (!normalized) {
    const { rows, mode } = await fetchDeviceSeries(deviceId, Number(rangeSec), {
      preferHourly: false,
    });

    normalized = normalizeSeriesRows(rows);
    // Giới hạn tối đa 500 dòng (lấy 500 bản ghi mới nhất)
    if (normalized.length > 500) normalized = normalized.slice(-500);
    historyCache.set(cacheKey, normalized);

    if (hint) hint.textContent = `Nguồn: ${mode} • records=${normalized.length} (max 500)`;
  } else {
    if (hint) hint.textContent = `Cache • records=${normalized.length}`;
  }

  const { key, order } = currentSort;
  const sorted = sortRows(normalized, key, order);
  renderHistoryTable(sorted);
  setSortIndicator(key, order);
}

function bindSortEvents() {
  const table = document.getElementById("detailDataTable");
  if (!table) return;

  table.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", async () => {
      const key = th.getAttribute("data-key");
      if (!key) return;

      // toggle
      if (currentSort.key === key) {
        currentSort.order = currentSort.order === "asc" ? "desc" : "asc";
      } else {
        currentSort.key = key;
        currentSort.order = "asc";
      }

      const deviceId = $("detailDeviceSelect")?.value || "";
      const rangeSec = Number($("detailRange")?.value || "86400");
      await loadHistoryTable(deviceId, rangeSec);
    });
  });
}


async function listDeviceIds() {
  const q1 = query(collection(db, "devices"), limit(200));
  const snap = await getDocs(q1);
  return snap.docs.map((d) => d.id).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function populateDeviceSelect() {
  const sel = $("detailDeviceSelect");
  if (!sel) return;

  sel.innerHTML = "";

  let ids = [];
  try {
    ids = await listDeviceIds();
  } catch (e) {
    // fallback minimal if rules block
    ids = [];
  }

  if (!ids.length) {
    // fallback: dùng list overrides trong data.js
    // (nếu bạn muốn chắc chắn, bạn có thể thêm list cứng ở đây)
    ids = ["bien_hoa", "binh_duong", "HoChiMinh_city"];
  }

  ids.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = getDeviceMeta(id, {}).name;
    sel.appendChild(opt);
  });

  // pick from URL if any
  const params = new URLSearchParams(location.search);
  const urlDevice = params.get("device");
  if (urlDevice && ids.includes(urlDevice)) sel.value = urlDevice;
}

function setDeviceTitle(deviceId) {
  const name = getDeviceMeta(deviceId, {}).name;
  const t = $("detailTitle");
  if (t) t.textContent = `Chi tiết: ${name} (${deviceId})`;
}

function buildRealStatus(latest) {
  if (!latest) return "--";

  if (isOfflineFromLatest(latest, THRESHOLDS.OFFLINE_MINUTES)) return "Offline";

  const parts = [];

  const sal = safeNum(latest.salinity, null);
  const ph = safeNum(latest.ph, null);
  const temp = safeNum(latest.temperature, null);
  const bat = safeNum(latest.batteryPct, null);

  if (sal != null) {
    if (sal > THRESHOLDS.SAL_HIGH) parts.push("Độ mặn cao");
    else if (sal < THRESHOLDS.SAL_LOW) parts.push("Độ mặn thấp");
  }

  if (ph != null) {
    if (ph > THRESHOLDS.PH_HIGH) parts.push("pH cao");
    else if (ph < THRESHOLDS.PH_LOW) parts.push("pH thấp");
  }

  if (temp != null) {
    if (temp > THRESHOLDS.TEMP_HIGH) parts.push("Nhiệt độ cao");
    else if (temp < THRESHOLDS.TEMP_LOW) parts.push("Nhiệt độ thấp");
  }

<<<<<<< HEAD
  // ✅ Pin > 20% là bình thường => <= 20% coi là pin yếu
  if (bat != null && bat <= THRESHOLDS.BAT_LOW) parts.push("Pin yếu");
=======
  if (bat != null && bat < THRESHOLDS.BAT_LOW) parts.push("Pin yếu");
>>>>>>> 05601b8cf60beba4f7133b7e4b310ac1692fdeea

  return parts.length ? parts.join(" • ") : "Bình thường";
}

function applyLatestToUI(deviceId, latest) {
  // values
  const sal = safeNum(latest?.salinity, null);
  const temp = safeNum(latest?.temperature, null);
  const ph = safeNum(latest?.ph, null);
  const bat = safeNum(latest?.batteryPct, null);

  $("dSal").textContent = sal == null ? "-- ‰" : `${sal.toFixed(1)} ‰`;
  $("dTemp").textContent = temp == null ? "-- °C" : `${temp.toFixed(1)} °C`;
  $("dPh").textContent = ph == null ? "--" : `${ph.toFixed(2)}`;
  $("dBat").textContent = bat == null ? "-- %" : `${bat.toFixed(0)} %`;

  // ✅ chỉ giữ note cho độ mặn (VN)
  const updated = fmtDateTime(latest?.updatedAt ?? latest?.measuredAt ?? null);
  $("dSalNote").textContent = `Cập nhật: ${updated}`;

  // ❌ bỏ note cho temp/ph/bat/status
  $("dTempNote").textContent = "";
  $("dPhNote").textContent = "";
  $("dBatNote").textContent = "";
  $("dStatusNote").textContent = "";

  // ✅ status thật
  $("dStatus").textContent = buildRealStatus(latest);

  // ✅ badge trên chart đổi sang VN
  const badge = $("detailUpdated");
  if (badge) badge.textContent = `Cập nhật: ${updated}`;

  // json
  const js = $("detailJson");
  if (js) js.textContent = JSON.stringify(latest ?? {}, null, 2);
}

let unsubLatest = null;

async function reloadDetail() {
  const deviceId = $("detailDeviceSelect")?.value || "";
  const rangeSec = Number($("detailRange")?.value || "86400");

  if (!deviceId) return;

  // update URL
  const params = new URLSearchParams(location.search);
  params.set("device", deviceId);
  history.replaceState({}, "", `${location.pathname}?${params.toString()}`);

  setDeviceTitle(deviceId);

  // subscribe latest
  if (unsubLatest) unsubLatest();
  unsubLatest = onSnapshot(
    doc(db, "devices", deviceId, "stats", "latest"),
    (snap) => {
      const latest = snap.exists() ? snap.data() : null;
      applyLatestToUI(deviceId, latest);
    }
  );

  // initial get latest (for faster first paint)
  const snap = await getDoc(doc(db, "devices", deviceId, "stats", "latest"));
  const latest = snap.exists() ? snap.data() : null;
  applyLatestToUI(deviceId, latest);

  // ✅ render chart using charts.js (FIX MẤT BIỂU ĐỒ)
  await renderDeviceDetailChart(deviceId, rangeSec);
  await loadHistoryTable(deviceId, rangeSec);
}

document.addEventListener("DOMContentLoaded", async () => {
  await populateDeviceSelect();
  bindSortEvents();

  $("detailDeviceSelect")?.addEventListener("change", reloadDetail);
  $("detailRange")?.addEventListener("change", reloadDetail);

  await reloadDetail();
});