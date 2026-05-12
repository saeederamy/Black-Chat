// SERVER_CONFIG removed: TURN/STUN settings are now fetched from /api/turn-config

let currentUser = null; let currentRole = null; let currentRoom = null; let targetUserForDM = null; 
let currentToken = localStorage.getItem('bc_token') || null;
let myQuotaMB = 0; let myUsedBytes = 0;
let ws = null; let currentLang = localStorage.getItem('lang') || 'fa'; let myContacts = [];
let contextMsgId = null; let contextMsgText = null; let contextMsgSender = null;
let replyToMsg = null; let selectionMode = false; let selectedMsgs = [];
let editMsgId = null; 
let autoDownload = true; 
let lastDateStr = null; 
let onlineUsers = [];

// ---- API helper that always sends Authorization header ----
async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (currentToken) options.headers['Authorization'] = 'Bearer ' + currentToken;
    return fetch(url, options);
}
async function apiJson(url, body) {
    const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    return res;
}
function fmtBytes(n) {
    if (!n || n < 1024) return (n||0) + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    if (n < 1024*1024*1024) return (n/(1024*1024)).toFixed(1) + ' MB';
    return (n/(1024*1024*1024)).toFixed(2) + ' GB';
}

let savedTheme = localStorage.getItem('hub_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
function toggleTheme() { savedTheme = savedTheme === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', savedTheme); localStorage.setItem('hub_theme', savedTheme); }

let savedBg = localStorage.getItem('chatBg');
if(savedBg) document.getElementById('chatArea').style.backgroundImage = `url('${savedBg}')`;

const translations = {
    'en': { login_title: 'Secure Login', btn_login: 'Access Hub', search_ph: 'Search...', type_ph: 'Type a message...', settings: 'Settings', add_contact: 'New Chat / Group', username_ph: 'Enter Exact Username', language: 'Language', active_sessions: 'Active Sessions', chat_bg: 'Chat Wallpaper URL', system_channel: 'System Announcements', private_chat: 'Private Chat', group: 'Private Group' },
    'fa': { login_title: 'ورود به سیستم', btn_login: 'ورود / تایید', search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...', settings: 'تنظیمات سیستم', add_contact: 'چت یا گروه جدید', username_ph: 'آیدی دقیق را وارد کنید', language: 'زبان برنامه', active_sessions: 'آی‌پی‌های متصل شما', chat_bg: 'پس‌زمینه چت (لینک عکس)', system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه خصوصی' }
};

function applyLang() {
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    let langSel = document.getElementById('langSelect'); if(langSel) langSel.value = currentLang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerText = translations[currentLang][el.getAttribute('data-i18n')]; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = translations[currentLang][el.getAttribute('data-i18n-ph')]; });
}
applyLang();
function changeLang(lang) { currentLang = lang; localStorage.setItem('lang', lang); applyLang(); }
function toggleAutoDl(state) { autoDownload = state; }
function changeBg(url) { if(url.trim() === '') { localStorage.removeItem('chatBg'); document.getElementById('chatArea').style.backgroundImage = 'none'; } else { localStorage.setItem('chatBg', url); document.getElementById('chatArea').style.backgroundImage = `url('${url}')`; } }

// === PHASE 2: Service Worker Registration (must run early for mobile push) ===
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.register('/static/service-worker.js', { scope: '/' });
        return reg;
    } catch (e) {
        console.warn('SW registration failed:', e);
        return null;
    }
}
// Kick off registration immediately so it's ready by the time we need to show a notification
registerServiceWorker();

function requestNotificationAccess() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        // Must be inside a user gesture; called from login button onclick & openChat
        Notification.requestPermission().catch(() => {});
    }
}

async function showSystemNotification(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
        const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
        const opts = {
            body: body,
            icon: '/static/icon-192.png',
            badge: '/static/icon-192.png',
            tag: tag || ('bc-' + Date.now()),
            renotify: true,
            silent: false,
            vibrate: [120, 60, 120],
        };
        if (reg && reg.showNotification) {
            await reg.showNotification(title, opts);
        } else {
            // Fallback for desktop
            new Notification(title, opts);
        }
    } catch (e) { console.warn('Notification error:', e); }
}

window.onload = () => {
    const s_usr = localStorage.getItem('bc_user');
    const s_role = localStorage.getItem('bc_role');
    const s_tok = localStorage.getItem('bc_token');
    if (s_usr && s_role && s_tok) {
        currentUser = s_usr; currentRole = s_role; currentToken = s_tok;
        document.getElementById('login-wrapper').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        initWebSocket(); loadInitData();
    }
};

function doLogout() {
    apiFetch('/api/logout', {method:'POST'}).catch(()=>{});
    localStorage.removeItem('bc_user'); localStorage.removeItem('bc_role'); localStorage.removeItem('bc_token');
    location.reload();
}

async function login() {
    const u = document.getElementById('username').value.trim(); const p = document.getElementById('password').value.trim();
    if (!u || !p) return;

    // IMPORTANT: must be inside the click gesture, BEFORE any await
    requestNotificationAccess();

    try {
        const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'} });
        if (!res.ok) {
            const errTxt = await res.text();
            alert("Server Error: " + res.status + "\n" + errTxt);
            return;
        }
        const data = await res.json();
        if (data.success) {
            currentUser = data.username; currentRole = data.role; currentToken = data.token;
            myQuotaMB = data.quota_mb || 0; myUsedBytes = data.used_bytes || 0;
            localStorage.setItem('bc_user', currentUser);
            localStorage.setItem('bc_role', currentRole);
            localStorage.setItem('bc_token', currentToken);

            document.getElementById('login-wrapper').style.display = 'none'; 
            document.getElementById('app').style.display = 'flex';
            initWebSocket(); loadInitData();
        } else alert("Invalid Credentials!");
    } catch(e) { alert("Connection Error:\n" + e.message); }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentUser}/${currentRole}/${currentToken}`);
    ws.onopen = () => { if (currentRoom) ws.send(JSON.stringify({action: 'get_history', room: currentRoom})); };
    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') { 
            if(msg.room === currentRoom) { 
                document.getElementById('messages').innerHTML = ''; 
                lastDateStr = null; 
                msg.data.forEach(m => appendMessage(m)); 
            }
        } 
        else if (msg.type === 'new_msg') { 
            if(msg.room === currentRoom) appendMessage(msg.data); else handleNotification(msg);
        }
        else if (msg.type === 'deleted') { 
            const el = document.getElementById(`msg-${msg.msg_id}`); if(el) el.remove(); 
            selectedMsgs = selectedMsgs.filter(id => id !== msg.msg_id); updateSelectionUI();
        }
        else if (msg.type === 'edited') {
            if(msg.room === currentRoom) {
                const el = document.getElementById(`msg-${msg.msg_id}`);
                if(el) {
                    const txtNode = el.querySelector('.msg-text-content');
                    if(txtNode) {
                        txtNode.innerText = msg.new_text;
                        if(!txtNode.innerHTML.includes('edited-tag')) txtNode.innerHTML += ' <span class="edited-tag">(edited)</span>';
                    }
                }
            }
        }
        else if (msg.type === 'reaction_updated') { if(msg.room === currentRoom) updateReactionUI(msg.msg_id, msg.reactions); }
        else if (msg.type === 'webrtc') { handleWebRTC(msg.data); }
        else if (msg.type === 'presence') { onlineUsers = msg.online || []; }
        else if (msg.type === 'pong') { /* keepalive */ }
    };
    ws.onclose = (ev) => {
        // 4401 = invalid token
        if (ev.code === 4401) {
            localStorage.removeItem('bc_token'); localStorage.removeItem('bc_user'); localStorage.removeItem('bc_role');
            location.reload();
            return;
        }
        setTimeout(initWebSocket, 2000);
    };
    setInterval(() => { if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({action: 'ping'})); }, 15000);
}

let userAvatars = {};

async function loadInitData() {
    const res = await apiJson('/api/action', {action: 'get_init_data', user: currentUser});
    const data = await res.json();
    myContacts = data.contacts; 
    if(data.all_avatars) userAvatars = data.all_avatars;
    if(data.quota_mb) myQuotaMB = data.quota_mb;
    if(data.used_bytes != null) myUsedBytes = data.used_bytes;
    
    if(data.avatar) { document.getElementById('my-avatar').src = data.avatar; document.getElementById('my-avatar').style.display='block'; document.getElementById('my-initial').style.display='none'; }

    const list = document.getElementById('chat-list');
    
    list.innerHTML = `<div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', 'Announcements')">
            <div class="avatar" style="background:var(--c-red); color:white; border:none; box-shadow:0 0 15px var(--c-red-glow);">📢</div><div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div><span class="unread-badge" id="badge-Announcements">0</span></div>`;
    
    data.custom_rooms.forEach(r => {
        let sub = translations[currentLang].group;
        let safeName = r.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        list.innerHTML += `<div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', 'group', '${safeName}')">
                <div class="avatar" style="background:var(--c-blue); color:white; border:none; box-shadow:0 0 15px var(--c-blue-glow);">👥</div><div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview">${sub}</div></div><span class="unread-badge" id="badge-${r.id}">0</span></div>`;
    });

    data.contacts.forEach(c => {
        let avHTML = userAvatars[c] ? `<img src="${userAvatars[c]}">` : '👤';
        let safeC = c.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${safeC}', 'private', '${safeC}', '${safeC}')">
                <div class="avatar">${avHTML}</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    
    if(!currentRoom) openChat('Announcements', 'channel', 'Announcements');
}

function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    if (id === 'settingsModal') {
        // Show admin entry button only for admin
        const adminRow = document.getElementById('admin-entry-row');
        if (adminRow) adminRow.style.display = (currentRole === 'admin') ? 'block' : 'none';
        // Sync the Enter-to-send checkbox
        const ets = document.getElementById('enterSendToggle');
        if (ets) ets.checked = getEnterToSend();
        // Refresh quota and active sessions
        refreshMyQuota();
        if (typeof fetchIPs === 'function') fetchIPs();
    }
}

async function refreshMyQuota() {
    try {
        const res = await apiFetch('/api/quota');
        if (!res.ok) return;
        const d = await res.json();
        myQuotaMB = d.quota_mb; myUsedBytes = d.used_bytes;
        const txt = document.getElementById('my-storage-info');
        const bar = document.getElementById('my-storage-bar');
        if (txt) txt.innerText = `${d.used_mb} MB / ${d.quota_mb} MB used  ·  ${d.remaining_mb} MB free`;
        if (bar) {
            const pct = d.quota_mb > 0 ? Math.min(100, (d.used_bytes / (d.quota_mb*1024*1024) * 100)) : 0;
            bar.style.width = pct + '%';
            bar.style.background = pct > 90 ? 'var(--c-red)' : 'var(--c-blue)';
        }
    } catch(e) {}
}
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeContextMenu() { document.getElementById('msgContextMenu').style.display = 'none'; }

function openCreateModal() {
    let html = '';
    myContacts.forEach(c => { 
        html += `<label class="contact-check"><input type="checkbox" value="${c}"> <span>${c}</span></label>`; 
    });
    document.getElementById('groupMembersList').innerHTML = html || '<p style="font-size:13px; color:var(--c-gray); text-align:center; padding:15px;">Contact list is empty.</p>';
    switchCreateTab('private');
    openModal('createModal');
}

function switchCreateTab(tab) {
    if(tab === 'private') {
        document.getElementById('tab-private').style.color = 'var(--c-blue)'; document.getElementById('tab-private').style.borderBottomColor = 'var(--c-blue)';
        document.getElementById('tab-group').style.color = 'var(--c-gray)'; document.getElementById('tab-group').style.borderBottomColor = 'transparent';
        document.getElementById('content-private').style.display = 'block'; document.getElementById('content-group').style.display = 'none';
    } else {
        document.getElementById('tab-group').style.color = 'var(--c-blue)'; document.getElementById('tab-group').style.borderBottomColor = 'var(--c-blue)';
        document.getElementById('tab-private').style.color = 'var(--c-gray)'; document.getElementById('tab-private').style.borderBottomColor = 'transparent';
        document.getElementById('content-group').style.display = 'block'; document.getElementById('content-private').style.display = 'none';
    }
}

function searchChat() {
    let q = document.getElementById('sidebarSearchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(i => { i.style.display = i.querySelector('.chat-name').innerText.toLowerCase().includes(q) ? 'flex' : 'none'; });
}

async function fetchIPs() {
    const res = await apiJson('/api/action', {action: 'get_ips', user: currentUser});
    const data = await res.json();
    document.getElementById('ipList').innerHTML = data.ips.map(i => `<div style="border-bottom:1px solid var(--border); padding:8px 0;">🌐 ${i.ip} <br><span style="color:var(--c-gray); font-size:11px;">${i.date}</span></div>`).join('');
}

async function uploadAvatar() {
    const file = document.getElementById('avatarInput').files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await apiFetch('/api/upload_avatar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) { document.getElementById('my-avatar').src = data.url; document.getElementById('my-avatar').style.display = 'block'; document.getElementById('my-initial').style.display = 'none'; }
}

async function submitContact() {
    const t = document.getElementById('contactUsername').value.trim(); if(!t) return;
    const res = await apiJson('/api/action', {action:'add_contact', owner: currentUser, target: t});
    const data = await res.json();
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.target, 'private', data.target, data.target); } else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); const t = document.getElementById('creationType').value || 'group'; if(!n) return;
    let members = []; document.querySelectorAll('#groupMembersList input:checked').forEach(chk => members.push(chk.value));
    const res = await apiJson('/api/action', {action:'create_room', type: t, name: n, user: currentUser, members: members});
    const data = await res.json();
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.room_id, t, n); }
}

