import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  API_BASE,
  fetchAllRules,
  toggleDefaultRule,
  updateDefaultRule,
  createCustomRule,
  checkCustomRuleConflicts,
  extractRulesFromDoc,
  approveExtractedRule,
  rejectExtractedRule,
  fetchRuleActivity,
  type BrandRule,
  type RuleCandidate,
  type RuleActivityItem,
} from "../api.ts";

type Tab = "default" | "custom" | "living";
type UploadTarget = "default" | "custom" | "brandbook";

const CATEGORIES = [
  "Brand Voice & Tone",
  "Visual Identity & Logos",
  "Product Specification",
  "Claims & Evidence",
  "Legal & Regulatory",
  "Pricing & Promotions",
  "Dates & Expiry",
  "Audience & Targeting",
  "Safety & Accessibility",
  "Privacy & Data",
  "Sustainability & Certifications",
  "Channel & Platform Rules",
  "Comparative Claims",
  "Other",
];

const FILE_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp";
const inputStyle: CSSProperties = {
  width: "100%", padding: "9px 10px", background: "#0b1020", border: "1px solid #334155",
  borderRadius: "6px", color: "#e2e8f0", boxSizing: "border-box",
};
const primaryButton: CSSProperties = {
  background: "#6366f1", color: "#fff", border: "none", borderRadius: "7px",
  padding: "9px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
};
const secondaryButton: CSSProperties = {
  background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: "7px",
  padding: "8px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ruleIsActive(rule: BrandRule) {
  return rule.status === "active";
}

