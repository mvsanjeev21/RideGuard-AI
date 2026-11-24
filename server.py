# server.py - Autonomous Dead-Man's Switch & Twilio Alert Engine
import os
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from twilio.rest import Client

app = Flask(__name__)
CORS(app)

# Store active rides in temporary RAM only (auto-deleted after ride for privacy)
active_rides = {}
DEADMAN_TIMEOUT_SEC = 45

# Set these in your terminal/Render dashboard (never hardcode keys on GitHub)
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886"  # Twilio Sandbox number

def dispatch_twilio_alert(ride, reason):
    maps_url = f"https://maps.google.com/?q={ride['lat']},{ride['lng']}"
    message_body = (
        f"🚨 RIDEGUARD AI ALERT ({reason})\n"
        f"User: {ride['user']} | Last Battery: {ride['battery']}%\n"
        f"Driver: {ride['driver']} | Vehicle: {ride['vehicle']}\n"
        f"Nearest Police: {ride['nearest_police']}\n"
        f"Last Known GPS: {maps_url}"
    )
    print("\n--- DISPATCHING EMERGENCY ALERT ---\n", message_body)

    if TWILIO_SID and TWILIO_TOKEN:
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        client.messages.create(
            from_=TWILIO_WHATSAPP_FROM,
            to=f"whatsapp:{ride['contact']}",
            body=message_body
        )

# Background thread checking for sudden phone switch-offs
def deadman_monitor():
    while True:
        now = time.time()
        for user, ride in list(active_rides.items()):
            if not ride["alerted"] and (now - ride["last_ping"] > DEADMAN_TIMEOUT_SEC):
                ride["alerted"] = True
                dispatch_twilio_alert(ride, "PHONE SWITCHED OFF / LOST SIGNAL")
        time.sleep(5)

@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    data = request.json
    active_rides[data["user"]] = {**data, "last_ping": time.time(), "alerted": False}
    return jsonify({"status": "alive"}), 200

@app.route("/sos", methods=["POST"])
def manual_sos():
    user = request.json.get("user")
    if user in active_rides:
        active_rides[user]["alerted"] = True
        dispatch_twilio_alert(active_rides[user], "MANUAL SOS TRIGGERED")
    return jsonify({"status": "dispatched"}), 200

@app.route("/end-ride", methods=["POST"])
def end_ride():
    user = request.json.get("user")
    active_rides.pop(user, None)  # Privacy purge
    return jsonify({"status": "purged"}), 200

if __name__ == "__main__":
    threading.Thread(target=deadman_monitor, daemon=True).start()
    app.run(host="0.0.0.0", port=5000)
