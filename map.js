// map.js — Member 1: Persistent Login, Geoapify/Carto Map, Live GPS Telemetry, Police Vector & SOS
let map, darkTileLayer, satTileLayer, riderMarker, accuracyCircle, liveTrailLine, routeLine, policeVectorLine;
let watchId, heartbeatTimer, demoTimer, switchOffTimer, offRouteInterval;
let isLiveGps = false, isSatellite = false, autoFollow = true, showPoliceVec = false;
let demoStep = 0, totalDistanceKm = 0, lastGeocodeTime = 0;
let liveTrailCoords = [];
let currentCoords = { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1], accuracy: 15, speedKmh: 0, heading: 0 };
let currentAddress = "Coimbatore, Tamil Nadu";
let currentBattery = 82;
let lastSosMessage = "";

const PROFILE_STORAGE_KEY = "rideguard_profile_v4";

window.onload = () => {
  initBattery();
  const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  if (saved && saved.contacts && saved.contacts.length >= 1) {
    showDashboard(saved);
  }
};

function hasValidMapKey() {
  return CONFIG.MAP_API_KEY && CONFIG.MAP_API_KEY !== "YOUR_GEOAPIFY_API_KEY_HERE";
}

// Haversine exact real-world distance (km)
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
    if (hasValidMapKey()) {
      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${CONFIG.MAP_API_KEY}`
      );
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        return data.features[0].properties.formatted;
      }
    } else {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`
      );
      const data = await res.json();
      if (data && data.address) {
        const a = data.address;
        return [a.road || a.neighbourhood || a.suburb, a.city || a.town || a.village, a.state]
          .filter(Boolean).join(", ") || data.display_name;
      }
    }
  } catch (e) {}
  return `GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function saveProfile() {
  const name = document.getElementById("userName").value.trim();
  const email = document.getElementById("userEmail").value.trim();
  const userPhone = document.getElementById("userPhone").value.trim();
  const emName1 = document.getElementById("emName1").value.trim();
  const emPhone1 = document.getElementById("emPhone1").value.trim();
  const emName2 = document.getElementById("emName2").value.trim();
  const emPhone2 = document.getElementById("emPhone2").value.trim();

  if (!name || !email || !userPhone || !emName1 || !emPhone1) {
    return showToast("Please fill in all required (*) fields.");
  }

  const contacts = [{ name: emName1, phone: emPhone1 }];
  if (emPhone2) contacts.push({ name: emName2 || "Secondary Contact", phone: emPhone2 });

  const profile = { name, email, userPhone, contacts };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  showDashboard(profile);
}

function quickDemoLogin() {
  const demo = {
    name: "Ananya Sharma",
    email: "ananya@example.com",
    userPhone: "+91 98765 43210",
    contacts: [
      { name: "Parent", phone: "+919876500001" },
      { name: "Friend", phone: "+919876500002" }
    ]
  };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(demo));
  showDashboard(demo);
}

function logoutProfile() {
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  location.reload();
}

function showDashboard(profile) {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("welcomeUser").innerText = `Protected: ${profile.name} • ${profile.email}`;
  setTimeout(initMap, 50);
}

function initMap() {
  if (map) { map.invalidateSize(); return; }

  map = L.map("map", { zoomControl: true }).setView(CONFIG.DEFAULT_CENTER, 13);

  const darkUrl = hasValidMapKey()
    ? `https://maps.geoapify.com/v1/tile/dark-matter-dark-grey/{z}/{x}/{y}.png?apiKey=${CONFIG.MAP_API_KEY}`
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  darkTileLayer = L.tileLayer(darkUrl, {
    attribution: hasValidMapKey() ? "&copy; Geoapify &copy; OpenStreetMap" : "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 20
  }).addTo(map);

  satTileLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19
  });

  routeLine = L.polyline(CONFIG.DEMO_ROUTE, { color: "#22d3ee", weight: 3, opacity: 0.4, dashArray: "6, 8" }).addTo(map);
  liveTrailLine = L.polyline([], { color: "#22d3ee", weight: 4, opacity: 0.95 }).addTo(map);
  policeVectorLine = L.polyline([], { color: "#ef4444", weight: 2.5, dashArray: "6, 6" }).addTo(map);

  riderMarker = L.marker(CONFIG.DEFAULT_CENTER).addTo(map).bindPopup("<b>Rider Live Location</b>");
  accuracyCircle = L.circle(CONFIG.DEFAULT_CENTER, {
    radius: 20, color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.14, weight: 1
  }).addTo(map);

  // Render all 18 Police Stations from config.js
  CONFIG.POLICE_STATIONS.forEach(ps => {
    L.circle([ps.lat, ps.lng], {
      radius: 450, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.15, weight: 1.5
    }).addTo(map);

    L.circleMarker([ps.lat, ps.lng], {
      radius: 7, color: "#fff", fillColor: "#ef4444", fillOpacity: 1, weight: 2
    }).addTo(map).bindPopup(`<b>🚓 ${ps.name}</b><br/>Tel: ${ps.phone}`);
  });
}

