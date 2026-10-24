import { useEffect, useRef, useState } from "react";
import { Sparkles, ShieldCheck, Check, ArrowRight } from "lucide-react";
import IssueCard, { type Finding } from "../components/IssueCard";
import { applyFixToBackend } from "../api.ts";

type Props = {
  content?: string;
  setContent?: (value: string) => void;
  reviewStarted?: boolean;
  onReview?: () => void;
};

const initialFindings: Finding[] = [
  {
    id: 1,
    title: "Absolute superiority claim",
    severity: "High",
    location: "Headline claim",
    explanation: "Absolute perfection guarantees need verified clinical trials and legal clearance.",
    evidence: "Brand Guideline §4.2: Avoid superlative and absolute claims without certified trial results.",
    suggestion: "visibly enhances radiance with pure botanical care.",
  },
  {
    id: 2,
    title: "Unsubstantiated timeframe",
    severity: "Medium",
    location: "Body copy claim",
    explanation: "A specific 7-day reversal claim exceeds current approved product study data.",
    evidence: "Clinical dossier #2024-B confirms improvement at 28 days, not 7 days.",
    suggestion: "support natural renewal with continuous daily use",
  },
  {
    id: 3,
    title: "Comparative claim without citation",
    severity: "Low",
    location: "Supporting copy",
    explanation: "Direct competitor comparisons require explicit disclaimers and benchmark testing.",
    evidence: "Advertising Standards Compliance Guide §8.",
    suggestion: "Designed to complement and elevate your daily skincare routine.",
  },
];