function openChat(roomId, type, title, targetUser = null) {
    requestNotificationAccess(); 
    
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active'));
    let activeItem = document.querySelector(`.chat-item[data-room="${roomId}"]`);
    if(activeItem) activeItem.classList.add('active');

    targetUserForDM = targetUser; cancelSelection(); cancelReply(); editMsgId = null; lastDateStr = null;
    let realRoomId = roomId;
    if (type === 'private') { const users = [currentUser, roomId].sort(); realRoomId = `dm_${users.join('-')}`; }
    currentRoom = realRoomId;

    document.getElementById('room-title').innerText = title;
    let st = type === 'channel' ? translations[currentLang].system_channel : (type === 'group' ? translations[currentLang].group : translations[currentLang].private_chat);
    if(roomId === 'Announcements') st = translations[currentLang].system_channel;
    document.getElementById('room-status').innerText = st;
    
    let headerAv = '📢';
    if (type === 'group') headerAv = '👥';
    if (type === 'private') headerAv = (targetUser && userAvatars[targetUser]) ? `<img src="${userAvatars[targetUser]}" style="width:100%;height:100%;object-fit:cover;">` : '👤';
    
    document.getElementById('header-avatar').innerHTML = headerAv;
    document.getElementById('header-avatar').style.boxShadow = type === 'channel' ? '0 0 15px var(--c-red-glow)' : '0 0 15px var(--c-blue-glow)';
    if(type === 'private' && targetUser && userAvatars[targetUser]) document.getElementById('header-avatar').style.border = 'none';

    document.getElementById('messages').innerHTML = '';
    
    let badgeId = type === 'private' ? `badge-dm_${roomId}` : `badge-${roomId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'none'; badge.innerText = '0'; }

    const inputArea = document.getElementById('input-container');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') inputArea.style.display = 'none';
    else inputArea.style.display = 'flex';
    
    if(type === 'private') {
        document.getElementById('callBtn').style.display = 'flex';
        const vBtn = document.getElementById('videoCallBtn');
        if (vBtn) vBtn.style.display = 'flex';
        const gBtn = document.getElementById('groupSettingsBtn');
        if (gBtn) gBtn.style.display = 'none';
    } else {
        document.getElementById('callBtn').style.display = 'none';
        const vBtn = document.getElementById('videoCallBtn');
        if (vBtn) vBtn.style.display = 'none';
        const gBtn = document.getElementById('groupSettingsBtn');
        // Show group settings only for custom rooms (rm_)
        if (gBtn) gBtn.style.display = (typeof roomId === 'string' && roomId.startsWith('rm_')) ? 'flex' : 'none';
    }

    // Hide search bar when switching chats
    const sb = document.getElementById('searchBar');
    const sr = document.getElementById('searchResults');
    if (sb) sb.style.display = 'none';
    if (sr) sr.style.display = 'none';

    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden');
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({action: 'get_history', room: currentRoom}));
}

function closeChat() { document.getElementById('sidebar').classList.remove('hidden'); }

function openProfile() {
    if(!currentRoom) return;
    document.getElementById('prof-avatar').innerHTML = document.getElementById('header-avatar').innerHTML;
    document.getElementById('prof-name').innerText = document.getElementById('room-title').innerText;
    
    let mediaH = '', filesH = '', audioH = '', linksH = '';
    document.querySelectorAll('.bubble').forEach(b => {
        let msgId = b.parentElement.id; 
        let img = b.querySelector('img'); let vid = b.querySelector('video');
        if(img) mediaH += `<img src="${img.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="width:30%; height:80px; object-fit:cover; border-radius:12px; border:1px solid var(--border); cursor:pointer; transition:0.3s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">`;
        if(vid && !vid.classList.contains('video-msg')) mediaH += `<video src="${vid.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="width:30%; height:80px; object-fit:cover; border-radius:12px; border:1px solid var(--border); cursor:pointer;"></video>`;
        
        let aud = b.querySelector('audio'); 
        let vidMsg = b.querySelector('.video-msg');
        
        if(aud) audioH += `<div style="background:var(--bg-input); padding:10px; border-radius:16px; display:flex; align-items:center; gap:12px; width:100%; border:1px solid var(--border);"><div onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="background:var(--c-blue); width:44px; height:44px; border-radius:50%; display:flex; justify-content:center; align-items:center; color:white; flex-shrink:0; cursor:pointer; box-shadow:0 0 10px var(--c-blue-glow);">🎵</div><audio controls src="${aud.src}" style="height:35px; width:100%; outline:none;"></audio></div>`;
        if(vidMsg) audioH += `<video src="${vidMsg.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" controls style="width:100px; height:100px; border-radius:50%; object-fit:cover; margin-bottom:8px; border:3px solid var(--c-blue); cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.3);"></video>`; 

        let link = b.querySelector('.file-link');
        if(link) filesH += `<a href="${link.href}" class="file-link" download>${link.innerHTML}</a>`;
        
        let txt = b.querySelector('.msg-text-content');
        if(txt) {
            let urls = txt.innerText.match(/https?:\/\/[^\s]+/g);
            if(urls) urls.forEach(u => linksH += `<a href="${u}" target="_blank" style="color:var(--c-blue); padding:12px; border-bottom:1px solid var(--border); display:block; border-radius:12px; background:var(--bg-input); margin-bottom:6px; transition:0.3s;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--bg-input)'">${u}</a>`);
        }
    });
    
    document.getElementById('tab-media').innerHTML = mediaH || '<p style="padding:25px; color:var(--c-gray); width:100%; text-align:center;">No Media</p>';
    document.getElementById('tab-files').innerHTML = filesH || '<p style="padding:25px; color:var(--c-gray); width:100%; text-align:center;">No Files</p>';
    document.getElementById('tab-audio').innerHTML = audioH || '<p style="padding:25px; color:var(--c-gray); width:100%; text-align:center;">No Voice/Video</p>';
    document.getElementById('tab-links').innerHTML = linksH || '<p style="padding:25px; color:var(--c-gray); width:100%; text-align:center;">No Links</p>';
    
    switchProfTab('media', document.querySelector('.prof-tab'));
    openModal('profileModal');
}
function switchProfTab(tab, btn) {
    document.querySelectorAll('.prof-tab').forEach(b => { b.style.color = 'var(--c-gray)'; b.style.borderBottomColor = 'transparent'; });
    btn.style.color = 'var(--c-blue)'; btn.style.borderBottomColor = 'var(--c-blue)';
    document.querySelectorAll('.prof-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = tab==='media'?'flex':'flex';
}

function handleNotification(msg) {
    let sender = msg.data.user; 
    let room = msg.room; 
    let isDM = room.startsWith('dm_');
    let isGroup = room.startsWith('rm_');

    if (isDM && !room.includes(currentUser)) return;
    if (isGroup && msg.data.roomMembers && !msg.data.roomMembers.includes(currentUser)) return;

    if (isDM && !document.querySelector(`.chat-item[data-room="${sender}"]`)) loadInitData(); 

    let targetId = isDM ? sender : room;
    let badgeId = isDM ? `badge-dm_${targetId}` : `badge-${targetId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'inline-block'; badge.innerText = (parseInt(badge.innerText || 0) + 1); }
    
    try { document.getElementById('notif-sound').play(); } catch(e){}

    if ("Notification" in window && Notification.permission === "granted") {
        let notifBody = msg.data.msgType === 'text' ? msg.data.text : "New Message 📎";
        showSystemNotification(sender, notifBody, 'msg-' + room);
    }
}

let pressTimer;
function startPress(e, id, text, sender) { pressTimer = window.setTimeout(() => { openMsgMenu(e, id, text, sender); }, 600); }
function cancelPress() { clearTimeout(pressTimer); }

function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image') media = `<img src="${data.url}">`;
    else if (data.msgType === 'video') {
        let isVideoMessage = data.url.includes('rec_');
        if (isVideoMessage) {
            media = `<video class="video-msg" autoplay loop muted playsinline src="${data.url}" onclick="this.muted = !this.muted;"></video>`;
        } else {
            media = `<video controls playsinline style="max-width:100%; border-radius:12px; margin-top:5px; border:1px solid var(--border);" src="${data.url}"></video>`;
        }
    }
    else if (data.msgType === 'audio') {
        // Telegram-style voice message with waveform, play/pause, seek
        const audioId = 'aud_' + data.id;
        media = `
        <div class="voice-msg" data-audio-id="${audioId}" style="display:flex; align-items:center; gap:10px; padding:6px 4px; margin-top:4px; min-width:230px;">
            <audio id="${audioId}" preload="metadata" src="${data.url}" style="display:none;"></audio>
            <button class="voice-play-btn" onclick="toggleVoicePlay('${audioId}'); event.stopPropagation();" style="width:42px; height:42px; border-radius:50%; background:var(--c-blue); border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 0 12px var(--c-blue-glow);">
                <svg class="voice-icon-play" viewBox="0 0 24 24" style="width:22px; fill:currentColor;"><path d="M8 5v14l11-7z"/></svg>
                <svg class="voice-icon-pause" viewBox="0 0 24 24" style="width:22px; fill:currentColor; display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
                <div class="voice-waveform" onclick="seekVoiceByClick(event, '${audioId}')" style="height:24px; display:flex; align-items:center; gap:2px; cursor:pointer; position:relative; user-select:none;">
                    ${generateWaveformBars()}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--c-gray);">
                    <span class="voice-time" data-time-for="${audioId}">0:00</span>
                </div>
            </div>
        </div>`;
    }
    else if (data.msgType === 'file') {
        let fName = data.fileName || "File";
        media = `<a href="${data.url}" class="file-link" download><div class="file-icon"><svg style="width:24px;fill:white;"><use href="#icon-doc"></use></svg></div> <div style="display:flex; flex-direction:column; overflow:hidden;"><span style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" dir="auto">${fName}</span><span style="font-size:11px; opacity:0.7;">Download</span></div></a>`;
    }

    let textContent = data.text || '';
    let replyHtml = '';
    if (data.replyTo && data.replyTo.id) {
        replyHtml = `<div class="reply-preview" onclick="scrollToMsg('msg-${data.replyTo.id}'); event.stopPropagation();"><div style="color:var(--c-blue); font-weight:bold; font-size:12px; margin-bottom:2px;">${data.replyTo.user}</div><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.replyTo.text}</div></div>`;
    }

    let safeText = encodeURIComponent(textContent);

    let dateObj = data.timestamp ? new Date(data.timestamp.replace(' ', 'T') + 'Z') : new Date();
    let timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    let dateStr = dateObj.toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' });
    
    if (dateStr !== lastDateStr) {
        msgBox.insertAdjacentHTML('beforeend', `<div class="date-header"><span>${dateStr}</span></div>`);
        lastDateStr = dateStr;
    }

    let isOnlyVidMsg = data.msgType === 'video' && data.url.includes('rec_') && !textContent;
    let bubbleClass = isOnlyVidMsg ? "bubble video-msg-bubble" : "bubble";

    const html = `
        <div class="msg-row ${isSelf ? 'out' : 'in'}" id="msg-${data.id}">
            <div class="${bubbleClass}" dir="auto" 
                oncontextmenu="openMsgMenu(event, '${data.id}', '${safeText}', '${data.user}')"
                ontouchstart="startPress(event, '${data.id}', '${safeText}', '${data.user}')" 
                ontouchend="cancelPress()" 
                ontouchmove="cancelPress()"
                onclick="toggleMsgSelection('${data.id}')">
                
                <span class="sender-name">${data.user}</span>
                ${replyHtml}
                <span class="msg-text-content">${textContent}</span>
                ${media}
                <div class="reactions-bar" id="reacts-${data.id}"></div>
                <div class="msg-bottom-bar"><span class="msg-time">${timeStr}</span></div>
            </div>
        </div>`;
    
    msgBox.insertAdjacentHTML('beforeend', html);
    if(data.reactions) updateReactionUI(data.id, data.reactions);
    msgBox.scrollTop = msgBox.scrollHeight;
}

function scrollToMsg(id) {
    const el = document.getElementById(id);
    const msgBox = document.getElementById('messages');
    if(el && msgBox) {
        const offsetTop = el.offsetTop - msgBox.offsetTop;
        msgBox.scrollTo({ top: offsetTop - 60, behavior: 'smooth' });
        
        const bubble = el.querySelector('.bubble');
        if(bubble) {
            bubble.classList.add('highlight-msg');
            setTimeout(()=> bubble.classList.remove('highlight-msg'), 2000);
        }
    }
}

function openMsgMenu(e, id, textEncoded, sender) {
    if(e && e.preventDefault) e.preventDefault();
    if(selectionMode) { toggleMsgSelection(id); return; }
    contextMsgId = id; contextMsgText = decodeURIComponent(textEncoded) || ''; contextMsgSender = sender;
    const menu = document.getElementById('msgContextMenu');
    menu.style.display = 'flex';

    if(sender === currentUser && contextMsgText !== '') document.getElementById('editBtnOption').style.display = 'flex';
    else document.getElementById('editBtnOption').style.display = 'none';

    let x = window.innerWidth / 2; let y = window.innerHeight / 2;
    if(e) {
        x = e.clientX || (e.touches && e.touches[0].clientX) || x;
        y = e.clientY || (e.touches && e.touches[0].clientY) || y;
    }

    // First reset so we can measure
    menu.style.left = '0px';
    menu.style.top = '0px';

    // After display:flex paints, measure the actual menu and place properly
    requestAnimationFrame(() => {
        const w = menu.offsetWidth || 230;
        const h = menu.offsetHeight || 280;
        const isMobile = window.innerWidth < 600;
        let left, top;
        if (isMobile) {
            // Center horizontally, place near tap vertically but keep on screen
            left = (window.innerWidth - w) / 2;
            // Show ABOVE the tap if it fits, else below
            top = y - h - 10;
            if (top < 10) top = Math.min(y + 10, window.innerHeight - h - 10);
        } else {
            left = x;
            top = y;
            if (left + w > window.innerWidth - 10) left = window.innerWidth - w - 10;
            if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
            if (left < 10) left = 10;
            if (top < 10) top = 10;
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    });
}

function sendReaction(emoji) { if(!contextMsgId) return; ws.send(JSON.stringify({action: 'react_msg', msg_id: contextMsgId, emoji: emoji})); closeContextMenu(); }

function updateReactionUI(msgId, reactionsObj) {
    const bar = document.getElementById(`reacts-${msgId}`); if(!bar) return;
    bar.innerHTML = ''; let counts = {}; let myReact = null;
    for(let usr in reactionsObj) { let em = reactionsObj[usr]; counts[em] = (counts[em] || 0) + 1; if(usr === currentUser) myReact = em; }
    for(let em in counts) { let isMine = (myReact === em) ? 'mine' : ''; bar.innerHTML += `<span class="react-badge ${isMine}" onclick="ws.send(JSON.stringify({action:'react_msg', msg_id:'${msgId}', emoji:'${em}'})); event.stopPropagation();">${em} ${counts[em]}</span>`; }
}

function doReply() { replyToMsg = { id: contextMsgId, text: contextMsgText, user: contextMsgSender }; document.getElementById('replySender').innerText = contextMsgSender; document.getElementById('replyText').innerText = contextMsgText; document.getElementById('replyBar').style.display = 'block'; document.getElementById('msgInput').focus(); closeContextMenu(); }
function cancelReply() { replyToMsg = null; document.getElementById('replyBar').style.display = 'none'; editMsgId = null;}
function doCopy() { navigator.clipboard.writeText(contextMsgText); closeContextMenu(); }
function doDeleteMsg() { if(confirm("Delete message for everyone?")) ws.send(JSON.stringify({action: 'delete_msg', msg_ids: [contextMsgId]})); closeContextMenu(); }

function doEdit() {
    editMsgId = contextMsgId;
    document.getElementById('msgInput').value = contextMsgText;
    document.getElementById('msgInput').focus();
    checkInput(); closeContextMenu();
}

function doSelect() { selectionMode = true; closeContextMenu(); toggleMsgSelection(contextMsgId); }
function toggleMsgSelection(id) {
    if(!selectionMode) return;
    const bubble = document.querySelector(`#msg-${id} .bubble`);
    if(!bubble) return;
    if(selectedMsgs.includes(id)) { selectedMsgs = selectedMsgs.filter(m => m !== id); bubble.classList.remove('selected-msg'); } 
    else { selectedMsgs.push(id); bubble.classList.add('selected-msg'); }
    updateSelectionUI();
}
function updateSelectionUI() {
    const bar = document.getElementById('multiSelectBar');
    if(selectedMsgs.length > 0) { bar.style.display = 'flex'; document.getElementById('selectCount').innerText = `${selectedMsgs.length} Selected`; } 
    else { cancelSelection(); }
}
function cancelSelection() {
    selectionMode = false; selectedMsgs = [];
    document.querySelectorAll('.bubble.selected-msg').forEach(b => b.classList.remove('selected-msg'));
    document.getElementById('multiSelectBar').style.display = 'none';
}
function deleteSelected() { if(confirm(`Delete ${selectedMsgs.length} messages for everyone?`)) { ws.send(JSON.stringify({action: 'delete_msg', msg_ids: selectedMsgs})); cancelSelection(); } }

function openForwardModal() {
    let html = '';
    document.querySelectorAll('.chat-item').forEach(item => {
        let rid = item.getAttribute('data-room');
        if(rid === 'Announcements' && currentRole !== 'admin') return; 
        let rname = item.querySelector('.chat-name').innerText;
        let avatar = item.querySelector('.avatar').innerHTML;
        html += `<div class="contact-check" onclick="execForward('${rid}')" style="border-bottom:1px solid var(--border); padding:10px; display:flex; align-items:center; gap:10px; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'"><div class="avatar" style="width:36px;height:36px;font-size:14px;border:none;">${avatar}</div> <span style="color:var(--c-white); font-weight:bold;">${rname}</span></div>`;
    });
    document.getElementById('forwardList').innerHTML = html || '<p style="text-align:center;color:gray;padding:15px;">No chats available</p>';
    openModal('forwardModal');
}

function execForward(targetRoomId) {
    ws.send(JSON.stringify({action: 'forward_msg', msg_ids: selectedMsgs, target_room: targetRoomId}));
    closeModal('forwardModal'); cancelSelection();
    let chatItem = document.querySelector(`.chat-item[data-room="${targetRoomId}"]`);
    if(chatItem) chatItem.click();
}

// --- Inputs & Recording ---
let mediaRecorder; let audioChunks = []; let isRecording = false; let isPaused = false;
let recTimerInterval; let recSeconds = 0;

function checkInput() {
    const input = document.getElementById('msgInput');
    const btnSend = document.getElementById('actionSendBtn');
    const btnMic = document.getElementById('actionMicBtn');
    const btnVid = document.getElementById('actionVideoBtn');
    if (input.value.trim() !== '') { 
        btnSend.style.display = 'flex'; btnMic.style.display = 'none'; btnVid.style.display = 'none';
    } else { 
        btnSend.style.display = 'none'; btnMic.style.display = 'flex'; btnVid.style.display = 'flex';
    }
}

function handleSendText() {
    const input = document.getElementById('msgInput');
    if (input.value.trim() !== '') { 
        if(editMsgId) {
            ws.send(JSON.stringify({action: 'edit_msg', msg_id: editMsgId, text: input.value}));
            editMsgId = null;
        } else {
            ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: 'text', text: input.value, replyTo: replyToMsg})); 
        }
        input.value = ''; cancelReply(); checkInput(); 
    }
}
// === PHASE 2: Mobile-friendly input handling ===
// Detect if we're on mobile/touch device
function isMobileDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

