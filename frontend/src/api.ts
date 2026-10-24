// ==========================================
// CENTRAL API CLIENT FOR 'BEFORE IT GOES LIVE'
// ==========================================

const API_BASE = "http://127.0.0.1:8000";

// --- Types ---
export interface AskAIParams {
  document_id?: string;
  node_id?: string;
  node_text?: string;
  node_type?: string;
  edge_verdict?: string;
  question: string;
}

// --------------------------------------------------
// 1. applyFixToBackend (Supports 2 or 3 arguments)
// --------------------------------------------------
export async function applyFixToBackend(
  docIdOrFindingId: string,
  findingIdOrAction?: string,
  maybeAction?: string
) {
  let docId = "doc-1";
  let findingId = docIdOrFindingId;
  let action = "apply";

  if (maybeAction !== undefined) {
    // Called with 3 arguments: ("doc-1", findingId, "apply")
    docId = docIdOrFindingId;
    findingId = findingIdOrAction || "";
    action = maybeAction;
  } else if (findingIdOrAction !== undefined) {
    if (findingIdOrAction === "apply" || findingIdOrAction === "dismiss") {
      // Called with 2 arguments: (findingId, "apply")
      findingId = docIdOrFindingId;
      action = findingIdOrAction;
    } else {
      // Called with 2 arguments: ("doc-1", findingId)
      docId = docIdOrFindingId;
      findingId = findingIdOrAction;
    }
  }

  const response = await fetch(`${API_BASE}/api/review/${docId}/fix/${findingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });

  if (!response.ok) {
    throw new Error(`Failed to apply fix: ${response.statusText}`);
  }

  return await response.json();
}

// --------------------------------------------------
// 2. askAI (Overloaded: accepts Object OR Two Strings)
// --------------------------------------------------
export function askAI(params: AskAIParams): Promise<{ answer: string; source: string }>;
export function askAI(nodeOrContext: string, question: string): Promise<{ answer: string; source: string }>;
export function askAI(question: string): Promise<{ answer: string; source: string }>;

export async function askAI(
  first: AskAIParams | string,
  second?: string
): Promise<{ answer: string; source: string }> {
  let payload: AskAIParams;

  if (typeof first === "object" && first !== null) {
    // Called with object: askAI({ question: "...", node_text: "..." })
    payload = first;
  } else if (typeof first === "string" && typeof second === "string") {
    // Called with 2 strings: askAI("Clinical Spec...", question)
    payload = {
      node_text: first,
      question: second,
      node_type: "Graph Node",
    };
  } else {
    // Called with single string: askAI(question)
    payload = {
      question: String(first),
      node_text: "General Inquiry",
    };
  }

  const response = await fetch(`${API_BASE}/api/ai/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.statusText}`);
  }

  return await response.json();
}

// --------------------------------------------------
// 3. fetchActivityHistory
// --------------------------------------------------
export async function fetchActivityHistory() {
  const response = await fetch(`${API_BASE}/api/activity`);
  if (!response.ok) {
    throw new Error(`Failed to fetch activity ledger: ${response.statusText}`);
  }
  return await response.json();
}

// --------------------------------------------------
// 4. fetchKnowledgeGraph
// --------------------------------------------------
export async function fetchKnowledgeGraph(documentId: string = "doc-1") {
  const response = await fetch(`${API_BASE}/api/graph/${documentId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch graph data: ${response.statusText}`);
  }
  return await response.json();
}

// --------------------------------------------------
// 5. uploadContent (Single file or text)
// --------------------------------------------------
export async function uploadContent(formData: FormData) {
  const response = await fetch(`${API_BASE}/api/intake`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }
  return await response.json();
}

// --------------------------------------------------
// 6. uploadBulkContent (Multiple files batch)
// --------------------------------------------------
export async function uploadBulkContent(formData: FormData) {
  const response = await fetch(`${API_BASE}/api/intake/bulk`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Bulk upload failed: ${response.statusText}`);
  }
  return await response.json();
}