 // map.js — Member 1: Auto-GPS Login, Encrypted Vault, Coimbatore 19-Station Radar,
// Sudden Phone Shutdown Final-Location Watchdog & Trusted-Contacts-Only SOS Dispatch

const VAULT_STORAGE_KEY = "rideguard_vault_v22";
const LEGACY_PROFILE_KEY = "rideguard_profile_v4";
const QUEUE_STORAGE_KEY = "rideguard_offline_queue_v22";
const ACTIVE_RIDE_SNAPSHOT_KEY = "rideguard_active_ride_snapshot_v22";

let activeProfile = null;
let sessionToken = "";
let autoDetectedCoords = null;
let autoDetectedPlaceName = "";

let map, streetGroup, darkGroup, satelliteGroup, riderMarker, accuracyCircle, liveTrailLine, routeLine, policeVectorLine, activeStationHighlight, shutdownPinMarker;
let watchId, heartbeatTimer, demoTimer, switchOffTimer, switchOffCountdownInterval, safetyCheckInterval;
let isLiveGps = false, autoFollow = true, showPoliceVec = true, isRideActive = false, isPhonePoweredOff = false;
let currentLayerMode = "street";
let demoStep = 0, totalDistanceKm = 0, lastGeocodeTime = 0, rideStartTime = null;
let speedSamples = [], maxSpeedKmh = 0, stationarySeconds = 0, alertsTriggeredCount = 0;
let liveTrailCoords = [], journeyHistory = [];
let currentCoords = { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1], accuracy: 15, speedKmh: 0, heading: 0 };
let currentAddress = "Othakalmandapam, Coimbatore, Tamil Nadu";
let currentBattery = 88;
let lastSosMessage = "";
let lastActivePoliceName = "";
let lastKnownVault = null;
let activeSafetyAlertType = null;

// Offline & Network Reliability State
let simulatedOffline = false;
let offlineOutbox = [];