// Whether Enter sends the message; user can toggle in settings.
// Default: desktop = Enter sends, Shift+Enter newline; mobile = Enter newline, button sends.
let enterToSend = localStorage.getItem('enterToSend');
if (enterToSend === null) {
    enterToSend = isMobileDevice() ? 'false' : 'true';
    localStorage.setItem('enterToSend', enterToSend);
}
function setEnterToSend(val) {
    enterToSend = val ? 'true' : 'false';
    localStorage.setItem('enterToSend', enterToSend);
}
function getEnterToSend() { return enterToSend === 'true'; }

function handleInputKey(e) {
    if (e.key !== 'Enter') return;
    // On mobile, never auto-send unless user enabled it; let Enter create newline
    if (e.shiftKey) return; // Shift+Enter always = newline
    if (e.ctrlKey || e.metaKey) {
        // Ctrl+Enter / Cmd+Enter always sends
        e.preventDefault();
        handleSendText();
        return;
    }
    if (getEnterToSend()) {
        e.preventDefault();
        handleSendText();
    }
    // else: let default newline happen
}

function autoResize(el) {
    if (!el) return;
    const messages = document.getElementById('messages');
    // Remember whether we were pinned to the bottom BEFORE resize
    let wasAtBottom = false;
    let prevScrollTop = 0;
    let prevHeight = 0;
    if (messages) {
        prevScrollTop = messages.scrollTop;
        prevHeight = el.offsetHeight;
        // "near bottom" threshold = 40px
        wasAtBottom = (messages.scrollHeight - messages.scrollTop - messages.clientHeight) < 40;
    }

    // Resize the textarea
    el.style.height = 'auto';
    const max = 140;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';

    // After the resize, the .messages flex container changed size.
    // We want to either (a) stick to the bottom, or (b) keep the previous scroll position
    // so the visible messages don't shift up/down.
    if (messages) {
        // Use rAF so we run after layout settles
        requestAnimationFrame(() => {
            if (wasAtBottom) {
                messages.scrollTop = messages.scrollHeight;
            } else {
                const heightDelta = el.offsetHeight - prevHeight;
                // When input grows by +N, messages height shrinks by N → scroll content
                // would visually shift UP by N. We compensate by reducing scrollTop by N.
                if (heightDelta !== 0) {
                    messages.scrollTop = Math.max(0, prevScrollTop - heightDelta);
                }
            }
        });
    }
}

// Keep the OLD keypress for safety (no-op since onkeydown handles it now via inline)
// Removed the unsafe Enter-always-sends listener that was here before

function updateTimer() {
    if(!isPaused) { recSeconds++; let m = String(Math.floor(recSeconds / 60)).padStart(2, '0'); let s = String(recSeconds % 60).padStart(2, '0'); document.getElementById('recTimer').innerText = `${m}:${s}`; }
}

async function startRecord(type, btn) {
    if (!isRecording) {
        try {
            audioChunks = []; 
            const constraints = type === 'video' ? { audio: true, video: { facingMode: "user" } } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (type === 'video') { const vidPrev = document.getElementById('videoPreview'); vidPrev.srcObject = stream; vidPrev.style.display = 'block'; }

            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                if(type === 'video') { const vidPrev = document.getElementById('videoPreview'); vidPrev.style.display = 'none'; vidPrev.srcObject = null; }
                stream.getTracks().forEach(t => t.stop());
                
                if(audioChunks.length > 0) {
                    const mime = type === 'video' ? 'video/webm' : 'audio/webm';
                    const uniqueId = Math.random().toString(36).substring(2, 10);
                    const fileName = `rec_${uniqueId}.${type==='video'?'mp4':'webm'}`;
                    
                    const fd = new FormData(); 
                    fd.append('file', new File([new Blob(audioChunks, { type: mime })], fileName, { type: mime }));
                    audioChunks = []; 
                    
                    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
                    const data = await res.json();
                    if (data.error || !data.url) {
                        alert("Upload failed: " + (data.detail || data.error || "Unknown error"));
                        return;
                    }
                    if (data.used_bytes != null) myUsedBytes = data.used_bytes;
                    ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: type, url: data.url, replyTo: replyToMsg}));
                    cancelReply();
                }
            };
            mediaRecorder.start(500); isRecording = true; isPaused = false;
            
            document.getElementById('textInputBox').style.display = 'none';
            document.getElementById('attachBtn').style.display = 'none';
            document.getElementById('actionVideoBtn').style.display = 'none';
            document.getElementById('actionMicBtn').style.display = 'none';
            
            document.getElementById('recControls').style.display = 'flex';
            let sendBtn = document.getElementById('actionSendBtn');
            sendBtn.style.display = 'flex'; sendBtn.classList.add('rec'); sendBtn.classList.remove('send');
            sendBtn.onclick = stopAndSendRecord; 

            recSeconds = 0; document.getElementById('recTimer').innerText = "00:00";
            recTimerInterval = setInterval(updateTimer, 1000);
            
        } catch (err) { alert("Please allow Microphone/Camera access in your browser."); }
    }
}

function pauseResumeRecord() {
    const btn = document.getElementById('pauseRecBtn');
    if(isPaused) { mediaRecorder.resume(); isPaused = false; btn.innerHTML = '<svg style="width:20px;fill:currentColor;"><use href="#icon-pause"></use></svg>'; btn.style.color = "var(--c-blue)";}
    else { mediaRecorder.pause(); isPaused = true; btn.innerHTML = '▶'; btn.style.color = "var(--c-red)";}
}

function cancelRecord() { audioChunks = []; mediaRecorder.stop(); resetRecordUI(); }
function stopAndSendRecord() { mediaRecorder.stop(); resetRecordUI(); }

function resetRecordUI() {
    isRecording = false; clearInterval(recTimerInterval);
    document.getElementById('recControls').style.display = 'none';
    document.getElementById('textInputBox').style.display = 'flex';
    document.getElementById('attachBtn').style.display = 'flex';
    
    let sendBtn = document.getElementById('actionSendBtn');
    sendBtn.classList.remove('rec'); sendBtn.classList.add('send');
    sendBtn.onclick = handleSendText; 
    checkInput(); 
}

async function uploadFile() {
    const file = document.getElementById('fileInput').files[0]; if (!file) return;

    // Quick client-side quota check
    if (myQuotaMB > 0) {
        const remaining = myQuotaMB * 1024 * 1024 - myUsedBytes;
        if (file.size > remaining) {
            alert(`Quota exceeded.\nRemaining: ${fmtBytes(Math.max(0, remaining))}\nFile size: ${fmtBytes(file.size)}`);
            document.getElementById('fileInput').value = '';
            return;
        }
    }

    const fd = new FormData(); fd.append('file', file);
    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
        try { const e = await res.json(); alert("Upload failed: " + (e.detail || res.status)); }
        catch { alert("Upload failed: " + res.status); }
        document.getElementById('fileInput').value = '';
        return;
    }
    const data = await res.json();
    if (data.used_bytes != null) myUsedBytes = data.used_bytes;
    if (data.url) { ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: data.type, url: data.url, fileName: data.name, replyTo: replyToMsg})); cancelReply(); }
    document.getElementById('fileInput').value = '';
}

// =====================================================================
// WebRTC — Voice + Video Calls (1-to-1)
// =====================================================================
// State
let localStreamCall = null;
let remoteStreamCall = null;
let peerConnection = null;
let callTarget = null;
let callMode = 'audio';      // 'audio' | 'video'
let callDirection = null;    // 'outgoing' | 'incoming'
let callState = 'idle';      // 'idle' | 'ringing' | 'connecting' | 'in-call'
let isMuted = false;
let isCameraOff = false;
let currentFacingMode = 'user';   // 'user' | 'environment'
let cachedIceServers = null;
let pendingIceCandidates = [];    // ICE candidates that arrived before remoteDescription was set
let callStartedAt = null;
let callTimerInterval = null;
let ringtoneAudio = null;

async function getIceServers() {
    if (cachedIceServers) return cachedIceServers;
    try {
        const res = await apiFetch('/api/turn-config');
        if (res.ok) {
            const data = await res.json();
            cachedIceServers = data.iceServers;
            return cachedIceServers;
        }
    } catch (e) { console.warn('Failed to get TURN config:', e); }
    // Fallback: free Google STUN
    cachedIceServers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ];
    return cachedIceServers;
}

function ensureSecureContext() {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (window.location.protocol !== 'https:' && !isLocalhost) {
        alert("⚠️ Calls require HTTPS to access microphone/camera.\nPlease use a secure (https://) connection.");
        return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser does not support media devices.");
        return false;
    }
    return true;
}

function getMediaConstraints(mode, facing) {
    if (mode === 'video') {
        return {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { facingMode: facing || 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
        };
    }
    return {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
    };
}

// Public entry points
async function startCall() { await initiateCall('audio'); }
async function startVideoCall() { await initiateCall('video'); }

async function initiateCall(mode) {
    if (callState !== 'idle') {
        alert('Already in a call');
        return;
    }
    if (!ensureSecureContext()) return;
    if (!targetUserForDM) {
        alert('Open a private chat first to start a call');
        return;
    }

    callTarget = targetUserForDM;
    callMode = mode;
    callDirection = 'outgoing';
    callState = 'ringing';
    pendingIceCandidates = [];

    showCallUI({ title: callTarget, status: mode === 'video' ? 'Video calling...' : 'Calling...', mode });

    try {
        const constraints = getMediaConstraints(mode, currentFacingMode);
        localStreamCall = await navigator.mediaDevices.getUserMedia(constraints);
        attachLocalVideo();

        const iceServers = await getIceServers();
        peerConnection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
        bindPeerEvents();
        localStreamCall.getTracks().forEach(t => peerConnection.addTrack(t, localStreamCall));

        const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: mode === 'video' });
        await peerConnection.setLocalDescription(offer);

        ws.send(JSON.stringify({
            action: 'webrtc', type: 'offer', mode: mode,
            targetUser: callTarget, offer: offer, from: currentUser
        }));
    } catch (err) {
        console.error('Call start error:', err);
        const msg = (err && err.name === 'NotAllowedError')
            ? "Permission denied for microphone/camera."
            : "Could not start call: " + (err.message || err);
        alert(msg);
        endCall(false);
    }
}

function bindPeerEvents() {
    peerConnection.onicecandidate = (e) => {
        if (e.candidate && callTarget) {
            ws.send(JSON.stringify({
                action: 'webrtc', type: 'ice', targetUser: callTarget,
                candidate: e.candidate, from: currentUser
            }));
        }
    };
    peerConnection.ontrack = (e) => {
        if (!remoteStreamCall) remoteStreamCall = new MediaStream();
        e.streams[0].getTracks().forEach(t => {
            try { remoteStreamCall.addTrack(t); } catch {}
        });
        attachRemoteMedia();
    };
    peerConnection.oniceconnectionstatechange = () => {
        const st = peerConnection ? peerConnection.iceConnectionState : '';
        console.log('[WebRTC] ICE state:', st);
        const stEl = document.getElementById('callStatusText');
        if (st === 'connected' || st === 'completed') {
            if (callState !== 'in-call') {
                callState = 'in-call';
                callStartedAt = Date.now();
                if (callTimerInterval) clearInterval(callTimerInterval);
                callTimerInterval = setInterval(updateCallDuration, 1000);
                stopRingtone();
            }
            if (stEl) stEl.innerText = formatCallDuration();
        } else if (st === 'disconnected' || st === 'failed') {
            if (stEl) stEl.innerText = 'Connection lost';
            if (st === 'failed') setTimeout(() => endCall(true), 2000);
        }
    };
}

function attachLocalVideo() {
    const lv = document.getElementById('localVideo');
    if (lv && callMode === 'video') {
        lv.srcObject = localStreamCall;
        lv.style.display = 'block';
        try { lv.play().catch(()=>{}); } catch {}
    } else if (lv) {
        lv.style.display = 'none';
    }
}

function attachRemoteMedia() {
    const remoteVideo = document.getElementById('remoteVideo');
    const remoteAudio = document.getElementById('remoteAudio');
    if (callMode === 'video' && remoteVideo) {
        remoteVideo.srcObject = remoteStreamCall;
        remoteVideo.style.display = 'block';
        try { remoteVideo.play().catch(()=>{}); } catch {}
    }
    if (remoteAudio) {
        remoteAudio.srcObject = remoteStreamCall;
        try { remoteAudio.play().catch(()=>{}); } catch {}
    }
}

