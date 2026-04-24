// ==========================================
// Black Chat Logic (PWA, WebSocket, I18N)
// ==========================================

let currentUser = null;
let currentRole = null;
let currentRoom = null;
let ws = null;
let autoDownload = true;
let currentLang = localStorage.getItem('lang') || 'fa';

// --- i18n Dictionary ---
const translations = {
    'en': {
        login_title: 'System Login', btn_login: 'Authenticate',
        search_ph: 'Search...', type_ph: 'Write a message...',
        new_group: 'New Group', new_channel: 'New Channel', settings: 'Settings', logout: 'Log Out',
        add_contact: 'Add Contact', username_ph: 'Enter exact username', cancel: 'Cancel', add: 'Add',
        create: 'Create', language: 'Language', auto_dl: 'Auto-Download Media', active_sessions: 'Active Sessions (IPs)', close: 'Close',
        system_channel: 'System Channel', private_chat: 'Private Chat', group: 'Public Group', channel: 'Public Channel'
    },
    'fa': {
        login_title: 'ورود به سیستم', btn_login: 'ورود / تایید',
        search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...',
        new_group: 'گروه جدید', new_channel: 'کانال جدید', settings: 'تنظیمات', logout: 'خروج از حساب',
        add_contact: 'افزودن مخاطب', username_ph: 'آیدی دقیق کاربر را وارد کنید', cancel: 'لغو', add: 'افزودن',
        create: 'ساختن', language: 'زبان برنامه', auto_dl: 'دانلود خودکار فایل‌ها', active_sessions: 'نشست‌های فعال (آی‌پی‌ها)', close: 'بستن',
        system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه عمومی', channel: 'کانال عمومی'
    }
};

function applyLang() {
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    document.getElementById('langSelect').value = currentLang;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.innerText = translations[currentLang][el.getAttribute('data-i18n')];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.placeholder = translations[currentLang][el.getAttribute('data-i18n-ph')];
    });
}
applyLang();

function changeLang(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    applyLang();
}

function toggleAutoDl(state) { autoDownload = state; }

// --- Login & Init ---
async function login() {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    if (!u || !p) return;

    const res = await fetch('/api/login', {
        method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'}
    });
    const data = await res.json();
    if (data.success) {
        currentUser = data.username; currentRole = data.role;
        document.getElementById('profile-name').innerText = currentUser;
        document.getElementById('profile-role').innerText = currentRole === 'admin' ? 'Admin' : 'User';
        document.getElementById('my-initial').innerText = currentUser.substring(0,2).toUpperCase();
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        
        loadInitData();
    } else { alert("رمز عبور یا آیدی اشتباه است / Invalid credentials"); }
}

async function loadInitData() {
    const res = await fetch('/api/action', {
        method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'}
    });
    const data = await res.json();
    
    if(data.avatar) {
        document.getElementById('my-avatar').src = data.avatar;
        document.getElementById('my-avatar').style.display = 'block';
        document.getElementById('my-initial').style.display = 'none';
    }

    const list = document.getElementById('chat-list');
    list.innerHTML = `
        <div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', '📢', 'Announcements')">
            <div class="avatar">📢</div>
            <div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div>
        </div>`;
    
    data.custom_rooms.forEach(r => {
        let icon = r.type === 'group' ? '🌍' : '📢';
        let sub = r.type === 'group' ? translations[currentLang].group : translations[currentLang].channel;
        list.innerHTML += `
            <div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', '${r.type}', '${icon}', '${r.name}')">
                <div class="avatar">${icon}</div>
                <div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview">${sub}</div></div>
            </div>`;
    });

    data.contacts.forEach(c => {
        list.innerHTML += `
            <div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', '👤', '${c}')">
                <div class="avatar">👤</div>
                <div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div>
            </div>`;
    });
    
    openChat('Announcements', 'channel', '📢', 'Announcements');
}

// --- Navigation & UI ---
function toggleDrawer() {
    const d = document.getElementById('sideDrawer');
    const o = document.getElementById('menuOverlay');
    if(d.classList.contains('open')) { d.classList.remove('open'); o.style.display = 'none'; }
    else { d.classList.add('open'); o.style.display = 'flex'; }
}

function openModal(id) {
    toggleDrawer(); document.getElementById('menuOverlay').style.display = 'flex';
    document.getElementById(id).style.display = 'flex';
    
    if(id === 'channelModal') { document.getElementById('groupModal').style.display = 'flex'; document.getElementById('creationType').value = 'channel'; document.getElementById('creation-title').innerText = translations[currentLang].new_channel; document.getElementById('channelModal').style.display='none';}
    if(id === 'settingsModal') fetchIPs();
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; closeAll(); }
function closeAll() {
    document.getElementById('menuOverlay').style.display = 'none';
    document.getElementById('sideDrawer').classList.remove('open');
    document.querySelectorAll('.modal-overlay').forEach(m => { if(m.id !== 'menuOverlay') m.style.display = 'none'; });
}

function searchChat() {
    let q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        let name = item.querySelector('.chat-name').innerText.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// --- Actions (Groups, Contacts, Avatar, IPs) ---
async function fetchIPs() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_ips', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    let h = '';
    data.ips.forEach(i => { h += `<div style="border-bottom:1px solid #333; padding:5px 0;">🌐 ${i.ip} <br><span style="color:#666;">${i.date}</span></div>`; });
    document.getElementById('ipList').innerHTML = h;
}

