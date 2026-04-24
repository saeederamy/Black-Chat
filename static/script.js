// ==========================================
// Black Chat Logic (Global WebSocket, PWA)
// ==========================================

let currentUser = null;
let currentRole = null;
let currentRoom = null;
let ws = null;
let autoDownload = true;
let currentLang = localStorage.getItem('lang') || 'fa';

// بارگذاری بک‌گراند تنظیم شده
let savedBg = localStorage.getItem('chatBg');
if(savedBg) document.getElementById('chatArea').style.backgroundImage = `url('${savedBg}')`;

const translations = {
    'en': {
        login_title: 'System Login', btn_login: 'Authenticate', search_ph: 'Search...', type_ph: 'Message...',
        new_group: 'New Group', settings: 'Settings', logout: 'Log Out', add_contact: 'Add Contact', 
        username_ph: 'Enter Username', cancel: 'Cancel', add: 'Add', create: 'Create', language: 'Language', 
        auto_dl: 'Auto-Download', active_sessions: 'Active Sessions (IPs)', close: 'Close', chat_bg: 'Chat Background URL',
        system_channel: 'System Channel', private_chat: 'Private Chat', group: 'Public Group', channel: 'Public Channel'
    },
    'fa': {
        login_title: 'ورود به سیستم', btn_login: 'ورود / تایید', search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...',
        new_group: 'گروه / کانال جدید', settings: 'تنظیمات', logout: 'خروج از حساب', add_contact: 'افزودن مخاطب', 
        username_ph: 'آیدی دقیق را وارد کنید', cancel: 'لغو', add: 'افزودن', create: 'ساختن', language: 'زبان برنامه', 
        auto_dl: 'دانلود خودکار', active_sessions: 'نشست‌های فعال', close: 'بستن', chat_bg: 'لینک پس‌زمینه چت',
        system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه عمومی', channel: 'کانال عمومی'
    }
};

function applyLang() {
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    document.getElementById('langSelect').value = currentLang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerText = translations[currentLang][el.getAttribute('data-i18n')]; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = translations[currentLang][el.getAttribute('data-i18n-ph')]; });
}
applyLang();

function changeLang(lang) { currentLang = lang; localStorage.setItem('lang', lang); applyLang(); }
function toggleAutoDl(state) { autoDownload = state; }
function changeBg(url) { 
    if(url.trim() === '') { localStorage.removeItem('chatBg'); document.getElementById('chatArea').style.backgroundImage = 'none'; }
    else { localStorage.setItem('chatBg', url); document.getElementById('chatArea').style.backgroundImage = `url('${url}')`; }
}

