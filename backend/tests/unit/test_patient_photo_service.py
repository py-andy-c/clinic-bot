"""
Unit tests for PatientPhotoService with focus on pagination and ordering.
"""
import pytest
from typing import Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from models.clinic import Clinic
from models.patient import Patient
from models.patient_photo import PatientPhoto
from models.medical_record import MedicalRecord
from models.medical_record_template import MedicalRecordTemplate
from services.patient_photo_service import PatientPhotoService


@pytest.fixture
def clinic(db_session: Session) -> Clinic:
    """Create a test clinic."""
    clinic = Clinic(
        name="Test Clinic",
        line_channel_id="test_channel",
        line_channel_secret="test_secret",
        line_channel_access_token="test_token"
    )
    db_session.add(clinic)
    db_session.commit()
    db_session.refresh(clinic)
    return clinic


@pytest.fixture
def patient(db_session: Session, clinic: Clinic) -> Patient:
    """Create a test patient."""
    patient = Patient(
        clinic_id=clinic.id,
        full_name="Test Patient",
        phone_number="0912345678"
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)
    return patient


@pytest.fixture
def medical_records(db_session: Session, clinic: Clinic, patient: Patient) -> dict:
    """Create test medical records."""
    # Create template
    template = MedicalRecordTemplate(
        clinic_id=clinic.id,
        name="Test Template",
        fields=[],
        version=1
    )
    db_session.add(template)
    db_session.commit()
    
    # Create records
    record1 = MedicalRecord(
        clinic_id=clinic.id,
        patient_id=patient.id,
        template_id=template.id,
        template_name=template.name,
        template_snapshot={"name": template.name, "fields": []},
        values={},
        version=1
    )
    record2 = MedicalRecord(
        clinic_id=clinic.id,
        patient_id=patient.id,
        template_id=template.id,
        template_name=template.name,
        template_snapshot={"name": template.name, "fields": []},
        values={},
        version=1
    )
    db_session.add(record1)
    db_session.add(record2)
    db_session.commit()
    db_session.refresh(record1)
    db_session.refresh(record2)
    
    return {"record1": record1, "record2": record2}


def create_test_photo(
    db_session: Session,
    clinic: Clinic,
    patient: Patient,
    is_pending: bool = False,
    medical_record_id: Optional[int] = None,
    created_at: Optional[datetime] = None
) -> PatientPhoto:
    """Helper to create a test photo."""
    photo = PatientPhoto(
        clinic_id=clinic.id,
        patient_id=patient.id,
        medical_record_id=medical_record_id,
        filename="test.jpg",
        storage_key=f"test/{datetime.now().timestamp()}.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
        is_pending=is_pending,
        created_at=created_at or datetime.now(timezone.utc)
    )
    db_session.add(photo)
    db_session.commit()
    db_session.refresh(photo)
    return photo


