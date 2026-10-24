import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "before_it_goes_live.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # 1. AUTO-DETECT OLD SCHEMA (Fixes 'datatype mismatch' and missing 'title')
    cursor.execute("PRAGMA table_info(documents)")
    rows = cursor.fetchall()
    if rows:
        col_types = {r[1]: str(r[2]).upper() for r in rows}
        # If id was INTEGER or title was missing, reset to clean TEXT schema:
        if "INT" in col_types.get("id", "") or "title" not in col_types:
            cursor.execute("DROP TABLE IF EXISTS documents")
            cursor.execute("DROP TABLE IF EXISTS findings")
            cursor.execute("DROP TABLE IF EXISTS graph_edges")

    # 2. Documents Table (id is TEXT PRIMARY KEY)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT 'Untitled Draft',
        content_type TEXT DEFAULT 'text',
        raw_text TEXT,
        status TEXT DEFAULT 'scanned',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 3. Brand Rules Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS brand_rules (
        id TEXT PRIMARY KEY,
        title TEXT,
        rule_category TEXT,
        approved_statement TEXT,
        forbidden_terms TEXT,
        override_count INTEGER DEFAULT 0
    )
    """)

    # 4. Findings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        rule_id TEXT,
        severity TEXT,
        flagged_text TEXT,
        explanation TEXT,
        suggested_fix TEXT,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 5. Knowledge Graph Edges Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        claim_text TEXT,
        fact_id TEXT,
        relationship TEXT,
        verdict TEXT
    )
    """)

    # 6. Rule Precedents Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rule_precedents (
        id TEXT PRIMARY KEY,
        rule_id TEXT,
        finding_id TEXT,
        decision TEXT,
        rationale TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 7. Seed Default Brand Rules if empty
    cursor.execute("SELECT COUNT(*) FROM brand_rules")
    if cursor.fetchone()[0] == 0:
        default_rules = [
            ("BR-01", "No Absolute Medical Reversal Claims", "Clinical & Regulatory", "Cosmetic products must state 'reduces appearance of fine lines', never 'reverses aging'.", "reverse aging,cure,permanently"),
            ("BR-02", "Organic Ingredient Certification Threshold", "Formulation & Science", "Specification confirms 95% certified organic extracts. Never claim 100% without certification.", "100% organic,pure organic"),
            ("BR-03", "Promotional Price Expiration Mandate", "Commercial & Pricing", "Promotional flash sale prices (e.g. $49) must state clear expiration deadline.", "flash promo,$49"),
            ("BR-04", "Clinical Trial Attribution", "Clinical & Regulatory", "Efficacy statistics must cite clinical protocol #2024-B with 4-week duration.", "instant,overnight,3 days")
        ]
        cursor.executemany(
            "INSERT INTO brand_rules (id, title, rule_category, approved_statement, forbidden_terms, override_count) VALUES (?, ?, ?, ?, ?, 0)",
            default_rules
        )

    conn.commit()
    conn.close()