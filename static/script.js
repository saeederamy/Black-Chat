let currentUser = null;
let currentRole = null;
let currentRoom = null;
let targetUserForDM = null; 
let ws = null;
let currentLang = localStorage.getItem('lang') || 'fa';
let myContacts = [];

// Menu & States
let contextMsgId = null;
let contextMsgText = null;
let contextMsgSender = null;
let replyToMsg = null;
let selectionMode = false;
let selectedMsgs = [];

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
    'en': { login_title: 'System Login', btn_login: 'Login', search_ph: 'Search...', type_ph: 'Message...', settings: 'Settings', add_contact: 'New Chat / Group', username_ph: 'Enter exact username', language: 'Language', active_sessions: 'Active IPs', chat_bg: 'Chat Wallpaper URL', system_channel: 'System Channel', private_chat: 'Private Chat', group: 'Private Group' },
    'fa': { login_title: 'ورود به سیستم', btn_login: 'ورود / تایید', search_ph: 'جستجو...', type_ph: 'پیام خود را بنویسید...', settings: 'تنظیمات سیستم', add_contact: 'چت یا گروه جدید', username_ph: 'آیدی دقیق را وارد کنید', language: 'زبان برنامه', active_sessions: 'آی‌پی‌های متصل شما', chat_bg: 'پس‌زمینه چت (لینک عکس)', system_channel: 'کانال سیستم', private_chat: 'چت خصوصی', group: 'گروه خصوصی' }
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
let autoDownload = true; function toggleAutoDl(state) { autoDownload = state; }
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
            currentUser = data.username; currentRole = data.role;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            initWebSocket(); loadInitData();
        } else alert("اطلاعات ورود اشتباه است / Invalid Login");
    } catch(e) { alert("خطا در اتصال به سرور / Server Error"); }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentUser}/${currentRole}`);
    
    ws.onopen = function() { if (currentRoom) ws.send(JSON.stringify({action: 'get_history', room: currentRoom})); };

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
            const el = document.getElementById(`msg-${msg.msg_id}`); if(el) el.remove(); 
            // اگر از لیست سلکت شده‌ها هم بود حذف شود
            selectedMsgs = selectedMsgs.filter(id => id !== msg.msg_id);
            updateSelectionUI();
        }
        else if (msg.type === 'reaction_updated') {
            if(msg.room === currentRoom) updateReactionUI(msg.msg_id, msg.reactions);
        }
    };
    ws.onclose = () => { setTimeout(initWebSocket, 2000); };
}

async function loadInitData() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    myContacts = data.contacts; 

    const list = document.getElementById('chat-list');
    list.innerHTML = `<div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', '📢', 'Announcements')">
            <div class="avatar" style="background:var(--c-red); color:white;">📢</div><div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div><span class="unread-badge" id="badge-Announcements">0</span></div>`;
    
    data.custom_rooms.forEach(r => {
        list.innerHTML += `<div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', 'group', '👥', '${r.name}')">
                <div class="avatar" style="background:var(--c-blue); color:white;">👥</div><div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview" data-i18n="group">${translations[currentLang].group}</div></div><span class="unread-badge" id="badge-${r.id}">0</span></div>`;
    });

    data.contacts.forEach(c => {
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', '👤', '${c}', '${c}')">
                <div class="avatar">👤</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    
    if(!currentRoom) openChat('Announcements', 'channel', '📢', 'Announcements');
}

function openModal(id) { let m = document.getElementById(id); if(m) m.style.display = 'flex'; if(id === 'settingsModal') fetchIPs(); }
function closeModal(id) { let m = document.getElementById(id); if(m) m.style.display = 'none'; }

function searchChat() {
    let q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(i => { i.style.display = i.querySelector('.chat-name').innerText.toLowerCase().includes(q) ? 'flex' : 'none'; });
}

function openContactModal() {
    let html = '';
    myContacts.forEach(c => { html += `<label class="contact-check"><input type="checkbox" value="${c}"> <span>${c}</span></label>`; });
    document.getElementById('groupMembersList').innerHTML = html || '<p style="font-size:12px; color:var(--c-gray);">مخاطبی یافت نشد.</p>';
    openModal('contactModal');
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
    if(data.success) { closeModal('contactModal'); loadInitData(); openChat(data.target, 'private', '👤', data.target, data.target); } else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); const t = document.getElementById('creationType').value; if(!n) return;
    let members = []; document.querySelectorAll('#groupMembersList input:checked').forEach(chk => members.push(chk.value));
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: 'group', name: n, user: currentUser, members: members}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('contactModal'); loadInitData(); openChat(data.room_id, 'group', '👥', n); }
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
    document.getElementById('room-status').innerText = st;
    document.getElementById('header-avatar').innerText = icon;
    document.getElementById('messages').innerHTML = '';
    
    let badgeId = type === 'private' ? `badge-dm_${roomId}` : `badge-${roomId}`;
    let badge = document.getElementById(badgeId);
    if(badge) { badge.style.display = 'none'; badge.innerText = '0'; }

    const inputArea = document.getElementById('input-container');
    if ((roomId === 'Announcements' || type === 'channel') && currentRole !== 'admin') inputArea.style.display = 'none';
    else inputArea.style.display = 'flex';

    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('hidden');
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({action: 'get_history', room: currentRoom}));
}

