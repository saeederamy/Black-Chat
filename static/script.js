// =========================================================
// ⚙️ WebRTC STUN/TURN Config (Prepared for Iran Servers - MCI fix)
// =========================================================
const SERVER_CONFIG = {
    turnDomain: window.location.hostname,   
    turnPort: "3478",                 
    turnUser: "user",            
    turnPass: "pass"         
};

let currentUser = null;
let currentRole = null;
let currentRoom = null;
let targetUserForDM = null; 
let ws = null;
let currentLang = localStorage.getItem('lang') || 'fa';
let myContacts = [];

let contextMsgId = null; let contextMsgText = null; let contextMsgSender = null;
let replyToMsg = null; let selectionMode = false; let selectedMsgs = [];

let savedTheme = localStorage.getItem('hub_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
function toggleTheme() {
    savedTheme = savedTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    localStorage.setItem('hub_theme', savedTheme);
}

let savedBg = localStorage.getItem('chatBg');
if(savedBg) document.getElementById('chatArea').style.backgroundImage = `url('${savedBg}')`;

const translations = {
    'en': { login_title: 'System Login', btn_login: 'Login', search_ph: 'Search...', type_ph: 'Message...', settings: 'Settings', add_contact: 'New Chat / Group', username_ph: 'Enter exact username', language: 'Language', active_sessions: 'Active IPs (Real IP)', chat_bg: 'Chat Wallpaper URL', system_channel: 'System Channel', private_chat: 'Private Chat', group: 'Private Group', channel: 'Public Channel' },
    'fa': { login_title: 'ورود به سیستم', btn_login: 'ورود / تایید', search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...', settings: 'تنظیمات سیستم', add_contact: 'چت یا گروه جدید', username_ph: 'آیدی دقیق را وارد کنید', language: 'زبان برنامه', active_sessions: 'آی‌پی‌های متصل شما', chat_bg: 'پس‌زمینه چت (لینک عکس)', system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه خصوصی', channel: 'کانال عمومی' }
};

function applyLang() {
    document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
    let langSel = document.getElementById('langSelect'); if(langSel) langSel.value = currentLang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerText = translations[currentLang][el.getAttribute('data-i18n')]; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = translations[currentLang][el.getAttribute('data-i18n-ph')]; });
}
applyLang();
function changeLang(lang) { currentLang = lang; localStorage.setItem('lang', lang); applyLang(); }

let autoDownload = true; function toggleAutoDl(state) { autoDownload = state; }
function changeBg(url) { 
    if(url.trim() === '') { localStorage.removeItem('chatBg'); document.getElementById('chatArea').style.backgroundImage = 'none'; }
    else { localStorage.setItem('chatBg', url); document.getElementById('chatArea').style.backgroundImage = `url('${url}')`; }
}

// سیستم حفظ لاگین
window.onload = () => {
    const s_usr = localStorage.getItem('bc_user');
    const s_role = localStorage.getItem('bc_role');
    if (s_usr && s_role) {
        currentUser = s_usr; currentRole = s_role;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        initWebSocket(); loadInitData();
    }
};

function doLogout() {
    localStorage.removeItem('bc_user');
    localStorage.removeItem('bc_role');
    location.reload();
}

