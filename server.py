"""
server.py — Member 3: Python Flask Dead-Man's Switch, Sudden Phone Shutdown
Final-Location Vault & Trusted-Contacts-Only Twilio WhatsApp/SMS Dispatcher.

Privacy & Dispatch Policy:
1. Volatile RAM Storage Only: Active ride telemetry is stored strictly in memory
   and purged immediately when `/end-ride` is called.
2. Trusted Personal Contacts Only: Emergency alerts are dispatched EXCLUSIVELY
   to the rider's saved emergency contacts (`contacts`). Nearest police station
   details are included strictly as read-only reference text; no automated
   messages or calls are ever placed to police numbers.
"""

import os
import time
import threading
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Configurable Dead-Man's Switch silence threshold (default: 45 seconds)
DEADMAN_TIMEOUT_SECONDS = int(os.getenv("DEADMAN_TIMEOUT_SECONDS", "45"))
MAX_DISPATCH_RETRIES = 3

# Optional Twilio Credentials (falls back to detailed console dispatch log if unset)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
TWILIO_SMS_FROM = os.getenv("TWILIO_SMS_FROM", "")

# Volatile RAM-only dictionary of active rides (zero disk persistence)
active_rides = {}
rides_lock = threading.Lock()


def normalize_e164(phone: str) -> str:
    """Normalizes Indian and international phone numbers to +E.164 format."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        return f"+91{digits}"
    if not str(phone).strip().startswith("+"):
        return f"+{digits}"
    return f"+{digits}"


def send_via_twilio_with_retry(contact_name: str, contact_phone: str, message_body: str) -> dict:
    """
    Sends an emergency alert exclusively to a saved personal contact with
    up to MAX_DISPATCH_RETRIES attempts if a transient network error occurs.
    """
    to_number = normalize_e164(contact_phone)
    if not to_number:
        return {"contact": contact_name, "status": "skipped_invalid_phone"}

    for attempt in range(1, MAX_DISPATCH_RETRIES + 1):
        try:
            if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
                from twilio.rest import Client
                client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

                # 1. WhatsApp Alert to Trusted Personal Contact
                client.messages.create(
                    from_=TWILIO_WHATSAPP_FROM,
                    to=f"whatsapp:{to_number}",
                    body=message_body
                )

                # 2. Optional SMS Fallback if TWILIO_SMS_FROM is configured
                if TWILIO_SMS_FROM:
                    client.messages.create(
                        from_=TWILIO_SMS_FROM,
                        to=to_number,
                        body=message_body[:1500]
                    )

                print(f"[DISPATCH OK] Sent to {contact_name} ({to_number}) on attempt {attempt}")
                return {"contact": contact_name, "phone": to_number, "status": "delivered", "attempts": attempt}

            # Local / Hackathon Mode (No Twilio keys configured): Log exact payload
            print("\n" + "=" * 68)
            print(f"[TRUSTED-CONTACT-ONLY DISPATCH | Attempt {attempt}/{MAX_DISPATCH_RETRIES}]")
            print(f"Recipient : {contact_name} ({to_number})")
            print(f"Policy    : Personal Emergency Contact ONLY (Zero Police Messaging)")
            print("-" * 68)
            print(message_body)
            print("=" * 68 + "\n")
            return {"contact": contact_name, "phone": to_number, "status": "delivered_simulated", "attempts": attempt}

        except Exception as exc:
            print(f"[DISPATCH RETRY {attempt}/{MAX_DISPATCH_RETRIES}] Failed for {contact_name}: {exc}")
            if attempt < MAX_DISPATCH_RETRIES:
                time.sleep(0.8 * attempt)

    return {"contact": contact_name, "phone": to_number, "status": "failed_after_retries", "attempts": MAX_DISPATCH_RETRIES}


def build_emergency_message(session: dict, reason: str, final_loc: dict = None) -> str:
    """Formats the SOS alert with exact final stop coordinates for personal contacts."""
    loc = final_loc or session.get("last_location", {})
    lat = float(loc.get("lat", 10.9085))
    lng = float(loc.get("lng", 76.9985))
    address = loc.get("address") or session.get("address") or f"{lat:.5f}, {lng:.5f}"
    stopped_time = loc.get("timestamp") or session.get("last_seen_str") or datetime.now().strftime("%H:%M:%S")
    speed = loc.get("speedKmh", session.get("speed_kmh", 0))
    battery = loc.get("battery", session.get("battery", "--"))
    maps_url = f"https://maps.google.com/?q={lat:.6f},{lng:.6f}"

    return (
        f"🚨 RIDEGUARD AI EMERGENCY ALERT ({reason})\n"
        f"Rider: {session.get('user', 'Rider')} ({session.get('user_phone', 'N/A')})\n"
        f"FINAL STOP LOCATION: {address}\n"
        f"Exact GPS Coordinates: {lat:.6f}, {lng:.6f}\n"
        f"Stopped At: {stopped_time} | Speed: {speed} km/h | Last Battery: {battery}%\n"
        f"Driver: {session.get('driver', 'Unknown')} | Vehicle: {session.get('vehicle', 'Unknown')}\n"
        f"Nearest Police (Reference Info Only): {session.get('nearest_police_ref', 'Coimbatore Police Radar')}\n"
        f"Google Maps Pin: {maps_url}"
    )


def dispatch_to_personal_contacts(session: dict, reason: str, custom_message: str = "", final_loc: dict = None) -> list:
    """Dispatches alerts exclusively to saved personal contacts; never calls/texts police."""
    contacts = session.get("contacts") or []
    message_body = custom_message.strip() or build_emergency_message(session, reason, final_loc)
    results = []
    for contact in contacts:
        res = send_via_twilio_with_retry(
            contact.get("name", "Emergency Contact"),
            contact.get("phone", ""),
            message_body
        )
        results.append(res)
    return results


def deadman_watchdog_loop():
    """
    Background monitor: If an active ride stops sending heartbeats (e.g., sudden phone
    shutdown or network loss), dispatches the rider's exact final location exclusively
    to their saved personal emergency contacts.
    """
    while True:
        time.sleep(3)
        now = time.time()
        to_escalate = []

        with rides_lock:
            for user_key, session in list(active_rides.items()):
                if not session.get("sos_dispatched") and (now - session.get("last_seen", now)) >= DEADMAN_TIMEOUT_SECONDS:
                    session["sos_dispatched"] = True
                    to_escalate.append(dict(session))

        for session in to_escalate:
            print(f"[DEAD-MAN'S SWITCH] Heartbeat timeout ({DEADMAN_TIMEOUT_SECONDS}s) for {session.get('user')}. Dispatching final location...")
            dispatch_to_personal_contacts(
                session,
                reason="DEAD-MAN'S SWITCH TIMEOUT — PHONE SHUTDOWN / SIGNAL LOST",
                final_loc=session.get("last_location")
            )


@app.route("/health", methods=["GET"])
def health():
    """Server availability health check."""
    with rides_lock:
        count = len(active_rides)
    return jsonify({"status": "online", "active_sessions": count, "dispatch_policy": "personal_contacts_only"})


@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    """Receives 10-second live telemetry and stores last-known final location in RAM."""
    data = request.get_json(silent=True) or {}
    user = str(data.get("user") or "").strip()
    if not user:
        return jsonify({"error": "Missing user identifier"}), 400

    now_str = datetime.now().strftime("%H:%M:%S")
    lat = float(data.get("lat", 10.9085))
    lng = float(data.get("lng", 76.9985))

    with rides_lock:
        active_rides[user] = {
            "user": user,
            "email": data.get("email", ""),
            "user_phone": data.get("user_phone", ""),
            "contacts": data.get("contacts", []),
            "driver": data.get("driver", "Unknown"),
            "vehicle": data.get("vehicle", "Unknown"),
            "nearest_police_ref": data.get("nearest_police_ref", ""),
            "speed_kmh": data.get("speed_kmh", 0),
            "battery": data.get("battery", 100),
            "last_seen": time.time(),
            "last_seen_str": now_str,
            "sos_dispatched": False,
            "last_location": {
                "lat": lat,
                "lng": lng,
                "accuracy": data.get("accuracy_m", 15),
                "speedKmh": data.get("speed_kmh", 0),
                "battery": data.get("battery", 100),
                "timestamp": now_str
            }
        }

    return jsonify({"status": "heartbeat_recorded", "user": user, "timestamp": now_str})


@app.route("/sos", methods=["POST"])
def sos():
    """
    Handles manual SOS, route deviation, unusual stop, and last-gasp
    `navigator.sendBeacon` sudden phone shutdown packets.
    """
    data = request.get_json(silent=True) or {}
    user = str(data.get("user") or "Rider").strip()
    reason = str(data.get("reason") or data.get("event") or "EMERGENCY SOS").strip()
    final_loc = data.get("final_location") or data.get("final_coordinates")

    with rides_lock:
        session = active_rides.get(user, {})
        if session:
            session["sos_dispatched"] = True
            if final_loc:
                session["last_location"] = final_loc

    merged_session = {
        "user": user,
        "user_phone": data.get("user_phone") or session.get("user_phone", ""),
        "contacts": data.get("contacts") or session.get("contacts", []),
        "driver": session.get("driver", "Unknown"),
        "vehicle": session.get("vehicle", "Unknown"),
        "nearest_police_ref": session.get("nearest_police_ref", ""),
        "last_location": final_loc or session.get("last_location", {})
    }

    delivery_results = dispatch_to_personal_contacts(
        merged_session,
        reason=reason,
        custom_message=str(data.get("message") or ""),
        final_loc=final_loc
    )

    return jsonify({
        "status": "dispatched_to_personal_contacts_only",
        "police_notified": False,
        "deliveries": delivery_results
    })


@app.route("/end-ride", methods=["POST"])
def end_ride():
    """Zero-Trace Privacy Purge: Wipes all active session telemetry from volatile RAM."""
    data = request.get_json(silent=True) or {}
    user = str(data.get("user") or "").strip()
    with rides_lock:
        removed = active_rides.pop(user, None)
    return jsonify({
        "status": "purged_from_ram",
        "user": user,
        "session_existed": removed is not None
    })


if __name__ == "__main__":
    watchdog = threading.Thread(target=deadman_watchdog_loop, daemon=True)
    watchdog.start()
    print(f"🛡️ RideGuard AI Server running on http://127.0.0.1:5000 (Dead-Man's Switch: {DEADMAN_TIMEOUT_SECONDS}s)")
    app.run(host="0.0.0.0", port=5000, debug=False)
