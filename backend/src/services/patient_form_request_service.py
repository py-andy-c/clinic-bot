from sqlalchemy.orm import Session
import secrets
from typing import List, Optional, Dict, Any  # type: ignore
from datetime import datetime, timezone
from fastapi import HTTPException

from models.patient_form_request import PatientFormRequest
from models.medical_record_template import MedicalRecordTemplate
from models.patient import Patient

class PatientFormRequestService:
    @staticmethod
    def create_request(
        db: Session,
        clinic_id: int,
        patient_id: int,
        template_id: int,
        request_source: str,  # 'auto', 'manual'
        appointment_id: Optional[int] = None,
        patient_form_setting_id: Optional[int] = None,
        notify_admin: bool = False,
        notify_appointment_practitioner: bool = False,
        notify_assigned_practitioner: bool = False
    ) -> PatientFormRequest:
        # For 'auto' requests, check if a pending request already exists to ensure idempotency
        if request_source == 'auto' and appointment_id and patient_form_setting_id:
            existing = db.query(PatientFormRequest).filter(
                PatientFormRequest.appointment_id == appointment_id,
                PatientFormRequest.patient_form_setting_id == patient_form_setting_id,
                PatientFormRequest.status == 'pending'
            ).first()
            if existing:
                return existing

        # Verify patient belongs to clinic
        patient = db.query(Patient).filter(Patient.id == patient_id, Patient.clinic_id == clinic_id).first()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        # Verify template exists and belongs to clinic
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id,
            MedicalRecordTemplate.template_type == 'patient_form',
            MedicalRecordTemplate.is_deleted == False
        ).first()
        if not template:
            raise HTTPException(status_code=404, detail="Patient form template not found")

        # Generate secure access token
        access_token = secrets.token_urlsafe(48)

        request = PatientFormRequest(
            clinic_id=clinic_id,
            patient_id=patient_id,
            template_id=template_id,
            appointment_id=appointment_id,
            request_source=request_source,
            patient_form_setting_id=patient_form_setting_id,
            notify_admin=notify_admin,
            notify_appointment_practitioner=notify_appointment_practitioner,
            notify_assigned_practitioner=notify_assigned_practitioner,
            access_token=access_token,
            status='pending'
        )
        db.add(request)
        db.flush()
        db.refresh(request)
        return request

    @staticmethod
    def get_request(db: Session, request_id: int, clinic_id: int) -> Optional[PatientFormRequest]:
        return db.query(PatientFormRequest).filter(
            PatientFormRequest.id == request_id,
            PatientFormRequest.clinic_id == clinic_id
        ).first()

    @staticmethod
    def get_request_by_token(db: Session, access_token: str) -> Optional[PatientFormRequest]:
        return db.query(PatientFormRequest).filter(
            PatientFormRequest.access_token == access_token
        ).first()

    @staticmethod
    def list_patient_requests(
        db: Session,
        clinic_id: int,
        patient_id: int,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[PatientFormRequest]:
        query = db.query(PatientFormRequest).filter(
            PatientFormRequest.clinic_id == clinic_id,
            PatientFormRequest.patient_id == patient_id
        )
        if status:
            query = query.filter(PatientFormRequest.status == status)
        
        return query.order_by(PatientFormRequest.created_at.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def count_patient_requests(
        db: Session,
        clinic_id: int,
        patient_id: int,
        status: Optional[str] = None
    ) -> int:
        query = db.query(PatientFormRequest).filter(
            PatientFormRequest.clinic_id == clinic_id,
            PatientFormRequest.patient_id == patient_id
        )
        if status:
            query = query.filter(PatientFormRequest.status == status)
        
        return query.count()

    @staticmethod
    def update_request_status(
        db: Session,
        request_id: int,
        clinic_id: int,
        status: str,
        medical_record_id: Optional[int] = None
    ) -> PatientFormRequest:
        request = PatientFormRequestService.get_request(db, request_id, clinic_id)
        if not request:
            raise HTTPException(status_code=404, detail="Request not found")

        request.status = status
        if status == 'submitted':
            request.submitted_at = datetime.now(timezone.utc)
            if medical_record_id:
                request.medical_record_id = medical_record_id

        request.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(request)
        return request