async function login() {
    const u = document.getElementById('username').value.trim(); const p = document.getElementById('password').value.trim();
    if (!u || !p) return;
    try {
        const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'} });
        const data = await res.json();
        if (data.success) {
            currentUser = data.username; currentRole = data.role;
            localStorage.setItem('bc_user', currentUser); localStorage.setItem('bc_role', currentRole);
            document.getElementById('login-screen').style.display = 'none'; document.getElementById('app').style.display = 'flex';
            initWebSocket(); loadInitData();
        } else alert("اطلاعات ورود اشتباه است");
    } catch(e) { alert("خطا در اتصال به سرور"); }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentUser}/${currentRole}`);
    ws.onopen = () => { if (currentRoom) ws.send(JSON.stringify({action: 'get_history', room: currentRoom})); };
    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') { 
            if(msg.room === currentRoom) { document.getElementById('messages').innerHTML = ''; msg.data.forEach(m => appendMessage(m)); }
        } 
        else if (msg.type === 'new_msg') { 
            if(msg.room === currentRoom) appendMessage(msg.data); else handleNotification(msg);
        }
        else if (msg.type === 'deleted') { 
            const el = document.getElementById(`msg-${msg.msg_id}`); if(el) el.remove(); 
            selectedMsgs = selectedMsgs.filter(id => id !== msg.msg_id); updateSelectionUI();
        }
        else if (msg.type === 'reaction_updated') { if(msg.room === currentRoom) updateReactionUI(msg.msg_id, msg.reactions); }
        else if (msg.type === 'webrtc') { handleWebRTC(msg.data); }
    };
    ws.onclose = () => { setTimeout(initWebSocket, 2000); };

    // پینگ کلودفلر/اروان برای زنده نگه داشتن سوکت
    setInterval(() => {
        if(ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({action: 'ping'})); }
    }, 15000);
}

let userAvatars = {};

async function loadInitData() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    myContacts = data.contacts; 
    if(data.all_avatars) userAvatars = data.all_avatars;
    
    if(data.avatar) { document.getElementById('my-avatar').src = data.avatar; document.getElementById('my-avatar').style.display='block'; document.getElementById('my-initial').style.display='none'; }

    const list = document.getElementById('chat-list');
    list.innerHTML = `<div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', '📢', 'Announcements')">
            <div class="avatar" style="background:var(--c-red); color:white;">📢</div><div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div><span class="unread-badge" id="badge-Announcements">0</span></div>`;
    
    data.custom_rooms.forEach(r => {
        let icon = r.type === 'group' ? '👥' : '📢';
        let sub = r.type === 'group' ? translations[currentLang].group : translations[currentLang].channel;
        list.innerHTML += `<div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', '${r.type}', '${icon}', '${r.name}')">
                <div class="avatar" style="background:var(--c-blue); color:white;">${icon}</div><div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview">${sub}</div></div><span class="unread-badge" id="badge-${r.id}">0</span></div>`;
    });

    data.contacts.forEach(c => {
        let av = userAvatars[c] ? `<img src="${userAvatars[c]}">` : '👤';
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', \`${av}\`, '${c}', '${c}')">
                <div class="avatar">${av}</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    
    if(!currentRoom) openChat('Announcements', 'channel', '📢', 'Announcements');
}

function openModal(id) { let m = document.getElementById(id); if(m) m.style.display = 'flex'; if(id === 'settingsModal') fetchIPs(); }
function closeModal(id) { let m = document.getElementById(id); if(m) m.style.display = 'none'; }
function closeContextMenu() { document.getElementById('msgContextMenu').style.display = 'none'; }

function openCreateModal() {
    let html = '';
    myContacts.forEach(c => { html += `<label class="custom-checkbox" style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); cursor:pointer;"><input type="checkbox" value="${c}" style="width:18px;height:18px;"> <span>${c}</span></label>`; });
    document.getElementById('groupMembersList').innerHTML = html || '<p style="font-size:12px; color:var(--c-gray);">مخاطبی یافت نشد.</p>';
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
    let q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(i => { i.style.display = i.querySelector('.chat-name').innerText.toLowerCase().includes(q) ? 'flex' : 'none'; });
}

async function fetchIPs() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_ips', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    document.getElementById('ipList').innerHTML = data.ips.map(i => `<div style="border-bottom:1px solid var(--border); padding:5px 0;">🌐 ${i.ip} <br><span style="color:var(--c-gray);">${i.date}</span></div>`).join('');
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
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.target, 'private', '👤', data.target, data.target); } else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); const t = document.getElementById('creationType').value; if(!n) return;
    let members = []; document.querySelectorAll('#groupMembersList input:checked').forEach(chk => members.push(chk.value));
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: t, name: n, user: currentUser, members: members}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.room_id, t, t==='group'?'👥':'📢', n); }
}

