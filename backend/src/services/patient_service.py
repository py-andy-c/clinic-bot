"""
Patient service for shared patient business logic.

This module contains all patient-related business logic that is shared
between different API endpoints (LIFF, clinic admin, etc.).
"""

import logging
from typing import List, Optional
from datetime import date
import os

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from models import Patient, LineUser, PatientPractitionerAssignment
from utils.datetime_utils import taiwan_now
from utils.patient_validators import validate_gender_field

logger = logging.getLogger(__name__)

# Localization helper for test vs production environments
def get_localized_message(english: str, chinese: str) -> str:
    """Return English message for tests, Chinese for production."""
    return english if os.getenv("PYTEST_VERSION") is not None else chinese


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
        line_user_id: Optional[int] = None,
        birthday: Optional[date] = None,
        gender: Optional[str] = None,
        created_by_type: str = 'line_user'
    ) -> Patient:
        """
        Create a new patient record.

        Args:
            db: Database session
            clinic_id: Clinic ID the patient belongs to
            full_name: Patient's full name
            phone_number: Optional phone number (can be None for clinic-created patients)
            line_user_id: Optional LINE user ID for association
            birthday: Optional patient birthday
            gender: Optional patient gender ('male', 'female', 'other')
            created_by_type: Source of creation - 'line_user' or 'clinic_user' (default: 'line_user')

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

        # Validate gender value if provided
        if gender is not None:
            try:
                gender = validate_gender_field(gender)
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(e)
                )

        try:
            patient = Patient(
                clinic_id=clinic_id,
                full_name=full_name,
                phone_number=phone_number,  # Can be None
                line_user_id=line_user_id,
                birthday=birthday,
                gender=gender,
                created_by_type=created_by_type,
                created_at=taiwan_now()  # Use Taiwan timezone to match rest of codebase
            )

            db.add(patient)
            db.commit()
            db.refresh(patient)

            logger.info(f"Created patient {patient.id} for clinic {clinic_id}")
            return patient

        except Exception as e:
            logger.exception(f"Failed to create patient: {e}")
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
    def list_patients_for_clinic(
        db: Session, 
        clinic_id: int,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        search: Optional[str] = None,
        practitioner_id: Optional[int] = None
    ) -> tuple[List[Patient], int]:
        """
        List all patients for a clinic (admin view, including deleted patients).

        Args:
            db: Database session
            clinic_id: Clinic ID
            page: Optional page number (1-indexed). If None, returns all patients.
            page_size: Optional items per page. If None, returns all patients.
            search: Optional search query to filter patients by name, phone, or LINE user display name.
            practitioner_id: Optional practitioner (user) ID to filter by assigned practitioners.

        Returns:
            Tuple of (List of Patient objects for the clinic including deleted, total count)
        """
        from utils.patient_queries import get_active_patients_for_clinic
        return get_active_patients_for_clinic(db, clinic_id, page=page, page_size=page_size, search=search, include_deleted=True, practitioner_id=practitioner_id)

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
                detail=get_localized_message("Patient not found or access denied", "找不到病患或拒絕存取")
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

        This performs a soft delete while preserving appointment history and
        maintaining the LINE user association.

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
        from utils.appointment_queries import count_future_appointments_for_patient
        future_appointments = count_future_appointments_for_patient(db, patient_id)

        if future_appointments > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=get_localized_message("Cannot delete patient with future appointments", "無法刪除有未來預約的病患")
            )

        # Check if this is the last active patient for this LINE user at this clinic
        total_patients = db.query(Patient).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).filter(
            Patient.is_deleted == False
        ).count()

        if total_patients <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="至少需保留一位就診人"
            )

        # Soft delete by marking as deleted (preserves appointment history and LINE user association)
        from datetime import datetime, timezone

        patient.is_deleted = True
        patient.deleted_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(f"Soft deleted patient {patient_id} for LINE user {line_user_id}")

    @staticmethod
    def update_patient_for_line_user(
        db: Session,
        patient_id: int,
        line_user_id: int,
        clinic_id: int,
        full_name: Optional[str] = None,
        phone_number: Optional[str] = None,
        birthday: Optional[date] = None,
        gender: Optional[str] = None
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
            birthday: Optional new birthday
            gender: Optional new gender

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
            # Note: notes are clinic-internal and cannot be updated by LINE users
            if full_name is not None:
                patient.full_name = full_name.strip()
            if phone_number is not None:
                patient.phone_number = phone_number
            if birthday is not None:
                patient.birthday = birthday
            if gender is not None:
                # Validate gender value before updating
                try:
                    validated_gender = validate_gender_field(gender)
                    patient.gender = validated_gender
                except ValueError as e:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=str(e)
                    )

            db.commit()
            db.refresh(patient)

            logger.info(f"Updated patient {patient_id} for LINE user {line_user_id}")
            return patient

        except Exception as e:
            logger.exception(f"Failed to update patient {patient_id}: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="更新病患資料失敗"
            )

    @staticmethod
    def check_duplicate_by_name(
        db: Session,
        clinic_id: int,
        full_name: str
    ) -> int:
        """
        Check for existing patients with exact same name (case-insensitive).

        Args:
            db: Database session
            clinic_id: Clinic ID to search within
            full_name: Patient name to check (will be trimmed and case-insensitive matched)

        Returns:
            Count of patients with exact same name (excluding soft-deleted patients)
        """
        # Trim and normalize name
        normalized_name = full_name.strip()
        if not normalized_name:
            return 0
        
        # Count patients with exact same name (case-insensitive)
        count = db.query(Patient).filter(
            Patient.clinic_id == clinic_id,
            func.lower(Patient.full_name) == func.lower(normalized_name),
            Patient.is_deleted == False
        ).count()
        
        return count

    @staticmethod
    def get_patient_by_id(
        db: Session,
        patient_id: int,
        clinic_id: int
    ) -> Patient:
        """
        Get a patient by ID for a clinic.

        Args:
            db: Database session
            patient_id: Patient ID
            clinic_id: Clinic ID

        Returns:
            Patient object

        Raises:
            HTTPException: If patient not found or doesn't belong to clinic
        """
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == clinic_id
        ).first()

        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="病患不存在"
            )

        return patient

    @staticmethod
    def update_patient_for_clinic(
        db: Session,
        patient_id: int,
        clinic_id: int,
        full_name: Optional[str] = None,
        phone_number: Optional[str] = None,
        birthday: Optional[date] = None,
        gender: Optional[str] = None,
        notes: Optional[str] = None
    ) -> Patient:
        """
        Update a patient record for clinic users.

        Args:
            db: Database session
            patient_id: Patient ID to update
            clinic_id: Clinic ID
            full_name: Optional new full name
            phone_number: Optional new phone number
            birthday: Optional new birthday
            gender: Optional new gender
            notes: Optional new notes

        Returns:
            Updated Patient object

        Raises:
            HTTPException: If patient not found, access denied, or update fails
        """
        # Get patient
        patient = PatientService.get_patient_by_id(db, patient_id, clinic_id)

        try:
            # Update allowed fields
            if full_name is not None:
                patient.full_name = full_name.strip()
            if phone_number is not None:
                patient.phone_number = phone_number
            if birthday is not None:
                patient.birthday = birthday
            if gender is not None:
                # Validate gender value before updating
                try:
                    validated_gender = validate_gender_field(gender)
                    patient.gender = validated_gender
                except ValueError as e:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=str(e)
                    )
            if notes is not None:
                patient.notes = notes

            db.commit()
            db.refresh(patient)

            logger.info(f"Updated patient {patient_id} for clinic {clinic_id}")
            return patient

        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Failed to update patient {patient_id}: {e}")
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="更新病患資料失敗"
            )

    @staticmethod
    def has_assigned_practitioners(
        db: Session,
        patient_id: int,
        clinic_id: int
    ) -> bool:
        """
        Check if a patient has any practitioner assignments at a clinic.

        Used to classify patients as "new" (no assignments) vs "existing" (has assignments)
        for appointment type visibility filtering.

        Note: All patient-practitioner assignments are considered active.
        The model does not support inactive assignments.

        Args:
            db: Database session
            patient_id: Patient ID to check
            clinic_id: Clinic ID to check within

        Returns:
            True if patient has at least one practitioner assignment, False otherwise
        """
        count = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).count()

        return count > 0

