// ==========================================
// CENTRAL API CLIENT FOR 'BEFORE IT GOES LIVE'
// ==========================================

// Auto-detect environment:
// When running locally on your computer, strictly use localhost.
// Render and Vercel will not be touched until you push to Git.

const isLocal =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

const configuredApiUrl = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;

export const API_BASE = isLocal
  ? "http://127.0.0.1:8000"
  : configuredApiUrl || "https://before-it-goes-live.onrender.com";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
export const MAX_BATCH_FILES = 20;
export const MAX_TEXT_CHARACTERS = 100_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  let authHeaders: Record<string, string> = {};
  if (typeof window !== "undefined" && window.localStorage) {
    const token = localStorage.getItem("b4live_session_id");
    const orgId = localStorage.getItem("b4live_org_id");
    if (token) {
      authHeaders["Authorization"] = `Bearer ${token}`;
      authHeaders["X-Session-ID"] = token;
    }
    if (orgId) {
      authHeaders["X-Organization-ID"] = orgId;
    }
  }

  const mergedHeaders = {
    ...authHeaders,
    ...(init.headers
      ? init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init.headers as Record<string, string>)
      : {}),
  };

  try {
    return await fetch(input, {
      credentials: "include",
      ...init,
      headers: mergedHeaders,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out. The server may still be processing it; check Activity before submitting it again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const responseBody = body as { detail?: unknown; message?: unknown };
  if (typeof responseBody.detail === "string") return responseBody.detail;
  if (
    responseBody.detail &&
    typeof responseBody.detail === "object" &&
    "message" in responseBody.detail &&
    typeof responseBody.detail.message === "string"
  ) {
    return responseBody.detail.message;
  }
  return typeof responseBody.message === "string" ? responseBody.message : fallback;
}

// --- Types ---
export interface ChatTurn {
  role: "user" | "ai";
  text: string;
}

export interface AskAIResult {
  answer: string;
  source: string;
  live?: boolean;
  reason?: string;
}

export interface AIStatusResult {
  key_configured: boolean;
  provider: string | null;
  model: string | null;
  primary_provider?: string;
  fallback_provider?: string;
  available_providers?: string[];
  configuration_error?: string | null;
}

export interface AskAIParams {
  history?: ChatTurn[];
  document_id?: string;
  node_id?: string;
  node_text?: string;
  node_type?: string;
  edge_verdict?: string;
  finding?: {
    finding_id?: string;
    flagged_text?: string;
    explanation?: string;
    evidence?: string;
    suggested_fix?: string;
    severity?: string;
    location?: string;
  };
  conversation?: ChatTurn[];
  question: string;
}

export type CorrectionSuggestionStatus =
  | "not_requested"
  | "suggestion_ready"
  | "needs_information"
  | "no_safe_replacement"
  | "invalid_suggestion"
  | "error";

export interface CorrectionSuggestionResult {
  finding_id: string;
  status: Exclude<CorrectionSuggestionStatus, "not_requested" | "invalid_suggestion" | "error">;
  original_text: string;
  rule_id: string;
  rule_violated: string;
  explanation: string;
  replacement_text: string;
  draft_replacement_text?: string;
  change_summary: string;
  missing_information: string[];
  requires_human_review: true;
}

export class CorrectionSuggestionError extends Error {
  suggestionStatus: "invalid_suggestion" | "error";

  constructor(
    message: string,
    suggestionStatus: "invalid_suggestion" | "error" = "error"
  ) {
    super(message);
    this.name = "CorrectionSuggestionError";
    this.suggestionStatus = suggestionStatus;
  }
}

// --------------------------------------------------
// 1. applyFixToBackend
// Send an explicitly approved replacement to the real backend endpoint.
// Never report success when the server did not confirm the change.
// --------------------------------------------------
export interface ApplyFixPayload {
  finding_id: string;
  flagged_text: string;
  replacement_text?: string;
  suggested_fix?: string;
  explanation?: string;
  evidence?: string;
  current_doc_text?: string;
}

export async function applyFixToBackend(payload: ApplyFixPayload): Promise<any>;
export async function applyFixToBackend(
  _docIdOrFindingId: string,
  _findingIdOrAction?: string,
  _maybeAction?: string
): Promise<any>;
export async function applyFixToBackend(
  first: ApplyFixPayload | string,
  _findingIdOrAction?: string,
  _maybeAction?: string
): Promise<any> {
  if (typeof first !== "object" || first === null) {
    throw new Error(
      "Applying a fix requires the finding text and the replacement text. Reopen the finding and try again."
    );
  }

  const response = await fetchWithTimeout(`${API_BASE}/api/ai/fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(first),
  }, 30_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `Could not apply the fix (${response.status}).`));
  }
  if (body?.status !== "success" || typeof body?.updated_text !== "string") {
    throw new Error("The backend did not confirm that the correction was saved.");
  }
  if (body?.recheck?.status !== "passed") {
    throw new Error("The backend did not confirm that the applied correction passed its rule recheck.");
  }
  return body;
}

export const applyFix = applyFixToBackend;

export async function generateCorrectionSuggestion(
  findingId: string
): Promise<CorrectionSuggestionResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${API_BASE}/api/ai/suggest-correction`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finding_id: findingId }),
      },
      45_000
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw new CorrectionSuggestionError(
        "Suggestion generation timed out. The server may have completed it; refresh this review before retrying.",
        "error"
      );
    }
    throw error;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : String(detail?.message || `Could not generate a correction suggestion (${response.status}).`);
    const suggestionStatus =
      detail?.status === "invalid_suggestion" ? "invalid_suggestion" : "error";
    throw new CorrectionSuggestionError(message, suggestionStatus);
  }

  const validStatuses = [
    "suggestion_ready",
    "needs_information",
    "no_safe_replacement",
  ];
  if (
    !body ||
    typeof body.finding_id !== "string" ||
    !validStatuses.includes(body.status) ||
    typeof body.original_text !== "string" ||
    typeof body.rule_id !== "string" ||
    typeof body.rule_violated !== "string" ||
    typeof body.explanation !== "string" ||
    typeof body.replacement_text !== "string" ||
    (body.draft_replacement_text !== undefined &&
      (typeof body.draft_replacement_text !== "string" ||
        body.draft_replacement_text.length > 4000)) ||
    typeof body.change_summary !== "string" ||
    !Array.isArray(body.missing_information) ||
    !body.missing_information.every((item: unknown) => typeof item === "string") ||
    body.requires_human_review !== true ||
    (body.status === "suggestion_ready" && !body.replacement_text.trim()) ||
    (body.status === "suggestion_ready" && body.missing_information.length > 0) ||
    (body.status === "needs_information" && body.missing_information.length === 0) ||
    (body.status !== "suggestion_ready" && body.replacement_text.trim())
  ) {
    throw new CorrectionSuggestionError(
      "The correction response was incomplete or invalid. No new replacement was shown.",
      "invalid_suggestion"
    );
  }

  return body as CorrectionSuggestionResult;
}

