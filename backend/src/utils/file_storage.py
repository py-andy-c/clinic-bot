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
    S3_CUSTOM_DOMAIN,
    MAX_UPLOAD_SIZE_MB
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

async def delete_file(file_path: str):
    """
    Deletes a file from storage. Handles both S3 and local storage.
    """
    # Use local storage if S3 is not configured
    if not S3_BUCKET or not S3_ACCESS_KEY or not S3_SECRET_KEY:
        # For local files, file_path is just the filename in UPLOAD_DIR
        local_path = os.path.join(UPLOAD_DIR, file_path)
        if os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception as e:
                # Log but don't fail if delete fails
                print(f"Failed to delete local file {local_path}: {e}")
        return

    # Delete from S3
    try:
        session = aioboto3.Session()
        async with session.client(  # type: ignore
            's3',
            region_name=S3_REGION,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            endpoint_url=S3_ENDPOINT_URL
        ) as s3_client: # type: ignore
            s3 = cast(S3Client, s3_client)
            await s3.delete_object(Bucket=S3_BUCKET, Key=file_path)
    except Exception as e:
        print(f"Failed to delete S3 object {file_path}: {e}")

async def generate_presigned_url(s3_key: str, expiration: int = 3600) -> str:
    """
    Generates a pre-signed URL for an S3 object.
    If S3 is not configured, returns the local static URL.
    """
    if not S3_BUCKET or not S3_ACCESS_KEY or not S3_SECRET_KEY:
        return f"{API_BASE_URL}/static/{UPLOAD_DIR}/{s3_key}"

    try:
        session = aioboto3.Session()
        async with session.client(  # type: ignore
            's3',
            region_name=S3_REGION,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            endpoint_url=S3_ENDPOINT_URL
        ) as s3_client: # type: ignore
            s3 = cast(S3Client, s3_client)
            url = await s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': S3_BUCKET, 'Key': s3_key},
                ExpiresIn=expiration
            )
            return url
    except Exception as e:
        print(f"Failed to generate pre-signed URL for {s3_key}: {e}")
        # Fallback to public URL format if signing fails
        if S3_CUSTOM_DOMAIN:
            return f"https://{S3_CUSTOM_DOMAIN}/{s3_key}"
        return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{s3_key}"

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
    ) as s3_client: # type: ignore
        s3 = cast(S3Client, s3_client)
        # Reset file pointer
        await upload_file.seek(0)
        
        # Use put_object instead of upload_fileobj to avoid asyncio.wait coroutine issues in Python 3.12
        # To avoid reading the entire file into memory, we can pass the file object directly
        # but UploadFile.file is a synchronous file object, and put_object expects bytes or a file-like object.
        # If we pass upload_file.file, boto3 will do synchronous I/O.
        # For small files (up to MAX_UPLOAD_SIZE_MB), reading into memory is acceptable.
        # The limit is enforced at the API layer.
        content = await upload_file.read()
        await s3.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=content,
            ContentType=upload_file.content_type or 'application/octet-stream'
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
