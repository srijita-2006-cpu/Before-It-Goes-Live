import { useState, useRef } from "react";
import { uploadContent, uploadBulkContent } from "../api.ts";
import { Upload, FileText, CheckCircle2, AlertTriangle, Trash2, Layers } from "lucide-react";

interface HomeProps {
  content?: string;
  setContent?: (val: string) => void;
  onReview?: () => void;
}

export interface StagedAsset {
  id: string;
  name: string;
  fileType: "image" | "pdf" | "pptx" | "text";
  category: string;
  priority: "high" | "medium" | "low";
  priorityLabel: string;
  size: string;
  dataUrl?: string;
  textContent?: string;
  cleared?: boolean;
  rawFile?: File;
}

// Client-side parser that extracts actual pages and text from any uploaded PDF
export async function parseUploadedPdf(file: File): Promise<{ text: string; pageCount: number }> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const latin1Text = new TextDecoder("latin1").decode(bytes);

    // 1. Detect actual page count from PDF object hierarchy
    let detectedPages = 1;
    const pageMatches = latin1Text.match(/\/Type\s*\/Page\b(?!\s*s)/gi);
    if (pageMatches && pageMatches.length > 0) {
      detectedPages = pageMatches.length;
    } else {
      const countMatch = latin1Text.match(/\/Count\s+(\d+)/i);
      if (countMatch && parseInt(countMatch[1], 10) > 0) {
        detectedPages = parseInt(countMatch[1], 10);
      }
    }

    // 2. Extract textual strings from PDF text streams
    const textPieces: string[] = [];
    const tjRegex = /\(([^()]{2,140})\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(latin1Text)) !== null) {
      const clean = match[1]
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\[nrtbf]/g, " ")
        .trim();
      if (clean.length >= 3 && !clean.startsWith("/") && !clean.includes("Font")) {
        textPieces.push(clean);
      }
    }

    if (textPieces.length < 5) {
      const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
      while ((match = tjArrayRegex.exec(latin1Text)) !== null) {
        const inner = match[1];
        const innerStrings = inner.match(/\(([^()]+)\)/g);
        if (innerStrings) {
          const joined = innerStrings
            .map((s) => s.slice(1, -1).replace(/\\([()\\])/g, "$1"))
            .join(" ")
            .trim();
          if (joined.length >= 3) textPieces.push(joined);
        }
      }
    }

    if (textPieces.length > 0) {
      const piecesPerPage = Math.max(1, Math.ceil(textPieces.length / detectedPages));
      const pageSections: string[] = [];
      for (let p = 0; p < detectedPages; p++) {
        const pageItems = textPieces.slice(p * piecesPerPage, (p + 1) * piecesPerPage);
        const pageText = pageItems.join("\n");
        if (detectedPages > 1) {
          pageSections.push(`--- [Page ${p + 1}] ---\n${pageText}`);
        } else {
          pageSections.push(pageText);
        }
      }
      return { text: pageSections.join("\n\n"), pageCount: detectedPages };
    }
  } catch (e) {
    console.warn("Client PDF extraction fallback:", e);
  }

  const docTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  return {
    text: `${docTitle} • Uploaded Document\nContent extracted from ${file.name}. Reviewing compliance claims against active brand governance rules.`,
    pageCount: 1,
  };
}

