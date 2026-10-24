import os
import sqlite3
import requests
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import get_db_connection, init_db
from engine import (
    extract_text_from_file,
    extract_text_from_url,
    extract_claims,
    match_claims_to_rules,
    generate_fixes,
    build_knowledge_graph,
    scan_blast_radius,
    check_campaign_conflicts,
    get_guideline_health,
    record_rule_precedent
)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AQ.Ab8RN6JUO4Pd16fk1Tza8WO-G2Q9L4NEGHSke99NciEflH67hQ")

init_db()

app = FastAPI(
    title="Before It Goes Live API",
    description="Pre-flight content review, living knowledge graph, and AI brand audit co-pilot.",
    version="1.0.0"
)

# Enable CORS for local Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------
class IntakeRequest(BaseModel):
    title: Optional[str] = "Untitled Draft"
    content_type: str = "text"  # 'text' | 'url'
    raw_text: Optional[str] = None
    url: Optional[str] = None

class ApplyFixRequest(BaseModel):
    action: str = "apply"  # 'apply' | 'dismiss' | 'custom'
    custom_text: Optional[str] = None

class CampaignCheckRequest(BaseModel):
    assets: List[Dict[str, str]]

class PrecedentRequest(BaseModel):
    rule_id: str
    decision: str  # 'approved_override' | 'rejected'
    rationale: str
    finding_id: Optional[str] = None

class AIAskRequest(BaseModel):
    document_id: Optional[str] = None
    node_id: Optional[str] = None
    node_text: Optional[str] = None
    node_type: Optional[str] = None
    edge_verdict: Optional[str] = None
    question: str


# ---------------------------------------------------------
# 1. Health & Welcome
# ---------------------------------------------------------
@app.get("/")
def read_root():
    return {
        "project": "Before It Goes Live",
        "status": "online",
        "gemini_active": bool(GEMINI_API_KEY and GEMINI_API_KEY != "PASTE_YOUR_GEMINI_API_KEY_HERE"),
        "docs_url": "http://127.0.0.1:8000/docs"
    }


