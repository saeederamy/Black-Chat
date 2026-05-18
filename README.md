<div align="center">

<img src="static/icon-192.png" alt="Black Chat" width="120" />

# Black Chat

**A self-hosted, Telegram-style realtime messenger.**
Pure black UI · End-to-end privacy on your own server · Voice & video calls · PWA · Works behind censorship.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Platform](https://img.shields.io/badge/platform-Ubuntu%2022.04+-orange.svg)](#-requirements)
[![PWA](https://img.shields.io/badge/PWA-ready-purple.svg)](https://web.dev/progressive-web-apps/)

[Features](#-features) · [Install](#-quick-install) · [Screenshots](#-screenshots) · [Docs](#-documentation) · [Donate](#-support-the-project)

</div>

---

## 🌟 What is Black Chat?

Black Chat is a **fully self-hosted Telegram alternative** you run on your own server. You own all the data. No third party reads your messages. No subscription. No tracking.

It looks and feels like Telegram Desktop in pure-black theme, with all the features you expect from a modern messenger — built in pure Python (FastAPI) on the backend and vanilla JavaScript on the frontend (no React, no build step).

It's designed especially for environments with restricted internet (such as Iran), with built-in TURN/TLS support to keep voice and video calls working when STUN-only would fail.

---

## ✨ Features

### 💬 Messaging
- **Direct messages** & **group chats**
- **Reply, edit, delete, forward** messages
- **Reactions** (👍 👎 ❤️ 😂) with one-tap picker
- **Pin messages** with sticky banner
- **@Mentions** with autocomplete dropdown — tap a mention to open a DM
- **Read receipts** with single/double blue ticks
- **Typing indicators**
- **Online status** & last-seen
- **Auto RTL** — detects Persian/Arabic/Hebrew per-message and aligns automatically
- **Search** inside any chat
- **Swipe-to-reply** on mobile (with haptic feedback)
- **Multi-select** with batch Delete / Forward / Copy

### 📁 Media & Files
- **Photos & videos** with lightbox preview
- **Voice messages** with live waveform, pause, resume, cancel — Telegram-style
- **Video messages** (round capsule, 60s max)
- **Files** with upload progress ring & in-bubble cancel
- **Image albums** & collage layout
- **Quota system** — per-user storage limits (admin-configurable)

### 📞 Voice & Video Calls (WebRTC)
- **1-on-1 voice and video calls**
- **Auto-detected TURN server** — if `/etc/turnserver.conf` exists (e.g. from a Black Meet install), Black Chat uses it without reinstalling coturn
- **STUN + TURN + TURNS (TLS)** for restrictive networks and DPI bypass
- **Mute, camera toggle, camera switch** during call

### 👤 User Experience
- **Telegram-style profile pane** — slide-in panel with Media / Files / Voice tabs
- **Profile photo upload** with circular crop preview
- **Change password** from settings
- **Pure black + Telegram blue** aesthetic — easy on the eyes
- **Glassmorphism login** with animated glow
- **PWA support** — install to home screen on iOS/Android/Desktop
- **Service Worker** for offline asset caching

### 🔔 Notifications
- **Web Push** — notifications even when tab is closed
- **PWA push** on Android (and iOS 16.4+)
- **In-app notification toast** when chat is in another tab
- **Per-chat mute** with visible 🔕 indicator

### 🛡️ Privacy & Moderation
- **Block users** — bidirectional message filter
- **Clear chat history** — server-side cutoff (persists across refreshes)
- **Delete DM** completely (removes contact + history)
- **Leave / Delete groups** with owner badge for group creators
- **Kick members** & **add members** (group owner only)
- **Token-based auth** — simple users.txt, no third-party services

### 🛠️ Admin Panel
- Add/edit/delete users with per-user quotas
- Storage & message statistics
- TURN server status & live coturn restart
- **One-click GitHub update** with automatic backup
- **Rollback to any backup** if an update misbehaves
- Service restart from web UI

### 📱 PWA
- Add to Home Screen on mobile = native-feeling app
- Push notifications when PWA is closed
- Offline-cached static assets

---

## 🚀 Quick Install

> **Requirements:** Ubuntu 22.04 / 24.04 · Root access · A domain name (for SSL & PWA) · A public IP

### One-line install:

```bash
bash <(curl -sL https://raw.githubusercontent.com/saeederamy/Black-Chat/main/install.sh)
```

You'll see a menu:

```
[1]  Initial Setup           (install Black Chat fresh)
[2]  Update from GitHub      (preserves users & messages)
[3]  Restart service
[4]  Show service status
[5]  Show logs
[6]  Backup now
[7]  Setup SSL (Let's Encrypt with auto-renew)
[8]  Setup SSL (manual certificate)
[9]  Show TURN credentials
[10] Setup coturn (TURN server)   ← Required for calls between different networks
[11] Restart coturn
[12] Safe Uninstall
```

**Order to follow:**
1. `1` — Initial Setup
2. `7` or `8` — SSL (HTTPS is **required** for PWA, camera, microphone)
3. `10` — TURN server (required for voice/video calls)

### Already have Black Meet?

If you already run [Black Meet](https://github.com/saeederamy/black-meet) on the same server, Black Chat auto-detects its `/etc/turnserver.conf` during step `10` and offers to reuse it. **Your Black Meet config is never modified.**

---

## 🔄 Updating

From the admin panel:
1. Login as admin → Settings → Admin Panel → Updates → **🔄 Update Now**
2. A backup is created automatically.
3. Service restarts in ~5 seconds.
4. `Ctrl+Shift+R` in browser to bust cache.

Or from the command line:
```bash
black-chat
# Choose: 2 (Update from GitHub)
```

If something breaks, restore from the admin panel: Updates → Rollback (or `black-chat` → option 2).

Your `users.txt`, database, and uploaded files are **never touched** during updates.

---

## 📸 Screenshots

> Add your screenshots to a `docs/screenshots/` folder and link them here, e.g.:
>
> ```markdown
> ![Chat view](docs/screenshots/chat.png)
> ![Profile pane](docs/screenshots/profile.png)
> ![Voice recording](docs/screenshots/voice.png)
> ```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / PWA                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ HTML + Vanilla JS + CSS (no React, no build step)   │    │
│  │ Service Worker (push, offline cache)                │    │
│  └────────────┬────────────────────────────────────────┘    │
└───────────────┼─────────────────────────────────────────────┘
                │  HTTPS + WSS (via Nginx)
                ▼
┌─────────────────────────────────────────────────────────────┐
│  /opt/black-chat/                                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ main.py (FastAPI + WebSocket)                       │    │
│  │   • REST API for auth, profiles, admin              │    │
│  │   • WebSocket for realtime chat                     │    │
│  │   • SQLite (chat.db) for persistence                │    │
│  │   • Per-user file uploads with quotas               │    │
│  │   • Web Push (VAPID)                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Optional: coturn (TURN/STUN)                               │
│   • UDP, TCP, and TLS (turns:) for restricted networks      │
└─────────────────────────────────────────────────────────────┘
```

### Tech stack
- **Backend:** Python 3.10+ · FastAPI · WebSockets · SQLite · aiofiles · pywebpush
- **Frontend:** Vanilla JS · Vanilla CSS · No build step
- **Realtime:** WebSocket
- **Calls:** WebRTC with coturn (TURN/STUN)
- **Storage:** Local filesystem with per-user quotas
- **Auth:** Simple users.txt + token-based session
- **PWA:** manifest.json + Service Worker
- **Web server:** Nginx reverse proxy

### File layout

```
/opt/black-chat/
├── main.py                  # FastAPI app
├── install.sh               # CLI installer/updater (`black-chat` command)
├── users.txt                # username:password:role:quota_mb
├── chat.db                  # SQLite (auto-created)
├── .env                     # TURN credentials
├── .tokens.json             # Active session tokens
├── .vapid.json              # Web Push keys (auto-generated)
├── backups/                 # Auto backups before each update
├── templates/
│   └── index.html
├── static/
│   ├── script.js
│   ├── style.css
│   ├── service-worker.js
│   ├── manifest.json
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── favicon-32.png
│   └── uploads/             # User-uploaded media
└── venv/                    # Python virtualenv
```

---

## 📋 Requirements

- **OS:** Ubuntu 22.04 LTS or 24.04 LTS (Debian-based should work)
- **Python:** 3.10+
- **RAM:** 512 MB minimum, 1 GB+ recommended
- **Storage:** Depends on user count and media usage
- **Network:**
  - A domain pointing to your server (for HTTPS + PWA)
  - Open ports: 80, 443 (web), 3478/UDP+TCP & 5349/TLS (TURN)
- **Optional but recommended:** A second domain `turn.yourdomain.com` pointing to the same IP for TURN

---

## 🔧 Configuration

### Adding users

Users are stored as plain text in `/opt/black-chat/users.txt`:

```
username:password:role:quota_mb
admin:secret:admin:5000
alice:hello:user:500
bob:world:user:200
```

- `role` is either `admin` or `user`
- `quota_mb` is the upload quota in megabytes
- Add users via the **admin panel UI** (recommended) or by editing the file directly

After editing manually:
```bash
systemctl restart black-chat.service
```

### TURN configuration

Edit `/opt/black-chat/.env`:

```ini
TURN_HOST=turn.yourdomain.com
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_USER=youruser
TURN_PASS=yourpass
TURN_REALM=yourdomain.com
```

These are auto-filled by `install.sh` option 10. You shouldn't need to edit by hand.

If you have an existing coturn install (e.g. from [Black Meet](https://github.com/saeederamy/black-meet)), Black Chat auto-detects it and reuses the credentials.

---

## 🧪 Development

```bash
# Clone
git clone https://github.com/saeederamy/Black-Chat.git
cd Black-Chat

# Create venv
python3 -m venv venv
source venv/bin/activate

# Install deps
pip install fastapi uvicorn websockets python-multipart aiofiles pywebpush cryptography

# Run
python -m uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000`. The default admin login is set on first launch via `users.txt`.

⚠️ For PWA, camera/mic, and Web Push to work, you need **HTTPS**. Use a reverse proxy (Nginx with self-signed cert) or a tool like [Caddy](https://caddyserver.com) for local dev.

---

## ❓ FAQ

<details>
<summary><strong>Is Black Chat truly private?</strong></summary>

Messages are stored in your SQLite database on your server. There's **no end-to-end encryption** (yet) — meaning if you (the admin) have shell access, you can read the database. For most self-hosted use cases this is fine; you trust your own server. For higher threat models, consider Signal or Matrix instead.

</details>

<details>
<summary><strong>Does it work in Iran / behind a strict firewall?</strong></summary>

Yes — that's a core design target. The bundled coturn ships with `turns:` (TLS over 5349/tcp) which mimics HTTPS and bypasses most DPI. Make sure to open port 5349/tcp on your firewall.

</details>

<details>
<summary><strong>Can I use it with Black Meet on the same server?</strong></summary>

Yes. Black Chat is designed to coexist with Black Meet. During install step 10, it detects Black Meet's existing `/etc/turnserver.conf` and offers to reuse it without modifying anything.

</details>

<details>
<summary><strong>How many users can it handle?</strong></summary>

It's a single-process FastAPI app on SQLite — comfortable up to a few hundred concurrent users on a modest VPS. For larger deployments you'd want to migrate to PostgreSQL and run multiple workers.

</details>

<details>
<summary><strong>Why no React / Vue / Svelte?</strong></summary>

Intentional. Black Chat ships as **plain HTML + JS + CSS** with no build step. You can read and edit `script.js` directly with a text editor. There's nothing to npm install, nothing to webpack, nothing to break in three years when the framework you chose is abandoned. The whole frontend is ~150 KB.

</details>

<details>
<summary><strong>How do I report bugs or request features?</strong></summary>

Open an issue on the [GitHub repo](https://github.com/saeederamy/Black-Chat/issues). Include the browser console output (F12) if it's a frontend bug.

</details>

---

## 🤝 Related Projects

- **[Black Meet](https://github.com/saeederamy/black-meet)** — A self-hosted video meeting platform (Jitsi-lite). Shares the same TURN server with Black Chat.
- **[Black Hub](https://github.com/saeederamy/black-hub)** — Personal dashboard hub. Inspired the login page aesthetic.

---

## 📜 License

MIT License. See [LICENSE](LICENSE) for full text.

You're free to use, modify, and self-host. Commercial use is allowed. Attribution appreciated but not required.

---

## 💝 Support the Project

If Black Chat is useful to you, please consider supporting development. It helps cover server costs for testing, and motivates more open-source releases.

You can donate crypto:

<table>
<tr>
<th align="left">Asset</th>
<th align="left">Network</th>
<th align="left">Address</th>
</tr>
<tr>
<td>🪙 <strong>Litecoin</strong></td>
<td>LTC</td>
<td><code>ltc1qxhuvs6j0suvv50nqjsuujqlr3u4ekfmys2ydps</code></td>
</tr>
<tr>
<td>💎 <strong>Toncoin</strong></td>
<td>TON</td>
<td><code>UQAHI_ySJ1HTTCkNxuBB93shfdhdec4LSgsd3iCOAZd5yGmc</code></td>
</tr>
</table>

> 🙏 **Even a small donation matters.** Every contribution — large or small — directly supports continued development and free open-source releases. Thank you for keeping Black Chat alive!

You can also support the project for free by:
- ⭐ **Starring the repo** on GitHub
- 🐛 **Reporting bugs** with detailed reproduction steps
- 💡 **Suggesting features** in Issues
- 📝 **Sharing** with friends who might find it useful

---

## 👨‍💻 Author

**Saeed Eramy**
🔗 [GitHub: @saeederamy](https://github.com/saeederamy)

Built with care in Iran 🇮🇷, for anyone who wants their own private messenger.

---

<div align="center">

**[⬆ back to top](#black-chat)**

Made with ☕ and a lot of late nights.

</div>