function openChat(roomId, type, icon, title, targetUser = null) {
    document.querySelectorAll('.chat-item').forEach(c => c.classList.remove('active'));
    let activeItem = document.querySelector(`.chat-item[data-room="${roomId}"]`);
    if(activeItem) activeItem.classList.add('active');

    targetUserForDM = targetUser; cancelSelection(); cancelReply();
    let realRoomId = roomId;
    if (type === 'private') { const users = [currentUser, roomId].sort(); realRoomId = `dm_${users.join('-')}`; }
    currentRoom = realRoomId;

    document.getElementById('room-title').innerText = title;
    let st = type === 'channel' ? translations[currentLang].system_channel : (type === 'group' ? translations[currentLang].group : translations[currentLang].private_chat);
    if(roomId === 'Announcements') st = translations[currentLang].system_channel;
    document.getElementById('room-status').innerText = st;
    document.getElementById('header-avatar').innerHTML = icon; 
    document.getElementById('messages').innerHTML = '';
    
    let badgeId = type === 'private' ? `badge-dm_${roomId}` : `badge-${roomId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'none'; badge.innerText = '0'; }

    const inputArea = document.getElementById('input-container');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') inputArea.style.display = 'none';
    else inputArea.style.display = 'flex';
    
    if(type === 'private') document.getElementById('callBtn').style.display = 'flex';
    else document.getElementById('callBtn').style.display = 'none';

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
        let img = b.querySelector('img'); let vid = b.querySelector('video');
        if(img) mediaH += `<img src="${img.src}" style="width:30%; height:80px; object-fit:cover; border-radius:8px; border:1px solid var(--border);">`;
        if(vid && !vid.classList.contains('video-msg')) mediaH += `<video src="${vid.src}" style="width:30%; height:80px; object-fit:cover; border-radius:8px; border:1px solid var(--border);"></video>`;
        
        let aud = b.querySelector('audio'); let vidMsg = b.querySelector('.video-msg');
        if(aud) audioH += `<audio controls src="${aud.src}" style="width:100%; height:40px; margin-bottom:5px; border-radius:20px;"></audio>`;
        if(vidMsg) audioH += `<video src="${vidMsg.src}" controls style="width:100px; height:100px; border-radius:50%; object-fit:cover; margin-bottom:5px; border:2px solid var(--c-blue);"></video>`; 

        let link = b.querySelector('.file-link');
        if(link) filesH += `<a href="${link.href}" class="file-link" download>${link.innerHTML}</a>`;
        
        let txt = b.innerText;
        let urls = txt.match(/https?:\/\/[^\s]+/g);
        if(urls) urls.forEach(u => linksH += `<a href="${u}" target="_blank" style="color:var(--c-blue); padding:10px; border-bottom:1px solid var(--border); display:block;">${u}</a>`);
    });
    
    document.getElementById('tab-media').innerHTML = mediaH || '<p style="padding:20px; color:var(--c-gray);">محتوایی یافت نشد.</p>';
    document.getElementById('tab-files').innerHTML = filesH || '<p style="padding:20px; color:var(--c-gray);">فایلی یافت نشد.</p>';
    document.getElementById('tab-audio').innerHTML = audioH || '<p style="padding:20px; color:var(--c-gray);">ویس/ویدیویی یافت نشد.</p>';
    document.getElementById('tab-links').innerHTML = linksH || '<p style="padding:20px; color:var(--c-gray);">لینکی یافت نشد.</p>';
    
    switchProfTab('media', document.querySelector('.prof-tab'));
    openModal('profileModal');
}

function switchProfTab(tab, btn) {
    document.querySelectorAll('.prof-tab').forEach(b => { b.style.color = 'var(--c-gray)'; b.style.borderBottomColor = 'transparent'; });
    btn.style.color = 'var(--c-blue)'; btn.style.borderBottomColor = 'var(--c-blue)';
    document.querySelectorAll('.prof-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'flex';
}

function handleNotification(msg) {
    let isDM = msg.room.startsWith('dm_');
    if (isDM && !msg.room.includes(currentUser)) return;
    if (msg.data.roomMembers && !msg.data.roomMembers.includes(currentUser)) return;
    if (isDM && !document.querySelector(`.chat-item[data-room="${msg.data.user}"]`)) loadInitData(); 

    let targetId = isDM ? msg.data.user : msg.room;
    let badge = document.getElementById(`badge-${isDM ? 'dm_'+targetId : targetId}`);
    if(badge) { badge.style.display = 'inline-block'; badge.innerText = parseInt(badge.innerText) + 1; }
    try { document.getElementById('notif-sound').play(); } catch(e){}
}

function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image') media = `<img src="${data.url}">`;
    else if (data.msgType === 'video') {
        let isVideoMessage = data.url.includes('rec.webm') || data.url.includes('rec.mp4');
        if (isVideoMessage) {
            media = `<video class="video-msg" autoplay loop muted playsinline src="${data.url}" onclick="this.muted = !this.muted;"></video>`;
        } else {
            media = `<video controls playsinline style="max-width:100%; border-radius:12px; margin-top:5px;" src="${data.url}"></video>`;
        }
    }
    else if (data.msgType === 'audio') media = `<audio controls preload="metadata" src="${data.url}"></audio>`;
    else if (data.msgType === 'file') {
        let fName = data.fileName || "File";
        media = `<a href="${data.url}" class="file-link" download><div class="file-icon"><svg style="width:24px;fill:white;"><use href="#icon-doc"></use></svg></div> <div class="file-info-dl"><span class="file-name-dl" dir="auto">${fName}</span><span style="font-size:11px; opacity:0.7;">Download</span></div></a>`;
    }

    let textContent = data.text || '';
    let replyHtml = '';
    if (data.replyTo && data.replyTo.id) {
        replyHtml = `<div class="reply-preview" onclick="scrollToMsg('msg-${data.replyTo.id}')"><div style="color:var(--c-blue); font-weight:bold; font-size:12px;">${data.replyTo.user}</div><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.replyTo.text}</div></div>`;
    }

    let isOnlyVidMsg = data.msgType === 'video' && (data.url.includes('rec.webm') || data.url.includes('rec.mp4')) && !textContent;
    let bubbleClass = isOnlyVidMsg ? "bubble video-msg-bubble" : "bubble normal-msg";

    const html = `
        <div class="msg-row ${isSelf ? 'out' : 'in'}" id="msg-${data.id}">
            <div class="${bubbleClass}" dir="auto" oncontextmenu="openMsgMenu(event, '${data.id}', '${encodeURIComponent(textContent)}', '${data.user}')" onclick="toggleMsgSelection('${data.id}')">
                <span class="sender-name">${data.user}</span>
                ${replyHtml}
                ${textContent}
                ${media}
                <div class="reactions-bar" id="reacts-${data.id}"></div>
            </div>
        </div>`;
    
    msgBox.insertAdjacentHTML('beforeend', html);
    if(data.reactions) updateReactionUI(data.id, data.reactions);
    msgBox.scrollTop = msgBox.scrollHeight;
}

function scrollToMsg(id) {
    const el = document.getElementById(id);
    if(el) { el.scrollIntoView({behavior: 'smooth', block: 'center'}); }
}

function openMsgMenu(e, id, textEncoded, sender) {
    e.preventDefault();
    if(selectionMode) { toggleMsgSelection(id); return; }
    contextMsgId = id; contextMsgText = decodeURIComponent(textEncoded) || 'Media'; contextMsgSender = sender;
    const menu = document.getElementById('msgContextMenu');
    menu.style.display = 'flex';
    let x = e.clientX; let y = e.clientY;
    if(x + 220 > window.innerWidth) x -= 220;
    if(y + 250 > window.innerHeight) y -= 250;
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
}

function sendReaction(emoji) { if(!contextMsgId) return; ws.send(JSON.stringify({action: 'react_msg', msg_id: contextMsgId, emoji: emoji})); closeContextMenu(); }

function updateReactionUI(msgId, reactionsObj) {
    const bar = document.getElementById(`reacts-${msgId}`); if(!bar) return;
    bar.innerHTML = ''; let counts = {}; let myReact = null;
    for(let usr in reactionsObj) { let em = reactionsObj[usr]; counts[em] = (counts[em] || 0) + 1; if(usr === currentUser) myReact = em; }
    for(let em in counts) { let isMine = (myReact === em) ? 'mine' : ''; bar.innerHTML += `<span class="react-badge ${isMine}" onclick="ws.send(JSON.stringify({action:'react_msg', msg_id:'${msgId}', emoji:'${em}'}))">${em} ${counts[em]}</span>`; }
}

function doReply() { replyToMsg = { id: contextMsgId, text: contextMsgText, user: contextMsgSender }; document.getElementById('replySender').innerText = contextMsgSender; document.getElementById('replyText').innerText = contextMsgText; document.getElementById('replyBar').style.display = 'block'; document.getElementById('msgInput').focus(); closeContextMenu(); }
function cancelReply() { replyToMsg = null; document.getElementById('replyBar').style.display = 'none'; }
function doCopy() { navigator.clipboard.writeText(contextMsgText); closeContextMenu(); }
function doDeleteMsg() { if(confirm("حذف پیام برای همه؟")) ws.send(JSON.stringify({action: 'delete_msg', msg_ids: [contextMsgId]})); closeContextMenu(); }

function doSelect() { selectionMode = true; closeContextMenu(); toggleMsgSelection(contextMsgId); }
function toggleMsgSelection(id) {
    if(!selectionMode) return;
    const bubble = document.querySelector(`#msg-${id} .bubble`);
    if(selectedMsgs.includes(id)) { selectedMsgs = selectedMsgs.filter(m => m !== id); bubble.classList.remove('selected-msg'); } 
    else { selectedMsgs.push(id); bubble.classList.add('selected-msg'); }
    updateSelectionUI();
}
function updateSelectionUI() {
    const bar = document.getElementById('multiSelectBar');
    if(selectedMsgs.length > 0) { bar.style.display = 'flex'; document.getElementById('selectCount').innerText = `${selectedMsgs.length} پیام`; } 
    else { cancelSelection(); }
}
function cancelSelection() {
    selectionMode = false; selectedMsgs = [];
    document.querySelectorAll('.bubble.selected-msg').forEach(b => b.classList.remove('selected-msg'));
    document.getElementById('multiSelectBar').style.display = 'none';
}
function deleteSelected() { if(confirm(`حذف ${selectedMsgs.length} پیام برای همه؟`)) { ws.send(JSON.stringify({action: 'delete_msg', msg_ids: selectedMsgs})); cancelSelection(); } }
function forwardSelected() { alert("امکان هدایت به زودی..."); cancelSelection(); }

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
        ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: 'text', text: input.value, replyTo: replyToMsg})); 
        input.value = ''; cancelReply(); checkInput(); 
    }
}

