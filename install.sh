#!/bin/bash

# ==========================================
# Black Chat - Advanced Management Script
# ==========================================

INSTALL_DIR="/opt/black-chat"
SERVICE_NAME="black-chat.service"
ENV_FILE="$INSTALL_DIR/.env"
USERS_FILE="$INSTALL_DIR/users.txt"
# لینک ریپازیتوری شما برای آپدیت خودکار
REPO_URL="https://raw.githubusercontent.com/saeederamy/Black-Chat/main"

GREEN="\e[32m"
RED="\e[31m"
WHITE="\e[97m"
CYAN="\e[36m"
YELLOW="\e[33m"
RESET="\e[0m"

function check_root() {
    if [ "$EUID" -ne 0 ]; then echo -e "${RED}Please run as root (sudo bash install.sh)${RESET}"; exit 1; fi
}

function create_global_command() {
    cat <<EOF > /usr/local/bin/black-chat
#!/bin/bash
cd $INSTALL_DIR && bash install.sh
EOF
    chmod +x /usr/local/bin/black-chat
}

function install_app() {
    echo -e "${WHITE}--- 🚀 Initial Setup (Black Chat) ---${RESET}"
    
    read -e -p "Enter Application Port (Default: 8000): " APP_PORT
    APP_PORT=${APP_PORT:-8000}

    read -e -p "Enter Admin Username (Default: admin): " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}

    read -e -p "Enter Admin Password: " ADMIN_PASS
    if [ -z "$ADMIN_PASS" ]; then echo -e "${RED}Password cannot be empty!${RESET}"; return; fi

    echo -e "${CYAN}Installing dependencies...${RESET}"
    apt update && apt install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx curl
    
    mkdir -p $INSTALL_DIR/static/uploads
    mkdir -p $INSTALL_DIR/templates
    
    # در صورت وجود فایل‌های لوکال کپی می‌شوند، در غیر این صورت از گیت‌هاب دانلود می‌شوند
    if [ -f "main.py" ]; then
        cp -r * $INSTALL_DIR/ 2>/dev/null
    else
        echo -e "${CYAN}Downloading files from GitHub...${RESET}"
        curl -sL "$REPO_URL/main.py" -o "$INSTALL_DIR/main.py"
        curl -sL "$REPO_URL/templates/index.html" -o "$INSTALL_DIR/templates/index.html"
        curl -sL "$REPO_URL/static/script.js" -o "$INSTALL_DIR/static/script.js"
        curl -sL "$REPO_URL/install.sh" -o "$INSTALL_DIR/install.sh"
    fi
    
    cd $INSTALL_DIR

    echo "APP_PORT=$APP_PORT" > $ENV_FILE
    echo "$ADMIN_USER:$ADMIN_PASS:admin" > $USERS_FILE

    echo -e "${CYAN}Setting up Python Environment (FastAPI)...${RESET}"
    python3 -m venv venv
    source venv/bin/activate
    pip install fastapi uvicorn websockets python-multipart aiofiles

    cat <<EOF > /etc/systemd/system/$SERVICE_NAME
[Unit]
Description=Black Chat Telegram Clone
After=network.target

[Service]
User=root
WorkingDirectory=$INSTALL_DIR
Environment="PATH=$INSTALL_DIR/venv/bin"
ExecStart=$INSTALL_DIR/venv/bin/uvicorn main:app --host 127.0.0.1 --port $APP_PORT
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME
    
    create_global_command
    echo -e "${GREEN}[✔] Installation completed successfully!${RESET}"
    echo -e "${YELLOW}Type 'black-chat' anywhere in your terminal to open this menu.${RESET}"
}

function update_app() {
    echo -e "\n${CYAN}🔄 Fetching latest updates from GitHub...${RESET}"
    mkdir -p "$INSTALL_DIR/templates" "$INSTALL_DIR/static"
    
    curl -sL "$REPO_URL/main.py" -o "$INSTALL_DIR/main.py"
    curl -sL "$REPO_URL/templates/index.html" -o "$INSTALL_DIR/templates/index.html"
    curl -sL "$REPO_URL/static/script.js" -o "$INSTALL_DIR/static/script.js"
    curl -sL "$REPO_URL/install.sh" -o "$INSTALL_DIR/install.sh"
    chmod +x "$INSTALL_DIR/install.sh"
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        systemctl restart $SERVICE_NAME
    fi
    
    echo -e "${GREEN}[✔] Update Complete! Users, Database, and uploads are safe.${RESET}"
}

function add_user() {
    if [ ! -f "$USERS_FILE" ]; then echo -e "${RED}Not installed yet!${RESET}"; return; fi
    echo -e "${WHITE}--- 👤 Add New User ---${RESET}"
    read -e -p "Enter Username: " NEW_USER
    if grep -q "^$NEW_USER:" "$USERS_FILE"; then echo -e "${RED}User already exists!${RESET}"; return; fi
    read -e -p "Enter Password: " NEW_PASS
    
    read -e -p "Enter Role (admin/user) [Default: user]: " NEW_ROLE
    NEW_ROLE=${NEW_ROLE:-user}

    echo "$NEW_USER:$NEW_PASS:$NEW_ROLE" >> $USERS_FILE
    echo -e "${GREEN}[✔] User '$NEW_USER' added!${RESET}"
}

function delete_user() {
    if [ ! -f "$USERS_FILE" ]; then echo -e "${RED}No users file found!${RESET}"; return; fi
    echo -e "${YELLOW}--- Current Users ---${RESET}"
    cat $USERS_FILE | awk -F':' '{print "- "$1" ("$3")"}'
    echo -e "---------------------"
    read -e -p "Enter Username to delete: " DEL_USER
    
    if grep -q "^$DEL_USER:" "$USERS_FILE"; then
        sed -i "/^$DEL_USER:/d" "$USERS_FILE"
        echo -e "${GREEN}[✔] User '$DEL_USER' deleted successfully!${RESET}"
    else
        echo -e "${RED}[!] User not found!${RESET}"
    fi
}