// --------------------------------------------------
// 2. askAI (Supports Object, 2, 3, or 4 Arguments)
// --------------------------------------------------
export async function getAIStatus(): Promise<AIStatusResult> {
  const response = await fetchWithTimeout(`${API_BASE}/api/ai/status`, {}, 10_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `Could not read AI configuration (${response.status}).`));
  }
  if (!body || typeof body.key_configured !== "boolean") {
    throw new Error("The backend returned an invalid AI configuration status.");
  }
  return body as AIStatusResult;
}

export function askAI(params: AskAIParams): Promise<AskAIResult>;
export function askAI(
  nodeOrContext: string,
  question: string
): Promise<AskAIResult>;
export function askAI(
  question: string,
  nodeOrContext?: string,
  nodeType?: string,
  documentId?: string
): Promise<AskAIResult>;

export async function askAI(
  first: AskAIParams | string,
  second?: string,
  third?: string,
  fourth?: string
): Promise<AskAIResult> {
  let payload: AskAIParams;

  if (typeof first === "object" && first !== null) {
    payload = first;
  } else if (typeof first === "string" && typeof second === "string") {
    payload = {
      node_text: first,
      question: second,
      node_type: third || "Graph Node",
      document_id: fourth,
    };
  } else {
    payload = {
      question: String(first),
      node_text: second || "General Inquiry",
      node_type: third || "Governance Node",
      document_id: fourth,
    };
  }

  const response = await fetchWithTimeout(`${API_BASE}/api/ai/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: payload.question,
      prompt: payload.node_text || "",
      finding: payload.finding || {
        flagged_text: payload.node_text || "",
        explanation: payload.edge_verdict || "",
        evidence: payload.node_type || "",
      },
      conversation: (payload.conversation || payload.history || []).map((turn) => ({
        role: turn.role === "ai" ? "model" : "user",
        text: turn.text,
      })),
    }),
  }, 45_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `AI request failed (${response.status}).`));
  }
  if (typeof body?.answer !== "string" || !body.answer.trim()) {
    throw new Error("The AI service did not return an answer. No compliance answer was generated.");
  }
  return body as AskAIResult;
}

export const askAi = askAI;

// --------------------------------------------------
// 3. uploadContent (Single file or text with active rules)
// --------------------------------------------------
export async function uploadContent(formData: FormData) {
  const response = await fetchWithTimeout(`${API_BASE}/api/intake`, {
    method: "POST",
    body: formData,
  }, 150_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `Upload or analysis failed (${response.status}).`));
  }
  if (!body || !body.document_id || !Array.isArray(body.findings)) {
    throw new Error("The backend did not return a completed analysis. No findings were fabricated.");
  }
  if (typeof body.status !== "string") {
    throw new Error("The backend did not return an audit status. Do not treat this upload as reviewed.");
  }
  return body;
}

// --------------------------------------------------
// 4. uploadBulkContent (Batch files)
// --------------------------------------------------
export async function uploadBulkContent(formData: FormData) {
  const response = await fetchWithTimeout(`${API_BASE}/api/bulk/upload`, {
    method: "POST",
    body: formData,
  }, 45_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `Bulk upload failed (${response.status}).`));
  }
  if (body?.status !== "accepted" || !body?.job_id) {
    throw new Error("The backend did not confirm that the batch was queued.");
  }
  return body;
}

export async function getBulkCapacity(payload: {
  file_count: number;
  total_size: number;
  unsupported_count?: number;
}) {
  const response = await fetchWithTimeout(`${API_BASE}/api/bulk/capacity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "accepted") {
    throw new Error(String(body?.detail || body?.message || `Could not check upload capacity (${response.status}).`));
  }
  return body;
}

