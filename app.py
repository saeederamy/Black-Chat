import os
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'black-chat-secure-key'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
socketio = SocketIO(app, cors_allowed_origins="*")

# تابع خواندن تمام کاربران برای چت خصوصی
def get_all_users():
    users = []
    if os.path.exists('users.txt'):
        with open('users.txt', 'r') as f:
            for line in f:
                if ':' in line:
                    users.append(line.strip().split(':')[0])
    return users

def check_user(username, password):
    if not os.path.exists('users.txt'): return False
    with open('users.txt', 'r') as f:
        for line in f:
            if ':' in line:
                u, p = line.strip().split(':', 1)
                if u == username and p == password:
                    return True
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
    # ارسال نام کاربری فعلی و لیست کل کاربران به قالب HTML
    return render_template('index.html', username=session['user'], all_users=get_all_users())

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    return jsonify({'url': '/' + filepath, 'type': file.content_type})

@socketio.on('join')
def on_join(data):
    join_room(data['room'])

@socketio.on('send_message')
def handle_message(data):
    # پیام به اتاقی که کاربر در آن است ارسال می‌شود (چه گروه، چه خصوصی)
    emit('message', data, room=data['room'])

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
