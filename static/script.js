const SERVER_CONFIG = {
    turnDomain: window.location.hostname,   
    turnPort: "3478",                 
    turnUser: "user",            
    turnPass: "pass"         
};

let currentUser = null; let currentRole = null; let currentRoom = null; let targetUserForDM = null; 
let ws = null; let currentLang = localStorage.getItem('lang') || 'fa'; let myContacts = [];
let contextMsgId = null; let contextMsgText = null; let contextMsgSender = null;
let replyToMsg = null; let selectionMode = false; let selectedMsgs = [];
let editMsgId = null; 
let autoDownload = true; 
let lastDateStr = null; 

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

// حفظ لاگین
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

function doLogout() { localStorage.removeItem('bc_user'); localStorage.removeItem('bc_role'); location.reload(); }

async function login() {
    const u = document.getElementById('username').value.trim(); const p = document.getElementById('password').value.trim();
    if (!u || !p) return;
    try {
        const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({username: u, password: p}), headers: {'Content-Type': 'application/json'} });
        const data = await res.json();
        if (data.success) {
            currentUser = data.username; currentRole = data.role;
            localStorage.setItem('bc_user', currentUser); localStorage.setItem('bc_role', currentRole);
            if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission();
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
                        if(!txtNode.innerHTML.includes('edited-tag')) txtNode.innerHTML += ' <span class="edited-tag">(ویرایش شده)</span>';
                    }
                }
            }
        }
        else if (msg.type === 'reaction_updated') { if(msg.room === currentRoom) updateReactionUI(msg.msg_id, msg.reactions); }
        else if (msg.type === 'webrtc') { handleWebRTC(msg.data); }
    };
    ws.onclose = () => { setTimeout(initWebSocket, 2000); };
    setInterval(() => { if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({action: 'ping'})); }, 15000);
}

let userAvatars = {};

async function loadInitData() {
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action: 'get_init_data', user: currentUser}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    myContacts = data.contacts; 
    if(data.all_avatars) userAvatars = data.all_avatars;
    
    if(data.avatar) { document.getElementById('my-avatar').src = data.avatar; document.getElementById('my-avatar').style.display='block'; document.getElementById('my-initial').style.display='none'; }

    const list = document.getElementById('chat-list');
    
    list.innerHTML = `<div class="chat-item" data-room="Announcements" onclick="openChat('Announcements', 'channel', 'Announcements')">
            <div class="avatar" style="background:var(--c-red); color:white;">📢</div><div class="chat-info"><div class="chat-name">Announcements</div><div class="chat-preview" data-i18n="system_channel">${translations[currentLang].system_channel}</div></div><span class="unread-badge" id="badge-Announcements">0</span></div>`;
    
    data.custom_rooms.forEach(r => {
        let sub = translations[currentLang].group;
        list.innerHTML += `<div class="chat-item" data-room="${r.id}" onclick="openChat('${r.id}', 'group', '${r.name.replace(/'/g, "\\'")}')">
                <div class="avatar" style="background:var(--c-blue); color:white;">👥</div><div class="chat-info"><div class="chat-name">${r.name}</div><div class="chat-preview">${sub}</div></div><span class="unread-badge" id="badge-${r.id}">0</span></div>`;
    });

    data.contacts.forEach(c => {
        let avHTML = userAvatars[c] ? `<img src="${userAvatars[c]}">` : '👤';
        list.innerHTML += `<div class="chat-item" data-room="${c}" onclick="openChat('${c}', 'private', '${c}', '${c}')">
                <div class="avatar">${avHTML}</div><div class="chat-info"><div class="chat-name">${c}</div><div class="chat-preview" data-i18n="private_chat">${translations[currentLang].private_chat}</div></div><span class="unread-badge" id="badge-dm_${c}">0</span></div>`;
    });
    
    if(!currentRoom) openChat('Announcements', 'channel', 'Announcements');
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeContextMenu() { document.getElementById('msgContextMenu').style.display = 'none'; }

function openCreateModal() {
    let html = '';
    myContacts.forEach(c => { 
        html += `<label class="contact-check"><input type="checkbox" value="${c}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--c-blue);"> <span>${c}</span></label>`; 
    });
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
    document.getElementById('ipList').innerHTML = data.ips.map(i => `<div style="border-bottom:1px solid var(--border); padding:8px 0;">🌐 ${i.ip} <br><span style="color:var(--c-gray); font-size:11px;">${i.date}</span></div>`).join('');
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
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.target, 'private', data.target, data.target); } else alert(data.msg);
}

async function submitCreation() {
    const n = document.getElementById('creationName').value.trim(); const t = document.getElementById('creationType').value || 'group'; if(!n) return;
    let members = []; document.querySelectorAll('#groupMembersList input:checked').forEach(chk => members.push(chk.value));
    const res = await fetch('/api/action', { method: 'POST', body: JSON.stringify({action:'create_room', type: t, name: n, user: currentUser, members: members}), headers: {'Content-Type': 'application/json'} });
    const data = await res.json();
    if(data.success) { closeModal('createModal'); loadInitData(); openChat(data.room_id, t, n); }
}

