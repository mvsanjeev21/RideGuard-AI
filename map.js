// map.js — Member 1: Persistent Login, Auto-GPS Indexing, Dark Map, Heartbeat & Dual-Contact SOS
let map, riderMarker, routeLine, watchId, heartbeatTimer, demoTimer, switchOffTimer;
let isLiveGps = false;
let demoStep = 0;
let currentCoords = { lat: CONFIG.DEFAULT_CENTER[0], lng: CONFIG.DEFAULT_CENTER[1] };
let currentBattery = 82;
let lastSosMessage = "";

window.onload = () => {
  initBattery();
  const saved = JSON.parse(localStorage.getItem("rideguard_profile_v3"));
  if (saved && saved.contacts && saved.contacts.length >= 1) {
    showDashboard(saved);
  }
};

function detectGpsLocation() {
  const btn = document.getElementById("detectLocBtn");
  btn.innerText = "Locating...";

  const applyLocation = (lat, lng, label) => {
    document.getElementById("userLocation").value = label;
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    document.getElementById("gmapsLink").href = mapsUrl;
    document.getElementById("gmapsIframe").src = `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
    document.getElementById("gmapsPreviewBox").classList.remove("hidden");
    btn.innerText = "🎯 Detect GPS";
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        applyLocation(lat, lng, `GPS: ${lat}, ${lng}`);
        showToast("📍 Live GPS location indexed via Google Maps.");
      },
      () => {
        applyLocation(10.8808, 76.9936, "Othakalmandapam, Coimbatore, TN (10.8808, 76.9936)");
        showToast("Using Coimbatore default location (enable GPS for live pin).");
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  } else {
    applyLocation(10.8808, 76.9936, "Othakalmandapam, Coimbatore, TN (10.8808, 76.9936)");
  }
}

function saveProfile() {
  const name = document.getElementById("userName").value.trim();
  const email = document.getElementById("userEmail").value.trim();
  const userPhone = document.getElementById("userPhone").value.trim();
  const baseLocation = document.getElementById("userLocation").value.trim();
  const emName1 = document.getElementById("emName1").value.trim();
  const emPhone1 = document.getElementById("emPhone1").value.trim();
  const emName2 = document.getElementById("emName2").value.trim();
  const emPhone2 = document.getElementById("emPhone2").value.trim();

  if (!name || !email || !userPhone || !baseLocation || !emName1 || !emPhone1) {
    return showToast("Please fill in all required (*) fields.");
  }

  const contacts = [{ name: emName1, phone: emPhone1 }];
  if (emPhone2) contacts.push({ name: emName2 || "Secondary Contact", phone: emPhone2 });

  const profile = { name, email, userPhone, baseLocation, contacts };
  localStorage.setItem("rideguard_profile_v3", JSON.stringify(profile));
  showDashboard(profile);
}

function quickDemoLogin() {
  const demo = {
    name: "Ananya Sharma",
    email: "ananya@example.com",
    userPhone: "+91 98765 43210",
    baseLocation: "Othakalmandapam, Coimbatore, TN",
    contacts: [
      { name: "Parent", phone: "+919876500001" },
      { name: "Friend", phone: "+919876500002" }
    ]
  };
  localStorage.setItem("rideguard_profile_v3", JSON.stringify(demo));
  showDashboard(demo);
}

function logoutProfile() {
  localStorage.removeItem("rideguard_profile_v3");
  location.reload();
}

function showDashboard(profile) {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("welcomeUser").innerText =
    `Protected: ${profile.name} • ${profile.email} • ${profile.baseLocation}`;
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
