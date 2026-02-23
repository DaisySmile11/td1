// assets/js/data.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Firebase config (y hệt file A)
export const firebaseConfig = {
  apiKey: "AIzaSyCsnaMLFs_QkO82sNo6_occGQfjpuGyjVs",
  authDomain: "esp32-iot-demo-temphumi.firebaseapp.com",
  databaseURL: "https://esp32-iot-demo-temphumi-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "esp32-iot-demo-temphumi",
  storageBucket: "esp32-iot-demo-temphumi.firebasestorage.app",
  messagingSenderId: "843392659912",
  appId: "1:843392659912:web:b8c2e674de0ff989b990fd",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * ✅ CHỖ ĐỔI TÊN HIỂN THỊ + TỌA ĐỘ THIẾT BỊ
 * - key = deviceId trong Firestore (VD: "bien_hoa", "binh_duong", "HoChiMinh_city")
 * - name = tên hiển thị
 * - lat/lng = toạ độ thật (để map đúng thành phố)
 *
 * Bạn chỉ cần thêm dòng mới vào đây khi có thiết bị mới.
 */
export const DEVICE_OVERRIDES = {
  bien_hoa: { name: "Biên Hòa", lat: 10.9574, lng: 106.8427 },
  binh_duong: { name: "Bình Dương", lat: 11.3254, lng: 106.4770 },
  HoChiMinh_city: { name: "Hồ Chí Minh", lat: 10.8231, lng: 106.6297 },
  // ví dụ thêm:
  demo_1: { name: "Demo Long Xuyên", lat: 10.391895, lng: 105.431071 },
  demo_2: { name: "Demo Cần Thơ", lat: 10.066987, lng: 105.777952 },
  demo_wifi_1: { name: "Demo Bạc Liêu", lat: 9.207590, lng: 105.741604 },
  demo_wifi_2: { name: "Demo Rạch Giá", lat: 10.009880, lng: 105.070804 },
};

export const THRESHOLDS = {
  
  // Độ mặn (‰)
  SAL_WARN: 30,
  SAL_DANGER: 35,

  // Pin (%)
  BAT_LOW: 20,

  // Nhiệt độ (°C)
  TEMP_LOW: 20,
  TEMP_HIGH: 35,

  // pH
  PH_LOW: 6.5,
  PH_HIGH: 8.5,

  // Offline
  OFFLINE_MINUTES: 10, // 10 phút không gửi tín hiệu sẽ báo offline

};

// Helpers
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
  const d = v.toDate ? v.toDate() : new Date(v);
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

export function fmtHM(v) {
  if (!v) return "--";
  const d = v.toDate ? v.toDate() : new Date(v);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function getDeviceMeta(deviceId, firestoreDeviceDoc = {}) {
  const o = DEVICE_OVERRIDES[deviceId] || {};
  // Ưu tiên override, fallback firestore fields
  const name = o.name || firestoreDeviceDoc.name || firestoreDeviceDoc.displayName || deviceId;
  const location = firestoreDeviceDoc.location || firestoreDeviceDoc.locationText || "";
  const lat =
    typeof o.lat === "number" ? o.lat :
    typeof firestoreDeviceDoc.lat === "number" ? firestoreDeviceDoc.lat :
    typeof firestoreDeviceDoc.latitude === "number" ? firestoreDeviceDoc.latitude :
    null;

  const lng =
    typeof o.lng === "number" ? o.lng :
    typeof firestoreDeviceDoc.lng === "number" ? firestoreDeviceDoc.lng :
    typeof firestoreDeviceDoc.longitude === "number" ? firestoreDeviceDoc.longitude :
    null;

  return { id: deviceId, name, location, lat, lng };
}

export function isOfflineFromLatest(latest, offlineMinutes = THRESHOLDS.OFFLINE_MINUTES) {
  const t = latest?.updatedAt ?? latest?.measuredAt ?? null;
  if (!t) return false;
  const d = t.toDate ? t.toDate() : new Date(t);
  return (Date.now() - d.getTime()) > offlineMinutes * 60 * 1000;
}

// Trạng thái tổng hợp (dùng cho bảng màu dòng)
export function deviceStatus(latest) {
  if (isOfflineFromLatest(latest)) return "offline";

  const bat = safeNum(latest?.batteryPct, null);
  if (bat != null && bat < THRESHOLDS.BAT_LOW) return "low-battery";

  const sal = safeNum(latest?.salinity, null);
  if (sal != null && sal >= THRESHOLDS.SAL_DANGER) return "high-salinity";
  if (sal != null && sal >= THRESHOLDS.SAL_WARN) return "warning-salinity";

  const temp = safeNum(latest?.temperature, null);
  if (temp != null && (temp < THRESHOLDS.TEMP_LOW || temp > THRESHOLDS.TEMP_HIGH)) return "warning-temp";

  const ph = safeNum(latest?.ph, null);
  if (ph != null && (ph < THRESHOLDS.PH_LOW || ph > THRESHOLDS.PH_HIGH)) return "warning-ph";

  return "normal";
}

export function deviceStatusTextFromLatest(latest) {
  const st = deviceStatus(latest);
  switch (st) {
    case "normal": return "Bình thường";
    case "warning-salinity": return "Độ mặn cao nhẹ";
    case "high-salinity": return "Độ mặn cao";
    case "low-battery": return "Pin yếu";
    case "warning-temp": return "Nhiệt độ bất thường";
    case "warning-ph": return "pH bất thường";
    case "offline": return "Offline / mất kết nối";
    default: return "Không rõ";
  }
}

// Khớp styles.css của bạn
export function deviceRowClassFromLatest(latest) {
  const st = deviceStatus(latest);
  if (st === "offline") return "row-offline";
  if (st === "high-salinity") return "row-danger";
  if (st === "warning-salinity" || st === "low-battery" || st === "warning-temp" || st === "warning-ph") return "row-warning";
  return "row-normal";
}