async function uploadAvatar() {
    const file = document.getElementById('avatarInput').files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('username', currentUser);
    const res = await fetch('/api/upload_avatar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) { document.getElementById('my-avatar').src = data.url; document.getElementById('my-avatar').style.display = 'block'; document.getElementById('my-initial').style.display = 'none'; }
}

async function submitContact() {
    const t = document.getElementById('contactUsername').value.trim();
    if(!t) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'add_contact', owner: currentUser, target: t}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('contactModal'); loadInitData(); openChat(data.target, 'private', '👤', data.target); }
    else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim();
    const t = document.getElementById('creationType').value;
    if(!n) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: t, name: n, user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('groupModal'); loadInitData(); openChat(data.room_id, t, t==='group'?'🌍':'📢', n); }
}

// --- WebSocket & Chat ---
function openChat(roomId, type, icon, title) {
    if (ws) ws.close();
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active'));
    let activeItem = document.querySelector(`.chat-item[data-room="${roomId}"]`);
    if(activeItem) activeItem.classList.add('active');

    let realRoomId = roomId;
    if (type === 'private') {
        const users = [currentUser, roomId].sort();
        realRoomId = `dm_${users[0]}_${users[1]}`;
    }
    currentRoom = realRoomId;

    document.getElementById('room-title').innerText = title;
    let st = type === 'channel' ? translations[currentLang].channel : (type === 'group' ? translations[currentLang].group : translations[currentLang].private_chat);
    if(roomId === 'Announcements') st = translations[currentLang].system_channel;
    document.getElementById('room-status').innerText = st;
    document.getElementById('header-avatar').innerText = icon;
    document.getElementById('messages').innerHTML = '';

    const inputArea = document.getElementById('input-area');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') {
        inputArea.style.display = 'none'; // فقط ادمین میتواند در کانال پیام دهد
    } else {
        inputArea.style.display = 'flex';
    }

    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentRoom}/${currentUser}/${currentRole}`);
    
    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') { msg.data.forEach(m => appendMessage(m)); } 
        else if (msg.type === 'message') { appendMessage(msg.data); }
        else if (msg.type === 'deleted') { 
            const el = document.getElementById(`msg-${msg.msg_id}`);
            if(el) el.remove();
        }
    };
}

function closeChat() { document.getElementById('sidebar').classList.remove('hidden'); }

function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image' || data.msgType === 'video') {
        let tag = data.msgType === 'image' ? `<img src="${data.url}">` : `<video controls src="${data.url}"></video>`;
        if(!autoDownload) {
            media = `<div style="position:relative;" onclick="this.innerHTML='${tag}'">
                        ${data.msgType === 'image' ? `<img src="${data.url}" class="blur-media">` : `<div style="width:200px;height:150px;background:#111;border-radius:12px;"></div>`}
                        <div class="dl-overlay"><svg class="svg-icon"><use href="#icon-dl"></use></svg></div>
                     </div>`;
        } else media = tag;
    }
    else if (data.msgType === 'audio') media = `<audio controls src="${data.url}"></audio>`;
    else if (data.msgType === 'file') media = `<a href="${data.url}" class="file-link" download><div class="file-icon"><svg class="svg-icon" style="width:20px;height:20px;"><use href="#icon-doc"></use></svg></div> <div style="overflow:hidden; text-overflow:ellipsis;">${data.fileName}</div></a>`;

    let delBtn = (isSelf || currentRole === 'admin') ? `<button class="delete-msg-btn" onclick="deleteMsg('${data.id}')"><svg class="svg-icon" style="width:16px;height:16px;"><use href="#icon-trash"></use></svg></button>` : '';

    const html = `
        <div class="msg-row ${isSelf ? 'out' : 'in'}" id="msg-${data.id}">
            ${isSelf ? delBtn : ''}
            <div class="bubble">
                <span class="sender-name">${data.user}</span>
                ${data.msgType === 'text' ? data.text : media}
            </div>
            ${!isSelf ? delBtn : ''}
        </div>`;
    
    msgBox.insertAdjacentHTML('beforeend', html);
    msgBox.scrollTop = msgBox.scrollHeight;
}

function deleteMsg(id) {
    if(confirm("Delete message for everyone?")) ws.send(JSON.stringify({action: 'delete', msg_id: id}));
}

// --- Voice & Inputs ---
let mediaRecorder; let audioChunks = []; let isRecording = false;

function checkInput() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('actionBtn');
    if (input.value.trim() !== '') { btn.innerHTML = '<svg class="svg-icon"><use href="#icon-send"></use></svg>'; btn.classList.add('send'); } 
    else { btn.innerHTML = '<svg class="svg-icon"><use href="#icon-mic"></use></svg>'; btn.classList.remove('send'); }
}

function handleAction() {
    const btn = document.getElementById('actionBtn');
    const input = document.getElementById('msgInput');
    if (btn.classList.contains('send')) {
        if (input.value.trim() !== '') { ws.send(JSON.stringify({user: currentUser, msgType: 'text', text: input.value})); input.value = ''; checkInput(); }
    } else { toggleRecord(btn, input); }
}

document.getElementById('msgInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleAction(); });

async function toggleRecord(btn, inputField) {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = [];
                const fd = new FormData(); fd.append('file', new File([blob], "voice.webm", { type: 'audio/webm' }));
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.url) ws.send(JSON.stringify({user: currentUser, msgType: 'audio', url: data.url}));
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
            inputField.placeholder = "Recording... Click to stop"; inputField.disabled = true;
        } catch (err) { alert("Microphone access denied / HTTPS required."); }
    } else {
        mediaRecorder.stop(); isRecording = false; btn.classList.remove('recording');
        inputField.placeholder = translations[currentLang].type_ph; inputField.disabled = false;
    }
}

async function uploadFile() {
    const file = document.getElementById('fileInput').files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) ws.send(JSON.stringify({user: currentUser, msgType: data.type, url: data.url, fileName: data.name}));
}
