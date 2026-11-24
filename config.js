// RideGuard configuration
const CONFIG = {
  // Set this to your deployed HTTPS backend URL when available.
  API_BASE_URL: "http://127.0.0.1:5000",

  // Optional Geoapify key. The app falls back to public map tiles when unset.
  MAP_API_KEY: "YOUR_GEOAPIFY_API_KEY_HERE",

  // Public map tile endpoints
  MAP_TILES: {
    STREET: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    DARK_BASE: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    DARK_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    SATELLITE: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    SATELLITE_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },

  GEOCODE_ENDPOINTS: {
    PHOTON: "https://photon.komoot.io/reverse",
    NOMINATIM: "https://nominatim.openstreetmap.org/reverse",
    BIGDATACLOUD: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },

  HEARTBEAT_INTERVAL_MS: 10000,
  GPS_LOCK_TARGET_METERS: 25,
  GPS_LOCK_MAX_WAIT_MS: 7000,
  GPS_JITTER_MAX_METERS: 120,

  DEFAULT_CENTER: [11.0168, 76.9674],

  DEMO_ROUTE: [
    [11.0245, 76.9495],
    [11.0198, 76.9562],
    [11.0176, 76.9674],
    [11.0215, 76.9820],
    [11.0283, 77.0028]
  ],

  POLICE_STATIONS: [
    // South / Pollachi Highway & Othakalmandapam Corridor
    { name: "Madukkarai Police Station", lat: 10.9038, lng: 76.9602, phone: "0422-2622233" },
    { name: "Chettipalayam Police Station", lat: 10.9168, lng: 77.0264, phone: "0422-2655233" },
    { name: "Kinathukadavu Police Station", lat: 10.8214, lng: 77.0181, phone: "04259-242220" },
    { name: "Pollachi Town East Police Station", lat: 10.6609, lng: 77.0048, phone: "04259-224433" },
    { name: "Podanur Police Station (D4)", lat: 10.9632, lng: 76.9885, phone: "0422-2410233" },
    { name: "Sundarapuram / Kuniyamuthur PS (D3)", lat: 10.9585, lng: 76.9554, phone: "0422-2672233" },

    // Central Coimbatore & All Women Police Stations (AWPS)
    { name: "All Women Police Station (Central)", lat: 11.0162, lng: 76.9685, phone: "0422-2300970" },
    { name: "All Women Police Station (East)", lat: 10.9972, lng: 76.9958, phone: "0422-2316677" },
    { name: "Gandhipuram / Kattoor PS (C1)", lat: 11.0176, lng: 76.9674, phone: "0422-2494333" },
    { name: "Race Course Police Station (C3)", lat: 11.0018, lng: 76.9765, phone: "0422-2220100" },
    { name: "Ukkadam Police Station (B1)", lat: 10.9904, lng: 76.9614, phone: "0422-2390233" },
    { name: "R.S. Puram Police Station (B2)", lat: 11.0086, lng: 76.9498, phone: "0422-2544233" },
    { name: "Saibaba Colony Police Station (C2)", lat: 11.0252, lng: 76.9468, phone: "0422-2441234" },

    // East & North IT / Airport Corridors
    { name: "Peelamedu Police Station (E2)", lat: 11.0283, lng: 77.0028, phone: "0422-2572344" },
    { name: "Singanallur Police Station (E1)", lat: 11.0012, lng: 77.0285, phone: "0422-2573233" },
    { name: "Saravanampatti Police Station (E3)", lat: 11.0764, lng: 77.0042, phone: "0422-2666233" },
    { name: "Thudiyalur Police Station", lat: 11.0805, lng: 76.9412, phone: "0422-2642233" },
    { name: "Sulur Police Station", lat: 11.0246, lng: 77.1256, phone: "0422-2687233" }
  ],

  OCR_PATTERNS: {
    vehicleNumber: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/i,
    driverKeywords: /(?:driver|captain|partner|rider)[:\s]+([A-Za-z.\s]{3,25})/i
  }
};

// Add a required location field with both manual coordinate entry and a GPS button.
(() => {
  const profileKey = "rideguard_profile_v4";
  const demoLocation = [11.0168, 76.9674];

  function parseCoordinates(value) {
    const parts = String(value || "").split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lat, lng];
  }

  function addLocationField() {
    const phone = document.getElementById("userPhone");
    if (!phone || document.getElementById("userLocation")) return;

    const formRow = phone.parentElement.parentElement;
    formRow.insertAdjacentHTML("afterend", `
      <div style="margin-top:12px">
        <label for="userLocation">Location * (enter coordinates or use the location button)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="userLocation" required aria-describedby="locationHelp" placeholder="Latitude, longitude (example: 11.0168, 76.9674)" style="flex:1;min-width:0" />
          <button type="button" id="useLocationButton" class="icon-btn" aria-label="Use my current location" title="Use my current location" style="font-size:20px;padding:8px 12px">📍</button>
        </div>
        <div id="locationHelp" style="font-size:11px;color:var(--text-muted);margin-top:5px">Required. Type latitude and longitude, or tap 📍 and allow location access.</div>
        <div id="locationStatus" role="status" aria-live="polite" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
      </div>`);

    const input = document.getElementById("userLocation");
    const status = document.getElementById("locationStatus");
    const button = document.getElementById("useLocationButton");
    try {
      const saved = JSON.parse(localStorage.getItem(profileKey) || "null");
      if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
        input.value = `${saved.latitude}, ${saved.longitude}`;
      }
    } catch (error) {
      // Ignore invalid stored profile data and let the user provide a location.
    }

    button.addEventListener("click", () => {
      if (!navigator.geolocation) {
        status.textContent = "Location is not supported by this browser. Enter coordinates manually.";
        return;
      }
      button.disabled = true;
      status.textContent = "Getting your location… Please allow location access if asked.";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          input.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          status.textContent = "Location added. You can now save your profile.";
          button.disabled = false;
        },
        (error) => {
          const message = error.code === 1
            ? "Location permission was denied. Allow it in your browser settings or enter coordinates manually."
            : "Could not get your location. Try again or enter coordinates manually.";
          status.textContent = message;
          button.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });

    window.saveProfile = ((saveOriginal) => function () {
      const coordinates = parseCoordinates(input.value);
      if (!coordinates) {
        status.textContent = "Enter valid latitude and longitude, or tap 📍 to use your current location.";
        input.focus();
        return;
      }
      CONFIG.DEFAULT_CENTER = coordinates;
      return saveOriginal.apply(this, arguments);
    })(window.saveProfile);

    window.showDashboard = ((showOriginal) => function (profile) {
      const coordinates = parseCoordinates(input.value) ||
        (profile && parseCoordinates(`${profile.latitude}, ${profile.longitude}`));
      if (!coordinates) {
        status.textContent = "Location is required. Enter coordinates or tap 📍 before continuing.";
        return;
      }
      profile.latitude = coordinates[0];
      profile.longitude = coordinates[1];
      CONFIG.DEFAULT_CENTER = coordinates;
      try {
        localStorage.setItem(profileKey, JSON.stringify(profile));
      } catch (error) {
        status.textContent = "Could not save your profile in this browser. Check storage settings and try again.";
        return;
      }
      return showOriginal.apply(this, arguments);
    })(window.showDashboard);

    window.quickDemoLogin = ((demoOriginal) => function () {
      if (!parseCoordinates(input.value)) {
        input.value = `${demoLocation[0]}, ${demoLocation[1]}`;
      }
      return demoOriginal.apply(this, arguments);
    })(window.quickDemoLogin);
  }

  document.addEventListener("DOMContentLoaded", addLocationField);
})();
