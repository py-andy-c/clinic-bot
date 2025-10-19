"""Application constants and configuration values."""

# Database field lengths
MAX_STRING_LENGTH = 255

# OAuth and authentication
GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "profile",
    "email"
]

# Database connection settings
DB_POOL_RECYCLE_SECONDS = 300  # 5 minutes

# CORS origins for development
CORS_ORIGINS = [
    "http://localhost:5173",  # React dev server (Vite)
]
