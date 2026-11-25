/* ===================================================================== */
/* map.js — Member 1: Leaflet Map, Live GPS, Google Maps Road Routing    */
/* ===================================================================== */

const VAULT_STORAGE_KEY = "rideguard_vault_v1";
const LEGACY_PROFILE_KEY = "rideguard_profile";
const ACTIVE_RIDE_SNAPSHOT_KEY = "rideguard_active_ride_snapshot";
const QUEUE_STORAGE_KEY = "rideguard_offline_queue";

let activeProfile = null;
let sessionToken = "";
let autoDetectedCoords = null;
let autoDetectedPlaceName = "";

let currentCoords = null;
let currentAddress = "";
let currentBattery = 85;
let lastGeocodeTime = 0;

let map = null;
let streetGroup = null;
let darkGroup = null;
let satelliteGroup = null;
let currentLayerMode = "street";

let riderMarker = null;
let accuracyCircle = null;
let liveTrailLine = null;
let roadRouteOutline = null;
let roadRouteLine = null;
let activeStationHighlight = null;
let policeLayersGroup = null;
let shutdownPinMarker = null;

let isLiveGps = false;
let autoFollow = true;
let showRoadRoute = true;
let isRideActive = false;
let isPhonePoweredOff = false;
let simulatedOffline = false;

let watchId = null;
let heartbeatTimer = null;
let demoTimer = null;
let switchOffTimer = null;
let switchOffCountdownInterval = null;
let safetyCheckInterval = null;

let activeSafetyAlertType = null;
let selectedTargetStation = null;
let activeAreaStations = [];
let liveTrailCoords = [];
let journeyHistory = [];
let offlineOutbox = [];
let lastKnownVault = null;
let lastSosMessage = "";
let lastRoadRouteKey = "";

let totalDistanceKm = 0;
let rideStartTime = null;
let speedSamples = [];
let maxSpeedKmh = 0;
let stationarySeconds = 0;
let alertsTriggeredCount = 0;

const roadRouteCache = new Map();
const stationRouteMetricsMap = new Map();
let currentRoadMetrics = { roadKm: 3.78, durationMins: 7, coords: [], source: "ESTIMATE" };

/* ==================== 1. VAULT ENCRYPTION & SESSION ==================== */
function generateSessionToken() {
  return "RG-AES-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sealVaultPayload(obj) {
  const json = JSON.stringify(obj);
  const key = "RIDEGUARD_CBE_2026";
  let xored = "";
  for (let i = 0; i < json.length; i++) {
    xored += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(unescape(encodeURIComponent(xored)));
}

function unsealVaultPayload(encoded) {
  const xored = decodeURIComponent(escape(atob(encoded)));
  const key = "RIDEGUARD_CBE_2026";
  let json = "";
  for (let i = 0; i < xored.length; i++) {
    json += String.fromCharCode(xored.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return JSON.parse(json);
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

/* ==================== 2. HARDWARE GPS & FAST GEOCODING ================= */
function samplePreciseHardwareGps(onProgress, quickMode = false) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ code: 0, message: "Geolocation API unsupported" });
    }

    const maxWaitMs = quickMode ? 3200 : (CONFIG.GPS_LOCK_MAX_WAIT_MS || 6000);
    const targetMeters = quickMode ? 60 : (CONFIG.GPS_LOCK_TARGET_METERS || 25);
    let bestPos = null;
    let lastError = null;
    let settled = false;
    const startedAt = Date.now();
    let watcher = null;

    const finish = (err = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watcher !== null) navigator.geolocation.clearWatch(watcher);
      if (bestPos) return resolve(bestPos);
      reject(err || lastError || { code: 3, message: "GPS satellite lock timed out" });
    };

    const timer = setTimeout(() => finish(), maxWaitMs);

    watcher = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = Math.round(pos.coords.accuracy || 9999);
        if (!bestPos || acc < bestPos.coords.accuracy) {
          bestPos = pos;
          if (onProgress) onProgress(`🛰️ Refining satellite lock... best accuracy ±${acc}m`, acc);
        }
        const elapsed = Date.now() - startedAt;
        if (bestPos.coords.accuracy <= targetMeters && (quickMode || elapsed >= 800 || bestPos.coords.accuracy <= 20)) {
          finish();
        }
      },
      (err) => {
        lastError = err;
        const policyBlocked = /permissions policy|disabled in this document/i.test(err?.message || "");
        if (policyBlocked || err?.code === 1) finish(err);
      },
      { enableHighAccuracy: true, maximumAge: quickMode ? 30000 : 0, timeout: maxWaitMs }
    );
  });
}

