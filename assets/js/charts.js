// assets/js/charts.js
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db, fmtHM, safeNum } from "./data.js";

const MAX_READ_DOCS = 1400;
const MAX_PLOT_POINTS = 360;

const BUCKET_5M = 300;
const BUCKET_1H = 3600;
const BUCKET_1D = 86400;

function epochSecNow() {
  return Math.floor(Date.now() / 1000);
}

function fmtLabelByRange(dateObj, rangeSec) {

  if (!dateObj) return "";

  const d = dateObj?.toDate ? dateObj.toDate() : dateObj;

  // 24h (hoặc <= 2 ngày) -> giờ:phút
  if (rangeSec <= 2 * 86400) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // <= 45 ngày -> ngày/tháng
  if (rangeSec <= 45 * 86400) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }

  // > 45 ngày -> tháng/năm
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${yyyy}`;
}


function fmtTooltipDateTime(v) {
  if (!v) return "";
  const d = v?.toDate ? v.toDate() : v;
  // vi-VN dd/mm/yyyy, 24h
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}


// align window (lag 1 bucket như file A)
function alignedWindow(nowSec, rangeSec, bucketSec, lagBuckets = 1) {
  const alignedEnd = Math.floor(nowSec / bucketSec) * bucketSec - (lagBuckets * bucketSec);
  const alignedStart = alignedEnd - rangeSec + bucketSec;
  return { startSec: alignedStart, endSec: alignedEnd };
}

function downsampleUniform(rowsAsc, maxPlot) {
  if (rowsAsc.length <= maxPlot) return rowsAsc;
  const step = Math.ceil(rowsAsc.length / maxPlot);
  const out = [];
  for (let i = 0; i < rowsAsc.length; i += step) out.push(rowsAsc[i]);
  if (out[out.length - 1] !== rowsAsc[rowsAsc.length - 1]) out.push(rowsAsc[rowsAsc.length - 1]);
  return out;
}

// yesterday window theo local time (VN chạy local ok)
function yesterdayWindowSec() {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // start today
  const endSec = Math.floor(d.getTime() / 1000);
  const startSec = endSec - 86400;
  return { startSec, endSec };
}

async function fetchSeries(deviceId, rangeSec, opts = {}) {
  const nowSec = opts.endSec ?? epochSecNow();
  const forced = opts.source ?? null;
  const useHourly = forced === "hourly" ? true : (forced === "5m") ? false : (opts.preferHourly ?? (rangeSec >= 86400));

  if (useHourly) {
    // hourly aligned
    const { startSec, endSec } = alignedWindow(nowSec, rangeSec, BUCKET_1H, 1);
    const want = Math.min(Math.floor(rangeSec / BUCKET_1H) + 3, MAX_READ_DOCS);

    const qH = query(
      collection(db, "devices", deviceId, "stats_hourly"),
      where("bucketStartSec", ">=", startSec),
      where("bucketStartSec", "<=", endSec),
      orderBy("bucketStartSec", "asc"),
      limit(want)
    );

    const snap = await getDocs(qH);
    return { rows: snap.docs.map(d => d.data()), mode: "hourly" };
  }

  // NOTE: stats_daily removed per config; use stats_hourly for long ranges.


  // 5m aligned
  const { startSec, endSec } = alignedWindow(nowSec, rangeSec, BUCKET_5M, 1);
  const want = Math.min(Math.floor(rangeSec / BUCKET_5M) + 3, MAX_READ_DOCS);

  const q5 = query(
    collection(db, "devices", deviceId, "stats_5m"),
    where("bucketStartSec", ">=", startSec),
    where("bucketStartSec", "<=", endSec),
    orderBy("bucketStartSec", "asc"),
    limit(want)
  );

  const snap = await getDocs(q5);
  return { rows: snap.docs.map(d => d.data()), mode: "5m" };
}

function buildChart(ctx, datasets, times = []) {
  const c = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items || !items.length) return "";
              const idx = items[0].dataIndex;
              const t = items[0].chart?.$times?.[idx] ?? null;
              return t ? fmtTooltipDateTime(t) : (items[0].label ?? "");
            },
          },
        },
      },
      stacked: false,
      scales: {
        // trục trái chỉ độ mặn + nhiệt độ
        y: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Độ mặn / Nhiệt độ" },
        },
        // pin
        y2: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          title: { display: true, text: "Pin (%)" },
          grid: { drawOnChartArea: false },
        },
        // pH riêng
        y3: {
          type: "linear",
          position: "right",
          min: 0,
          max: 14,
          title: { display: true, text: "pH" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
  c.$times = Array.isArray(times) ? times : [];
  return c;
}

// ===== INDEX PAGE =====
export async function renderIndexMainChart(deviceId) {
  const canvas = document.getElementById("mainChart");
  if (!canvas) return;

  const timeSel = document.getElementById("timeRange");
  const rangeKey = timeSel?.value ?? "last24h";

  // range config
  let rangeSec = 86400;
  let source = "hourly"; // hourly | daily | 5m

  if (rangeKey === "last30d") {
    rangeSec = 30 * 86400;
    source = "hourly";
  } else if (rangeKey === "last7d") {
    rangeSec = 7 * 86400;
    source = "hourly";
  } else {
    // last24h (default)
    rangeSec = 24 * 3600;
    source = "hourly";
  }

  const { rows, mode } = await fetchSeries(deviceId, rangeSec, { source });

  const slim = downsampleUniform(rows, MAX_PLOT_POINTS);
  const tArr = slim.map(r => r.bucketStart || (r.bucketStartSec ? new Date(r.bucketStartSec * 1000) : null));
  const labels = tArr.map(t => fmtLabelByRange(t, rangeSec));

  const sal = slim.map(r => safeNum(r.avgSalinity ?? r.salinity ?? null, null));
  const temp = slim.map(r => safeNum(r.avgTemperature ?? r.temperature ?? null, null));
  const ph = slim.map(r => safeNum(r.avgPh ?? r.ph ?? null, null));
  const bat = slim.map(r => safeNum(r.avgBatteryPct ?? r.batteryPct ?? null, null));

  if (!window.__mainChart) {
    const ctx = canvas.getContext("2d");
    window.__mainChart = buildChart(ctx, [
      { label: "Độ mặn (‰)", data: [], borderColor: "rgba(0,123,255,1)", backgroundColor: "rgba(0,123,255,0.12)", tension: 0.35, pointRadius: 0, fill: true },
      { label: "Nhiệt độ (°C)", data: [], borderColor: "rgba(220,53,69,1)", backgroundColor: "rgba(220,53,69,0.10)", tension: 0.35, pointRadius: 0, fill: true },
      { label: "pH", data: [], borderColor: "rgba(16,185,129,1)", backgroundColor: "rgba(16,185,129,0.10)", tension: 0.35, pointRadius: 0, fill: true, yAxisID: "y3" },
      { label: "Pin (%)", data: [], borderColor: "rgba(255,193,7,1)", backgroundColor: "rgba(255,193,7,0.10)", tension: 0.35, pointRadius: 0, fill: true, yAxisID: "y2" },
    ], tArr);
  }

  window.__mainChart.$times = tArr;
  window.__mainChart.data.labels = labels;
  window.__mainChart.data.datasets[0].data = sal;
  window.__mainChart.data.datasets[1].data = temp;
  window.__mainChart.data.datasets[2].data = ph;
  window.__mainChart.data.datasets[3].data = bat;
  window.__mainChart.update();

  const note = document.querySelector(".note-pill-text");
  if (note) {
    note.textContent =
      rangeKey === "yesterday"
        ? `Biểu đồ: Hôm qua • nguồn: ${mode}`
        : `Biểu đồ lấy dữ liệu thật từ Firestore (${mode}).`;
  }
}

// ===== DEVICE DETAIL PAGE =====
// rangeSec = số giây (300/900/1800/3600/86400/...)
export async function renderDeviceDetailChart(deviceId, rangeSec) {
  const canvas = document.getElementById("detailChart");
  if (!canvas) return;

  const rs = Number(rangeSec);
  const safeRangeSec = Number.isFinite(rs) ? rs : 86400;

  // <24h dùng 5m; 24h dùng hourly; 7d & 30d dùng daily
  let source = null;
  if (safeRangeSec === 7 * 86400 || safeRangeSec === 30 * 86400) {
    source = "hourly";
  } else if (safeRangeSec >= 86400) {
    source = "hourly";
  } else {
    source = "5m";
  }

  const { rows, mode } = await fetchSeries(deviceId, safeRangeSec, { source });

  const slim = downsampleUniform(rows, MAX_PLOT_POINTS);
  const tArr = slim.map(r => r.bucketStart || (r.bucketStartSec ? new Date(r.bucketStartSec * 1000) : null));
  const labels = tArr.map(t => fmtLabelByRange(t, safeRangeSec));

  const sal = slim.map(r => safeNum(r.avgSalinity ?? r.salinity ?? null, null));
  const temp = slim.map(r => safeNum(r.avgTemperature ?? r.temperature ?? null, null));
  const ph = slim.map(r => safeNum(r.avgPh ?? r.ph ?? null, null));
  const bat = slim.map(r => safeNum(r.avgBatteryPct ?? r.batteryPct ?? null, null));

  if (!window.__detailChart) {
    const ctx = canvas.getContext("2d");
    window.__detailChart = buildChart(ctx, [
      { label: "Độ mặn (‰)", data: [], borderColor: "rgba(0,123,255,1)", backgroundColor: "rgba(0,123,255,0.12)", tension: 0.35, pointRadius: 0, fill: true },
      { label: "Nhiệt độ (°C)", data: [], borderColor: "rgba(220,53,69,1)", backgroundColor: "rgba(220,53,69,0.10)", tension: 0.35, pointRadius: 0, fill: true },
      { label: "pH", data: [], borderColor: "rgba(16,185,129,1)", backgroundColor: "rgba(16,185,129,0.10)", tension: 0.35, pointRadius: 0, fill: true, yAxisID: "y3" },
      { label: "Pin (%)", data: [], borderColor: "rgba(255,193,7,1)", backgroundColor: "rgba(255,193,7,0.10)", tension: 0.35, pointRadius: 0, fill: true, yAxisID: "y2" },
    ], tArr);
  }

  window.__detailChart.$times = tArr;
  window.__detailChart.data.labels = labels;
  window.__detailChart.data.datasets[0].data = sal;
  window.__detailChart.data.datasets[1].data = temp;
  window.__detailChart.data.datasets[2].data = ph;
  window.__detailChart.data.datasets[3].data = bat;
  window.__detailChart.update();

  const hint = document.getElementById("detailChartHint");
  if (hint) hint.textContent = `Nguồn: ${mode} • points=${slim.length}`;
}

// Public helper for device detail table / exports
export async function fetchDeviceSeries(deviceId, rangeSec, opts = {}) {
  return await fetchSeries(deviceId, rangeSec, opts);
}
