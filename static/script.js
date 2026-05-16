/* ============================================================
   Black Chat — frontend (v2, clean rewrite)
   ============================================================ */
'use strict';

// ============================================================
// 1. STATE
// ============================================================
const State = {
    token: localStorage.getItem('bc_token') || null,
    user: localStorage.getItem('bc_user') || null,
    role: localStorage.getItem('bc_role') || null,
    quotaMB: 0,
    usedBytes: 0,
    contacts: [],
    rooms: [],            // [{id, name, type: 'dm'|'group', members?, avatar?}]
    allUsers: [],
    avatars: {},          // username -> url
    currentRoom: null,    // {id, name, type, partner?}
    onlineUsers: [],
    lastSeen: {},
    messages: {},         // roomId -> [msg]
    unread: {},           // roomId -> count
    pinned: {},           // roomId -> [msg]
    pinnedIdx: 0,
    replyTo: null,
    editId: null,
    selectionMode: false,
    selectedIds: new Set(),
    typingTimers: {},     // roomId -> timeout
    typing: {},           // roomId -> {user, expires}
    ws: null,
    appName: 'Black Chat',
};

// ============================================================
// 2. SAFE HTML / UTIL
// ============================================================
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtBytes(n) {
    if (!n || n < 1024) return (n || 0) + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtTime(d) {
    if (typeof d === 'string') d = new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
    if (!(d instanceof Date) || isNaN(d)) return '';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}
function fmtDateLabel(d) {
    if (typeof d === 'string') d = new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
    if (!(d instanceof Date) || isNaN(d)) return '';
    const today = new Date();
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yest)) return 'Yesterday';
    const week = 7 * 24 * 3600 * 1000;
    if (Date.now() - d.getTime() < week) {
        return d.toLocaleDateString(undefined, { weekday: 'long' });
    }
    return d.toLocaleDateString();
}
function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
    if (isNaN(d)) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

// ============================================================
// 3. API HELPERS
// ============================================================
async function api(path, opts = {}) {
    opts.headers = opts.headers || {};
    if (State.token) opts.headers['Authorization'] = 'Bearer ' + State.token;
    return fetch(path, opts);
}
async function apiPost(path, body) {
    return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
}

// ============================================================
// 4. LOGIN / LOGOUT
// ============================================================
async function doLogin() {
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    err.innerText = '';
    if (!u || !p) { err.innerText = 'Username and password required.'; return; }

    // request notification permission while still inside a user gesture
    try {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    } catch {}

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p }),
        });
        if (!res.ok) { err.innerText = 'Server error ' + res.status; return; }
        const data = await res.json();
        if (!data.success) { err.innerText = data.message || 'Invalid credentials.'; return; }

        State.token = data.token;
        State.user = data.username;
        State.role = data.role;
        State.quotaMB = data.quota_mb || 0;
        State.usedBytes = data.used_bytes || 0;
        localStorage.setItem('bc_token', State.token);
        localStorage.setItem('bc_user', State.user);
        localStorage.setItem('bc_role', State.role);

        enterApp();
    } catch (e) {
        err.innerText = 'Connection error: ' + e.message;
    }
}

function doLogout() {
    api('/api/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('bc_token');
    localStorage.removeItem('bc_user');
    localStorage.removeItem('bc_role');
    location.reload();
}

async function enterApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    // Show admin menu entry
    if (State.role === 'admin') {
        const ma = document.getElementById('menu-admin');
        if (ma) ma.style.display = '';
    }

    await loadInitData();
    connectWS();
    setupHandlers();
    registerSW();
}

// ============================================================
// 5. INIT DATA
// ============================================================
async function loadInitData() {
    try {
        const res = await apiPost('/api/action', { action: 'get_init_data' });
        const d = await res.json();
        State.contacts = d.contacts || [];
        State.allUsers = d.all_users || [];
        State.avatars = d.all_avatars || {};
        State.rooms = [];

        // Build the rooms list
        // Announcements channel
        State.rooms.push({ id: 'Announcements', name: 'Announcements', type: 'channel' });

        // Custom rooms (groups)
        (d.custom_rooms || []).forEach(r => {
            State.rooms.push({ id: r.id, name: r.name, type: 'group' });
        });

        // DM contacts
        (d.contacts || []).forEach(c => {
            const roomId = dmRoomId(State.user, c);
            State.rooms.push({ id: roomId, name: c, type: 'dm', partner: c });
        });

        if (d.quota_mb) State.quotaMB = d.quota_mb;
        if (d.used_bytes != null) State.usedBytes = d.used_bytes;

        renderChatList();
    } catch (e) {
        console.error('loadInitData failed:', e);
    }
}

function dmRoomId(a, b) {
    const [x, y] = [a, b].sort();
    return `dm_${x}-${y}`;
}

// ============================================================
// 6. WEBSOCKET
// ============================================================
function connectWS() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/${encodeURIComponent(State.user)}/${encodeURIComponent(State.role)}/${encodeURIComponent(State.token)}`;
    State.ws = new WebSocket(url);

    State.ws.onopen = () => {
        if (State.currentRoom) {
            State.ws.send(JSON.stringify({ action: 'get_history', room: State.currentRoom.id }));
        }
    };
    State.ws.onmessage = ev => {
        try { handleWS(JSON.parse(ev.data)); }
        catch (e) { console.error('WS msg parse', e); }
    };
    State.ws.onclose = ev => {
        if (ev.code === 4401) {
            localStorage.clear();
            location.reload();
            return;
        }
        setTimeout(connectWS, 2000);
    };

    // keepalive
    setInterval(() => {
        if (State.ws && State.ws.readyState === WebSocket.OPEN) {
            State.ws.send(JSON.stringify({ action: 'ping' }));
        }
    }, 15000);
}

function wsSend(obj) {
    if (State.ws && State.ws.readyState === WebSocket.OPEN) {
        State.ws.send(JSON.stringify(obj));
    }
}

function handleWS(m) {
    switch (m.type) {
        case 'history':
            if (State.currentRoom && m.room === State.currentRoom.id) {
                State.messages[m.room] = m.data || [];
                renderMessages();
                // Get pinned for this room
                wsSend({ action: 'get_pinned', room: m.room });
                // Mark as read
                wsSend({ action: 'read_messages', room: m.room });
            }
            break;
        case 'new_msg':
            onNewMsg(m);
            break;
        case 'deleted':
            onDeleted(m);
            break;
        case 'edited':
            onEdited(m);
            break;
        case 'reaction_updated':
            onReaction(m);
            break;
        case 'read_receipt':
            onReadReceipt(m);
            break;
        case 'typing':
            onTyping(m);
            break;
        case 'presence':
            State.onlineUsers = m.online || [];
            renderHeader();
            renderChatList();
            break;
        case 'last_seen':
            State.lastSeen = m.data || {};
            renderHeader();
            break;
        case 'pinned_changed':
            State.pinned[m.room] = m.pinned || [];
            if (State.currentRoom && m.room === State.currentRoom.id) {
                State.pinnedIdx = 0;
                renderPinnedBar();
            }
            break;
        case 'webrtc':
            handleWebRTC(m.data);
            break;
        case 'pong':
            break;
    }
}

function onNewMsg(m) {
    const room = m.room;
    const data = m.data;
    State.messages[room] = State.messages[room] || [];
    State.messages[room].push(data);

    if (State.currentRoom && room === State.currentRoom.id) {
        appendMessage(data, true);
        // Mark as read shortly (so other side sees blue ticks)
        if (document.hasFocus()) {
            setTimeout(() => wsSend({ action: 'read_messages', room }), 500);
        }
    } else {
        // Increment unread for the room (unless it's my own message)
        if (data.user !== State.user) {
            State.unread[room] = (State.unread[room] || 0) + 1;
            try { document.getElementById('notif-sound').play(); } catch {}
            // System notification
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
                const sender = data.user;
                const body = data.msgType === 'text' ? data.text : `[${data.msgType}]`;
                try {
                    if (navigator.serviceWorker) {
                        navigator.serviceWorker.getRegistration().then(reg => {
                            if (reg) reg.showNotification(sender, { body, icon: '/static/icon-192.png', tag: room });
                        });
                    } else {
                        new Notification(sender, { body, icon: '/static/icon-192.png' });
                    }
                } catch {}
            }
        }
        renderChatList();
    }
}

function onDeleted(m) {
    if (State.messages[m.room]) {
        State.messages[m.room] = State.messages[m.room].filter(x => x.id !== m.msg_id);
    }
    const el = document.getElementById('msg-' + m.msg_id);
    if (el) el.remove();
}

function onEdited(m) {
    if (State.messages[m.room]) {
        const msg = State.messages[m.room].find(x => x.id === m.msg_id);
        if (msg) msg.text = m.new_text;
    }
    const el = document.getElementById('msg-' + m.msg_id);
    if (el) {
        const txt = el.querySelector('.text');
        if (txt) {
            txt.innerHTML = esc(m.new_text) + ' <span style="opacity:0.6;font-size:11px">(edited)</span>';
        }
    }
}

function onReaction(m) {
    if (State.messages[m.room]) {
        const msg = State.messages[m.room].find(x => x.id === m.msg_id);
        if (msg) msg.reactions = m.reactions;
    }
    const r = document.getElementById('reacts-' + m.msg_id);
    if (r) r.outerHTML = reactionsHTML(m.msg_id, m.reactions);
}

function onReadReceipt(m) {
    // m.msg_ids_per_sender = { senderUser: [msgIds...] }
    const myIds = m.msg_ids_per_sender[State.user];
    if (!myIds) return;
    myIds.forEach(id => {
        const el = document.getElementById('msg-' + id);
        if (el) {
            const ticks = el.querySelector('.ticks');
            if (ticks) ticks.classList.add('read');
        }
    });
}

function onTyping(m) {
    if (!State.currentRoom || m.room !== State.currentRoom.id) return;
    if (m.user === State.user) return;
    State.typing[m.room] = { user: m.user, expires: Date.now() + 4000 };
    renderHeader();
    setTimeout(() => {
        const t = State.typing[m.room];
        if (t && Date.now() >= t.expires) {
            delete State.typing[m.room];
            renderHeader();
        }
    }, 4500);
}

// ============================================================
// 7. RENDER SIDEBAR (chat list)
// ============================================================
function renderChatList() {
    const list = document.getElementById('chat-list');
    if (!list) return;
    const q = (document.getElementById('sidebar-search').value || '').toLowerCase();

    list.innerHTML = '';
    State.rooms.forEach(r => {
        if (q && !r.name.toLowerCase().includes(q)) return;
        const unread = State.unread[r.id] || 0;
        const active = State.currentRoom && State.currentRoom.id === r.id;
        const isOnline = r.type === 'dm' && State.onlineUsers.includes(r.partner);

        // Avatar
        let avatar;
        if (r.type === 'channel') {
            avatar = '<div class="avatar" style="background:var(--red)">📢</div>';
        } else if (r.type === 'group') {
            avatar = '<div class="avatar" style="background:#9c27b0">👥</div>';
        } else {
            const av = State.avatars[r.partner];
            if (av) {
                avatar = `<div class="avatar"><img src="${esc(av)}"></div>`;
            } else {
                avatar = `<div class="avatar">${esc((r.partner||'?').charAt(0).toUpperCase())}</div>`;
            }
        }

        const div = document.createElement('div');
        div.className = 'chat-item' + (active ? ' active' : '');
        div.dataset.roomId = r.id;
        div.innerHTML = `
            ${avatar}
            <div class="chat-item-body">
                <div class="chat-item-row">
                    <div class="chat-item-name">${esc(r.name)}${isOnline ? ' <span style="color:var(--green);font-size:10px">●</span>' : ''}</div>
                </div>
                <div class="chat-item-preview">
                    <span>${esc(getLastPreview(r.id))}</span>
                    ${unread > 0 ? `<span class="chat-item-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                </div>
            </div>
        `;
        div.addEventListener('click', () => openChat(r));
        list.appendChild(div);
    });
}

