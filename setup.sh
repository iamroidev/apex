#!/bin/bash
# setup.sh - Remote EC2 bootstrap script for Apex Classroom
set -e

echo "===================================================="
echo " Starting Server Bootstrapping & Dependencies Setup  "
echo "===================================================="

# Update Apt repositories and install system requirements
sudo apt-get update -y
sudo apt-get install -y curl gnupg build-essential unzip

# Install Node.js v20 LTS
echo "Installing Node.js v20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installations
node --version
npm --version

# Parse IP and OAuth arguments
PUBLIC_IP=$1
if [ -z "$PUBLIC_IP" ]; then
    PUBLIC_IP="localhost"
fi
GOOGLE_CLIENT_ID=$2
GOOGLE_CLIENT_SECRET=$3

# Install PM2 globally
echo "Installing PM2 globally..."
sudo npm install -g pm2

# Setup folder structure
echo "Extracting codebase..."
mkdir -p ~/apex
unzip -o ~/apex-deploy.zip -d ~/apex || true
cd ~/apex

# Install package dependencies
echo "Installing NPM package dependencies..."
npm install --omit=dev

# Generate production environment variables (.env) if not exists
if [ ! -f ~/apex/.env ]; then
    echo "Creating new production environment variables (.env)..."
    cat <<EOF > ~/apex/.env
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)

# LiveKit SFU credentials
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_WS_URL=ws://${PUBLIC_IP}:7880

# Google OAuth Credentials
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
EOF
else
    echo "Existing .env file found. Preserving config."
    if [ ! -z "$GOOGLE_CLIENT_ID" ]; then
        sed -i "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}|g" ~/apex/.env
    fi
    if [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
        sed -i "s|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}|g" ~/apex/.env
    fi
fi

# Install LiveKit Server binary
echo "Checking and installing LiveKit Server..."
if ! command -v livekit-server &> /dev/null; then
    curl -sSL https://get.livekit.io | bash
fi

# Generate LiveKit configuration
echo "Creating LiveKit configuration..."
sudo mkdir -p /etc/livekit
sudo tee /etc/livekit/livekit.yaml > /dev/null <<EOF
port: 7880
bind_addresses:
  - ""
rtc:
  port_range_start: 7882
  port_range_end: 7890
  use_external_ip: true
keys:
  devkey: "devsecret"
EOF

# Start LiveKit under PM2
echo "Launching LiveKit server under PM2..."
pm2 delete livekit-server 2>/dev/null || true
pm2 start livekit-server --name "livekit-server" -- --config /etc/livekit/livekit.yaml

# Start app under PM2 process manager
echo "Launching Apex Classroom under PM2..."
pm2 delete apex-classroom 2>/dev/null || true
pm2 start server.js --name "apex-classroom"
pm2 save

# Automatically configure startup script on system boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu || true

echo "===================================================="
echo "      Deployment Completed Successfully!            "
echo "      Apex Web App: http://${PUBLIC_IP}:3000        "
echo "      LiveKit SFU: ws://${PUBLIC_IP}:7880           "
echo "===================================================="
