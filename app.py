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
    # جدول جدید برای ذخیره گروه‌ها
    c.execute('''CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)''')
    # ساخت دو گروه پیش‌فرض اگر وجود نداشتند
    c.execute("INSERT OR IGNORE INTO groups (name) VALUES ('General')")
    c.execute("INSERT OR IGNORE INTO groups (name) VALUES ('Dev_Team')")
    
    conn.commit()
    conn.close()

init_db()

def get_all_users():
    users = []
    if os.path.exists('users.txt'):
        with open('users.txt', 'r') as f:
            for line in f:
                if ':' in line: users.append(line.strip().split(':')[0])
    return users

def get_all_groups():
    conn = sqlite3.connect('chat.db')
    c = conn.cursor()
    c.execute("SELECT name FROM groups")
    groups = [row[0] for row in c.fetchall()]
    conn.close()
    return groups

def check_user(username, password):
    if not os.path.exists('users.txt'): return False
    with open('users.txt', 'r') as f:
        for line in f:
            if ':' in line:
                u, p = line.strip().split(':', 1)
                if u == username and p == password: return True
    return False

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if check_user(username, password):
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
    return render_template('index.html', username=session['user'], all_users=get_all_users(), all_groups=get_all_groups())

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
    conn.commit()
    conn.close()

    emit('message', data, room=room)
    emit('notification', data, broadcast=True)

# دریافت درخواست ساخت گروه و اطلاع به بقیه
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
        # به همه کلاینت‌ها اطلاع میده تا گروه جدید در لیستشان اضافه شود
        emit('new_group', {'name': group_name}, broadcast=True)
    except sqlite3.IntegrityError:
        pass # گروه قبلاً وجود داشته

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