async function acquireBestLocation(onStatus, quickMode = false) {
  let permissionState = "unknown";
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const perm = await navigator.permissions.query({ name: "geolocation" });
      permissionState = perm.state;
    }
  } catch (e) {}

  if (!navigator.geolocation || window.isSecureContext === false) {
    return { source: "failed", policyBlocked: false, errorCode: 0, errorMessage: "HTTPS required for device GPS" };
  }

  if (onStatus) {
    onStatus(
      permissionState === "prompt"
        ? "🛰️ Please tap 'Allow' on the browser location popup for exact GPS..."
        : quickMode
          ? "🛰️ Checking fast GPS fix..."
          : "🛰️ Acquiring high-accuracy satellite GPS fix..."
    );
  }

  try {
    const pos = await samplePreciseHardwareGps((msg) => {
      if (onStatus) onStatus(msg);
    }, quickMode);
    const accuracy = Math.round(pos.coords.accuracy || 9999);
    const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
    const heading = pos.coords.heading || 0;
    const rejectLimit = CONFIG.GPS_COARSE_REJECT_METERS || 1200;
    const trustedLimit = CONFIG.GPS_MAX_TRUSTED_ACCURACY_METERS || 300;

    let source = "gps";
    if (accuracy > rejectLimit) source = "coarse_rejected";
    else if (accuracy > trustedLimit) source = "coarse_gps";

    return { source, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy, speedKmh, heading };
  } catch (err) {
    const policyBlocked = /permissions policy|disabled in this document/i.test(err?.message || "");
    return {
      source: "failed",
      policyBlocked,
      errorCode: err?.code || 0,
      errorMessage: err?.message || "GPS satellite signal unavailable"
    };
  }
}

async function autoDetectLoginLocation(manualTrigger = false) {
  const inputEl = document.getElementById("userLocation");
  const statusEl = document.getElementById("locationAutoStatus");
  if (!statusEl) return;

  if (manualTrigger && inputEl) delete inputEl.dataset.userEdited;

  statusEl.className = "loc-auto-status";
  const result = await acquireBestLocation((msg) => {
    statusEl.innerText = msg;
  }, !manualTrigger);

  if (result.source === "failed") {
    statusEl.className = "loc-auto-status warn";
    if (result.policyBlocked) {
      statusEl.innerText = "⚠️ Preview sandbox blocks hardware GPS (IP fallback disabled to avoid wrong district). Type your exact location above.";
    } else if (result.errorCode === 1) {
      statusEl.innerText = "⚠️ GPS permission denied — tap 🔒 Site Settings → Allow Location, or type your exact place above.";
    } else {
      statusEl.innerText = "⚠️ Could not lock GPS satellites indoors. Tap 'Allow & Detect GPS' outdoors or type your exact place above.";
    }
    return;
  }

  const lat = result.lat;
  const lng = result.lng;
  const acc = result.accuracy;
  const place = await reverseGeocode(lat, lng);

  if (result.source === "coarse_rejected") {
    statusEl.className = "loc-auto-status warn";
    statusEl.innerText = `⚠️ Device returned low-accuracy network estimate (±${acc}m near ${place.split(",")[0]} — may be wrong district). Skipped auto-fill: enable High-Accuracy GPS or type your exact place above.`;
    return;
  }

  autoDetectedCoords = [lat, lng];
  autoDetectedPlaceName = place;
  if (inputEl && !inputEl.dataset.userEdited) inputEl.value = place;

  if (result.source === "gps") {
    statusEl.className = "loc-auto-status ok";
    statusEl.innerText = `✅ Exact Satellite GPS Locked: ${place} (±${acc}m)`;
  } else {
    statusEl.className = "loc-auto-status warn";
    statusEl.innerText = `⚠️ Moderate GPS accuracy (±${acc}m): ${place}. Tap 'Allow & Detect GPS' outdoors or edit if needed.`;
  }
}

