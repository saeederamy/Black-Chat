import os
import sqlite3
import json
import aiofiles
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List

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
    c.execute('''CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, user TEXT, msg_type TEXT, content TEXT, file_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_room ON messages(room)')
    c.execute('''CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, contact TEXT, UNIQUE(owner, contact))''')
    conn.commit()
    conn.close()

init_db()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room: str):
        await websocket.accept()
        if room not in self.active_connections:
            self.active_connections[room] = []
        self.active_connections[room].append(websocket)

    def disconnect(self, websocket: WebSocket, room: str):
        if room in self.active_connections:
            self.active_connections[room].remove(websocket)

    async def broadcast(self, message: dict, room: str):
        if room in self.active_connections:
            for connection in self.active_connections[room]:
                await connection.send_json(message)

manager = ConnectionManager()

def check_login(username, password):
    if not os.path.exists(USERS_FILE): return None
    with open(USERS_FILE, "r") as f:
        for line in f:
            parts = line.strip().split(':')
            if len(parts) >= 3 and parts[0] == username and parts[1] == password:
                return parts[2] # role
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
async def get_index():
    return FileResponse(os.path.join(TPL_DIR, 'index.html'))

@app.post("/api/login")
async def login_api(request: Request):
    data = await request.json()
    role = check_login(data.get("username"), data.get("password"))
    if role:
        return {"success": True, "role": role, "username": data.get("username")}
    return {"success": False, "message": "Invalid Credentials"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_location = os.path.join(UPLOAD_DIR, file.filename)
    async with aiofiles.open(file_location, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
    
    c_type = file.content_type or ''
    msg_type = 'file'
    if c_type.startswith('image/'): msg_type = 'image'
    elif c_type.startswith('video/'): msg_type = 'video'
    elif c_type.startswith('audio/'): msg_type = 'audio'
    
    return {"url": f"/static/uploads/{file.filename}", "type": msg_type, "name": file.filename}

@app.post("/api/contacts")
async def add_contact(request: Request):
    data = await request.json()
    owner, target = data.get("owner"), data.get("target")
    if target not in get_all_users(): return {"success": False, "msg": "User not found!"}
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (owner, target))
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target, owner))
        conn.commit()
        conn.close()
        return {"success": True, "target": target}
    except Exception as e:
        return {"success": False, "msg": str(e)}

@app.get("/api/init_data")
async def init_data(username: str):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT contact FROM contacts WHERE owner=?", (username,))
    contacts = [row[0] for row in c.fetchall()]
    conn.close()
    return {"contacts": contacts}

@app.websocket("/ws/{room}/{username}/{role}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str, role: str):
    await manager.connect(websocket, room)
    
    # ارسال تاریخچه
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user, msg_type, content, file_name FROM messages WHERE room=? ORDER BY timestamp ASC", (room,))
    history = [{"user": m[0], "msgType": m[1], "text": m[2] if m[1]=='text' else '', "url": m[2] if m[1]!='text' else '', "fileName": m[3]} for m in c.fetchall()]
    conn.close()
    await websocket.send_json({"type": "history", "data": history})

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            # جلوگیری از ارسال پیام توسط کاربران عادی در کانال همگانی
            if room == "Announcements" and role != "admin":
                continue

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("INSERT INTO messages (room, user, msg_type, content, file_name) VALUES (?, ?, ?, ?, ?)", 
                      (room, msg['user'], msg['msgType'], msg.get('text', msg.get('url', '')), msg.get('fileName', '')))
            conn.commit()
            conn.close()

            await manager.broadcast({"type": "message", "data": msg}, room)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