function getLastPreview(roomId) {
    const msgs = State.messages[roomId];
    if (!msgs || !msgs.length) {
        const room = State.rooms.find(r => r.id === roomId);
        if (room) {
            if (room.type === 'dm') return 'Private chat';
            if (room.type === 'group') return 'Group';
            if (room.type === 'channel') return 'System channel';
        }
        return '';
    }
    const m = msgs[msgs.length - 1];
    if (m.msgType === 'text') return m.text.slice(0, 50);
    if (m.msgType === 'image') return '🖼️ Photo';
    if (m.msgType === 'video') return '🎥 Video';
    if (m.msgType === 'audio') return '🎤 Voice';
    return '📎 ' + (m.fileName || 'File');
}

// ============================================================
// 8. OPEN CHAT
// ============================================================
function openChat(room) {
    State.currentRoom = room;
    State.unread[room.id] = 0;

    document.getElementById('chat-empty').style.display = 'none';
    document.getElementById('chat-content').style.display = 'flex';
    document.getElementById('chat-view').classList.add('active');

    renderHeader();
    renderChatList();

    // Show/hide call buttons
    const isDM = room.type === 'dm';
    document.getElementById('chat-call-btn').style.display = isDM ? '' : 'none';
    document.getElementById('chat-video-btn').style.display = isDM ? '' : 'none';

    // Request history
    State.messages[room.id] = null;
    document.getElementById('messages').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3)"><div class="spinner" style="margin:0 auto 12px auto"></div>Loading...</div>';
    wsSend({ action: 'get_history', room: room.id });
}

function closeChat() {
    State.currentRoom = null;
    document.getElementById('chat-content').style.display = 'none';
    document.getElementById('chat-empty').style.display = '';
    document.getElementById('chat-view').classList.remove('active');
    renderChatList();
}

// ============================================================
// 9. RENDER HEADER
// ============================================================
function renderHeader() {
    if (!State.currentRoom) return;
    const r = State.currentRoom;
    document.getElementById('chat-header-title').innerText = r.name;

    // Avatar
    const av = document.getElementById('chat-header-avatar');
    if (r.type === 'channel') {
        av.innerHTML = '📢';
        av.style.background = 'var(--red)';
    } else if (r.type === 'group') {
        av.innerHTML = '👥';
        av.style.background = '#9c27b0';
    } else {
        const aURL = State.avatars[r.partner];
        if (aURL) {
            av.innerHTML = `<img src="${esc(aURL)}">`;
        } else {
            av.innerHTML = esc((r.partner || '?').charAt(0).toUpperCase());
        }
        av.style.background = 'var(--accent)';
    }

    // Status
    const status = document.getElementById('chat-header-status');
    // Typing indicator
    const typing = State.typing[r.id];
    if (typing && Date.now() < typing.expires) {
        status.innerText = typing.user + ' is typing…';
        status.className = 'chat-header-status online';
        return;
    }
    if (r.type === 'dm') {
        if (State.onlineUsers.includes(r.partner)) {
            status.innerText = 'online';
            status.className = 'chat-header-status online';
        } else {
            const ls = State.lastSeen[r.partner];
            status.innerText = ls ? 'last seen ' + fmtRelative(ls) : 'offline';
            status.className = 'chat-header-status';
        }
    } else if (r.type === 'group') {
        status.innerText = '';
        status.className = 'chat-header-status';
    } else {
        status.innerText = '';
        status.className = 'chat-header-status';
    }
}

// ============================================================
// 10. RENDER MESSAGES
// ============================================================
function renderMessages() {
    const container = document.getElementById('messages');
    if (!container || !State.currentRoom) return;
    const msgs = State.messages[State.currentRoom.id] || [];
    container.innerHTML = '';

    let lastDate = null;
    let lastSender = null;
    let prevRow = null;

    msgs.forEach((m, i) => {
        const d = new Date((m.timestamp || '').replace(' ', 'T') + 'Z');
        const dayKey = isNaN(d) ? '' : d.toDateString();
        if (dayKey && dayKey !== lastDate) {
            const div = document.createElement('div');
            div.className = 'date-divider';
            div.innerText = fmtDateLabel(d);
            container.appendChild(div);
            lastDate = dayKey;
            lastSender = null;
        }
        const isSame = (lastSender === m.user);
        const next = msgs[i + 1];
        const nextSameDate = next && (new Date((next.timestamp || '').replace(' ', 'T') + 'Z').toDateString() === dayKey);
        const isLastInGroup = !next || next.user !== m.user || !nextSameDate;

        const row = buildMessageRow(m, isSame, isLastInGroup);
        container.appendChild(row);
        lastSender = m.user;
        prevRow = row;
    });

    // Scroll to bottom
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function appendMessage(m, scrollIfNearBottom = false) {
    const container = document.getElementById('messages');
    if (!container) return;
    const msgs = State.messages[State.currentRoom.id] || [];
    const idx = msgs.length - 1;
    const prev = idx > 0 ? msgs[idx - 1] : null;

    // Need a date divider?
    const d = new Date((m.timestamp || '').replace(' ', 'T') + 'Z');
    const dayKey = isNaN(d) ? '' : d.toDateString();
    const lastDivider = container.querySelector('.date-divider:last-of-type');
    let needDivider = false;
    if (!prev) needDivider = true;
    else {
        const pd = new Date((prev.timestamp || '').replace(' ', 'T') + 'Z');
        needDivider = !isNaN(pd) && pd.toDateString() !== dayKey;
    }
    // If there are no message rows yet, ensure divider
    if (!container.querySelector('.msg-row')) needDivider = true;
    if (needDivider) {
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerText = fmtDateLabel(d);
        container.appendChild(div);
    }

    const isSame = prev && prev.user === m.user;
    const row = buildMessageRow(m, isSame, true);
    container.appendChild(row);

    if (scrollIfNearBottom) {
        const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 200;
        if (nearBottom || m.user === State.user) {
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        } else {
            // Show scroll-to-bottom badge with +1
            const pill = document.getElementById('unread-pill');
            const btn = document.getElementById('scroll-bottom-btn');
            if (btn && pill) {
                btn.style.display = 'flex';
                pill.style.display = '';
                pill.innerText = (parseInt(pill.innerText || '0', 10) + 1);
            }
        }
    }
}

function buildMessageRow(m, isSame, isLastInGroup) {
    const isOut = m.user === State.user;
    const row = document.createElement('div');
    row.className = 'msg-row ' + (isOut ? 'out' : 'in') + (isSame ? ' same' : '') + (isLastInGroup ? ' last-in-group' : '');
    row.id = 'msg-' + m.id;
    row.dataset.msgId = m.id;
    row.dataset.user = m.user;

    let mediaHTML = '';
    let isMedia = false;
    if (m.msgType === 'image' && m.url) {
        mediaHTML = `<div class="media"><img src="${esc(m.url)}" onclick="openLightbox('${esc(m.url)}', 'image')"></div>`;
        isMedia = true;
    } else if (m.msgType === 'video' && m.url) {
        mediaHTML = `<div class="media"><video src="${esc(m.url)}" controls playsinline></video></div>`;
        isMedia = true;
    } else if (m.msgType === 'audio' && m.url) {
        mediaHTML = voiceBubble(m.id, m.url);
    } else if (m.msgType === 'file' && m.url) {
        mediaHTML = fileBubble(m);
    }

    // For groups, show sender name
    const showSender = !isOut && !isSame && (State.currentRoom.type === 'group' || State.currentRoom.id === 'Announcements');

    // Reply quote
    let replyHTML = '';
    if (m.replyTo && m.replyTo.id) {
        replyHTML = `<div class="bubble-reply" onclick="jumpToMessage('${esc(m.replyTo.id)}')">
            <div class="bubble-reply-name">${esc(m.replyTo.user || '')}</div>
            <div class="bubble-reply-text">${esc((m.replyTo.text || '').slice(0, 80))}</div>
        </div>`;
    }

    // Text
    const textHTML = m.msgType === 'text' && m.text ? `<div class="text">${esc(m.text)}</div>` : '';

    // Meta (time + ticks for outgoing)
    let ticks = '';
    if (isOut) {
        const isRead = m.read_by && m.read_by.length > 0;
        ticks = `<svg class="ticks${isRead ? ' read' : ''}"><use href="#${isRead ? 'i-check2' : 'i-check'}"/></svg>`;
    }
    const metaHTML = `<span class="meta">${fmtTime(m.timestamp)}${ticks}</span>`;

    // Reactions
    const reactionsRender = m.reactions ? reactionsHTML(m.id, m.reactions) : '';

    const bubbleClass = 'bubble' + (isMedia ? ' with-media' : '');
    row.innerHTML = `
        <div class="${bubbleClass}">
            ${showSender ? `<div class="sender">${esc(m.user)}</div>` : ''}
            ${replyHTML}
            ${mediaHTML}
            ${textHTML}
            ${metaHTML}
            ${reactionsRender}
        </div>
    `;

    // Right-click / long-press for context menu
    attachLongPress(row, () => openContextMenu(row, m));

    return row;
}

function voiceBubble(id, url) {
    const bars = Array.from({ length: 28 }, (_, i) => {
        const h = 25 + ((Math.sin(i * 1.7) + Math.sin(i * 0.9 + 1) + 2) * 18);
        return `<div class="voice-bar" style="height:${Math.round(h)}%"></div>`;
    }).join('');
    return `
        <div class="voice-row" data-voice-id="${id}">
            <audio data-voice-audio="${id}" src="${esc(url)}" preload="metadata" style="display:none"></audio>
            <button class="voice-play" data-voice-play="${id}">
                <svg><use href="#i-play"/></svg>
            </button>
            <div class="voice-bars-wrap">
                <div class="voice-bars" data-voice-bars="${id}">${bars}</div>
                <div class="voice-time" data-voice-time="${id}">0:00</div>
            </div>
        </div>
    `;
}

function fileBubble(m) {
    return `
        <div class="file-row" onclick="window.open('${esc(m.url)}', '_blank')">
            <div class="file-icon"><svg><use href="#i-file"/></svg></div>
            <div class="file-meta">
                <div class="file-name">${esc(m.fileName || 'File')}</div>
                <div class="file-size">${fmtBytes(m.fileSize || 0)}</div>
            </div>
        </div>
    `;
}

function reactionsHTML(msgId, reactions) {
    if (!reactions || Object.keys(reactions).length === 0) return `<div class="reactions" id="reacts-${msgId}"></div>`;
    const counts = {};
    let mine = null;
    for (const u in reactions) {
        const em = reactions[u];
        counts[em] = (counts[em] || 0) + 1;
        if (u === State.user) mine = em;
    }
    const pills = Object.entries(counts).map(([em, c]) =>
        `<span class="reaction-pill ${mine === em ? 'mine' : ''}" onclick="sendReaction('${esc(msgId)}', '${esc(em)}')">${em} ${c}</span>`
    ).join('');
    return `<div class="reactions" id="reacts-${msgId}">${pills}</div>`;
}

// ============================================================
// 11. VOICE PLAYER
// ============================================================
let __activeVoice = null;
function setupVoiceClicks() {
    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-voice-play]');
        if (btn) { toggleVoice(btn.dataset.voicePlay); return; }
        const bars = e.target.closest('[data-voice-bars]');
        if (bars) { seekVoiceByClick(e, bars); return; }
    });
}

