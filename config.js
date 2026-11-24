// config.js — Member 4: Central Dynamic Configuration
const CONFIG = {
  // Change to your deployed Render/Railway URL when live
  API_BASE_URL: "http://127.0.0.1:5000",

  HEARTBEAT_INTERVAL_MS: 10000, // 10 seconds
  DEFAULT_CENTER: [11.0168, 76.9674], // Coimbatore

  DEMO_ROUTE: [
    [11.0245, 76.9495],
    [11.0198, 76.9562],
    [11.0176, 76.9674],
    [11.0215, 76.9820],
    [11.0283, 77.0028]
  ],

  POLICE_STATIONS: [
    { name: "Peelamedu Police Station", lat: 11.0283, lng: 77.0028, phone: "0422-2572344" },
    { name: "Gandhipuram Police Station", lat: 11.0176, lng: 76.9674, phone: "0422-2494333" },
    { name: "Saibaba Colony Police Station", lat: 11.0252, lng: 76.9468, phone: "0422-2441234" },
    { name: "Kinathukadavu Police Station", lat: 10.8214, lng: 77.0181, phone: "04259-242220" }
  ],

  OCR_PATTERNS: {
    vehicleNumber: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/i,
    driverKeywords: /(?:driver|captain|partner|rider)[:\s]+([A-Za-z.\s]{3,25})/i
  }
};
