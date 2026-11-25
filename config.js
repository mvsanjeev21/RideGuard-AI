/* ===================================================================== */
/* config.js — Member 4: Dynamic Settings, 19-Station DB & App Rules     */
/* ===================================================================== */
const CONFIG = {
  API_BASE_URL: "http://localhost:5000",
  COIMBATORE_CENTER: [11.0168, 76.9674],
  COIMBATORE_DISTRICT_RADIUS_KM: 75,

  // GPS Lock & Accuracy Thresholds
  GPS_LOCK_MAX_WAIT_MS: 6000,
  GPS_LOCK_TARGET_METERS: 25,
  GPS_COARSE_REJECT_METERS: 1200,
  GPS_MAX_TRUSTED_ACCURACY_METERS: 300,
  GPS_JITTER_MAX_METERS: 120,
  HEARTBEAT_INTERVAL_MS: 8000,

  // Map Tiles & Road Routing Endpoints
  MAP_TILES: {
    STREET: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    DARK_BASE: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    DARK_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    SATELLITE: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    SATELLITE_LABELS: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
  },

  GEOCODE_ENDPOINTS: {
    PHOTON: "https://photon.komoot.io/reverse",
    PHOTON_SEARCH: "https://photon.komoot.io/api",
    BIGDATACLOUD: "https://api.bigdatacloud.net/data/reverse-geocode-client",
    NOMINATIM_SEARCH: "https://nominatim.openstreetmap.org/search"
  },

  OSRM_ROUTE_URL: "https://router.project-osrm.org/route/v1/driving",

  // v1.0 Scope: Coimbatore District Police Stations (Display-Only Reference Info)
  POLICE_STATIONS: [
    { name: "Sulur Police Station", phone: "0422-2687233", lat: 11.0246, lng: 77.1256, jurisdiction: "Sulur, Kangeyam Rd & Eastern Bypass" },
    { name: "Singanallur Police Station", phone: "0422-2573233", lat: 11.0012, lng: 77.0285, jurisdiction: "Singanallur, Trichy Rd & Ondipudur" },
    { name: "Peelamedu Police Station", phone: "0422-2574233", lat: 11.0283, lng: 77.0028, jurisdiction: "Peelamedu, Avinashi Rd & Airport Corridor" },
    { name: "Saravanampatti Police Station", phone: "0422-2666233", lat: 11.0764, lng: 77.0042, jurisdiction: "Saravanampatti, Sathy Rd & IT Corridor" },
    { name: "Gandhipuram All Women PS", phone: "0422-2300999", lat: 11.0168, lng: 76.9674, jurisdiction: "Gandhipuram Central Bus Stand & Cross Cut Rd" },
    { name: "Race Course Police Station", phone: "0422-2220100", lat: 11.0018, lng: 76.9762, jurisdiction: "Race Course, Sungam & Red Fields" },
    { name: "R.S. Puram Police Station", phone: "0422-2544233", lat: 11.0086, lng: 76.9498, jurisdiction: "R.S. Puram, DB Rd & Lawley Rd" },
    { name: "Ukkadam Police Station", phone: "0422-2390233", lat: 10.9904, lng: 76.9614, jurisdiction: "Ukkadam, Town Hall & Pollachi Bypass" },
    { name: "Podanur Police Station", phone: "0422-2410233", lat: 10.9632, lng: 76.9885, jurisdiction: "Podanur Railway Junction & Chettipalayam Rd" },
    { name: "Kuniyamuthur Police Station", phone: "0422-2252233", lat: 10.9628, lng: 76.9491, jurisdiction: "Kuniyamuthur & Palakkad Main Rd" },
    { name: "Thudiyalur Police Station", phone: "0422-2642233", lat: 11.0805, lng: 76.9412, jurisdiction: "Thudiyalur & Mettupalayam Rd" },
    { name: "Kovai Pudur Police Station", phone: "0422-2607233", lat: 10.9415, lng: 76.9358, jurisdiction: "Kovai Pudur & Madukkarai Approach" },
    { name: "Madukkarai Police Station", phone: "0422-2622233", lat: 10.9032, lng: 76.9598, jurisdiction: "Madukkarai NH-544 & Walayar Checkpost" },
    { name: "Periyanaickenpalayam PS", phone: "0422-2692233", lat: 11.1534, lng: 76.9482, jurisdiction: "Periyanaickenpalayam & Veerapandi" },
    { name: "Karamadai Police Station", phone: "04254-272233", lat: 11.2428, lng: 76.9589, jurisdiction: "Karamadai & Mettupalayam Corridor" },
    { name: "Mettupalayam Police Station", phone: "04254-222233", lat: 11.2998, lng: 76.9348, jurisdiction: "Mettupalayam Town & Ooty Ghat Base" },
    { name: "Kinathukadavu Police Station", phone: "04259-242233", lat: 10.8214, lng: 77.0181, jurisdiction: "Kinathukadavu & Pollachi Highway" },
    { name: "Pollachi Town East PS", phone: "04259-224233", lat: 10.6609, lng: 77.0048, jurisdiction: "Pollachi Central & Palakkad Rd" },
    { name: "Vadavalli Police Station", phone: "0422-2422233", lat: 11.0241, lng: 76.9012, jurisdiction: "Vadavalli & Marudhamalai Rd" }
  ]
};
