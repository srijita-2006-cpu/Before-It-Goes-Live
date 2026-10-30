"""Input validation shared by the upload and audit routes."""

import io
import os
import zipfile
from datetime import date
from typing import Dict, List

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_BATCH_BYTES = 50 * 1024 * 1024
MAX_BATCH_FILES = 20
MAX_TEXT_CHARACTERS = 100_000
MAX_DOCUMENT_PAGES = 100
UPLOAD_CHUNK_BYTES = 64 * 1024
MAX_OFFICE_ARCHIVE_ENTRIES = 10_000

IMAGE_FORMATS = {
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".webp": "WEBP",
    ".gif": "GIF",
    ".bmp": "BMP",
    ".tif": "TIFF",
    ".tiff": "TIFF",
}
TEXT_EXTENSIONS = {".txt", ".md", ".csv"}
SUPPORTED_EXTENSIONS = set(IMAGE_FORMATS) | TEXT_EXTENSIONS | {".pdf", ".docx", ".pptx"}


def original_filename(filename: str) -> str:
    """Keep only a safe display name; never use it as a storage path."""
    name = str(filename or "").replace("\\", "/").split("/")[-1].strip()
    if not name or name in {".", ".."} or "\x00" in name:
        raise ValueError("A valid filename is required.")
    if len(name) > 255:
        raise ValueError("The filename is too long. Use a name under 256 characters.")
    return name


def validate_text_length(text: str) -> None:
    if len(text) > MAX_TEXT_CHARACTERS:
        raise ValueError(
            f"Text is too long ({len(text):,} characters). The limit is {MAX_TEXT_CHARACTERS:,} characters."
        )


def validate_rule_fields(
    title: str,
    category: str,
    statement: str,
    forbidden_terms: str = "",
    effective_date: str = "",
    expires_at: str = "",
    severity: str = "medium",
) -> tuple[str, str, str]:
    title = str(title or "").strip()
    category = str(category or "").strip()
    statement = str(statement or "").strip()
    if not title or not category or not statement:
        raise ValueError("Rule title, category, and rule text are required. Fill in all three fields.")
    if len(title) > 160 or len(category) > 100 or len(statement) > 4000:
        raise ValueError("Rule title must be 160 characters or fewer, category 100 or fewer, and rule text 4,000 or fewer.")
    if len(str(forbidden_terms or "")) > 4000:
        raise ValueError("Forbidden terms must be 4,000 characters or fewer.")
    for label, value in (("effective", effective_date), ("expiry", expires_at)):
        if value:
            try:
                parsed_date = date.fromisoformat(value)
            except ValueError as exc:
                raise ValueError(f"The {label} date must be a valid YYYY-MM-DD date.") from exc
            if parsed_date.isoformat() != value:
                raise ValueError(f"The {label} date must use YYYY-MM-DD format.")
    if expires_at and effective_date and expires_at < effective_date:
        raise ValueError("Expiry date cannot be earlier than the effective date.")
    if severity and severity.lower() not in {"high", "medium", "low"}:
        raise ValueError("Severity must be high, medium, or low.")
    return title, category, statement


def _validate_zip_container(data: bytes, required_member: str) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > MAX_OFFICE_ARCHIVE_ENTRIES:
                raise ValueError("The Office document contains too many archive entries to process safely.")
            if any(member.flag_bits & 0x1 for member in members):
                raise ValueError("Password-protected Office documents are not supported.")
            if sum(member.file_size for member in members) > MAX_BATCH_BYTES:
                raise ValueError("The uncompressed document is too large to process safely.")
            if not any(member.filename == required_member for member in members):
                raise ValueError("The file contents do not match the selected document format.")
            if archive.testzip() is not None:
                raise ValueError("The document archive is damaged. Save a fresh copy and try again.")
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("The Office document is corrupted, uses unsupported compression, or cannot be read.") from exc


