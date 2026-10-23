import {
  Moon,
  Sun,
  UserRound,
  ShieldCheck,
  Settings2,
  ChevronRight,
} from "lucide-react";

type Props = {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
};

export default function Account({ darkMode, setDarkMode }: Props) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERSONAL WORKSPACE</p>
          <h1>Your <span>account.</span></h1>
          <p className="muted">Preferences for your review experience.</p>
        </div>
        <span className="workspace-icon"><UserRound size={24} /></span>
      </div>

      <section className="profile-card">
        <div className="profile-avatar"><UserRound size={28} /></div>
        <div>
          <h2>Workspace member</h2>
          <p className="muted">Personal demo workspace</p>
        </div>
        <span className="demo-badge">LOCAL DEMO</span>
      </section>

      <section className="settings-panel">
        <p className="eyebrow">PREFERENCES</p>

        <button className="setting-row" onClick={() => setDarkMode(!darkMode)}>
          <span className="setting-icon">
            {darkMode ? <Moon size={20} /> : <Sun size={20} />}
          </span>
          <span className="setting-copy">
            <strong>Appearance</strong>
            <span className="muted">
              {darkMode ? "Midnight dark theme" : "Light theme"}
            </span>
          </span>
          <span className="setting-action">{darkMode ? "Dark" : "Light"}</span>
        </button>

        <div className="setting-row">
          <span className="setting-icon"><ShieldCheck size={20} /></span>
          <span className="setting-copy">
            <strong>Brand guidelines</strong>
            <span className="muted">Connect approved sources in a future version</span>
          </span>
          <ChevronRight size={18} />
        </div>

        <div className="setting-row">
          <span className="setting-icon"><Settings2 size={20} /></span>
          <span className="setting-copy">
            <strong>Review preferences</strong>
            <span className="muted">Approval rules and notifications are not connected yet</span>
          </span>
          <ChevronRight size={18} />
        </div>
      </section>

      <p className="prototype-note">
        Account details and preferences are illustrative. Sign-in and cloud
        storage have not been connected.
      </p>
    </div>
  );
}