function handleWebRTC(data) {
    if (data.targetUser !== currentUser) return;

    if (data.type === 'offer') {
        if (callState !== 'idle') {
            // already in a call - reject quietly
            ws.send(JSON.stringify({ action: 'webrtc', type: 'busy', targetUser: data.from, from: currentUser }));
            return;
        }
        callTarget = data.from;
        callMode = data.mode || 'audio';
        callDirection = 'incoming';
        callState = 'ringing';
        pendingIceCandidates = [];
        // store offer for accept
        window._pendingOffer = data.offer;
        showCallUI({
            title: callTarget,
            status: callMode === 'video' ? 'Incoming video call' : 'Incoming voice call',
            mode: callMode,
            incoming: true,
        });
        playRingtone();
    }
    else if (data.type === 'answer') {
        if (peerConnection && peerConnection.signalingState !== 'stable') {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                .then(flushPendingIce).catch(e => console.error('Set answer failed:', e));
        }
        const stEl = document.getElementById('callStatusText');
        if (stEl) stEl.innerText = 'Connecting...';
    }
    else if (data.type === 'ice') {
        if (peerConnection && peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => console.warn('ICE add failed:', e));
        } else {
            // Buffer until remote description is set
            pendingIceCandidates.push(data.candidate);
        }
    }
    else if (data.type === 'busy') {
        const stEl = document.getElementById('callStatusText');
        if (stEl) stEl.innerText = 'User is busy';
        setTimeout(() => endCall(false), 2000);
    }
    else if (data.type === 'end') {
        endCall(false);
    }
}

async function flushPendingIce() {
    if (!peerConnection) return;
    while (pendingIceCandidates.length > 0) {
        const c = pendingIceCandidates.shift();
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
    }
}

async function acceptCall() {
    if (!ensureSecureContext()) { endCall(true); return; }
    const offerData = window._pendingOffer;
    if (!offerData) { endCall(true); return; }
    delete window._pendingOffer;

    stopRingtone();
    callState = 'connecting';
    const stEl = document.getElementById('callStatusText');
    if (stEl) stEl.innerText = 'Connecting...';
    setInCallButtons();

    try {
        const constraints = getMediaConstraints(callMode, currentFacingMode);
        localStreamCall = await navigator.mediaDevices.getUserMedia(constraints);
        attachLocalVideo();

        const iceServers = await getIceServers();
        peerConnection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
        bindPeerEvents();
        localStreamCall.getTracks().forEach(t => peerConnection.addTrack(t, localStreamCall));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));
        await flushPendingIce();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        ws.send(JSON.stringify({
            action: 'webrtc', type: 'answer',
            targetUser: callTarget, answer: answer, from: currentUser
        }));
    } catch (err) {
        console.error('Accept error:', err);
        const msg = (err && err.name === 'NotAllowedError')
            ? "Permission denied for microphone/camera."
            : "Could not accept call: " + (err.message || err);
        alert(msg);
        endCall(true);
    }
}

function rejectCall() { endCall(true); }

function endCall(notifyOther = true) {
    stopRingtone();
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }

    if (peerConnection) {
        try { peerConnection.close(); } catch {}
        peerConnection = null;
    }
    if (localStreamCall) {
        try { localStreamCall.getTracks().forEach(t => t.stop()); } catch {}
        localStreamCall = null;
    }
    remoteStreamCall = null;

    const remoteAudio = document.getElementById('remoteAudio');
    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');
    if (remoteAudio) remoteAudio.srcObject = null;
    if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; }
    if (localVideo) { localVideo.srcObject = null; localVideo.style.display = 'none'; }

    if (notifyOther && callTarget && ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({ action: 'webrtc', type: 'end', targetUser: callTarget, from: currentUser }));
        } catch {}
    }

    document.getElementById('callModal').style.display = 'none';
    callTarget = null;
    callMode = 'audio';
    callDirection = null;
    callState = 'idle';
    isMuted = false;
    isCameraOff = false;
    pendingIceCandidates = [];
    callStartedAt = null;
}

// =================== In-call controls ===================
function toggleMute() {
    if (!localStreamCall) return;
    isMuted = !isMuted;
    localStreamCall.getAudioTracks().forEach(t => t.enabled = !isMuted);
    const btn = document.getElementById('callMuteBtn');
    if (btn) {
        btn.classList.toggle('active', isMuted);
        btn.title = isMuted ? 'Unmute' : 'Mute';
        btn.innerHTML = isMuted
            ? '<svg viewBox="0 0 24 24" style="width:24px;fill:currentColor;"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM15 11.16L9 5.18V5c0-1.66 1.34-3 3-3s3 1.34 3 3v6.16zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>'
            : '<svg viewBox="0 0 24 24" style="width:24px;fill:currentColor;"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
    }
}

function toggleCamera() {
    if (!localStreamCall) return;
    if (callMode !== 'video') {
        alert('Camera is only available in video calls');
        return;
    }
    isCameraOff = !isCameraOff;
    localStreamCall.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
    const btn = document.getElementById('callCameraBtn');
    if (btn) {
        btn.classList.toggle('active', isCameraOff);
        btn.title = isCameraOff ? 'Camera On' : 'Camera Off';
    }
    const lv = document.getElementById('localVideo');
    if (lv) lv.style.display = isCameraOff ? 'none' : 'block';
}

async function switchCamera() {
    if (!localStreamCall || callMode !== 'video') return;
    const newFacing = currentFacingMode === 'user' ? 'environment' : 'user';
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } }
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (!newVideoTrack) return;
        // Replace sender track
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(newVideoTrack);
        // Stop old video track, attach new
        localStreamCall.getVideoTracks().forEach(t => { try { t.stop(); } catch {} localStreamCall.removeTrack(t); });
        localStreamCall.addTrack(newVideoTrack);
        attachLocalVideo();
        currentFacingMode = newFacing;
    } catch (err) {
        console.error('Camera switch failed:', err);
        alert('Could not switch camera: ' + (err.message || err));
    }
}

