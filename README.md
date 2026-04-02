# 💬 Black Chat Web Messenger

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![Flask](https://img.shields.io/badge/Framework-Flask-black.svg?logo=flask)
![Socket.IO](https://img.shields.io/badge/WebSocket-Socket.IO-black.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

A lightweight, secure, and real-time web messenger built with Python (Flask) and a powerful terminal management panel. Features a modern **Glassmorphism** user interface and an automated installation script for Linux servers.

## ✨ Features

- 🎨 **Modern UI:** Sleek, dark-themed, and responsive Glassmorphism design.
- ⚡ **Real-Time Communication:** Instant messaging powered by WebSockets.
- 📁 **Rich Media Support:** Seamlessly share Images, Videos, and record Live Audio (Voice Messages).
- 🛠️ **Management Panel:** A robust, colorful Bash menu directly in your terminal to manage the server.
- 🔐 **Secure User Management:** Registration is disabled on the web; users can only be added securely via the server terminal.
- 🌐 **Auto SSL & Nginx:** Built-in options to easily set up Nginx reverse proxy and obtain SSL certificates via Let's Encrypt (Certbot).

---

## 🚀 Quick Installation

Run the following one-liner command on your Linux server (Ubuntu/Debian recommended) as `root`. This will automatically download and install the required dependencies, set up the service, and create the management command.

```bash
bash <(curl -sL [https://raw.githubusercontent.com/saeederamy/Black-Chat/main/install.sh](https://raw.githubusercontent.com/saeederamy/Black-Chat/main/install.sh))
