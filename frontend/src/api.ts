export const API_BASE = "http://127.0.0.1:8000";

// 1. Content Intake (Text or File)
export async function uploadContent(text?: string, file?: File) {
  const formData = new FormData();
  if (text) formData.append("text", text);
  if (file) formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/intake`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error("Intake failed");
  return res.json();
}

// 2. Apply a Fix
export async function applyFixToBackend(documentId: number, findingId: number, replacement: string) {
  const res = await fetch(`${API_BASE}/api/review/${documentId}/fix/${findingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replacement }),
  });

  if (!res.ok) throw new Error("Failed to apply fix");
  return res.json();
}

// 3. Fetch Audit Activity History
export async function fetchActivityHistory() {
  const res = await fetch(`${API_BASE}/api/activity`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json();
}

// 4. Fetch Knowledge Graph
export async function fetchKnowledgeGraph(documentId: number) {
  const res = await fetch(`${API_BASE}/api/graph/${documentId}`);
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}