function toggleVoice(id) {
    const audio = document.querySelector(`[data-voice-audio="${id}"]`);
    if (!audio) return;
    if (__activeVoice && __activeVoice !== id) {
        const other = document.querySelector(`[data-voice-audio="${__activeVoice}"]`);
        if (other) { try { other.pause(); } catch {} }
        setVoiceIcon(__activeVoice, false);
    }
    const playBtn = document.querySelector(`[data-voice-play="${id}"]`);
    if (audio.paused) {
        audio.play().catch(() => {});
        setVoiceIcon(id, true);
        __activeVoice = id;
        attachVoiceUpdater(id, audio);
    } else {
        audio.pause();
        setVoiceIcon(id, false);
    }
}

function setVoiceIcon(id, playing) {
    const btn = document.querySelector(`[data-voice-play="${id}"]`);
    if (!btn) return;
    btn.innerHTML = `<svg><use href="#${playing ? 'i-pause' : 'i-play'}"/></svg>`;
}

function attachVoiceUpdater(id, audio) {
    if (audio._upHooked) return;
    audio._upHooked = true;
    const barsWrap = document.querySelector(`[data-voice-bars="${id}"]`);
    const timeEl = document.querySelector(`[data-voice-time="${id}"]`);
    const bars = barsWrap ? barsWrap.querySelectorAll('.voice-bar') : [];

    audio.addEventListener('timeupdate', () => {
        if (!audio.duration || !isFinite(audio.duration)) return;
        const pct = audio.currentTime / audio.duration;
        bars.forEach((b, i) => {
            if (i / bars.length < pct) b.classList.add('active');
            else b.classList.remove('active');
        });
        if (timeEl) timeEl.innerText = fmtVoiceTime(audio.currentTime) + ' / ' + fmtVoiceTime(audio.duration);
    });
    audio.addEventListener('ended', () => {
        setVoiceIcon(id, false);
        audio.currentTime = 0;
        bars.forEach(b => b.classList.remove('active'));
    });
}

function fmtVoiceTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' + sec : sec);
}

function seekVoiceByClick(e, barsWrap) {
    const id = barsWrap.dataset.voiceBars;
    const audio = document.querySelector(`[data-voice-audio="${id}"]`);
    if (!audio || !audio.duration) return;
    const r = barsWrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    audio.currentTime = Math.max(0, Math.min(audio.duration, (x / r.width) * audio.duration));
}

// ============================================================
// 12. PINNED BAR
// ============================================================
function renderPinnedBar() {
    const bar = document.getElementById('pinned-bar');
    if (!State.currentRoom) { bar.style.display = 'none'; return; }
    const arr = State.pinned[State.currentRoom.id] || [];
    if (arr.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    const p = arr[State.pinnedIdx % arr.length];
    const preview = p.msgType === 'text'
        ? (p.text || '').slice(0, 80)
        : (p.msgType === 'image' ? '🖼️ Photo' :
           p.msgType === 'video' ? '🎥 Video' :
           p.msgType === 'audio' ? '🎤 Voice' :
           '📎 ' + (p.fileName || 'File'));
    document.getElementById('pinned-bar-text').innerText = preview;
    bar.onclick = () => jumpToMessage(p.id);
    document.getElementById('pinned-unpin-btn').onclick = (e) => {
        e.stopPropagation();
        if (confirm('Unpin this message?')) {
            wsSend({ action: 'unpin_msg', msg_id: p.id });
        }
    };
}

// ============================================================
// 13. CONTEXT MENU (long press / right click)
// ============================================================
let __pressTimer = null;
let __pressStart = null;
function attachLongPress(el, callback) {
    el.addEventListener('contextmenu', e => { e.preventDefault(); callback(e); });
    el.addEventListener('touchstart', e => {
        if (__pressTimer) clearTimeout(__pressTimer);
        __pressStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        __pressTimer = setTimeout(() => {
            __pressTimer = null;
            // Vibrate if available
            if (navigator.vibrate) navigator.vibrate(40);
            callback({ clientX: __pressStart.x, clientY: __pressStart.y, target: el });
        }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
        if (!__pressStart) return;
        const dx = e.touches[0].clientX - __pressStart.x;
        const dy = e.touches[0].clientY - __pressStart.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            if (__pressTimer) { clearTimeout(__pressTimer); __pressTimer = null; }
        }
    }, { passive: true });
    el.addEventListener('touchend', () => {
        if (__pressTimer) { clearTimeout(__pressTimer); __pressTimer = null; }
    });
    el.addEventListener('touchcancel', () => {
        if (__pressTimer) { clearTimeout(__pressTimer); __pressTimer = null; }
    });
}

let __ctxMsg = null;
function openContextMenu(rowEl, msg) {
    __ctxMsg = msg;
    const menu = document.getElementById('ctx-menu');
    const editBtn = document.getElementById('ctx-edit');
    const pinBtn = document.getElementById('ctx-pin');

    // Only show edit for own text messages
    if (msg.user === State.user && msg.msgType === 'text') {
        editBtn.style.display = '';
    } else {
        editBtn.style.display = 'none';
    }
    // Pin label
    const isPinned = (State.pinned[State.currentRoom.id] || []).some(p => p.id === msg.id);
    pinBtn.querySelector('span').innerText = isPinned ? 'Unpin' : 'Pin';

    // Show menu
    menu.style.display = 'flex';
    // Add backdrop click-outside
    showBackdrop(() => closeContextMenu());

    // Position
    const bubble = rowEl.querySelector('.bubble');
    const r = bubble ? bubble.getBoundingClientRect() : rowEl.getBoundingClientRect();
    requestAnimationFrame(() => positionMenu(menu, r));
}

function positionMenu(menu, anchorRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = menu.offsetWidth || 230;
    const h = menu.offsetHeight || 280;
    const PAD = 10;

    let left, top;
    const isMobile = vw <= 768;

    if (isMobile) {
        // Center horizontally; place above the bubble if room, else below
        left = (vw - w) / 2;
        const spaceAbove = anchorRect.top;
        const spaceBelow = vh - anchorRect.bottom;
        if (spaceAbove >= h + PAD) {
            top = anchorRect.top - h - 8;
        } else if (spaceBelow >= h + PAD) {
            top = anchorRect.bottom + 8;
        } else {
            top = (vh - h) / 2;
        }
    } else {
        // Desktop: position right of cursor (or right of bubble for outgoing)
        left = anchorRect.right - w;
        top = anchorRect.bottom + 6;
        if (top + h > vh - PAD) top = anchorRect.top - h - 6;
        if (left < PAD) left = PAD;
    }
    if (left < PAD) left = PAD;
    if (left + w > vw - PAD) left = vw - w - PAD;
    if (top < PAD) top = PAD;
    if (top + h > vh - PAD) top = vh - h - PAD;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

function closeContextMenu() {
    document.getElementById('ctx-menu').style.display = 'none';
    hideBackdrop();
    __ctxMsg = null;
}

function showBackdrop(onClick) {
    let bd = document.getElementById('ctx-backdrop');
    if (!bd) {
        bd = document.createElement('div');
        bd.id = 'ctx-backdrop';
        document.body.appendChild(bd);
    }
    bd.onclick = onClick;
}
function hideBackdrop() {
    const bd = document.getElementById('ctx-backdrop');
    if (bd) bd.remove();
}

function handleCtxAction(action) {
    if (!__ctxMsg) return;
    const msg = __ctxMsg;
    switch (action) {
        case 'reply':
            State.replyTo = { id: msg.id, user: msg.user, text: msg.text || `[${msg.msgType}]` };
            renderReplyBar();
            document.getElementById('msg-input').focus();
            break;
        case 'copy':
            try { navigator.clipboard.writeText(msg.text || msg.url || ''); } catch {}
            break;
        case 'edit':
            State.editId = msg.id;
            document.getElementById('msg-input').value = msg.text || '';
            document.getElementById('msg-input').focus();
            updateComposerButton();
            break;
        case 'forward':
            openForwardModal(msg);
            break;
        case 'pin':
            const isPinned = (State.pinned[State.currentRoom.id] || []).some(p => p.id === msg.id);
            wsSend({ action: isPinned ? 'unpin_msg' : 'pin_msg', msg_id: msg.id });
            break;
        case 'select':
            State.selectionMode = true;
            State.selectedIds.add(msg.id);
            // (Selection UI can be extended later)
            break;
        case 'delete':
            if (confirm('Delete this message?')) {
                wsSend({ action: 'delete_msg', msg_ids: [msg.id] });
            }
            break;
    }
    closeContextMenu();
}

function renderReplyBar() {
    const bar = document.getElementById('reply-bar');
    if (!State.replyTo) { bar.style.display = 'none'; return; }
    document.getElementById('reply-bar-name').innerText = State.replyTo.user;
    document.getElementById('reply-bar-text').innerText = State.replyTo.text;
    bar.style.display = 'flex';
}
function cancelReply() {
    State.replyTo = null;
    State.editId = null;
    document.getElementById('reply-bar').style.display = 'none';
    updateComposerButton();
}

// ============================================================
// 14. COMPOSER (input)
// ============================================================
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
}

function updateComposerButton() {
    const input = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const hasText = input.value.trim().length > 0;
    sendBtn.style.display = hasText ? 'flex' : 'none';
    micBtn.style.display = hasText ? 'none' : 'flex';
}

function sendText() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !State.currentRoom) return;

    if (State.editId) {
        wsSend({ action: 'edit_msg', msg_id: State.editId, text });
    } else {
        wsSend({
            action: 'send_msg',
            room: State.currentRoom.id,
            user: State.user,
            targetUser: State.currentRoom.type === 'dm' ? State.currentRoom.partner : null,
            msgType: 'text',
            text,
            replyTo: State.replyTo,
        });
    }

    // RESET textarea - force back to single-line
    input.value = '';
    input.style.height = 'auto';
    requestAnimationFrame(() => {
        input.style.height = Math.max(40, input.scrollHeight) + 'px';
    });

    cancelReply();
    updateComposerButton();
}

