import os
import sqlite3
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'black-chat-secure-key'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
socketio = SocketIO(app, cors_allowed_origins="*")

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def init_db():
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  room TEXT, user TEXT, msg_type TEXT, content TEXT, file_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    
    # ایندکس برای افزایش وحشتناک سرعت لود پیام‌ها
    c.execute('CREATE INDEX IF NOT EXISTS idx_room_time ON messages(room, timestamp)')
    
    c.execute('''CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)''')
    c.execute("INSERT OR IGNORE INTO groups (name) VALUES ('General')")
    c.execute("INSERT OR IGNORE INTO groups (name) VALUES ('Dev_Team')")
    
    c.execute('''CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, contact TEXT, UNIQUE(owner, contact))''')
    conn.commit()
    conn.close()

init_db()

def check_user_exists(username):
    if not os.path.exists('users.txt'): return False
    with open('users.txt', 'r') as f:
        for line in f:
            if ':' in line and line.strip().split(':')[0] == username: return True
    return False

def check_user_login(username, password):
    if not os.path.exists('users.txt'): return False
    with open('users.txt', 'r') as f:
        for line in f:
            if ':' in line:
                u, p = line.strip().split(':', 1)
                if u == username and p == password: return True
    return False

def get_all_groups():
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute("SELECT name FROM groups")
    groups = [row[0] for row in c.fetchall()]
    conn.close()
    return groups

def get_contacts(username):
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute("SELECT contact FROM contacts WHERE owner=?", (username,))
    contacts = [row[0] for row in c.fetchall()]
    conn.close()
    return contacts

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form['password'].strip()
        if check_user_login(username, password):
            session['user'] = username
            return redirect(url_for('index'))
        return render_template('login.html', error="Invalid Credentials")
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

@app.route('/')
def index():
    if 'user' not in session: return redirect(url_for('login'))
    return render_template('index.html', username=session['user'], all_groups=get_all_groups(), contacts=get_contacts(session['user']))

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    content_type = file.content_type or ''
    if content_type.startswith('image/'): msg_type = 'image'
    elif content_type.startswith('video/'): msg_type = 'video'
    elif content_type.startswith('audio/'): msg_type = 'audio'
    else: msg_type = 'file'
    
    return jsonify({'url': '/' + filepath, 'type': msg_type, 'name': filename})

@socketio.on('join')
def on_join(data):
    room = data['room']
    join_room(room)
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute("SELECT user, msg_type, content, file_name FROM messages WHERE room=? ORDER BY timestamp ASC", (room,))
    msgs = c.fetchall()
    conn.close()
    
    history = [{'user': m[0], 'msgType': m[1], 'text': m[2] if m[1] == 'text' else '', 'url': m[2] if m[1] != 'text' else '', 'fileName': m[3]} for m in msgs]
    emit('history', history)

@socketio.on('send_message')
def handle_message(data):
    room, user, msg_type = data['room'], data['user'], data['msgType']
    content, file_name = data.get('text', data.get('url', '')), data.get('fileName', '')

    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute("INSERT INTO messages (room, user, msg_type, content, file_name) VALUES (?, ?, ?, ?, ?)", (room, user, msg_type, content, file_name))
    
    # اگر پیام خصوصی بود، مطمئن شویم دو طرف در لیست هم هستند
    if room.startswith('dm_'):
        target = room.replace('dm_', '').replace(user, '').replace('_', '')
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (user, target))
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target, user))
        
    conn.commit()
    conn.close()

    emit('message', data, room=room)
    emit('notification', data, broadcast=True)

@socketio.on('create_group')
def handle_create_group(data):
    group_name = data['group_name'].replace(' ', '_')
    if not group_name: return
    try:
        conn = sqlite3.connect('chat.db')
        c = conn.cursor()
        c.execute("INSERT INTO groups (name) VALUES (?)", (group_name,))
        conn.commit()
        conn.close()
        emit('new_group', {'name': group_name}, broadcast=True)
    except sqlite3.IntegrityError:
        pass

@socketio.on('add_contact')
def handle_add_contact(data):
    owner = data['owner']
    target = data['target'].strip()
    
    if owner == target:
        emit('contact_response', {'success': False, 'msg': "You can't add yourself!"})
        return
    if not check_user_exists(target):
        emit('contact_response', {'success': False, 'msg': "User ID not found in system!"})
        return
        
    try:
        conn = sqlite3.connect('chat.db')
        c = conn.cursor()
        # ایجاد ارتباط دو طرفه
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (owner, target))
        c.execute("INSERT OR IGNORE INTO contacts (owner, contact) VALUES (?, ?)", (target, owner))
        conn.commit()
        conn.close()
        # ارسال موفقیت برای همه کلاینت‌ها تا هر دو طرف لیستشان آپدیت شود
        emit('contact_response', {'success': True, 'owner': owner, 'contact': target}, broadcast=True)
    except Exception as e:
        emit('contact_response', {'success': False, 'msg': "Error adding contact!"})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
