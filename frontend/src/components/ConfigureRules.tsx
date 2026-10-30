import { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Sparkles,
  BookOpen,
  Upload,
} from "lucide-react";
import {
  API_BASE,
  MAX_FILE_BYTES,
  fetchAllRules,
  toggleDefaultRule,
  updateDefaultRule,
  createDefaultRule,
  createCustomRule,
  checkCustomRuleConflicts,
  deleteCustomRule,
  extractRulesFromDoc,
  fetchRuleActivity,
  approveExtractedRule,
  rejectExtractedRule,
  type BrandRule,
  type RuleCandidate,
  type RuleActivityItem,
} from "../api.ts";

interface ConfigureRulesProps {
  onBack: () => void;
  onLaunchReview: (activeRules: BrandRule[]) => void;
  loadingReview: boolean;
}

export default function ConfigureRules({
  onBack,
  onLaunchReview,
  loadingReview,
}: ConfigureRulesProps) {
  const [activeTab, setActiveTab] = useState<
    "default" | "custom" | "brandbook"
  >("default");
  const [rules, setRules] = useState<BrandRule[]>([]);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyActionId, setBusyActionId] = useState("");

  // Tab 1: Default Rules State
  const [defaultMode, setDefaultMode] = useState<"use" | "update">("use");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editStatement, setEditStatement] = useState("");
  const [newDefTitle, setNewDefTitle] = useState("");
  const [newDefCategory, setNewDefCategory] = useState("Clinical & Regulatory");
  const [newDefStatement, setNewDefStatement] = useState("");
  const [newDefForbidden, setNewDefForbidden] = useState("");
  const [newDefSeverity, setNewDefSeverity] = useState<"high" | "medium" | "low">("medium");
  const [addingDefaultRule, setAddingDefaultRule] = useState(false);

  // Tab 2: Custom Rules State
  const [customInputMode, setCustomInputMode] = useState<"manual" | "upload">(
    "manual"
  );
  const [newTitle, setNewTitle] = useState("");
  const [newCondition, setNewCondition] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newScope, setNewScope] = useState("Global");
  const [newSeverity, setNewSeverity] = useState<"high" | "medium" | "low">(
    "medium"
  );
  const [newEffectiveDate, setNewEffectiveDate] = useState("");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [newSource, setNewSource] = useState("");

  // Document extraction & candidates
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState<RuleCandidate[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab 3: Living Brand Book State
  const [selectedLayer, setSelectedLayer] = useState<1 | 2 | 3>(1);
  const [activityLogs, setActivityLogs] = useState<RuleActivityItem[]>([]);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  // Rule scope isolation modes
  // Default tab: "all-active" uses every active default rule; "uploaded-only" deactivates
  // all other default rules so only the just-uploaded document's rules apply.
  const [defaultRuleScope, setDefaultRuleScope] = useState<"all-active" | "uploaded-only">("all-active");
  // Custom tab: "custom-only" uses only custom rules; "custom-with-defaults" mixes in
  // user-picked default rules.
  const [customRuleScope, setCustomRuleScope] = useState<"custom-only" | "custom-with-defaults">("custom-only");
  const [selectedDefaultsForCustom, setSelectedDefaultsForCustom] = useState<string[]>([]);

  // Load rules and activity from persistent backend
  const loadData = async () => {
    setLoading(true);
    setLoadFailed(false);
    setFormError("");
    try {
      const [allRules, logs] = await Promise.all([
        fetchAllRules(),
        fetchRuleActivity(),
      ]);
      setRules(allRules);
      setCandidates((previous) => {
        const previousById = new Map<string, BrandRule>(previous.map((item): [string, BrandRule] => [item.id, item]));
        return allRules.filter((item) => item.status === "candidate").map((item) => ({ ...item, ...(previousById.get(item.id) || {}) }));
      });
      setActivityLogs(logs);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      setFormError(err instanceof Error ? err.message : "Could not load rules from the backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const defaultRules = rules.filter((r) => r.rule_type === "default" && r.status !== "candidate");
  const customRules = rules.filter((r) => r.rule_type === "custom" && r.status !== "candidate");
  const brandBookRules = rules.filter(
    (r) => (r.rule_type === "brandbook" || r.is_from_brandbook) && r.status !== "candidate"
  );

  const visibleCandidates = candidates.filter((candidate) => candidate.rule_type === activeTab);
  const today = new Date().toISOString().slice(0, 10);
  const activeRules = rules.filter((rule) => {
    if (rule.status !== "active") return false;
    if (rule.effective_date && rule.effective_date > today) return false;
    if (rule.expires_at && rule.expires_at < today) return false;
    return true;
  });
  const activeCount = activeRules.length;
  const ruleGroups = (() => {
    const groups = new Map<string, { label: string; rules: BrandRule[] }>();
    for (const rule of activeRules) {
      let key: string;
      let label: string;
      if (rule.source_file_path) {
        key = `source:${rule.source_file_path}`;
        label = `Uploaded policy: ${rule.source_filename || "Source document"}`;
      } else if (rule.rule_type === "default") {
        key = "default:workspace";
        label = "Default rules";
      } else if (rule.rule_type === "custom") {
        key = `custom:${rule.id}`;
        label = `Custom rule: ${rule.title}`;
      } else {
        key = `rule:${rule.id}`;
        label = `${rule.rule_type === "brandbook" ? "Brand rule" : "Rule"}: ${rule.title}`;
      }
      const group = groups.get(key) || { label, rules: [] };
      group.rules.push(rule);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  })();
  const selectedRules = activeRules.filter((rule) => selectedRuleIds.includes(rule.id));

  // Rule groups filtered by active tab's scope mode
  const filteredRuleGroups = ruleGroups.filter((group) => {
    const isDefaultGroup = group.rules.some((r) => r.rule_type === "default");
    const isUploadedGroup = group.rules.some((r) => r.source_file_path);
    if (activeTab === "default") {
      if (defaultRuleScope === "uploaded-only" && !isUploadedGroup) return false;
      return true;
    }
    if (activeTab === "custom") {
      if (customRuleScope === "custom-only" && isDefaultGroup) return false;
      if (customRuleScope === "custom-with-defaults" && isDefaultGroup) {
        const hasSelectedDefault = group.rules.some(
          (r) => r.rule_type === "default" && selectedDefaultsForCustom.includes(r.id)
        );
        if (!hasSelectedDefault) return false;
      }
      return true;
    }
    return true;
  });

  // Keep selectedRuleIds in sync with currently active rules so that rules
  // deactivated by isolation or expiry can never be sent to the backend.
  const activeRuleIdsString = activeRules.map((r) => r.id).sort().join(",");
  useEffect(() => {
    const activeRuleIds = new Set(activeRuleIdsString.split(",").filter(Boolean));
    setSelectedRuleIds((previous) => {
      const filtered = previous.filter((id) => activeRuleIds.has(id));
      if (filtered.length !== previous.length) return filtered;
      return previous;
    });
  }, [activeRuleIdsString]);

  // Clear selections when the rule scope context changes so stale selections
  // from a different tab or scope mode cannot leak into the current review.
  useEffect(() => {
    setSelectedRuleIds([]);
  }, [activeTab, defaultRuleScope, customRuleScope]);

  const handleLaunchReview = async () => {
    setFormError("");
    try {
      const allRules = await fetchAllRules();
      setRules(allRules);
      const freshActiveRules = allRules.filter((rule) => {
        if (rule.status !== "active") return false;
        if (rule.effective_date && rule.effective_date > today) return false;
        if (rule.expires_at && rule.expires_at < today) return false;
        return true;
      });
      const validSelected = freshActiveRules.filter((rule) =>
        selectedRuleIds.includes(rule.id)
      );
      if (validSelected.length === 0) {
        setFormError(
          "No valid active rules selected. Some selected rules may have expired, been deactivated, or no longer belong to this workspace. Refresh the rule list and re-select."
        );
        return;
      }
      const prunedIds = validSelected.map((r) => r.id);
      setSelectedRuleIds(prunedIds);
      onLaunchReview(validSelected);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Could not refresh rules before launching. Please try again."
      );
    }
  };

  const toggleRule = (ruleId: string) => {
    setSelectedRuleIds((previous) =>
      previous.includes(ruleId)
        ? previous.filter((id) => id !== ruleId)
        : [...previous, ruleId]
    );
  };

  const toggleRuleGroup = (groupRules: BrandRule[]) => {
    const ids = groupRules.map((rule) => rule.id);
    const allSelected = ids.every((id) => selectedRuleIds.includes(id));
    setSelectedRuleIds((previous) =>
      allSelected
        ? previous.filter((id) => !ids.includes(id))
        : [...new Set([...previous, ...ids])]
    );
  };

  const handleToggleDefault = async (ruleId: string) => {
    if (busyActionId) return;
    setBusyActionId(ruleId);
    setFormError("");
    try {
      const result = await toggleDefaultRule(ruleId);
      setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, status: result.new_status } : r));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not update this rule.");
    } finally {
      setBusyActionId("");
    }
  };

  const handleSaveEditDefault = async (ruleId: string) => {
    if (busyActionId) return;
    if (!editStatement.trim()) {
      setFormError("Enter the updated rule before saving.");
      return;
    }
    if (editStatement.trim().length > 4000) {
      setFormError("Rule text must be 4,000 characters or fewer.");
      return;
    }
    setBusyActionId(ruleId);
    setFormError("");
    try {
      await updateDefaultRule(ruleId, { approved_statement: editStatement.trim() });
      setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, approved_statement: editStatement.trim() } : r));
      setEditingRuleId(null);
      setNotice("Default rule updated.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setBusyActionId("");
    }
  };

  const handleAddDefaultRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setNotice("");
    if (!newDefTitle.trim() || !newDefStatement.trim() || !newDefCategory.trim()) {
      setFormError("Please enter Title, Category, and Approved Standard/Statement for the rule.");
      return;
    }
    setAddingDefaultRule(true);
    try {
      await createDefaultRule({
        title: newDefTitle.trim(),
        rule_category: newDefCategory.trim(),
        approved_statement: newDefStatement.trim(),
        forbidden_terms: newDefForbidden.trim() || undefined,
        severity: newDefSeverity,
        scope: "Global",
      });
      const addedTitle = newDefTitle.trim();
      setNewDefTitle("");
      setNewDefStatement("");
      setNewDefForbidden("");
      setNotice(`Rule "${addedTitle}" was successfully added to Default Rules!`);
      setDefaultMode("use");
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add default rule.");
    } finally {
      setAddingDefaultRule(false);
    }
  };

  const handleAddManualCustom = async () => {
    setFormError("");
    setNotice("");
    if (!newTitle.trim() || !newCategory.trim() || !newCondition.trim()) {
      setFormError("Complete every field marked with a red * before adding the rule.");
      return;
    }
    if (newTitle.trim().length > 160 || newCategory.trim().length > 100 || newCondition.trim().length > 4000) {
      setFormError("Rule title must be 160 characters or fewer, category 100 or fewer, and rule text 4,000 or fewer.");
      return;
    }
    if (newExpiresAt && newEffectiveDate && newExpiresAt < newEffectiveDate) {
      setFormError("The expiry date cannot be earlier than the effective date.");
      return;
    }
    setSavingRule(true);
    try {
      const payload = {
        title: newTitle.trim(),
        approved_statement: newCondition.trim(),
        rule_category: newCategory,
        scope: newScope,
        severity: newSeverity,
        effective_date: newEffectiveDate || undefined,
        expires_at: newExpiresAt || undefined,
        source_filename: newSource.trim() || "Manual User Entry",
        exact_quote: "",
      };
      const conflictCheck = await checkCustomRuleConflicts(payload);
      if (conflictCheck.contradiction && !window.confirm(`Potential contradiction with an existing rule:\n\n${conflictCheck.contradiction}\n\nReview the existing rule and edit this one before saving. Save it anyway only if you have confirmed the policies can coexist.`)) {
        return;
      }
      if (conflictCheck.contradiction_check === "unavailable" && !window.confirm("The system could not automatically compare this rule with existing rules. Compare them manually before continuing. Save this rule anyway?")) {
        return;
      }
      const res = await createCustomRule(payload);
      if (res?.status === "success") {
        setNewTitle("");
        setNewCondition("");
        setNewCategory("");
        setNewSource("");
        setNewEffectiveDate("");
        setNewExpiresAt("");
        setNotice("Custom rule saved to the database.");
        await loadData();
      } else {
        setFormError("The server did not confirm that the rule was saved.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the custom rule.");
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteCustom = async (ruleId: string) => {
    if (busyActionId) return;
    setBusyActionId(ruleId);
    setFormError("");
    try {
      await deleteCustomRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setCandidates((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not remove the rule.");
    } finally {
      setBusyActionId("");
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size === 0) {
      setFormError("The selected file is empty. Choose a non-empty source document.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFormError("Rule source files must be 20 MiB or smaller. Choose a smaller file.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx", "pptx", "txt", "md", "csv", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(extension)) {
      setFormError("Unsupported source file. Use PDF, DOCX, PPTX, TXT, MD, CSV, or a supported image.");
      return;
    }
    setFormError("");
    setNotice("");
    setCandidates([]);
    setExtracting(true);
    try {
      const res = await extractRulesFromDoc(file, activeTab);
      setCandidates(res.candidates || []);
      if (res.candidates?.length) {
        setNotice(`Uploaded ${res.filename}. Extracted ${res.candidates.length} candidate rule(s). Review the source quote and page before approving.`);
      } else {
        setFormError(`The file ${res.filename} was received, but no rule candidates could be verified from its readable text. Scanned PDFs may not contain selectable text; configure an AI provider for visual extraction.`);
      }
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload or extraction failed. Check that the backend is running and the file is readable.");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleApproveCandidate = async (cand: RuleCandidate) => {
    if (busyActionId) return;
    if (cand.contradiction && !window.confirm(`Potential rule conflict detected:\n\n${cand.contradiction}\n\nApprove this rule anyway? Only continue if you have checked the source documents and resolved the conflict.`)) return;
    if (cand.contradiction_check === "unavailable" && !window.confirm("The system could not complete its contradiction check. Approve this candidate only if you have manually compared it with the existing rules. Continue?")) return;
    setFormError("");
    setNotice("");
    setBusyActionId(cand.id);
    try {
      // Isolation: when default scope is "uploaded-only", deactivate every other
      // active default rule so only the uploaded document's rules are enforced.
      if (defaultRuleScope === "uploaded-only" && cand.rule_type === "default") {
        const activeDefaults = defaultRules.filter(
          (r) => r.status === "active" && r.id !== cand.id
        );
        if (activeDefaults.length > 0) {
          await Promise.all(
            activeDefaults.map((rule) => toggleDefaultRule(rule.id))
          );
          setRules((prev) =>
            prev.map((r) =>
              r.rule_type === "default" && r.id !== cand.id && r.status === "active"
                ? { ...r, status: "inactive" as const }
                : r
            )
          );
        }
      }
      const result = await approveExtractedRule(cand.id);
      if (result?.status !== "success") throw new Error("The server did not confirm approval.");
      setCandidates((prev) => prev.filter((c) => c.id !== cand.id));
      setNotice(`Approved “${cand.title}”. The existing extracted record is now active; its source citation was retained.`);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not approve this candidate.");
    } finally {
      setBusyActionId("");
    }
  };

  const handleRejectCandidate = async (cand: RuleCandidate) => {
    if (busyActionId) return;
    setBusyActionId(cand.id);
    setFormError("");
    try {
      await rejectExtractedRule(cand.id);
      setCandidates((prev) => prev.filter((c) => c.id !== cand.id));
      setNotice("Candidate rejected and removed from the stored rule list.");
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not reject this candidate.");
    } finally {
      setBusyActionId("");
    }
  };

  return (
    <div
      style={{
        maxWidth: "1000px",
        margin: "0 auto",
        padding: "10px 20px 40px",
        color: "#f1f5f9",
      }}
    >
      {/* Header & Tabs Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <div>
          <button
            onClick={onBack}
            type="button"
            style={{
              background: "#171b35",
              border: "1px solid #252a48",
              borderRadius: "8px",
              color: "#12c4d4",
              cursor: "pointer",
              fontSize: "12.5px",
              fontWeight: 700,
              padding: "6px 14px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            }}
          >
            ← Back to Asset Input
          </button>
          <h1
            style={{
              fontSize: "26px",
              fontWeight: 800,
              margin: "6px 0 2px 0",
              color: "#ffffff",
            }}
          >
            Smart Rule Management System
          </h1>
          <p style={{ margin: 0, color: "#9299b7", fontSize: "13px" }}>
            Source-grounded policy gating across default standards, campaign
            rules, and living brand knowledge.
          </p>
          <p style={{ margin: "8px 0 0", color: "#b8c0d8", fontSize: "12px", lineHeight: 1.6, maxWidth: 680 }}>
            Audits use only active, approved rules. Exact prohibited terms and quoted required wording are checked deterministically; the configured AI provider also checks the document's meaning against those same rules. If text extraction or semantic review cannot finish, the audit is marked incomplete, not compliant.
          </p>
        </div>
        <div
          style={{
            background: "#101329",
            border: "1px solid #252a48",
            borderRadius: "10px",
            padding: "8px 16px",
            textAlign: "right",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: "#9299b7",
              textTransform: "uppercase",
              display: "block",
            }}
          >
            Active Rules
          </span>
          <strong style={{ fontSize: "18px", color: "#c6f45b" }}>
            {activeCount}
          </strong>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          borderBottom: "1px solid #252a48",
          paddingBottom: "12px",
          marginBottom: "24px",
        }}
      >
        {[
          {
            id: "default" as const,
            label: "1. Default Rules",
            icon: ShieldCheck,
            count: defaultRules.length,
          },
          {
            id: "custom" as const,
            label: "2. Custom Rules",
            icon: Sparkles,
            count: customRules.length,
          },
          {
            id: "brandbook" as const,
            label: "3. Living Brand Book",
            icon: BookOpen,
            count: brandBookRules.length,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: isActive ? "#171b35" : "transparent",
                border: isActive
                  ? "1px solid #12c4d4"
                  : "1px solid transparent",
                borderRadius: "10px",
                padding: "10px 18px",
                color: isActive ? "#ffffff" : "#9299b7",
                fontWeight: isActive ? 700 : 500,
                fontSize: "14px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <Icon size={16} color={isActive ? "#12c4d4" : "#9299b7"} />
              <span>{tab.label}</span>
              <span
                style={{
                  background: isActive ? "#12c4d420" : "#252a48",
                  color: isActive ? "#12c4d4" : "#cbd5e1",
                  borderRadius: "12px",
                  padding: "2px 8px",
                  fontSize: "11px",
                }}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {(formError || notice) && (
        <div role={formError ? "alert" : "status"} style={{ marginBottom: "16px", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${formError ? "#ff6b6b" : "#c6f45b"}`, background: formError ? "#ff6b6b12" : "#c6f45b12", color: formError ? "#ff9a9a" : "#c6f45b", fontSize: "12px" }}>
          {formError || notice}
          {loadFailed && <button type="button" className="secondary-button" disabled={loading} onClick={() => void loadData()} style={{ marginLeft: "10px" }}>Retry loading rules</button>}
        </div>
      )}
      {!loading && !loadFailed && activeCount === 0 && (
        <div role="status" style={{ marginBottom: "16px", padding: "12px", borderRadius: "8px", border: "1px solid #f5ce7550", background: "#f5ce7512", color: "#f5ce75", fontSize: "12px" }}>
          No active brand rules are available. Activate a saved rule or add a verified rule before launching an audit.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "20px" }}>
        {[
          { title: "1. Choose rules", text: "Activate only rules that apply to your brand, product, audience, channel, and market. Inactive and candidate rules are not enforced." },
          { title: "2. Add or upload", text: "Write a rule or upload guidelines. Extraction checks all source sections for voice, terminology, claims, evidence, disclosures, offers, design, safety, audience, and other stated standards." },
          { title: "3. Review before use", text: "Verify each quotation, source file, page, scope, and expiry. Extracted rules remain candidates until you approve them." },
        ].map((step) => <div key={step.title} style={{ background: "#080a1c", border: "1px solid #252a48", borderRadius: "10px", padding: "12px" }}><strong style={{ display: "block", color: "#12c4d4", fontSize: "12px", marginBottom: "5px" }}>{step.title}</strong><span style={{ color: "#cbd5e1", fontSize: "11px", lineHeight: 1.5 }}>{step.text}</span></div>)}
      </div>

      {visibleCandidates.length > 0 && (
        <div style={{ background: "#171b35", border: "1px solid #12c4d4", borderRadius: "12px", padding: "18px", marginBottom: "20px" }}>
          <strong style={{ fontSize: "14px", color: "#12c4d4", display: "block" }}>Review rules awaiting approval ({visibleCandidates.length})</strong>
          <p style={{ fontSize: "11px", color: "#cbd5e1", margin: "5px 0 12px" }}>Extracted key points from the uploaded document. Each row shows the verified source quotation and page reference. Approve to activate; reject to remove.</p>
          <div
            style={{
              overflowX: "auto",
              border: "1px solid #252a48",
              borderRadius: "8px",
              background: "#080a1c",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "11px",
                color: "#cbd5e1",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #252a48" }}>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Rule Title
                  </th>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Category
                  </th>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Key Points / Statement
                  </th>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Source File
                  </th>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Page / Slide
                  </th>
                  <th
                    style={{ textAlign: "left", padding: "8px 10px", color: "#9299b7", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map((cand) => (
                  <tr
                    key={cand.id}
                    style={{ borderBottom: "1px solid #1f2338" }}
                  >
                    <td style={{ padding: "10px", color: "#fff", fontSize: "12px", fontWeight: 600, verticalAlign: "top" }}>
                      {cand.title}
                    </td>
                    <td style={{ padding: "10px", color: "#9299b7", fontSize: "11px", verticalAlign: "top" }}>
                      {cand.rule_category}
                    </td>
                    <td style={{ padding: "10px", color: "#cbd5e1", fontSize: "12px", verticalAlign: "top", maxWidth: "320px", overflowWrap: "anywhere" }}>
                      {cand.approved_statement}
                    </td>
                    <td style={{ padding: "10px", color: "#9299b7", fontSize: "11px", verticalAlign: "top" }}>
                      {cand.source_filename || "Source not recorded"}
                    </td>
                    <td style={{ padding: "10px", color: "#9299b7", fontSize: "11px", verticalAlign: "top" }}>
                      {cand.source_page != null ? `Page ${cand.source_page}` : "Not available"}
                    </td>
                    <td style={{ padding: "10px", verticalAlign: "top" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void handleApproveCandidate(cand)}
                          disabled={
                            Boolean(busyActionId) ||
                            !cand.exact_quote?.trim() ||
                            Boolean(cand.expires_at && cand.expires_at < new Date().toISOString().slice(0, 10))
                          }
                          title={!cand.exact_quote?.trim() ? "A verified source quotation is required before approval." : undefined}
                          style={{
                            background: "#c6f45b",
                            color: "#080a1c",
                            border: "none",
                            borderRadius: "5px",
                            padding: "4px 10px",
                            fontSize: "10px",
                            fontWeight: 700,
                            cursor: "pointer",
                            opacity: (Boolean(busyActionId) || !cand.exact_quote?.trim() || Boolean(cand.expires_at && cand.expires_at < new Date().toISOString().slice(0, 10))) ? 0.6 : 1,
                          }}
                        >
                          {busyActionId === cand.id ? "Saving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRejectCandidate(cand)}
                          disabled={Boolean(busyActionId)}
                          style={{
                            background: "transparent",
                            color: "#ff987e",
                            border: "1px solid #ff987e40",
                            borderRadius: "5px",
                            padding: "4px 10px",
                            fontSize: "10px",
                            cursor: "pointer",
                            opacity: Boolean(busyActionId) ? 0.6 : 1,
                          }}
                        >
                          {busyActionId === cand.id ? "Saving…" : "Reject"}
                        </button>
                      </div>
                      {cand.source_file_path && (
                        <a
                          href={`${API_BASE}/api/rules/source/${encodeURIComponent(cand.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "block", marginTop: "4px", color: "#12c4d4", fontSize: "9px" }}
                        >
                          Open original source document
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "10px", fontSize: "11px", color: "#9299b7", lineHeight: 1.5 }}>
            {visibleCandidates.some((c) => c.contradiction) && <div style={{ color: "#f5ce75", marginBottom: "4px" }}>One or more candidates have a possible conflict with an active rule. Review before approving.</div>}
            {visibleCandidates.some((c) => c.contradiction_check === "unavailable") && <div style={{ color: "#f5ce75", marginBottom: "4px" }}>Automatic conflict check was unavailable for some candidates; compare manually before approval.</div>}
            <span style={{ color: "#64748b", fontSize: "10px" }}>Status: candidate · Approval is required before enforcement.</span>
          </div>
        </div>
      )}

      {/* TAB 1: DEFAULT RULES */}
      {activeTab === "default" && (
        <div
          style={{
            background: "#101329",
            border: "1px solid #252a48",
            borderRadius: "16px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  margin: "0 0 4px 0",
                  color: "#ffffff",
                }}
              >
                Add or update default rules
              </h2>
              <p style={{ margin: 0, color: "#9299b7", fontSize: "12px" }}>
                Turn saved default rules on or off. To change the baseline, upload an official source and review its extracted proposals first.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setDefaultMode("use")}
                style={{
                  background: defaultMode === "use" ? "#12c4d4" : "#171b35",
                  color: defaultMode === "use" ? "#080a1c" : "#9299b7",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Use Default Rules
              </button>
              <button
                onClick={() => setDefaultMode("update")}
                style={{
                  background: defaultMode === "update" ? "#12c4d4" : "#171b35",
                  color: defaultMode === "update" ? "#080a1c" : "#9299b7",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Update Default Rules
              </button>
            </div>
          </div>

          {/* Default rule scope selector */}
          <div style={{ marginTop: "16px", padding: "14px", background: "#080a1c", border: "1px solid #252a48", borderRadius: "10px", marginBottom: "20px" }}>
            <strong style={{ display: "block", fontSize: "12px", color: "#fff", marginBottom: "8px" }}>Rule scope for this upload</strong>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={defaultRuleScope === "all-active"}
                  onChange={() => setDefaultRuleScope("all-active")}
                  style={{ accentColor: "#12c4d4" }}
                />
                Use all active default rules
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={defaultRuleScope === "uploaded-only"}
                  onChange={() => setDefaultRuleScope("uploaded-only")}
                  style={{ accentColor: "#12c4d4" }}
                />
                Use only uploaded document rules
              </label>
            </div>
            {defaultRuleScope === "uploaded-only" && (
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#9299b7", lineHeight: 1.5 }}>
                When enabled, approving rules from this upload will deactivate all other default rules so only the uploaded document&apos;s rules are enforced.
              </div>
            )}
          </div>

          {defaultMode === "update" && (
            <div
              style={{
                background: "#080a1c",
                border: "1px solid #252a48",
                borderRadius: "14px",
                padding: "20px",
                marginBottom: "20px",
                boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ marginBottom: "16px" }}>
                <h3
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "var(--lime)",
                    margin: "0 0 4px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Sparkles size={16} />
                  Add a New Rule to Default Rules
                </h3>
                <p style={{ fontSize: "12px", color: "#9299b7", margin: 0 }}>
                  Enter your organization standard below. It will be added directly into Default Rules and can be toggled Active/Inactive at any time.
                </p>
              </div>

              <form onSubmit={handleAddDefaultRule} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#cbd5e1", marginBottom: "4px" }}>
                      Rule Title *
                    </label>
                    <input
                      type="text"
                      value={newDefTitle}
                      onChange={(e) => setNewDefTitle(e.target.value)}
                      placeholder="e.g. Return Policy Expiration Disclosure"
                      required
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#101329",
                        border: "1px solid #252a48",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#cbd5e1", marginBottom: "4px" }}>
                      Category *
                    </label>
                    <select
                      value={newDefCategory}
                      onChange={(e) => setNewDefCategory(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#101329",
                        border: "1px solid #252a48",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="Clinical & Regulatory">Clinical & Regulatory</option>
                      <option value="Formulation & Science">Formulation & Science</option>
                      <option value="Commercial & Pricing">Commercial & Pricing</option>
                      <option value="Brand Voice & Legal">Brand Voice & Legal</option>
                      <option value="Claims & Environmental">Claims & Environmental</option>
                      <option value="General Standard">General Standard</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#cbd5e1", marginBottom: "4px" }}>
                    Approved Policy Standard / Statement *
                  </label>
                  <textarea
                    value={newDefStatement}
                    onChange={(e) => setNewDefStatement(e.target.value)}
                    placeholder="Describe the required standard, approved terminology, and mandatory disclosure..."
                    rows={3}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      color: "#ffffff",
                      fontSize: "12px",
                      lineHeight: "1.5",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#cbd5e1", marginBottom: "4px" }}>
                      Forbidden Terms (optional, comma-separated)
                    </label>
                    <input
                      type="text"
                      value={newDefForbidden}
                      onChange={(e) => setNewDefForbidden(e.target.value)}
                      placeholder="e.g. 100% guaranteed, permanently risk-free"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#101329",
                        border: "1px solid #252a48",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#cbd5e1", marginBottom: "4px" }}>
                      Severity *
                    </label>
                    <select
                      value={newDefSeverity}
                      onChange={(e) => setNewDefSeverity(e.target.value as "high" | "medium" | "low")}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: "#101329",
                        border: "1px solid #252a48",
                        borderRadius: "8px",
                        color: "#ffffff",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                  <button
                    type="submit"
                    disabled={addingDefaultRule}
                    style={{
                      background: "var(--lime)",
                      color: "#080a1c",
                      border: "none",
                      borderRadius: "8px",
                      padding: "8px 18px",
                      fontSize: "12px",
                      fontWeight: 800,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {addingDefaultRule ? "Saving Rule..." : "+ Add to Default Rules"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefaultMode("use")}
                    style={{
                      background: "transparent",
                      color: "#9299b7",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "8px 14px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>

              {/* Upload section */}
              <div
                style={{
                  marginTop: "20px",
                  paddingTop: "16px",
                  borderTop: "1px solid #1f2338",
                }}
              >
                <strong
                  style={{
                    fontSize: "12.5px",
                    color: "#12c4d4",
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  Or Upload Source Document to Extract Updated Company Policies:
                </strong>
                <p
                  style={{
                    fontSize: "11px",
                    color: "#9299b7",
                    margin: "0 0 10px 0",
                  }}
                >
                  Upload official policy PDF, DOCX, or guidelines. Candidates will be proposed for review before updating the baseline.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFileUpload(e.target.files)}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  style={{
                    background: "#171b35",
                    color: "#cbd5e1",
                    border: "1px solid #252a48",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {extracting
                    ? "Extracting Candidate Rules..."
                    : "📄 Select Policy File to Extract"}
                </button>
              </div>
            </div>
          )}

          {/* List of Default Rules */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {loading ? <p style={{ color: "#9299b7", fontSize: "12px" }}>Loading saved default rules…</p> : defaultRules.length === 0 ? <p style={{ color: "#9299b7", fontSize: "12px", padding: "12px", border: "1px dashed #252a48", borderRadius: "8px" }}>No default rules are saved in the database yet. Nothing has been generated automatically. Use “Update Default Rules” to upload an official source document, then review its extracted candidates.</p> : null}
            {defaultRules.map((rule) => {
              const isActive = rule.status === "active";
              const isEditing = editingRuleId === rule.id;
              return (
                <div
                  key={rule.id}
                  style={{
                    background: isActive ? "#171b35" : "#0c0e1e",
                    border: isActive
                      ? "1px solid #252a48"
                      : "1px dashed #1f2338",
                    borderRadius: "12px",
                    padding: "16px",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#12c4d4",
                            background: "#12c4d415",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          {rule.id}
                        </span>
                        <strong
                          style={{
                            fontSize: "14px",
                            color: isActive ? "#ffffff" : "#64748b",
                          }}
                        >
                          {rule.title}
                        </strong>
                        <span
                          style={{
                            fontSize: "10px",
                            color: "#9299b7",
                            border: "1px solid #252a48",
                            borderRadius: "4px",
                            padding: "1px 6px",
                          }}
                        >
                          {rule.rule_category}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "#64748b",
                          marginTop: "2px",
                          display: "block",
                        }}
                      >
                        Scope: {rule.scope || "Not specified"} • Source: {rule.source_filename || "Not recorded"}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: isActive ? "#c6f45b" : "#64748b",
                        }}
                      >
                        {isActive ? "ACTIVE" : "EXCLUDED"}
                      </span>
                      <button
                        disabled={Boolean(busyActionId)}
                        onClick={() => void handleToggleDefault(rule.id)}
                        style={{
                          background: isActive ? "#c6f45b20" : "#252a48",
                          border: `1px solid ${
                            isActive ? "#c6f45b" : "#475569"
                          }`,
                          color: isActive ? "#c6f45b" : "#cbd5e1",
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {busyActionId === rule.id ? "Saving…" : isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div style={{ marginTop: "10px" }}>
                      <textarea
                        value={editStatement}
                        onChange={(e) => setEditStatement(e.target.value)}
                        rows={2}
                        style={{
                          width: "100%",
                          background: "#080a1c",
                          border: "1px solid #12c4d4",
                          borderRadius: "6px",
                          padding: "8px",
                          color: "#fff",
                          fontSize: "12px",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginTop: "6px",
                        }}
                      >
                        <button
                          disabled={Boolean(busyActionId)}
                          onClick={() => void handleSaveEditDefault(rule.id)}
                          style={{
                            background: "#12c4d4",
                            color: "#080a1c",
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 12px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {busyActionId === rule.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingRuleId(null)}
                          style={{
                            background: "transparent",
                            color: "#9299b7",
                            border: "none",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#cbd5e1",
                        marginTop: "4px",
                        lineHeight: "1.5",
                      }}
                    >
                      <strong>Rule:</strong>{" "}
                      {rule.approved_statement}
                      {defaultMode === "update" && (
                        <button
                          onClick={() => {
                            setEditingRuleId(rule.id);
                            setEditStatement(rule.approved_statement);
                          }}
                          style={{
                            marginLeft: "10px",
                            background: "transparent",
                            border: "none",
                            color: "#12c4d4",
                            fontSize: "11px",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOM RULES */}
      {activeTab === "custom" && (
        <div
          style={{
            background: "#101329",
            border: "1px solid #252a48",
            borderRadius: "16px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  margin: "0 0 4px 0",
                  color: "#ffffff",
                }}
              >
                Campaign, Product & Situation-Specific Rules
              </h2>
              <p style={{ margin: 0, color: "#9299b7", fontSize: "12px" }}>
                Enter custom rules manually or upload source collateral. Fields marked * are required; the rule will not save until all three are complete.
                documents.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setCustomInputMode("manual")}
                style={{
                  background:
                    customInputMode === "manual" ? "#12c4d4" : "#171b35",
                  color: customInputMode === "manual" ? "#080a1c" : "#9299b7",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Option A: Enter Manually
              </button>
              <button
                onClick={() => setCustomInputMode("upload")}
                style={{
                  background:
                    customInputMode === "upload" ? "#12c4d4" : "#171b35",
                  color: customInputMode === "upload" ? "#080a1c" : "#9299b7",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Option B: Upload Document
              </button>
            </div>
          </div>

          {/* Custom rule scope selector */}
          <div style={{ marginTop: "16px", padding: "14px", background: "#080a1c", border: "1px solid #252a48", borderRadius: "10px", marginBottom: "20px" }}>
            <strong style={{ display: "block", fontSize: "12px", color: "#fff", marginBottom: "8px" }}>Rule scope for custom review</strong>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={customRuleScope === "custom-only"}
                  onChange={() => setCustomRuleScope("custom-only")}
                  style={{ accentColor: "#12c4d4" }}
                />
                Custom rules only
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={customRuleScope === "custom-with-defaults"}
                  onChange={() => setCustomRuleScope("custom-with-defaults")}
                  style={{ accentColor: "#12c4d4" }}
                />
                Custom + picked defaults
              </label>
            </div>
            {customRuleScope === "custom-with-defaults" && defaultRules.length > 0 && (
              <div style={{ marginTop: "10px", padding: "12px", background: "#0c0e1e", border: "1px solid #252a48", borderRadius: "8px" }}>
                <strong style={{ display: "block", fontSize: "11px", color: "#12c4d4", marginBottom: "8px" }}>Pick default rules to mix in:</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
                  {defaultRules.map((rule) => (
                    <label key={rule.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#cbd5e1", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedDefaultsForCustom.includes(rule.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDefaultsForCustom([...selectedDefaultsForCustom, rule.id]);
                          } else {
                            setSelectedDefaultsForCustom(selectedDefaultsForCustom.filter((id) => id !== rule.id));
                          }
                        }}
                        style={{ accentColor: "#12c4d4" }}
                      />
                      {rule.title}
                    </label>
                  ))}
                </div>
                {selectedDefaultsForCustom.length > 0 && (
                  <div style={{ marginTop: "6px", fontSize: "11px", color: "#c6f45b" }}>
                    {selectedDefaultsForCustom.length} default rule(s) will be mixed in
                  </div>
                )}
              </div>
            )}
            {customRuleScope === "custom-only" && (
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#9299b7", lineHeight: 1.5 }}>
                Only custom rules will be enforced. Default rules are excluded from this review.
              </div>
            )}
            {customRuleScope === "custom-with-defaults" && (
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#9299b7", lineHeight: 1.5 }}>
                Custom rules plus the default rules you pick above will be enforced together.
              </div>
            )}
          </div>

          {/* Convenience buttons */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              onClick={() => setCustomInputMode("manual")}
              style={{
                background: "#171b35",
                color: "#cbd5e1",
                border: "1px solid #252a48",
                borderRadius: "8px",
                padding: "6px 14px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Add more custom rules
            </button>
            <button
              onClick={() => setActiveTab("default")}
              style={{
                background: "#171b35",
                color: "#cbd5e1",
                border: "1px solid #252a48",
                borderRadius: "8px",
                padding: "6px 14px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Add default rules
            </button>
          </div>

          {/* Option A: Manual Entry */}
          {customInputMode === "manual" && (
            <div
              style={{
                background: "#080a1c",
                border: "1px solid #252a48",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              <strong
                style={{
                  fontSize: "13px",
                  color: "#ffffff",
                  display: "block",
                  marginBottom: "12px",
                }}
              >
                Create Custom Rule:
              </strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Rule Title <span style={{ color: "#ff6b6b" }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Q4 Holiday Cola Promo Disclaimer"
                    value={newTitle}
                    maxLength={160}
                    required
                    aria-required="true"
                    onChange={(e) => setNewTitle(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      color: "#fff",
                      fontSize: "12px",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Category <span style={{ color: "#ff6b6b" }}>*</span>
                  </label>
                  <select
                    value={newCategory}
                    required
                    aria-required="true"
                    onChange={(e) => setNewCategory(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      color: "#fff",
                      fontSize: "12px",
                    }}
                  >
                    <option value="" disabled>Select a category</option>
                    <option>Brand identity and logo usage</option>
                    <option>Brand voice and tone</option>
                    <option>Product descriptions and approved claims</option>
                    <option>Unsupported or misleading claims</option>
                    <option>Advertising and promotional conditions</option>
                    <option>Pricing, discounts, and offer validity</option>
                    <option>Required disclaimers and disclosures</option>
                    <option>Product specifications and factual accuracy</option>
                    <option>Channel-specific content restrictions</option>
                    <option>Applicable legal and regulatory requirements</option>
                    <option>Testimonials, reviews, and influencer disclosures</option>
                    <option>Packaging, labels, and usage instructions</option>
                    <option>Safety warnings and product limitations</option>
                    <option>Privacy and personal data</option>
                    <option>Accessibility and inclusive content</option>
                    <option>Competitor and comparative claims</option>
                    <option>Environmental and sustainability claims</option>
                    <option>Copyright, trademarks, and permissions</option>
                    <option>Data security and cybersecurity claims</option>
                    <option>Employment, hiring, and workplace communications</option>
                    <option>Financial services and investment claims</option>
                    <option>Health, wellness, and medical claims</option>
                    <option>Political, social, and sensitive-topic content</option>
                    <option>Localization, language, and regional restrictions</option>
                    <option>Product availability, stock, and delivery promises</option>
                    <option>Customer support and service commitments</option>
                    <option>AI-generated content and synthetic media disclosure</option>
                    <option>Other (describe in the rule)</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    fontSize: "11px",
                    color: "#9299b7",
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  Rule / Condition <span style={{ color: "#ff6b6b" }}>*</span>
                </label>
                <p style={{ fontSize: "11px", color: "#9299b7", margin: "0 0 6px" }}>
                  Write the rule as an instruction the checker can compare with an asset. Example: “Show the offer end date and participating-store restriction whenever this discount is advertised.”
                </p>
                <textarea
                  placeholder="Describe exactly what must appear, must not appear, or must be true…"
                  value={newCondition}
                  maxLength={4000}
                  required
                  aria-required="true"
                  onChange={(e) => setNewCondition(e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    background: "#101329",
                    border: "1px solid #252a48",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Scope
                  </label>
                  <select
                    value={newScope}
                    onChange={(e) => setNewScope(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "8px",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                  >
                    <option>Global</option>
                    <option>Campaign: Holiday</option>
                    <option>Channel: Social</option>
                    <option>Channel: Packaging</option>
                    <option>Product Specific</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Severity
                  </label>
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "8px",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                  >
                    <option value="high">🚨 High (Blocker)</option>
                    <option value="medium">⚠️ Medium (Warning)</option>
                    <option value="low">ℹ️ Low (Advisory)</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={newEffectiveDate}
                    onChange={(e) => setNewEffectiveDate(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "7px",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: "11px",
                      color: "#9299b7",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Expiration Date
                  </label>
                  <input
                    type="date"
                    value={newExpiresAt}
                    onChange={(e) => setNewExpiresAt(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#101329",
                      border: "1px solid #252a48",
                      borderRadius: "8px",
                      padding: "7px",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  placeholder="Source / Legal memo justification (optional)"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  style={{
                    width: "65%",
                    background: "#101329",
                    border: "1px solid #252a48",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: "11px",
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddManualCustom}
                  disabled={savingRule || !newTitle.trim() || !newCategory.trim() || !newCondition.trim()}
                  aria-disabled={savingRule || !newTitle.trim() || !newCategory.trim() || !newCondition.trim()}
                  title={!newTitle.trim() || !newCategory.trim() || !newCondition.trim() ? "Fill in the three required fields first." : "Save this custom rule"}
                  style={{
                    background: "#c6f45b",
                    color: "#080a1c",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 20px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: savingRule ? "wait" : "pointer",
                    opacity: savingRule ? 0.7 : 1,
                  }}
                >
                  {savingRule ? "Saving…" : "+ Add Custom Rule"}
                </button>
              </div>
            </div>
          )}

          {/* Option B: Document Upload & AI Candidate Extraction */}
          {customInputMode === "upload" && (
            <div
              style={{
                background: "#080a1c",
                border: "1px dashed #12c4d450",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <Upload
                  size={28}
                  color="#12c4d4"
                  style={{ margin: "0 auto 8px auto" }}
                />
                <strong
                  style={{
                    fontSize: "14px",
                    color: "#ffffff",
                    display: "block",
                  }}
                >
                  Upload Document to Extract Custom Rules
                </strong>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#9299b7",
                    margin: "4px 0 16px 0",
                  }}
                >
                  Supports PDF, DOCX, PPTX, images, and UTF-8 text files. Scanned pages require readable text or configured AI visual extraction; OCR is not guaranteed.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.docx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff"
                  onChange={(e) => { void handleFileUpload(e.target.files); e.target.value = ""; }}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  style={{
                    background: "#12c4d4",
                    color: "#080a1c",
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 22px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {extracting
                    ? "Extracting Rules & Citations..."
                    : "Choose File to Ingest"}
                </button>
              </div>
            </div>
          )}

          {/* Existing Custom Rules */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#9299b7",
                textTransform: "uppercase",
              }}
            >
              Active Custom Rules ({customRules.length})
            </span>
            {customRules.length === 0 ? (
              <p style={{ fontSize: "12px", color: "#64748b" }}>
                No custom rules configured yet. Enter one manually or upload a
                document above.
              </p>
            ) : (
              customRules.map((rule) => (
                <div
                  key={rule.id}
                  style={{
                    background: "#171b35",
                    border: "1px solid #252a48",
                    borderRadius: "10px",
                    padding: "14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#12c4d4",
                          }}
                        >
                          {rule.id}
                        </span>
                        <strong style={{ fontSize: "13px", color: "#fff" }}>
                          {rule.title}
                        </strong>
                        <span
                          style={{ fontSize: "10px", color: "#9299b7" }}
                        >
                          [{rule.rule_category}]
                        </span>
                      </div>
                      <p
                        style={{
                          margin: "4px 0 0 0",
                          fontSize: "12px",
                          color: "#cbd5e1",
                        }}
                      >
                        {rule.approved_statement}
                      </p>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "#64748b",
                          marginTop: "4px",
                          display: "block",
                        }}
                      >
                        Scope: {rule.scope} • Source:{" "}
                        {rule.source_filename || "Manual"} • Expires:{" "}
                        {rule.expires_at || "Permanent"}
                      </span>
                    </div>
                    <button
                      disabled={Boolean(busyActionId)}
                      onClick={() => void handleDeleteCustom(rule.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#ff987e",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                    >
                      {busyActionId === rule.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LIVING BRAND BOOK */}
      {activeTab === "brandbook" && (
        <div
          style={{
            background: "#101329",
            border: "1px solid #252a48",
            borderRadius: "16px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  margin: "0 0 4px 0",
                  color: "#ffffff",
                }}
              >
                Living Brand Book & Auditable Provenance
              </h2>
              <p style={{ margin: 0, color: "#9299b7", fontSize: "12px" }}>
                Upload source documents, verify citations, review possible conflicts, and track expiry dates.
              </p>
            </div>
            {/* 3-Layer Selector */}
            <div style={{ display: "flex", gap: "6px" }}>
              {[
                { layer: 1 as const, name: "Layer 1: Internal Brand Rules" },
                { layer: 2 as const, name: "Layer 2: Expiry Tracking" },
                { layer: 3 as const, name: "Layer 3: Review History" },
              ].map((l) => (
                <button
                  key={l.layer}
                  onClick={() => setSelectedLayer(l.layer)}
                  style={{
                    background:
                      selectedLayer === l.layer ? "#12c4d4" : "#171b35",
                    color: selectedLayer === l.layer ? "#080a1c" : "#9299b7",
                    border: "none",
                    borderRadius: "6px",
                    padding: "5px 10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          {/* Layer Specific Views */}
          {selectedLayer === 1 && (
            <div style={{ marginBottom: "24px" }}>
              <div
                style={{
                  background: "#080a1c",
                  border: "1px dashed #252a48",
                  borderRadius: "10px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <strong
                  style={{
                    fontSize: "13px",
                    color: "#12c4d4",
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  Ingest Official Brand Guidelines / Master Dossier:
                </strong>
                <p
                  style={{
                    fontSize: "11px",
                    color: "#9299b7",
                    margin: "0 0 10px 0",
                  }}
                >
                  Upload master guidelines or specification sheets. The engine
                  extracts facts and maintains exact citations and page
                  references.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.docx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff"
                  onChange={(e) => { void handleFileUpload(e.target.files); e.target.value = ""; }}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                  style={{
                    background: "#171b35",
                    color: "#cbd5e1",
                    border: "1px solid #252a48",
                    borderRadius: "6px",
                    padding: "6px 14px",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  {extracting
                    ? "Ingesting..."
                    : "Upload Official Guideline Document"}
                </button>
              </div>

              {/* Verified Facts List */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#9299b7",
                    textTransform: "uppercase",
                  }}
                >
                  Approved Brand Facts ({brandBookRules.length})
                </span>
                {brandBookRules.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "#64748b" }}>
                    No verified brand facts loaded yet. Upload your brand
                    guidelines above.
                  </p>
                ) : (
                  brandBookRules.map((fact) => (
                    <div
                      key={fact.id}
                      style={{
                        background: "#171b35",
                        border: "1px solid #252a48",
                        borderRadius: "10px",
                        padding: "14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: "13px", color: "#fff" }}>
                            {fact.title}
                          </strong>
                          <p
                            style={{
                              margin: "4px 0",
                              fontSize: "12px",
                              color: "#cbd5e1",
                            }}
                          >
                            {fact.approved_statement}
                          </p>
                          {fact.exact_quote && <blockquote style={{ margin: "8px 0", padding: "8px 10px", borderLeft: "2px solid #12c4d4", background: "#101329", color: "#cbd5e1", fontSize: "11px" }}>Source quotation: “{fact.exact_quote}”</blockquote>}
                          <div style={{ fontSize: "10px", color: "#64748b" }}>
                            Source: {fact.source_filename || "Not recorded"} •
                            Page/slide: {fact.source_page ?? "Not available"} • Expiry: {fact.expires_at || "Not stated"} • Status: {" "}
                            <span style={{ color: fact.status === "expired" ? "#ff987e" : fact.status === "active" ? "#c6f45b" : "#f5ce75" }}>
                              {fact.status.toUpperCase()}
                            </span>
                          </div>
                          {fact.source_file_path && <a href={`${API_BASE}/api/rules/source/${encodeURIComponent(fact.id)}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "6px", color: "#12c4d4", fontSize: "11px" }}>Open original source document</a>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {selectedLayer === 2 && (
            <div style={{ background: "#080a1c", border: "1px solid #252a48", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
              <strong style={{ fontSize: "13px", color: "#fff", display: "block", marginBottom: "8px" }}>Expiry review</strong>
              <p style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6 }}>Rules with an expiry date are tracked from the saved source record. Expired rules are not treated as active enforcement rules. Review the original source before extending or replacing a date.</p>
              {brandBookRules.filter((rule) => rule.expires_at).length === 0 ? <p style={{ color: "#64748b", fontSize: "11px" }}>No expiry dates are recorded in the saved Brand Book rules.</p> : brandBookRules.filter((rule) => rule.expires_at).map((rule) => <div key={rule.id} style={{ borderTop: "1px solid #252a48", padding: "8px 0", color: "#cbd5e1", fontSize: "11px" }}><strong>{rule.title}</strong><span> — expires {rule.expires_at} · {rule.status}</span></div>)}
            </div>
          )}

          {selectedLayer === 3 && (
            <div style={{ background: "#080a1c", border: "1px solid #252a48", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
              <strong style={{ fontSize: "13px", color: "#fff", display: "block", marginBottom: "8px" }}>Source and review history</strong>
              <p style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6 }}>Use the activity timeline below to review saved rule changes. Only facts extracted from uploaded documents or rules entered by a user appear here; no sample regulatory policies are inserted.</p>
              {brandBookRules.filter((rule) => rule.status === "candidate").length === 0 ? <p style={{ color: "#64748b", fontSize: "11px" }}>There are no pending candidates in the saved rules list.</p> : brandBookRules.filter((rule) => rule.status === "candidate").map((rule) => <div key={rule.id} style={{ borderTop: "1px solid #252a48", padding: "8px 0", color: "#cbd5e1", fontSize: "11px" }}><strong>{rule.title}</strong><span> — waiting for approval · {rule.source_filename || "Source not recorded"} · page {rule.source_page ?? "not available"}</span></div>)}
            </div>
          )}

          {/* Persistent Activity Timeline */}
          <div
            style={{
              marginTop: "24px",
              borderTop: "1px solid #252a48",
              paddingTop: "18px",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#9299b7",
                textTransform: "uppercase",
              }}
            >
              Living History & Audit Timeline ({activityLogs.length} Events)
            </span>
            <div
              style={{
                maxHeight: "200px",
                overflowY: "auto",
                marginTop: "10px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {activityLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: "#080a1c",
                    border: "1px solid #1f2338",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    fontSize: "11px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      color: "#9299b7",
                    }}
                  >
                    <span style={{ color: "#12c4d4", fontWeight: 600 }}>
                      {log.title}
                    </span>
                    <span>{log.created_at}</span>
                  </div>
                  <div style={{ color: "#cbd5e1", marginTop: "2px" }}>
                    {log.description || log.detail || log.action || "Rule activity recorded."}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <section
        aria-labelledby="review-rule-selection-title"
        style={{
          marginTop: "24px",
          padding: "18px",
          border: "1px solid #12c4d455",
          borderRadius: "12px",
          background: "#101329",
        }}
      >
        <h2 id="review-rule-selection-title" style={{ margin: "0 0 6px", color: "#fff", fontSize: "16px" }}>
          Choose rules for this review
        </h2>
        <p style={{ margin: "0 0 14px", color: "#cbd5e1", fontSize: "12px", lineHeight: 1.6 }}>
          Only checked active rules will be used. Rules from different sources are combined only when you explicitly select more than one group. For an uploaded policy, select its document group; defaults and unrelated custom rules will not be added automatically.
        </p>
        {ruleGroups.length === 0 ? (
          <p role="status" style={{ margin: 0, color: "#f5ce75", fontSize: "12px" }}>
            No active rules are available. Approve an extracted policy rule or create/activate a rule before reviewing.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
            {filteredRuleGroups.map((group) => {
              const groupSelectedCount = group.rules.filter((rule) => selectedRuleIds.includes(rule.id)).length;
              const groupChecked = groupSelectedCount === group.rules.length;
              return (
                <fieldset key={group.key} style={{ minWidth: 0, margin: 0, padding: "10px 12px", border: "1px solid #252a48", borderRadius: "8px" }}>
                  <legend style={{ padding: "0 4px", color: "#12c4d4", fontSize: "12px", fontWeight: 700 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
                      <input
                        type="checkbox"
                        checked={groupChecked}
                        ref={(element) => {
                          if (element) element.indeterminate = groupSelectedCount > 0 && !groupChecked;
                        }}
                        onChange={() => toggleRuleGroup(group.rules)}
                        aria-label={`Select all rules from ${group.label}`}
                      />
                      {group.label}
                    </label>
                  </legend>
                  <div style={{ display: "grid", gap: "7px" }}>
                    {group.rules.map((rule) => (
                      <label key={rule.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px", color: "#e2e8f0", fontSize: "11px", lineHeight: 1.45 }}>
                        <input
                          type="checkbox"
                          checked={selectedRuleIds.includes(rule.id)}
                          onChange={() => toggleRule(rule.id)}
                          aria-label={`Use rule ${rule.title}`}
                        />
                        <span>
                          <strong>{rule.title}</strong>
                          {rule.source_page != null && <span style={{ color: "#9299b7" }}> · Source page {rule.source_page}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}
        <p style={{ margin: "12px 0 0", color: selectedRules.length ? "#cbd5e1" : "#f5ce75", fontSize: "11px" }}>
          {selectedRules.length
            ? `${selectedRules.length} rule${selectedRules.length === 1 ? "" : "s"} selected.`
            : "Select at least one rule. No rule source is selected by default."}
        </p>
      </section>

      {/* Launch Review Action Bar */}
      <div
        style={{
          marginTop: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#101329",
          border: "1px solid #252a48",
          borderRadius: "12px",
          padding: "16px 20px",
        }}
      >
        <div>
          <strong style={{ fontSize: "14px", color: "#ffffff" }}>
            Ready to Audit Asset
          </strong>
          <span
            style={{ fontSize: "12px", color: "#9299b7", display: "block" }}
          >
            {activeCount} active rules ready across Default, Custom, and Living
            Brand Book. {selectedRules.length} selected for this review.
          </span>
        </div>
        <button
          onClick={handleLaunchReview}
          disabled={loadingReview || loading || selectedRules.length === 0}
          style={{
            background: "#c6f45b",
            color: "#080a1c",
            border: "none",
            borderRadius: "10px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 800,
            cursor: loadingReview || loading || selectedRules.length === 0 ? "not-allowed" : "pointer",
            opacity: loadingReview || loading || selectedRules.length === 0 ? 0.65 : 1,
          }}
        >
          {loadingReview
            ? "Auditing Asset..."
            : activeCount === 0
            ? "Add or activate rules to continue"
            : selectedRules.length === 0
            ? "Select rules for this review"
            : "🚀 Confirm Rules & Launch Review →"}
        </button>
      </div>
    </div>
  );
}