function toggleGpsMode() {
  isLiveGps = !isLiveGps;
  const btn = document.getElementById("gpsModeBtn");
  btn.innerText = isLiveGps ? "📍 Mode: Real GPS" : "📍 Mode: Demo";
  btn.classList.toggle("active", isLiveGps);
  showToast(isLiveGps ? "Switched to High-Accuracy Mobile GPS." : "Switched to Coimbatore Demo Route.");
}

function toggleMapLayer() {
  isSatellite = !isSatellite;
  const btn = document.getElementById("layerBtn");
  if (isSatellite) {
    map.removeLayer(darkTileLayer);
    satTileLayer.addTo(map);
    btn.innerText = "🗺️ Dark Radar";
    btn.classList.add("active");
  } else {
    map.removeLayer(satTileLayer);
    darkTileLayer.addTo(map);
    btn.innerText = "📡 Satellite";
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
  const etaMins = Math.max(1, Math.round((ps.distKm / 30) * 60));
  showToast(`🚨 Nearest Police: ${ps.name} (${ps.distKm.toFixed(1)} km • ~${etaMins} min)`);
}

function simulateOffRoute() {
  const banner = document.getElementById("offRouteBanner");
  const cdEl = document.getElementById("offRouteCountdown");
  let secs = 10;
  cdEl.innerText = secs;
  banner.classList.remove("hidden");

  clearInterval(offRouteInterval);
  offRouteInterval = setInterval(() => {
    secs--;
    cdEl.innerText = secs;
    if (secs <= 0) {
      clearInterval(offRouteInterval);
      banner.classList.add("hidden");
      triggerManualSOS("UNCONFIRMED ROUTE DEVIATION");
    }
  }, 1000);
}

function confirmSafe() {
  clearInterval(offRouteInterval);
  document.getElementById("offRouteBanner").classList.add("hidden");
  showToast("✅ Safety confirmed. Monitoring resumed.");
}

function getNearestPolice(lat, lng) {
  return CONFIG.POLICE_STATIONS.reduce((nearest, ps) => {
    const distKm = getDistanceKm(lat, lng, ps.lat, ps.lng);
    return distKm < nearest.distKm ? { ...ps, distKm } : nearest;
  }, { name: "Peelamedu Police Station", lat: 11.0283, lng: 77.0028, distKm: Infinity });
}

function startSafeRide() {
  const badge = document.getElementById("sessionBadge");
  badge.innerText = "🛡️ ACTIVE SAFE RIDE SESSION";
  badge.classList.remove("danger");
  setHeartbeatUI(true);
  liveTrailCoords = [];
  totalDistanceKm = 0;
  if (liveTrailLine) liveTrailLine.setLatLngs([]);

  if (isLiveGps && navigator.geolocation) {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (liveTrailCoords.length > 0 && pos.coords.accuracy > CONFIG.GPS_JITTER_MAX_METERS) return;
        const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, speedKmh, pos.coords.heading || 0);
      },
      (err) => showToast(`GPS Error (${err.message}). Test on mobile over HTTPS with Precise Location.`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  } else {
    clearInterval(demoTimer);
    demoStep = 0;
    demoTimer = setInterval(() => {
      const pt = CONFIG.DEMO_ROUTE[demoStep % CONFIG.DEMO_ROUTE.length];
      updatePosition(pt[0], pt[1], 10, 32, 65);
      demoStep++;
    }, 2500);
  }

  sendHeartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  showToast("Safe Ride active. High-accuracy GPS + 10s Heartbeat running.");
}

