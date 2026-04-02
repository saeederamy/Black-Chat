#!/bin/bash

# --- Config ---
APP_NAME="black-chat"
PY_SCRIPT="app.py"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
WORKING_DIR="/opt/black-chat"
CONF_FILE="chatserver.conf"
REPO_URL="https://raw.githubusercontent.com/saeederamy/Black-Chat/main"

# ایجاد و انتقال به پوشه
mkdir -p "$WORKING_DIR"
cd "$WORKING_DIR" || exit 1

# --- Colors ---
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

ask() {
    echo -n -e "${CYAN}$1${NC}" >&2
    read -e -r res < /dev/tty
    echo "$res" | tr -d '\r\n '
}

if [ ! -f "/usr/local/bin/black-chat" ]; then
    sudo ln -sf "$WORKING_DIR/manage_chat.sh" /usr/local/bin/black-chat
    sudo chmod +x /usr/local/bin/black-chat
fi

show_menu() {
    clear
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}       Black Chat Management Panel       ${NC}"
    echo -e "${GREEN}=========================================${NC}"
    
    if systemctl is-active --quiet $APP_NAME; then
        echo -e "Service Status: ${GREEN}▶ Running${NC}"
    else
        echo -e "Service Status: ${RED}🛑 Stopped${NC}"
    fi
    echo -e "-----------------------------------------"
    
    echo -e " ${YELLOW}1)${NC} 🚀 Initial Setup (Install & Config)"
    echo -e " ${YELLOW}2)${NC} 👤 Add New User (Terminal Only)"
    echo -e " ${YELLOW}3)${NC} ▶️  Start Service"
    echo -e " ${YELLOW}4)${NC} 🛑 Stop Service"
    echo -e " ${YELLOW}5)${NC} ♻️  Restart Service"
    echo -e " ${YELLOW}6)${NC} 🛠️  Run Manually (Debug Mode)"
    echo -e " ${YELLOW}7)${NC} 🔐 Setup Nginx & Auto SSL (Certbot)"
    echo -e " ${YELLOW}8)${NC} 🔐 Setup Nginx & Manual SSL"
    echo -e " ${YELLOW}9)${NC} 🔑 Show Users & Info"
    echo -e "${RED}10)${NC} 🗑️  Full Uninstall (Nuclear Option)"
    echo -e "  ${RED}0)${NC} ❌ Exit"
    echo -e "-----------------------------------------"
}

while true; do
    show_menu
    opt=$(ask "Choose an option (0-10): ")

    case "$opt" in
        1) 
            # پرسیدن پورت از کاربر
            echo -e "\n${CYAN}--- Configuration ---${NC}"
            APP_PORT=$(ask "Enter port for Black Chat (default 5000): ")
            [ -z "$APP_PORT" ] && APP_PORT=5000
            
            sudo apt update && sudo apt install python3 python3-pip python3-venv -y
            python3 -m venv venv
            source venv/bin/activate
            pip install Flask Flask-SocketIO eventlet gunicorn werkzeug
            
            echo -e "${CYAN}Downloading app files from GitHub...${NC}"
            curl -sL "$REPO_URL/app.py" -o "$WORKING_DIR/app.py"
            mkdir -p "$WORKING_DIR/templates" "$WORKING_DIR/static/uploads"
            curl -sL "$REPO_URL/templates/login.html" -o "$WORKING_DIR/templates/login.html"
            curl -sL "$REPO_URL/templates/index.html" -o "$WORKING_DIR/templates/index.html"
            
            touch "$WORKING_DIR/users.txt"
            echo "PORT=$APP_PORT" > "$WORKING_DIR/$CONF_FILE"

            # تنظیم Gunicorn برای گوش دادن به تمام آی‌پی‌ها (0.0.0.0) با پورت انتخابی
            sudo tee $SERVICE_FILE > /dev/null <<EOF
[Unit]
Description=Black Chat Web Messenger
After=network.target