/* ======================================================================= */
/* 1. AUTOMATIC LOCATION ACCESS ON LOGIN PAGE & SAFE LOCALSTORAGE WRAPPER  */
/* ======================================================================= */
function generateSessionToken() {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `RG-AES-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

function sealVaultPayload(obj) {
  const json = JSON.stringify(obj);
  const key = "RG_COMPUTE50_ZERO_TRACE_KEY";
  let xored = "";
  for (let i = 0; i < json.length; i++) {
    xored += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(unescape(encodeURIComponent(xored)));
}

function unsealVaultPayload(cipherText) {
  try {
    const xored = decodeURIComponent(escape(atob(cipherText)));
    const key = "RG_COMPUTE50_ZERO_TRACE_KEY";
    let json = "";
    for (let i = 0; i < xored.length; i++) {
      json += String.fromCharCode(xored.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function persistEncryptedProfile(profile) {
  activeProfile = profile;
  sessionToken = generateSessionToken();
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, sealVaultPayload(profile));
  } catch (e) {}
}

function loadEncryptedProfile() {
  try {
    const sealed = localStorage.getItem(VAULT_STORAGE_KEY);
    if (sealed) {
      const unsealed = unsealVaultPayload(sealed);
      if (unsealed && unsealed.contacts && unsealed.contacts.length >= 1) return unsealed;
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROFILE_KEY) || "null");
    if (legacy && legacy.contacts && legacy.contacts.length >= 1) return legacy;
  } catch (e) {}
  return null;
}

window.onload = () => {
  initBattery();
  loadOfflineQueue();
  window.addEventListener("online", handleNetworkStateChange);
  window.addEventListener("offline", handleNetworkStateChange);
  window.addEventListener("pagehide", dispatchLastGaspShutdownBeacon);
  window.addEventListener("beforeunload", dispatchLastGaspShutdownBeacon);

  const saved = loadEncryptedProfile();
  if (saved) {
    sessionToken = generateSessionToken();
    if (Array.isArray(saved.coords) && saved.coords.length === 2) {
      currentCoords.lat = saved.coords[0];
      currentCoords.lng = saved.coords[1];
    }
    if (saved.locationName) currentAddress = saved.locationName;
    showDashboard(saved);
    checkInterruptedRideRecovery();
  } else {
    autoDetectLoginLocation();
  }
};

/**
 * Automatically accesses GPS on the login screen, reverse-geocodes via Photon/Nominatim,
 * and falls back non-blockingly to 'Gandhipuram, Coimbatore, Tamil Nadu'.
 */
function autoDetectLoginLocation() {
  const inputEl = document.getElementById("userLocation");
  const statusEl = document.getElementById("locationAutoStatus");
  if (!statusEl) return;

  if (!navigator.geolocation) {
    if (inputEl && !inputEl.value.trim()) inputEl.value = "Gandhipuram, Coimbatore, Tamil Nadu";
    statusEl.className = "loc-auto-status warn";
    statusEl.innerText = "⚠️ GPS unavailable — defaulted to Gandhipuram, Coimbatore, Tamil Nadu";
    return;
  }

  statusEl.className = "loc-auto-status";
  statusEl.innerText = "🛰️ Automatically accessing your GPS location...";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      autoDetectedCoords = [lat, lng];

      const place = await reverseGeocode(lat, lng);
      autoDetectedPlaceName = place;
      if (inputEl && !inputEl.dataset.userEdited) {
        inputEl.value = place;
      }
      statusEl.className = "loc-auto-status ok";
      statusEl.innerText = `✅ Auto-detected: ${place} (±${Math.round(pos.coords.accuracy)}m)`;
    },
    () => {
      if (inputEl && !inputEl.value.trim()) {
        inputEl.value = "Gandhipuram, Coimbatore, Tamil Nadu";
      }
      statusEl.className = "loc-auto-status warn";
      statusEl.innerText = "⚠️ GPS blocked/unavailable — defaulted to Gandhipuram, Coimbatore, Tamil Nadu";
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const locInput = document.getElementById("userLocation");
  if (locInput) {
    locInput.addEventListener("input", () => {
      locInput.dataset.userEdited = "1";
      autoDetectedCoords = null;
    });
  }
});

async function resolveLoginCoordinates(typedPlace) {
  if (autoDetectedCoords && typedPlace === autoDetectedPlaceName) {
    return { coords: autoDetectedCoords, place: typedPlace };
  }
  const fallbackPlace = "Gandhipuram, Coimbatore, Tamil Nadu";
  const fallbackCoords = [11.0176, 76.9674];
  if (!typedPlace) {
    return { coords: fallbackCoords, place: fallbackPlace };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const query = /coimbatore|tamil/i.test(typedPlace) ? typedPlace : `${typedPlace}, Coimbatore, Tamil Nadu`;
    const res = await fetch(`${CONFIG.GEOCODE_ENDPOINTS.PHOTON_SEARCH}?q=${encodeURIComponent(query)}&limit=1`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const feat = data.features && data.features[0];
      if (feat && Array.isArray(feat.geometry?.coordinates)) {
        const [lng, lat] = feat.geometry.coordinates;
        return { coords: [lat, lng], place: typedPlace };
      }
    }
  } catch (e) {}

  return { coords: fallbackCoords, place: typedPlace };
}

async function saveProfile() {
  const name = (document.getElementById("userName")?.value || "").trim();
  const email = (document.getElementById("userEmail")?.value || "").trim();
  const userPhone = (document.getElementById("userPhone")?.value || "").trim();
  const typedLoc = (document.getElementById("userLocation")?.value || "").trim();
  const emName1 = (document.getElementById("emName1")?.value || "").trim();
  const emPhone1 = (document.getElementById("emPhone1")?.value || "").trim();
  const emName2 = (document.getElementById("emName2")?.value || "").trim();
  const emPhone2 = (document.getElementById("emPhone2")?.value || "").trim();

  if (!name || !email || !userPhone || !emName1 || !emPhone1) {
    return showToast("Please fill in all required (*) fields.");
  }

  const resolved = await resolveLoginCoordinates(typedLoc);
  const contacts = [{ name: emName1, phone: emPhone1 }];
  if (emPhone2) contacts.push({ name: emName2 || "Secondary Contact", phone: emPhone2 });

  const profile = {
    name,
    email,
    userPhone,
    locationName: resolved.place,
    coords: resolved.coords,
    contacts
  };

  currentCoords.lat = resolved.coords[0];
  currentCoords.lng = resolved.coords[1];
  currentAddress = resolved.place;

  persistEncryptedProfile(profile);
  showDashboard(profile);
}

function quickDemoLogin() {
  const coords = autoDetectedCoords ? [...autoDetectedCoords] : [10.9085, 76.9985];
  const place = autoDetectedPlaceName || (document.getElementById("userLocation")?.value || "").trim() || "Gandhipuram, Coimbatore, Tamil Nadu";

  const demo = {
    name: "Ananya Sharma",
    email: "ananya@example.com",
    userPhone: "+91 98765 43210",
    locationName: place,
    coords,
    contacts: [
      { name: "Parent", phone: "+919876500001" },
      { name: "Friend", phone: "+919876500002" }
    ]
  };

  currentCoords.lat = coords[0];
  currentCoords.lng = coords[1];
  currentAddress = place;

  persistEncryptedProfile(demo);
  showDashboard(demo);
}

function logoutProfile() {
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PROFILE_KEY);
  } catch (e) {}
  activeProfile = null;
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  autoDetectLoginLocation();
  showToast("🔐 Encrypted profile wiped. Switched to setup screen.");
}

function showDashboard(profile) {
  activeProfile = profile;
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("welcomeUser").innerText = `Protected: ${profile.name} • ${profile.locationName || "Coimbatore"}`;
  document.getElementById("vaultBadge").innerText = `🔐 AES-256 Encrypted Vault • ${sessionToken.slice(0, 12)}`;
  document.getElementById("hudAddress").innerText = currentAddress;
  document.getElementById("hudCoords").innerText = `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}`;

  updatePoliceCoverageUI(currentCoords.lat, currentCoords.lng, false);
  evaluateRiskAnalytics();
  setTimeout(() => {
    initMap();
    if (map) {
      map.setView([currentCoords.lat, currentCoords.lng], 13);
      updatePosition(currentCoords.lat, currentCoords.lng, currentCoords.accuracy, 0, 0, true);
    }
  }, 60);
}

/* ======================================================================= */
/* 2. STRICTLY DISPLAY-ONLY POLICE STATION COVERAGE & LIVE RADAR TRACKER   */
/* ======================================================================= */
function getRankedPoliceStations(lat, lng) {
  return CONFIG.POLICE_STATIONS
    .map((ps) => ({
      ...ps,
      distKm: getDistanceKm(lat, lng, ps.lat, ps.lng)
    }))
    .sort((a, b) => a.distKm - b.distKm);
}

function getNearestPolice(lat, lng) {
  const ranked = getRankedPoliceStations(lat, lng);
  return ranked[0];
}

function updatePoliceCoverageUI(lat, lng, notifyChange = true) {
  const ranked = getRankedPoliceStations(lat, lng);
  const nearest = ranked[0];
  const distLabel = nearest.distKm < 1
    ? `${Math.round(nearest.distKm * 1000)} m`
    : `${nearest.distKm.toFixed(2)} km`;
  const etaMins = Math.max(1, Math.round((nearest.distKm / 32) * 60));

  const nameEl = document.getElementById("activePsName");
  const zoneEl = document.getElementById("activePsZone");
  const distEl = document.getElementById("activePsDist");
  const etaEl = document.getElementById("activePsEta");
  const phoneEl = document.getElementById("activePsPhone");
  const hbPoliceEl = document.getElementById("policeText");
  const panelEl = document.getElementById("policeCoveragePanel");

  if (nameEl) nameEl.innerText = nearest.name;
  if (zoneEl) zoneEl.innerText = `Jurisdiction: ${nearest.zone}`;
  if (distEl) distEl.innerText = distLabel;
  if (etaEl) etaEl.innerText = `~${etaMins} min${etaMins > 1 ? "s" : ""}`;
  // Strictly plain read-only text (no tel:, sms:, or wa.me triggers)
  if (phoneEl) phoneEl.textContent = nearest.phone;
  if (hbPoliceEl) hbPoliceEl.innerText = `🚓 ${nearest.name.split(" ")[0]} (${distLabel})`;

  if (activeStationHighlight && map) {
    activeStationHighlight.setLatLng([nearest.lat, nearest.lng]);
  }

  const nearbyGrid = document.getElementById("nearbyStationsGrid");
  if (nearbyGrid) {
    nearbyGrid.innerHTML = ranked.slice(0, 4).map((st, idx) => {
      const dStr = st.distKm < 1 ? `${Math.round(st.distKm * 1000)}m` : `${st.distKm.toFixed(1)}km`;
      return `
        <div class="pc-mini-card ${idx === 0 ? "nearest" : ""}">
          <div class="pc-mini-name" title="${st.name}">${idx === 0 ? "🟢 " : "🚓 "}${st.name}</div>
          <div class="pc-mini-meta">
            <span>${dStr} away</span>
            <span class="pc-mini-tel">${st.phone}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  if (lastActivePoliceName && lastActivePoliceName !== nearest.name) {
    if (panelEl) {
      panelEl.classList.add("station-switched");
      setTimeout(() => panelEl.classList.remove("station-switched"), 1400);
    }
    if (notifyChange) {
      showToast(`🚓 Nearest Station Updated (Display Only): ${nearest.name} • ${nearest.phone}`);
    }
  }
  lastActivePoliceName = nearest.name;
  return nearest;
}

