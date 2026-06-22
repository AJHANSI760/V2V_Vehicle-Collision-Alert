import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import struct
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = 8080
DATA_FILE = "app_data.json"
SECRET_FILE = ".v2v_secret"
DEMO_EMAIL = "demo@v2v.com"
DEMO_PASSWORD = "V2V-Demo#2026"
LOGIN_LIMIT = 5
LOGIN_WINDOW_SECONDS = 10 * 60

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
}

PAGE_ROUTES = {
    "/": "index.html",
    "/public": "public.html",
    "/login": "login.html",
    "/dashboard": "dashboard.html",
    "/settings": "settings.html",
}

default_settings = {
    "distanceRange": 50,
    "speedThreshold": 60,
    "sensitivity": "medium",
    "vehicleFilter": "all",
    "soundAlerts": True,
    "popupAlerts": True,
    "smsAlerts": False,
    "darkMode": True,
    "language": "English",
    "autoEmergency": False,
    "emergencyContact": "",
}

state = {
    "users": [],
    "alerts": [],
    "vehicles": [],
    "ws_clients": set(),
    "failed_logins": {},
}
state_lock = threading.RLock()


def load_secret():
    env_secret = os.environ.get("V2V_SECRET")
    if env_secret:
        return env_secret
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    secret = secrets.token_urlsafe(48)
    with open(SECRET_FILE, "w", encoding="utf-8") as handle:
        handle.write(secret)
    return secret


SECRET = load_secret()


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def save_state():
    with state_lock:
        payload = {
            "users": state["users"],
            "alerts": state["alerts"][-50:],
        }
    with open(DATA_FILE, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"{salt}${digest.hex()}"


def verify_password(password, stored):
    salt, digest = stored.split("$", 1)
    return hmac.compare_digest(hash_password(password, salt), stored)


def password_errors(password):
    checks = [
        (len(password) >= 12, "at least 12 characters"),
        (any(char.islower() for char in password), "one lowercase letter"),
        (any(char.isupper() for char in password), "one uppercase letter"),
        (any(char.isdigit() for char in password), "one number"),
        (any(not char.isalnum() for char in password), "one symbol"),
    ]
    return [message for passed, message in checks if not passed]


def is_login_limited(key):
    now = time.time()
    attempts = state["failed_logins"].get(key, [])
    attempts = [stamp for stamp in attempts if now - stamp < LOGIN_WINDOW_SECONDS]
    state["failed_logins"][key] = attempts
    return len(attempts) >= LOGIN_LIMIT


def record_login_failure(key):
    state["failed_logins"].setdefault(key, []).append(time.time())


def clear_login_failures(key):
    state["failed_logins"].pop(key, None)


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def encode_token(payload):
    header = {"alg": "HS256", "typ": "JWT"}
    parts = [
        b64url(json.dumps(header, separators=(",", ":")).encode()),
        b64url(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signing_input = ".".join(parts).encode()
    signature = hmac.new(SECRET.encode(), signing_input, hashlib.sha256).digest()
    return ".".join(parts + [b64url(signature)])


def decode_token(token):
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode()
        expected = b64url(hmac.new(SECRET.encode(), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig_b64):
            return None
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "==="))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def public_user(user):
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "role": user.get("role", "driver"),
        "vehicle": user["vehicle"],
        "settings": user.get("settings", default_settings.copy()),
    }


def find_user_by_email(email):
    with state_lock:
        return next((u for u in state["users"] if u["email"].lower() == email.lower()), None)


def issue_auth(user):
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user.get("role", "driver"),
        "exp": int(time.time() + 60 * 60 * 8),
    }
    return encode_token(payload)


def authenticate(handler):
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    payload = decode_token(header.split(" ", 1)[1])
    if not payload:
        return None
    with state_lock:
        return next((u for u in state["users"] if u["id"] == payload["sub"]), None)


def distance_m(a, b):
    dx = (a["x"] - b["x"]) * 780
    dy = (a["y"] - b["y"]) * 620
    return (dx ** 2 + dy ** 2) ** 0.5


def build_vehicle_payload():
    with state_lock:
        vehicles = [dict(v) for v in state["vehicles"]]
        alerts = list(state["alerts"][-6:])
    closest = None
    danger = []
    for i, first in enumerate(vehicles):
        for second in vehicles[i + 1:]:
            gap = distance_m(first, second)
            if closest is None or gap < closest["distance"]:
                closest = {"ids": [first["id"], second["id"]], "distance": round(gap, 1)}
            if gap < 75:
                danger.append({
                    "ids": [first["id"], second["id"]],
                    "distance": round(gap, 1),
                    "message": f"Collision Risk: {first['label']} and {second['label']}",
                })
    return {
        "type": "snapshot",
        "timestamp": now_iso(),
        "vehicles": vehicles,
        "closestPair": closest,
        "dangerPairs": danger,
        "alerts": alerts,
    }


