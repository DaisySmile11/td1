// assets/js/data.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firebase config
export const firebaseConfig = {
  apiKey: "AIzaSyCsnaMLFs_QkO82sNo6_occGQfjpuGyjVs",
  authDomain: "esp32-iot-demo-temphumi.firebaseapp.com",
  databaseURL:
    "https://esp32-iot-demo-temphumi-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "esp32-iot-demo-temphumi",
  storageBucket: "esp32-iot-demo-temphumi.firebasestorage.app",
  messagingSenderId: "843392659912",
  appId: "1:843392659912:web:b8c2e674de0ff989b990fd",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * ✅ CHỖ ĐỔI TÊN HIỂN THỊ + TỌA ĐỘ THIẾT BỊ
 * - key = deviceId trong Firestore
 * - name = tên hiển thị
 * - lat/lng = toạ độ thật
 */
export const DEVICE_OVERRIDES = {
  bien_hoa: { name: "Biên Hòa", lat: 10.9574, lng: 106.8427 },
  binh_duong: { name: "Bình Dương", lat: 11.3254, lng: 106.477 },
  HoChiMinh_city: { name: "Hồ Chí Minh", lat: 10.8231, lng: 106.6297 },

  // demo
  demo_1: { name: "Demo Long Xuyên", lat: 10.391895, lng: 105.431071 },
  demo_2: { name: "Demo Cần Thơ", lat: 10.066987, lng: 105.777952 },
  demo_wifi_1: { name: "Demo Bạc Liêu", lat: 9.20759, lng: 105.741604 },
  demo_wifi_2: { name: "Demo Rạch Giá", lat: 10.00988, lng: 105.070804 },
};

export const THRESHOLDS = {
  // Độ mặn (‰)
  // ✅ Ngưỡng: 8‰ - 12‰
  SAL_HIGH: 12,
  SAL_LOW: 8,

  // Pin (%)
  BAT_LOW: 20,

  // Nhiệt độ (°C)
  // ✅ Ngưỡng: 25°C - 32°C
  TEMP_LOW: 25,
  TEMP_HIGH: 32,

  // pH
  PH_HIGH: 8.5,
  PH_LOW: 6.5,

  // Offline
  OFFLINE_MINUTES: 10, // 10 phút không gửi tín hiệu sẽ báo offline
};

// =====================
// Helpers
// =====================
export function qs(name, fallback = null) {
  const params = new URLSearchParams(location.search);
  return params.get(name) ?? fallback;
}

export function safeNum(x, fallback = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtDateTime(v) {
  if (!v) return "--";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

export function fmtHM(v) {
  if (!v) return "--";
  const d = v?.toDate ? v.toDate() : new Date(v);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function prettifyId(id) {
  return String(id || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getDeviceMeta(deviceId, firestoreDeviceDoc = {}) {
  const o = DEVICE_OVERRIDES[deviceId] || {};
  const name =
    o.name ||
    firestoreDeviceDoc.name ||
    firestoreDeviceDoc.displayName ||
    prettifyId(deviceId);

  const location =
    firestoreDeviceDoc.location ||
    firestoreDeviceDoc.locationText ||
    o.name ||
    "";

  const lat =
    typeof o.lat === "number"
      ? o.lat
      : typeof firestoreDeviceDoc.lat === "number"
      ? firestoreDeviceDoc.lat
      : typeof firestoreDeviceDoc.latitude === "number"
      ? firestoreDeviceDoc.latitude
      : null;

  const lng =
    typeof o.lng === "number"
      ? o.lng
      : typeof firestoreDeviceDoc.lng === "number"
      ? firestoreDeviceDoc.lng
      : typeof firestoreDeviceDoc.longitude === "number"
      ? firestoreDeviceDoc.longitude
      : null;

  return { id: deviceId, name, location, lat, lng };
}

export function isOfflineFromLatest(latest, offlineMinutes = THRESHOLDS.OFFLINE_MINUTES) {
  if (!latest) return true;

  // if backend explicitly marks OFFLINE
  const st = String(latest.status || "").toUpperCase();
  if (st === "OFFLINE") return true;

  const t = latest.updatedAt ?? latest.measuredAt ?? null;
  if (!t) return false;

  const d = t?.toDate ? t.toDate() : new Date(t);
  return Date.now() - d.getTime() > offlineMinutes * 60 * 1000;
}

// Trạng thái tổng hợp (dùng cho bảng/list nếu cần)
export function deviceStatus(latest) {
  if (isOfflineFromLatest(latest)) return "offline";

  const sal = safeNum(latest?.salinity, null);
  if (sal != null && (sal > THRESHOLDS.SAL_HIGH || sal < THRESHOLDS.SAL_LOW))
    return "abnormal-salinity";

  const bat = safeNum(latest?.batteryPct, null);
  // ✅ Pin > 20% là bình thường => <= 20% coi là pin yếu
  if (bat != null && bat <= THRESHOLDS.BAT_LOW) return "low-battery";

  const temp = safeNum(latest?.temperature, null);
  if (temp != null && (temp < THRESHOLDS.TEMP_LOW || temp > THRESHOLDS.TEMP_HIGH))
    return "warning-temp";

  const ph = safeNum(latest?.ph, null);
  if (ph != null && (ph < THRESHOLDS.PH_LOW || ph > THRESHOLDS.PH_HIGH))
    return "warning-ph";

  return "normal";
}

export function deviceStatusTextFromLatest(latest) {
  const st = deviceStatus(latest);
  switch (st) {
    case "normal":
      return "Bình thường";
    case "abnormal-salinity":
      return "Độ mặn bất thường";
    case "low-battery":
      return "Pin yếu";
    case "warning-temp":
      return "Nhiệt độ bất thường";
    case "warning-ph":
      return "pH bất thường";
    case "offline":
      return "Offline";
    default:
      return "Không rõ";
  }
}

// Khớp styles.css (nếu bạn có dùng bảng)
export function deviceRowClassFromLatest(latest) {
  const st = deviceStatus(latest);
  if (st === "offline") return "row-offline";
  if (st === "abnormal-salinity") return "row-danger";
  if (st === "low-battery" || st === "warning-temp" || st === "warning-ph") return "row-warning";
  return "row-normal";
}