async function updatePosition(lat, lng, accuracy = 15, speedKmh = 0, heading = 0) {
  if (liveTrailCoords.length > 0) {
    const prev = liveTrailCoords[liveTrailCoords.length - 1];
    totalDistanceKm += getDistanceKm(prev[0], prev[1], lat, lng);
  }

  currentCoords = { lat, lng, accuracy: Math.round(accuracy), speedKmh, heading };
  liveTrailCoords.push([lat, lng]);

  if (riderMarker) riderMarker.setLatLng([lat, lng]);
  if (accuracyCircle) accuracyCircle.setLatLng([lat, lng]).setRadius(Math.min(accuracy, 200));
  if (liveTrailLine) liveTrailLine.setLatLngs(liveTrailCoords);
  if (autoFollow && map) map.panTo([lat, lng]);
  if (showPoliceVec) updatePoliceVector();

  // Update Live Telemetry HUD
  const sigEl = document.getElementById("hudSignal");
  sigEl.className = "sig-badge" + (accuracy > 80 ? " weak" : accuracy > 30 ? " fair" : "");
  sigEl.innerText = accuracy <= 30 ? `GPS LOCKED ±${Math.round(accuracy)}m` : `±${Math.round(accuracy)}m`;
  document.getElementById("hudSpeed").innerText = `${speedKmh} km/h`;
  document.getElementById("hudHeading").innerText = getCardinalHeading(heading);
  document.getElementById("hudDist").innerText = `${totalDistanceKm.toFixed(2)} km`;
  document.getElementById("hudCoords").innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

  const police = getNearestPolice(lat, lng);
  const distLabel = police.distKm < 1 ? `${Math.round(police.distKm * 1000)}m` : `${police.distKm.toFixed(1)}km`;
  document.getElementById("policeText").innerText = `🚓 ${police.name.split(" ")[0]} (${distLabel})`;

  if (Date.now() - lastGeocodeTime > 15000) {
    lastGeocodeTime = Date.now();
    currentAddress = await reverseGeocode(lat, lng);
    document.getElementById("hudAddress").innerText = currentAddress;
  }
}

async function initBattery() {
  if (navigator.getBattery) {
    const bat = await navigator.getBattery();
    currentBattery = Math.round(bat.level * 100);
  }
  document.getElementById("batteryText").innerText = `🔋 ${currentBattery}%`;
}