function setup_ssl_auto() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE
    read -e -p "Enter your domain name (e.g., chat.domain.com): " DOMAIN
    
    cat <<EOF > /etc/nginx/sites-available/black-chat
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 500M;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/black-chat /etc/nginx/sites-enabled/
    systemctl restart nginx
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email
    
    # اضافه کردن نام دامنه به فایل کانفیگ
    echo "DOMAIN=$DOMAIN" >> $ENV_FILE
    echo -e "${GREEN}[✔] Auto SSL & Nginx Ready!${RESET}"
}

function setup_ssl_manual() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE
    echo -e "${WHITE}--- 🔐 Manual SSL Configuration ---${RESET}"
    read -e -p "Enter your domain name (e.g., chat.domain.com): " DOMAIN
    read -e -p "Enter absolute path to Certificate (.crt / .pem): " CERT_PATH
    read -e -p "Enter absolute path to Private Key (.key): " KEY_PATH

    if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
        echo -e "${RED}[!] Certificate or Key file does not exist at the provided paths!${RESET}"
        return
    fi

    cat <<EOF > /etc/nginx/sites-available/black-chat
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;
    
    ssl_certificate $CERT_PATH;
    ssl_certificate_key $KEY_PATH;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/black-chat /etc/nginx/sites-enabled/
    systemctl restart nginx
    echo "DOMAIN=$DOMAIN" >> $ENV_FILE
    echo -e "${GREEN}[✔] Manual SSL Setup successfully applied!${RESET}"
}

function uninstall_app() {
    echo -e "${RED}⚠️ WARNING: This will delete the app, database, users, and all uploaded files!${RESET}"
    read -e -p "Are you absolutely sure? (y/n): " choice
    if [ "$choice" == "y" ]; then
        echo "Stopping and removing service..."
        systemctl stop $SERVICE_NAME 2>/dev/null
        systemctl disable $SERVICE_NAME 2>/dev/null
        rm -f /etc/systemd/system/$SERVICE_NAME
        systemctl daemon-reload
        
        echo "Removing Nginx configs..."
        rm -f /etc/nginx/sites-enabled/black-chat
        rm -f /etc/nginx/sites-available/black-chat
        systemctl restart nginx

        echo "Deleting files..."
        rm -rf $INSTALL_DIR
        rm -f /usr/local/bin/black-chat
        
        echo -e "${RED}[✔] Black Chat has been completely uninstalled.${RESET}"
        exit 0
    fi
}

check_root

while true; do
    clear
    if systemctl is-active --quiet $SERVICE_NAME; then STATUS="${GREEN}▶ RUNNING${RESET}"; else STATUS="${RED}🛑 STOPPED${RESET}"; fi

    echo -e "${GREEN}=========================================${RESET}"
    echo -e "${GREEN}       Black Chat Management Panel       ${RESET}"
    echo -e "${GREEN}=========================================${RESET}"
    echo -e "Service Status: $STATUS"
    echo -e "${GREEN}-----------------------------------------${RESET}"
    echo -e " ${YELLOW}1)${RESET} 🚀 Initial Setup (Install & Config)"
    echo -e " ${YELLOW}2)${RESET} 🔄 Update App (Fetch Latest from GitHub)"
    echo -e " ${YELLOW}3)${RESET} 👤 Add New User"
    echo -e " ${YELLOW}4)${RESET} 🗑️  Delete User"
    echo -e " ${YELLOW}5)${RESET} ▶️  Start Service"
    echo -e " ${YELLOW}6)${RESET} 🛑 Stop / Restart Service"
    echo -e " ${YELLOW}7)${RESET} 🔐 Setup Nginx & Auto SSL (Certbot)"
    echo -e " ${YELLOW}8)${RESET} 🔐 Setup Nginx & Manual SSL"
    echo -e " ${YELLOW}9)${RESET} 🔑 Show Users & Info"
    echo -e "${RED}10)${RESET} ☢️  Full Uninstall (Nuclear Option)"
    echo -e "  ${RED}0)${RESET} ❌ Exit"
    echo -e "${GREEN}-----------------------------------------${RESET}"
    read -e -p "Choose an option (0-10): " choice

    case $choice in
        1) install_app ; sleep 2 ;;
        2) update_app ; sleep 3 ; exec black-chat ;; # ری‌استارت پنل بعد از آپدیت
        3) add_user ; sleep 2 ;;
        4) delete_user ; sleep 2 ;;
        5) systemctl start $SERVICE_NAME; echo -e "${GREEN}[✔] Started!${RESET}" ; sleep 1 ;;
        6) systemctl restart $SERVICE_NAME; echo -e "${GREEN}[✔] Restarted!${RESET}" ; sleep 1 ;;
        7) setup_ssl_auto ; sleep 2 ;;
        8) setup_ssl_manual ; sleep 2 ;;
        9) 
           echo -e "\n${CYAN}--- Registered Users ---${RESET}"
           if [ -f "$USERS_FILE" ]; then cat $USERS_FILE | awk -F':' '{print "User: "$1" | Role: "$3}'; else echo "No users found."; fi
           echo ""
           read -p "Press Enter to return..." 
           ;;
        10) uninstall_app ; sleep 2 ;;
        0) clear; exit 0 ;;
        *) echo -e "${RED}Invalid option!${RESET}" ; sleep 1 ;;
    esac
done
