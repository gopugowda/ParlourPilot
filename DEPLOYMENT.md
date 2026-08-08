# ParlourPilot — Deployment Guide

## Overview
- **Frontend**: Expo React Native (mobile) + web build
- **Backend**: FastAPI (Python) with Uvicorn
- **Database**: MongoDB Atlas (managed cloud)
- **Domains** (planned):
  - `www.parlourpilot.com` — marketing website
  - `app.parlourpilot.com` — mobile web build
  - `api.parlourpilot.com` — backend API

---

## 1. Backend Deployment (AWS EC2 / AWS WorkSpaces)

### Prerequisites
- Python 3.11+
- MongoDB Atlas cluster with IP allowlist including AWS server's static IP
- Domain + SSL certificate (Let's Encrypt via certbot or ACM)

### Steps

#### 1.1 Provision Server
```bash
# On Ubuntu 22.04+
sudo apt update && sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx
```

#### 1.2 Clone & Install
```bash
git clone <your-repo>
cd parlourpilot/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### 1.3 Configure Environment
Create `backend/.env`:
```bash
MONGO_URL=mongodb+srv://<user>:<pwd>@<cluster>.mongodb.net/glowup_db?retryWrites=true&w=majority
DB_NAME=glowup_db
JWT_SECRET=<generate a strong 48-char secret: python3 -c "import secrets;print(secrets.token_urlsafe(48))">
ADMIN_SEED_PASSWORD=<optional, only for initial seed>
STAFF_SEED_PASSWORD=<optional>
PLATFORM_ADMIN_EMAIL=<your platform admin email>
PLATFORM_ADMIN_PASSWORD=<strong password>
```

⚠️ **Do NOT commit `.env` to git.** The `.gitignore` excludes it by default.

#### 1.4 Whitelist AWS IP in MongoDB Atlas
1. Atlas Console → Network Access → Add IP Address
2. Add your EC2 instance's static / Elastic IP
3. Remove `0.0.0.0/0` if it was set for development

#### 1.5 Run Backend as Service (systemd)
Create `/etc/systemd/system/parlourpilot-api.service`:
```ini
[Unit]
Description=ParlourPilot API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/parlourpilot/backend
Environment="PATH=/home/ubuntu/parlourpilot/backend/venv/bin"
ExecStart=/home/ubuntu/parlourpilot/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable & start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable parlourpilot-api
sudo systemctl start parlourpilot-api
sudo systemctl status parlourpilot-api
```

#### 1.6 Configure Nginx Reverse Proxy
Create `/etc/nginx/sites-available/parlourpilot-api`:
```nginx
server {
  listen 80;
  server_name api.parlourpilot.com;

  location / {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/parlourpilot-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 1.7 Enable HTTPS
```bash
sudo certbot --nginx -d api.parlourpilot.com
```

#### 1.8 Verify
```bash
curl https://api.parlourpilot.com/api/
# Expected: {"message": "ParlourPilot SaaS API", "status": "ok"}
```

---

## 2. Frontend Deployment (Expo)

### 2.1 Preview / Web (via Emergent)
Click **Publish** → Deploy your app in the Emergent workspace. Deployment cost: 50 credits/month.

### 2.2 Android APK / iOS IPA
After deployment:
1. Click **Publish** again
2. Choose **Publish to Play Store** (Android) or **Publish to App Store** (iOS)
3. Provide:
   - App name: **ParlourPilot**
   - App icon: `frontend/assets/images/parlourpilot-logo.png`
   - Package/Bundle ID (preserve existing to avoid EAS project reset)
4. Wait for build to complete
5. Download APK/IPA

### 2.3 Production Backend URL
Update `frontend/.env`:
```bash
EXPO_PUBLIC_BACKEND_URL=https://api.parlourpilot.com
```
Then rebuild.

---

## 3. Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URL` | Yes | MongoDB connection string (Atlas or local) |
| `DB_NAME` | Yes | Database name (default: `glowup_db`) |
| `JWT_SECRET` | Yes | 48+ char random secret for JWT signing |
| `ADMIN_SEED_PASSWORD` | No | Password for seeded `admin@glowup.com` (skip if empty) |
| `STAFF_SEED_PASSWORD` | No | Password for seeded `staff@glowup.com` (skip if empty) |
| `PLATFORM_ADMIN_EMAIL` | No | Platform admin email for auto-seed |
| `PLATFORM_ADMIN_PASSWORD` | No | Platform admin password for auto-seed |

### Frontend (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_BACKEND_URL` | Full backend URL (e.g. `https://api.parlourpilot.com`) |
| `EXPO_PACKAGER_PROXY_URL` | Preview proxy (managed by Emergent — do NOT modify) |
| `EXPO_PACKAGER_HOSTNAME` | Preview hostname (managed by Emergent — do NOT modify) |

---

## 4. Multi-Environment Setup

Recommended files (not committed):
- `backend/.env.development` — local Mongo, dummy JWT
- `backend/.env.staging` — Atlas staging cluster
- `backend/.env.production` — Atlas production cluster + strong JWT
- `frontend/.env.development` — points to local backend
- `frontend/.env.production` — points to `api.parlourpilot.com`

Load via:
```bash
export ENV=production
cp .env.$ENV .env
```

---

## 5. Post-Deployment Checklist

- [ ] Backend `/api/` returns 200
- [ ] Signup a fresh test tenant → confirm 7-day trial starts
- [ ] Login existing admin → confirm data preserved
- [ ] Login as staff → confirm restricted access works
- [ ] Verify tenant isolation: create 2 tenants, confirm no data leaks
- [ ] Test bill creation, receipt PDF generation with tenant branding
- [ ] Test subscription-expired flow (extend then rollback trial_end_date via platform admin)
- [ ] Verify MongoDB indexes exist (`db.tenants.getIndexes()`)
- [ ] HTTPS working on `api.parlourpilot.com`

---

## 6. Backup & Monitoring

- **MongoDB Atlas**: Automatic continuous backups enabled (M10+ tier)
- **Logs**: `journalctl -u parlourpilot-api -f` for backend
- **Uptime monitoring**: consider UptimeRobot / BetterStack for `api.parlourpilot.com`
- **Error tracking**: Sentry can be added later via `sentry-sdk[fastapi]`

---

## 7. Rollback Procedure

If a deployment breaks production:
1. `sudo systemctl stop parlourpilot-api`
2. `git checkout <previous-working-commit>`
3. `pip install -r requirements.txt` (if requirements changed)
4. `sudo systemctl start parlourpilot-api`

Database is safe — MongoDB Atlas offers point-in-time restore.
