"""
Patient service for shared patient business logic.

This module contains all patient-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Patient

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
        phone_number: Optional[str] = None,
        line_user_id: Optional[int] = None
    ) -> Patient:
        """
        Create a new patient record.

        Args:
            db: Database session
            clinic_id: Clinic ID the patient belongs to
            full_name: Patient's full name
            phone_number: Optional phone number
            line_user_id: Optional LINE user ID for association

        Returns:
            Created Patient object

        Raises:
            HTTPException: If creation fails
        """
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
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create patient"
            )

    @staticmethod
    def list_patients_for_line_user(
        db: Session,
        line_user_id: int,
        clinic_id: int
    ) -> List[Patient]:
        """
        List all patients associated with a LINE user for a specific clinic.

        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID

        Returns:
            List of Patient objects, sorted by creation time
        """
        patients = db.query(Patient).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).order_by(Patient.created_at).all()

        return patients

    @staticmethod
    def list_patients_for_clinic(db: Session, clinic_id: int) -> List[Patient]:
        """
        List all patients for a clinic (admin view).

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of all Patient objects for the clinic
        """
        patients = db.query(Patient).filter(
            Patient.clinic_id == clinic_id
        ).all()

        return patients

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

        # Check for future appointments
        future_appointments = db.query(Patient).join(
            Patient.appointments
        ).join(
            Patient.appointments[0].calendar_event
        ).filter(
            Patient.id == patient_id,
            Patient.appointments[0].calendar_event.start_time > datetime.now()
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

        # Soft delete by unlinking from LINE user (preserves appointment history)
        patient.line_user_id = None
        db.commit()

        logger.info(f"Soft deleted patient {patient_id} for LINE user {line_user_id}")

    @staticmethod
    def get_primary_patient_for_line_user(
        db: Session,
        line_user_id: int,
        clinic_id: int
    ) -> Optional[Patient]:
        """
        Get the primary patient for a LINE user at a clinic.

        The primary patient is the first one created for this LINE user at this clinic.

        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID

        Returns:
            Primary Patient object or None if no patients exist
        """
        patient = db.query(Patient).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).order_by(Patient.created_at).first()

        return patient