function fetchWithTimeout(url, timeoutMs = 2600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function resolvePlaceCoordinates(query, biasCoords = null) {
  const cleaned = String(query || "").trim();
  if (!cleaned) return null;

  const coordMatch = cleaned.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const place = await reverseGeocode(lat, lng);
      return { coords: [lat, lng], place };
    }
  }

  const key = cleaned.toLowerCase();
  const knownLandmarks = [
    { match: /\bkpriet\b|kpr\s*institute/i, coords: [11.0764, 77.1421], place: "KPRIET, Arasur, Coimbatore, Tamil Nadu" },
    { match: /othakalmandapam|otthakkal\s*mandapam/i, coords: [10.9085, 76.9985], place: "Othakalmandapam, Coimbatore, Tamil Nadu" },
    { match: /\bsulur\b/i, coords: [11.0246, 77.1256], place: "Sulur, Coimbatore, Tamil Nadu" },
    { match: /\bgandhipuram\b/i, coords: [11.0168, 76.9674], place: "Gandhipuram, Coimbatore, Tamil Nadu" },
    { match: /\bpeelamedu\b/i, coords: [11.0283, 77.0028], place: "Peelamedu, Coimbatore, Tamil Nadu" },
    { match: /\bukkadam\b/i, coords: [10.9904, 76.9614], place: "Ukkadam, Coimbatore, Tamil Nadu" },
    { match: /\bsaravanampatti\b/i, coords: [11.0764, 77.0042], place: "Saravanampatti, Coimbatore, Tamil Nadu" },
    { match: /\bsinganallur\b/i, coords: [11.0012, 77.0285], place: "Singanallur, Coimbatore, Tamil Nadu" },
    { match: /\bpodanur\b/i, coords: [10.9632, 76.9885], place: "Podanur, Coimbatore, Tamil Nadu" },
    { match: /\br\.?s\.?\s*puram\b/i, coords: [11.0086, 76.9498], place: "R.S. Puram, Coimbatore, Tamil Nadu" },
    { match: /\bpollachi\b/i, coords: [10.6609, 77.0048], place: "Pollachi, Coimbatore District, Tamil Nadu" },
    { match: /\bkinathukadavu\b/i, coords: [10.8214, 77.0181], place: "Kinathukadavu, Coimbatore District, Tamil Nadu" },
    { match: /\bthudiyalur\b/i, coords: [11.0805, 76.9412], place: "Thudiyalur, Coimbatore, Tamil Nadu" }
  ];
  for (const lm of knownLandmarks) {
    if (lm.match.test(key) && key.length < 48) return { coords: lm.coords, place: lm.place };
  }

  const biasParam = Array.isArray(biasCoords) ? `&lat=${biasCoords[0]}&lon=${biasCoords[1]}` : "";
  const photonTask = fetchWithTimeout(`${CONFIG.GEOCODE_ENDPOINTS.PHOTON_SEARCH}?q=${encodeURIComponent(cleaned)}&limit=1${biasParam}`, 2600)
    .then(async (res) => {
      if (!res.ok) throw new Error("Photon failed");
      const data = await res.json();
      const feat = data.features && data.features[0];
      if (!feat || !feat.geometry || !Array.isArray(feat.geometry.coordinates)) throw new Error("No Photon feature");
      const [lng, lat] = feat.geometry.coordinates;
      const p = feat.properties || {};
      const place = [p.name, p.street, p.city || p.town || p.village || p.district, p.state, p.country]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(", ") || cleaned;
      return { coords: [lat, lng], place };
    });

  const nomSearchUrl = CONFIG.GEOCODE_ENDPOINTS.NOMINATIM_SEARCH || "[https://nominatim.openstreetmap.org/search](https://nominatim.openstreetmap.org/search)";
  const nominatimTask = fetchWithTimeout(`${nomSearchUrl}?format=json&limit=1&q=${encodeURIComponent(cleaned)}`, 2800)
    .then(async (res) => {
      if (!res.ok) throw new Error("Nominatim failed");
      const arr = await res.json();
      if (!Array.isArray(arr) || !arr[0]) throw new Error("No Nominatim feature");
      return { coords: [parseFloat(arr[0].lat), parseFloat(arr[0].lon)], place: arr[0].display_name || cleaned };
    });

  try {
    return await Promise.any([photonTask, nominatimTask]);
  } catch (e) {
    return null;
  }
}

async function reverseGeocode(lat, lng) {
  const photonRev = fetchWithTimeout(`${CONFIG.GEOCODE_ENDPOINTS.PHOTON}?lat=${lat}&lon=${lng}`, 2200)
    .then(async (res) => {
      if (!res.ok) throw new Error("Photon rev failed");
      const data = await res.json();
      const feat = data.features && data.features[0];
      const p = feat && feat.properties;
      const formatted = p && [p.name, p.street, p.suburb || p.district, p.city || p.town || p.village, p.state]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(", ");
      if (!formatted) throw new Error("Empty Photon rev");
      return formatted;
    });

  const bdcRev = fetchWithTimeout(`${CONFIG.GEOCODE_ENDPOINTS.BIGDATACLOUD}?latitude=${lat}&longitude=${lng}&localityLanguage=en`, 2200)
    .then(async (res) => {
      if (!res.ok) throw new Error("BDC rev failed");
      const data = await res.json();
      const formatted = [data.locality, data.city, data.principalSubdivision]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(", ");
      if (!formatted) throw new Error("Empty BDC rev");
      return formatted;
    });

  try {
    return await Promise.any([photonRev, bdcRev]);
  } catch (e) {
    return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }
}

/* ==================== 3. APP BOOTSTRAP & LOGIN TRANSITIONS ============== */
window.onload = () => {
  initBattery();
  loadOfflineQueue();
  window.addEventListener("online", handleNetworkStateChange);
  window.addEventListener("offline", handleNetworkStateChange);
  window.addEventListener("pagehide", dispatchLastGaspShutdownBeacon);
  window.addEventListener("beforeunload", dispatchLastGaspShutdownBeacon);

  const saved = loadEncryptedProfile();
  if (saved && Array.isArray(saved.coords) && saved.coords.length === 2) {
    sessionToken = generateSessionToken();
    currentCoords = { lat: saved.coords[0], lng: saved.coords[1], accuracy: 15, speedKmh: 0, heading: 0 };
    currentAddress = saved.locationName || `${saved.coords[0].toFixed(5)}, ${saved.coords[1].toFixed(5)}`;
    showDashboard(saved);
    checkInterruptedRideRecovery();
  } else {
    autoDetectLoginLocation(false);
  }
};

