import { useEffect, useState } from "react";
import SplashScreen from "./components/SplashScreen";
import BottomNavigation, {
  type Tab,
} from "./components/BottomNavigation";
import Home from "./pages/Home.tsx";
import Review from "./pages/Review.tsx";
import Activity from "./pages/Activity.tsx";
import Account from "./pages/Account.tsx";
import AuthScreen from "./components/AuthScreen.tsx";
import WorkspaceSetupScreen from "./components/WorkspaceSetupScreen.tsx";
import RuleOnboardingScreen from "./components/RuleOnboardingScreen.tsx";
import {
  getCurrentUser,
  switchOrganization,
  fetchRuleStatus,
  type AuthUser,
  type Organization,
  type AuthProfileResponse,
} from "./api.ts";
import { FileText, X } from "lucide-react";
import "./App.css";

interface CurrentAsset {
  name: string;
  fileType: string;
}

const readCurrentAsset = (): CurrentAsset | null => {
  try {
    const saved = sessionStorage.getItem("b4live_current_asset");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.name === "string" && typeof parsed.fileType === "string") {
        return parsed;
      }
    }
    const name = sessionStorage.getItem("current_filename");
    const fileType = sessionStorage.getItem("current_file_type");
    if (name) return { name, fileType: fileType || "file" };
    const staged = JSON.parse(localStorage.getItem("b4live_staged_assets") || "[]");
    const first = Array.isArray(staged) ? staged[0] : null;
    return first?.name
      ? { name: first.name, fileType: first.fileType || "file" }
      : null;
  } catch {
    return null;
  }
};

