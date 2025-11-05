# Deployment Guide

This guide will help you deploy the Clinic Bot application to production using Vercel (frontend) and Railway (backend).

## Prerequisites

1. **GitHub Account** - Your code should be in a GitHub repository
2. **Vercel Account** - Sign up at [vercel.com](https://vercel.com)
3. **Railway Account** - Sign up at [railway.app](https://railway.app)
4. **PostgreSQL Database** - Railway provides PostgreSQL automatically
5. **LINE Developer Account** - For LINE bot integration
6. **Google Cloud Console** - For OAuth credentials

## Step 1: Prepare Environment Variables

### Backend Environment Variables (Railway)

You'll need to set these in Railway's environment variables:

```bash
# Database (Railway automatically provides DATABASE_URL)
# You don't need to set this manually - Railway provides it

# Frontend URL (Set this after deploying frontend)
FRONTEND_URL=https://your-app.vercel.app

# API Base URL (Set this after deploying backend)
API_BASE_URL=https://your-backend.railway.app

# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# Authentication (IMPORTANT: Generate strong secrets for production!)
JWT_SECRET_KEY=your_jwt_secret_key_here_use_a_long_random_string
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"

SYSTEM_ADMIN_EMAILS=admin@yourcompany.com,dev@yourcompany.com

ENCRYPTION_KEY=your_base64_encoded_32_byte_fernet_key_here
# Generate with: python -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"

# JWT Token Configuration
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=180

# Agent Debug Configuration
AGENT_DEBUG=false
```

### Frontend Environment Variables (Vercel)

```bash
# API Base URL (Set this after deploying backend)
VITE_API_BASE_URL=https://your-backend.railway.app

# LINE LIFF ID
VITE_LIFF_ID=your_liff_id_here
```

## Step 2: Deploy Backend to Railway

1. **Create or Select a Workspace**
   - Go to [railway.app](https://railway.app)
   - If you're new to Railway, you'll need to create a workspace first
   - Click on your profile/workspace selector in the top right
   - If you don't have a workspace, create a new one (it's free)
   - Your personal account can be used as a workspace

2. **Create a New Project**
   - Once you have a workspace selected, click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub account if prompted
   - Choose your repository from the list

3. **Configure the Service Root Directory** (CRITICAL STEP)
   - After selecting your repository, Railway will create a service
   - **IMPORTANT**: You MUST set the root directory to `backend` before Railway builds
   - Click on your service (it may be named after your repo)
   - Go to the "Settings" tab
   - Find the "Source" section (at the top)
   - Look for "Add Root Directory" link under "Source Repo"
   - **Click "Add Root Directory"** - this will reveal a text input field
   - Enter: `backend` (no leading slash, just `backend`)
   - Click "Save" or "Update"
   - Railway will automatically detect `nixpacks.toml` from the `backend` directory
   
   **Note**: If you see an error about "start.sh not found", it means the root directory wasn't set correctly. Make sure to:
   1. Click the "Add Root Directory" link first (it's not a visible field until you click it)
   2. Then enter `backend` (not `/backend` or `./backend`, just `backend`)
   3. Save the changes

2. **Add PostgreSQL Database** (CRITICAL - MUST BE DONE FIRST)
   - In your Railway project dashboard, click "New" (or "+ New" button)
   - Select "Database" → "PostgreSQL"
   - Railway will create a PostgreSQL service
   - Wait for it to finish provisioning (may take a minute)
   - **Important**: Railway will automatically provide `DATABASE_URL` environment variable in the PostgreSQL service
   - **DO NOT** set `DATABASE_URL` manually - Railway provides it automatically
   - Note the PostgreSQL service name (it will appear in your project)

3. **Connect Database to Backend Service** (CRITICAL STEP)
   - After PostgreSQL is created, you need to connect it to your backend service
   - Click on your **backend service** (not the PostgreSQL service)
   - Go to "Settings" tab
   - Click on "Variables" section
   - Look for `DATABASE_URL` - it might be automatically added, or you need to add it
   - If `DATABASE_URL` is NOT present:
     - Click "New Variable" button
     - In the variable name field, type: `DATABASE_URL`
     - You'll see tabs: "Plain" and "Reference" - **Click "Reference"**
     - After clicking "Reference", you should see:
       - A dropdown to select a service (this will show your PostgreSQL service)
       - A dropdown to select a variable (this will show `DATABASE_URL`)
     - Select your PostgreSQL service from the first dropdown
     - Select `DATABASE_URL` from the second dropdown
     - Click "Add" or "Save"
   - If you don't see the service dropdown after clicking "Reference":
     - Make sure the PostgreSQL service is fully provisioned (check the PostgreSQL service status)
     - Make sure both services are in the same Railway project
     - Try refreshing the page
   
   **Verify**: In your backend service Variables, you should see:
   - `DATABASE_URL` with a value like `postgresql://postgres:password@hostname:port/railway`
   - It should show as "Referenced from PostgreSQL" or have a link icon (not a plain value)

4. **Configure Other Environment Variables**
   - Still in your backend service settings
   - Click on "Variables" tab
   - Add all the other backend environment variables listed above
   - **Important**: Don't set `DATABASE_URL` manually - it should be referenced from PostgreSQL service

4. **Configure Build Settings**
   - Railway will automatically detect `nixpacks.toml` and use it for building
   - The build will install dependencies and run migrations on startup
   - No additional configuration needed

5. **Generate Domain**
   - Railway will automatically generate a domain (e.g., `your-app.up.railway.app`)
   - Note this URL - you'll need it for the frontend configuration

6. **Database Migrations**
   - Migrations run automatically on startup via `nixpacks.toml` start command
   - The command runs `alembic upgrade head` before starting the server
   - Check Railway logs to verify migrations completed successfully
   - If needed, you can run manually via Railway's CLI:
     ```bash
     railway run alembic upgrade head
     ```

## Step 3: Deploy Frontend to Vercel

1. **Connect Repository to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Set the root directory to `frontend`

2. **Configure Build Settings**
   - Vercel will detect Vite automatically
   - Build Command: `npm run build` (auto-detected)
   - Output Directory: `dist` (auto-detected)
   - Install Command: `npm install` (auto-detected)

3. **Configure Environment Variables**
   - Go to Project Settings → Environment Variables
   - Add:
     - `VITE_API_BASE_URL` = Your Railway backend URL (e.g., `https://your-backend.railway.app`)
     - `VITE_LIFF_ID` = Your LINE LIFF ID

4. **Deploy**
   - Click "Deploy"
   - Wait for deployment to complete
   - Note your deployment URL (e.g., `your-app.vercel.app`)

## Step 4: Update Environment Variables

After both deployments are complete, you need to update the environment variables:

### Update Backend (Railway)
1. Go back to Railway
2. Update `FRONTEND_URL` to your Vercel URL (e.g., `https://your-app.vercel.app`)
3. Update `API_BASE_URL` to your Railway backend URL

### Update Frontend (Vercel)
1. Go back to Vercel
2. Update `VITE_API_BASE_URL` to your Railway backend URL
3. Redeploy if needed

## Step 5: Configure LINE Webhook

1. **Update LINE Webhook URL**
   - Go to [LINE Developers Console](https://developers.line.biz/console/)
   - Select your channel
   - Go to "Messaging API" tab
   - Update Webhook URL to: `https://your-backend.railway.app/api/liff/webhook`
   - Enable webhook

2. **Update Google OAuth Redirect URI**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Select your project
   - Go to "APIs & Services" → "Credentials"
   - Edit your OAuth 2.0 Client ID
   - Add redirect URI: `https://your-backend.railway.app/api/auth/google/callback`

## Step 6: Verify Deployment

1. **Test Backend Health**
   - Visit: `https://your-backend.railway.app/health`
   - Should return: `{"status": "healthy"}`

2. **Test Frontend**
   - Visit your Vercel URL
   - Check browser console for errors
   - Verify API calls are working

3. **Test Database**
   - Check Railway logs for migration success
   - Verify database tables are created

## Step 7: Production Checklist

- [ ] All environment variables are set correctly
- [ ] Database migrations have run successfully
- [ ] CORS is configured correctly (frontend URL in backend)
- [ ] LINE webhook URL is updated
- [ ] Google OAuth redirect URI is updated
- [ ] JWT secret keys are strong and unique (not default values)
- [ ] Encryption key is generated and set
- [ ] System admin emails are configured
- [ ] Frontend can connect to backend API
- [ ] Authentication flow works end-to-end

## Troubleshooting

### Backend Issues

**Database Connection Errors (Connection to localhost refused)**
- **Symptom**: Error says "connection to server at localhost failed"
- **Cause**: `DATABASE_URL` environment variable is not set or not referenced from PostgreSQL service
- **Solution**:
  1. Go to your backend service in Railway
  2. Click "Settings" → "Variables"
  3. Check if `DATABASE_URL` exists
  4. If it doesn't exist:
     - Click "New Variable"
     - Select "Reference" tab (not "Plain")
     - Choose your PostgreSQL service from the dropdown
     - Select `DATABASE_URL` variable
     - Save
  5. If `DATABASE_URL` exists but is a plain value (not a reference):
     - Delete it
     - Add it as a reference (see step 4 above)
  6. Verify the value looks like: `postgresql://postgres:password@hostname:port/railway`
  7. Redeploy the backend service

**Database Connection Errors (General)**
- Verify `DATABASE_URL` is provided by Railway (don't set manually)
- Check Railway logs for connection errors
- Ensure PostgreSQL service is running
- Verify PostgreSQL service is in the same Railway project

**Migration Errors**
- Check Railway logs for migration output
- Run migrations manually: `railway run alembic upgrade head`
- Verify database is accessible

**CORS Errors**
- Ensure `FRONTEND_URL` in Railway matches your Vercel URL exactly
- Check that CORS_ORIGINS includes your production URL
- Verify frontend is making requests to the correct backend URL

### Frontend Issues

**API Connection Errors**
- Verify `VITE_API_BASE_URL` is set correctly
- Check browser console for CORS errors
- Ensure backend is deployed and accessible
- Check network tab for failed requests

**Build Errors**
- Check Vercel build logs
- Verify all dependencies are in `package.json`
- Ensure Node.js version is compatible

### Environment Variable Issues

**Variables Not Loading**
- Vercel: Ensure variables are set for the correct environment (Production)
- Railway: Check that variables are set in the service, not just the project
- Restart services after adding new variables

## Monitoring

### Railway
- Check logs in Railway dashboard
- Monitor database usage
- Set up alerts for service downtime

### Vercel
- Check deployment logs
- Monitor function execution times
- Set up analytics if needed

## Security Notes

1. **Never commit secrets** - All sensitive data should be in environment variables
2. **Use strong secrets** - Generate random strings for JWT and encryption keys
3. **HTTPS only** - Both Vercel and Railway use HTTPS by default
4. **CORS** - Only allow your production frontend URL
5. **Database** - Railway provides encrypted connections automatically

## Cost Considerations

### Vercel
- Free tier: 100GB bandwidth, unlimited deployments
- Hobby plan: $20/month for team features

### Railway
- Free tier: $5 credit/month
- Usage-based pricing after free tier
- PostgreSQL: Included in database service

## Support

- Railway Docs: https://docs.railway.app
- Vercel Docs: https://vercel.com/docs
- Railway Support: support@railway.app
- Vercel Support: https://vercel.com/support