def send_ws_frame(sock, payload):
    data = payload.encode("utf-8")
    length = len(data)
    if length < 126:
        header = struct.pack("!BB", 0x81, length)
    elif length < 65536:
        header = struct.pack("!BBH", 0x81, 126, length)
    else:
        header = struct.pack("!BBQ", 0x81, 127, length)
    sock.sendall(header + data)


def recv_ws_frame(sock):
    header = sock.recv(2)
    if not header:
        return None
    first, second = header
    opcode = first & 0x0F
    masked = second & 0x80
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    mask = sock.recv(4) if masked else b""
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            return None
        payload += chunk
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


def remove_client(sock):
    with state_lock:
        state["ws_clients"].discard(sock)
    try:
        sock.close()
    except OSError:
        pass


def websocket_loop(sock):
    with state_lock:
        state["ws_clients"].add(sock)
    try:
        send_ws_frame(sock, json.dumps(build_vehicle_payload()))
        while True:
            frame = recv_ws_frame(sock)
            if not frame:
                break
            opcode, payload = frame
            if opcode == 0x8:
                break
            if opcode == 0x9:
                sock.sendall(b"\x8A\x00")
            if opcode == 0x1 and payload == b"ping":
                send_ws_frame(sock, "pong")
    except OSError:
        pass
    finally:
        remove_client(sock)


def seed_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        state["users"] = payload.get("users", [])
        state["alerts"] = payload.get("alerts", [])
    if not state["users"]:
        state["users"].append({
            "id": "user-demo",
            "name": "Demo Driver",
            "email": DEMO_EMAIL,
            "phone": "9999999999",
            "password_hash": hash_password(DEMO_PASSWORD),
            "role": "driver",
            "vehicle": {"type": "SUV", "model": "Sentinel X", "number": "V2V-100"},
            "settings": default_settings.copy(),
        })
    else:
        demo_user = next((u for u in state["users"] if u["email"].lower() == DEMO_EMAIL), None)
        if demo_user:
            demo_user["password_hash"] = hash_password(DEMO_PASSWORD)
    if not state["alerts"]:
        state["alerts"] = [
            {"id": "alert-1", "severity": "high", "message": "Blind spot risk detected on right lane", "time": now_iso()},
            {"id": "alert-2", "severity": "medium", "message": "Highway merge caution within 64m", "time": now_iso()},
        ]
    state["vehicles"] = [
        {"id": "alpha", "label": "Alpha", "color": "#00aaff", "x": 0.12, "y": 0.41, "vx": 0.11, "vy": 0.0, "speed": 68, "heading": "Eastbound"},
        {"id": "bravo", "label": "Bravo", "color": "#ff3b3b", "x": 0.52, "y": 1.08, "vx": 0.0, "vy": -0.15, "speed": 74, "heading": "Northbound"},
        {"id": "charlie", "label": "Charlie", "color": "#9be6ff", "x": 1.06, "y": 0.59, "vx": -0.12, "vy": 0.0, "speed": 62, "heading": "Westbound"},
        {"id": "delta", "label": "Delta", "color": "#6ea8ff", "x": 0.68, "y": -0.14, "vx": 0.0, "vy": 0.09, "speed": 49, "heading": "Southbound"},
    ]
    save_state()


def broadcast_loop():
    while True:
        time.sleep(1)
        with state_lock:
            for vehicle in state["vehicles"]:
                vehicle["x"] += vehicle["vx"] * 0.18
                vehicle["y"] += vehicle["vy"] * 0.18
                if vehicle["vx"] > 0 and vehicle["x"] > 1.12:
                    vehicle["x"] = -0.12
                if vehicle["vx"] < 0 and vehicle["x"] < -0.12:
                    vehicle["x"] = 1.12
                if vehicle["vy"] > 0 and vehicle["y"] > 1.12:
                    vehicle["y"] = -0.12
                if vehicle["vy"] < 0 and vehicle["y"] < -0.12:
                    vehicle["y"] = 1.12
            snapshot = build_vehicle_payload()
            active_sockets = list(state["ws_clients"])
            if snapshot["dangerPairs"]:
                newest = snapshot["dangerPairs"][0]
                message = newest["message"] + f" at {newest['distance']}m"
                if not state["alerts"] or state["alerts"][-1]["message"] != message:
                    state["alerts"].append({
                        "id": f"alert-{int(time.time())}",
                        "severity": "high",
                        "message": message,
                        "time": now_iso(),
                    })
        for sock in active_sockets:
            try:
                send_ws_frame(sock, json.dumps(snapshot))
            except OSError:
                remove_client(sock)
        save_state()