export async function getBulkJob(jobId: string) {
  const response = await fetchWithTimeout(`${API_BASE}/api/bulk/job/${encodeURIComponent(jobId)}`, {}, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(String(body?.detail || body?.message || `Could not read batch status (${response.status}).`));
  }
  if (!body?.job || !Array.isArray(body.files)) {
    throw new Error("The backend did not return a valid batch status. Retry the status check before uploading again.");
  }
  return body;
}

// --------------------------------------------------
// 5. fetchActivityHistory
// --------------------------------------------------
export async function fetchActivityHistory() {
  const response = await fetchWithTimeout(`${API_BASE}/api/activity`, {}, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.detail || `Failed to fetch activity (${response.status}).`));
  if (!body || !Array.isArray(body.documents) || !Array.isArray(body.logs)) {
    throw new Error("The backend returned an invalid activity response. Retry loading the audit history.");
  }
  return body;
}

export const fetchActivity = fetchActivityHistory;

// --------------------------------------------------
// 6. fetchKnowledgeGraph
// --------------------------------------------------
export async function fetchKnowledgeGraph(documentId: string = "doc-1") {
  const response = await fetchWithTimeout(`${API_BASE}/api/graph/${encodeURIComponent(documentId)}`, {}, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.detail || `Failed to fetch graph (${response.status}).`));
  return body;
}

