// =========================================================
// ⚙️ WebRTC STUN/TURN Config (Prepared for Iran Servers)
// =========================================================
const SERVER_CONFIG = {
    turnDomain: "turn.yourdomian.ir",
    turnPort: "3478",
    turnUser: "user",
    turnPass: "pass"
};

let currentUser = null;
let currentRole = null;
let currentRoom = null;
let ws = null;

// --- Voice Recording Setup ---
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// 1. ورود به سیستم
async function login() {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    if (!u || !p) return;

    const res = await fetch('/api/login', {
        method: 'POST', body: JSON.stringify({username: u, password: p}),
        headers: {'Content-Type': 'application/json'}
    });
    const data = await res.json();
    
    if (data.success) {
        currentUser = data.username;
        currentRole = data.role;
        document.getElementById('profile-name').innerText = currentUser;
        document.getElementById('profile-role').innerText = currentRole === 'admin' ? 'مدیریت کل' : 'کاربر عادی';
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        
        loadContacts();
        openChat('Announcements', 'channel'); // باز کردن پیش‌فرض کانال
    } else {
        alert("اطلاعات ورود اشتباه است.");
    }
}

// 2. بارگذاری لیست چت‌ها
async function loadContacts() {
    const res = await fetch(`/api/init_data?username=${currentUser}`);
    const data = await res.json();
    const list = document.getElementById('chat-list');
    
    // حفظ کانال پیش فرض
    list.innerHTML = `
        <div class="chat-item" onclick="openChat('Announcements', 'channel')">
            <div class="avatar">📢</div>
            <div class="chat-info"><div class="chat-name">اطلاعیه‌های سیستم</div></div>
        </div>
    `;
    
    data.contacts.forEach(c => {
        list.innerHTML += `
            <div class="chat-item" onclick="openChat('${c}', 'private')">
                <div class="avatar">👤</div>
                <div class="chat-info"><div class="chat-name">${c}</div></div>
            </div>`;
    });
}

async function addContact() {
    toggleMenu(true); // بستن منو در صورت باز بودن
    let target = prompt("آیدی فرد مورد نظر را برای شروع چت وارد کنید:");
    if (target && target.trim()) {
        const res = await fetch('/api/contacts', {
            method: 'POST', body: JSON.stringify({owner: currentUser, target: target.trim()}),
            headers: {'Content-Type': 'application/json'}
        });
        const data = await res.json();
        if(data.success) {
            loadContacts();
            openChat(data.target, 'private');
        } else {
            alert(data.msg);
        }
    }
}

// 3. باز کردن چت و اتصال سوکت
function openChat(room, type) {
    if (ws) ws.close();
    
    let realRoomId = room;
    if (type === 'private') {
        const users = [currentUser, room].sort();
        realRoomId = `dm_${users[0]}_${users[1]}`;
    }
    currentRoom = realRoomId;

    // تنظیمات هدر چت
    document.getElementById('room-title').innerText = room === 'Announcements' ? 'اطلاعیه‌های سیستم' : room;
    document.getElementById('room-status').innerText = type === 'channel' ? 'کانال سیستم' : 'چت خصوصی';
    document.getElementById('header-avatar').innerText = type === 'channel' ? '📢' : '👤';
    document.getElementById('messages').innerHTML = '';

    // مخفی کردن کادر تایپ برای کاربران عادی در کانال همگانی
    const inputArea = document.getElementById('input-area');
    if (room === 'Announcements' && currentRole !== 'admin') {
        inputArea.style.display = 'none';
    } else {
        inputArea.style.display = 'flex';
    }

    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('hidden');
    }

    // اتصال به WebSocket FastAPI
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentRoom}/${currentUser}/${currentRole}`);
    
    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') {
            msg.data.forEach(m => appendMessage(m));
        } else if (msg.type === 'message') {
            appendMessage(msg.data);
        }
    };
}

function closeChat() {
    document.getElementById('sidebar').classList.remove('hidden');
}

// 4. رندر پیام‌ها
function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image') media = `<img src="${data.url}">`;
    else if (data.msgType === 'video') media = `<video controls src="${data.url}"></video>`;
    else if (data.msgType === 'audio') media = `<audio controls src="${data.url}"></audio>`;
    else if (data.msgType === 'file') media = `<a href="${data.url}" class="file-link" download>📄 ${data.fileName}</a>`;

    const html = `
        <div class="msg-row ${isSelf ? 'out' : 'in'}">
            <div class="bubble">
                <span class="sender-name">${data.user}</span>
                ${data.msgType === 'text' ? data.text : media}
            </div>
        </div>`;
    
    msgBox.insertAdjacentHTML('beforeend', html);
    msgBox.scrollTop = msgBox.scrollHeight;
}

// 5. سیستم ورودی و ضبط صدا تلگرامی
function checkInput() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('actionBtn');
    if (input.value.trim() !== '') {
        btn.innerText = '➤';
        btn.classList.add('send');
    } else {
        btn.innerText = '🎤';
        btn.classList.remove('send');
    }
}

function handleAction() {
    const btn = document.getElementById('actionBtn');
    const input = document.getElementById('msgInput');
    
    if (btn.innerText === '➤') {
        // ارسال متن
        if (input.value.trim() !== '') {
            ws.send(JSON.stringify({user: currentUser, msgType: 'text', text: input.value}));
            input.value = '';
            checkInput();
        }
    } else {
        // ضبط صدا
        toggleRecord(btn, input);
    }
}

// گوش دادن به Enter برای ارسال سریع
document.getElementById('msgInput')?.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleAction();
});

async function toggleRecord(btn, inputField) {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];
                const fd = new FormData(); 
                fd.append('file', new File([blob], "voice.webm", { type: 'audio/webm' }));
                
                // آپلود و ارسال اتوماتیک
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.url) ws.send(JSON.stringify({user: currentUser, msgType: 'audio', url: data.url}));
            };
            
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
            inputField.placeholder = "در حال ضبط... (برای توقف کلیک کنید)";
            inputField.disabled = true;
        } catch (err) {
            alert("دسترسی میکروفون رد شد یا سایت HTTPS نیست.");
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        btn.classList.remove('recording');
        inputField.placeholder = "پیام خود را بنویسید...";
        inputField.disabled = false;
    }
}

// 6. آپلود فایل
async function uploadFile() {
    const file = document.getElementById('fileInput').files[0];
    if (!file) return;
    const fd = new FormData(); 
    fd.append('file', file);
    
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    
    if (data.url) {
        ws.send(JSON.stringify({user: currentUser, msgType: data.type, url: data.url, fileName: data.name}));
    }
}

// 7. منوی همبرگری
function toggleMenu(forceClose = false) {
    const menu = document.getElementById('sideMenu');
    const overlay = document.getElementById('menuOverlay');
    if (menu.classList.contains('open') || forceClose) {
        menu.classList.remove('open');
        overlay.style.display = 'none';
    } else {
        menu.classList.add('open');
        overlay.style.display = 'block';
    }
}
