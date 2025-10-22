"""
Admin API endpoints for clinic management.

This module provides REST API endpoints for clinic administrators to manage
therapists, patients, settings, and view dashboard analytics.
"""

import logging
from typing import Any, Dict, List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import API_BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from models import Therapist, Patient, Appointment, AppointmentType, ClinicAdmin, Clinic
from services.google_oauth import GoogleOAuthService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/auth/google/login", summary="Initiate Google OAuth login")
async def initiate_google_auth() -> Dict[str, str]:
    """
    Initiate Google OAuth login flow for clinic admins.
    """
    try:
        # Simple Google OAuth URL construction for admin login
        # In production, use proper OAuth2 client
        from urllib.parse import urlencode
        from core.config import GOOGLE_CLIENT_ID

        params = {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": f"{API_BASE_URL}/api/admin/auth/google/callback",
            "scope": "openid profile email",
            "response_type": "code",
            "state": "admin"
        }

        auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
        return {"auth_url": auth_url}
    except Exception as e:
        logger.error(f"Error initiating Google auth: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate authentication"
        )


@router.get("/auth/google/callback", summary="Handle Google OAuth callback")
async def google_auth_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Handle Google OAuth callback and authenticate clinic admin.
    """
    try:
        # Validate state (should be "admin")
        if state != "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid authentication state"
            )

        # Exchange code for tokens (simplified for admin auth)
        import httpx
        token_url = "https://oauth2.googleapis.com/token"

        token_data = {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": f"{API_BASE_URL}/api/admin/auth/google/callback"
        }

        async with httpx.AsyncClient() as client:
            token_response = await client.post(token_url, data=token_data)
            token_response.raise_for_status()
            token_info = token_response.json()

            # Get user info
            user_info_url = "https://www.googleapis.com/oauth2/v2/userinfo"
            headers = {"Authorization": f"Bearer {token_info['access_token']}"}
            user_response = await client.get(user_info_url, headers=headers)
            user_response.raise_for_status()
            user_info = user_response.json()

        if not user_info or not user_info.get("email"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get user information from Google"
            )

        email = user_info["email"]

        # Check if user is a clinic admin
        admin = db.query(ClinicAdmin).filter_by(email=email).first()

        if not admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. You are not authorized to access this system."
            )

        # Get clinic information
        clinic = db.query(Clinic).filter_by(id=admin.clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Clinic information not found"
            )

        # TODO: Create JWT token for session management
        # For now, return user info
        return {
            "user": {
                "id": admin.id,
                "email": admin.email,
                "name": admin.full_name or user_info.get("name", email),
                "clinic_id": admin.clinic_id,
                "clinic_name": clinic.name
            },
            "message": "Authentication successful"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in Google auth callback: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication failed"
        )


@router.post("/auth/logout", summary="Logout current user")
async def logout() -> Dict[str, str]:
    """
    Logout the current user by clearing session.
    """
    # TODO: Invalidate session/token
    return {"message": "Logged out successfully"}


# Dependency to get current clinic admin (placeholder for now)
async def get_current_admin(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get current authenticated admin.

    TODO: Implement proper JWT/session-based authentication
    For now, returns a mock admin for development.
    """
    # Mock admin for development - in production this would validate JWT/session
    return {
        "id": 1,
        "clinic_id": 1,
        "email": "admin@clinic.com",
        "name": "Admin User"
    }


@router.get("/dashboard", summary="Get dashboard statistics")
async def get_dashboard_stats(
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get dashboard statistics for the admin's clinic.

    Returns key metrics like appointment counts, patient stats, and cancellation rates.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        # Total appointments
        total_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id)
        ).count()

        # Upcoming appointments (next 7 days)
        week_from_now = datetime.now(timezone.utc) + timedelta(days=7)
        upcoming_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.start_time >= datetime.now(timezone.utc),
            Appointment.start_time <= week_from_now,
            Appointment.status == "confirmed"
        ).count()

        # New patients (last 30 days)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        new_patients = db.query(Patient).filter(
            Patient.clinic_id == clinic_id
        ).filter(Patient.created_at >= thirty_days_ago).count()  # type: ignore

        # Cancellation rate (last 30 days)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        recent_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.created_at >= thirty_days_ago  # type: ignore
        ).count()

        cancelled_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.created_at >= thirty_days_ago,  # type: ignore
            Appointment.status.in_(["canceled_by_patient", "canceled_by_clinic"])
        ).count()

        cancellation_rate = cancelled_appointments / recent_appointments if recent_appointments > 0 else 0

        return {
            "total_appointments": total_appointments,
            "upcoming_appointments": upcoming_appointments,
            "new_patients": new_patients,
            "cancellation_rate": cancellation_rate
        }

    except Exception as e:
        logger.error(f"Error fetching dashboard stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch dashboard statistics"
        )


