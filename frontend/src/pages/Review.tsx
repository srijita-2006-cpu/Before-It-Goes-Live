import { useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Image,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import IssueCard, { type Finding } from "../components/IssueCard";

type Props = {
  content: string;
  setContent: (value: string) => void;
  reviewStarted: boolean;
  onReview: () => void;
};

const demoFindings: Finding[] = [
  {
    id: 1,
    title: "Unsupported promotional claim",
    severity: "High",
    location: "Finding 01 · Headline",
    explanation:
      "The headline makes a strong performance promise, but the supplied brand references do not establish evidence for that claim. A reviewer should verify it before publication.",
    evidence:
      "Example brand rule: promotional performance claims must have an approved source and substantiation.",
    suggestion:
      "Replace the absolute promise with a specific, approved benefit or attach evidence that substantiates the claim.",
  },
  {
    id: 2,
    title: "Messaging needs alignment",
    severity: "Medium",
    location: "Finding 02 · Body copy",
    explanation:
      "This wording may not match the brand's preferred terminology. Check the approved messaging guide before finalising the text.",
    evidence:
      "Example brand rule: use approved product terminology and consistent messaging across channels.",
    suggestion:
      "Use the terminology from the approved messaging guide and retain the intended meaning of the original copy.",
  },
  {
    id: 3,
    title: "Final review required",
    severity: "Low",
    location: "Finding 03 · Publication",
    explanation:
      "The content has not yet been confirmed by an authorised reviewer. This is a workflow reminder, not a detected content error.",
    evidence:
      "Example workflow rule: content must receive the required approval before publication.",
    suggestion:
      "Send the revised content to the appropriate reviewer and record the approval decision.",
  },
];

export default function Review({
  content,
  setContent,
  reviewStarted,
  onReview,
}: Props) {
  const [selectedFinding, setSelectedFinding] = useState(1);
  const [approved, setApproved] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const hasContent = Boolean(content.trim());
  const findings = hasContent && reviewStarted ? demoFindings : [];
  const selected = findings.find((item) => item.id === selectedFinding);

  return (
    <div className="page review-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTENT WORKSPACE</p>
          <h1>Review <span>before release.</span></h1>
          <p className="muted">
            Explore findings in context, not buried in a checklist.
          </p>
        </div>
        <span className="workspace-icon"><ScanSearch size={24} /></span>
      </div>

      <section className="input-panel review-input">
        <div className="panel-title">
          <span className="type-icon cyan"><FileText size={19} /></span>
          <div>
            <h3>Your draft</h3>
            <p className="muted">Paste the content you want to review.</p>
          </div>
        </div>

        <textarea
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setApproved(false);
          }}
          rows={3}
          placeholder="Paste campaign copy, an announcement, or product messaging..."
        />

        <div className="input-footer">
          <span className="muted">{content.length} characters</span>
          <button
            className="primary-button"
            onClick={() => {
              setSelectedFinding(1);
              setApproved(false);
              onReview();
            }}
            disabled={!hasContent}
          >
            <Sparkles size={16} /> Run demo review
          </button>
        </div>
      </section>

      {!reviewStarted || !hasContent ? (
        <section className="empty-state">
          <div className="empty-icon"><ScanSearch size={30} /></div>
          <h2>Your visual review starts here</h2>
          <p>
            Add content above, then run the demo review to explore how
            visual findings and evidence-linked explanations will work.
          </p>
        </section>
      ) : (
        <>
          <div className="review-summary">
            <div>
              <span className="summary-number">03</span>
              <span className="muted">Illustrative findings</span>
            </div>
            <span className="demo-badge">DEMO DATA</span>
          </div>

          <div className="review-layout">
            <section className="preview-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / IN CONTEXT</p>
                  <h2>Content preview</h2>
                </div>
                <span className="preview-tag"><Image size={14} /> Draft</span>
              </div>

              <div className="creative-preview">
                <div className="creative-topline">
                  <span>CAMPAIGN DRAFT</span>
                  <span>NOT APPROVED</span>
                </div>

                <div className="creative-art">
                  <div className="creative-decoration" />
                  <span className="creative-kicker">YOUR BRAND. YOUR STORY.</span>
                  <h2>
                    {content.split("\n")[0].slice(0, 100) ||
                      "Make every moment extraordinary."}
                  </h2>
                  <p>{content.split("\n").slice(1).join(" ").slice(0, 180) ||
                    "Your campaign copy will appear here for review."}</p>

                  <button
                    className={`issue-marker marker-one ${selectedFinding === 1 ? "marker-active" : ""}`}
                    onClick={() => setSelectedFinding(1)}
                    aria-label="Show finding one"
                  >
                    1
                  </button>
                  <button
                    className={`issue-marker marker-two ${selectedFinding === 2 ? "marker-active" : ""}`}
                    onClick={() => setSelectedFinding(2)}
                    aria-label="Show finding two"
                  >
                    2
                  </button>
                  <button
                    className={`issue-marker marker-three ${selectedFinding === 3 ? "marker-active" : ""}`}
                    onClick={() => setSelectedFinding(3)}
                    aria-label="Show finding three"
                  >
                    3
                  </button>
                </div>

                <div className="preview-legend">
                  <span><i className="legend-high" /> High</span>
                  <span><i className="legend-medium" /> Medium</span>
                  <span><i className="legend-low" /> Workflow</span>
                </div>
              </div>

              
            <div className="selected-insight">
            <span className="insight-icon">
                <Sparkles size={17} />
            </span>

            <div>
                <strong>{selected?.title ?? "Select a finding"}</strong>
                <p>
                {selected?.explanation ??
                    "Choose a marker to inspect a finding."}
                </p>

                {selected && (
                <>
                    <p className="muted">
                    <strong>Suggested fix:</strong> {selected.suggestion}
                    </p>

                    <button
                    className="secondary-button"
                    onClick={() => {
                        setContent(
                        content.trimEnd() +
                            "\n\nSuggested revision: " +
                            selected.suggestion
                        );
                        setApproved(false);
                        setShowEditor(true);
                    }}
                    >
                    Use suggestion <ArrowRight size={16} />
                    </button>
                </>
                )}
            </div>
            </div>

            </section>

            <section className="findings-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">02 / EXPLORE</p>
                  <h2>Review findings</h2>
                </div>
                <span className="finding-count">{findings.length}</span>
              </div>

              <div className="issue-list">
                {findings.map((finding) => (
                  <IssueCard
                    key={finding.id}
                    finding={finding}
                    selected={selectedFinding === finding.id}
                    onSelect={() => setSelectedFinding(finding.id)}
                  />
                ))}
              </div>

              <button
                className="secondary-button editor-toggle"
                onClick={() => setShowEditor(!showEditor)}
              >
                {showEditor ? "Hide revision editor" : "Open revision editor"}
                <ArrowRight size={16} />
              </button>

              {showEditor && (
                <div className="revision-editor">
                  <h3>Revise your draft</h3>
                  <p className="muted">
                    Make a change, then submit it for human review. No AI
                    corrections are automatically applied in this prototype.
                  </p>
                  <textarea
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value);
                      setApproved(false);
                    }}
                    rows={5}
                  />
                </div>
              )}
            </section>
          </div>

          <section className="approval-panel">
            <div className="approval-icon"><ShieldCheck size={23} /></div>
            <div className="approval-copy">
              <h3>{approved ? "Marked for review" : "Ready for the next step?"}</h3>
              <p className="muted">
                {approved
                  ? "Your draft is marked as ready for human review in this prototype."
                  : "Mark the draft as ready for a human reviewer. This does not mean the content has been approved."}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setApproved(!approved)}
            >
              {approved ? <Check size={16} /> : <ArrowRight size={16} />}
              {approved ? "Marked" : "Request review"}
            </button>
          </section>
        </>
      )}
    </div>
  );
}