class TestListPhotosWithPagination:
    """Test list_photos returns paginated response with total count."""

    def test_returns_tuple_with_items_and_total(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify list_photos returns (items, total) tuple."""
        # Create 3 photos
        for _ in range(3):
            create_test_photo(db_session, clinic, patient)

        service = PatientPhotoService()
        result = service.list_photos(db_session, clinic.id, patient.id)

        # Should return tuple
        assert isinstance(result, tuple)
        assert len(result) == 2

        items, total = result
        assert isinstance(items, list)
        assert isinstance(total, int)
        assert len(items) == 3
        assert total == 3

    def test_pagination_skip_and_limit(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify skip and limit parameters work correctly."""
        # Create 10 photos
        for i in range(10):
            create_test_photo(db_session, clinic, patient)

        service = PatientPhotoService()

        # Get first page (5 items)
        items_page1, total = service.list_photos(
            db_session, clinic.id, patient.id, skip=0, limit=5
        )
        assert len(items_page1) == 5
        assert total == 10

        # Get second page (5 items)
        items_page2, total = service.list_photos(
            db_session, clinic.id, patient.id, skip=5, limit=5
        )
        assert len(items_page2) == 5
        assert total == 10

        # Verify no overlap
        page1_ids = {p.id for p in items_page1}
        page2_ids = {p.id for p in items_page2}
        assert len(page1_ids & page2_ids) == 0

    def test_total_count_excludes_deleted_photos(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify total count excludes soft-deleted photos."""
        # Create 5 photos, delete 2
        photos = [create_test_photo(db_session, clinic, patient) for _ in range(5)]
        
        photos[0].is_deleted = True
        photos[1].is_deleted = True
        db_session.commit()

        service = PatientPhotoService()
        items, total = service.list_photos(db_session, clinic.id, patient.id)

        assert len(items) == 3
        assert total == 3


class TestStableOrdering:
    """Test stable ordering: created_at DESC, id DESC."""

    def test_orders_by_created_at_desc_then_id_desc(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify photos are ordered by created_at DESC, then id DESC."""
        now = datetime.now(timezone.utc)
        
        # Create photos with different timestamps
        photo1 = create_test_photo(db_session, clinic, patient, created_at=now - timedelta(hours=3))
        photo2 = create_test_photo(db_session, clinic, patient, created_at=now - timedelta(hours=2))
        photo3 = create_test_photo(db_session, clinic, patient, created_at=now - timedelta(hours=1))

        service = PatientPhotoService()
        items, _ = service.list_photos(db_session, clinic.id, patient.id)

        # Should be ordered newest first
        assert items[0].id == photo3.id
        assert items[1].id == photo2.id
        assert items[2].id == photo1.id

    def test_stable_ordering_with_same_timestamp(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify stable ordering when photos have identical timestamps."""
        same_time = datetime.now(timezone.utc)
        
        # Create 3 photos with same timestamp
        photo1 = create_test_photo(db_session, clinic, patient, created_at=same_time)
        photo2 = create_test_photo(db_session, clinic, patient, created_at=same_time)
        photo3 = create_test_photo(db_session, clinic, patient, created_at=same_time)

        service = PatientPhotoService()
        items, _ = service.list_photos(db_session, clinic.id, patient.id)

        # Should be ordered by ID DESC (newest ID first)
        assert items[0].id == photo3.id
        assert items[1].id == photo2.id
        assert items[2].id == photo1.id


class TestCountRecordPhotos:
    """Test count_record_photos for auto-suggestion."""

    def test_counts_photos_for_specific_record(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient,
        medical_records: dict
    ):
        """Verify count_record_photos returns correct count."""
        record1 = medical_records["record1"]
        record2 = medical_records["record2"]
        
        # Create photos linked to record 1
        for _ in range(3):
            create_test_photo(db_session, clinic, patient, medical_record_id=record1.id)

        # Create photos linked to record 2
        for _ in range(2):
            create_test_photo(db_session, clinic, patient, medical_record_id=record2.id)

        # Create unlinked photos
        create_test_photo(db_session, clinic, patient)

        service = PatientPhotoService()
        
        count_record1 = service.count_record_photos(db_session, clinic.id, record1.id)
        count_record2 = service.count_record_photos(db_session, clinic.id, record2.id)

        assert count_record1 == 3
        assert count_record2 == 2

    def test_excludes_deleted_photos_from_count(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient,
        medical_records: dict
    ):
        """Verify count excludes soft-deleted photos."""
        record1 = medical_records["record1"]
        
        # Create 5 photos for record 1
        photos = [
            create_test_photo(db_session, clinic, patient, medical_record_id=record1.id)
            for _ in range(5)
        ]

        # Delete 2 photos
        photos[0].is_deleted = True
        photos[1].is_deleted = True
        db_session.commit()

        service = PatientPhotoService()
        count = service.count_record_photos(db_session, clinic.id, record1.id)

        assert count == 3

    def test_returns_zero_for_record_with_no_photos(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify count returns 0 for record with no photos."""
        service = PatientPhotoService()
        count = service.count_record_photos(db_session, clinic.id, 999)

        assert count == 0


class TestFilteringBehavior:
    """Test filtering behavior for pending photos and medical records."""

    def test_hides_pending_photos_by_default(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient
    ):
        """Verify pending photos are hidden in default gallery view."""
        active_photo = create_test_photo(db_session, clinic, patient, is_pending=False)
        pending_photo = create_test_photo(db_session, clinic, patient, is_pending=True)

        service = PatientPhotoService()
        items, total = service.list_photos(db_session, clinic.id, patient.id)

        ids = [p.id for p in items]
        assert active_photo.id in ids
        assert pending_photo.id not in ids
        assert total == 1

    def test_shows_pending_photos_when_filtering_by_record(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient,
        medical_records: dict
    ):
        """Verify pending photos are shown when filtering by medical_record_id."""
        record1 = medical_records["record1"]
        
        pending_photo = create_test_photo(
            db_session, clinic, patient, is_pending=True, medical_record_id=record1.id
        )

        service = PatientPhotoService()
        items, total = service.list_photos(
            db_session, clinic.id, patient.id, medical_record_id=record1.id
        )

        ids = [p.id for p in items]
        assert pending_photo.id in ids
        assert total == 1

    def test_unlinked_only_filter(
        self,
        db_session: Session,
        clinic: Clinic,
        patient: Patient,
        medical_records: dict
    ):
        """Verify unlinked_only filter works correctly."""
        record1 = medical_records["record1"]
        
        linked_photo = create_test_photo(db_session, clinic, patient, medical_record_id=record1.id)
        unlinked_photo = create_test_photo(db_session, clinic, patient)

        service = PatientPhotoService()
        items, total = service.list_photos(
            db_session, clinic.id, patient.id, unlinked_only=True
        )

        ids = [p.id for p in items]
        assert unlinked_photo.id in ids
        assert linked_photo.id not in ids
        assert total == 1
