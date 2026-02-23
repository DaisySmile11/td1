// assets/js/device.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** =====================
 * Firebase config (same as A)
 * ===================== */
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

/** =====================
 * Bạn đổi tên hiển thị ở đây
 * ===================== */
const DEVICE_META = {
  bien_hoa: { name: "Biên Hòa" },
  binh_duong: { name: "Bình Dương" },
  HoChiMinh_city: { name: "Hồ Chí Minh" },

  demo_1: { name: "demo_1" },
  demo_2: { name: "demo_2" },
  demo_wifi_1: { name: "demo_wifi_1" },
  demo_wifi_2: { name: "demo_wifi_2" },
};

function prettifyId(id) {
  return String(id || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function getDeviceDisplayName(id) {
  return DEVICE_META?.[id]?.name || prettifyId(id);
}

/** =====================
 * Config chart aligned giống A
 * ===================== */
const MAX_READ_DOCS = 500;
const MAX_PLOT_POINTS = 300;
const BUCKET_5M = 300;
const BUCKET_1H = 3600;

const $ = (id) => document.getElementById(id);

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function epochSecNow() {
  return Math.floor(Date.now() / 1000);
}
function fmtTime(v) {
  if (!v) return "--";
  const d = v.toDate ? v.toDate() : new Date(v);
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}
function fmtHM(v) {
  if (!v) return "--";
  const d = v.toDate ? v.toDate() : new Date(v);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function downsampleUniform(rowsAsc, maxPlot) {
  if (rowsAsc.length <= maxPlot) return rowsAsc;
  const step = Math.ceil(rowsAsc.length / maxPlot);
  const out = [];
  for (let i = 0; i < rowsAsc.length; i += step) out.push(rowsAsc[i]);
  if (out[out.length - 1] !== rowsAsc[rowsAsc.length - 1]) out.push(rowsAsc[rowsAsc.length - 1]);
  return out;
}

function alignedWindow(nowSec, rangeSec, bucketSec, lagBuckets = 1) {
  const alignedEnd = Math.floor(nowSec / bucketSec) * bucketSec - lagBuckets * bucketSec;
  const alignedStart = alignedEnd - rangeSec + bucketSec;
  return { startSec: alignedStart, endSec: alignedEnd };
}

/** =====================
 * Chart.js
 * ===================== */
let detailChart = null;

function ensureChart() {
  const canvas = $("detailChart");
  if (!canvas) return;

  if (detailChart) return;

  const ctx = canvas.getContext("2d");
  detailChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Độ mặn (‰)",
          data: [],
          borderColor: "rgba(0, 123, 255, 1)",
          backgroundColor: "rgba(0, 123, 255, 0.12)",
          tension: 0.35,
          yAxisID: "y",
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
        {
          label: "Nhiệt độ (°C)",
          data: [],
          borderColor: "rgba(220, 53, 69, 1)",
          backgroundColor: "rgba(220, 53, 69, 0.10)",
          tension: 0.35,
          yAxisID: "y",
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
        {
          label: "pH",
          data: [],
          borderColor: "rgba(34, 197, 94, 1)",
          backgroundColor: "rgba(34, 197, 94, 0.10)",
          tension: 0.35,
          yAxisID: "y3",
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
        {
          label: "Pin (%)",
          data: [],
          borderColor: "rgba(255, 193, 7, 1)",
          backgroundColor: "rgba(255, 193, 7, 0.10)",
          tension: 0.35,
          yAxisID: "y2",
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true } },
      scales: {
        y: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Độ mặn / Nhiệt độ" },
        },
        y2: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          title: { display: true, text: "Pin (%)" },
          grid: { drawOnChartArea: false },
        },
        y3: {
          type: "linear",
          position: "right",
          min: 0,
          max: 14,
          title: { display: true, text: "pH" },
          grid: { drawOnChartArea: false },
          offset: true,
        },
      },
    },
  });
}

function setChart({ labels, sal, temp, ph, bat, hint }) {
  ensureChart();
  if (!detailChart) return;

  detailChart.data.labels = labels;
  detailChart.data.datasets[0].data = sal;
  detailChart.data.datasets[1].data = temp;
  detailChart.data.datasets[2].data = ph;
  detailChart.data.datasets[3].data = bat;

  detailChart.update();
  if ($("detailChartHint")) $("detailChartHint").textContent = hint || "--";
}

/** =====================
 * UI helpers
 * ===================== */
function setUrlDevice(deviceId) {
  const u = new URL(location.href);
  u.searchParams.set("device", deviceId);
  history.replaceState({}, "", u.toString());
}

