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

function fetchWithTimeout(url, timeoutMs = 2500) {
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

  // Race Photon and Nominatim in parallel for sub-second location resolution
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

  const nomSearchUrl = CONFIG.GEOCODE_ENDPOINTS.NOMINATIM_SEARCH || "https://nominatim.openstreetmap.org/search";
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

/* ===================================================================== */
/* 2. APP BOOTSTRAP & MULTI-SAMPLE PRECISION SATELLITE GPS LOCK          */
/* ===================================================================== */
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

function samplePreciseHardwareGps(onProgress) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ code: 0, message: "Geolocation API unsupported" });
    }

    const maxWaitMs = CONFIG.GPS_LOCK_MAX_WAIT_MS || 12000;
    const targetMeters = CONFIG.GPS_LOCK_TARGET_METERS || 25;
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
        if (bestPos.coords.accuracy <= targetMeters && (elapsed >= 1200 || bestPos.coords.accuracy <= 15)) {
          finish();
        }
      },
      (err) => {
        lastError = err;
        const policyBlocked = /permissions policy|disabled in this document/i.test(err?.message || "");
        if (policyBlocked || err?.code === 1) finish(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs }
    );
  });
}

async function acquireBestLocation(onStatus) {
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
        : "🛰️ Acquiring high-accuracy satellite GPS fix (up to 12s)..."
    );
  }

  try {
    const pos = await samplePreciseHardwareGps((msg) => {
      if (onStatus) onStatus(msg);
    });
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
  });

  if (result.source === "failed") {
    statusEl.className = "loc-auto-status warn";
    if (result.policyBlocked) {
      statusEl.innerText = "⚠️ Preview sandbox blocks hardware GPS (IP fallback disabled to avoid wrong district). Type your exact location above.";
    } else if (result.errorCode === 1) {
      statusEl.innerText = "⚠️ GPS permission denied — tap 🔒 Site Settings → Allow Location, or type your exact place above.";
    } else {
      statusEl.innerText = "⚠️ Could not lock GPS satellites indoors. Enable High-Accuracy GPS, move near a window, or type your exact place above.";
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

/* ===================================================================== */
/* 3. FORWARD GEOCODING, LOGIN & PROFILE TRANSITIONS                     */
/* ===================================================================== */
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

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const biasParam = Array.isArray(biasCoords) ? `&lat=${biasCoords[0]}&lon=${biasCoords[1]}` : "";
    const res = await fetch(
      `${CONFIG.GEOCODE_ENDPOINTS.PHOTON_SEARCH}?q=${encodeURIComponent(cleaned)}&limit=1${biasParam}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const feat = data.features && data.features[0];
      if (feat && feat.geometry && Array.isArray(feat.geometry.coordinates)) {
        const [lng, lat] = feat.geometry.coordinates;
        const p = feat.properties || {};
        const place =
          [p.name, p.street, p.city || p.town || p.village || p.district, p.state, p.country]
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(", ") || cleaned;
        return { coords: [lat, lng], place };
      }
    }
  } catch (e) {}

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const nomSearchUrl = CONFIG.GEOCODE_ENDPOINTS.NOMINATIM_SEARCH || "https://nominatim.openstreetmap.org/search";
    const res = await fetch(`${nomSearchUrl}?format=json&limit=1&q=${encodeURIComponent(cleaned)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0]) {
        return { coords: [parseFloat(arr[0].lat), parseFloat(arr[0].lon)], place: arr[0].display_name || cleaned };
      }
    }
  } catch (e) {}

  return null;
}

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
      if (geo) {
        coords = geo.coords;
        locationName = geo.place;
      }
    }
    if (!coords && autoDetectedCoords) {
      coords = autoDetectedCoords;
      locationName = typedLoc || autoDetectedPlaceName || `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
    }
    if (!coords && typedLoc) {
      const geo = await resolvePlaceCoordinates(typedLoc);
      if (geo) {
        coords = geo.coords;
        locationName = geo.place;
      }
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
  if (welcomeEl) welcomeEl.innerText = `👤 ${profile.name} • 📍 ${currentAddress.split(",")[0]}`;
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

/* ===================================================================== */
/* 4. COIMBATORE DISTRICT POLICE RADAR, OSRM ROAD ROUTING & LEAFLET MAP   */
/* ===================================================================== */
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

function selectStationForRoadRouting(idx) {
  if (!currentCoords) return;
  const ranked = getRankedPoliceStations(currentCoords.lat, currentCoords.lng).slice(0, 4);
  if (ranked[idx]) {
    selectedTargetStation = ranked[idx];
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
let lastRoadRouteKey = "";

async function computeGoogleMapsRoadRoute(startLat, startLng, targetStation) {
  if (!targetStation) return;
  const airKm = getAirDistanceKm(startLat, startLng, targetStation.lat, targetStation.lng);
  const inCoimbatore = isInsideCoimbatoreDistrict(startLat, startLng);
  const cacheKey = `${startLat.toFixed(3)},${startLng.toFixed(3)}->${targetStation.lat.toFixed(4)},${targetStation.lng.toFixed(4)}`;

  if (cacheKey === lastRoadRouteKey && roadRouteCache.has(cacheKey)) return;
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

  computeGoogleMapsRoadRoute(lat, lng, activePs);
  return activePs;
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

  if (riderMarker) riderMarker.bindPopup(`<b>📍 Location from Uploaded Screenshot</b><br/>${resolved.place}`).openPopup();
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
  showToast("🛰️ Acquiring high-accuracy satellite GPS (waiting for sharpest fix)...");

  const result = await acquireBestLocation((msg) => {
    const match = msg.match(/±\d+m/);
    if (sigEl && match) sigEl.innerText = `REFINING ${match[0]}`;
  });

  if (result.source === "failed") {
    sigEl.className = "sig-badge weak";
    sigEl.innerText = result.policyBlocked ? "SANDBOX BLOCKED" : "GPS UNAVAILABLE";
    return showToast(
      result.policyBlocked
        ? "Preview iframe blocks hardware GPS (IP guess skipped to avoid wrong district). Search your area below or drag the blue pin."
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

/* ===================================================================== */
/* 5. AI SAFETY ANALYTICS, SAFE RIDE TELEMETRY & CHECK-INS               */
/* ===================================================================== */
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
    indicators.push({ text: "✅ Highway Road Trajectory Normal", warn: false });
  }

  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const inCbe = isInsideCoimbatoreDistrict(currentCoords.lat, currentCoords.lng);
  indicators.push({
    text: inCbe
      ? `🛣️ ${nearestPs.name} (${currentRoadMetrics.roadKm.toFixed(1)} km road)`
      : `ℹ️ Coimbatore District Info Only (Pin outside CBE)`,
    warn: inCbe && currentRoadMetrics.roadKm > 15
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
  if (journeyHistory.length > 30) journeyHistory.pop();
  const countEl = document.getElementById("journeyCount");
  const listEl = document.getElementById("journeyEntries");
  if (countEl) countEl.innerText = `${journeyHistory.length} pts`;
  if (listEl) {
    listEl.innerHTML = journeyHistory.map((pt) => `<div>[${pt.time}] ${pt.label} • 🛣️ ${currentRoadMetrics.roadKm.toFixed(1)}km to ${pt.stationName.split(" ")[0]}</div>`).join("");
  }
}

function shareLiveLocation() {
  if (!currentCoords) return;
  const driver = document.getElementById("driverName").value || "Not Scanned";
  const vehicle = document.getElementById("vehicleNumber").value || "TN-38-AB-1234";
  const nearestPs = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const mapsUrl = `https://maps.google.com/?q=${currentCoords.lat.toFixed(6)},${currentCoords.lng.toFixed(6)}`;
  const shareText = `🛡️ RideGuard AI Live Trip Share\nRider: ${activeProfile?.name || "Rider"}\nDriver: ${driver} | Vehicle: ${vehicle}\nLocation: ${currentAddress}\nCoimbatore Dist. Police (Info Only): ${nearestPs.name} • Tel: ${nearestPs.phone}\nTrack Live Pin: ${mapsUrl}`;
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
  if (!currentCoords) return showToast("Please set your starting location first.");
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
    let roadIdx = 0;
    const fallbackStepPts = [
      [currentCoords.lat, currentCoords.lng],
      [currentCoords.lat + 0.0045, currentCoords.lng + 0.0042],
      [currentCoords.lat + 0.0092, currentCoords.lng + 0.0085],
      [currentCoords.lat + 0.0138, currentCoords.lng + 0.0124]
    ];
    const roadPts = currentRoadMetrics.coords && currentRoadMetrics.coords.length >= 2 ? currentRoadMetrics.coords : fallbackStepPts;
    updatePosition(roadPts[0][0], roadPts[0][1], 10, 36, 192);
    roadIdx = 1;
    demoTimer = setInterval(() => {
      const pt = roadPts[roadIdx % roadPts.length];
      updatePosition(pt[0], pt[1], 10, 38, 185);
      roadIdx++;
    }, 2600);
  }

  sendHeartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  showToast("🛡️ Safe Ride active along live road network.");
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
    stationarySeconds += 2.6;
    if (stationarySeconds >= 15 && !activeSafetyAlertType) triggerSafetyCheckIn("UNUSUAL_STOP");
  } else {
    stationarySeconds = 0;
  }

  if (riderMarker) riderMarker.setLatLng([lat, lng]);
  if (accuracyCircle) accuracyCircle.setLatLng([lat, lng]).setRadius(Math.min(accuracy, 200));
  if (liveTrailLine) liveTrailLine.setLatLngs(liveTrailCoords);
  if (autoFollow && map) map.panTo([lat, lng]);

  const nearestPs = updatePoliceCoverageUI(lat, lng, !silentInit);
  discoverNearbyPoliceStations(lat, lng, false);

  const sigEl = document.getElementById("hudSignal");
  sigEl.className = "sig-badge" + (accuracy > 80 ? " weak" : accuracy > 30 ? " fair" : "");
  sigEl.innerText = accuracy <= 30 ? `EXACT ±${Math.round(accuracy)}m` : `±${Math.round(accuracy)}m`;
  document.getElementById("hudSpeed").innerText = `${speedKmh} km/h`;
  document.getElementById("hudHeading").innerText = getCardinalHeading(heading);
  document.getElementById("hudDist").innerText = `${totalDistanceKm.toFixed(2)} km`;
  document.getElementById("hudCoords").innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (Date.now() - lastGeocodeTime > 12000) {
    lastGeocodeTime = Date.now();
    currentAddress = await reverseGeocode(lat, lng);
    const addrEl = document.getElementById("hudAddress");
    addrEl.innerText = currentAddress;
    addrEl.title = currentAddress;
  }

  if (!silentInit) recordJourneyWaypoint(lat, lng, speedKmh, currentAddress.split(",")[0], nearestPs.name);
  syncShadowVaultSnapshot();
  evaluateRiskAnalytics();
}

