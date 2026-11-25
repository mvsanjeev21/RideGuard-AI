"""
server.py — Member 3: Python Flask Dead-Man's Switch, Sudden Phone Shutdown
Final-Location Vault & Trusted-Contacts-Only Twilio WhatsApp/SMS Dispatcher.

Privacy & Dispatch Rules:
- All active ride telemetry is stored strictly in volatile RAM and purged on /end-ride.
- Emergency alerts are dispatched EXCLUSIVELY to the rider's personal trusted contacts.
- Coimbatore District police station details are included strictly as read-only reference info;
  no automated calls or messages are ever sent to police numbers.
"""

import json
import os
import threading
import time
from datetime import datetime
from flask import Flask, jsonify, request

try:
    from flask_cors import CORS
except ImportError:
    CORS = None

try:
    from twilio.rest import Client as TwilioClient
except ImportError:
    TwilioClient = None


app = Flask(__name__)
if CORS is not None:
    CORS(app)


@app.after_request
def attach_cors_headers(response):
    """Ensures CORS headers are present even when flask-cors is not installed."""
    response.headers.setdefault("Access-Control-Allow-Origin", "*")
    response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, X-RideGuard-Token")
    response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    return response


DEADMAN_TIMEOUT_SECONDS = int(os.getenv("DEADMAN_TIMEOUT_SECONDS", "45"))
WATCHDOG_POLL_SECONDS = 5
MAX_DISPATCH_RETRIES = 3

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886").strip()
TWILIO_SMS_FROM = os.getenv("TWILIO_SMS_FROM", "").strip()

active_sessions = {}
sessions_lock = threading.Lock()


def safe_float(value, default: float = 0.0) -> float:
    """Safely converts incoming telemetry coordinates to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_request_json() -> dict:
    """Parses JSON from standard fetch() calls as well as navigator.sendBeacon() blobs."""
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data
    raw_body = request.get_data(as_text=True) or ""
    if raw_body.strip():
        try:
            parsed = json.loads(raw_body)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def normalize_phone_e164(phone: str) -> str:
    """Normalizes Indian or international phone numbers into E.164 format."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        return f"+91{digits}"
    return f"+{digits}"


def build_emergency_message(session: dict, reason: str, final_loc: dict = None) -> str:
    """Formats the SOS alert with exact final stop coordinates for personal contacts."""
    loc = final_loc or session.get("last_location", {})
    lat = safe_float(loc.get("lat"), 0.0)
    lng = safe_float(loc.get("lng"), 0.0)
    accuracy = loc.get("accuracy") or loc.get("accuracy_m") or 15
    address = loc.get("address") or f"{lat:.5f}, {lng:.5f}"
    timestamp = loc.get("timestamp") or datetime.now().strftime("%H:%M:%S")
    speed = loc.get("speedKmh", loc.get("speed_kmh", 0))
    battery = loc.get("battery", session.get("battery", "--"))
    driver = loc.get("driver") or session.get("driver", "Not Scanned")
    vehicle = loc.get("vehicle") or session.get("vehicle", "Unknown")
    police_ref = (
        loc.get("nearest_police_ref")
        or (f"{loc.get('policeName')} ({loc.get('policePhone')})" if loc.get("policeName") else None)
        or session.get("nearest_police_ref", "Coimbatore District Police Reference")
    )
    maps_url = f"https://maps.google.com/?q={lat:.6f},{lng:.6f}"

    return (
        f"🚨 RIDEGUARD AI EMERGENCY ALERT ({reason})\n"
        f"Rider: {session.get('user', 'Rider')} ({session.get('user_phone', 'N/A')})\n"
        f"📍 Final Recorded Location: {address}\n"
        f"Exact GPS Pin: {lat:.6f}, {lng:.6f} (±{accuracy}m)\n"
        f"Last Seen: {timestamp} | Speed: {speed} km/h | Battery: {battery}%\n"
        f"Driver: {driver} | Vehicle: {vehicle}\n"
        f"Coimbatore Dist. Police (Info Only): {police_ref}\n"
        f"Google Maps Pin: {maps_url}"
    )


