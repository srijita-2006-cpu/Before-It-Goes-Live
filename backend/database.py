"""
Database configuration and initialization for Before It Goes Live.

Stores users, sessions, organizations, documents, brand rules, findings,
audit activity, and bulk jobs.
Safely adds missing columns without deleting existing records.
Preserves existing data and isolates multi-tenant workspaces.
"""

import os
import sqlite3

DB_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "before_it_goes_live.db",
)


# --------------------------------------------------
# Database connection
# --------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_connection():
    """Compatibility alias for older code."""
    return get_db()


# --------------------------------------------------
# Schema migration helpers
# --------------------------------------------------

def _table_exists(cursor, table_name):
    row = cursor.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table_name,),
    ).fetchone()

    return row is not None


def _ensure_table(cursor, table_name, create_sql, columns):
    """
    Create a missing table and add missing columns.

    Existing tables and records are preserved.
    SQLite cannot add a primary-key constraint to an
    existing column through a simple ALTER TABLE.
    """
    if not _table_exists(cursor, table_name):
        cursor.execute(create_sql)
        return

    # Table names passed here are fixed internal names.
    existing = {
        row["name"]
        for row in cursor.execute(
            f'PRAGMA table_info("{table_name}")'
        ).fetchall()
    }

    for column_name, column_type in columns.items():
        if column_name not in existing:
            cursor.execute(
                f'ALTER TABLE "{table_name}" '
                f'ADD COLUMN "{column_name}" {column_type}'
            )


# --------------------------------------------------
# 6 Standard Default Brand Rules
# --------------------------------------------------

STANDARD_DEFAULT_RULES = [
    {
        "id": "BR-01",
        "title": "Cosmetic vs Medical Claims Policy",
        "rule_category": "Clinical & Regulatory",
        "rule_type": "default",
        "approved_statement": "Cosmetic claims must describe appearance enhancements (e.g. 'reduces appearance of fine lines') and must never state medical, biological reversal, or cure claims.",
        "forbidden_terms": "cure,permanently reverse,reverses aging,eliminates wrinkles permanently",
        "scope": "Global",
        "severity": "high",
        "status": "active",
    },
    {
        "id": "BR-02",
        "title": "Organic Ingredient Certification Threshold",
        "rule_category": "Formulation & Science",
        "rule_type": "default",
        "approved_statement": "Products claiming organic composition must state certified percentage (e.g. 95% certified organic extracts). Never claim 100% organic unless 100% certified.",
        "forbidden_terms": "100% organic,completely pure organic",
        "scope": "Global",
        "severity": "medium",
        "status": "active",
    },
    {
        "id": "BR-03",
        "title": "Promotional Price Expiration Mandate",
        "rule_category": "Commercial & Pricing",
        "rule_type": "default",
        "approved_statement": "Promotional flash sale pricing or limited-time discounts must explicitly disclose validity duration or expiration deadline (e.g. 'Offer valid through [Date]').",
        "forbidden_terms": "unlimited sale,permanent discount",
        "scope": "Global",
        "severity": "medium",
        "status": "active",
    },
    {
        "id": "BR-04",
        "title": "Clinical Trial Attribution & Statistical Proof",
        "rule_category": "Clinical & Regulatory",
        "rule_type": "default",
        "approved_statement": "Quantitative efficacy statistics must cite protocol study ID, sample size, or clinical testing duration. Never claim instant, guaranteed, or overnight results.",
        "forbidden_terms": "instant,overnight miracle,guaranteed cure,100% success rate",
        "scope": "Global",
        "severity": "high",
        "status": "active",
    },
    {
        "id": "BR-05",
        "title": "Comparative Claims & Competitor Disparagement",
        "rule_category": "Brand Voice & Legal",
        "rule_type": "default",
        "approved_statement": "Comparative claims against competitors must be backed by documented head-to-head testing. Direct disparagement or unsubstantiated superiority claims are strictly forbidden.",
        "forbidden_terms": "better than all,destroys competition,inferior brands,fake alternatives",
        "scope": "Global",
        "severity": "high",
        "status": "active",
    },
    {
        "id": "BR-06",
        "title": "Environmental & Sustainability Certifications",
        "rule_category": "Claims & Environmental",
        "rule_type": "default",
        "approved_statement": "Sustainability, eco-friendly, and carbon-neutral claims must identify the issuing third-party standard or certification authority (e.g., ISO 14021 or FSC-certified).",
        "forbidden_terms": "100% green,zero impact,planet proof",
        "scope": "Global",
        "severity": "medium",
        "status": "active",
    },
]