export default function Review({ setContent: setPropContent }: Props = {}) {
  const [headlineFix, setHeadlineFix] = useState("100% organic, pure skin perfection.");
  const [bodyPart2Fix, setBodyPart2Fix] = useState("reverse signs of aging in 7 days");
  const [bodyPart3Fix, setBodyPart3Fix] = useState("No other cream works better.");

  const [findings] = useState<Finding[]>(initialFindings);
  const [selectedId, setSelectedId] = useState<number | null>(2);
  const [replacement, setReplacement] = useState("");
  const [resolvedIds, setResolvedIds] = useState<number[]>([]);
  const [connectorPath, setConnectorPath] = useState("");

  const workspaceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const fullHeadline = `Radiance redefined: ${headlineFix}`;
  const fullBody = `Formulated without parabens or synthetics. Clinically proven to ${bodyPart2Fix}. ${bodyPart3Fix}`;

  const selectedFinding = findings.find((f) => f.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedFinding) {
      setReplacement(selectedFinding.suggestion);
    }
  }, [selectedId]);

  useEffect(() => {
    function updateConnector() {
      if (!selectedId || !workspaceRef.current || !panelRef.current) {
        setConnectorPath("");
        return;
      }

      const markerEl = markerRefs.current[selectedId];
      if (!markerEl) {
        setConnectorPath("");
        return;
      }

      const wsRect = workspaceRef.current.getBoundingClientRect();
      const mRect = markerEl.getBoundingClientRect();
      const pRect = panelRef.current.getBoundingClientRect();

      const startX = mRect.left + mRect.width / 2 - wsRect.left;
      const startY = mRect.bottom - wsRect.top;
      const endX = pRect.left + 35 - wsRect.left;
      const endY = pRect.top - wsRect.top;

      const midY = (startY + endY) / 2;
      setConnectorPath(`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`);
    }

    updateConnector();
    window.addEventListener("resize", updateConnector);
    return () => window.removeEventListener("resize", updateConnector);
  }, [selectedId, headlineFix, bodyPart2Fix, bodyPart3Fix]);

  function openFix(finding: Finding) {
    setSelectedId(finding.id);
    setReplacement(finding.suggestion);
  }

  function applyFix() {
    if (!selectedFinding || resolvedIds.includes(selectedFinding.id)) return;

    const findingId = selectedFinding.id;

    if (findingId === 1) {
      setHeadlineFix(replacement);
    } else if (findingId === 2) {
      setBodyPart2Fix(replacement);
    } else if (findingId === 3) {
      setBodyPart3Fix(replacement);
    }

    setResolvedIds((prev) => [...prev, findingId]);
    setSelectedId(null);
    setPropContent?.(fullBody);

    // Sync to Python backend through clean api.ts
    applyFixToBackend(1, findingId, replacement).catch(() => {});
  }

  const unresolvedCount = findings.length - resolvedIds.length;

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTENT AUDIT</p>
          <h1>Review & <span>alignment.</span></h1>
          <p className="muted">Inspect flagged claims, apply fixes, and approve for release.</p>
        </div>
        <span className="workspace-icon"><Sparkles size={24} /></span>
      </div>

      <div className="review-summary">
        <div>
          <span className="summary-number">{unresolvedCount}</span>
          <div>
            <strong>Active findings</strong>
            <p className="muted">Issues requiring review</p>
          </div>
        </div>
        <span className="demo-badge">PRE-FLIGHT AUDIT</span>
      </div>

      <div className="review-layout">
        <section className="review-visual-workspace" ref={workspaceRef}>
          {selectedFinding && !resolvedIds.includes(selectedFinding.id) && connectorPath && (
            <svg className="review-connector" aria-hidden="true">
              <defs>
                <marker
                  id="connector-arrow"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--cyan)" />
                </marker>
              </defs>
              <path d={connectorPath} markerEnd="url(#connector-arrow)" />
            </svg>
          )}

          <div className="creative-preview">
            <div className="creative-topline">
              <span>CAMPAIGN COPY & CREATIVE</span>
              <span>{resolvedIds.length} OF {findings.length} RESOLVED</span>
            </div>

            <div className="creative-art">
              <div className="creative-decoration" />
              <span className="creative-kicker">SPRING HERO ASSET</span>

              <h2>
                Radiance redefined:{" "}
                <button
                  type="button"
                  className={`review-issue-text ${selectedId === 1 ? "active" : ""} ${
                    resolvedIds.includes(1) ? "resolved" : ""
                  }`}
                  onClick={() => openFix(findings[0])}
                >
                  {headlineFix}
                </button>
              </h2>

              <p>
                Formulated without parabens or synthetics. Clinically proven to{" "}
                <button
                  type="button"
                  className={`review-issue-text medium ${selectedId === 2 ? "active" : ""} ${
                    resolvedIds.includes(2) ? "resolved" : ""
                  }`}
                  onClick={() => openFix(findings[1])}
                >
                  {bodyPart2Fix}
                </button>
                .{" "}
                <button
                  type="button"
                  className={`review-issue-text low ${selectedId === 3 ? "active" : ""} ${
                    resolvedIds.includes(3) ? "resolved" : ""
                  }`}
                  onClick={() => openFix(findings[2])}
                >
                  {bodyPart3Fix}
                </button>
              </p>

              {!resolvedIds.includes(1) && (
                <button
                  ref={(el) => {
                    markerRefs.current[1] = el;
                  }}
                  type="button"
                  className={`issue-marker marker-one ${selectedId === 1 ? "marker-active" : ""}`}
                  onClick={() => openFix(findings[0])}
                  title="Issue 1: Absolute claim"
                >
                  1
                </button>
              )}

              {!resolvedIds.includes(2) && (
                <button
                  ref={(el) => {
                    markerRefs.current[2] = el;
                  }}
                  type="button"
                  className={`issue-marker marker-two ${selectedId === 2 ? "marker-active" : ""}`}
                  onClick={() => openFix(findings[1])}
                  title="Issue 2: Timeframe claim"
                >
                  2
                </button>
              )}

              {!resolvedIds.includes(3) && (
                <button
                  ref={(el) => {
                    markerRefs.current[3] = el;
                  }}
                  type="button"
                  className={`issue-marker marker-three ${selectedId === 3 ? "marker-active" : ""}`}
                  onClick={() => openFix(findings[2])}
                  title="Issue 3: Comparative claim"
                >
                  3
                </button>
              )}
            </div>

            <div className="preview-legend">
              <span><i className="legend-high" /> High priority</span>
              <span><i className="legend-medium" /> Medium priority</span>
              <span><i className="legend-low" /> Low priority</span>
            </div>
          </div>

          {selectedFinding && !resolvedIds.includes(selectedFinding.id) && (
            <div className="magic-fix-panel" ref={panelRef}>
              <div className="magic-fix-heading">
                <Sparkles size={16} />
                <span>MAGIC FIX · ISSUE #{selectedFinding.id}</span>
              </div>

              <p className="magic-fix-copy">{selectedFinding.explanation}</p>

              <span className="magic-fix-label">PROPOSED REVISION</span>
              <textarea
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                rows={3}
              />

              <div className="magic-fix-actions">
                <button
                  type="button"
                  className="magic-fix-apply"
                  onClick={applyFix}
                  disabled={!replacement.trim()}
                >
                  <Check size={16} />
                  Apply Fix
                  <ArrowRight size={15} />
                </button>

                <button
                  type="button"
                  className="magic-fix-cancel"
                  onClick={() => setSelectedId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedFinding && (
            <div className="selected-insight">
              <Sparkles size={18} className="insight-icon" />
              <div>
                <strong>Issue #{selectedFinding.id}: {selectedFinding.title}</strong>
                <p>{selectedFinding.explanation}</p>
              </div>
            </div>
          )}

          <div className="approval-panel">
            <div className="approval-icon">
              <ShieldCheck size={24} />
            </div>
            <div className="approval-copy">
              <h3>Human approval</h3>
              <p className="muted">Approve this creative once all brand flags have been resolved.</p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={unresolvedCount > 0}
              onClick={() => alert("Draft approved for release.")}
            >
              Approve creative <Check size={16} />
            </button>
          </div>
        </section>

        <aside>
          <div className="profile-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="eyebrow" style={{ margin: 0 }}>LIVE REVISED OUTPUT</span>
              <span className="demo-badge">
                {resolvedIds.length > 0 ? `${resolvedIds.length} FIXED` : "ORIGINAL"}
              </span>
            </div>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--cyan)", letterSpacing: 1 }}>
                  HEADLINE
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  {fullHeadline}
                </p>
              </div>

              <div>
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--cyan)", letterSpacing: 1 }}>
                  BODY COPY
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
                  {fullBody}
                </p>
              </div>
            </div>

            {resolvedIds.length > 0 && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--lime)", display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={14} /> Updated in real time as you apply fixes
              </p>
            )}
          </div>

          <div className="section-heading" style={{ marginTop: 24 }}>
            <div>
              <p className="eyebrow">AUDIT FINDINGS</p>
              <h2>Flagged issues</h2>
            </div>
            <span className="finding-count">{unresolvedCount}</span>
          </div>

          <div className="issue-list">
            {findings.map((finding) => (
              <IssueCard
                key={finding.id}
                finding={finding}
                selected={selectedId === finding.id}
                onSelect={() => openFix(finding)}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}