def dispatch_to_trusted_contacts(contacts: list, message: str, incident_id: str) -> list:
    """
    Sends WhatsApp/SMS notifications exclusively to the rider's personal trusted contacts
    with automatic retry on transient failures. Never messages police numbers.
    """
    results = []
    twilio_ready = bool(TwilioClient and TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)
    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) if twilio_ready else None

    for contact in contacts or []:
        name = contact.get("name", "Trusted Contact")
        raw_phone = contact.get("phone", "")
        e164_phone = normalize_phone_e164(raw_phone)
        if not e164_phone:
            results.append({"name": name, "phone": raw_phone, "status": "skipped_invalid_phone", "attempts": 0})
            continue

        delivered = False
        attempts = 0
        last_error = ""

        for attempt in range(1, MAX_DISPATCH_RETRIES + 1):
            attempts = attempt
            try:
                if client is not None:
                    if TWILIO_WHATSAPP_FROM:
                        client.messages.create(
                            from_=TWILIO_WHATSAPP_FROM,
                            to=f"whatsapp:{e164_phone}",
                            body=message,
                        )
                    if TWILIO_SMS_FROM:
                        client.messages.create(
                            from_=TWILIO_SMS_FROM,
                            to=e164_phone,
                            body=message,
                        )
                else:
                    print(f"[{incident_id}] 📤 Simulated Trusted-Contact Dispatch -> {name} ({e164_phone})")
                delivered = True
                break
            except Exception as exc:
                last_error = str(exc)
                time.sleep(0.5 * attempt)

        results.append({
            "name": name,
            "phone": e164_phone,
            "status": "delivered" if delivered else "failed",
            "attempts": attempts,
            "error": "" if delivered else last_error,
        })

    return results


def deadman_watchdog_loop():
    """
    Background daemon monitoring active rides. If a phone stops sending heartbeats
    for DEADMAN_TIMEOUT_SECONDS, automatically dispatches the last-known final location
    exclusively to personal trusted contacts.
    """
    while True:
        time.sleep(WATCHDOG_POLL_SECONDS)
        now = time.time()
        expired_sessions = []

        with sessions_lock:
            for user_key, session in active_sessions.items():
                if not session.get("sos_sent") and (now - session.get("last_seen", now)) >= DEADMAN_TIMEOUT_SECONDS:
                    session["sos_sent"] = True
                    expired_sessions.append((user_key, dict(session)))

        for user_key, session in expired_sessions:
            incident_id = f"RG-DM-{int(now) % 1000000}"
            reason = f"DEAD-MAN'S SWITCH: PHONE SIGNAL LOST ({DEADMAN_TIMEOUT_SECONDS}s)"
            message = build_emergency_message(session, reason)
            print(f"🚨 [{incident_id}] Dead-Man's Switch triggered for {user_key}! Dispatching final location...")
            dispatch_to_trusted_contacts(session.get("contacts", []), message, incident_id)


