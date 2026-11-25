/**
 * config.js — RideGuard AI runtime configuration.
 * Police station phone numbers are display-only; alerts are not sent to police.
 */

let configuredApiBaseUrl = "";
try {
  configuredApiBaseUrl = (localStorage.getItem("rideguard_api_base_url") || "").trim();
} catch (e) {
  // Storage may be disabled; the frontend can still run without a backend.
}

const CONFIG = {
  // Configure the hosted API with localStorage.setItem("rideguard_api_base_url", "https://your-api.example")
  // Empty by default so GitHub Pages never mistakenly calls a visitor's localhost.
  API_BASE_URL: (configuredApiBaseUrl || window.RIDEGUARD_API_BASE_URL || "").replace(/\/+$/, ""),

  MAP_TILES: {
    STREET: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    DARK_BASE: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    DARK_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    SATELLITE: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    SATELLITE_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },
  GEOCODE_ENDPOINTS: {
    PHOTON_SEARCH: "https://photon.komoot.io/api/",
    PHOTON: "https://photon.komoot.io/reverse",
    NOMINATIM_SEARCH: "https://nominatim.openstreetmap.org/search",
    NOMINATIM: "https://nominatim.openstreetmap.org/reverse",
    BIGDATACLOUD: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },
  OSRM_ROUTE_URL: "https://router.project-osrm.org/route/v1/driving",
  OVERPASS_ENDPOINTS: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ],
  HEARTBEAT_INTERVAL_MS: 10000,
  GPS_LOCK_TARGET_METERS: 25,
  GPS_LOCK_MAX_WAIT_MS: 12000,
  GPS_MAX_TRUSTED_ACCURACY_METERS: 300,
  GPS_COARSE_REJECT_METERS: 1200,
  GPS_JITTER_MAX_METERS: 120,
  LOCAL_POLICE_MAX_RADIUS_KM: 60,
  POLICE_STATIONS: [
    { name: "Sulur Police Station", zone: "Sulur, Arasur, KPRIET Corridor & Trichy Rd", lat: 11.0246, lng: 77.1256, phone: "0422-2687233" },
    { name: "Peelamedu Police Station", zone: "Peelamedu, Avinashi Rd, PSG Tech & Airport", lat: 11.0283, lng: 77.0028, phone: "0422-2572344" },
    { name: "Singanallur Police Station", zone: "Singanallur, Ondipudur & Trichy Rd Corridor", lat: 11.0012, lng: 77.0285, phone: "0422-2573233" },
    { name: "Saravanampatti Police Station", zone: "Saravanampatti, KCT Tech Park & Sathy Rd", lat: 11.0764, lng: 77.0042, phone: "0422-2666233" },
    { name: "Othakalmandapam Outpost", zone: "Othakalmandapam Junction & Pollachi Main Rd", lat: 10.9085, lng: 76.9985, phone: "0422-2655228" },
    { name: "Madukkarai Police Station", zone: "Madukkarai, Eachanari & NH-544 Bypass", lat: 10.9038, lng: 76.9602, phone: "0422-2622233" },
    { name: "Chettipalayam Police Station", zone: "Chettipalayam & Eastern Pollachi Corridor", lat: 10.9168, lng: 77.0264, phone: "0422-2655233" },
    { name: "Podanur Police Station", zone: "Podanur Junction, Chettipalayam Rd & Kurichi", lat: 10.9632, lng: 76.9885, phone: "0422-2410233" },
    { name: "Sundarapuram Police Station", zone: "Sundarapuram, Kuniyamuthur & Palakkad Rd", lat: 10.9585, lng: 76.9554, phone: "0422-2672233" },
    { name: "AWPS Central", zone: "Gandhipuram Central & All Women Police Wing", lat: 11.0162, lng: 76.9685, phone: "0422-2300970" },
    { name: "AWPS East", zone: "Ramanathapuram, Singanallur & Trichy Rd", lat: 10.9972, lng: 76.9958, phone: "0422-2316677" },
    { name: "Gandhipuram Police Station", zone: "Gandhipuram, Cross Cut Rd & 100ft Rd", lat: 11.0176, lng: 76.9674, phone: "0422-2494333" },
    { name: "Race Course Police Station", zone: "Race Course, Collectorate & Sungam", lat: 11.0018, lng: 76.9765, phone: "0422-2220100" },
    { name: "Ukkadam Police Station", zone: "Ukkadam Bus Terminus, Town Hall & Oppanakara St", lat: 10.9904, lng: 76.9614, phone: "0422-2390233" },
    { name: "R.S. Puram Police Station", zone: "R.S. Puram, DB Road & Brookefields", lat: 11.0086, lng: 76.9498, phone: "0422-2544233" },
    { name: "Saibaba Colony Police Station", zone: "Saibaba Colony, Mettupalayam Rd & NSR Rd", lat: 11.0252, lng: 76.9468, phone: "0422-2441234" },
    { name: "Thudiyalur Police Station", zone: "Thudiyalur, Vadamadurai & NGGO Colony", lat: 11.0805, lng: 76.9412, phone: "0422-2642233" },
    { name: "Kinathukadavu Police Station", zone: "Kinathukadavu & Southern Pollachi Hwy", lat: 10.8214, lng: 77.0181, phone: "04259-242220" },
    { name: "Pollachi Police Station", zone: "Pollachi Town & Valparai Junction", lat: 10.6609, lng: 77.0048, phone: "04259-224433" }
  ],
  OCR_PATTERNS: {
    vehicleNumber: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/i,
    driverKeywords: /(?:driver|captain|partner|pilot|rider)[:\s]+([A-Za-z.\s]{3,26})/i
  }
};

