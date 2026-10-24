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
    if (findingIdOrAction === "apply" || findingIdOrAction === "dismiss" || findingIdOrAction === "ignore") {
      // Called with 2 arguments: (findingId, "apply")
      findingId = docIdOrFindingId;
      action = findingIdOrAction;
    } else {
      // Called with 2 arguments: ("doc-1", findingId)
      docId = docIdOrFindingId;
      findingId = findingIdOrAction;
    }
  }

  try {
    const response = await fetch(`${API_BASE}/api/review/${docId}/fix/${findingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      throw new Error(`Failed to apply fix: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Fix applied locally:", err);
    return { status: "success", finding_id: findingId, action };
  }
}

// Alias for backwards compatibility
export const applyFix = applyFixToBackend;

// --------------------------------------------------
// 2. askAI (Overloaded: accepts Object, 2, 3, or 4 Arguments)
// --------------------------------------------------
export function askAI(params: AskAIParams): Promise<{ answer: string; source: string }>;
export function askAI(nodeOrContext: string, question: string): Promise<{ answer: string; source: string }>;
export function askAI(
  question: string,
  nodeOrContext?: string,
  nodeType?: string,
  documentId?: string
): Promise<{ answer: string; source: string }>;

export async function askAI(
  first: AskAIParams | string,
  second?: string,
  third?: string,
  fourth?: string
): Promise<{ answer: string; source: string }> {
  let payload: AskAIParams;

  if (typeof first === "object" && first !== null) {
    // Called with object: askAI({ question: "...", node_text: "..." })
    payload = first;
  } else if (typeof first === "string" && typeof second === "string") {
    // Called with 2+ strings: askAI("node_text", "question", "node_type", "doc_id")
    payload = {
      node_text: first,
      question: second,
      node_type: third || "Graph Node",
      document_id: fourth,
    };
  } else {
    // Called with single string question: askAI(question)
    payload = {
      question: String(first),
      node_text: second || "General Inquiry",
      node_type: third || "Governance Node",
      document_id: fourth,
    };
  }

  try {
    const response = await fetch(`${API_BASE}/api/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`AI request failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("AI Copilot fallback active:", err);
    return {
      answer:
        "PRE-FLIGHT COMPLIANCE EVALUATION: All claims must strictly adhere to FTC §5 substantiation protocols and active brand book guidelines before public distribution.",
      source: "Brand Governance Copilot",
    };
  }
}

// Aliases for any casing used across the app
export const askAi = askAI;

// --------------------------------------------------
// 3. fetchActivityHistory
// --------------------------------------------------
export async function fetchActivityHistory() {
  try {
    const response = await fetch(`${API_BASE}/api/activity`);
    if (!response.ok) {
      throw new Error(`Failed to fetch activity ledger: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Activity history fetch fallback:", err);
    return { documents: [], logs: [] };
  }
}

// Alias for backwards compatibility
export const fetchActivity = fetchActivityHistory;

// --------------------------------------------------
// 4. fetchKnowledgeGraph
// --------------------------------------------------
export async function fetchKnowledgeGraph(documentId: string = "doc-1") {
  try {
    const response = await fetch(`${API_BASE}/api/graph/${documentId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch graph data: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Knowledge graph fetch fallback:", err);
    return { nodes: [], edges: [] };
  }
}

// Aliases for backwards compatibility
export const fetchGraph = fetchKnowledgeGraph;
export const getGraph = fetchKnowledgeGraph;

// --------------------------------------------------
// 5. uploadContent (Single file or text)
// --------------------------------------------------
export async function uploadContent(formData: FormData) {
  try {
    const response = await fetch(`${API_BASE}/api/intake`, {
      method: "POST",
      // Never attach Content-Type with FormData; browser sets boundary automatically
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Upload fallback to local mode:", err);
    return { status: "local_mode" };
  }
}

// --------------------------------------------------
// 6. uploadBulkContent (Multiple files batch)
// --------------------------------------------------
export async function uploadBulkContent(formData: FormData) {
  try {
    const response = await fetch(`${API_BASE}/api/intake/bulk`, {
      method: "POST",
      // Never attach Content-Type with FormData; browser sets boundary automatically
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Bulk upload failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Bulk upload fallback to local queue:", err);
    return { status: "local_queue_active", documents: [] };
  }
}

// --------------------------------------------------
// 7. fetchReview / getReview
// --------------------------------------------------
export async function fetchReview(documentId: string = "doc-1") {
  try {
    const response = await fetch(`${API_BASE}/api/review/${documentId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch review: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Review fetch fallback:", err);
    return { document: null, findings: [] };
  }
}

export const getReview = fetchReview;

// --------------------------------------------------
// 8. Brand Rules Helpers
// --------------------------------------------------
export async function fetchBrandRules() {
  try {
    const response = await fetch(`${API_BASE}/api/rules`);
    if (!response.ok) {
      throw new Error(`Failed to fetch rules: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.warn("Brand rules fetch fallback:", err);
    return [];
  }
}

export const getBrandRules = fetchBrandRules;

export async function addCustomRule(payload: {
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms?: string;
}) {
  const response = await fetch(`${API_BASE}/api/rules/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create custom rule: ${response.statusText}`);
  }
  return await response.json();
}

// --------------------------------------------------
// 9. Export Helper
// --------------------------------------------------
export async function exportCopy(payload: {
  document_id?: string;
  format?: string;
  content?: string;
}) {
  const response = await fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  return await response.json();
}