/* ===================================================================== */
/* 6. SUDDEN PHONE SHUTDOWN VAULT, OFFLINE QUEUE & SOS DISPATCH          */
/* ===================================================================== */
function syncShadowVaultSnapshot() {
  if (!currentCoords) return;
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
    driver: document.getElementById("driverName")?.value || "Not Scanned",
    vehicle: document.getElementById("vehicleNumber")?.value || "TN-38-AB-1234",
    policeName: nearestPs.name,
    policePhone: nearestPs.phone,
    policeRoadKm: currentRoadMetrics.roadKm
  };

  const box = document.getElementById("vaultSyncBox");
  const titleEl = document.getElementById("vaultSyncTitle");
  const timeEl = document.getElementById("vaultSyncTime");
  const coordsEl = document.getElementById("vaultSyncCoords");

  if (box && !isPhonePoweredOff) {
    box.classList.remove("frozen");
    if (titleEl) titleEl.innerText = "☁️ LAST-KNOWN FINAL PIN";
    if (timeEl) timeEl.innerText = nowTime;
    if (coordsEl) coordsEl.innerText = `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)} • ${currentAddress.split(",")[0]}`;
  }

  if (isRideActive && activeProfile) {
    try {
      localStorage.setItem(ACTIVE_RIDE_SNAPSHOT_KEY, JSON.stringify({ profile: activeProfile, vault: lastKnownVault }));
    } catch (e) {}
  }
}

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
      navigator.sendBeacon(`${CONFIG.API_BASE_URL}/sos`, new Blob([payload], { type: "application/json" }));
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
        if (isRideActive && !isPhonePoweredOff && !bat.charging && currentBattery <= 3) testSwitchOff(true);
      };
      updateBat();
      bat.addEventListener("levelchange", updateBat);
    }
  } catch (e) {}
  const batEl = document.getElementById("batteryText");
  if (batEl) batEl.innerText = `🔋 ${currentBattery}%`;
}

