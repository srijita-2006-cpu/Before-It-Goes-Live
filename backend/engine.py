import re
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from docx import Document as DocxDocument
from pptx import Presentation
from database import get_connection

# --- 1. FILE PARSING ---

def extract_text_from_file(file_path: Path, filename: str) -> str:
    ext = file_path.suffix.lower()

    if ext == ".pdf":
        reader = PdfReader(file_path)
        return "\n".join([page.extract_text() or "" for page in reader.pages])

    elif ext in [".docx", ".doc"]:
        doc = DocxDocument(file_path)
        return "\n".join([p.text for p in doc.paragraphs if p.text.strip()])

    elif ext in [".pptx", ".ppt"]:
        prs = Presentation(file_path)
        text_runs = []
        for slide_idx, slide in enumerate(prs.slides, start=1):
            for shape in slide.shapes:
                if shape.has_text_frame and shape.text.strip():
                    text_runs.append(f"[Slide {slide_idx}] {shape.text.strip()}")
        return "\n".join(text_runs)

    else:
        # Fallback to plain text / code / csv
        return file_path.read_text(encoding="utf-8", errors="ignore")

def extract_text_from_url(url: str) -> str:
    resp = requests.get(url, timeout=8, headers={"User-Agent": "BeforeItGoesLive/1.0"})
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    return "\n".join([p.get_text(strip=True) for p in soup.find_all(["h1", "h2", "h3", "p"]) if len(p.get_text(strip=True)) > 5])

# --- 2. AUDIT ENGINE ---

CLAIM_RULES = [
    {
        "type": "Absolute claim",
        "pattern": re.compile(r"\b(100%|guarantee[ds]?|flawless skin|pure perfection)\b", re.IGNORECASE),
        "severity": "High",
        "explanation": "Absolute guarantees require verified clinical trial certification.",
        "evidence": "Brand Guideline §4.2: Absolute and Superlative Claims",
        "fix": "visibly enhances skin radiance"
    },
    {
        "type": "Unsubstantiated timeframe",
        "pattern": re.compile(r"\b(in just 3 days|reverses? aging in 7 days|overnight)\b", re.IGNORECASE),
        "severity": "Medium",
        "explanation": "Specific timeframe claims must align with the approved 28-day testing protocol.",
        "evidence": "Clinical Dossier #2024-B: Approved for 28-day timeline",
        "fix": "supports natural renewal with daily use"
    },
    {
        "type": "Comparative claim",
        "pattern": re.compile(r"\b(no other cream works better|most powerful formula|best on the market)\b", re.IGNORECASE),
        "severity": "Low",
        "explanation": "Market superiority claims need comparative bench testing documentation.",
        "evidence": "Advertising Standards Compliance Guide §8",
        "fix": "designed to complement your everyday routine"
    }
]

def run_content_audit(document_id: int, content_text: str):
    conn = get_connection()
    cursor = conn.cursor()

    findings = []
    edges = []

    for rule in CLAIM_RULES:
        match = rule["pattern"].search(content_text)
        if match:
            flagged = match.group(0)
            cursor.execute("""
            INSERT INTO findings (document_id, title, severity, flagged_text, explanation, evidence, suggested_fix)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                document_id,
                rule["type"],
                rule["severity"],
                flagged,
                rule["explanation"],
                rule["evidence"],
                rule["fix"]
            ))
            finding_id = cursor.lastrowid

            # Connect graph: Asset -> Finding -> Rule -> Fix
            edges.append((f"asset_{document_id}", f"finding_{finding_id}", "FLAGGED_IN"))
            edges.append((f"finding_{finding_id}", f"rule_{rule['severity'].lower()}", "GOVERNED_BY"))
            edges.append((f"finding_{finding_id}", f"fix_{finding_id}", "PROPOSES_FIX"))

    cursor.executemany("INSERT INTO graph_edges (source_id, target_id, relation) VALUES (?, ?, ?)", edges)
    conn.commit()
    conn.close()

# --- 3. BLAST RADIUS RE-CHECK ---

def check_blast_radius(rule_keyword: str):
    """When a rule or fact changes, find past documents containing that keyword."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, filename FROM documents WHERE raw_text LIKE ?
    """, (f"%{rule_keyword}%",))
    affected = [{"id": row["id"], "filename": row["filename"]} for row in cursor.fetchall()]
    conn.close()
    return affected
# --- 4. CAMPAIGN-BUNDLE CONSISTENCY ---

def check_campaign_bundle(document_ids: list[int]) -> list[dict]:
    """Finds contradictory prices, dates, or discounts across multiple assets in a campaign."""
    conn = get_connection()
    cursor = conn.cursor()

    placeholders = ",".join(["?"] * len(document_ids))
    cursor.execute(f"SELECT id, filename, raw_text FROM documents WHERE id IN ({placeholders})", document_ids)
    docs = [dict(row) for row in cursor.fetchall()]
    conn.close()

    conflicts = []
    prices_found = []

    # Regex to find prices like $49, $49.99
    price_regex = re.compile(r"\$\d+(?:\.\d{2})?")

    for doc in docs:
        matches = price_regex.findall(doc["raw_text"])
        for p in matches:
            prices_found.append({"doc_id": doc["id"], "filename": doc["filename"], "price": p})

    # If different prices exist across assets in the same campaign
    unique_prices = set([item["price"] for item in prices_found])
    if len(unique_prices) > 1:
        conflicts.append({
            "type": "Conflicting Pricing Across Assets",
            "severity": "High",
            "details": f"Found mismatched pricing across campaign assets: {list(unique_prices)}",
            "occurrences": prices_found
        })

    return conflicts

# --- 5. GUIDELINE HEALTH & PRECEDENT ---

def record_user_decision(rule_id: int, decision: str, rationale: str = ""):
    """Tracks whether a rule was accepted or overridden to measure guideline health."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rule_precedents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER,
        decision TEXT,
        rationale TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("INSERT INTO rule_precedents (rule_id, decision, rationale) VALUES (?, ?, ?)", (rule_id, decision, rationale))
    conn.commit()
    conn.close()

def get_guideline_health() -> list[dict]:
    """Identifies frequently overridden rules that may be ambiguous or outdated."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT rule_id, 
           COUNT(*) as total_reviews,
           SUM(CASE WHEN decision = 'Overridden' THEN 1 ELSE 0 END) as overrides
    FROM rule_precedents
    GROUP BY rule_id
    """)
    rows = cursor.fetchall()
    conn.close()
    return [{"rule_id": r["rule_id"], "total": r["total_reviews"], "overrides": r["overrides"]} for r in rows]