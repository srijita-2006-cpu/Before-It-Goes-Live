import shutil
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from database import get_connection
from engine import extract_text_from_file, extract_text_from_url, run_content_audit, check_blast_radius

app = FastAPI(title="Before It Goes Live API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Root endpoint (health & API docs link)
@app.get("/")
def root():
    return {
        "status": "online",
        "app": "Before It Goes Live API",
        "docs": "Visit /docs to test all endpoints"
    }

# 1. Content Intake: Text, File (PDF, PPTX, DOCX), or URL
@app.post("/api/intake")
async def intake_content(
    text: str = Form(None),
    url: str = Form(None),
    file: UploadFile = File(None)
):
    raw_text = ""
    filename = "pasted_content.txt"
    file_type = "text"

    if url:
        filename = url
        file_type = "url"
        raw_text = extract_text_from_url(url)
    elif file:
        filename = file.filename
        file_type = Path(filename).suffix.replace(".", "")
        saved_path = UPLOAD_DIR / filename
        with open(saved_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        raw_text = extract_text_from_file(saved_path, filename)
    elif text:
        raw_text = text

    # Save to database
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO documents (filename, file_type, raw_text) VALUES (?, ?, ?)", (filename, file_type, raw_text))
    doc_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Run audit and generate graph
    run_content_audit(doc_id, raw_text)

    return {"document_id": doc_id, "filename": filename, "characters": len(raw_text)}

# 2. Get Findings for a Document
@app.get("/api/review/{document_id}")
def get_review(document_id: int):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT raw_text FROM documents WHERE id = ?", (document_id,))
    doc = cursor.fetchone()
    if not doc:
        return {"error": "Document not found"}

    cursor.execute("SELECT * FROM findings WHERE document_id = ?", (document_id,))
    findings = [dict(row) for row in cursor.fetchall()]

    conn.close()
    return {"raw_text": doc["raw_text"], "findings": findings}

# 3. Apply a Fix
@app.post("/api/review/{document_id}/fix/{finding_id}")
def apply_fix(document_id: int, finding_id: int, payload: dict):
    replacement = payload.get("replacement", "")
    conn = get_connection()
    cursor = conn.cursor()

    # Mark finding as resolved
    cursor.execute("UPDATE findings SET status = 'Resolved' WHERE id = ?", (finding_id,))

    # Update document raw text
    cursor.execute("SELECT flagged_text FROM findings WHERE id = ?", (finding_id,))
    finding = cursor.fetchone()

    cursor.execute("SELECT raw_text FROM documents WHERE id = ?", (document_id,))
    current_text = cursor.fetchone()["raw_text"]

    if finding and finding["flagged_text"] in current_text:
        updated_text = current_text.replace(finding["flagged_text"], replacement, 1)
        cursor.execute("UPDATE documents SET raw_text = ? WHERE id = ?", (updated_text, document_id))

    conn.commit()
    conn.close()
    return {"status": "success", "resolved_id": finding_id}

# 4. Visual Graph System
@app.get("/api/graph/{document_id}")
def get_graph(document_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT source_id, target_id, relation FROM graph_edges WHERE source_id LIKE ?", (f"%{document_id}%",))
    edges = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"edges": edges}

# 5. Blast-radius Recheck Endpoint
@app.get("/api/blast-radius")
def blast_radius(keyword: str):
    return {"keyword": keyword, "affected_documents": check_blast_radius(keyword)}
from engine import check_campaign_bundle, get_guideline_health, record_user_decision

# 6. Campaign Bundle Consistency Check
@app.post("/api/campaign/check")
def campaign_consistency(payload: dict):
    document_ids = payload.get("document_ids", [])
    conflicts = check_campaign_bundle(document_ids)
    return {"status": "ok", "conflicts": conflicts}

# 7. Guideline Health & Precedents
@app.get("/api/guidelines/health")
def guideline_health():
    return {"health_metrics": get_guideline_health()}

@app.post("/api/guidelines/precedent")
def log_precedent(payload: dict):
    record_user_decision(payload.get("rule_id", 1), payload.get("decision", "Accepted"), payload.get("rationale", ""))
    return {"status": "recorded"}
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)