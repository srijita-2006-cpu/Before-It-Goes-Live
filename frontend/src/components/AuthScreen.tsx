import { useState, useEffect } from "react";
import {
  Sparkles,
  Check,
  LogIn,
  UserPlus,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  Building2,
  FileCheck,
} from "lucide-react";
import {
  getDemoConfig,
  getGoogleConfig,
  loginAccount,
  registerAccount,
  type DemoConfig,
  type GoogleConfig,
  type AuthProfileResponse,
} from "../api";

interface AuthScreenProps {
  onAuthenticated: (profile: AuthProfileResponse) => void;
}

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [demoConfig, setDemoConfig] = useState<DemoConfig | null>(null);
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig | null>(null);
  const [checkingDemo, setCheckingDemo] = useState(true);

  // Sign In Form State (Left Column)
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [autofillSuccess, setAutofillSuccess] = useState(false);

  // Create Account Form State (Right Column)
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCheckingDemo(true);

    void getDemoConfig()
      .then((cfg) => {
        if (!active) return;
        setDemoConfig(cfg);
      })
      .catch(() => {
        if (active) {
          setDemoConfig({
            demo_enabled: true,
            demo_email: "demo@beforeitgoeslive.com",
            demo_password: "DemoPassword2026!",
            organization_name: "Before It Goes Live (Demo Sandbox)",
          });
        }
      })
      .finally(() => {
        if (active) setCheckingDemo(false);
      });

    void getGoogleConfig()
      .then((cfg) => {
        if (active) setGoogleConfig(cfg);
      })
      .catch(() => {
        // google config not configured
      });

    return () => {
      active = false;
    };
  }, []);

  // One-click demo credentials autofill
  const handleUseDemoCredentials = () => {
    const email = demoConfig?.demo_email || "demo@beforeitgoeslive.com";
    const password = demoConfig?.demo_password || "DemoPassword2026!";

    // Automatically populate controlled fields in the Sign In section
    setSignInEmail(email);
    setSignInPassword(password);
    setSignInError(null);
    setAutofillSuccess(true);
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError(null);

    if (!signInEmail.trim()) {
      setSignInError("Please enter your email address.");
      return;
    }
    if (!signInPassword) {
      setSignInError("Please enter your password.");
      return;
    }

    setSignInLoading(true);
    try {
      const profile = await loginAccount(signInEmail.trim(), signInPassword);
      onAuthenticated(profile);
    } catch (err) {
      setSignInError(
        err instanceof Error
          ? err.message
          : "Login failed. Please check your credentials."
      );
    } finally {
      setSignInLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    const emailTrimmed = regEmail.trim();
    if (!emailTrimmed || !emailTrimmed.includes("@") || !emailTrimmed.includes(".")) {
      setRegError("Please enter a valid email address.");
      return;
    }
    if (regPassword.length < 8) {
      setRegError("Password must be at least 8 characters long.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setRegError("Passwords do not match.");
      return;
    }

    setRegLoading(true);
    try {
      const profile = await registerAccount(
        emailTrimmed,
        regPassword,
        regFullName.trim() || undefined
      );
      onAuthenticated(profile);
    } catch (err) {
      setRegError(
        err instanceof Error ? err.message : "Registration failed. Try again."
      );
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div
      className="auth-page"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        background: "var(--bg)",
        color: "var(--text)",
        boxSizing: "border-box",
      }}
    >
      {/* Brand Header */}
      <div style={{ textAlign: "center", marginBottom: "36px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
          <img
            src="/logo.jpg"
            alt="Before It Goes Live"
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "11px",
              objectFit: "contain",
            }}
          />
          <span
            style={{
              fontSize: "24px",
              fontWeight: 800,
              letterSpacing: "-0.6px",
            }}
          >
            before<span className="brand-accent">itgoes</span>live
          </span>
        </div>
        <p
          className="muted"
          style={{
            margin: 0,
            fontSize: "14px",
            maxWidth: "520px",
            lineHeight: "1.6",
          }}
        >
          Pre-flight Brand Governance & Regulatory Compliance Engine
        </p>
      </div>

      {/* Main Two-Section Layout (Sign In on Left, Create Account on Right) */}
      <div
        style={{
          width: "100%",
          maxWidth: "1000px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "28px",
          alignItems: "stretch",
        }}
      >
        {/* ============================================================== */}
        {/* LEFT SECTION: SIGN IN WITH PROMINENT DEMO LOGIN OPTION        */}
        {/* ============================================================== */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "32px 28px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 1. VISUALLY PROMINENT DEMO BOX */}
          {demoConfig?.demo_enabled ? (
            <div
              style={{
                background:
                  "linear-gradient(135deg, rgba(18, 196, 212, 0.09) 0%, rgba(198, 244, 91, 0.11) 100%)",
                border: "1.5px solid rgba(198, 244, 91, 0.45)",
                borderRadius: "16px",
                padding: "20px 22px",
                marginBottom: "24px",
                boxShadow: "0 8px 24px rgba(198, 244, 91, 0.08)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                }}
              >
                <span
                  className="eyebrow"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "var(--lime)",
                    fontWeight: 800,
                  }}
                >
                  <Sparkles size={14} style={{ color: "var(--lime)" }} />
                  ONE-CLICK DEMO ACCESS
                </span>
                <span
                  className="pill"
                  style={{
                    background: "rgba(198, 244, 91, 0.18)",
                    color: "var(--lime)",
                    borderColor: "rgba(198, 244, 91, 0.35)",
                    fontSize: "9px",
                    fontWeight: 800,
                    padding: "3px 8px",
                  }}
                >
                  LIVE DEMO
                </span>
              </div>

              <h3
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  margin: "4px 0 8px 0",
                  letterSpacing: "-0.3px",
                }}
              >
                Try Our Live Demo
              </h3>

              <p
                className="muted"
                style={{
                  fontSize: "12.5px",
                  lineHeight: "1.55",
                  margin: "0 0 14px 0",
                }}
              >
                Want to explore Before It Goes Live? You don't need to create an
                account or enter credentials manually. Simply click the button
                below to automatically fill in the demo login credentials and
                access the application.
              </p>

              {/* Demo Credentials Visual Display */}
              <div
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  marginBottom: "14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Demo Account:</span>
                  <strong style={{ color: "var(--text)" }}>
                    {demoConfig.demo_email || "demo@beforeitgoeslive.com"}
                  </strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Demo Password:</span>
                  <strong style={{ color: "var(--text)", letterSpacing: "1px" }}>
                    ••••••••••••
                  </strong>
                </div>
              </div>

              {/* ONE-CLICK AUTOFILL BUTTON */}
              <button
                type="button"
                onClick={handleUseDemoCredentials}
                className="primary-button"
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "13px",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  cursor: "pointer",
                  background: "var(--lime)",
                  color: "#11170b",
                  border: "none",
                  borderRadius: "10px",
                  boxShadow: "0 4px 14px rgba(198, 244, 91, 0.25)",
                }}
              >
                <Sparkles size={15} />
                Use Demo Credentials
              </button>

              {/* Autofill Confirmation Message */}
              {autofillSuccess && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(198, 244, 91, 0.14)",
                    border: "1px solid rgba(198, 244, 91, 0.35)",
                    color: "var(--lime)",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Check size={14} />
                  <span>
                    Demo credentials loaded into Sign In below! Click "Sign In"
                    to proceed.
                  </span>
                </div>
              )}

              <p
                className="muted"
                style={{
                  fontSize: "11px",
                  textAlign: "center",
                  margin: "10px 0 0 0",
                }}
              >
                Click above to automatically fill in the demo email and
                password. Then click Sign In to continue.
              </p>
            </div>
          ) : !checkingDemo ? (
            <div
              onClick={handleUseDemoCredentials}
              style={{
                background: "var(--surface-raised)",
                border: autofillSuccess
                  ? "1px solid var(--lime)"
                  : "1px solid var(--border)",
                borderRadius: "12px",
                padding: "14px 16px",
                marginBottom: "24px",
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
              title="Click to automatically enter default demo email and password"
            >
              <strong style={{ display: "block", marginBottom: "4px" }}>
                Demo Access Notice
              </strong>
              <span className="muted" style={{ display: "block", marginBottom: autofillSuccess ? "8px" : "0" }}>
                Demo sandbox is currently unconfigured or disabled in this
                environment. Please sign in with your email or register an
                account.
              </span>
              {autofillSuccess && (
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    background: "rgba(198, 244, 91, 0.14)",
                    border: "1px solid rgba(198, 244, 91, 0.35)",
                    color: "var(--lime)",
                    fontSize: "11px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Check size={13} />
                  <span>
                    Default demo credentials loaded into Sign In! Click "Sign In" below.
                  </span>
                </div>
              )}
            </div>
          ) : null}

          {/* 2. REGULAR SIGN IN FORM */}
          <div style={{ marginTop: "4px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <LogIn size={18} style={{ color: "var(--cyan)" }} />
              <h3
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 750,
                  letterSpacing: "-0.2px",
                }}
              >
                Sign In
              </h3>
            </div>

            {signInError && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  marginBottom: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "#fca5a5",
                  fontSize: "12px",
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{signInError}</span>
              </div>
            )}

            <form onSubmit={handleSignInSubmit}>
              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    marginBottom: "6px",
                    color: "var(--muted)",
                  }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={signInEmail}
                  onChange={(e) => {
                    setSignInEmail(e.target.value);
                    setAutofillSuccess(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: "10px",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginBottom: "22px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--muted)",
                    }}
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSignInPassword(!showSignInPassword)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: 0,
                    }}
                  >
                    {showSignInPassword ? (
                      <>
                        <EyeOff size={13} /> Hide
                      </>
                    ) : (
                      <>
                        <Eye size={13} /> Show
                      </>
                    )}
                  </button>
                </div>
                <input
                  type={showSignInPassword ? "text" : "password"}
                  required
                  placeholder="Enter your password"
                  value={signInPassword}
                  onChange={(e) => {
                    setSignInPassword(e.target.value);
                    setAutofillSuccess(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: "10px",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={signInLoading}
                className="primary-button"
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  opacity: signInLoading ? 0.7 : 1,
                  cursor: signInLoading ? "not-allowed" : "pointer",
                }}
              >
                {signInLoading ? "Signing In..." : "Sign In"}
              </button>
            </form>

            {/* Optional Google Sign-In if configured */}
            {googleConfig?.configured && googleConfig.client_id && (
              <div
                style={{
                  marginTop: "20px",
                  paddingTop: "16px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <p
                  className="muted"
                  style={{
                    textAlign: "center",
                    fontSize: "12px",
                    marginBottom: "10px",
                  }}
                >
                  Or continue with Google Workspace
                </p>
                <div
                  id="google-signin-btn"
                  style={{ display: "flex", justifyContent: "center" }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ============================================================== */}
        {/* RIGHT SECTION: CREATE ACCOUNT                                  */}
        {/* ============================================================== */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "32px 28px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "6px",
            }}
          >
            <UserPlus size={18} style={{ color: "var(--cyan)" }} />
            <h3
              style={{
                margin: 0,
                fontSize: "17px",
                fontWeight: 750,
                letterSpacing: "-0.2px",
              }}
            >
              Create Account
            </h3>
          </div>
          <p
            className="muted"
            style={{ fontSize: "12.5px", margin: "0 0 20px 0", lineHeight: "1.5" }}
          >
            Register your team and create a dedicated brand compliance workspace.
          </p>

          {regError && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "10px",
                padding: "10px 14px",
                marginBottom: "18px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#fca5a5",
                fontSize: "12px",
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{regError}</span>
            </div>
          )}

          <form onSubmit={handleRegisterSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "6px",
                  color: "var(--muted)",
                }}
              >
                Full Name (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Alex Morgan"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "6px",
                  color: "var(--muted)",
                }}
              >
                Work Email
              </label>
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "6px",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--muted)",
                  }}
                >
                  Password (min. 8 characters)
                </label>
                <button
                  type="button"
                  onClick={() => setShowRegPassword(!showRegPassword)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: 0,
                  }}
                >
                  {showRegPassword ? (
                    <>
                      <EyeOff size={13} /> Hide
                    </>
                  ) : (
                    <>
                      <Eye size={13} /> Show
                    </>
                  )}
                </button>
              </div>
              <input
                type={showRegPassword ? "text" : "password"}
                required
                placeholder="At least 8 characters"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "6px",
                  color: "var(--muted)",
                }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                required
                placeholder="Re-enter password"
                value={regConfirmPassword}
                onChange={(e) => setRegConfirmPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={regLoading}
              className="primary-button"
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "13px",
                fontWeight: 700,
                opacity: regLoading ? 0.7 : 1,
                cursor: regLoading ? "not-allowed" : "pointer",
              }}
            >
              {regLoading ? "Creating Account..." : "Create Account & Workspace"}
            </button>
          </form>

          {/* Quick Info Checklist */}
          <div
            style={{
              marginTop: "auto",
              paddingTop: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "11.5px",
              color: "var(--muted)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldCheck size={14} style={{ color: "var(--lime)" }} />
              <span>Multi-tenant data isolation & secure Argon2id hashing</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FileCheck size={14} style={{ color: "var(--cyan)" }} />
              <span>PDF, DOCX, PPTX, image & plain-text audit pipelines</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Building2 size={14} style={{ color: "var(--violet)" }} />
              <span>Custom brand rules & deterministic compliance validation</span>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: "32px",
          textAlign: "center",
          fontSize: "12px",
          color: "var(--muted)",
        }}
      >
        Before It Goes Live · Brand Governance & Regulatory Compliance Platform
      </div>
    </div>
  );
}