function openChat(roomId, type, title, targetUser = null) {
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
    if (type === 'private') headerAv = (targetUser && userAvatars[targetUser]) ? `<img src="${userAvatars[targetUser]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : '👤';
    document.getElementById('header-avatar').innerHTML = headerAv;

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

// Profile Shared Media
function openProfile() {
    if(!currentRoom) return;
    document.getElementById('prof-avatar').innerHTML = document.getElementById('header-avatar').innerHTML;
    document.getElementById('prof-name').innerText = document.getElementById('room-title').innerText;
    
    let mediaH = '', filesH = '', audioH = '', linksH = '';
    document.querySelectorAll('.bubble').forEach(b => {
        let msgId = b.parentElement.id; 
        let img = b.querySelector('img'); let vid = b.querySelector('video');
        if(img) mediaH += `<img src="${img.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="width:30%; height:80px; object-fit:cover; border-radius:8px; border:1px solid var(--border); cursor:pointer; transition:0.3s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">`;
        if(vid && !vid.classList.contains('video-msg')) mediaH += `<video src="${vid.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="width:30%; height:80px; object-fit:cover; border-radius:8px; border:1px solid var(--border); cursor:pointer;"></video>`;
        
        let aud = b.querySelector('audio'); 
        let vidMsg = b.querySelector('.video-msg');
        
        if(aud) audioH += `<div style="background:var(--bg-input); padding:10px; border-radius:12px; display:flex; align-items:center; gap:10px; width:100%; border:1px solid var(--border);"><div onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" style="background:var(--c-blue); width:40px; height:40px; border-radius:50%; display:flex; justify-content:center; align-items:center; color:white; flex-shrink:0; cursor:pointer; box-shadow:0 0 10px var(--c-blue-glow);">🎵</div><audio controls src="${aud.src}" style="height:35px; width:100%; outline:none;"></audio></div>`;
        if(vidMsg) audioH += `<video src="${vidMsg.src}" onclick="closeModal('profileModal'); scrollToMsg('${msgId}')" controls style="width:100px; height:100px; border-radius:50%; object-fit:cover; margin-bottom:5px; border:2px solid var(--c-blue); cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.3);"></video>`; 

        let link = b.querySelector('.file-link');
        if(link) filesH += `<a href="${link.href}" class="file-link" download>${link.innerHTML}</a>`;
        
        let txt = b.querySelector('.msg-text-content');
        if(txt) {
            let urls = txt.innerText.match(/https?:\/\/[^\s]+/g);
            if(urls) urls.forEach(u => linksH += `<a href="${u}" target="_blank" style="color:var(--c-blue); padding:10px; border-bottom:1px solid var(--border); display:block; border-radius:8px; background:var(--bg-input); margin-bottom:5px; transition:0.3s;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--bg-input)'">${u}</a>`);
        }
    });
    
    document.getElementById('tab-media').innerHTML = mediaH || '<p style="padding:20px; color:var(--c-gray); width:100%; text-align:center;">محتوایی یافت نشد.</p>';
    document.getElementById('tab-files').innerHTML = filesH || '<p style="padding:20px; color:var(--c-gray); width:100%; text-align:center;">فایلی یافت نشد.</p>';
    document.getElementById('tab-audio').innerHTML = audioH || '<p style="padding:20px; color:var(--c-gray); width:100%; text-align:center;">ویس/ویدیویی یافت نشد.</p>';
    document.getElementById('tab-links').innerHTML = linksH || '<p style="padding:20px; color:var(--c-gray); width:100%; text-align:center;">لینکی یافت نشد.</p>';
    
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
    // رفع باگ اصلی: دریافت نام فرستنده از مسیر درست
    let sender = msg.data.user; 
    let room = msg.room; 
    let isDM = room.startsWith('dm_');

    // مسدود کردن نوتیف‌های نامربوط
    if (isDM && !room.includes(currentUser)) return;
    if (!isDM && room !== 'Announcements' && msg.data.roomMembers && !msg.data.roomMembers.includes(currentUser)) return;

    // اگر چت طرف مقابل در سایدبار نبود، لیست را رفرش کن
    if (isDM && !document.querySelector(`.chat-item[data-room="${sender}"]`)) {
        loadInitData(); 
    }

    // تشخیص آیدی برای انداختن حباب
    let targetId = isDM ? sender : room;
    let badgeId = isDM ? `badge-dm_${targetId}` : `badge-${targetId}`;
    let badge = document.getElementById(badgeId);
    
    if(badge) { 
        badge.style.display = 'inline-block'; 
        badge.innerText = (parseInt(badge.innerText) || 0) + 1; 
    }
    
    try { document.getElementById('notif-sound').play(); } catch(e){}

    // ارسال پاپ‌آپ کروم (فقط وقتی تب مرورگر مخفی است)
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        let bodyText = msg.data.msgType === 'text' ? msg.data.text : "New Message 🖼️🎤";
        new Notification(sender, { body: bodyText });
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
        media = `<div style="display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.15); padding:6px 12px 6px 6px; border-radius:30px; margin-top:6px; border:1px solid rgba(255,255,255,0.05); box-shadow: 0 2px 8px rgba(0,0,0,0.1);"><div style="background:var(--c-blue); width:38px; height:38px; border-radius:50%; display:flex; justify-content:center; align-items:center; color:white; flex-shrink:0; font-size:18px; box-shadow:0 0 10px var(--c-blue-glow);">🎤</div><audio controls preload="metadata" src="${data.url}" style="height:32px; width:200px; outline:none; filter:grayscale(0.5);"></audio></div>`;
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