// =================== Call UI ===================
function showCallUI({ title, status, mode, incoming = false }) {
    const modal = document.getElementById('callModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const t = document.getElementById('callUserText');
    if (t) t.innerText = title || '';
    const s = document.getElementById('callStatusText');
    if (s) s.innerText = status || '';

    // Avatar
    const av = document.getElementById('callAvatar');
    if (av) {
        const url = (userAvatars && userAvatars[title]) || '';
        if (url) {
            av.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            av.innerHTML = `<span style="font-size:54px;font-weight:700;">${(title||'?').charAt(0).toUpperCase()}</span>`;
        }
    }

    // Show video container only in video mode
    const vc = document.getElementById('callVideoContainer');
    if (vc) vc.style.display = (mode === 'video') ? 'block' : 'none';

    if (incoming) {
        setIncomingButtons();
    } else {
        setOutgoingButtons();
    }
}

function setIncomingButtons() {
    const btns = document.getElementById('callBtns');
    if (!btns) return;
    btns.innerHTML = `
        <button class="call-btn answer-btn" onclick="acceptCall()" title="Answer">
            <svg viewBox="0 0 24 24" style="width:28px;fill:currentColor;"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        </button>
        <button class="call-btn reject-btn" onclick="rejectCall()" title="Decline">
            <svg viewBox="0 0 24 24" style="width:28px;fill:currentColor;transform:rotate(135deg);"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        </button>
    `;
}

function setOutgoingButtons() {
    const btns = document.getElementById('callBtns');
    if (!btns) return;
    btns.innerHTML = `
        <button class="call-btn reject-btn" onclick="endCall()" title="End call">
            <svg viewBox="0 0 24 24" style="width:28px;fill:currentColor;transform:rotate(135deg);"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        </button>
    `;
}

function setInCallButtons() {
    const btns = document.getElementById('callBtns');
    if (!btns) return;
    const isVideo = callMode === 'video';
    btns.innerHTML = `
        <button class="call-btn ctrl-btn" id="callMuteBtn" onclick="toggleMute()" title="Mute">
            <svg viewBox="0 0 24 24" style="width:24px;fill:currentColor;"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        </button>
        ${isVideo ? `
        <button class="call-btn ctrl-btn" id="callCameraBtn" onclick="toggleCamera()" title="Camera Off">
            <svg viewBox="0 0 24 24" style="width:24px;fill:currentColor;"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        </button>
        <button class="call-btn ctrl-btn" id="callSwitchBtn" onclick="switchCamera()" title="Switch Camera">
            <svg viewBox="0 0 24 24" style="width:24px;fill:currentColor;"><path d="M9.4 10.5l4.77-8.26C13.47 2.09 12.75 2 12 2c-2.4 0-4.6.85-6.32 2.25l3.66 6.35.06-.1zM21.54 9c-.92-2.92-3.15-5.26-6-6.34L11.88 9h9.66zm.26 1h-7.49l.29.5 4.76 8.25C21 16.97 22 14.61 22 12c0-.69-.07-1.35-.2-2zM8.54 12l-3.9-6.75C3.01 7.03 2 9.39 2 12c0 .69.07 1.35.2 2h7.49l-1.15-2zm-6.08 3c.92 2.92 3.15 5.26 6 6.34L12.12 15H2.46zm11.27 0l-3.9 6.76c.7.15 1.42.24 2.17.24 2.4 0 4.6-.85 6.32-2.25l-3.66-6.35-.93 1.6z"/></svg>
        </button>
        ` : ''}
        <button class="call-btn reject-btn" onclick="endCall()" title="End call">
            <svg viewBox="0 0 24 24" style="width:28px;fill:currentColor;transform:rotate(135deg);"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        </button>
    `;
}

function formatCallDuration() {
    if (!callStartedAt) return '';
    const sec = Math.floor((Date.now() - callStartedAt) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
}
function updateCallDuration() {
    const stEl = document.getElementById('callStatusText');
    if (stEl) stEl.innerText = formatCallDuration();
    // Switch buttons to in-call mode if not already
    if (callState === 'in-call' && !document.getElementById('callMuteBtn')) {
        setInCallButtons();
    }
}

function playRingtone() {
    try {
        const r = document.getElementById('notif-sound');
        if (!r) return;
        ringtoneAudio = r;
        ringtoneAudio.loop = true;
        ringtoneAudio.play().catch(()=>{});
    } catch {}
}
function stopRingtone() {
    if (ringtoneAudio) {
        try { ringtoneAudio.pause(); ringtoneAudio.currentTime = 0; ringtoneAudio.loop = false; } catch {}
        ringtoneAudio = null;
    }
}

// ============================================================
// ADMIN PANEL
// ============================================================
async function openAdminPanel() {
    if (currentRole !== 'admin') { alert('Admin only'); return; }
    closeModal('settingsModal');
    document.getElementById('adminModal').style.display = 'flex';
    switchAdminTab('users');
}
function closeAdminPanel() { document.getElementById('adminModal').style.display = 'none'; }

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-pane').forEach(p => p.style.display = 'none');
    const tabBtn = document.querySelector(`.admin-tab[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const pane = document.getElementById('admin-pane-' + tab);
    if (pane) pane.style.display = 'block';
    if (tab === 'users') loadAdminUsers();
    if (tab === 'stats') loadAdminStats();
    if (tab === 'turn') loadAdminTurn();
    if (tab === 'updates') loadAdminBackups();
}

async function loadAdminTurn() {
    const box = document.getElementById('admin-turn-content');
    if (!box) return;
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--c-gray);">Loading...</div>';
    try {
        const res = await apiFetch('/api/admin/turn');
        if (!res.ok) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Failed: '+res.status+'</div>'; return; }
        const d = await res.json();
        const dot = (ok) => `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${ok?'#22c55e':'#64748b'}; margin-right:8px; vertical-align:middle;"></span>`;
        const yes = '<span style="color:#22c55e; font-weight:700;">YES</span>';
        const no = '<span style="color:var(--c-red); font-weight:700;">NO</span>';
        box.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Service Status</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                <span style="font-size:16px;">${dot(d.running)}${d.running?'Running':'Stopped'}</span>
                <span style="font-size:13px; color:var(--c-gray);">Configured: ${d.configured?yes:no}</span>
            </div>
        </div>
        ${d.configured ? `
        <div class="stat-card" style="margin-top:12px;">
            <div class="stat-label">TURN Credentials</div>
            <table style="width:100%; font-size:13px; border-collapse:collapse; color:var(--c-text);">
                <tr><td style="padding:6px 0; color:var(--c-gray);">Host:</td><td style="text-align:right; font-family:monospace;">${escapeHtml(d.host)}</td></tr>
                <tr><td style="padding:6px 0; color:var(--c-gray);">Port:</td><td style="text-align:right; font-family:monospace;">${escapeHtml(d.port)}</td></tr>
                <tr><td style="padding:6px 0; color:var(--c-gray);">TLS Port:</td><td style="text-align:right; font-family:monospace;">${escapeHtml(d.tls_port)}</td></tr>
                <tr><td style="padding:6px 0; color:var(--c-gray);">Username:</td><td style="text-align:right; font-family:monospace;">${escapeHtml(d.user)}</td></tr>
                <tr><td style="padding:6px 0; color:var(--c-gray);">Password:</td><td style="text-align:right; font-family:monospace; word-break:break-all;">${escapeHtml(d.password)}</td></tr>
                <tr><td style="padding:6px 0; color:var(--c-gray);">Realm:</td><td style="text-align:right; font-family:monospace;">${escapeHtml(d.realm)}</td></tr>
            </table>
        </div>` : `
        <div class="stat-card" style="margin-top:12px; border:1px solid var(--c-orange);">
            <div style="color:var(--c-orange); font-weight:700; margin-bottom:6px;">⚠️ TURN not configured</div>
            <div style="font-size:13px; color:var(--c-gray);">Calls between users on different networks may fail without TURN. Run <code style="background:#000; padding:2px 6px; border-radius:4px;">black-chat</code> on the server and choose option 10 to install coturn.</div>
        </div>`}
        <div class="stat-card" style="margin-top:12px;">
            <div class="stat-label">ICE Servers (sent to clients)</div>
            <pre style="margin-top:8px; padding:10px; background:#000; color:#7dd3fc; border-radius:8px; font-size:11px; overflow-x:auto;">${escapeHtml(JSON.stringify(d.ice_servers, null, 2))}</pre>
        </div>`;
    } catch(e) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Error: '+e.message+'</div>'; }
}

async function adminTurnRestart() {
    if (!confirm('Restart coturn service?')) return;
    const res = await apiJson('/api/admin/turn/restart', {});
    if (res.ok) {
        alert('Restart issued. Reloading TURN status...');
        setTimeout(loadAdminTurn, 2000);
    } else {
        try { const e = await res.json(); alert('Failed: ' + (e.detail || 'unknown')); } catch { alert('Failed'); }
    }
}

async function loadAdminUsers() {
    const box = document.getElementById('admin-users-list');
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--c-gray);">Loading...</div>';
    try {
        const res = await apiFetch('/api/admin/users');
        if (!res.ok) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Failed: '+res.status+'</div>'; return; }
        const data = await res.json();
        if (!data.users.length) { box.innerHTML = '<div style="padding:20px; color:var(--c-gray); text-align:center;">No users</div>'; return; }
        box.innerHTML = data.users.map(u => {
            const usedMB = (u.used_bytes/(1024*1024)).toFixed(1);
            const pct = u.quota_mb > 0 ? Math.min(100, (u.used_bytes / (u.quota_mb*1024*1024) * 100)) : 0;
            const onlineDot = u.online ? '<span style="display:inline-block; width:8px; height:8px; background:#22c55e; border-radius:50%; margin-right:6px;"></span>' : '<span style="display:inline-block; width:8px; height:8px; background:#64748b; border-radius:50%; margin-right:6px;"></span>';
            return `
            <div class="admin-user-row" style="padding:14px; background:var(--bg-input); border-radius:12px; margin-bottom:10px; border:1px solid var(--border);">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                  <div style="font-weight:700; font-size:15px;">${onlineDot}${escapeHtml(u.username)} <span style="font-size:11px; padding:2px 8px; background:${u.role==='admin'?'var(--c-red)':'var(--c-blue)'}; border-radius:8px; color:white; margin-right:6px;">${u.role}</span></div>
                  <div style="font-size:12px; color:var(--c-gray); margin-top:4px;">Used: ${usedMB} MB / ${u.quota_mb} MB</div>
                  <div style="height:5px; background:rgba(255,255,255,0.1); border-radius:10px; margin-top:6px; width:200px; max-width:100%;">
                    <div style="height:100%; width:${pct}%; background:${pct>90?'var(--c-red)':'var(--c-blue)'}; border-radius:10px;"></div>
                  </div>
                </div>
                <div style="display:flex; gap:6px;">
                  <button onclick="adminEditUser('${escapeAttr(u.username)}', ${u.quota_mb}, '${u.role}')" style="padding:8px 12px; background:var(--c-blue); color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px;">Edit</button>
                  <button onclick="adminDeleteUser('${escapeAttr(u.username)}')" style="padding:8px 12px; background:var(--c-red); color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px;">Delete</button>
                </div>
              </div>
            </div>`;
        }).join('');
    } catch(e) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Error: '+e.message+'</div>'; }
}

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return String(s||'').replace(/'/g, "\\'").replace(/"/g, '\\"'); }

async function adminAddUser() {
    const username = document.getElementById('admin-new-username').value.trim();
    const password = document.getElementById('admin-new-password').value.trim();
    const role = document.getElementById('admin-new-role').value;
    const quota = parseInt(document.getElementById('admin-new-quota').value) || 500;
    if (!username || !password) { alert('Username and password required'); return; }
    const res = await apiJson('/api/admin/users/add', { username, password, role, quota_mb: quota });
    if (res.ok) {
        document.getElementById('admin-new-username').value = '';
        document.getElementById('admin-new-password').value = '';
        document.getElementById('admin-new-quota').value = '500';
        loadAdminUsers();
    } else {
        try { const e = await res.json(); alert(e.detail || 'Failed'); } catch { alert('Failed'); }
    }
}

async function adminEditUser(username, currentQuota, currentR) {
    const newPass = prompt(`New password for "${username}" (leave empty to keep):`, '');
    const newQuota = prompt(`Quota in MB for "${username}":`, currentQuota);
    const newRole = prompt(`Role for "${username}" (admin/user):`, currentR);
    if (newQuota === null) return;
    const body = { username };
    if (newPass && newPass.trim()) body.password = newPass.trim();
    if (newQuota) body.quota_mb = parseInt(newQuota) || currentQuota;
    if (newRole && (newRole === 'admin' || newRole === 'user')) body.role = newRole;
    const res = await apiJson('/api/admin/users/update', body);
    if (res.ok) loadAdminUsers();
    else { try { const e = await res.json(); alert(e.detail || 'Failed'); } catch { alert('Failed'); } }
}

async function adminDeleteUser(username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    const res = await apiJson('/api/admin/users/delete', { username });
    if (res.ok) loadAdminUsers();
    else { try { const e = await res.json(); alert(e.detail || 'Failed'); } catch { alert('Failed'); } }
}

async function loadAdminStats() {
    const box = document.getElementById('admin-stats-content');
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--c-gray);">Loading...</div>';
    try {
        const res = await apiFetch('/api/admin/stats');
        const d = await res.json();
        const diskPct = d.disk_total ? (d.disk_used / d.disk_total * 100).toFixed(1) : 0;
        box.innerHTML = `
        <div class="stat-card">
          <div class="stat-label">Online Users</div>
          <div class="stat-value">${d.online_count} <span style="font-size:13px; color:var(--c-gray);">/ ${d.users_count}</span></div>
          ${d.online_users.length ? `<div style="font-size:11px; color:var(--c-gray); margin-top:6px;">${d.online_users.map(u=>escapeHtml(u)).join(', ')}</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Messages</div>
          <div class="stat-value">${d.messages_count.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uploaded Files</div>
          <div class="stat-value">${d.uploads_files.toLocaleString()} <span style="font-size:13px; color:var(--c-gray);">(${fmtBytes(d.uploads_bytes)})</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Server Disk</div>
          <div class="stat-value">${fmtBytes(d.disk_used)} / ${fmtBytes(d.disk_total)}</div>
          <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:10px; margin-top:8px;">
            <div style="height:100%; width:${diskPct}%; background:${diskPct>85?'var(--c-red)':'var(--c-blue)'}; border-radius:10px;"></div>
          </div>
          <div style="font-size:11px; color:var(--c-gray); margin-top:4px;">${diskPct}% used | ${fmtBytes(d.disk_free)} free</div>
        </div>`;
    } catch(e) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Error: '+e.message+'</div>'; }
}

async function loadAdminBackups() {
    const box = document.getElementById('admin-backups-list');
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--c-gray);">Loading...</div>';
    try {
        const res = await apiFetch('/api/admin/backups');
        const data = await res.json();
        if (!data.backups.length) { box.innerHTML = '<div style="padding:20px; color:var(--c-gray); text-align:center;">No backups</div>'; return; }
        box.innerHTML = data.backups.map(b => `
          <div style="padding:12px; background:var(--bg-input); border-radius:10px; margin-bottom:8px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-weight:600; font-size:13px;">${escapeHtml(b.name)}</div>
              <div style="font-size:11px; color:var(--c-gray);">${new Date(b.created).toLocaleString()} · ${fmtBytes(b.size_bytes)}</div>
            </div>
            <button onclick="adminRollback('${escapeAttr(b.name)}')" style="padding:8px 14px; background:var(--c-orange); color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600;">↶ Rollback</button>
          </div>`).join('');
    } catch(e) { box.innerHTML = '<div style="color:var(--c-red); padding:10px;">Error: '+e.message+'</div>'; }
}

async function adminCreateBackup() {
    if (!confirm('Create a backup now?')) return;
    const res = await apiJson('/api/admin/backup', {});
    if (res.ok) { alert('Backup created'); loadAdminBackups(); }
    else alert('Backup failed');
}

async function adminUpdateApp() {
    if (!confirm('Update the app from GitHub?\n\nA backup will be created automatically.\nThe service will restart after.')) return;
    const btn = document.getElementById('admin-update-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Updating...'; }
    try {
        const res = await apiJson('/api/admin/update', {});
        const d = await res.json();
        if (res.ok && d.success) {
            alert('✅ Update applied!\nBackup: ' + d.backup + '\n\nThe page will reload in ~5 seconds.');
            setTimeout(() => location.reload(), 5000);
        } else {
            alert('Update failed: ' + (d.detail || 'unknown'));
        }
    } catch(e) { alert('Update error: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.innerText = '🔄 Update Now'; } }
}

async function adminRollback(name) {
    if (!confirm('Rollback to backup:\n' + name + '\n\nA safety backup of the current state will be made first.\nThe service will restart after.')) return;
    const res = await apiJson('/api/admin/rollback', { name });
    if (res.ok) {
        alert('✅ Rollback complete. Reloading in ~5 seconds.');
        setTimeout(() => location.reload(), 5000);
    } else {
        try { const e = await res.json(); alert('Rollback failed: ' + (e.detail || 'unknown')); } catch { alert('Rollback failed'); }
    }
}

async function adminRestartService() {
    if (!confirm('Restart the service now?')) return;
    await apiJson('/api/admin/restart', {});
    alert('Restart issued. Reloading in 5 seconds.');
    setTimeout(() => location.reload(), 5000);
}

// =====================================================================
// PHASE 4: Typing indicator, Read receipts, Online/Last seen,
// Smart auto-scroll, Scroll-to-bottom button, Swipe to reply
// =====================================================================

// ---- State ----
let lastSeenMap = {};                 // username -> ISO timestamp
let typingUsers = {};                 // room -> { user: timestamp }
let typingClearTimer = null;
let myTypingState = false;
let myTypingDebounce = null;
let unreadCount = 0;
let isNearBottom = true;

// ---- Typing dots HTML ----
function typingDotsHTML() {
    return '<span class="typing-dots-container"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
}

// ---- Update chat header status (online / last seen / typing) ----
function refreshHeaderStatus() {
    const statusEl = document.getElementById('room-status');
    if (!statusEl || !currentRoom) return;

    // Channel/group: keep their original status
    if (currentRoom === 'Announcements') {
        statusEl.innerText = translations[currentLang].system_channel || 'System Announcements';
        return;
    }
    if (currentRoom.startsWith('rm_')) {
        // Group: show typing user(s) if any
        const typers = typingUsers[currentRoom] ? Object.keys(typingUsers[currentRoom]) : [];
        if (typers.length > 0) {
            const names = typers.slice(0, 2).join(', ');
            statusEl.innerHTML = `<span style="color:var(--c-blue);">${escapeHtml(names)} typing</span>${typingDotsHTML()}`;
        } else {
            statusEl.innerText = translations[currentLang].group || 'Private Group';
        }
        return;
    }

    // Private DM
    if (!targetUserForDM) {
        statusEl.innerText = '';
        return;
    }
    // Typing has highest priority
    if (typingUsers[currentRoom] && Object.keys(typingUsers[currentRoom]).length > 0) {
        statusEl.innerHTML = `<span style="color:var(--c-blue);">typing</span>${typingDotsHTML()}`;
        return;
    }
    // Online?
    if (onlineUsers && onlineUsers.includes(targetUserForDM)) {
        statusEl.innerHTML = '<span style="color:#4dcd5e;">● online</span>';
        return;
    }
    // Last seen
    const ls = lastSeenMap[targetUserForDM];
    if (ls) {
        statusEl.innerText = 'last seen ' + formatLastSeen(ls);
    } else {
        statusEl.innerText = 'offline';
    }
}

function formatLastSeen(iso) {
    try {
        // Backend stores in UTC without timezone marker - assume UTC
        const d = new Date(iso.replace(' ', 'T') + 'Z');
        const now = Date.now();
        const diffSec = Math.floor((now - d.getTime()) / 1000);
        if (diffSec < 60) return 'just now';
        if (diffSec < 3600) return Math.floor(diffSec / 60) + ' min ago';
        if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
        if (diffSec < 7 * 86400) return Math.floor(diffSec / 86400) + 'd ago';
        return d.toLocaleDateString();
    } catch { return ''; }
}

// ---- Send our own typing signal ----
function notifyTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
    if (currentRoom === 'Announcements') return;
    if (!myTypingState) {
        myTypingState = true;
        ws.send(JSON.stringify({ action: 'typing', room: currentRoom, state: 'typing' }));
    }
    if (myTypingDebounce) clearTimeout(myTypingDebounce);
    myTypingDebounce = setTimeout(() => {
        myTypingState = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'typing', room: currentRoom, state: 'stopped' }));
        }
    }, 3000);
}

// ---- Handle incoming typing signals ----
function handleTypingSignal(msg) {
    if (!msg.room || !msg.user || msg.user === currentUser) return;
    typingUsers[msg.room] = typingUsers[msg.room] || {};
    if (msg.state === 'stopped') {
        delete typingUsers[msg.room][msg.user];
        if (Object.keys(typingUsers[msg.room]).length === 0) delete typingUsers[msg.room];
    } else {
        typingUsers[msg.room][msg.user] = Date.now();
    }
    if (msg.room === currentRoom) refreshHeaderStatus();

    // Auto-clear stale typing after 5s
    if (typingClearTimer) clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(() => {
        const now = Date.now();
        Object.keys(typingUsers).forEach(room => {
            Object.keys(typingUsers[room]).forEach(user => {
                if (now - typingUsers[room][user] > 5000) delete typingUsers[room][user];
            });
            if (Object.keys(typingUsers[room]).length === 0) delete typingUsers[room];
        });
        refreshHeaderStatus();
    }, 5000);
}

// ---- Read receipts ----
function markCurrentRoomAsRead() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
    if (!document.hasFocus || !document.hasFocus()) return;
    ws.send(JSON.stringify({ action: 'read_messages', room: currentRoom }));
}

function applyReadReceipt(msg) {
    // msg.msg_ids_per_sender: { senderUser: [msgIds...] }
    if (!msg.msg_ids_per_sender) return;
    if (msg.room !== currentRoom) return;
    const myMsgs = msg.msg_ids_per_sender[currentUser] || [];
    myMsgs.forEach(id => {
        const el = document.getElementById('msg-' + id);
        if (!el) return;
        let ticks = el.querySelector('.msg-ticks');
        if (!ticks) {
            // No ticks yet (e.g. attached after history load) — try to add them
            attachTicksToBubble(el, { readBy: ['someone'] });
            ticks = el.querySelector('.msg-ticks');
        }
        if (ticks) {
            ticks.classList.add('read');
            ticks.innerHTML = '<svg viewBox="0 0 24 24"><path d="M.41 13.41L6 19l1.41-1.42L1.83 12 .41 13.41zM22.24 5.58L11.66 16.17 7.5 12l-1.41 1.41L11.66 19l12-12-1.42-1.42zM18 7l-1.41-1.42-6.35 6.35 1.42 1.41L18 7z"/></svg>';
        }
    });
}

// ---- Smart scroll ----
function scrollMessagesToBottom(force = false) {
    const box = document.getElementById('messages');
    if (!box) return;
    if (force || isNearBottom) {
        box.scrollTop = box.scrollHeight;
        unreadCount = 0;
        updateScrollBottomBtn();
    }
}

function updateScrollBottomBtn() {
    const btn = document.getElementById('scrollBottomBtn');
    if (!btn) return;
    if (isNearBottom) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'flex';
        const dot = document.getElementById('unreadDot');
        if (dot) {
            if (unreadCount > 0) {
                dot.style.display = 'flex';
                dot.innerText = unreadCount > 99 ? '99+' : String(unreadCount);
            } else {
                dot.style.display = 'none';
            }
        }
    }
}

function attachMessagesScrollListener() {
    const box = document.getElementById('messages');
    if (!box || box._scrollAttached) return;
    box._scrollAttached = true;
    box.addEventListener('scroll', () => {
        const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 80;
        isNearBottom = nearBottom;
        if (nearBottom) {
            unreadCount = 0;
            markCurrentRoomAsRead();
        }
        updateScrollBottomBtn();
    }, { passive: true });
}

