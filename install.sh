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
    
    if [ -f "main.py" ]; then
        cp -r * $INSTALL_DIR/ 2>/dev/null
    else
        echo -e "${CYAN}Downloading files from GitHub...${RESET}"
        download_file() {
            local url="$1"
            local dest="$2"
            local name="$3"
            if ! curl -fsSL "$url" -o "$dest"; then
                echo -e "${RED}[!] Failed to download $name from $url${RESET}"
                echo -e "${RED}[!] Make sure you've pushed v2 files to GitHub first.${RESET}"
                return 1
            fi
            if [ ! -s "$dest" ]; then
                echo -e "${RED}[!] $name downloaded but is empty.${RESET}"
                return 1
            fi
            return 0
        }

        download_file "$REPO_URL/main.py"                    "$INSTALL_DIR/main.py"                    "main.py" || return 1
        download_file "$REPO_URL/templates/index.html"       "$INSTALL_DIR/templates/index.html"       "index.html" || return 1
        download_file "$REPO_URL/static/script.js"           "$INSTALL_DIR/static/script.js"           "script.js" || return 1
        download_file "$REPO_URL/static/style.css"           "$INSTALL_DIR/static/style.css"           "style.css" || return 1
        download_file "$REPO_URL/static/service-worker.js"   "$INSTALL_DIR/static/service-worker.js"   "service-worker.js" || return 1
        download_file "$REPO_URL/static/manifest.json"       "$INSTALL_DIR/static/manifest.json"       "manifest.json" || return 1
        download_file "$REPO_URL/static/icon-192.png"        "$INSTALL_DIR/static/icon-192.png"        "icon-192.png" || return 1
        download_file "$REPO_URL/static/icon-512.png"        "$INSTALL_DIR/static/icon-512.png"        "icon-512.png" || return 1
        download_file "$REPO_URL/static/favicon-32.png"      "$INSTALL_DIR/static/favicon-32.png"      "favicon-32.png" || return 1
        download_file "$REPO_URL/install.sh"                 "$INSTALL_DIR/install.sh"                 "install.sh" || return 1
        echo -e "${GREEN}[✓] All files downloaded successfully${RESET}"
    fi
    
    cd $INSTALL_DIR

    echo "APP_PORT=$APP_PORT" > $ENV_FILE
    echo "$ADMIN_USER:$ADMIN_PASS:admin:5000" > $USERS_FILE

    echo -e "${CYAN}Setting up Python Environment (FastAPI)...${RESET}"
    python3 -m venv venv
    source venv/bin/activate
    pip install fastapi uvicorn websockets python-multipart aiofiles pywebpush cryptography

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
    curl -sL "$REPO_URL/static/style.css" -o "$INSTALL_DIR/static/style.css"
    curl -sL "$REPO_URL/static/service-worker.js" -o "$INSTALL_DIR/static/service-worker.js"
    curl -sL "$REPO_URL/static/manifest.json" -o "$INSTALL_DIR/static/manifest.json"
    curl -sL "$REPO_URL/static/icon-192.png" -o "$INSTALL_DIR/static/icon-192.png"
    curl -sL "$REPO_URL/static/icon-512.png" -o "$INSTALL_DIR/static/icon-512.png"
    curl -sL "$REPO_URL/static/favicon-32.png" -o "$INSTALL_DIR/static/favicon-32.png"
    curl -sL "$REPO_URL/install.sh" -o "$INSTALL_DIR/install.sh"
    chmod +x "$INSTALL_DIR/install.sh"
    
    # Cache-bust by adding timestamp to script.js reference in index.html
    TIMESTAMP=$(date +%s)
    sed -i "s|/static/script.js[^\"']*|/static/script.js?v=$TIMESTAMP|g" "$INSTALL_DIR/templates/index.html"
    
    # Ensure new dependencies are installed (pywebpush, cryptography for push notifications)
    if [ -f "$INSTALL_DIR/venv/bin/pip" ]; then
        echo -e "${CYAN}Checking dependencies (pywebpush, cryptography)...${RESET}"
        "$INSTALL_DIR/venv/bin/pip" install -q pywebpush cryptography 2>/dev/null || \
            echo -e "${YELLOW}  ⚠ Could not install pywebpush (push notifications will be disabled but app still works)${RESET}"
    fi
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        systemctl restart $SERVICE_NAME
    fi
    
    echo -e "${GREEN}[✔] Update Complete! Cache busted. Users, DB, and uploads are safe.${RESET}"
}