# ---------------------------------------------------------
# 2. Intake Endpoint (Text, URL, File Upload)
# ---------------------------------------------------------
@app.post("/api/intake")
# ---------------------------------------------------------
# 2B. Bulk Intake Endpoint (Multiple Files, Auto-Triage)
# ---------------------------------------------------------
@app.post("/api/intake/bulk")
async def bulk_content_intake(files: List[UploadFile] = File(...)):
    """
    Accepts multiple files via drag-and-drop or multi-select.
    Extracts text, scans claims, categorizes asset type, and calculates priority.
    """
    import uuid
    conn = get_db_connection()
    cursor = conn.cursor()

    batch_results = []

    for file in files:
        file_bytes = await file.read()
        filename = file.filename
        ext = filename.lower().split('.')[-1]

        # 1. Auto-categorize channel/format
        if ext in ['png', 'jpg', 'jpeg', 'webp']:
            asset_category = "Social Ad / Creative Banner"
        elif ext in ['pptx']:
            asset_category = "Sales Deck / Presentation"
        elif ext in ['pdf', 'docx']:
            asset_category = "Product Documentation / Whitepaper"
        else:
            asset_category = "Marketing Draft"

        # 2. Extract text (using deep PDF/PPTX or Gemini Image Vision)
        extracted_text = extract_text_from_file(filename, file_bytes, GEMINI_API_KEY)

        # 3. Create document record
        doc_id = str(uuid.uuid4())[:8]
        cursor.execute(
            "INSERT INTO documents (id, title, content_type, raw_text, status) VALUES (?, ?, ?, ?, ?)",
            (doc_id, filename, asset_category, extracted_text, "scanned")
        )

        # 4. Extract claims and match rules
        claims = extract_claims(extracted_text)
        findings = match_claims_to_rules(cursor, claims)

        critical_count = 0
        warning_count = 0

        for f in findings:
            f_id = str(uuid.uuid4())[:8]
            cursor.execute(
                """INSERT INTO findings 
                   (id, document_id, rule_id, severity, flagged_text, explanation, suggested_fix, status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (f_id, doc_id, f["rule_id"], f["severity"], f["flagged_text"], f["explanation"], f["suggested_fix"], "open")
            )
            if f["severity"] == "critical":
                critical_count += 1
            else:
                warning_count += 1

        # 5. Build Knowledge Graph edges
        edges = build_knowledge_graph(cursor, doc_id, claims)
        for edge in edges:
            e_id = str(uuid.uuid4())[:8]
            cursor.execute(
                """INSERT INTO graph_edges 
                   (id, document_id, claim_text, fact_id, relationship, verdict) 
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (e_id, doc_id, edge["claim_text"], edge.get("fact_id"), edge["relationship"], edge["verdict"])
            )

        # 6. Compute Triage Priority
        if critical_count > 0:
            priority = "high"       # 🔴 Blocker: Immediate human review required
            recommendation = f"BLOCKED: {critical_count} critical violations must be resolved before publication."
        elif warning_count > 0:
            priority = "medium"     # 🟡 Caution: Claims need source backing or mild fixes
            recommendation = f"CAUTION: {warning_count} ungrounded claims detected."
        else:
            priority = "low"        # 🟢 Clean: 100% compliant, ready to auto-approve
            recommendation = "CLEARED: 100% compliant with approved brand guidelines."

        batch_results.append({
            "document_id": doc_id,
            "title": filename,
            "category": asset_category,
            "priority": priority,
            "total_findings": len(findings),
            "critical_count": critical_count,
            "warning_count": warning_count,
            "recommendation": recommendation
        })

    conn.commit()
    conn.close()

    # Sort so High Priority (Blockers) appear at the very top of the user's queue
    priority_order = {"high": 0, "medium": 1, "low": 2}
    batch_results.sort(key=lambda x: priority_order.get(x["priority"], 3))

    return {
        "total_uploaded": len(batch_results),
        "high_priority_count": sum(1 for b in batch_results if b["priority"] == "high"),
        "medium_priority_count": sum(1 for b in batch_results if b["priority"] == "medium"),
        "low_priority_count": sum(1 for b in batch_results if b["priority"] == "low"),
        "queue": batch_results
    }
