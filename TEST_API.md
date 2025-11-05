# API Testing Guide

## Railway Backend URL
`https://clinic-bot-production.up.railway.app`

## Quick Tests

### 1. Health Check
```bash
curl https://clinic-bot-production.up.railway.app/health
```
**Expected**: `{"status":"healthy"}`

### 2. Root Endpoint
```bash
curl https://clinic-bot-production.up.railway.app/
```
**Expected**: `{"message":"Clinic Bot Backend API","version":"1.0.0","status":"running"}`

### 3. API Documentation
Visit in browser:
```
https://clinic-bot-production.up.railway.app/docs
```
**Expected**: Swagger UI documentation page

### 4. Alternative Documentation
Visit in browser:
```
https://clinic-bot-production.up.railway.app/redoc
```
**Expected**: ReDoc documentation page

## Using the Domain

### For Frontend (Vercel)
Set environment variable:
```
VITE_API_BASE_URL=https://clinic-bot-production.up.railway.app
```

### For LINE Webhook
Update webhook URL to:
```
https://clinic-bot-production.up.railway.app/api/liff/webhook
```

### For Google OAuth
Add redirect URI:
```
https://clinic-bot-production.up.railway.app/api/auth/google/callback
```

### For Backend Environment Variables
In Railway, set:
```
API_BASE_URL=https://clinic-bot-production.up.railway.app
FRONTEND_URL=https://your-vercel-app.vercel.app (set after frontend deploys)
```

