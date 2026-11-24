// config.js — Member 4: Keyless Google-Style Map Layers, Free Geocoders & 18-Station Police DB
const CONFIG = {
  // Replace with your HTTPS Render/Railway backend URL when deployed
  API_BASE_URL: "http://127.0.0.1:5000",

  // 100% Free, Zero-API-Key Map Tile Servers (Street, Dark Radar & Satellite Hybrid)
  MAP_TILES: {
    STREET: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    DARK_BASE: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    DARK_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    SATELLITE: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    SATELLITE_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },

  // 100% Free, Zero-API-Key Reverse Geocoding Endpoints (POI/Landmark + Street + Plus Code)
  GEOCODE_ENDPOINTS: {
    PHOTON: "https://photon.komoot.io/reverse",
    NOMINATIM: "https://nominatim.openstreetmap.org/reverse",
    BIGDATACLOUD: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },

  // Timers & GPS Precision Thresholds
  HEARTBEAT_INTERVAL_MS: 10000,      // 10s server heartbeat
  GPS_LOCK_TARGET_METERS: 25,        // Target accuracy for satellite lock
  GPS_LOCK_MAX_WAIT_MS: 7000,        // Max wait to refine GPS lock
  GPS_JITTER_MAX_METERS: 120,        // Ignore rough cell-tower spikes > 120m

  DEFAULT_CENTER: [11.0168, 76.9674], // Coimbatore Central

  DEMO_ROUTE: [
    [11.0245, 76.9495],
    [11.0198, 76.9562],
    [11.0176, 76.9674],
    [11.0215, 76.9820],
    [11.0283, 77.0028]
  ],

  POLICE_STATIONS: [
    // South / Pollachi Highway & Othakalmandapam Corridor
    { name: "Madukkarai Police Station", lat: 10.9038, lng: 76.
