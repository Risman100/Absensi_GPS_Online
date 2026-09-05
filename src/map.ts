import L from 'leaflet';
import type { GpsCoordinates, OfficeLocation } from './types';

let map: L.Map | null = null;
let userMarker: L.Marker | null = null;
let officeCircle: L.Circle | null = null;
let officeMarker: L.Marker | null = null;
let attendanceMarkers: { type: 'in' | 'out', marker: L.Marker }[] = [];
let currentTileLayer: L.TileLayer | null = null;

const userIcon = L.divIcon({
  className: '',
  html: `<div class="map-user-pin">
    <div class="map-user-pin__dot"></div>
    <div class="map-user-pin__ring"></div>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const officeIcon = L.divIcon({
  className: '',
  html: `<div class="map-office-pin">🏢</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const clockInIcon = L.divIcon({
  className: '',
  html: `<div class="map-record-pin map-record-pin--in">▲</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const clockOutIcon = L.divIcon({
  className: '',
  html: `<div class="map-record-pin map-record-pin--out">▼</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export function initMap(containerId: string, office: OfficeLocation): void {
  if (map) return;

  const lat = (!office || typeof office.latitude !== 'number' || isNaN(office.latitude)) ? -6.2115 : office.latitude;
  const lng = (!office || typeof office.longitude !== 'number' || isNaN(office.longitude)) ? 106.8335 : office.longitude;
  const radius = (!office || typeof office.radius !== 'number' || isNaN(office.radius) || office.radius <= 0) ? 200 : office.radius;
  const name = office?.name || 'Kantor Pusat';

  console.log('[DEBUG] initMap center:', lat, lng, 'radius:', radius);

  map = L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
  }).setView([lat, lng], 16);

  const isLight = document.documentElement.classList.contains('light-theme');
  const themeUrl = isLight 
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2y3t_1_c2ac00cfdabbebeac1836a5b'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2y3t_1_c2ac00cfdabbebeac1836a5b';

  currentTileLayer = L.tileLayer(themeUrl, {
    maxZoom: 19,
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Office location circle
  officeCircle = L.circle([lat, lng], {
    radius: radius,
    color: '#4f8ef7',
    fillColor: '#4f8ef7',
    fillOpacity: 0.12,
    weight: 2,
    dashArray: '6 4',
  }).addTo(map);

  officeMarker = L.marker([lat, lng], { icon: officeIcon })
    .addTo(map)
    .bindPopup(`<b>${name}</b><br>Radius: ${radius}m`);
}

export function updateUserPosition(gps: GpsCoordinates): void {
  console.log('[DEBUG] updateUserPosition called with gps:', gps);
  if (!map || !gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number' || isNaN(gps.latitude) || isNaN(gps.longitude)) {
    console.error('[DEBUG] Invalid GPS data, aborting updateUserPosition');
    return;
  }
  const latlng: L.LatLngTuple = [gps.latitude, gps.longitude];

  if (userMarker) {
    userMarker.setLatLng(latlng);
  } else {
    userMarker = L.marker(latlng, { icon: userIcon })
      .addTo(map)
      .bindPopup(`<b>Lokasi Anda</b><br>Akurasi: ±${gps.accuracy ? gps.accuracy.toFixed(0) : '0'}m`);
  }
  
  const currentCenter = map.getCenter();
  const size = map.getSize();
  console.log('[DEBUG] Current map center before flyTo:', currentCenter, 'size:', size);
  
  if (isNaN(currentCenter.lat) || isNaN(currentCenter.lng) || size.x === 0 || size.y === 0) {
      console.warn('[DEBUG] Map is hidden or center is NaN! Resetting view to prevent crash.');
      map.setView(latlng, 17, { animate: false });
  } else {
      map.flyTo(latlng, 17, { animate: true, duration: 1.2 });
  }
}

export function addAttendanceMarker(
  gps: GpsCoordinates,
  type: 'in' | 'out',
  label: string
): void {
  if (!map || !gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number' || isNaN(gps.latitude) || isNaN(gps.longitude)) return;
  const icon = type === 'in' ? clockInIcon : clockOutIcon;
  const marker = L.marker([gps.latitude, gps.longitude], { icon })
    .addTo(map)
    .bindPopup(`<b>${label}</b><br>${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`);
  attendanceMarkers.push({ type, marker });
}

export function clearAttendanceMarkers(): void {
  attendanceMarkers.forEach(m => m.marker.remove());
  attendanceMarkers = [];
}

export function updateOfficeLocation(office: OfficeLocation): void {
  if (!map || !office) return;
  const lat = (typeof office.latitude !== 'number' || isNaN(office.latitude)) ? -6.2115 : office.latitude;
  const lng = (typeof office.longitude !== 'number' || isNaN(office.longitude)) ? 106.8335 : office.longitude;
  const radius = (typeof office.radius !== 'number' || isNaN(office.radius) || office.radius <= 0) ? 200 : office.radius;
  const latlng: L.LatLngTuple = [lat, lng];

  console.log('[DEBUG] updateOfficeLocation center:', lat, lng);
  
  officeCircle?.setLatLng(latlng).setRadius(radius);
  officeMarker?.setLatLng(latlng);
  officeMarker?.setPopupContent(`<b>${office.name || 'Kantor Pusat'}</b><br>Radius: ${radius}m`);
  
  const currentCenter = map.getCenter();
  const size = map.getSize();
  if (isNaN(currentCenter.lat) || isNaN(currentCenter.lng) || size.x === 0 || size.y === 0) {
      map.setView(latlng, 16, { animate: false });
  } else {
      map.flyTo(latlng, 16, { animate: true, duration: 1.0 });
  }
}

export function resizeMap(): void {
  map?.invalidateSize();
}

export function getMap(): L.Map | null {
  return map;
}

export function focusMapMarker(type: 'user' | 'office' | 'in' | 'out'): void {
  if (!map) return;
  if (type === 'user' && userMarker) {
    map.flyTo(userMarker.getLatLng(), 18, { animate: true, duration: 1.0 });
    userMarker.openPopup();
  } else if (type === 'office' && officeMarker) {
    map.flyTo(officeMarker.getLatLng(), 17, { animate: true, duration: 1.0 });
    officeMarker.openPopup();
  } else if (type === 'in' || type === 'out') {
    const found = attendanceMarkers.find(m => m.type === type);
    if (found) {
      map.flyTo(found.marker.getLatLng(), 18, { animate: true, duration: 1.0 });
      found.marker.openPopup();
    }
  }
}

export function updateMapTheme(isLight: boolean): void {
  if (!map) return;
  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
  }
  const themeUrl = isLight 
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2y3t_1_c2ac00cfdabbebeac1836a5b'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2y3t_1_c2ac00cfdabbebeac1836a5b';
    
  currentTileLayer = L.tileLayer(themeUrl, { maxZoom: 19 }).addTo(map);
}