document.getElementById('msgInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleSendText(); });

function updateTimer() {
    if(!isPaused) { recSeconds++; let m = String(Math.floor(recSeconds / 60)).padStart(2, '0'); let s = String(recSeconds % 60).padStart(2, '0'); document.getElementById('recTimer').innerText = `${m}:${s}`; }
}

async function startRecord(type, btn) {
    if (!isRecording) {
        try {
            const constraints = type === 'video' ? { audio: true, video: { facingMode: "user", aspectRatio: 1 } } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (type === 'video') { const vidPrev = document.getElementById('videoPreview'); vidPrev.srcObject = stream; vidPrev.style.display = 'block'; }

            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                if(type === 'video') { const vidPrev = document.getElementById('videoPreview'); vidPrev.style.display = 'none'; vidPrev.srcObject = null; }
                stream.getTracks().forEach(t => t.stop());

                if(audioChunks.length > 0) {
                    const mime = type === 'video' ? 'video/webm' : 'audio/webm';
                    const fd = new FormData(); fd.append('file', new File([new Blob(audioChunks, { type: mime })], `rec.${type==='video'?'mp4':'webm'}`, { type: mime }));
                    audioChunks = [];
                    const res = await fetch('/api/upload', { method: 'POST', body: fd });
                    const data = await res.json();
                    if(data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: type, url: data.url, replyTo: replyToMsg}));
                    cancelReply();
                }
            };
            mediaRecorder.start(); isRecording = true; isPaused = false;
            
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
            
        } catch (err) { alert("لطفا دسترسی میکروفون/دوربین را مجاز کنید."); }
    }
}

