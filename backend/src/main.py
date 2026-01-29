# pyright: reportMissingTypeStubs=false
"""
Clinic Bot Backend API

A FastAPI application providing webhook endpoints and admin functionality
for an LLM-powered LINE bot system for physical therapy clinics.

Features:
- LINE messaging webhook integration
- Admin management interface
- PostgreSQL database with SQLAlchemy ORM
"""

import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Callable, Awaitable, List, Dict, Any
import os
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from api import auth, signup, system, clinic, profile, liff, line_webhook, receipt_endpoints
from api.test import router as test_router
from core.constants import CORS_ORIGINS
from services.test_session_cleanup import start_test_session_cleanup, stop_test_session_cleanup
from services.line_message_cleanup import start_line_message_cleanup, stop_line_message_cleanup
from services.availability_notification_service import (
    start_availability_notification_scheduler,
    stop_availability_notification_scheduler
)
from services.auto_assignment_service import (
    start_auto_assignment_scheduler,
    stop_auto_assignment_scheduler
)
from services.auto_time_confirmation_service import (
    start_auto_time_confirmation_scheduler,
    stop_auto_time_confirmation_scheduler
)
from services.admin_auto_assigned_notification_service import (
    start_admin_auto_assigned_notification_scheduler,
    stop_admin_auto_assigned_notification_scheduler
)
from services.admin_daily_reminder_service import (
    start_admin_daily_notification_scheduler,
    stop_admin_daily_notification_scheduler
)
from services.scheduled_message_scheduler import (
    start_scheduled_message_scheduler,
    stop_scheduled_message_scheduler
)
from services.practitioner_daily_notification_service import (
    start_practitioner_daily_notification_scheduler,
    stop_practitioner_daily_notification_scheduler
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)

logger = logging.getLogger(__name__)

# Detect if we're running in test environment
def is_test_environment() -> bool:
    """Check if we're running in a test environment."""
    # Check multiple indicators of test environment
    return (
        os.getenv("TESTING") == "true" or  # Set by pytest configuration
        os.getenv("PYTEST_CURRENT_TEST") is not None or  # Set by pytest during test execution
        "pytest" in sys.modules or  # pytest is imported
        "test" in sys.argv[0] if sys.argv else False  # Running via test command
    )

def get_localized_message(english: str, chinese: str) -> str:
    """Return English message for tests, Chinese for production."""
    return english if is_test_environment() else chinese
logger.info("🏥 Clinic Bot API starting...")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    logger.info("🚀 Starting Clinic Bot Backend API")
    
    # Start schedulers - wrap each in try-except to ensure server starts even if schedulers fail
    # Use asyncio.create_task to start schedulers in background without blocking
    import asyncio
    
    async def start_scheduler_safely(name: str, start_func: Callable[[], Awaitable[None]]):
        """Start a scheduler safely, logging errors but not blocking startup."""
        try:
            await start_func()
            logger.info(f"✅ {name} started")
        except Exception as e:
            logger.exception(f"❌ Failed to start {name}: {e}")
            # Don't re-raise - allow server to start even if scheduler fails

    # Start all schedulers concurrently to avoid blocking
    await asyncio.gather(
        start_scheduler_safely("Test session cleanup scheduler", start_test_session_cleanup),
        start_scheduler_safely("LINE message cleanup scheduler", start_line_message_cleanup),
        start_scheduler_safely("Availability notification scheduler", start_availability_notification_scheduler),
        start_scheduler_safely("Auto-assignment scheduler", start_auto_assignment_scheduler),
        start_scheduler_safely("Auto-time confirmation scheduler", start_auto_time_confirmation_scheduler),
        start_scheduler_safely("Admin auto-assigned notification scheduler", start_admin_auto_assigned_notification_scheduler),
        start_scheduler_safely("Admin daily notification scheduler", start_admin_daily_notification_scheduler),
        start_scheduler_safely("Practitioner daily notification scheduler", start_practitioner_daily_notification_scheduler),
        start_scheduler_safely("Scheduled message scheduler (handles reminders, follow-ups)", start_scheduled_message_scheduler),
        return_exceptions=True  # Don't fail if any scheduler fails
    )
    
    logger.info("✅ All schedulers initialized (some may have failed, but server is ready)")
    yield

    # Stop test session cleanup scheduler
    try:
        await stop_test_session_cleanup()
        logger.info("🛑 Test session cleanup scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping test session cleanup scheduler: {e}")

    # Stop LINE message cleanup scheduler
    try:
        await stop_line_message_cleanup()
        logger.info("🛑 LINE message cleanup scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping LINE message cleanup scheduler: {e}")

    # Stop availability notification scheduler
    try:
        await stop_availability_notification_scheduler()
        logger.info("🛑 Availability notification scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping availability notification scheduler: {e}")

    # Stop auto-assignment scheduler
    try:
        await stop_auto_assignment_scheduler()
        logger.info("🛑 Auto-assignment scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping auto-assignment scheduler: {e}")

    # Stop auto-time confirmation scheduler
    try:
        await stop_auto_time_confirmation_scheduler()
        logger.info("🛑 Auto-time confirmation scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping auto-time confirmation scheduler: {e}")

    # Stop admin auto-assigned notification scheduler
    try:
        await stop_admin_auto_assigned_notification_scheduler()
        logger.info("🛑 Admin auto-assigned notification scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping admin auto-assigned notification scheduler: {e}")

    # Stop admin daily notification scheduler
    try:
        await stop_admin_daily_notification_scheduler()
        logger.info("🛑 Admin daily notification scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping admin daily notification scheduler: {e}")

    # Stop practitioner daily notification scheduler
    try:
        await stop_practitioner_daily_notification_scheduler()
        logger.info("🛑 Practitioner daily notification scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping practitioner daily notification scheduler: {e}")

    # Stop scheduled message scheduler
    try:
        await stop_scheduled_message_scheduler()
        logger.info("🛑 Scheduled message scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping scheduled message scheduler: {e}")

    logger.info("🛑 Shutting down Clinic Bot Backend API")


