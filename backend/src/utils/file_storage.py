import os
import uuid
import aiofiles
import aioboto3  # type: ignore
from typing import Tuple, cast
from fastapi import UploadFile
from types_aiobotocore_s3 import S3Client  # type: ignore
from core.config import (
    API_BASE_URL, 
    S3_BUCKET, 
    S3_REGION, 
    S3_ACCESS_KEY, 
    S3_SECRET_KEY, 
    S3_ENDPOINT_URL,
    S3_CUSTOM_DOMAIN
)

# Local storage configuration
UPLOAD_DIR = "uploads/medical_records"

async def save_upload_file(upload_file: UploadFile) -> Tuple[str, str]:
    """
    Saves an uploaded file and returns (s3_key, url).
    Prioritizes S3 if configured, otherwise falls back to local storage.
    """
    # Use local storage if S3 is not configured or in development/testing without S3 keys
    if not S3_BUCKET or not S3_ACCESS_KEY or not S3_SECRET_KEY:
        return await save_local_file(upload_file)
    
    return await save_s3_file(upload_file)

async def save_local_file(upload_file: UploadFile) -> Tuple[str, str]:
    """
    Saves a file to the local filesystem.
    """
    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    file_extension = os.path.splitext(upload_file.filename or "")[1]
    s3_key = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, s3_key)

    # Reset file pointer just in case
    await upload_file.seek(0)
    
    async with aiofiles.open(file_path, 'wb') as out_file:
        while content := await upload_file.read(1024 * 1024):  # Read in 1MB chunks
            await out_file.write(content)

    url = f"{API_BASE_URL}/static/{UPLOAD_DIR}/{s3_key}"
    return s3_key, url

async def save_s3_file(upload_file: UploadFile) -> Tuple[str, str]:
    """
    Saves a file to AWS S3 using aioboto3.
    Uses chunked reading to avoid memory pressure for large files.
    """
    file_extension = os.path.splitext(upload_file.filename or "")[1]
    s3_key = f"medical-records/{uuid.uuid4()}{file_extension}"
    
    session = aioboto3.Session()
    async with session.client(  # type: ignore
        's3',
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        endpoint_url=S3_ENDPOINT_URL
    ) as s3_client:  # type: ignore
        s3 = cast(S3Client, s3_client)
        # Reset file pointer
        await upload_file.seek(0)
        
        # Use upload_fileobj for streaming to S3, which is more memory-efficient
        # than reading the entire file into memory with put_object.
        # We wrap the upload_file.file (which is a SpooledTemporaryFile) 
        # to ensure it's treated correctly by aioboto3.
        await s3.upload_fileobj(
            upload_file.file,
            S3_BUCKET,
            s3_key,
            ExtraArgs={
                'ContentType': upload_file.content_type or 'application/octet-stream'
            }
        )

    # Construct the URL
    if S3_CUSTOM_DOMAIN:
        url = f"https://{S3_CUSTOM_DOMAIN}/{s3_key}"
    else:
        # Standard S3 URL format
        if S3_ENDPOINT_URL:
            # For MinIO or localstack, we might need to adjust this
            url = f"{S3_ENDPOINT_URL}/{S3_BUCKET}/{s3_key}"
        else:
            url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{s3_key}"
            
    return s3_key, url
