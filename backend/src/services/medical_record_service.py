"""
Service for managing medical records.
"""

from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from models import MedicalRecord, MedicalRecordTemplate
from .medical_record_template_service import MedicalRecordTemplateService

class MedicalRecordService:
    @staticmethod
    def create_record(
        db: Session,
        patient_id: int,
        clinic_id: int,
        template_id: int
    ) -> MedicalRecord:
        """
        Create a new medical record.
        Snapshots the template's header structure at the time of creation.
        """
        template = MedicalRecordTemplateService.get_template(db, template_id, clinic_id)
        
        record = MedicalRecord(
            patient_id=patient_id,
            clinic_id=clinic_id,
            template_id=template_id,
            header_structure=template.header_fields, # Snapshot
            header_values={},
            workspace_data={}
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def get_record(db: Session, record_id: int, clinic_id: int) -> MedicalRecord:
        """Get a specific record, ensuring it belongs to the clinic."""
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medical record not found")
        return record

    @staticmethod
    def list_records_for_patient(db: Session, patient_id: int, clinic_id: int) -> List[MedicalRecord]:
        """List all records for a patient in a clinic."""
        return db.query(MedicalRecord).filter(
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.clinic_id == clinic_id
        ).order_by(MedicalRecord.created_at.desc()).all()

    @staticmethod
    def update_record(
        db: Session,
        record_id: int,
        clinic_id: int,
        header_values: Optional[Dict[str, Any]] = None,
        workspace_data: Optional[Dict[str, Any]] = None
    ) -> MedicalRecord:
        """
        Update a medical record.
        Frontend is expected to send the full latest state for the fields being updated.
        """
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        
        if header_values is not None:
            record.header_values = header_values
        if workspace_data is not None:
            record.workspace_data = workspace_data
            
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def delete_record(db: Session, record_id: int, clinic_id: int) -> bool:
        """Delete a medical record."""
        record = MedicalRecordService.get_record(db, record_id, clinic_id)
        db.delete(record)
        db.commit()
        return True