// ---- Hook into existing message append ----
// We patch by saving the original appendMessage and wrapping it
const __origAppendMessage = (typeof appendMessage === 'function') ? appendMessage : null;
if (__origAppendMessage) {
    window.appendMessage = function(data) {
        const wasNearBottom = isNearBottom;
        __origAppendMessage(data);

        // After appending, decide auto-scroll
        if (data.user === currentUser) {
            // My own message: always scroll
            scrollMessagesToBottom(true);
        } else if (wasNearBottom) {
            scrollMessagesToBottom(true);
            // Mark as read if focused
            markCurrentRoomAsRead();
        } else {
            // I'm scrolled up; track unread
            unreadCount++;
            updateScrollBottomBtn();
        }

        // Add ticks to outgoing message bubble (post-render)
        try {
            const el = document.getElementById('msg-' + data.id);
            if (el && data.user === currentUser) {
                attachTicksToBubble(el, data);
            }
        } catch {}
    };
}

function attachTicksToBubble(el, data) {
    if (!el) return;
    const bottomBar = el.querySelector('.msg-bottom-bar');
    const bubble = el.querySelector('.bubble');
    if (!bubble) return;
    if (el.querySelector('.msg-ticks')) return;
    const ticksSpan = document.createElement('span');
    ticksSpan.className = 'msg-ticks';
    const isRead = (data.readBy && data.readBy.length > 0);
    if (isRead) ticksSpan.classList.add('read');
    ticksSpan.innerHTML = isRead
        ? '<svg viewBox="0 0 24 24"><path d="M.41 13.41L6 19l1.41-1.42L1.83 12 .41 13.41zM22.24 5.58L11.66 16.17 7.5 12l-1.41 1.41L11.66 19l12-12-1.42-1.42zM18 7l-1.41-1.42-6.35 6.35 1.42 1.41L18 7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    if (bottomBar) bottomBar.appendChild(ticksSpan);
    else bubble.appendChild(ticksSpan);
}

// ---- Enhance openChat: refresh header status when chat opens ----
const __origOpenChat = (typeof openChat === 'function') ? openChat : null;
if (__origOpenChat) {
    window.openChat = function(roomId, type, title, targetUser = null) {
        __origOpenChat(roomId, type, title, targetUser);
        unreadCount = 0;
        isNearBottom = true;
        // Reset typing state for this room
        typingUsers[currentRoom] = {};
        setTimeout(() => {
            attachMessagesScrollListener();
            refreshHeaderStatus();
            updateScrollBottomBtn();
            // Mark history as read after a short delay
            setTimeout(markCurrentRoomAsRead, 600);
        }, 50);
    };
}

// ---- Hook WS events for typing/presence/read_receipt ----
const __origWsHook = window.__phase4WsHook || false;
if (!__origWsHook) {
    window.__phase4WsHook = true;
    // Wrap WebSocket onmessage by intercepting initWebSocket
    const __origInitWS = (typeof initWebSocket === 'function') ? initWebSocket : null;
    if (__origInitWS) {
        window.initWebSocket = function() {
            __origInitWS();
            // After ws is created, augment its onmessage
            if (!ws) return;
            const prevOnMessage = ws.onmessage;
            ws.onmessage = async function(event) {
                if (prevOnMessage) await prevOnMessage(event);
                try {
                    const m = JSON.parse(event.data);
                    if (m.type === 'typing') handleTypingSignal(m);
                    else if (m.type === 'presence') {
                        onlineUsers = m.online || [];
                        if (m.last_seen) lastSeenMap = m.last_seen;
                        refreshHeaderStatus();
                    }
                    else if (m.type === 'read_receipt') {
                        applyReadReceipt(m);
                    }
                    else if (m.type === 'history') {
                        // Mark as read after history loads
                        setTimeout(markCurrentRoomAsRead, 400);
                    }
                } catch {}
            };
        };
    }
}

// ---- Hook into message input for typing notify ----
function setupTypingHook() {
    const inp = document.getElementById('msgInput');
    if (!inp || inp._typingHooked) return;
    inp._typingHooked = true;
    inp.addEventListener('input', () => {
        if (inp.value.length > 0) notifyTyping();
    });
}
// Try to attach on DOMContentLoaded and on each openChat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTypingHook);
} else {
    setupTypingHook();
}

// ---- Mark as read when window regains focus ----
window.addEventListener('focus', () => {
    setTimeout(markCurrentRoomAsRead, 200);
});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        setTimeout(markCurrentRoomAsRead, 200);
    }
});

// ---- Periodic header refresh (for "last seen X min ago" updates) ----
setInterval(refreshHeaderStatus, 30000);

// ---- Swipe-to-reply on touch devices ----
function setupSwipeReply() {
    const messages = document.getElementById('messages');
    if (!messages || messages._swipeHooked) return;
    messages._swipeHooked = true;

    let startX = 0, startY = 0, curBubble = null, dragging = false;

    messages.addEventListener('touchstart', (e) => {
        if (selectionMode) return;
        const t = e.targetTouches[0];
        startX = t.clientX; startY = t.clientY;
        curBubble = e.target.closest('.bubble');
        dragging = false;
    }, { passive: true });

    messages.addEventListener('touchmove', (e) => {
        if (!curBubble || selectionMode) return;
        const t = e.targetTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        // Horizontal drag dominates
        if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) dragging = true;
        if (dragging) {
            // Limit drag
            const offset = Math.max(-80, Math.min(80, dx));
            curBubble.style.transform = `translateX(${offset}px)`;
            curBubble.style.transition = 'none';
        }
    }, { passive: true });

    messages.addEventListener('touchend', () => {
        if (!curBubble) return;
        const transform = curBubble.style.transform;
        const match = transform && transform.match(/-?\d+/);
        const offset = match ? parseInt(match[0]) : 0;
        curBubble.style.transition = 'transform 0.2s';
        curBubble.style.transform = '';
        // If swiped enough, trigger reply
        if (Math.abs(offset) > 50) {
            const wrapper = curBubble.parentElement;
            if (wrapper && wrapper.id && wrapper.id.startsWith('msg-')) {
                const id = wrapper.id.replace('msg-', '');
                const textEl = curBubble.querySelector('.msg-text-content');
                const text = textEl ? textEl.innerText : '';
                const senderEl = wrapper.querySelector('.bubble-sender, .sender-name');
                const sender = senderEl ? senderEl.innerText : (curBubble.classList.contains('bubble-me') ? currentUser : '');
                if (typeof contextMsgId !== 'undefined') {
                    contextMsgId = id; contextMsgText = text; contextMsgSender = sender;
                    if (typeof doReply === 'function') doReply();
                }
            }
        }
        curBubble = null; dragging = false;
    }, { passive: true });
}
// Run after openChat/setup
setInterval(setupSwipeReply, 1500);

// =====================================================================
// PHASE 4 — Group management & message search
// =====================================================================
let currentGroupMembers = null;  // { members, owner, all_users }

async function openGroupSettings() {
    if (!currentRoom || !currentRoom.startsWith('rm_')) return;
    document.getElementById('groupSettingsModal').style.display = 'flex';
    await loadGroupMembers();
}

async function loadGroupMembers() {
    const list = document.getElementById('group-members-list');
    list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--c-gray);">Loading...</div>';
    try {
        const res = await apiJson('/api/action', { action: 'get_room_members', room_id: currentRoom });
        const data = await res.json();
        if (!data.success) {
            list.innerHTML = `<div style="padding:14px; color:var(--c-red);">${escapeHtml(data.msg||'Error')}</div>`;
            return;
        }
        currentGroupMembers = data;
        const owner = data.owner;
        const isOwner = owner === currentUser;
        const groupName = document.getElementById('room-title').innerText || 'Group';

        document.getElementById('group-info-bar').innerHTML =
            `<strong style="color:var(--c-white);">${escapeHtml(groupName)}</strong><br>${data.members.length} member${data.members.length===1?'':'s'} · Owner: <strong style="color:var(--c-white);">${escapeHtml(owner)}</strong>`;

        // Add member section: only for owner
        const addSection = document.getElementById('group-add-member');
        if (isOwner) {
            addSection.style.display = 'block';
            const sel = document.getElementById('group-add-select');
            const candidates = (data.all_users || []).filter(u => !data.members.includes(u));
            sel.innerHTML = candidates.length
                ? candidates.map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`).join('')
                : '<option value="">— No users to add —</option>';
        } else {
            addSection.style.display = 'none';
        }

        // Members list
        list.innerHTML = data.members.map(m => {
            const isMemOwner = m === owner;
            const canRemove = isOwner && !isMemOwner;
            return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:var(--bg-input); border-radius:12px; margin-bottom:8px; border:1px solid var(--border);">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="avatar" style="width:40px; height:40px; font-size:16px; background:${isMemOwner?'var(--c-orange)':'var(--c-blue)'};">${escapeHtml((m||'?').charAt(0).toUpperCase())}</div>
                    <div>
                        <div style="font-weight:600;">${escapeHtml(m)}${m===currentUser?' <span style="font-size:11px; color:var(--c-gray);">(you)</span>':''}</div>
                        ${isMemOwner ? '<div style="font-size:11px; color:var(--c-orange); font-weight:600;">OWNER</div>' : (onlineUsers.includes(m) ? '<div style="font-size:11px; color:#4dcd5e;">● online</div>' : '<div style="font-size:11px; color:var(--c-gray);">offline</div>')}
                    </div>
                </div>
                ${canRemove ? `<button onclick="removeGroupMember('${escapeAttr(m)}')" style="padding:6px 12px; background:transparent; color:var(--c-red); border:1px solid var(--c-red); border-radius:8px; cursor:pointer; font-size:12px;">Remove</button>` : ''}
            </div>`;
        }).join('');

        // Owner danger zone vs member leave
        document.getElementById('group-danger-zone').style.display = isOwner ? 'block' : 'none';
        document.getElementById('group-leave-zone').style.display = isOwner ? 'none' : 'block';
    } catch(e) {
        list.innerHTML = `<div style="padding:14px; color:var(--c-red);">${escapeHtml(e.message)}</div>`;
    }
}

async function addGroupMember() {
    const sel = document.getElementById('group-add-select');
    const target = sel.value;
    if (!target) return;
    const res = await apiJson('/api/action', { action: 'add_room_member', room_id: currentRoom, target });
    const data = await res.json();
    if (data.success) {
        await loadGroupMembers();
    } else {
        alert(data.msg || 'Failed');
    }
}

async function removeGroupMember(target) {
    if (!confirm(`Remove "${target}" from the group?`)) return;
    const res = await apiJson('/api/action', { action: 'remove_room_member', room_id: currentRoom, target });
    const data = await res.json();
    if (data.success) {
        await loadGroupMembers();
    } else {
        alert(data.msg || 'Failed');
    }
}

async function leaveCurrentGroup() {
    if (!confirm('Are you sure you want to leave this group?')) return;
    const res = await apiJson('/api/action', { action: 'remove_room_member', room_id: currentRoom, target: currentUser });
    const data = await res.json();
    if (data.success) {
        closeModal('groupSettingsModal');
        currentRoom = null;
        targetUserForDM = null;
        document.getElementById('sidebar').classList.remove('hidden');
        if (typeof loadInitData === 'function') loadInitData();
    } else {
        alert(data.msg || 'Failed');
    }
}

async function deleteCurrentGroup() {
    if (!confirm('⚠️ This will permanently delete the group, all messages, and remove all members. Continue?')) return;
    const res = await apiJson('/api/action', { action: 'delete_room', room_id: currentRoom });
    const data = await res.json();
    if (data.success) {
        closeModal('groupSettingsModal');
        currentRoom = null;
        targetUserForDM = null;
        document.getElementById('sidebar').classList.remove('hidden');
        if (typeof loadInitData === 'function') loadInitData();
    } else {
        alert(data.msg || 'Failed');
    }
}

// =====================================================================
// Message Search
// =====================================================================
let searchDebounceTimer = null;

function openSearchBar() {
    if (!currentRoom) return;
    const sb = document.getElementById('searchBar');
    sb.style.display = 'flex';
    const inp = document.getElementById('searchInput');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
    document.getElementById('searchResults').style.display = 'none';
    if (!inp._searchHooked) {
        inp._searchHooked = true;
        inp.addEventListener('input', handleSearchInput);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearchBar(); });
    }
}

function closeSearchBar() {
    document.getElementById('searchBar').style.display = 'none';
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchInput').value = '';
}

function handleSearchInput() {
    const q = document.getElementById('searchInput').value.trim();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (q.length < 2) {
        document.getElementById('searchResults').style.display = 'none';
        return;
    }
    searchDebounceTimer = setTimeout(() => doSearch(q), 350);
}

async function doSearch(q) {
    const box = document.getElementById('searchResults');
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:24px; text-align:center; color:var(--c-gray);">Searching...</div>';
    try {
        const res = await apiJson('/api/action', { action: 'search_messages', room: currentRoom, q });
        const data = await res.json();
        if (!data.success && data.msg) {
            box.innerHTML = `<div style="padding:14px; color:var(--c-red);">${escapeHtml(data.msg)}</div>`;
            return;
        }
        const results = data.results || [];
        if (!results.length) {
            box.innerHTML = `<div style="padding:24px; text-align:center; color:var(--c-gray);">No messages found for "<strong>${escapeHtml(q)}</strong>"</div>`;
            return;
        }
        const lower = q.toLowerCase();
        box.innerHTML = `<div style="padding:8px 14px; font-size:12px; color:var(--c-gray); font-weight:600;">${results.length} result${results.length===1?'':'s'}</div>` + results.map(r => {
            const text = r.text || '';
            // Highlight match
            const idx = text.toLowerCase().indexOf(lower);
            let highlighted;
            if (idx >= 0) {
                highlighted = escapeHtml(text.substring(0, idx)) +
                    '<mark style="background:var(--c-blue); color:white; padding:1px 3px; border-radius:3px;">' + escapeHtml(text.substring(idx, idx+q.length)) + '</mark>' +
                    escapeHtml(text.substring(idx+q.length));
            } else {
                highlighted = escapeHtml(text);
            }
            return `
            <div onclick="jumpToSearchResult('${escapeAttr(r.id)}')" style="padding:12px 14px; margin:4px 8px; background:var(--bg-input); border-radius:10px; cursor:pointer; border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <strong style="color:var(--c-blue); font-size:13px;">${escapeHtml(r.user)}</strong>
                    <span style="font-size:11px; color:var(--c-gray);">${escapeHtml(formatSearchTimestamp(r.timestamp))}</span>
                </div>
                <div style="font-size:13px; color:var(--c-text, var(--c-white)); line-height:1.5; word-break:break-word;">${highlighted}</div>
            </div>`;
        }).join('');
    } catch(e) {
        box.innerHTML = `<div style="padding:14px; color:var(--c-red);">${escapeHtml(e.message)}</div>`;
    }
}

function formatSearchTimestamp(iso) {
    try {
        const d = new Date(iso.replace(' ', 'T') + 'Z');
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString();
    } catch { return ''; }
}

function jumpToSearchResult(msgId) {
    closeSearchBar();
    setTimeout(() => {
        const el = document.getElementById('msg-' + msgId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const bubble = el.querySelector('.bubble');
            if (bubble) {
                bubble.style.transition = 'box-shadow 0.5s';
                bubble.style.boxShadow = '0 0 0 3px var(--c-blue)';
                setTimeout(() => { bubble.style.boxShadow = ''; }, 1800);
            }
        }
    }, 100);
}

