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
  X,
} from "lucide-react";
import { fetchActivityHistory } from "../api.ts";

type ActivityItem = {
  id: string | number;
  filename: string;
  file_type: string;
  created_at: string;
  total_findings: number;
  resolved_findings: number;
  status: "Approved" | "In Review";
  preview: string;
};

type ActivityProps = { onStartReview: () => void };

export default function Activity({ onStartReview }: ActivityProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<"All" | "Approved" | "In Review">("All");
  const [search, setSearch] = useState("");
  const [inspectItem, setInspectItem] = useState<ActivityItem | null>(null);

  const loadActivity = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchActivityHistory();
      const documents = Array.isArray(data?.documents) ? data.documents : [];
      setItems(documents.map((document: any): ActivityItem => {
        const contentType = String(document.content_type || "");
        const extension = document.filename?.split(".").pop()?.toLowerCase();
        const fileType = extension && ["pdf", "pptx", "docx", "csv", "md", "txt"].includes(extension)
          ? extension
          : contentType.startsWith("image/") ? "image" : "file";
        const status = document.status === "Compliant" && Number(document.unresolved_count) === 0
          ? "Approved"
          : "In Review";
        const preview = String(document.text_content || "").replace(/[\r\n]+/g, " ").trim();
        return {
          id: document.id,
          filename: document.filename || "Untitled upload",
          file_type: fileType,
          created_at: document.created_at || "",
          total_findings: Number(document.total_findings) || 0,
          resolved_findings: Number(document.resolved_findings) || 0,
          status,
          preview: preview.slice(0, 160) + (preview.length > 160 ? "…" : ""),
        };
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load activity history. Check the backend connection and retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadActivity();
  }, []);

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
          <h1>
            Review <span>activity.</span>
          </h1>
          <p className="muted">
            Track past pre-flight audits, applied fixes, and approved collateral.
          </p>
        </div>
        <span className="workspace-icon">
          <History size={24} />
        </span>
      </div>

      <div
        className="review-summary"
        style={{ marginBottom: 25, flexWrap: "wrap", gap: 14 }}
      >
        <div style={{ display: "flex", gap: 30 }}>
          <div>
            <span className="summary-number">{items.length}</span>
            <div>
              <strong>Audits Logged</strong>
              <p className="muted">Permanent Audit Ledger</p>
            </div>
          </div>
          <div>
            <span className="summary-number" style={{ color: "var(--lime)" }}>
              {approvedCount}
            </span>
            <div>
              <strong>Cleared Assets</strong>
              <p className="muted">100% Brand Compliant</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="demo-badge">
            LIVE AUDIT HISTORY ({items.length} TOTAL)
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: "6px 12px",
            borderRadius: 10,
            minWidth: 260,
          }}
        >
          <Search size={15} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search all audited documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text)",
              outline: "none",
              fontSize: 13,
              width: "100%",
            }}
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
      ) : loadError ? (
        <div className="empty-state" role="alert">
          <div className="empty-icon"><AlertTriangle size={28} /></div>
          <h2>Activity history could not be loaded</h2>
          <p>{loadError}</p>
          <button type="button" className="secondary-button" onClick={() => void loadActivity()}>
            Retry loading history
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Clock size={28} /></div>
          <h2>No activity history yet</h2>
          <p>Completed reviews will appear here after the backend saves them.</p>
          <button type="button" className="primary-button" onClick={onStartReview}>
            Start a review
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Clock size={28} />
          </div>
          <h2>No matching audits found</h2>
          <p>No saved audits match the selected search and status filters.</p>
          <button type="button" className="secondary-button" onClick={() => { setSearch(""); setFilter("All"); }}>
            Clear search and filters
          </button>
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 12,
                  }}
                >
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
                      <p
                        className="muted"
                        style={{ margin: "2px 0 0", fontSize: 11 }}
                      >
                        Audited {item.created_at} · Format:{" "}
                        {item.file_type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <span
                    className="demo-badge"
                    style={{
                      color: isApproved
                        ? "var(--lime)"
                        : isInReview
                        ? "#f5ce75"
                        : "var(--cyan)",
                      borderColor: isApproved
                        ? "#c6f45b50"
                        : isInReview
                        ? "#f5ce7550"
                        : "var(--border)",
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
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: "var(--muted)",
                    }}
                  >
                    "{item.preview}"
                  </p>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      color: isApproved ? "var(--lime)" : "var(--muted)",
                    }}
                  >
                    {isApproved ? (
                      <>
                        <ShieldCheck size={15} />
                        <span>
                          All {item.total_findings} brand & legal checks cleared
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={15} color="#f5ce75" />
                        <span>
                          {item.resolved_findings} of {item.total_findings} issues
                          resolved
                        </span>
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
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                background: "transparent",
                border: 0,
                color: "var(--muted)",
                cursor: "pointer",
              }}
              onClick={() => setInspectItem(null)}
            >
              <X size={18} />
            </button>
            <span className="eyebrow">AUDIT CERTIFICATE DETAILS</span>
            <h2 style={{ margin: "10px 0 4px", fontSize: 20 }}>
              {inspectItem.filename}
            </h2>
            <p className="muted" style={{ fontSize: 12, marginBottom: 20 }}>
              Logged on {inspectItem.created_at} • Format:{" "}
              {inspectItem.file_type.toUpperCase()}
            </p>
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  fontSize: 12,
                }}
              >
                <span className="muted">Pre-Flight Status:</span>
                <strong
                  style={{
                    color:
                      inspectItem.status === "Approved"
                        ? "var(--lime)"
                        : "#f5ce75",
                  }}
                >
                  {inspectItem.status.toUpperCase()}
                </strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  fontSize: 12,
                }}
              >
                <span className="muted">Total Flags Detected:</span>
                <strong>{inspectItem.total_findings}</strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  fontSize: 12,
                }}
              >
                <span className="muted">Resolved:</span>
                <strong>{inspectItem.resolved_findings}</strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                }}
              >
                <span className="muted">Digital Audit Hash:</span>
                <code style={{ color: "var(--cyan)", fontSize: 11 }}>
                  {inspectItem.id}
                </code>
              </div>
            </div>
            <button
              type="button"
              className="primary-button"
              style={{ width: "100%" }}
              onClick={() => setInspectItem(null)}
            >
              Close Certificate
            </button>
          </div>
        </div>
      )}

      <p className="prototype-note" style={{ marginTop: 28 }}>
        <Sparkles size={16} /> Every review decision and approved collateral item is permanently logged to your audit ledger.
      </p>
    </div>
  );
}