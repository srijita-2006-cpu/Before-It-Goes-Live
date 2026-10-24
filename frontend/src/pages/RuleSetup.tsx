import { useState, useEffect } from "react";
import { fetchBrandRules, addCustomRule } from "../api.ts";

interface RuleItem {
  id: string;
  title: string;
  rule_category: string;
  approved_statement: string;
  forbidden_terms?: string;
  enabled?: boolean;
}

export default function RuleSetup() {
  // Check URL query parameters for docId or draft title
  const urlParams = new URLSearchParams(window.location.search);
  const docId = urlParams.get("docId") || "draft-temp";
  const docTitle = urlParams.get("title") || "Autumn Glow Campaign Draft";
  const isBulk = urlParams.get("bulk") === "true";

  // Pre-loaded rule categories & rules
  const [rules, setRules] = useState<RuleItem[]>([
    {
      id: "BR-01",
      title: "No Absolute Medical Reversal Claims",
      rule_category: "Clinical & Regulatory",
      approved_statement: "Cosmetic products must state 'reduces appearance of fine lines', never 'reverses aging'.",
      enabled: true,
    },
    {
      id: "BR-02",
      title: "Organic Ingredient Certification Threshold",
      rule_category: "Formulation & Science",
      approved_statement: "Spec confirms 95% certified organic extracts. Never claim 100% without USDA certification.",
      enabled: true,
    },
    {
      id: "BR-03",
      title: "Promotional Price Expiration Mandate",
      rule_category: "Commercial & Pricing",
      approved_statement: "Any mention of promotional prices (e.g. $49) must disclose the expiration deadline.",
      enabled: true,
    },
    {
      id: "BR-04",
      title: "Third-Party Clinical Trial Attribution",
      rule_category: "Clinical & Regulatory",
      approved_statement: "All efficacy statistics must reference clinical protocol #2024-B with standard 4-week duration.",
      enabled: true,
    },
  ]);

  // Selected preset profile
  const [selectedProfile, setSelectedProfile] = useState("cosmetics");
  const [applyToAllInBundle, setApplyToAllInBundle] = useState(true);

  // Custom one-off rule modal/input
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customStatement, setCustomStatement] = useState("");
  const [customCategory, setCustomCategory] = useState("Product Specification");

  // Load backend rules if available
  useEffect(() => {
    fetchBrandRules()
      .then((data) => {
        if (data.rules && data.rules.length > 0) {
          setRules(data.rules.map((r: RuleItem) => ({ ...r, enabled: true })));
        }
      })
      .catch(() => {
        // Fallback to initial defaults
      });
  }, []);

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleCreateCustomRule = async () => {
    if (!customTitle.trim() || !customStatement.trim()) return;

    const newRule: RuleItem = {
      id: `CR-${Date.now().toString().slice(-4)}`,
      title: customTitle,
      rule_category: customCategory,
      approved_statement: customStatement,
      enabled: true,
    };

    setRules((prev) => [newRule, ...prev]);

    try {
      await addCustomRule({
        title: customTitle,
        rule_category: customCategory,
        approved_statement: customStatement,
      });
    } catch {
      // Graceful fallback
    }

    setCustomTitle("");
    setCustomStatement("");
    setShowAddCustom(false);
  };

  const handleLaunchAudit = () => {
    // Navigate to Review page with the confirmed rules
    window.location.href = `/review?docId=${docId}`;
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "36px 20px", color: "#f1f5f9" }}>
      {/* Top Breadcrumb & Title */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#64748b", marginBottom: "8px" }}>
          <span>1. Upload</span>
          <span>→</span>
          <span style={{ color: "#38bdf8", fontWeight: 700 }}>2. Configure Policy & Rules Scope</span>
          <span>→</span>
          <span>3. Pre-Flight Review</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 800, margin: "0 0 6px 0", color: "#ffffff" }}>
              Confirm Audit Rules & Compliance Scope
            </h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
              Review the brand guidelines and clinical facts that will be enforced for{" "}
              <strong style={{ color: "#e2e8f0" }}>"{docTitle}"</strong>.
            </p>
          </div>

          <button
            onClick={handleLaunchAudit}
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "10px 24px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.4)",
            }}
          >
            Confirm & Launch Audit →
          </button>
        </div>
      </div>

      {/* Bulk Scope Option (if multiple files uploaded) */}
      {isBulk && (
        <div
          style={{
            background: "#1e1b4b30",
            border: "1px solid #6366f150",
            borderRadius: "10px",
            padding: "14px 18px",
            marginBottom: "24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#e0e7ff" }}>
              📦 Campaign Bundle Mode Detected
            </div>
            <div style={{ fontSize: "12px", color: "#a5b4fc", marginTop: "2px" }}>
              Apply this policy profile and custom facts to all uploaded assets in the bundle.
            </div>
          </div>
          <input
            type="checkbox"
            checked={applyToAllInBundle}
            onChange={(e) => setApplyToAllInBundle(e.target.checked)}
            style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#6366f1" }}
          />
        </div>
      )}

      {/* Preset Rule Profile Selector */}
      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px", padding: "18px 20px", marginBottom: "24px" }}>
        <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: 700, marginBottom: "10px" }}>
          Select Product / Policy Profile Preset
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {[
            { id: "cosmetics", name: "Dermatology & Cosmetics", desc: "FDA cosmetic rules, ingredient specs, clinical trials" },
            { id: "promo", name: "Flash Promos & Commercial", desc: "FTC pricing guidelines, coupon codes, expiration dates" },
            { id: "master", name: "Master Corporate Baseline", desc: "Trademark spelling, corporate boilerplates, warranties" },
          ].map((profile) => (
            <div
              key={profile.id}
              onClick={() => setSelectedProfile(profile.id)}
              style={{
                background: selectedProfile === profile.id ? "#1e293b" : "#090d16",
                border: selectedProfile === profile.id ? "2px solid #6366f1" : "1px solid #334155",
                borderRadius: "8px",
                padding: "12px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700, color: selectedProfile === profile.id ? "#a5b4fc" : "#f1f5f9" }}>
                {profile.name}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px", lineHeight: "1.4" }}>
                {profile.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Rules Checklist */}
      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>
            Active Enforcement Rules ({rules.filter((r) => r.enabled).length} of {rules.length} Active)
          </div>
          <button
            onClick={() => setShowAddCustom(true)}
            style={{
              background: "#1e293b",
              color: "#38bdf8",
              border: "1px solid #38bdf850",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ➕ Add One-Off Rule / Fact
          </button>
        </div>

        {/* Modal / Inline Drawer for Custom Rule */}
        {showAddCustom && (
          <div style={{ background: "#1e293b", border: "1px solid #475569", borderRadius: "10px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
              Add a Specific Rule or Approved Fact for This Draft:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <input
                type="text"
                placeholder="Rule Title (e.g. VIP Discount Cap)"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", padding: "8px 12px", color: "#fff", fontSize: "13px", outline: "none" }}
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", padding: "8px 12px", color: "#fff", fontSize: "13px", outline: "none" }}
              >
                <option value="Product Specification">Product Specification</option>
                <option value="Commercial & Pricing">Commercial & Pricing</option>
                <option value="Clinical & Regulatory">Clinical & Regulatory</option>
              </select>
            </div>
            <textarea
              placeholder="Approved Statement / Fact (e.g. 'Flash promo price is $49 only with code GLOW20; offer strictly expires Nov 15th.')"
              value={customStatement}
              onChange={(e) => setCustomStatement(e.target.value)}
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", background: "#0f172a", border: "1px solid #334155", borderRadius: "6px", padding: "8px 12px", color: "#fff", fontSize: "13px", outline: "none", marginBottom: "10px", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={() => setShowAddCustom(false)}
                style={{ background: "transparent", border: "1px solid #475569", color: "#94a3b8", borderRadius: "6px", padding: "5px 12px", fontSize: "12px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCustomRule}
                style={{ background: "#38bdf8", color: "#000", border: "none", borderRadius: "6px", padding: "5px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Save Rule to Scan
              </button>
            </div>
          </div>
        )}

        {/* Rule Items Checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              onClick={() => toggleRule(rule.id)}
              style={{
                background: rule.enabled ? "#1e293b40" : "#090d16",
                border: rule.enabled ? "1px solid #334155" : "1px dashed #334155",
                borderRadius: "8px",
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                opacity: rule.enabled ? 1 : 0.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <input
                  type="checkbox"
                  checked={!!rule.enabled}
                  onChange={() => toggleRule(rule.id)}
                  style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#6366f1" }}
                />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
                      {rule.title}
                    </span>
                    <span style={{ fontSize: "10px", background: "#334155", color: "#94a3b8", padding: "2px 6px", borderRadius: "4px" }}>
                      {rule.rule_category}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "3px" }}>
                    {rule.approved_statement}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: "12px", color: rule.enabled ? "#34d399" : "#64748b", fontWeight: 600 }}>
                {rule.enabled ? "Active" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => (window.location.href = "/")}
          style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "14px", cursor: "pointer" }}
        >
          ← Cancel and return to upload
        </button>
        <button
          onClick={handleLaunchAudit}
          style={{
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "12px 28px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(99, 102, 241, 0.4)",
          }}
        >
          Confirm Rules & Run Review →
        </button>
      </div>
    </div>
  );
}