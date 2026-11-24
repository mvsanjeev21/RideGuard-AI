// config.js — Member 4: Dynamic Settings, Coimbatore 19-Station Police DB & App Rules
const CONFIG = {
  // Backend Flask Dead-Man's Switch API URL (update to HTTPS URL when deployed)
  API_BASE_URL: "http://127.0.0.1:5000",

  // Keyless High-DPI Esri Map Tile Layers (Zero API keys or watermarks)
  MAP_TILES: {
    STREET: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    DARK_BASE: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    DARK_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    SATELLITE: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    SATELLITE_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },

  // 3-Tier Keyless Reverse Geocoding & Place Search Endpoints
  GEOCODE_ENDPOINTS: {
    PHOTON_SEARCH: "https://photon.komoot.io/api/",
    PHOTON: "https://photon.komoot.io/reverse",
    NOMINATIM: "https://nominatim.openstreetmap.org/reverse",
    BIGDATACLOUD: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },

  // Telemetry, Dead-Man's Switch & Precision GPS Lock Settings
  HEARTBEAT_INTERVAL_MS: 10000,
  GPS_LOCK_TARGET_METERS: 25,
  GPS_LOCK_MAX_WAIT_MS: 7000,
  GPS_JITTER_MAX_METERS: 120,

  // Default Center: Othakalmandapam, Coimbatore, Tamil Nadu
  DEFAULT_CENTER: [10.9085, 76.9985],

  // 6-Stop Coimbatore Corridor Demo Route (South-to-East Transit)
  DEMO_ROUTE: [
    [10.9085, 76.9985], // 1. Othakalmandapam
    [10.9350, 76.9820], // 2. Malumichampatti
    [10.9632, 76.9885], // 3. Podanur
    [10.9904, 76.9614], // 4. Ukkadam
    [11.0176, 76.9674], // 5. Gandhipuram
    [11.0283, 77.0028]  // 6. Peelamedu
  ],

  DEMO_ROUTE_LABELS: [
    "Othakalmandapam, Coimbatore, Tamil Nadu",
    "Malumichampatti, Coimbatore, Tamil Nadu",
    "Podanur, Coimbatore, Tamil Nadu",
    "Ukkadam, Coimbatore, Tamil Nadu",
    "Gandhipuram, Coimbatore, Tamil Nadu",
    "Peelamedu, Coimbatore, Tamil Nadu"
  ],

  // 19 Coimbatore & Surrounding Police Stations (Strictly Display-Only Reference Info)
  POLICE_STATIONS: [
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
    { name: "Peelamedu Police Station", zone: "Peelamedu, Avinashi Rd, PSG Tech & Airport", lat: 11.0283, lng: 77.0028, phone: "0422-2572344" },
    { name: "Singanallur Police Station", zone: "Singanallur, Ondipudur & Trichy Rd Corridor", lat: 11.0012, lng: 77.0285, phone: "0422-2573233" },
    { name: "Saravanampatti Police Station", zone: "Saravanampatti, KCT Tech Park & Sathy Rd", lat: 11.0764, lng: 77.0042, phone: "0422-2666233" },
    { name: "Thudiyalur Police Station", zone: "Thudiyalur, Vadamadurai & NGGO Colony", lat: 11.0805, lng: 76.9412, phone: "0422-2642233" },
    { name: "Sulur Police Station", zone: "Sulur, Kangeyam Rd & Eastern Bypass", lat: 11.0246, lng: 77.1256, phone: "0422-2687233" },
    { name: "Kinathukadavu Police Station", zone: "Kinathukadavu & Southern Pollachi Hwy", lat: 10.8214, lng: 77.0181, phone: "04259-242220" },
    { name: "Pollachi Police Station", zone: "Pollachi Town & Valparai Junction", lat: 10.6609, lng: 77.0048, phone: "04259-224433" }
  ],

  // OCR Extraction Patterns for Indian Plates & Ride-Hailing Driver Labels
  OCR_PATTERNS: {
    vehicleNumber: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/i,
    driverKeywords: /(?:driver|captain|partner|pilot|rider)[:\s]+([A-Za-z.\s]{3,26})/i
  }
};