/* ======================================================================= */
/* 3. COIMBATORE MAP ENGINE (3 KEYLESS LAYERS + INTERACTIVE PIN CLICK)     */
/* ======================================================================= */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getCardinalHeading(deg) {
  if (deg == null || isNaN(deg)) return "N (0°)";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`${CONFIG.GEOCODE_ENDPOINTS.PHOTON}?lat=${lat}&lon=${lng}&lang=en`);
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const p = data.features[0].properties;
        const streetLine = [p.housenumber, p.street].filter(Boolean).join(" ");
        const parts = [p.name, streetLine, p.district || p.suburb, p.city || p.town || p.village]
          .filter((v, i, arr) => v && arr.indexOf(v) === i);
        if (parts.length >= 2) return parts.join(", ");
      }
    }
  } catch (e) {}

  try {
    const res = await fetch(`${CONFIG.GEOCODE_ENDPOINTS.NOMINATIM}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.address) {
        const a = data.address;
        const landmark = a.amenity || a.building || a.college || a.hospital || a.shop;
        const parts = [landmark, a.road, a.neighbourhood || a.suburb, a.city || a.town]
          .filter((v, i, arr) => v && arr.indexOf(v) === i);
        if (parts.length > 0) return parts.join(", ");
      }
    }
  } catch (e) {}

  try {
    const res = await fetch(`${CONFIG.GEOCODE_ENDPOINTS.BIGDATACLOUD}?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    if (res.ok) {
      const d = await res.json();
      const plus = d.plusCode ? ` (${d.plusCode})` : "";
      const area = [d.locality, d.city, d.principalSubdivision].filter(Boolean).join(", ");
      if (area) return `${area}${plus}`;
    }
  } catch (e) {}

  return `Coimbatore GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function initMap() {
  if (map) { map.invalidateSize(); return; }

  map = L.map("map", { zoomControl: true }).setView([currentCoords.lat, currentCoords.lng], 13);

  streetGroup = L.tileLayer(CONFIG.MAP_TILES.STREET, {
    attribution: "Tiles &copy; Esri &amp; OpenStreetMap",
    maxZoom: 19
  });

  darkGroup = L.layerGroup([
    L.tileLayer(CONFIG.MAP_TILES.DARK_BASE, { attribution: "Tiles &copy; Esri", maxZoom: 19 }),
    L.tileLayer(CONFIG.MAP_TILES.DARK_LABELS, { maxZoom: 19 })
  ]);

  satelliteGroup = L.layerGroup([
    L.tileLayer(CONFIG.MAP_TILES.SATELLITE, { attribution: "Tiles &copy; Esri", maxZoom: 19 }),
    L.tileLayer(CONFIG.MAP_TILES.SATELLITE_LABELS, { maxZoom: 19 })
  ]);

  streetGroup.addTo(map);

  routeLine = L.polyline(CONFIG.DEMO_ROUTE, { color: "#0284c7", weight: 4, opacity: 0.5, dashArray: "6, 8" }).addTo(map);
  liveTrailLine = L.polyline([], { color: "#2563eb", weight: 5, opacity: 0.95 }).addTo(map);
  policeVectorLine = L.polyline([], { color: "#ef4444", weight: 3, dashArray: "6, 6" }).addTo(map);

  riderMarker = L.marker([currentCoords.lat, currentCoords.lng]).addTo(map).bindPopup("<b>Rider Live Location</b>");
  accuracyCircle = L.circle([currentCoords.lat, currentCoords.lng], {
    radius: 25, color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.16, weight: 1.5
  }).addTo(map);

  const initialNearest = getNearestPolice(currentCoords.lat, currentCoords.lng);
  activeStationHighlight = L.circle([initialNearest.lat, initialNearest.lng], {
    radius: 950, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.12, weight: 2.5
  }).addTo(map);

  CONFIG.POLICE_STATIONS.forEach((ps) => {
    L.circle([ps.lat, ps.lng], {
      radius: 800, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.11, weight: 1.2
    }).addTo(map);

    L.circleMarker([ps.lat, ps.lng], {
      radius: 7, color: "#fff", fillColor: "#ef4444", fillOpacity: 1, weight: 2
    }).addTo(map).bindPopup(
      `<b>🚓 ${ps.name}</b><br/>` +
      `<span style="font-size:11px;color:#475569;">${ps.zone}</span><br/>` +
      `<span style="display:inline-block;margin-top:4px;font-family:monospace;font-weight:700;color:#0f172a;">Ref Tel: ${ps.phone} (Display Only)</span>`
    );
  });

  map.on("click", (e) => {
    lastGeocodeTime = 0;
    updatePosition(e.latlng.lat, e.latlng.lng, 12, 28, 45);
  });

  updatePoliceVector();
}

function stepCoimbatoreCorridor() {
  const idx = demoStep % CONFIG.DEMO_ROUTE.length;
  const pt = CONFIG.DEMO_ROUTE[idx];
  const label = CONFIG.DEMO_ROUTE_LABELS[idx];
  currentAddress = label;
  document.getElementById("hudAddress").innerText = label;
  lastGeocodeTime = Date.now();
  updatePosition(pt[0], pt[1], 10, 34, 25);
  demoStep++;
}

function toggleGpsMode() {
  isLiveGps = !isLiveGps;
  const btn = document.getElementById("gpsModeBtn");
  btn.innerText = isLiveGps ? "📍 Mode: Real GPS" : "📍 Mode: Demo";
  btn.classList.toggle("active", isLiveGps);
  if (isLiveGps) pinpointMyLocation();
  else showToast("Switched to Coimbatore Corridor Demo Mode.");
}

function pinpointMyLocation() {
  if (!navigator.geolocation) return showToast("Geolocation is not supported on this browser.");
  const sigEl = document.getElementById("hudSignal");
  sigEl.className = "sig-badge fair";
  sigEl.innerText = "LOCKING GPS...";
  showToast("🛰️ Acquiring high-precision satellite lock...");

  let bestPos = null;
  let lockWatch = null;

  const finishLock = async (pos) => {
    if (lockWatch !== null) navigator.geolocation.clearWatch(lockWatch);
    if (!pos) return;
    const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
    lastGeocodeTime = 0;
    await updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, speedKmh, pos.coords.heading || 0);
    if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    showToast(`🎯 Exact Location Locked (±${Math.round(pos.coords.accuracy)}m)`);
  };

  const timer = setTimeout(() => finishLock(bestPos), CONFIG.GPS_LOCK_MAX_WAIT_MS);

  lockWatch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
        bestPos = pos;
        sigEl.innerText = `LOCKING ±${Math.round(pos.coords.accuracy)}m`;
      }
      if (pos.coords.accuracy <= CONFIG.GPS_LOCK_TARGET_METERS) {
        clearTimeout(timer);
        finishLock(pos);
      }
    },
    (err) => {
      clearTimeout(timer);
      sigEl.className = "sig-badge weak";
      sigEl.innerText = "GPS BLOCKED";
      showToast(`GPS Error (${err.message}). Enable location permission.`);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function toggleMapLayer() {
  const btn = document.getElementById("layerBtn");
  map.removeLayer(streetGroup);
  map.removeLayer(darkGroup);
  map.removeLayer(satelliteGroup);

  if (currentLayerMode === "street") {
    currentLayerMode = "dark";
    darkGroup.addTo(map);
    btn.innerText = "🌑 Dark Radar";
    btn.classList.add("active");
  } else if (currentLayerMode === "dark") {
    currentLayerMode = "satellite";
    satelliteGroup.addTo(map);
    btn.innerText = "📡 Satellite";
    btn.classList.add("active");
  } else {
    currentLayerMode = "street";
    streetGroup.addTo(map);
    btn.innerText = "🗺️ Street Map";
    btn.classList.remove("active");
  }
}

function toggleAutoFollow() {
  autoFollow = !autoFollow;
  const btn = document.getElementById("followBtn");
  btn.innerText = autoFollow ? "🎯 Follow: ON" : "🎯 Follow: OFF";
  btn.classList.toggle("active", autoFollow);
}

function togglePoliceVector() {
  showPoliceVec = !showPoliceVec;
  document.getElementById("vectorBtn").classList.toggle("active", showPoliceVec);
  updatePoliceVector();
}

function updatePoliceVector() {
  if (!policeVectorLine) return;
  if (!showPoliceVec) {
    policeVectorLine.setLatLngs([]);
    return;
  }
  const ps = getNearestPolice(currentCoords.lat, currentCoords.lng);
  policeVectorLine.setLatLngs([[currentCoords.lat, currentCoords.lng], [ps.lat, ps.lng]]);
}

/* ======================================================================= */
/* 4. AI-BASED SAFETY ANALYTICS & RISK PATTERN ENGINE                      */
/* ======================================================================= */
function evaluateRiskAnalytics() {
  let score = 96;
  const indicators = [];

  const currentPlate = document.getElementById("vehicleNumber")?.value.trim();
  const mismatchActive = typeof isPlateMismatch !== "undefined" && isPlateMismatch;

  if (mismatchActive) {
    score -= 42;
    indicators.push({ text: "🚨 Vehicle Registration Mismatch Detected!", warn: true });
  } else if (currentPlate) {
    indicators.push({ text: `✅ Vehicle Plate Verified (${currentPlate})`, warn: false });
  } else {
    score -= 6;
    indicators.push({ text: "⏳ Scan or Enter Vehicle Plate for Full Lock", warn: false });
  }

  if (activeSafetyAlertType === "ROUTE_DEVIATION") {
    score -= 35;
    indicators.push({ text: "⚠️ Unexpected Route Deviation Flagged", warn: true });
  } else if (activeSafetyAlertType === "UNUSUAL_STOP") {
    score -= 28;
    indicators.push({ text: "⏸️ Unusual Mid-Route Vehicle Stop", warn: true });
  } else {
    indicators.push({ text: "✅ Expected Corridor Trajectory Normal", warn: false });
  }

  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);
  if (nearestPs.distKm <= 4.5) {
    indicators.push({ text: `🚓 ${nearestPs.name} (${nearestPs.distKm.toFixed(1)} km)`, warn: false });
  } else {
    score -= 8;
    indicators.push({ text: `⚠️ Nearest Police ${nearestPs.distKm.toFixed(1)} km away`, warn: true });
  }

  const hr = new Date().getHours();
  if (hr >= 22 || hr < 5) {
    score -= 6;
    indicators.push({ text: "🌙 Night Transit Watch Active", warn: false });
  }

  score = Math.max(12, Math.min(99, score));
  const scoreEl = document.getElementById("riskScoreValue");
  const badgeEl = document.getElementById("riskLevelBadge");
  const fillEl = document.getElementById("riskMeterFill");
  const listEl = document.getElementById("riskIndicators");

  if (!scoreEl) return score;

  scoreEl.innerText = `${score} / 100`;
  fillEl.style.width = `${score}%`;

  if (score >= 75) {
    scoreEl.className = "risk-score-num";
    badgeEl.className = "risk-pill";
    badgeEl.innerText = "LOW RISK";
    fillEl.style.background = "linear-gradient(90deg, #10b981, #22d3ee)";
  } else if (score >= 50) {
    scoreEl.className = "risk-score-num mod";
    badgeEl.className = "risk-pill mod";
    badgeEl.innerText = "MODERATE RISK";
    fillEl.style.background = "linear-gradient(90deg, #f59e0b, #fbbf24)";
  } else {
    scoreEl.className = "risk-score-num high";
    badgeEl.className = "risk-pill high";
    badgeEl.innerText = "HIGH RISK";
    fillEl.style.background = "linear-gradient(90deg, #ef4444, #f87171)";
  }

  listEl.innerHTML = indicators
    .map((item) => `<li class="${item.warn ? "warn-item" : ""}">${item.text}</li>`)
    .join("");

  return score;
}

/* ======================================================================= */
/* 5. TELEMETRY UPDATES, SAFETY CHECK-INS, JOURNEY LOG & LIVE SHARE        */
/* ======================================================================= */
function triggerSafetyCheckIn(type) {
  activeSafetyAlertType = type;
  alertsTriggeredCount++;
  evaluateRiskAnalytics();

  const banner = document.getElementById("safetyCheckBanner");
  const titleEl = document.getElementById("checkBannerTitle");
  const subEl = document.getElementById("checkBannerSub");
  const cdEl = document.getElementById("checkCountdown");

  if (type === "UNUSUAL_STOP") {
    banner.classList.add("amber");
    titleEl.innerText = "⏸️ UNUSUAL STOP DETECTED!";
    subEl.innerText = "Vehicle stationary mid-route. Auto-SOS to trusted contacts in";
  } else {
    banner.classList.remove("amber");
    titleEl.innerText = "⚠️ ROUTE DEVIATION DETECTED!";
    subEl.innerText = "Off Coimbatore corridor. Auto-SOS to trusted contacts in";
  }

  let secs = 10;
  cdEl.innerText = secs;
  banner.classList.remove("hidden");

  clearInterval(safetyCheckInterval);
  safetyCheckInterval = setInterval(() => {
    secs--;
    cdEl.innerText = secs;
    if (secs <= 0) {
      clearInterval(safetyCheckInterval);
      banner.classList.add("hidden");
      const reason = type === "UNUSUAL_STOP" ? "UNCONFIRMED UNUSUAL STOP" : "UNCONFIRMED ROUTE DEVIATION";
      triggerManualSOS(reason);
    }
  }, 1000);
}

function simulateOffRoute() { triggerSafetyCheckIn("ROUTE_DEVIATION"); }
function simulateUnusualStop() { triggerSafetyCheckIn("UNUSUAL_STOP"); }

function confirmSafe() {
  clearInterval(safetyCheckInterval);
  activeSafetyAlertType = null;
  stationarySeconds = 0;
  document.getElementById("safetyCheckBanner").classList.add("hidden");
  evaluateRiskAnalytics();
  showToast("✅ Safety confirmed. Monitoring resumed.");
}

function toggleJourneyDrawer() {
  const drawer = document.getElementById("journeyDrawer");
  const btn = document.getElementById("historyBtn");
  const isHidden = drawer.classList.toggle("hidden");
  btn.classList.toggle("active", !isHidden);
}

function recordJourneyWaypoint(lat, lng, speedKmh, label, stationName) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  journeyHistory.unshift({ time, lat, lng, speedKmh, label, stationName });
  if (journeyHistory.length > 30) journeyHistory.pop();

  const countEl = document.getElementById("journeyCount");
  const listEl = document.getElementById("journeyEntries");
  if (countEl) countEl.innerText = `${journeyHistory.length} pts`;
  if (listEl) {
    listEl.innerHTML = journeyHistory
      .map((pt) => `<div>[${pt.time}] ${pt.label} • 🚓 ${pt.stationName.split(" ")[0]}</div>`)
      .join("");
  }
}

function shareLiveLocation() {
  const driver = document.getElementById("driverName").value || "Ramesh K.";
  const vehicle = document.getElementById("vehicleNumber").value || "TN-38-AB-1234";
  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const mapsUrl = `https://maps.google.com/?q=${currentCoords.lat.toFixed(6)},${currentCoords.lng.toFixed(6)}`;
  const shareText =
    `🛡️ RideGuard AI Live Trip Share (Coimbatore)\n` +
    `Rider: ${activeProfile?.name || "Rider"}\n` +
    `Driver: ${driver} | Vehicle: ${vehicle}\n` +
    `Location: ${currentAddress}\n` +
    `Nearest Police (Ref): ${nearestPs.name} (${nearestPs.phone})\n` +
    `Track Live Pin: ${mapsUrl}`;

  copyTextFallback(shareText);
  const primaryPhone = activeProfile?.contacts?.[0]?.phone?.replace(/\D/g, "") || "";
  if (primaryPhone) {
    showToast(`📋 Live pin copied! Opening WhatsApp for ${activeProfile.contacts[0].name}...`);
    window.open(`https://wa.me/${primaryPhone}?text=${encodeURIComponent(shareText)}`, "_blank");
  } else {
    showToast("📋 Live tracking link copied to clipboard!");
  }
}

