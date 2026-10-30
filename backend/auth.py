"""
Authentication, Session Management, Organizations, and Demo Account Provisioning
for Before It Goes Live.

Features:
- Strong password hashing with Argon2id via argon2-cffi
- Secure random session tokens with expiration and CSRF tokens
- Public evaluator demo account configuration and idempotent provisioning
- Google OpenID Connect token verification (optional addition)
- Strict organization membership and multi-tenant data isolation
"""

import os
import secrets
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
import httpx

logger = logging.getLogger("before_it_goes_live.auth")

# Argon2id password hasher (RFC 9106 recommended parameters)
_password_hasher = PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=1,
    hash_len=32,
    salt_len=16,
)

SESSION_DURATION = timedelta(days=7)


# --------------------------------------------------
# Password Hashing
# --------------------------------------------------

def hash_password(plain_password: str) -> str:
    """Hash password using Argon2id with unique salt."""
    if not plain_password:
        raise ValueError("Password cannot be empty.")
    return _password_hasher.hash(plain_password)


def verify_password(stored_hash: str, candidate_password: str) -> bool:
    """Verify password against stored Argon2id hash."""
    if not stored_hash or not candidate_password:
        return False
    try:
        return _password_hasher.verify(stored_hash, candidate_password)
    except (VerifyMismatchError, VerificationError):
        return False
    except Exception as exc:
        logger.warning("Error verifying password hash: %s", exc)
        return False


# --------------------------------------------------
# Session Management
# --------------------------------------------------

