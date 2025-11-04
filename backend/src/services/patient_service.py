"""
Patient service for shared patient business logic.

This module contains all patient-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_

from models import Patient, Appointment, CalendarEvent, LineUser
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


class PatientService:
    """
    Service class for patient operations.

    Contains business logic for patient management that is shared
    across different API endpoints.
    """

    @staticmethod
    def create_patient(
        db: Session,
        clinic_id: int,
        full_name: str,
        phone_number: str,
        line_user_id: Optional[int] = None
    ) -> Patient:
        """
        Create a new patient record.

        Args:
            db: Database session
            clinic_id: Clinic ID the patient belongs to
            full_name: Patient's full name
            phone_number: Phone number (required)
            line_user_id: Optional LINE user ID for association

        Returns:
            Created Patient object

        Raises:
            HTTPException: If creation fails or line_user_id is invalid
        """
        # Validate line_user_id if provided
        if line_user_id is not None:
            line_user = db.query(LineUser).filter(LineUser.id == line_user_id).first()
            if not line_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無效的 LINE 使用者 ID"
                )

        try:
            patient = Patient(
                clinic_id=clinic_id,
                full_name=full_name,
                phone_number=phone_number,
                line_user_id=line_user_id
            )

            db.add(patient)
            db.commit()
            db.refresh(patient)

            logger.info(f"Created patient {patient.id} for clinic {clinic_id}")
            return patient

        except Exception as e:
            logger.error(f"Failed to create patient: {e}")
            db.rollback()

            # Handle unique constraint violations
            error_message = str(e).lower()
            if "unique constraint failed" in error_message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="此資料已存在，請檢查是否重複註冊"
                )
            else:
                raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="建立病患資料時發生錯誤，請稍後再試"
                )

    @staticmethod
    def list_patients_for_line_user(
        db: Session,
        line_user_id: int,
        clinic_id: int
    ) -> List[Patient]:
        """
        List all active patients associated with a LINE user for a specific clinic.

        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID

        Returns:
            List of active Patient objects, sorted by creation time
        """
        from utils.patient_queries import get_active_patients_for_line_user
        return get_active_patients_for_line_user(db, line_user_id, clinic_id)

    @staticmethod
    def list_patients_for_clinic(db: Session, clinic_id: int) -> List[Patient]:
        """
        List all active patients for a clinic (admin view).

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of active Patient objects for the clinic
        """
        from utils.patient_queries import get_active_patients_for_clinic
        return get_active_patients_for_clinic(db, clinic_id)

    @staticmethod
    def validate_patient_ownership(
        db: Session,
        patient_id: int,
        line_user_id: int,
        clinic_id: int
    ) -> Patient:
        """
        Validate that a patient belongs to a specific LINE user and clinic.

        Args:
            db: Database session
            patient_id: Patient ID to validate
            line_user_id: Expected LINE user ID
            clinic_id: Expected clinic ID

        Returns:
            Patient object if validation passes

        Raises:
            HTTPException: If patient not found or access denied
        """
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.line_user_id == line_user_id,
            Patient.clinic_id == clinic_id
        ).first()

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Patient not found or access denied"
            )

        return patient

    @staticmethod
    def delete_patient_for_line_user(
        db: Session,
        patient_id: int,
        line_user_id: int,
        clinic_id: int
    ) -> None:
        """
        Delete a patient record for a LINE user.

        This performs a soft delete by unlinking the patient from the LINE user
        while preserving appointment history.

        Args:
            db: Database session
            patient_id: Patient ID to delete
            line_user_id: LINE user ID for ownership validation
            clinic_id: Clinic ID

        Raises:
            HTTPException: If deletion not allowed or other validation fails
        """
        # Validate ownership
        patient = PatientService.validate_patient_ownership(
            db, patient_id, line_user_id, clinic_id
        )

        # Check for future appointments (using Taiwan timezone)
        # Need to check if any appointment is in the future by comparing date and time
        now = taiwan_now()
        today = now.date()
        current_time = now.time()
        
        future_appointments = db.query(Appointment).join(
            CalendarEvent
        ).filter(
            Appointment.patient_id == patient_id,
            Appointment.status == "confirmed",
            # Check if appointment is in the future: either future date, or today with future time
            (
                (CalendarEvent.date > today) |
                and_(CalendarEvent.date == today, CalendarEvent.start_time > current_time)
            )
        ).count()

        if future_appointments > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete patient with future appointments"
            )

        # Check if this is the last patient for this LINE user at this clinic
        total_patients = db.query(Patient).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).count()

        if total_patients <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="至少需保留一位就診人"
            )

        # Soft delete by marking as deleted and unlinking from LINE user (preserves appointment history)
        from datetime import datetime, timezone

        patient.is_deleted = True
        patient.deleted_at = datetime.now(timezone.utc)
        patient.line_user_id = None  # Also unlink for backward compatibility
        db.commit()

        logger.info(f"Soft deleted patient {patient_id} for LINE user {line_user_id}")

    @staticmethod
    def update_patient_for_line_user(
        db: Session,
        patient_id: int,
        line_user_id: int,
        clinic_id: int,
        full_name: Optional[str] = None,
        phone_number: Optional[str] = None
    ) -> Patient:
        """
        Update a patient record for a LINE user.

        Args:
            db: Database session
            patient_id: Patient ID to update
            line_user_id: LINE user ID for ownership validation
            clinic_id: Clinic ID
            full_name: Optional new full name
            phone_number: Optional new phone number

        Returns:
            Updated Patient object

        Raises:
            HTTPException: If patient not found, access denied, or update fails
        """
        # Validate ownership
        patient = PatientService.validate_patient_ownership(
            db, patient_id, line_user_id, clinic_id
        )

        try:
            # Update allowed fields
            # Note: phone_number is already cleaned and validated by PatientUpdateRequest validator
            if full_name is not None:
                patient.full_name = full_name.strip()
            if phone_number is not None:
                patient.phone_number = phone_number

            db.commit()
            db.refresh(patient)

            logger.info(f"Updated patient {patient_id} for LINE user {line_user_id}")
            return patient

        except Exception as e:
            logger.error(f"Failed to update patient {patient_id}: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update patient"
            )