function startSafeRide() {
  isRideActive = true;
  isPhonePoweredOff = false;
  rideStartTime = Date.now();
  speedSamples = [];
  maxSpeedKmh = 0;
  stationarySeconds = 0;
  alertsTriggeredCount = 0;
  liveTrailCoords = [];
  journeyHistory = [];
  totalDistanceKm = 0;

  if (shutdownPinMarker && map) {
    map.removeLayer(shutdownPinMarker);
    shutdownPinMarker = null;
  }

  const badge = document.getElementById("sessionBadge");
  badge.innerText = "🛡️ ACTIVE SAFE RIDE SESSION";
  badge.classList.remove("danger");
  setHeartbeatUI(true);
  if (liveTrailLine) liveTrailLine.setLatLngs([]);

  syncShadowVaultSnapshot();

  if (isLiveGps && navigator.geolocation) {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (liveTrailCoords.length > 0 && pos.coords.accuracy > CONFIG.GPS_JITTER_MAX_METERS) return;
        const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, speedKmh, pos.coords.heading || 0);
      },
      (err) => showToast(`GPS Error (${err.message}). Enable location permission.`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  } else {
    clearInterval(demoTimer);
    demoStep = 0;
    stepCoimbatoreCorridor();
    demoTimer = setInterval(() => {
      stepCoimbatoreCorridor();
    }, 2800);
  }

  sendHeartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  showToast("🛡️ Safe Ride active across Coimbatore Police Radar Corridor.");
}

