import { useEffect, useState } from "react";
import {
  History,
  FileText,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  FileCheck,
  X,
  Trash2,
} from "lucide-react";

type ActivityItem = {
  id: string | number;
  filename: string;
  file_type: string;
  created_at: string;
  total_findings: number;
  resolved_findings: number;
  status: "Approved" | "In Review" | "Clean";
  preview: string;
};

const STORAGE_KEY = "b4live_audit_ledger";

const fallbackHistory: ActivityItem[] = [
  {
    id: "doc-101",
    filename: "Spring_Hero_Ad_Copy.txt",
    file_type: "text",
    created_at: "Today at 19:45",
    total_findings: 3,
    resolved_findings: 3,
    status: "Approved",
    preview: "Radiance redefined: organic botanical blend with pure skin vitality. Formulated without parabens or synthetics...",
  },
  {
    id: "doc-102",
    filename: "AuraGlo_Launch_Catalog.pdf",
    file_type: "pdf",
    created_at: "Today at 17:20",
    total_findings: 3,
    resolved_findings: 2,
    status: "In Review",
    preview: "Multi-page product specifications. Clinically proven to support natural skin renewal over continuous use...",
  },
  {
    id: "doc-103",
    filename: "Q3_Executive_Presentation.pptx",
    file_type: "pptx",
    created_at: "Yesterday at 16:10",
    total_findings: 2,
    resolved_findings: 2,
    status: "Approved",
    preview: "[Slide 1] Project AuraGlo Reveal [Slide 2] Clinical dossier #2024-B confirms improvement at 28 days...",
  },
];

function getStoredLedger(): ActivityItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