function add_user() {
    if [ ! -f "$USERS_FILE" ]; then echo -e "${RED}Not installed yet!${RESET}"; return; fi
    echo -e "${WHITE}--- 👤 Add New User ---${RESET}"
    read -e -p "Enter Username: " NEW_USER
    if grep -q "^$NEW_USER:" "$USERS_FILE"; then echo -e "${RED}User already exists!${RESET}"; return; fi
    read -e -p "Enter Password: " NEW_PASS
    
    read -e -p "Enter Role (admin/user) [Default: user]: " NEW_ROLE
    NEW_ROLE=${NEW_ROLE:-user}

    read -e -p "Enter Quota in MB [Default: 500]: " NEW_QUOTA
    NEW_QUOTA=${NEW_QUOTA:-500}

    echo "$NEW_USER:$NEW_PASS:$NEW_ROLE:$NEW_QUOTA" >> $USERS_FILE
    echo -e "${GREEN}[✔] User '$NEW_USER' added with ${NEW_QUOTA}MB quota!${RESET}"
}

function delete_user() {
    if [ ! -f "$USERS_FILE" ]; then echo -e "${RED}No users file found!${RESET}"; return; fi
    echo -e "${YELLOW}--- Current Users ---${RESET}"
    cat $USERS_FILE | awk -F':' '{q = ($4=="" ? "500" : $4); print "- "$1" (role: "$3", quota: "q"MB)"}'
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

function setup_turn() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE

    echo -e "${WHITE}--- 🎙️  Setup coturn (TURN/STUN Server) ---${RESET}"
    echo -e "${CYAN}This is required for voice/video calls between users on different networks.${RESET}"
    echo ""

    # ============================================================
    # AUTO-DETECT: existing turnserver.conf (from Black Meet or similar)
    # ============================================================
    if [ -f /etc/turnserver.conf ] && systemctl is-active --quiet coturn 2>/dev/null; then
        EXISTING_REALM=$(grep -E '^realm=' /etc/turnserver.conf 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
        EXISTING_USER=$(grep -E '^user=' /etc/turnserver.conf 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
        EXISTING_PORT=$(grep -E '^listening-port=' /etc/turnserver.conf 2>/dev/null | cut -d'=' -f2 | tr -d ' ')

        if [ -n "$EXISTING_USER" ] && [ -n "$EXISTING_REALM" ]; then
            echo -e "${GREEN}✓ Detected existing TURN server configuration!${RESET}"
            echo -e "  Realm: ${YELLOW}$EXISTING_REALM${RESET}"
            echo -e "  Port:  ${YELLOW}${EXISTING_PORT:-3478}${RESET}"
            echo -e "  Status: ${GREEN}coturn is running${RESET}"
            echo -e "${CYAN}This looks like an existing TURN setup (e.g. from Black Meet).${RESET}"
            echo ""
            read -e -p "Use the existing TURN configuration? [Y/n]: " USE_EXISTING
            USE_EXISTING=${USE_EXISTING:-Y}
            if [[ "$USE_EXISTING" =~ ^[Yy]$ ]]; then
                # Parse user:password
                TURN_USER=$(echo "$EXISTING_USER" | cut -d':' -f1)
                TURN_PASS=$(echo "$EXISTING_USER" | cut -d':' -f2)
                TURN_IP=$(grep -E '^external-ip=' /etc/turnserver.conf 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
                TURN_PORT="${EXISTING_PORT:-3478}"
                TURN_TLS_PORT=$(grep -E '^tls-listening-port=' /etc/turnserver.conf 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
                TURN_TLS_PORT="${TURN_TLS_PORT:-5349}"
                REALM="$EXISTING_REALM"

                # Pick the right hostname:
                # 1. Try turn.<realm> (Black Meet convention)
                # 2. Fall back to <realm>
                # 3. Last resort: external-ip
                TURN_HOST=""
                if getent hosts "turn.$REALM" >/dev/null 2>&1; then
                    TURN_HOST="turn.$REALM"
                    echo -e "${GREEN}  Detected TURN hostname: turn.$REALM${RESET}"
                elif getent hosts "$REALM" >/dev/null 2>&1; then
                    TURN_HOST="$REALM"
                    echo -e "${GREEN}  Detected TURN hostname: $REALM${RESET}"
                else
                    echo -e "${YELLOW}  Could not resolve turn.$REALM or $REALM${RESET}"
                    read -e -p "Enter TURN hostname/IP manually [Default: turn.$REALM]: " TURN_HOST
                    TURN_HOST=${TURN_HOST:-turn.$REALM}
                fi

                # Save to our .env so the app uses this config
                grep -v -E '^TURN_' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || cp "$ENV_FILE" "$ENV_FILE.tmp"
                mv "$ENV_FILE.tmp" "$ENV_FILE"
                cat >> "$ENV_FILE" <<EOF
TURN_HOST=$TURN_HOST
TURN_PORT=$TURN_PORT
TURN_TLS_PORT=$TURN_TLS_PORT
TURN_USER=$TURN_USER
TURN_PASS=$TURN_PASS
TURN_REALM=$REALM
EOF
                echo -e "${GREEN}✓ Using existing TURN config!${RESET}"
                echo -e "${CYAN}  Host:  ${YELLOW}$TURN_HOST${RESET}"
                echo -e "${CYAN}  Port:  ${YELLOW}$TURN_PORT${RESET}"
                echo -e "${CYAN}  User:  ${YELLOW}$TURN_USER${RESET}"
                read -p "Restart Black Chat now? [Y/n]: " RESTART_NOW
                RESTART_NOW=${RESTART_NOW:-Y}
                if [[ "$RESTART_NOW" =~ ^[Yy]$ ]]; then
                    systemctl restart black-chat.service
                    echo -e "${GREEN}✓ Service restarted.${RESET}"
                fi
                return
            fi
            echo -e "${YELLOW}Proceeding to set up a fresh coturn install (this will overwrite the existing config).${RESET}"
            read -p "Are you sure? Existing TURN setup will be replaced. [y/N]: " CONFIRM_OVERWRITE
            if [[ ! "$CONFIRM_OVERWRITE" =~ ^[Yy]$ ]]; then
                echo -e "${CYAN}Aborted.${RESET}"
                return
            fi
        fi
    fi

    # Auto-detect public IP
    PUB_IP=$(curl -s4 -m 5 ifconfig.me 2>/dev/null || curl -s4 -m 5 icanhazip.com 2>/dev/null || echo "")
    echo -e "Detected public IP: ${YELLOW}${PUB_IP:-(could not auto-detect)}${RESET}"
    read -e -p "Public IP for TURN server [Default: $PUB_IP]: " TURN_IP
    TURN_IP=${TURN_IP:-$PUB_IP}
    if [ -z "$TURN_IP" ]; then echo -e "${RED}Public IP is required!${RESET}"; return; fi

    read -e -p "TURN listening port [Default: 3478]: " TURN_PORT
    TURN_PORT=${TURN_PORT:-3478}
    read -e -p "TURN TLS port [Default: 5349]: " TURN_TLS_PORT
    TURN_TLS_PORT=${TURN_TLS_PORT:-5349}

    # Generate random user/password
    TURN_USER="bcuser_$(tr -dc 'a-z0-9' </dev/urandom | head -c6)"
    TURN_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c24)"

    REALM="${DOMAIN:-blackchat.local}"

    echo -e "${CYAN}Installing coturn...${RESET}"
    DEBIAN_FRONTEND=noninteractive apt update -qq
    DEBIAN_FRONTEND=noninteractive apt install -y coturn

    # Enable
    sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
    grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn

    # Backup old config if exists
    if [ -f /etc/turnserver.conf ] && [ ! -f /etc/turnserver.conf.bak ]; then
        cp /etc/turnserver.conf /etc/turnserver.conf.bak
    fi

    cat <<EOF > /etc/turnserver.conf
# Black Chat coturn configuration
listening-port=$TURN_PORT
tls-listening-port=$TURN_TLS_PORT
listening-ip=0.0.0.0
external-ip=$TURN_IP
relay-ip=$TURN_IP

fingerprint
lt-cred-mech
realm=$REALM
user=$TURN_USER:$TURN_PASS
total-quota=100
stale-nonce=600

no-stdout-log
log-file=/var/log/turnserver.log
syslog
no-loopback-peers
no-multicast-peers

# UDP relay range (open these ports in firewall)
min-port=49152
max-port=65535

# Security
no-cli
EOF

    # Open firewall ports if ufw is active
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
        echo -e "${CYAN}Opening firewall ports...${RESET}"
        ufw allow $TURN_PORT/tcp >/dev/null 2>&1
        ufw allow $TURN_PORT/udp >/dev/null 2>&1
        ufw allow $TURN_TLS_PORT/tcp >/dev/null 2>&1
        ufw allow $TURN_TLS_PORT/udp >/dev/null 2>&1
        ufw allow 49152:65535/udp >/dev/null 2>&1
    fi

    systemctl enable coturn >/dev/null 2>&1
    systemctl restart coturn

    sleep 2
    if systemctl is-active --quiet coturn; then
        echo -e "${GREEN}[✔] coturn is running!${RESET}"
    else
        echo -e "${RED}[!] coturn failed to start. Check 'systemctl status coturn' and /var/log/turnserver.log${RESET}"
    fi

    # Save credentials to .env (replace existing TURN_* lines)
    sed -i '/^TURN_/d' $ENV_FILE
    cat <<EOF >> $ENV_FILE
TURN_HOST=$TURN_IP
TURN_PORT=$TURN_PORT
TURN_TLS_PORT=$TURN_TLS_PORT
TURN_USER=$TURN_USER
TURN_PASS=$TURN_PASS
TURN_REALM=$REALM
EOF
    chmod 600 $ENV_FILE

    # Restart Black Chat so it picks up the new env
    if systemctl is-active --quiet $SERVICE_NAME; then
        systemctl restart $SERVICE_NAME
    fi

    echo ""
    echo -e "${GREEN}=========================================${RESET}"
    echo -e "${GREEN} TURN credentials saved to $ENV_FILE${RESET}"
    echo -e "${GREEN}=========================================${RESET}"
    echo -e "Host:        ${YELLOW}$TURN_IP${RESET}"
    echo -e "TURN port:   ${YELLOW}$TURN_PORT${RESET}  (TCP+UDP)"
    echo -e "TLS port:    ${YELLOW}$TURN_TLS_PORT${RESET}"
    echo -e "Username:    ${YELLOW}$TURN_USER${RESET}"
    echo -e "Password:    ${YELLOW}$TURN_PASS${RESET}"
    echo -e "Realm:       ${YELLOW}$REALM${RESET}"
    echo -e "${GREEN}=========================================${RESET}"
    echo -e "${CYAN}Important: Open these ports on your cloud firewall:${RESET}"
    echo -e "  - $TURN_PORT/tcp, $TURN_PORT/udp"
    echo -e "  - $TURN_TLS_PORT/tcp, $TURN_TLS_PORT/udp"
    echo -e "  - 49152-65535/udp (relay range)"
    echo ""
}

function turn_status() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE
    echo -e "${WHITE}--- 🎙️  TURN Server Status ---${RESET}"
    if systemctl is-active --quiet coturn; then
        echo -e "Service: ${GREEN}▶ RUNNING${RESET}"
    else
        echo -e "Service: ${RED}🛑 STOPPED${RESET}"
    fi
    echo -e "Host:    ${YELLOW}${TURN_HOST:-not configured}${RESET}"
    echo -e "Port:    ${YELLOW}${TURN_PORT:-not configured}${RESET}"
    echo -e "User:    ${YELLOW}${TURN_USER:-not configured}${RESET}"
    echo ""
    echo -e "${CYAN}Recent log lines:${RESET}"
    tail -n 10 /var/log/turnserver.log 2>/dev/null || echo "(no log)"
    echo ""
    read -p "Press Enter to return..."
}

function uninstall_app() {
    echo -e "${RED}⚠️ WARNING: This will delete the App, Database, and Chat Nginx block.${RESET}"
    echo -e "${CYAN}Don't worry! Your global Nginx installation and other server files are SAFE.${RESET}"
    read -e -p "Are you sure? (y/n): " choice
    if [ "$choice" == "y" ]; then
        echo "Stopping and removing service..."
        systemctl stop $SERVICE_NAME 2>/dev/null
        systemctl disable $SERVICE_NAME 2>/dev/null
        rm -f /etc/systemd/system/$SERVICE_NAME
        systemctl daemon-reload
        
        echo "Removing Black Chat Nginx config (Other configs are safe)..."
        rm -f /etc/nginx/sites-enabled/black-chat
        rm -f /etc/nginx/sites-available/black-chat
        systemctl restart nginx

        echo "Deleting application folder..."
        cd /tmp || exit
        rm -rf "$INSTALL_DIR"
        rm -f /usr/local/bin/black-chat
        
        echo -e "${GREEN}[✔] Black Chat has been safely uninstalled!${RESET}"
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
    echo -e "${YELLOW}10)${RESET} 🎙️  Setup TURN Server (coturn) - for voice/video"
    echo -e "${YELLOW}11)${RESET} 📡 TURN Status / Logs"
    echo -e "${RED}12)${RESET} ☢️  Safe Uninstall (App Only)"
    echo -e "  ${RED}0)${RESET} ❌ Exit"
    echo -e "${GREEN}-----------------------------------------${RESET}"
    read -e -p "Choose an option (0-12): " choice

    case $choice in
        1) install_app ; sleep 2 ;;
        2) update_app ; sleep 3 ; exec black-chat ;;
        3) add_user ; sleep 2 ;;
        4) delete_user ; sleep 2 ;;
        5) systemctl start $SERVICE_NAME; echo -e "${GREEN}[✔] Started!${RESET}" ; sleep 1 ;;
        6) systemctl restart $SERVICE_NAME; echo -e "${GREEN}[✔] Restarted!${RESET}" ; sleep 1 ;;
        7) setup_ssl_auto ; sleep 2 ;;
        8) setup_ssl_manual ; sleep 2 ;;
        9) 
           echo -e "\n${CYAN}--- Registered Users ---${RESET}"
           if [ -f "$USERS_FILE" ]; then cat $USERS_FILE | awk -F':' '{q = ($4=="" ? "500" : $4); print "User: "$1" | Role: "$3" | Quota: "q"MB"}'; else echo "No users found."; fi
           echo ""
           read -p "Press Enter to return..." 
           ;;
        10) setup_turn ; sleep 2 ;;
        11) turn_status ;;
        12) uninstall_app ; sleep 2 ;;
        0) clear; exit 0 ;;
        *) echo -e "${RED}Invalid option!${RESET}" ; sleep 1 ;;
    esac
done
