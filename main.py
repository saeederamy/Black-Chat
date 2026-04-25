import os
import sqlite3
import json
import uuid
import datetime
import aiofiles
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TPL_DIR = os.path.join(BASE_DIR, "templates")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
USERS_FILE = os.path.join(BASE_DIR, "users.txt")
DB_FILE = os.path.join(BASE_DIR, "chat.db")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TPL_DIR, exist_ok=True)

def init_db():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages (msg_id TEXT PRIMARY KEY, room TEXT, user TEXT, msg_type TEXT, content TEXT, file_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_room ON messages(room)')
    
    try: c.execute("ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT '{}'")
    except: pass
    try: c.execute("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'")
    except: pass

    c.execute('''CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, contact TEXT, UNIQUE(owner, contact))''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_ips (user TEXT, ip TEXT, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user, ip))''')
    c.execute('''CREATE TABLE IF NOT EXISTS profiles (user TEXT PRIMARY KEY, avatar TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS custom_rooms (room_id TEXT PRIMARY KEY, type TEXT, name TEXT, owner TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS room_members (room_id TEXT, user TEXT, UNIQUE(room_id, user))''')
    conn.commit()
    conn.close()

init_db()

# --- سیستم هوشمند تشخیص آی‌پی (رفع مشکل 127.0.0.1) ---
def get_real_ip(request: Request):
    headers_to_check = ["CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"]
    for header in headers_to_check:
        val = request.headers.get(header)
        if val:
            return val.split(",")[0].strip()
    
    ip = request.client.host if request.client else "Unknown"
    if ip == "127.0.0.1" or ip == "::1":
        return "شبکه داخلی (Local)"
    return ip

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try: await connection.send_json(message)
            except: pass

manager = ConnectionManager()

def check_login(username, password):
    if not os.path.exists(USERS_FILE): return None
    with open(USERS_FILE, "r") as f:
        for line in f:
            parts = line.strip().split(':')
            if len(parts) >= 3 and parts[0] == username and parts[1] == password: return parts[2]
    return None

def get_all_users():
    users = []
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r") as f:
            for line in f:
                if ':' in line: users.append(line.strip().split(':')[0])
    return users

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def get_index(): return FileResponse(os.path.join(TPL_DIR, 'index.html'))

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
        return {"success": True, "role": role, "username": user}
    return {"success": False, "message": "Invalid Credentials"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_location = os.path.join(UPLOAD_DIR, file.filename)
    async with aiofiles.open(file_location, 'wb') as out_file:
        await out_file.write(await file.read())
    
    c_type = file.content_type or ''
    msg_type = 'file'
    if c_type.startswith('image/'): msg_type = 'image'
    elif c_type.startswith('video/'): msg_type = 'video'
    elif c_type.startswith('audio/'): msg_type = 'audio'
    
    return {"url": f"/static/uploads/{file.filename}", "type": msg_type, "name": file.filename}

@app.post("/api/upload_avatar")
async def upload_avatar(username: str = Form(...), file: UploadFile = File(...)):
    ext = file.filename.split('.')[-1]
    avatar_name = f"avatar_{username}_{uuid.uuid4().hex[:6]}.{ext}"
    file_location = os.path.join(UPLOAD_DIR, avatar_name)
    async with aiofiles.open(file_location, 'wb') as out_file:
        await out_file.write(await file.read())
    
    url = f"/static/uploads/{avatar_name}"
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO profiles (user, avatar) VALUES (?, ?)", (username, url))
    conn.commit()
    conn.close()
    return {"success": True, "url": url}

@app.post("/api/action")
async def api_action(request: Request):
    data = await request.json()
    act = data.get("action")
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    res = {"success": True}
    
    if act == "get_init_data":
        u = data.get("user")
        c.execute("SELECT contact FROM contacts WHERE owner=?", (u,))
        res["contacts"] = [r[0] for r in c.fetchall()]
        
        c.execute("SELECT r.room_id, r.name FROM custom_rooms r JOIN room_members m ON r.room_id = m.room_id WHERE m.user = ?", (u,))
        res["custom_rooms"] = [{"id": r[0], "type": "group", "name": r[1]} for r in c.fetchall()]
        
        c.execute("SELECT avatar FROM profiles WHERE user=?", (u,))
        av = c.fetchone()
        res["avatar"] = av[0] if av else ""
        
        c.execute("SELECT user, avatar FROM profiles")
        res["all_avatars"] = {r[0]: r[1] for r in c.fetchall()}

    elif act == "get_ips":
        c.execute("SELECT ip, last_seen FROM active_ips WHERE user=?", (data.get("user"),))
        res["ips"] = [{"ip": r[0], "date": r[1]} for r in c.fetchall()]
        
    elif act == "create_room":
        room_id = "rm_" + uuid.uuid4().hex[:8]
        owner = data.get("user")
        room_name = data.get("name")
        members = data.get("members", [])
        
        c.execute("INSERT INTO custom_rooms (room_id, name, owner) VALUES (?, ?, ?)", (room_id, room_name, owner))
        c.execute("INSERT INTO room_members (room_id, user) VALUES (?, ?)", (room_id, owner))
        for m in members:
            c.execute("INSERT OR IGNORE INTO room_members (room_id, user) VALUES (?, ?)", (room_id, m))
        res["room_id"] = room_id
        
    elif act == "add_contact":
        owner, target = data.get("owner"), data.get("target")
        if target not in get_all_users():
            res = {"success": False, "msg": "User not found"}
        else:
            c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (owner, target))
            c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target, owner))
            res["target"] = target
            
    conn.commit()
    conn.close()
    return res

@app.websocket("/ws/{username}/{role}")
async def websocket_endpoint(websocket: WebSocket, username: str, role: str):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            action = msg.get("action")
            
            if action == "ping":
                continue 
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            if action == "get_history":
                room = msg.get("room")
                c.execute("SELECT msg_id, user, msg_type, content, file_name, reply_to, reactions, timestamp FROM messages WHERE room=? ORDER BY timestamp ASC", (room,))
                history = [{"id": m[0], "user": m[1], "msgType": m[2], "text": m[3] if m[2]=='text' else '', "url": m[3] if m[2]!='text' else '', "fileName": m[4], "replyTo": json.loads(m[5]) if m[5] else None, "reactions": json.loads(m[6]) if m[6] else {}, "timestamp": m[7]} for m in c.fetchall()]
                await websocket.send_json({"type": "history", "room": room, "data": history})

            elif action == "delete_msg":
                msg_ids = msg.get("msg_ids", []) 
                for msg_id in msg_ids:
                    c.execute("SELECT user, room FROM messages WHERE msg_id=?", (msg_id,))
                    row = c.fetchone()
                    if row and (row[0] == username or role == 'admin'):
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
                    users = target_room.replace('dm_', '').split('-')
                    if len(users) == 2:
                        t_user = users[0] if users[1] == username else users[1]
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
                
                if room == "Announcements" and role != "admin": continue
                
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
                
                c.execute("INSERT INTO messages (msg_id, room, user, msg_type, content, file_name, reply_to, reactions, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                          (msg_id, room, msg['user'], msg['msgType'], msg.get('text', msg.get('url', '')), msg.get('fileName', ''), reply_to, '{}', now_str))
                
                await manager.broadcast({"type": "new_msg", "room": room, "data": msg_payload})
                
            elif action == "webrtc":
                await manager.broadcast({"type": "webrtc", "data": msg})
                
            conn.commit()
            conn.close()
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