export const fetchGraph = fetchKnowledgeGraph;
export const getGraph = fetchKnowledgeGraph;

// --------------------------------------------------
// 7. fetchReview / getReview
// --------------------------------------------------
export async function fetchReview(documentId: string = "doc-1") {
  const response = await fetchWithTimeout(`${API_BASE}/api/review/${encodeURIComponent(documentId)}`, {}, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.detail || `Failed to fetch review (${response.status}).`));
  return body;
}

export const getReview = fetchReview;

// --------------------------------------------------
// 8. Brand Rules Helpers
// --------------------------------------------------
export async function fetchBrandRules() {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules`, {}, 15_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.detail || `Failed to fetch rules (${response.status}).`));
  return body;
}

export const getBrandRules = fetchBrandRules;

export async function addCustomRule(payload: {
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms?: string;
}) {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/custom`, {
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
// Rule management and Living Brand Book
// --------------------------------------------------
export interface BrandRule {
  id: string;
  title: string;
  rule_category: string;
  rule_type: "default" | "custom" | "brandbook" | string;
  approved_statement: string;
  forbidden_terms?: string;
  scope?: string;
  severity?: "high" | "medium" | "low" | string;
  effective_date?: string | null;
  expires_at?: string | null;
  source_filename?: string | null;
  source_page?: number | null;
  source_file_path?: string | null;
  exact_quote?: string | null;
  status: "active" | "inactive" | "candidate" | "expired" | string;
  is_from_brandbook?: boolean;
  contradiction?: string | null;
  contradiction_check?: "checked" | "unavailable" | "not_needed" | string;
}

export interface RuleCandidate extends BrandRule {
  contradiction?: string | null;
  contradiction_check?: "checked" | "unavailable" | "not_needed" | string;
}

export interface RuleActivityItem {
  id: string;
  rule_id?: string;
  action?: string;
  title: string;
  detail?: string;
  description?: string;
  created_at?: string;
}

async function ruleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, init, path.includes("brandbook/upload") ? 150_000 : 30_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, response.statusText || "Request failed"));
  }
  if (!Array.isArray(body) && (!body || typeof body !== "object" || (
    "status" in body && !["success", "accepted"].includes(body.status)
  ))) {
    throw new Error("The backend did not confirm the requested rule operation.");
  }
  return body as T;
}

export async function fetchAllRules(): Promise<BrandRule[]> {
  return ruleRequest<BrandRule[]>("/api/rules");
}

export async function toggleDefaultRule(ruleId: string) {
  return ruleRequest<{status: string; rule_id: string; new_status: string}>(
    `/api/rules/default/toggle/${encodeURIComponent(ruleId)}`,
    { method: "POST" }
  );
}

export async function updateDefaultRule(ruleId: string, payload: Partial<BrandRule>) {
  return ruleRequest<{status: string; rule_id: string}>(
    `/api/rules/default/update/${encodeURIComponent(ruleId)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export async function createCustomRule(payload: Partial<BrandRule> & {
  title: string;
  rule_category: string;
  approved_statement: string;
}) {
  return ruleRequest<{status: string; rule_id: string; title?: string}>(
    "/api/rules/custom/create",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export async function checkCustomRuleConflicts(payload: {
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms?: string;
  scope?: string;
  severity?: string;
  effective_date?: string;
  expires_at?: string;
}) {
  return ruleRequest<{ contradiction?: string | null; contradiction_check: string }>(
    "/api/rules/custom/check",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export async function deleteCustomRule(ruleId: string) {
  return ruleRequest<{status: string; rule_id: string}>(
    `/api/rules/custom/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" }
  );
}

