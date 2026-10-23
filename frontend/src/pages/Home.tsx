
import { useRef, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Image,
  ShieldCheck,
  Sparkles,
  Upload,
  Files,
  X,
} from "lucide-react";

type ContentType = "Written content" | "Visual creative" | "Other";

type ImportedFile = {
  file: File;
  type: ContentType;
};

type HomeProps = {
  content: string;
  setContent: (value: string) => void;
  onReview: () => void;
};

export default function Home({
  content,
  setContent,
  onReview,
}: HomeProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"text" | "visual" | "bulk">("text");
  const [files, setFiles] = useState<ImportedFile[]>([]);

  function detectType(file: File): ContentType {
    if (file.type.startsWith("image/")) {
      return "Visual creative";
    }

    if (
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|json)$/i.test(file.name)
    ) {
    return "Written content";
    }

    return "Other";
  }

  function addFiles(selectedFiles: FileList | null) {
    if (!selectedFiles) return;

    const newFiles = Array.from(selectedFiles).map((file) => ({
      file,
      type: detectType(file),
    }));

    setFiles((current) => [...current, ...newFiles]);
  }

  function updateFileType(index: number, type: ContentType) {
    setFiles((current) =>
      current.map((item, i) => (i === index ? { ...item, type } : item)),
    );
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  function chooseMode(nextMode: "text" | "visual" | "bulk") {
    setMode(nextMode);

    if (nextMode === "text") {
      setContent("");
    }

    if (nextMode === "visual" || nextMode === "bulk") {
      fileInput.current?.click();
    }
  }

  return (
    <div className="page home-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">YOUR BRAND, PROTECTED</p>
          <h1>Make every detail count.</h1>
          <p>Review your content. Protect the consistency.</p>
        </div>
        <ShieldCheck size={36} />
      </section>

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">YOUR REVIEW SPACE</p>
          <h2>Before it reaches the world, make sure it represents you.</h2>
          <p>
            Bring your content together and check it against your brand
            guidelines before publication.
          </p>
          <button
            className="primary-button"
            onClick={() =>
              document.getElementById("content-input")?.focus()
            }
          >
            Start a review <ArrowUpRight size={17} />
          </button>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-sheet">
            <Sparkles size={22} />
            <div className="visual-line" />
            <div className="visual-line short" />
            <div className="visual-check">
              <ShieldCheck size={25} />
              Brand check
            </div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GET STARTED</p>
            <h2>What are we reviewing?</h2>
          </div>
        </div>

        <div className="content-type-grid">
          <button
            className={`content-type-card ${mode === "text" ? "selected" : ""}`}
            onClick={() => chooseMode("text")}
          >
            <FileText size={24} />
            <span>Written content</span>
            <small>Posts, captions, emails and articles</small>
            <ArrowUpRight size={17} />
          </button>

          <button
            className={`content-type-card ${mode === "visual" ? "selected" : ""}`}
            onClick={() => chooseMode("visual")}
          >
            <Image size={24} />
            <span>Visual creative</span>
            <small>Images, banners and campaign creatives</small>
            <ArrowUpRight size={17} />
          </button>

          <button
            className={`content-type-card ${mode === "bulk" ? "selected" : ""}`}
            onClick={() => chooseMode("bulk")}
          >
            <Files size={24} />
            <span>Bulk import</span>
            <small>Select multiple files and organize them together</small>
            <ArrowUpRight size={17} />
          </button>
        </div>
      </section>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif"
        hidden
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {mode === "text" ? (
        <section className="input-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR CONTENT</p>
              <h2>Bring your content</h2>
            </div>
            <FileText size={22} />
          </div>

          <textarea
            id="content-input"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste your post, caption, email or other written content here..."
            rows={7}
          />

          <div className="input-footer">
            <small>{content.length} characters</small>
            <button
              className="primary-button"
              onClick={onReview}
              disabled={!content.trim()}
            >
              Review content <ArrowUpRight size={17} />
            </button>
          </div>
        </section>
      ) : (
        <section className="input-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {mode === "bulk" ? "BATCH INTAKE" : "VISUAL INTAKE"}
              </p>
              <h2>
                {mode === "bulk"
                  ? "Organize your content batch"
                  : "Add visual creative"}
              </h2>
            </div>
            <Upload size={22} />
          </div>

          <button
            className="primary-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} /> Choose files
          </button>

          <p className="prototype-note">
            File types are suggested from their formats. You can change each
            classification. Content inside files is not analyzed yet.
          </p>

          {files.length > 0 && (
            <div className="imported-files">
              <div className="section-heading">
                <h3>Selected files ({files.length})</h3>
                <button
                  className="text-button"
                  onClick={() => setFiles([])}
                >
                  Clear all
                </button>
              </div>

              {files.map((item, index) => (
                <div className="imported-file" key={`${item.file.name}-${index}`}>
                  <div className="imported-file-info">
                    {item.type === "Visual creative" ? (
                      <Image size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                    <div>
                      <strong>{item.file.name}</strong>
                      <small>
                        {(item.file.size / 1024).toFixed(1)} KB
                      </small>
                    </div>
                  </div>

                  <select
                    aria-label={`Category for ${item.file.name}`}
                    value={item.type}
                    onChange={(event) =>
                      updateFileType(index, event.target.value as ContentType)
                    }
                  >
                    <option>Written content</option>
                    <option>Visual creative</option>
                    <option>Other</option>
                  </select>

                  <button
                    className="icon-button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeFile(index)}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="prototype-note">
        This prototype currently demonstrates content intake. Real brand
        checks, source connections and file-content analysis are not connected
        yet.
      </p>
    </div>
  );
}