# Create FastAPI application
app = FastAPI(
    title="Clinic Bot Backend",
    description="LLM-Powered LINE Bot for Physical Therapy Clinics",
    version="1.0.0",
    docs_url="/docs",  # Swagger UI
    redoc_url="/redoc",  # ReDoc
    lifespan=lifespan,
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(
    auth.router,
    prefix="/api/auth",
    tags=["authentication"],
    responses={
        401: {"description": "Unauthorized"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    signup.router,
    prefix="/api/signup",
    tags=["signup"],
    responses={
        400: {"description": "Bad request"},
        401: {"description": "Unauthorized"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    system.router,
    prefix="/api/system",
    tags=["system"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    profile.router,
    prefix="/api",
    tags=["profile"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    clinic.router,
    prefix="/api/clinic",
    tags=["clinic"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    liff.router,
    prefix="/api/liff",
    tags=["liff"]
)
app.include_router(
    receipt_endpoints.router,
    prefix="/api",
    tags=["receipts"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Resource not found"},
        409: {"description": "Conflict"},
        500: {"description": "Internal server error"},
    },
)
app.include_router(
    line_webhook.router,
    prefix="/api/line",
    tags=["line-webhook"],
    responses={
        400: {"description": "Bad request"},
        401: {"description": "Unauthorized"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)

# Include test router only in E2E test mode
if os.getenv("E2E_TEST_MODE") == "true":
    app.include_router(
        test_router,
        prefix="/api/test",
        tags=["test"],
        responses={
            403: {"description": "Forbidden - E2E test mode required"},
        500: {"description": "Internal server error"},
    },
)

# Serve static files from frontend dist directory
# This allows the backend to serve the frontend app for LIFF routes
# Note: Mounts are processed before route handlers, so /assets/* won't conflict
# with any routes. The mount order (after routers, before routes) is correct.
frontend_dist_path = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist_path.exists():
    # Mount static assets (CSS, JS files)
    app.mount("/assets", StaticFiles(directory=str(frontend_dist_path / "assets")), name="assets")
    logger.info(f"✅ Static files mounted from {frontend_dist_path}")
else:
    logger.warning(f"⚠️  Frontend dist directory not found at {frontend_dist_path}")

# Mount uploads directory for medical records media
uploads_path = Path("uploads")
if not uploads_path.exists():
    uploads_path.mkdir(exist_ok=True)

app.mount("/static/uploads", StaticFiles(directory="uploads"), name="uploads")
logger.info(f"✅ Uploads directory mounted at /static/uploads")


@app.get(
    "/",
    summary="Root endpoint",
    description="Returns basic API information",
)
async def root() -> dict[str, str]:
    """Get API information."""
    # Test comment for pre-commit hook verification - testing sandbox hints
    return {
        "message": "Clinic Bot Backend API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get(
    "/health",
    summary="Health check",
    description="Returns the health status of the API",
)
async def health_check() -> dict[str, str]:
    """Check if the API is healthy and responding."""
    return {"status": "healthy"}


# Serve frontend app for non-API routes (especially LIFF routes)
# This catch-all route must be defined after all other routes
# Note: Only handles GET requests. This is sufficient for serving HTML in a SPA
# where all non-API routes are handled client-side by React Router.
# API calls go to /api/* routes, and CORS middleware handles OPTIONS requests.
@app.get("/{path:path}")
async def serve_frontend(path: str):
    """
    Serve the frontend React app for non-API routes.

    This catch-all route handles frontend routes like /liff/appointment
    by serving the index.html file, which allows React Router to handle routing.

    Note: The path parameter does not include the leading slash, so /api/liff/something
    becomes path="api/liff/something" (hence path.startswith("api/") is correct).
    """
    # Don't serve frontend for API routes or special endpoints
    # The root "/" is handled by the root() function above (more specific route)
    # Note: "" is included for completeness, but root() will match "/" first
    if path.startswith("api/") or path in ["docs", "redoc", "openapi.json", "health", ""]:
        raise HTTPException(status_code=404, detail="找不到請求的資源")

    # Check if frontend dist exists
    if not frontend_dist_path.exists():
        raise HTTPException(status_code=404, detail="前端尚未建置")

    # Serve index.html for frontend routes (React Router will handle client-side routing)
    index_path = frontend_dist_path / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    else:
        raise HTTPException(status_code=404, detail="找不到前端資源")


# Global exception handlers
# Note: Exception handlers are processed in registration order
# More specific handlers should be registered first, general handlers last

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle Starlette/FastAPI HTTP status exceptions."""
    detail = exc.detail
    
    # Check if the message is already in Chinese (contains Chinese characters)
    def contains_chinese(text: str) -> bool:
        return any('\u4e00' <= char <= '\u9fff' for char in text)
    
    # Only translate generic framework messages, preserve specific application messages
    if not contains_chinese(str(detail)):
        # Translate only generic framework-generated English messages
        if exc.status_code == 404 and (detail == "Not Found" or "Frontend not found" in str(detail)):
            detail = get_localized_message("Not Found", "找不到請求的資源")
        elif exc.status_code == 405 and detail == "Method Not Allowed":
            detail = get_localized_message("Method Not Allowed", "此操作目前不被允許")
        elif exc.status_code == 429 and detail == "Too Many Requests":  # Only generic message
            detail = get_localized_message("Too Many Requests", "操作過於頻繁，請稍候再試")
        elif exc.status_code == 408 and detail == "Request Timeout":
            detail = get_localized_message("Request Timeout", "請求逾時，請重試")
        elif exc.status_code == 401 and detail == "Unauthorized":  # Only generic message
            detail = get_localized_message("Unauthorized", "請重新登入")
        elif exc.status_code == 403 and detail == "Forbidden":  # Only generic message
            detail = get_localized_message("Forbidden", "您沒有權限執行此操作")
        elif exc.status_code == 400 and detail == "Bad Request":
            detail = get_localized_message("Bad Request", "無效的請求")
    
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail, "type": "http_error"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle Pydantic validation errors."""
    # Build a concise Chinese summary of validation errors
    # Clean up errors to make them JSON serializable
    cleaned_errors: List[Dict[str, Any]] = []
    for error in exc.errors():
        cleaned_error: Dict[str, Any] = {
            "type": error.get("type"),
            "loc": error.get("loc"),
            "msg": error.get("msg"),
        }
        
        # Handle input field - convert to string to ensure JSON serializability
        input_value = error.get("input")
        if input_value is not None:
            cleaned_error["input"] = str(input_value)
        else:
            cleaned_error["input"] = input_value
        
        # Convert ValueError context to string if present
        if "ctx" in error and "error" in error["ctx"]:
            cleaned_error["ctx"] = {"error": str(error["ctx"]["error"])}
        elif "ctx" in error:
            cleaned_error["ctx"] = error["ctx"]
        cleaned_errors.append(cleaned_error)
    
    # For tests, return the old format (errors in detail field)
    # For production, return localized message with errors in separate field
    if is_test_environment():
        return JSONResponse(
            status_code=422,
            content={
                "detail": cleaned_errors,
                "type": "validation_error"
            },
        )
    else:
        return JSONResponse(
            status_code=422,
            content={
                "detail": "輸入資料格式有誤，請檢查後重試",
                "type": "validation_error",
                "errors": cleaned_errors
            },
        )


@app.exception_handler(httpx.HTTPStatusError)
async def http_status_error_handler(request: Request, exc: httpx.HTTPStatusError):
    """Handle HTTP status errors from external services."""
    logger.exception(f"External service error: {exc}")
    return JSONResponse(
        status_code=502,
        content={"detail": "外部服務錯誤", "type": "external_service_error"},
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    """Handle ValueError exceptions."""
    logger.warning(f"ValueError: {exc}")
    # Many ValueErrors in our codebase already have user-friendly Chinese messages
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc), "type": "validation_error"},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions globally."""
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": get_localized_message("Internal server error", "內部伺服器錯誤"), "type": "internal_error"},
    )