@router.get("/therapists", summary="List all therapists")
async def get_therapists(
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all therapists for the admin's clinic.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        therapists = db.query(Therapist).filter_by(clinic_id=clinic_id).all()

        return [{
            "id": t.id,
            "name": t.name,
            "email": t.email,
            "gcal_sync_enabled": t.gcal_credentials is not None and t.gcal_sync_enabled,
            "created_at": t.created_at.isoformat()
        } for t in therapists]

    except Exception as e:
        logger.error(f"Error fetching therapists: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch therapists"
        )


@router.post("/therapists", summary="Create a new therapist")
async def create_therapist(
    therapist_data: Dict[str, str],
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Create a new therapist record and return signup link.

    Email is not required - it comes from Google OAuth during signup.
    """
    clinic_id = current_admin["clinic_id"]
    name = therapist_data.get("name")

    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name is required"
        )

    try:
        # Check if therapist with this name already exists in the clinic
        existing = db.query(Therapist).filter_by(
            clinic_id=clinic_id,
            name=name
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Therapist with this name already exists"
            )

        # Create therapist record (email will be set during Google OAuth signup)
        therapist = Therapist(
            clinic_id=clinic_id,
            name=name,
            email=None  # Will be populated from Google OAuth
        )

        db.add(therapist)
        db.commit()
        db.refresh(therapist)

        logger.info(f"Therapist record created: {name} (ID: {therapist.id})")

        return {
            "id": therapist.id,
            "name": therapist.name,
            "email": therapist.email,  # Will be None initially
            "message": "Therapist record created successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error inviting therapist: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to invite therapist"
        )


@router.get("/therapists/{therapist_id}/gcal/auth", summary="Initiate Google Calendar OAuth")
async def initiate_therapist_gcal_auth(
    therapist_id: int,
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Initiate Google Calendar OAuth flow for a therapist.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        # Verify therapist belongs to clinic
        therapist = db.query(Therapist).filter_by(
            id=therapist_id,
            clinic_id=clinic_id
        ).first()

        if not therapist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Therapist not found"
            )

        # Generate OAuth URL using therapist OAuth service
        oauth_service = GoogleOAuthService()
        auth_url = oauth_service.get_authorization_url(therapist_id, clinic_id)

        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error initiating GCal auth: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate Google Calendar authorization"
        )


@router.get("/patients", summary="List all patients")
async def get_patients(
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all patients for the admin's clinic.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        patients = db.query(Patient).filter_by(clinic_id=clinic_id).all()

        return [{
            "id": p.id,
            "full_name": p.full_name,
            "phone_number": p.phone_number,
            "line_user_id": p.line_user.line_user_id if p.line_user else None,
            "created_at": p.created_at.isoformat()  # type: ignore
        } for p in patients]

    except Exception as e:
        logger.error(f"Error fetching patients: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch patients"
        )


@router.get("/settings", summary="Get clinic settings")
async def get_settings(
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get clinic settings including appointment types and preferences.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        # Get appointment types
        appointment_types = db.query(AppointmentType).filter_by(clinic_id=clinic_id).all()

        return {
            "appointment_types": [{
                "id": at.id,
                "name": at.name,
                "duration_minutes": at.duration_minutes
            } for at in appointment_types],
            "reminder_hours_before": 24,  # Default for now
            "clinic_hours_start": "09:00",
            "clinic_hours_end": "18:00",
            "holidays": []  # Placeholder
        }

    except Exception as e:
        logger.error(f"Error fetching settings: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch settings"
        )


@router.put("/settings", summary="Update clinic settings")
async def update_settings(
    settings: Dict[str, Any],
    current_admin: Dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update clinic settings including appointment types.
    """
    clinic_id = current_admin["clinic_id"]

    try:
        # Update appointment types
        appointment_types_data = settings.get("appointment_types", [])

        # Delete existing appointment types
        db.query(AppointmentType).filter_by(clinic_id=clinic_id).delete()

        # Add new appointment types
        for at_data in appointment_types_data:
            if at_data.get("name") and at_data.get("duration_minutes"):
                appointment_type = AppointmentType(
                    clinic_id=clinic_id,
                    name=at_data["name"],
                    duration_minutes=at_data["duration_minutes"]
                )
                db.add(appointment_type)

        db.commit()

        return {"message": "Settings updated successfully"}

    except Exception as e:
        logger.error(f"Error updating settings: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update settings"
        )