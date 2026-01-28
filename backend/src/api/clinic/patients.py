# pyright: reportMissingTypeStubs=false
"""
Patient Management API endpoints.
"""

import logging
import math
from datetime import date as date_type
from typing import Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi import status as http_status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import PatientPractitionerAssignment
from services import PatientService, AppointmentService, PatientPractitionerAssignmentService
from api.clinic.shared import (
    validate_patient_name,
    validate_patient_name_optional,
    validate_birthday,
    validate_phone_optional,
    validate_gender
)
from api.responses import (
    ClinicPatientResponse,
    ClinicPatientListResponse,
    PatientCreateResponse,
    AppointmentListResponse,
    AppointmentListItem
)

logger = logging.getLogger(__name__)

router = APIRouter()


class ClinicPatientCreateRequest(BaseModel):
    """Request model for creating patient by clinic users."""
    full_name: str
    phone_number: Optional[str] = None
    birthday: Optional[date_type] = None
    gender: Optional[str] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        return validate_patient_name(v)

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number if provided, allow None or empty string."""
        return validate_phone_optional(v)

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date_type, None]) -> Optional[date_type]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        return validate_birthday(v)

    @field_validator('gender', mode='before')
    @classmethod
    def validate_gender(cls, v: Union[str, None]) -> Optional[str]:
        """Validate gender value."""
        return validate_gender(v)


class DuplicateCheckResponse(BaseModel):
    """Response model for duplicate name check."""
    count: int
    """Number of patients with exact same name (case-insensitive)."""


class ClinicPatientUpdateRequest(BaseModel):
    """Request model for updating patient by clinic users."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    birthday: Optional[date_type] = None
    gender: Optional[str] = None
    notes: Optional[str] = None
    assigned_practitioner_ids: Optional[List[int]] = None

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        return validate_patient_name_optional(v)

    @field_validator('phone_number')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        """Validate phone number if provided, allow None or empty string."""
        return validate_phone_optional(v)

    @field_validator('birthday', mode='before')
    @classmethod
    def validate_birthday(cls, v: Union[str, date_type, None]) -> Optional[date_type]:
        """Validate birthday format (YYYY-MM-DD) and reasonable range."""
        return validate_birthday(v)

    @field_validator('gender', mode='before')
    @classmethod
    def validate_gender(cls, v: Union[str, None]) -> Optional[str]:
        """Validate gender value."""
        return validate_gender(v)

    @field_validator('notes')
    @classmethod
    def validate_notes(cls, v: Optional[str]) -> Optional[str]:
        """Validate notes field if provided."""
        if v is None:
            return None
        # Trim whitespace, allow empty strings
        v = v.strip() if v else ''
        # Limit length to prevent abuse (e.g., 5000 characters)
        if len(v) > 5000:
            raise ValueError('備注長度過長（最多5000字元）')
        return v

    @model_validator(mode='after')
    def validate_at_least_one_field(self):
        """Ensure at least one field is provided for update."""
        # Check what fields were actually set (exclude unset fields)
        provided_fields = self.model_dump(exclude_unset=True)
        
        # If notes is in the provided fields (even if empty string), allow the update
        if 'notes' in provided_fields:
            return self
        
        # If assigned_practitioner_ids is in the provided fields, allow the update
        if 'assigned_practitioner_ids' in provided_fields:
            return self
        
        # Otherwise, require at least one non-None field
        if self.full_name is None and self.phone_number is None and self.birthday is None and self.gender is None:
            raise ValueError('至少需提供一個欄位進行更新')
        return self