def seed_standard_default_rules(conn):
    """
    Ensure the 6 standard default rules exist in the database with status='active'.
    Idempotent: updates existing rules or inserts missing ones.
    Seeds them for org_default and ensures they are active and togglable.
    """
    cursor = conn.cursor()
    for rule in STANDARD_DEFAULT_RULES:
        existing = cursor.execute(
            "SELECT id, status FROM brand_rules WHERE id = ?",
            (rule["id"],),
        ).fetchone()

        if existing:
            current_status = existing["status"] if existing["status"] in ("active", "inactive") else "active"
            cursor.execute(
                """
                UPDATE brand_rules
                SET title = ?,
                    rule_category = ?,
                    rule_type = 'default',
                    approved_statement = ?,
                    forbidden_terms = ?,
                    scope = ?,
                    severity = ?,
                    status = ?
                WHERE id = ?
                """,
                (
                    rule["title"],
                    rule["rule_category"],
                    rule["approved_statement"],
                    rule["forbidden_terms"],
                    rule["scope"],
                    rule["severity"],
                    current_status,
                    rule["id"],
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO brand_rules (
                    id, organization_id, title, rule_category, rule_type,
                    approved_statement, forbidden_terms, scope, severity, status
                ) VALUES (?, 'org_default', ?, ?, 'default', ?, ?, ?, ?, 'active')
                """,
                (
                    rule["id"],
                    rule["title"],
                    rule["rule_category"],
                    rule["approved_statement"],
                    rule["forbidden_terms"],
                    rule["scope"],
                    rule["severity"],
                ),
            )
    conn.commit()


# --------------------------------------------------
# Initialize and migrate the database
# --------------------------------------------------

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    try:
        # Users
        _ensure_table(
            cursor,
            "users",
            """
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                full_name TEXT,
                google_id TEXT,
                is_demo INTEGER DEFAULT 0,
                is_admin INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "email": "TEXT",
                "password_hash": "TEXT",
                "full_name": "TEXT",
                "google_id": "TEXT",
                "is_demo": "INTEGER DEFAULT 0",
                "is_admin": "INTEGER DEFAULT 0",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
            },
        )

        # Sessions
        _ensure_table(
            cursor,
            "sessions",
            """
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                csrf_token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """,
            {
                "id": "TEXT",
                "user_id": "TEXT",
                "csrf_token": "TEXT",
                "expires_at": "TIMESTAMP",
                "created_at": "TIMESTAMP",
            },
        )

        # Organizations
        _ensure_table(
            cursor,
            "organizations",
            """
            CREATE TABLE organizations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT,
                is_demo INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "name": "TEXT",
                "slug": "TEXT",
                "is_demo": "INTEGER DEFAULT 0",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
            },
        )

        # Organization Members
        _ensure_table(
            cursor,
            "organization_members",
            """
            CREATE TABLE organization_members (
                id TEXT PRIMARY KEY,
                organization_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT DEFAULT 'owner',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE (organization_id, user_id)
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "user_id": "TEXT",
                "role": "TEXT DEFAULT 'owner'",
                "created_at": "TIMESTAMP",
            },
        )

        # Documents
        _ensure_table(
            cursor,
            "documents",
            """
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                filename TEXT,
                content_type TEXT,
                text_content TEXT,
                headline TEXT,
                risk_level TEXT DEFAULT 'Unassessed',
                unresolved_count INTEGER DEFAULT 0,
                file_path TEXT,
                rules_snapshot TEXT DEFAULT '[]',
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "filename": "TEXT",
                "content_type": "TEXT",
                "text_content": "TEXT",
                "headline": "TEXT",
                "risk_level": "TEXT DEFAULT 'Unassessed'",
                "unresolved_count": "INTEGER DEFAULT 0",
                "file_path": "TEXT",
                "rules_snapshot": "TEXT DEFAULT '[]'",
                "status": "TEXT DEFAULT 'pending'",
                "created_at": "TIMESTAMP",
            },
        )

        # Brand rules
        _ensure_table(
            cursor,
            "brand_rules",
            """
            CREATE TABLE brand_rules (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                title TEXT,
                rule_category TEXT,
                rule_type TEXT DEFAULT 'custom',
                approved_statement TEXT,
                forbidden_terms TEXT,
                scope TEXT DEFAULT 'Global',
                severity TEXT DEFAULT 'medium',
                effective_date TEXT,
                expires_at TEXT,
                source_filename TEXT,
                source_page INTEGER,
                exact_quote TEXT,
                source_file_path TEXT,
                status TEXT DEFAULT 'candidate',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "title": "TEXT",
                "rule_category": "TEXT",
                "rule_type": "TEXT DEFAULT 'custom'",
                "approved_statement": "TEXT",
                "forbidden_terms": "TEXT",
                "scope": "TEXT DEFAULT 'Global'",
                "severity": "TEXT DEFAULT 'medium'",
                "effective_date": "TEXT",
                "expires_at": "TEXT",
                "source_filename": "TEXT",
                "source_page": "INTEGER",
                "exact_quote": "TEXT",
                "source_file_path": "TEXT",
                "status": "TEXT DEFAULT 'candidate'",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
            },
        )

        # Findings
        _ensure_table(
            cursor,
            "findings",
            """
            CREATE TABLE findings (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                document_id TEXT,
                rule_id TEXT,
                severity TEXT,
                location TEXT,
                image_action TEXT,
                flagged_text TEXT,
                explanation TEXT,
                suggested_fix TEXT,
                suggestion_status TEXT DEFAULT 'not_requested',
                suggestion_explanation TEXT,
                suggestion_change_summary TEXT,
                suggestion_missing_information TEXT DEFAULT '[]',
                evidence TEXT,
                pin_x INTEGER,
                pin_y INTEGER,
                page INTEGER,
                status TEXT DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (document_id) REFERENCES documents(id),
                FOREIGN KEY (rule_id) REFERENCES brand_rules(id)
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "document_id": "TEXT",
                "rule_id": "TEXT",
                "severity": "TEXT",
                "location": "TEXT",
                "image_action": "TEXT",
                "flagged_text": "TEXT",
                "explanation": "TEXT",
                "suggested_fix": "TEXT",
                "suggestion_status": "TEXT DEFAULT 'not_requested'",
                "suggestion_explanation": "TEXT",
                "suggestion_change_summary": "TEXT",
                "suggestion_missing_information": "TEXT DEFAULT '[]'",
                "evidence": "TEXT",
                "pin_x": "INTEGER",
                "pin_y": "INTEGER",
                "page": "INTEGER",
                "status": "TEXT DEFAULT 'open'",
                "created_at": "TIMESTAMP",
            },
        )

        # Validated correction suggestions reusable within the same organization.
        _ensure_table(
            cursor,
            "correction_suggestion_cache",
            """
            CREATE TABLE correction_suggestion_cache (
                organization_id TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                suggestion_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (organization_id, cache_key)
            )
            """,
            {
                "organization_id": "TEXT",
                "cache_key": "TEXT",
                "suggestion_json": "TEXT",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
            },
        )

        # Rule activity log
        _ensure_table(
            cursor,
            "rule_activity_log",
            """
            CREATE TABLE rule_activity_log (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                rule_id TEXT,
                action TEXT,
                title TEXT,
                detail TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "rule_id": "TEXT",
                "action": "TEXT",
                "title": "TEXT",
                "detail": "TEXT",
                "created_at": "TIMESTAMP",
            },
        )

        # General audit trail
        _ensure_table(
            cursor,
            "audit_log",
            """
            CREATE TABLE audit_log (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                document_id TEXT,
                action TEXT,
                detail TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "document_id": "TEXT",
                "action": "TEXT",
                "detail": "TEXT",
                "created_at": "TIMESTAMP",
            },
        )

        # Knowledge graph edges
        _ensure_table(
            cursor,
            "graph_edges",
            """
            CREATE TABLE graph_edges (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                document_id TEXT,
                claim_text TEXT,
                fact_id TEXT,
                relationship TEXT,
                verdict TEXT
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "document_id": "TEXT",
                "claim_text": "TEXT",
                "fact_id": "TEXT",
                "relationship": "TEXT",
                "verdict": "TEXT",
            },
        )

        # Rule precedents
        _ensure_table(
            cursor,
            "rule_precedents",
            """
            CREATE TABLE rule_precedents (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                rule_id TEXT,
                finding_id TEXT,
                decision TEXT,
                rationale TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "rule_id": "TEXT",
                "finding_id": "TEXT",
                "decision": "TEXT",
                "rationale": "TEXT",
                "created_at": "TIMESTAMP",
            },
        )

        # Bulk jobs
        _ensure_table(
            cursor,
            "bulk_jobs",
            """
            CREATE TABLE bulk_jobs (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                name TEXT,
                total_files INTEGER DEFAULT 0,
                processed_files INTEGER DEFAULT 0,
                passed_files INTEGER DEFAULT 0,
                failed_files INTEGER DEFAULT 0,
                unsupported_files INTEGER DEFAULT 0,
                rules_snapshot TEXT DEFAULT '[]',
                status TEXT DEFAULT 'queued',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "name": "TEXT",
                "total_files": "INTEGER DEFAULT 0",
                "processed_files": "INTEGER DEFAULT 0",
                "passed_files": "INTEGER DEFAULT 0",
                "failed_files": "INTEGER DEFAULT 0",
                "unsupported_files": "INTEGER DEFAULT 0",
                "rules_snapshot": "TEXT DEFAULT '[]'",
                "status": "TEXT DEFAULT 'queued'",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
            },
        )

        # Files belonging to bulk jobs
        _ensure_table(
            cursor,
            "bulk_job_files",
            """
            CREATE TABLE bulk_job_files (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                job_id TEXT,
                original_filename TEXT,
                file_path TEXT,
                file_type TEXT,
                status TEXT DEFAULT 'pending',
                passed_check INTEGER DEFAULT 0,
                findings_count INTEGER DEFAULT 0,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                document_id TEXT,
                content_type TEXT,
                text_content TEXT,
                headline TEXT,
                risk_level TEXT,
                audit_status TEXT,
                findings_json TEXT,
                FOREIGN KEY (job_id) REFERENCES bulk_jobs(id)
            )
            """,
            {
                "id": "TEXT",
                "organization_id": "TEXT",
                "job_id": "TEXT",
                "original_filename": "TEXT",
                "file_path": "TEXT",
                "file_type": "TEXT",
                "status": "TEXT DEFAULT 'pending'",
                "passed_check": "INTEGER DEFAULT 0",
                "findings_count": "INTEGER DEFAULT 0",
                "error_message": "TEXT",
                "created_at": "TIMESTAMP",
                "updated_at": "TIMESTAMP",
                "processed_at": "TIMESTAMP",
                "document_id": "TEXT",
                "content_type": "TEXT",
                "text_content": "TEXT",
                "headline": "TEXT",
                "risk_level": "TEXT",
                "audit_status": "TEXT",
                "findings_json": "TEXT",
            },
        )

        # Indexes
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_users_email
            ON users(email)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id
            ON sessions(user_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_org_members_user
            ON organization_members(user_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_org_members_org
            ON organization_members(organization_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_documents_org
            ON documents(organization_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_brand_rules_org
            ON brand_rules(organization_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_findings_org
            ON findings(organization_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_findings_document_id
            ON findings(document_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_findings_rule_id
            ON findings(rule_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_bulk_job_files_job_id
            ON bulk_job_files(job_id)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_brand_rules_status
            ON brand_rules(status)
            """
        )

        # --------------------------------------------------
        # Safe legacy data migration
        # --------------------------------------------------
        default_org_id = "org_default"
        default_org_name = "Before It Goes Live (Enterprise Team)"

        existing_default_org = cursor.execute(
            "SELECT id FROM organizations WHERE id = ?",
            (default_org_id,),
        ).fetchone()

        if not existing_default_org:
            cursor.execute(
                """
                INSERT OR IGNORE INTO organizations (id, name, slug, is_demo)
                VALUES (?, ?, 'enterprise', 0)
                """,
                (default_org_id, default_org_name),
            )

        # Backfill existing legacy records where organization_id is NULL
        legacy_tables = [
            "documents",
            "brand_rules",
            "findings",
            "rule_activity_log",
            "audit_log",
            "graph_edges",
            "rule_precedents",
            "bulk_jobs",
            "bulk_job_files",
        ]
        for tbl in legacy_tables:
            if _table_exists(cursor, tbl):
                cursor.execute(
                    f'UPDATE "{tbl}" SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ""',
                    (default_org_id,),
                )

        conn.commit()

        # Seed 6 standard default rules
        seed_standard_default_rules(conn)

        # Idempotently provision demo account if DEMO_ACCOUNT_ENABLED=true
        try:
            import auth
            auth.provision_demo_account(conn)
        except Exception:
            pass

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print("Database schema successfully verified.")