// 📌 رفع باگ بزرگ: محاسبه دقیق موقعیت برای جلوگیری از پرش‌های مزاحم کل صفحه 
function scrollToMsg(id) {
    const el = document.getElementById(id);
    const msgBox = document.getElementById('messages');
    if(el && msgBox) {
        const offsetTop = el.offsetTop - msgBox.offsetTop;
        msgBox.scrollTo({
            top: offsetTop - 60, // ۶۰ پیکسل فاصله از بالا برای دید بهتر
            behavior: 'smooth'
        });
        
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
    
    if(x + 240 > window.innerWidth) x = window.innerWidth - 250;
    if(y + 300 > window.innerHeight) y = window.innerHeight - 310;
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
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
function doDeleteMsg() { if(confirm("حذف پیام برای همه؟")) ws.send(JSON.stringify({action: 'delete_msg', msg_ids: [contextMsgId]})); closeContextMenu(); }

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
    if(selectedMsgs.length > 0) { bar.style.display = 'flex'; document.getElementById('selectCount').innerText = `${selectedMsgs.length} پیام`; } 
    else { cancelSelection(); }
}
function cancelSelection() {
    selectionMode = false; selectedMsgs = [];
    document.querySelectorAll('.bubble.selected-msg').forEach(b => b.classList.remove('selected-msg'));
    document.getElementById('multiSelectBar').style.display = 'none';
}
function deleteSelected() { if(confirm(`حذف ${selectedMsgs.length} پیام برای همه؟`)) { ws.send(JSON.stringify({action: 'delete_msg', msg_ids: selectedMsgs})); cancelSelection(); } }
function forwardSelected() {
    let html = '';
    document.querySelectorAll('.chat-item').forEach(item => {
        let rid = item.getAttribute('data-room');
        if(rid === 'Announcements' && currentRole !== 'admin') return; 
        let rname = item.querySelector('.chat-name').innerText;
        let avatar = item.querySelector('.avatar').innerHTML;
        html += `<div class="contact-check" onclick="execForward('${rid}')" style="border-bottom:1px solid var(--border); padding:10px; display:flex; align-items:center; gap:10px; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='none'"><div class="avatar" style="width:36px;height:36px;font-size:14px;border:none;">${avatar}</div> <span style="color:var(--c-white); font-weight:bold;">${rname}</span></div>`;
    });
    document.getElementById('forwardList').innerHTML = html || '<p style="text-align:center;color:gray;padding:15px;">چتی یافت نشد</p>';
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
document.getElementById('msgInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleSendText(); });

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
                    
                    const fd = new FormData(); fd.append('file', new File([new Blob(audioChunks, { type: mime })], fileName, { type: mime }));
                    audioChunks = []; 
                    const res = await fetch('/api/upload', { method: 'POST', body: fd });
                    const data = await res.json();
                    if(data.url) ws.send(JSON.stringify({action: 'send_msg', room: currentRoom, user: currentUser, targetUser: targetUserForDM, msgType: type, url: data.url, replyTo: replyToMsg}));
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
            
        } catch (err) { alert("لطفا دسترسی میکروفون/دوربین را در مرورگر مجاز کنید."); }
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
    if(window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert("⚠️ Voice Call requires HTTPS (SSL) to securely access your microphone. Please use a secure connection.");
        return;
    }

    if(!targetUserForDM) return;
    callTarget = targetUserForDM;
    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('callStatusText').innerText = "در حال تماس...";
    document.getElementById('callUserText').innerText = callTarget;
    document.getElementById('callBtns').innerHTML = `<button class="call-btn btn-rej" onclick="endCall()" style="background:var(--c-red); color:white;">✖</button>`;
    
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
        document.getElementById('callBtns').innerHTML = `<button class="call-btn btn-ans" onclick='acceptCall(${JSON.stringify(data.offer)})' style="background:#10b981; color:white;">📞</button><button class="call-btn btn-rej" onclick="endCall()" style="background:var(--c-red); color:white;">✖</button>`;
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
    document.getElementById('callBtns').innerHTML = `<button class="call-btn btn-rej" onclick="endCall()" style="background:var(--c-red); color:white;">✖</button>`;
    
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