/*
 * The latest map.js commit accidentally removed the app's shared state and most
 * top-level functions. Load the last complete version first to restore those
 * globals. The current map.js then overrides its GPS/geocoding improvements.
 * This is pinned to an immutable commit so it cannot change unexpectedly.
 */
document.write('<script src="https://raw.githubusercontent.com/mvsanjeev21/RideGuard-AI/2f6ba60916d0bcda0ccaf799909e3a3f4f279889/map.js"><\/script>');

// Repair the accidentally truncated/nested coverage UI after all scripts load.
window.addEventListener("load", function restorePoliceCoverageUI() {
  window.updatePoliceCoverageUI = function updatePoliceCoverageUI(lat, lng, triggerToast = false) {
    const ranked = getRankedPoliceStations(lat, lng);
    const activePs = selectedTargetStation
      ? { ...selectedTargetStation, airKm: getAirDistanceKm(lat, lng, selectedTargetStation.lat, selectedTargetStation.lng) }
      : ranked[0];
    if (!activePs) return { name: "Sulur Police Station", phone: "0422-2687233", airKm: 0 };

    const inCoimbatore = isInsideCoimbatoreDistrict(lat, lng);
    const setTxt = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.innerText = value;
    };
    setTxt("activePsName", inCoimbatore ? activePs.name : `${activePs.name} (Coimbatore Dist. Ref)`);
    setTxt("activePsZone", `Jurisdiction: ${activePs.zone}`);
    setTxt("activePsAirDist", inCoimbatore ? `${activePs.airKm.toFixed(1)} km` : "Outside CBE");
    setTxt("activePsPhone", activePs.phone);

    const mapsLink = document.getElementById("hudGmapsLink");
    if (mapsLink) {
      mapsLink.href = `https://www.google.com/maps/dir/?api=1&origin=${lat.toFixed(5)},${lng.toFixed(5)}&destination=${activePs.lat.toFixed(5)},${activePs.lng.toFixed(5)}&travelmode=driving`;
    }
    if (activeStationHighlight) activeStationHighlight.setLatLng([activePs.lat, activePs.lng]);

    const panel = document.getElementById("policeCoveragePanel");
    if (lastActivePoliceName && lastActivePoliceName !== activePs.name && panel) {
      panel.classList.add("station-switched");
      setTimeout(() => panel.classList.remove("station-switched"), 1400);
      if (triggerToast) showToast(`🚓 Coimbatore Police Info switched to ${activePs.name}`);
    }
    lastActivePoliceName = activePs.name;

    const grid = document.getElementById("nearbyStationsGrid");
    if (grid) {
      grid.innerHTML = ranked.slice(0, 4).map((station, index) => {
        const selected = station.name === activePs.name;
        const distance = inCoimbatore ? `~${station.estRoadKm.toFixed(1)} km road` : "Coimbatore Dist.";
        return `<div class="pc-mini-card ${selected ? "nearest" : ""}" onclick="selectStationForRoadRouting(${index})"><div class="pc-mini-name">${selected ? "🟢 " : "🚓 "}${station.name}</div><div class="pc-mini-meta"><span>${distance}</span><span class="pc-mini-tel">${station.phone}</span></div></div>`;
      }).join("");
    }
    computeGoogleMapsRoadRoute(lat, lng, activePs);
    return activePs;
  };
});