function updateHeader(deviceId) {
  const title = $("detailTitle");
  const name = getDeviceDisplayName(deviceId);
  if (title) title.textContent = `Chi tiết: ${name} (${deviceId})`;
}

function getRangeSeconds() {
  const v = Number($("detailRange")?.value || 86400);
  return Number.isFinite(v) ? v : 86400;
}

function showError(err) {
  const el = $("detailJson");
  if (!el) return;
  el.textContent =
    "❌ device.js gặp lỗi:\n" +
    (err?.stack || String(err)) +
    "\n\nGợi ý: mở DevTools Console để xem chi tiết.";
}

/** =====================
 * Load device options (có fallback chắc chắn)
 * ===================== */
async function loadDeviceOptions() {
  const sel = $("detailDeviceSelect");
  if (!sel) return;

  sel.innerHTML = "";

  const params = new URLSearchParams(location.search);
  const urlDevice = params.get("device") || "";

  // Try list from Firestore
  let ids = [];
  try {
    const q1 = query(collection(db, "devices"), limit(200));
    const snap = await getDocs(q1);
    ids = snap.docs.map((d) => d.id).filter(Boolean).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    // ignore - will fallback
  }

  // Fallback: meta keys + URL device (đảm bảo luôn có ít nhất 1 option)
  const fallback = new Set(Object.keys(DEVICE_META));
  if (urlDevice) fallback.add(urlDevice);

  const finalIds = ids.length ? ids : Array.from(fallback).sort((a, b) => a.localeCompare(b));

  finalIds.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = getDeviceDisplayName(id);
    sel.appendChild(opt);
  });

  // select by URL if possible
  if (urlDevice && finalIds.includes(urlDevice)) sel.value = urlDevice;
  else if (sel.options.length) sel.selectedIndex = 0;
}

function getSelectedDeviceId() {
  return $("detailDeviceSelect")?.value || "";
}

/** =====================
 * Latest realtime
 * ===================== */
let unsubLatest = null;

function applyLatestToKpis(deviceId, latest) {
  if (!latest) {
    $("dSal").textContent = "-- ‰";
    $("dTemp").textContent = "-- °C";
    $("dPh").textContent = "--";
    $("dBat").textContent = "-- %";
    $("dStatus").textContent = "--";

    $("dSalNote").textContent = "--";
    $("dTempNote").textContent = "--";
    $("dPhNote").textContent = "--";
    $("dBatNote").textContent = "--";
    $("dStatusNote").textContent = "--";

    $("detailUpdated").textContent = "Updated: --";
    $("detailJson").textContent = `Không có dữ liệu latest cho device "${deviceId}".\n\nKiểm tra path:\ndevices/${deviceId}/stats/latest`;
    return;
  }

  const sal = safeNum(latest.salinity, null);
  const temp = safeNum(latest.temperature, null);
  const ph = safeNum(latest.ph, null);
  const bat = safeNum(latest.batteryPct, null);

  const upd = fmtTime(latest.updatedAt ?? latest.measuredAt ?? null);

  $("dSal").textContent = sal == null ? "-- ‰" : `${sal.toFixed(1)} ‰`;
  $("dTemp").textContent = temp == null ? "-- °C" : `${temp.toFixed(1)} °C`;
  $("dPh").textContent = ph == null ? "--" : `${ph.toFixed(2)}`;
  $("dBat").textContent = bat == null ? "-- %" : `${bat.toFixed(0)} %`;

  $("dSalNote").textContent = `Updated: ${upd}`;
  $("dTempNote").textContent = `Updated: ${upd}`;
  $("dPhNote").textContent = `Updated: ${upd}`;
  $("dBatNote").textContent = `Updated: ${upd}`;

  const status = String(latest.status ?? "--").toUpperCase();
  $("dStatus").textContent = status;
  $("dStatusNote").textContent = `Thiết bị: ${deviceId}`;

  $("detailUpdated").textContent = `Updated: ${upd}`;
  $("detailJson").textContent = JSON.stringify(latest, null, 2);
}

function watchLatest(deviceId) {
  if (unsubLatest) unsubLatest();

  const refLatest = doc(db, "devices", deviceId, "stats", "latest");

  unsubLatest = onSnapshot(
    refLatest,
    (snap) => {
      if (!snap.exists()) {
        applyLatestToKpis(deviceId, null);
        return;
      }
      const latest = snap.data();
      applyLatestToKpis(deviceId, latest);

      // Reload chart on latest update
      loadDetailChart(deviceId, getRangeSeconds()).catch(() => {});
    },
    (err) => {
      showError(err);
    }
  );
}