// Typing indicator: notify other side
let __lastTypingSent = 0;
function notifyTyping() {
    if (!State.currentRoom) return;
    const now = Date.now();
    if (now - __lastTypingSent < 3000) return;
    __lastTypingSent = now;
    wsSend({ action: 'typing', room: State.currentRoom.id });
}

// ============================================================
// 15. UPLOAD WITH PROGRESS (in-bubble)
// ============================================================
function uploadFiles(files) {
    if (!files || !files.length) return;
    Array.from(files).forEach(f => uploadOne(f));
}

function uploadOne(file) {
    if (!State.currentRoom) return;
    // Quota check
    if (State.quotaMB > 0) {
        const rem = State.quotaMB * 1024 * 1024 - State.usedBytes;
        if (file.size > rem) {
            alert(`Quota exceeded. ${fmtBytes(Math.max(0, rem))} remaining.`);
            return;
        }
    }

    const tempId = 'up_' + Math.random().toString(36).slice(2, 9);
    const previewURL = (file.type.startsWith('image/') || file.type.startsWith('video/')) ? URL.createObjectURL(file) : null;
    const row = createUploadPlaceholder(file, tempId, previewURL);

    const xhr = new XMLHttpRequest();
    State['xhr_' + tempId] = xhr;
    const fd = new FormData();
    fd.append('file', file, file.name);

    xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            updateUploadProgress(tempId, pct);
        }
    });
    xhr.addEventListener('load', () => {
        delete State['xhr_' + tempId];
        if (previewURL) URL.revokeObjectURL(previewURL);
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.used_bytes != null) State.usedBytes = data.used_bytes;
                wsSend({
                    action: 'send_msg',
                    room: State.currentRoom.id,
                    user: State.user,
                    targetUser: State.currentRoom.type === 'dm' ? State.currentRoom.partner : null,
                    msgType: data.type,
                    url: data.url,
                    fileName: data.name,
                    fileSize: data.size,
                    replyTo: State.replyTo,
                });
                cancelReply();
                row.remove();
            } catch (e) {
                showUploadError(tempId, 'Bad response');
            }
        } else {
            let detail = 'Failed';
            try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
            showUploadError(tempId, detail);
        }
    });
    xhr.addEventListener('error', () => {
        if (previewURL) URL.revokeObjectURL(previewURL);
        delete State['xhr_' + tempId];
        showUploadError(tempId, 'Network error');
    });
    xhr.addEventListener('abort', () => {
        if (previewURL) URL.revokeObjectURL(previewURL);
        delete State['xhr_' + tempId];
        row.remove();
    });

    xhr.open('POST', '/api/upload', true);
    if (State.token) xhr.setRequestHeader('Authorization', 'Bearer ' + State.token);
    xhr.send(fd);
}

function createUploadPlaceholder(file, tempId, previewURL) {
    const container = document.getElementById('messages');
    const row = document.createElement('div');
    row.className = 'msg-row out';
    row.dataset.uploadId = tempId;

    let mediaHTML;
    if (previewURL && file.type.startsWith('image/')) {
        mediaHTML = `<div class="media"><img src="${previewURL}"></div>`;
    } else if (previewURL && file.type.startsWith('video/')) {
        mediaHTML = `<div class="media"><video src="${previewURL}" muted></video></div>`;
    } else {
        mediaHTML = `<div class="file-row">
            <div class="file-icon"><svg><use href="#i-file"/></svg></div>
            <div class="file-meta">
                <div class="file-name">${esc(file.name)}</div>
                <div class="file-size">${fmtBytes(file.size)}</div>
            </div>
        </div>`;
    }

    row.innerHTML = `
        <div class="bubble with-media" style="position:relative">
            ${mediaHTML}
            <div class="upload-overlay">
                <div class="upload-ring">
                    <svg width="56" height="56" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3"/>
                        <circle data-ring-fg="${tempId}" cx="28" cy="28" r="24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="150.8"/>
                    </svg>
                    <button class="upload-cancel-btn" onclick="cancelUpload('${tempId}')">
                        <svg><use href="#i-close"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    return row;
}

function updateUploadProgress(tempId, pct) {
    const ring = document.querySelector(`[data-ring-fg="${tempId}"]`);
    if (!ring) return;
    const C = 150.8;
    ring.setAttribute('stroke-dashoffset', String(C * (1 - pct / 100)));
}

function showUploadError(tempId, msg) {
    const row = document.querySelector(`[data-upload-id="${tempId}"]`);
    if (!row) return;
    const ov = row.querySelector('.upload-overlay');
    if (ov) ov.innerHTML = `<div style="background:rgba(0,0,0,0.7);padding:8px 14px;border-radius:10px;color:white;font-size:13px">❌ ${esc(msg)}</div>`;
    setTimeout(() => row.remove(), 3500);
}

function cancelUpload(tempId) {
    const xhr = State['xhr_' + tempId];
    if (xhr) { try { xhr.abort(); } catch {} }
}

// ============================================================
// 16. VOICE RECORDING — Telegram-style with live waveform, pause, cancel/send
// ============================================================
const Rec = {
    state: 'idle',          // 'idle' | 'recording' | 'paused'
    mediaRecorder: null,
    stream: null,
    chunks: [],
    startTime: 0,
    pausedTime: 0,          // total ms spent paused
    pauseStartedAt: 0,
    timerInterval: null,
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    rafId: null,
    waveBars: [],
    mimeType: '',
};

function recGetMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',          // Safari iOS
        'audio/aac',
    ];
    for (const m of candidates) {
        try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return '';
}

async function startRecording() {
    if (Rec.state !== 'idle') return;
    // Check support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support voice recording. Try Chrome or Firefox.');
        return;
    }
    if (typeof MediaRecorder === 'undefined') {
        alert('Your browser does not support MediaRecorder API.');
        return;
    }
    // HTTPS requirement check
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert('Voice recording requires HTTPS. Please use HTTPS or localhost.');
        return;
    }
    try {
        Rec.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
    } catch (e) {
        let msg = 'Microphone access denied.';
        if (e.name === 'NotAllowedError') msg = 'Microphone permission denied. Please allow microphone access in browser settings.';
        else if (e.name === 'NotFoundError') msg = 'No microphone found.';
        else if (e.message) msg = e.message;
        alert(msg);
        return;
    }
    Rec.mimeType = recGetMime();
    try {
        Rec.mediaRecorder = Rec.mimeType
            ? new MediaRecorder(Rec.stream, { mimeType: Rec.mimeType })
            : new MediaRecorder(Rec.stream);
    } catch (e) {
        alert('Cannot start recorder: ' + (e.message || e));
        recCleanupStream();
        return;
    }
    Rec.chunks = [];
    Rec.startTime = Date.now();
    Rec.pausedTime = 0;
    Rec.state = 'recording';

    Rec.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) Rec.chunks.push(e.data);
    };
    Rec.mediaRecorder.onstop = onRecordingStopped;
    Rec.mediaRecorder.onerror = (e) => {
        console.error('Recorder error:', e);
        alert('Recording error: ' + (e.error ? e.error.message : 'unknown'));
        recAbort();
    };

    try { Rec.mediaRecorder.start(100); }   // collect data every 100ms
    catch (e) {
        alert('Failed to start recording: ' + (e.message || e));
        recCleanupStream();
        Rec.state = 'idle';
        return;
    }

    showRecordingBar();
    startWaveAnimation();
    startRecTimer();
}

function pauseResumeRecording() {
    if (!Rec.mediaRecorder) return;
    if (Rec.state === 'recording') {
        try { Rec.mediaRecorder.pause(); } catch (e) {
            // Some browsers don't support pause; fallback to a no-op
            console.warn('Pause not supported');
            return;
        }
        Rec.state = 'paused';
        Rec.pauseStartedAt = Date.now();
        if (Rec.rafId) { cancelAnimationFrame(Rec.rafId); Rec.rafId = null; }
        updateRecPauseUI(true);
    } else if (Rec.state === 'paused') {
        try { Rec.mediaRecorder.resume(); } catch {}
        Rec.state = 'recording';
        Rec.pausedTime += Date.now() - Rec.pauseStartedAt;
        startWaveAnimation();
        updateRecPauseUI(false);
    }
}

function cancelRecording() {
    if (Rec.state === 'idle') return;
    recAbort();
    hideRecordingBar();
}

function sendRecording() {
    if (Rec.state === 'idle' || !Rec.mediaRecorder) return;
    // Stop the recorder; the onstop handler will upload
    try { Rec.mediaRecorder.stop(); } catch {}
    // state will be set to 'idle' in onRecordingStopped
}

function onRecordingStopped() {
    if (Rec.timerInterval) { clearInterval(Rec.timerInterval); Rec.timerInterval = null; }
    if (Rec.rafId) { cancelAnimationFrame(Rec.rafId); Rec.rafId = null; }
    hideRecordingBar();
    recCleanupStream();

    if (!Rec.chunks.length) {
        Rec.state = 'idle';
        return;
    }
    const type = Rec.mimeType || 'audio/webm';
    const blob = new Blob(Rec.chunks, { type });
    let ext = 'webm';
    if (type.includes('ogg')) ext = 'ogg';
    else if (type.includes('mp4') || type.includes('aac')) ext = 'm4a';
    const filename = `voice_${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type });

    Rec.state = 'idle';
    Rec.chunks = [];
    uploadOne(file);
}

function recAbort() {
    if (Rec.timerInterval) { clearInterval(Rec.timerInterval); Rec.timerInterval = null; }
    if (Rec.rafId) { cancelAnimationFrame(Rec.rafId); Rec.rafId = null; }
    if (Rec.mediaRecorder && Rec.mediaRecorder.state !== 'inactive') {
        // Stop and clear onstop so uploadOne is NOT called
        Rec.mediaRecorder.onstop = null;
        try { Rec.mediaRecorder.stop(); } catch {}
    }
    Rec.chunks = [];
    recCleanupStream();
    Rec.state = 'idle';
}

function recCleanupStream() {
    if (Rec.stream) {
        try { Rec.stream.getTracks().forEach(t => t.stop()); } catch {}
        Rec.stream = null;
    }
    if (Rec.audioCtx) {
        try { Rec.audioCtx.close(); } catch {}
        Rec.audioCtx = null;
        Rec.analyser = null;
        Rec.sourceNode = null;
    }
    Rec.mediaRecorder = null;
}

// ----- Recording UI -----
function showRecordingBar() {
    const composer = document.querySelector('.composer');
    if (!composer) return;
    let bar = document.getElementById('recording-bar');
    if (bar) bar.remove();

    bar = document.createElement('div');
    bar.id = 'recording-bar';
    bar.className = 'recording-bar';
    bar.innerHTML = `
        <button class="rec-action-btn cancel" id="rec-cancel" title="Cancel">
            <svg><use href="#i-trash-can"/></svg>
        </button>
        <div class="rec-indicator"></div>
        <span class="rec-timer" id="rec-timer">0:00</span>
        <div class="rec-wave" id="rec-wave">${generateLiveWaveBars(28)}</div>
        <button class="rec-action-btn pause" id="rec-pause" title="Pause">
            <svg><use href="#i-pause"/></svg>
        </button>
        <button class="rec-action-btn send" id="rec-send" title="Send">
            <svg><use href="#i-send"/></svg>
        </button>
    `;
    composer.appendChild(bar);

    Rec.waveBars = Array.from(bar.querySelectorAll('.rec-wave-bar'));

    document.getElementById('rec-cancel').addEventListener('click', cancelRecording);
    document.getElementById('rec-pause').addEventListener('click', pauseResumeRecording);
    document.getElementById('rec-send').addEventListener('click', sendRecording);
}

