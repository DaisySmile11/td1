// assets/js/charts.js
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db, safeNum } from "./data.js";

const MAX_READ_DOCS = 1400;
const MAX_PLOT_POINTS = 360;

const BUCKET_5M = 300;
const BUCKET_1H = 3600;

function epochSecNow() {
  return Math.floor(Date.now() / 1000);
}

/** Normalize various timestamp shapes into Date */
function toDateObj(v) {
  if (!v) return null;

  // Firestore Timestamp instance
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate();
  if (typeof v === "object" && typeof v.toMillis === "function") return new Date(v.toMillis());

  // Plain object {seconds, nanoseconds}
  if (typeof v === "object" && v.seconds != null) {
    const sec = Number(v.seconds);
    const ns = Number(v.nanoseconds ?? 0);
    if (!Number.isFinite(sec)) return null;
    const msFromNs = Number.isFinite(ns) ? Math.floor(ns / 1e6) : 0;
    return new Date(sec * 1000 + msFromNs);
  }

  // number/string (sec or ms)
  if (typeof v === "number" || typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // heuristic: seconds < 1e11
    const ms = n < 1e11 ? n * 1000 : n;
    return new Date(ms);
  }

  // already Date
  if (v instanceof Date) return v;

  return null;
}

function fmtLabelByRange(dateObj, rangeSec) {
  if (!dateObj) return "";
  const d = toDateObj(dateObj);
  if (!d) return "";

  // <= 2 ngày -> giờ:phút
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
  const d = toDateObj(v);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

// align window (lag 1 bucket)
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

/**
 * Fetch series from:
 * - readings (raw) for 5m/15m/30m
 * - stats_5m for < 24h (trừ 5/15/30m)
 * - stats_hourly for >= 24h
 */
async function fetchSeries(deviceId, rangeSec, opts = {}) {
  const nowSec = opts.endSec ?? epochSecNow();
  const forced = opts.source ?? null; // "readings" | "5m" | "hourly" | null

  // ===== READINGS =====
  // Force readings when:
  // - forced === "readings"
  // - or range <= 30m (1800s) and caller didn't force otherwise
  const wantReadings = forced === "readings" || (forced == null && rangeSec <= 1800);

  if (wantReadings) {
    // Try measuredAtSec first (recommended)
    const { startSec, endSec } = { startSec: nowSec - rangeSec, endSec: nowSec };
    const want = Math.min(MAX_READ_DOCS, 900);

    try {
      const qR = query(
        collection(db, "devices", deviceId, "readings"),
        where("measuredAtSec", ">=", startSec),
        where("measuredAtSec", "<=", endSec),
        orderBy("measuredAtSec", "asc"),
        limit(want)
      );
      const snap = await getDocs(qR);
      return { rows: snap.docs.map(d => d.data()), mode: "readings" };
    } catch (e) {
      // Fallback: measuredAt (Timestamp) if project uses Timestamp field
      try {
        const startDate = new Date(startSec * 1000);
        const endDate = new Date(endSec * 1000);
        const qR2 = query(
          collection(db, "devices", deviceId, "readings"),
          where("measuredAt", ">=", startDate),
          where("measuredAt", "<=", endDate),
          orderBy("measuredAt", "asc"),
          limit(want)
        );
        const snap2 = await getDocs(qR2);
        return { rows: snap2.docs.map(d => d.data()), mode: "readings" };
      } catch (e2) {
        console.warn("readings query failed:", e, e2);
        return { rows: [], mode: "readings" };
      }
    }
  }

  // ===== HOURLY =====
  const useHourly =
    forced === "hourly"
      ? true
      : forced === "5m"
        ? false
        : (opts.preferHourly ?? (rangeSec >= 86400));

  if (useHourly) {
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

  // ===== 5M STATS =====
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

              // Prefer $times (Date objects)
              const t = items[0].chart?.$times?.[idx] ?? null;
              if (t) return fmtTooltipDateTime(t);

              // Fallback: label
              return items[0].label ?? "";
            },
          },
        },
      },
      stacked: false,
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

  let rangeSec = 86400;
  let source = "hourly";

  if (rangeKey === "last30d") {
    rangeSec = 30 * 86400;
    source = "hourly";
  } else if (rangeKey === "last7d") {
    rangeSec = 7 * 86400;
    source = "hourly";
  } else {
    rangeSec = 24 * 3600;
    source = "hourly";
  }

  const { rows, mode } = await fetchSeries(deviceId, rangeSec, { source });

  const slim = downsampleUniform(rows, MAX_PLOT_POINTS);

  const tArr = slim.map(r => {
    // hourly/5m
    if (r.bucketStart) return toDateObj(r.bucketStart);
    if (r.bucketStartSec != null) return new Date(Number(r.bucketStartSec) * 1000);
    return null;
  }).filter(Boolean);

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
  if (note) note.textContent = `Biểu đồ lấy dữ liệu thật từ Firestore (${mode}).`;
}

// ===== DEVICE DETAIL PAGE =====
export async function renderDeviceDetailChart(deviceId, rangeSec) {
  const canvas = document.getElementById("detailChart");
  if (!canvas) return;

  const rs = Number(rangeSec);
  const safeRangeSec = Number.isFinite(rs) ? rs : 86400;

  // ✅ 5m / 15m / 30m => readings
  // <24h (trừ 5/15/30) => stats_5m
  // >=24h => stats_hourly
  let source = null;
  if (safeRangeSec <= 1800) source = "readings";
  else if (safeRangeSec >= 86400) source = "hourly";
  else source = "5m";

  const { rows, mode } = await fetchSeries(deviceId, safeRangeSec, { source });

  const slim = downsampleUniform(rows, MAX_PLOT_POINTS);

  // Build time array based on mode
  let tArr = [];
  if (mode === "readings") {
    tArr = slim.map(r => {
      // Prefer measuredAtSec (seconds)
      if (r.measuredAtSec != null) return new Date(Number(r.measuredAtSec) * 1000);
      // Timestamp or {seconds}
      if (r.measuredAt) return toDateObj(r.measuredAt);
      if (r.timestamp) return toDateObj(r.timestamp);
      if (r.createdAt) return toDateObj(r.createdAt);
      return null;
    }).filter(Boolean);
  } else {
    tArr = slim.map(r => {
      if (r.bucketStart) return toDateObj(r.bucketStart);
      if (r.bucketStartSec != null) return new Date(Number(r.bucketStartSec) * 1000);
      return null;
    }).filter(Boolean);
  }

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