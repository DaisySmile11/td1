// assets/js/map.js
// Leaflet map for devices (works with type="module").
// Expects window.devices = [{id,name,location,lat,lng,salinity,temperature,battery,lastOnline}, ...]
// app.js will set window.devices and then call window.initMap() / window.refreshDeviceMarkers()

let mapInstance;
let deviceMarkers = [];

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

  refreshDeviceMarkers();
}

function clearMarkers() {
  if (!mapInstance) return;
  deviceMarkers.forEach((m) => mapInstance.removeLayer(m));
  deviceMarkers = [];
}

// simple status color (can improve later)
function getMarkerColor(device) {
  // if app.js later fills battery/salinity/temp, you can color here
  // fallback: red dot
  return "#dc2626";
}

function refreshDeviceMarkers() {
  if (!mapInstance) return;

  clearMarkers();

  const devices = Array.isArray(window.devices) ? window.devices : [];
  devices.forEach((d) => {
    const color = getMarkerColor(d);

    const marker = L.circleMarker([d.lat, d.lng], {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.9,
    });

    const popupHtml = `
      <div style="font-size:0.85rem;">
        <strong>${d.name || d.id}</strong><br/>
        ${d.location ? `Vị trí: ${d.location}<br/>` : ""}
        ${Number.isFinite(Number(d.salinity)) ? `Độ mặn: ${Number(d.salinity).toFixed(1)}‰<br/>` : ""}
        ${Number.isFinite(Number(d.temperature)) ? `Nhiệt độ: ${Number(d.temperature).toFixed(1)}°C<br/>` : ""}
        ${Number.isFinite(Number(d.battery)) ? `Pin: ${Number(d.battery).toFixed(0)}%<br/>` : ""}
      </div>
    `;

    marker.bindPopup(popupHtml);

    // Click marker -> select device in dropdown
    marker.on("click", () => {
      const select = document.getElementById("deviceSelect");
      if (select) {
        select.value = d.id;
        select.dispatchEvent(new Event("change"));
      }
    });

    marker.addTo(mapInstance);
    deviceMarkers.push(marker);
  });
}

// IMPORTANT: expose to window so app.js can call
window.initMap = initMap;
window.refreshDeviceMarkers = refreshDeviceMarkers;