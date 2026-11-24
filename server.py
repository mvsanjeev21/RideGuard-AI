# server.py — Member 3: Dead-Man's Switch & Dual-Contact Twilio Alert Engine
# Install dependencies: pip install flask flask-cors twilio
import os
import re
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from twilio.rest import Client

app = Flask(__name__)
CORS(app)

# Volatile RAM storage only (Zero-retention privacy policy)
active_rides = {}
DEADMAN_TIMEOUT_SEC = 45

TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")


def normalize_phone(raw_phone):
    """Strip spaces/dashes and ensure E.164 '+' format for Twilio."""
    digits = re.sub(r"[^\d+]", "", str(raw_phone or ""))
    if digits and not digits.startswith("+"):
        digits = f"+91{digits}" if len(digits) == 10 else f"+{digits}"
    return digits


def dispatch_twilio_alert(ride, reason):
    maps_url = f"https://maps.google.com/?q={ride['lat']},{ride['lng']}"
    message_body = (
        f"🚨 RIDEGUARD AI ALERT ({reason})\n"
        f"Rider: {ride['user']} ({ride.get('user_phone', 'N/A')})\n"
        f"Email: {ride.get('email', 'N/A')}\n"
        f"Speed: {ride.get('speed_kmh', 0)} km/h | GPS: ±{ride.get('accuracy_m', 0)}m | Battery: {ride['battery']}%\n"
        f"Driver: {ride['driver']} | Vehicle: {ride['vehicle']}\n"
        f"Nearest Police: {ride['nearest_police']}\n"
        f"Google Maps Pin: {maps_url}"
    )
    print("\n--- DISPATCHING EMERGENCY ALERT ---\n", message_body, "\n-----------------------------------")

    if TWILIO_SID and TWILIO_TOKEN:
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        for contact in ride.get("contacts", []):
            raw_num = contact.get("phone") if isinstance(contact, dict) else contact
            phone = normalize_phone(raw_num)
            if phone:
                try:
                    client.messages.create(
                        from_=TWILIO_WHATSAPP_FROM,
                        to=f"whatsapp:{phone}",
                        body=message_body
                    )
                except Exception as exc:
                    print(f"[Twilio Error for {phone}]: {exc}")


def deadman_monitor():
    while True:
        now = time.time()
        for user, ride in list(active_rides.items()):
            if not ride["alerted"] and (now - ride["last_ping"] > DEADMAN_TIMEOUT_SEC):
                ride["alerted"] = True
                dispatch_twilio_alert(ride, "PHONE SWITCHED OFF / SIGNAL LOST")
        time.sleep(5)


@app.route("/", methods=["GET"])
def health_check():
    return jsonify({
        "service": "RideGuard AI Dead-Man's Switch",
        "status": "online",
        "active_sessions": len(active_rides)
    }), 200


@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    data = request.json or {}
    user = data.get("user")
    if not user:
        return jsonify({"error": "Missing user field"}), 400

    active_rides[user] = {
        **data,
        "last_ping": time.time(),
        "alerted": False
    }
    return jsonify({"status": "alive"}), 200


@app.route("/sos", methods=["POST"])
def manual_sos():
    data = request.json or {}
    user = data.get("user")
    if user in active_rides:
        active_rides[user]["alerted"] = True
        dispatch_twilio_alert(active_rides[user], "MANUAL SOS TRIGGERED")
        return jsonify({"status": "dispatched"}), 200
    return jsonify({"status": "no_active_session"}), 404


@app.route("/end-ride", methods=["POST"])
def end_ride():
    data = request.json or {}
    user = data.get("user")
    active_rides.pop(user, None)  # Permanent volatile RAM purge
    return jsonify({"status": "purged"}), 200


if __name__ == "__main__":
    threading.Thread(target=deadman_monitor, daemon=True).start()
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
