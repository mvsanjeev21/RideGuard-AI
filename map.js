// map.js - Persistent Login, Leaflet Map, Real Mobile GPS & Heartbeat
let map, riderMarker, watchId, heartbeatTimer;
let currentCoords = { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1] };

// Load saved profile on startup
window.onload = () => {
  const saved = JSON.parse(localStorage.getItem("rideguard_profile"));
  if (saved) showDashboard(saved);
};

function saveProfile() {
  const profile = {
    name: document.getElementById("userName").value.trim(),
    contact: document.getElementById("emergencyPhone").value.trim()
  };
  if (!profile.name || !profile.contact) return alert("Enter name and emergency number.");
  localStorage.setItem("rideguard_profile", JSON.stringify(profile));
  showDashboard(profile);
}

function showDashboard(profile) {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("welcomeText").innerText = `Protected: ${profile.name}`;

  if (!map) {
    map = L.map("map").setView(CONFIG.DEFAULT_CENTER, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    riderMarker = L.marker(CONFIG.DEFAULT_CENTER).addTo(map).bindPopup("Rider Location");
    CONFIG.POLICE_STATIONS.forEach(ps => L.circleMarker([ps.lat, ps.lng], { color: "red" }).addTo(map).bindPopup(ps.name));
  }
}

function getNearestPolice(lat, lng) {
  return CONFIG.POLICE_STATIONS.reduce((nearest, ps) => {
    const dist = Math.hypot(ps.lat - lat, ps.lng - lng);
    return dist < nearest.dist ? { ...ps, dist } : nearest;
  }, { name: "Nearest Police", dist: Infinity });
}

function startSafeRide() {
  if (!navigator.geolocation) return alert("GPS not supported on this browser.");

  // Track real mobile GPS
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      riderMarker.setLatLng([currentCoords.lat, currentCoords.lng]);
      map.panTo([currentCoords.lat, currentCoords.lng]);
    },
    (err) => alert("Enable Location Permission: " + err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  // Send periodic heartbeat to Member 3's Python Server
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
  alert("Safe Ride Active! Server heartbeat started.");
}

async function sendHeartbeat() {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  const battery = navigator.getBattery ? Math.round((await navigator.getBattery()).level * 100) : 100;
  const police = getNearestPolice(currentCoords.lat, currentCoords.lng);

  fetch(`${CONFIG.API_BASE_URL}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: profile.name,
      contact: profile.contact,
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      battery,
      driver: document.getElementById("driverName").value || "Unknown",
      vehicle: document.getElementById("vehicleNumber").value || "Unknown",
      nearest_police: police.name
    })
  }).catch(() => console.warn("Backend offline - running in local mode."));
}

function triggerManualSOS() {
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  const mapsLink = `https://maps.google.com/?q=${currentCoords.lat},${currentCoords.lng}`;
  const msg = `🚨 RIDEGUARD SOS! ${profile.name} needs help! Vehicle: ${document.getElementById("vehicleNumber").value} | Location: ${mapsLink}`;

  // 1. Trigger Server Auto-Alert
  fetch(`${CONFIG.API_BASE_URL}/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: profile.name })
  }).catch(() => {});

  // 2. Instant Fallback: Open WhatsApp directly on phone
  const cleanPhone = profile.contact.replace(/\D/g, "");
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function endRideSafely() {
  navigator.geolocation.clearWatch(watchId);
  clearInterval(heartbeatTimer);
  const profile = JSON.parse(localStorage.getItem("rideguard_profile"));
  fetch(`${CONFIG.API_BASE_URL}/end-ride`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: profile.name })
  }).catch(() => {});
  alert("Ride ended safely. Temporary GPS & ride data purged.");
}
