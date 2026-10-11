#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# -----------------------------
# Configuration
# -----------------------------
PM2_APP_NAME="exclusive-videos"
NGINX_SERVICE="nginx"
PROJECT_DIR="$(pwd)"

echo "=========================================="
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "Starting deployment"
echo "Branch : $CURRENT_BRANCH"
echo "Project: $PROJECT_DIR"
echo "=========================================="

# -----------------------------
# Step 1 - Pull latest code
# -----------------------------
echo "🚀 Step 1: Pulling latest changes..."
git pull origin "$CURRENT_BRANCH"

# -----------------------------
# Step 2 - Install dependencies
# -----------------------------
echo "📦 Step 2: Installing dependencies..."
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi

# -----------------------------
# Step 3 - Build application
# -----------------------------
echo "🛠️ Step 3: Building production application..."
npm run build

# -----------------------------
# Step 4 - Start/Reload PM2
# -----------------------------
echo "🚀 Step 4: Starting/Reloading PM2..."

if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    echo "Reloading existing PM2 process..."
    pm2 reload "$PM2_APP_NAME"
else
    echo "Starting new PM2 process..."
    pm2 start npm \
        --name "$PM2_APP_NAME" \
        --cwd "$PROJECT_DIR" \
        -- start
fi

# Save PM2 process list
pm2 save

# -----------------------------
# Step 5 - Test & Reload Nginx
# -----------------------------
echo "🌐 Step 5: Testing Nginx configuration..."

sudo nginx -t

echo "Reloading Nginx..."
sudo systemctl reload "$NGINX_SERVICE"

echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "=========================================="

echo ""
echo "Application Status:"