export default function App() {
  const [showSplash, setShowSplash] = useState(() => {
    return !sessionStorage.getItem("b4live_splash_shown");
  });
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    return (localStorage.getItem("b4live_active_tab") as Tab) || "Home";
  });
  const [content, setContent] = useState(() => {
    return localStorage.getItem("b4live_content") || "";
  });
  const [reviewStarted, setReviewStarted] = useState(() => {
    return localStorage.getItem("b4live_review_started") === "true";
  });
  const [currentAsset, setCurrentAsset] = useState<CurrentAsset | null>(readCurrentAsset);
  const [assetNoticeOpen, setAssetNoticeOpen] = useState(false);
  const [hasApprovedCorrection, setHasApprovedCorrection] = useState(
    () => sessionStorage.getItem("b4live_review_has_approved") === "true"
  );
  const [homeSessionKey, setHomeSessionKey] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("b4live_dark_mode");
    return saved !== null ? saved === "true" : true;
  });

  useEffect(() => {
    localStorage.setItem("b4live_active_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("b4live_content", content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem("b4live_review_started", String(reviewStarted));
  }, [reviewStarted]);

  // Auth & tenant state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [authChecking, setAuthChecking] = useState(true);
  const [showRuleOnboarding, setShowRuleOnboarding] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(async (profile) => {
        if (!active) return;
        setAuthUser(profile.user);
        setActiveOrg(profile.active_organization);
        setOrganizations(profile.organizations || []);
        if (profile.active_organization) {
          try {
            const status = await fetchRuleStatus();
            if (active && !status.has_active_rules) {
              setShowRuleOnboarding(true);
            }
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        if (active) {
          setAuthUser(null);
          setActiveOrg(null);
        }
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleAuthenticated = async (profile: AuthProfileResponse) => {
    setAuthUser(profile.user);
    setActiveOrg(profile.active_organization);
    setOrganizations(profile.organizations || []);
    if (profile.active_organization) {
      try {
        const status = await fetchRuleStatus();
        if (!status.has_active_rules) {
          setShowRuleOnboarding(true);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleWorkspaceCreated = (org: Organization) => {
    setActiveOrg(org);
    setOrganizations((prev) => [...prev, org]);
    setShowRuleOnboarding(true);
  };

  const handleSwitchOrg = async (orgId: string) => {
    const switched = await switchOrganization(orgId);
    setActiveOrg(switched);
    const status = await fetchRuleStatus().catch(() => null);
    if (status && !status.has_active_rules) {
      setShowRuleOnboarding(true);
    }
  };

  const handleLogout = () => {
    setAuthUser(null);
    setActiveOrg(null);
    setOrganizations([]);
    setShowRuleOnboarding(false);
    setActiveTab("Home");
    localStorage.removeItem("b4live_active_tab");
    localStorage.removeItem("b4live_content");
    localStorage.removeItem("b4live_review_started");
    localStorage.removeItem("b4live_home_step");
    localStorage.removeItem("b4live_staged_assets");
    sessionStorage.removeItem("b4live_current_asset");
    sessionStorage.removeItem("b4live_review_has_approved");
    setCurrentAsset(null);
    setHasApprovedCorrection(false);
  };

  const updateCurrentAsset = (asset: CurrentAsset | null) => {
    setCurrentAsset(asset);
    if (asset) {
      sessionStorage.setItem("b4live_current_asset", JSON.stringify(asset));
    } else {
      sessionStorage.removeItem("b4live_current_asset");
    }
  };

  const clearReviewSession = () => {
    [
      "current_filename",
      "current_file_type",
      "currentDocId",
      "current_findings",
      "current_headline",
      "current_doc_text",
      "current_original_doc_text",
      "current_image_url",
      "current_audit_status",
      "current_risk_level",
      "current_error_message",
      "bulk_queue",
      "is_bulk_import",
      "b4live_review_has_approved",
    ].forEach((key) => sessionStorage.removeItem(key));
    (window as any).__B4LIVE_QUEUE__ = null;
    setHasApprovedCorrection(false);
  };

  const clearCurrentWorkflow = (preserveQueuedAssets: boolean) => {
    const documentId = sessionStorage.getItem("currentDocId");
    const filename = currentAsset?.name || sessionStorage.getItem("current_filename");
    let remainingAssets: Array<{ id?: string; name?: string; fileType?: string }> = [];
    if (preserveQueuedAssets) {
      try {
        const saved = JSON.parse(localStorage.getItem("b4live_staged_assets") || "[]");
        if (Array.isArray(saved)) {
          remainingAssets = saved.filter((asset) =>
            documentId
              ? asset.id !== documentId
              : asset.name !== filename
          );
        }
      } catch {
        remainingAssets = [];
      }
      if (remainingAssets.length) {
        localStorage.setItem("b4live_staged_assets", JSON.stringify(remainingAssets));
      } else {
        localStorage.removeItem("b4live_staged_assets");
        localStorage.removeItem("b4live_content");
        setContent("");
      }
    } else {
      localStorage.removeItem("b4live_staged_assets");
      localStorage.removeItem("b4live_content");
      setContent("");
      remainingAssets = [];
    }
    localStorage.setItem("b4live_home_step", "input");

    clearReviewSession();
    const nextAsset = remainingAssets[0];
    if (nextAsset?.name) {
      const next = { name: nextAsset.name, fileType: nextAsset.fileType || "file" };
      updateCurrentAsset(next);
      sessionStorage.setItem("current_filename", next.name);
      sessionStorage.setItem("current_file_type", next.fileType);
      if (nextAsset.id) sessionStorage.setItem("currentDocId", nextAsset.id);
    } else {
      updateCurrentAsset(null);
    }
    setReviewStarted(false);
    setHomeSessionKey((key) => key + 1);
  };

  const navigateAwayFromReview = (tab: Tab) => {
    if (activeTab === "Explore" && hasApprovedCorrection) {
      clearCurrentWorkflow(true);
    }
    setActiveTab(tab);
    setAssetNoticeOpen(true);
  };

  const handleClearAsset = () => {
    const confirmed = window.confirm(
      "Clear this asset from the current workflow? Any correction already approved remains saved in Activity and will not be undone."
    );
    if (!confirmed) return;
    clearCurrentWorkflow(false);
    setAssetNoticeOpen(false);
    setActiveTab("Home");
  };

  const handleStartReview = () => {
    setHasApprovedCorrection(false);
    sessionStorage.removeItem("b4live_review_has_approved");
    const name = sessionStorage.getItem("current_filename");
    if (name) {
      updateCurrentAsset({
        name,
        fileType: sessionStorage.getItem("current_file_type") || "file",
      });
    }
    setReviewStarted(true);
    setActiveTab("Explore");
  };

  if (showSplash) {
    return <SplashScreen onFinish={() => { sessionStorage.setItem("b4live_splash_shown", "true"); setShowSplash(false); }} />;
  }

  if (authChecking) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--muted)",
        fontSize: "13px"
      }}>
        Loading brand workspace...
      </div>
    );
  }

  // Not authenticated -> show AuthScreen
  if (!authUser) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  // Authenticated but no organization -> show WorkspaceSetupScreen
  if (!activeOrg) {
    return <WorkspaceSetupScreen onWorkspaceCreated={handleWorkspaceCreated} />;
  }

  // Workspace has no rules -> show RuleOnboardingScreen (can be skipped)
  if (showRuleOnboarding) {
    return (
      <RuleOnboardingScreen
        organizationName={activeOrg.name}
        onComplete={() => setShowRuleOnboarding(false)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand-lockup"
          onClick={() => {
            if (activeTab === "Explore") navigateAwayFromReview("Home");
            else {
              setActiveTab("Home");
              setReviewStarted(false);
            }
          }}
          aria-label="Go to home"
        >
          <img src="/logo.jpg" alt="" />
          <span>
            before<span className="brand-accent">itgoes</span>live
          </span>
        </button>
        <div className="topbar-status">
          <span className="status-dot" />
          <span>{activeOrg.name}</span>
          {activeOrg.is_demo && (
            <span
              className="pill"
              style={{
                marginLeft: "8px",
                background: "rgba(198, 244, 91, 0.15)",
                color: "var(--lime)",
                borderColor: "rgba(198, 244, 91, 0.35)",
                padding: "3px 8px",
                fontSize: "9px",
                fontWeight: 800,
              }}
            >
              DEMO WORKSPACE · SAMPLE DATA
            </span>
          )}
        </div>
      </header>

      <main className="main-content">
        {currentAsset && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              margin: "0 auto 18px",
              maxWidth: 1100,
              padding: "12px 16px",
              border: "1px solid var(--cyan)",
              borderRadius: 12,
              background: "rgba(18, 196, 212, 0.1)",
              color: "var(--text)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <FileText size={18} color="var(--cyan)" />
              <span style={{ fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>
                Current asset: <strong>{currentAsset.name}</strong>
                <span style={{ color: "var(--muted)" }}> · {currentAsset.fileType.toUpperCase()}</span>
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearAsset}
              aria-label="Clear current asset"
              title="Clear current asset"
              style={{ background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", display: "flex", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {activeTab === "Home" && (
          <Home
            key={homeSessionKey}
            content={content}
            setContent={setContent}
            onAssetChange={updateCurrentAsset}
            onShowAssetNotice={() => setAssetNoticeOpen(true)}
            onReview={handleStartReview}
          />
        )}

        {activeTab === "Explore" && (
          <Review
            content={content}
            setContent={setContent}
            reviewStarted={reviewStarted}
            onReview={() => setReviewStarted(true)}
            onBackToHome={() => navigateAwayFromReview("Home")}
            onCorrectionApproved={() => {
              setHasApprovedCorrection(true);
              sessionStorage.setItem("b4live_review_has_approved", "true");
            }}
          />
        )}

        {activeTab === "Activity" && (
          <Activity onStartReview={() => setActiveTab("Home")} />
        )}

        {activeTab === "Account" && (
          <Account
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            authUser={authUser}
            activeOrganization={activeOrg}
            organizations={organizations}
            onSwitchOrganization={handleSwitchOrg}
            onLogout={handleLogout}
          />
        )}
      </main>

      <BottomNavigation
        activeTab={activeTab}
        onChange={(tab) => {
          if (activeTab === "Explore" && tab !== "Explore") {
            navigateAwayFromReview(tab);
          } else {
            setActiveTab(tab);
          }
        }}
      />

      {assetNoticeOpen && (
        <div
          role="presentation"
          onClick={() => setAssetNoticeOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(5, 7, 27, 0.78)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-notice-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(440px, 100%)",
              padding: 24,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
            }}
          >
            <h2 id="asset-notice-title" style={{ margin: "0 0 10px", fontSize: 18 }}>
              {currentAsset ? "Your asset is still here" : "Your review is saved"}
            </h2>
            <p className="muted" style={{ margin: "0 0 20px", lineHeight: 1.6 }}>
              {currentAsset
                ? `${currentAsset.name} remains in the current asset box above. You can return to it to make changes; use × only to clear it from this workflow.`
                : "The approved correction and audit record remain saved in Activity. The completed asset has been cleared from the current workflow."}
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => setAssetNoticeOpen(false)}
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
