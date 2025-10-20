"""
Provider admin API endpoints.

This module provides administrative endpoints for the clinic bot provider
to manage clinics, view system-wide analytics, and perform provider-level operations.
Separate from clinic admin functionality.
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from models import Clinic, ClinicAdmin, Therapist, Patient, Appointment

router = APIRouter()
logger = logging.getLogger(__name__)


# Provider authentication (simplified for demo - in production use proper auth)
def get_provider_auth() -> Dict[str, str]:
    """Get provider authentication (simplified for demo)."""
    return {"provider_id": "provider_123", "email": "provider@clinicbot.com"}


@router.get("/dashboard", summary="Get provider dashboard")
async def get_provider_dashboard(
    provider: Dict[str, str] = Depends(get_provider_auth),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get provider-level dashboard with system-wide metrics.
    """
    try:
        # Total clinics
        total_clinics = db.query(Clinic).count()

        # Active clinics (non-trial)
        active_clinics = db.query(Clinic).filter(
            Clinic.subscription_status.in_(["active", "trial"])
        ).count()

        # Total therapists
        total_therapists = db.query(Therapist).count()

        # Total patients
        total_patients = db.query(Patient).count()

        # Total appointments (last 30 days)
        thirty_days_ago = datetime.now() - timedelta(days=30)
        recent_appointments = db.query(Appointment).filter(
            Appointment.start_time >= thirty_days_ago
        ).count()

        # Revenue metrics (simplified)
        monthly_revenue = active_clinics * 99  # $99 per clinic per month

        return {
            "total_clinics": total_clinics,
            "active_clinics": active_clinics,
            "total_therapists": total_therapists,
            "total_patients": total_patients,
            "recent_appointments": recent_appointments,
            "monthly_revenue": monthly_revenue,
            "churn_rate": 0.05,  # 5% placeholder
        }

    except Exception as e:
        logger.error(f"Error fetching provider dashboard: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch provider dashboard"
        )


@router.get("/clinics", summary="List all clinics")
async def get_clinics(
    provider: Dict[str, str] = Depends(get_provider_auth),
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all clinics in the system.
    """
    try:
        clinics = db.query(Clinic).all()

        clinic_data = []
        for clinic in clinics:
            # Get clinic stats
            therapist_count = db.query(Therapist).filter_by(clinic_id=clinic.id).count()
            patient_count = db.query(Patient).filter_by(clinic_id=clinic.id).count()
            admin_count = db.query(ClinicAdmin).filter_by(clinic_id=clinic.id).count()

            clinic_data.append({
                "id": clinic.id,
                "name": clinic.name,
                "line_channel_id": clinic.line_channel_id,
                "subscription_status": clinic.subscription_status,
                "trial_ends_at": clinic.trial_ends_at.isoformat() if clinic.trial_ends_at else None,
                "therapist_count": therapist_count,
                "patient_count": patient_count,
                "admin_count": admin_count,
                "created_at": clinic.created_at.isoformat(),
            })

        return clinic_data

    except Exception as e:
        logger.error(f"Error fetching clinics: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch clinics"
        )


@router.post("/clinics", summary="Create new clinic")
async def create_clinic(
    clinic_data: Dict[str, Any],
    provider: Dict[str, str] = Depends(get_provider_auth),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Create a new clinic in the system.
    """
    required_fields = ["name", "line_channel_id", "line_channel_secret", "line_channel_access_token"]
    for field in required_fields:
        if field not in clinic_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required field: {field}"
            )

    try:
        # Check if LINE channel ID already exists
        existing = db.query(Clinic).filter_by(
            line_channel_id=clinic_data["line_channel_id"]
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Clinic with this LINE channel ID already exists"
            )

        # Create clinic
        clinic = Clinic(
            name=clinic_data["name"],
            line_channel_id=clinic_data["line_channel_id"],
            line_channel_secret=clinic_data["line_channel_secret"],
            line_channel_access_token=clinic_data["line_channel_access_token"],
            subscription_status=clinic_data.get("subscription_status", "trial"),
            trial_ends_at=datetime.now() + timedelta(days=14) if clinic_data.get("subscription_status") == "trial" else None
        )

        db.add(clinic)
        db.commit()
        db.refresh(clinic)

        logger.info(f"Created new clinic: {clinic.name} (ID: {clinic.id})")

        return {
            "id": clinic.id,
            "name": clinic.name,
            "line_channel_id": clinic.line_channel_id,
            "subscription_status": clinic.subscription_status,
            "trial_ends_at": clinic.trial_ends_at.isoformat() if clinic.trial_ends_at else None,
            "message": "Clinic created successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating clinic: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create clinic"
        )


@router.get("/clinics/{clinic_id}", summary="Get clinic details")
async def get_clinic_details(
    clinic_id: int,
    provider: Dict[str, str] = Depends(get_provider_auth),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get detailed information about a specific clinic.
    """
    try:
        clinic = db.query(Clinic).filter_by(id=clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )

        # Get related data
        admins = db.query(ClinicAdmin).filter_by(clinic_id=clinic_id).all()
        therapists = db.query(Therapist).filter_by(clinic_id=clinic_id).all()
        patients = db.query(Patient).filter_by(clinic_id=clinic_id).all()

        # Recent appointments
        thirty_days_ago = datetime.now() - timedelta(days=30)
        recent_appointments = db.query(Appointment).filter(
            Appointment.patient.has(clinic_id=clinic_id),
            Appointment.created_at >= thirty_days_ago
        ).count()

        return {
            "clinic": {
                "id": clinic.id,
                "name": clinic.name,
                "line_channel_id": clinic.line_channel_id,
                "subscription_status": clinic.subscription_status,
                "trial_ends_at": clinic.trial_ends_at.isoformat() if clinic.trial_ends_at else None,
                "created_at": clinic.created_at.isoformat(),
            },
            "stats": {
                "admin_count": len(admins),
                "therapist_count": len(therapists),
                "patient_count": len(patients),
                "recent_appointments": recent_appointments,
            },
            "admins": [{
                "id": admin.id,
                "email": admin.email,
                "full_name": admin.full_name,
                "is_active": admin.is_active,
            } for admin in admins],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching clinic details: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch clinic details"
        )


@router.put("/clinics/{clinic_id}", summary="Update clinic")
async def update_clinic(
    clinic_id: int,
    clinic_data: Dict[str, Any],
    provider: Dict[str, str] = Depends(get_provider_auth),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update clinic information.
    """
    try:
        clinic = db.query(Clinic).filter_by(id=clinic_id).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )

        # Update allowed fields
        allowed_fields = ["name", "subscription_status", "trial_ends_at"]
        for field in allowed_fields:
            if field in clinic_data:
                setattr(clinic, field, clinic_data[field])

        db.commit()
        db.refresh(clinic)

        return {
            "id": clinic.id,
            "name": clinic.name,
            "subscription_status": clinic.subscription_status,
            "trial_ends_at": clinic.trial_ends_at.isoformat() if clinic.trial_ends_at else None,
            "message": "Clinic updated successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clinic: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update clinic"
        )