function hideRecordingBar() {
    const bar = document.getElementById('recording-bar');
    if (bar) bar.remove();
    Rec.waveBars = [];
}

function updateRecPauseUI(isPaused) {
    const btn = document.getElementById('rec-pause');
    if (!btn) return;
    if (isPaused) {
        btn.classList.add('paused');
        btn.innerHTML = `<svg><use href="#i-play"/></svg>`;
        btn.title = 'Resume';
        const ind = document.querySelector('.rec-indicator');
        if (ind) ind.style.animationPlayState = 'paused';
    } else {
        btn.classList.remove('paused');
        btn.innerHTML = `<svg><use href="#i-pause"/></svg>`;
        btn.title = 'Pause';
        const ind = document.querySelector('.rec-indicator');
        if (ind) ind.style.animationPlayState = 'running';
    }
}

function generateLiveWaveBars(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `<div class="rec-wave-bar" style="height:20%"></div>`;
    }
    return html;
}

function startRecTimer() {
    if (Rec.timerInterval) clearInterval(Rec.timerInterval);
    Rec.timerInterval = setInterval(() => {
        const timer = document.getElementById('rec-timer');
        if (!timer) return;
        const elapsed = Date.now() - Rec.startTime - Rec.pausedTime;
        if (Rec.state === 'paused') return;  // freeze timer when paused
        timer.innerText = formatRecTime(elapsed);
        // Hard cap at 5 minutes
        if (elapsed >= 5 * 60 * 1000) sendRecording();
    }, 200);
}

function formatRecTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + (sec < 10 ? '0' + sec : sec);
}

function startWaveAnimation() {
    if (!Rec.stream) return;
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        if (!Rec.audioCtx) {
            Rec.audioCtx = new AudioCtxClass();
            Rec.sourceNode = Rec.audioCtx.createMediaStreamSource(Rec.stream);
            Rec.analyser = Rec.audioCtx.createAnalyser();
            Rec.analyser.fftSize = 64;
            Rec.sourceNode.connect(Rec.analyser);
        }
        const data = new Uint8Array(Rec.analyser.frequencyBinCount);
        function loop() {
            if (Rec.state !== 'recording') return;
            Rec.analyser.getByteFrequencyData(data);
            const bars = Rec.waveBars;
            if (bars.length) {
                // Shift visualization left by one and add new bar on right
                for (let i = 0; i < bars.length - 1; i++) {
                    bars[i].style.height = bars[i + 1].style.height;
                }
                // Average of frequencies → bar height
                let sum = 0;
                for (let i = 0; i < data.length; i++) sum += data[i];
                const avg = sum / data.length;
                const h = Math.max(10, Math.min(100, (avg / 255) * 100 * 2.5));
                bars[bars.length - 1].style.height = h + '%';
            }
            Rec.rafId = requestAnimationFrame(loop);
        }
        loop();
    } catch (e) {
        console.warn('Wave animation not available:', e);
    }
}

function updateMicUI() { /* deprecated, kept for compat */ }

// ============================================================
// 16b. VIDEO MESSAGE (capsule) — Telegram-style round video
// ============================================================
const VidRec = {
    state: 'idle',
    stream: null,
    mediaRecorder: null,
    chunks: [],
    startTime: 0,
    timerInterval: null,
    mimeType: '',
};

function vidRecGetMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ];
    for (const m of candidates) {
        try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return '';
}

async function openVideoMessageRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support video recording.');
        return;
    }
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert('Video recording requires HTTPS.');
        return;
    }
    try {
        VidRec.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
        });
    } catch (e) {
        alert('Could not access camera: ' + (e.message || e.name));
        return;
    }
    const modal = document.getElementById('video-rec-modal');
    modal.style.display = 'flex';
    const vid = document.getElementById('video-rec-preview-video');
    vid.srcObject = VidRec.stream;
    try { vid.play(); } catch {}

    // Initial controls: start + cancel
    VidRec.state = 'ready';
    setVidRecControlsReady();
}

function setVidRecControlsReady() {
    document.getElementById('video-rec-controls').innerHTML = `
        <button class="video-rec-btn cancel" id="vrec-cancel" title="Cancel">
            <svg><use href="#i-close"/></svg>
        </button>
        <button class="video-rec-btn start" id="vrec-start" title="Start recording">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>
        </button>
    `;
    document.getElementById('vrec-cancel').addEventListener('click', closeVideoMessageRecorder);
    document.getElementById('vrec-start').addEventListener('click', startVideoMessageRecording);
    document.getElementById('video-rec-hint').innerText = 'Tap the red button to start recording';
    document.getElementById('video-rec-timer').innerText = '0:00';
}

function setVidRecControlsRecording() {
    document.getElementById('video-rec-controls').innerHTML = `
        <button class="video-rec-btn cancel" id="vrec-cancel" title="Cancel">
            <svg><use href="#i-close"/></svg>
        </button>
        <button class="video-rec-btn stop" id="vrec-stop" title="Stop & send">
            <svg viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor"/></svg>
        </button>
    `;
    document.getElementById('vrec-cancel').addEventListener('click', cancelVideoMessageRecording);
    document.getElementById('vrec-stop').addEventListener('click', stopAndSendVideoMessage);
    document.getElementById('video-rec-hint').innerText = '● Recording…';
    document.getElementById('video-rec-preview').classList.add('recording');
}

function startVideoMessageRecording() {
    if (!VidRec.stream) return;
    VidRec.mimeType = vidRecGetMime();
    try {
        VidRec.mediaRecorder = VidRec.mimeType
            ? new MediaRecorder(VidRec.stream, { mimeType: VidRec.mimeType })
            : new MediaRecorder(VidRec.stream);
    } catch (e) {
        alert('Cannot start: ' + (e.message || e));
        return;
    }
    VidRec.chunks = [];
    VidRec.startTime = Date.now();
    VidRec.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) VidRec.chunks.push(e.data);
    };
    VidRec.mediaRecorder.onstop = onVideoMessageStopped;
    try { VidRec.mediaRecorder.start(100); }
    catch (e) { alert('Failed: ' + e.message); return; }
    VidRec.state = 'recording';
    setVidRecControlsRecording();
    startVidRecTimer();
}

function startVidRecTimer() {
    if (VidRec.timerInterval) clearInterval(VidRec.timerInterval);
    VidRec.timerInterval = setInterval(() => {
        const t = document.getElementById('video-rec-timer');
        if (!t) return;
        const elapsed = Date.now() - VidRec.startTime;
        t.innerText = formatRecTime(elapsed);
        if (elapsed >= 60 * 1000) stopAndSendVideoMessage();  // 60s cap
    }, 200);
}

function stopAndSendVideoMessage() {
    if (VidRec.timerInterval) { clearInterval(VidRec.timerInterval); VidRec.timerInterval = null; }
    if (VidRec.mediaRecorder && VidRec.mediaRecorder.state !== 'inactive') {
        try { VidRec.mediaRecorder.stop(); } catch {}
    }
}

