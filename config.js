// config.js - Central dynamic configuration for RideGuard AI
const CONFIG = {
  // Change this to your live Render/Railway URL when deployed
  API_BASE_URL: "http://127.0.0.1:5000",

  // Heartbeat & Safety Timers
  HEARTBEAT_INTERVAL_MS: 10000, // Send GPS ping every 10 seconds
  DEFAULT_CENTER: [11.0168, 76.9558], // Default map center (Coimbatore)

  // Dynamic Police Station Database (Add any city/station here)
  POLICE_STATIONS: [
    { name: "Peelamedu Police Station", lat: 11.0283, lng: 77.0028, phone: "0422-2572344" },
    { name: "Gandhipuram Police Station", lat: 11.0176, lng: 76.9674, phone: "0422-2494333" },
    { name: "Kinathukadavu Police Station", lat: 10.8214, lng: 77.0181, phone: "04259-242220" }
  ],

  // Dynamic Regex Patterns (Easy to add Ola, Namma Yatri, etc. in the future)
  OCR_PATTERNS: {
    vehicleNumber: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/i,
    driverKeywords: /(?:driver|captain|partner)[:\s]+([A-Za-z\s]{3,25})/i
  }
};