/** =====================
 * Chart data load aligned (stats_5m / stats_hourly)
 * ===================== */
let loading = false;

async function loadDetailChart(deviceId, rangeSeconds) {
  if (loading) return;
  loading = true;

  try {
    const nowSec = epochSecNow();
    const useHourly = rangeSeconds >= 86400;

    if (useHourly) {
      const { startSec, endSec } = alignedWindow(nowSec, rangeSeconds, BUCKET_1H, 1);
      const expect = Math.floor(rangeSeconds / BUCKET_1H);
      const want = Math.min(expect, MAX_READ_DOCS);

      const qH = query(
        collection(db, "devices", deviceId, "stats_hourly"),
        where("bucketStartSec", ">=", startSec),
        where("bucketStartSec", "<=", endSec),
        orderBy("bucketStartSec", "asc"),
        limit(want)
      );

      const snap = await getDocs(qH);
      const rows = snap.docs.map((d) => d.data());

      if (!rows.length) {
        setChart({ labels: [], sal: [], temp: [], ph: [], bat: [], hint: "stats_hourly chưa có dữ liệu." });
        return;
      }

      const slim = downsampleUniform(rows, MAX_PLOT_POINTS);
      const tArr = slim.map((r) => (r.bucketStart ? r.bucketStart : (r.bucketStartSec ? new Date(r.bucketStartSec * 1000) : null)));
      const labels = tArr.map((t) => fmtHM(t));

      setChart({
        labels,
        sal: slim.map((r) => safeNum(r.avgSalinity, null)),
        temp: slim.map((r) => safeNum(r.avgTemperature, null)),
        ph: slim.map((r) => safeNum(r.avgPh, null)),
        bat: slim.map((r) => safeNum(r.avgBatteryPct, null)),
        hint: `Aligned: stats_hourly • docs=${rows.length} (expect=${expect})`,
      });
      return;
    }

    // < 24h => stats_5m
    const { startSec, endSec } = alignedWindow(nowSec, rangeSeconds, BUCKET_5M, 1);
    const expect = Math.floor(rangeSeconds / BUCKET_5M);
    const want = Math.min(expect, MAX_READ_DOCS);

    const q5m = query(
      collection(db, "devices", deviceId, "stats_5m"),
      where("bucketStartSec", ">=", startSec),
      where("bucketStartSec", "<=", endSec),
      orderBy("bucketStartSec", "asc"),
      limit(want)
    );

    const snap = await getDocs(q5m);
    const rows = snap.docs.map((d) => d.data());

    if (!rows.length) {
      setChart({ labels: [], sal: [], temp: [], ph: [], bat: [], hint: "stats_5m chưa có dữ liệu (đợi backend aggregate)." });
      return;
    }

    const slim = downsampleUniform(rows, MAX_PLOT_POINTS);
    const tArr = slim.map((r) => (r.bucketStart ? r.bucketStart : (r.bucketStartSec ? new Date(r.bucketStartSec * 1000) : null)));
    const labels = tArr.map((t) => fmtHM(t));

    setChart({
      labels,
      sal: slim.map((r) => safeNum(r.avgSalinity, null)),
      temp: slim.map((r) => safeNum(r.avgTemperature, null)),
      ph: slim.map((r) => safeNum(r.avgPh, null)),
      bat: slim.map((r) => safeNum(r.avgBatteryPct, null)),
      hint: `Aligned: stats_5m • docs=${rows.length} (expect=${expect})`,
    });
  } catch (e) {
    showError(e);
    if ($("detailChartHint")) $("detailChartHint").textContent = "Không load được chart (Rules/index?).";
  } finally {
    loading = false;
  }
}

/** =====================
 * Boot
 * ===================== */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // set initial UI so bạn biết JS đã chạy
    if ($("detailJson")) $("detailJson").textContent = "Đang kết nối Firestore...";

    await loadDeviceOptions();

    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
      if ($("detailJson")) $("detailJson").textContent = "Không có device để hiển thị.";
      return;
    }

    setUrlDevice(deviceId);
    updateHeader(deviceId);

    // listeners
    $("detailRange")?.addEventListener("change", () => {
      loadDetailChart(getSelectedDeviceId(), getRangeSeconds()).catch(() => {});
    });

    $("detailDeviceSelect")?.addEventListener("change", () => {
      const id = getSelectedDeviceId();
      setUrlDevice(id);
      updateHeader(id);
      watchLatest(id);
      loadDetailChart(id, getRangeSeconds()).catch(() => {});
    });

    // start
    watchLatest(deviceId);
    await loadDetailChart(deviceId, getRangeSeconds());
  } catch (e) {
    showError(e);
  }
});