function onVideoMessageStopped() {
    if (VidRec.timerInterval) { clearInterval(VidRec.timerInterval); VidRec.timerInterval = null; }
    if (!VidRec.chunks.length) {
        closeVideoMessageRecorder();
        return;
    }
    const type = VidRec.mimeType || 'video/webm';
    const blob = new Blob(VidRec.chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const filename = `vidmsg_${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type });

    closeVideoMessageRecorder();
    VidRec.state = 'idle';
    VidRec.chunks = [];

    uploadOne(file);
}

function cancelVideoMessageRecording() {
    if (VidRec.timerInterval) { clearInterval(VidRec.timerInterval); VidRec.timerInterval = null; }
    if (VidRec.mediaRecorder && VidRec.mediaRecorder.state !== 'inactive') {
        VidRec.mediaRecorder.onstop = null;
        try { VidRec.mediaRecorder.stop(); } catch {}
    }
    VidRec.chunks = [];
    closeVideoMessageRecorder();
}

function closeVideoMessageRecorder() {
    const modal = document.getElementById('video-rec-modal');
    if (modal) modal.style.display = 'none';
    const preview = document.getElementById('video-rec-preview');
    if (preview) preview.classList.remove('recording');
    const vid = document.getElementById('video-rec-preview-video');
    if (vid) vid.srcObject = null;
    if (VidRec.stream) {
        try { VidRec.stream.getTracks().forEach(t => t.stop()); } catch {}
        VidRec.stream = null;
    }
    VidRec.state = 'idle';
}

// ============================================================
// 17. WEBRTC CALLS
// ============================================================
let pc = null, localStream = null, remoteStream = null;
let callPeer = null, callDir = null, callMode = 'audio', callState = 'idle';
let pendingICE = [];
let callStartedAt = null, callTimer = null;
let isMuted = false, isCamOff = false, facing = 'user';
let iceServersCache = null;

async function getIceServers() {
    if (iceServersCache) return iceServersCache;
    try {
        const res = await api('/api/turn-config');
        if (res.ok) {
            const d = await res.json();
            iceServersCache = d.iceServers;
            return iceServersCache;
        }
    } catch {}
    iceServersCache = [{ urls: ['stun:stun.l.google.com:19302'] }];
    return iceServersCache;
}

async function startCall(mode) {
    if (callState !== 'idle') { alert('Already in a call'); return; }
    if (!State.currentRoom || State.currentRoom.type !== 'dm') return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        alert('Calls require HTTPS.');
        return;
    }
    callPeer = State.currentRoom.partner;
    callMode = mode;
    callDir = 'out';
    callState = 'ringing';
    pendingICE = [];
    showCallUI({ title: callPeer, status: mode === 'video' ? 'Video calling…' : 'Calling…', mode });

    try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints(mode));
        attachLocalVideo();
        const ice = await getIceServers();
        pc = new RTCPeerConnection({ iceServers: ice });
        bindPCEvents();
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: mode === 'video' });
        await pc.setLocalDescription(offer);
        wsSend({ action: 'webrtc', type: 'offer', mode, targetUser: callPeer, offer, from: State.user });
    } catch (e) {
        alert('Call start failed: ' + (e.message || e));
        endCall(false);
    }
}

function mediaConstraints(mode) {
    if (mode === 'video') {
        return {
            audio: { echoCancellation: true, noiseSuppression: true },
            video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        };
    }
    return { audio: { echoCancellation: true, noiseSuppression: true }, video: false };
}

function bindPCEvents() {
    pc.onicecandidate = e => {
        if (e.candidate && callPeer) {
            wsSend({ action: 'webrtc', type: 'ice', targetUser: callPeer, candidate: e.candidate, from: State.user });
        }
    };
    pc.ontrack = e => {
        if (!remoteStream) remoteStream = new MediaStream();
        e.streams[0].getTracks().forEach(t => { try { remoteStream.addTrack(t); } catch {} });
        attachRemoteMedia();
    };
    pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') {
            if (callState !== 'in-call') {
                callState = 'in-call';
                callStartedAt = Date.now();
                if (callTimer) clearInterval(callTimer);
                callTimer = setInterval(updateCallDuration, 1000);
                setInCallButtons();
            }
        } else if (s === 'failed') {
            setTimeout(() => endCall(true), 2000);
        }
    };
}

function attachLocalVideo() {
    const lv = document.getElementById('local-video');
    if (lv && callMode === 'video') {
        lv.srcObject = localStream;
        lv.style.display = '';
        try { lv.play(); } catch {}
    } else if (lv) {
        lv.style.display = 'none';
    }
}
function attachRemoteMedia() {
    const rv = document.getElementById('remote-video');
    const ra = document.getElementById('remote-audio');
    if (callMode === 'video' && rv) {
        rv.srcObject = remoteStream;
        rv.style.display = '';
        try { rv.play(); } catch {}
    }
    if (ra) {
        ra.srcObject = remoteStream;
        try { ra.play(); } catch {}
    }
}

function handleWebRTC(d) {
    if (d.targetUser !== State.user) return;
    if (d.type === 'offer') {
        if (callState !== 'idle') {
            wsSend({ action: 'webrtc', type: 'busy', targetUser: d.from, from: State.user });
            return;
        }
        callPeer = d.from;
        callMode = d.mode || 'audio';
        callDir = 'in';
        callState = 'ringing';
        pendingICE = [];
        window._pendingOffer = d.offer;
        showCallUI({ title: callPeer, status: 'Incoming ' + callMode + ' call', mode: callMode, incoming: true });
        try { document.getElementById('notif-sound').play(); } catch {}
    } else if (d.type === 'answer') {
        if (pc) pc.setRemoteDescription(new RTCSessionDescription(d.answer)).then(flushICE).catch(e => console.error(e));
    } else if (d.type === 'ice') {
        if (pc && pc.remoteDescription) {
            pc.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(() => {});
        } else {
            pendingICE.push(d.candidate);
        }
    } else if (d.type === 'busy') {
        document.getElementById('call-status').innerText = 'Busy';
        setTimeout(() => endCall(false), 1500);
    } else if (d.type === 'end') {
        endCall(false);
    }
}

async function flushICE() {
    while (pendingICE.length && pc) {
        const c = pendingICE.shift();
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
}

async function acceptCall() {
    if (!window._pendingOffer) return endCall(true);
    const offer = window._pendingOffer;
    delete window._pendingOffer;
    callState = 'connecting';
    setInCallButtons();
    document.getElementById('call-status').innerText = 'Connecting…';
    try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints(callMode));
        attachLocalVideo();
        const ice = await getIceServers();
        pc = new RTCPeerConnection({ iceServers: ice });
        bindPCEvents();
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushICE();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ action: 'webrtc', type: 'answer', targetUser: callPeer, answer, from: State.user });
    } catch (e) {
        alert('Accept failed: ' + (e.message || e));
        endCall(true);
    }
}

function endCall(notify = true) {
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch {} localStream = null; }
    remoteStream = null;
    const rv = document.getElementById('remote-video');
    const ra = document.getElementById('remote-audio');
    const lv = document.getElementById('local-video');
    if (rv) { rv.srcObject = null; rv.style.display = 'none'; }
    if (ra) ra.srcObject = null;
    if (lv) { lv.srcObject = null; lv.style.display = 'none'; }
    if (notify && callPeer) wsSend({ action: 'webrtc', type: 'end', targetUser: callPeer, from: State.user });
    document.getElementById('call-modal').style.display = 'none';
    callPeer = null;
    callState = 'idle';
    isMuted = false;
    isCamOff = false;
    pendingICE = [];
}

function showCallUI({ title, status, mode, incoming = false }) {
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('call-name').innerText = title;
    document.getElementById('call-status').innerText = status;
    const av = document.getElementById('call-avatar');
    const aURL = State.avatars[title];
    if (aURL) av.innerHTML = `<img src="${esc(aURL)}">`;
    else av.innerText = (title || '?').charAt(0).toUpperCase();
    if (incoming) setIncomingButtons();
    else setOutgoingButtons();
}

function setIncomingButtons() {
    document.getElementById('call-controls').innerHTML = `
        <button class="call-btn accept" onclick="acceptCall()"><svg><use href="#i-phone"/></svg></button>
        <button class="call-btn reject" onclick="endCall()"><svg><use href="#i-close"/></svg></button>
    `;
}
function setOutgoingButtons() {
    document.getElementById('call-controls').innerHTML = `
        <button class="call-btn end" onclick="endCall()"><svg><use href="#i-close"/></svg></button>
    `;
}
function setInCallButtons() {
    const isVideo = callMode === 'video';
    document.getElementById('call-controls').innerHTML = `
        <button class="call-btn ${isMuted ? 'active' : ''}" onclick="toggleMute()"><svg><use href="#${isMuted ? 'i-mic-off' : 'i-mic'}"/></svg></button>
        ${isVideo ? `<button class="call-btn ${isCamOff ? 'active' : ''}" onclick="toggleCamera()"><svg><use href="#${isCamOff ? 'i-cam-off' : 'i-video'}"/></svg></button>` : ''}
        ${isVideo ? `<button class="call-btn" onclick="switchCamera()"><svg><use href="#i-switch-cam"/></svg></button>` : ''}
        <button class="call-btn end" onclick="endCall()"><svg><use href="#i-close"/></svg></button>
    `;
}

function updateCallDuration() {
    if (!callStartedAt) return;
    const s = Math.floor((Date.now() - callStartedAt) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    document.getElementById('call-status').innerText = m + ':' + (sec < 10 ? '0' + sec : sec);
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    setInCallButtons();
}
function toggleCamera() {
    if (!localStream || callMode !== 'video') return;
    isCamOff = !isCamOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
    setInCallButtons();
}
async function switchCamera() {
    if (!localStream || callMode !== 'video') return;
    const newFacing = facing === 'user' ? 'environment' : 'user';
    try {
        const s = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const newTrack = s.getVideoTracks()[0];
        if (!newTrack) return;
        const sender = pc.getSenders().find(x => x.track && x.track.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack);
        localStream.getVideoTracks().forEach(t => { try { t.stop(); } catch {}; localStream.removeTrack(t); });
        localStream.addTrack(newTrack);
        attachLocalVideo();
        facing = newFacing;
    } catch (e) {
        alert('Camera switch failed: ' + (e.message || e));
    }
}

// ============================================================
// 18. REACTIONS
// ============================================================
function sendReaction(msgId, emoji) {
    wsSend({ action: 'react_msg', msg_id: msgId, emoji });
}

// ============================================================
// 19. JUMP TO MESSAGE
// ============================================================
function jumpToMessage(id) {
    const el = document.getElementById('msg-' + id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = el.querySelector('.bubble');
        if (bubble) {
            bubble.style.transition = 'box-shadow 0.4s';
            bubble.style.boxShadow = '0 0 0 3px var(--accent)';
            setTimeout(() => { bubble.style.boxShadow = ''; }, 1500);
        }
    }
}

// ============================================================
// 20. LIGHTBOX
// ============================================================
function openLightbox(url, type) {
    document.getElementById('lightbox').style.display = 'flex';
    document.getElementById('lightbox-content').innerHTML =
        type === 'video' ? `<video src="${esc(url)}" controls autoplay></video>`
                         : `<img src="${esc(url)}">`;
}
function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
    document.getElementById('lightbox-content').innerHTML = '';
}

// ============================================================
// 21. MODALS
// ============================================================
function showModal(html) {
    document.getElementById('modal-box').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('modal-box').innerHTML = '';
}

function openNewChatModal() {
    closeMenu();
    showModal(`
        <h3 class="modal-title">New Chat or Group</h3>
        <div class="modal-row" style="border:none">
            <div style="width:100%">
                <button class="btn-primary" onclick="openNewDMModal()" style="width:100%;margin-bottom:8px">
                    <svg style="width:18px;height:18px;fill:currentColor;vertical-align:middle;margin-right:6px"><use href="#i-user-plus"/></svg>
                    New Private Chat
                </button>
                <button class="btn-primary" onclick="openNewGroupModal()" style="width:100%">
                    <svg style="width:18px;height:18px;fill:currentColor;vertical-align:middle;margin-right:6px"><use href="#i-users"/></svg>
                    New Group
                </button>
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function openNewDMModal() {
    showModal(`
        <h3 class="modal-title">Start Private Chat</h3>
        <input type="text" id="new-dm-username" placeholder="Username">
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
            <button class="btn-primary" onclick="submitNewDM()">Start</button>
        </div>
    `);
    setTimeout(() => document.getElementById('new-dm-username').focus(), 100);
}

async function submitNewDM() {
    const u = document.getElementById('new-dm-username').value.trim();
    if (!u) return;
    const res = await apiPost('/api/action', { action: 'add_contact', target: u });
    const d = await res.json();
    if (!d.success) { alert(d.msg || 'Failed'); return; }
    closeModal();
    await loadInitData();
    const roomId = dmRoomId(State.user, d.target);
    const room = State.rooms.find(r => r.id === roomId);
    if (room) openChat(room);
}

function openNewGroupModal() {
    const userList = State.allUsers.filter(u => u !== State.user).map(u =>
        `<label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;cursor:pointer">
            <input type="checkbox" value="${esc(u)}" style="width:18px;height:18px"> ${esc(u)}
        </label>`
    ).join('');
    showModal(`
        <h3 class="modal-title">Create Group</h3>
        <input type="text" id="new-group-name" placeholder="Group name">
        <div style="font-size:13px;color:var(--text-3);margin:8px 0">Select members:</div>
        <div id="new-group-members" style="max-height:240px;overflow-y:auto;background:var(--bg-input);border-radius:10px;padding:6px">
            ${userList || '<div style="padding:14px;color:var(--text-3);text-align:center">No other users</div>'}
        </div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
            <button class="btn-primary" onclick="submitNewGroup()">Create</button>
        </div>
    `);
}

async function submitNewGroup() {
    const name = document.getElementById('new-group-name').value.trim();
    if (!name) return;
    const members = Array.from(document.querySelectorAll('#new-group-members input:checked')).map(c => c.value);
    const res = await apiPost('/api/action', { action: 'create_room', type: 'group', name, members });
    const d = await res.json();
    if (!d.success) { alert(d.msg || 'Failed'); return; }
    closeModal();
    await loadInitData();
    const room = State.rooms.find(r => r.id === d.room_id);
    if (room) openChat(room);
}

function openSettingsModal() {
    closeMenu();
    const usedMB = (State.usedBytes / (1024*1024)).toFixed(1);
    const remMB = (State.quotaMB - State.usedBytes/(1024*1024)).toFixed(1);
    const pct = State.quotaMB > 0 ? Math.min(100, (State.usedBytes / (State.quotaMB*1024*1024) * 100)) : 0;
    const myAvatar = State.avatars[State.user];
    const avatarInner = myAvatar
        ? `<img src="${esc(myAvatar)}" alt="">`
        : esc(State.user.charAt(0).toUpperCase());

    showModal(`
        <div class="profile-modal-box">
            <div class="profile-header">
                <div class="profile-avatar-large" id="profile-avatar-btn" onclick="document.getElementById('profile-avatar-file').click()">
                    ${avatarInner}
                    <div class="profile-avatar-overlay">
                        <svg><use href="#i-camera"/></svg>
                    </div>
                </div>
                <input type="file" id="profile-avatar-file" accept="image/*" style="display:none">
                <h3 class="profile-name">${esc(State.user)}</h3>
                <p class="profile-status">${State.role === 'admin' ? '🛡️ Administrator' : '👤 Member'}</p>
            </div>

            <div class="profile-body">
                <div class="profile-row" onclick="openChangePasswordModal()">
                    <svg><use href="#i-key"/></svg>
                    <div class="profile-row-content">
                        <div class="profile-row-label">Password</div>
                        <div class="profile-row-value">Change password</div>
                    </div>
                </div>

                <div class="profile-row">
                    <svg><use href="#i-shield"/></svg>
                    <div class="profile-row-content">
                        <div class="profile-row-label">Storage</div>
                        <div class="profile-row-value">${usedMB} MB / ${State.quotaMB} MB</div>
                        <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:10px;margin-top:6px">
                            <div style="width:${pct}%;height:100%;background:${pct>90?'var(--red)':'var(--accent)'};border-radius:10px"></div>
                        </div>
                    </div>
                </div>

                ${myAvatar ? `
                <div class="profile-row danger" onclick="removeAvatar()">
                    <svg><use href="#i-trash-can"/></svg>
                    <div class="profile-row-content">
                        <div class="profile-row-value">Remove profile photo</div>
                    </div>
                </div>` : ''}

                <div class="profile-row danger" onclick="closeModal(); doLogout()">
                    <svg><use href="#i-logout"/></svg>
                    <div class="profile-row-content">
                        <div class="profile-row-value">Logout</div>
                    </div>
                </div>
            </div>

            <div style="padding:0 20px 16px 20px">
                <button class="btn-cancel" onclick="closeModal()" style="width:100%;padding:12px;border-radius:10px;font-size:14px">Close</button>
            </div>
        </div>
    `);

    // Hook the avatar file picker
    const fileInput = document.getElementById('profile-avatar-file');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            await uploadAvatar(file);
            e.target.value = '';
        });
    }
}