function pauseResumeRecord() {
    const btn = document.getElementById('pauseRecBtn');
    if(isPaused) { mediaRecorder.resume(); isPaused = false; btn.innerHTML = '<svg style="width:22px;fill:currentColor;"><use href="#icon-pause"></use></svg>'; btn.style.color = "var(--c-blue)";}
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
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) { ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: data.type, url: data.url, fileName: data.name, replyTo: replyToMsg})); cancelReply(); }
}

// --- WebRTC Voice Call ---
let localStreamCall; let peerConnection; let callTarget;

const servers = { 
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' },
        { 
            'urls': `turn:${SERVER_CONFIG.turnDomain}:${SERVER_CONFIG.turnPort}`,
            'username': SERVER_CONFIG.turnUser,
            'credential': SERVER_CONFIG.turnPass
        }
    ],
    'iceTransportPolicy': 'all'
};

async function startCall() {
    if(!targetUserForDM) return;
    callTarget = targetUserForDM;
    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('callStatusText').innerText = "در حال تماس...";
    document.getElementById('callUserText').innerText = callTarget;
    document.getElementById('callBtns').innerHTML = `<button class="icon-btn" onclick="endCall()" style="background:var(--c-red); color:white; width:60px; height:60px; font-size:24px;">✖</button>`;
    
    try {
        localStreamCall = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection = new RTCPeerConnection(servers);
        localStreamCall.getTracks().forEach(t => peerConnection.addTrack(t, localStreamCall));
        
        peerConnection.onicecandidate = e => { if(e.candidate) ws.send(JSON.stringify({action: 'webrtc', type: 'ice', targetUser: callTarget, candidate: e.candidate, from: currentUser})); };
        peerConnection.ontrack = e => { document.getElementById('remoteAudio').srcObject = e.streams[0]; };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({action: 'webrtc', type: 'offer', targetUser: callTarget, offer: offer, from: currentUser}));
    } catch(err) { alert("عدم دسترسی به میکروفون!"); endCall(false); }
}

