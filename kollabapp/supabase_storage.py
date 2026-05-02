import logging
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from supabase import create_client

logger = logging.getLogger(__name__)

_supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)

def _bucket():
    return _supabase.storage.from_(settings.SUPABASE_BUCKET)

def build_storage_path(folder: str, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if not suffix:
        suffix = ""
    return f"{folder}/{uuid4().hex}{suffix}"

def upload_file(path: str, file_obj, content_type: str | None = None):
    options = {}
    if content_type:
        options["content-type"] = content_type
    payload = file_obj
    if hasattr(file_obj, "read"):
        payload = file_obj.read()
    result = _bucket().upload(path, payload, options)
    if isinstance(result, dict) and result.get("error"):
        logger.error("Supabase upload failed: %s", result)
        raise RuntimeError("Supabase upload failed")
    return result

def delete_file(path: str):
    if not path:
        return
    result = _bucket().remove([path])
    if isinstance(result, dict) and result.get("error"):
        logger.warning("Supabase delete failed for %s: %s", path, result)
    return result

def create_signed_url(path: str, expires_in: int = 3600) -> str | None:
    if not path:
        return None
    result = _bucket().create_signed_url(path, expires_in)
    if isinstance(result, dict):
        return result.get("signedURL") or result.get("signedUrl")
    return None
