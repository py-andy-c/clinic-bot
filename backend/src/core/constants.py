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

# HTTP status codes (for reuse)
HTTP_200_OK = 200
HTTP_400_BAD_REQUEST = 400
HTTP_401_UNAUTHORIZED = 401
HTTP_404_NOT_FOUND = 404
HTTP_422_UNPROCESSABLE_ENTITY = 422
HTTP_500_INTERNAL_SERVER_ERROR = 500

# Database connection settings
DB_POOL_RECYCLE_SECONDS = 300  # 5 minutes

# CORS origins for development
CORS_ORIGINS = [
    "http://localhost:5173",  # React dev server (Vite)
]