def validate_upload_bytes(filename: str, data: bytes, allow_zip: bool = False) -> str:
    """Validate a bounded upload by extension and its actual file structure."""
    name = original_filename(filename)
    if not data:
        raise ValueError("The selected file is empty. Choose a non-empty file.")
    if len(data) > (MAX_BATCH_BYTES if allow_zip and name.lower().endswith(".zip") else MAX_FILE_BYTES):
        limit = MAX_BATCH_BYTES if allow_zip and name.lower().endswith(".zip") else MAX_FILE_BYTES
        raise ValueError(f"The file exceeds the {limit // (1024 * 1024)} MiB upload limit.")

    extension = os.path.splitext(name)[1].lower()
    if extension != ".pdf" and data.startswith(b"%PDF-"):
        raise ValueError("The file contents are a PDF but the filename extension does not match.")
    if extension not in {".docx", ".pptx"} and not (allow_zip and extension == ".zip") and data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        raise ValueError("The file contents are an Office document or ZIP archive but the filename extension does not match.")
    if extension not in IMAGE_FORMATS:
        image_signatures = (
            b"\x89PNG\r\n\x1a\n",
            b"\xff\xd8\xff",
            b"GIF87a",
            b"GIF89a",
            b"BM",
            b"II*\x00",
            b"MM\x00*",
        )
        if data.startswith(image_signatures) or (
            data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        ):
            raise ValueError("The file contents are an image but the filename extension does not match.")
    if allow_zip and extension == ".zip":
        if not data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
            raise ValueError("The file contents do not match a ZIP archive.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                members = archive.infolist()
                if len(members) > MAX_OFFICE_ARCHIVE_ENTRIES:
                    raise ValueError("The ZIP archive contains too many entries to process safely.")
                files = [entry for entry in members if not entry.is_dir()]
                if len(files) > MAX_BATCH_FILES:
                    raise ValueError(f"A batch can contain at most {MAX_BATCH_FILES} files.")
                if sum(entry.file_size for entry in files) > MAX_BATCH_BYTES:
                    raise ValueError("The uncompressed batch exceeds the 50 MiB total limit.")
                if any(entry.file_size > MAX_FILE_BYTES for entry in files):
                    raise ValueError("Each file in a ZIP batch must be 20 MiB or smaller.")
                if any(entry.flag_bits & 0x1 for entry in files):
                    raise ValueError("Password-protected ZIP entries are not supported.")
                if archive.testzip() is not None:
                    raise ValueError("The ZIP archive is damaged. Create a fresh archive and try again.")
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The ZIP archive is corrupted, uses unsupported compression, or cannot be read.") from exc
        return "zip"

    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            "Unsupported file type. Use PDF, PPTX, DOCX, TXT, MD, CSV, or a supported image."
        )

    if extension in IMAGE_FORMATS:
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data)) as image:
                if image.format != IMAGE_FORMATS[extension]:
                    raise ValueError("The file contents do not match its image filename extension.")
                if image.width * image.height > 40_000_000:
                    raise ValueError("The image dimensions are too large to process safely.")
                image.verify()
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The image is corrupted or unreadable. Choose a valid image file.") from exc
        return "image"

    if extension == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("The file contents do not match a PDF. Check the filename and try again.")
        try:
            import fitz

            document = fitz.open(stream=data, filetype="pdf")
            if document.needs_pass:
                document.close()
                raise ValueError("Password-protected PDFs are not supported. Remove the password and retry.")
            if document.page_count == 0:
                document.close()
                raise ValueError("The PDF contains no pages.")
            document.close()
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The PDF is corrupted or unreadable. Save a fresh copy and try again.") from exc
        return "pdf"

    if extension in {".docx", ".pptx"}:
        if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            raise ValueError("This is an encrypted or legacy Office document. Password-protected and legacy .doc/.ppt files are not supported; save an unprotected .docx or .pptx copy.")
        required_member = "word/document.xml" if extension == ".docx" else "ppt/presentation.xml"
        _validate_zip_container(data, required_member)
        return "docx" if extension == ".docx" else "pptx"

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Text files must use UTF-8 encoding. Save as UTF-8 and retry.") from exc
    validate_text_length(text)
    if not text.strip():
        raise ValueError("The text file is empty. Add content before starting a review.")
    return "text"


def validate_archive_entry_names(names: List[str]) -> None:
    if len(names) > MAX_BATCH_FILES:
        raise ValueError(f"A batch can contain at most {MAX_BATCH_FILES} files.")
    unsupported = [name for name in names if os.path.splitext(original_filename(name))[1].lower() not in SUPPORTED_EXTENSIONS]
    if unsupported:
        raise ValueError(
            "The ZIP contains unsupported files: " + ", ".join(original_filename(name) for name in unsupported[:5])
        )
