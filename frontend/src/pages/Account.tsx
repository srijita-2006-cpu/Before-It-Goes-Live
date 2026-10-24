import { useState } from "react";

interface AccountProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

export default function Account({ darkMode, setDarkMode }: AccountProps) {
  // Brand dictionary terms stored
  const [dictionary, setDictionary] = useState<string[]>([
    "Bio-Matrix Delivery System",
    "Glow-Hydrate Complex",
    "Triple-Phyto Extract",
    "Clinical Protocol #2024-B",
  ]);
  const [newTerm, setNewTerm] = useState("");

  const addTerm = () => {
    if (!newTerm.trim()) return;
    setDictionary((prev) => [...prev, newTerm.trim()]);
    setNewTerm("");
  };

  const removeTerm = (term: string) => {
    setDictionary((prev) => prev.filter((t) => t !== term));
  };

  return (
    <div className="page" style={{ maxWidth: "860px", margin: "0 auto" }}>
      {/* Workspace Profile Header */}
      <div className="profile-card">
        <div className="profile-avatar">🛡️</div>
        <div>
          <h2>Brand Governance Workspace</h2>
          <p className="muted">Organization: <strong>Before It Goes Live (Enterprise Team)</strong></p>
        </div>
        <span className="pill" style={{ marginLeft: "auto" }}>
          COMPLIANCE PRO TIER
        </span>
      </div>

      {/* AI Engine Status */}
      <div className="settings-panel" style={{ marginBottom: "20px" }}>
        <span className="eyebrow">AUDIT REASONING ENGINE</span>
        <div className="setting-row">
          <div className="setting-icon">🤖</div>
          <div className="setting-copy">
            <strong>Google Gemini 2.0 Flash</strong>
            <span className="muted">Live multimodal reasoning & compliance grounding</span>
          </div>
          <span style={{ color: "var(--lime)", fontWeight: 700, fontSize: "12px" }}>
            ONLINE & ACTIVE
          </span>
        </div>
      </div>

      {/* Approved Brand Dictionary */}
      <div className="settings-panel" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <span className="eyebrow">BRAND DICTIONARY & WHITELIST</span>
            <h3 style={{ margin: "4px 0 0 0" }}>Approved Brand Nomenclature</h3>
          </div>
          <span className="muted" style={{ fontSize: "12px" }}>
            {dictionary.length} Terms Whitelisted
          </span>
        </div>
        <p className="muted" style={{ fontSize: "12px", marginBottom: "16px" }}>
          Phrases and terms saved via "Ignore All" are stored here. These terms will never be flagged by grammar or spelling checkers across your documents.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
          {dictionary.map((term, i) => (
            <span
              key={i}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "20px",
                padding: "6px 12px",
                fontSize: "12px",
                color: "var(--text)",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>{term}</span>
              <button
                onClick={() => removeTerm(term)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                title="Remove from dictionary"
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            placeholder="Add new approved company term or proprietary name..."
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTerm()}
            style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)", color: "#fff", fontSize: "12px", outline: "none" }}
          />
          <button className="secondary-button" style={{ minHeight: "34px", fontSize: "12px" }} onClick={addTerm}>
            Add Term
          </button>
        </div>
      </div>

      {/* Theme Settings */}
      <div className="settings-panel">
        <span className="eyebrow">DISPLAY PREFERENCES</span>
        <div className="setting-row" style={{ border: 0 }}>
          <div className="setting-icon">🌓</div>
          <div className="setting-copy">
            <strong>Interface Theme</strong>
            <span className="muted">Currently set to {darkMode ? "Dark Theme" : "Light Theme"}</span>
          </div>
          <button
            className="secondary-button"
            style={{ minHeight: "34px", fontSize: "12px" }}
            onClick={() => setDarkMode(!darkMode)}
          >
            Switch to {darkMode ? "Light" : "Dark"} Mode
          </button>
        </div>
      </div>
    </div>
  );
}