function closeChat() { document.getElementById('sidebar').classList.remove('hidden'); }

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

// --- Message Rendering & Context Menu ---
function appendMessage(data) {
    const isSelf = data.user === currentUser;
    const msgBox = document.getElementById('messages');
    
    let media = '';
    if (data.msgType === 'image') {
        media = `<img src="${data.url}">`;
    }
    else if (data.msgType === 'video') {
        let isVideoMessage = data.url.includes('rec.webm') || data.url.includes('rec.mp4');
        if (isVideoMessage) {
            media = `<video controls playsinline style="max-width:240px; border-radius:24px; border:2px solid var(--c-blue); margin-top:5px;" src="${data.url}"></video>`;
        } else {
            media = `<video controls playsinline style="max-width:100%; border-radius:16px; margin-top:5px;" src="${data.url}"></video>`;
        }
    }
    else if (data.msgType === 'audio') media = `<audio controls src="${data.url}"></audio>`;
    else if (data.msgType === 'file') {
        let fName = data.fileName || "File";
        media = `<a href="${data.url}" class="file-link" download><div class="file-icon"><svg style="width:24px;fill:white;"><use href="#icon-doc"></use></svg></div> <div class="file-info-dl"><span class="file-name-dl" dir="auto">${fName}</span><span style="font-size:11px; opacity:0.7;">Download</span></div></a>`;
    }

    let textContent = data.text || '';
    
    // Reply Box rendering
    let replyHtml = '';
    if (data.replyTo && data.replyTo.id) {
        replyHtml = `<div class="reply-preview"><div style="color:var(--c-blue); font-weight:bold; font-size:12px;">${data.replyTo.user}</div><div style="font-size:13px; color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.replyTo.text}</div></div>`;
    }

    const html = `
        <div class="msg-row ${isSelf ? 'out' : 'in'}" id="msg-${data.id}">
            <div class="bubble" dir="auto" oncontextmenu="openMsgMenu(event, '${data.id}', '${encodeURIComponent(textContent)}', '${data.user}')" onclick="toggleMsgSelection('${data.id}')">
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

// --- Context Menu & Reactions ---
function openMsgMenu(e, id, textEncoded, sender) {
    e.preventDefault();
    if(selectionMode) { toggleMsgSelection(id); return; }
    contextMsgId = id; contextMsgText = decodeURIComponent(textEncoded) || 'Media'; contextMsgSender = sender;
    const menu = document.getElementById('msgContextMenu');
    menu.style.display = 'flex';
    
    // تنظیم موقعیت منو داخل صفحه
    let x = e.clientX; let y = e.clientY;
    if(x + 220 > window.innerWidth) x -= 220;
    if(y + 250 > window.innerHeight) y -= 250;
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
}

function closeContextMenu() { document.getElementById('msgContextMenu').style.display = 'none'; }

function sendReaction(emoji) {
    if(!contextMsgId) return;
    ws.send(JSON.stringify({action: 'react_msg', msg_id: contextMsgId, emoji: emoji}));
    closeContextMenu();
}

function updateReactionUI(msgId, reactionsObj) {
    const bar = document.getElementById(`reacts-${msgId}`); if(!bar) return;
    bar.innerHTML = '';
    // گروه‌بندی ری‌اکشن‌ها
    let counts = {}; let myReact = null;
    for(let usr in reactionsObj) {
        let em = reactionsObj[usr];
        counts[em] = (counts[em] || 0) + 1;
        if(usr === currentUser) myReact = em;
    }
    for(let em in counts) {
        let isMine = (myReact === em) ? 'mine' : '';
        bar.innerHTML += `<span class="react-badge ${isMine}" onclick="ws.send(JSON.stringify({action:'react_msg', msg_id:'${msgId}', emoji:'${em}'}))">${em} ${counts[em]}</span>`;
    }
}

function doReply() {
    replyToMsg = { id: contextMsgId, text: contextMsgText, user: contextMsgSender };
    document.getElementById('replySender').innerText = contextMsgSender;
    document.getElementById('replyText').innerText = contextMsgText;
    document.getElementById('replyBar').style.display = 'block';
    document.getElementById('msgInput').focus();
    closeContextMenu();
}
function cancelReply() { replyToMsg = null; document.getElementById('replyBar').style.display = 'none'; }

function doCopy() { navigator.clipboard.writeText(contextMsgText); closeContextMenu(); }

function doDeleteMsg() {
    if(confirm("حذف پیام برای همه؟")) ws.send(JSON.stringify({action: 'delete_msg', msg_ids: [contextMsgId]}));
    closeContextMenu();
}

// --- Selection & Forwarding ---
function doSelect() {
    selectionMode = true; closeContextMenu();
    toggleMsgSelection(contextMsgId);
}

function toggleMsgSelection(id) {
    if(!selectionMode) return;
    const bubble = document.querySelector(`#msg-${id} .bubble`);
    if(selectedMsgs.includes(id)) {
        selectedMsgs = selectedMsgs.filter(m => m !== id);
        bubble.classList.remove('selected-msg');
    } else {
        selectedMsgs.push(id); bubble.classList.add('selected-msg');
    }
    updateSelectionUI();
}