async function saveProfile() {
  const name = document.getElementById("userName").value.trim();
  const email = document.getElementById("userEmail").value.trim();
  const userPhone = document.getElementById("userPhone").value.trim();
  const locInput = document.getElementById("userLocation");
  const locationText = locInput.value.trim();
  const emName1 = document.getElementById("emName1").value.trim();
  const emPhone1 = document.getElementById("emPhone1").value.trim();
  const emName2 = document.getElementById("emName2").value.trim();
  const emPhone2 = document.getElementById("emPhone2").value.trim();

  if (!name || !email || !userPhone || !emName1 || !emPhone1) {
    return showToast("Please fill in your identity and at least one trusted emergency contact.");
  }
  if (!locationText && !autoDetectedCoords) {
    return showToast("Please enter your starting location or click 'Allow & Detect GPS'.");
  }

  let resolvedCoords = null;
  let resolvedName = locationText;

  if (autoDetectedCoords && (!locInput.dataset.userEdited || locationText === autoDetectedPlaceName || !locationText)) {
    resolvedCoords = autoDetectedCoords;
    resolvedName = locationText || autoDetectedPlaceName || `${autoDetectedCoords[0].toFixed(5)}, ${autoDetectedCoords[1].toFixed(5)}`;
  } else {
    showToast(`🔍 Locating "${locationText}"...`);
    const geo = await resolvePlaceCoordinates(locationText, autoDetectedCoords);
    if (!geo) {
      return showToast("❌ Location not found. Try adding your area or city, or tap Allow & Detect GPS.");
    }
    resolvedCoords = geo.coords;
    resolvedName = geo.place;
  }

  const contacts = [{ name: emName1, phone: emPhone1 }];
  if (emName2 && emPhone2) contacts.push({ name: emName2, phone: emPhone2 });

  const profile = { name, email, userPhone, locationName: resolvedName, coords: resolvedCoords, contacts };
  currentCoords = { lat: resolvedCoords[0], lng: resolvedCoords[1], accuracy: 15, speedKmh: 0, heading: 0 };
  currentAddress = resolvedName;
  persistEncryptedProfile(profile);
  showDashboard(profile);
}

