let currentUser = null;
let currentRole = null;
let currentRoom = null;
let targetUserForDM = null; 
let ws = null;
let autoDownload = true;
let currentLang = localStorage.getItem('lang') || 'fa';

// اعمال بک‌گراند
let savedBg = localStorage.getItem('chatBg');
if(savedBg) document.getElementById('chatArea').style.backgroundImage = `url('${savedBg}')`;

const translations = {
    'en': {
        login_title: 'System Login', btn_login: 'Login', search_ph: 'Search...', type_ph: 'Message...',
        settings: 'Settings', add_contact: 'New Chat', username_ph: 'Enter exact username', 
        language: 'Language', auto_dl: 'Auto-Download', active_sessions: 'Active IPs', chat_bg: 'Chat Wallpaper URL',
        system_channel: 'System Channel', private_chat: 'Private Chat', group: 'Group', channel: 'Channel'
    },
    'fa': {
        login_title: 'ورود به سیستم', btn_login: 'ورود / تایید', search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...',
        settings: 'تنظیمات سیستم', add_contact: 'چت خصوصی جدید', username_ph: 'آیدی دقیق را وارد کنید', 
        language: 'زبان برنامه', auto_dl: 'دانلود خودکار', active_sessions: 'آی‌پی‌های متصل شما', chat_bg: 'پس‌زمینه چت (لینک عکس)',
        system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه عمومی', channel: 'کانال عمومی'
    }
};

function applyLang() {
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    let langSel = document.getElementById('langSelect');
    if(langSel) langSel.value = currentLang;
    
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

    try {
        const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'} });
        const data = await res.json();
        if (data.success) {
            currentUser = data.username; 
            currentRole = data.role;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            
            initWebSocket();
            loadInitData();
        } else {
            alert("اطلاعات ورود اشتباه است / Invalid Login");
        }
    } catch(e) {
        alert("خطا در اتصال به سرور / Server Connection Error");
    }
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
    ws.onclose = () => { setTimeout(initWebSocket, 3000); };
}

async function loadInitData() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();

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
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', '👤', '${c}', '${c}')">
                <div class="avatar">👤</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    
    openChat('Announcements', 'channel', '📢', 'Announcements');
}

function openModal(id) { 
    let m = document.getElementById(id);
    if(m) { m.style.display = 'flex'; }
    if(id === 'settingsModal') fetchIPs(); 
}
function closeModal(id) { 
    let m = document.getElementById(id);
    if(m) m.style.display = 'none'; 
}

function searchChat() {
    let q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(i => { i.style.display = i.querySelector('.chat-name').innerText.toLowerCase().includes(q) ? 'flex' : 'none'; });
}

async function fetchIPs() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_ips', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    document.getElementById('ipList').innerHTML = data.ips.map(i => `<div style="border-bottom:1px solid var(--border); padding:5px 0;">🌐 ${i.ip} <br><span style="color:var(--c-gray);">${i.date}</span></div>`).join('');
}

async function submitContact() {
    const t = document.getElementById('contactUsername').value.trim(); if(!t) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'add_contact', owner: currentUser, target: t}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { 
        closeModal('contactModal'); 
        loadInitData(); 
        openChat(data.target, 'private', '👤', data.target, data.target); 
    } else {
        alert(data.msg);
    }
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); 
    const t = document.getElementById('creationType').value; 
    if(!n) return;
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: t, name: n, user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { 
        closeModal('contactModal'); 
        loadInitData(); 
        openChat(data.room_id, t, t==='group'?'🌍':'📢', n); 
    }
}

