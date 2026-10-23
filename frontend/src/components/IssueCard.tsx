import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  WandSparkles,
} from "lucide-react";

export type Finding = {
  id: number;
  title: string;
  severity: "High" | "Medium" | "Low";
  location: string;
  explanation: string;
  evidence: string;
  suggestion: string;
};

type Props = {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
};

export default function IssueCard({
  finding,
  selected,
  onSelect,
}: Props) {
  const [showFix, setShowFix] = useState(false);

  return (
    <article className={`issue-card ${selected ? "issue-selected" : ""}`}>
      <button className="issue-heading" onClick={onSelect}>
        <span className={`severity-icon ${finding.severity.toLowerCase()}`}>
          {finding.severity === "High" ? (
            <AlertTriangle size={18} />
          ) : (
            <FileSearch size={18} />
          )}
        </span>

        <span className="issue-heading-text">
          <span className="issue-location">{finding.location}</span>
          <strong>{finding.title}</strong>
          <span className={`severity-label ${finding.severity.toLowerCase()}`}>
            {finding.severity} priority
          </span>
        </span>

        <ChevronDown
          className={selected ? "chevron-open" : ""}
          size={18}
        />
      </button>

      {selected && (
        <div className="issue-details">
          <h4><WandSparkles size={16} /> Why this needs attention</h4>
          <p>{finding.explanation}</p>

          <div className="evidence-box">
            <span className="evidence-title">
              <FileSearch size={15} /> BRAND REFERENCE
            </span>
            <p>{finding.evidence}</p>
          </div>

          <button
            className="secondary-button"
            onClick={() => setShowFix(!showFix)}
          >
            {showFix ? "Hide suggested fix" : "View suggested fix"}
          </button>

          {showFix && (
            <div className="suggestion-box">
              <CheckCircle2 size={17} />
              <p>{finding.suggestion}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}