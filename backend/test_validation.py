import io
import unittest
import zipfile
from unittest.mock import patch

from validation import (
    MAX_FILE_BYTES,
    MAX_TEXT_CHARACTERS,
    validate_archive_entry_names,
    validate_rule_fields,
    validate_text_length,
    validate_upload_bytes,
)


def office_archive(member_name):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(member_name, "<document/>")
    return buffer.getvalue()


class UploadValidationTests(unittest.TestCase):
    def test_rejects_empty_file(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            validate_upload_bytes("copy.txt", b"")

    def test_rejects_unsupported_extension(self):
        with self.assertRaisesRegex(ValueError, "Unsupported file type"):
            validate_upload_bytes("copy.exe", b"data")

    def test_rejects_mismatched_pdf_signature(self):
        with self.assertRaisesRegex(ValueError, "do not match"):
            validate_upload_bytes("copy.pdf", b"not a pdf")

    def test_rejects_pdf_disguised_as_text(self):
        with self.assertRaisesRegex(ValueError, "extension does not match"):
            validate_upload_bytes("copy.txt", b"%PDF-1.4\n")

    def test_rejects_oversized_file(self):
        with self.assertRaisesRegex(ValueError, "20 MiB"):
            validate_upload_bytes("copy.txt", b"x" * (MAX_FILE_BYTES + 1))

    def test_rejects_whitespace_text(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            validate_upload_bytes("copy.txt", b" \r\n\t")

    def test_rejects_invalid_utf8(self):
        with self.assertRaisesRegex(ValueError, "UTF-8"):
            validate_upload_bytes("copy.csv", b"\xff\xfe")

    def test_rejects_mismatched_office_document(self):
        with self.assertRaisesRegex(ValueError, "do not match"):
            validate_upload_bytes("copy.docx", office_archive("ppt/presentation.xml"))

    def test_reports_office_parser_failure_as_validation_error(self):
        with patch("zipfile.ZipFile.testzip", side_effect=RuntimeError("unsupported compression")):
            with self.assertRaisesRegex(ValueError, "unsupported compression"):
                validate_upload_bytes("copy.docx", office_archive("word/document.xml"))

    def test_accepts_utf8_text(self):
        self.assertEqual(validate_upload_bytes("copy.md", b"\xef\xbb\xbfHello"), "text")

    def test_limits_extracted_text(self):
        with self.assertRaisesRegex(ValueError, "100,000"):
            validate_text_length("x" * (MAX_TEXT_CHARACTERS + 1))

    def test_rejects_unsupported_zip_entries(self):
        with self.assertRaisesRegex(ValueError, "unsupported files"):
            validate_archive_entry_names(["campaign.exe"])

    def test_rejects_blank_rule_fields(self):
        with self.assertRaisesRegex(ValueError, "required"):
            validate_rule_fields(" ", "Brand", "Some rule")

    def test_rejects_invalid_rule_dates(self):
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            validate_rule_fields("Name", "Brand", "Some rule", effective_date="not-a-date")

    def test_rejects_noncanonical_rule_dates(self):
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            validate_rule_fields("Name", "Brand", "Some rule", effective_date="20260301")

    def test_rejects_expiry_before_effective_date(self):
        with self.assertRaisesRegex(ValueError, "earlier"):
            validate_rule_fields(
                "Name", "Brand", "Some rule",
                effective_date="2026-03-01", expires_at="2026-02-01"
            )


if __name__ == "__main__":
    unittest.main()