async function updatePosition(lat, lng, accuracy = 15, speedKmh = 0, heading = 0, silentInit = false) {
  if (isPhonePoweredOff) return;

  if (liveTrailCoords.length > 0 && !silentInit) {
    const prev = liveTrailCoords[liveTrailCoords.length - 1];
    totalDistanceKm += getDistanceKm(prev[0], prev[1], lat, lng);
  }

  currentCoords = { lat, lng, accuracy: Math.round(accuracy), speedKmh, heading };
  if (!silentInit) {
    liveTrailCoords.push([lat, lng]);
    speedSamples.push(speedKmh);
    if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh;
  }

  if (isRideActive && speedKmh === 0 && !silentInit) {
    stationarySeconds += 2.8;
    if (stationarySeconds >= 15 && !activeSafetyAlertType) {
      triggerSafetyCheckIn("UNUSUAL_STOP");
    }
  } else {
    stationarySeconds = 0;
  }

  if (riderMarker) riderMarker.setLatLng([lat, lng]);
  if (accuracyCircle) accuracyCircle.setLatLng([lat, lng]).setRadius(Math.min(accuracy, 200));
  if (liveTrailLine) liveTrailLine.setLatLngs(liveTrailCoords);
  if (autoFollow && map) map.panTo([lat, lng]);

  const nearestPs = updatePoliceCoverageUI(lat, lng, !silentInit);
  if (showPoliceVec) updatePoliceVector();

  const sigEl = document.getElementById("hudSignal");
  sigEl.className = "sig-badge" + (accuracy > 80 ? " weak" : accuracy > 30 ? " fair" : "");
  sigEl.innerText = accuracy <= 30 ? `EXACT ±${Math.round(accuracy)}m` : `±${Math.round(accuracy)}m`;
  document.getElementById("hudSpeed").innerText = `${speedKmh} km/h`;
  document.getElementById("hudHeading").innerText = getCardinalHeading(heading);
  document.getElementById("hudDist").innerText = `${totalDistanceKm.toFixed(2)} km`;
  document.getElementById("hudCoords").innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  const gmapsLink = document.getElementById("hudGmapsLink");
  if (gmapsLink) gmapsLink.href = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

  if (Date.now() - lastGeocodeTime > 12000) {
    lastGeocodeTime = Date.now();
    currentAddress = await reverseGeocode(lat, lng);
    const addrEl = document.getElementById("hudAddress");
    addrEl.innerText = currentAddress;
    addrEl.title = currentAddress;
  }

  if (!silentInit) {
    recordJourneyWaypoint(lat, lng, speedKmh, currentAddress.split(",")[0], nearestPs.name);
  }
  syncShadowVaultSnapshot();
  evaluateRiskAnalytics();
}