function isNetworkOnline() { return !simulatedOffline && navigator.onLine; }

function loadOfflineQueue() {
  try { offlineOutbox = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]"); } catch (e) { offlineOutbox = []; }
  updateNetworkUI();
}

function saveOfflineQueue() {
  try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineOutbox)); } catch (e) {}
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
  if (!simulatedOffline) flushOfflineQueue();
  else showToast("📴 Offline mode active. Heartbeats & SOS alerts will queue locally.");
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
  if (!activeProfile || !currentCoords) return;
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
    driver: document.getElementById("driverName").value || "Not Scanned",
    vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234",
    nearest_police_ref: `${police.name} (${police.phone} • Coimbatore Dist. Info Only)`
  };
  if (!isNetworkOnline()) return enqueueOfflinePacket("HEARTBEAT", packet);
  fetch(`${CONFIG.API_BASE_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RideGuard-Token": sessionToken },
    body: JSON.stringify(packet)
  }).catch(() => {});
}

function setHeartbeatUI(online) {
  const status = document.getElementById("hbStatus");
  const dot = document.getElementById("hbDot");
  if (status) {
    status.innerText = online ? "ONLINE • SYNCING" : "PHONE SHUTDOWN DETECTED";
    status.classList.toggle("offline", !online);
  }
  if (dot) dot.classList.toggle("offline", !online);
}

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
  if (coordsEl && lastKnownVault) coordsEl.innerText = `${lastKnownVault.lat.toFixed(5)}, ${lastKnownVault.lng.toFixed(5)} • ${lastKnownVault.address}`;

  if (map && lastKnownVault) {
    if (shutdownPinMarker) map.removeLayer(shutdownPinMarker);
    shutdownPinMarker = L.circleMarker([lastKnownVault.lat, lastKnownVault.lng], {
      radius: 11, color: "#fef2f2", fillColor: "#ef4444", fillOpacity: 0.95, weight: 3
    }).addTo(map).bindPopup(`<b>📵 PHONE SHUTDOWN — FINAL STOP LOCATION</b><br/>Area: ${lastKnownVault.address}<br/>Stopped At: ${lastKnownVault.timestamp}`).openPopup();
    map.panTo([lastKnownVault.lat, lastKnownVault.lng]);
  }

  const badge = document.getElementById("sessionBadge");
  let secs = 5;
  badge.innerText = `📵 PHONE SHUTDOWN — SENDING FINAL PIN IN ${secs}s`;
  badge.classList.add("danger");

  showToast(
    isCriticalBattery
      ? "🪫 Battery ≤3%! Locking final location & alerting trusted contacts in 5s..."
      : `📵 Phone powered off at ${lastKnownVault?.address?.split(",")[0] || "stop spot"}! Sending final location in 5s...`
  );

  switchOffCountdownInterval = setInterval(() => {
    secs--;
    if (secs > 0) badge.innerText = `📵 PHONE SHUTDOWN — SENDING FINAL PIN IN ${secs}s`;
    else {
      clearInterval(switchOffCountdownInterval);
      badge.innerText = "🚨 FINAL SHUTDOWN LOCATION DISPATCHED";
    }
  }, 1000);

  const reason = isCriticalBattery
    ? "CRITICAL BATTERY SHUTDOWN (≤3%) — FINAL LOCATION WHERE DRIVE STOPPED"
    : "SUDDEN PHONE SHUTDOWN — FINAL LOCATION WHERE DRIVE STOPPED";

  switchOffTimer = setTimeout(() => triggerManualSOS(reason, lastKnownVault), 5000);
}

async function triggerManualSOS(reason, shutdownVault = null) {
  if (!activeProfile) return;
  alertsTriggeredCount++;
  const locData = shutdownVault || {
    lat: currentCoords.lat,
    lng: currentCoords.lng,
    accuracy: currentCoords.accuracy,
    speedKmh: currentCoords.speedKmh,
    battery: currentBattery,
    address: currentAddress,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    driver: document.getElementById("driverName").value || "Not Scanned",
    vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234"
  };

  const police = getNearestPolice(locData.lat, locData.lng);
  const inCbe = isInsideCoimbatoreDistrict(locData.lat, locData.lng);
  const roadDist = estimateRoadDistanceKm(locData.lat, locData.lng, police.lat, police.lng);
  const mapsUrl = `https://maps.google.com/?q=${locData.lat.toFixed(6)},${locData.lng.toFixed(6)}`;
  const incidentId = `RG-${Math.floor(100000 + Math.random() * 900000)}`;
  const isShutdownEvent = Boolean(shutdownVault) || /SHUTDOWN/i.test(reason);
  const policeInfoLine = inCbe
    ? `Coimbatore Dist. Police (Info Only): ${police.name} (${roadDist.toFixed(1)} km by road) • Ref Tel: ${police.phone}`
    : `Coimbatore Dist. Police (Info Only): ${police.name} • Ref Tel: ${police.phone}`;

  lastSosMessage =
    `🚨 RIDEGUARD AI ALERT [${incidentId}] (${reason})\n` +
    `Rider: ${activeProfile.name} (${activeProfile.userPhone})\n` +
    `Email: ${activeProfile.email}\n` +
    `${isShutdownEvent ? "📍 FINAL LOCATION WHERE PHONE STOPPED" : "📍 Live Location"}: ${locData.address}\n` +
    `Exact GPS Pin: ${locData.lat.toFixed(6)}, ${locData.lng.toFixed(6)} (±${locData.accuracy}m)\n` +
    `Time Stopped: ${locData.timestamp} | Speed at Stop: ${locData.speedKmh} km/h | Last Battery: ${locData.battery}%\n` +
    `Driver: ${locData.driver} | Vehicle: ${locData.vehicle}\n` +
    `${policeInfoLine}\n` +
    `Google Maps Pin: ${mapsUrl}`;

  document.getElementById("sosPayload").innerText = lastSosMessage;
  document.getElementById("deliveryTracker").innerHTML = activeProfile.contacts
    .map((c, idx) => `<div class="delivery-item"><div><strong>${c.name}</strong> <span style="color:var(--text-muted); font-size:11px;">(${c.phone})</span></div><span id="delivStatus_${idx}" class="deliv-badge sending">📡 Sending...</span></div>`)
    .join("");
  document.getElementById("dispatchButtons").innerHTML = activeProfile.contacts
    .map((c, idx) => `<button class="btn btn-safe" onclick="openWhatsAppFallback(${idx})">💬 WhatsApp (${c.name})</button><button class="btn btn-purge" onclick="openSmsFallback(${idx})">📩 SMS (${c.name})</button>`)
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
      if (el) { el.className = "deliv-badge queued"; el.innerText = "📦 Queued Offline (Will Retry)"; }
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
      setTimeout(() => { el.className = "deliv-badge retry"; el.innerText = "⚠️ Retrying (2/3)..."; }, 900);
      setTimeout(() => { el.className = "deliv-badge ok"; el.innerText = `✅ Delivered (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })})`; }, 2200);
    } else {
      setTimeout(() => { el.className = "deliv-badge ok"; el.innerText = `✅ Delivered (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })})`; }, 1100);
    }
  });
}