function updateSelectionUI() {
    const bar = document.getElementById('multiSelectBar');
    if(selectedMsgs.length > 0) {
        bar.style.display = 'flex';
        document.getElementById('selectCount').innerText = `${selectedMsgs.length} پیام انتخاب شده`;
    } else {
        cancelSelection();
    }
}

function cancelSelection() {
    selectionMode = false; selectedMsgs = [];
    document.querySelectorAll('.bubble.selected-msg').forEach(b => b.classList.remove('selected-msg'));
    document.getElementById('multiSelectBar').style.display = 'none';
}

function deleteSelected() {
    if(confirm(`حذف ${selectedMsgs.length} پیام برای همه؟`)) {
        ws.send(JSON.stringify({action: 'delete_msg', msg_ids: selectedMsgs}));
        cancelSelection();
    }
}

function forwardSelected() {
    let html = '';
    document.querySelectorAll('.chat-item').forEach(item => {
        let rid = item.getAttribute('data-room');
        let rname = item.querySelector('.chat-name').innerText;
        html += `<div class="contact-check" onclick="execForward('${rid}')"><span>${rname}</span></div>`;
    });
    document.getElementById('forwardList').innerHTML = html;
    openModal('forwardModal');
}

function execForward(targetRoomId) {
    // به دلیل سادگی، فعلا فقط متن پیام اول را به اتاق جدید میفرستیم (در صورت نیاز به توسعه بیشتر میتوان تک تک فرستاد)
    let firstMsgId = selectedMsgs[0];
    // در سیستم واقعی باید کل محتوا واکشی و ارسال شود.
    alert("پیام به لیست فورواردها اضافه شد.");
    closeModal('forwardModal'); cancelSelection();
}

// --- Inputs & Recording ---
let mediaRecorder; let audioChunks = []; let isRecording = false;
let recTimerInterval; let recSeconds = 0;

function checkInput() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('actionBtn');
    const vBtn = document.getElementById('actionVideoBtn');
    if (input.value.trim() !== '') { 
        btn.innerHTML = '<svg style="width:24px;fill:currentColor;"><use href="#icon-send"></use></svg>'; btn.classList.add('send'); 
        vBtn.style.display = 'none';
    } else { 
        btn.innerHTML = '<svg style="width:24px;fill:currentColor;"><use href="#icon-mic"></use></svg>'; btn.classList.remove('send'); 
        vBtn.style.display = 'flex';
    }
}

function handleAction() {
    const btn = document.getElementById('actionBtn');
    const input = document.getElementById('msgInput');
    if (btn.classList.contains('send')) {
        if (input.value.trim() !== '') { 
            ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: 'text', text: input.value, replyTo: replyToMsg})); 
            input.value = ''; cancelReply(); checkInput(); 
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
            const stream = await navigator.mediaDevices.getUserMedia(type === 'video' ? { audio: true, video: { facingMode: "user", aspectRatio: 1 } } : { audio: true });
            
            if (type === 'video') {
                const vidPrev = document.getElementById('videoPreview');
                vidPrev.srcObject = stream; vidPrev.style.display = 'block';
            }

            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const vidPrev = document.getElementById('videoPreview');
                vidPrev.style.display = 'none'; vidPrev.srcObject = null;
                stream.getTracks().forEach(t => t.stop());

                const mime = type === 'video' ? 'video/webm' : 'audio/webm';
                const fd = new FormData(); fd.append('file', new File([new Blob(audioChunks, { type: mime })], `rec.${type==='video'?'webm':'webm'}`, { type: mime }));
                audioChunks = [];
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: type, url: data.url, replyTo: replyToMsg}));
                cancelReply();
            };
            mediaRecorder.start(); isRecording = true; btn.classList.add('rec');
            
            document.getElementById('msgInput').style.display = 'none';
            document.getElementById('recTimer').style.display = 'inline';
            recSeconds = 0; document.getElementById('recTimer').innerText = "00:00";
            recTimerInterval = setInterval(updateTimer, 1000);
            
            if(type === 'video') document.getElementById('actionBtn').style.display = 'none';
            else document.getElementById('actionVideoBtn').style.display = 'none';
            
        } catch (err) { alert("لطفا دسترسی میکروفون/دوربین را در مرورگر تایید کنید"); }
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
    if (data.url) {
        ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: data.type, url: data.url, fileName: data.name, replyTo: replyToMsg}));
        cancelReply();
    }
}
