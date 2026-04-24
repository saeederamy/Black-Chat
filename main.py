import os
import sqlite3
import json
import uuid
import aiofiles
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

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
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages (msg_id TEXT PRIMARY KEY, room TEXT, user TEXT, msg_type TEXT, content TEXT, file_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, contact TEXT, UNIQUE(owner, contact))''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_ips (user TEXT, ip TEXT, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user, ip))''')
    c.execute('''CREATE TABLE IF NOT EXISTS custom_rooms (room_id TEXT PRIMARY KEY, type TEXT, name TEXT, owner TEXT)''')
    conn.commit()
    conn.close()

init_db()

class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

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
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO active_ips (user, ip) VALUES (?, ?)", (user, request.client.host))
        conn.commit()
        conn.close()
        return {"success": True, "role": role, "username": user}
    return {"success": False, "message": "Invalid"}

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
        c.execute("SELECT room_id, type, name FROM custom_rooms")
        res["custom_rooms"] = [{"id": r[0], "type": r[1], "name": r[2]} for r in c.fetchall()]
    elif act == "get_ips":
        c.execute("SELECT ip, last_seen FROM active_ips WHERE user=?", (data.get("user"),))
        res["ips"] = [{"ip": r[0], "date": r[1]} for r in c.fetchall()]
    elif act == "create_room":
        room_id = "rm_" + uuid.uuid4().hex[:8]
        c.execute("INSERT INTO custom_rooms (room_id, type, name, owner) VALUES (?, ?, ?, ?)", (room_id, data.get("type"), data.get("name"), data.get("user")))
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
            
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            if action == "get_history":
                room = msg.get("room")
                c.execute("SELECT msg_id, user, msg_type, content, file_name FROM messages WHERE room=? ORDER BY timestamp ASC", (room,))
                history = [{"id": m[0], "user": m[1], "msgType": m[2], "text": m[3] if m[2]=='text' else '', "url": m[3] if m[2]!='text' else '', "fileName": m[4]} for m in c.fetchall()]
                await websocket.send_json({"type": "history", "room": room, "data": history})

            elif action == "delete_msg":
                msg_id = msg.get("msg_id")
                c.execute("SELECT user, room FROM messages WHERE msg_id=?", (msg_id,))
                row = c.fetchone()
                if row and (row[0] == username or role == 'admin'):
                    c.execute("DELETE FROM messages WHERE msg_id=?", (msg_id,))
                    await manager.broadcast({"type": "deleted", "room": row[1], "msg_id": msg_id})
                    
            elif action == "send_msg":
                room = msg.get("room")
                target_user = msg.get("targetUser")
                
                if room == "Announcements" and role != "admin": continue
                
                # ثبت دقیق کانتکت‌ها بدون هیچگونه دستکاری رشته‌ای (حل مشکل اصلی پیام ندادن)
                if target_user:
                    c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (username, target_user))
                    c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target_user, username))

                msg_id = str(uuid.uuid4())
                msg_payload = {"id": msg_id, "user": msg['user'], "msgType": msg['msgType'], "text": msg.get('text',''), "url": msg.get('url',''), "fileName": msg.get('fileName','')}
                
                c.execute("INSERT INTO messages (msg_id, room, user, msg_type, content, file_name) VALUES (?, ?, ?, ?, ?, ?)", 
                          (msg_id, room, msg['user'], msg['msgType'], msg.get('text', msg.get('url', '')), msg.get('fileName', '')))
                
                await manager.broadcast({"type": "new_msg", "room": room, "data": msg_payload})
                
            conn.commit()
            conn.close()
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