function openChat(roomId, type, icon, title, targetUser = null) {
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active'));
    let activeItem = document.querySelector(`.chat-item[data-room="${roomId}"]`);
    if(activeItem) activeItem.classList.add('active');

    targetUserForDM = targetUser; 
    
    let realRoomId = roomId;
    if (type === 'private') { 
        const users = [currentUser, roomId].sort(); 
        realRoomId = `dm_${users.join('-')}`; 
    }
    currentRoom = realRoomId;

    document.getElementById('room-title').innerText = title;
    let st = type === 'channel' ? translations[currentLang].channel : (type === 'group' ? translations[currentLang].group : translations[currentLang].private_chat);
    if(roomId === 'Announcements') st = translations[currentLang].system_channel;
    document.getElementById('room-status').innerText = st;
    document.getElementById('header-avatar').innerText = icon;
    document.getElementById('messages').innerHTML = '';
    
    let badgeId = type === 'private' ? `badge-dm_${roomId}` : `badge-${roomId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'none'; badge.innerText = '0'; }

    const inputArea = document.getElementById('input-area');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') inputArea.style.display = 'none';
    else inputArea.style.display = 'flex';

    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden');

    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: 'get_history', room: currentRoom}));
    }
}

function closeChat() { document.getElementById('sidebar').classList.remove('hidden'); }

function handleNotification(msg) {
    let isDM = msg.room.startsWith('dm_');
    if (isDM && !msg.room.includes(currentUser)) return;
    
    if (isDM && !document.querySelector(`.chat-item[data-room="${msg.data.user}"]`)) {
        loadInitData(); 
    }

    let targetId = isDM ? msg.data.user : msg.room;
    let badge = document.getElementById(`badge-${isDM ? 'dm_'+targetId : targetId}`);
    if(badge) { badge.style.display = 'inline-block'; badge.innerText = parseInt(badge.innerText) + 1; }
    
    try { document.getElementById('notif-sound').play(); } catch(e){}
}

function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image' || data.msgType === 'video') {
        let tag = data.msgType === 'image' ? `<img src="${data.url}">` : `<video controls src="${data.url}"></video>`;
        if(!autoDownload && data.msgType === 'image') {
            media = `<div style="position:relative;" onclick="this.innerHTML='${tag}'"><img src="${data.url}" style="filter:blur(10px);"></div>`;
        } else media = tag;
    }
    else if (data.msgType === 'audio') media = `<audio controls src="${data.url}"></audio>`;
    else if (data.msgType === 'file') media = `<a href="${data.url}" class="file-link" download><div class="file-icon">📄</div> <div style="overflow:hidden; text-overflow:ellipsis;">${data.fileName}</div></a>`;

    let delBtn = (isSelf || currentRole === 'admin') ? `<button class="delete-btn" onclick="deleteMsg('${data.id}')">🗑</button>` : '';

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

function deleteMsg(id) { if(confirm("آیا از حذف پیام مطمئن هستید؟")) ws.send(JSON.stringify({action: 'delete_msg', msg_id: id})); }

// --- Inputs & Recording ---
let mediaRecorder; let audioChunks = []; let isRecording = false;
let recTimerInterval; let recSeconds = 0;

function checkInput() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('actionBtn');
    const vBtn = document.getElementById('actionVideoBtn');
    
    if (input.value.trim() !== '') { 
        btn.innerText = '➤'; btn.classList.add('send'); 
        vBtn.style.display = 'none';
    } else { 
        btn.innerText = '🎤'; btn.classList.remove('send'); 
        vBtn.style.display = 'flex';
    }
}

function handleAction() {
    const btn = document.getElementById('actionBtn');
    const input = document.getElementById('msgInput');
    if (btn.classList.contains('send')) {
        if (input.value.trim() !== '') { 
            ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: 'text', text: input.value})); 
            input.value = ''; checkInput(); 
        }
    } else { startRecord('audio', btn); }
}

document.getElementById('msgInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleAction(); });

function updateTimer() {
    recSeconds++;
    let m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
    let s = String(recSeconds % 60).padStart(2, '0');
    document.getElementById('recTimer').innerText = `${m}:${s}`;
}

async function startRecord(type, btn) {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(type === 'video' ? { audio: true, video: true } : { audio: true });
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const mime = type === 'video' ? 'video/webm' : 'audio/webm';
                const fd = new FormData(); fd.append('file', new File([new Blob(audioChunks, { type: mime })], `rec.${type==='video'?'webm':'webm'}`, { type: mime }));
                audioChunks = [];
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: type, url: data.url}));
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('rec');
            
            document.getElementById('msgInput').style.display = 'none';
            document.getElementById('recTimer').style.display = 'inline';
            recSeconds = 0; document.getElementById('recTimer').innerText = "00:00";
            recTimerInterval = setInterval(updateTimer, 1000);
            
            if(type === 'video') document.getElementById('actionBtn').style.display = 'none';
            else document.getElementById('actionVideoBtn').style.display = 'none';
            
        } catch (err) { alert("لطفا دسترسی دوربین/میکروفون را تایید کنید"); }
    } else {
        mediaRecorder.stop(); isRecording = false; btn.classList.remove('rec');
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
    if (data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: data.type, url: data.url, fileName: data.name}));
}
