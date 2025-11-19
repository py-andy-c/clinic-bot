"""
Settings service for centralized clinic and practitioner settings management.

This service consolidates settings validation and access logic that was
previously scattered across multiple endpoints.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from models import Clinic
from models.clinic import ClinicSettings
from models.user_clinic_association import PractitionerSettings

logger = logging.getLogger(__name__)


class SettingsService:
    """
    Service class for settings operations.
    
    Provides centralized access to clinic and practitioner settings with
    validation and caching support.
    """
    
    @staticmethod
    def get_clinic_settings(db: Session, clinic_id: int) -> ClinicSettings:
        """
        Get validated clinic settings.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            
        Returns:
            ClinicSettings object with validated settings
            
        Raises:
            HTTPException: If clinic not found
        """
        from fastapi import HTTPException, status
        
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )
        
        return clinic.get_validated_settings()
    
    @staticmethod
    def get_practitioner_settings(
        db: Session,
        user_id: int,
        clinic_id: int
    ) -> Optional[PractitionerSettings]:
        """
        Get validated practitioner settings.
        
        Args:
            db: Database session
            user_id: User ID
            clinic_id: Clinic ID
            
        Returns:
            PractitionerSettings object if association exists, None otherwise
        """
        from models import UserClinicAssociation
        
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()
        
        if not association:
            return None
        
        return association.get_validated_settings()