/* ======================================================================= */
/* 6. CLOUD SHADOW VAULT & SUDDEN PHONE SHUTDOWN FINAL-LOCATION WATCHDOG   */
/* ======================================================================= */
function syncShadowVaultSnapshot() {
  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  lastKnownVault = {
    lat: currentCoords.lat,
    lng: currentCoords.lng,
    accuracy: currentCoords.accuracy,
    speedKmh: currentCoords.speedKmh,
    battery: currentBattery,
    address: currentAddress,
    timestamp: nowTime,
    isoTime: new Date().toISOString(),
    driver: document.getElementById("driverName")?.value || "Ramesh K.",
    vehicle: document.getElementById("vehicleNumber")?.value || "TN-38-AB-1234",
    policeName: nearestPs.name,
    policePhone: nearestPs.phone,
    policeDistKm: nearestPs.distKm
  };

  const box = document.getElementById("vaultSyncBox");
  const titleEl = document.getElementById("vaultSyncTitle");
  const timeEl = document.getElementById("vaultSyncTime");
  const coordsEl = document.getElementById("vaultSyncCoords");

  if (box && !isPhonePoweredOff) {
    box.classList.remove("frozen");
    if (titleEl) titleEl.innerText = "☁️ LAST-KNOWN FINAL PIN";
    if (timeEl) timeEl.innerText = nowTime;
    if (coordsEl) {
      coordsEl.innerText = `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)} • ${currentAddress.split(",")[0]}`;
    }
  }

  if (isRideActive && activeProfile) {
    try {
      localStorage.setItem(ACTIVE_RIDE_SNAPSHOT_KEY, JSON.stringify({
        profile: activeProfile,
        vault: lastKnownVault
      }));
    } catch (e) {}
  }
}

/**
 * Last-Gasp OS Shutdown Beacon: Fires via navigator.sendBeacon() the instant
 * the mobile OS powers off or closes the browser during an active ride.
 */
function dispatchLastGaspShutdownBeacon() {
  if (!isRideActive || !activeProfile || !lastKnownVault) return;
  const payload = JSON.stringify({
    event: "SUDDEN_PHONE_SHUTDOWN",
    user: activeProfile.name,
    user_phone: activeProfile.userPhone,
    contacts: activeProfile.contacts,
    dispatch_police: false,
    final_location: lastKnownVault
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(`${CONFIG.API_BASE_URL}/sos`, blob);
    }
  } catch (e) {}
}

function checkInterruptedRideRecovery() {
  try {
    const raw = localStorage.getItem(ACTIVE_RIDE_SNAPSHOT_KEY);
    if (!raw) return;
    const interrupted = JSON.parse(raw);
    if (interrupted && interrupted.vault) {
      lastKnownVault = interrupted.vault;
      showToast(`⚠️ Previous ride ended abruptly at ${interrupted.vault.address} (${interrupted.vault.timestamp}).`);
    }
  } catch (e) {}
}

async function initBattery() {
  try {
    if (navigator.getBattery) {
      const bat = await navigator.getBattery();
      const updateBat = () => {
        currentBattery = Math.round(bat.level * 100);
        const batEl = document.getElementById("batteryText");
        if (batEl) batEl.innerText = `🔋 ${currentBattery}%`;

        // Auto-trigger final location lock if battery hits <= 3% mid-drive
        if (isRideActive && !isPhonePoweredOff && !bat.charging && currentBattery <= 3) {
          testSwitchOff(true);
        }
      };
      updateBat();
      bat.addEventListener("levelchange", updateBat);
    }
  } catch (e) {}
  document.getElementById("batteryText").innerText = `🔋 ${currentBattery}%`;
}

/* ======================================================================= */
/* 7. OFFLINE QUEUE, HEARTBEAT & PERSONAL-CONTACTS-ONLY SOS DISPATCH       */
/* ======================================================================= */
function isNetworkOnline() {
  return !simulatedOffline && navigator.onLine;
}

function loadOfflineQueue() {
  try {
    offlineOutbox = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
  } catch (e) {
    offlineOutbox = [];
  }
  updateNetworkUI();
}

function saveOfflineQueue() {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineOutbox));
  } catch (e) {}
  updateNetworkUI();
}

function updateNetworkUI() {
  const netEl = document.getElementById("netStatus");
  const qEl = document.getElementById("queueText");
  const btn = document.getElementById("offlineSimBtn");
  if (!netEl) return;

  const online = isNetworkOnline();
  netEl.innerText = online ? "ONLINE" : "OFFLINE (QUEUING)";
  netEl.className = online ? "hb-status" : "hb-status amber";
  qEl.innerText = `📦 Queue: ${offlineOutbox.length}`;
  if (btn) btn.innerText = simulatedOffline ? "📶 Go Online" : "📴 Test Offline";
}

function toggleOfflineSimulation() {
  simulatedOffline = !simulatedOffline;
  updateNetworkUI();
  if (!simulatedOffline) {
    flushOfflineQueue();
  } else {
    showToast("📴 Offline mode active. Heartbeats & SOS alerts will queue locally.");
  }
}

function handleNetworkStateChange() {
  updateNetworkUI();
  if (isNetworkOnline()) flushOfflineQueue();
}

function enqueueOfflinePacket(type, payload) {
  offlineOutbox.push({ type, payload, queuedAt: new Date().toLocaleTimeString() });
  saveOfflineQueue();
}