async function login() {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    if (!u || !p) return;

    const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if (data.success) {
        currentUser = data.username; currentRole = data.role;
        document.getElementById('profile-name').innerText = currentUser;
        document.getElementById('profile-role').innerText = currentRole === 'admin' ? 'Admin' : 'User';
        document.getElementById('my-initial').innerText = currentUser.substring(0,2).toUpperCase();
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        
        initWebSocket();
        loadInitData();
    } else alert("اطلاعات ورود اشتباه است");
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentUser}/${currentRole}`);
    
    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') { 
            if(msg.room === currentRoom) {
                document.getElementById('messages').innerHTML = '';
                msg.data.forEach(m => appendMessage(m)); 
            }
        } 
        else if (msg.type === 'new_msg') { 
            if(msg.room === currentRoom) appendMessage(msg.data);
            else handleNotification(msg);
        }
        else if (msg.type === 'deleted') { 
            if(msg.room === currentRoom) { const el = document.getElementById(`msg-${msg.msg_id}`); if(el) el.remove(); }
        }
    };
}

async function loadInitData() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.avatar) { document.getElementById('my-avatar').src = data.avatar; document.getElementById('my-avatar').style.display='block'; document.getElementById('my-initial').style.display='none'; }

    const list = document.getElementById('chat-list');
    list.innerHTML = `<div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', '📢', 'Announcements')">
            <div class="avatar">📢</div><div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div><span class="unread-badge" id="badge-Announcements">0</span></div>`;
    
    data.custom_rooms.forEach(r => {
        let icon = r.type === 'group' ? '🌍' : '📢';
        let sub = r.type === 'group' ? translations[currentLang].group : translations[currentLang].channel;
        list.innerHTML += `<div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', '${r.type}', '${icon}', '${r.name}')">
                <div class="avatar">${icon}</div><div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview">${sub}</div></div><span class="unread-badge" id="badge-${r.id}">0</span></div>`;
    });

    data.contacts.forEach(c => {
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', '👤', '${c}')">
                <div class="avatar">👤</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    openChat('Announcements', 'channel', '📢', 'Announcements');
}

// --- Navigation & Modals ---
function toggleDrawer() {
    const d = document.getElementById('sideDrawer'); const o = document.getElementById('menuOverlay');
    if(d.classList.contains('open')) { d.classList.remove('open'); o.style.display = 'none'; }
    else { d.classList.add('open'); o.style.display = 'flex'; }
}

function openModal(id) { toggleDrawer(); document.getElementById('menuOverlay').style.display = 'flex'; document.getElementById(id).style.display = 'flex'; if(id === 'settingsModal') fetchIPs(); }
function closeModal(id) { document.getElementById(id).style.display = 'none'; closeAll(); }
function closeAll() { document.getElementById('menuOverlay').style.display = 'none'; document.getElementById('sideDrawer').classList.remove('open'); document.querySelectorAll('.modal-overlay').forEach(m => m.style.display='none'); }

function searchChat() {
    let q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(i => { i.style.display = i.querySelector('.chat-name').innerText.toLowerCase().includes(q) ? 'flex' : 'none'; });
}

// --- Actions (Groups, Contacts, IPs) ---
async function fetchIPs() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_ips', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    document.getElementById('ipList').innerHTML = data.ips.map(i => `<div style="border-bottom:1px solid #333; padding:5px 0;">🌐 ${i.ip} <br><span style="color:#666;">${i.date}</span></div>`).join('');
}

async function uploadAvatar() {
    const file = document.getElementById('avatarInput').files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file); fd.append('username', currentUser);
    const res = await fetch('/api/upload_avatar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) { document.getElementById('my-avatar').src = data.url; document.getElementById('my-avatar').style.display = 'block'; document.getElementById('my-initial').style.display = 'none'; }
}

async function submitContact() {
    const t = document.getElementById('contactUsername').value.trim(); if(!t) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'add_contact', owner: currentUser, target: t}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('contactModal'); loadInitData(); openChat(data.target, 'private', '👤', data.target); } else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); const t = document.getElementById('creationType').value; if(!n) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: t, name: n, user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('groupModal'); loadInitData(); openChat(data.room_id, t, t==='group'?'🌍':'📢', n); }
}

