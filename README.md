🛡️ RideGuard-AI

Coimbatore-Focused Women's Safety & Ride Security Companion

RideGuard-AI is a real-time ride-monitoring and personal safety web application built around Coimbatore to support women's safety and security during daily commutes, college travel, and late-evening journeys. It combines high-accuracy GPS locking, start-to-end route visualization, vehicle plate auto-sync, risk pattern checks, and trusted-contact alert workflows.

🌸 Women's Safety & Security in the Current Scenario

Women commuting across Coimbatore—whether heading to colleges, workplaces, railway/bus hubs, or returning home late—often rely on ride-hailing cabs, autos, or shared transit along busy and unfamiliar stretches. When a ride feels off or a phone runs low on battery, quick access to verified trip details and live location sharing matters.

Live Journey & Route Awareness: Tracks active rides with directional travel bearings, live movement trails, and start-to-end road outlines so riders and trusted contacts can see where a trip is moving.

Vehicle Plate Accountability: Keeps the vehicle registration number synced across live location shares, heartbeats, and SOS alerts—helping ensure the plate being shared matches the ride without trailing OCR label noise.

Unusual Stop & Route Deviation Checks: Flags unexpected stops or off-route shifts with safety check-ins and countdown escalation to personal emergency contacts if unconfirmed.

Shutdown Vault & Offline Resilience: Saves last-known trip snapshots locally and queues heartbeats or SOS alerts when network signals drop, retrying once connectivity returns.

Emergency Reminder: RideGuard-AI is a supportive safety tool and does not replace official emergency services. In an immediate threat or emergency, always call 112 or 1091 (Women Helpline) directly.

✨ Core Capabilities

🛰️ Precision GPS Lock (map.js): Uses high-accuracy geolocation sampling (enableHighAccuracy: true) with accuracy filtering to reduce coarse network/cell location jumps and keep map views responsive on mobile and desktop screens.

🚘 Vehicle Plate Auto-Sync (syncVehiclePlate): Normalizes #vehicleNumber, binds input/change listeners, and keeps the plate updated during ride start, position updates, sharing, heartbeats, and SOS alerts.

🗺️ Interactive Radar & Trip Outlines: Displays start/end markers, road route lines, directional arrow markers, and switchable street, dark radar, and satellite map layers.

🚓 Coimbatore Police Station Reference: Highlights nearby police stations around Coimbatore with jurisdiction labels, road distance/ETA estimates, and reference contact numbers for route awareness.

📋 Safety Audit & Zero-Trace Ride End: Summarizes trip distance, duration, speeds, and risk score at the end of a ride while clearing temporary ride/OCR state.

📁 Repository Structure

RideGuard-AI/
├── README.md     # Project overview, women's safety context & setup guide
├── config.js     # Map tiles, routing endpoints, Coimbatore settings & station data
├── index.html    # Profile setup, map HUD, OCR/ticket scanner & alert modals
├── map.js        # GPS lock, plate auto-sync, trip outlines, risk checks & SOS
├── ocr.js        # Ticket/screenshot parsing & vehicle/location extraction
├── server.py     # Backend service for heartbeats, SOS alerts & ride sessions
└── style.css     # Responsive UI styling for mobile & desktop screens


🚀 Getting Started

Clone the repository:

git clone https://github.com/mvsanjeev21/RideGuard-AI.git
cd RideGuard-AI


Check configuration (config.js):
Verify map tile URLs, routing endpoints, and Coimbatore station/GPS thresholds before running.

Start the backend & serve the frontend:
Run server.py and serve index.html over localhost or HTTPS so browser geolocation permissions can prompt reliably.

Test a Safe Ride:

Sign in or load the demo profile with your Coimbatore starting location and trusted emergency contacts.

Verify or enter the vehicle registration number and confirm it stays synced when sharing or triggering alerts.

Start a ride and test GPS pinpoint, route/stop safety checks, and end-of-ride cleanup.# RideGuard-AI
