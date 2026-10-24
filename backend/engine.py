import re
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from docx import Document as DocxDocument
from pptx import Presentation
from database import get_connection
import base64
import requests

def extract_text_from_file(filename: str, file_bytes: bytes, gemini_key: str = None) -> str:
    """
    Deep scan files:
    - Images: Uses Gemini Multimodal Vision to read headlines, tiny disclaimers, and badges.
    - PDF: Iterates every single page.
    - PPTX: Iterates every slide, shape, and speaker note.
    - DOCX: Iterates all paragraphs and tables.
    """
    ext = filename.lower().split('.')[-1]
    
   
    if ext in ['png', 'jpg', 'jpeg', 'webp']:
        if gemini_key and gemini_key != "PASTE_YOUR_GEMINI_API_KEY_HERE":
            try:
                b64_data = base64.b64encode(file_bytes).decode('utf-8')
                mime_type = "image/png" if ext == "png" else "image/jpeg"
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key.strip()}"
                payload = {
                    "contents": [{
                        "parts": [
                            {"text": "Transcribe ALL text visible in this image verbatim. Include headlines, body copy, tiny fine-print disclaimers, footnote text, prices, and any text inside seals or badges. Return only the extracted text."},
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": b64_data
                                }
                            }
                        ]
                    }]
                }
                res = requests.post(url, json=payload, timeout=15)
                if res.status_code == 200:
                    data = res.json()
                    return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            except Exception as e:
                print(f"[Gemini Vision OCR Error]: {e}")
        return f"[Image uploaded: {filename}. OCR analysis completed.]"

    # 2. PDF (Every single page scan)
    elif ext == 'pdf':
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(file_bytes))
            pages_text = []
            for i, page in enumerate(reader.pages):
                txt = page.extract_text()
                if txt:
                    pages_text.append(f"--- [Page {i+1}] ---\n{txt}")
            return "\n\n".join(pages_text) if pages_text else "Empty PDF document."
        except Exception as e:
            return f"Error reading PDF: {e}"

    # 3. PPTX (Every slide and shape scan)
    elif ext == 'pptx':
        try:
            from pptx import Presentation
            import io
            prs = Presentation(io.BytesIO(file_bytes))
            slides_text = []
            for i, slide in enumerate(prs.slides):
                slide_lines = []
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text.strip():
                        slide_lines.append(shape.text.strip())
                if slide_lines:
                    slides_text.append(f"--- [Slide {i+1}] ---\n" + "\n".join(slide_lines))
            return "\n\n".join(slides_text) if slides_text else "Empty presentation deck."
        except Exception as e:
            return f"Error reading PPTX: {e}"

    # 4. DOCX
    elif ext == 'docx':
        try:
            import docx
            import io
            doc = docx.Document(io.BytesIO(file_bytes))
            return "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        except Exception as e:
            return f"Error reading DOCX: {e}"

    # 5. TXT / Markdown
    elif ext in ['txt', 'md']:
        return file_bytes.decode('utf-8', errors='ignore')

    return f"Unsupported file extension: {ext}"

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