@router.get("/patients", summary="List all patients", response_model=ClinicPatientListResponse)
async def list_patients(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-indexed). Must be provided with page_size."),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Items per page. Must be provided with page."),
    search: Optional[str] = Query(None, max_length=200, description="Search query to filter patients by name, phone, or LINE user display name. Maximum length: 200 characters."),
    practitioner_id: Optional[int] = Query(None, description="Filter patients by assigned practitioner (user ID)")
) -> ClinicPatientListResponse:
    """
    Get all patients for the current user's clinic.

    Available to all clinic members (including read-only users).
    Supports pagination via page and page_size parameters.
    Supports search via search parameter to filter by patient name, phone number, or LINE user display name.
    Supports filtering by practitioner via practitioner_id parameter.
    If pagination parameters are not provided, returns all patients (backward compatible).
    Note: page and page_size must both be provided together or both omitted.
    """
    try:
        # Validate pagination parameters: both or neither
        if (page is not None) != (page_size is not None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="必須同時提供 page 和 page_size，或者兩者皆不提供"
            )
        
        # Get patients using service
        clinic_id = ensure_clinic_access(current_user)
        patients, total = PatientService.list_patients_for_clinic(
            db=db,
            clinic_id=clinic_id,
            page=page,
            page_size=page_size,
            search=search,
            practitioner_id=practitioner_id
        )

        # Validate page number doesn't exceed total pages
        if page is not None and page_size is not None and total > 0:
            max_page = math.ceil(total / page_size)
            if page > max_page:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Page {page} exceeds maximum page {max_page}"
                )

        # Get assigned practitioners for all patients in one query
        patient_ids = [patient.id for patient in patients]
        assignments = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id.in_(patient_ids),
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).all()
        
        # Build lookup map: patient_id -> list of practitioner_ids
        assignments_by_patient: Dict[int, List[int]] = {}
        for assignment in assignments:
            if assignment.patient_id not in assignments_by_patient:
                assignments_by_patient[assignment.patient_id] = []
            assignments_by_patient[assignment.patient_id].append(assignment.user_id)
        
        # Format for clinic response (includes line_user_id and display_name)
        patient_list = [
            ClinicPatientResponse(
                id=patient.id,
                full_name=patient.full_name,
                phone_number=patient.phone_number,
                birthday=patient.birthday,
                gender=patient.gender,
                notes=patient.notes,
                line_user_id=patient.line_user.line_user_id if patient.line_user else None,
                line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
                line_user_picture_url=patient.line_user.picture_url if patient.line_user else None,
                created_at=patient.created_at,
                is_deleted=patient.is_deleted,
                assigned_practitioner_ids=assignments_by_patient.get(patient.id, [])
            )
            for patient in patients
        ]

        # If pagination is used, return pagination info; otherwise use defaults
        if page is not None and page_size is not None:
            return ClinicPatientListResponse(
                patients=patient_list,
                total=total,
                page=page,
                page_size=page_size
            )
        else:
            # Backward compatibility: return all results with total count
            # Use total as page_size when total > 0, otherwise use a default
            return ClinicPatientListResponse(
                patients=patient_list,
                total=total,
                page=1,
                page_size=total if total > 0 else 50
            )

    except Exception as e:
        logger.exception(f"Error getting patients list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患列表"
        )