async function uploadAvatar(file) {
    if (file.size > 5 * 1024 * 1024) {
        alert('Image too large (max 5MB).');
        return;
    }
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await api('/api/upload_avatar', { method: 'POST', body: fd });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert('Upload failed: ' + (d.detail || res.status));
            return;
        }
        const d = await res.json();
        State.avatars[State.user] = d.url;
        renderChatList();
        renderHeader();
        openSettingsModal();  // refresh
    } catch (e) {
        alert('Upload error: ' + e.message);
    }
}

async function removeAvatar() {
    if (!confirm('Remove your profile photo?')) return;
    try {
        const res = await apiPost('/api/remove_avatar', {});
        if (res.ok) {
            delete State.avatars[State.user];
            renderChatList();
            renderHeader();
            openSettingsModal();  // refresh
        } else {
            alert('Failed');
        }
    } catch (e) { alert(e.message); }
}

function openChangePasswordModal() {
    showModal(`
        <h3 class="modal-title">Change Password</h3>
        <input type="password" id="pw-old" placeholder="Current password" autocomplete="current-password">
        <input type="password" id="pw-new" placeholder="New password" autocomplete="new-password">
        <input type="password" id="pw-confirm" placeholder="Confirm new password" autocomplete="new-password">
        <div id="pw-error" style="color:var(--red);font-size:13px;min-height:18px;margin-top:6px"></div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="openSettingsModal()">Back</button>
            <button class="btn-primary" onclick="submitChangePassword()">Save</button>
        </div>
    `);
    setTimeout(() => document.getElementById('pw-old').focus(), 100);
}

async function submitChangePassword() {
    const oldP = document.getElementById('pw-old').value;
    const newP = document.getElementById('pw-new').value;
    const conf = document.getElementById('pw-confirm').value;
    const err = document.getElementById('pw-error');
    err.innerText = '';
    if (!oldP || !newP) { err.innerText = 'Both fields are required'; return; }
    if (newP !== conf) { err.innerText = 'New passwords do not match'; return; }
    if (newP.length < 4) { err.innerText = 'Password too short (min 4 chars)'; return; }
    try {
        const res = await apiPost('/api/change_password', { old_password: oldP, new_password: newP });
        if (res.ok) {
            alert('Password changed successfully.');
            openSettingsModal();
        } else {
            const d = await res.json().catch(() => ({}));
            err.innerText = d.detail || 'Failed';
        }
    } catch (e) { err.innerText = e.message; }
}

function openForwardModal(msg) {
    const items = State.rooms.filter(r => r.id !== State.currentRoom.id).map(r =>
        `<div onclick="doForward('${esc(msg.id)}', '${esc(r.id)}')" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
            <div class="avatar" style="width:36px;height:36px;font-size:14px">${esc(r.name.charAt(0).toUpperCase())}</div>
            <div>${esc(r.name)}</div>
        </div>`
    ).join('');
    showModal(`
        <h3 class="modal-title">Forward to…</h3>
        <div style="max-height:340px;overflow-y:auto">${items}</div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        </div>
    `);
}
function doForward(msgId, targetRoom) {
    wsSend({ action: 'forward_msg', msg_ids: [msgId], target_room: targetRoom });
    closeModal();
}

// ============================================================
// 22. MENUS (dropdown)
// ============================================================
function openMenu(menuId, anchorEl) {
    closeMenu();
    const menu = document.getElementById(menuId);
    menu.style.display = 'flex';
    showBackdrop(() => closeMenu());
    requestAnimationFrame(() => {
        const r = anchorEl.getBoundingClientRect();
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        let left = r.right - w;
        let top = r.bottom + 6;
        if (left < 8) left = 8;
        if (top + h > window.innerHeight - 8) top = r.top - h - 6;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    });
}
function closeMenu() {
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('chat-menu').style.display = 'none';
    hideBackdrop();
}

// ============================================================
// 23. SETUP HANDLERS
// ============================================================
function setupHandlers() {
    // Sidebar
    document.getElementById('menu-btn').addEventListener('click', e => {
        openMenu('main-menu', e.currentTarget);
    });
    document.getElementById('sidebar-search').addEventListener('input', renderChatList);
    document.getElementById('new-chat-btn').addEventListener('click', () => openNewChatModal());

    // Main menu actions
    document.getElementById('main-menu').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        closeMenu();
        if (a === 'new-group') openNewGroupModal();
        else if (a === 'contacts') openNewDMModal();
        else if (a === 'settings') openSettingsModal();
        else if (a === 'admin') openAdminPanel();
        else if (a === 'logout') doLogout();
    });

    // Chat header
    document.getElementById('back-btn').addEventListener('click', closeChat);
    document.getElementById('chat-call-btn').addEventListener('click', () => startCall('audio'));
    document.getElementById('chat-video-btn').addEventListener('click', () => startCall('video'));
    document.getElementById('chat-menu-btn').addEventListener('click', e => {
        openMenu('chat-menu', e.currentTarget);
    });
    document.getElementById('chat-menu').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        closeMenu();
        if (btn.dataset.action === 'clear') {
            if (confirm('Clear chat history (visible only on your side)?')) {
                document.getElementById('messages').innerHTML = '';
                State.messages[State.currentRoom.id] = [];
            }
        }
    });

    // Context menu actions
    document.getElementById('ctx-menu').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        handleCtxAction(btn.dataset.action);
    });

    // Composer
    const input = document.getElementById('msg-input');
    input.addEventListener('input', () => {
        autoResize(input);
        updateComposerButton();
        notifyTyping();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
            e.preventDefault();
            sendText();
        }
    });
    document.getElementById('send-btn').addEventListener('click', sendText);
    document.getElementById('attach-btn').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', e => {
        uploadFiles(e.target.files);
        e.target.value = '';
    });

    // Voice recording — TAP to start (recording bar then has its own send/pause/cancel)
    const mic = document.getElementById('mic-btn');
    mic.addEventListener('click', (e) => {
        e.preventDefault();
        if (Rec.state === 'idle') {
            startRecording();
        }
        // If already recording, the recording-bar's send button handles it
    });

    // Video message button
    const vmsg = document.getElementById('video-msg-btn');
    if (vmsg) {
        vmsg.addEventListener('click', (e) => {
            e.preventDefault();
            openVideoMessageRecorder();
        });
    }

    // Scroll-to-bottom button
    const messagesList = document.getElementById('messages');
    messagesList.addEventListener('scroll', () => {
        const near = (messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight) < 100;
        const btn = document.getElementById('scroll-bottom-btn');
        if (near) {
            btn.style.display = 'none';
            document.getElementById('unread-pill').innerText = '0';
            document.getElementById('unread-pill').style.display = 'none';
            if (State.currentRoom) wsSend({ action: 'read_messages', room: State.currentRoom.id });
        } else {
            btn.style.display = 'flex';
        }
    });
    document.getElementById('scroll-bottom-btn').addEventListener('click', () => {
        messagesList.scrollTop = messagesList.scrollHeight;
    });

    // Voice clicks (delegate)
    setupVoiceClicks();

    // Window focus → mark as read
    window.addEventListener('focus', () => {
        if (State.currentRoom) wsSend({ action: 'read_messages', room: State.currentRoom.id });
    });

    // ESC closes things
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeContextMenu();
            closeMenu();
            if (document.getElementById('lightbox').style.display === 'flex') closeLightbox();
        }
    });

    // Initial composer state
    updateComposerButton();
}

// ============================================================
// 24. ADMIN PANEL (lazy)
// ============================================================
function openAdminPanel() {
    if (State.role !== 'admin') return;
    showModal(`
        <h3 class="modal-title">Admin Panel</h3>
        <div style="display:flex;gap:6px;border-bottom:1px solid var(--border);margin-bottom:14px;flex-wrap:wrap">
            <button class="admin-tab active" data-tab="users" onclick="loadAdminTab('users', this)" style="padding:8px 12px;font-size:13px;border-bottom:2px solid var(--accent);font-weight:600">Users</button>
            <button class="admin-tab" data-tab="stats" onclick="loadAdminTab('stats', this)" style="padding:8px 12px;font-size:13px;border-bottom:2px solid transparent;color:var(--text-3)">Stats</button>
            <button class="admin-tab" data-tab="theme" onclick="loadAdminTab('theme', this)" style="padding:8px 12px;font-size:13px;border-bottom:2px solid transparent;color:var(--text-3)">Theme</button>
            <button class="admin-tab" data-tab="updates" onclick="loadAdminTab('updates', this)" style="padding:8px 12px;font-size:13px;border-bottom:2px solid transparent;color:var(--text-3)">Updates</button>
        </div>
        <div id="admin-content">Loading…</div>
        <div class="modal-actions">
            <button class="btn-cancel" onclick="closeModal()">Close</button>
        </div>
    `);
    loadAdminTab('users');
}

