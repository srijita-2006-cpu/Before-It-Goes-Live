import { useEffect, useState } from "react";
import {
  History,
  FileText,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Sparkles,
} from "lucide-react";
import { fetchActivityHistory } from "../api.ts";

type ActivityItem = {
  id: number;
  filename: string;
  file_type: string;
  created_at: string;
  total_findings: number;
  resolved_findings: number;
  status: "Approved" | "In Review" | "Clean";
  preview: string;
};

const fallbackHistory: ActivityItem[] = [
  {
    id: 1,
    filename: "Spring_Hero_Ad_Copy.txt",
    file_type: "text",
    created_at: "Just now",
    total_findings: 3,
    resolved_findings: 1,
    status: "In Review",
    preview: "Radiance redefined: 100% organic, pure skin perfection. Formulated without parabens or synthetics...",
  },
];

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadActivity() {
      try {
        const data = await fetchActivityHistory();
        if (data.activity && data.activity.length > 0) {
          setItems(data.activity);
          return;
        }
      } catch (err) {
        console.warn("Backend not reachable, showing demo audit history:", err);
      } finally {
        setLoading(false);
      }

      setItems(fallbackHistory);
    }

    loadActivity();
  }, []);

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>Review <span>activity.</span></h1>
          <p className="muted">
            Track past reviews, applied fixes, and approved brand assets.
          </p>
        </div>
        <span className="workspace-icon">
          <History size={24} />
        </span>
      </div>

      <div className="review-summary" style={{ marginBottom: 25 }}>
        <div>
          <span className="summary-number">{items.length}</span>
          <div>
            <strong>Total Audits Logged</strong>
            <p className="muted">Stored in Before It Goes Live local database</p>
          </div>
        </div>
        <span className="demo-badge">AUDIT LOG</span>
      </div>

      {loading ? (
        <p className="muted">Loading audit records...</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Clock size={28} />
          </div>
          <h2>No reviews recorded yet</h2>
          <p>
            Upload content from the Home screen to start your first brand compliance audit.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((item) => {
            const isApproved = item.status === "Approved";
            const isInReview = item.status === "In Review";

            return (
              <article
                key={item.id}
                className="issue-card"
                style={{ padding: 20 }}
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
                        Audited {item.created_at} · Format: {item.file_type.toUpperCase()}
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
                        <span>All {item.total_findings} brand checks passed</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={15} color="#f5ce75" />
                        <span>
                          {item.resolved_findings} of {item.total_findings} issues resolved
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

      <p className="prototype-note" style={{ marginTop: 28 }}>
        <Sparkles size={16} /> Every review decision and applied fix is logged to the local SQLite audit ledger.
      </p>
    </div>
  );
}