import io
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

import database
import engine
import fitz
from PIL import Image
from pptx import Presentation

_test_storage = tempfile.TemporaryDirectory()
database.DB_FILE = os.path.join(_test_storage.name, "test.db")

import main
from fastapi.testclient import TestClient

main.UPLOAD_DIR = os.path.join(_test_storage.name, "uploads")
os.makedirs(main.UPLOAD_DIR, exist_ok=True)
# Initialize test database and create a test session for reliability suite
import auth
database.init_db()
_test_conn = database.get_db()
_test_user = auth.create_user(_test_conn, "reliability_tester@test.local", "TestPassword123!")
_test_sess = auth.create_session(_test_conn, _test_user["id"])
_test_conn.execute("INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role) VALUES ('mem_rel_test', 'org_default', ?, 'owner')", (_test_user["id"],))
_test_conn.commit()
_test_conn.close()

client = TestClient(main.app)
client.cookies.set("session_id", _test_sess["session_id"])
client.cookies.set("org_id", "org_default")


def mock_gemini_response(status_code, payload, headers=None):
    response = Mock(status_code=status_code)
    response.iter_content.return_value = [json.dumps(payload).encode("utf-8")]
    response.json.return_value = payload
    response.headers = headers or {}
    return response


def mock_groq_response(content, status_code=200):
    response = Mock(status_code=status_code)
    response.headers = {}
    response.json.return_value = {
        "choices": [{"message": {"content": content}}],
    }
    return response


def clear_test_data():
    connection = database.get_db()
    try:
        for table in (
            "findings",
            "documents",
            "brand_rules",
            "correction_suggestion_cache",
            "audit_log",
            "rule_activity_log",
        ):
            connection.execute(f"DELETE FROM {table}")
        connection.commit()
    finally:
        connection.close()


def create_correction_fixture(
    document_text="Our product is 100% organic.",
    flagged_text="100% organic",
    approved_statement="Specification confirms 95% certified organic extracts. Never claim 100% without certification.",
    forbidden_terms="100% organic,pure organic",
    rule_id="correction-rule",
    document_id="correction-doc",
    finding_id="correction-finding",
    exact_quote="95% certified organic extracts",
):
    connection = database.get_db()
    try:
        connection.execute(
            """
            INSERT INTO brand_rules
                (id, title, rule_category, approved_statement, forbidden_terms, exact_quote, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
            """,
            (rule_id, "Organic claim", "Product claims", approved_statement, forbidden_terms, exact_quote),
        )
        connection.execute(
            "INSERT INTO documents (id, filename, text_content, status) VALUES (?, ?, ?, 'Exceptions Found')",
            (document_id, "copy.txt", document_text),
        )
        connection.execute(
            """
            INSERT INTO findings
                (id, document_id, rule_id, flagged_text, explanation, evidence, severity, suggested_fix, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
            """,
            (
                finding_id,
                document_id,
                rule_id,
                flagged_text,
                "The claim conflicts with the configured rule.",
                f"{rule_id} - Organic claim",
                "high",
                "",
            ),
        )
        connection.commit()
    finally:
        connection.close()
    return finding_id, document_id


