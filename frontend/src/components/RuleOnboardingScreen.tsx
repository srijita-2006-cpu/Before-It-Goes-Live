import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Sparkles,
  BookOpen,
  Plus,
  Upload,
  Check,
  ArrowRight,
  AlertCircle,
  FileText,
} from "lucide-react";
import {
  fetchRuleTemplates,
  activateRuleTemplates,
  createCustomRule,
  extractRulesFromDoc,
  approveExtractedRule,
  type StarterRuleTemplate,
  type RuleCandidate,
} from "../api";

interface RuleOnboardingScreenProps {
  organizationName: string;
  onComplete: () => void;
}

export default function RuleOnboardingScreen({
  organizationName,
  onComplete,
}: RuleOnboardingScreenProps) {
  const [activeTab, setActiveTab] = useState<"templates" | "custom" | "upload">("templates");
  const [templates, setTemplates] = useState<StarterRuleTemplate[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Custom rule form
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [customCategory, setCustomCategory] = useState("Claims & Evidence");
  const [customForbiddenTerms, setCustomForbiddenTerms] = useState("");
  const [customSeverity, setCustomSeverity] = useState<"high" | "medium" | "low">("medium");

  // Upload guidelines
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extractedCandidates, setExtractedCandidates] = useState<RuleCandidate[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchRuleTemplates()
      .then((data) => {
        if (!active) return;
        setTemplates(data);
        setSelectedTemplateIds(data.map((t) => t.id));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load templates.");
      })
      .finally(() => {
        if (active) setLoadingTemplates(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleActivateTemplates = async () => {
    if (selectedTemplateIds.length === 0) {
      setError("Please select at least one starter rule template.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await activateRuleTemplates(selectedTemplateIds);
      setSuccessNotice(`Successfully activated ${selectedTemplateIds.length} starter rules!`);
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate rules.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim() || !customStatement.trim()) {
      setError("Please enter a rule title and approved statement.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createCustomRule({
        title: customTitle.trim(),
        approved_statement: customStatement.trim(),
        rule_category: customCategory,
        forbidden_terms: customForbiddenTerms.trim(),
        severity: customSeverity,
        scope: "Global",
      });
      setSuccessNotice("Custom rule saved and activated successfully!");
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save custom rule.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setError("Please select a document file (.pdf, .docx, .txt).");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const res = await extractRulesFromDoc(uploadFile);
      setExtractedCandidates(res.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document rule extraction failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleApproveCandidate = async (candidateId: string) => {
    try {
      await approveExtractedRule(candidateId);
      setApprovedCount((c) => c + 1);
      setExtractedCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve candidate rule.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--text)",
      padding: "40px 20px"
    }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <span className="eyebrow">STEP 2 OF 2 · BRAND GUIDELINE SETUP</span>
            <h1 style={{ fontSize: "28px", margin: "6px 0 8px 0" }}>Configure Your Brand Rules</h1>
            <p className="muted" style={{ margin: 0, fontSize: "14px" }}>
              Workspace: <strong>{organizationName}</strong>. Select starter rules, create your own, or extract them from your brandbook.
            </p>
          </div>
          <button
            type="button"
            onClick={onComplete}
            className="secondary-button"
            style={{ fontSize: "12px", whiteSpace: "nowrap" }}
          >
            Skip for now & go to Home →
          </button>
        </div>

        {/* Status Alerts */}
        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "#fca5a5",
            fontSize: "13px"
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successNotice && (
          <div style={{
            background: "rgba(198, 244, 91, 0.12)",
            border: "1px solid rgba(198, 244, 91, 0.3)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "var(--lime)",
            fontSize: "13px"
          }}>
            <Check size={16} />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Tab selection */}
        <div style={{
          display: "flex",
          gap: "12px",
          marginBottom: "28px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "12px"
        }}>
          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={activeTab === "templates" ? "primary-button" : "secondary-button"}
            style={{ fontSize: "12px", padding: "8px 16px" }}
          >
            <Sparkles size={14} />
            Starter Rule Templates ({templates.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            className={activeTab === "custom" ? "primary-button" : "secondary-button"}
            style={{ fontSize: "12px", padding: "8px 16px" }}
          >
            <Plus size={14} />
            Write Custom Rule
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={activeTab === "upload" ? "primary-button" : "secondary-button"}
            style={{ fontSize: "12px", padding: "8px 16px" }}
          >
            <Upload size={14} />
            Extract from Guidelines
          </button>
        </div>

        {/* Tab 1: Starter Templates */}
        {activeTab === "templates" && (
          <div>
            <p className="muted" style={{ fontSize: "13px", marginBottom: "18px" }}>
              Select vetted industry-standard baseline compliance rules to immediately activate for this workspace.
            </p>

            {loadingTemplates ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
                Loading templates...
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "28px" }}>
                {templates.map((tpl) => {
                  const isChecked = selectedTemplateIds.includes(tpl.id);
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => toggleTemplate(tpl.id)}
                      style={{
                        background: isChecked ? "rgba(18, 196, 212, 0.05)" : "var(--surface)",
                        border: isChecked ? "1px solid var(--cyan)" : "1px solid var(--border)",
                        borderRadius: "14px",
                        padding: "16px 20px",
                        cursor: "pointer",
                        transition: "all 150ms ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by parent div
                          style={{ marginTop: "4px", accentColor: "var(--cyan)", width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <strong style={{ fontSize: "14px" }}>{tpl.title}</strong>
                            <span className="pill" style={{ fontSize: "9px", padding: "2px 8px" }}>
                              {tpl.rule_category}
                            </span>
                          </div>
                          <p className="muted" style={{ fontSize: "12px", margin: "4px 0 8px 0" }}>
                            {tpl.description}
                          </p>
                          <div style={{
                            background: "var(--surface-raised)",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontSize: "12px",
                            color: "var(--text)"
                          }}>
                            <strong>Mandate: </strong>
                            <span className="muted">{tpl.approved_statement}</span>
                            {tpl.forbidden_terms && (
                              <div style={{ marginTop: "4px" }}>
                                <span style={{ color: "#f87171", fontWeight: 600 }}>Prohibits: </span>
                                <span className="muted">{tpl.forbidden_terms}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              disabled={submitting || selectedTemplateIds.length === 0}
              onClick={handleActivateTemplates}
              className="primary-button"
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              {submitting ? "Activating Rules..." : `Activate ${selectedTemplateIds.length} Selected Rules & Proceed`}
              {!submitting && <ArrowRight size={15} />}
            </button>
          </div>
        )}

        {/* Tab 2: Custom Rule */}
        {activeTab === "custom" && (
          <form onSubmit={handleCreateCustom} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "24px"
          }}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
                Rule Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Clinical Study Reference Requirement"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
                  Category
                </label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                    boxSizing: "border-box"
                  }}
                >
                  <option value="Claims & Evidence">Claims & Evidence</option>
                  <option value="Legal & Regulatory">Legal & Regulatory</option>
                  <option value="Pricing & Promotions">Pricing & Promotions</option>
                  <option value="Brand Voice & Tone">Brand Voice & Tone</option>
                  <option value="Product Specification">Product Specification</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
                  Severity
                </label>
                <select
                  value={customSeverity}
                  onChange={(e) => setCustomSeverity(e.target.value as "high" | "medium" | "low")}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                    boxSizing: "border-box"
                  }}
                >
                  <option value="high">High (Blocks approval)</option>
                  <option value="medium">Medium (Warning)</option>
                  <option value="low">Low (Suggestion)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
                Approved Statement / Compliance Mandate
              </label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Products claiming organic status must state certified percentage. Never claim 100% organic unless fully certified."
                value={customStatement}
                onChange={(e) => setCustomStatement(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px", color: "var(--muted)" }}>
                Forbidden Terms / Phrases (comma-separated)
              </label>
              <input
                type="text"
                placeholder="e.g. 100% organic, totally natural, chemical-free"
                value={customForbiddenTerms}
                onChange={(e) => setCustomForbiddenTerms(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="primary-button"
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              {submitting ? "Saving Rule..." : "Save & Activate Rule"}
              {!submitting && <ArrowRight size={15} />}
            </button>
          </form>
        )}

        {/* Tab 3: Upload Guidelines */}
        {activeTab === "upload" && (
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "24px"
          }}>
            <form onSubmit={handleUploadDoc} style={{ marginBottom: "24px" }}>
              <div style={{
                border: "2px dashed var(--border)",
                borderRadius: "12px",
                padding: "32px 20px",
                textAlign: "center",
                marginBottom: "16px"
              }}>
                <Upload size={32} style={{ color: "var(--cyan)", marginBottom: "12px" }} />
                <h4 style={{ margin: "0 0 6px 0" }}>Upload Brand Book or Guidelines</h4>
                <p className="muted" style={{ fontSize: "12px", margin: "0 0 16px 0" }}>
                  Supports PDF, DOCX, PPTX, or TXT guidelines. AI extracts prospective compliance rules for review.
                </p>
                <input
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  style={{ display: "none" }}
                  id="guideline-file-input"
                />
                <label
                  htmlFor="guideline-file-input"
                  className="secondary-button"
                  style={{ cursor: "pointer", display: "inline-flex" }}
                >
                  <FileText size={14} />
                  {uploadFile ? uploadFile.name : "Choose Guidelines File"}
                </label>
              </div>

              <button
                type="submit"
                disabled={uploading || !uploadFile}
                className="primary-button"
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px"
                }}
              >
                {uploading ? "Extracting Rules..." : "Extract Brand Rules from File"}
              </button>
            </form>

            {/* Extracted Candidates */}
            {extractedCandidates.length > 0 && (
              <div>
                <h4 style={{ marginBottom: "12px" }}>Extracted Rule Candidates ({extractedCandidates.length})</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {extractedCandidates.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: "var(--surface-raised)",
                        border: "1px solid var(--border)",
                        borderRadius: "10px",
                        padding: "12px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div>
                        <strong>{c.title}</strong>
                        <p className="muted" style={{ fontSize: "12px", margin: "4px 0 0 0" }}>
                          {c.approved_statement}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleApproveCandidate(c.id)}
                        className="secondary-button"
                        style={{ fontSize: "11px", padding: "6px 12px" }}
                      >
                        Approve & Activate
                      </button>
                    </div>
                  ))}
                </div>

                {approvedCount > 0 && (
                  <button
                    type="button"
                    onClick={onComplete}
                    className="primary-button"
                    style={{ width: "100%", padding: "12px" }}
                  >
                    Finish and Continue to Dashboard ({approvedCount} Rules Added)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
