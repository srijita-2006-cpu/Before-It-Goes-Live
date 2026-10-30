import { useState, useRef, useEffect } from "react";
import {
  API_BASE,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARACTERS,
  uploadContent,
  uploadBulkContent,
  getBulkCapacity,
  getBulkJob,
} from "../api.ts";
import ConfigureRules from "../components/ConfigureRules.tsx";

interface HomeProps {
  content?: string;
  setContent?: (val: string) => void;
  onReview?: () => void;
  onAssetChange?: (asset: { name: string; fileType: string }) => void;
  onShowAssetNotice?: () => void;
}

export interface StagedAsset {
  id: string;
  name: string;
  fileType: "image" | "pdf" | "pptx" | "text" | "docx" | "unsupported";
  category: string;
  priority: "high" | "medium" | "low";
  priorityLabel: string;
  size: string;
  dataUrl?: string;
  textContent?: string;
  findings?: any[];
  headline?: string;
  auditStatus?: string;
  riskLevel?: string;
  errorMessage?: string;
  cleared?: boolean;
  rawFile?: File;
}

export async function parseUploadedPdf(
  file: File
): Promise<{ text: string; pageCount: number }> {
  // PDF extraction is performed by the backend, which can handle compressed
  // streams and preserve real page text. Never label guessed text as extracted.
  throw new Error(
    `Text extraction for ${file.name} must be completed by the backend. Upload the PDF to continue.`
  );
}