class ApiReliabilityTests(unittest.TestCase):
    def setUp(self):
        clear_test_data()
        self.gemini_environment = patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key",
            "GROQ_API_KEY": "",
            "AI_PRIMARY_PROVIDER": "gemini",
            "AI_FALLBACK_PROVIDER": "groq",
            "GEMINI_MODEL": main.DEFAULT_GEMINI_MODEL,
            "GROQ_MODEL": main.ai_provider.DEFAULT_GROQ_MODEL,
            "GEMINI_API_URL": main.ai_provider.DEFAULT_GEMINI_API_URL,
            "GROQ_API_URL": main.ai_provider.DEFAULT_GROQ_API_URL,
        })
        self.gemini_environment.start()

    def tearDown(self):
        self.gemini_environment.stop()

    def test_legacy_matcher_does_not_invent_default_findings(self):
        findings = engine.match_claims_to_rules(
            ["This product is 100% organic and offers a miracle cure."]
        )
        self.assertEqual(findings, [])

    def test_suggestion_schema_migration_preserves_existing_finding(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(temporary_directory, "legacy.db")
            connection = sqlite3.connect(legacy_path)
            try:
                connection.execute(
                    "CREATE TABLE findings (id TEXT PRIMARY KEY, suggested_fix TEXT)"
                )
                connection.execute(
                    "INSERT INTO findings (id, suggested_fix) VALUES (?, ?)",
                    ("existing-finding", ""),
                )
                connection.commit()
            finally:
                connection.close()

            previous_db_file = database.DB_FILE
            database.DB_FILE = legacy_path
            try:
                database.init_db()
                connection = database.get_db()
                try:
                    columns = {
                        row["name"]
                        for row in connection.execute("PRAGMA table_info(findings)").fetchall()
                    }
                    existing = connection.execute(
                        "SELECT id, suggested_fix, suggestion_status, suggestion_missing_information "
                        "FROM findings WHERE id = ?",
                        ("existing-finding",),
                    ).fetchone()
                    self.assertTrue({
                        "suggestion_status",
                        "suggestion_explanation",
                        "suggestion_change_summary",
                        "suggestion_missing_information",
                    }.issubset(columns))
                    self.assertEqual(existing["id"], "existing-finding")
                    self.assertEqual(existing["suggestion_status"], "not_requested")
                    self.assertEqual(existing["suggestion_missing_information"], "[]")
                finally:
                    connection.close()
            finally:
                database.DB_FILE = previous_db_file

    def test_blank_text_is_rejected_without_creating_a_document(self):
        response = client.post("/api/intake", data={"content": " \r\n "})
        self.assertEqual(response.status_code, 422)
        connection = database.get_db()
        try:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0], 0)
        finally:
            connection.close()

    def test_extension_signature_mismatch_is_rejected(self):
        response = client.post(
            "/api/intake",
            files={"file": ("draft.pdf", b"not a pdf", "application/pdf")},
        )
        self.assertEqual(response.status_code, 422)

    def test_zero_byte_upload_is_rejected(self):
        response = client.post(
            "/api/intake",
            files={"file": ("draft.txt", b"", "text/plain")},
        )
        self.assertEqual(response.status_code, 422)

    def test_pasted_text_upload_preserves_original_file(self):
        response = client.post(
            "/api/intake",
            files={"file": ("draft.txt", b"Original draft copy.", "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Incomplete Analysis")
        connection = database.get_db()
        try:
            row = connection.execute("SELECT filename, file_path FROM documents").fetchone()
            self.assertEqual(row["filename"], "draft.txt")
            stored_path = os.path.join(main.UPLOAD_DIR, row["file_path"])
            with open(stored_path, "rb") as saved:
                self.assertEqual(saved.read(), b"Original draft copy.")
        finally:
            connection.close()

    def test_pasted_text_runs_semantic_and_deterministic_active_rule_checks(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use an accurate claim.", "guaranteed, #1, $49", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post("/api/intake", data={"content": "Guaranteed results, #1 in sales for $49."})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "Exceptions Found")
        self.assertEqual({finding["flagged_text"].lower() for finding in body["findings"]}, {"guaranteed", "#1", "$49"})
        self.assertTrue(body["gemini_used"])
        gemini.assert_called_once()

    def test_pasted_text_without_matches_is_compliant_after_semantic_review(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post("/api/intake", data={"content": "This product is available today."})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Compliant")
        gemini.assert_called_once()

    def test_updated_active_rule_is_used_on_the_next_review(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value="[]") as gemini:
            first = client.post("/api/intake", data={"content": "Available for $49."})
            connection = database.get_db()
            try:
                connection.execute(
                    "UPDATE brand_rules SET forbidden_terms = ? WHERE id = ?",
                    ("$49", "rule-test"),
                )
                connection.commit()
            finally:
                connection.close()
            second = client.post("/api/intake", data={"content": "Available for $49."})
        self.assertEqual(first.json()["status"], "Compliant")
        self.assertEqual(second.json()["status"], "Exceptions Found")
        self.assertEqual(second.json()["findings"][0]["flagged_text"], "$49")
        self.assertEqual(gemini.call_count, 2)

    def test_semantic_audit_finds_rule_violations_without_literal_forbidden_terms(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "pricing-disclosure",
                    "Offer expiry disclosure",
                    "Pricing & Promotions",
                    "custom",
                    "A limited-time discount must state its expiry date and applicable conditions.",
                    "",
                    "active",
                ),
            )
            connection.commit()
        finally:
            connection.close()

        model_findings = [{
            "rule_id": "pricing-disclosure",
            "flagged_text": "Flash sale price: $49!",
            "explanation": "The limited-time offer is presented without the expiry date required by this active rule.",
            "severity": "medium",
            "page": None,
        }]
        with patch("main.call_gemini", return_value=json.dumps(model_findings)) as semantic_call:
            response = client.post(
                "/api/intake",
                data={"content": "Flash sale price: $49!"},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "Exceptions Found")
        self.assertTrue(body["gemini_used"])
        self.assertEqual(body["findings"][0]["flagged_text"], "Flash sale price: $49!")
        self.assertEqual(body["findings"][0]["evidence"], "pricing-disclosure - Offer expiry disclosure")
        prompt = semantic_call.call_args.args[0][0]["text"]
        self.assertIn("Pricing & Promotions", prompt)
        self.assertIn("Flash sale price: $49!", prompt)

    def test_demo_rules_check_absolute_claims_without_unrelated_cosmetic_requirement(self):
        old_cosmetic_statement = (
            "Cosmetic claims must state 'reduces appearance of fine lines', "
            "never 'reverses aging' or 'cures wrinkles'."
        )
        with patch.dict(os.environ, {
            "DEMO_ACCOUNT_ENABLED": "true",
            "DEMO_EMAIL": "demo_audit@test.local",
            "DEMO_PASSWORD": "DemoPassword123!",
            "DEMO_ORGANIZATION_NAME": "Audit Demo",
        }):
            connection = database.get_db()
            try:
                auth.provision_demo_account(connection)
                connection.execute(
                    "UPDATE brand_rules SET approved_statement = ? "
                    "WHERE id = 'BR-DEMO-01' AND organization_id = 'org_demo'",
                    (old_cosmetic_statement,),
                )
                connection.commit()
                auth.provision_demo_account(connection)
                rules = [
                    dict(row)
                    for row in connection.execute(
                        "SELECT * FROM brand_rules WHERE organization_id = 'org_demo' AND status = 'active'"
                    ).fetchall()
                ]
            finally:
                connection.close()

        content = (
            "Our AI platform guarantees 100% uptime with zero errors and "
            "outperforms every competitor on the market permanently."
        )
        with patch("main.call_gemini", return_value="[]") as semantic_review:
            result = main.execute_unified_audit(
                filename="saas-ad.txt",
                content_type="text/plain",
                input_text=content,
                image_parts=[],
                db_rules=rules,
            )

        flagged_text = {finding["flagged_text"].lower() for finding in result["findings"]}
        self.assertIn("100% uptime", flagged_text)
        self.assertIn("zero errors", flagged_text)
        self.assertIn("outperforms every competitor", flagged_text)
        self.assertFalse(any(finding["rule_id"] == "BR-DEMO-01" for finding in result["findings"]))
        self.assertEqual(result["status"], "Exceptions Found")
        semantic_review.assert_called_once()
        prompt = semantic_review.call_args.args[0][0]["text"]
        self.assertIn("BR-DEMO-04", prompt)
        self.assertIn(content, prompt)

    def test_missing_exact_required_wording_is_a_document_finding(self):
        rules = [{
            "id": "disclaimer-rule",
            "title": "Required disclaimer",
            "rule_category": "Disclosure",
            "approved_statement": 'Must include the exact phrase "Terms apply."',
            "forbidden_terms": "",
            "severity": "high",
            "status": "active",
        }]
        pages = [
            {"page": 1, "text": "A promotional offer."},
            {"page": 2, "text": "Available this week."},
        ]
        with patch("main.call_gemini", return_value="[]"):
            result = main.execute_unified_audit(
                filename="offer.pdf",
                content_type="application/pdf",
                input_text="--- [Page 1] ---\nA promotional offer.\n--- [Page 2] ---\nAvailable this week.",
                image_parts=[],
                db_rules=rules,
                pdf_pages=pages,
            )
        required_findings = [
            finding for finding in result["findings"]
            if finding.get("image_action") == "Add the missing required wording"
        ]
        self.assertEqual(len(required_findings), 1)
        self.assertEqual(required_findings[0]["flagged_text"], "")
        self.assertIn("Terms apply.", required_findings[0]["explanation"])
        self.assertEqual(required_findings[0]["location"], "Document-wide required wording")

    def test_semantic_provider_failure_does_not_mark_document_compliant(self):
        rules = [{
            "id": "voice-rule",
            "title": "Voice standard",
            "rule_category": "Brand Voice",
            "approved_statement": "Keep all product copy reassuring and avoid fear-based language.",
            "forbidden_terms": "",
            "severity": "medium",
            "status": "active",
        }]
        with patch(
            "main.call_gemini",
            side_effect=main.ai_provider.AIProviderError(
                "gemini", 503, "UPSTREAM", "AI generation is temporarily unavailable."
            ),
        ):
            result = main.execute_unified_audit(
                filename="copy.txt",
                content_type="text/plain",
                input_text="Your skin will look healthier.",
                image_parts=[],
                db_rules=rules,
            )
        self.assertEqual(result["status"], "Incomplete Analysis")
        self.assertEqual(result["risk_level"], "Analysis Incomplete")
        self.assertFalse(result["semantic_audit_complete"])
        self.assertIn("not marked compliant", result["error_message"])

    def test_invalid_semantic_response_does_not_create_findings_or_mark_compliant(self):
        rules = [{
            "id": "voice-rule",
            "title": "Voice standard",
            "rule_category": "Brand Voice",
            "approved_statement": "Keep all product copy reassuring and avoid fear-based language.",
            "forbidden_terms": "",
            "severity": "medium",
            "status": "active",
        }]
        invalid_responses = (
            "not valid json",
            json.dumps([{
                "rule_id": "voice-rule",
                "flagged_text": "text that does not appear in source",
                "explanation": "The wording violates the active rule.",
                "severity": "medium",
                "page": None,
            }]),
        )
        for invalid_response in invalid_responses:
            with self.subTest(response=invalid_response), patch(
                "main.call_gemini",
                return_value=invalid_response,
            ):
                result = main.execute_unified_audit(
                    filename="copy.txt",
                    content_type="text/plain",
                    input_text="Your skin will look healthier.",
                    image_parts=[],
                    db_rules=rules,
                )
            self.assertEqual(result["status"], "Incomplete Analysis")
            self.assertEqual(result["findings"], [])
            self.assertFalse(result["semantic_audit_complete"])

    def test_brandbook_extraction_covers_all_source_chunks_and_policy_categories(self):
        first_quote = "Brand voice must stay respectful."
        second_quote = "Packaging must display the required safety warning."
        source_text = first_quote + "\n" + ("reference material " * 900) + second_quote
        responses = [
            json.dumps([{
                "title": "Brand voice",
                "rule_category": "Brand Voice & Tone",
                "approved_statement": first_quote,
                "forbidden_terms": "",
                "severity": "medium",
                "exact_quote": first_quote,
                "expires_at": None,
                "source_page": None,
            }]),
            json.dumps([{
                "title": "Safety warning",
                "rule_category": "Packaging & Labeling",
                "approved_statement": second_quote,
                "forbidden_terms": "",
                "severity": "high",
                "exact_quote": second_quote,
                "expires_at": None,
                "source_page": None,
            }]),
        ]
        with patch("main.call_gemini", side_effect=responses) as extraction_call:
            candidates = main.extract_candidate_rules_from_text(source_text, "guidelines.txt")

        self.assertEqual(len(candidates), 2)
        self.assertEqual({candidate["exact_quote"] for candidate in candidates}, {first_quote, second_quote})
        self.assertEqual(extraction_call.call_count, 2)
        self.assertIn("accessibility", extraction_call.call_args_list[0].args[0][0]["text"].lower())
        self.assertIn(second_quote, extraction_call.call_args_list[1].args[0][0]["text"])

    def test_explicit_prohibition_in_rule_text_matches_broader_claim(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "BR-02",
                    "Organic Ingredient Certification Threshold",
                    "Formulation & Science",
                    "default",
                    "Specification confirms 95% certified organic extracts. Never claim 100% without certification.",
                    "100% organic,pure organic",
                    "active",
                ),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post(
                "/api/intake",
                data={"content": "Promotional flash sale ends Friday. This formula is 100% organic."},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "Exceptions Found")
        self.assertEqual(body["findings"][0]["flagged_text"], "100% organic")
        self.assertEqual(body["findings"][0]["suggested_fix"], "")
        self.assertTrue(body["findings"][0]["evidence"].startswith("BR-02 - "))
        gemini.assert_called_once()

        finding = body["findings"][0]
        model_response = {
            "status": "suggestion_ready",
            "original_text": finding["flagged_text"],
            "rule_id": "BR-02",
            "rule_violated": "Specification confirms 95% certified organic extracts. Never claim 100% without certification.",
            "explanation": "The original phrase makes a 100% claim without the required certification.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Replaces the unsupported 100% claim with the configured 95% statement.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch("main.call_gemini", return_value=json.dumps(model_response)) as gemini:
            suggestion = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding["id"]},
            )
        self.assertEqual(suggestion.status_code, 200)
        suggestion_body = suggestion.json()
        self.assertEqual(suggestion_body["status"], "suggestion_ready")
        self.assertEqual(suggestion_body["replacement_text"], "95% certified organic extracts")
        self.assertTrue(suggestion_body["requires_human_review"])
        request_text = gemini.call_args.args[0][0]["text"]
        self.assertIn(body["text_content"], request_text)
        self.assertIn("Never claim 100% without certification", request_text)
        self.assertIn('"flagged_text_to_replace": "100% organic"', request_text)
        self.assertIn("response_schema", gemini.call_args.kwargs)

        connection = database.get_db()
        try:
            saved_finding = connection.execute(
                "SELECT suggested_fix, suggestion_status, status FROM findings WHERE id = ?",
                (finding["id"],),
            ).fetchone()
            saved_document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (body["document_id"],),
            ).fetchone()
            self.assertEqual(saved_finding["suggested_fix"], "95% certified organic extracts")
            self.assertEqual(saved_finding["suggestion_status"], "suggestion_ready")
            self.assertEqual(saved_finding["status"], "open")
            self.assertEqual(saved_document["text_content"], body["text_content"])
        finally:
            connection.close()

        correction = client.post(
            "/api/ai/fix",
            json={
                "finding_id": finding["id"],
                "flagged_text": finding["flagged_text"],
                "replacement_text": suggestion_body["replacement_text"],
                "current_doc_text": body["text_content"],
            },
        )
        self.assertEqual(correction.status_code, 200)
        self.assertEqual(correction.json()["recheck"]["status"], "passed")
        self.assertEqual(
            correction.json()["updated_text"],
            "Promotional flash sale ends Friday. This formula is 95% certified organic extracts.",
        )
        activity = client.get("/api/activity")
        self.assertEqual(activity.status_code, 200)
        activity_document = next(
            item
            for item in activity.json()["documents"]
            if item["id"] == body["document_id"]
        )
        self.assertEqual(activity_document["text_content"], correction.json()["updated_text"])
        self.assertTrue(
            any(
                item["document_id"] == body["document_id"]
                and item["action"] == "finding_resolved"
                for item in activity.json()["logs"]
            )
        )
        connection = database.get_db()
        try:
            audit_entry = connection.execute(
                "SELECT detail FROM audit_log WHERE document_id = ? AND action = 'finding_resolved'",
                (body["document_id"],),
            ).fetchone()
            self.assertIn("95% certified organic extracts", audit_entry["detail"])
        finally:
            connection.close()

    def test_pdf_review_uses_active_rules_without_calling_ai(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        source = fitz.open()
        source.new_page().insert_text((72, 72), "This product is guaranteed.")
        pdf_bytes = source.tobytes()
        source.close()
        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post(
                "/api/intake",
                files={"file": ("draft.pdf", pdf_bytes, "application/pdf")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Exceptions Found")
        self.assertEqual(response.json()["findings"][0]["flagged_text"].lower(), "guaranteed")
        self.assertTrue(response.json()["gemini_used"])
        gemini.assert_called_once()

    def test_pptx_review_uses_active_rules_without_calling_ai(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(0, 0, 4000000, 500000).text = "This product is guaranteed."
        pptx_buffer = io.BytesIO()
        presentation.save(pptx_buffer)
        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post(
                "/api/intake",
                files={
                    "file": (
                        "draft.pptx",
                        pptx_buffer.getvalue(),
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    )
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Exceptions Found")
        self.assertEqual(response.json()["findings"][0]["flagged_text"].lower(), "guaranteed")
        gemini.assert_called_once()

    def test_pptx_without_extractable_text_remains_incomplete_without_ai(self):
        presentation = Presentation()
        presentation.slides.add_slide(presentation.slide_layouts[6])
        pptx_buffer = io.BytesIO()
        presentation.save(pptx_buffer)

        with patch("main.call_gemini", side_effect=AssertionError("PPTX reviews must not call Gemini")) as gemini:
            response = client.post(
                "/api/intake",
                files={
                    "file": (
                        "image-only.pptx",
                        pptx_buffer.getvalue(),
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    )
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Incomplete Analysis")
        self.assertIn("not checked against the active rules", response.json()["error_message"])
        gemini.assert_not_called()

    def test_bulk_text_review_uses_active_rules_without_calling_ai(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post(
                "/api/bulk/upload",
                files={"files": ("draft.txt", b"This product is guaranteed.", "text/plain")},
            )
        self.assertEqual(response.status_code, 200)
        job = client.get(f"/api/bulk/job/{response.json()['job_id']}").json()
        self.assertEqual(job["files"][0]["audit_status"], "Exceptions Found")
        self.assertEqual(job["files"][0]["findings_count"], 1)
        gemini.assert_called_once()

    def test_uploaded_image_ocr_text_is_checked_against_active_rules(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", "Use accurate claims.", "$49", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        image_buffer = io.BytesIO()
        Image.new("RGB", (10, 10), "white").save(image_buffer, format="PNG")
        with patch("main.extract_visual_text_with_gemini", return_value="Available for $49.") as ocr, \
             patch("main.call_gemini", return_value="[]") as gemini:
            response = client.post(
                "/api/intake",
                files={"file": ("creative.png", image_buffer.getvalue(), "image/png")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Exceptions Found")
        self.assertEqual(response.json()["findings"][0]["flagged_text"], "$49")
        self.assertTrue(response.json()["gemini_used"])
        ocr.assert_called_once()
        gemini.assert_called_once()

    def test_ai_failure_does_not_save_a_canned_replacement(self):
        finding_id, _ = create_correction_fixture()

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
             patch("main.call_gemini", return_value=None):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["status"], "error")
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertFalse(row["suggested_fix"])
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_missing_gemini_key_reports_configuration_error(self):
        finding_id, _ = create_correction_fixture()

        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), \
             patch("main.call_gemini") as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["status"], "configuration_error")
        self.assertIn("backend", response.json()["detail"]["message"])
        gemini.assert_not_called()

    def test_gemini_status_uses_current_default_model(self):
        response = client.get("/api/ai/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "gemini-3.1-flash-lite")

    def test_application_dispatcher_uses_groq_after_retryable_gemini_failure(self):
        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "gemini-test-key",
            "GROQ_API_KEY": "groq-test-key",
            "AI_PRIMARY_PROVIDER": "gemini",
            "AI_FALLBACK_PROVIDER": "groq",
        }), patch(
            "main.requests.post",
            side_effect=[
                mock_gemini_response(503, {"error": {"status": "UNAVAILABLE"}}),
                mock_groq_response("Groq fallback answer"),
            ],
        ) as post:
            answer = main.call_gemini(
                [{"text": "Question"}],
                json_mode=False,
                raise_on_error=True,
            )

        self.assertEqual(answer, "Groq fallback answer")
        self.assertEqual(post.call_count, 2)
        self.assertIn(main.DEFAULT_GEMINI_MODEL, post.call_args_list[0].args[0])
        self.assertEqual(post.call_args_list[1].args[0], main.ai_provider.DEFAULT_GROQ_API_URL)
        self.assertEqual(
            post.call_args_list[1].kwargs["headers"]["Authorization"],
            "Bearer groq-test-key",
        )
        self.assertEqual(main.ai_provider.last_used_provider(), "groq")

    def test_unavailable_gemini_model_returns_actionable_message(self):
        finding_id, _ = create_correction_fixture()

        with patch(
            "main.call_gemini",
            side_effect=main.GeminiAPIError(
                404,
                "NOT_FOUND",
                "Provider model is no longer available.",
            ),
        ):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["status"], "provider_error")
        self.assertIn("GEMINI_MODEL", response.json()["detail"]["message"])
        self.assertIn("gemini-3.1-flash-lite", response.json()["detail"]["message"])

    def test_temporary_gemini_failure_does_not_save_a_correction(self):
        finding_id, _ = create_correction_fixture()

        with patch(
            "main.call_gemini",
            side_effect=main.GeminiAPIError(503, "UNAVAILABLE", "Temporary provider outage."),
        ):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["status"], "provider_error")
        self.assertIn("temporarily unavailable", response.json()["detail"]["message"])
        self.assertIn("No replacement was saved", response.json()["detail"]["message"])
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertFalse(row["suggested_fix"])
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_suggestion_retries_503_within_limit_and_does_not_save_on_outage(self):
        finding_id, _ = create_correction_fixture()
        provider_error = {"error": {"status": "UNAVAILABLE", "message": "provider details"}}
        responses = [
            mock_gemini_response(503, provider_error, {"Retry-After": "2"})
            for _ in range(main.GEMINI_SUGGESTION_MAX_ATTEMPTS)
        ]

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key-not-for-logs"}), \
             patch("main.requests.post", side_effect=responses) as post, \
             patch("main.time.sleep") as sleep, \
             patch("main.random.uniform", side_effect=[0.1, 0.2]) as jitter, \
             self.assertLogs("main", level="WARNING") as captured:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("temporarily unavailable", response.json()["detail"]["message"])
        self.assertEqual(post.call_count, main.GEMINI_SUGGESTION_MAX_ATTEMPTS)
        self.assertEqual(jitter.call_args_list[0].args, (0, 0.5))
        self.assertEqual(jitter.call_args_list[1].args, (0, 1.0))
        self.assertAlmostEqual(sleep.call_args_list[0].args[0], 0.6)
        self.assertAlmostEqual(sleep.call_args_list[1].args[0], 1.2)
        self.assertEqual(len(captured.records), main.GEMINI_SUGGESTION_MAX_ATTEMPTS)
        for attempt, record in enumerate(captured.records, start=1):
            self.assertIn(f"attempt={attempt}/3", record.getMessage())
            self.assertIn("upstream_http_status=503", record.getMessage())
            self.assertIn("google_status=UNAVAILABLE", record.getMessage())
            self.assertIn("category=service_unavailable", record.getMessage())
            self.assertIn("elapsed_ms=", record.getMessage())
            self.assertIn("retry_after=2s", record.getMessage())
            self.assertNotIn("test-key-not-for-logs", record.getMessage())
            self.assertNotIn("provider details", record.getMessage())
            self.assertNotIn("Our product is 100% organic.", record.getMessage())
        for request_call in post.call_args_list:
            self.assertEqual(request_call.kwargs["timeout"][0], 5.0)
            self.assertAlmostEqual(request_call.kwargs["timeout"][1], 30.0, places=2)
            self.assertTrue(request_call.kwargs["stream"])
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertFalse(row["suggested_fix"])
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_suggestion_timing_logs_cover_phases_without_private_content(self):
        private_copy = "Private diagnostic copy 100% organic."
        private_rule = "Private approved source confirms 95% certified organic extracts."
        finding_id, _ = create_correction_fixture(
            document_text=private_copy,
            approved_statement=private_rule,
            exact_quote="95% certified organic extracts",
        )
        response_body = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": private_rule,
            "explanation": "The original phrase makes an unsupported claim.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Replaces the unsupported claim.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch.dict(os.environ, {"GEMINI_API_KEY": "private-test-key"}), \
             patch(
                 "main.requests.post",
                 return_value=mock_gemini_response(
                     200,
                     {"candidates": [{"content": {"parts": [{"text": json.dumps(response_body)}]}}]},
                 ),
             ), \
             patch("main.time.sleep") as sleep, \
             self.assertLogs("main", level="INFO") as captured:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        sleep.assert_not_called()
        messages = [record.getMessage() for record in captured.records]
        for phase in (
            "db_lookup",
            "prompt_construction",
            "response_parse_validation",
            "deterministic_validation",
            "persistence",
            "total",
        ):
            self.assertTrue(any(f"phase={phase}" in message for message in messages), phase)
        self.assertTrue(any("upstream_http_status=200" in message for message in messages))
        combined_logs = "\n".join(messages)
        for sensitive_value in (private_copy, private_rule, "private-test-key", "REQUEST_CONTEXT_JSON"):
            self.assertNotIn(sensitive_value, combined_logs)
        for message in messages:
            if "phase=" in message or "upstream_http_status=" in message:
                self.assertRegex(message, r"(duration_ms|elapsed_ms)=\d+")

    def test_gemini_retries_503_once_then_accepts_success(self):
        failed_response = mock_gemini_response(503, {"error": {"status": "UNAVAILABLE"}})
        successful_response = mock_gemini_response(
            200,
            {"candidates": [{"content": {"parts": [{"text": '{"ok":true}'}]}}]},
        )

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
             patch("main.requests.post", side_effect=[failed_response, successful_response]) as post, \
             patch("main.time.sleep") as sleep, \
             patch("main.random.uniform", return_value=0.125):
            result = main.call_gemini(
                [{"text": "safe test content"}],
                timeout=(5.0, 30.0),
                raise_on_error=True,
                retry_transient_503=True,
                overall_timeout=main.GEMINI_SUGGESTION_TIMEOUT_SECONDS,
            )

        self.assertEqual(result, '{"ok":true}')
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once_with(0.625)

    def test_gemini_retry_jitter_does_not_exceed_remaining_budget(self):
        response = mock_gemini_response(503, {"error": {"status": "UNAVAILABLE"}})
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
             patch("main.requests.post", return_value=response) as post, \
             patch("main.time.monotonic", return_value=0.0), \
             patch("main.time.sleep") as sleep, \
             patch("main.random.uniform", return_value=0.2):
            with self.assertRaises(main.ai_provider.AIProviderError):
                main.call_gemini(
                    [{"text": "safe test content"}],
                    timeout=(5.0, 30.0),
                    raise_on_error=True,
                    retry_transient_503=True,
                    overall_timeout=0.5,
                )

        post.assert_called_once()
        sleep.assert_not_called()

    def test_gemini_does_not_retry_non_503_errors(self):
        rejected_response = mock_gemini_response(429, {"error": {"status": "RESOURCE_EXHAUSTED"}})

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
             patch("main.requests.post", return_value=rejected_response) as post, \
             patch("main.time.sleep") as sleep:
            with self.assertRaises(main.ai_provider.AIProviderError) as raised:
                main.call_gemini(
                    [{"text": "safe test content"}],
                    raise_on_error=True,
                    retry_transient_503=True,
                    overall_timeout=main.GEMINI_SUGGESTION_TIMEOUT_SECONDS,
                )

        post.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual(raised.exception.status_code, 429)

    def test_malformed_gemini_response_is_rejected_without_fallback(self):
        finding_id, _ = create_correction_fixture()

        with patch("main.call_gemini", return_value='{"status":"suggestion_ready"}'):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["status"], "invalid_suggestion")
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertFalse(row["suggested_fix"])
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_suggestion_that_still_matches_active_rules_is_not_ready(self):
        finding_id, document_id = create_correction_fixture()
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "A replacement was drafted.",
            "replacement_text": "100% organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertEqual(response.json()["replacement_text"], "")
        connection = database.get_db()
        try:
            finding = connection.execute(
                "SELECT suggested_fix, suggestion_status, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(finding["suggested_fix"], "")
            self.assertEqual(finding["suggestion_status"], "no_safe_replacement")
            self.assertEqual(finding["status"], "open")
            self.assertEqual(document["text_content"], "Our product is 100% organic.")
        finally:
            connection.close()

        approved = client.post(
            "/api/ai/fix",
            json={
                "finding_id": finding_id,
                "flagged_text": "100% organic",
                "replacement_text": "95% certified organic extracts",
                "current_doc_text": "Our product is 100% organic.",
            },
        )
        self.assertEqual(approved.status_code, 200)
        connection = database.get_db()
        try:
            document = connection.execute(
                "SELECT status, unresolved_count FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(document["status"], "Compliant")
            self.assertEqual(document["unresolved_count"], 0)
        finally:
            connection.close()

    def test_identical_validated_suggestion_is_reused_without_another_ai_call(self):
        finding_id, _ = create_correction_fixture()
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "The wording follows the configured source.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Uses the source-backed wording.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch(
            "main.requests.post",
            return_value=mock_gemini_response(
                200,
                {"candidates": [{"content": {"parts": [{"text": json.dumps(model_response)}]}}]},
            ),
        ) as post:
            first = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )
            second = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["replacement_text"], "95% certified organic extracts")
        post.assert_called_once()

    def test_groq_correction_uses_the_same_validation_and_requires_user_approval(self):
        finding_id, document_id = create_correction_fixture()
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "The wording follows the configured source.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Uses the source-backed wording.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GROQ_API_KEY": "groq-test-key"}), patch(
            "main.requests.post",
            return_value=mock_groq_response(json.dumps(model_response)),
        ) as post:
            suggestion = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(suggestion.status_code, 200)
        self.assertEqual(suggestion.json()["status"], "suggestion_ready")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer groq-test-key")
        connection = database.get_db()
        try:
            finding = connection.execute(
                "SELECT suggested_fix, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(finding["suggested_fix"], "95% certified organic extracts")
            self.assertEqual(finding["status"], "open")
            self.assertEqual(document["text_content"], "Our product is 100% organic.")
        finally:
            connection.close()

        applied = client.post(
            "/api/ai/fix",
            json={
                "finding_id": finding_id,
                "flagged_text": "100% organic",
                "replacement_text": suggestion.json()["replacement_text"],
                "current_doc_text": "Our product is 100% organic.",
            },
        )
        self.assertEqual(applied.status_code, 200)
        self.assertEqual(applied.json()["status"], "success")
        connection = database.get_db()
        try:
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(
                document["text_content"],
                "Our product is 95% certified organic extracts.",
            )
        finally:
            connection.close()

    def test_groq_correction_failing_deterministic_check_is_not_saved_ready(self):
        finding_id, _ = create_correction_fixture()
        invalid = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "A replacement was drafted.",
            "replacement_text": "100% organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch.dict(os.environ, {
            "GEMINI_API_KEY": "gemini-test-key",
            "GROQ_API_KEY": "groq-test-key",
            "AI_PRIMARY_PROVIDER": "groq",
            "AI_FALLBACK_PROVIDER": "gemini",
        }), patch(
            "main.requests.post",
            return_value=mock_groq_response(json.dumps(invalid)),
        ) as post:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertEqual(
            response.json()["draft_replacement_text"],
            "100% organic extracts",
        )
        post.assert_called_once()
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, suggestion_status, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertEqual(row["suggested_fix"], "")
            self.assertEqual(row["suggestion_status"], "no_safe_replacement")
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_apply_rechecks_replacement_before_resolving_finding(self):
        finding_id, document_id = create_correction_fixture()
        response = client.post(
            "/api/ai/fix",
            json={
                "finding_id": finding_id,
                "flagged_text": "100% organic",
                "replacement_text": "100% organic extracts",
                "current_doc_text": "Our product is 100% organic.",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("does not pass", response.json()["detail"])
        connection = database.get_db()
        try:
            finding = connection.execute(
                "SELECT status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(finding["status"], "open")
            self.assertEqual(document["text_content"], "Our product is 100% organic.")
        finally:
            connection.close()

    def test_required_disclaimer_missing_before_the_edit_does_not_block_the_correction(self):
        requirement = (
            "Specification confirms 95% certified organic extracts. "
            "Never claim 100% without certification. "
            'Must include the disclaimer "Results may vary."'
        )
        finding_id, document_id = create_correction_fixture(
            approved_statement=requirement,
        )
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": requirement,
            "explanation": "The original percentage exceeds the configured evidence.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Uses the percentage in the configured approved claim.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)) as gemini:
            suggestion = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )
        self.assertEqual(suggestion.status_code, 200)
        body = suggestion.json()
        self.assertEqual(body["status"], "suggestion_ready")
        self.assertEqual(body["replacement_text"], "95% certified organic extracts")
        self.assertIn("Results may vary", body["explanation"])
        prompt = gemini.call_args.args[0][0]["text"]
        self.assertIn("required_wording", prompt)
        self.assertIn("Results may vary.", prompt)
        self.assertIn("prohibited_wording", prompt)

        applied = client.post(
            "/api/ai/fix",
            json={
                "finding_id": finding_id,
                "flagged_text": "100% organic",
                "replacement_text": "95% certified organic extracts",
                "current_doc_text": "Our product is 100% organic.",
            },
        )
        self.assertEqual(applied.status_code, 200)
        self.assertEqual(
            applied.json()["updated_text"],
            "Our product is 95% certified organic extracts.",
        )
        self.assertEqual(
            [item["phrase"] for item in applied.json()["recheck"]["outstanding_required_wording"]],
            ["Results may vary."],
        )
        connection = database.get_db()
        try:
            finding = connection.execute(
                "SELECT status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            self.assertEqual(finding["status"], "resolved")
            self.assertEqual(
                document["text_content"],
                "Our product is 95% certified organic extracts.",
            )
        finally:
            connection.close()

    def test_rule_phrase_matching_respects_exactness_whitespace_and_punctuation(self):
        exact_rule = {
            "id": "default-exact",
            "title": "Exact disclosure",
            "approved_statement": 'Must include the exact phrase "Results may vary."',
        }
        flexible_rule = {
            "id": "custom-flexible",
            "title": "Flexible disclosure",
            "approved_statement": 'Must include the phrase "Consult your specialist."',
        }

        self.assertEqual(
            main._missing_required_phrases("results   may vary.", [exact_rule]),
            [{
                "rule_id": "default-exact",
                "phrase": "Results may vary.",
                "title": "Exact disclosure",
                "exact_case": True,
            }],
        )
        self.assertEqual(
            main._missing_required_phrases("Results\tmay  vary.", [exact_rule]),
            [],
        )
        self.assertEqual(
            main._missing_required_phrases("consult   your specialist.", [flexible_rule]),
            [],
        )
        self.assertEqual(
            len(main._missing_required_phrases("Results may vary!", [exact_rule])),
            1,
        )

        findings = main.deterministic_rule_audit(
            "FLASH   SALE for $49.",
            [
                {"id": "pdf-rule", "title": "Offer", "forbidden_terms": "flash sale"},
                {"id": "custom-price", "title": "Price", "forbidden_terms": "$49"},
            ],
        )
        self.assertEqual({finding["rule_id"] for finding in findings}, {"pdf-rule", "custom-price"})

    def test_br01_required_phrase_does_not_capture_later_prohibited_phrase(self):
        br01 = {
            "id": "BR-01",
            "title": "No Absolute Medical Reversal Claims",
            "rule_type": "default",
            "approved_statement": (
                "Cosmetic products must state 'reduces appearance of fine lines', "
                "never 'reverses aging'."
            ),
            "forbidden_terms": "reverse aging,cure,permanently",
            "status": "active",
        }

        self.assertEqual(
            main._rule_required_phrase_specs(br01),
            [{"phrase": "reduces appearance of fine lines", "exact_case": False}],
        )
        self.assertEqual(main._rule_constraint_conflicts([br01]), [])
        self.assertFalse(main._rule_has_unresolved_requirement(br01))
        self.assertFalse(
            main._correction_rule_issues(
                "reduces appearance of fine lines",
                "Our serum reduces appearance of fine lines.",
                [br01],
            )
        )
        self.assertTrue(
            main.deterministic_rule_audit("reverses aging", [br01])
        )

    def test_required_wording_blocks_only_when_the_edit_removes_it(self):
        br01 = {
            "id": "BR-01",
            "title": "No Absolute Medical Reversal Claims",
            "rule_type": "default",
            "approved_statement": (
                "Cosmetic products must state 'reduces appearance of fine lines', "
                "never 'reverses aging'."
            ),
            "forbidden_terms": "reverse aging,cure,permanently",
            "status": "active",
        }

        already_missing = main._correction_rule_issues(
            "leaves skin feeling soft",
            "Our serum leaves skin feeling soft.",
            [br01],
            baseline_document="Our serum smooths skin.",
        )
        self.assertEqual(
            [issue for issue in already_missing if issue["kind"] == "required"],
            [],
        )

        removed = main._correction_rule_issues(
            "leaves skin feeling soft",
            "Our serum leaves skin feeling soft.",
            [br01],
            baseline_document="Our serum reduces appearance of fine lines.",
        )
        required = [issue for issue in removed if issue["kind"] == "required"]
        self.assertEqual(len(required), 1)
        self.assertEqual(required[0]["phrase"], "reduces appearance of fine lines")
        self.assertIn("must include the required wording", " ".join(
            main._correction_issue_messages(removed)
        ))

        without_baseline = main._correction_rule_issues(
            "leaves skin feeling soft",
            "Our serum leaves skin feeling soft.",
            [br01],
        )
        self.assertTrue(
            any(issue["kind"] == "required" for issue in without_baseline)
        )

    def test_unstructured_exact_wording_requirement_is_marked_for_review(self):
        rule = {
            "id": "custom-review",
            "title": "Unspecified exact wording",
            "approved_statement": "Must include the exact wording.",
            "forbidden_terms": "",
        }

        self.assertTrue(main._rule_has_unresolved_requirement(rule))
        issue_messages = main._correction_issue_messages(
            main._correction_rule_issues("ordinary copy", "ordinary copy", [rule])
        )
        self.assertTrue(any("custom-review" in message for message in issue_messages))
        self.assertTrue(any("clarify the rule" in message for message in issue_messages))

    def test_br03_is_a_price_deadline_condition_not_a_fixed_required_phrase(self):
        br03 = {
            "id": "BR-03",
            "title": "Promotional Price Expiration Mandate",
            "rule_type": "default",
            "approved_statement": (
                "Promotional flash sale prices (e.g. $49) must state clear expiration deadline."
            ),
            "forbidden_terms": "flash promo,$49",
            "status": "active",
        }

        self.assertEqual(main._rule_required_phrase_specs(br03), [])
        self.assertFalse(main._rule_has_unresolved_requirement(br03))
        self.assertFalse(main._rule_has_unresolved_condition(br03))

    def test_candidate_rule_is_not_used_for_correction_generation(self):
        finding_id, _ = create_correction_fixture()
        connection = database.get_db()
        try:
            connection.execute(
                "UPDATE brand_rules SET status = 'candidate' WHERE id = ?",
                ("correction-rule",),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini") as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertIn("no longer active", response.json()["explanation"])
        gemini.assert_not_called()

    def test_generator_receives_current_default_imported_and_custom_rules(self):
        finding_id, _ = create_correction_fixture()
        connection = database.get_db()
        try:
            connection.execute(
                "UPDATE brand_rules SET rule_type = 'default' WHERE id = ?",
                ("correction-rule",),
            )
            for rule_id, title, rule_type, statement, terms, scope, quote, status in (
                ("pdf-rule", "Imported offer rule", "brandbook", "State the approved offer.", "$777", "Campaign", "Original offer quotation", "active"),
                ("custom-rule", "Custom disclaimer rule", "custom", "Keep claims supportable.", "guaranteed results", "Product", "User-confirmed custom source", "active"),
                ("candidate-rule", "Unapproved candidate", "brandbook", "Never use draft wording.", "draft wording", "Global", "Unapproved source quote", "candidate"),
            ):
                connection.execute(
                    """
                    INSERT INTO brand_rules
                        (id, title, rule_category, rule_type, approved_statement,
                         forbidden_terms, scope, exact_quote, status)
                    VALUES (?, ?, 'Test', ?, ?, ?, ?, ?, ?)
                    """,
                    (rule_id, title, rule_type, statement, terms, scope, quote, status),
                )
            connection.commit()
        finally:
            connection.close()

        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "Uses the source-backed approved wording.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Replaces only the flagged claim.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch(
            "main.call_gemini",
            return_value=json.dumps(model_response),
        ) as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "suggestion_ready")
        prompt = gemini.call_args.args[0][0]["text"]
        for expected in (
            "correction-rule",
            "pdf-rule",
            "Imported offer rule",
            "Original offer quotation",
            "custom-rule",
            "User-confirmed custom source",
            "scope",
            "requirement_and_conditions",
        ):
            self.assertIn(expected, prompt)
        self.assertNotIn("candidate-rule", prompt)

    def test_approved_pdf_imported_rule_is_used_in_correction_checks(self):
        finding_id, _ = create_correction_fixture()
        source_text = "Never use promo code in marketing copy."
        pdf = fitz.open()
        page = pdf.new_page()
        page.insert_text((50, 50), source_text)
        pdf_bytes = pdf.tobytes()
        pdf.close()
        extracted_rule = {
            "title": "PDF promo restriction",
            "rule_category": "Promotional claims",
            "approved_statement": source_text,
            "forbidden_terms": "promo code",
            "scope": "Global",
            "severity": "high",
            "effective_date": "2026-10-30",
            "expires_at": None,
            "source_filename": "uploaded-policy.pdf",
            "source_page": 1,
            "exact_quote": source_text,
        }

        with patch("main.extract_candidate_rules_from_text", return_value=[extracted_rule]), \
             patch("main._candidate_conflicts_with_active_rules"):
            imported = client.post(
                "/api/rules/brandbook/upload",
                data={"target_type": "custom"},
                files={"file": ("uploaded-policy.pdf", pdf_bytes, "application/pdf")},
            )

        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["extracted_count"], 1)
        rule_id = imported.json()["candidates"][0]["id"]
        activated = client.post(
            f"/api/rules/custom/update/{rule_id}",
            json={"status": "active"},
        )
        self.assertEqual(activated.status_code, 200)

        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "Draft proposal.",
            "replacement_text": "promo code for 95% certified organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch("main.call_gemini", return_value=json.dumps(model_response)) as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertIn(rule_id, " ".join(response.json()["missing_information"]))
        self.assertIn(rule_id, gemini.call_args.args[0][0]["text"])
        connection = database.get_db()
        try:
            saved = connection.execute(
                "SELECT suggested_fix, suggestion_status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertEqual(saved["suggested_fix"], "")
            self.assertEqual(saved["suggestion_status"], "no_safe_replacement")
        finally:
            connection.close()

    def test_second_active_rule_failure_is_reported_and_not_saved(self):
        finding_id, _ = create_correction_fixture()
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("custom-restriction", "Organic wording", "Claims", "custom", "Use approved claims.", "certified organic", "active"),
            )
            connection.commit()
        finally:
            connection.close()
        response_body = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "Draft proposal.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(response_body)) as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertIn("custom-restriction", " ".join(response.json()["missing_information"]))
        self.assertIn("certified organic", " ".join(response.json()["missing_information"]))
        self.assertIn("custom-restriction", gemini.call_args.args[0][0]["text"])
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, suggestion_status, status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertEqual(row["suggested_fix"], "")
            self.assertEqual(row["suggestion_status"], "no_safe_replacement")
            self.assertEqual(row["status"], "open")
        finally:
            connection.close()

    def test_conflicting_required_and_prohibited_rules_request_review_before_ai(self):
        finding_id, _ = create_correction_fixture()
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("requirement-rule", "Required promise", "Claims", "brandbook", 'Must include the exact phrase "We guarantee results."', "", "active"),
            )
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("restriction-rule", "No guarantees", "Claims", "custom", "Avoid unsupported guarantees.", "guarantee", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini") as gemini:
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        feedback = " ".join(response.json()["missing_information"])
        self.assertIn("requirement-rule", feedback)
        self.assertIn("restriction-rule", feedback)
        self.assertIn("review the conflicting rules", feedback)
        gemini.assert_not_called()
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, suggestion_status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertEqual(row["suggested_fix"], "")
            self.assertEqual(row["suggestion_status"], "no_safe_replacement")
        finally:
            connection.close()

    def test_retry_prompt_receives_previous_rule_specific_validation_feedback(self):
        finding_id, _ = create_correction_fixture()
        invalid = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "Initial proposal.",
            "replacement_text": "100% organic extracts",
            "change_summary": "Initial proposal.",
            "missing_information": [],
            "requires_human_review": True,
        }
        valid = {
            **invalid,
            "replacement_text": "95% certified organic extracts",
            "explanation": "Revised proposal.",
            "change_summary": "Uses the source-backed wording.",
        }
        with patch(
            "main.call_gemini",
            side_effect=[json.dumps(invalid), json.dumps(valid)],
        ) as gemini:
            first = client.post("/api/ai/suggest-correction", json={"finding_id": finding_id})
            second = client.post("/api/ai/suggest-correction", json={"finding_id": finding_id})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["status"], "no_safe_replacement")
        self.assertIn("correction-rule", " ".join(first.json()["missing_information"]))
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["status"], "suggestion_ready")
        retry_prompt = gemini.call_args_list[1].args[0][0]["text"]
        self.assertIn("previous_validation_feedback", retry_prompt)
        self.assertIn("remove prohibited wording", retry_prompt)
        self.assertIn("correction-rule", retry_prompt)

    def test_conditional_restriction_without_verified_exception_is_rejected(self):
        finding_id, _ = create_correction_fixture(
            approved_statement="Never claim clinical improvement unless supported by a current study.",
            forbidden_terms="clinically proven",
            exact_quote="Current approved copy contains no clinical study evidence.",
        )
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim clinical improvement unless supported by a current study.",
            "explanation": "The wording is acceptable because the exception is met.",
            "replacement_text": "clinically proven organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_safe_replacement")
        self.assertIn("correction-rule", " ".join(response.json()["missing_information"]))
        self.assertIn("clinically proven", " ".join(response.json()["missing_information"]))

    def test_rule_update_is_used_by_the_next_correction_validation(self):
        finding_id, _ = create_correction_fixture()
        first_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "Uses approved wording.",
            "replacement_text": "95% certified organic extracts",
            "change_summary": "Reworded the claim.",
            "missing_information": [],
            "requires_human_review": True,
        }
        with patch("main.call_gemini", return_value=json.dumps(first_response)):
            first = client.post("/api/ai/suggest-correction", json={"finding_id": finding_id})
        self.assertEqual(first.json()["status"], "suggestion_ready")

        connection = database.get_db()
        try:
            connection.execute(
                "UPDATE brand_rules SET forbidden_terms = 'certified organic' WHERE id = ?",
                ("correction-rule",),
            )
            connection.commit()
        finally:
            connection.close()

        with patch("main.call_gemini", return_value=json.dumps(first_response)) as gemini:
            second = client.post("/api/ai/suggest-correction", json={"finding_id": finding_id})

        self.assertEqual(second.json()["status"], "no_safe_replacement")
        self.assertIn("certified organic", " ".join(second.json()["missing_information"]))
        self.assertIn("certified organic", gemini.call_args.args[0][0]["text"])

    def test_unsupported_new_number_is_withheld_and_requests_information(self):
        finding_id, _ = create_correction_fixture()
        model_response = {
            "status": "suggestion_ready",
            "original_text": "100% organic",
            "rule_id": "correction-rule",
            "rule_violated": "Never claim 100% without certification.",
            "explanation": "An alternative percentage is not supported by the source.",
            "replacement_text": "80% certified organic extracts",
            "change_summary": "Would replace the original percentage.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "needs_information")
        self.assertEqual(response.json()["replacement_text"], "")
        self.assertTrue(response.json()["missing_information"])
        connection = database.get_db()
        try:
            row = connection.execute(
                "SELECT suggested_fix, suggestion_status FROM findings WHERE id = ?",
                (finding_id,),
            ).fetchone()
            self.assertEqual(row["suggested_fix"], "")
            self.assertEqual(row["suggestion_status"], "needs_information")
        finally:
            connection.close()

    def test_unsupported_non_numeric_claim_terms_are_withheld(self):
        finding_id, _ = create_correction_fixture(
            approved_statement="Do not make unsupported improvement claims.",
            forbidden_terms="guaranteed",
            flagged_text="guaranteed",
            document_text="Our product is guaranteed.",
            exact_quote="",
        )
        model_response = {
            "status": "suggestion_ready",
            "original_text": "guaranteed",
            "rule_id": "correction-rule",
            "rule_violated": "Do not make unsupported improvement claims.",
            "explanation": "The original promise lacks supporting evidence.",
            "replacement_text": "gentle and effective skincare",
            "change_summary": "Would replace the unsupported guarantee.",
            "missing_information": [],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "needs_information")
        self.assertEqual(response.json()["replacement_text"], "")
        self.assertIn("effective", response.json()["missing_information"][0])

    def test_model_needs_information_status_is_returned_without_replacement(self):
        finding_id, _ = create_correction_fixture(
            approved_statement="Do not make unsupported improvement claims.",
            forbidden_terms="guaranteed",
            flagged_text="guaranteed",
            document_text="Our product is guaranteed.",
            exact_quote="",
        )
        model_response = {
            "status": "needs_information",
            "original_text": "guaranteed",
            "rule_id": "correction-rule",
            "rule_violated": "Do not make unsupported improvement claims.",
            "explanation": "The provided rule does not establish a supported product benefit.",
            "replacement_text": "",
            "change_summary": "No replacement can be safely drafted.",
            "missing_information": ["Provide an approved, evidence-backed product claim."],
            "requires_human_review": True,
        }

        with patch("main.call_gemini", return_value=json.dumps(model_response)):
            response = client.post(
                "/api/ai/suggest-correction",
                json={"finding_id": finding_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "needs_information")
        self.assertEqual(response.json()["replacement_text"], "")
        self.assertEqual(
            response.json()["missing_information"],
            ["Provide an approved, evidence-backed product claim."],
        )

    def test_unreadable_image_ocr_is_incomplete_not_compliant(self):
        image_buffer = io.BytesIO()
        Image.new("RGB", (10, 10), "white").save(image_buffer, format="PNG")

        with patch("main.extract_visual_text_with_gemini", return_value="") as ocr, \
             patch("main.call_gemini", side_effect=AssertionError("Failed OCR must not trigger compliance analysis")) as gemini:
            response = client.post(
                "/api/intake",
                files={"file": ("unreadable.png", image_buffer.getvalue(), "image/png")},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "Incomplete Analysis")
        self.assertIn("not checked against the active rules", body["error_message"])
        ocr.assert_called_once()
        gemini.assert_not_called()

    def test_surgical_correction_preserves_surrounding_copy_and_rejects_reuse(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("rule-price", "Price wording", "Pricing", "State the approved offer terms.", "$49", "active"),
            )
            connection.execute(
                "INSERT INTO documents (id, filename, text_content, status) VALUES (?, ?, ?, ?)",
                ("doc-test", "copy.txt", "Promotional flash sale is available for $49 today.", "Exceptions Found"),
            )
            connection.execute(
                "INSERT INTO findings (id, document_id, rule_id, flagged_text, status) VALUES (?, ?, ?, ?, ?)",
                ("finding-test", "doc-test", "rule-price", "$49", "open"),
            )
            connection.commit()
        finally:
            connection.close()

        payload = {
            "finding_id": "finding-test",
            "flagged_text": "$49",
            "replacement_text": "a limited-time price",
            "current_doc_text": "Promotional flash sale is available for $49 today.",
        }
        first = client.post("/api/ai/fix", json=payload)
        second = client.post("/api/ai/fix", json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(
            first.json()["updated_text"],
            "Promotional flash sale is available for a limited-time price today.",
        )

    def test_rule_statement_cannot_be_inserted_as_advertisement_copy(self):
        rule_statement = "Never claim 100% without certification."
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("rule-test", "Term rule", "Brand", "custom", rule_statement, "100%", "active"),
            )
            connection.execute(
                "INSERT INTO documents (id, filename, text_content, status) VALUES (?, ?, ?, ?)",
                ("doc-rule-fix", "copy.txt", "Our success rate is 100%.", "Exceptions Found"),
            )
            connection.execute(
                """
                INSERT INTO findings
                    (id, document_id, rule_id, flagged_text, suggested_fix, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("finding-rule-fix", "doc-rule-fix", "rule-test", "100%", rule_statement, "open"),
            )
            connection.commit()
        finally:
            connection.close()

        response = client.post(
            "/api/ai/fix",
            json={
                "finding_id": "finding-rule-fix",
                "flagged_text": "100%",
                "replacement_text": rule_statement,
                "current_doc_text": "Our success rate is 100%.",
            },
        )
        self.assertEqual(response.status_code, 422)
        connection = database.get_db()
        try:
            document = connection.execute(
                "SELECT text_content FROM documents WHERE id = ?",
                ("doc-rule-fix",),
            ).fetchone()
            finding = connection.execute(
                "SELECT status FROM findings WHERE id = ?",
                ("finding-rule-fix",),
            ).fetchone()
            self.assertEqual(document["text_content"], "Our success rate is 100%.")
            self.assertEqual(finding["status"], "open")
        finally:
            connection.close()

    def test_bulk_capacity_rejects_over_limit(self):
        response = client.post(
            "/api/bulk/capacity",
            json={"file_count": 1, "total_size": 50 * 1024 * 1024 + 1},
        )
        self.assertEqual(response.status_code, 413)

    def test_custom_rule_update_rejects_blank_title(self):
        created = client.post(
            "/api/rules/custom",
            json={
                "title": "Required title",
                "rule_category": "Brand",
                "approved_statement": "Keep approved claims accurate.",
            },
        )
        self.assertEqual(created.status_code, 200)
        rule_id = created.json()["rule_id"]

        updated = client.post(
            f"/api/rules/custom/update/{rule_id}",
            json={"title": "   "},
        )
        self.assertEqual(updated.status_code, 422)

    def test_blank_ai_question_is_rejected(self):
        response = client.post("/api/ai/ask", json={"question": " \n "})
        self.assertEqual(response.status_code, 422)

    def test_image_extraction_without_ai_does_not_claim_success(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GROQ_API_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "No AI provider API key"):
                engine.extract_text_from_file(b"image-bytes", "creative.png")

    def test_existing_database_migration_adds_file_reference_without_losing_rows(self):
        previous_db_file = database.DB_FILE
        with tempfile.TemporaryDirectory() as directory:
            legacy_db_file = os.path.join(directory, "legacy.db")
            connection = sqlite3.connect(legacy_db_file)
            connection.execute(
                "CREATE TABLE documents (id TEXT PRIMARY KEY, filename TEXT)"
            )
            connection.execute(
                "INSERT INTO documents (id, filename) VALUES (?, ?)",
                ("legacy-doc", "original.txt"),
            )
            connection.commit()
            connection.close()

            try:
                database.DB_FILE = legacy_db_file
                database.init_db()
                connection = database.get_db()
                try:
                    row = connection.execute(
                        "SELECT id, filename, file_path FROM documents WHERE id = ?",
                        ("legacy-doc",),
                    ).fetchone()
                    self.assertEqual(row["filename"], "original.txt")
                    self.assertIsNone(row["file_path"])
                finally:
                    connection.close()
            finally:
                database.DB_FILE = previous_db_file

    def test_upload_path_rejects_traversal(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            main._stored_upload_path("..\\outside.txt")

    def test_pdf_text_extraction_does_not_render_pages_for_ai_review(self):
        source = fitz.open()
        page = source.new_page(width=10_000, height=10_000)
        page.insert_text((72, 72), "A deterministic phrase.")
        pdf_bytes = source.tobytes()
        source.close()

        with patch.object(fitz.Page, "get_pixmap", side_effect=AssertionError("PDF must not be rasterized")):
            pages, text = main.extract_pdf_pages_and_text(pdf_bytes)
        self.assertIn("A deterministic phrase.", text)
        self.assertIsNone(pages[0]["image"])

    def test_scanned_pdf_page_is_ocrd_then_checked_against_active_rules(self):
        connection = database.get_db()
        try:
            connection.execute(
                """
                INSERT INTO brand_rules
                    (id, title, rule_category, rule_type, approved_statement, forbidden_terms, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("scan-rule", "Prohibited claim", "Claims", "custom", "Do not use guaranteed.", "guaranteed", "active"),
            )
            connection.commit()
        finally:
            connection.close()

        image_buffer = io.BytesIO()
        Image.new("RGB", (300, 120), "white").save(image_buffer, format="PNG")
        source = fitz.open()
        page = source.new_page()
        page.insert_image(page.rect, stream=image_buffer.getvalue())
        pdf_bytes = source.tobytes()
        source.close()

        with patch("main.extract_visual_text_with_gemini", return_value="This product is guaranteed.") as ocr, \
             patch("main.call_gemini", return_value="[]") as semantic:
            response = client.post(
                "/api/intake",
                files={"file": ("scanned-claim.pdf", pdf_bytes, "application/pdf")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Exceptions Found")
        self.assertEqual(response.json()["findings"][0]["flagged_text"].lower(), "guaranteed")
        ocr.assert_called_once()
        semantic.assert_called_once()

    def test_docx_extraction_includes_table_and_header_text(self):
        from docx import Document

        document = Document()
        document.sections[0].header.paragraphs[0].text = "Brand confidential header"
        document.add_paragraph("Main body copy")
        table = document.add_table(rows=1, cols=1)
        table.cell(0, 0).text = "Prohibited claim in table"
        buffer = io.BytesIO()
        document.save(buffer)

        extracted = main.extract_docx_text(buffer.getvalue())
        self.assertIn("Main body copy", extracted)
        self.assertIn("Prohibited claim in table", extracted)
        self.assertIn("Brand confidential header", extracted)

    def test_scanned_pdf_without_text_remains_incomplete_without_ocr(self):
        source = fitz.open()
        source.new_page()
        pdf_bytes = source.tobytes()
        source.close()

        with patch("main.call_gemini", side_effect=AssertionError("Scanned PDFs must not call Gemini")) as gemini:
            response = client.post(
                "/api/intake",
                files={"file": ("scan.pdf", pdf_bytes, "application/pdf")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Incomplete Analysis")
        self.assertIn("not checked against the active rules", response.json()["error_message"])
        gemini.assert_not_called()


if __name__ == "__main__":
    unittest.main()
