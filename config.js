// RideGuard configuration
const CONFIG = {
  // Set this to your deployed HTTPS backend URL when available.
  API_BASE_URL: "http://127.0.0.1:5000",
  // Optional Geoapify key. The app falls back to public map tiles when unset.
  MAP_API_KEY: "YOUR_GEOAPIFY_API_KEY_HERE",
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
    { name: "Madukkarai Police Station", lat: 10.9038, lng: 76.9602, phone: "0422-2622233" },
    { name: "Chettipalayam Police Station", lat: 10.9168, lng: 77.0264, phone: "0422-2655233" },
    { name: "Kinathukadavu Police Station", lat: 10.8214, lng: 77.0181, phone: "04259-242220" },
    { name: "Pollachi Town East Police Station", lat: 10.6609, lng: 77.0048, phone: "04259-224433" },
    { name: "Podanur Police Station (D4)", lat: 10.9632, lng: 76.9885, phone: "0422-2410233" },
    { name: "Sundarapuram / Kuniyamuthur PS (D3)", lat: 10.9585, lng: 76.9554, phone: "0422-2672233" },
    { name: "All Women Police Station (Central)", lat: 11.0162, lng: 76.9685, phone: "0422-2300970" },
    { name: "All Women Police Station (East)", lat: 10.9972, lng: 76.9958, phone: "0422-2316677" },
    { name: "Gandhipuram / Kattoor PS (C1)", lat: 11.0176, lng: 76.9674, phone: "0422-2494333" },
    { name: "Race Course Police Station (C3)", lat: 11.0018, lng: 76.9765, phone: "0422-2220100" },
    { name: "Ukkadam Police Station (B1)", lat: 10.9904, lng: 76.9614, phone: "0422-2390233" },
    { name: "R.S. Puram Police Station (B2)", lat: 11.0086, lng: 76.9498, phone: "0422-2544233" },
    { name: "Saibaba Colony Police Station (C2)", lat: 11.0252, lng: 76.9468, phone: "0422-2441234" },
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

// Location is required. Users can enter a place/address or use the GPS button.
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

  async function resolveAddress(query) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Address search failed");
    const data = await response.json();
    const feature = data.features && data.features[0];
    if (!feature) throw new Error("No matching place found");
    const [longitude, latitude] = feature.geometry.coordinates;
    const p = feature.properties;
    const name = p.name || p.street || p.locality || p.district || p.city || p.county;
    const place = [name, p.suburb, p.city || p.town || p.village, p.state, p.country]
      .filter((part, index, values) => part && values.indexOf(part) === index)
      .join(", ");
    return { latitude, longitude, place: place || query };
  }

  async function reverseLookup(latitude, longitude) {
    const url = `https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not look up the place name");
    const data = await response.json();
    const p = data.features && data.features[0] && data.features[0].properties;
    if (!p) throw new Error("Could not find a readable place name here");
    const name = p.name || p.street || p.locality || p.district || p.city || p.county;
    const place = [name, p.suburb, p.city || p.town || p.village, p.state, p.country]
      .filter((part, index, values) => part && values.indexOf(part) === index)
      .join(", ");
    if (!place) throw new Error("Could not find a readable place name here");
    return place;
  }

  function addLocationField() {
    const phone = document.getElementById("userPhone");
    if (!phone || document.getElementById("userLocation")) return;

    phone.parentElement.parentElement.insertAdjacentHTML("afterend", `
      <div style="margin-top:12px">
        <label for="userLocation">Location * (place name or address)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="userLocation" required aria-describedby="locationHelp" placeholder="Enter street, area, town/city" style="flex:1;min-width:0" />
          <button type="button" id="useLocationButton" class="icon-btn" aria-label="Use my current location" title="Use my current location" style="font-size:20px;padding:8px 12px">📍</button>
        </div>
        <div id="locationHelp" style="font-size:11px;color:var(--text-muted);margin-top:5px">Required. Type a precise place/address or tap 📍 and allow location access.</div>
        <div id="locationStatus" role="status" aria-live="polite" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
      </div>`);

    const input = document.getElementById("userLocation");
    const status = document.getElementById("locationStatus");
    const button = document.getElementById("useLocationButton");
    let selectedCoordinates = null;

    try {
      const saved = JSON.parse(localStorage.getItem(profileKey) || "null");
      if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
        selectedCoordinates = [saved.latitude, saved.longitude];
        input.value = saved.locationName || "";
      }
    } catch (error) {
      // Ignore invalid stored profile data.
    }

    input.addEventListener("input", () => { selectedCoordinates = null; });

    button.addEventListener("click", () => {
      if (!navigator.geolocation) {
        status.textContent = "Location is not supported. Enter a place name or address.";
        return;
      }
      button.disabled = true;
      status.textContent = "Getting your location and place name… Allow location access if asked.";
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const place = await reverseLookup(latitude, longitude);
          input.value = place;
          selectedCoordinates = [latitude, longitude];
          status.textContent = `Location found: ${place}`;
        } catch (error) {
          input.value = "";
          selectedCoordinates = null;
          status.textContent = "Could not get a readable place name. Enter your place/address manually and try again.";
        } finally {
          button.disabled = false;
        }
      }, (error) => {
        status.textContent = error.code === 1
          ? "Location permission denied. Allow it in browser settings or enter a place/address manually."
          : "Could not get your location. Try again or enter a place/address manually.";
        button.disabled = false;
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });

    async function prepareLocation(profile) {
      const typedValue = input.value.trim();
      if (!typedValue) {
        status.textContent = "Location is required. Enter a place/address or tap 📍.";
        input.focus();
        return false;
      }
      if (selectedCoordinates && typedValue === (profile && profile.locationName || input.value.trim())) {
        profile.latitude = selectedCoordinates[0];
        profile.longitude = selectedCoordinates[1];
        profile.locationName = typedValue;
        return true;
      }
      const coordinates = parseCoordinates(typedValue);
      if (coordinates) {
        try {
          status.textContent = "Finding the place name for these coordinates…";
          const place = await reverseLookup(coordinates[0], coordinates[1]);
          input.value = place;
          profile.latitude = coordinates[0];
          profile.longitude = coordinates[1];
          profile.locationName = place;
          selectedCoordinates = coordinates;
          status.textContent = `Location found: ${place}`;
          return true;
        } catch (error) {
          status.textContent = "Could not find a readable place name. Enter a place/address instead.";
          return false;
        }
      }
      try {
        status.textContent = "Searching for this place…";
        const result = await resolveAddress(typedValue);
        input.value = result.place;
        profile.latitude = result.latitude;
        profile.longitude = result.longitude;
        profile.locationName = result.place;
        selectedCoordinates = [result.latitude, result.longitude];
        status.textContent = `Place found: ${result.place}`;
        return true;
      } catch (error) {
        status.textContent = "Place not found. Add a street/area and city, then try again.";
        return false;
      }
    }

    const originalSave = window.saveProfile;
    window.saveProfile = async function () {
      const profile = {
        name: document.getElementById("userName").value.trim(),
        email: document.getElementById("userEmail").value.trim(),
        userPhone: document.getElementById("userPhone").value.trim(),
        contacts: []
      };
      const emName1 = document.getElementById("emName1").value.trim();
      const emPhone1 = document.getElementById("emPhone1").value.trim();
      const emName2 = document.getElementById("emName2").value.trim();
      const emPhone2 = document.getElementById("emPhone2").value.trim();
      if (!profile.name || !profile.email || !profile.userPhone || !emName1 || !emPhone1) {
        return originalSave.apply(this, arguments);
      }
      profile.contacts = [{ name: emName1, phone: emPhone1 }];
      if (emPhone2) profile.contacts.push({ name: emName2 || "Secondary Contact", phone: emPhone2 });
      if (!(await prepareLocation(profile))) return;
      CONFIG.DEFAULT_CENTER = [profile.latitude, profile.longitude];
      localStorage.setItem(profileKey, JSON.stringify(profile));
      window.showDashboard(profile);
    };

    const originalDemo = window.quickDemoLogin;
    window.quickDemoLogin = async function () {
      if (!input.value.trim()) input.value = "Gandhipuram, Coimbatore, Tamil Nadu, India";
      const profile = {
        name: "Ananya Sharma",
        email: "ananya@example.com",
        userPhone: "+91 98765 43210",
        contacts: [
          { name: "Parent", phone: "+919876500001" },
          { name: "Friend", phone: "+919876500002" }
        ]
      };
      if (!(await prepareLocation(profile))) return;
      CONFIG.DEFAULT_CENTER = [profile.latitude, profile.longitude];
      localStorage.setItem(profileKey, JSON.stringify(profile));
      window.showDashboard(profile);
    };
  }

  document.addEventListener("DOMContentLoaded", addLocationField);
})();
