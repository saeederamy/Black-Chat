import os
import sqlite3
import json
import uuid
import shutil
import datetime
import subprocess
import tempfile
import asyncio
import urllib.request
import aiofiles
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TPL_DIR = os.path.join(BASE_DIR, "templates")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
USERS_FILE = os.path.join(BASE_DIR, "users.txt")
DB_FILE = os.path.join(BASE_DIR, "chat.db")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
TOKENS_FILE = os.path.join(BASE_DIR, ".tokens.json")

# Default per-user quota in MB if not set in users.txt
DEFAULT_QUOTA_MB = 500
# Max single upload size in MB
MAX_FILE_SIZE_MB = 100

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TPL_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)

# ===================== DATABASE =====================
def init_db():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages (msg_id TEXT PRIMARY KEY, room TEXT, user TEXT, msg_type TEXT, content TEXT, file_name TEXT, file_size INTEGER DEFAULT 0, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_room ON messages(room)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_user ON messages(user)')

    # backward-compatible alters
    for stmt in [
        "ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT '{}'",
        "ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'",
        "ALTER TABLE messages ADD COLUMN file_size INTEGER DEFAULT 0",
    ]:
        try: c.execute(stmt)
        except: pass

    # Phase 4: read receipts and last seen
    c.execute('''CREATE TABLE IF NOT EXISTS message_reads (
        msg_id TEXT,
        reader TEXT,
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (msg_id, reader)
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_reads_msg ON message_reads(msg_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_reads_reader ON message_reads(reader)')

    c.execute('''CREATE TABLE IF NOT EXISTS user_presence (
        user TEXT PRIMARY KEY,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, contact TEXT, UNIQUE(owner, contact))''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_ips (user TEXT, ip TEXT, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user, ip))''')
    c.execute('''CREATE TABLE IF NOT EXISTS profiles (user TEXT PRIMARY KEY, avatar TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS custom_rooms (room_id TEXT PRIMARY KEY, type TEXT, name TEXT, owner TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS room_members (room_id TEXT, user TEXT, UNIQUE(room_id, user))''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, file_path TEXT, file_size INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_uploads_user ON user_uploads(user)')

    # Phase 4 extras: pinned messages
    c.execute('''CREATE TABLE IF NOT EXISTS pinned_messages (
        room TEXT,
        msg_id TEXT,
        pinned_by TEXT,
        pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room, msg_id)
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_pinned_room ON pinned_messages(room)')

    conn.commit()
    conn.close()

init_db()

# ===================== TOKEN STORE =====================
def _load_tokens():
    try:
        with open(TOKENS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_tokens(d):
    try:
        with open(TOKENS_FILE, "w") as f:
            json.dump(d, f)
        os.chmod(TOKENS_FILE, 0o600)
    except Exception:
        pass

def issue_token(user, role):
    tokens = _load_tokens()
    tok = uuid.uuid4().hex
    tokens[tok] = {"user": user, "role": role, "issued": datetime.datetime.utcnow().isoformat()}
    _save_tokens(tokens)
    return tok

def revoke_token(tok):
    tokens = _load_tokens()
    if tok in tokens:
        del tokens[tok]
        _save_tokens(tokens)

def verify_token(tok):
    tokens = _load_tokens()
    return tokens.get(tok)

async def require_admin(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    tok = authorization.replace("Bearer ", "").strip()
    info = verify_token(tok)
    if not info or info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return info

async def require_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    tok = authorization.replace("Bearer ", "").strip()
    info = verify_token(tok)
    if not info:
        raise HTTPException(status_code=401, detail="Invalid token")
    return info

# ===================== USERS.TXT MANAGEMENT =====================
# Format (backward compatible):
#   username:password:role
#   username:password:role:quota_mb
def read_users():
    """Returns list of dicts: {username, password, role, quota_mb}"""
    users = []
    if not os.path.exists(USERS_FILE):
        return users
    with open(USERS_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(':')
            if len(parts) < 3:
                continue
            quota = DEFAULT_QUOTA_MB
            if len(parts) >= 4:
                try: quota = int(parts[3])
                except: quota = DEFAULT_QUOTA_MB
            users.append({
                "username": parts[0],
                "password": parts[1],
                "role": parts[2],
                "quota_mb": quota,
            })
    return users

def write_users(users):
    """Atomic write of users list back to users.txt."""
    tmp = USERS_FILE + ".tmp"
    with open(tmp, "w") as f:
        for u in users:
            f.write(f"{u['username']}:{u['password']}:{u['role']}:{u['quota_mb']}\n")
    os.replace(tmp, USERS_FILE)

def find_user(username):
    for u in read_users():
        if u["username"] == username:
            return u
    return None

def check_login(username, password):
    u = find_user(username)
    if u and u["password"] == password:
        return u["role"]
    return None

def get_all_usernames():
    return [u["username"] for u in read_users()]

# ===================== QUOTA HELPERS =====================
def get_user_used_bytes(username):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT COALESCE(SUM(file_size), 0) FROM user_uploads WHERE user=?", (username,))
    row = c.fetchone()
    conn.close()
    return int(row[0]) if row else 0

def record_user_upload(username, file_path, file_size):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT INTO user_uploads (user, file_path, file_size) VALUES (?, ?, ?)", (username, file_path, file_size))
    conn.commit()
    conn.close()

def remove_user_upload_record(file_path):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("DELETE FROM user_uploads WHERE file_path=?", (file_path,))
    conn.commit()
    conn.close()

# ===================== IP DETECTION =====================
def get_real_ip(request: Request):
    headers_to_check = ["CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"]
    for header in headers_to_check:
        val = request.headers.get(header)
        if val:
            return val.split(",")[0].strip()
    ip = request.client.host if request.client else "Unknown"
    if ip in ("127.0.0.1", "::1"):
        return "Local Network"
    return ip

# ===================== WEBSOCKET MANAGER =====================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_map = {}  # ws -> username

    async def connect(self, websocket: WebSocket, username: str):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.user_map[websocket] = username

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.user_map:
            del self.user_map[websocket]

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

    def online_users(self):
        return list(set(self.user_map.values()))

manager = ConnectionManager()

# ===================== STATIC =====================
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(TPL_DIR, 'index.html'))

# ===================== AUTH =====================
@app.post("/api/login")
async def login_api(request: Request):
    data = await request.json()
    user, pwd = data.get("username"), data.get("password")
    role = check_login(user, pwd)
    if role:
        ip = get_real_ip(request)
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO active_ips (user, ip, last_seen) VALUES (?, ?, CURRENT_TIMESTAMP)", (user, ip))
        conn.commit()
        conn.close()
        token = issue_token(user, role)
        u = find_user(user)
        return {
            "success": True,
            "role": role,
            "username": user,
            "token": token,
            "quota_mb": u["quota_mb"] if u else DEFAULT_QUOTA_MB,
            "used_bytes": get_user_used_bytes(user),
        }
    return {"success": False, "message": "Invalid Credentials"}

@app.post("/api/logout")
async def logout_api(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        revoke_token(authorization.replace("Bearer ", "").strip())
    return {"success": True}

# ===================== UPLOADS =====================
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    info = await require_user(authorization)
    username = info["user"]

    u = find_user(username)
    if not u:
        raise HTTPException(status_code=403, detail="User not found")

    # read in chunks to enforce size limits
    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    quota_bytes = u["quota_mb"] * 1024 * 1024
    used = get_user_used_bytes(username)
    remaining = quota_bytes - used
    if remaining <= 0:
        raise HTTPException(status_code=413, detail="Quota exceeded")

    # safe filename
    orig_name = os.path.basename(file.filename or "file")
    safe_name = f"{uuid.uuid4().hex[:8]}_{orig_name}"
    file_location = os.path.join(UPLOAD_DIR, safe_name)

    total = 0
    try:
        async with aiofiles.open(file_location, 'wb') as out_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    await out_file.close()
                    os.remove(file_location)
                    raise HTTPException(status_code=413, detail=f"File exceeds max size of {MAX_FILE_SIZE_MB}MB")
                if total > remaining:
                    await out_file.close()
                    os.remove(file_location)
                    raise HTTPException(status_code=413, detail="Quota exceeded")
                await out_file.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(file_location):
            try: os.remove(file_location)
            except: pass
        raise HTTPException(status_code=500, detail=str(e))

    record_user_upload(username, f"/static/uploads/{safe_name}", total)

    c_type = file.content_type or ''
    msg_type = 'file'
    if c_type.startswith('image/'): msg_type = 'image'
    elif c_type.startswith('video/'): msg_type = 'video'
    elif c_type.startswith('audio/'): msg_type = 'audio'

    return {
        "url": f"/static/uploads/{safe_name}",
        "type": msg_type,
        "name": orig_name,
        "size": total,
        "used_bytes": get_user_used_bytes(username),
        "quota_mb": u["quota_mb"],
    }

@app.post("/api/upload_avatar")
async def upload_avatar(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    info = await require_user(authorization)
    username = info["user"]
    ext = (file.filename or "png").split('.')[-1].lower()[:5]
    avatar_name = f"avatar_{username}_{uuid.uuid4().hex[:6]}.{ext}"
    file_location = os.path.join(UPLOAD_DIR, avatar_name)
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Avatar too large (max 5MB)")
    async with aiofiles.open(file_location, 'wb') as out_file:
        await out_file.write(data)
    url = f"/static/uploads/{avatar_name}"
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO profiles (user, avatar) VALUES (?, ?)", (username, url))
    conn.commit()
    conn.close()
    return {"success": True, "url": url}

@app.get("/api/quota")
async def get_quota(info: dict = Depends(require_user)):
    u = find_user(info["user"])
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    used = get_user_used_bytes(info["user"])
    return {
        "username": info["user"],
        "quota_mb": u["quota_mb"],
        "used_bytes": used,
        "used_mb": round(used / (1024*1024), 2),
        "remaining_mb": round(max(0, u["quota_mb"] * 1024 * 1024 - used) / (1024*1024), 2),
    }

# ===================== TURN / WEBRTC CONFIG =====================
def _read_env_file():
    """Read /opt/black-chat/.env style key=value pairs."""
    env_path = os.path.join(BASE_DIR, ".env")
    out = {}
    if not os.path.exists(env_path):
        return out
    try:
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return out

def build_ice_servers():
    """
    Build iceServers list for clients:
    - Always include Google STUN (free, public)
    - If TURN credentials are configured, include them too
    """
    servers = [
        {"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]},
    ]
    env = _read_env_file()
    turn_host = env.get("TURN_HOST")
    turn_port = env.get("TURN_PORT", "3478")
    turn_user = env.get("TURN_USER")
    turn_pass = env.get("TURN_PASS")
    turn_tls_port = env.get("TURN_TLS_PORT", "5349")

    if turn_host and turn_user and turn_pass:
        # Both UDP and TCP TURN, plus TLS variant for restrictive networks
        urls = [
            f"turn:{turn_host}:{turn_port}?transport=udp",
            f"turn:{turn_host}:{turn_port}?transport=tcp",
            f"turns:{turn_host}:{turn_tls_port}?transport=tcp",
        ]
        servers.append({
            "urls": urls,
            "username": turn_user,
            "credential": turn_pass,
        })
        # ALSO expose as STUN
        servers[0]["urls"].insert(0, f"stun:{turn_host}:{turn_port}")
    return servers

@app.get("/api/turn-config")
async def get_turn_config(info: dict = Depends(require_user)):
    """Return iceServers for WebRTC. Only authenticated users get TURN credentials."""
    return {
        "iceServers": build_ice_servers(),
        "hasTurn": bool(_read_env_file().get("TURN_HOST")),
    }

@app.get("/api/admin/turn")
async def admin_turn_status(info: dict = Depends(require_admin)):
    """Admin-only: full TURN status / credentials."""
    env = _read_env_file()
    # Check if coturn service is running
    is_running = False
    try:
        r = subprocess.run(["systemctl", "is-active", "coturn"], capture_output=True, text=True, timeout=3)
        is_running = (r.returncode == 0 and "active" in r.stdout)
    except Exception:
        pass
    return {
        "configured": bool(env.get("TURN_HOST")),
        "running": is_running,
        "host": env.get("TURN_HOST", ""),
        "port": env.get("TURN_PORT", ""),
        "tls_port": env.get("TURN_TLS_PORT", ""),
        "user": env.get("TURN_USER", ""),
        "password": env.get("TURN_PASS", ""),
        "realm": env.get("TURN_REALM", ""),
        "ice_servers": build_ice_servers(),
    }

@app.post("/api/admin/turn/restart")
async def admin_turn_restart(info: dict = Depends(require_admin)):
    """Restart coturn service."""
    try:
        subprocess.Popen(
            ["systemctl", "restart", "coturn"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True}

# ===================== USER ACTIONS =====================
@app.post("/api/action")
async def api_action(request: Request, info: dict = Depends(require_user)):
    data = await request.json()
    act = data.get("action")
    username = info["user"]
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    res = {"success": True}

    if act == "get_init_data":
        c.execute("SELECT contact FROM contacts WHERE owner=?", (username,))
        res["contacts"] = [r[0] for r in c.fetchall()]
        c.execute("SELECT r.room_id, r.name FROM custom_rooms r JOIN room_members m ON r.room_id = m.room_id WHERE m.user = ?", (username,))
        res["custom_rooms"] = [{"id": r[0], "type": "group", "name": r[1]} for r in c.fetchall()]
        c.execute("SELECT avatar FROM profiles WHERE user=?", (username,))
        av = c.fetchone()
        res["avatar"] = av[0] if av else ""
        c.execute("SELECT user, avatar FROM profiles")
        res["all_avatars"] = {r[0]: r[1] for r in c.fetchall()}
        u = find_user(username)
        res["quota_mb"] = u["quota_mb"] if u else DEFAULT_QUOTA_MB
        res["used_bytes"] = get_user_used_bytes(username)
        res["all_users"] = get_all_usernames()

    elif act == "get_ips":
        c.execute("SELECT ip, last_seen FROM active_ips WHERE user=?", (username,))
        res["ips"] = [{"ip": r[0], "date": r[1]} for r in c.fetchall()]

    elif act == "create_room":
        room_id = "rm_" + uuid.uuid4().hex[:8]
        room_name = data.get("name")
        members = data.get("members", [])
        c.execute("INSERT INTO custom_rooms (room_id, name, owner) VALUES (?, ?, ?)", (room_id, room_name, username))
        c.execute("INSERT INTO room_members (room_id, user) VALUES (?, ?)", (room_id, username))
        for m in members:
            if m in get_all_usernames():
                c.execute("INSERT OR IGNORE INTO room_members (room_id, user) VALUES (?, ?)", (room_id, m))
        res["room_id"] = room_id

    elif act == "add_contact":
        target = data.get("target")
        if target not in get_all_usernames():
            res = {"success": False, "msg": "User not found"}
        else:
            c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (username, target))
            c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target, username))
            res["target"] = target

    elif act == "get_room_members":
        room_id = data.get("room_id")
        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room_id,))
        owner_row = c.fetchone()
        c.execute("SELECT user FROM room_members WHERE room_id=?", (room_id,))
        members = [r[0] for r in c.fetchall()]
        # only members can view
        if username not in members:
            res = {"success": False, "msg": "Not a member"}
        else:
            res["members"] = members
            res["owner"] = owner_row[0] if owner_row else None
            res["all_users"] = get_all_usernames()

    elif act == "add_room_member":
        room_id = data.get("room_id")
        target = data.get("target")
        # Only owner can add
        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room_id,))
        owner_row = c.fetchone()
        if not owner_row or owner_row[0] != username:
            res = {"success": False, "msg": "Only group owner can add members"}
        elif target not in get_all_usernames():
            res = {"success": False, "msg": "User not found"}
        else:
            c.execute("INSERT OR IGNORE INTO room_members (room_id, user) VALUES (?, ?)", (room_id, target))
            res["target"] = target

    elif act == "remove_room_member":
        room_id = data.get("room_id")
        target = data.get("target")
        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room_id,))
        owner_row = c.fetchone()
        if not owner_row:
            res = {"success": False, "msg": "Room not found"}
        elif owner_row[0] != username and target != username:
            # Owner can remove anyone; user can only remove themselves (leave)
            res = {"success": False, "msg": "Only group owner can remove other members"}
        elif owner_row[0] == target:
            res = {"success": False, "msg": "Owner cannot leave; delete the group instead"}
        else:
            c.execute("DELETE FROM room_members WHERE room_id=? AND user=?", (room_id, target))
            res["target"] = target

    elif act == "delete_room":
        room_id = data.get("room_id")
        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room_id,))
        owner_row = c.fetchone()
        if not owner_row or owner_row[0] != username:
            res = {"success": False, "msg": "Only owner can delete the group"}
        else:
            # Wipe everything
            c.execute("DELETE FROM messages WHERE room=?", (room_id,))
            c.execute("DELETE FROM message_reads WHERE msg_id IN (SELECT msg_id FROM messages WHERE room=?)", (room_id,))
            c.execute("DELETE FROM room_members WHERE room_id=?", (room_id,))
            c.execute("DELETE FROM custom_rooms WHERE room_id=?", (room_id,))

    elif act == "search_messages":
        room = data.get("room")
        query = (data.get("q") or "").strip()
        if not query or not room:
            res = {"success": False, "msg": "Query and room required"}
        else:
            # Verify access
            access_ok = False
            if room == "Announcements":
                access_ok = True
            elif room.startswith("dm_"):
                pair = room[3:].split("-")
                access_ok = (username in pair) and (len(pair) == 2)
            elif room.startswith("rm_"):
                c.execute("SELECT 1 FROM room_members WHERE room_id=? AND user=?", (room, username))
                access_ok = c.fetchone() is not None
            if not access_ok:
                res = {"success": False, "msg": "Access denied"}
            else:
                like = f"%{query}%"
                c.execute("""SELECT msg_id, user, msg_type, content, file_name, timestamp
                             FROM messages WHERE room=? AND msg_type='text' AND content LIKE ?
                             ORDER BY timestamp DESC LIMIT 50""", (room, like))
                res["results"] = [
                    {"id": r[0], "user": r[1], "msgType": r[2], "text": r[3],
                     "fileName": r[4], "timestamp": r[5]}
                    for r in c.fetchall()
                ]

    conn.commit()
    conn.close()
    return res

# ===================== ADMIN PANEL =====================
@app.get("/api/admin/users")
async def admin_list_users(info: dict = Depends(require_admin)):
    users = read_users()
    out = []
    for u in users:
        out.append({
            "username": u["username"],
            "role": u["role"],
            "quota_mb": u["quota_mb"],
            "used_bytes": get_user_used_bytes(u["username"]),
            "online": u["username"] in manager.online_users(),
        })
    return {"users": out}

@app.post("/api/admin/users/add")
async def admin_add_user(request: Request, info: dict = Depends(require_admin)):
    data = await request.json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    role = data.get("role") or "user"
    quota_mb = int(data.get("quota_mb") or DEFAULT_QUOTA_MB)
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username/password required")
    if ":" in username or ":" in password:
        raise HTTPException(status_code=400, detail="Username/password cannot contain ':'")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    users = read_users()
    if any(u["username"] == username for u in users):
        raise HTTPException(status_code=400, detail="User exists")
    users.append({"username": username, "password": password, "role": role, "quota_mb": quota_mb})
    write_users(users)
    return {"success": True}

@app.post("/api/admin/users/update")
async def admin_update_user(request: Request, info: dict = Depends(require_admin)):
    data = await request.json()
    username = data.get("username")
    users = read_users()
    found = False
    for u in users:
        if u["username"] == username:
            if "password" in data and data["password"]:
                if ":" in data["password"]:
                    raise HTTPException(status_code=400, detail="Password cannot contain ':'")
                u["password"] = data["password"]
            if "role" in data and data["role"] in ("admin", "user"):
                u["role"] = data["role"]
            if "quota_mb" in data:
                try: u["quota_mb"] = int(data["quota_mb"])
                except: pass
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="User not found")
    write_users(users)
    return {"success": True}

@app.post("/api/admin/users/delete")
async def admin_delete_user(request: Request, info: dict = Depends(require_admin)):
    data = await request.json()
    username = data.get("username")
    if username == info["user"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    users = read_users()
    new_users = [u for u in users if u["username"] != username]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="User not found")
    write_users(new_users)
    return {"success": True}

@app.get("/api/admin/stats")
async def admin_stats(info: dict = Depends(require_admin)):
    # disk usage of upload dir
    total_uploads = 0
    file_count = 0
    for root, _, files in os.walk(UPLOAD_DIR):
        for f in files:
            try:
                total_uploads += os.path.getsize(os.path.join(root, f))
                file_count += 1
            except: pass

    # message count
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM messages")
    msg_count = c.fetchone()[0]
    conn.close()

    # disk space
    disk = shutil.disk_usage(BASE_DIR)

    users = read_users()
    return {
        "uploads_bytes": total_uploads,
        "uploads_files": file_count,
        "messages_count": msg_count,
        "users_count": len(users),
        "online_count": len(manager.online_users()),
        "online_users": manager.online_users(),
        "disk_total": disk.total,
        "disk_used": disk.used,
        "disk_free": disk.free,
    }

# ===================== ADMIN: UPDATE & ROLLBACK =====================
GITHUB_RAW = "https://raw.githubusercontent.com/saeederamy/Black-Chat/main"
UPDATE_FILES = [
    ("main.py", "main.py"),
    ("templates/index.html", "templates/index.html"),
    ("static/script.js", "static/script.js"),
    ("static/service-worker.js", "static/service-worker.js"),
    ("static/manifest.json", "static/manifest.json"),
    ("install.sh", "install.sh"),
]
# Binary files (icons) — downloaded but not text
UPDATE_BINARY_FILES = [
    ("static/icon-192.png", "static/icon-192.png"),
    ("static/icon-512.png", "static/icon-512.png"),
    ("static/favicon-32.png", "static/favicon-32.png"),
]
MAX_BACKUPS = 5

def _make_backup(label="manual"):
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    name = f"backup_{ts}_{label}"
    path = os.path.join(BACKUP_DIR, name)
    os.makedirs(path, exist_ok=True)
    # copy code files only (not uploads, not all backups themselves)
    for src_rel in [
        "main.py",
        "templates/index.html",
        "static/script.js",
        "static/service-worker.js",
        "static/manifest.json",
        "static/icon-192.png",
        "static/icon-512.png",
        "static/favicon-32.png",
        "install.sh",
        "users.txt",
    ]:
        src = os.path.join(BASE_DIR, src_rel)
        if os.path.exists(src):
            dst = os.path.join(path, src_rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    # also backup db
    if os.path.exists(DB_FILE):
        shutil.copy2(DB_FILE, os.path.join(path, "chat.db"))
    return name

def _trim_backups():
    try:
        items = sorted([d for d in os.listdir(BACKUP_DIR) if d.startswith("backup_")])
        while len(items) > MAX_BACKUPS:
            old = items.pop(0)
            shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)
    except Exception:
        pass

def _list_backups():
    out = []
    if not os.path.exists(BACKUP_DIR):
        return out
    for d in sorted(os.listdir(BACKUP_DIR), reverse=True):
        full = os.path.join(BACKUP_DIR, d)
        if os.path.isdir(full) and d.startswith("backup_"):
            try:
                size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(full) for f in fs)
            except:
                size = 0
            out.append({
                "name": d,
                "size_bytes": size,
                "created": datetime.datetime.fromtimestamp(os.path.getctime(full)).isoformat(),
            })
    return out

def _download_url_to(url, dst):
    req = urllib.request.Request(url, headers={"User-Agent": "BlackChat-Updater/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(data)
    return len(data)

def _restart_service_async():
    # Try systemctl restart in background; ignore errors (in dev)
    try:
        subprocess.Popen(
            ["systemctl", "restart", "black-chat.service"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        pass

@app.get("/api/admin/backups")
async def admin_list_backups(info: dict = Depends(require_admin)):
    return {"backups": _list_backups()}

@app.post("/api/admin/backup")
async def admin_create_backup(info: dict = Depends(require_admin)):
    name = _make_backup(label="manual")
    _trim_backups()
    return {"success": True, "name": name}

@app.post("/api/admin/update")
async def admin_update(info: dict = Depends(require_admin)):
    """
    1) Make automatic backup
    2) Download latest files into temp (text + binary)
    3) Atomically replace (skip files not present on remote)
    4) Schedule service restart (3s delay)
    """
    backup_name = _make_backup(label="preupdate")
    _trim_backups()

    # Download to temp first to avoid partial overwrites
    tmpdir = tempfile.mkdtemp(prefix="bc_update_")
    downloaded = []
    skipped = []
    try:
        # Required files (text) - failure here aborts the whole update
        for remote_rel, local_rel in UPDATE_FILES:
            url = f"{GITHUB_RAW}/{remote_rel}"
            tmp_dst = os.path.join(tmpdir, local_rel)
            size = _download_url_to(url, tmp_dst)
            downloaded.append((tmp_dst, os.path.join(BASE_DIR, local_rel), size))
        # Optional binary files (icons) - missing ones are tolerated
        for remote_rel, local_rel in UPDATE_BINARY_FILES:
            url = f"{GITHUB_RAW}/{remote_rel}"
            tmp_dst = os.path.join(tmpdir, local_rel)
            try:
                size = _download_url_to(url, tmp_dst)
                downloaded.append((tmp_dst, os.path.join(BASE_DIR, local_rel), size))
            except Exception:
                skipped.append(local_rel)
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Download failed: {e}")

    # Replace
    try:
        for src, dst, _ in downloaded:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        # ensure install.sh executable
        ish = os.path.join(BASE_DIR, "install.sh")
        if os.path.exists(ish):
            try: os.chmod(ish, 0o755)
            except: pass
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Apply failed (rollback the backup '{backup_name}' if needed): {e}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    async def delayed_restart():
        await asyncio.sleep(3)
        _restart_service_async()
    asyncio.create_task(delayed_restart())

    return {
        "success": True,
        "backup": backup_name,
        "skipped": skipped,
        "message": f"Update applied ({len(downloaded)} files). Service will restart in ~3s.",
    }

@app.post("/api/admin/rollback")
async def admin_rollback(request: Request, info: dict = Depends(require_admin)):
    data = await request.json()
    name = data.get("name")
    if not name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid backup name")
    src_dir = os.path.join(BACKUP_DIR, name)
    if not os.path.isdir(src_dir):
        raise HTTPException(status_code=404, detail="Backup not found")

    # safety backup before rollback
    safety = _make_backup(label="prerollback")
    _trim_backups()

    try:
        for rel in [
            "main.py",
            "templates/index.html",
            "static/script.js",
            "static/service-worker.js",
            "static/manifest.json",
            "static/icon-192.png",
            "static/icon-512.png",
            "static/favicon-32.png",
            "install.sh",
            "users.txt",
        ]:
            src = os.path.join(src_dir, rel)
            if os.path.exists(src):
                dst = os.path.join(BASE_DIR, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
        db_src = os.path.join(src_dir, "chat.db")
        if os.path.exists(db_src):
            shutil.copy2(db_src, DB_FILE)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    async def delayed_restart():
        await asyncio.sleep(3)
        _restart_service_async()
    asyncio.create_task(delayed_restart())

    return {"success": True, "safety_backup": safety, "message": "Rollback complete. Service will restart in ~3s."}

@app.post("/api/admin/restart")
async def admin_restart(info: dict = Depends(require_admin)):
    async def delayed_restart():
        await asyncio.sleep(1)
        _restart_service_async()
    asyncio.create_task(delayed_restart())
    return {"success": True}

# ===================== PHASE 4: HELPERS =====================
def update_user_last_seen(username):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO user_presence (user, last_seen) VALUES (?, CURRENT_TIMESTAMP)", (username,))
        conn.commit()
        conn.close()
    except Exception: pass

def get_last_seen_map():
    """Returns dict: username -> ISO timestamp of last_seen"""
    out = {}
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT user, last_seen FROM user_presence")
        for r in c.fetchall():
            out[r[0]] = r[1]
        conn.close()
    except Exception: pass
    return out

def get_message_reads(msg_ids):
    """Returns dict: msg_id -> [list of readers]"""
    if not msg_ids:
        return {}
    out = {mid: [] for mid in msg_ids}
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        placeholders = ",".join("?" * len(msg_ids))
        c.execute(f"SELECT msg_id, reader FROM message_reads WHERE msg_id IN ({placeholders})", msg_ids)
        for r in c.fetchall():
            out.setdefault(r[0], []).append(r[1])
        conn.close()
    except Exception: pass
    return out

def get_pinned_for_room(room):
    """Returns list of pinned msgs (joined with messages table) for a room."""
    out = []
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("""
            SELECT p.msg_id, p.pinned_by, p.pinned_at, m.user, m.msg_type, m.content, m.file_name, m.timestamp
            FROM pinned_messages p
            LEFT JOIN messages m ON m.msg_id = p.msg_id
            WHERE p.room = ?
            ORDER BY p.pinned_at DESC
        """, (room,))
        for row in c.fetchall():
            mid, pinned_by, pinned_at, user, msg_type, content, file_name, ts = row
            if not user:
                # Original message was deleted - skip orphaned pin
                continue
            out.append({
                "id": mid, "user": user, "msgType": msg_type,
                "text": content if msg_type == 'text' else '',
                "url": content if msg_type != 'text' else '',
                "fileName": file_name,
                "timestamp": ts,
                "pinnedBy": pinned_by,
                "pinnedAt": pinned_at,
            })
        conn.close()
    except Exception:
        pass
    return out

def mark_messages_read(reader, room, until_msg_id=None):
    """Mark all messages in `room` from other senders as read by `reader`.
    Returns list of (msg_id, sender) of newly-read messages."""
    newly_read = []
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        # Get unread messages in this room (not from reader, not yet read by reader)
        c.execute("""SELECT m.msg_id, m.user FROM messages m
                     WHERE m.room = ? AND m.user != ?
                     AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.msg_id = m.msg_id AND r.reader = ?)
                     ORDER BY m.timestamp ASC""", (room, reader, reader))
        rows = c.fetchall()
        for msg_id, sender in rows:
            c.execute("INSERT OR IGNORE INTO message_reads (msg_id, reader) VALUES (?, ?)", (msg_id, reader))
            newly_read.append((msg_id, sender))
        conn.commit()
        conn.close()
    except Exception: pass
    return newly_read

# ===================== WEBSOCKET =====================
@app.websocket("/ws/{username}/{role}/{token}")
async def websocket_endpoint(websocket: WebSocket, username: str, role: str, token: str):
    info = verify_token(token)
    if not info or info["user"] != username:
        # accept first so we can send close code, then close
        try:
            await websocket.accept()
            await websocket.close(code=4401)
        except Exception:
            pass
        return
    await manager.connect(websocket, username)
    update_user_last_seen(username)
    # broadcast online list update + last seen times
    await manager.broadcast({
        "type": "presence",
        "online": manager.online_users(),
        "last_seen": get_last_seen_map(),
    })
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except:
                continue
            action = msg.get("action")

            if action == "ping":
                try: await websocket.send_json({"type": "pong"})
                except: pass
                continue

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            if action == "get_history":
                room = msg.get("room")
                c.execute("SELECT msg_id, user, msg_type, content, file_name, reply_to, reactions, timestamp FROM messages WHERE room=? ORDER BY timestamp ASC", (room,))
                rows = c.fetchall()
                msg_ids = [m[0] for m in rows]
                reads_map = get_message_reads(msg_ids)
                history = [{
                    "id": m[0], "user": m[1], "msgType": m[2],
                    "text": m[3] if m[2]=='text' else '',
                    "url": m[3] if m[2]!='text' else '',
                    "fileName": m[4],
                    "replyTo": json.loads(m[5]) if m[5] else None,
                    "reactions": json.loads(m[6]) if m[6] else {},
                    "timestamp": m[7],
                    "readBy": reads_map.get(m[0], []),
                } for m in rows]
                await websocket.send_json({"type": "history", "room": room, "data": history})

            elif action == "delete_msg":
                msg_ids = msg.get("msg_ids", [])
                for msg_id in msg_ids:
                    c.execute("SELECT user, room, msg_type, content FROM messages WHERE msg_id=?", (msg_id,))
                    row = c.fetchone()
                    if row and (row[0] == username or role == 'admin'):
                        # if it was a media message, also remove the upload record
                        if row[2] in ("image", "video", "audio", "file") and row[3]:
                            try:
                                # try to remove physical file
                                rel = row[3]
                                if rel.startswith("/static/uploads/"):
                                    fp = os.path.join(BASE_DIR, rel.lstrip("/"))
                                    if os.path.exists(fp):
                                        try: os.remove(fp)
                                        except: pass
                                remove_user_upload_record(rel)
                            except: pass
                        c.execute("DELETE FROM messages WHERE msg_id=?", (msg_id,))
                        await manager.broadcast({"type": "deleted", "room": row[1], "msg_id": msg_id})

            elif action == "edit_msg":
                msg_id, new_text = msg.get("msg_id"), msg.get("text")
                c.execute("SELECT user, room FROM messages WHERE msg_id=?", (msg_id,))
                row = c.fetchone()
                if row and (row[0] == username or role == 'admin'):
                    c.execute("UPDATE messages SET content=? WHERE msg_id=?", (new_text, msg_id))
                    await manager.broadcast({"type": "edited", "room": row[1], "msg_id": msg_id, "new_text": new_text})

            elif action == "react_msg":
                msg_id, emoji = msg.get("msg_id"), msg.get("emoji")
                c.execute("SELECT reactions, room FROM messages WHERE msg_id=?", (msg_id,))
                row = c.fetchone()
                if row:
                    reacts = json.loads(row[0]) if row[0] else {}
                    if username in reacts and reacts[username] == emoji:
                        del reacts[username]
                    else:
                        reacts[username] = emoji
                    c.execute("UPDATE messages SET reactions=? WHERE msg_id=?", (json.dumps(reacts), msg_id))
                    await manager.broadcast({"type": "reaction_updated", "room": row[1], "msg_id": msg_id, "reactions": reacts})

            elif action == "forward_msg":
                msg_ids = msg.get("msg_ids", [])
                target_room = msg.get("target_room")
                room_members = []
                if target_room.startswith('rm_'):
                    c.execute("SELECT user FROM room_members WHERE room_id=?", (target_room,))
                    room_members = [r[0] for r in c.fetchall()]
                if target_room.startswith('dm_'):
                    users_pair = target_room.replace('dm_', '').split('-')
                    if len(users_pair) == 2:
                        t_user = users_pair[0] if users_pair[1] == username else users_pair[1]
                        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (username, t_user))
                        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (t_user, username))
                for msg_id in msg_ids:
                    c.execute("SELECT msg_type, content, file_name FROM messages WHERE msg_id=?", (msg_id,))
                    row = c.fetchone()
                    if row:
                        msg_type, content, file_name = row
                        new_msg_id = str(uuid.uuid4())
                        now_str = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                        fwd_content = f"Forwarded from {username}:\n{content}" if msg_type == 'text' else content
                        msg_payload = {
                            "id": new_msg_id, "user": username, "msgType": msg_type,
                            "text": fwd_content if msg_type == 'text' else '',
                            "url": content if msg_type != 'text' else '',
                            "fileName": file_name, "roomMembers": room_members,
                            "replyTo": None, "reactions": {}, "timestamp": now_str
                        }
                        c.execute("INSERT INTO messages (msg_id, room, user, msg_type, content, file_name, reply_to, reactions, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                  (new_msg_id, target_room, username, msg_type, fwd_content if msg_type == 'text' else content, file_name, '{}', '{}', now_str))
                        await manager.broadcast({"type": "new_msg", "room": target_room, "data": msg_payload})

            elif action == "send_msg":
                room = msg.get("room")
                target_user = msg.get("targetUser")
                if room == "Announcements" and role != "admin":
                    conn.close(); continue
                room_members = []
                if room.startswith('rm_'):
                    c.execute("SELECT user FROM room_members WHERE room_id=?", (room,))
                    room_members = [r[0] for r in c.fetchall()]
                if target_user:
                    c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (username, target_user))
                    c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target_user, username))
                msg_id = str(uuid.uuid4())
                reply_to = json.dumps(msg.get('replyTo', {}))
                now_str = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                msg_payload = {
                    "id": msg_id, "user": msg['user'], "msgType": msg['msgType'],
                    "text": msg.get('text',''), "url": msg.get('url',''),
                    "fileName": msg.get('fileName',''), "roomMembers": room_members,
                    "replyTo": msg.get('replyTo', None), "reactions": {}, "timestamp": now_str
                }
                # Phase 4: forward album metadata if present (not stored in DB)
                if msg.get('albumId'):
                    msg_payload['albumId'] = msg.get('albumId')
                    msg_payload['albumIndex'] = msg.get('albumIndex', 0)
                    msg_payload['albumTotal'] = msg.get('albumTotal', 1)
                c.execute("INSERT INTO messages (msg_id, room, user, msg_type, content, file_name, reply_to, reactions, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          (msg_id, room, msg['user'], msg['msgType'], msg.get('text', msg.get('url', '')), msg.get('fileName', ''), reply_to, '{}', now_str))
                await manager.broadcast({"type": "new_msg", "room": room, "data": msg_payload})

            elif action == "webrtc":
                await manager.broadcast({"type": "webrtc", "data": msg})

            elif action == "typing":
                # state: 'typing' | 'stopped'
                state = msg.get("state", "typing")
                await manager.broadcast({
                    "type": "typing",
                    "room": msg.get("room"),
                    "user": username,
                    "state": state,
                })

            elif action == "read_messages":
                # User reports they've read all messages in a room up to now
                room = msg.get("room")
                if room:
                    newly_read = mark_messages_read(username, room)
                    # Notify each sender with the IDs of their messages now read by `username`
                    senders = {}
                    for mid, sender in newly_read:
                        if sender == username:
                            continue
                        senders.setdefault(sender, []).append(mid)
                    if senders:
                        await manager.broadcast({
                            "type": "read_receipt",
                            "room": room,
                            "reader": username,
                            "msg_ids_per_sender": senders,
                        })

            elif action == "pin_msg":
                msg_id = msg.get("msg_id")
                # find the room of this message
                c.execute("SELECT room FROM messages WHERE msg_id=?", (msg_id,))
                row = c.fetchone()
                if row:
                    room = row[0]
                    # Authorization: admin everywhere, group owner in groups, anyone in DM
                    can_pin = False
                    if role == 'admin':
                        can_pin = True
                    elif room.startswith('rm_'):
                        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room,))
                        owner_row = c.fetchone()
                        if owner_row and owner_row[0] == username:
                            can_pin = True
                    elif room.startswith('dm_'):
                        # Both participants can pin in a DM
                        pair = room[3:].split("-")
                        if username in pair:
                            can_pin = True
                    if can_pin:
                        c.execute("INSERT OR IGNORE INTO pinned_messages (room, msg_id, pinned_by) VALUES (?, ?, ?)", (room, msg_id, username))
                        conn.commit()
                        await manager.broadcast({
                            "type": "pinned_changed", "room": room,
                            "pinned": get_pinned_for_room(room),
                        })

            elif action == "unpin_msg":
                msg_id = msg.get("msg_id")
                c.execute("SELECT room FROM messages WHERE msg_id=?", (msg_id,))
                row = c.fetchone()
                if row:
                    room = row[0]
                    can_unpin = False
                    if role == 'admin':
                        can_unpin = True
                    elif room.startswith('rm_'):
                        c.execute("SELECT owner FROM custom_rooms WHERE room_id=?", (room,))
                        owner_row = c.fetchone()
                        if owner_row and owner_row[0] == username:
                            can_unpin = True
                    elif room.startswith('dm_'):
                        pair = room[3:].split("-")
                        if username in pair:
                            can_unpin = True
                    if can_unpin:
                        c.execute("DELETE FROM pinned_messages WHERE msg_id=?", (msg_id,))
                        conn.commit()
                        await manager.broadcast({
                            "type": "pinned_changed", "room": row[0],
                            "pinned": get_pinned_for_room(row[0]),
                        })

            elif action == "get_pinned":
                room = msg.get("room")
                if room:
                    await websocket.send_json({
                        "type": "pinned_changed", "room": room,
                        "pinned": get_pinned_for_room(room),
                    })

            conn.commit()
            conn.close()

    except WebSocketDisconnect:
        update_user_last_seen(username)
        manager.disconnect(websocket)
        await manager.broadcast({
            "type": "presence",
            "online": manager.online_users(),
            "last_seen": get_last_seen_map(),
        })
    except Exception:
        update_user_last_seen(username)
        manager.disconnect(websocket)
        try:
            await manager.broadcast({
                "type": "presence",
                "online": manager.online_users(),
                "last_seen": get_last_seen_map(),
            })
        except: pass
