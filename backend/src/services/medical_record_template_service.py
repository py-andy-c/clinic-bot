from typing import List, Optional, Any, Dict
from sqlalchemy.orm import Session
from models import MedicalRecordTemplate
from fastapi import HTTPException

class MedicalRecordTemplateService:
    @staticmethod
    def list_templates(db: Session, clinic_id: int, include_inactive: bool = False) -> List[MedicalRecordTemplate]:
        query = db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.clinic_id == clinic_id
        )
        if not include_inactive:
            query = query.filter(MedicalRecordTemplate.is_active == True)
        return query.order_by(MedicalRecordTemplate.created_at.desc()).all()

    @staticmethod
    def get_template_by_id(db: Session, template_id: int, clinic_id: int) -> Optional[MedicalRecordTemplate]:
        return db.query(MedicalRecordTemplate).filter(
            MedicalRecordTemplate.id == template_id,
            MedicalRecordTemplate.clinic_id == clinic_id
        ).first()

    @staticmethod
    def create_template(
        db: Session, 
        clinic_id: int, 
        name: str, 
        header_fields: List[Dict[str, Any]], 
        workspace_config: Dict[str, Any],
        is_active: bool = True
    ) -> MedicalRecordTemplate:
        new_template = MedicalRecordTemplate(
            clinic_id=clinic_id,
            name=name,
            header_fields=header_fields,
            workspace_config=workspace_config,
            is_active=is_active
        )
        db.add(new_template)
        db.commit()
        db.refresh(new_template)
        return new_template

    @staticmethod
    def update_template(
        db: Session, 
        template_id: int, 
        clinic_id: int, 
        update_data: Dict[str, Any]
    ) -> MedicalRecordTemplate:
        template = MedicalRecordTemplateService.get_template_by_id(db, template_id, clinic_id)
        if not template:
            raise HTTPException(status_code=404, detail="找不到範本")

        for key, value in update_data.items():
            setattr(template, key, value)

        db.commit()
        db.refresh(template)
        return template

    @staticmethod
    def soft_delete_template(db: Session, template_id: int, clinic_id: int) -> MedicalRecordTemplate:
        template = MedicalRecordTemplateService.get_template_by_id(db, template_id, clinic_id)
        if not template:
            raise HTTPException(status_code=404, detail="找不到範本")
        
        template.is_active = False
        db.commit()
        db.refresh(template)
        return template
