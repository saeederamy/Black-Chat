#!/bin/bash
# install.sh

WORKING_DIR="/opt/black-chat"
mkdir -p "$WORKING_DIR"

echo -e "\033[0;36m[+] Downloading Management Script...\033[0m"
curl -sL "https://raw.githubusercontent.com/saeederamy/Black-Chat/main/manage_chat.sh" -o "$WORKING_DIR/manage_chat.sh"
chmod +x "$WORKING_DIR/manage_chat.sh"

sudo ln -sf "$WORKING_DIR/manage_chat.sh" /usr/local/bin/black-chat
sudo chmod +x /usr/local/bin/black-chat

echo -e "\033[0;32m[✔] Installation script loaded successfully!\033[0m"
sleep 1

# باز کردن خودکار منو
black-chat
