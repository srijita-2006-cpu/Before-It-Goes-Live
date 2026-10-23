import sqlite3
import json
from pathlib import Path

DB_FILE = Path(__file__).parent / "before_it_goes_live.db"

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # Documents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Brand Guidelines / Rules
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS brand_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        severity TEXT NOT NULL,
        rationale TEXT NOT NULL
    )
    """)

    # Audit Findings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        flagged_text TEXT NOT NULL,
        explanation TEXT NOT NULL,
        evidence TEXT NOT NULL,
        suggested_fix TEXT NOT NULL,
        status TEXT DEFAULT 'Open',
        FOREIGN KEY(document_id) REFERENCES documents(id)
    )
    """)

    # Knowledge Graph (Nodes & Edges)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL
    )
    """)

    # Seed default brand rules if empty
    cursor.execute("SELECT COUNT(*) FROM brand_rules")
    if cursor.fetchone()[0] == 0:
        default_rules = [
            ("Claim", "Never make absolute perfection or 100% efficacy claims without clinical clearance.", "High", "Brand Guideline §4.2: Avoid superlative and absolute claims."),
            ("Timeframe", "Do not promise results under 28 days without certified testing dossiers.", "Medium", "Clinical Dossier #2024-B: Product is tested for 28-day skin renewal."),
            ("Comparative", "Direct competitive claims require explicit disclaimers and test data.", "Low", "Advertising Compliance Guide §8: Broad superiority claims need proof.")
        ]
        cursor.executemany("INSERT INTO brand_rules (category, rule_text, severity, rationale) VALUES (?, ?, ?, ?)", default_rules)

    conn.commit()
    conn.close()

# Auto-initialize database on import
init_db()