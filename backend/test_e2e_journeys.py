"""End-to-End User Journeys and Verification Test Suite.

Covers:
- Journey 1: Evaluator Demo Access (pre-filled config, login, session restore, demo org isolation, logout)
- Journey 2: Ordinary Visitor Registration (create account, create workspace, rules status, template activation, scoped intake)
- Journey 3: Multi-Tenant Isolation & Workspace Switching
- Journey 4: Brand Rules & Deterministic Compliance (BR-01 cosmetic claims, BR-03 promotional pricing)
"""

import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

# Ensure demo account is enabled for testing
os.environ["DEMO_ACCOUNT_ENABLED"] = "true"
os.environ["DEMO_EMAIL"] = "demo@beforeitgoeslive.com"
os.environ["DEMO_PASSWORD"] = "DemoPassword2026!"
os.environ["DEMO_ORGANIZATION_NAME"] = "Before It Goes Live (Demo Sandbox)"

from main import app


class TestEndToEndUserJourneys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DEMO_ACCOUNT_ENABLED"] = "true"
        os.environ["DEMO_EMAIL"] = "demo@beforeitgoeslive.com"
        os.environ["DEMO_PASSWORD"] = "DemoPassword2026!"
        os.environ["DEMO_ORGANIZATION_NAME"] = "Before It Goes Live (Demo Sandbox)"
        import auth
        import database
        conn = database.get_connection()
        try:
            auth.provision_demo_account(conn)
        finally:
            conn.close()
        cls.client = TestClient(app)

    def test_journey_1_evaluator_demo_access_and_logout(self):
        """Journey 1: Evaluator discovers demo config, signs in, checks demo sandbox, and logs out."""
        # Step 1: Discover demo config
        res = self.client.get("/api/auth/demo-config")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("demo_enabled"))
        self.assertEqual(data.get("demo_email"), "demo@beforeitgoeslive.com")
        self.assertEqual(data.get("demo_password"), "DemoPassword2026!")

        # Step 2: Sign in with demo credentials
        login_res = self.client.post("/api/auth/login", json={
            "email": data["demo_email"],
            "password": data["demo_password"],
        })
        self.assertEqual(login_res.status_code, 200)
        login_data = login_res.json()
        self.assertEqual(login_data["user"]["email"], "demo@beforeitgoeslive.com")
        self.assertTrue(login_data["user"]["is_demo"])
        self.assertIsNotNone(login_data.get("active_organization"))
        self.assertTrue(login_data["active_organization"]["is_demo"])
        self.assertEqual(login_data["active_organization"]["id"], "org_demo")

        session_cookie = login_res.cookies.get("session_id")
        self.assertIsNotNone(session_cookie)

        # Step 3: Session restore via /api/auth/me
        me_res = self.client.get("/api/auth/me", cookies={"session_id": session_cookie})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["user"]["email"], "demo@beforeitgoeslive.com")
        self.assertEqual(me_data["active_organization"]["id"], "org_demo")

        # Step 4: Current organization details
        org_res = self.client.get("/api/organizations/current", cookies={"session_id": session_cookie})
        self.assertEqual(org_res.status_code, 200)
        org_data = org_res.json()
        self.assertIn("organization", org_data)
        self.assertEqual(org_data["organization"]["id"], "org_demo")
        self.assertTrue(org_data["organization"]["is_demo"])

        # Step 5: Safe logout
        logout_res = self.client.post("/api/auth/logout", cookies={"session_id": session_cookie})
        self.assertEqual(logout_res.status_code, 200)

        # Step 6: Session invalidation check
        me_after_logout = self.client.get("/api/auth/me", cookies={"session_id": session_cookie})
        self.assertEqual(me_after_logout.status_code, 401)

    def test_journey_2_new_visitor_onboarding_and_rules_activation(self):
        """Journey 2: New visitor registers, creates workspace, activates starter rules, intakes draft."""
        import uuid
        unique_email = f"user_{uuid.uuid4().hex[:8]}@acmebrand.com"
        password = "SecurePassword123!"

        # Step 1: Register account
        reg_res = self.client.post("/api/auth/register", json={
            "email": unique_email,
            "password": password,
            "full_name": "Acme Brand Director",
        })
        self.assertEqual(reg_res.status_code, 200)
        reg_data = reg_res.json()
        self.assertEqual(reg_data["user"]["email"], unique_email)
        self.assertFalse(reg_data["user"]["is_demo"])
        session_cookie = reg_res.cookies.get("session_id")
        self.assertIsNotNone(session_cookie)

        # Step 2: Create new brand workspace
        create_org_res = self.client.post(
            "/api/organizations",
            json={"name": "Acme Skincare Co"},
            cookies={"session_id": session_cookie},
        )
        self.assertEqual(create_org_res.status_code, 200)
        new_org = create_org_res.json()
        self.assertEqual(new_org["name"], "Acme Skincare Co")
        org_id = new_org["id"]

        # Step 3: Check brand rules status (should be empty initially)
        status_res = self.client.get("/api/rules/status", cookies={"session_id": session_cookie})
        self.assertEqual(status_res.status_code, 200)
        status_data = status_res.json()
        self.assertFalse(status_data["has_active_rules"])
        self.assertEqual(status_data["active_count"], 0)

        # Step 4: Get starter rule templates
        tpl_res = self.client.get("/api/rules/templates", cookies={"session_id": session_cookie})
        self.assertEqual(tpl_res.status_code, 200)
        templates = tpl_res.json()
        self.assertGreaterEqual(len(templates), 4)
        template_ids = {template["id"] for template in templates}
        self.assertIn("tpl_absolute_reliability", template_ids)
        self.assertIn("tpl_guaranteed_outcomes", template_ids)

        # Step 5: Activate selected starter templates
        activate_res = self.client.post(
            "/api/rules/templates/activate",
            json={"template_ids": ["tpl_cosmetics_medical", "tpl_pricing_deadline"]},
            cookies={"session_id": session_cookie},
        )
        self.assertEqual(activate_res.status_code, 200)
        self.assertEqual(len(activate_res.json()["activated_rules"]), 2)

        # Step 6: Verify rules status is now active
        status_after = self.client.get("/api/rules/status", cookies={"session_id": session_cookie})
        self.assertEqual(status_after.status_code, 200)
        self.assertTrue(status_after.json()["has_active_rules"])
        self.assertEqual(status_after.json()["active_count"], 2)

        # Step 7: Post an intake document to this new org
        with patch("main.call_gemini", return_value="[]"):
            intake_res = self.client.post(
                "/api/intake",
                data={
                    "title": "Acme Summer Launch",
                    "content": "Our new serum reduces appearance of fine lines with 10% niacinamide.",
                },
                cookies={"session_id": session_cookie},
            )
        self.assertEqual(intake_res.status_code, 200)
        doc_id = intake_res.json()["document_id"]

        # Step 8: Verify document is in this org's activity
        activity_list = self.client.get("/api/activity", cookies={"session_id": session_cookie})
        self.assertEqual(activity_list.status_code, 200)
        docs = activity_list.json()["documents"]
        self.assertTrue(any(d["id"] == doc_id for d in docs))

        # Step 9: Verify cross-tenant isolation: demo user cannot see this document
        demo_login = self.client.post("/api/auth/login", json={
            "email": "demo@beforeitgoeslive.com",
            "password": "DemoPassword2026!",
        })
        demo_cookie = demo_login.cookies.get("session_id")
        demo_docs = self.client.get("/api/activity", cookies={"session_id": demo_cookie}).json()["documents"]
        self.assertFalse(any(d["id"] == doc_id for d in demo_docs))

        # Attempt to access Acme's document directly from demo user -> 404
        demo_review_res = self.client.get(f"/api/review/{doc_id}", cookies={"session_id": demo_cookie})
        self.assertEqual(demo_review_res.status_code, 404)

    def test_journey_3_multi_org_creation_and_switching(self):
        """Journey 3: User belongs to multiple workspaces and switches between them cleanly."""
        import uuid
        email = f"lead_{uuid.uuid4().hex[:8]}@holdingcompany.com"
        reg_res = self.client.post("/api/auth/register", json={
            "email": email,
            "password": "Password123!",
            "full_name": "Group Brand VP",
        })
        cookie = reg_res.cookies.get("session_id")

        # Create Org 1
        org1_res = self.client.post("/api/organizations", json={"name": "Brand A Global"}, cookies={"session_id": cookie})
        org1 = org1_res.json()

        # Create Org 2
        org2_res = self.client.post("/api/organizations", json={"name": "Brand B Europe"}, cookies={"session_id": cookie})
        org2 = org2_res.json()

        # User organizations list
        orgs_res = self.client.get("/api/organizations", cookies={"session_id": cookie})
        orgs = orgs_res.json()
        self.assertGreaterEqual(len(orgs), 2)
        org_ids = [o["id"] for o in orgs]
        self.assertIn(org1["id"], org_ids)
        self.assertIn(org2["id"], org_ids)

        # Switch to Org 1
        switch_res = self.client.post("/api/organizations/switch", json={"organization_id": org1["id"]}, cookies={"session_id": cookie})
        self.assertEqual(switch_res.status_code, 200)
        curr = self.client.get("/api/organizations/current", cookies={"session_id": cookie}).json()["organization"]
        self.assertEqual(curr["id"], org1["id"])

        # Switch to Org 2
        switch_res2 = self.client.post("/api/organizations/switch", json={"organization_id": org2["id"]}, cookies={"session_id": cookie})
        self.assertEqual(switch_res2.status_code, 200)
        curr2 = self.client.get("/api/organizations/current", cookies={"session_id": cookie}).json()["organization"]
        self.assertEqual(curr2["id"], org2["id"])

    def test_journey_4_rules_deterministic_compliance_br01_and_br03(self):
        """Journey 4: Deterministic rule verification on real text without fabrication."""
        import uuid
        email = f"compliance_{uuid.uuid4().hex[:8]}@beautybrand.com"
        reg_res = self.client.post("/api/auth/register", json={
            "email": email,
            "password": "Password123!",
        })
        cookie = reg_res.cookies.get("session_id")
        self.client.post("/api/organizations", json={"name": "Beauty Brand Co"}, cookies={"session_id": cookie})

        # Activate cosmetic claims rule and pricing rule
        self.client.post(
            "/api/rules/templates/activate",
            json={"template_ids": ["tpl_cosmetics_medical", "tpl_pricing_deadline"]},
            cookies={"session_id": cookie},
        )

        # Post draft with cosmetic claim violation ("reverses aging")
        with patch("main.call_gemini", return_value="[]"):
            intake_res = self.client.post(
                "/api/intake",
                data={
                    "title": "Age Miracle Serum",
                    "content": "Our miracle serum permanently reverses aging and eliminates wrinkles in 3 days. Flash sale price: $49!",
                },
                cookies={"session_id": cookie},
            )
        self.assertEqual(intake_res.status_code, 200)
        doc_id = intake_res.json()["document_id"]

        # Run review
        review_res = self.client.get(f"/api/review/{doc_id}", cookies={"session_id": cookie})
        self.assertEqual(review_res.status_code, 200)
        review_data = review_res.json()

        findings = review_data.get("findings", [])
        # Confirm deterministic check caught the forbidden terms
        forbidden_matches = [
            f for f in findings
            if any(term in str(f.get("flagged_text") or "").lower() or term in str(f.get("explanation") or "").lower()
                   for term in ["reverses aging", "permanently", "pricing", "expiration", "validity"])
        ]
        self.assertGreater(len(forbidden_matches), 0, "Deterministic check should flag prohibited cosmetic claim.")

    def test_journey_5_judge_autofill_and_disabled_demo_scenarios(self):
        """Journey 5: Verifies judge autofill credential contract and honest disabled behavior."""
        from unittest.mock import patch

        # 1. Honest reporting when demo is disabled
        with patch.dict(os.environ, {"DEMO_LOGIN_ENABLED": "false", "DEMO_ACCOUNT_ENABLED": "false"}):
            res = self.client.get("/api/auth/demo-config")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertFalse(data["demo_enabled"])
            self.assertIsNone(data["demo_email"])
            self.assertIsNone(data["demo_password"])

        # 2. Honest delivery when enabled via DEMO_LOGIN_ENABLED
        with patch.dict(os.environ, {"DEMO_LOGIN_ENABLED": "true", "DEMO_EMAIL": "judge@hackathon.io", "DEMO_PASSWORD": "JudgePass2026!"}):
            # Ensure provisioned in DB
            import auth, database
            conn = database.get_connection()
            try:
                auth.provision_demo_account(conn)
            finally:
                conn.close()

            res = self.client.get("/api/auth/demo-config")
            self.assertEqual(res.status_code, 200)
            cfg = res.json()
            self.assertTrue(cfg["demo_enabled"])
            self.assertEqual(cfg["demo_email"], "judge@hackathon.io")
            self.assertEqual(cfg["demo_password"], "JudgePass2026!")

            # Autofill simulates posting the returned credentials to standard login
            login_res = self.client.post("/api/auth/login", json={"email": cfg["demo_email"], "password": cfg["demo_password"]})
            self.assertEqual(login_res.status_code, 200)
            login_data = login_res.json()
            self.assertTrue(login_data["user"]["is_demo"])
            self.assertEqual(login_data["active_organization"]["id"], "org_demo")

            # Restore original demo credentials for other tests
            os.environ["DEMO_EMAIL"] = "demo@beforeitgoeslive.com"
            os.environ["DEMO_PASSWORD"] = "DemoPassword2026!"
            conn = database.get_connection()
            try:
                auth.provision_demo_account(conn)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