def create_session(conn, user_id: str) -> Dict[str, Any]:
    """Create a new authenticated session in the database."""
    session_id = secrets.token_hex(32)
    csrf_token = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    expires_iso = expires_at.isoformat()

    conn.execute(
        """
        INSERT INTO sessions (id, user_id, csrf_token, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (session_id, user_id, csrf_token, expires_iso),
    )
    conn.commit()

    return {
        "session_id": session_id,
        "csrf_token": csrf_token,
        "expires_at": expires_iso,
        "user_id": user_id,
    }


def get_session(conn, session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an active session and associated user info, removing expired sessions."""
    if not session_id or not isinstance(session_id, str):
        return None

    row = conn.execute(
        """
        SELECT
            s.id AS session_id,
            s.user_id,
            s.csrf_token,
            s.expires_at,
            u.email,
            u.full_name,
            u.is_demo,
            u.is_admin
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ?
        """,
        (session_id,),
    ).fetchone()

    if not row:
        return None

    try:
        expires_at = datetime.fromisoformat(row["expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        # Invalid timestamp format, invalidate session
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return None

    if expires_at < datetime.now(timezone.utc):
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return None

    return dict(row)


def delete_session(conn, session_id: str):
    """Invalidate a session on logout."""
    if session_id:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()


# --------------------------------------------------
# Demo Account Provisioning
# --------------------------------------------------

def get_demo_env() -> Dict[str, Any]:
    """Read demo account configuration from environment variables."""
    raw_enabled = (os.environ.get("DEMO_LOGIN_ENABLED") or os.environ.get("DEMO_ACCOUNT_ENABLED") or "").strip().lower()
    enabled = raw_enabled not in ("false", "0", "no", "disabled")

    env_email = os.environ.get("DEMO_EMAIL", "").strip()
    env_password = os.environ.get("DEMO_PASSWORD", "").strip()

    if enabled:
        email = env_email or "demo@beforeitgoeslive.com"
        password = env_password or "DemoPassword2026!"
    else:
        email = env_email or None
        password = env_password or None

    org_name = (os.environ.get("DEMO_ORGANIZATION_NAME") or "Before It Goes Live (Demo Sandbox)").strip()

    valid = bool(enabled and email and password)
    return {
        "enabled": enabled,
        "valid": valid,
        "email": email or None,
        "password": password or None,
        "org_name": org_name,
    }


def get_public_demo_config() -> Dict[str, Any]:
    """
    Public configuration endpoint for evaluators.
    Only returns fields intentionally meant to be public.
    Never returns secrets, private user emails, or system credentials.
    """
    demo_env = get_demo_env()
    if not demo_env["enabled"]:
        return {
            "demo_enabled": False,
            "demo_email": None,
            "demo_password": None,
            "organization_name": None,
        }

    if not demo_env["valid"]:
        logger.warning(
            "DEMO_ACCOUNT_ENABLED is true, but DEMO_EMAIL or DEMO_PASSWORD is not set."
        )
        return {
            "demo_enabled": False,
            "demo_email": None,
            "demo_password": None,
            "organization_name": None,
            "configuration_error": "Demo account is enabled but DEMO_EMAIL or DEMO_PASSWORD is missing in server environment.",
        }

    return {
        "demo_enabled": True,
        "demo_email": demo_env["email"],
        "demo_password": demo_env["password"],
        "organization_name": demo_env["org_name"],
    }


def provision_demo_account(conn) -> Optional[str]:
    """
    Idempotently provision the dedicated evaluator demo account and workspace.
    Stores only an Argon2id password hash in SQLite.
    Returns demo user ID if provisioned, or None if disabled.
    """
    demo_env = get_demo_env()
    if not demo_env["enabled"] or not demo_env["valid"]:
        return None

    email = demo_env["email"].lower()
    password = demo_env["password"]
    org_name = demo_env["org_name"]

    cursor = conn.cursor()

    # 1. Ensure demo organization exists
    demo_org = cursor.execute(
        "SELECT id, name FROM organizations WHERE is_demo = 1"
    ).fetchone()

    if not demo_org:
        demo_org_id = "org_demo"
        cursor.execute(
            """
            INSERT OR IGNORE INTO organizations (id, name, slug, is_demo)
            VALUES (?, ?, 'demo', 1)
            """,
            (demo_org_id, org_name),
        )
    else:
        demo_org_id = demo_org["id"]
        if demo_org["name"] != org_name:
            cursor.execute(
                "UPDATE organizations SET name = ? WHERE id = ?",
                (org_name, demo_org_id),
            )

    # 2. Ensure demo user exists
    demo_user = cursor.execute(
        "SELECT id, password_hash, is_demo FROM users WHERE email = ? OR is_demo = 1",
        (email,),
    ).fetchone()

    demo_user_id = demo_user["id"] if demo_user else "user_demo"
    password_hash = hash_password(password)

    if not demo_user:
        cursor.execute(
            """
            INSERT INTO users (id, email, password_hash, full_name, is_demo, is_admin)
            VALUES (?, ?, ?, 'Evaluator Demo', 1, 0)
            """,
            (demo_user_id, email, password_hash),
        )
    else:
        # Update email and verify/update password hash
        needs_update = False
        current_hash = demo_user["password_hash"]
        if not verify_password(current_hash, password):
            needs_update = True

        cursor.execute(
            """
            UPDATE users
            SET email = ?,
                password_hash = ?,
                is_demo = 1,
                is_admin = 0,
                full_name = 'Evaluator Demo'
            WHERE id = ?
            """,
            (email, password_hash if needs_update else current_hash, demo_user_id),
        )

    # 3. Ensure membership in demo organization only
    cursor.execute(
        """
        INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role)
        VALUES (?, ?, ?, 'owner')
        """,
        (f"mem_{demo_user_id}_{demo_org_id}", demo_org_id, demo_user_id),
    )

    # Keep demo rules illustrative and scoped; never overwrite a rule changed by its owner.
    cursor.execute(
        """
        UPDATE brand_rules
        SET approved_statement = ?,
            forbidden_terms = ?,
            scope = ?
        WHERE id = 'BR-DEMO-01'
          AND organization_id = ?
          AND approved_statement = ?
        """,
        (
            "For cosmetic product claims, describe substantiated appearance benefits only; do not imply medical treatment, a cure, or guaranteed biological reversal. This rule applies only to cosmetic claims and does not require fixed wording.",
            "reverses aging,cures wrinkles,permanently erase wrinkles",
            "Cosmetic claims",
            demo_org_id,
            "Cosmetic claims must state 'reduces appearance of fine lines', never 'reverses aging' or 'cures wrinkles'.",
        ),
    )

    demo_rules = [
        (
            "BR-DEMO-01",
            demo_org_id,
            "[Demo] Cosmetic vs Medical Claims",
            "Legal & Regulatory",
            "custom",
            "For cosmetic product claims, describe substantiated appearance benefits only; do not imply medical treatment, a cure, or guaranteed biological reversal. This rule applies only to cosmetic claims and does not require fixed wording.",
            "reverses aging,cures wrinkles,permanently erase wrinkles",
            "Cosmetic claims",
            "high",
            "active",
        ),
        (
            "BR-DEMO-02",
            demo_org_id,
            "[Demo] Organic Content Verification",
            "Formulation & Science",
            "custom",
            "Organic claims must disclose certified percentage (e.g. 95% certified organic extracts). Never claim 100% organic without full certification.",
            "100% organic,completely pure organic",
            "Global",
            "medium",
            "active",
        ),
        (
            "BR-DEMO-03",
            demo_org_id,
            "[Demo] Promotional Price Expiration Mandate",
            "Commercial & Pricing",
            "custom",
            "Promotional flash sale pricing must disclose a clear expiration deadline (e.g. 'Valid until [Date]').",
            "",
            "Global",
            "medium",
            "active",
        ),
        (
            "BR-DEMO-04",
            demo_org_id,
            "[Demo] Absolute Reliability Claims",
            "Claims & Evidence",
            "custom",
            "Absolute uptime, error-free, or permanent reliability claims require current approved evidence that defines scope, measurement period, and limitations.",
            "100% uptime,zero errors,zero downtime,never fails,100% reliable,guaranteed uptime",
            "Software, services, and product performance claims",
            "high",
            "active",
        ),
        (
            "BR-DEMO-05",
            demo_org_id,
            "[Demo] Competitor Comparison Claims",
            "Claims & Evidence",
            "custom",
            "Comparisons with competitors or market rankings require a fair, current, approved comparison basis. Do not present unsupported superiority claims as fact.",
            "outperforms every competitor,every competitor,best on the market,number one in the market,better than all competitors",
            "Global",
            "high",
            "active",
        ),
    ]
    for rule in demo_rules:
        cursor.execute(
            """
            INSERT OR IGNORE INTO brand_rules (
                id, organization_id, title, rule_category, rule_type,
                approved_statement, forbidden_terms, scope, severity, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rule,
        )

    conn.commit()
    logger.info("Demo account provisioned successfully: %s", email)
    return demo_user_id


# --------------------------------------------------
# User & Organization Helpers
# --------------------------------------------------

def get_user_by_email(conn, email: str) -> Optional[Dict[str, Any]]:
    """Retrieve user record by case-insensitive email."""
    if not email:
        return None
    row = conn.execute(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
        (email.strip(),),
    ).fetchone()
    return dict(row) if row else None


def get_user_by_id(conn, user_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve user record by ID."""
    if not user_id:
        return None
    row = conn.execute(
        "SELECT * FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def create_user(
    conn,
    email: str,
    password: Optional[str] = None,
    full_name: Optional[str] = None,
    google_id: Optional[str] = None,
    is_demo: int = 0,
) -> Dict[str, Any]:
    """Register a new user in the database."""
    clean_email = email.strip().lower()
    existing = get_user_by_email(conn, clean_email)
    if existing:
        raise ValueError("An account with this email already exists.")

    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    pwd_hash = hash_password(password) if password else None
    display_name = full_name.strip() if full_name else clean_email.split("@")[0]

    conn.execute(
        """
        INSERT INTO users (id, email, password_hash, full_name, google_id, is_demo, is_admin)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        """,
        (user_id, clean_email, pwd_hash, display_name, google_id, is_demo),
    )
    conn.commit()

    return {
        "id": user_id,
        "email": clean_email,
        "full_name": display_name,
        "is_demo": is_demo,
    }


def get_user_organizations(conn, user_id: str) -> List[Dict[str, Any]]:
    """Get all organizations the user is a member of."""
    rows = conn.execute(
        """
        SELECT
            o.id,
            o.name,
            o.slug,
            o.is_demo,
            om.role,
            (SELECT COUNT(*) FROM brand_rules br WHERE br.organization_id = o.id AND br.status = 'active') AS active_rule_count
        FROM organizations o
        JOIN organization_members om ON o.id = om.organization_id
        WHERE om.user_id = ?
        ORDER BY o.created_at ASC
        """,
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create_organization(conn, user_id: str, name: str, is_demo: int = 0) -> Dict[str, Any]:
    """Create a new workspace organization and assign owner membership."""
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Organization name cannot be empty.")

    org_id = f"org_{uuid.uuid4().hex[:12]}"
    member_id = f"mem_{uuid.uuid4().hex[:12]}"

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO organizations (id, name, is_demo)
        VALUES (?, ?, ?)
        """,
        (org_id, clean_name, is_demo),
    )
    cursor.execute(
        """
        INSERT INTO organization_members (id, organization_id, user_id, role)
        VALUES (?, ?, ?, 'owner')
        """,
        (member_id, org_id, user_id),
    )
    conn.commit()

    return {
        "id": org_id,
        "name": clean_name,
        "role": "owner",
        "is_demo": is_demo,
        "active_rule_count": 0,
    }


def user_belongs_to_org(conn, user_id: str, org_id: str) -> bool:
    """Verify that a user is an authorized member of an organization."""
    if not user_id or not org_id:
        return False
    row = conn.execute(
        """
        SELECT 1 FROM organization_members
        WHERE user_id = ? AND organization_id = ?
        """,
        (user_id, org_id),
    ).fetchone()
    return row is not None


# --------------------------------------------------
# Google Sign-In (Optional)
# --------------------------------------------------

def get_google_auth_config() -> Dict[str, Any]:
    """Public Google OAuth client configuration."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip() or None
    return {
        "configured": bool(client_id),
        "client_id": client_id,
    }


async def verify_google_id_token(credential: str) -> Optional[Dict[str, Any]]:
    """
    Validate Google ID Token directly with Google's tokeninfo endpoint.
    Verifies audience, issuer, email, and signature without hardcoded claims.
    """
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id or not credential:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": credential},
            )
            if resp.status_code != 200:
                logger.warning("Google tokeninfo returned status %d", resp.status_code)
                return None

            claims = resp.json()

            # Verify audience
            if claims.get("aud") != client_id:
                logger.warning("Google token audience mismatch: %s != %s", claims.get("aud"), client_id)
                return None

            # Verify issuer
            iss = claims.get("iss")
            if iss not in ("accounts.google.com", "https://accounts.google.com"):
                logger.warning("Google token issuer invalid: %s", iss)
                return None

            # Verify email
            email = claims.get("email")
            if not email:
                return None

            return {
                "google_id": claims.get("sub"),
                "email": email.lower(),
                "full_name": claims.get("name") or email.split("@")[0],
                "email_verified": claims.get("email_verified") in (True, "true"),
            }
    except Exception as exc:
        logger.warning("Failed to verify Google ID token: %s", exc)
        return None
