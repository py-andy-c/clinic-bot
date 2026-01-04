"""
Patient-Practitioner Assignment service.

This module contains business logic for managing patient-practitioner assignments.
"""

import logging
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import PatientPractitionerAssignment, Patient, User
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


class PatientPractitionerAssignmentService:
    """
    Service class for patient-practitioner assignment operations.
    """
    
    @staticmethod
    def get_assignments_for_patient(
        db: Session,
        patient_id: int,
        clinic_id: int
    ) -> List[PatientPractitionerAssignment]:
        """
        Get all practitioner assignments for a patient.
        
        Args:
            db: Database session
            patient_id: Patient ID
            clinic_id: Clinic ID
            
        Returns:
            List of PatientPractitionerAssignment objects
        """
        return db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).all()
    
    @staticmethod
    def get_assigned_practitioner_ids(
        db: Session,
        patient_id: int,
        clinic_id: int
    ) -> List[int]:
        """
        Get list of assigned practitioner IDs for a patient.
        
        Args:
            db: Database session
            patient_id: Patient ID
            clinic_id: Clinic ID
            
        Returns:
            List of practitioner (user) IDs
        """
        assignments = PatientPractitionerAssignmentService.get_assignments_for_patient(
            db, patient_id, clinic_id
        )
        return [assignment.user_id for assignment in assignments]
    
    @staticmethod
    def get_assignments_for_practitioner(
        db: Session,
        practitioner_id: int,
        clinic_id: int
    ) -> List[PatientPractitionerAssignment]:
        """
        Get all patient assignments for a practitioner.
        
        Args:
            db: Database session
            practitioner_id: Practitioner (user) ID
            clinic_id: Clinic ID
            
        Returns:
            List of PatientPractitionerAssignment objects
        """
        return db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.user_id == practitioner_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).all()
    
    @staticmethod
    def assign_practitioner(
        db: Session,
        patient_id: int,
        practitioner_id: int,
        clinic_id: int,
        created_by_user_id: Optional[int] = None
    ) -> PatientPractitionerAssignment:
        """
        Assign a practitioner to a patient.
        
        Args:
            db: Database session
            patient_id: Patient ID
            practitioner_id: Practitioner (user) ID
            clinic_id: Clinic ID
            created_by_user_id: Optional user ID who created this assignment
            
        Returns:
            Created PatientPractitionerAssignment object
            
        Raises:
            HTTPException: If patient, practitioner, or clinic not found, or assignment already exists
        """
        # Validate patient exists and belongs to clinic
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == clinic_id
        ).first()
        
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="病患不存在"
            )
        
        # Validate practitioner exists and belongs to clinic
        from utils.practitioner_helpers import validate_practitioner_for_clinic
        try:
            validate_practitioner_for_clinic(
                db=db,
                practitioner_id=practitioner_id,
                clinic_id=clinic_id
            )
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="治療師不存在或未屬於此診所"
            )
        
        # Check if assignment already exists
        existing = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.user_id == practitioner_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此治療師已經是負責人員"
            )
        
        # Create assignment
        assignment = PatientPractitionerAssignment(
            patient_id=patient_id,
            user_id=practitioner_id,
            clinic_id=clinic_id,
            created_by_user_id=created_by_user_id,
            created_at=taiwan_now()
        )
        
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
        
        logger.info(f"Assigned practitioner {practitioner_id} to patient {patient_id} in clinic {clinic_id}")
        return assignment
    
    @staticmethod
    def remove_assignment(
        db: Session,
        patient_id: int,
        practitioner_id: int,
        clinic_id: int
    ) -> None:
        """
        Remove a practitioner assignment from a patient.
        
        Args:
            db: Database session
            patient_id: Patient ID
            practitioner_id: Practitioner (user) ID
            clinic_id: Clinic ID
            
        Raises:
            HTTPException: If assignment not found
        """
        assignment = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.user_id == practitioner_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).first()
        
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="負責人員關係不存在"
            )
        
        db.delete(assignment)
        db.commit()
        
        logger.info(f"Removed assignment of practitioner {practitioner_id} from patient {patient_id} in clinic {clinic_id}")
    
    @staticmethod
    def update_assignments(
        db: Session,
        patient_id: int,
        clinic_id: int,
        practitioner_ids: List[int],
        created_by_user_id: Optional[int] = None
    ) -> List[PatientPractitionerAssignment]:
        """
        Update all practitioner assignments for a patient.
        
        This replaces all existing assignments with the new list.
        
        Args:
            db: Database session
            patient_id: Patient ID
            clinic_id: Clinic ID
            practitioner_ids: List of practitioner (user) IDs to assign
            created_by_user_id: Optional user ID who created these assignments
            
        Returns:
            List of PatientPractitionerAssignment objects
            
        Raises:
            HTTPException: If patient not found or any practitioner not found
        """
        # Validate patient exists
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == clinic_id
        ).first()
        
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="病患不存在"
            )
        
        # Validate all practitioners exist and belong to clinic
        if practitioner_ids:
            from models import UserClinicAssociation
            from utils.query_helpers import filter_by_role
            
            # Query practitioners with clinic association validation
            query = db.query(User).join(UserClinicAssociation).filter(
                User.id.in_(practitioner_ids),
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            )
            query = filter_by_role(query, 'practitioner')
            practitioners = query.all()
            
            if len(practitioners) != len(practitioner_ids):
                found_ids = {p.id for p in practitioners}
                missing_ids = set(practitioner_ids) - found_ids
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"治療師不存在或未屬於此診所: {', '.join(map(str, missing_ids))}"
                )
        
        # Get existing assignments
        existing_assignments = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).all()
        
        existing_practitioner_ids = {assignment.user_id for assignment in existing_assignments}
        new_practitioner_ids = set(practitioner_ids)
        
        # Calculate differences
        to_add = new_practitioner_ids - existing_practitioner_ids
        to_remove = existing_practitioner_ids - new_practitioner_ids
        
        # Remove assignments that are no longer needed
        assignments_to_remove = [
            assignment for assignment in existing_assignments
            if assignment.user_id in to_remove
        ]
        for assignment in assignments_to_remove:
            db.delete(assignment)
        
        # Create new assignments only for practitioners not already assigned
        new_assignments: List[PatientPractitionerAssignment] = []
        for practitioner_id in to_add:
            assignment = PatientPractitionerAssignment(
                patient_id=patient_id,
                user_id=practitioner_id,
                clinic_id=clinic_id,
                created_by_user_id=created_by_user_id,
                created_at=taiwan_now()
            )
            db.add(assignment)
            new_assignments.append(assignment)
        
        db.commit()
        
        # Refresh all new assignments
        for assignment in new_assignments:
            db.refresh(assignment)
        
        logger.info(
            f"Updated assignments for patient {patient_id} in clinic {clinic_id}: "
            f"added {len(new_assignments)}, removed {len(assignments_to_remove)}"
        )
        return new_assignments
    
    @staticmethod
    def is_practitioner_assigned(
        db: Session,
        patient_id: int,
        practitioner_id: int,
        clinic_id: int
    ) -> bool:
        """
        Check if a practitioner is assigned to a patient.
        
        Args:
            db: Database session
            patient_id: Patient ID
            practitioner_id: Practitioner (user) ID
            clinic_id: Clinic ID
            
        Returns:
            True if assigned, False otherwise
        """
        assignment = db.query(PatientPractitionerAssignment).filter(
            PatientPractitionerAssignment.patient_id == patient_id,
            PatientPractitionerAssignment.user_id == practitioner_id,
            PatientPractitionerAssignment.clinic_id == clinic_id
        ).first()
        
        return assignment is not None

