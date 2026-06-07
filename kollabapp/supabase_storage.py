import logging
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from supabase import create_client

logger = logging.getLogger(__name__)

_supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)

def _bucket():
    return _supabase.storage.from_(settings.SUPABASE_BUCKET)


def _local_file_path(path: str) -> Path:
    local_path = settings.MEDIA_ROOT / Path(path)
    resolved_path = local_path.resolve()
    if not str(resolved_path).startswith(str(settings.MEDIA_ROOT.resolve())):
        raise ValueError("Invalid local storage path")
    return resolved_path


def _save_local_file(path: str, content: bytes) -> Path:
    local_path = _local_file_path(path)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(content)
    return local_path


def _local_file_exists(path: str) -> bool:
    try:
        return _local_file_path(path).exists()
    except ValueError:
        return False


def _local_url(path: str) -> str:
    return f"{settings.MEDIA_URL.rstrip('/')}" + "/" + str(Path(path).as_posix()).lstrip("/")


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

    if isinstance(payload, str):
        payload = payload.encode("utf-8")

    try:
        result = _bucket().upload(path, payload, options)
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(result.get("error"))
        return result
    except Exception as exc:
        logger.warning("Supabase upload failed, storing locally instead: %s", exc)
        _save_local_file(path, payload)
        return path


def delete_file(path: str):
    if not path:
        return

    if _local_file_exists(path):
        try:
            _local_file_path(path).unlink()
        except Exception as exc:
            logger.warning("Local file delete failed for %s: %s", path, exc)
        return

    try:
        result = _bucket().remove([path])
        if isinstance(result, dict) and result.get("error"):
            logger.warning("Supabase delete failed for %s: %s", path, result)
        return result
    except Exception as exc:
        logger.warning("Supabase delete failed for %s: %s", path, exc)
        return


def create_signed_url(path: str, expires_in: int = 3600) -> str | None:
    if not path:
        return None

    if _local_file_exists(path):
        return _local_url(path)

    try:
        result = _bucket().create_signed_url(path, expires_in)
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl")
        return None
    except Exception as exc:
        logger.warning("Supabase signed URL failed for %s: %s", path, exc)
        return None
