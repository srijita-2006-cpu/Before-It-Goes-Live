import { Clock3, FileText, ArrowUpRight } from "lucide-react";

export default function Activity() {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Review <span>activity.</span></h1>
          <p className="muted">Keep track of your content review journey.</p>
        </div>
        <span className="workspace-icon"><Clock3 size={24} /></span>
      </div>

      <section className="empty-state activity-empty">
        <div className="empty-icon"><FileText size={30} /></div>
        <h2>Your review history will live here</h2>
        <p>
          Completed reviews, revisions, and approval decisions can be collected
          here as persistent review history is implemented.
        </p>
        <span className="demo-badge">HISTORY NOT CONNECTED YET</span>
      </section>

      <div className="info-card">
        <ArrowUpRight size={20} />
        <div>
          <h3>Built for traceable reviews</h3>
          <p className="muted">
            The intended workflow records what changed, why it changed,
            and who made the final approval decision.
          </p>
        </div>
      </div>
    </div>
  );
}