export default function RuleSetup() {
  const urlParams = new URLSearchParams(window.location.search);
  const docId = urlParams.get("docId") || "draft-temp";
  const docTitle = urlParams.get("title") || "Campaign Draft";
  const isBulk = urlParams.get("bulk") === "true";

  const [rules, setRules] = useState<BrandRule[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("default");
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [customCategory, setCustomCategory] = useState("Product Specification");
  const [customForbiddenTerms, setCustomForbiddenTerms] = useState("");
  const [customScope, setCustomScope] = useState("Global");
  const [customSeverity, setCustomSeverity] = useState("medium");
  const [customEffectiveDate, setCustomEffectiveDate] = useState("");
  const [customExpiryDate, setCustomExpiryDate] = useState("");
  const [customSaving, setCustomSaving] = useState(false);

  const [showDefaultManager, setShowDefaultManager] = useState(false);
  const [editingDefaultId, setEditingDefaultId] = useState("");
  const [defaultTitle, setDefaultTitle] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultStatement, setDefaultStatement] = useState("");
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [defaultFile, setDefaultFile] = useState<File | null>(null);
  const [defaultUploading, setDefaultUploading] = useState(false);

  const [brandFile, setBrandFile] = useState<File | null>(null);
  const [brandUploading, setBrandUploading] = useState(false);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customUploading, setCustomUploading] = useState(false);
  const [pendingRules, setPendingRules] = useState<RuleCandidate[]>([]);
  const [pendingExpiry, setPendingExpiry] = useState<Record<string, string>>({});
  const [pendingBusyId, setPendingBusyId] = useState("");
  const [activity, setActivity] = useState<RuleActivityItem[]>([]);

  const defaults = useMemo(() => rules.filter((rule) => rule.rule_type === "default"), [rules]);
  const customs = useMemo(() => rules.filter((rule) => rule.rule_type === "custom"), [rules]);
  const activeCount = rules.filter(ruleIsActive).length;
  const selectedDefault = defaults.find((rule) => rule.id === editingDefaultId);

  async function reloadRules() {
    setLoadError("");
    const data = await fetchAllRules();
    setRules(Array.isArray(data) ? data : []);
    setPendingRules((Array.isArray(data) ? data : []).filter((rule) => rule.status === "candidate"));
  }

  async function reloadActivity() {
    try {
      setActivity(await fetchRuleActivity());
    } catch {
      setActivity([]);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingRules(true);
      try {
        const data = await fetchAllRules();
        if (!mounted) return;
        const saved = Array.isArray(data) ? data : [];
        setRules(saved);
        setPendingRules(saved.filter((rule) => rule.status === "candidate"));
        setLoadError("");
      } catch (error) {
        if (mounted) setLoadError(messageOf(error, "Could not load saved rules. Check that the backend is running."));
      } finally {
        if (mounted) setLoadingRules(false);
      }
      try {
        const rows = await fetchRuleActivity();
        if (mounted) setActivity(rows);
      } catch {
        if (mounted) setActivity([]);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!selectedDefault) return;
    setDefaultTitle(selectedDefault.title || "");
    setDefaultCategory(selectedDefault.rule_category || "");
    setDefaultStatement(selectedDefault.approved_statement || "");
  }, [editingDefaultId, selectedDefault?.title, selectedDefault?.rule_category, selectedDefault?.approved_statement]);

  async function toggleRule(rule: BrandRule) {
    setErrorMessage("");
    setNotice("");
    try {
      const result = await toggleDefaultRule(rule.id);
      if (result?.status !== "success") throw new Error("The server did not confirm the status change.");
      await reloadRules();
      await reloadActivity();
      setNotice(`“${rule.title}” is now ${result.new_status === "active" ? "active" : "inactive"}.`);
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not update this rule. Please try again."));
    }
  }

  async function saveDefaultRule() {
    if (!editingDefaultId || !defaultTitle.trim() || !defaultCategory.trim() || !defaultStatement.trim()) {
      setErrorMessage("Fill in the rule name, category, and rule text before saving.");
      return;
    }
    setDefaultSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await updateDefaultRule(editingDefaultId, {
        title: defaultTitle.trim(),
        rule_category: defaultCategory.trim(),
        approved_statement: defaultStatement.trim(),
      });
      if (result?.status !== "success") throw new Error("The server did not confirm the update.");
      await reloadRules();
      await reloadActivity();
      setNotice("Default rule updated and saved.");
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not update the default rule."));
    } finally {
      setDefaultSaving(false);
    }
  }

  async function uploadAndExtract(file: File, target: UploadTarget) {
    const result = await extractRulesFromDoc(file, target);
    if (result.status !== "success") throw new Error("The file was uploaded, but extraction was not confirmed.");
    await reloadRules();
    await reloadActivity();
    return result;
  }

  async function handleDefaultUpload() {
    if (!defaultFile) return;
    setDefaultUploading(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await uploadAndExtract(defaultFile, "default");
      setNotice(`Uploaded “${result.filename}”. ${result.extracted_count} source-verified candidate rule(s) were extracted. Review and approve them below before they become active.`);
      setDefaultFile(null);
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not upload or extract the policy document."));
    } finally {
      setDefaultUploading(false);
    }
  }

  async function handleCreateCustomRule() {
    if (!customTitle.trim() || !customCategory.trim() || !customStatement.trim()) {
      setErrorMessage("Complete every field marked with a red * before saving.");
      return;
    }
    if (customEffectiveDate && customExpiryDate && customExpiryDate < customEffectiveDate) {
      setErrorMessage("The expiry date cannot be earlier than the start date.");
      return;
    }
    setCustomSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const payload = {
        title: customTitle.trim(),
        rule_category: customCategory,
        approved_statement: customStatement.trim(),
        forbidden_terms: customForbiddenTerms.trim(),
        scope: customScope,
        severity: customSeverity,
        effective_date: customEffectiveDate || undefined,
        expires_at: customExpiryDate || undefined,
      };
      const conflict = await checkCustomRuleConflicts(payload);
      if (conflict.contradiction) {
        const proceed = window.confirm(`The system found a possible contradiction:\n\n${conflict.contradiction}\n\nReview the existing rule(s). Save this new rule anyway?`);
        if (!proceed) return;
      } else if (conflict.contradiction_check === "unavailable") {
        const proceed = window.confirm("The automatic contradiction check could not complete. No conclusion was made. Compare this rule with existing rules before saving. Continue anyway?");
        if (!proceed) return;
      }
      const result = await createCustomRule(payload);
      if (result?.status !== "success" || !result?.rule_id) throw new Error("The server did not confirm that the rule was saved.");
      await reloadRules();
      await reloadActivity();
      setCustomTitle("");
      setCustomStatement("");
      setCustomCategory("Product Specification");
      setCustomForbiddenTerms("");
      setCustomScope("Global");
      setCustomSeverity("medium");
      setCustomEffectiveDate("");
      setCustomExpiryDate("");
      setShowAddCustom(false);
      setNotice("Custom rule saved successfully.");
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not save the custom rule."));
    } finally {
      setCustomSaving(false);
    }
  }

  async function handleCustomUpload() {
    if (!customFile) return;
    setCustomUploading(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await uploadAndExtract(customFile, "custom");
      setNotice(`Uploaded “${result.filename}”. ${result.extracted_count} candidate(s) with source quotations were extracted. Review and approve candidates in the Living Brand Book tab.`);
      setCustomFile(null);
      setShowAddCustom(false);
      setActiveTab("living");
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not upload or extract this document."));
    } finally {
      setCustomUploading(false);
    }
  }

  async function handleBrandUpload() {
    if (!brandFile) return;
    setBrandUploading(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await uploadAndExtract(brandFile, "brandbook");
      setNotice(`Uploaded “${result.filename}”. ${result.extracted_count} source-verified candidate(s) were extracted. Nothing becomes an active rule until you approve it.`);
      setBrandFile(null);
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not upload or extract the Brand Book."));
    } finally {
      setBrandUploading(false);
    }
  }

  async function approveCandidate(rule: BrandRule) {
    setPendingBusyId(rule.id);
    setErrorMessage("");
    setNotice("");
    try {
      const chosenExpiry = pendingExpiry[rule.id];
      if (chosenExpiry) {
        const update = await updateDefaultRule(rule.id, { expires_at: chosenExpiry });
        if (update?.status !== "success") throw new Error("Could not save the expiry date.");
      }
      const result = await approveExtractedRule(rule.id);
      if (result?.status !== "success") throw new Error("The server did not confirm approval.");
      await reloadRules();
      await reloadActivity();
      setNotice(`Approved “${rule.title}”. It is now available as a saved rule.`);
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not approve this candidate. Check its source quotation and original document."));
    } finally {
      setPendingBusyId("");
    }
  }

  async function rejectCandidate(rule: BrandRule) {
    if (!window.confirm(`Reject and remove this extracted candidate?\n\n${rule.title}`)) return;
    setPendingBusyId(rule.id);
    setErrorMessage("");
    try {
      const result = await rejectExtractedRule(rule.id);
      if (result?.status !== "success") throw new Error("The server did not confirm rejection.");
      await reloadRules();
      await reloadActivity();
      setNotice("Candidate rejected.");
    } catch (error) {
      setErrorMessage(messageOf(error, "Could not reject this candidate."));
    } finally {
      setPendingBusyId("");
    }
  }

  function launchAudit() {
    const query = new URLSearchParams({ docId, title: docTitle });
    if (isBulk) query.set("bulk", "true");
    window.location.href = `/review?${query.toString()}`;
  }

  function goBack() {
    window.location.href = "/";
  }

  const fieldLabel = (label: string, required = false) => (
    <label style={{ display: "block", fontSize: "12px", color: "#cbd5e1", marginBottom: "5px", fontWeight: 600 }}>
      {label}{required && <span style={{ color: "#f87171", marginLeft: "4px" }}>*</span>}
    </label>
  );

  const panelStyle: CSSProperties = {
    background: "#0f172a", border: "1px solid #334155", borderRadius: "12px", padding: "20px", marginBottom: "20px",
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "36px 20px", color: "#f1f5f9" }}>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#64748b", marginBottom: "8px", flexWrap: "wrap" }}>
          <span>1. Upload</span><span>→</span>
          <span style={{ color: "#38bdf8", fontWeight: 700 }}>2. Configure Policy & Rules Scope</span><span>→</span>
          <span>3. Pre-Flight Review</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px", flexWrap: "wrap" }}>
              <button onClick={goBack} style={{ ...secondaryButton, padding: "4px 10px", fontSize: "11px" }}>← Back to Upload</button>
              <h1 style={{ fontSize: "26px", fontWeight: 800, margin: 0, color: "#fff" }}>Confirm Audit Rules & Compliance Scope</h1>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px", lineHeight: 1.6 }}>
              Choose which saved rules apply to <strong style={{ color: "#e2e8f0" }}>“{docTitle}”</strong>. Uploaded facts stay pending until a person reviews and approves them.
            </p>
          </div>
          <button onClick={launchAudit} style={{ ...primaryButton, padding: "11px 18px", fontSize: "13px", whiteSpace: "nowrap" }}>Launch Pre-Flight Audit →</button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "18px", flexWrap: "wrap" }}>
          {([ ["default", "Default Rules"], ["custom", "Custom Rules"], ["living", "Living Brand Book"] ] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => { setActiveTab(tab); setErrorMessage(""); }} style={{ ...secondaryButton, padding: "8px 16px", background: activeTab === tab ? "#1e293b" : "transparent", color: activeTab === tab ? "#fff" : "#94a3b8", borderColor: activeTab === tab ? "#38bdf8" : "#334155" }}>{label}</button>
          ))}
        </div>
      </div>

      {notice && <div role="status" style={{ marginBottom: "14px", padding: "11px 13px", border: "1px solid #166534", background: "#052e16", borderRadius: "8px", color: "#bbf7d0", fontSize: "13px" }}>{notice}</div>}
      {errorMessage && <div role="alert" style={{ marginBottom: "14px", padding: "11px 13px", border: "1px solid #991b1b", background: "#450a0a", borderRadius: "8px", color: "#fecaca", fontSize: "13px" }}>{errorMessage}</div>}
      {loadError && <div role="alert" style={{ ...panelStyle, color: "#fecaca" }}>Could not load saved rules: {loadError}</div>}

      {activeTab === "default" && (
        <section style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>Default Rules ({defaults.filter(ruleIsActive).length} Active)</div>
              <p style={{ color: "#94a3b8", fontSize: "12px", margin: "5px 0 0", lineHeight: 1.6 }}>Turn a saved default rule on or off for audits. The status is saved on the server.</p>
            </div>
            <button onClick={() => { setShowDefaultManager(true); setEditingDefaultId(defaults[0]?.id || ""); setErrorMessage(""); }} style={secondaryButton}>Add or Update Default Rules</button>
          </div>
          {loadingRules ? <p style={{ color: "#94a3b8", fontSize: "13px" }}>Loading saved default rules…</p> : defaults.length === 0 ? (
            <div style={{ border: "1px dashed #475569", borderRadius: "9px", padding: "18px", color: "#94a3b8", fontSize: "13px", lineHeight: 1.7 }}>
              No default rules are saved yet. Nothing has been added automatically. Use <strong style={{ color: "#e2e8f0" }}>Add or Update Default Rules</strong> to edit a saved default or upload an official policy document and review extracted candidates.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
              {defaults.map((rule) => (
                <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", padding: "14px 16px", background: "#0b1020", border: "1px solid #1e293b", borderRadius: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "5px" }}>
                      <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "14px" }}>{rule.title}</span>
                      <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}>{rule.rule_category}</span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>{rule.id}</span>
                    </div>
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: "13px", lineHeight: 1.6 }}>{rule.approved_statement}</p>
                    {rule.expires_at && <p style={{ margin: "7px 0 0", fontSize: "11px", color: rule.status === "expired" ? "#fca5a5" : "#94a3b8" }}>Expires: {rule.expires_at}</p>}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: rule.status === "expired" ? "not-allowed" : "pointer", marginLeft: "8px", flexShrink: 0 }}>
                    <input type="checkbox" checked={ruleIsActive(rule)} disabled={rule.status === "expired"} onChange={() => void toggleRule(rule)} style={{ accentColor: "#6366f1", width: "16px", height: "16px" }} />
                    <span style={{ fontSize: "12px", color: ruleIsActive(rule) ? "#10b981" : rule.status === "expired" ? "#f87171" : "#64748b", fontWeight: 600 }}>{ruleIsActive(rule) ? "Active" : rule.status === "expired" ? "Expired" : "Inactive"}</span>
                  </label>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: "18px", borderTop: "1px solid #1e293b", paddingTop: "14px" }}>
            <strong style={{ color: "#e2e8f0", fontSize: "13px" }}>Confirm rules and launch</strong>
            <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.6, margin: "5px 0 12px" }}>Check that the correct saved rules are active. You can return here to change them before running the audit.</p>
            <button onClick={launchAudit} style={primaryButton}>Confirm Rules & Launch Audit →</button>
          </div>
        </section>
      )}

      {activeTab === "custom" && (
        <section style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>Custom Rules ({customs.filter(ruleIsActive).length} Active)</div>
              <p style={{ color: "#94a3b8", fontSize: "12px", margin: "5px 0 0", lineHeight: 1.6 }}>Create a specific rule for your team, or upload a document to extract source-backed candidates.</p>
            </div>
            <button onClick={() => { setShowAddCustom(true); setErrorMessage(""); }} style={primaryButton}>+ Add Custom Rule</button>
          </div>
          {loadingRules ? <p style={{ color: "#94a3b8", fontSize: "13px" }}>Loading saved custom rules…</p> : customs.length === 0 ? <p style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>No saved custom rules yet. Select “Add Custom Rule” to create one.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
              {customs.map((rule) => <div key={rule.id} style={{ padding: "13px 14px", background: "#0b1020", border: "1px solid #1e293b", borderRadius: "9px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <strong style={{ color: "#e2e8f0", fontSize: "13px" }}>{rule.title}</strong>
                  <label style={{ display: "flex", alignItems: "center", gap: "7px", cursor: rule.status === "expired" || rule.status === "candidate" ? "not-allowed" : "pointer", fontSize: "11px", color: ruleIsActive(rule) ? "#34d399" : rule.status === "expired" ? "#f87171" : "#94a3b8" }}>
                    <input type="checkbox" checked={ruleIsActive(rule)} disabled={rule.status === "expired" || rule.status === "candidate"} onChange={() => void toggleRule(rule)} style={{ accentColor: "#6366f1" }} />
                    {ruleIsActive(rule) ? "Active" : rule.status === "expired" ? "Expired" : rule.status === "candidate" ? "Pending approval" : "Inactive"}
                  </label>
                </div>
                <div style={{ color: "#94a3b8", fontSize: "11px", margin: "4px 0 7px" }}>{rule.rule_category} · {rule.id}</div>
                <div style={{ color: "#cbd5e1", fontSize: "13px", lineHeight: 1.6 }}>{rule.approved_statement}</div>
                {(rule.effective_date || rule.expires_at) && <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "7px" }}>Valid: {rule.effective_date || "not set"} – {rule.expires_at || "no expiry set"}</div>}
              </div>)}
            </div>
          )}
        </section>
      )}

      {activeTab === "living" && (
        <section style={panelStyle}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>Living Brand Book</div>
          <div style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.8, margin: "7px 0 16px" }}>
            <div><strong style={{ color: "#cbd5e1" }}>1) Learn from source:</strong> Upload an official guideline, product spec, or legal memo (PDF/DOCX/PPTX/TXT/MD/CSV/images). Every extracted fact must have a verified exact quote from the uploaded document.</div>
            <div><strong style={{ color: "#cbd5e1" }}>2) Review with proof:</strong> Check the filename, page number, and quoted text. Set an expiry date if the fact is time-limited (e.g., a promotion end date). Contradictions with active rules are flagged before approval.</div>
            <div><strong style={{ color: "#cbd5e1" }}>3) Approve to activate:</strong> Only after human review does a candidate become an active rule. Expired facts are flagged automatically when auditing content.</div>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "18px" }}>
            <input type="file" accept={FILE_ACCEPT} onChange={(event) => setBrandFile(event.target.files?.[0] || null)} style={{ color: "#e2e8f0", maxWidth: "100%" }} />
            <button disabled={!brandFile || brandUploading} onClick={() => void handleBrandUpload()} style={{ ...primaryButton, opacity: !brandFile || brandUploading ? 0.55 : 1, cursor: !brandFile || brandUploading ? "not-allowed" : "pointer" }}>{brandUploading ? "Uploading & extracting…" : "Upload & Extract Facts"}</button>
          </div>
          <div style={{ borderTop: "1px solid #334155", paddingTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "5px" }}>Needs review ({pendingRules.length})</div>
            <p style={{ color: "#94a3b8", fontSize: "11px", margin: "0 0 12px", lineHeight: 1.6 }}>Each item below should show its source quotation and location. If a source quote is missing, do not approve the item.</p>
            {pendingRules.length === 0 && !loadingRules ? <div style={{ color: "#94a3b8", fontSize: "12px", padding: "12px 0" }}>No pending candidates. Upload a document to extract facts for review.</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {pendingRules.map((rule) => (
                <div key={rule.id} style={{ border: "1px solid #334155", borderRadius: "9px", padding: "13px", background: "#0b1020" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <strong style={{ color: "#e2e8f0", fontSize: "13px" }}>{rule.title}</strong>
                    <span style={{ color: "#fbbf24", fontSize: "10px", border: "1px solid #854d0e", borderRadius: "4px", padding: "2px 6px" }}>Pending approval</span>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "13px", lineHeight: 1.6, marginTop: "7px" }}>{rule.approved_statement}</div>
                  <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "8px", lineHeight: 1.6 }}>
                    Source: {rule.source_filename || "Not recorded"}{rule.source_page ? ` · Page ${rule.source_page}` : " · Page not verified"}{rule.rule_category ? ` · ${rule.rule_category}` : ""}
                  </div>
                  <div style={{ marginTop: "8px", padding: "10px", borderLeft: "3px solid #38bdf8", background: "#111827", color: "#cbd5e1", fontSize: "12px", lineHeight: 1.7 }}>
                    <strong style={{ display: "block", color: "#7dd3fc", fontSize: "10px", marginBottom: "4px" }}>VERIFIED SOURCE QUOTE</strong>
                    {rule.exact_quote ? `“${rule.exact_quote}”` : "No verified exact quotation is available. This candidate should not be approved."}
                  </div>
                  {rule.contradiction && <div style={{ marginTop: "9px", padding: "9px", border: "1px solid #92400e", background: "#451a03", color: "#fde68a", borderRadius: "6px", fontSize: "12px", lineHeight: 1.6 }}>Possible conflict: {rule.contradiction}</div>}
                  {rule.contradiction_check === "unavailable" && <div style={{ marginTop: "8px", color: "#fbbf24", fontSize: "11px" }}>Automatic conflict check was unavailable; no conflict conclusion was made.</div>}
                  <div style={{ marginTop: "11px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    {rule.source_file_path && <a href={`${API_BASE}/api/rules/source/${encodeURIComponent(rule.id)}`} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc", fontSize: "11px" }}>Open original document ↗</a>}
                    <label style={{ color: "#94a3b8", fontSize: "11px" }}>Expiry date (optional): <input type="date" value={pendingExpiry[rule.id] ?? rule.expires_at ?? ""} onChange={(event) => setPendingExpiry((prev) => ({ ...prev, [rule.id]: event.target.value }))} style={{ ...inputStyle, width: "auto", marginLeft: "5px", padding: "5px" }} /></label>
                    <button disabled={!rule.exact_quote || !rule.source_file_path || pendingBusyId === rule.id} onClick={() => void approveCandidate(rule)} style={{ ...primaryButton, padding: "6px 10px", opacity: !rule.exact_quote || !rule.source_file_path || pendingBusyId === rule.id ? 0.5 : 1 }}>{pendingBusyId === rule.id ? "Saving…" : "Approve & Activate"}</button>
                    <button disabled={pendingBusyId === rule.id} onClick={() => void rejectCandidate(rule)} style={{ ...secondaryButton, padding: "6px 10px", color: "#fecaca", borderColor: "#7f1d1d" }}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid #334155", marginTop: "22px", paddingTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>Approved and saved Brand Book rules</div>
            {rules.filter((rule) => rule.rule_type === "brandbook" && rule.status !== "candidate").length === 0 ? <p style={{ color: "#94a3b8", fontSize: "12px" }}>No approved Brand Book rules yet.</p> : rules.filter((rule) => rule.rule_type === "brandbook" && rule.status !== "candidate").map((rule) => (
              <div key={rule.id} style={{ borderTop: "1px solid #1e293b", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}><strong style={{ color: "#e2e8f0", fontSize: "12px" }}>{rule.title}</strong><span style={{ color: rule.status === "active" ? "#34d399" : rule.status === "expired" ? "#f87171" : "#94a3b8", fontSize: "11px" }}>{rule.status === "expired" ? "Expired" : rule.status === "active" ? "Active" : rule.status}</span></div>
                <div style={{ color: "#cbd5e1", fontSize: "12px", marginTop: "4px" }}>{rule.approved_statement}</div>
                <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "5px" }}>Source: {rule.source_filename || "Not recorded"}{rule.source_page ? ` · Page ${rule.source_page}` : ""}{rule.expires_at ? ` · Expires ${rule.expires_at}` : " · No expiry recorded"}</div>
                {rule.exact_quote && <div style={{ marginTop: "6px", padding: "8px", borderLeft: "3px solid #38bdf8", background: "#111827", color: "#cbd5e1", fontSize: "11px", lineHeight: 1.6 }}>Quote: “{rule.exact_quote}”</div>}
                {rule.contradiction && <div style={{ marginTop: "7px", padding: "7px", border: "1px solid #92400e", background: "#451a03", color: "#fde68a", borderRadius: "6px", fontSize: "11px" }}>Possible conflict: {rule.contradiction}</div>}
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #334155", marginTop: "20px", paddingTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>Rule activity</div>
            {activity.length === 0 ? <p style={{ color: "#94a3b8", fontSize: "12px" }}>No rule activity has been returned by the server yet.</p> : <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflowY: "auto" }}>{activity.map((item) => <div key={item.id} style={{ background: "#0b1020", border: "1px solid #1e293b", borderRadius: "7px", padding: "9px 11px" }}><div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", color: "#94a3b8", fontSize: "11px" }}><strong style={{ color: "#7dd3fc" }}>{item.title}</strong><span>{item.created_at || ""}</span></div><div style={{ color: "#cbd5e1", fontSize: "12px", marginTop: "4px" }}>{item.description || item.detail || item.action || "Rule activity recorded."}</div></div>)}</div>}
          </div>
        </section>
      )}

      {showAddCustom && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !customSaving && !customUploading) setShowAddCustom(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="custom-rule-heading" style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px", width: "560px", maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: "22px" }}>
            <h2 id="custom-rule-heading" style={{ margin: "0 0 8px", fontSize: "18px", color: "#fff" }}>Add Custom Rule</h2>
            <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.6, margin: "0 0 16px" }}>Write one clear instruction the audit should check. Fields marked with a red * are required. The rule is saved only after the server confirms it.</p>
            <div style={{ marginBottom: "12px" }}>{fieldLabel("Rule name", true)}<input required value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Example: Show the offer end date" style={inputStyle} /></div>
            <div style={{ marginBottom: "12px" }}>{fieldLabel("Category", true)}<select required value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} style={inputStyle}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select><p style={{ color: "#64748b", fontSize: "11px", margin: "5px 0 0" }}>Choose the topic that best describes the rule.</p></div>
            <div style={{ marginBottom: "12px" }}>{fieldLabel("What should the system check?", true)}<textarea required value={customStatement} onChange={(event) => setCustomStatement(event.target.value)} rows={4} placeholder="Explain what is allowed, what is not allowed, or what evidence must be present." style={{ ...inputStyle, resize: "vertical" }} /></div>
            <div style={{ marginBottom: "12px" }}>{fieldLabel("Words or phrases that must not appear (optional)")}<input value={customForbiddenTerms} onChange={(event) => setCustomForbiddenTerms(event.target.value)} placeholder="Separate multiple phrases with commas" style={inputStyle} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "12px", marginBottom: "12px" }}>
              <div>{fieldLabel("Applies to")}<select value={customScope} onChange={(event) => setCustomScope(event.target.value)} style={inputStyle}><option value="Global">All content</option><option value="Campaign">This campaign</option><option value="Product">Specific product</option><option value="Channel">Specific channel</option></select></div>
              <div>{fieldLabel("Importance")}<select value={customSeverity} onChange={(event) => setCustomSeverity(event.target.value)} style={inputStyle}><option value="high">High — must fix</option><option value="medium">Medium — review</option><option value="low">Low — suggestion</option></select></div>
              <div>{fieldLabel("Start date (optional)")}<input type="date" value={customEffectiveDate} onChange={(event) => setCustomEffectiveDate(event.target.value)} style={inputStyle} /></div>
              <div>{fieldLabel("Expiry date (optional)")}<input type="date" value={customExpiryDate} onChange={(event) => setCustomExpiryDate(event.target.value)} min={customEffectiveDate || undefined} style={inputStyle} /></div>
            </div>
            <div style={{ marginBottom: "16px", padding: "10px", background: "#111827", border: "1px solid #334155", borderRadius: "7px", color: "#94a3b8", fontSize: "11px", lineHeight: 1.6 }}>Before saving, the app checks whether this rule may contradict an active rule. If that check is unavailable, it will tell you instead of pretending the check passed.</div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}><button onClick={() => setShowAddCustom(false)} disabled={customSaving} style={secondaryButton}>Cancel</button><button onClick={() => void handleCreateCustomRule()} disabled={customSaving || !customTitle.trim() || !customCategory.trim() || !customStatement.trim()} style={{ ...primaryButton, opacity: customSaving || !customTitle.trim() || !customCategory.trim() || !customStatement.trim() ? 0.55 : 1 }}>{customSaving ? "Checking & saving…" : "Check & Save Rule"}</button></div>
            <div style={{ marginTop: "18px", borderTop: "1px solid #334155", paddingTop: "14px" }}>
              <strong style={{ display: "block", color: "#e2e8f0", fontSize: "12px", marginBottom: "6px" }}>Or extract rules from a document</strong>
              <p style={{ color: "#94a3b8", fontSize: "11px", lineHeight: 1.6 }}>Choose a source document to extract candidate rules with quotations. The candidates must be reviewed before activation.</p>
              <input type="file" accept={FILE_ACCEPT} onChange={(event) => setCustomFile(event.target.files?.[0] || null)} style={{ color: "#e2e8f0", maxWidth: "100%" }} />
              <button disabled={!customFile || customUploading} onClick={() => void handleCustomUpload()} style={{ ...secondaryButton, marginTop: "10px", opacity: !customFile || customUploading ? 0.55 : 1 }}>{customUploading ? "Uploading & extracting…" : "Upload & Extract Candidates"}</button>
            </div>
          </div>
        </div>
      )}

      {showDefaultManager && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !defaultSaving && !defaultUploading) setShowDefaultManager(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="default-manager-heading" style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px", width: "600px", maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: "22px" }}>
            <h2 id="default-manager-heading" style={{ margin: "0 0 8px", fontSize: "18px", color: "#fff" }}>Add or Update Default Rules</h2>
            <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.7 }}>Edit a saved default rule below, or upload an official policy document. New extracted rules remain pending until you review their source quote and approve them.</p>
            {defaults.length > 0 ? <>
              <div style={{ marginBottom: "12px" }}>{fieldLabel("Choose a saved default rule", true)}<select value={editingDefaultId} onChange={(event) => setEditingDefaultId(event.target.value)} style={inputStyle}>{defaults.map((rule) => <option key={rule.id} value={rule.id}>{rule.title}</option>)}</select></div>
              <div style={{ marginBottom: "12px" }}>{fieldLabel("Rule name", true)}<input value={defaultTitle} onChange={(event) => setDefaultTitle(event.target.value)} style={inputStyle} /></div>
              <div style={{ marginBottom: "12px" }}>{fieldLabel("Category", true)}<select value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value)} style={inputStyle}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}{defaultCategory && !CATEGORIES.includes(defaultCategory) && <option value={defaultCategory}>{defaultCategory}</option>}</select></div>
              <div style={{ marginBottom: "12px" }}>{fieldLabel("Rule text", true)}<textarea value={defaultStatement} onChange={(event) => setDefaultStatement(event.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} /></div>
              <button onClick={() => void saveDefaultRule()} disabled={defaultSaving || !editingDefaultId || !defaultTitle.trim() || !defaultCategory.trim() || !defaultStatement.trim()} style={{ ...primaryButton, opacity: defaultSaving ? 0.6 : 1 }}>{defaultSaving ? "Saving…" : "Save Default Rule"}</button>
            </> : <div style={{ padding: "12px", background: "#0b1020", borderRadius: "7px", color: "#94a3b8", fontSize: "12px" }}>There are no saved default rules to edit. Upload a policy document below to extract candidates.</div>}
            <div style={{ borderTop: "1px solid #334155", marginTop: "18px", paddingTop: "16px" }}>
              <strong style={{ display: "block", color: "#e2e8f0", fontSize: "13px", marginBottom: "6px" }}>Add defaults from a policy document</strong>
              <p style={{ color: "#94a3b8", fontSize: "11px", lineHeight: 1.6 }}>The uploaded file is sent to the backend for extraction. Only candidates with a source-verified quote are eligible for approval.</p>
              <input type="file" accept={FILE_ACCEPT} onChange={(event) => setDefaultFile(event.target.files?.[0] || null)} style={{ color: "#e2e8f0", maxWidth: "100%" }} />
              <button onClick={() => void handleDefaultUpload()} disabled={!defaultFile || defaultUploading} style={{ ...secondaryButton, marginTop: "10px", opacity: !defaultFile || defaultUploading ? 0.55 : 1 }}>{defaultUploading ? "Uploading & extracting…" : "Upload Policy & Extract Default Candidates"}</button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}><button onClick={() => setShowDefaultManager(false)} style={secondaryButton}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
