import boto3 # type: ignore
from datetime import datetime, timedelta, timezone
from typing import Set, Any
from sqlalchemy.orm import Session

from core.config import S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
from models.medical_record import MedicalRecord
from models.patient_photo import PatientPhoto
from services.medical_record_service import MedicalRecordService

class CleanupService:
    def __init__(self, db: Session):
        self.db = db
        self.s3_client: Any = boto3.client( # type: ignore
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
        self.bucket = S3_BUCKET

    def cleanup_soft_deleted_data(self, retention_days: int = 30) -> int:
        """
        Hard delete records and photos that have been soft-deleted for more than `retention_days`.
        Also cleans up abandoned uploads (is_pending=True) that were never committed.
        Returns the number of items deleted.
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)
        count = 0

        # 1. Find and hard delete expired medical records
        # This will also delete associated photos if they are linked (based on our hard_delete logic)
        expired_records = self.db.query(MedicalRecord).filter(
            MedicalRecord.is_deleted == True,
            MedicalRecord.deleted_at <= cutoff_date
        ).all()

        for record in expired_records:
            # We use the service's hard_delete to ensure consistent logic (e.g. cascading to photos)
            MedicalRecordService.hard_delete_record(self.db, record.id, record.clinic_id)
            count += 1

        # 2. Find and hard delete expired standalone photos (not linked to a record, or linked to a non-deleted record but deleted themselves)
        # Note: Photos linked to the records we just deleted are already gone.
        expired_photos = self.db.query(PatientPhoto).filter(
            PatientPhoto.is_deleted == True,
            PatientPhoto.deleted_at <= cutoff_date
        ).all()

        for photo in expired_photos:
            self.db.delete(photo)
            count += 1
        
        # 3. Clean up abandoned uploads (is_pending=True for >retention_days)
        # These are photos uploaded but never committed (user abandoned the record creation/edit)
        abandoned_photos = self.db.query(PatientPhoto).filter(
            PatientPhoto.is_pending == True,
            PatientPhoto.created_at <= cutoff_date
        ).all()

        for photo in abandoned_photos:
            self.db.delete(photo)
            count += 1
        
        self.db.commit()
        return count

    def garbage_collect_s3(self, dry_run: bool = False) -> int:
        """
        Delete S3 objects that are not referenced by any PatientPhoto row in the database.
        Returns the number of objects deleted (or found, if dry_run).
        """
        # 1. Get all referenced keys from DB
        # We need ALL rows, including soft-deleted ones (if they are not expired yet)
        # Optimization: Only fetch necessary columns and use yield_per to avoid loading everything into memory
        referenced_keys: Set[str] = set()
        
        # Query tuples of (storage_key, thumbnail_key)
        query = self.db.query(PatientPhoto.storage_key, PatientPhoto.thumbnail_key).execution_options(yield_per=1000)
        
        for storage_key, thumbnail_key in query:
            if storage_key:
                referenced_keys.add(storage_key)
            if thumbnail_key:
                referenced_keys.add(thumbnail_key)

        # 2. List all objects in S3
        # Note: For large buckets, this needs pagination. using get_paginator is safer.
        paginator: Any = self.s3_client.get_paginator('list_objects_v2') # type: ignore
        pages: Any = paginator.paginate(Bucket=self.bucket) # type: ignore

        deleted_count = 0
        
        for page in pages: # type: ignore
            if 'Contents' not in page: # type: ignore
                continue
                
            for obj in page['Contents']: # type: ignore
                key: str = obj['Key'] # type: ignore
                # Skip if key is a "folder" placeholder (ends with /)
                if key.endswith('/'):
                    continue
                
                # Check if referenced
                if key not in referenced_keys:
                    # SAFETY CHECK: Only delete if older than 31 days
                    # This provides a grace period for eventual consistency and recovery
                    last_modified = obj['LastModified']
                    if last_modified > datetime.now(timezone.utc) - timedelta(days=31):
                        continue

                    if not dry_run:
                        self.s3_client.delete_object(Bucket=self.bucket, Key=key) # type: ignore
                        print(f"GC: Deleted unreferenced object {key}")
                    else:
                        print(f"GC: [Dry Run] Would delete {key}")
                    deleted_count += 1

        return deleted_count