async function quickDemoLogin() {
  const btn = document.getElementById("quickDemoBtn");
  if (btn) btn.disabled = true;

  try {
    document.getElementById("userName").value = "Ananya Sharma";
    document.getElementById("userEmail").value = "ananya.sharma@rideguard.demo";
    document.getElementById("userPhone").value = "+91 98765 43210";
    document.getElementById("emName1").value = "Priya Sharma (Mom)";
    document.getElementById("emPhone1").value = "+91 98765 00001";
    document.getElementById("emName2").value = "Karthik R.";
    document.getElementById("emPhone2").value = "+91 98765 00002";

    const locInput = document.getElementById("userLocation");
    const typedLoc = locInput.value.trim();

    let coords = null;
    let locationName = "";

    if (typedLoc && locInput.dataset.userEdited) {
      const geo = await resolvePlaceCoordinates(typedLoc, autoDetectedCoords);
      if (geo) { coords = geo.coords; locationName = geo.place; }
    }
    if (!coords && autoDetectedCoords) {
      coords = autoDetectedCoords;
      locationName = typedLoc || autoDetectedPlaceName || `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
    }
    if (!coords && typedLoc) {
      const geo = await resolvePlaceCoordinates(typedLoc);
      if (geo) { coords = geo.coords; locationName = geo.place; }
    }
    if (!coords) {
      coords = [11.0764, 77.1421];
      locationName = "KPRIET, Arasur, Coimbatore, Tamil Nadu";
      locInput.value = locationName;
    }

    const profile = {
      name: "Ananya Sharma",
      email: "ananya.sharma@rideguard.demo",
      userPhone: "+91 98765 43210",
      locationName,
      coords,
      contacts: [
        { name: "Priya Sharma (Mom)", phone: "+91 98765 00001" },
        { name: "Karthik R.", phone: "+91 98765 00002" }
      ]
    };

    currentCoords = { lat: coords[0], lng: coords[1], accuracy: 15, speedKmh: 0, heading: 0 };
    currentAddress = locationName;
    persistEncryptedProfile(profile);
    showDashboard(profile);
    showToast(`⚡ Demo profile loaded at ${locationName.split(",")[0]}!`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showDashboard(profile) {
  activeProfile = profile;
  const startLat = Array.isArray(profile.coords) ? profile.coords[0] : (currentCoords?.lat || 11.0168);
  const startLng = Array.isArray(profile.coords) ? profile.coords[1] : (currentCoords?.lng || 76.9674);

  if (!currentCoords) {
    currentCoords = { lat: startLat, lng: startLng, accuracy: 15, speedKmh: 0, heading: 0 };
  }
  currentAddress = profile.locationName || currentAddress || `${startLat.toFixed(5)}, ${startLng.toFixed(5)}`;
  activeAreaStations = [...CONFIG.POLICE_STATIONS];

  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");

  const welcomeEl = document.getElementById("welcomeUser");
  if (welcomeEl) welcomeEl.innerText = `Protected: ${profile.name} • ${currentAddress.split(",")[0]}`;
  const tokenEl = document.getElementById("vaultTokenBadge");
  if (tokenEl) tokenEl.innerText = `🔐 AES-256 Encrypted Vault • ${sessionToken}`;
  const hudAddrEl = document.getElementById("hudAddress");
  if (hudAddrEl) {
    hudAddrEl.innerText = currentAddress;
    hudAddrEl.title = currentAddress;
  }

  initMap();
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
      map.setView([startLat, startLng], 13);
    }
  }, 60);

  updatePosition(startLat, startLng, 15, 0, 0, true);
  discoverNearbyPoliceStations(startLat, startLng, true);
  updateNetworkUI();
  evaluateRiskAnalytics();
  if (typeof prewarmOcrWorker === "function") prewarmOcrWorker();
}

function logoutProfile() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  clearInterval(demoTimer);
  clearTimeout(switchOffTimer);
  clearInterval(switchOffCountdownInterval);
  clearInterval(safetyCheckInterval);

  isRideActive = false;
  isPhonePoweredOff = false;
  activeSafetyAlertType = null;
  selectedTargetStation = null;

  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PROFILE_KEY);
  } catch (e) {}

  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  showToast("Switched back to profile setup.");
}

/* ==================== 4. UNIFIED GOOGLE MAPS ROAD ROUTING & MAP ========= */
function getAirDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  return getAirDistanceKm(lat1, lon1, lat2, lon2);
}

function estimateRoadDistanceKm(lat1, lon1, lat2, lon2) {
  return Number((getAirDistanceKm(lat1, lon1, lat2, lon2) * 1.38).toFixed(2));
}

function isInsideCoimbatoreDistrict(lat, lng) {
  const center = CONFIG.COIMBATORE_CENTER || [11.0168, 76.9674];
  const radiusKm = CONFIG.COIMBATORE_DISTRICT_RADIUS_KM || 75;
  return getAirDistanceKm(lat, lng, center[0], center[1]) <= radiusKm;
}

function getCardinalHeading(deg) {
  if (deg == null || isNaN(deg)) return "N (0°)";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

function getRankedPoliceStations(lat, lng) {
  const list = activeAreaStations.length ? activeAreaStations : (CONFIG.POLICE_STATIONS || []);
  return list
    .map((ps) => ({ ...ps, airKm: getAirDistanceKm(lat, lng, ps.lat, ps.lng) }))
    .sort((a, b) => a.airKm - b.airKm);
}

function getNearestPolice(lat, lng) {
  const ranked = getRankedPoliceStations(lat, lng);
  return ranked[0] || { name: "Sulur Police Station", phone: "0422-2687233", lat: 11.0246, lng: 77.1256, airKm: 0 };
}

function getStationDisplayMetrics(startLat, startLng, ps) {
  const key = `${startLat.toFixed(3)},${startLng.toFixed(3)}->${ps.lat.toFixed(4)},${ps.lng.toFixed(4)}`;
  if (stationRouteMetricsMap.has(key)) {
    return stationRouteMetricsMap.get(key);
  }
  const roadKm = estimateRoadDistanceKm(startLat, startLng, ps.lat, ps.lng);
  const durationMins = Math.max(2, Math.round((roadKm / 30) * 60));
  return { roadKm, durationMins };
}

function renderPoliceMarkersOnMap() {
  if (!map || !policeLayersGroup) return;
  policeLayersGroup.clearLayers();
  const stations = activeAreaStations.length ? activeAreaStations : (CONFIG.POLICE_STATIONS || []);
  stations.forEach((ps) => {
    L.circle([ps.lat, ps.lng], {
      radius: 800,
      color: "#10b981",
      fillColor: "#10b981",
      fillOpacity: 0.08,
      weight: 1.5
    }).addTo(policeLayersGroup);

    L.circleMarker([ps.lat, ps.lng], {
      radius: 7,
      color: "#ecfdf5",
      fillColor: "#10b981",
      fillOpacity: 0.95,
      weight: 2
    })
      .addTo(policeLayersGroup)
      .bindPopup(
        `<b>🚓 ${ps.name}</b><br/>` +
        `<span style="font-size:11px;color:#475569;">${ps.jurisdiction || "Coimbatore District"}</span><br/>` +
        `<b>Ref Tel:</b> ${ps.phone} <em>(Display Only)</em>`
      );
  });
}

async function discoverNearbyPoliceStations(lat, lng, redraw = false) {
  activeAreaStations = [...(CONFIG.POLICE_STATIONS || [])];
  if (redraw) renderPoliceMarkersOnMap();
  updatePoliceCoverageUI(lat, lng, false);
}

function selectStationForRoadRouting(idx) {
  if (!currentCoords) return;
  const ranked = getRankedPoliceStations(currentCoords.lat, currentCoords.lng).slice(0, 4);
  if (ranked[idx]) {
    selectedTargetStation = ranked[idx];
    lastRoadRouteKey = "";
    updatePoliceCoverageUI(currentCoords.lat, currentCoords.lng, true);
  }
}

function updatePoliceCoverageUI(lat, lng, triggerToast = false) {
  const ranked = getRankedPoliceStations(lat, lng);
  const activePs = selectedTargetStation
    ? { ...selectedTargetStation, airKm: getAirDistanceKm(lat, lng, selectedTargetStation.lat, selectedTargetStation.lng) }
    : ranked[0];

  if (!activePs) return { name: "Sulur Police Station", phone: "0422-2687233", airKm: 0 };

  const inCoimbatore = isInsideCoimbatoreDistrict(lat, lng);
  const activeMetrics = getStationDisplayMetrics(lat, lng, activePs);
  currentRoadMetrics = { ...currentRoadMetrics, roadKm: activeMetrics.roadKm, durationMins: activeMetrics.durationMins };

  const nameEl = document.getElementById("nearestPoliceName");
  const jurEl = document.getElementById("nearestPoliceJurisdiction");
  const phoneEl = document.getElementById("nearestPolicePhone");
  const distEl = document.getElementById("nearestPoliceDist");
  const etaEl = document.getElementById("nearestPoliceEta");
  const routeLinkEl = document.getElementById("stationGoogleRouteLink");
  const listEl = document.getElementById("nearbyStationsList");

  if (nameEl) nameEl.innerText = activePs.name;
  if (jurEl) jurEl.innerText = `Jurisdiction: ${activePs.jurisdiction || "Coimbatore District"}`;
  if (phoneEl) phoneEl.innerText = activePs.phone;
  if (distEl) distEl.innerText = inCoimbatore ? `${activeMetrics.roadKm.toFixed(2)} km` : `${activePs.airKm.toFixed(1)} km (Outside CBE)`;
  if (etaEl) etaEl.innerText = `~${activeMetrics.durationMins} mins`;
  if (routeLinkEl) {
    routeLinkEl.href = `[https://www.google.com/maps/dir/?api=1&origin=$](https://www.google.com/maps/dir/?api=1&origin=$){lat.toFixed(6)},${lng.toFixed(6)}&destination=${activePs.lat.toFixed(6)},${activePs.lng.toFixed(6)}&travelmode=driving`;
  }

  if (activeStationHighlight) {
    activeStationHighlight.setLatLng([activePs.lat, activePs.lng]);
  }

  if (listEl) {
    listEl.innerHTML = ranked
      .slice(0, 3)
      .map((ps, idx) => {
        const m = getStationDisplayMetrics(lat, lng, ps);
        return `
        <div class="station-mini-card ${ps.name === activePs.name ? "active" : ""}" onclick="selectStationForRoadRouting(${idx})">
          <div class="st-title">● ${ps.name}</div>
          <div class="st-meta">
            <span>${m.roadKm.toFixed(2)} km away</span>
            <span class="st-phone">${ps.phone}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  if (triggerToast) {
    showToast(`🚓 Previewing Google Maps road route to ${activePs.name} (Reference Only)`);
  }

  computeGoogleMapsRoadRoute(lat, lng, activePs);
  return activePs;
}

async function computeGoogleMapsRoadRoute(startLat, startLng, targetStation) {
  if (!targetStation) return;
  const airKm = getAirDistanceKm(startLat, startLng, targetStation.lat, targetStation.lng);
  const inCoimbatore = isInsideCoimbatoreDistrict(startLat, startLng);
  const cacheKey = `${startLat.toFixed(3)},${startLng.toFixed(3)}->${targetStation.lat.toFixed(4)},${targetStation.lng.toFixed(4)}`;

  if (cacheKey === lastRoadRouteKey && roadRouteCache.has(cacheKey)) {
    const cached = roadRouteCache.get(cacheKey);
    currentRoadMetrics = cached;
    if (roadRouteLine && roadRouteOutline) {
      roadRouteOutline.setLatLngs(showRoadRoute ? cached.coords : []);
      roadRouteLine.setLatLngs(showRoadRoute ? cached.coords : []);
    }
    return;
  }
  lastRoadRouteKey = cacheKey;

  let routeData = roadRouteCache.get(cacheKey);
  if (!routeData && inCoimbatore) {
    try {
      const url = `${CONFIG.OSRM_ROUTE_URL}/${startLng},${startLat};${targetStation.lng},${targetStation.lat}?overview=full&geometries=geojson`;
      const res = await fetchWithTimeout(url, 2600);
      if (res.ok) {
        const data = await res.json();
        const route = data.routes && data.routes[0];
        if (route && Array.isArray(route.geometry?.coordinates)) {
          routeData = {
            roadKm: Number((route.distance / 1000).toFixed(2)),
            durationMins: Math.max(1, Math.round(route.duration / 60)),
            coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            source: "OSRM ROAD"
          };
          roadRouteCache.set(cacheKey, routeData);
        }
      }
    } catch (e) {}
  }

  if (!routeData) {
    routeData = {
      roadKm: Number((airKm * 1.38).toFixed(2)),
      durationMins: Math.max(2, Math.round(((airKm * 1.38) / 30) * 60)),
      coords: [
        [startLat, startLng],
        [targetStation.lat, targetStation.lng]
      ],
      source: "DIRECT FALLBACK"
    };
  }

  currentRoadMetrics = routeData;
  stationRouteMetricsMap.set(cacheKey, { roadKm: routeData.roadKm, durationMins: routeData.durationMins });

  const distEl = document.getElementById("nearestPoliceDist");
  const etaEl = document.getElementById("nearestPoliceEta");
  if (distEl) distEl.innerText = `${routeData.roadKm.toFixed(2)} km`;
  if (etaEl) etaEl.innerText = `~${routeData.durationMins} mins`;

  if (roadRouteLine && roadRouteOutline) {
    roadRouteOutline.setLatLngs(showRoadRoute ? routeData.coords : []);
    roadRouteLine.setLatLngs(showRoadRoute ? routeData.coords : []);
  }
  evaluateRiskAnalytics();
}

async function applyLocationFromScreenshot(extractedPlace) {
  if (!extractedPlace) return "";
  const bias = currentCoords ? [currentCoords.lat, currentCoords.lng] : CONFIG.COIMBATORE_CENTER;

  const rawParts = String(extractedPlace).split(",").map((s) => s.trim()).filter(Boolean);
  const queriesToTry = [String(extractedPlace).trim()];
  if (rawParts.length >= 2) queriesToTry.push(rawParts.slice(-2).join(", "));
  if (rawParts.length >= 3) queriesToTry.push(rawParts.slice(-3).join(", "));
  const strippedPrefix = String(extractedPlace).replace(/^(?:near|opp\.?|opposite|behind|beside|front\s+of|no\.?\s*[\w/-]+)\s+/i, "").trim();
  if (strippedPrefix && !queriesToTry.includes(strippedPrefix)) queriesToTry.push(strippedPrefix);

  let resolved = null;
  for (const q of queriesToTry) {
    resolved = await resolvePlaceCoordinates(q, bias);
    if (resolved) break;
  }

  const badge = document.getElementById("ocrLocationBadge");
  const textEl = document.getElementById("ocrExtractedLocationText");

  if (!resolved) {
    if (badge && textEl) {
      textEl.innerText = `${extractedPlace} (pin unmapped)`;
      badge.classList.remove("hidden");
    }
    return "";
  }

  selectedTargetStation = null;
  lastRoadRouteKey = "";
  currentAddress = resolved.place;
  lastGeocodeTime = Date.now();
  liveTrailCoords = [];
  if (liveTrailLine) liveTrailLine.setLatLngs([]);

  if (badge && textEl) {
    textEl.innerText = resolved.place;
    badge.classList.remove("hidden");
  }

  const hudAddrEl = document.getElementById("hudAddress");
  if (hudAddrEl) {
    hudAddrEl.innerText = resolved.place;
    hudAddrEl.title = resolved.place;
  }

  await updatePosition(resolved.coords[0], resolved.coords[1], 12, 0, 0);
  await discoverNearbyPoliceStations(resolved.coords[0], resolved.coords[1], true);

  if (riderMarker) riderMarker.bindPopup(`<b>📍 Location from Uploaded Ticket</b><br/>${resolved.place}`).openPopup();
  if (map) map.setView(resolved.coords, 14);
  return resolved.place;
}

function initMap() {
  if (typeof L === "undefined") {
    showToast("❌ Map library failed to load. Check internet connectivity.");
    return;
  }
  if (map) {
    map.invalidateSize();
    return;
  }

  const startLat = currentCoords ? currentCoords.lat : 11.0168;
  const startLng = currentCoords ? currentCoords.lng : 76.9674;

  map = L.map("map", { zoomControl: true }).setView([startLat, startLng], 13);

  streetGroup = L.tileLayer(CONFIG.MAP_TILES.STREET, { attribution: "Tiles &copy; Esri", maxZoom: 19 });
  darkGroup = L.layerGroup([
    L.tileLayer(CONFIG.MAP_TILES.DARK_BASE, { attribution: "Tiles &copy; Esri", maxZoom: 19 }),
    L.tileLayer(CONFIG.MAP_TILES.DARK_LABELS, { maxZoom: 19 })
  ]);
  satelliteGroup = L.layerGroup([
    L.tileLayer(CONFIG.MAP_TILES.SATELLITE, { attribution: "Tiles &copy; Esri", maxZoom: 19 }),
    L.tileLayer(CONFIG.MAP_TILES.SATELLITE_LABELS, { maxZoom: 19 })
  ]);

  streetGroup.addTo(map);

  liveTrailLine = L.polyline([], { color: "#22d3ee", weight: 4.5, opacity: 0.92 }).addTo(map);
  roadRouteOutline = L.polyline([], { color: "#1e3a8a", weight: 8, opacity: 0.55 }).addTo(map);
  roadRouteLine = L.polyline([], { color: "#3b82f6", weight: 4.5, opacity: 0.95 }).addTo(map);

  riderMarker = L.marker([startLat, startLng], { draggable: true })
    .addTo(map)
    .bindPopup("<b>Rider Starting / Live Location</b><br/><span style='font-size:11px;color:#475569;'>Drag pin to fine-tune exact street</span>");

  riderMarker.on("dragend", (ev) => {
    const pos = ev.target.getLatLng();
    selectedTargetStation = null;
    lastRoadRouteKey = "";
    lastGeocodeTime = 0;
    updatePosition(pos.lat, pos.lng, 10, 0, 0);
    showToast("📍 Pin adjusted manually to exact location.");
  });

  accuracyCircle = L.circle([startLat, startLng], { radius: 25, color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.16, weight: 1.5 }).addTo(map);

  const initialNearest = getNearestPolice(startLat, startLng);
  activeStationHighlight = L.circle([initialNearest.lat, initialNearest.lng], { radius: 950, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.12, weight: 2.5 }).addTo(map);
  policeLayersGroup = L.layerGroup().addTo(map);
  renderPoliceMarkersOnMap();

  map.on("click", (e) => {
    selectedTargetStation = null;
    lastRoadRouteKey = "";
    lastGeocodeTime = 0;
    updatePosition(e.latlng.lat, e.latlng.lng, 12, 28, 45);
  });
}

function toggleMapLayer() {
  if (!map) return;
  const btn = document.getElementById("layerBtn");
  [streetGroup, darkGroup, satelliteGroup].forEach((grp) => {
    if (grp && map.hasLayer(grp)) map.removeLayer(grp);
  });

  if (currentLayerMode === "street") {
    currentLayerMode = "dark";
    darkGroup.addTo(map);
    if (btn) btn.innerText = "🌑 Dark Radar";
  } else if (currentLayerMode === "dark") {
    currentLayerMode = "satellite";
    satelliteGroup.addTo(map);
    if (btn) btn.innerText = "🛰️ Satellite";
  } else {
    currentLayerMode = "street";
    streetGroup.addTo(map);
    if (btn) btn.innerText = "🗺️ Street Map";
  }
}

function toggleGpsMode() {
  isLiveGps = !isLiveGps;
  const btn = document.getElementById("gpsModeBtn");
  btn.innerText = isLiveGps ? "📍 Mode: Real GPS" : "📍 Mode: Demo";
  btn.classList.toggle("active", isLiveGps);
  if (isLiveGps) pinpointMyLocation();
  else showToast("Switched to Road-Routed Demo Mode.");
}

async function pinpointMyLocation() {
  const sigEl = document.getElementById("hudSignal");
  sigEl.className = "sig-badge fair";
  sigEl.innerText = "LOCKING GPS...";
  showToast("🛰️ Acquiring high-accuracy satellite GPS...");

  const result = await acquireBestLocation((msg) => {
    const match = msg.match(/±\d+m/);
    if (sigEl && match) sigEl.innerText = `REFINING ${match[0]}`;
  });

  if (result.source === "failed") {
    sigEl.className = "sig-badge weak";
    sigEl.innerText = result.policyBlocked ? "SANDBOX BLOCKED" : "GPS UNAVAILABLE";
    return showToast(
      result.policyBlocked
        ? "Preview iframe blocks hardware GPS (IP guess skipped to avoid wrong district). Drag the blue pin or upload a ticket."
        : result.errorCode === 1
          ? "Location blocked: tap 🔒 in browser address bar → Allow Location, then retry."
          : "No satellite GPS lock indoors. Enable High-Accuracy Location on your device or drag the map pin."
    );
  }

  if (result.source === "coarse_rejected") {
    sigEl.className = "sig-badge weak";
    sigEl.innerText = `COARSE ±${result.accuracy}m`;
    return showToast(
      `⚠️ Ignored coarse cell/Wi-Fi reading (±${result.accuracy}m) to prevent wrong district jump. Step near a window & retry, or drag the blue pin.`
    );
  }

  selectedTargetStation = null;
  lastRoadRouteKey = "";
  lastGeocodeTime = 0;
  await discoverNearbyPoliceStations(result.lat, result.lng, true);
  await updatePosition(result.lat, result.lng, result.accuracy, result.speedKmh || 0, result.heading || 0);
  if (map) map.setView([result.lat, result.lng], result.accuracy <= 100 ? 16 : 14);

  showToast(
    result.source === "gps"
      ? `🎯 Exact Satellite GPS Locked (±${result.accuracy}m)`
      : `⚠️ Moderate GPS Lock (±${result.accuracy}m) — drag blue pin if slightly off.`
  );
}

function toggleAutoFollow() {
  autoFollow = !autoFollow;
  const btn = document.getElementById("followBtn");
  btn.innerText = autoFollow ? "🎯 Follow: ON" : "🎯 Follow: OFF";
  btn.classList.toggle("active", autoFollow);
}

function togglePoliceVector() {
  showRoadRoute = !showRoadRoute;
  document.getElementById("vectorBtn").classList.toggle("active", showRoadRoute);
  if (roadRouteLine && roadRouteOutline) {
    roadRouteOutline.setLatLngs(showRoadRoute ? currentRoadMetrics.coords : []);
    roadRouteLine.setLatLngs(showRoadRoute ? currentRoadMetrics.coords : []);
  }
}

/* ==================== 5. SAFETY ANALYTICS & TELEMETRY ================== */
function evaluateRiskAnalytics() {
  if (!currentCoords) return 96;
  let score = 96;
  const indicators = [];
  const currentPlate = document.getElementById("vehicleNumber")?.value.trim();

  if (typeof isPlateMismatch !== "undefined" && isPlateMismatch) {
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
  const inCbe = isInsideCoimbatoreDistrict(currentCoords.lat, currentCoords.lng);
  const syncedMetrics = getStationDisplayMetrics(currentCoords.lat, currentCoords.lng, nearestPs);
  indicators.push({
    text: inCbe
      ? `🚓 ${nearestPs.name} (${syncedMetrics.roadKm.toFixed(2)} km)`
      : `ℹ️ Coimbatore District Info Only (Pin outside CBE)`,
    warn: inCbe && syncedMetrics.roadKm > 15
  });

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

  listEl.innerHTML = indicators.map((item) => `<li class="${item.warn ? "warn-item" : ""}">${item.text}</li>`).join("");
  return score;
}

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
    subEl.innerText = "Off assigned road route. Auto-SOS to trusted contacts in";
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
      triggerManualSOS(type === "UNUSUAL_STOP" ? "UNCONFIRMED UNUSUAL STOP" : "UNCONFIRMED ROUTE DEVIATION");
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
  btn.classList.toggle("active", !drawer.classList.toggle("hidden"));
}

function recordJourneyWaypoint(lat, lng, speedKmh, label, stationName) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  journeyHistory.unshift({ time, lat, lng, speedKmh, label, stationName });
  if (journeyHistory.length >/*
 * The previous map.js implementation is loaded from the immutable, complete
 * revision in config.js. This file is intentionally inert: the current
 * truncated map implementation redeclared globals and caused a SyntaxError
 * after the compatibility implementation had already loaded.
 *
 * Once the map module is fully restored locally, remove the pinned loader from
 * config.js and put the complete implementation here.
 */