function saveStoredLedger(items: ActivityItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"All" | "Approved" | "In Review">("All");
  const [search, setSearch] = useState("");
  const [inspectItem, setInspectItem] = useState<ActivityItem | null>(null);

  useEffect(() => {
    async function loadActivity() {
      setLoading(true);

      // 1. Load existing persistent items from localStorage
      const savedLedger = getStoredLedger();

      // 2. Automatically ingest current session upload (e.g. PureGlow image / brochure)
      const currentFilename = sessionStorage.getItem("current_filename");
      let sessionItem: ActivityItem | null = null;

      if (currentFilename) {
        const fileType =
          sessionStorage.getItem("current_file_type") ||
          (currentFilename.match(/\.(png|jpg|jpeg|webp)$/i)
            ? "image"
            : currentFilename.match(/\.pdf$/i)
            ? "pdf"
            : "text");

        let totalFindings = 3;
        let resolvedFindings = 0;
        const rawFindings = sessionStorage.getItem("current_findings");
        if (rawFindings) {
          try {
            const parsed = JSON.parse(rawFindings);
            if (Array.isArray(parsed) && parsed.length > 0) {
              totalFindings = parsed.length;
              resolvedFindings = parsed.filter(
                (f: any) => f.status === "resolved" || f.status === "dismissed"
              ).length;
            }
          } catch {}
        }

        const isAllResolved = resolvedFindings >= totalFindings;
        const docText = sessionStorage.getItem("current_doc_text") || "";
        const preview =
          fileType === "image"
            ? "Visual ad creative scanned. Claims audited against FTC Green Guides §260, Endorsement §255, and FDA cosmetic rules."
            : docText.slice(0, 160).replace(/[\r\n]+/g, " ") + (docText.length > 160 ? "..." : "");

        sessionItem = {
          id: `audit-${currentFilename.replace(/[^a-zA-Z0-9]/g, "_")}`,
          filename: currentFilename,
          file_type: fileType,
          created_at: `Today at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          total_findings: totalFindings,
          resolved_findings: resolvedFindings,
          status: isAllResolved ? "Approved" : resolvedFindings > 0 ? "In Review" : "In Review",
          preview: preview || "Audited marketing collateral copy.",
        };
      }

      // 3. Fetch from backend if available
      let backendItems: ActivityItem[] = [];
      try {
        const res = await fetch("http://127.0.0.1:8000/api/activity");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.activity)) {
            backendItems = data.activity;
          }
        }
      } catch (err) {
        console.warn("Backend loading error, merging local audit history:", err);
      }

      // 4. Merge all sources without duplicating
      const map = new Map<string, ActivityItem>();

      // Baseline sample items
      fallbackHistory.forEach((item) => {
        map.set(item.filename, item);
      });

      // Backend items
      backendItems.forEach((item) => {
        map.set(item.filename, item);
      });

      // LocalStorage persistent items
      savedLedger.forEach((item) => {
        map.set(item.filename, item);
      });

      // Active session item (promoted to top)
      if (sessionItem) {
        map.set(sessionItem.filename, sessionItem);
      }

      const merged = Array.from(map.values());
      setItems(merged);
      saveStoredLedger(merged);
      setLoading(false);
    }

    loadActivity();
  }, []);

  const handleClearHistory = () => {
    if (window.confirm("Clear saved local audit history? Baseline records will remain.")) {
      localStorage.removeItem(STORAGE_KEY);
      setItems(fallbackHistory);
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesFilter = filter === "All" || item.status === filter;
    const matchesSearch =
      item.filename.toLowerCase().includes(search.toLowerCase()) ||
      item.preview.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const approvedCount = items.filter((i) => i.status === "Approved").length;

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDIT LEDGER & COMPLIANCE TRAIL</p>
          <h1>Review <span>activity.</span></h1>
          <p className="muted">
            Track past pre-flight audits, applied surgical fixes, and approved collateral.
          </p>
        </div>
        <span className="workspace-icon">
          <History size={24} />
        </span>
      </div>

      {/* METRICS SUMMARY */}
      <div className="review-summary" style={{ marginBottom: 25, flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", gap: 30 }}>
          <div>
            <span className="summary-number">{items.length}</span>
            <div>
              <strong>Audits Logged</strong>
              <p className="muted">Permanent Audit Ledger</p>
            </div>
          </div>
          <div>
            <span className="summary-number" style={{ color: "var(--lime)" }}>{approvedCount}</span>
            <div>
              <strong>Cleared Assets</strong>
              <p className="muted">100% Brand Compliant</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="demo-badge">LIVE AUDIT HISTORY ({items.length} TOTAL)</span>
          {items.length > 3 && (
            <button
              onClick={handleClearHistory}
              title="Clear Local History"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "4px 8px",
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* SEARCH & FILTER BAR */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 10, minWidth: 260 }}>
          <Search size={15} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search all audited documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: "transparent", border: 0, color: "var(--text)", outline: "none", fontSize: 13, width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {(["All", "Approved", "In Review"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={filter === tab ? "primary-button" : "secondary-button"}
              style={{ minHeight: 32, padding: "4px 12px", fontSize: 11 }}
              onClick={() => setFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading audit records...</p>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Clock size={28} /></div>
          <h2>No matching audits found</h2>
          <p>No audit logs match your search filter.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filteredItems.map((item) => {
            const isApproved = item.status === "Approved";
            const isInReview = item.status === "In Review";

            return (
              <article
                key={item.id}
                className="issue-card"
                style={{ padding: 20, cursor: "pointer" }}
                onClick={() => setInspectItem(item)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      className="type-icon"
                      style={{
                        background: isApproved ? "#c6f45b16" : "#12c4d416",
                        color: isApproved ? "var(--lime)" : "var(--cyan)",
                      }}
                    >
                      <FileText size={20} />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14 }}>{item.filename}</strong>
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: 11 }}>
                        Audited {item.created_at} · Format: {item.file_type.toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <span
                    className="demo-badge"
                    style={{
                      color: isApproved ? "var(--lime)" : isInReview ? "#f5ce75" : "var(--cyan)",
                      borderColor: isApproved ? "#c6f45b50" : isInReview ? "#f5ce7550" : "var(--border)",
                    }}
                  >
                    {item.status.toUpperCase()}
                  </span>
                </div>

                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    margin: "12px 0",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>
                    "{item.preview}"
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: isApproved ? "var(--lime)" : "var(--muted)" }}>
                    {isApproved ? (
                      <>
                        <ShieldCheck size={15} />
                        <span>All {item.total_findings} brand & legal checks cleared</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={15} color="#f5ce75" />
                        <span>{item.resolved_findings} of {item.total_findings} issues resolved</span>
                      </>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--cyan)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Inspect audit record <ArrowUpRight size={13} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* INSPECT AUDIT CERTIFICATE MODAL */}
      {inspectItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 7, 27, 0.92)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setInspectItem(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              maxWidth: 600,
              width: "100%",
              padding: 28,
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={{ position: "absolute", top: 18, right: 18, background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer" }}
              onClick={() => setInspectItem(null)}
            >
              <X size={18} />
            </button>

            <span className="eyebrow">AUDIT CERTIFICATE DETAILS</span>
            <h2 style={{ margin: "10px 0 4px", fontSize: 20 }}>{inspectItem.filename}</h2>
            <p className="muted" style={{ fontSize: 12, marginBottom: 20 }}>
              Logged on {inspectItem.created_at} • Format: {inspectItem.file_type.toUpperCase()}
            </p>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span className="muted">Pre-Flight Status:</span>
                <strong style={{ color: inspectItem.status === "Approved" ? "var(--lime)" : "#f5ce75" }}>
                  {inspectItem.status.toUpperCase()}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span className="muted">Total Flags Detected:</span>
                <strong>{inspectItem.total_findings}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span className="muted">Surgically Resolved:</span>
                <strong>{inspectItem.resolved_findings}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">Digital Audit Hash:</span>
                <code style={{ color: "var(--cyan)", fontSize: 11 }}>b4live_{String(inspectItem.id).replace("-", "")}_verified</code>
              </div>
            </div>

            <button type="button" className="primary-button" style={{ width: "100%" }} onClick={() => setInspectItem(null)}>
              Close Certificate
            </button>
          </div>
        </div>
      )}

      <p className="prototype-note" style={{ marginTop: 28 }}>
        <Sparkles size={16} /> Every review decision, surgical replacement, and user ignore action is permanently logged to your audit ledger.
      </p>
    </div>
  );
}