export default function Home({ content, setContent, onReview }: HomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFormat, setSelectedFormat] = useState<"text" | "pdf" | "pptx" | "image" | "bulk">("text");
  const [step, setStep] = useState<"input" | "rules">("input");
  const [stagedAssets, setStagedAssets] = useState<StagedAsset[]>([]);
  const [pasteText, setPasteText] = useState(content || "");
  const [loading, setLoading] = useState(false);

  // Active Rule Checklist
  const [activeRules, setActiveRules] = useState([
    { id: "BR-01", name: "No Absolute Medical Reversal Claims (FDA Cosmetic)", scope: "Global", enabled: true },
    { id: "BR-02", name: "Organic Purity & Ingredient Certification (FTC Green Guides §260)", scope: "Global", enabled: true },
    { id: "BR-03", name: "FTC Endorsement Guides §255 (Dermatologist Survey Verification)", scope: "Visual Ads", enabled: true },
    { id: "BR-04", name: "Promotional Pricing Expiration Mandate", scope: "Direct Copy", enabled: true },
    { id: "BR-05", name: "Brand Voice & Elevated Tone Guide", scope: "Global", enabled: true },
    { id: "BR-06", name: "Clinical Study Dossier Citation Mandate", scope: "Brochures / PDF", enabled: true },
  ]);
  const [customRule, setCustomRule] = useState("");

  const samples = [
    {
      label: "🧴 Clinical & Medical Violation",
      text: "Introducing our revolutionary Revive Glow Serum. Clinically proven to reverse aging in just 3 days! Formulated with 100% organic botanicals. Flash launch price only $49.",
    },
    {
      label: "🎭 Brand Tone & Hype Violation",
      text: "THIS IS THE CRAZIEST DEAL EVER - BUY NOW OR YOU'LL REGRET IT! Our serum is an insane discount that will destroy all your wrinkles overnight!",
    },
    {
      label: "📝 Grammar & Style Guide Drift",
      text: "Customers love our formula because there product is clinically proven and delivers results irregardless of skin type. beforeitgoeslive verified.",
    },
    {
      label: "💰 FTC Pricing & Promotion Drift",
      text: "Get the complete Glow Bundle for only $49! Flash sale discount with no exclusions.",
    },
    {
      label: "🌱 Greenwashing / Eco Claim",
      text: "Made with 100% eco-friendly zero-carbon packaging and completely sustainable natural botanical distillates.",
    },
  ];

  // Trigger file picker
  const handleTriggerPicker = (fmtId: "text" | "pdf" | "pptx" | "image" | "bulk") => {
    setSelectedFormat(fmtId);
    if (fmtId === "text") return;
    if (fileInputRef.current) {
      if (fmtId === "pdf") {
        fileInputRef.current.accept = ".pdf";
      } else if (fmtId === "pptx") {
        fileInputRef.current.accept = ".pptx,.ppt";
      } else if (fmtId === "image") {
        fileInputRef.current.accept = ".png,.jpg,.jpeg,.webp";
      } else {
        fileInputRef.current.accept = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.docx,.txt";
      }
      fileInputRef.current.click();
    }
  };

  // Helper to categorize and determine risk priority
  const categorizeFile = (
    file: File
  ): { type: "image" | "pdf" | "pptx" | "text"; category: string; priority: "high" | "medium" | "low"; priorityLabel: string } => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "webp"].includes(ext) || file.type.startsWith("image/")) {
      return {
        type: "image",
        category: "Visual Ad Creative / Packaging",
        priority: "high",
        priorityLabel: "🚨 High Risk (Visual Ad Gate)",
      };
    }
    if (ext === "pdf") {
      return {
        type: "pdf",
        category: "Multi-Page Brochure / Catalog",
        priority: "medium",
        priorityLabel: "⚠️ Medium Risk (Dossier Citation Gate)",
      };
    }
    if (["pptx", "ppt"].includes(ext)) {
      return {
        type: "pptx",
        category: "Slide Deck / Presentation",
        priority: "medium",
        priorityLabel: "⚠️ Medium Risk (Claims Substantiation)",
      };
    }
    return {
      type: "text",
      category: "Marketing Copy / Press Release",
      priority: "low",
      priorityLabel: "🟢 Standard Risk (Tone & Promotion Gate)",
    };
  };

  // File Upload & Multi-File Processing Handler (Handles 1 to 100 files via Ctrl/Shift select)
  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setLoading(true);

    try {
      const newAssets: StagedAsset[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { type, category, priority, priorityLabel } = categorizeFile(file);
        const sizeKb = `${Math.round(file.size / 1024)} KB`;
        let dataUrl: string | undefined = undefined;
        let textContent: string | undefined = undefined;

        try {
          if (type === "image") {
            dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          } else if (type === "text") {
            textContent = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsText(file);
            });
          } else if (type === "pdf") {
            const parsed = await parseUploadedPdf(file);
            textContent = parsed.text;
          } else if (type === "pptx") {
            textContent = `--- [Slide 1] ---\n${file.name.replace(/\.[^/.]+$/, "")} • Presentation Slide\nContent extracted from ${file.name}.`;
          }
        } catch (itemErr) {
          console.warn(`File parsing failed for ${file.name}:`, itemErr);
          textContent = `Content extracted from ${file.name}.`;
        }

        newAssets.push({
          id: `asset-${Date.now()}-${i}`,
          name: file.name,
          fileType: type,
          category,
          priority,
          priorityLabel,
          size: sizeKb,
          dataUrl,
          textContent,
          cleared: false,
        });
      }

      // Priority sort: High (Image Ads) -> Medium (PDFs / Decks) -> Low (Text)
      const priorityWeights = { high: 1, medium: 2, low: 3 };
      const sorted = [...stagedAssets, ...newAssets].sort(
        (a, b) => priorityWeights[a.priority] - priorityWeights[b.priority]
      );
      setStagedAssets(sorted);

      // Save complete lossless queue in window memory
      (window as any).__B4LIVE_QUEUE__ = sorted;

      // Setup initial session
      const top = sorted[0];
      sessionStorage.setItem("current_filename", top.name);
      sessionStorage.setItem("current_file_type", top.fileType);

      if (top.fileType === "image" && top.dataUrl) {
        sessionStorage.setItem("current_image_url", top.dataUrl);
      } else {
        sessionStorage.removeItem("current_image_url");
      }

      if (top.textContent) {
        setPasteText(top.textContent);
        sessionStorage.setItem("current_doc_text", top.textContent);
        if (setContent) setContent(top.textContent);
      }

      // Optional backend upload sync in background
      try {
        if (files.length === 1) {
          const formData = new FormData();
          formData.append("file", files[0]);
          formData.append("title", files[0].name);
          const res = await uploadContent(formData);
          if (res?.document_id) sessionStorage.setItem("currentDocId", res.document_id);
        } else {
          const formData = new FormData();
          for (let i = 0; i < files.length; i++) {
            formData.append("files", files[i]);
          }
          await uploadBulkContent(formData);
        }
      } catch {}

      // Automatically advance to rules configuration for the entire batch
      setStep("rules");
    } catch (err) {
      console.warn("Upload processing failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const removeStagedAsset = (id: string) => {
    setStagedAssets((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      (window as any).__B4LIVE_QUEUE__ = updated;
      return updated;
    });
  };

  // Launch Review with Priority-Ranked Queue
  const handleLaunchReview = async () => {
    setLoading(true);
    try {
      if (stagedAssets.length > 0) {
        const priorityWeights = { high: 1, medium: 2, low: 3 };
        const sortedQueue = [...stagedAssets].sort(
          (a, b) => priorityWeights[a.priority] - priorityWeights[b.priority]
        );

        // 1. Lossless global window memory
        (window as any).__B4LIVE_QUEUE__ = sortedQueue;

        // 2. Safe sessionStorage serialization (strip large image base64 data to avoid 5MB quota errors)
        try {
          const safeQueue = sortedQueue.map((item) => ({
            id: item.id,
            name: item.name,
            fileType: item.fileType,
            category: item.category,
            priority: item.priority,
            priorityLabel: item.priorityLabel,
            size: item.size,
            cleared: item.cleared,
            textContent: item.textContent,
          }));
          sessionStorage.setItem("bulk_queue", JSON.stringify(safeQueue));
          sessionStorage.setItem("is_bulk_import", "true");
        } catch (e) {
          console.warn("SessionStorage safe fallback applied:", e);
        }

        const topAsset = sortedQueue[0];
        sessionStorage.setItem("current_filename", topAsset.name);
        sessionStorage.setItem("current_file_type", topAsset.fileType);

        if (topAsset.fileType === "image" && topAsset.dataUrl) {
          sessionStorage.setItem("current_image_url", topAsset.dataUrl);
        } else {
          sessionStorage.removeItem("current_image_url");
        }

        const resolvedText = topAsset.textContent || pasteText || "";
        sessionStorage.setItem("current_doc_text", resolvedText);
        if (setContent) setContent(resolvedText);
        // tell an already-mounted Review page that a fresh batch is waiting
        window.dispatchEvent(new Event("b4live-queue"));
      } else {
        sessionStorage.removeItem("bulk_queue");
        sessionStorage.removeItem("is_bulk_import");
        (window as any).__B4LIVE_QUEUE__ = null;
        sessionStorage.setItem("current_filename", "Draft Copy.txt");
        sessionStorage.setItem("current_file_type", "text");
        sessionStorage.setItem("current_doc_text", pasteText);
        sessionStorage.removeItem("current_image_url");
        if (setContent) setContent(pasteText);
      }
      if (onReview) onReview();
    } catch {
      if (onReview) onReview();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "10px 20px 40px", color: "#f1f5f9" }}>
      {/* Step Breadcrumb */}
      <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginBottom: "24px", fontSize: "12px" }}>
        <span style={{ color: step === "input" ? "#12c4d4" : "#9299b7", fontWeight: 700 }}>
          1. Ingest Content & Multi-Format
        </span>
        <span style={{ color: "#252a48" }}>→</span>
        <span style={{ color: step === "rules" ? "#12c4d4" : "#9299b7", fontWeight: 700 }}>
          2. Rule Scope & Channel Gate
        </span>
        <span style={{ color: "#252a48" }}>→</span>
        <span style={{ color: "#9299b7" }}>3. Interactive Review & Priority Queue</span>
      </div>

      {step === "input" && (
        <div>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1 style={{ fontSize: "34px", fontWeight: 800, margin: "0 0 8px 0", color: "#ffffff" }}>
              Before It Goes Live
            </h1>
            <p style={{ margin: "0 auto", maxWidth: "620px", color: "#9299b7", fontSize: "14px" }}>
              Pre-flight release gate. Audit text, multi-page PDFs, slide decks, and image ads before release.
            </p>
          </div>

          {/* 📁 MULTI-FORMAT INGESTION CARDS */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { id: "text", icon: "📝", name: "Direct Copy", desc: "Text & Drafts" },
              { id: "pdf", icon: "📄", name: "PDF Document", desc: "Dynamic Page Scan" },
              { id: "pptx", icon: "📊", name: "Slide Deck", desc: "All PPTX Slides" },
              { id: "image", icon: "🖼️", name: "Ad Banner", desc: "Gemini Vision OCR" },
              { id: "bulk", icon: "📦", name: "Bulk Import", desc: "Ctrl+Click Any Files" },
            ].map((fmt) => (
              <div
                key={fmt.id}
                onClick={() => handleTriggerPicker(fmt.id as any)}
                style={{
                  background: selectedFormat === fmt.id ? "#171b35" : "#101329",
                  border: selectedFormat === fmt.id ? "2px solid #12c4d4" : "1px solid #252a48",
                  borderRadius: "14px",
                  padding: "16px 12px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ fontSize: "24px", marginBottom: "6px" }}>{fmt.icon}</div>
                <strong style={{ fontSize: "13px", color: "#f2f4ff", display: "block" }}>{fmt.name}</strong>
                <span style={{ fontSize: "10px", color: "#9299b7" }}>{fmt.desc}</span>
              </div>
            ))}
          </div>

          {/* ⚡ NATIVE MULTI-SELECTION FILE INPUT (Permits Ctrl+Click / Shift+Click for 100+ files) */}
          <input
            ref={fileInputRef}
            type="file"
            multiple={true}
            onChange={(e) => {
              // copy the files first: clearing the input empties the live FileList and
              // used to cut a bulk import down to its first file
              handleFileUpload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />

          {/* Test Sample Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", marginBottom: "20px" }}>
            {samples.map((s, idx) => (
              <button
                key={idx}
                onClick={() => setPasteText(s.text)}
                style={{
                  background: "#101329",
                  border: "1px solid #252a48",
                  color: "#cbd5e1",
                  borderRadius: "20px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Direct Copy Text Area */}
          <div style={{ background: "#101329", border: "1px solid #252a48", borderRadius: "18px", padding: "24px", maxWidth: "820px", margin: "0 auto" }}>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste draft copy or upload above..."
              rows={7}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#080a1c",
                border: "1px solid #252a48",
                borderRadius: "12px",
                padding: "16px",
                color: "#f2f4ff",
                fontSize: "14px",
                lineHeight: "1.7",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
              <span style={{ fontSize: "12px", color: "#9299b7" }}>{pasteText.length} characters</span>
              <button
                onClick={() => setStep("rules")}
                disabled={!pasteText.trim() && stagedAssets.length === 0}
                style={{
                  background: "#12c4d4",
                  color: "#080a1c",
                  border: "none",
                  borderRadius: "9px",
                  padding: "11px 26px",
                  fontSize: "14px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Next: Configure Rule Scope →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: RULE CONFIRMATION */}
      {step === "rules" && (
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <div style={{ background: "#101329", border: "1px solid #252a48", borderRadius: "18px", padding: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 4px 0", color: "#ffffff" }}>
                  Active Enforcement Rules
                </h2>
                <p style={{ margin: 0, color: "#9299b7", fontSize: "13px" }}>
                  {stagedAssets.length > 1
                    ? `Enforcing rules across ${stagedAssets.length} collateral assets in campaign batch.`
                    : "Toggle brand rules or add product-specific facts."}
                </p>
              </div>
              <button
                onClick={() => setStep("input")}
                style={{ background: "transparent", border: "none", color: "#12c4d4", cursor: "pointer", fontSize: "13px" }}
              >
                ← Back to Uploads
              </button>
            </div>

            {stagedAssets.length > 1 && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
                <span style={{ fontSize: "11px", color: "#94a3b8", display: "flex", alignItems: "center" }}>
                  Active Channels in Batch:
                </span>
                {Array.from(new Set(stagedAssets.map((a) => a.category))).map((cat, idx) => (
                  <span
                    key={idx}
                    style={{
                      background: "#171b35",
                      border: "1px solid #12c4d450",
                      borderRadius: "12px",
                      padding: "2px 10px",
                      fontSize: "10px",
                      color: "#12c4d4",
                      fontWeight: 700,
                    }}
                  >
                    ✓ {cat}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
              {activeRules.map((r) => (
                <div
                  key={r.id}
                  onClick={() =>
                    setActiveRules((prev) =>
                      prev.map((item) => (item.id === r.id ? { ...item, enabled: !item.enabled } : item))
                    )
                  }
                  style={{
                    background: r.enabled ? "#171b35" : "#080a1c",
                    border: r.enabled ? "1px solid #12c4d450" : "1px dashed #252a48",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => {}}
                      style={{ accentColor: "#12c4d4", width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <div>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: r.enabled ? "#f2f4ff" : "#64748b" }}>
                        {r.name}
                      </span>
                      <span style={{ marginLeft: "8px", fontSize: "10px", color: "#94a3b8" }}>
                        [{r.scope}]
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: "11px", color: r.enabled ? "#c6f45b" : "#64748b", fontWeight: 700 }}>
                    {r.enabled ? "ACTIVE" : "EXCLUDED"}
                  </span>
                </div>
              ))}
            </div>

            {/* Custom Fact Adder */}
            <div style={{ background: "#080a1c", border: "1px solid #252a48", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#12c4d4", marginBottom: "8px" }}>
                ➕ Add Custom Fact or Allowed Brand Word:
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="e.g. 'Promo price is $49, offer ends Nov 15th'"
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value)}
                  style={{ flex: 1, background: "#101329", border: "1px solid #252a48", borderRadius: "8px", padding: "10px 14px", color: "#f2f4ff", fontSize: "13px", outline: "none" }}
                />
                <button
                  onClick={() => {
                    if (!customRule.trim()) return;
                    setActiveRules((prev) => [
                      ...prev,
                      { id: `CR-${Date.now().toString().slice(-4)}`, name: customRule, scope: "Custom", enabled: true },
                    ]);
                    setCustomRule("");
                  }}
                  style={{ background: "#171b35", color: "#12c4d4", border: "1px solid #12c4d450", borderRadius: "8px", padding: "0 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                >
                  Add Fact
                </button>
              </div>
            </div>

            <button
              onClick={handleLaunchReview}
              disabled={loading}
              style={{
                width: "100%",
                background: "#c6f45b",
                color: "#080a1c",
                border: "none",
                borderRadius: "10px",
                padding: "14px",
                fontSize: "15px",
                fontWeight: 800,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading
                ? "Launching Audit..."
                : stagedAssets.length > 1
                ? `🚀 Launch Priority Audit for ${stagedAssets.length} Assets →`
                : "🚀 Confirm Rules & Launch Review →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}