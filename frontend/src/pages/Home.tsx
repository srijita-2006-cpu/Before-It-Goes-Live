import {
  ArrowUpRight,
  FileText,
  Image,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";

type Props = {
  content: string;
  setContent: (value: string) => void;
  onReview: () => void;
};

export default function Home({
  content,
  setContent,
  onReview,
}: Props) {
  return (
    <div className="page home-page">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">YOUR BRAND, PROTECTED</p>
          <h1>Make every detail <span>count.</span></h1>
          <p className="muted">
            Review the content. Protect the consistency.
          </p>
        </div>
        <div className="welcome-icon">
          <ShieldCheck size={30} />
        </div>
      </div>

      <section className="hero-card">
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />

        <div className="hero-content">
          <span className="pill"><Sparkles size={13} /> YOUR REVIEW SPACE</span>
          <h2>Before it reaches the world, make sure it represents you.</h2>
          <p>
            Check messaging, approved claims, terminology, and visual brand
            consistency in one review experience.
          </p>
          <button
            className="primary-button"
            onClick={() => document.getElementById("content-input")?.focus()}
          >
            Start a review <ArrowUpRight size={17} />
          </button>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-sheet">
            <div className="sheet-top"><span /><span /><span /></div>
            <div className="sheet-art">
              <div className="sheet-sun" />
              <div className="sheet-line" />
              <div className="sheet-line short" />
              <div className="sheet-highlight">Brand check</div>
            </div>
            <div className="sheet-check"><ShieldCheck size={21} /></div>
          </div>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <p className="eyebrow">GET STARTED</p>
          <h2>What are we reviewing?</h2>
        </div>
      </div>

      <div className="content-types">
        <button className="type-card" onClick={() => {
          setContent("");
          document.getElementById("content-input")?.focus();
        }}>
          <span className="type-icon cyan"><FileText size={21} /></span>
          <strong>Written content</strong>
          <span>Copy, captions, claims</span>
        </button>
        <button className="type-card" onClick={() => {
          setContent("");
          document.getElementById("content-input")?.focus();
        }}>
          <span className="type-icon lime"><Image size={21} /></span>
          <strong>Visual creative</strong>
          <span>Posters, ads, designs</span>
        </button>
      </div>

      <section className="input-panel">
        <div className="panel-title">
          <span className="type-icon violet"><Upload size={19} /></span>
          <div>
            <h3>Bring your content</h3>
            <p className="muted">Paste a draft to start exploring the review.</p>
          </div>
        </div>

        <textarea
          id="content-input"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Paste your campaign copy, product description, or brand message..."
          rows={4}
        />

        <div className="input-footer">
          <span className="muted">{content.length} characters</span>
          <button
            className="primary-button"
            onClick={onReview}
            disabled={!content.trim()}
          >
            Review content <ArrowUpRight size={16} />
          </button>
        </div>
      </section>

      <p className="prototype-note">
        <ShieldCheck size={15} /> This prototype uses illustrative review
        findings. Real AI analysis and brand-source connections come next.
      </p>
    </div>
  );
}