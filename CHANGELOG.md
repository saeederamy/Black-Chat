# Changelog

All notable changes to **Black Chat** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.4.0] — Phase 9

### Added
- 🔇 **Mute chats** — silence specific chats or groups; server-side persistence
- 🔕 Muted indicator in sidebar + grayed-out unread badges
- 📲 **Web Push notifications** — receive messages on Chrome desktop and mobile PWA even when the tab/app is closed
- 🔑 Auto-generated VAPID keys (stored in `.vapid.json`)
- 🤝 **Auto-detection of existing TURN configuration** (e.g. from Black Meet on the same server) during install
- 🌐 DNS resolution to auto-pick `turn.<realm>` vs `<realm>` for TURN hostname
- 🛠️ Admin update now auto-installs new pip dependencies (pywebpush, cryptography)

### Changed
- WebRTC: ice servers now include both UDP, TCP, and TLS (`turns:`) variants for better Iran/restricted-network support
- Install script: option 10 (TURN setup) detects pre-existing coturn configs

### Fixed
- TURN hostname resolution when `realm` is just a domain but actual service is on `turn.<realm>`

---

## [2.3.0] — Phase 8

### Added
- 🔵 **Selection mode** with full toolbar (Copy, Forward, Delete)
- 👈 **Swipe-to-reply** on mobile with haptic feedback
- 👥 **Manage Group** modal — kick / add members, owner badge
- 🚪 Leave group / Delete group / Delete DM options
- 🚫 **Block / unblock users** (bidirectional message filter)
- 📜 **Clear history** is now server-side (persists across refresh)
- 🏷️ **@Mentions** with autocomplete dropdown
- 🔗 Click an `@mention` to open a DM with that user (auto-add contact)
- 🍞 **In-app notification toast** for messages in other chats
- 👀 Improved read receipts — blue double-tick when seen

### Fixed
- Reaction picker overlapping the Delete button on own messages
- Multiple selection now works properly

---

## [2.2.0] — Phase 7

### Added
- 😀 **Reactions** with 4 default emojis (👍 👎 ❤️ 😂)
- 👤 **Telegram-style profile pane** — slide-in panel with Media / Files / Voice tabs
- 🌐 **Automatic RTL detection** per-message for Persian / Arabic / Hebrew text
- ✍️ Developer signature with GitHub link (in login screen + main menu)
- 🎨 New login page — glassmorphism design inspired by Black Hub

---

## [2.1.0] — Phase 6

### Added
- 👤 **Telegram-style profile** with circular avatar header, gradient background
- 📸 Avatar upload / remove with hover overlay
- 🔑 **Change password** modal with validation
- 🎙️ **Voice recording overhaul** — tap-to-start, live waveform via AudioContext, pause/resume/cancel/send buttons
- 🎥 **Video message capsule** — round mirror-style preview, 60s max
- 📝 Persian / Arabic / Hebrew font fallback (Vazirmatn, Vazir, Tahoma)

### Fixed
- Voice recording on mobile (replaced unreliable hold-to-record with tap-to-start)
- iOS Safari support via mp4/aac mime fallback

---

## [2.0.0] — Full Rewrite

### Changed
- 🔄 **Complete frontend rewrite from scratch** — 47% less JavaScript, 78% less HTML
- 🎨 New pure-black UI inspired by Telegram Desktop
- 🏗️ Modular code: HTML / CSS / JS in separate files (was inline)
- 📦 Backend (`main.py`) preserved unchanged

### Fixed
- Page-shift bug when typing or replying (CSS `contain: layout` + `overflow-anchor`)
- Textarea stuck wide after sending
- Context menu position on mobile (was stuck top-right)

---

## [1.x] — Initial Releases

### Added
- Core FastAPI + WebSocket backend
- SQLite persistence
- User authentication with `users.txt`
- Per-user storage quotas
- File uploads (images, videos, voice, files)
- Direct messages & groups
- WebRTC 1-on-1 voice & video calls
- coturn auto-install via `install.sh`
- Admin panel with user management, stats, and GitHub update
- PWA support (manifest + service worker)
- Reply, edit, delete, forward messages
- Pinned messages
- Typing indicators, online status, last-seen
- Read receipts
- Image albums / collage rendering
- Lightbox viewer
- Search inside chats

---

[2.4.0]: https://github.com/saeederamy/Black-Chat/releases/tag/v2.4.0
[2.3.0]: https://github.com/saeederamy/Black-Chat/releases/tag/v2.3.0
[2.2.0]: https://github.com/saeederamy/Black-Chat/releases/tag/v2.2.0
[2.1.0]: https://github.com/saeederamy/Black-Chat/releases/tag/v2.1.0
[2.0.0]: https://github.com/saeederamy/Black-Chat/releases/tag/v2.0.0