function sendHeartbeat() {
  const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  if (!profile) return;
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);

  fetch(`${CONFIG.API_BASE_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: profile.name,
      email: profile.email,
      user_phone: profile.userPhone,
      contacts: profile.contacts,
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      accuracy_m: currentCoords.accuracy,
      speed_kmh: currentCoords.speedKmh,
      battery: currentBattery,
      driver: document.getElementById("driverName").value || "Ramesh K.",
      vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234",
      nearest_police: `${police.name} (${police.distKm.toFixed(1)} km)`
    })
  }).catch(() => {});
}

function setHeartbeatUI(online) {
  const status = document.getElementById("hbStatus");
  const dot = document.getElementById("hbDot");
  status.innerText = online ? "ONLINE" : "OFFLINE (SIGNAL LOST)";
  status.classList.toggle("offline", !online);
  dot.classList.toggle("offline", !online);
}

function testSwitchOff() {
  clearInterval(heartbeatTimer);
  setHeartbeatUI(false);
  const badge = document.getElementById("sessionBadge");
  badge.innerText = "⚠️ HEARTBEAT LOST — DEAD-MAN'S SWITCH (5s)";
  badge.classList.add("danger");
  showToast("Simulated phone switch-off! Auto-dispatching in 5s...");

  clearTimeout(switchOffTimer);
  switchOffTimer = setTimeout(() => triggerManualSOS("PHONE SWITCHED OFF / DEAD-MAN'S SWITCH"), 5000);
}

async function triggerManualSOS(reason) {
  const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const driver = document.getElementById("driverName").value || "Ramesh K.";
  const vehicle = document.getElementById("vehicleNumber").value || "TN-38-AB-1234";
  const mapsUrl = `https://maps.google.com/?q=${currentCoords.lat.toFixed(5)},${currentCoords.lng.toFixed(5)}`;
  const liveAddr = await reverseGeocode(currentCoords.lat, currentCoords.lng);

  lastSosMessage =
    `🚨 RIDEGUARD AI ALERT (${reason})\n` +
    `Rider: ${profile.name} (${profile.userPhone})\n` +
    `Email: ${profile.email}\n` +
    `Live Area: ${liveAddr}\n` +
    `Speed: ${currentCoords.speedKmh} km/h | GPS: ±${currentCoords.accuracy}m | Battery: ${currentBattery}%\n` +
    `Driver: ${driver} | Vehicle: ${vehicle}\n` +
    `Nearest Police: ${police.name} (${police.distKm.toFixed(1)} km)\n` +
    `Google Maps Pin: ${mapsUrl}`;

  document.getElementById("sosPayload").innerText = lastSosMessage;
  document.getElementById("dispatchButtons").innerHTML = profile.contacts.map((c, idx) => `
    <button class="btn btn-safe" onclick="openWhatsAppFallback(${idx})">💬 WhatsApp (${c.name})</button>
    <button class="btn btn-purge" onclick="openSmsFallback(${idx})">📩 SMS (${c.name})</button>
  `).join("");
  document.getElementById("sosModal").classList.remove("hidden");

  fetch(`${CONFIG.API_BASE_URL}/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: profile.name })
  }).catch(() => {});
}

function openWhatsAppFallback(index) {
  const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  const phone = profile.contacts[index].phone.replace(/\D/g, "");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lastSosMessage)}`, "_blank");
}

function openSmsFallback(index) {
  const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  window.open(`sms:${profile.contacts[index].phone}?body=${encodeURIComponent(lastSosMessage)}`, "_self");
}

function closeSosModal() {
  document.getElementById("sosModal").classList.add("hidden");
}

function endRideSafely() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  clearInterval(demoTimer);
  clearTimeout(switchOffTimer);
  clearInterval(offRouteInterval);
  liveTrailCoords = [];
  totalDistanceKm = 0;
  if (liveTrailLine) liveTrailLine.setLatLngs([]);
  if (policeVectorLine) policeVectorLine.setLatLngs([]);

  const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  fetch(`${CONFIG.API_BASE_URL}/end-ride`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: profile.name })
  }).catch(() => {});

  document.getElementById("driverName").value = "";
  document.getElementById("vehicleNumber").value = "";
  document.getElementById("ocrStatus").innerText = "Waiting for booking screenshot...";
  document.getElementById("ocrStatus").classList.remove("success");
  document.getElementById("ocrPreview").innerHTML = "<strong>Upload Rapido / Uber / Ola Screenshot</strong><br/>Click to browse or tap <em>Load Sample</em>";
  document.getElementById("sessionBadge").innerText = "🛡️ RIDE ENDED — ZERO DATA RETAINED";
  document.getElementById("sessionBadge").classList.remove("danger");
  document.getElementById("offRouteBanner").classList.add("hidden");
  setHeartbeatUI(true);
  showToast("✅ Ride ended safely. Temporary GPS & OCR data purged.");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}
