// assets/js/map.js
// Leaflet map for devices (works with type="module").
// Expects window.devices = [{id,name,location,lat,lng,salinity,ph,temperature,battery,lastOnline,offline,salinityAbnormal,batteryLow}, ...]
// app.js will set window.devices and then call window.initMap() / window.refreshDeviceMarkers()

let mapInstance;
let deviceMarkers = [];

// Popup pin state
let pinnedDeviceId = null;
let pinnedMarker = null;

// Init map (Vietnam)
function initMap() {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  if (mapInstance) return; // prevent init twice

  mapInstance = L.map("map").setView([10.8, 106.7], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(mapInstance);

  // Click anywhere on map => unpin popup (close it)
  mapInstance.on("click", () => {
    if (pinnedMarker) {
      pinnedMarker.closePopup();
    }
    pinnedMarker = null;
    pinnedDeviceId = null;
  });

  refreshDeviceMarkers();
}

function clearMarkers() {
  if (!mapInstance) return;

  // If we are about to redraw markers, clear references safely
  pinnedMarker = null;

  deviceMarkers.forEach((m) => mapInstance.removeLayer(m));
  deviceMarkers = [];
}

function getMarkerColor(device) {
  // Rule bạn yêu cầu:
  // xám: offline
  // đỏ: độ mặn bất thường (cao hoặc thấp)
  // vàng: pin yếu
  // xanh lá: active
  if (device?.offline) return "#6b7280";
  if (device?.salinityAbnormal) return "#dc2626";
  if (device?.batteryLow) return "#facc15";
  return "#16a34a";
}

function nf(v, digits = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}

function buildPopupHtml(d) {
  const sal = nf(d.salinity, 1);
  const ph = nf(d.ph, 2);
  const temp = nf(d.temperature, 1);
  const bat = nf(d.battery, 0);

  const detailHref = `device.html?device=${encodeURIComponent(d.id)}`;

  return `
    <div style="font-size:0.85rem; line-height:1.35;">
      <div style="font-weight:800; margin-bottom:4px;">${d.name || d.id}</div>
      ${d.location ? `<div>Vị trí: ${d.location}</div>` : ""}
      ${sal !== null ? `<div>Độ mặn: ${sal}‰</div>` : ""}
      ${ph !== null ? `<div>pH: ${ph}</div>` : ""}
      ${temp !== null ? `<div>Nhiệt độ: ${temp}°C</div>` : ""}
      ${bat !== null ? `<div>Pin: ${bat}%</div>` : ""}
      <div style="margin-top:6px;">
        <a href="${detailHref}" style="font-weight:700; text-decoration:none; border-bottom:1px dashed currentColor;">
          Xem chi tiết
        </a>
      </div>
    </div>
  `;
}

function refreshDeviceMarkers() {
  if (!mapInstance) return;

  clearMarkers();

  const devices = Array.isArray(window.devices) ? window.devices : [];

  devices.forEach((d) => {
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;

    const color = getMarkerColor(d);

    const marker = L.circleMarker([d.lat, d.lng], {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 2,
    });

    const popupHtml = buildPopupHtml(d);

    // Quan trọng:
    // - closeOnClick:false => click chỗ khác mới đóng (mình tự xử lý bằng map click)
    // - autoClose:false => mở popup khác không tự đóng popup đang ghim (mình tự quản)
    marker.bindPopup(popupHtml, {
      closeButton: false,
      closeOnClick: false,
      autoClose: false,
      autoPan: true,
    });

    // 1) Hover => popup hiện tạm (nếu chưa ghim)
    marker.on("mouseover", () => {
      if (pinnedDeviceId && pinnedDeviceId !== d.id) return;
      if (!pinnedDeviceId) marker.openPopup();
    });

    marker.on("mouseout", () => {
      if (pinnedDeviceId === d.id) return; // đang ghim thì không tắt
      marker.closePopup();
    });

    // 2) Click => ghim popup (giữ nguyên)
    marker.on("click", (e) => {
      // tránh click marker bị map click bắt => đóng ngay
      if (e?.originalEvent) e.originalEvent.stopPropagation();

      // nếu đang ghim marker khác => đóng marker cũ trước
      if (pinnedMarker && pinnedMarker !== marker) {
        pinnedMarker.closePopup();
      }

      pinnedDeviceId = d.id;
      pinnedMarker = marker;
      marker.openPopup();
    });

    marker.addTo(mapInstance);
    deviceMarkers.push(marker);

    // 3) Nếu marker này là thiết bị đang ghim => mở lại popup sau khi refresh
    if (pinnedDeviceId && pinnedDeviceId === d.id) {
      pinnedMarker = marker;
      marker.openPopup();
    }
  });
}

// IMPORTANT: expose to window so app.js can call
window.initMap = initMap;
window.refreshDeviceMarkers = refreshDeviceMarkers;