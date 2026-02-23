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

import { renderDeviceDetailChart } from "./charts.js";

const $ = (id) => document.getElementById(id);

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

  if (bat != null && bat < THRESHOLDS.BAT_LOW) parts.push("Pin yếu");

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
}

document.addEventListener("DOMContentLoaded", async () => {
  await populateDeviceSelect();

  $("detailDeviceSelect")?.addEventListener("change", reloadDetail);
  $("detailRange")?.addEventListener("change", reloadDetail);

  await reloadDetail();
});