class Handler(BaseHTTPRequestHandler):
    def send_file_headers(self, path):
        target = PAGE_ROUTES.get(path, path.lstrip("/"))
        if not os.path.exists(target) or not os.path.isfile(target):
            self.send_error(404, "Not found")
            return False
        ext = os.path.splitext(target)[1]
        size = os.path.getsize(target)
        self.send_response(200)
        self.send_header("Content-Type", MIME_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(size))
        self.end_headers()
        return target

    def json_response(self, code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def serve_file(self, path):
        target = self.send_file_headers(path)
        if not target:
            return
        with open(target, "rb") as handle:
            content = handle.read()
        self.wfile.write(content)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/me":
            user = authenticate(self)
            return self.json_response(200 if user else 401, {"user": public_user(user)} if user else {"error": "Unauthorized"})
        if parsed.path == "/api/settings":
            user = authenticate(self)
            return self.json_response(200 if user else 401, {"settings": user.get("settings", default_settings.copy())} if user else {"error": "Unauthorized"})
        if parsed.path == "/api/alerts":
            user = authenticate(self)
            if not user:
                return self.json_response(401, {"error": "Unauthorized"})
            with state_lock:
                return self.json_response(200, {"alerts": list(reversed(state["alerts"][-12:]))})
        if parsed.path == "/api/vehicles":
            return self.json_response(200, build_vehicle_payload())
        if parsed.path == "/ws/vehicles" and self.headers.get("Upgrade", "").lower() == "websocket":
            params = parse_qs(parsed.query)
            token = params.get("token", [""])[0]
            payload = decode_token(token)
            if not payload:
                self.send_error(401, "Unauthorized")
                return
            key = self.headers.get("Sec-WebSocket-Key", "")
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()
            websocket_loop(self.request)
            return
        self.serve_file(parsed.path)

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(405)
            self.end_headers()
            return
        self.send_file_headers(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self.read_json()
        if parsed.path == "/api/register":
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            name = body.get("name", "").strip()
            vehicle = body.get("vehicle", {})
            if not all([email, password, name, vehicle.get("type"), vehicle.get("model"), vehicle.get("number")]):
                return self.json_response(400, {"error": "Missing required fields"})
            errors = password_errors(password)
            if errors:
                return self.json_response(400, {"error": "Password needs " + ", ".join(errors)})
            if find_user_by_email(email):
                return self.json_response(409, {"error": "User already exists"})
            user = {
                "id": f"user-{int(time.time())}",
                "name": name,
                "email": email,
                "phone": body.get("phone", ""),
                "password_hash": hash_password(password),
                "role": body.get("role", "driver"),
                "vehicle": vehicle,
                "settings": default_settings.copy(),
            }
            with state_lock:
                state["users"].append(user)
            save_state()
            return self.json_response(201, {"token": issue_auth(user), "user": public_user(user)})
        if parsed.path == "/api/login":
            email = body.get("email", "").strip().lower()
            key = f"{self.client_address[0]}:{email}"
            if is_login_limited(key):
                return self.json_response(429, {"error": "Too many attempts. Try again in a few minutes."})
            user = find_user_by_email(email)
            if not user or not verify_password(body.get("password", ""), user["password_hash"]):
                record_login_failure(key)
                return self.json_response(401, {"error": "Invalid email or password"})
            clear_login_failures(key)
            return self.json_response(200, {"token": issue_auth(user), "user": public_user(user)})
        if parsed.path == "/api/settings":
            user = authenticate(self)
            if not user:
                return self.json_response(401, {"error": "Unauthorized"})
            with state_lock:
                user["settings"] = {
                    **default_settings,
                    **body,
                }
            save_state()
            return self.json_response(200, {"settings": user["settings"], "saved": True})
        return self.json_response(404, {"error": "Not found"})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    seed_data()
    threading.Thread(target=broadcast_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"V2V Sentinel running at http://{HOST}:{PORT}")
    server.serve_forever()
