// config.js — Member 4: Central Dynamic Configuration & Expanded Coimbatore Police DB
const CONFIG = {
  // Replace with your HTTPS Render/Railway backend URL when deployed
  API_BASE_URL: "http://127.0.0.1:5000",

  // Paste your free Geoapify API key here (auto-falls back to free CartoDB tiles if left as placeholder)
  MAP_API_KEY: "YOUR_GEOAPIFY_API_KEY_HERE",

  // Timers & GPS Precision Thresholds
  HEARTBEAT_INTERVAL_MS: 10000,      // 10s server heartbeat
  GPS_LOCK_TARGET_METERS: 30,        // Target accuracy for initial satellite lock
  GPS_LOCK_MAX_WAIT_MS: 8000,        // Max wait to refine GPS lock
  GPS_JITTER_MAX_METERS: 120,        // Ignore wild GPS spikes worse than 120m

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
