"""
Comprehensive Test Suite for Authentication, Session Management,
Evaluator Demo Access, Organizations, and Multi-Tenant Isolation.

Covers:
- Prompt 03: Email/password authentication, Argon2id hashing, secure sessions,
            evaluator demo account provisioning, public demo configuration, logout.
- Prompt 04: Google Sign-in configuration and validation.
- Prompt 05: Organizations, membership roles, strict multi-tenant data isolation,
            rejection of cross-organization reads/mutations and demo account boundaries.
- Prompt 06: Starter rule templates, activation, and rule status.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

import database
import auth

# Use isolated temp database for tests
_test_dir = tempfile.TemporaryDirectory()
database.DB_FILE = os.path.join(_test_dir.name, "auth_test.db")

import main
from fastapi.testclient import TestClient

database.init_db()


class AuthAndIsolationTests(unittest.TestCase):
    def setUp(self):
        # Fresh test client for each test (isolated cookies)
        self.client = TestClient(main.app)

    def test_01_unauthenticated_request_is_rejected(self):
        """Unauthenticated requests to protected endpoints must return 401."""
        response = self.client.get("/api/rules")
        self.assertEqual(response.status_code, 401)
        self.assertIn("Authentication required", response.json()["detail"])

        response = self.client.post("/api/intake", data={"content": "Sample ad text"})
        self.assertEqual(response.status_code, 401)

    def test_02_registration_hashes_password_and_creates_session(self):
        """Registering a new account stores an Argon2id hash and issues a session."""
        email = "founder@startup.io"
        password = "SecurePassword123!"
        response = self.client.post(
            "/api/auth/register",
            json={"email": email, "password": password, "full_name": "Alice Founder"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["user"]["email"], email)
        self.assertNotIn("password", data["user"])
        self.assertNotIn("password_hash", data["user"])

        # Verify session cookie was set
        self.assertIn("session_id", self.client.cookies)

        # Verify password in database is hashed with Argon2id and never plaintext
        conn = database.get_db()
        try:
            user = auth.get_user_by_email(conn, email)
            self.assertIsNotNone(user)
            self.assertTrue(user["password_hash"].startswith("$argon2id$"))
            self.assertNotEqual(user["password_hash"], password)
            self.assertTrue(auth.verify_password(user["password_hash"], password))
            self.assertFalse(auth.verify_password(user["password_hash"], "WrongPassword!"))
        finally:
            conn.close()

    def test_03_duplicate_registration_is_rejected(self):
        """Duplicate emails must be rejected with 409 Conflict."""
        email = "duplicate@brand.com"
        password = "Password12345!"
        res1 = self.client.post("/api/auth/register", json={"email": email, "password": password})
        self.assertEqual(res1.status_code, 200)

        client2 = TestClient(main.app)
        res2 = client2.post("/api/auth/register", json={"email": email, "password": password})
        self.assertEqual(res2.status_code, 409)
        self.assertIn("already exists", res2.json()["detail"])

    def test_04_weak_password_and_invalid_email_are_rejected(self):
        """Invalid emails or passwords under 8 characters must be rejected."""
        res = self.client.post("/api/auth/register", json={"email": "notanemail", "password": "Password1!"})
        self.assertEqual(res.status_code, 400)

        res2 = self.client.post("/api/auth/register", json={"email": "valid@brand.com", "password": "short"})
        self.assertEqual(res2.status_code, 400)
        self.assertIn("8 characters", res2.json()["detail"])

    def test_05_login_with_correct_credentials_and_safe_rejections(self):
        """Valid login succeeds; wrong credentials return generic 401."""
        email = "team@brand.com"
        password = "MyPassword2026!"
        self.client.post("/api/auth/register", json={"email": email, "password": password})

        login_client = TestClient(main.app)
        # Bad password
        bad_res = login_client.post("/api/auth/login", json={"email": email, "password": "WrongPassword"})
        self.assertEqual(bad_res.status_code, 401)
        self.assertIn("Invalid email or password", bad_res.json()["detail"])

        # Unknown email
        unknown_res = login_client.post("/api/auth/login", json={"email": "ghost@brand.com", "password": password})
        self.assertEqual(unknown_res.status_code, 401)

        # Correct login
        good_res = login_client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(good_res.status_code, 200)
        self.assertIn("session_id", login_client.cookies)

    def test_06_session_restore_and_logout(self):
        """Logged-in session restores user profile and is invalidated on logout."""
        email = "restorable@brand.com"
        password = "RestorePassword1!"
        self.client.post("/api/auth/register", json={"email": email, "password": password})

        # Profile check
        me_res = self.client.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()["user"]["email"], email)

        # Logout
        logout_res = self.client.post("/api/auth/logout")
        self.assertEqual(logout_res.status_code, 200)

        # After logout, accessing protected endpoints must return 401
        after_res = self.client.get("/api/auth/me")
        self.assertEqual(after_res.status_code, 401)

    def test_07_evaluator_demo_configuration_endpoint(self):
        """Demo endpoint returns public credentials only when enabled, never secrets."""
        # 1. When disabled
        with patch.dict(os.environ, {"DEMO_ACCOUNT_ENABLED": "false"}):
            res = self.client.get("/api/auth/demo-config")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertFalse(data["demo_enabled"])
            self.assertIsNone(data["demo_email"])
            self.assertIsNone(data["demo_password"])

        # 2. When enabled with valid env vars
        with patch.dict(os.environ, {
            "DEMO_ACCOUNT_ENABLED": "true",
            "DEMO_EMAIL": "evaluator@demo.test",
            "DEMO_PASSWORD": "DemoPassword2026!",
            "DEMO_ORGANIZATION_NAME": "Before It Goes Live Demo Workspace",
        }):
            res = self.client.get("/api/auth/demo-config")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["demo_enabled"])
            self.assertEqual(data["demo_email"], "evaluator@demo.test")
            self.assertEqual(data["demo_password"], "DemoPassword2026!")
            self.assertEqual(data["organization_name"], "Before It Goes Live Demo Workspace")

        # 3. When enabled via DEMO_LOGIN_ENABLED
        with patch.dict(os.environ, {
            "DEMO_LOGIN_ENABLED": "true",
            "DEMO_EMAIL": "judge@hackathon.org",
            "DEMO_PASSWORD": "JudgePassword2026!",
        }):
            res = self.client.get("/api/auth/demo-config")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["demo_enabled"])
            self.assertEqual(data["demo_email"], "judge@hackathon.org")
            self.assertEqual(data["demo_password"], "JudgePassword2026!")

    def test_08_evaluator_demo_provisioning_and_login_flow(self):
        """Demo account is provisioned idempotently and can log in without typing."""
        with patch.dict(os.environ, {
            "DEMO_ACCOUNT_ENABLED": "true",
            "DEMO_EMAIL": "evaluator@demo.local",
            "DEMO_PASSWORD": "DemoLogin1234!",
            "DEMO_ORGANIZATION_NAME": "Demo Evaluation Brand",
        }):
            conn = database.get_db()
            auth.provision_demo_account(conn)
            conn.close()

            # Client reads public config
            cfg = self.client.get("/api/auth/demo-config").json()
            self.assertTrue(cfg["demo_enabled"])

            # Client logs in using pre-filled credentials
            login_res = self.client.post(
                "/api/auth/login",
                json={"email": cfg["demo_email"], "password": cfg["demo_password"]},
            )
            self.assertEqual(login_res.status_code, 200)
            data = login_res.json()
            self.assertTrue(data["user"]["is_demo"])
            self.assertEqual(data["active_organization"]["name"], "Demo Evaluation Brand")

    def test_09_demo_account_cannot_access_or_switch_to_customer_orgs(self):
        """Demo user is strictly restricted to the demo workspace on the backend."""
        with patch.dict(os.environ, {
            "DEMO_ACCOUNT_ENABLED": "true",
            "DEMO_EMAIL": "evaluator@restricted.demo",
            "DEMO_PASSWORD": "DemoPass999!",
            "DEMO_ORGANIZATION_NAME": "Demo Workspace",
        }):
            conn = database.get_db()
            auth.provision_demo_account(conn)
            conn.close()

            demo_client = TestClient(main.app)
            demo_client.post(
                "/api/auth/login",
                json={"email": "evaluator@restricted.demo", "password": "DemoPass999!"},
            )

            # Demo user cannot create an additional organization
            create_res = demo_client.post("/api/organizations", json={"name": "Hacked Org"})
            self.assertEqual(create_res.status_code, 403)

            # Demo user cannot switch to customer org_default
            switch_res = demo_client.post("/api/organizations/switch", json={"organization_id": "org_default"})
            self.assertEqual(switch_res.status_code, 403)

            # Demo user cannot access customer documents via header manipulation
            hack_res = demo_client.get("/api/rules", headers={"X-Organization-Id": "org_default"})
            self.assertEqual(hack_res.status_code, 403)

    def test_10_multi_tenant_data_isolation_between_organizations(self):
        """User A in Org A cannot see or mutate User B's documents, rules, or findings."""
        # 1. User A in Org A
        client_a = TestClient(main.app)
        client_a.post("/api/auth/register", json={"email": "alice@company-a.com", "password": "Password123!"})
        org_a = client_a.post("/api/organizations", json={"name": "Company Alpha"}).json()
        client_a.cookies.set("org_id", org_a["id"])

        # User A creates a custom rule in Org A
        rule_res = client_a.post("/api/rules/custom", json={
            "title": "Alpha Brand Exclusive",
            "rule_category": "Brand Voice & Tone",
            "approved_statement": "Alpha products must always mention Alpha Quality.",
            "forbidden_terms": "cheap,low quality",
        })
        self.assertEqual(rule_res.status_code, 200)
        rule_a_id = rule_res.json()["rule_id"]

        # User A audits an intake document in Org A
        with patch("main.call_gemini", return_value="[]"):
            intake_res = client_a.post("/api/intake", data={"content": "Buy our cheap Alpha product today."})
        self.assertEqual(intake_res.status_code, 200)
        doc_a_id = intake_res.json()["document_id"]

        # 2. User B in Org B
        client_b = TestClient(main.app)
        client_b.post("/api/auth/register", json={"email": "bob@company-b.com", "password": "Password123!"})
        org_b = client_b.post("/api/organizations", json={"name": "Company Beta"}).json()
        client_b.cookies.set("org_id", org_b["id"])

        # User B lists rules: MUST NOT see User A's rule
        b_rules = client_b.get("/api/rules").json()
        self.assertNotIn(rule_a_id, [r["id"] for r in b_rules])

        # User B attempts to read User A's document: MUST get 404 (zero leakage)
        b_doc_res = client_b.get(f"/api/review/{doc_a_id}")
        self.assertEqual(b_doc_res.status_code, 404)

        # User B attempts to access Org A with spoofed header: MUST get 403 Forbidden
        b_spoof = client_b.get("/api/rules", headers={"X-Organization-Id": org_a["id"]})
        self.assertEqual(b_spoof.status_code, 403)

    def test_11_starter_rules_templates_and_activation(self):
        """Starter rule templates can be browsed and activated into an organization."""
        client = TestClient(main.app)
        client.post("/api/auth/register", json={"email": "charlie@newco.com", "password": "Password123!"})
        org = client.post("/api/organizations", json={"name": "NewCo Labs"}).json()
        client.cookies.set("org_id", org["id"])

        # Check rule status before activation: no active rules
        status_res = client.get("/api/rules/status")
        self.assertEqual(status_res.status_code, 200)
        self.assertFalse(status_res.json()["has_active_rules"])

        # Get starter templates
        templates = client.get("/api/rules/templates").json()
        self.assertGreaterEqual(len(templates), 3)

        # Activate selected templates
        activate_res = client.post(
            "/api/rules/templates/activate",
            json={"template_ids": [templates[0]["id"], templates[1]["id"]]},
        )
        self.assertEqual(activate_res.status_code, 200)
        self.assertEqual(len(activate_res.json()["activated_rules"]), 2)

        # Check rule status after activation
        status_after = client.get("/api/rules/status").json()
        self.assertTrue(status_after["has_active_rules"])
        self.assertEqual(status_after["active_count"], 2)

    def test_12_google_oauth_config_endpoint(self):
        """Google OAuth config endpoint returns whether client ID is configured."""
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": ""}):
            res = self.client.get("/api/auth/google/config")
            self.assertEqual(res.status_code, 200)
            self.assertFalse(res.json()["configured"])
            self.assertIsNone(res.json()["client_id"])

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "test-client-id-123.apps.googleusercontent.com"}):
            res = self.client.get("/api/auth/google/config")
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json()["configured"])
            self.assertEqual(res.json()["client_id"], "test-client-id-123.apps.googleusercontent.com")

    @classmethod
    def tearDownClass(cls):
        os.environ["DEMO_ACCOUNT_ENABLED"] = "true"
        os.environ["DEMO_EMAIL"] = "demo@beforeitgoeslive.com"
        os.environ["DEMO_PASSWORD"] = "DemoPassword2026!"
        os.environ["DEMO_ORGANIZATION_NAME"] = "Before It Goes Live (Demo Sandbox)"
        conn = database.get_connection()
        try:
            auth.provision_demo_account(conn)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
