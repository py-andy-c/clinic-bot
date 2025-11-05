# Quick Deployment Checklist

## Before You Start

1. Generate production secrets:
   ```bash
   # JWT Secret Key
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   
   # Encryption Key
   python -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
   ```

2. Have your API keys ready:
   - OpenAI API Key
   - Google OAuth Client ID & Secret
   - LINE LIFF ID
   - LINE Channel Access Token (if needed)

## Backend (Railway) - 5 Steps

1. **Create Railway Project**
   - New Project → Deploy from GitHub
   - Set root directory: `backend`
   - Add PostgreSQL database

2. **Set Environment Variables** (in Railway service settings):
   ```
   FRONTEND_URL=https://your-app.vercel.app (set after frontend deploys)
   API_BASE_URL=https://your-backend.railway.app (set after backend deploys)
   OPENAI_API_KEY=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   JWT_SECRET_KEY=... (generate strong secret)
   ENCRYPTION_KEY=... (generate strong secret)
   SYSTEM_ADMIN_EMAILS=admin@example.com
   JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
   JWT_REFRESH_TOKEN_EXPIRE_DAYS=180
   AGENT_DEBUG=false
   ```
   **Note**: Railway automatically provides `DATABASE_URL` - don't set it manually!

3. **Deploy**
   - Railway will build and deploy automatically
   - Check logs to verify migrations ran successfully

4. **Note Your Backend URL**
   - Example: `https://your-app.up.railway.app`
   - You'll need this for frontend configuration

5. **Update Environment Variables**
   - Set `API_BASE_URL` to your Railway URL
   - Set `FRONTEND_URL` after frontend deploys

## Frontend (Vercel) - 4 Steps

1. **Create Vercel Project**
   - New Project → Import from GitHub
   - Set root directory: `frontend`

2. **Set Environment Variables** (in Vercel project settings):
   ```
   VITE_API_BASE_URL=https://your-backend.railway.app
   VITE_LIFF_ID=your_line_liff_id
   ```

3. **Deploy**
   - Vercel will build and deploy automatically
   - Note your deployment URL

4. **Update Backend CORS**
   - Go back to Railway
   - Update `FRONTEND_URL` to your Vercel URL
   - Redeploy backend if needed

## Post-Deployment

1. **Update LINE Webhook**
   - LINE Developers Console → Your Channel
   - Webhook URL: `https://your-backend.railway.app/api/liff/webhook`
   - Enable webhook

2. **Update Google OAuth Redirect**
   - Google Cloud Console → Your Project
   - OAuth 2.0 Client → Authorized redirect URIs
   - Add: `https://your-backend.railway.app/api/auth/google/callback`

3. **Test Everything**
   - Backend health: `https://your-backend.railway.app/health`
   - Frontend loads correctly
   - Authentication flow works
   - API calls succeed

## Common Issues

**CORS Errors**: Make sure `FRONTEND_URL` in Railway matches your Vercel URL exactly

**Database Errors**: Verify `DATABASE_URL` is provided by Railway (don't set manually)

**Migration Errors**: Check Railway logs - migrations run automatically on startup

**Build Errors**: Check build logs in Railway/Vercel dashboard

## Files Created

- `backend/Procfile` - Railway start command
- `backend/start.sh` - Startup script with migrations
- `backend/railway.json` - Railway configuration
- `frontend/vercel.json` - Vercel configuration
- `DEPLOYMENT.md` - Full deployment guide

