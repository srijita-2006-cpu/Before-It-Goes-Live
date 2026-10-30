import { useEffect, useState } from "react";
import { LogOut, Building2, User } from "lucide-react";
import {
  getAIStatus,
  logoutAccount,
  type AIStatusResult,
  type AuthUser,
  type Organization,
} from "../api";

interface AccountProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  authUser?: AuthUser | null;
  activeOrganization?: Organization | null;
  organizations?: Organization[];
  onSwitchOrganization?: (orgId: string) => Promise<void>;
  onLogout?: () => void;
}

export default function Account({
  darkMode,
  setDarkMode,
  authUser,
  activeOrganization,
  organizations = [],
  onSwitchOrganization,
  onLogout,
}: AccountProps) {
  // Brand dictionary terms stored
  const [dictionary, setDictionary] = useState<string[]>([
    "Bio-Matrix Delivery System",
    "Glow-Hydrate Complex",
    "Triple-Phyto Extract",
    "Clinical Protocol #2024-B",
  ]);
  const [newTerm, setNewTerm] = useState("");
  const [aiStatus, setAIStatus] = useState<AIStatusResult | null>(null);
  const [aiStatusError, setAIStatusError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  useEffect(() => {
    let active = true;
    void getAIStatus()
      .then((status) => {
        if (active) setAIStatus(status);
      })
      .catch((error: unknown) => {
        if (active) {
          setAIStatusError(
            error instanceof Error ? error.message : "Could not read AI provider status."
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const addTerm = () => {
    if (!newTerm.trim()) return;
    setDictionary((prev) => [...prev, newTerm.trim()]);
    setNewTerm("");
  };

  const removeTerm = (term: string) => {
    setDictionary((prev) => prev.filter((t) => t !== term));
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutAccount();
    } catch {
      // ignore
    } finally {
      if (onLogout) onLogout();
      setLoggingOut(false);
    }
  };

  const handleOrgChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    if (nextId && onSwitchOrganization) {
      setSwitchingOrg(true);
      try {
        await onSwitchOrganization(nextId);
      } finally {
        setSwitchingOrg(false);
      }
    }
  };

  const isDemo = Boolean(activeOrganization?.is_demo || authUser?.is_demo);

  return (
    <div className="page" style={{ maxWidth: "860px", margin: "0 auto" }}>
      {/* Workspace Profile Header */}
      <div className="profile-card" style={{ marginBottom: "20px" }}>
        <div className="profile-avatar">{isDemo ? "🔬" : "🛡️"}</div>
        <div style={{ flex: 1 }}>
          <h2>{activeOrganization?.name || "Brand Governance Workspace"}</h2>
          <p className="muted" style={{ margin: "2px 0 0 0" }}>
            User: <strong>{authUser?.full_name || authUser?.email || "Administrator"}</strong>
            {authUser?.email && ` (${authUser.email})`}
            {" · "}Role: <strong style={{ textTransform: "capitalize" }}>{activeOrganization?.role || "Owner"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto" }}>
          {isDemo ? (
            <span
              className="pill"
              style={{
                background: "rgba(198, 244, 91, 0.15)",
                color: "var(--lime)",
                borderColor: "rgba(198, 244, 91, 0.35)",
              }}
            >
              DEMO WORKSPACE · SAMPLE DATA
            </span>
          ) : (
            <span className="pill">COMPLIANCE PRO TIER</span>
          )}
        </div>
      </div>

      {/* Organization Switcher if user has multiple orgs */}
      {organizations.length > 1 && (
        <div className="settings-panel" style={{ marginBottom: "20px" }}>
          <span className="eyebrow">ACTIVE TENANT WORKSPACE</span>
          <div className="setting-row">
            <div className="setting-icon">
              <Building2 size={18} />
            </div>
            <div className="setting-copy">
              <strong>Switch Brand Workspace</strong>
              <span className="muted">You are a member of {organizations.length} workspaces</span>
            </div>
            <select
              value={activeOrganization?.id || ""}
              onChange={handleOrgChange}
              disabled={switchingOrg}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "12px",
              }}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} {org.is_demo ? "(Demo Sandbox)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* AI Engine Status */}
      <div className="settings-panel" style={{ marginBottom: "20px" }}>
        <span className="eyebrow">AUDIT REASONING ENGINE</span>
        <div className="setting-row">
          <div className="setting-icon">🤖</div>
          <div className="setting-copy">
            <strong>
              {aiStatus?.key_configured && aiStatus.provider && aiStatus.model
                ? `${aiStatus.provider[0].toUpperCase()}${aiStatus.provider.slice(1)} · ${aiStatus.model}`
                : aiStatus
                  ? "AI provider not configured"
                  : "Checking AI provider..."}
            </strong>
            <span className="muted">
              {aiStatusError ||
                aiStatus?.configuration_error ||
                (aiStatus
                  ? `${aiStatus.primary_provider || "gemini"} primary · ${aiStatus.fallback_provider || "groq"} fallback`
                  : "Reading provider selection from the backend")}
            </span>
          </div>
          <span
            style={{
              color: aiStatus?.key_configured ? "var(--lime)" : "#f5ce75",
              fontWeight: 700,
              fontSize: "12px",
            }}
          >
            {aiStatusError ? "STATUS UNAVAILABLE" : aiStatus?.key_configured ? "ONLINE" : aiStatus ? "SETUP REQUIRED" : "CHECKING"}
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
      <div className="settings-panel" style={{ marginBottom: "20px" }}>
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

      {/* Account Session & Sign Out */}
      <div className="settings-panel">
        <span className="eyebrow">SESSION MANAGEMENT</span>
        <div className="setting-row" style={{ border: 0 }}>
          <div className="setting-icon">
            <User size={18} />
          </div>
          <div className="setting-copy">
            <strong>Active Session</strong>
            <span className="muted">
              Signed in as {authUser?.email || "Authenticated User"}. Secure HTTP-only cookie.
            </span>
          </div>
          <button
            className="secondary-button"
            style={{
              minHeight: "34px",
              fontSize: "12px",
              color: "#f87171",
              borderColor: "rgba(239, 68, 68, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
            disabled={loggingOut}
            onClick={handleLogout}
          >
            <LogOut size={14} />
            {loggingOut ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </div>
    </div>
  );
}