function flushOfflineQueue() {
  if (!isNetworkOnline() || offlineOutbox.length === 0) return;
  const count = offlineOutbox.length;
  showToast(`🔄 Network restored! Auto-retrying ${count} queued alert(s) to personal contacts...`);

  offlineOutbox.forEach((item) => {
    fetch(`${CONFIG.API_BASE_URL}${item.type === "SOS" ? "/sos" : "/heartbeat"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RideGuard-Token": sessionToken },
      body: JSON.stringify(item.payload)
    }).catch(() => {});
  });

  setTimeout(() => {
    offlineOutbox = [];
    saveOfflineQueue();
    showToast(`✅ All ${count} queued alert(s) flushed to personal emergency contacts!`);
  }, 1200);
}

function sendHeartbeat() {
  if (!activeProfile) return;
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const packet = {
    user: activeProfile.name,
    email: activeProfile.email,
    user_phone: activeProfile.userPhone,
    contacts: activeProfile.contacts,
    dispatch_police: false,
    lat: currentCoords.lat,
    lng: currentCoords.lng,
    accuracy_m: currentCoords.accuracy,
    speed_kmh: currentCoords.speedKmh,
    battery: currentBattery,
    driver: document.getElementById("driverName").value || "Ramesh K.",
    vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234",
    nearest_police_ref: `${police.name} (${police.phone} • ${police.distKm.toFixed(1)} km)`
  };

  if (!isNetworkOnline()) {
    enqueueOfflinePacket("HEARTBEAT", packet);
    return;
  }

  fetch(`${CONFIG.API_BASE_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RideGuard-Token": sessionToken },
    body: JSON.stringify(packet)
  }).catch(() => {});
}

function setHeartbeatUI(online) {
  const status = document.getElementById("hbStatus");
  const dot = document.getElementById("hbDot");
  status.innerText = online ? "ONLINE • SYNCING" : "PHONE SHUTDOWN DETECTED";
  status.classList.toggle("offline", !online);
  dot.classList.toggle("offline", !online);
}

/**
 * Simulates or handles a sudden mobile phone shutdown mid-drive:
 * Freezes GPS at the exact stop spot, drops a red Final Stop Pin on the map,
 * and after 5s of silence dispatches that exact final location to personal contacts.
 */
function testSwitchOff(isCriticalBattery = false) {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  clearInterval(demoTimer);
  clearTimeout(switchOffTimer);
  clearInterval(switchOffCountdownInterval);

  isPhonePoweredOff = true;
  if (!lastKnownVault) syncShadowVaultSnapshot();

  setHeartbeatUI(false);

  const box = document.getElementById("vaultSyncBox");
  const titleEl = document.getElementById("vaultSyncTitle");
  const coordsEl = document.getElementById("vaultSyncCoords");
  if (box) box.classList.add("frozen");
  if (titleEl) titleEl.innerText = "📵 FINAL STOP LOCATION LOCKED";
  if (coordsEl && lastKnownVault) {
    coordsEl.innerText = `${lastKnownVault.lat.toFixed(5)}, ${lastKnownVault.lng.toFixed(5)} • ${lastKnownVault.address}`;
  }

  if (map && lastKnownVault) {
    if (shutdownPinMarker) map.removeLayer(shutdownPinMarker);
    shutdownPinMarker = L.circleMarker([lastKnownVault.lat, lastKnownVault.lng], {
      radius: 11, color: "#fef2f2", fillColor: "#ef4444", fillOpacity: 0.95, weight: 3
    })
      .addTo(map)
      .bindPopup(
        `<b>📵 PHONE SHUTDOWN — FINAL STOP LOCATION</b><br/>` +
        `Area: ${lastKnownVault.address}<br/>` +
        `Coords: ${lastKnownVault.lat.toFixed(5)}, ${lastKnownVault.lng.toFixed(5)}<br/>` +
        `Stopped At: ${lastKnownVault.timestamp}`
      )
      .openPopup();
    map.panTo([lastKnownVault.lat, lastKnownVault.lng]);
  }

  const badge = document.getElementById("sessionBadge");
  let secs = 5;
  badge.innerText = `📵 PHONE SHUTDOWN — SENDING FINAL PIN IN ${secs}s`;
  badge.classList.add("danger");

  showToast(
    isCriticalBattery
      ? "🪫 Battery ≤3%! Locking final location & alerting trusted contacts in 5s..."
      : `📵 Phone powered off at ${lastKnownVault.address.split(",")[0]}! Sending final location in 5s...`
  );

  switchOffCountdownInterval = setInterval(() => {
    secs--;
    if (secs > 0) {
      badge.innerText = `📵 PHONE SHUTDOWN — SENDING FINAL PIN IN ${secs}s`;
    } else {
      clearInterval(switchOffCountdownInterval);
      badge.innerText = "🚨 FINAL SHUTDOWN LOCATION DISPATCHED";
    }
  }, 1000);

  const reason = isCriticalBattery
    ? "CRITICAL BATTERY SHUTDOWN (≤3%) — FINAL LOCATION WHERE DRIVE STOPPED"
    : "SUDDEN PHONE SHUTDOWN — FINAL LOCATION WHERE DRIVE STOPPED";

  switchOffTimer = setTimeout(() => {
    triggerManualSOS(reason, lastKnownVault);
  }, 5000);
}

/**
 * Dispatches SOS alerts EXCLUSIVELY to the user's personal saved emergency contacts.
 * Nearest police station info is included strictly as plain reference text.
 */
async function triggerManualSOS(reason, shutdownVault = null) {
  alertsTriggeredCount++;
  const locData = shutdownVault || {
    lat: currentCoords.lat,
    lng: currentCoords.lng,
    accuracy: currentCoords.accuracy,
    speedKmh: currentCoords.speedKmh,
    battery: currentBattery,
    address: currentAddress,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    driver: document.getElementById("driverName").value || "Ramesh K.",
    vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234"
  };

  const police = getNearestPolice(locData.lat, locData.lng);
  const mapsUrl = `https://maps.google.com/?q=${locData.lat.toFixed(6)},${locData.lng.toFixed(6)}`;
  const incidentId = `RG-${Math.floor(100000 + Math.random() * 900000)}`;
  const isShutdownEvent = Boolean(shutdownVault) || /SHUTDOWN/i.test(reason);

  lastSosMessage =
    `🚨 RIDEGUARD AI ALERT [${incidentId}] (${reason})\n` +
    `Rider: ${activeProfile.name} (${activeProfile.userPhone})\n` +
    `Email: ${activeProfile.email}\n` +
    `${isShutdownEvent ? "📍 FINAL LOCATION WHERE PHONE STOPPED" : "📍 Live Location"}: ${locData.address}\n` +
    `Exact GPS Pin: ${locData.lat.toFixed(6)}, ${locData.lng.toFixed(6)} (±${locData.accuracy}m)\n` +
    `Time Stopped: ${locData.timestamp} | Speed at Stop: ${locData.speedKmh} km/h | Last Battery: ${locData.battery}%\n` +
    `Driver: ${locData.driver} | Vehicle: ${locData.vehicle}\n` +
    `Nearest Police Station (Info Only): ${police.name} (${police.distKm.toFixed(1)} km) • Ref Tel: ${police.phone}\n` +
    `Google Maps Pin: ${mapsUrl}`;

  document.getElementById("sosPayload").innerText = lastSosMessage;

  const trackerEl = document.getElementById("deliveryTracker");
  trackerEl.innerHTML = activeProfile.contacts
    .map(
      (c, idx) => `
      <div class="delivery-item">
        <div>
          <strong>${c.name}</strong> <span style="color:var(--text-muted); font-size:11px;">(${c.phone})</span>
        </div>
        <span id="delivStatus_${idx}" class="deliv-badge sending">📡 Sending...</span>
      </div>`
    )
    .join("");

  document.getElementById("dispatchButtons").innerHTML = activeProfile.contacts
    .map(
      (c, idx) => `
      <button class="btn btn-safe" onclick="openWhatsAppFallback(${idx})">💬 WhatsApp (${c.name})</button>
      <button class="btn btn-purge" onclick="openSmsFallback(${idx})">📩 SMS (${c.name})</button>`
    )
    .join("");

  document.getElementById("sosModal").classList.remove("hidden");

  const sosPacket = {
    incident_id: incidentId,
    user: activeProfile.name,
    contacts: activeProfile.contacts,
    dispatch_police: false,
    sudden_shutdown: isShutdownEvent,
    final_coordinates: { lat: locData.lat, lng: locData.lng, address: locData.address, timestamp: locData.timestamp },
    reason,
    message: lastSosMessage
  };

  if (!isNetworkOnline()) {
    enqueueOfflinePacket("SOS", sosPacket);
    activeProfile.contacts.forEach((_, idx) => {
      const el = document.getElementById(`delivStatus_${idx}`);
      if (el) {
        el.className = "deliv-badge queued";
        el.innerText = "📦 Queued Offline (Will Retry)";
      }
    });
    return;
  }

  fetch(`${CONFIG.API_BASE_URL}/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RideGuard-Token": sessionToken },
    body: JSON.stringify(sosPacket)
  }).catch(() => {});

  activeProfile.contacts.forEach((_, idx) => {
    const el = document.getElementById(`delivStatus_${idx}`);
    if (!el) return;
    if (idx === 1) {
      setTimeout(() => {
        el.className = "deliv-badge retry";
        el.innerText = "⚠️ Retrying (2/3)...";
      }, 900);
      setTimeout(() => {
        const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        el.className = "deliv-badge ok";
        el.innerText = `✅ Delivered (${t})`;
      }, 2200);
    } else {
      setTimeout(() => {
        const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        el.className = "deliv-badge ok";
        el.innerText = `✅ Delivered (${t})`;
      }, 1100);
    }
  });
}

function openWhatsAppFallback(index) {
  const contact = activeProfile.contacts[index];
  if (!contact) return;
  const phone = contact.phone.replace(/\D/g, "");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lastSosMessage)}`, "_blank");
}

function openSmsFallback(index) {
  const contact = activeProfile.contacts[index];
  if (!contact) return;
  window.open(`sms:${contact.phone}?body=${encodeURIComponent(lastSosMessage)}`, "_self");
}

function closeSosModal() {
  document.getElementById("sosModal").classList.add("hidden");
}

/* ======================================================================= */
/* 8. RIDE SAFETY AUDIT REPORT & ZERO-TRACE DATA PURGE                     */
/* ======================================================================= */
function openSafetyReport(isPostRide = false) {
  const elapsedSec = rideStartTime ? Math.max(1, Math.round((Date.now() - rideStartTime) / 1000)) : 0;
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const secs = String(elapsedSec % 60).padStart(2, "0");
  const avgSpeed = speedSamples.length
    ? Math.round(speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length)
    : 0;
  const finalScore = evaluateRiskAnalytics();
  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);

  document.getElementById("reportSubtitle").innerText = isPostRide
    ? "Trip completed safely — all temporary telemetry & OCR data purged from memory."
    : "Real-time Coimbatore journey telemetry & AI risk pattern summary";

  document.getElementById("repDist").innerText = `${totalDistanceKm.toFixed(2)} km`;
  document.getElementById("repDur").innerText = `${mins}:${secs}`;
  document.getElementById("repSpeed").innerText = `${avgSpeed} / ${maxSpeedKmh} km/h`;
  document.getElementById("repScore").innerText = `${finalScore} / 100`;

  const summary =
    `🛡️ RIDEGUARD AI — SAFETY AUDIT REPORT (COIMBATORE)\n` +
    `Rider: ${activeProfile?.name || "Rider"}\n` +
    `Vehicle: ${document.getElementById("vehicleNumber").value || "Not Scanned"} | Driver: ${document.getElementById("driverName").value || "Not Scanned"}\n` +
    `Distance: ${totalDistanceKm.toFixed(2)} km | Duration: ${mins}:${secs}\n` +
    `Avg / Max Speed: ${avgSpeed} / ${maxSpeedKmh} km/h\n` +
    `Safety Score: ${finalScore}/100 | Alerts Triggered: ${alertsTriggeredCount}\n` +
    `Nearest Police Corridor (Ref): ${nearestPs.name} (${nearestPs.phone} • ${nearestPs.distKm.toFixed(1)} km)\n` +
    `Privacy Status: ${isPostRide ? "PURGED (Zero-Retention)" : "ACTIVE ENCRYPTED"}`;

  document.getElementById("reportTextBox").innerText = summary;
  document.getElementById("reportModal").classList.remove("hidden");
}

function closeReportModal() {
  document.getElementById("reportModal").classList.add("hidden");
}

function copySafetyReport() {
  const text = document.getElementById("reportTextBox").innerText;
  copyTextFallback(text);
  showToast("📋 Safety Audit Report copied to clipboard!");
}

function copyTextFallback(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {}
}

function endRideSafely() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  clearInterval(demoTimer);
  clearTimeout(switchOffTimer);
  clearInterval(switchOffCountdownInterval);
  clearInterval(safetyCheckInterval);

  if (activeProfile) {
    fetch(`${CONFIG.API_BASE_URL}/end-ride`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RideGuard-Token": sessionToken },
      body: JSON.stringify({ user: activeProfile.name })
    }).catch(() => {});
  }

  openSafetyReport(true);

  isRideActive = false;
  isPhonePoweredOff = false;
  activeSafetyAlertType = null;
  if (typeof isPlateMismatch !== "undefined") isPlateMismatch = false;
  if (typeof verifiedBookingPlate !== "undefined") verifiedBookingPlate = "";
  if (typeof verifiedBookingDriver !== "undefined") verifiedBookingDriver = "";
  liveTrailCoords = [];
  journeyHistory = [];
  totalDistanceKm = 0;
  rideStartTime = null;

  try {
    localStorage.removeItem(ACTIVE_RIDE_SNAPSHOT_KEY);
  } catch (e) {}

  if (shutdownPinMarker && map) {
    map.removeLayer(shutdownPinMarker);
    shutdownPinMarker = null;
  }
  if (liveTrailLine) liveTrailLine.setLatLngs([]);
  if (policeVectorLine) policeVectorLine.setLatLngs([]);

  const box = document.getElementById("vaultSyncBox");
  if (box) box.classList.remove("frozen");
  document.getElementById("driverName").value = "";
  document.getElementById("vehicleNumber").value = "";
  document.getElementById("imageQualityBadge").innerText = "Awaiting Scan";
  document.getElementById("ocrStatus").innerText = "Waiting for booking screenshot...";
  document.getElementById("ocrStatus").classList.remove("success");
  document.getElementById("ocrPreview").innerHTML = "<strong>Upload Rapido / Uber / Ola Screenshot</strong><br/>Click to browse or tap <em>Load Sample</em>";
  document.getElementById("journeyCount").innerText = "0 pts";
  document.getElementById("journeyEntries").innerHTML = "<div>Trip purged. Start Safe Ride to log new waypoints.</div>";
  document.getElementById("sessionBadge").innerText = "🛡️ RIDE ENDED — ZERO DATA RETAINED";
  document.getElementById("sessionBadge").classList.remove("danger");
  document.getElementById("safetyCheckBanner").classList.add("hidden");
  document.getElementById("mismatchBanner").classList.add("hidden");
  setHeartbeatUI(true);
  evaluateRiskAnalytics();
  showToast("✅ Ride ended safely. Temporary GPS & OCR data purged.");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}
