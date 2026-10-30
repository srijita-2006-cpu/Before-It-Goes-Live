import { useState } from "react";
import { Building2, Sparkles, ArrowRight, AlertCircle } from "lucide-react";
import { createOrganization, type Organization } from "../api";

interface WorkspaceSetupScreenProps {
  onWorkspaceCreated: (org: Organization) => void;
}

export default function WorkspaceSetupScreen({ onWorkspaceCreated }: WorkspaceSetupScreenProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a name for your brand workspace.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const org = await createOrganization(name.trim());
      onWorkspaceCreated(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      background: "var(--bg)",
      color: "var(--text)"
    }}>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px"
        }}>
          <img
            src="/logo.jpg"
            alt="Before It Goes Live"
            style={{ width: "42px", height: "42px", borderRadius: "10px", objectFit: "contain" }}
          />
          <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.5px" }}>
            before<span className="brand-accent">itgoes</span>live
          </span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: "14px" }}>
          Workspace Provisioning
        </p>
      </div>

      <div style={{
        width: "100%",
        maxWidth: "520px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "20px",
        padding: "36px 32px",
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: "rgba(18, 196, 212, 0.1)",
            border: "1px solid rgba(18, 196, 212, 0.3)",
            display: "grid",
            placeItems: "center",
            color: "var(--cyan)"
          }}>
            <Building2 size={18} />
          </div>
          <div>
            <span className="eyebrow">FIRST-TIME SETUP</span>
            <h2 style={{ fontSize: "18px", margin: "2px 0 0 0" }}>Name Your Brand Workspace</h2>
          </div>
        </div>

        <p className="muted" style={{ fontSize: "13px", margin: "14px 0 24px 0", lineHeight: "1.6" }}>
          Workspaces isolate your brand guidelines, custom rules, uploaded campaign assets, and audit logs from other organizations.
        </p>

        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "10px",
            padding: "12px 14px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "#fca5a5",
            fontSize: "12px"
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--muted)" }}>
              Workspace or Company Name
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Acme Health Brand Team"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none"
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="primary-button"
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Creating Workspace..." : "Create Workspace & Continue"}
            {!loading && <ArrowRight size={15} />}
          </button>
        </form>
      </div>
    </div>
  );
}
