# WTSP Backend — Live Setup Guide

---

## Table of Contents

1. [Server Requirements](#1-server-requirements)
2. [Server Setup (EC2 / VPS)](#2-server-setup)
3. [Environment Variables](#3-environment-variables)
4. [MongoDB Atlas Setup](#4-mongodb-atlas-setup)
5. [Redis Setup](#5-redis-setup)
6. [Meta WhatsApp Cloud API Setup](#6-meta-whatsapp-cloud-api-setup)
7. [Twilio WhatsApp Setup](#7-twilio-whatsapp-setup)
8. [AWS S3 / File Storage Setup](#8-aws-s3--file-storage-setup)
9. [Nginx + SSL Setup](#9-nginx--ssl-setup)
10. [Deploy & Run with PM2](#10-deploy--run-with-pm2)
11. [Future Code Updates](#11-future-code-updates)
12. [Checklist](#12-final-checklist)

---

## 1. Server Requirements

| Item | Minimum |
|------|---------|
| RAM | 1 GB (t2.micro) |
| OS | Ubuntu 22.04 LTS |
| Node.js | v20.x |
| Ports open | 80, 443, 22 |

> **Important:** Never run `npm run build` on EC2 (1GB RAM). Build locally, push `dist/` via GitHub.

---

## 2. Server Setup

### Node.js install karo
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x hona chahiye
```

### PM2 install karo
```bash
sudo npm install -g pm2
```

### Nginx install karo
```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Certbot (SSL) install karo
```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 3. Environment Variables

EC2 pe `.env` file banao:
```bash
sudo nano /whatappCRM_Backend/.env
```

### Complete `.env` template:

```env
NODE_ENV=production
PORT=5000

# MongoDB Atlas URI (Section 4 se milega)
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/wtsp_panel?retryWrites=true&w=majority

# Redis (EC2 pe locally chal raha hai)
REDIS_URL=redis://localhost:6379

# JWT Secrets — minimum 32 characters, random string
JWT_ACCESS_SECRET=apna-random-32-plus-chars-secret-yahan-likho
JWT_REFRESH_SECRET=dusra-random-32-plus-chars-secret-yahan-likho
JWT_ACCESS_EXPIRES=1h
JWT_REFRESH_EXPIRES=7d

# Encryption Key — exactly 64 hex characters (32 bytes)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Frontend URL (CORS ke liye)
FRONTEND_URL=https://wtsp.codeconnect.in

# API ka public HTTPS URL (no trailing slash)
PUBLIC_API_BASE_URL=https://wtspapi.codeconnect.in

# Twilio (optional — Section 7 se milega)
TWILIO_WEBHOOK_AUTH_TOKEN=

# AWS S3 (optional — Section 8 se milega)
AWS_REGION=ap-south-1
S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

LOG_LEVEL=info
```

### Random secrets kaise banayein?
```bash
# JWT secrets generate karo
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Encryption key (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. MongoDB Atlas Setup

### Step 1 — Account banao
- https://cloud.mongodb.com pe jao
- Free account banao

### Step 2 — Cluster banao
1. **"Build a Database"** click karo
2. **Free tier (M0)** select karo
3. Region: `Mumbai (ap-south-1)` select karo
4. Cluster name: `cluster1` rakhna

### Step 3 — Database User banao
1. Left sidebar → **"Database Access"**
2. **"Add New Database User"** click karo
3. Username aur strong password set karo
4. Role: **"Read and Write to any database"**
5. **"Add User"** click karo

### Step 4 — Network Access (EC2 IP allow karo)
1. Left sidebar → **"Network Access"**
2. **"Add IP Address"** click karo
3. EC2 ka public IP dalo (`13.203.123.47`)
4. Ya dev ke liye `0.0.0.0/0` (sabko allow — production mein avoid karo)

### Step 5 — Connection String lo
1. Cluster pe **"Connect"** click karo
2. **"Connect your application"** select karo
3. Driver: **Node.js**, Version: **5.5 or later**
4. Connection string copy karo — kuch aisa dikhega:
   ```
   mongodb+srv://username:password@cluster1.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. `?` se pehle database name add karo:
   ```
   mongodb+srv://username:password@cluster1.xxxxx.mongodb.net/wtsp_panel?retryWrites=true&w=majority
   ```
6. Yeh `.env` mein `MONGODB_URI` mein dalo

---

## 5. Redis Setup

### EC2 pe Redis install aur start karo:
```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable redis
sudo systemctl start redis

# Test karo
redis-cli ping
# Output: PONG
```

### `.env` mein:
```env
REDIS_URL=redis://localhost:6379
```

> Default Redis port `6379` hai. `6380` mat likhna.

---

## 6. Meta WhatsApp Cloud API Setup

Yeh 2 part mein hota hai:
- **Part A:** Meta Developer Console pe App banana + credentials lena
- **Part B:** App ke andar Settings mein credentials save karna

---

### Part A — Meta Developer Console

#### Step 1 — Meta Developer Account
- https://developers.facebook.com pe jao
- Apne Facebook account se login karo

#### Step 2 — App banao
1. **"My Apps"** → **"Create App"**
2. App Type: **"Business"** select karo
3. App name: kuch bhi (e.g., `WTSP CRM`)
4. Business account connect karo
5. **"Create App"** click karo

#### Step 3 — WhatsApp Product add karo
1. App dashboard mein **"Add Products"** section
2. **WhatsApp** dhundho → **"Set Up"** click karo

#### Step 4 — App Secret lena
1. Left sidebar → **"App Settings"** → **"Basic"**
2. **"App Secret"** field ke saamne **"Show"** click karo
3. Password enter karo
4. Yeh `App Secret` copy karo — App ke Settings mein save karna hai

#### Step 5 — Temporary Access Token lena
1. Left sidebar → **WhatsApp** → **"API Setup"**
2. **"Temporary access token"** copy karo

> ⚠️ Temporary token 24 ghante mein expire hota hai.
> Production ke liye **System User + Permanent Token** banao (Step 6 dekho).

#### Step 6 — Permanent Token banana (Production ke liye)
1. https://business.facebook.com jao
2. **"Settings"** → **"Users"** → **"System Users"**
3. **"Add"** → System User banao (Admin role)
4. **"Generate New Token"** click karo
5. Apna App select karo
6. Permissions: `whatsapp_business_messaging`, `whatsapp_business_management` select karo
7. Token copy karo — yeh permanent hai

#### Step 7 — WABA ID lena (WhatsApp Business Account ID)
1. Left sidebar → **WhatsApp** → **"API Setup"**
2. **"WhatsApp Business Account"** section mein **WABA ID** dikhega
3. Copy karo

#### Step 8 — Phone Number ID lena
1. Same page pe **"From"** section mein test number dikhega
2. **Phone Number ID** copy karo (numbers ka ek code hoga)

---

### Part B — App ke andar Meta Settings save karo

App mein login karo → Company Settings → WhatsApp (Meta) tab:

| Field | Kahan se milega |
|-------|----------------|
| Access Token | Step 5 ya Step 6 |
| App Secret | Step 4 |
| WABA ID | Step 7 |

Save karne ke baad ek **Webhook URL** generate hogi, kuch aisi:
```
https://wtspapi.codeconnect.in/webhooks/meta/whatsapp/{webhookSlug}
```

#### Step 9 — Webhook Meta Console pe set karo
1. Meta Developer Console → **WhatsApp** → **"Configuration"**
2. **"Webhook"** section → **"Edit"**
3. **Callback URL:** apni webhook URL dalo (upar wali)
4. **Verify Token:** App mein jo verify token set kiya woh dalo
5. **"Verify and Save"** click karo
6. Subscribe karo: `messages` field pe tick karo → **"Subscribe"**

#### Step 10 — WhatsApp Number add karo (App mein)
App → Company Settings → WhatsApp Numbers:
- Provider: **Meta**
- Phone Number ID: Step 8 se
- Phone Number: E.164 format mein (e.g., `+911234567890`)

---

## 6B. Template Approval Flow (Bulk Message ke liye ZAROORI)

### WhatsApp ka 24-hour rule

| Situation | Kya bhej sakte ho |
|-----------|-------------------|
| Customer ne tumhe message kiya → 24h ke andar | Koi bhi free text / image |
| 24h ke baad, ya tum pehle message karo | **Sirf approved template** |
| Bulk campaign | **Sirf approved template** |

Isliye bulk messaging ke liye template approval mandatory hai.

### Alag se koi "template API key" nahi milti

Jo Access Token already Settings mein save hai, **wahi kaafi hai**. Bas usme
`whatsapp_business_management` permission honi chahiye (System User token banate
waqt select karo — Section 6, Step 6).

Saath mein **WABA ID** bhi zaroori hai (Section 6, Step 7). WABA ID ke bina
template submit nahi hoga.

### Flow — Panel se

**Step 1 — Template banao**
Templates page → naya template:
- Name: `order_update` (lowercase, spaces underscore ban jaate hain)
- Body: `Hello {{name}}, aapka order ready hai.`
- Category: `UTILITY` / `MARKETING` / `AUTHENTICATION`

Variables sirf ye 3 supported hain: `{{name}}`, `{{phone}}`, `{{email}}`

**Step 2 — Meta ko submit karo**
```
POST /api/tenant/templates/:id/submit
```
Backend automatically `{{name}}` ko `{{1}}` mein convert karke Meta ko bhejta hai,
sample values ke saath (Meta bina example ke reject kar deta hai).

Status `PENDING` ho jayega.

**Step 3 — Status check karo**
```
POST /api/tenant/templates/sync
```
Meta se latest status pull karta hai. Approval mein **15 minute se 24 ghante** lagte hain.

Status ye ho sakte hain:
- `PENDING` — review chal raha hai
- `APPROVED` — ✅ ab campaign chala sakte ho
- `REJECTED` — `rejectedReason` field mein wajah milegi

**Step 4 — Campaign chalao**
Template `APPROVED` hone ke baad hi campaign start hoga. Agar approved nahi hai to
campaign start karte hi clear error milega.

### Category sahi choose karo (reject hone se bachne ke liye)

| Category | Kab use karo | Example |
|----------|--------------|---------|
| `UTILITY` | Order update, payment reminder, booking confirm | "Aapka order #123 dispatch ho gaya" |
| `MARKETING` | Offer, promotion, discount | "50% off is weekend!" |
| `AUTHENTICATION` | OTP, login code | "Your code is 123456" |

**Reject hone ke common reasons:**
- Promotional message ko `UTILITY` mein daal diya → `MARKETING` use karo
- Spelling/grammar mistakes
- Variable se message shuru ya khatam karna (`{{name}}` se start mat karo)
- Bahut zyada variables, context clear na hona
- URL shorteners (bit.ly etc.)

### Template edit karne pe kya hota hai

Meta pe approved template ka text change nahi kar sakte. Panel mein body edit
karoge to status wapas `local` ho jayega — dobara submit karna padega.

---

## 7. Twilio WhatsApp Setup

### Step 1 — Twilio Account
- https://twilio.com pe free account banao
- Phone number verify karo

### Step 2 — Credentials lena
1. Twilio Console → Dashboard
2. **Account SID** copy karo
3. **Auth Token** copy karo

### Step 3 — WhatsApp Sandbox (Testing ke liye)
1. Left sidebar → **"Messaging"** → **"Try it out"** → **"Send a WhatsApp message"**
2. Sandbox number note karo
3. Join code se apna number join karo (WhatsApp pe message bhejo)

### Step 4 — Webhook set karo (Sandbox)
1. Sandbox settings mein:
   - **"When a message comes in":** `https://wtspapi.codeconnect.in/webhooks/twilio/incoming`
   - Method: `POST`

### Step 5 — App mein Twilio save karo
App → Company Settings → Twilio tab:
- Account SID
- Auth Token

Then WhatsApp Numbers mein:
- Provider: **Twilio**
- Phone Number: Twilio sandbox number (E.164 format)

---

## 8. AWS S3 / File Storage Setup

Media upload ke liye S3 chahiye (production mein required).

### Step 1 — AWS Account
- https://aws.amazon.com pe account banao

### Step 2 — S3 Bucket banao
1. AWS Console → **S3** → **"Create bucket"**
2. Bucket name: kuch unique (e.g., `wtsp-media-prod`)
3. Region: `ap-south-1` (Mumbai)
4. **"Block all public access":** OFF karo (media publicly accessible hoga)
5. **"Create bucket"**

### Step 3 — IAM User banao (credentials ke liye)
1. AWS Console → **IAM** → **Users** → **"Add users"**
2. Username: `wtsp-s3-user`
3. **"Attach policies directly"** → `AmazonS3FullAccess`
4. User banao

### Step 4 — Access Keys lena
1. IAM → Users → `wtsp-s3-user`
2. **"Security credentials"** tab
3. **"Create access key"** → Application running outside AWS
4. **Access Key ID** aur **Secret Access Key** copy karo

### Step 5 — `.env` mein dalo
```env
AWS_REGION=ap-south-1
S3_BUCKET=wtsp-media-prod
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=xxx...
```

---

## 9. Nginx + SSL Setup

### Nginx config file banao
```bash
sudo nano /etc/nginx/sites-available/wtspapi
```

Paste karo:
```nginx
server {
    listen 80;
    server_name wtspapi.codeconnect.in;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable karo aur SSL lagao:
```bash
sudo ln -s /etc/nginx/sites-available/wtspapi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL certificate
sudo certbot --nginx -d wtspapi.codeconnect.in
```

---

## 10. Deploy & Run with PM2

### Pehli baar deploy karo

```bash
# Repo clone karo
git clone https://github.com/CodeConnectLab/whatappCRM_Backend.git /whatappCRM_Backend
cd /whatappCRM_Backend

# Dependencies install karo (sirf production)
npm install --omit=dev

# .env file banao (Section 3 dekho)
nano .env

# PM2 se start karo
pm2 start dist/server.js --name wtsp-backend
pm2 save
pm2 startup   # EC2 restart pe auto-start
```

### Status check karo
```bash
pm2 status
pm2 logs wtsp-backend --lines 50
```

### Health check
```bash
curl https://wtspapi.codeconnect.in/health
# Response: {"status":"ok","checks":{"mongodb":"ok","redis":"ok"}}
```

---

## 11. Future Code Updates

Jab bhi code change karna ho:

### Local machine pe (Windows):
```powershell
# 1. Code changes karo src/ mein
# 2. Build karo
cd d:\wtsp\whatappCRM_Backend
node build.mjs

# 3. Commit aur push karo
git add src/ dist/
git commit -m "your change description"
git push origin main
```

### EC2 pe:
```bash
cd /whatappCRM_Backend
git pull origin main
pm2 restart wtsp-backend
pm2 logs wtsp-backend --lines 20
```

> **Rule:** EC2 pe kabhi `npm run build` mat chalao — hamesha local build karo aur `dist/` push karo.

---

## 12. Final Checklist

### Server
- [ ] Node.js v20 installed
- [ ] PM2 installed
- [ ] Nginx installed aur running
- [ ] SSL certificate (certbot) set up

### Environment
- [ ] `.env` file EC2 pe hai
- [ ] `MONGODB_URI` correct hai
- [ ] `REDIS_URL=redis://localhost:6379` hai
- [ ] `JWT_ACCESS_SECRET` 32+ chars hai
- [ ] `JWT_REFRESH_SECRET` 32+ chars hai
- [ ] `ENCRYPTION_KEY` exact 64 hex chars hai
- [ ] `FRONTEND_URL` correct domain hai
- [ ] `PUBLIC_API_BASE_URL` correct hai

### Services
- [ ] MongoDB Atlas — cluster running, IP allowed
- [ ] Redis — `redis-cli ping` → PONG
- [ ] PM2 — `pm2 status` → online

### WhatsApp (Meta)
- [ ] Meta App banaya
- [ ] Access Token (permanent) liya
- [ ] App Secret liya
- [ ] WABA ID liya
- [ ] Phone Number ID liya
- [ ] Webhook configured aur verified
- [ ] App mein credentials save kiye

### WhatsApp (Twilio) — optional
- [ ] Twilio account + credentials
- [ ] Webhook URLs set
- [ ] App mein save kiya

### Test
- [ ] `/health` → `{"status":"ok"}`
- [ ] Login kaam kar raha hai
- [ ] Message bhej sakte ho