export default function Home({
  content,
  setContent,
  onReview,
  onAssetChange,
  onShowAssetNotice,
}: HomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const [selectedFormat, setSelectedFormat] = useState<
    "text" | "pdf" | "pptx" | "image" | "bulk"
  >("text");
  const [step, setStep] = useState<"input" | "rules">(() => {
    return (localStorage.getItem("b4live_home_step") as "input" | "rules") || "input";
  });
  const [stagedAssets, setStagedAssets] = useState<StagedAsset[]>(() => {
    try {
      const saved = localStorage.getItem("b4live_staged_assets");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [pasteText, setPasteText] = useState(() => {
    return localStorage.getItem("b4live_content") || content || "";
  });

  useEffect(() => {
    localStorage.setItem("b4live_home_step", step);
  }, [step]);

  useEffect(() => {
    try {
      const serializable = stagedAssets.map(({ rawFile, ...rest }) => rest);
      localStorage.setItem("b4live_staged_assets", JSON.stringify(serializable));
    } catch {
      // ignore
    }
  }, [stagedAssets]);

  useEffect(() => {
    localStorage.setItem("b4live_content", pasteText);
    setContent?.(pasteText);
  }, [pasteText, setContent]);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pendingBatchJobId, setPendingBatchJobId] = useState(
    () => sessionStorage.getItem("bulk_job_id") || ""
  );

  const samples = [
    {
      label: "🥤 Cold Drinks Ad Violation",
      text: "New Arctic Surge Cola! Guaranteed 100% natural mountain water. Scientifically proven to incinerate body fat and boost metabolism in 3 days! Unbeatable #1 soda worldwide.",
    },
    {
      label: "⚖️ Law Firm Ad Violation",
      text: "Smith & Associates Injury Law. We guarantee you win your settlement or pay $0! Voted the #1 personal injury attorneys in America with 100% success rate on all cases.",
    },
    {
      label: "🧴 Cosmetic Brand Violation",
      text: "Revive Glow Serum. Clinically formulated to reverse aging in 7 days! 100% organic botanicals. Flash promo price only $49.",
    },
    {
      label: "💻 Tech / SaaS Guarantee",
      text: "Our AI platform guarantees 100% uptime with zero errors and outperforms every competitor on the market permanently.",
    },
  ];

  const handleTriggerPicker = (
    fmtId: "text" | "pdf" | "pptx" | "image" | "bulk"
  ) => {
    setSelectedFormat(fmtId);
    if (fmtId === "text") return;
    if (fileInputRef.current) {
      if (fmtId === "pdf") fileInputRef.current.accept = ".pdf";
      else if (fmtId === "pptx") fileInputRef.current.accept = ".pptx";
      else if (fmtId === "image")
        fileInputRef.current.accept =
          ".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff";
      else
        fileInputRef.current.accept =
          ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.docx,.txt,.md,.csv,.zip";
      fileInputRef.current.click();
    }
  };

  const categorizeFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (
      ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext) ||
      file.type.startsWith("image/")
    ) {
      return {
        type: "image" as const,
        category: "Visual Creative Ad / Packaging",
        priority: "high" as const,
        priorityLabel: "🚨 High Risk (Visual Gate)",
      };
    }
    if (ext === "pdf") {
      return {
        type: "pdf" as const,
        category: "Multi-Page Brochure / Dossier",
        priority: "medium" as const,
        priorityLabel: "⚠️ Medium Risk (Citation Gate)",
      };
    }
    if (ext === "pptx") {
      return {
        type: "pptx" as const,
        category: "Slide Deck / Presentation",
        priority: "medium" as const,
        priorityLabel: "⚠️ Medium Risk (Substantiation)",
      };
    }
    if (ext === "docx") {
      return {
        type: "docx" as const,
        category: "Document / Brief",
        priority: "medium" as const,
        priorityLabel: "⚠️ Medium Risk (Review)",
      };
    }
    if (ext === "zip") {
      return {
        type: "text" as const,
        category: "Campaign Bundle (ZIP)",
        priority: "high" as const,
        priorityLabel: "🚨 Campaign Bundle",
      };
    }
    return {
      type: "text" as const,
      category: "Marketing Copy / Press Release",
      priority: "low" as const,
      priorityLabel: "🟢 Standard Risk (Tone Gate)",
    };
  };

  const stageBulkResult = (jobResult: any): StagedAsset[] | false => {
    const rows = Array.isArray(jobResult?.files) ? jobResult.files : [];
    const failedRows = rows.filter((row: any) => row.status !== "processed" || !row.document_id);
    const readyRows = rows.filter((row: any) => row.status === "processed" && row.document_id);
    if (!readyRows.length) {
      const reasons = failedRows.map((row: any) => `${row.original_filename}: ${row.error_message || row.status}`).join("; ");
      setUploadError(`No uploaded assets could be prepared for review.${reasons ? ` ${reasons}` : " Check the batch status and retry with supported files."}`);
      return false;
    }

    const assets: StagedAsset[] = readyRows.map((row: any) => {
      const type = row.file_type as StagedAsset["fileType"];
      let findings: any[];
      try {
        findings = JSON.parse(row.findings_json);
      } catch {
        throw new Error(`The backend returned invalid finding data for ${row.original_filename}. Retry checking the saved batch status.`);
      }
      if (!Array.isArray(findings)) {
        throw new Error(`The backend returned an invalid findings list for ${row.original_filename}. Retry checking the saved batch status.`);
      }
      const categoryByType: Record<string, string> = {
        image: "Visual Creative Ad / Packaging",
        pdf: "Multi-Page Brochure / Dossier",
        pptx: "Slide Deck / Presentation",
        docx: "Corporate Copy / Document",
        text: "Plain Text Copy / Markdown",
      };
      const priority = type === "image" ? "high" : type === "text" ? "low" : "medium";
      return {
        id: row.document_id,
        name: row.original_filename,
        fileType: type,
        category: categoryByType[type] || "Uploaded Asset",
        priority,
        priorityLabel: priority === "high" ? "High priority" : priority === "medium" ? "Review" : "Standard review",
        size: "Uploaded",
        dataUrl: type === "image" ? `${API_BASE}/api/bulk/file/${encodeURIComponent(row.id)}` : undefined,
        textContent: row.text_content || "",
        findings,
        headline: row.headline || "",
        auditStatus: row.audit_status || "Incomplete Analysis",
        riskLevel: row.risk_level || "Analysis Incomplete",
        errorMessage: row.error_message || "",
        cleared: false,
      };
    });

    setStagedAssets(assets);
    (window as any).__B4LIVE_QUEUE__ = assets;
    onAssetChange?.({ name: assets[0].name, fileType: assets[0].fileType });
    setStep("rules");
    const incompleteRows = readyRows.filter((row: any) => row.audit_status === "Incomplete Analysis" || row.audit_status === "Analysis Incomplete");
    const messages = [
      ...(failedRows.length ? [`Files not processed: ${failedRows.map((row: any) => `${row.original_filename} (${row.error_message || row.status})`).join(", ")}.`] : []),
      ...(incompleteRows.length ? [`Analysis is incomplete for: ${incompleteRows.map((row: any) => `${row.original_filename}${row.error_message ? ` — ${row.error_message}` : ""}`).join("; ")}. Do not treat these assets as cleared.`] : []),
    ];
    setUploadError(messages.join(" "));
    sessionStorage.removeItem("bulk_job_id");
    setPendingBatchJobId("");
    return assets;
  };

  const checkPendingBatchStatus = async () => {
    if (!pendingBatchJobId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await getBulkJob(pendingBatchJobId);
      if (result?.job?.status !== "completed") {
        setUploadError(`Batch ${pendingBatchJobId} is still processing (${result?.job?.processed_files || 0} of ${result?.job?.total_files || 0} files). Check again shortly; do not re-upload the same batch.`);
        return;
      }
      stageBulkResult(result);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not check the batch status. The server job may still be running; retry this status check.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    if (loadingRef.current) return;
    const isBatch = files.length > 1 || files.some((file) => file.name.toLowerCase().endsWith(".zip"));
    if (files.length > MAX_BATCH_FILES) {
      setUploadError(`A batch can contain at most ${MAX_BATCH_FILES} files. Split the selection and retry.`);
      return;
    }
    if (files.some((file) => file.size === 0)) {
      setUploadError("One or more selected files are empty. Choose non-empty files and retry.");
      return;
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES && !file.name.toLowerCase().endsWith(".zip"))) {
      setUploadError("Each file must be 20 MiB or smaller. Choose smaller files and retry.");
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
      setUploadError("The batch exceeds 50 MiB. Split it into smaller batches and retry.");
      return;
    }
    const supportedExtensions = new Set([
      "pdf", "pptx", "docx", "txt", "md", "csv",
      "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff",
    ]);
    const unsupported = files.filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      return extension === "zip" ? !isBatch : !supportedExtensions.has(extension);
    });
    if (unsupported.length) {
      setUploadError(`Unsupported file type: ${unsupported.map((file) => file.name).join(", ")}. Choose PDF, PPTX, DOCX, TXT, MD, CSV, or a supported image.`);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setUploadError("");

    try {
      const isBatch = files.length > 1 || files.some((file) => file.name.toLowerCase().endsWith(".zip"));
      if (isBatch) {
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > MAX_BATCH_BYTES) {
          throw new Error(`Selected files exceed the ${Math.round(MAX_BATCH_BYTES / (1024 * 1024))} MiB batch limit.`);
        }
        for (const file of files) {
          if (!file.name.toLowerCase().endsWith(".zip") && file.size > MAX_FILE_BYTES) {
            throw new Error(`${file.name} exceeds the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MiB per-file limit.`);
          }
        }
        if (files.length > MAX_BATCH_FILES) {
          throw new Error(`Select at most ${MAX_BATCH_FILES} files per batch.`);
        }
        await getBulkCapacity({
          file_count: files.length,
          total_size: totalSize,
          unsupported_count: 0,
        });
      }

      const newAssets: StagedAsset[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > MAX_FILE_BYTES && !file.name.toLowerCase().endsWith(".zip")) {
          throw new Error(`${file.name} exceeds the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MiB per-file limit.`);
        }
        const { type, category, priority, priorityLabel } = categorizeFile(file);
        newAssets.push({
          id: `pending-${Date.now()}-${i}`,
          name: file.name,
          fileType: type,
          category,
          priority,
          priorityLabel,
          size: `${Math.round(file.size / 1024)} KB`,
          auditStatus: "Awaiting rule selection",
          cleared: false,
          rawFile: file,
        });
      }

      const priorityWeights = { high: 1, medium: 2, low: 3 };
      const sorted = [...stagedAssets, ...newAssets].sort(
        (a, b) => priorityWeights[a.priority] - priorityWeights[b.priority]
      );
      setStagedAssets(sorted);
      (window as any).__B4LIVE_QUEUE__ = sorted;

      const top = sorted[0];
      onAssetChange?.({ name: top.name, fileType: top.fileType });
      sessionStorage.setItem("current_filename", top.name);
      sessionStorage.setItem("current_file_type", top.fileType);
      sessionStorage.removeItem("currentDocId");
      sessionStorage.removeItem("current_findings");
      sessionStorage.removeItem("current_headline");

      if (top.fileType === "image" && top.dataUrl) {
        sessionStorage.setItem("current_image_url", top.dataUrl);
      } else {
        sessionStorage.removeItem("current_image_url");
      }

      if (top.textContent) {
        setPasteText(top.textContent);
        sessionStorage.setItem("current_doc_text", top.textContent);
        sessionStorage.setItem("current_original_doc_text", top.textContent);
        if (setContent) setContent(top.textContent);
      }

      setStep("rules");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload or analysis failed. No results were fabricated.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const handleLaunchReviewWithRules = async (activeRules: any[]) => {
    if (loadingRef.current) return;
    if (!stagedAssets.length && !pasteText.trim()) {
      setUploadError("Paste non-empty content or upload a file before launching the review.");
      return;
    }
    if (!stagedAssets.length && pasteText.length > MAX_TEXT_CHARACTERS) {
      setUploadError(`Text is too long. Keep pasted content to ${MAX_TEXT_CHARACTERS.toLocaleString()} characters or fewer.`);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    try {
      const rulesJson = JSON.stringify(activeRules);
      sessionStorage.setItem("active_rules", rulesJson);
      let reviewAssets = stagedAssets;

      if (stagedAssets.length > 0) {
        if (stagedAssets.some((asset) => !asset.rawFile)) {
          throw new Error(
            "These files were restored from a previous browser session and are no longer available for a new rule-scoped review. Re-select the original files, then choose the rules for this review."
          );
        }
        const selectedRuleIds = JSON.stringify(activeRules.map((rule) => rule.id));
        const isBatch =
          stagedAssets.length > 1 ||
          stagedAssets.some((asset) => asset.rawFile?.name.toLowerCase().endsWith(".zip"));
        if (isBatch) {
          const formData = new FormData();
          for (const asset of stagedAssets) {
            formData.append("files", asset.rawFile as File);
          }
          formData.append(
            "name",
            stagedAssets.length === 1 && stagedAssets[0].name.toLowerCase().endsWith(".zip")
              ? stagedAssets[0].name.replace(/\.zip$/i, "")
              : "Campaign Bundle"
          );
          formData.append("rules", selectedRuleIds);
          const queued = await uploadBulkContent(formData);
          sessionStorage.setItem("bulk_job_id", queued.job_id);
          setPendingBatchJobId(queued.job_id);

          let jobResult: any = null;
          for (let attempt = 0; attempt < 180; attempt++) {
            jobResult = await getBulkJob(queued.job_id);
            if (jobResult?.job?.status === "completed") break;
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
          }
          if (jobResult?.job?.status !== "completed") {
            throw new Error(`Batch ${queued.job_id} is still processing. Check its status before retrying.`);
          }
          const prepared = stageBulkResult(jobResult);
          if (!prepared) throw new Error("No batch files were successfully prepared for this rule-scoped review.");
          reviewAssets = prepared;
        } else {
          const reviewedAssets: StagedAsset[] = [];
          for (const asset of stagedAssets) {
            const formData = new FormData();
            formData.append("file", asset.rawFile as File);
            formData.append("title", asset.name);
            formData.append("rules", selectedRuleIds);
            const response = await uploadContent(formData);
            const imageUrl = asset.fileType === "image"
              ? await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onerror = () => reject(new Error(`Could not load preview for ${asset.name}.`));
                  reader.onload = () => typeof reader.result === "string"
                    ? resolve(reader.result)
                    : reject(new Error(`Could not load preview for ${asset.name}.`));
                  reader.readAsDataURL(asset.rawFile as File);
                })
              : undefined;
            reviewedAssets.push({
              ...asset,
              id: response.document_id || asset.id,
              textContent: response.text_content || response.raw_text || response.text || "",
              findings: Array.isArray(response.findings) ? response.findings : [],
              headline: response.headline || "",
              auditStatus: response.status || "Incomplete Analysis",
              riskLevel: response.risk_level || "Analysis Incomplete",
              errorMessage: response.error_message || "",
              dataUrl: imageUrl,
            });
          }
          const priorityWeights = { high: 1, medium: 2, low: 3 };
          reviewAssets = reviewedAssets.sort(
            (left, right) => priorityWeights[left.priority] - priorityWeights[right.priority]
          );
        }
        setStagedAssets(reviewAssets);
        (window as any).__B4LIVE_QUEUE__ = reviewAssets;
        const priorityWeights = { high: 1, medium: 2, low: 3 };
        const sortedQueue = [...reviewAssets].sort(
          (a, b) => priorityWeights[a.priority] - priorityWeights[b.priority]
        );

        (window as any).__B4LIVE_QUEUE__ = sortedQueue;
        sessionStorage.setItem("bulk_queue", JSON.stringify(sortedQueue));
        sessionStorage.setItem("is_bulk_import", "true");

        const topAsset = sortedQueue[0];
        onAssetChange?.({ name: topAsset.name, fileType: topAsset.fileType || "text" });
        sessionStorage.setItem("current_filename", topAsset.name);
        sessionStorage.setItem("current_file_type", topAsset.fileType);
        if (topAsset.id) sessionStorage.setItem("currentDocId", topAsset.id);
        if (topAsset.findings)
          sessionStorage.setItem(
            "current_findings",
            JSON.stringify(topAsset.findings)
          );
        if (topAsset.headline)
          sessionStorage.setItem("current_headline", topAsset.headline);
        if (topAsset.auditStatus)
          sessionStorage.setItem("current_audit_status", topAsset.auditStatus);
        if (topAsset.riskLevel)
          sessionStorage.setItem("current_risk_level", topAsset.riskLevel);
        if (topAsset.errorMessage)
          sessionStorage.setItem("current_error_message", topAsset.errorMessage);
        else sessionStorage.removeItem("current_error_message");

        if (topAsset.fileType === "image" && topAsset.dataUrl) {
          sessionStorage.setItem("current_image_url", topAsset.dataUrl);
        } else {
          sessionStorage.removeItem("current_image_url");
        }

        const resolvedText = topAsset.textContent || pasteText || "";
        sessionStorage.setItem("current_doc_text", resolvedText);
        sessionStorage.setItem("current_original_doc_text", resolvedText);
        if (setContent) setContent(resolvedText);

        window.dispatchEvent(new Event("b4live-queue"));
      } else {
        if (!pasteText.trim()) {
          throw new Error("Add text or upload a file before launching the review.");
        }
        try {
          const formData = new FormData();
          formData.append("content", pasteText);
          formData.append("rules", rulesJson);
          const res = await uploadContent(formData);
          if (res.document_id) sessionStorage.setItem("currentDocId", res.document_id);
          sessionStorage.setItem("current_findings", JSON.stringify(res.findings || []));
          if (res.headline) sessionStorage.setItem("current_headline", res.headline);
          sessionStorage.setItem("current_audit_status", res.status || "Incomplete Analysis");
          sessionStorage.setItem("current_risk_level", res.risk_level || "Analysis Incomplete");
          if (res.error_message) sessionStorage.setItem("current_error_message", res.error_message);
          else sessionStorage.removeItem("current_error_message");
          if (typeof res.text_content === "string") {
            sessionStorage.setItem("current_doc_text", res.text_content);
            sessionStorage.setItem("current_original_doc_text", res.text_content);
            if (setContent) setContent(res.text_content);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : "The backend could not analyse the pasted content.";
          setUploadError(message);
          throw e instanceof Error ? e : new Error(message);
        }

        sessionStorage.removeItem("bulk_queue");
        sessionStorage.removeItem("is_bulk_import");
        (window as any).__B4LIVE_QUEUE__ = null;
        sessionStorage.setItem("current_filename", "Marketing Copy.txt");
        sessionStorage.setItem("current_file_type", "text");
        onAssetChange?.({ name: "Marketing Copy.txt", fileType: "text" });
        sessionStorage.setItem("current_doc_text", pasteText);
        sessionStorage.setItem("current_original_doc_text", pasteText);
        sessionStorage.removeItem("current_image_url");
        if (setContent) setContent(pasteText);
      }

      if (onReview) onReview();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not start the review. The backend did not confirm success.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  return (
    <div
      style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "10px 20px 40px",
        color: "#f1f5f9",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "12px",
          marginBottom: "24px",
          fontSize: "12px",
        }}
      >
        <span
          style={{
            color: step === "input" ? "#12c4d4" : "#9299b7",
            fontWeight: 700,
          }}
        >
          1. Ingest Content & Multi-Format
        </span>
        <span style={{ color: "#252a48" }}>→</span>
        <span
          style={{
            color: step === "rules" ? "#12c4d4" : "#9299b7",
            fontWeight: 700,
          }}
        >
          2. Rule Scope & Channel Gate
        </span>
        <span style={{ color: "#252a48" }}>→</span>
        <span style={{ color: "#9299b7" }}>
          3. Interactive Review & Priority Queue
        </span>
      </div>

      <div
        role="note"
        style={{
          maxWidth: "820px",
          margin: "0 auto 18px",
          padding: "11px 14px",
          borderRadius: "10px",
          border: "1px solid rgba(18, 196, 212, 0.35)",
          background: "rgba(18, 196, 212, 0.07)",
          color: "#cbd5e1",
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "#12c4d4" }}>Review scope:</strong> Text and documents are checked only against the active rules you provide, upload and approve, or choose from the rule templates. They are not checked against every law, standard, or factual source. Results are not a certification or guarantee of compliance; verify the rules and evidence that apply to your content.
      </div>

      {uploadError && (
        <div role="alert" style={{ marginBottom: "16px", padding: "12px 14px", borderRadius: "8px", border: "1px solid #ff6b6b70", background: "#ff6b6b12", color: "#ff9a9a", fontSize: "12px", lineHeight: 1.5 }}>
          {uploadError}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
            {pendingBatchJobId && (
              <button type="button" className="secondary-button" disabled={loading} onClick={() => void checkPendingBatchStatus()}>
                {loading ? "Checking status…" : "Check batch status"}
              </button>
            )}
            {step === "input" && (
              <button type="button" className="secondary-button" disabled={loading} onClick={() => handleTriggerPicker("bulk")}>
                Choose another file
              </button>
            )}
          </div>
        </div>
      )}

      {step === "input" && (
        <div>
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1
              style={{
                fontSize: "34px",
                fontWeight: 800,
                margin: "0 0 8px 0",
                color: "#ffffff",
              }}
            >
              Before It Goes Live
            </h1>
            <p
              style={{
                margin: "0 auto",
                maxWidth: "620px",
                color: "#9299b7",
                fontSize: "14px",
              }}
            >
              Universal pre-flight compliance release gate. Audit beverage ads,
              legal copy, skincare, retail flyers, or presentations.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            {[
              {
                id: "text",
                icon: "📝",
                name: "Direct Copy",
                desc: "Any Industry Draft",
              },
              {
                id: "pdf",
                icon: "📄",
                name: "PDF Document",
                desc: "Dynamic Page Scan",
              },
              {
                id: "pptx",
                icon: "📊",
                name: "Slide Deck",
                desc: "Presentation Slides",
              },
              {
                id: "image",
                icon: "🖼️",
                name: "Ad Banner / Image",
                desc: "AI visual review",
              },
              {
                id: "bulk",
                icon: "📦",
                name: "Bulk Import",
                desc: "Multi-files / ZIP / Folder",
              },
            ].map((fmt) => (
              <div
                key={fmt.id}
                onClick={() => handleTriggerPicker(fmt.id as any)}
                style={{
                  background:
                    selectedFormat === fmt.id ? "#171b35" : "#101329",
                  border:
                    selectedFormat === fmt.id
                      ? "2px solid #12c4d4"
                      : "1px solid #252a48",
                  borderRadius: "14px",
                  padding: "16px 12px",
                  textAlign: "center",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "24px", marginBottom: "6px" }}>
                  {fmt.icon}
                </div>
                <strong
                  style={{
                    fontSize: "13px",
                    color: "#f2f4ff",
                    display: "block",
                  }}
                >
                  {fmt.name}
                </strong>
                <span style={{ fontSize: "10px", color: "#9299b7" }}>
                  {fmt.desc}
                </span>
              </div>
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple={true}
            onChange={(e) => {
              handleFileUpload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <p className="muted" style={{ textAlign: "center", fontSize: "11px", margin: "8px 0 16px" }}>
            Files: 20 MiB each; batches: 20 files and 50 MiB total. Scanned pages are visually reviewed only when an AI provider is configured; OCR is not guaranteed.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "8px",
              marginBottom: "20px",
            }}
          >
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

          <div
            style={{
              background: "#101329",
              border: "1px solid #252a48",
              borderRadius: "18px",
              padding: "24px",
              maxWidth: "820px",
              margin: "0 auto",
            }}
          >
            <textarea
              value={pasteText}
              maxLength={MAX_TEXT_CHARACTERS}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste any marketing draft, social caption, cold drink ad, or legal copy here..."
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "16px",
              }}
            >
              <span style={{ fontSize: "12px", color: "#9299b7" }}>
                {pasteText.length.toLocaleString()} / {MAX_TEXT_CHARACTERS.toLocaleString()} characters
              </span>
              <button
                onClick={() => {
                  if (stagedAssets.length > 0) {
                    onAssetChange?.({
                      name: stagedAssets[0].name,
                      fileType: stagedAssets[0].fileType,
                    });
                  } else if (pasteText.trim()) {
                    onAssetChange?.({ name: "Marketing Copy.txt", fileType: "text" });
                  }
                  setStep("rules");
                }}
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

      {step === "rules" && (
        <ConfigureRules
          onBack={() => {
            setStep("input");
            onShowAssetNotice?.();
          }}
          onLaunchReview={(activeRules) => {
            handleLaunchReviewWithRules(activeRules);
          }}
          loadingReview={loading}
        />
      )}
    </div>
  );
}