function loadAdminTab(tab, btnEl) {
    if (btnEl) {
        document.querySelectorAll('.admin-tab').forEach(t => { t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--text-3)'; });
        btnEl.style.borderBottomColor = 'var(--accent)';
        btnEl.style.color = 'var(--text)';
    }
    const c = document.getElementById('admin-content');
    if (tab === 'users') loadAdminUsers(c);
    else if (tab === 'stats') loadAdminStats(c);
    else if (tab === 'theme') loadAdminTheme(c);
    else if (tab === 'updates') loadAdminUpdates(c);
}

async function loadAdminUsers(c) {
    c.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
        const res = await api('/api/admin/users');
        const d = await res.json();
        let html = `
            <div style="background:var(--bg-input);padding:12px;border-radius:10px;margin-bottom:12px">
                <div style="font-weight:600;margin-bottom:8px">Add user</div>
                <input id="adm-user-u" type="text" placeholder="Username" style="margin-bottom:6px">
                <input id="adm-user-p" type="text" placeholder="Password" style="margin-bottom:6px">
                <div style="display:flex;gap:6px;margin-bottom:6px">
                    <select id="adm-user-r" style="flex:1;margin:0">
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                    </select>
                    <input id="adm-user-q" type="number" value="500" placeholder="MB" style="flex:1;margin:0">
                </div>
                <button class="btn-primary" onclick="adminAddUser()" style="width:100%;margin:0">Add</button>
            </div>
        `;
        d.users.forEach(u => {
            const usedMB = (u.used_bytes / (1024*1024)).toFixed(1);
            html += `
                <div style="background:var(--bg-input);padding:10px;border-radius:8px;margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
                        <div>
                            <div style="font-weight:600">${u.online ? '<span style="color:var(--green)">●</span> ' : ''}${esc(u.username)}
                                <span style="background:${u.role==='admin'?'var(--red)':'var(--accent)'};padding:1px 6px;border-radius:5px;font-size:10px;color:white">${u.role}</span>
                            </div>
                            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${usedMB} MB / ${u.quota_mb} MB</div>
                        </div>
                        <div style="display:flex;gap:4px">
                            <button onclick="adminEditUser('${esc(u.username)}',${u.quota_mb})" style="padding:6px 10px;background:var(--accent);color:white;border-radius:6px;font-size:12px">Edit</button>
                            <button onclick="adminDelUser('${esc(u.username)}')" style="padding:6px 10px;background:var(--red);color:white;border-radius:6px;font-size:12px">×</button>
                        </div>
                    </div>
                </div>
            `;
        });
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = `<div style="color:var(--red)">${esc(e.message)}</div>`;
    }
}

async function adminAddUser() {
    const u = document.getElementById('adm-user-u').value.trim();
    const p = document.getElementById('adm-user-p').value.trim();
    const r = document.getElementById('adm-user-r').value;
    const q = parseInt(document.getElementById('adm-user-q').value, 10) || 500;
    if (!u || !p) return alert('Username/password required');
    const res = await apiPost('/api/admin/users/add', { username: u, password: p, role: r, quota_mb: q });
    if (res.ok) loadAdminUsers(document.getElementById('admin-content'));
    else alert((await res.json()).detail || 'Failed');
}
async function adminEditUser(u, q) {
    const newQ = prompt(`Quota MB for "${u}":`, q);
    if (newQ === null) return;
    const newP = prompt(`New password (empty to keep):`, '');
    const body = { username: u, quota_mb: parseInt(newQ, 10) || q };
    if (newP) body.password = newP;
    const res = await apiPost('/api/admin/users/update', body);
    if (res.ok) loadAdminUsers(document.getElementById('admin-content'));
    else alert('Failed');
}
async function adminDelUser(u) {
    if (!confirm(`Delete user "${u}"?`)) return;
    const res = await apiPost('/api/admin/users/delete', { username: u });
    if (res.ok) loadAdminUsers(document.getElementById('admin-content'));
    else alert('Failed');
}

async function loadAdminStats(c) {
    c.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
        const res = await api('/api/admin/stats');
        const d = await res.json();
        const diskPct = d.disk_total ? (d.disk_used / d.disk_total * 100).toFixed(1) : 0;
        c.innerHTML = `
            <div style="background:var(--bg-input);padding:12px;border-radius:10px;margin-bottom:8px">
                <div style="font-size:11px;color:var(--text-3);text-transform:uppercase">Online</div>
                <div style="font-size:20px;font-weight:700">${d.online_count} / ${d.users_count}</div>
            </div>
            <div style="background:var(--bg-input);padding:12px;border-radius:10px;margin-bottom:8px">
                <div style="font-size:11px;color:var(--text-3);text-transform:uppercase">Messages</div>
                <div style="font-size:20px;font-weight:700">${d.messages_count.toLocaleString()}</div>
            </div>
            <div style="background:var(--bg-input);padding:12px;border-radius:10px;margin-bottom:8px">
                <div style="font-size:11px;color:var(--text-3);text-transform:uppercase">Uploads</div>
                <div style="font-size:20px;font-weight:700">${d.uploads_files.toLocaleString()} <span style="font-size:12px;color:var(--text-3)">${fmtBytes(d.uploads_bytes)}</span></div>
            </div>
            <div style="background:var(--bg-input);padding:12px;border-radius:10px">
                <div style="font-size:11px;color:var(--text-3);text-transform:uppercase">Disk</div>
                <div style="font-size:16px;font-weight:600">${fmtBytes(d.disk_used)} / ${fmtBytes(d.disk_total)}</div>
                <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:10px;margin-top:6px">
                    <div style="height:100%;width:${diskPct}%;background:${diskPct>85?'var(--red)':'var(--accent)'};border-radius:10px"></div>
                </div>
            </div>
        `;
    } catch (e) {
        c.innerHTML = `<div style="color:var(--red)">${esc(e.message)}</div>`;
    }
}

async function loadAdminTheme(c) {
    c.innerHTML = `
        <div style="background:var(--bg-input);padding:12px;border-radius:10px">
            <div style="font-weight:600;margin-bottom:10px">Theme settings will appear here.</div>
            <div style="font-size:12px;color:var(--text-3)">In this version, the dark Telegram theme is the only one. Customization comes in a later update.</div>
        </div>
    `;
}

async function loadAdminUpdates(c) {
    c.innerHTML = `
        <div style="background:var(--bg-input);padding:12px;border-radius:10px;margin-bottom:8px">
            <div style="font-weight:600;font-size:14px;margin-bottom:6px">🔄 Update from GitHub</div>
            <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Creates a backup first and restarts the service.</div>
            <button class="btn-primary" id="adm-update-btn" onclick="adminUpdate()" style="width:100%;margin:0">Update Now</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button onclick="adminBackup()" style="padding:10px;background:var(--bg-input);border-radius:8px;font-weight:500">Manual Backup</button>
            <button onclick="adminRestart()" style="padding:10px;background:var(--bg-input);border-radius:8px;font-weight:500">Restart Service</button>
        </div>
        <div id="adm-backup-list" style="margin-top:12px"></div>
    `;
    try {
        const res = await api('/api/admin/backups');
        const d = await res.json();
        const list = document.getElementById('adm-backup-list');
        if (!d.backups.length) { list.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:10px">No backups</div>'; return; }
        list.innerHTML = d.backups.map(b => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-input);border-radius:8px;margin-bottom:6px;font-size:12px">
                <div>
                    <div>${esc(b.name)}</div>
                    <div style="color:var(--text-3)">${new Date(b.created).toLocaleString()} · ${fmtBytes(b.size_bytes)}</div>
                </div>
                <button onclick="adminRollback('${esc(b.name)}')" style="padding:5px 10px;background:var(--orange);color:white;border-radius:6px;font-size:12px">Rollback</button>
            </div>
        `).join('');
    } catch {}
}
async function adminUpdate() {
    if (!confirm('Update from GitHub now?')) return;
    const btn = document.getElementById('adm-update-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Updating…'; }
    try {
        const res = await apiPost('/api/admin/update', {});
        if (res.ok) {
            alert('✅ Update applied. Reloading…');
            setTimeout(() => location.reload(), 4000);
        } else alert('Failed');
    } catch (e) { alert(e.message); }
}
async function adminBackup() {
    const res = await apiPost('/api/admin/backup', {});
    if (res.ok) { alert('Backup created'); loadAdminTab('updates'); }
}
async function adminRestart() {
    if (!confirm('Restart service?')) return;
    await apiPost('/api/admin/restart', {});
    alert('Restarting…');
    setTimeout(() => location.reload(), 4000);
}
async function adminRollback(name) {
    if (!confirm('Rollback to ' + name + '?')) return;
    const res = await apiPost('/api/admin/rollback', { name });
    if (res.ok) { alert('Rolled back, reloading…'); setTimeout(() => location.reload(), 4000); }
    else alert('Failed');
}

// ============================================================
// 25. SERVICE WORKER
// ============================================================
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/service-worker.js').catch(() => {});
    }
}

// ============================================================
// 26. INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    // Login handlers
    document.getElementById('login-btn').addEventListener('click', doLogin);
    ['login-username', 'login-password'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') doLogin();
        });
    });

    // Auto-login if token exists
    if (State.token && State.user) {
        // verify token by fetching quota
        api('/api/quota').then(res => {
            if (res.ok) enterApp();
            else {
                localStorage.clear();
                State.token = null;
            }
        }).catch(() => {
            localStorage.clear();
            State.token = null;
        });
    }

    // ESC handlers for lightbox/menus already in setupHandlers
});

// Expose globals for inline onclicks
window.doLogout = doLogout;
window.cancelReply = cancelReply;
window.cancelUpload = cancelUpload;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.acceptCall = acceptCall;
window.endCall = endCall;
window.toggleMute = toggleMute;
window.toggleCamera = toggleCamera;
window.switchCamera = switchCamera;
window.sendReaction = sendReaction;
window.jumpToMessage = jumpToMessage;
window.closeModal = closeModal;
window.openNewDMModal = openNewDMModal;
window.openNewGroupModal = openNewGroupModal;
window.submitNewDM = submitNewDM;
window.submitNewGroup = submitNewGroup;
window.doForward = doForward;
window.loadAdminTab = loadAdminTab;
window.adminAddUser = adminAddUser;
window.adminEditUser = adminEditUser;
window.adminDelUser = adminDelUser;
window.adminUpdate = adminUpdate;
window.adminBackup = adminBackup;
window.adminRestart = adminRestart;
window.adminRollback = adminRollback;

// Phase 6 additions
window.uploadAvatar = uploadAvatar;
window.removeAvatar = removeAvatar;
window.openChangePasswordModal = openChangePasswordModal;
window.submitChangePassword = submitChangePassword;
window.openSettingsModal = openSettingsModal;
window.openVideoMessageRecorder = openVideoMessageRecorder;
