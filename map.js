// map.js — Member 1: Persistent Login (4 fields), Dark Map, Live GPS, Heartbeat & Dual-Contact SOS
let map, riderMarker, routeLine, watchId, heartbeatTimer, demoTimer, switchOffTimer;
let isLiveGps = false;
let demoStep = 0;
let currentCoords = { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1] };
let currentBattery = 82;
let lastSosMessage = "";

window.onload = () => {
  initBattery();
  const saved = JSON.parse(localStorage.getItem("rideguard_profile"));
  if (saved && saved.contacts && saved.contacts.length === 2) {
    showDashboard(saved);
  }
};

function saveProfile() {
  const name = document.getElementById("userName").value.trim();
  const userPhone = document.getElementById("userPhone").value.trim();
  const c1 = document.getElementById("emergencyPhone1").value.trim();
  const c2 = document.getElementById("emergencyPhone2").value.trim();

  if (!name || !userPhone || !c1 || !c2) {
    return showToast("Please fill in your name, phone number, and both emergency contacts.");
  }

  const profile = { name, userPhone, contacts: [c1, c2] };
  localStorage.setItem("rideguard_profile", JSON.stringify(profile));
  showDashboard(profile);
}

function quickDemoLogin() {
  const demo = {
    name: "Priya S.",
    userPhone: "+919000011111",
    contacts: ["+919876543210", "+919123456789"]
  };
  localStorage.setItem("rideguard_profile", JSON.stringify(demo));
  showDashboard(demo);
}

function logoutProfile() {
  localStorage.removeItem("rideguard_profile");
  location.reload();
}

function showDashboard(profile) {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("welcomeUser").innerText = `Protected: ${profile.name} (${profile.userPhone})`;
  setTimeout(initMap, 50);
}

function initMap() {
  if (map) { map.invalidateSize(); return; }

  map = L.map("map", { zoomControl: true }).setView(CONFIG.DEFAULT_CENTER, 13);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 19
  }).addTo(map);

  routeLine = L.polyline(CONFIG.DEMO_ROUTE, {
    color: "#22d3ee", weight: 4, opacity: 0.85
  }).addTo(map);

  riderMarker = L.marker(CONFIG.DEFAULT_CENTER).addTo(map).bindPopup("<b>Rider Live Location</b>");

  CONFIG.POLICE_STATIONS.forEach(ps => {
    L.circle([ps.lat, ps.lng], {
      radius: 450, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.18, weight: 1.5
    }).addTo(map);

    L.circleMarker([ps.lat, ps.lng], {
      radius: 7, color: "#fff", fillColor: "#ef4444", fillOpacity: 1, weight: 2
    }).addTo(map).bindPopup(`<b>🚓 ${ps.name}</b><br/>Tel: ${ps.phone}`);
  });
}

function toggleGpsMode() {
  isLiveGps = !isLiveGps;
  document.getElementById("gpsModeBtn").innerText = isLiveGps
    ? "Mode: Real Mobile GPS (Active)"
    : "Mode: Demo Route (Tap for Live GPS)";
  showToast(isLiveGps ? "Switched to Real Mobile GPS." : "Switched to Coimbatore Demo Route.");
}

function getNearestPolice(lat, lng) {
  return CONFIG.POLICE_STATIONS.reduce((nearest, ps) => {
    const dist = Math.hypot(ps.lat - lat, ps.lng - lng);
    return dist < nearest.dist ? { ...ps, dist } : nearest;
  }, { name: "Peelamedu Police Station", dist: Infinity });
}

function startSafeRide() {
  const badge = document.getElementById("sessionBadge");
  badge.innerText = "🛡️ ACTIVE SAFE RIDE SESSION";
  badge.classList.remove("danger");
  setHeartbeatUI(true);

  if (isLiveGps && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => updatePosition(pos.coords.latitude, pos.coords.longitude),
      (err) => showToast("GPS Error: " + err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  } else {
    clearInterval(demoTimer);
    demoStep = 0;
    demoTimer = setInterval(() => {
      const pt = CONFIG.DEMO_ROUTE[demoStep % CONFIG.DEMO_ROUTE.length];
      updatePosition(pt[0], pt[1]);
      demoStep++;
    }, 2500);
  }

  sendHeartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  showToast("Safe Ride started. 10s Server Heartbeat active.");
}

function updatePosition(lat, lng) {
  currentCoords = { lat, lng };
  if (riderMarker) riderMarker.setLatLng([lat, lng]);
  if (map) map.panTo([lat, lng]);
  const police = getNearestPolice(lat, lng);
  document.getElementById("policeText").innerText = `🚓 ${police.name.split(" ")[0]}`;
}

async function initBattery() {
  if (navigator.getBattery) {
    const bat = await navigator.getBattery();
    currentBattery = Math.round(bat.level * 100);
  }
  document.getElementById("batteryText").innerText = `🔋 ${currentBattery}%`;
}

function sendHeartbeat() {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  if (!profile) return;
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);

  fetch(`${CONFIG.API_BASE_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: profile.name,
      user_phone: profile.userPhone,
      contacts: profile.contacts,
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      battery: currentBattery,
      driver: document.getElementById("driverName").value || "Ramesh K.",
      vehicle: document.getElementById("vehicleNumber").value || "TN-38-AB-1234",
      nearest_police: police.name
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
  switchOffTimer = setTimeout(() => {
    triggerManualSOS("PHONE SWITCHED OFF / DEAD-MAN'S SWITCH");
  }, 5000);
}

function triggerManualSOS(reason) {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);
  const driver = document.getElementById("driverName").value || "Ramesh K.";
  const vehicle = document.getElementById("vehicleNumber").value || "TN-38-AB-1234";
  const mapsUrl = `https://maps.google.com/?q=${currentCoords.lat.toFixed(5)},${currentCoords.lng.toFixed(5)}`;

  lastSosMessage =
    `🚨 RIDEGUARD AI ALERT (${reason})\n` +
    `User: ${profile.name} (${profile.userPhone})\n` +
    `Last Battery: ${currentBattery}%\n` +
    `Driver: ${driver} | Vehicle: ${vehicle}\n` +
    `Nearest Police: ${police.name}\n` +
    `Last Known GPS: ${mapsUrl}`;

  document.getElementById("sosPayload").innerText = lastSosMessage;
  document.getElementById("sosModal").classList.remove("hidden");

  fetch(`${CONFIG.API_BASE_URL}/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: profile.name })
  }).catch(() => {});
}

function openWhatsAppFallback(index) {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  const phone = profile.contacts[index].replace(/\D/g, "");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lastSosMessage)}`, "_blank");
}

function openSmsFallback(index) {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  window.open(`sms:${profile.contacts[index]}?body=${encodeURIComponent(lastSosMessage)}`, "_self");
}

function closeSosModal() {
  document.getElementById("sosModal").classList.add("hidden");
}

function endRideSafely() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  clearInterval(demoTimer);
  clearTimeout(switchOffTimer);

  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
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
  setHeartbeatUI(true);
  showToast("✅ Ride ended safely. Temporary GPS & OCR data purged.");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}