export async function extractRulesFromDoc(file: File, targetType: string = "brandbook") {
  const form = new FormData();
  form.append("file", file);
  form.append("target_type", targetType);
  const result = await ruleRequest<{status: string; filename: string; extracted_count: number; candidates: RuleCandidate[]}>(
    "/api/rules/brandbook/upload",
    { method: "POST", body: form }
  );
  if (result.status !== "success") throw new Error("The document was uploaded, but extraction did not complete.");
  return result;
}

export async function approveExtractedRule(ruleId: string) {
  return ruleRequest<{status: string; rule_id: string}>(
    `/api/rules/custom/update/${encodeURIComponent(ruleId)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) }
  );
}

export async function rejectExtractedRule(ruleId: string) {
  return ruleRequest<{status: string; rule_id: string}>(
    `/api/rules/custom/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" }
  );
}

export async function fetchRuleActivity(): Promise<RuleActivityItem[]> {
  const rows = await ruleRequest<any[]>("/api/rules/activity");
  return rows.map((row) => ({
    ...row,
    description: row.description ?? row.detail ?? "",
  }));
}

export async function dismissFinding(findingId: string) {
  return ruleRequest<{ status: string; finding_id: string }>(
    `/api/findings/${encodeURIComponent(findingId)}/dismiss`,
    { method: "POST" }
  );
}

export async function dismissMatchingFindings(findingId: string) {
  return ruleRequest<{ status: string; finding_id: string; dismissed_count: number }>(
    `/api/findings/${encodeURIComponent(findingId)}/dismiss-matching`,
    { method: "POST" }
  );
}


// Compatibility helpers for the legacy RuleSetup screen. These read and write
// actual stored rule records; they do not create sample facts or pretend success.
export async function uploadBrandBook(formData: FormData) {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/brandbook/upload`, {
    method: "POST",
    body: formData,
  }, 150_000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, `Document extraction failed (${response.status}).`));
  return {
    ...body,
    facts: (body?.candidates || []).map((candidate: RuleCandidate) => ({
      ...candidate,
      fact_text: candidate.approved_statement,
    })),
  };
}

export async function getBrandBookFacts(_scope: string = "all") {
  const rules = await fetchAllRules();
  return {
    facts: rules
      .filter((rule) => rule.rule_type === "brandbook" || rule.is_from_brandbook)
      .map((rule) => ({ ...rule, fact_text: rule.approved_statement })),
  };
}

export async function approveBrandBookFact(payload: { fact_id: string }) {
  return approveExtractedRule(payload.fact_id);
}

export async function rejectBrandBookFact(factId: string) {
  return rejectExtractedRule(factId);
}


// --------------------------------------------------
// 9. Export Helper
// --------------------------------------------------
export async function exportCopy(payload: {
  document_id?: string;
  format?: string;
  content?: string;
}) {
  const response = await fetchWithTimeout(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }
  return await response.json();
}

// --------------------------------------------------
// 10. Authentication, Organizations, and Rule Templates
// --------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_demo: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  is_demo: boolean;
  role: string;
  active_rule_count?: number;
}

export interface DemoConfig {
  demo_enabled: boolean;
  demo_email: string | null;
  demo_password: string | null;
  organization_name: string | null;
  configuration_error?: string | null;
}

export interface GoogleConfig {
  configured: boolean;
  client_id: string | null;
}

export interface AuthProfileResponse {
  status: string;
  user: AuthUser;
  csrf_token?: string;
  session_id?: string;
  organizations: Organization[];
  active_organization: Organization | null;
}

export interface RuleStatusResponse {
  has_active_rules: boolean;
  active_count: number;
  total_count: number;
  organization_id?: string;
  organization_name?: string;
}

export interface StarterRuleTemplate {
  id: string;
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms: string;
  scope: string;
  severity: string;
  description: string;
}

export async function getDemoConfig(): Promise<DemoConfig> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/demo-config`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Could not load demo configuration."));
  return body as DemoConfig;
}