@router.post("/patients", summary="Create patient (clinic users)", response_model=PatientCreateResponse)
async def create_patient(
    request: ClinicPatientCreateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> PatientCreateResponse:
    """
    Create a new patient record for the clinic.
    
    Available to clinic admins and practitioners.
    Phone number and birthday are optional.
    Duplicate phone numbers are allowed.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Create patient with clinic_user as created_by_type
        # Note: For clinic-created patients, all fields except name are optional
        # (require_birthday and require_gender settings only apply to LIFF patient creation)
        patient = PatientService.create_patient(
            db=db,
            clinic_id=clinic_id,
            full_name=request.full_name,
            phone_number=request.phone_number,  # Can be None
            line_user_id=None,  # Clinic-created patients are not linked to LINE users
            birthday=request.birthday,
            gender=request.gender,
            created_by_type='clinic_user'
        )

        return PatientCreateResponse(
            patient_id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            gender=patient.gender,
            created_at=patient.created_at
        )

    except HTTPException:
        raise
    except ValueError as e:
        # Validation errors from validators
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception(f"Patient creation error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立病患失敗"
        )


@router.get("/patients/check-duplicate", summary="Check for duplicate patient names", response_model=DuplicateCheckResponse)
async def check_duplicate_patient_name(
    name: str = Query(..., description="Patient name to check (exact match, case-insensitive)"),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> DuplicateCheckResponse:
    """
    Check for existing patients with exact same name (case-insensitive).
    
    Used for duplicate detection in patient creation form.
    Returns count of patients with matching name (excluding soft-deleted).
    Available to all clinic users (including read-only).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Trim name
        trimmed_name = name.strip()
        if not trimmed_name or len(trimmed_name) < 2:
            # Return 0 for very short names (not meaningful to check)
            return DuplicateCheckResponse(count=0)
        
        count = PatientService.check_duplicate_by_name(
            db=db,
            clinic_id=clinic_id,
            full_name=trimmed_name
        )
        
        return DuplicateCheckResponse(count=count)
        
    except Exception as e:
        logger.exception(f"Error checking duplicate patient name: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="檢查重複病患名稱時發生錯誤"
        )


@router.get("/patients/{patient_id}", summary="Get patient details", response_model=ClinicPatientResponse)
async def get_patient(
    patient_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Get patient details by ID.

    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        patient = PatientService.get_patient_by_id(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        # Get assigned practitioners
        assigned_practitioner_ids = PatientPractitionerAssignmentService.get_assigned_practitioner_ids(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )

        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            gender=patient.gender,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted,
            assigned_practitioner_ids=assigned_practitioner_ids
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting patient {patient_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得病患資料"
        )


@router.put("/patients/{patient_id}", summary="Update patient information", response_model=ClinicPatientResponse)
async def update_patient(
    patient_id: int,
    request: ClinicPatientUpdateRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Update patient information.

    Available to clinic admins and practitioners only.
    Read-only users cannot update patients.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Note: require_practitioner_or_admin dependency already excludes read-only users
        patient = PatientService.update_patient_for_clinic(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id,
            full_name=request.full_name,
            phone_number=request.phone_number,
            birthday=request.birthday,
            gender=request.gender,
            notes=request.notes
        )
        
        # Update assigned practitioners if provided
        if request.assigned_practitioner_ids is not None:
            PatientPractitionerAssignmentService.update_assignments(
                db=db,
                patient_id=patient_id,
                clinic_id=clinic_id,
                practitioner_ids=request.assigned_practitioner_ids,
                created_by_user_id=current_user.user_id
            )
        
        # Get assigned practitioners
        assigned_practitioner_ids = PatientPractitionerAssignmentService.get_assigned_practitioner_ids(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )

        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            gender=patient.gender,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted,
            assigned_practitioner_ids=assigned_practitioner_ids
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating patient {patient_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新病患資料失敗"
        )


class AssignPractitionerRequest(BaseModel):
    """Request model for assigning practitioner to patient."""
    user_id: int = Field(..., description="Practitioner (user) ID to assign")


@router.post("/patients/{patient_id}/assign-practitioner", summary="Assign practitioner to patient", response_model=ClinicPatientResponse)
async def assign_practitioner(
    patient_id: int,
    request: AssignPractitionerRequest,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Assign a practitioner to a patient.
    
    Available to clinic admins and practitioners only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Assign practitioner
        PatientPractitionerAssignmentService.assign_practitioner(
            db=db,
            patient_id=patient_id,
            practitioner_id=request.user_id,
            clinic_id=clinic_id,
            created_by_user_id=current_user.user_id
        )
        
        # Get updated patient with assignments
        patient = PatientService.get_patient_by_id(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        assigned_practitioner_ids = PatientPractitionerAssignmentService.get_assigned_practitioner_ids(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            gender=patient.gender,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted,
            assigned_practitioner_ids=assigned_practitioner_ids
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error assigning practitioner to patient {patient_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="指派負責人員失敗"
        )


@router.delete("/patients/{patient_id}/assign-practitioner/{practitioner_id}", summary="Remove practitioner assignment from patient", response_model=ClinicPatientResponse)
async def remove_practitioner_assignment(
    patient_id: int,
    practitioner_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ClinicPatientResponse:
    """
    Remove a practitioner assignment from a patient.
    
    Available to clinic admins and practitioners only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Remove assignment
        PatientPractitionerAssignmentService.remove_assignment(
            db=db,
            patient_id=patient_id,
            practitioner_id=practitioner_id,
            clinic_id=clinic_id
        )
        
        # Get updated patient with assignments
        patient = PatientService.get_patient_by_id(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        assigned_practitioner_ids = PatientPractitionerAssignmentService.get_assigned_practitioner_ids(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id
        )
        
        return ClinicPatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            birthday=patient.birthday,
            gender=patient.gender,
            notes=patient.notes,
            line_user_id=patient.line_user.line_user_id if patient.line_user else None,
            line_user_display_name=patient.line_user.effective_display_name if patient.line_user else None,
            created_at=patient.created_at,
            is_deleted=patient.is_deleted,
            assigned_practitioner_ids=assigned_practitioner_ids
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error removing practitioner assignment from patient {patient_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="移除負責人員失敗"
        )


@router.get("/patients/{patient_id}/appointments", summary="Get patient appointments", response_model=AppointmentListResponse)
async def get_patient_appointments(
    patient_id: int,
    status: Optional[str] = Query(None, description="Filter by status: confirmed, canceled_by_patient, canceled_by_clinic"),
    upcoming_only: bool = Query(False, description="Filter for upcoming appointments only"),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> AppointmentListResponse:
    """
    Get appointments for a specific patient.

    Available to all clinic members (including read-only users).
    """
    try:
        clinic_id = ensure_clinic_access(current_user)

        # Validate status if provided
        if status and status not in ['confirmed', 'canceled_by_patient', 'canceled_by_clinic']:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,  # Use http_status to avoid shadowing parameter
                detail="無效的狀態值"
            )

        # Hide practitioner_id for auto-assigned appointments if user is not admin
        # This prevents non-admin practitioners from seeing who was auto-assigned
        is_admin = current_user.has_role('admin')
        hide_auto_assigned_practitioner_id = not is_admin

        appointments_data = AppointmentService.list_appointments_for_patient(
            db=db,
            patient_id=patient_id,
            clinic_id=clinic_id,
            status=status,
            upcoming_only=upcoming_only,
            hide_auto_assigned_practitioner_id=hide_auto_assigned_practitioner_id
        )

        # Convert dicts to response objects
        appointments = [
            AppointmentListItem(**appointment)
            for appointment in appointments_data
        ]

        return AppointmentListResponse(appointments=appointments)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting appointments for patient {patient_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,  # Use http_status to avoid shadowing parameter
            detail="無法取得預約記錄"
        )

