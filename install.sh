#!/bin/bash
# install.sh

WORKING_DIR="/opt/black-chat"
mkdir -p "$WORKING_DIR"

echo "[+] Downloading Management Script..."
# لینک زیر را با آدرس فایل manage_chat.sh در گیت‌هاب خودت عوض کن
curl -sL "https://raw.githubusercontent.com/saeederamy/Black-Chat/main/manage_chat.sh" -o "$WORKING_DIR/manage_chat.sh"
chmod +x "$WORKING_DIR/manage_chat.sh"

sudo ln -sf "$WORKING_DIR/manage_chat.sh" /usr/local/bin/black-chat
sudo chmod +x /usr/local/bin/black-chat

echo -e "\033[0;32m[✔] Installation complete! Type 'black-chat' to open the menu.\033[0m"