// =====================================================================
// Phase 4 — i18n additions (best-effort, only used if translations object exists)
// =====================================================================
try {
    if (typeof translations === 'object') {
        Object.assign(translations.en || {}, {
            online: 'online', offline: 'offline', typing: 'typing',
            search_msgs_ph: 'Search messages...', no_results: 'No messages found',
            group_members: 'Group Members', add_member: 'Add Member', leave_group: 'Leave Group', delete_group: 'Delete Group',
        });
        Object.assign(translations.fa || {}, {
            online: 'آنلاین', offline: 'آفلاین', typing: 'در حال تایپ',
            search_msgs_ph: 'جستجو در پیام‌ها...', no_results: 'پیامی یافت نشد',
            group_members: 'اعضای گروه', add_member: 'افزودن عضو', leave_group: 'خروج از گروه', delete_group: 'حذف گروه',
        });
    }
} catch {}

// =====================================================================
// Pinned messages
// =====================================================================
let pinnedMessages = [];     // current room's pinned list
let pinnedIndex = 0;         // which one is showing in the bar

function refreshPinnedBar() {
    const bar = document.getElementById('pinnedBar');
    if (!bar) return;
    if (!pinnedMessages.length) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    pinnedIndex = pinnedIndex % pinnedMessages.length;
    const p = pinnedMessages[pinnedIndex];
    const preview = p.msgType === 'text'
        ? (p.text || '').slice(0, 120)
        : (p.msgType === 'image' ? '🖼️ Photo' : (p.msgType === 'video' ? '🎥 Video' : (p.msgType === 'audio' ? '🎤 Voice' : '📎 ' + (p.fileName||'File'))));
    document.getElementById('pinnedPreview').innerText = `${p.user}: ${preview}`;
    document.getElementById('pinnedCount').innerText = pinnedMessages.length > 1 ? `(${pinnedIndex+1}/${pinnedMessages.length})` : '';
    bar.onclick = () => {
        // Jump to pinned message
        const el = document.getElementById('msg-' + p.id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const bubble = el.querySelector('.bubble');
            if (bubble) {
                bubble.style.transition = 'box-shadow 0.5s';
                bubble.style.boxShadow = '0 0 0 3px var(--c-blue)';
                setTimeout(() => { bubble.style.boxShadow = ''; }, 1500);
            }
        }
    };
}
function cyclePinned() {
    if (!pinnedMessages.length) return;
    pinnedIndex = (pinnedIndex + 1) % pinnedMessages.length;
    refreshPinnedBar();
}
async function unpinCurrentPinned() {
    if (!pinnedMessages.length) return;
    if (!confirm('Unpin this message?')) return;
    const p = pinnedMessages[pinnedIndex];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'unpin_msg', msg_id: p.id }));
    }
}
function doPin() {
    if (!contextMsgId) return;
    const isPinned = pinnedMessages.some(p => p.id === contextMsgId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: isPinned ? 'unpin_msg' : 'pin_msg', msg_id: contextMsgId }));
    }
    closeContextMenu();
}
// Update pin button label when context menu opens
function updatePinButtonLabel(msgId) {
    const t = document.getElementById('pinBtnText');
    if (!t) return;
    const isPinned = pinnedMessages.some(p => p.id === msgId);
    t.innerText = isPinned ? 'Unpin' : 'Pin';
}

// Hook into context menu opening
const __origShowContextMenu = (typeof showContextMenu === 'function') ? showContextMenu : null;
if (__origShowContextMenu) {
    window.showContextMenu = function(...args) {
        __origShowContextMenu.apply(this, args);
        if (typeof contextMsgId !== 'undefined') updatePinButtonLabel(contextMsgId);
    };
}

// Hook WS for pinned_changed events
const __origInitWS_Pin = (typeof initWebSocket === 'function') ? initWebSocket : null;
if (__origInitWS_Pin) {
    const wrapped = window.initWebSocket;
    window.initWebSocket = function() {
        wrapped();
        if (!ws) return;
        const prev = ws.onmessage;
        ws.onmessage = async function(event) {
            if (prev) await prev(event);
            try {
                const m = JSON.parse(event.data);
                if (m.type === 'pinned_changed' && m.room === currentRoom) {
                    pinnedMessages = m.pinned || [];
                    pinnedIndex = 0;
                    refreshPinnedBar();
                }
                else if (m.type === 'history' && m.room === currentRoom) {
                    // Request pinned list when history arrives
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ action: 'get_pinned', room: currentRoom }));
                    }
                }
            } catch {}
        };
    };
}

// Reset pinned bar when switching rooms
const __origOpenChat_Pin = (typeof openChat === 'function') ? openChat : null;
if (__origOpenChat_Pin) {
    const wrapped = window.openChat;
    window.openChat = function(...args) {
        wrapped.apply(this, args);
        pinnedMessages = [];
        pinnedIndex = 0;
        const bar = document.getElementById('pinnedBar');
        if (bar) bar.style.display = 'none';
        // get_pinned will be triggered by history hook above
    };
}