async def content_intake(
    title: Optional[str] = Form("Untitled Draft"),
    content_type: Optional[str] = Form("text"),
    raw_text: Optional[str] = Form(None),
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    extracted_text = ""

    if file:
        file_bytes = await file.read()
        extracted_text = extract_text_from_file(file.filename, file_bytes)
        title = file.filename
        content_type = "file"
    elif url:
        extracted_text = extract_text_from_url(url)
        content_type = "url"
    elif raw_text:
        extracted_text = raw_text
    else:
        raise HTTPException(status_code=400, detail="No content provided (text, URL, or file required)")

    # 1. Save document to SQLite
    conn = get_db_connection()
    cursor = conn.cursor()
    import uuid
    doc_id = str(uuid.uuid4())[:8]

    cursor.execute(
        "INSERT INTO documents (id, title, content_type, raw_text, status) VALUES (?, ?, ?, ?, ?)",
        (doc_id, title, content_type, extracted_text, "scanned")
    )

    # 2. Extract claims and match against active brand guidelines
    claims = extract_claims(extracted_text)
    findings = match_claims_to_rules(cursor, claims)

    # 3. Save findings to database
    for f in findings:
        f_id = str(uuid.uuid4())[:8]
        cursor.execute(
            """INSERT INTO findings 
               (id, document_id, rule_id, severity, flagged_text, explanation, suggested_fix, status) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (f_id, doc_id, f["rule_id"], f["severity"], f["flagged_text"], f["explanation"], f["suggested_fix"], "open")
        )

    # 4. Build and persist Knowledge Graph edges
    edges = build_knowledge_graph(cursor, doc_id, claims)
    for edge in edges:
        e_id = str(uuid.uuid4())[:8]
        cursor.execute(
            """INSERT INTO graph_edges 
               (id, document_id, claim_text, fact_id, relationship, verdict) 
               VALUES (?, ?, ?, ?, ?, ?)""",
            (e_id, doc_id, edge["claim_text"], edge.get("fact_id"), edge["relationship"], edge["verdict"])
        )

    conn.commit()
    conn.close()

    return {
        "document_id": doc_id,
        "title": title,
        "findings_count": len(findings),
        "status": "scanned"
    }


# ---------------------------------------------------------
# 3. Review Endpoint (Findings & Document Copy)
# ---------------------------------------------------------
@app.get("/api/review/{document_id}")
def get_review_data(document_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM documents WHERE id = ?", (document_id,))
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        raise HTTPException(status_code=404, detail="Document not found")

    cursor.execute("SELECT * FROM findings WHERE document_id = ?", (document_id,))
    findings_rows = cursor.fetchall()

    cursor.execute("SELECT * FROM graph_edges WHERE document_id = ?", (document_id,))
    edge_rows = cursor.fetchall()

    conn.close()

    return {
        "document": dict(doc),
        "findings": [dict(r) for r in findings_rows],
        "graph_edges": [dict(e) for e in edge_rows]
    }


# ---------------------------------------------------------
# 4. Apply / Dismiss Fix
# ---------------------------------------------------------
@app.post("/api/review/{document_id}/fix/{finding_id}")
def apply_fix(document_id: str, finding_id: str, req: ApplyFixRequest):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM findings WHERE id = ? AND document_id = ?", (finding_id, document_id))
    finding = cursor.fetchone()
    if not finding:
        conn.close()
        raise HTTPException(status_code=404, detail="Finding not found")

    cursor.execute("SELECT * FROM documents WHERE id = ?", (document_id,))
    doc = cursor.fetchone()

    updated_text = doc["raw_text"]
    new_status = "resolved" if req.action == "apply" else "dismissed"

    if req.action == "apply" and finding["suggested_fix"]:
        updated_text = updated_text.replace(finding["flagged_text"], finding["suggested_fix"])
        cursor.execute("UPDATE documents SET raw_text = ? WHERE id = ?", (updated_text, document_id))

    cursor.execute("UPDATE findings SET status = ? WHERE id = ?", (new_status, finding_id))
    conn.commit()
    conn.close()

    return {
        "message": f"Finding {finding_id} updated to {new_status}",
        "updated_raw_text": updated_text
    }


# ---------------------------------------------------------
# 5. Knowledge Graph Endpoint
# ---------------------------------------------------------
@app.get("/api/graph/{document_id}")
def get_graph_data(document_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM graph_edges WHERE document_id = ?", (document_id,))
    edges = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT id, title, rule_category, approved_statement FROM brand_rules")
    facts = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return {
        "document_id": document_id,
        "edges": edges,
        "approved_facts": facts
    }


# ---------------------------------------------------------
# 6. Real Google Gemini AI Co-Pilot
# ---------------------------------------------------------
@app.post("/api/ai/ask")
def ask_ai_copilot(req: AIAskRequest):
    """
    Real AI Co-Pilot powered by Google Gemini (gemini-1.5-flash / gemini-2.0-flash).
    Provides context-aware brand compliance reasoning on draft claims and rules.
    """
    # 1. Gather document text context if available
    doc_context = ""
    if req.document_id:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT raw_text FROM documents WHERE id = ?", (req.document_id,))
            row = cursor.fetchone()
            if row and row["raw_text"]:
                doc_context = f"\nFULL DRAFT COPY UNDER REVIEW:\n\"\"\"{row['raw_text']}\"\"\"\n"
            conn.close()
        except Exception:
            pass

    # 2. Build the System & Prompt Context
    system_instruction = (
        "You are 'Before It Goes Live' AI Co-Pilot — an elite brand governance, regulatory compliance, "
        "and advertising claims auditor. You help content creators identify factual conflicts, unverified claims, "
        "and compliance risks in their marketing and product copy before publication.\n\n"
        "Guidelines for your response:\n"
        "- Be direct, concise, and professional.\n"
        "- Explain exactly WHY a claim passed, contradicted approved facts, or lacked source evidence.\n"
        "- If there is a violation or the user asks for a solution, provide a compliant rewrite suggestion."
    )

    prompt = f"""{system_instruction}

AUDIT CONTEXT:
- Inspected Graph Node: "{req.node_text or 'Selected Element'}"
- Node Type: {req.node_type or 'Draft Claim'}
- Status / Verdict: {req.edge_verdict or 'Under Review'}
{doc_context}

USER QUESTION:
"{req.question}"

Please provide your compliance analysis:
"""

    # 3. Call Google Gemini via standard HTTP request (No extra SDK setup needed)
    is_valid_key = bool(GEMINI_API_KEY and GEMINI_API_KEY.strip() != "PASTE_YOUR_GEMINI_API_KEY_HERE")

    if is_valid_key:
        try:
            # We use gemini-1.5-flash which provides 15 RPM, 1,000,000 tokens/min for free
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY.strip()}"
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": prompt}]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.3,
                    "maxOutputTokens": 600
                }
            }
            resp = requests.post(url, json=payload, timeout=12)
            
            if resp.status_code == 200:
                data = resp.json()
                ai_answer = data["candidates"][0]["content"]["parts"][0]["text"]
                return {
                    "answer": ai_answer.strip(),
                    "source": "Google Gemini 1.5 Flash (Live AI)"
                }
            else:
                err_msg = resp.text
                print(f"[Gemini API Error] {resp.status_code}: {err_msg}")
                # If key has quota or format issue, explain clearly:
                return {
                    "answer": f"Gemini API returned code {resp.status_code}. Details: {err_msg[:200]}...",
                    "source": "Gemini API Error"
                }
        except Exception as e:
            print(f"[Gemini Request Exception]: {e}")
            return {
                "answer": f"Unable to reach Gemini API: {str(e)}",
                "source": "Network Exception"
            }

    # 4. Fallback if key is still default placeholder
    return {
        "answer": (
            f"Regarding '{req.node_text or 'this claim'}': To receive live Gemini responses, "
            f"open backend/main.py and paste your Gemini API key on Line 18. "
            f"Currently running in local preview mode."
        ),
        "source": "Setup Needed (Set key on line 18)"
    }


# ---------------------------------------------------------
# 7. Audit Activity Ledger Endpoint
# ---------------------------------------------------------
@app.get("/api/activity")
def get_activity_ledger():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            d.id,
            d.title,
            d.content_type,
            d.created_at,
            d.status,
            COUNT(f.id) as total_findings,
            SUM(CASE WHEN f.status = 'resolved' THEN 1 ELSE 0 END) as resolved_findings,
            SUM(CASE WHEN f.severity = 'critical' THEN 1 ELSE 0 END) as critical_count
        FROM documents d
        LEFT JOIN findings f ON d.id = f.document_id
        GROUP BY d.id
        ORDER BY d.created_at DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    return {"history": [dict(r) for r in rows]}


# ---------------------------------------------------------
# 8. Blast-Radius Scanner Endpoint
# ---------------------------------------------------------
@app.get("/api/blast-radius")
def blast_radius(keyword: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    impacted = scan_blast_radius(cursor, keyword)
    conn.close()
    return {"keyword": keyword, "impacted_documents": impacted}


# ---------------------------------------------------------
# 9. Precedents & Guideline Health Endpoints
# ---------------------------------------------------------
@app.get("/api/guidelines/health")
def guideline_health():
    conn = get_db_connection()
    cursor = conn.cursor()
    health_stats = get_guideline_health(cursor)
    conn.close()
    return {"guidelines": health_stats}

@app.post("/api/guidelines/precedent")
def log_precedent(req: PrecedentRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    record_rule_precedent(cursor, req.rule_id, req.decision, req.rationale, req.finding_id)
    conn.commit()
    conn.close()
    return {"status": "recorded"}


# ---------------------------------------------------------
# 10. Multi-Asset Campaign Check (Kept for compatibility)
# ---------------------------------------------------------
@app.post("/api/campaign/check")
def campaign_check(req: CampaignCheckRequest):
    discrepancies = check_campaign_conflicts(req.assets)
    return {
        "status": "conflict_detected" if discrepancies else "pass",
        "discrepancies": discrepancies
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main.py:app", host="127.0.0.1", port=8000, reload=True)