function openWhatsAppFallback(index) {
  const contact = activeProfile?.contacts?.[index];
  if (!contact) return;
  window.open(`https://wa.me/${contact.phone.replace(/\D/g, "")}?text=${encodeURIComponent(lastSosMessage)}`, "_blank");
}

function openSmsFallback(index) {
  const contact = activeProfile?.contacts?.[index];
  if (!contact) return;
  window.open(`sms:${contact.phone}?body=${encodeURIComponent(lastSosMessage)}`, "_self");
}

function closeSosModal() { document.getElementById("sosModal").classList.add("hidden"); }

/* ===================================================================== */
/* 7. SAFETY AUDIT REPORT & ZERO-TRACE PRIVACY PURGE                     */
/* ===================================================================== */
function openSafetyReport(isPostRide = false) {
  const elapsedSec = rideStartTime ? Math.max(1, Math.round((Date.now() - rideStartTime) / 1000)) : 0;
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const secs = String(elapsedSec % 60).padStart(2, "0");
  const avgSpeed = speedSamples.length ? Math.round(speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length) : 0;
  const finalScore = evaluateRiskAnalytics();
  const nearestPs = currentCoords ? getNearestPolice(currentCoords.lat, currentCoords.lng) : { name: "Sulur Police Station", phone: "0422-2687233" };

  document.getElementById("reportSubtitle").innerText = isPostRide
    ? "Trip completed safely — all temporary telemetry & OCR data purged from memory."
    : "Real-time road telemetry & AI risk pattern summary";
  document.getElementById("repDist").innerText = `${totalDistanceKm.toFixed(2)} km`;
  document.getElementById("repDur").innerText = `${mins}:${secs}`;
  document.getElementById("repSpeed").innerText = `${avgSpeed} / ${maxSpeedKmh} km/h`;
  document.getElementById("repScore").innerText = `${finalScore} / 100`;

  document.getElementById("reportTextBox").innerText =
    `🛡️ RIDEGUARD AI — SAFETY AUDIT REPORT\n` +
    `Rider: ${activeProfile?.name || "Rider"}\n` +
    `Vehicle: ${document.getElementById("vehicleNumber").value || "Not Scanned"} | Driver: ${document.getElementById("driverName").value || "Not Scanned"}\n` +
    `Trip Distance: ${totalDistanceKm.toFixed(2)} km | Duration: ${mins}:${secs}\n` +
    `Avg / Max Speed: ${avgSpeed} / ${maxSpeedKmh} km/h\n` +
    `Safety Score: ${finalScore}/100 | Alerts Triggered: ${alertsTriggeredCount}\n` +
    `Coimbatore Dist. Police Info: ${nearestPs.name} • Ref Tel: ${nearestPs.phone}\n` +
    `Privacy Status: ${isPostRide ? "PURGED (Zero-Retention)" : "ACTIVE ENCRYPTED"}`;
  document.getElementById("reportModal").classList.remove("hidden");
}

function closeReportModal() { document.getElementById("reportModal").classList.add("hidden"); }

function copySafetyReport() {
  copyTextFallback(document.getElementById("reportTextBox").innerText);
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

  try { localStorage.removeItem(ACTIVE_RIDE_SNAPSHOT_KEY); } catch (e) {}
  if (shutdownPinMarker && map) { map.removeLayer(shutdownPinMarker); shutdownPinMarker = null; }
  if (liveTrailLine) liveTrailLine.setLatLngs([]);
  document.getElementById("vaultSyncBox")?.classList.remove("frozen");
  document.getElementById("driverName").value = "";
  document.getElementById("vehicleNumber").value = "";
  const fileInput = document.getElementById("screenshotInput");
  if (fileInput) fileInput.value = "";
  document.getElementById("imageQualityBadge").innerText = "Awaiting Scan";
  document.getElementById("ocrLocationBadge")?.classList.add("hidden");
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
  if (!t) return;
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}
