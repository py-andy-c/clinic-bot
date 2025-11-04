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
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import auth, signup, system, clinic, profile, practitioner_calendar, liff
from core.constants import CORS_ORIGINS
from services.reminder_service import start_reminder_scheduler, stop_reminder_scheduler
from core.database import get_db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)

logger = logging.getLogger(__name__)
logger.info("🏥 Clinic Bot API starting...")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    logger.info("🚀 Starting Clinic Bot Backend API")

    # Start reminder scheduler
    db = next(get_db())
    try:
        await start_reminder_scheduler(db)
        logger.info("✅ Appointment reminder scheduler started")
    except Exception as e:
        logger.exception(f"❌ Failed to start reminder scheduler: {e}")

    yield

    # Stop reminder scheduler
    try:
        await stop_reminder_scheduler()
        logger.info("🛑 Appointment reminder scheduler stopped")
    except Exception as e:
        logger.exception(f"❌ Error stopping reminder scheduler: {e}")

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
    practitioner_calendar.router,
    prefix="/api/clinic",
    tags=["practitioner-calendar"],
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
    tags=["liff"],
    responses={
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden"},
        404: {"description": "Resource not found"},
        409: {"description": "Conflict"},
        500: {"description": "Internal server error"},
    },
)


@app.get(
    "/",
    summary="Root endpoint",
    description="Returns basic API information",
)
async def root() -> dict[str, str]:
    """Get API information."""
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


# Global exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions globally."""
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "內部伺服器錯誤", "type": "internal_error"},
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    """Handle ValueError exceptions."""
    logger.warning(f"ValueError: {exc}")
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc), "type": "validation_error"},
    )


@app.exception_handler(httpx.HTTPStatusError)
async def http_status_error_handler(request: Request, exc: httpx.HTTPStatusError):
    """Handle HTTP status errors from external services."""
    logger.exception(f"External service error: {exc}")
    return JSONResponse(
        status_code=502,
        content={"detail": "外部服務錯誤", "type": "external_service_error"},
    )