// =====================================================================
// Upload Progress Bar (XHR-based to track progress)
// =====================================================================
function createUploadProgressEl() {
    let el = document.getElementById('uploadProgressEl');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'uploadProgressEl';
    el.style.cssText = 'position:absolute; bottom:78px; left:50%; transform:translateX(-50%); z-index:10; background:var(--bg-panel); backdrop-filter:blur(15px); border:1px solid var(--border); padding:10px 14px; border-radius:14px; box-shadow:0 8px 28px rgba(0,0,0,0.4); min-width:240px; max-width:90%;';
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <div id="uploadProgressIcon" style="width:32px; height:32px; border-radius:8px; background:var(--c-blue); display:flex; align-items:center; justify-content:center; color:white; flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:18px; fill:currentColor;"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg></div>
            <div style="flex:1; min-width:0;">
                <div id="uploadProgressName" style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Uploading...</div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                    <div style="flex:1; height:5px; background:rgba(255,255,255,0.1); border-radius:10px; overflow:hidden;">
                        <div id="uploadProgressBar" style="height:100%; width:0%; background:linear-gradient(90deg, var(--c-blue), #4ba2ee); border-radius:10px; transition:width 0.2s;"></div>
                    </div>
                    <span id="uploadProgressPct" style="font-size:11px; font-weight:600; color:var(--c-gray); min-width:36px; text-align:right;">0%</span>
                </div>
            </div>
            <button onclick="cancelCurrentUpload()" style="background:transparent; border:none; color:var(--c-red); cursor:pointer; padding:4px;" title="Cancel"><svg viewBox="0 0 24 24" style="width:18px; fill:currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
        </div>
    `;
    document.querySelector('.chat-area')?.appendChild(el) || document.body.appendChild(el);
    return el;
}
let currentUploadXHR = null;
function cancelCurrentUpload() {
    if (currentUploadXHR) {
        try { currentUploadXHR.abort(); } catch {}
        currentUploadXHR = null;
    }
    const el = document.getElementById('uploadProgressEl');
    if (el) el.remove();
}

async function uploadWithProgress(file, fileName) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        currentUploadXHR = xhr;
        const fd = new FormData();
        fd.append('file', file, fileName || file.name);

        const progressEl = createUploadProgressEl();
        document.getElementById('uploadProgressName').innerText = fileName || file.name || 'File';
        document.getElementById('uploadProgressBar').style.width = '0%';
        document.getElementById('uploadProgressPct').innerText = '0%';

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                document.getElementById('uploadProgressBar').style.width = pct + '%';
                document.getElementById('uploadProgressPct').innerText = pct + '%';
            }
        });
        xhr.addEventListener('load', () => {
            currentUploadXHR = null;
            const el = document.getElementById('uploadProgressEl');
            if (el) el.remove();
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error('Invalid response')); }
            } else {
                let detail = xhr.responseText;
                try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
                reject(new Error(`HTTP ${xhr.status}: ${detail}`));
            }
        });
        xhr.addEventListener('error', () => {
            currentUploadXHR = null;
            const el = document.getElementById('uploadProgressEl');
            if (el) el.remove();
            reject(new Error('Network error'));
        });
        xhr.addEventListener('abort', () => {
            currentUploadXHR = null;
            const el = document.getElementById('uploadProgressEl');
            if (el) el.remove();
            reject(new Error('Upload cancelled'));
        });

        xhr.open('POST', '/api/upload', true);
        if (currentToken) xhr.setRequestHeader('Authorization', 'Bearer ' + currentToken);
        xhr.send(fd);
    });
}

// =====================================================================
// In-bubble upload preview with progress ring + cancel
// =====================================================================
function detectUploadKind(file) {
    if (!file) return 'file';
    const t = file.type || '';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'file';
}

function createUploadPlaceholder(file) {
    const messages = document.getElementById('messages');
    if (!messages) return null;
    const kind = detectUploadKind(file);
    const tempId = 'up_' + Math.random().toString(36).slice(2, 9);

    // Generate object URL for image/video preview
    let previewUrl = null;
    if (kind === 'image' || kind === 'video') {
        try { previewUrl = URL.createObjectURL(file); } catch {}
    }

    const row = document.createElement('div');
    row.className = 'msg-row out';
    row.id = 'upload-' + tempId;

    let mediaHtml = '';
    if (kind === 'image' && previewUrl) {
        mediaHtml = `<img src="${previewUrl}" style="max-width:280px; max-height:340px; border-radius:14px; display:block;">`;
    } else if (kind === 'video' && previewUrl) {
        mediaHtml = `<video src="${previewUrl}" muted style="max-width:280px; max-height:340px; border-radius:14px; display:block;"></video>`;
    } else if (kind === 'audio') {
        mediaHtml = `<div style="display:flex; align-items:center; gap:10px; padding:10px 14px; min-width:230px;">
            <div style="width:42px; height:42px; border-radius:50%; background:var(--c-blue); display:flex; align-items:center; justify-content:center; color:white;">🎤</div>
            <div><div style="font-weight:600; font-size:13px;">${(file.name||'Voice').replace(/[<>]/g,'')}</div><div style="font-size:11px; opacity:0.7;">${fmtBytes(file.size)}</div></div>
        </div>`;
    } else {
        // generic file
        mediaHtml = `<div class="file-link" style="margin-top:0;">
            <div class="file-icon"><svg style="width:24px;fill:white;"><use href="#icon-doc"></use></svg></div>
            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <span style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" dir="auto">${(file.name||'File').replace(/[<>]/g,'')}</span>
                <span style="font-size:11px; opacity:0.7;">${fmtBytes(file.size)} · Uploading...</span>
            </div>
        </div>`;
    }

    row.innerHTML = `
        <div class="bubble uploading-bubble" style="padding:4px; max-width:90%;">
            <div style="position:relative; border-radius:14px; overflow:hidden;">
                ${mediaHtml}
                <div class="upload-overlay">
                    <button class="upload-cancel-btn" type="button" data-temp-id="${tempId}" title="Cancel upload">
                        <div class="upload-ring">
                            <svg viewBox="0 0 56 56" width="56" height="56">
                                <circle class="ring-bg" cx="28" cy="28" r="24" fill="none" stroke-width="3"/>
                                <circle class="ring-fg" data-ring-for="${tempId}" cx="28" cy="28" r="24" fill="none" stroke-width="3" stroke-dasharray="150.8" stroke-dashoffset="150.8"/>
                            </svg>
                            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;">
                                <svg viewBox="0 0 24 24" style="width:18px; fill:white;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                            </div>
                        </div>
                    </button>
                </div>
            </div>
            <div class="upload-status" data-status-for="${tempId}" style="font-size:11px; color:var(--c-gray); margin-top:6px; text-align:right;">0% · Uploading...</div>
        </div>
    `;

    messages.appendChild(row);
    // Smooth-scroll to bottom
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });

    // Track for cancel
    row._previewUrl = previewUrl;
    row._tempId = tempId;
    return { row, tempId, previewUrl };
}

function updateUploadPlaceholder(tempId, pct) {
    const ring = document.querySelector(`circle[data-ring-for="${tempId}"]`);
    const status = document.querySelector(`[data-status-for="${tempId}"]`);
    if (ring) {
        const circumference = 150.8; // 2*PI*24
        const offset = circumference * (1 - (pct / 100));
        ring.style.strokeDashoffset = offset;
    }
    if (status) status.innerText = `${pct}% · Uploading...`;
}

function removeUploadPlaceholder(tempId) {
    const row = document.getElementById('upload-' + tempId);
    if (!row) return;
    if (row._previewUrl) { try { URL.revokeObjectURL(row._previewUrl); } catch{} }
    row.remove();
}

function setUploadPlaceholderError(tempId, errMsg) {
    const status = document.querySelector(`[data-status-for="${tempId}"]`);
    if (status) {
        status.innerText = '❌ ' + (errMsg || 'Upload failed');
        status.style.color = 'var(--c-red)';
    }
    const row = document.getElementById('upload-' + tempId);
    if (row) {
        row.querySelector('.uploading-bubble')?.classList.remove('uploading-bubble');
        // Auto remove after 4s
        setTimeout(() => removeUploadPlaceholder(tempId), 4000);
    }
}

// Better uploadWithProgress that integrates with in-bubble placeholder
async function uploadWithProgressInBubble(file, fileName, tempId) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const fd = new FormData();
        fd.append('file', file, fileName || file.name);

        // Track XHR by tempId so we can cancel by clicking the cancel button
        window._activeUploads = window._activeUploads || {};
        window._activeUploads[tempId] = xhr;

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                updateUploadPlaceholder(tempId, pct);
            }
        });
        xhr.addEventListener('load', () => {
            delete window._activeUploads[tempId];
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error('Invalid response')); }
            } else {
                let detail = xhr.responseText;
                try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
                reject(new Error(`HTTP ${xhr.status}: ${detail}`));
            }
        });
        xhr.addEventListener('error', () => {
            delete window._activeUploads[tempId];
            reject(new Error('Network error'));
        });
        xhr.addEventListener('abort', () => {
            delete window._activeUploads[tempId];
            reject(new Error('Upload cancelled'));
        });

        xhr.open('POST', '/api/upload', true);
        if (currentToken) xhr.setRequestHeader('Authorization', 'Bearer ' + currentToken);
        xhr.send(fd);
    });
}

// Wire up cancel button via event delegation
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.upload-cancel-btn');
    if (!btn) return;
    e.stopPropagation();
    const tempId = btn.getAttribute('data-temp-id');
    if (!tempId) return;
    const xhr = window._activeUploads && window._activeUploads[tempId];
    if (xhr) { try { xhr.abort(); } catch{} }
    removeUploadPlaceholder(tempId);
});

// Replace uploadFile to use in-bubble preview
window.uploadFile = async function() {
    const file = document.getElementById('fileInput').files[0];
    if (!file) return;
    if (myQuotaMB > 0) {
        const remaining = myQuotaMB * 1024 * 1024 - myUsedBytes;
        if (file.size > remaining) {
            alert(`Quota exceeded.\nRemaining: ${fmtBytes(Math.max(0, remaining))}\nFile size: ${fmtBytes(file.size)}`);
            document.getElementById('fileInput').value = '';
            return;
        }
    }
    const ph = createUploadPlaceholder(file);
    if (!ph) return;
    try {
        const data = await uploadWithProgressInBubble(file, file.name, ph.tempId);
        if (data.used_bytes != null) myUsedBytes = data.used_bytes;
        if (data.url) {
            // Send actual message; the placeholder will be replaced when the WS
            // echoes our own message back (or after a short delay if WS lags).
            removeUploadPlaceholder(ph.tempId);
            ws.send(JSON.stringify({
                action: 'send_msg', room: currentRoom, user: currentUser,
                targetUser: targetUserForDM, msgType: data.type,
                url: data.url, fileName: data.name, replyTo: replyToMsg
            }));
            cancelReply();
        } else {
            removeUploadPlaceholder(ph.tempId);
        }
    } catch (e) {
        if (e.message === 'Upload cancelled') {
            // already removed
        } else {
            setUploadPlaceholderError(ph.tempId, e.message);
        }
    }
    document.getElementById('fileInput').value = '';
};

// Also wire the album / multi-upload path
window.uploadMultipleImages = async function(files) {
    if (!files || !files.length) return;
    if (files.length === 1) {
        const dt = new DataTransfer();
        dt.items.add(files[0]);
        document.getElementById('fileInput').files = dt.files;
        return uploadFile();
    }
    const albumId = 'alb_' + Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ph = createUploadPlaceholder(file);
        if (!ph) continue;
        try {
            const data = await uploadWithProgressInBubble(file, file.name, ph.tempId);
            if (data.used_bytes != null) myUsedBytes = data.used_bytes;
            if (data.url) {
                removeUploadPlaceholder(ph.tempId);
                ws.send(JSON.stringify({
                    action: 'send_msg', room: currentRoom, user: currentUser,
                    targetUser: targetUserForDM, msgType: data.type,
                    url: data.url, fileName: data.name,
                    replyTo: i === 0 ? replyToMsg : null,
                    albumId, albumIndex: i, albumTotal: files.length,
                }));
            } else {
                removeUploadPlaceholder(ph.tempId);
            }
        } catch (e) {
            if (e.message !== 'Upload cancelled') {
                setUploadPlaceholderError(ph.tempId, e.message);
            }
        }
    }
    cancelReply();
};


// =====================================================================
// Telegram-style image collage (album)
// When a user selects multiple images at once, group them into an album.
// =====================================================================
async function uploadMultipleImages(files) {
    if (!files || !files.length) return;
    if (files.length === 1) {
        // Just one file - use the regular uploadFile flow
        document.getElementById('fileInput').files = createDataTransfer(files).files;
        return uploadFile();
    }
    const albumId = 'alb_' + Math.random().toString(36).slice(2, 10);
    let success = 0;
    for (let i = 0; i < files.length; i++) {
        try {
            const data = await uploadWithProgress(files[i]);
            if (data.used_bytes != null) myUsedBytes = data.used_bytes;
            if (data.url) {
                ws.send(JSON.stringify({
                    action: 'send_msg', room: currentRoom, user: currentUser,
                    targetUser: targetUserForDM, msgType: data.type,
                    url: data.url, fileName: data.name,
                    replyTo: i === 0 ? replyToMsg : null,
                    albumId: albumId,
                    albumIndex: i,
                    albumTotal: files.length,
                }));
                success++;
            }
        } catch (e) {
            if (e.message !== 'Upload cancelled') {
                alert('Upload failed for "' + files[i].name + '": ' + e.message);
            }
        }
    }
    if (success > 0) cancelReply();
}

function createDataTransfer(files) {
    const dt = new DataTransfer();
    Array.from(files).forEach(f => dt.items.add(f));
    return dt;
}

// Hook the file input to detect multi-select
function setupMultiUploadHook() {
    const input = document.getElementById('fileInput');
    if (!input || input._multiHooked) return;
    input._multiHooked = true;
    // Make the input accept multiple files
    input.setAttribute('multiple', 'multiple');
    // Listen for changes; if multiple, route through album uploader
    input.addEventListener('change', async () => {
        const files = input.files;
        if (!files || files.length === 0) return;
        if (files.length > 1) {
            // Filter only images for album mode
            const allImages = Array.from(files).every(f => f.type && f.type.startsWith('image/'));
            if (allImages) {
                await uploadMultipleImages(Array.from(files));
                input.value = '';
                return;
            }
            // Mixed types: upload one by one
            for (const f of Array.from(files)) {
                const dt = new DataTransfer();
                dt.items.add(f);
                input.files = dt.files;
                await uploadFile();
            }
            input.value = '';
            return;
        }
        // single file: default flow handled by original onchange attribute
    }, { capture: true });
}
setInterval(setupMultiUploadHook, 1500);

// =====================================================================
// Lightbox (tap image/video to view full)
// =====================================================================
function openLightbox(url, isVideo = false) {
    const lb = document.getElementById('lightbox');
    const content = document.getElementById('lightbox-content');
    if (!lb || !content) return;
    content.innerHTML = isVideo
        ? `<video src="${url}" controls autoplay style="max-width:95vw; max-height:95vh; border-radius:8px;"></video>`
        : `<img src="${url}" style="max-width:95vw; max-height:95vh; object-fit:contain; border-radius:8px;">`;
    lb.style.display = 'flex';
}
function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (lb) {
        lb.style.display = 'none';
        document.getElementById('lightbox-content').innerHTML = '';
    }
}
// ESC to close
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// =====================================================================
// Album/collage rendering — group consecutive images with same albumId
// =====================================================================
let albumGroups = {};  // albumId -> { images: [...], firstMsgId, lastUpdated }

function tryAttachToAlbum(data) {
    if (!data.albumId || data.msgType !== 'image') return false;
    const grp = albumGroups[data.albumId] = albumGroups[data.albumId] || { images: [], firstMsgId: null, owner: data.user };
    grp.images.push({ id: data.id, url: data.url });
    grp.lastUpdated = Date.now();

    // If this is the first one, render the album container
    if (!grp.firstMsgId) {
        grp.firstMsgId = data.id;
        return false;  // Let normal append happen for first; we'll convert after
    }
    // Hide subsequent message rows; just append the URL to the album in firstMsgId's bubble
    setTimeout(() => collapseAlbumIntoFirst(data.albumId), 30);
    return false;  // Don't block the original render; we'll mutate post-render
}

function collapseAlbumIntoFirst(albumId) {
    const grp = albumGroups[albumId];
    if (!grp || !grp.firstMsgId) return;
    const firstEl = document.getElementById('msg-' + grp.firstMsgId);
    if (!firstEl) return;
    const bubble = firstEl.querySelector('.bubble');
    if (!bubble) return;

    // Remove subsequent album items from DOM
    grp.images.slice(1).forEach(im => {
        const el = document.getElementById('msg-' + im.id);
        if (el) el.style.display = 'none';
    });

    // Replace existing image inside first bubble with the album grid
    const existingImg = bubble.querySelector('img');
    if (existingImg && !bubble.querySelector('.album')) {
        const albumDiv = document.createElement('div');
        const total = grp.images.length;
        let cls = 'album ';
        if (total === 2) cls += 'album-2';
        else if (total === 3) cls += 'album-3';
        else if (total === 4) cls += 'album-4';
        else cls += 'album-many';
        albumDiv.className = cls;
        const visibleCount = Math.min(total, total <= 4 ? total : 5);
        for (let i = 0; i < visibleCount; i++) {
            const img = grp.images[i];
            const itemDiv = document.createElement('div');
            itemDiv.style.position = 'relative';
            const imgEl = document.createElement('img');
            imgEl.className = 'album-item';
            imgEl.src = img.url;
            imgEl.onclick = (e) => { e.stopPropagation(); openLightbox(img.url, false); };
            itemDiv.appendChild(imgEl);
            // Show "+N" overlay on last item if more
            if (i === visibleCount - 1 && total > visibleCount) {
                const overlay = document.createElement('div');
                overlay.className = 'album-overlay-count';
                overlay.innerText = '+' + (total - visibleCount + 1);
                overlay.onclick = (e) => { e.stopPropagation(); openLightbox(img.url, false); };
                itemDiv.appendChild(overlay);
            }
            albumDiv.appendChild(itemDiv);
        }
        existingImg.replaceWith(albumDiv);
    } else if (bubble.querySelector('.album')) {
        // Already have an album; just append a new item if room
        const albumDiv = bubble.querySelector('.album');
        const newImage = grp.images[grp.images.length - 1];
        if (!albumDiv.querySelector(`img[src="${newImage.url}"]`)) {
            const itemDiv = document.createElement('div');
            itemDiv.style.position = 'relative';
            const imgEl = document.createElement('img');
            imgEl.className = 'album-item';
            imgEl.src = newImage.url;
            imgEl.onclick = (e) => { e.stopPropagation(); openLightbox(newImage.url, false); };
            itemDiv.appendChild(imgEl);
            albumDiv.appendChild(itemDiv);
            // Update class based on new count
            const cnt = albumDiv.children.length;
            albumDiv.className = 'album ' + (cnt === 2 ? 'album-2' : cnt === 3 ? 'album-3' : cnt === 4 ? 'album-4' : 'album-many');
        }
    }
}

// Hook appendMessage to attach to albums and add date dividers
const __origAppendMessage_ph4x = (typeof appendMessage === 'function') ? appendMessage : null;
if (__origAppendMessage_ph4x) {
    const wrapped = window.appendMessage;
    window.appendMessage = function(data) {
        // Insert date divider if needed (when day changes)
        try {
            const tsRaw = data.timestamp;
            if (tsRaw) {
                const dStr = formatDateDividerLabel(tsRaw);
                if (dStr && dStr !== window.__lastInsertedDateDivider) {
                    window.__lastInsertedDateDivider = dStr;
                    const messages = document.getElementById('messages');
                    if (messages) {
                        const div = document.createElement('div');
                        div.className = 'date-divider';
                        div.innerHTML = `<span>${dStr}</span>`;
                        messages.appendChild(div);
                    }
                }
            }
        } catch {}
        wrapped(data);
        // Attach to album if applicable
        if (data.albumId) {
            tryAttachToAlbum(data);
        }
    };
}

function formatDateDividerLabel(iso) {
    try {
        const d = new Date((iso.includes('T') ? iso : iso.replace(' ', 'T')) + (iso.endsWith('Z') ? '' : 'Z'));
        if (isNaN(d.getTime())) return '';
        const today = new Date();
        const yesterday = new Date(today.getTime() - 86400000);
        const sameDay = (a, b) => a.toDateString() === b.toDateString();
        if (sameDay(d, today)) return 'Today';
        if (sameDay(d, yesterday)) return 'Yesterday';
        const sevenDays = new Date(today.getTime() - 7 * 86400000);
        if (d > sevenDays) {
            return d.toLocaleDateString(undefined, { weekday: 'long' });
        }
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    } catch { return ''; }
}

// Reset divider tracker when switching rooms / loading history
const __origOpenChat_ph4x = (typeof openChat === 'function') ? openChat : null;
if (__origOpenChat_ph4x) {
    const wrapped = window.openChat;
    window.openChat = function(...args) {
        window.__lastInsertedDateDivider = null;
        wrapped.apply(this, args);
    };
}

// Auto-open lightbox when single bubble images are tapped
function setupSingleImageLightbox() {
    const messages = document.getElementById('messages');
    if (!messages || messages._lbHooked) return;
    messages._lbHooked = true;
    messages.addEventListener('click', (e) => {
        const t = e.target;
        if (t.tagName === 'IMG' && t.closest('.bubble') && !t.classList.contains('album-item')) {
            e.stopPropagation();
            openLightbox(t.src, false);
        }
        if (t.tagName === 'VIDEO' && t.closest('.bubble') && !t.closest('.video-msg-bubble')) {
            // Round video messages have their own controls; don't intercept
        }
    }, true);
}
setInterval(setupSingleImageLightbox, 1500);


// =====================================================================
// Telegram-style voice message player
// =====================================================================
function generateWaveformBars(count = 32) {
    // Pseudo-random heights based on a seed for a "natural" waveform look
    let bars = '';
    for (let i = 0; i < count; i++) {
        // Predictable but irregular heights between 25% and 100%
        const h = 25 + ((Math.sin(i * 1.7) + Math.sin(i * 0.9 + 1) + 2) * 18);
        bars += `<div class="wfbar" style="flex:1; min-width:2px; background:rgba(255,255,255,0.35); height:${Math.round(h)}%; border-radius:2px; transition:background 0.15s;"></div>`;
    }
    return bars;
}

let __activeVoiceId = null;

function toggleVoicePlay(audioId) {
    const audio = document.getElementById(audioId);
    if (!audio) return;
    // Stop any other currently-playing voice message
    if (__activeVoiceId && __activeVoiceId !== audioId) {
        const other = document.getElementById(__activeVoiceId);
        if (other) { try { other.pause(); } catch{} }
        const otherWrap = document.querySelector(`[data-audio-id="${__activeVoiceId}"]`);
        if (otherWrap) {
            otherWrap.querySelector('.voice-icon-play').style.display = 'block';
            otherWrap.querySelector('.voice-icon-pause').style.display = 'none';
        }
    }
    const wrap = document.querySelector(`[data-audio-id="${audioId}"]`);
    if (!wrap) return;
    const iconPlay = wrap.querySelector('.voice-icon-play');
    const iconPause = wrap.querySelector('.voice-icon-pause');

    if (audio.paused) {
        audio.play().catch(e => console.warn('Voice play failed:', e));
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
        __activeVoiceId = audioId;
        attachVoiceProgressListeners(audio, wrap);
    } else {
        audio.pause();
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    }
}

function attachVoiceProgressListeners(audio, wrap) {
    if (audio._listenersAttached) return;
    audio._listenersAttached = true;

    const timeEl = wrap.querySelector('.voice-time');
    const bars = wrap.querySelectorAll('.wfbar');
    const total = bars.length;

    const updateBars = () => {
        if (!audio.duration || !isFinite(audio.duration)) return;
        const pct = audio.currentTime / audio.duration;
        const filledCount = Math.floor(pct * total);
        bars.forEach((b, i) => {
            b.style.background = i < filledCount ? 'var(--c-blue)' : 'rgba(255,255,255,0.35)';
        });
    };
    const updateTime = () => {
        if (timeEl) timeEl.innerText = formatVoiceTime(audio.currentTime || 0) +
            (audio.duration && isFinite(audio.duration) ? ' / ' + formatVoiceTime(audio.duration) : '');
    };

    audio.addEventListener('timeupdate', () => { updateBars(); updateTime(); });
    audio.addEventListener('loadedmetadata', updateTime);
    audio.addEventListener('ended', () => {
        const iconPlay = wrap.querySelector('.voice-icon-play');
        const iconPause = wrap.querySelector('.voice-icon-pause');
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        audio.currentTime = 0;
        bars.forEach(b => b.style.background = 'rgba(255,255,255,0.35)');
    });
}

function formatVoiceTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' + sec : sec);
}

function seekVoiceByClick(e, audioId) {
    const audio = document.getElementById(audioId);
    if (!audio || !audio.duration) return;
    const wfm = e.currentTarget;
    const rect = wfm.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let pct = x / rect.width;
    if (pct < 0) pct = 0; if (pct > 1) pct = 1;
    audio.currentTime = pct * audio.duration;
}