function handleWebRTC(data) {
    if(data.targetUser !== currentUser) return;
    
    if(data.type === 'offer') {
        callTarget = data.from;
        document.getElementById('callModal').style.display = 'flex';
        document.getElementById('callStatusText').innerText = "تماس ورودی...";
        document.getElementById('callUserText').innerText = callTarget;
        document.getElementById('callBtns').innerHTML = `<button class="icon-btn" onclick='acceptCall(${JSON.stringify(data.offer)})' style="background:#52c41a; color:white; width:60px; height:60px; font-size:24px;">📞</button><button class="icon-btn" onclick="endCall()" style="background:var(--c-red); color:white; width:60px; height:60px; font-size:24px;">✖</button>`;
        try { document.getElementById('notif-sound').play(); } catch(e){}
    }
    else if(data.type === 'answer') {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        document.getElementById('callStatusText').innerText = "در حال مکالمه";
    }
    else if(data.type === 'ice') {
        if(peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
    else if(data.type === 'end') {
        endCall(false);
    }
}

async function acceptCall(offerData) {
    document.getElementById('callStatusText').innerText = "در حال اتصال...";
    document.getElementById('callBtns').innerHTML = `<button class="icon-btn" onclick="endCall()" style="background:var(--c-red); color:white; width:60px; height:60px; font-size:24px;">✖</button>`;
    
    try {
        localStreamCall = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection = new RTCPeerConnection(servers);
        localStreamCall.getTracks().forEach(t => peerConnection.addTrack(t, localStreamCall));
        
        peerConnection.onicecandidate = e => { if(e.candidate) ws.send(JSON.stringify({action: 'webrtc', type: 'ice', targetUser: callTarget, candidate: e.candidate, from: currentUser})); };
        peerConnection.ontrack = e => { document.getElementById('remoteAudio').srcObject = e.streams[0]; };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({action: 'webrtc', type: 'answer', targetUser: callTarget, answer: answer, from: currentUser}));
        document.getElementById('callStatusText').innerText = "در حال مکالمه";
    } catch(err) { alert("عدم دسترسی به میکروفون!"); endCall(); }
}

function endCall(notifyOther = true) {
    if(peerConnection) peerConnection.close();
    if(localStreamCall) localStreamCall.getTracks().forEach(t => t.stop());
    peerConnection = null; localStreamCall = null;
    document.getElementById('callModal').style.display = 'none';
    document.getElementById('remoteAudio').srcObject = null;
    if(notifyOther && callTarget) ws.send(JSON.stringify({action: 'webrtc', type: 'end', targetUser: callTarget, from: currentUser}));
    callTarget = null;
}
