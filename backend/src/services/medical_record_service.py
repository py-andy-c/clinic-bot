from typing import List, Dict, Any, Optional, cast
from copy import deepcopy
from sqlalchemy.orm import Session
from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from models.medical_record_media import MedicalRecordMedia
from utils.datetime_utils import taiwan_now
import logging

logger = logging.getLogger(__name__)

class MedicalRecordService:
    @staticmethod
    def list_records_for_patient(db: Session, patient_id: int, clinic_id: int) -> List[MedicalRecord]:
        """
        List all medical records for a specific patient in a clinic.
        Ordered by created_at descending.
        """
        return db.query(MedicalRecord).filter(
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.clinic_id == clinic_id
        ).order_by(MedicalRecord.created_at.desc()).all()

    @staticmethod
    def create_record(
        db: Session, 
        patient_id: int, 
        clinic_id: int, 
        template_id: int
    ) -> MedicalRecord:
        """
        Create a new medical record based on a template.
        Performs snapshotting of the template's header_fields AND base_layers.
        """
        # Fetch the template
        template = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id
        ).first()

        if not template:
            raise ValueError("Template not found or does not belong to clinic")

        # Snapshot the header fields (deep copy to prevent shared state)
        header_structure = deepcopy(template.header_fields)

        # Snapshot the base_layers and backgroundImageUrl from workspace_config
        # These are the admin-configured background diagrams that should be preserved
        workspace_config = template.workspace_config or {}
        base_layers_raw = workspace_config.get('base_layers', [])
        base_layers: List[Dict[str, Any]] = cast(List[Dict[str, Any]], base_layers_raw if base_layers_raw else [])
        background_image_url = workspace_config.get('backgroundImageUrl')

        # Create the record with snapshotted base_layers (deep copy for nested structures)
        new_record = MedicalRecord(
            patient_id=patient_id,
            clinic_id=clinic_id,
            template_id=template_id,
            header_structure=header_structure,
            header_values={},
            workspace_data={
                "version": 1,
                "layers": deepcopy(base_layers) if base_layers else [],  # Deep copy for safety
                "canvas_height": 1000,  # Default height
                "background_image_url": background_image_url
            }
        )

        db.add(new_record)
        db.commit()
        db.refresh(new_record)
        return new_record

    @staticmethod
    def get_record_by_id(db: Session, record_id: int, clinic_id: int) -> Optional[MedicalRecord]:
        """Get a medical record by ID, ensuring it belongs to the clinic."""
        return db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()

    @staticmethod
    def update_record(
        db: Session, 
        record_id: int, 
        clinic_id: int, 
        update_data: Dict[str, Any]
    ) -> Optional[MedicalRecord]:
        """
        Update a medical record (autosave).
        Updates updated_at timestamp.
        """
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()

        if not record:
            return None

        # Update fields if provided
        if "header_values" in update_data:
            record.header_values = update_data["header_values"]
        if "workspace_data" in update_data:
            record.workspace_data = update_data["workspace_data"]

        record.updated_at = taiwan_now()
        
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def delete_record(db: Session, record_id: int, clinic_id: int) -> bool:
        """Delete a medical record."""
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()

        if not record:
            return False

        db.delete(record)
        db.commit()
        return True

    @staticmethod
    def add_media(
        db: Session,
        record_id: int,
        clinic_id: int,
        url: str,
        file_type: str,
        original_filename: Optional[str] = None
    ) -> MedicalRecordMedia:
        """Add a media reference to a medical record."""
        # Verify record exists and belongs to clinic
        record = db.query(MedicalRecord).filter(
            MedicalRecord.id == record_id,
            MedicalRecord.clinic_id == clinic_id
        ).first()
        
        if not record:
            raise ValueError("找不到病歷記錄")
            
        media = MedicalRecordMedia(
            record_id=record_id,
            s3_key=url,  # We use s3_key to store the URL/path
            file_type=file_type,
            original_filename=original_filename
        )
        db.add(media)
        db.commit()
        db.refresh(media)
        return media
