from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.medical_record_template import MedicalRecordTemplate

class MedicalRecordTemplateService:
    @staticmethod
    def create_template(
        db: Session,
        clinic_id: int,
        name: str,
        fields: List[Dict[str, Any]],
        description: Optional[str] = None,
        created_by_user_id: Optional[int] = None
    ) -> MedicalRecordTemplate:
        template = MedicalRecordTemplate(
            clinic_id=clinic_id,
            name=name,
            fields=fields,
            description=description,
            created_by_user_id=created_by_user_id,
            updated_by_user_id=created_by_user_id,
            version=1
        )
        db.add(template)
        db.commit()
        db.refresh(template)
        return template

    @staticmethod
    def get_template(
        db: Session,
        template_id: int,
        clinic_id: int
    ) -> Optional[MedicalRecordTemplate]:
        return db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id,
            MedicalRecordTemplate.is_deleted == False
        ).first()

    @staticmethod
    def list_templates(
        db: Session,
        clinic_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[MedicalRecordTemplate]:
        return db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.clinic_id == clinic_id,
            MedicalRecordTemplate.is_deleted == False
        ).offset(skip).limit(limit).all()

    @staticmethod
    def update_template(
        db: Session,
        template_id: int,
        clinic_id: int,
        version: int,
        name: Optional[str] = None,
        fields: Optional[List[Dict[str, Any]]] = None,
        description: Optional[str] = None,
        updated_by_user_id: Optional[int] = None
    ) -> MedicalRecordTemplate:
        template = MedicalRecordTemplateService.get_template(db, template_id, clinic_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        
        if template.version != version:
            raise HTTPException(status_code=409, detail="Template has been modified by another user")

        if name is not None:
            template.name = name
        if fields is not None:
            template.fields = fields
        if description is not None:
            template.description = description
            
        template.version += 1
        template.updated_by_user_id = updated_by_user_id
        template.updated_at = datetime.now(timezone.utc)
        
        db.commit()
        db.refresh(template)
        return template

    @staticmethod
    def delete_template(
        db: Session,
        template_id: int,
        clinic_id: int,
        deleted_by_user_id: Optional[int] = None
    ) -> bool:
        template = MedicalRecordTemplateService.get_template(db, template_id, clinic_id)
        if not template:
            return False
            
        template.is_deleted = True
        template.deleted_at = datetime.now(timezone.utc)
        template.updated_by_user_id = deleted_by_user_id
        
        db.commit()
        return True