export async function getGoogleConfig(): Promise<GoogleConfig> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/google/config`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Could not load Google configuration."));
  return body as GoogleConfig;
}

export async function registerAccount(email: string, password: string, fullName?: string): Promise<AuthProfileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, full_name: fullName }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Registration failed."));
  const profile = body as AuthProfileResponse;
  if (profile.session_id && typeof window !== "undefined") {
    localStorage.setItem("b4live_session_id", profile.session_id);
    if (profile.active_organization?.id) {
      localStorage.setItem("b4live_org_id", profile.active_organization.id);
    }
  }
  return profile;
}

export async function loginAccount(email: string, password: string): Promise<AuthProfileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Login failed. Check your credentials and try again."));
  const profile = body as AuthProfileResponse;
  if (profile.session_id && typeof window !== "undefined") {
    localStorage.setItem("b4live_session_id", profile.session_id);
    if (profile.active_organization?.id) {
      localStorage.setItem("b4live_org_id", profile.active_organization.id);
    }
  }
  return profile;
}

export async function logoutAccount(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem("b4live_session_id");
    localStorage.removeItem("b4live_org_id");
  }
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/logout`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(responseErrorMessage(body, "Logout failed."));
  }
}

export async function getCurrentUser(): Promise<AuthProfileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/me`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Not authenticated."));
  const profile = body as AuthProfileResponse;
  if (profile.active_organization?.id && typeof window !== "undefined") {
    localStorage.setItem("b4live_org_id", profile.active_organization.id);
  }
  return profile;
}

export async function verifyGoogleLogin(credential: string): Promise<AuthProfileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/api/auth/google/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Google authentication failed."));
  const profile = body as AuthProfileResponse;
  if (profile.session_id && typeof window !== "undefined") {
    localStorage.setItem("b4live_session_id", profile.session_id);
    if (profile.active_organization?.id) {
      localStorage.setItem("b4live_org_id", profile.active_organization.id);
    }
  }
  return profile;
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const response = await fetchWithTimeout(`${API_BASE}/api/organizations`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Could not load workspaces."));
  return body as Organization[];
}

export async function createOrganization(name: string): Promise<Organization> {
  const response = await fetchWithTimeout(`${API_BASE}/api/organizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Failed to create workspace."));
  const org = body as Organization;
  if (org.id && typeof window !== "undefined") {
    localStorage.setItem("b4live_org_id", org.id);
  }
  return org;
}

export async function switchOrganization(organizationId: string): Promise<Organization> {
  const response = await fetchWithTimeout(`${API_BASE}/api/organizations/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: organizationId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Failed to switch workspace."));
  const org = (body as { active_organization: Organization }).active_organization;
  if (org?.id && typeof window !== "undefined") {
    localStorage.setItem("b4live_org_id", org.id);
  }
  return org;
}

export async function createDefaultRule(payload: {
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms?: string;
  scope?: string;
  severity?: "high" | "medium" | "low";
  effective_date?: string;
  expires_at?: string;
  source_filename?: string;
  exact_quote?: string;
}): Promise<{ status: string; rule_id: string; rule_type?: string }> {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/default/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, rule_type: "default" }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Failed to add default rule."));
  return body as { status: string; rule_id: string; rule_type?: string };
}

export async function fetchRuleStatus(): Promise<RuleStatusResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/status`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Could not check brand rule status."));
  return body as RuleStatusResponse;
}

export async function fetchRuleTemplates(): Promise<StarterRuleTemplate[]> {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/templates`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Could not load starter rule templates."));
  return body as StarterRuleTemplate[];
}

export async function activateRuleTemplates(templateIds: string[]): Promise<{ status: string; activated_rules: { id: string; title: string }[] }> {
  const response = await fetchWithTimeout(`${API_BASE}/api/rules/templates/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_ids: templateIds }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseErrorMessage(body, "Failed to activate starter rule templates."));
  return body as { status: string; activated_rules: { id: string; title: string }[] };
}