// --- WebSocket & Chat Functions ---
function openChat(roomId, type, icon, title) {
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active'));
    let activeItem = document.querySelector(`.chat-item[data-room="${roomId}"]`);
    if(activeItem) activeItem.classList.add('active');

    let realRoomId = roomId;
    if (type === 'private') { const users = [currentUser, roomId].sort(); realRoomId = `dm_${users[0]}_${users[1]}`; }
    currentRoom = realRoomId;

    document.getElementById('room-title').innerText = title;
    let st = type === 'channel' ? translations[currentLang].channel : (type === 'group' ? translations[currentLang].group : translations[currentLang].private_chat);
    if(roomId === 'Announcements') st = translations[currentLang].system_channel;
    document.getElementById('room-status').innerText = st;
    document.getElementById('header-avatar').innerText = icon;
    document.getElementById('messages').innerHTML = '';
    
    // پاک کردن بج نوتیفیکیشن
    let badgeId = type === 'private' ? `badge-dm_${roomId}` : `badge-${roomId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'none'; badge.innerText = '0'; }

    const inputArea = document.getElementById('input-area');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') inputArea.style.display = 'none';
    else inputArea.style.display = 'flex';

    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden');

    ws.send(JSON.stringify({action: 'get_history', room: currentRoom}));
}

function closeChat() { document.getElementById('sidebar').classList.remove('hidden'); }

function handleNotification(msg) {
    let isDM = msg.room.startsWith('dm_');
    if (isDM && !msg.room.includes(currentUser)) return;
    
    let targetId = isDM ? msg.room : msg.room; // باگ بج برای خصوصی در اینجا رفع شد
    let badge = document.getElementById(`badge-${targetId}`);
    if(badge) { badge.style.display = 'inline-block'; badge.innerText = parseInt(badge.innerText) + 1; }
    
    try { document.getElementById('notif-sound').play(); } catch(e){}
}

function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image' || data.msgType === 'video') {
        let tag = data.msgType === 'image' ? `<img src="${data.url}" loading="lazy">` : `<video controls src="${data.url}"></video>`;
        if(!autoDownload) {
            media = `<div style="position:relative; max-width:250px;" onclick="this.innerHTML='${tag}'">
                        ${data.msgType === 'image' ? `<img src="${data.url}" class="blur-media">` : `<div style="width:250px;height:150px;background:#111;border-radius:12px;border:1px solid #333;"></div>`}
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
            <div class="bubble" dir="auto">
                <span class="sender-name">${data.user}</span>
                ${data.msgType === 'text' ? data.text : media}
            </div>
            ${!isSelf ? delBtn : ''}
        </div>`;
    
    msgBox.insertAdjacentHTML('beforeend', html);
    msgBox.scrollTop = msgBox.scrollHeight;
}

function deleteMsg(id) { if(confirm("Delete message for everyone?")) ws.send(JSON.stringify({action: 'delete_msg', msg_id: id})); }

// --- Input & Recording (Voice / Video) ---
let mediaRecorder; let audioChunks = []; let isRecording = false;
let recTimerInterval; let recSeconds = 0;

function checkInput() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('actionBtn');
    const vBtn = document.getElementById('actionVideoBtn');
    
    if (input.value.trim() !== '') { 
        btn.innerHTML = '<svg class="svg-icon"><use href="#icon-send"></use></svg>'; btn.classList.add('send'); 
        vBtn.style.display = 'none';
    } else { 
        btn.innerHTML = '<svg class="svg-icon"><use href="#icon-mic"></use></svg>'; btn.classList.remove('send'); 
        vBtn.style.display = 'flex';
    }
}

function handleAction() {
    const btn = document.getElementById('actionBtn');
    const input = document.getElementById('msgInput');
    if (btn.classList.contains('send')) {
        if (input.value.trim() !== '') { ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, msgType: 'text', text: input.value})); input.value = ''; checkInput(); }
    } else { startRecord('audio', btn); }
}

document.getElementById('msgInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleAction(); });

function toggleVideoRecord() {
    const vBtn = document.getElementById('actionVideoBtn');
    startRecord('video', vBtn);
}

function updateTimer() {
    recSeconds++;
    let m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
    let s = String(recSeconds % 60).padStart(2, '0');
    document.getElementById('recTimer').innerText = `${m}:${s}`;
}

async function startRecord(type, btn) {
    if (!isRecording) {
        try {
            const constraints = type === 'video' ? { audio: true, video: { facingMode: "user" } } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const mimeType = type === 'video' ? 'video/webm' : 'audio/webm';
                const blob = new Blob(audioChunks, { type: mimeType }); audioChunks = [];
                const fd = new FormData(); fd.append('file', new File([blob], `record.${type==='video'?'webm':'webm'}`, { type: mimeType }));
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, msgType: type, url: data.url}));
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
            
            document.getElementById('msgInput').style.display = 'none';
            document.getElementById('recTimer').style.display = 'inline';
            recSeconds = 0; document.getElementById('recTimer').innerText = "00:00";
            recTimerInterval = setInterval(updateTimer, 1000);
            
            if(type === 'video') document.getElementById('actionBtn').style.display = 'none';
            else document.getElementById('actionVideoBtn').style.display = 'none';
            
        } catch (err) { alert("Camera/Microphone access denied or HTTPS required."); }
    } else {
        mediaRecorder.stop(); isRecording = false; btn.classList.remove('recording');
        clearInterval(recTimerInterval);
        document.getElementById('recTimer').style.display = 'none';
        document.getElementById('msgInput').style.display = 'block';
        document.getElementById('actionBtn').style.display = 'flex';
        document.getElementById('actionVideoBtn').style.display = 'flex';
    }
}

async function uploadFile() {
    const file = document.getElementById('fileInput').files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, msgType: data.type, url: data.url, fileName: data.name}));
}