[Service]
User=root
WorkingDirectory=$WORKING_DIR
ExecStart=$WORKING_DIR/venv/bin/gunicorn --worker-class eventlet -w 1 -b 0.0.0.0:$APP_PORT app:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF
            sudo systemctl daemon-reload
            sudo systemctl enable $APP_NAME
            sudo systemctl restart $APP_NAME
            echo -e "${GREEN}[✔] Setup Complete and Service Started on Port $APP_PORT!${NC}"
            sleep 2
            ;;
        2)
            echo -e "\n${CYAN}--- Add New User ---${NC}"
            u_name=$(ask "Enter Username: ")
            u_pass=$(ask "Enter Password: ")
            if grep -q "^$u_name:" "$WORKING_DIR/users.txt" 2>/dev/null; then
                echo -e "${RED}User already exists!${NC}"
            else
                echo "$u_name:$u_pass" >> "$WORKING_DIR/users.txt"
                echo -e "${GREEN}[✔] User '$u_name' added successfully.${NC}"
            fi
            sleep 2
            ;;
        3) 
            sudo systemctl start $APP_NAME; echo -e "${GREEN}[✔] Service Started.${NC}"; sleep 1 ;;
        4) 
            sudo systemctl stop $APP_NAME; echo -e "${RED}[✔] Service Stopped.${NC}"; sleep 1 ;;
        5) 
            sudo systemctl restart $APP_NAME; echo -e "${GREEN}[✔] Service Restarted.${NC}"; sleep 1 ;;
        6) 
            sudo systemctl stop $APP_NAME
            echo -e "${YELLOW}Running in debug mode. Press Ctrl+C to stop and return to menu.${NC}"
            source venv/bin/activate
            python3 "$PY_SCRIPT"
            ;;
        7)
            DOMAIN=$(ask "Enter domain: ")
            [ -z "$DOMAIN" ] && continue
            sudo apt update && sudo apt install nginx certbot python3-certbot-nginx -y
            PORT=$(grep "PORT=" $CONF_FILE | cut -d'=' -f2 | tr -d '\r')
            [ -z "$PORT" ] && PORT=5000
            
            sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        client_max_body_size 10G;
    }
}
EOF
            sudo rm -f /etc/nginx/sites-enabled/default
            sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
            if sudo nginx -t; then
                sudo systemctl restart nginx
                sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
                echo -e "DOMAIN=$DOMAIN" >> $CONF_FILE
                echo -e "${GREEN}[✔] Auto SSL & Nginx Ready.${NC}"
            fi
            sleep 2
            ;;
        8)
            DOMAIN=$(ask "Enter domain: ")
            [ -z "$DOMAIN" ] && continue
            
            CERT_PATH=$(ask "Enter full path to SSL Certificate (e.g., /root/cert.crt): ")
            KEY_PATH=$(ask "Enter full path to SSL Private Key (e.g., /root/private.key): ")

            if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
                echo -e "${RED}[!] Certificate or Key file not found!${NC}"
                sleep 2
                continue
            fi

            sudo apt update && sudo apt install nginx -y
            PORT=$(grep "PORT=" $CONF_FILE | cut -d'=' -f2 | tr -d '\r')
            [ -z "$PORT" ] && PORT=5000

            sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null <<EOF
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

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        client_max_body_size 10G;
    }
}
EOF
            sudo rm -f /etc/nginx/sites-enabled/default
            sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
            
            if sudo nginx -t; then
                sudo systemctl restart nginx
                echo -e "DOMAIN=$DOMAIN" >> $CONF_FILE
                echo -e "${GREEN}[✔] Custom Manual SSL & Nginx Ready.${NC}"
            else
                echo -e "${RED}[!] Nginx configuration test failed.${NC}"
            fi
            sleep 2
            ;;
        9)
            echo -e "\n${YELLOW}--- Registered Users ---${NC}"
            cat "$WORKING_DIR/users.txt" 2>/dev/null || echo "No users found."
            echo -e "\n${YELLOW}--- Configuration ---${NC}"
            cat "$WORKING_DIR/$CONF_FILE" 2>/dev/null || echo "No config found."
            ask "Press Enter to return to menu..."
            ;;
        10)
            confirm=$(ask "ARE YOU SURE? This will delete EVERYTHING (y/n): ")
            if [ "$confirm" == "y" ]; then
                sudo systemctl stop $APP_NAME 2>/dev/null
                sudo systemctl disable $APP_NAME 2>/dev/null
                sudo rm -f $SERVICE_FILE
                sudo systemctl daemon-reload
                
                if [ -f "$CONF_FILE" ]; then
                    D_NAME=$(grep "DOMAIN=" $CONF_FILE | cut -d'=' -f2 | tr -d '\r')
                    if [ -n "$D_NAME" ]; then
                        sudo rm -f /etc/nginx/sites-enabled/$D_NAME
                        sudo rm -f /etc/nginx/sites-available/$D_NAME
                        sudo systemctl restart nginx
                    fi
                fi

                cd /tmp || exit
                sudo rm -rf "$WORKING_DIR"
                sudo rm -f /usr/local/bin/black-chat
                echo -e "${RED}Uninstall complete. The 'black-chat' command has been removed. Bye!${NC}"
                exit 0
            fi 
            ;;
        0) clear; exit 0 ;;
        *) echo -e "${RED}Invalid option!${NC}"; sleep 1 ;;
    esac
done