@app.route("/health", methods=["GET"])
def health_check():
    """Lightweight server availability endpoint for client health checks."""
    with sessions_lock:
        count = len(active_sessions)
    return jsonify({
        "status": "online",
        "active_rides": count,
        "deadman_timeout_sec": DEADMAN_TIMEOUT_SECONDS,
        "police_scope": "COIMBATORE_DISTRICT_V1",
        "police_dispatch_enabled": False,
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/heartbeat", methods=["POST", "OPTIONS"])
def heartbeat():
    """Receives periodic live GPS telemetry and refreshes the Dead-Man's Switch timer."""
    if request.method == "OPTIONS":
        return ("", 204)

    data = parse_request_json()
    user = str(data.get("user") or "").strip()
    if not user:
        return jsonify({"error": "Missing rider name"}), 400

    now_str = datetime.now().strftime("%H:%M:%S")
    lat = safe_float(data.get("lat"), 0.0)
    lng = safe_float(data.get("lng"), 0.0)

    with sessions_lock:
        active_sessions[user] = {
            "user": user,
            "email": data.get("email", ""),
            "user_phone": data.get("user_phone", ""),
            "contacts": data.get("contacts", []),
            "driver": data.get("driver", "Not Scanned"),
            "vehicle": data.get("vehicle", "Unknown"),
            "battery": data.get("battery", 100),
            "nearest_police_ref": data.get("nearest_police_ref", "Coimbatore District Police Reference"),
            "dispatch_police": False,
            "last_seen": time.time(),
            "sos_sent": False,
            "last_location": {
                "lat": lat,
                "lng": lng,
                "accuracy": data.get("accuracy_m", 15),
                "speed_kmh": data.get("speed_kmh", 0),
                "battery": data.get("battery", 100),
                "timestamp": now_str,
            },
        }

    return jsonify({
        "status": "heartbeat_recorded",
        "user": user,
        "synced_at": now_str,
        "dispatch_police": False,
    })


@app.route("/sos", methods=["POST", "OPTIONS"])
def trigger_sos():
    """
    Handles instant manual SOS, route deviation, vehicle mismatch, and
    navigator.sendBeacon() sudden phone shutdown packets.
    """
    if request.method == "OPTIONS":
        return ("", 204)

    data = parse_request_json()
    user = str(data.get("user") or "Rider").strip()
    incident_id = data.get("incident_id") or f"RG-{int(time.time()) % 1000000}"
    reason = data.get("reason") or data.get("event") or "EMERGENCY SOS TRIGGERED"

    with sessions_lock:
        stored_session = active_sessions.get(user, {})
        if user in active_sessions:
            active_sessions[user]["sos_sent"] = True

    contacts = data.get("contacts") or stored_session.get("contacts", [])
    final_loc = data.get("final_location") or data.get("final_coordinates") or stored_session.get("last_location")

    session_snapshot = {
        "user": user,
        "user_phone": data.get("user_phone") or stored_session.get("user_phone", "N/A"),
        "driver": stored_session.get("driver", "Not Scanned"),
        "vehicle": stored_session.get("vehicle", "Unknown"),
        "battery": stored_session.get("battery", "--"),
        "nearest_police_ref": stored_session.get("nearest_police_ref", "Coimbatore District Police Reference"),
        "last_location": final_loc or {},
    }

    message = data.get("message") or build_emergency_message(session_snapshot, reason, final_loc)
    delivery_results = dispatch_to_trusted_contacts(contacts, message, incident_id)

    return jsonify({
        "status": "dispatched",
        "incident_id": incident_id,
        "dispatch_police": False,
        "recipients": delivery_results,
    })


@app.route("/end-ride", methods=["POST", "OPTIONS"])
def end_ride():
    """Immediately purges the rider's temporary session data from volatile RAM."""
    if request.method == "OPTIONS":
        return ("", 204)

    data = parse_request_json()
    user = str(data.get("user") or "").strip()
    purged = False

    if user:
        with sessions_lock:
            if user in active_sessions:
                del active_sessions[user]
                purged = True

    return jsonify({
        "status": "purged" if purged else "no_active_session",
        "user": user,
        "retained_records": 0,
    })


if __name__ == "__main__":
    watchdog = threading.Thread(target=deadman_watchdog_loop, daemon=True)
    watchdog.start()
    port = int(os.getenv("PORT", "5000"))
    print(f"🛡️ RideGuard AI Server running on http://127.0.0.1:{port} (Dead-Man's Switch: {DEADMAN_TIMEOUT_SECONDS}s)")
    app.run(host="0.0.0.0", port=port, debug=False)
