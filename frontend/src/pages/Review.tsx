
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  type ChangeEvent,
} from "react";
import {
  Sparkles,
  EyeOff,
  Edit3,
  Download,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Upload,
  Layers,
  ArrowLeft,
} from "lucide-react";
import {
  applyFixToBackend,
  askAI,
  generateCorrectionSuggestion,
  uploadContent,
  dismissFinding,
  dismissMatchingFindings,
  CorrectionSuggestionError,
  type ChatTurn,
  type CorrectionSuggestionStatus,
} from "../api.ts";
import GraphView from "../components/GraphView.tsx";

interface Finding {
  id: string;
  page?: number;
  markerId: number;
  severity: "high" | "medium" | "low";
  location?: string;
  image_action?: string;
  flagged_text: string;
  explanation: string;
  suggested_fix: string;
  suggestion_draft: string;
  suggestion_status: CorrectionSuggestionStatus;
  suggestion_explanation: string;
  suggestion_change_summary: string;
  suggestion_missing_information: string[];
  evidence: string;
  status: "open" | "resolved" | "dismissed";
  pinX?: number;
  pinY?: number;
}

interface BulkAsset {
  id?: string;
  name: string;
  fileType?: string;
  dataUrl?: string;
  textContent?: string;
  originalTextContent?: string;
  findings?: Finding[];
  status?: string;
  risk_level?: string;
  error_message?: string;
  cleared?: boolean;
  [key: string]: any;
}

const normalizeSeverity = (value: unknown): Finding["severity"] => {
  const severity = String(value ?? "").toLowerCase();

  if (
    severity === "high" ||
    severity === "medium" ||
    severity === "low"
  ) {
    return severity;
  }

  return "medium";
};

const normalizeFindingStatus = (
  value: unknown
): Finding["status"] => {
  const status = String(value ?? "open").toLowerCase();

  if (
    status === "resolved" ||
    status === "dismissed" ||
    status === "open"
  ) {
    return status;
  }

  return "open";
};

const normalizeFinding = (
  item: any,
  index: number
): Finding => {
  const explanation =
    typeof item?.explanation === "string" ? item.explanation : "";
  const allowedSuggestionStatuses: CorrectionSuggestionStatus[] = [
    "not_requested",
    "suggestion_ready",
    "needs_information",
    "no_safe_replacement",
    "invalid_suggestion",
    "error",
  ];
  const suggestionStatus = allowedSuggestionStatuses.includes(
    item?.suggestion_status
  )
    ? item.suggestion_status
    : "not_requested";
  const storedSuggestion =
    typeof item?.suggested_fix === "string" ? item.suggested_fix : "";
  let missingInformation: string[] = [];
  if (Array.isArray(item?.suggestion_missing_information)) {
    missingInformation = item.suggestion_missing_information.filter(
      (value: unknown): value is string => typeof value === "string"
    );
  } else if (typeof item?.suggestion_missing_information === "string") {
    try {
      const parsed = JSON.parse(item.suggestion_missing_information);
      if (Array.isArray(parsed)) {
        missingInformation = parsed.filter(
          (value: unknown): value is string => typeof value === "string"
        );
      }
    } catch {
      missingInformation = [];
    }
  }
  const requiredStandard = explanation.match(
    /Required standard:\s*([\s\S]*)$/i
  )?.[1]?.trim();
  const isRuleStatementReplacement =
    Boolean(requiredStandard) &&
    storedSuggestion
      .toLowerCase()
      .includes(requiredStandard?.toLowerCase() ?? "");

  return {
    id: String(item?.id || `f-${index + 1}`),
    page:
      item?.page != null && Number.isFinite(Number(item.page))
        ? Number(item.page)
        : undefined,
    markerId:
      Number.isFinite(Number(item?.markerId)) && Number(item?.markerId) > 0
        ? Number(item.markerId)
        : index + 1,
    severity: normalizeSeverity(item?.severity),
    location:
      typeof item?.location === "string" ? item.location : undefined,
    image_action:
      typeof item?.image_action === "string"
        ? item.image_action
        : undefined,
    flagged_text:
      typeof item?.flagged_text === "string"
        ? item.flagged_text
        : typeof item?.original === "string"
          ? item.original
          : "",
    explanation,
    suggested_fix:
      suggestionStatus === "suggestion_ready" && !isRuleStatementReplacement
        ? storedSuggestion
        : "",
    suggestion_draft:
      typeof item?.suggestion_draft === "string" ? item.suggestion_draft : "",
    suggestion_status: suggestionStatus,
    suggestion_explanation:
      typeof item?.suggestion_explanation === "string"
        ? item.suggestion_explanation
        : "",
    suggestion_change_summary:
      typeof item?.suggestion_change_summary === "string"
        ? item.suggestion_change_summary
        : "",
    suggestion_missing_information: missingInformation,
    evidence:
      typeof item?.evidence === "string" ? item.evidence : "",
    status: normalizeFindingStatus(item?.status),
    pinX:
      item?.pinX != null &&
      item.pinX !== "" &&
      Number.isFinite(Number(item.pinX))
        ? Number(item.pinX)
        : undefined,
    pinY:
      item?.pinY != null &&
      item.pinY !== "" &&
      Number.isFinite(Number(item.pinY))
        ? Number(item.pinY)
        : undefined,
  };
};

const readSession = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSession = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // The review remains usable if browser storage is unavailable.
  }
};

const removeSession = (key: string) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
};

interface ReviewProps {
  content?: string;
  setContent?: (val: string) => void;
  reviewStarted?: boolean;
  onReview?: () => void;
  onBackToHome?: () => void;
  onCorrectionApproved?: () => void;
}

export default function Review({
  content,
  setContent,
  onBackToHome,
  onCorrectionApproved,
}: ReviewProps) {
  const [viewMode, setViewMode] = useState<"creative" | "graph">(
    "creative"
  );
  const [activeMarkerId, setActiveMarkerId] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [auditStatus, setAuditStatus] = useState(
    () => readSession("current_audit_status") || "Awaiting audit"
  );
  const [riskLevel, setRiskLevel] = useState(
    () => readSession("current_risk_level") || "Not assessed"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    () => readSession("current_error_message")
  );

  const [bulkQueue, setBulkQueue] = useState<BulkAsset[]>(() => {
    const globalQueue = (window as any).__B4LIVE_QUEUE__;

    if (Array.isArray(globalQueue) && globalQueue.length > 0) {
      return globalQueue;
    }

    try {
      const saved = readSession("bulk_queue");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore malformed saved queue data.
    }

    return [];
  });

  const [docFilename, setDocFilename] = useState(
    () =>
      readSession("current_filename") ||
      bulkQueue[0]?.name ||
      "Marketing Asset"
  );

  const docTitle = docFilename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]/g, " ");

  const [activeAssetId, setActiveAssetId] = useState<string | null>(
    () =>
      (
        bulkQueue.find(
          (asset) => asset.name === docFilename
        ) ?? bulkQueue[0]
      )?.id ?? null
  );

  const isCurrent = (asset: BulkAsset) =>
    activeAssetId
      ? asset.id === activeAssetId
      : asset.name === docFilename;

  const [activeFileType, setActiveFileType] = useState(
    () =>
      readSession("current_file_type") ||
      bulkQueue[0]?.fileType ||
      "text"
  );

  const [imageUrl, setImageUrl] = useState<string | null>(
    () => readSession("current_image_url")
  );

  const isImageMode =
    activeFileType === "image" ||
    Boolean(
      docFilename.match(/\.(png|jpg|jpeg|webp|gif)$/i) &&
        imageUrl
    );

  const imageFileInputRef = useRef<HTMLInputElement>(null);

  const [documentText, setDocumentText] = useState(() => {
    const saved = readSession("current_doc_text");

    if (saved !== null && saved.trim().length > 0) {
      return saved;
    }

    if (content && content.trim().length > 0) {
      return content;
    }

    return saved ?? "";
  });

  const [originalDocumentText, setOriginalDocumentText] = useState(() => {
    const original = readSession("current_original_doc_text");
    if (original !== null) return original;
    return readSession("current_doc_text") ?? content ?? "";
  });

  const pages = useMemo(() => {
    if (!documentText) return [""];

    const pageRegex =
      /---\s*\[(?:Page|Slide)\s*(\d+)\]\s*---/gi;

    if (pageRegex.test(documentText)) {
      const parts = documentText
        .split(/---\s*\[(?:Page|Slide)\s*\d+\]\s*---/gi)
        .map((part) => part.trim())
        .filter(Boolean);

      return parts.length > 0 ? parts : [documentText];
    }

    return [documentText];
  }, [documentText]);

  const originalPages = useMemo(() => {
    if (!originalDocumentText) return [""];

    const pageRegex =
      /---\s*\[(?:Page|Slide)\s*(\d+)\]\s*---/gi;

    if (pageRegex.test(originalDocumentText)) {
      const parts = originalDocumentText
        .split(/---\s*\[(?:Page|Slide)\s*\d+\]\s*---/gi)
        .map((part) => part.trim())
        .filter(Boolean);

      return parts.length > 0 ? parts : [originalDocumentText];
    }

    return [originalDocumentText];
  }, [originalDocumentText]);

  const totalPages = isImageMode ? 1 : pages.length;
  const activePageText =
    pages[currentPage - 1] || pages[0] || "";
  const originalPageText =
    originalPages[currentPage - 1] || originalPages[0] || "";

  const [findings, setFindings] = useState<Finding[]>(() => {
    try {
      const saved = readSession("current_findings");

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed)) {
          return parsed.map(normalizeFinding);
        }
      }
    } catch {
      // Invalid saved findings must not crash the review.
    }

    return [];
  });

  const [isEditingManually, setIsEditingManually] = useState(false);
  const [manualText, setManualText] = useState("");
  const [aiChats, setAiChats] = useState<{
    [id: string]: ChatTurn[];
  }>({});
  const [aiInputs, setAiInputs] = useState<{
    [id: string]: string;
  }>({});
  const [aiLoading, setAiLoading] = useState<{
    [id: string]: boolean;
  }>({});
  const [fixSaving, setFixSaving] = useState<{
    [id: string]: boolean;
  }>({});
  const [suggestionLoading, setSuggestionLoading] = useState<{
    [id: string]: boolean;
  }>({});
  const [suggestionFailures, setSuggestionFailures] = useState<{
    [id: string]: { status: "invalid_suggestion" | "error"; message: string };
  }>({});
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const suggestionRequestsRef = useRef(new Set<string>());
  const markerRefs = useRef<{
    [key: number]: HTMLElement | null;
  }>({});
  const fixPanelRef = useRef<HTMLDivElement | null>(null);
  const [arrowPath, setArrowPath] = useState("");

  const pageFindings = useMemo(() => {
    if (isImageMode) return findings;

    return findings.filter((finding) =>
      finding.page != null
        ? finding.page === currentPage
        : currentPage === 1
    );
  }, [findings, currentPage, isImageMode]);

  const openPageFindings = pageFindings.filter(
    (finding) => finding.status === "open"
  );

  const activeFinding =
    pageFindings.find(
      (finding) => finding.markerId === activeMarkerId
    ) ||
    openPageFindings[0] ||
    pageFindings[0];

  const allPageResolved =
    pageFindings.length > 0 &&
    pageFindings.every(
      (finding) =>
        finding.status === "resolved" ||
        finding.status === "dismissed"
    );

  const persistFindings = (nextFindings: Finding[]) => {
    setFindings(nextFindings);
    writeSession("current_findings", JSON.stringify(nextFindings));
  };

  const persistActiveBulkAsset = (
    updatedText: string,
    updatedFindings: Finding[]
  ) => {
    if (!activeAssetId) return;

    setBulkQueue((previous) => {
      const updatedQueue = previous.map((asset) =>
        isCurrent(asset)
          ? {
              ...asset,
              originalTextContent:
                asset.originalTextContent ??
                asset.textContent ??
                originalDocumentText,
              textContent: updatedText,
              findings: updatedFindings,
            }
          : asset
      );
      writeSession("bulk_queue", JSON.stringify(updatedQueue));
      (window as any).__B4LIVE_QUEUE__ = updatedQueue;
      return updatedQueue;
    });
  };

  const setReviewError = (message: string | null) => {
    setErrorMessage(message);

    if (message) {
      writeSession("current_error_message", message);
    } else {
      removeSession("current_error_message");
    }
  };

  const handleApplyAiSuggestion = async (findingId: string) => {
    const target = findings.find((finding) => finding.id === findingId);
    if (
      !target ||
      target.status !== "open" ||
      suggestionLoading[findingId] ||
      suggestionRequestsRef.current.has(findingId) ||
      fixSaving[findingId]
    ) {
      return;
    }

    // Reuse an already validated suggestion instead of spending another AI call.
    if (
      target.suggestion_status === "suggestion_ready" &&
      target.suggested_fix.trim()
    ) {
      setManualText(target.suggested_fix);
      setIsEditingManually(true);
      setReviewError(null);
      return;
    }

    suggestionRequestsRef.current.add(findingId);
    setSuggestionLoading((previous) => ({
      ...previous,
      [findingId]: true,
    }));
    setSuggestionFailures((previous) => {
      const next = { ...previous };
      delete next[findingId];
      return next;
    });

    try {
      const suggestion = await generateCorrectionSuggestion(findingId);
      const nextFindings = findings.map((finding) =>
        finding.id === findingId
          ? {
              ...finding,
              suggested_fix:
                suggestion.status === "suggestion_ready"
                  ? suggestion.replacement_text
                  : "",
              suggestion_draft:
                suggestion.status === "suggestion_ready"
                  ? ""
                  : suggestion.draft_replacement_text?.trim() || "",
              suggestion_status: suggestion.status,
              suggestion_explanation: suggestion.explanation,
              suggestion_change_summary: suggestion.change_summary,
              suggestion_missing_information: suggestion.missing_information,
            }
          : finding
      );
      persistFindings(nextFindings);
      onCorrectionApproved?.();
      if (!isImageMode) {
        persistActiveBulkAsset(documentText, nextFindings);
      }

      if (
        suggestion.status !== "suggestion_ready" ||
        !suggestion.replacement_text.trim()
      ) {
        setCorrectionNotice(null);
        setManualText(suggestion.draft_replacement_text?.trim() || "");
        setIsEditingManually(true);
        setReviewError(null);
        return;
      }

      // Put the generated wording in the editable preview. The user reviews or
      // edits it, then presses Confirm to update the advertisement.
      setManualText(suggestion.replacement_text);
      setIsEditingManually(true);
      setReviewError(null);
    } catch (error) {
      setSuggestionFailures((previous) => ({
        ...previous,
        [findingId]: {
          status:
            error instanceof CorrectionSuggestionError
              ? error.suggestionStatus
              : "error",
          message:
            error instanceof Error
              ? error.message
              : "The suggestion could not be generated. No replacement was saved; retry the request.",
        },
      }));
    } finally {
      suggestionRequestsRef.current.delete(findingId);
      setSuggestionLoading((previous) => ({
        ...previous,
        [findingId]: false,
      }));
    }
  };

  const handleSwitchBulkAsset = (asset: BulkAsset) => {
    setActiveAssetId(asset.id ?? null);
    setDocFilename(asset.name);
    setActiveFileType(asset.fileType || "text");

    writeSession("current_filename", asset.name);
    writeSession("current_file_type", asset.fileType || "text");

    if (asset.fileType === "image") {
      const img = asset.dataUrl || null;
      setImageUrl(img);

      if (img) {
        writeSession("current_image_url", img);
      } else {
        removeSession("current_image_url");
      }
    } else {
      setImageUrl(null);
      removeSession("current_image_url");
    }

    const nextText =
      typeof asset.textContent === "string"
        ? asset.textContent
        : "";
    const nextOriginalText =
      typeof asset.originalTextContent === "string"
        ? asset.originalTextContent
        : nextText;

    setDocumentText(nextText);
    setOriginalDocumentText(nextOriginalText);
    setContent?.(nextText);
    writeSession("current_doc_text", nextText);
    writeSession("current_original_doc_text", nextOriginalText);

    const nextFindings = Array.isArray(asset.findings)
      ? asset.findings.map(normalizeFinding)
      : [];

    persistFindings(nextFindings);

    const nextStatus = asset.status || "Awaiting audit";
    const nextRisk = asset.risk_level || "Not assessed";

    setAuditStatus(nextStatus);
    setRiskLevel(nextRisk);

    writeSession("current_audit_status", nextStatus);
    writeSession("current_risk_level", nextRisk);

    setReviewError(asset.error_message || null);

    setActiveMarkerId(1);
    setCurrentPage(1);
    setIsEditingManually(false);
    setManualText("");
    setAiChats({});
    setAiInputs({});
    setAiLoading({});
    setFixSaving({});
  };

  const handleImageChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (loadEvent) => {
      const dataUrl = loadEvent.target?.result;

      if (typeof dataUrl !== "string") {
        setReviewError("The selected image could not be read.");
        setAuditStatus("Failed");
        writeSession("current_audit_status", "Failed");
        event.target.value = "";
        return;
      }

      setImageUrl(dataUrl);
      setDocFilename(file.name);
      setActiveAssetId(null);
      setActiveFileType("image");
      setDocumentText("");
      setOriginalDocumentText("");
      persistFindings([]);
      setAuditStatus("Analysis in progress");
      setRiskLevel("Not assessed");
      setReviewError(null);

      writeSession("current_doc_text", "");
      writeSession("current_original_doc_text", "");
      writeSession("current_audit_status", "Analysis in progress");
      writeSession("current_risk_level", "Not assessed");
      writeSession("current_image_url", dataUrl);
      writeSession("current_file_type", "image");
      writeSession("current_filename", file.name);
      removeSession("current_error_message");

      setActiveMarkerId(1);
      setCurrentPage(1);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", file.name);

        const response = await uploadContent(formData);

        if (response?.document_id) {
          writeSession("currentDocId", response.document_id);
        }

        if (response?.headline) {
          writeSession("current_headline", response.headline);
        }

        if (typeof response?.text_content === "string") {
          setDocumentText(response.text_content);
          setOriginalDocumentText(response.text_content);
          writeSession("current_doc_text", response.text_content);
          writeSession("current_original_doc_text", response.text_content);
        }

        const nextFindings = Array.isArray(response?.findings)
          ? response.findings.map(normalizeFinding)
          : [];

        persistFindings(nextFindings);

        const nextRisk =
          response?.risk_level || "Not assessed";
        const nextStatus =
          response?.status || "Incomplete analysis";

        setRiskLevel(nextRisk);
        setAuditStatus(nextStatus);

        writeSession("current_risk_level", nextRisk);
        writeSession("current_audit_status", nextStatus);

        setReviewError(response?.error_message || null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The image could not be audited.";

        setAuditStatus("Failed");
        setRiskLevel("Not assessed");
        setReviewError(message);

        writeSession("current_audit_status", "Failed");
        writeSession("current_risk_level", "Not assessed");
      } finally {
        event.target.value = "";
      }
    };

    reader.onerror = () => {
      setAuditStatus("Failed");
      setRiskLevel("Not assessed");
      setReviewError("The selected image could not be read.");
      writeSession("current_audit_status", "Failed");
      writeSession("current_risk_level", "Not assessed");
      event.target.value = "";
    };

    reader.readAsDataURL(file);
  };

  const handlePageChange = (newPage: number) => {
    const safePage = Math.max(
      1,
      Math.min(totalPages, newPage)
    );

    setCurrentPage(safePage);
    setIsEditingManually(false);

    const nextPageOpen = findings.filter(
      (finding) =>
        (isImageMode ||
          finding.page === safePage ||
          finding.page == null && safePage === 1) &&
        finding.status === "open"
    );

    setActiveMarkerId(
      nextPageOpen.length > 0
        ? nextPageOpen[0].markerId
        : 0
    );
  };

  const advanceToNextOpen = (
    currentId: string,
    updatedList: Finding[]
  ) => {
    const remainingOnPage = updatedList.filter(
      (finding) =>
        (isImageMode ||
          finding.page === currentPage ||
          finding.page == null && currentPage === 1) &&
        finding.status === "open" &&
        finding.id !== currentId
    );

    setActiveMarkerId(
      remainingOnPage.length > 0
        ? remainingOnPage[0].markerId
        : 0
    );
  };

  // Calculate the animated connector between the selected finding
  // and the Magic Fix panel.
  useEffect(() => {
    if (viewMode !== "creative" || activeMarkerId === 0) {
      setArrowPath("");
      return;
    }

    const updateConnector = () => {
      const markerElement = markerRefs.current[activeMarkerId];
      const fixElement = fixPanelRef.current;
      const containerElement = containerRef.current;

      if (
        markerElement &&
        fixElement &&
        containerElement
      ) {
        const markerRect =
          markerElement.getBoundingClientRect();
        const fixRect = fixElement.getBoundingClientRect();
        const containerRect =
          containerElement.getBoundingClientRect();

        if (markerRect.width > 0 && markerRect.height > 0) {
          const x1 =
            markerRect.left +
            markerRect.width / 2 -
            containerRect.left;
          const y1 = markerRect.bottom - containerRect.top;
          const x2 = fixRect.left + 50 - containerRect.left;
          const y2 = fixRect.top - containerRect.top;
          const controlY = y1 + (y2 - y1) * 0.5;

          setArrowPath(
            `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`
          );
          return;
        }
      }

      setArrowPath("");
    };

    updateConnector();

    const animationFrame = requestAnimationFrame(updateConnector);
    const timer = window.setTimeout(updateConnector, 60);

    window.addEventListener("resize", updateConnector);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateConnector);
    };
  }, [
    activeMarkerId,
    viewMode,
    currentPage,
    isImageMode,
    findings,
    documentText,
  ]);

  const handleApplyFix = async (
    findingId: string,
    replacementOverride?: string
  ) => {
    const target = findings.find(
      (finding) => finding.id === findingId
    );

    if (!target || fixSaving[findingId]) return;

    const replacement = (
      replacementOverride ?? target.suggested_fix ?? ""
    ).trim();

    if (!target.flagged_text.trim() || !replacement) {
      setReviewError(
        "This finding has no verified flagged text or replacement to apply."
      );
      return;
    }

    if (
      !isImageMode &&
      !documentText.includes(target.flagged_text)
    ) {
      setReviewError(
        "The flagged text was not found in the current document. No change was applied."
      );
      return;
    }

    if (
      !isImageMode &&
      documentText.split(target.flagged_text).length - 1 !== 1
    ) {
      setReviewError(
        "The flagged text appears more than once. The replacement was not applied because the target is ambiguous."
      );
      return;
    }

    setFixSaving((previous) => ({
      ...previous,
      [findingId]: true,
    }));

    try {
      const result = await applyFixToBackend({
        finding_id: findingId,
        flagged_text: target.flagged_text,
        replacement_text: replacement,
        explanation: target.explanation,
        evidence: target.evidence,
        current_doc_text: documentText,
      });

      if (
        result?.status === "error" ||
        result?.success === false
      ) {
        throw new Error(
          result?.detail ||
            result?.message ||
            "The backend did not confirm the fix."
        );
      }

      if (!isImageMode) {
        const updatedDocument = result.updated_text;

        setDocumentText(updatedDocument);
        setContent?.(updatedDocument);
        writeSession("current_doc_text", updatedDocument);
      }

      const nextFindings = findings.map((finding) =>
        finding.id === findingId
          ? {
              ...finding,
              suggested_fix: replacement,
              status: "resolved" as const,
            }
          : finding
      );

      persistFindings(nextFindings);
      onCorrectionApproved?.();
      if (!isImageMode) {
        persistActiveBulkAsset(result.updated_text, nextFindings);
      }
      setReviewError(null);
      setCorrectionNotice(
        "The replacement was applied and passed deterministic checks against current active rules. Other findings may remain."
      );
      advanceToNextOpen(findingId, nextFindings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The fix could not be saved.";

      setReviewError(message);
    } finally {
      setFixSaving((previous) => ({
        ...previous,
        [findingId]: false,
      }));
    }
  };

  const handleSaveManualEdit = async (
    findingId: string
  ) => {
    const target = findings.find(
      (finding) => finding.id === findingId
    );
    const replacement = manualText.trim();

    if (!target || !replacement || fixSaving[findingId]) {
      return;
    }

    if (!isImageMode) {
      if (!target.flagged_text.trim()) {
        setReviewError(
          "The original flagged text is unavailable. No change was applied."
        );
        return;
      }

      const occurrences =
        documentText.split(target.flagged_text).length - 1;

      if (occurrences !== 1) {
        setReviewError(
          occurrences === 0
            ? "The flagged text was not found in the current document. No change was applied."
            : "The flagged text appears more than once. No change was applied because the target is ambiguous."
        );
        return;
      }
    }

    setFixSaving((previous) => ({
      ...previous,
      [findingId]: true,
    }));

    try {
      const result = await applyFixToBackend({
        finding_id: findingId,
        flagged_text: target.flagged_text,
        replacement_text: replacement,
        explanation: target.explanation,
        evidence: target.evidence,
        current_doc_text: documentText,
      });

      if (
        result?.status === "error" ||
        result?.success === false
      ) {
        throw new Error(
          result?.detail ||
            result?.message ||
            "The backend did not confirm the edit."
        );
      }

      if (!isImageMode) {
        const updatedDocument = result.updated_text;

        setDocumentText(updatedDocument);
        setContent?.(updatedDocument);
        writeSession("current_doc_text", updatedDocument);
      }

      const nextFindings = findings.map((finding) =>
        finding.id === findingId
          ? {
              ...finding,
              suggested_fix: replacement,
              status: "resolved" as const,
            }
          : finding
      );

      persistFindings(nextFindings);
      if (!isImageMode) {
        persistActiveBulkAsset(result.updated_text, nextFindings);
      }
      setIsEditingManually(false);
      setManualText("");
      setReviewError(null);
      setCorrectionNotice(
        "Your replacement was applied and passed deterministic checks against current active rules. Other findings may remain."
      );
      advanceToNextOpen(findingId, nextFindings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The manual edit could not be saved.";

      setReviewError(message);
    } finally {
      setFixSaving((previous) => ({
        ...previous,
        [findingId]: false,
      }));
    }
  };

  const handleIgnoreOnce = async (findingId: string) => {
    if (fixSaving[findingId]) return;
    setFixSaving((previous) => ({ ...previous, [findingId]: true }));
    try {
      const result = await dismissFinding(findingId);
      if (result?.status !== "success") throw new Error("The server did not confirm the dismissal.");
      const nextFindings = findings.map((finding) =>
        finding.id === findingId ? { ...finding, status: "dismissed" as const } : finding
      );
      persistFindings(nextFindings);
      setReviewError(null);
      advanceToNextOpen(findingId, nextFindings);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The finding could not be dismissed. Refresh the review and retry.");
    } finally {
      setFixSaving((previous) => ({ ...previous, [findingId]: false }));
    }
  };

  const handleIgnoreAll = async (target: Finding) => {
    if (fixSaving[target.id]) return;
    setFixSaving((previous) => ({ ...previous, [target.id]: true }));
    try {
      const result = await dismissMatchingFindings(target.id);
      if (result?.status !== "success") throw new Error("The server did not confirm the dismissal.");
      const nextFindings = findings.map((finding) =>
        finding.flagged_text === target.flagged_text && finding.status === "open"
          ? { ...finding, status: "dismissed" as const }
          : finding
      );
      persistFindings(nextFindings);
      setReviewError(null);
      advanceToNextOpen(target.id, nextFindings);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Matching findings could not be dismissed. Refresh the review and retry.");
    } finally {
      setFixSaving((previous) => ({ ...previous, [target.id]: false }));
    }
  };

  const handleAskAi = async (
    finding: Finding,
    query?: string
  ) => {
    const userPrompt = (
      query ||
      "Explain this finding using the supplied evidence and suggest an alternative."
    ).trim();

    if (!userPrompt || aiLoading[finding.id]) return;

    const previousConversation = aiChats[finding.id] ?? [];

    const userTurn: ChatTurn = {
      role: "user",
      text: userPrompt,
    };

    setAiChats((previous) => ({
      ...previous,
      [finding.id]: [
        ...(previous[finding.id] ?? []),
        userTurn,
      ],
    }));

    setAiInputs((previous) => ({
      ...previous,
      [finding.id]: "",
    }));

    setAiLoading((previous) => ({
      ...previous,
      [finding.id]: true,
    }));

    try {
      const response = await askAI({
        finding: {
          finding_id: finding.id,
          flagged_text: finding.flagged_text,
          explanation: finding.explanation,
          evidence: finding.evidence,
          suggested_fix: finding.suggested_fix,
          severity: finding.severity,
          location: finding.location,
        },
        question: userPrompt,
        conversation: previousConversation,
      });

      if (
        typeof response?.answer !== "string" ||
        !response.answer.trim()
      ) {
        throw new Error("The AI service returned no answer.");
      }

      const aiTurn: ChatTurn = {
        role: "ai",
        text: response.answer,
      };

      setAiChats((previous) => ({
        ...previous,
        [finding.id]: [
          ...(previous[finding.id] ?? []),
          aiTurn,
        ],
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI consultation failed.";

      const errorTurn: ChatTurn = {
        role: "ai",
        text: `AI response unavailable: ${message}`,
      };

      setAiChats((previous) => ({
        ...previous,
        [finding.id]: [
          ...(previous[finding.id] ?? []),
          errorTurn,
        ],
      }));
    } finally {
      setAiLoading((previous) => ({
        ...previous,
        [finding.id]: false,
      }));
    }
  };

  const handleDownload = () => {
    const contentToDownload = isImageMode
      ? pageFindings
          .map(
            (finding) =>
              `[Marker #${finding.markerId} • ${finding.severity.toUpperCase()} RISK]\n` +
              `Location: ${finding.location || "Not specified"}\n` +
              `Flagged: "${finding.flagged_text}"\n` +
              `Explanation: ${finding.explanation}\n` +
              `Suggested replacement: "${finding.suggested_fix}"\n` +
              `Evidence: ${finding.evidence || "Not provided"}\n` +
              `Status: ${finding.status}\n`
          )
          .join("\n---\n\n")
      : documentText;

    const blob = new Blob([contentToDownload], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      `${docTitle.replace(/\s+/g, "_")}_review.txt`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopy = async () => {
    const textToCopy = isImageMode
      ? pageFindings
          .map(
            (finding) =>
              `Marker #${finding.markerId} (${finding.location || "Location not specified"}):\n` +
              `Suggested replacement: "${finding.suggested_fix}"\n` +
              `Status: ${finding.status}`
          )
          .join("\n\n")
      : documentText;

    try {
      await navigator.clipboard.writeText(textToCopy);
      alert("Copied review content to clipboard.");
    } catch {
      setReviewError(
        "Clipboard access was unavailable. Please copy the text manually."
      );
    }
  };

  const renderAnnotatedPage = (
    text: string,
    currentFindings: Finding[]
  ) => {
    if (!text) return null;

    const matching = currentFindings.filter(
      (finding) =>
        finding.flagged_text &&
        text.includes(finding.flagged_text)
    );

    if (matching.length === 0) {
      return (
        <div
          style={{
            whiteSpace: "pre-line",
            lineHeight: "1.8",
            color: "#e2e8f0",
            fontSize: "14px",
          }}
        >
          {text}
        </div>
      );
    }

    const sorted = [...matching].sort(
      (first, second) =>
        second.flagged_text.length -
        first.flagged_text.length
    );

    const escapeRegex = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(
      `(${sorted.map((finding) => escapeRegex(finding.flagged_text)).join("|")})`,
      "g"
    );

    const parts = text.split(regex);

    return (
      <div
        style={{
          whiteSpace: "pre-line",
          lineHeight: "2.1",
          color: "#e2e8f0",
          fontSize: "14px",
        }}
      >
        {parts.map((part, index) => {
          const finding = sorted.find(
            (item) => item.flagged_text === part
          );

          if (!finding) {
            return <span key={index}>{part}</span>;
          }

          if (finding.status === "dismissed") {
            return (
              <span key={index}>
                {finding.flagged_text}
              </span>
            );
          }

          if (finding.status === "resolved") {
            return (
              <span
                key={index}
                style={{
                  color: "var(--lime)",
                  fontWeight: 700,
                  textDecoration: "line-through",
                  background: "rgba(198, 244, 91, 0.15)",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  margin: "0 2px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{finding.flagged_text}</span>
                <span
                  style={{
                    fontSize: "10px",
                    background: "var(--lime)",
                    color: "#080a1c",
                    borderRadius: "10px",
                    padding: "1px 5px",
                    fontWeight: 800,
                  }}
                >
                  ✓ Addressed
                </span>
              </span>
            );
          }

          const isSelected =
            activeMarkerId === finding.markerId;

          return (
            <button
              key={index}
              type="button"
              ref={(element) => {
                markerRefs.current[finding.markerId] =
                  element;
              }}
              className={`review-issue-text ${finding.severity} ${isSelected ? "active" : ""}`}
              onClick={() => {
                setActiveMarkerId(finding.markerId);
                setIsEditingManually(false);
              }}
              style={{
                cursor: "pointer",
                padding: "3px 8px",
                borderRadius: "6px",
                fontWeight: 700,
                margin: "0 3px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                border: isSelected
                  ? "2px solid #12c4d4"
                  : "1.5px dashed #ef4444",
                background: isSelected
                  ? "rgba(18, 196, 212, 0.3)"
                  : "rgba(239, 68, 68, 0.22)",
                transition: "all 150ms ease",
              }}
            >
              <span>{finding.flagged_text}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  background:
                    finding.severity === "high"
                      ? "#ef4444"
                      : finding.severity === "medium"
                        ? "#f59e0b"
                        : "#64748b",
                  color: "#ffffff",
                  borderRadius: "50%",
                  width: "20px",
                  height: "20px",
                  fontWeight: 900,
                  flexShrink: 0,
                }}
              >
                {finding.markerId}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const clearedAssetsCount = bulkQueue.filter(
    (asset) => asset.cleared
  ).length;

  const activeQueueIndex = bulkQueue.findIndex(isCurrent);

  const nextUnclearedAsset =
    bulkQueue.find(
      (asset, index) =>
        index > activeQueueIndex && !asset.cleared
    ) ||
    bulkQueue.find(
      (asset) => !isCurrent(asset) && !asset.cleared
    );

  const nextAsset =
    bulkQueue.length > 1
      ? bulkQueue[
          (Math.max(activeQueueIndex, 0) + 1) %
            bulkQueue.length
        ]
      : undefined;

  const prevAsset =
    bulkQueue.length > 1
      ? bulkQueue[
          (Math.max(activeQueueIndex, 0) -
            1 +
            bulkQueue.length) %
            bulkQueue.length
        ]
      : undefined;

  const isAuditIncomplete = [
    "failed",
    "incomplete analysis",
  ].includes(auditStatus.toLowerCase());

  const openCount = pageFindings.filter(
    (finding) => finding.status === "open"
  ).length;

  const resolvedCount = pageFindings.filter(
    (finding) => finding.status === "resolved"
  ).length;

  const dismissedCount = pageFindings.filter(
    (finding) => finding.status === "dismissed"
  ).length;

  return (
    <div className="page">
      <style>{`
        @keyframes connector-dash {
          to { stroke-dashoffset: -24; }
        }
      `}</style>

      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        style={{ display: "none" }}
      />

      {onBackToHome && (
        <button
          type="button"
          className="secondary-button"
          onClick={onBackToHome}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 16 }}
        >
          <ArrowLeft size={16} /> Back
        </button>
      )}

      <div
        role="note"
        style={{
          marginBottom: "16px",
          padding: "11px 14px",
          borderRadius: "10px",
          border: "1px solid rgba(18, 196, 212, 0.35)",
          background: "rgba(18, 196, 212, 0.07)",
          color: "#cbd5e1",
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "#12c4d4" }}>Review scope:</strong> Results cover only the active rules you provide, approve from uploaded guidelines, or choose from templates. Content is not checked against every law, standard, or factual source. This review is not a certification or guarantee of compliance; verify the rules and supporting evidence that apply.
      </div>

      {/* Batch import queue */}
      {bulkQueue.length > 0 && (
        <div
          style={{
            background:
              "linear-gradient(180deg, #101535 0%, #080a1c 100%)",
            border: "1.5px solid #12c4d4",
            borderRadius: "16px",
            padding: "16px 20px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <div
                style={{
                  background: "rgba(18, 196, 212, 0.2)",
                  color: "#12c4d4",
                  borderRadius: "8px",
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: 800,
                  fontSize: "13px",
                }}
              >
                <Layers size={16} /> BATCH IMPORT QUEUE
              </div>

              <span
                style={{
                  fontSize: "13px",
                  color: "#94a3b8",
                  fontWeight: 600,
                }}
              >
                File {Math.max(activeQueueIndex, 0) + 1} of{" "}
                {bulkQueue.length} · {clearedAssetsCount} cleared
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {clearedAssetsCount === bulkQueue.length && (
                <span
                  style={{
                    background: "rgba(198, 244, 91, 0.2)",
                    color: "#c6f45b",
                    border: "1px solid #c6f45b",
                    padding: "6px 14px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 800,
                  }}
                >
                  All queue items marked cleared
                </span>
              )}

              {prevAsset && (
                <button
                  onClick={() =>
                    handleSwitchBulkAsset(prevAsset)
                  }
                  style={{
                    background: "#171b35",
                    color: "#12c4d4",
                    border: "1.5px solid #12c4d4",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  ← Prev
                </button>
              )}

              {nextAsset && (
                <button
                  onClick={() =>
                    handleSwitchBulkAsset(nextAsset)
                  }
                  style={{
                    background: "#171b35",
                    color: "#12c4d4",
                    border: "1.5px solid #12c4d4",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Next →{" "}
                  {nextAsset.name.length > 25
                    ? `${nextAsset.name.slice(0, 23)}…`
                    : nextAsset.name}
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              overflowX: "auto",
              paddingBottom: "6px",
            }}
          >
            {bulkQueue.map((asset, index) => {
              const active = isCurrent(asset);

              return (
                <div
                  key={asset.id || index}
                  onClick={() =>
                    handleSwitchBulkAsset(asset)
                  }
                  style={{
                    flex: "0 0 240px",
                    background: active
                      ? "rgba(18, 196, 212, 0.15)"
                      : "#0c1024",
                    border: active
                      ? "2px solid #12c4d4"
                      : asset.cleared
                        ? "1.5px solid #c6f45b80"
                        : "1px solid #252a48",
                    borderRadius: "10px",
                    padding: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: active ? "#12c4d4" : "#94a3b8",
                        fontWeight: 700,
                      }}
                    >
                      QUEUE #{index + 1}
                    </span>

                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 800,
                        color: asset.cleared
                          ? "#c6f45b"
                          : active
                            ? "#12c4d4"
                            : "#94a3b8",
                      }}
                    >
                      {asset.cleared
                        ? "✓ CLEARED"
                        : active
                          ? "● ONGOING"
                          : "⏳ IN QUEUE"}
                    </span>
                  </div>

                  <strong
                    style={{
                      fontSize: "13px",
                      color: active ? "#ffffff" : "#cbd5e1",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {asset.name}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header and view toggle */}
      <div
        className="section-heading"
        style={{ marginBottom: "20px" }}
      >
        <div>
          <span className="eyebrow">
            PRE-FLIGHT RELEASE GATE
          </span>
          <h2>Automated Claims &amp; Content Review</h2>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              padding: "6px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 800,
              background:
                riskLevel === "High Risk"
                  ? "rgba(239, 68, 68, 0.2)"
                  : riskLevel === "Medium Risk"
                    ? "rgba(245, 158, 11, 0.2)"
                    : isAuditIncomplete
                      ? "rgba(239, 68, 68, 0.2)"
                      : ["compliant", "passed"].includes(
                            auditStatus.toLowerCase()
                          )
                        ? "rgba(198, 244, 91, 0.2)"
                        : "rgba(148, 163, 184, 0.16)",
              color:
                riskLevel === "High Risk"
                  ? "#ef4444"
                  : riskLevel === "Medium Risk"
                    ? "#f59e0b"
                    : isAuditIncomplete
                      ? "#ef4444"
                      : ["compliant", "passed"].includes(
                            auditStatus.toLowerCase()
                          )
                        ? "var(--lime)"
                        : "#94a3b8",
              border: `1px solid ${
                riskLevel === "High Risk"
                  ? "#ef4444"
                  : riskLevel === "Medium Risk"
                    ? "#f59e0b"
                    : isAuditIncomplete
                      ? "#ef4444"
                      : ["compliant", "passed"].includes(
                            auditStatus.toLowerCase()
                          )
                        ? "var(--lime)"
                        : "#64748b"
              }`,
            }}
          >
            {isAuditIncomplete
              ? "⚠️ ANALYSIS INCOMPLETE"
              : ["compliant", "passed"].includes(
                    auditStatus.toLowerCase()
                  )
                ? `🛡️ ${riskLevel.toUpperCase()}`
                : `ⓘ ${riskLevel.toUpperCase()}`}
          </span>

          <span
            style={{
              fontSize: "12px",
              color: "#94a3b8",
              fontWeight: 600,
            }}
          >
            Status:{" "}
            <strong style={{ color: "#fff" }}>
              {auditStatus}
            </strong>
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            background: "var(--surface)",
            padding: "4px",
            borderRadius: "12px",
            border: "1px solid var(--border)",
          }}
        >
          <button
            onClick={() => setViewMode("creative")}
            className={
              viewMode === "creative"
                ? "primary-button"
                : "secondary-button"
            }
            style={{
              minHeight: "36px",
              fontSize: "12px",
              padding: "8px 14px",
            }}
          >
            🎨 Creative Art View
          </button>

          <button
            onClick={() => setViewMode("graph")}
            className={
              viewMode === "graph"
                ? "primary-button"
                : "secondary-button"
            }
            style={{
              minHeight: "36px",
              fontSize: "12px",
              padding: "8px 14px",
            }}
          >
            🕸️ Interactive Knowledge Graph
          </button>
        </div>
      </div>

      {correctionNotice && (
        <div
          role="status"
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            borderRadius: "8px",
            border: "1px solid rgba(198, 244, 91, 0.45)",
            background: "rgba(198, 244, 91, 0.08)",
            color: "var(--lime)",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          {correctionNotice}
          <button
            onClick={() => setCorrectionNotice(null)}
            aria-label="Dismiss correction result"
            style={{
              float: "right",
              background: "transparent",
              color: "var(--lime)",
              border: "none",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            borderRadius: "8px",
            border: "1px solid rgba(239, 68, 68, 0.6)",
            background: "rgba(239, 68, 68, 0.08)",
            color: "#ffb4a9",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          <strong>Notice:</strong> {errorMessage}
          <button
            onClick={() => setReviewError(null)}
            aria-label="Dismiss notice"
            style={{
              float: "right",
              background: "transparent",
              color: "#ffb4a9",
              border: "none",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {viewMode === "graph" ? (
        <GraphView
          findings={findings}
          documentText={documentText}
          docTitle={docTitle}
          pages={pages}
          totalPages={totalPages}
          currentPage={currentPage}
          onNavigateToPage={(pageNumber, markerId) => {
            handlePageChange(pageNumber);

            if (markerId) {
              setActiveMarkerId(markerId);
            }

            setViewMode("creative");
          }}
        />
      ) : (
        <div className="review-layout">
          {/* Left: document and findings */}
          <div
            className="review-visual-workspace"
            ref={containerRef}
            style={{ position: "relative" }}
          >
            <div className="creative-preview">
              <div
                className="creative-topline"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  SCANNED MARKETING ASSET{" "}
                  {isImageMode ? "• VISUAL AD CREATIVE" : ""}
                </span>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <span>
                    {openCount} OPEN · {resolvedCount} RESOLVED ·{" "}
                    {dismissedCount} DISMISSED
                  </span>

                  {isImageMode && (
                    <button
                      className="secondary-button"
                      onClick={() =>
                        imageFileInputRef.current?.click()
                      }
                      style={{
                        minHeight: "26px",
                        padding: "3px 8px",
                        fontSize: "10px",
                        borderColor: "var(--cyan)",
                        color: "var(--cyan)",
                      }}
                    >
                      <Upload
                        size={11}
                        style={{ marginRight: 4 }}
                      />
                      Change Image
                    </button>
                  )}

                  <button
                    className="icon-button"
                    onClick={() => setIsFullscreen(true)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#12c4d4",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                    }}
                  >
                    <Maximize2 size={13} /> Fullscreen
                  </button>
                </div>
              </div>

              {totalPages > 1 && !isImageMode && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 14px",
                    background: "#080a1c",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "12px",
                  }}
                >
                  <span
                    style={{
                      color: "#94a3b8",
                      fontWeight: 600,
                    }}
                  >
                    📄 Document:{" "}
                    <strong style={{ color: "#fff" }}>
                      Page {currentPage} of {totalPages}
                    </strong>
                  </span>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <button
                      className="icon-button"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        handlePageChange(currentPage - 1)
                      }
                    >
                      <ChevronLeft size={14} />
                    </button>

                    {Array.from({ length: totalPages }).map(
                      (_, index) => (
                        <button
                          key={index}
                          onClick={() =>
                            handlePageChange(index + 1)
                          }
                          style={{
                            background:
                              currentPage === index + 1
                                ? "#12c4d4"
                                : "#171b35",
                            color:
                              currentPage === index + 1
                                ? "#080a1c"
                                : "#94a3b8",
                            border: "none",
                            borderRadius: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          P.{index + 1}
                        </button>
                      )
                    )}

                    <button
                      className="icon-button"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        handlePageChange(currentPage + 1)
                      }
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              <div
                className="creative-art"
                style={{
                  maxHeight: "440px",
                  overflowY: "auto",
                  padding: isImageMode ? "14px" : "28px",
                }}
              >
                {isImageMode && imageUrl ? (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      borderRadius: "10px",
                      overflow: "hidden",
                      background: "#080a1c",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt="Scanned marketing asset"
                      style={{
                        width: "100%",
                        maxHeight: "400px",
                        objectFit: "contain",
                        borderRadius: "8px",
                      }}
                    />

                    {pageFindings.map((finding) => {
                      if (
                        finding.pinX == null ||
                        finding.pinY == null ||
                        !Number.isFinite(finding.pinX) ||
                        !Number.isFinite(finding.pinY) ||
                        finding.pinX < 0 ||
                        finding.pinX > 100 ||
                        finding.pinY < 0 ||
                        finding.pinY > 100
                      ) {
                        return null;
                      }

                      const selected =
                        activeMarkerId === finding.markerId;

                      return (
                        <button
                          key={finding.id}
                          type="button"
                          ref={(element) => {
                            markerRefs.current[finding.markerId] =
                              element;
                          }}
                          onClick={() => {
                            setActiveMarkerId(finding.markerId);
                            setIsEditingManually(false);
                          }}
                          aria-label={`Finding ${finding.markerId}`}
                          style={{
                            position: "absolute",
                            left: `${finding.pinX}%`,
                            top: `${finding.pinY}%`,
                            transform: "translate(-50%, -50%)",
                            cursor: "pointer",
                            border: selected
                              ? "3px solid #12c4d4"
                              : "2px solid #ffffff",
                            borderRadius: "50%",
                            width: "32px",
                            height: "32px",
                            background:
                              finding.status === "resolved"
                                ? "var(--lime)"
                                : finding.severity === "high"
                                  ? "#ef4444"
                                  : finding.severity === "medium"
                                    ? "#f59e0b"
                                    : "#64748b",
                            color:
                              finding.status === "resolved"
                                ? "#080a1c"
                                : "#ffffff",
                            fontWeight: 900,
                            fontSize: "14px",
                            display: "grid",
                            placeItems: "center",
                            boxShadow: selected
                              ? "0 0 20px #12c4d4"
                              : "0 4px 12px rgba(0,0,0,0.7)",
                            zIndex: selected ? 10 : 5,
                          }}
                        >
                          {finding.status === "resolved"
                            ? "✓"
                            : finding.markerId}
                        </button>
                      );
                    })}

                    {/* Findings tray, including findings without real pins */}
                    {pageFindings.length > 0 && (
                      <div
                        style={{
                          width: "100%",
                          marginTop: "10px",
                          display: "flex",
                          gap: "6px",
                          flexWrap: "wrap",
                          background: "rgba(8, 10, 28, 0.88)",
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border:
                            "1px solid rgba(255, 255, 255, 0.15)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            color: "#94a3b8",
                            alignSelf: "center",
                            fontWeight: 700,
                            marginRight: "4px",
                          }}
                        >
                          {pageFindings.some(
                            (finding) =>
                              finding.pinX != null &&
                              finding.pinY != null &&
                              finding.pinX >= 0 &&
                              finding.pinX <= 100 &&
                              finding.pinY >= 0 &&
                              finding.pinY <= 100
                          )
                            ? "Markers / findings:"
                            : "Findings (no verified pin):"}
                        </span>

                        {pageFindings.map((finding) => {
                          const selected =
                            activeMarkerId === finding.markerId;

                          return (
                            <button
                              key={finding.id}
                              type="button"
                              ref={(element) => {
                                if (
                                  finding.pinX == null ||
                                  finding.pinY == null
                                ) {
                                  markerRefs.current[
                                    finding.markerId
                                  ] = element;
                                }
                              }}
                              onClick={() => {
                                setActiveMarkerId(
                                  finding.markerId
                                );
                                setIsEditingManually(false);
                              }}
                              style={{
                                background: selected
                                  ? "#12c4d4"
                                  : finding.status === "resolved"
                                    ? "rgba(198, 244, 91, 0.2)"
                                    : "#1e293b",
                                color: selected
                                  ? "#080a1c"
                                  : finding.status === "resolved"
                                    ? "var(--lime)"
                                    : "#fff",
                                border: selected
                                  ? "1.5px solid #12c4d4"
                                  : "1px solid #334155",
                                borderRadius: "6px",
                                padding: "3px 8px",
                                fontSize: "11px",
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              #{finding.markerId}{" "}
                              {finding.status === "resolved"
                                ? "✓"
                                : `(${finding.severity.toUpperCase()})`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ width: "100%" }}>
                    <span className="creative-kicker">
                      {docTitle.toUpperCase()}
                    </span>
                    <h2
                      style={{
                        fontSize: "22px",
                        margin: "4px 0 16px 0",
                        color: "#ffffff",
                      }}
                    >
                      {docTitle}
                    </h2>
                    {renderAnnotatedPage(
                      originalPageText,
                      pageFindings
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Animated connector */}
            {arrowPath && (
              <svg
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  zIndex: 10,
                  overflow: "visible",
                }}
              >
                <defs>
                  <marker
                    id="review-arrowhead"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                  >
                    <polygon
                      points="0 1, 8 4, 0 7"
                      fill="#12c4d4"
                    />
                  </marker>
                </defs>

                <path
                  d={arrowPath}
                  fill="none"
                  stroke="#12c4d4"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="6 6"
                  markerEnd="url(#review-arrowhead)"
                  style={{
                    animation:
                      "connector-dash 650ms linear infinite",
                  }}
                />
              </svg>
            )}

            {/* Magic Fix panel */}
            <div
              className="magic-fix-panel"
              ref={fixPanelRef}
            >
              {isAuditIncomplete ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px 10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "32px",
                      marginBottom: "8px",
                    }}
                  >
                    ⚠️
                  </div>

                  <strong
                    style={{
                      color: "#ef4444",
                      fontSize: "16px",
                      display: "block",
                    }}
                  >
                    Analysis Incomplete or Failed
                  </strong>

                  <p
                    className="muted"
                    style={{
                      fontSize: "12px",
                      marginTop: "8px",
                      lineHeight: "1.6",
                    }}
                  >
                    {errorMessage ||
                      "The asset could not be fully verified. Missing findings do not indicate compliance."}
                  </p>

                  <div style={{ marginTop: "12px" }}>
                    <span
                      className="pill"
                      style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        color: "#ef4444",
                        border: "1px solid #ef4444",
                        fontSize: "11px",
                      }}
                    >
                      STATUS: {auditStatus.toUpperCase()}
                    </span>
                  </div>
                </div>
              ) : findings.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px 10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "32px",
                      marginBottom: "8px",
                    }}
                  >
                    ⓘ
                  </div>

                  <strong
                    style={{
                      color: "var(--cyan)",
                      fontSize: "16px",
                      display: "block",
                    }}
                  >
                    {auditStatus === "Awaiting audit"
                      ? "No review loaded"
                      : /incomplete|failed/i.test(auditStatus)
                        ? "Analysis incomplete"
                        : auditStatus === "Compliant"
                          ? "No active-rule findings"
                          : "No Findings Returned"}
                  </strong>

                  <p
                    className="muted"
                    style={{
                      fontSize: "12px",
                      marginTop: "8px",
                      lineHeight: "1.6",
                    }}
                  >
                    {errorMessage ||
                      (auditStatus === "Awaiting audit"
                        ? "Choose an asset from Home and run a review to see its results."
                        : auditStatus === "Compliant"
                          ? "The completed audit returned no findings against the active rules. Review the audit status before release."
                          : "An empty findings list is not a compliance pass. Check the audit status and active rules, then retry from Home if analysis did not complete.")}
                  </p>

                  <div style={{ marginTop: "12px" }}>
                    <span
                      className="pill"
                      style={{
                        background: "rgba(18, 196, 212, 0.12)",
                        color: "var(--cyan)",
                        border: "1px solid var(--cyan)",
                        fontSize: "11px",
                      }}
                    >
                      STATUS: {auditStatus.toUpperCase()}
                    </span>
                  </div>

                  {nextUnclearedAsset && (
                    <button
                      onClick={() =>
                        handleSwitchBulkAsset(nextUnclearedAsset)
                      }
                      className="primary-button"
                      style={{
                        marginTop: "16px",
                        background: "var(--lime)",
                        color: "#080a1c",
                        fontWeight: 800,
                      }}
                    >
                      Audit Next Asset in Queue →
                    </button>
                  )}

                  {auditStatus !== "Compliant" && onBackToHome && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ marginTop: "12px" }}
                      onClick={onBackToHome}
                    >
                      Return to asset intake
                    </button>
                  )}
                </div>
              ) : allPageResolved ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px 0",
                  }}
                >
                  <div style={{ fontSize: "28px" }}>✓</div>

                  <strong
                    style={{
                      color: "var(--lime)",
                      fontSize: "15px",
                    }}
                  >
                    All Current Findings Addressed
                  </strong>

                  <p
                    className="muted"
                    style={{
                      fontSize: "12px",
                      marginTop: "4px",
                    }}
                  >
                    The listed findings have been resolved or
                    dismissed. Run a fresh audit before treating
                    this asset as compliant.
                  </p>

                  {nextUnclearedAsset && (
                    <button
                      onClick={() =>
                        handleSwitchBulkAsset(nextUnclearedAsset)
                      }
                      className="primary-button"
                      style={{
                        marginTop: "12px",
                        background: "var(--lime)",
                        color: "#080a1c",
                        fontWeight: 800,
                      }}
                    >
                      Audit Next Asset in Queue →
                    </button>
                  )}
                </div>
              ) : activeFinding ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "12px",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span>🪄</span>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: "14px",
                          color: "var(--cyan)",
                        }}
                      >
                        Review Finding #{activeFinding.markerId}
                      </span>
                    </div>

                    <span
                      className="pill legend-high"
                      style={{ fontSize: "10px" }}
                    >
                      {activeFinding.severity.toUpperCase()} RISK
                      {activeFinding.page
                        ? ` • PAGE ${activeFinding.page}`
                        : ""}
                    </span>
                  </div>

                  <div
                    style={{
                      background: "rgba(18, 196, 212, 0.08)",
                      border:
                        "1px solid rgba(18, 196, 212, 0.25)",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      marginBottom: "12px",
                      fontSize: "12px",
                    }}
                  >
                    <strong style={{ color: "var(--cyan)" }}>
                      📍 ELEMENT:{" "}
                    </strong>

                    <span style={{ color: "#ffffff" }}>
                      {activeFinding.location ||
                        `Marker #${activeFinding.markerId}`}
                      {activeFinding.page
                        ? ` (Page ${activeFinding.page})`
                        : ""}
                      {activeFinding.pinX != null &&
                      activeFinding.pinY != null &&
                      activeFinding.pinX >= 0 &&
                      activeFinding.pinX <= 100 &&
                      activeFinding.pinY >= 0 &&
                      activeFinding.pinY <= 100
                        ? ` • Pin: (${activeFinding.pinX}%, ${activeFinding.pinY}%)`
                        : " • Exact visual pin unavailable"}
                    </span>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <span
                      className="magic-fix-label"
                      style={{ color: "#ef4444" }}
                    >
                      📝 FLAGGED COPY:
                    </span>

                    <div
                      style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        border:
                          "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        color: "#ff987e",
                        fontSize: "13px",
                        fontWeight: 700,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {activeFinding.flagged_text || (
                        <span>
                          This is a missing-content finding, not a quoted phrase.
                          Add the required wording to the document and run the review again.
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <span
                      className="magic-fix-label"
                      style={{ color: "#f87171" }}
                    >
                      ❌ EXPLANATION:
                    </span>

                    <div
                      style={{
                        background: "rgba(239, 68, 68, 0.06)",
                        borderLeft: "3px solid #ef4444",
                        padding: "10px 14px",
                        color: "#e2e8f0",
                        fontSize: "12px",
                        lineHeight: "1.6",
                      }}
                    >
                      {activeFinding.explanation ||
                        "No explanation was supplied by the audit."}
                    </div>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <span
                      className="magic-fix-label"
                      style={{ color: "var(--cyan)" }}
                    >
                      📚 EVIDENCE:
                    </span>

                    <div
                      style={{
                        background: "rgba(18, 196, 212, 0.06)",
                        border:
                          "1px solid rgba(18, 196, 212, 0.25)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        color: "#e2e8f0",
                        fontSize: "12px",
                        lineHeight: "1.6",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {activeFinding.evidence ||
                        "No supporting evidence was supplied."}
                    </div>
                  </div>

                  <div style={{ marginBottom: "14px" }}>
                    <span
                      className="magic-fix-label"
                      style={{ color: "var(--lime)" }}
                    >
                      ✨ AI-PROPOSED REPLACEMENT:
                    </span>

                    <div
                      style={{
                        background: "rgba(198, 244, 91, 0.1)",
                        border:
                          "1px solid rgba(198, 244, 91, 0.4)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        color: "var(--lime)",
                        fontSize: "13px",
                        fontWeight: 700,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {activeFinding.suggestion_status === "suggestion_ready" &&
                      activeFinding.suggested_fix
                        ? activeFinding.suggested_fix
                        : "No replacement has been generated for this finding."}
                    </div>
                    {activeFinding.suggestion_status === "suggestion_ready" && (
                      <div
                        style={{
                          marginTop: "8px",
                          color: "#cbd5e1",
                          fontSize: "12px",
                          lineHeight: "1.5",
                        }}
                      >
                        <div>{activeFinding.suggestion_explanation}</div>
                        {activeFinding.suggestion_change_summary && (
                          <div style={{ marginTop: "4px" }}>
                            Change: {activeFinding.suggestion_change_summary}
                          </div>
                        )}
                        <strong style={{ display: "block", marginTop: "5px" }}>
                          Apply AI Suggestion replaces the flagged copy with this wording.
                        </strong>
                      </div>
                    )}
                    {activeFinding.suggestion_status === "needs_information" && (
                      <div
                        role="status"
                        style={{ marginTop: "8px", color: "#fbbf24", fontSize: "12px" }}
                      >
                        <div>{activeFinding.suggestion_explanation}</div>
                        {activeFinding.suggestion_missing_information.length > 0 && (
                          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                            {activeFinding.suggestion_missing_information.map((item, index) => (
                              <li key={`${activeFinding.id}-missing-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {activeFinding.suggestion_status === "no_safe_replacement" && (
                      <div
                        role="status"
                        style={{ marginTop: "8px", color: "#fbbf24", fontSize: "12px" }}
                      >
                        {activeFinding.suggestion_explanation}
                        {activeFinding.suggestion_missing_information.length > 0 && (
                          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                            {activeFinding.suggestion_missing_information.map((item, index) => (
                              <li key={`${activeFinding.id}-required-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {suggestionLoading[activeFinding.id] && (
                      <div
                        role="status"
                        aria-live="polite"
                        style={{ marginTop: "8px", color: "var(--cyan)", fontSize: "12px" }}
                      >
                        Generating and validating a context-aware suggestion…
                      </div>
                    )}
                    {suggestionFailures[activeFinding.id] && (
                      <div
                        role="alert"
                        style={{ marginTop: "8px", color: "#fca5a5", fontSize: "12px" }}
                      >
                        {suggestionFailures[activeFinding.id].status === "invalid_suggestion"
                          ? "The suggestion could not be validated. "
                          : "Suggestion generation failed. "}
                        {suggestionFailures[activeFinding.id].message}
                      </div>
                    )}
                  </div>

                  {isEditingManually && (
                    <div style={{ marginBottom: "14px" }}>
                      <span
                        className="magic-fix-label"
                        style={{ color: "var(--lime)" }}
                      >
                        {activeFinding.suggestion_status === "suggestion_ready"
                          ? "✍️ REVIEW & CONFIRM AI SUGGESTION:"
                            : activeFinding.suggestion_draft
                              ? "✍️ REVIEW & EDIT AI DRAFT:"
                              : "✍️ ENTER A MANUAL REPLACEMENT:"}
                        </span>
                        {activeFinding.suggestion_status !== "suggestion_ready" && (
                        <p
                          style={{
                            margin: "4px 0 8px",
                            color: "#fbbf24",
                            fontSize: "12px",
                            lineHeight: 1.5,
                          }}
                        >
                            {activeFinding.suggestion_draft
                              ? "This AI draft did not pass all deterministic checks. Review or edit it; it must pass the active rules before it can be applied."
                              : "No AI draft is available. Enter a candidate here; it will be checked against the active rules before it can be applied."}
                          </p>
                        )}
                      <textarea
                        value={manualText}
                        onChange={(event) =>
                          setManualText(event.target.value)
                        }
                        placeholder={
                          activeFinding.suggestion_status === "suggestion_ready" ||
                          activeFinding.suggestion_draft
                            ? "Review or edit the AI suggestion, then confirm to update the advertisement."
                            : "Enter a replacement for review and rule validation."
                        }
                        autoFocus
                        rows={3}
                        style={{
                          width: "100%",
                          background: "#080a1c",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "10px",
                          color: "#fff",
                        }}
                      />

                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginTop: "8px",
                        }}
                      >
                        <button
                          className="primary-button"
                          disabled={
                            Boolean(fixSaving[activeFinding.id]) ||
                            !manualText.trim()
                          }
                          onClick={() =>
                            handleSaveManualEdit(activeFinding.id)
                          }
                        >
                          {fixSaving[activeFinding.id]
                            ? "Applying..."
                            : "Confirm"}
                        </button>

                        <button
                          className="secondary-button"
                          onClick={() => {
                            setIsEditingManually(false);
                            setManualText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <button
                      className="primary-button"
                      disabled={
                        Boolean(fixSaving[activeFinding.id]) ||
                        Boolean(suggestionLoading[activeFinding.id]) ||
                        isEditingManually ||
                        !activeFinding.flagged_text.trim()
                      }
                      onClick={() =>
                        void handleApplyAiSuggestion(activeFinding.id)
                      }
                      style={{
                        background: "var(--lime)",
                        color: "#080a1c",
                        fontWeight: 800,
                      }}
                    >
                      <Sparkles
                        size={14}
                        style={{ marginRight: 6 }}
                      />
                      {suggestionLoading[activeFinding.id]
                        ? "Generating & applying…"
                        : fixSaving[activeFinding.id]
                          ? "Applying…"
                          : "Apply AI Suggestion"}
                    </button>

                    <button
                      className="secondary-button"
                      disabled={
                        Boolean(fixSaving[activeFinding.id]) ||
                        Boolean(suggestionLoading[activeFinding.id]) ||
                        !activeFinding.flagged_text.trim()
                      }
                      onClick={() => {
                        setManualText(
                          activeFinding.suggestion_status === "suggestion_ready"
                            ? activeFinding.suggested_fix
                            : activeFinding.suggestion_draft
                        );
                        setIsEditingManually(true);
                      }}
                    >
                      <Edit3
                        size={14}
                        style={{ marginRight: 6 }}
                      />
                      Manual Edit
                    </button>

                    <button
                      className="secondary-button"
                      disabled={
                        Boolean(fixSaving[activeFinding.id]) ||
                        Boolean(suggestionLoading[activeFinding.id])
                      }
                      onClick={() => void handleIgnoreOnce(activeFinding.id)}
                    >
                      <EyeOff
                        size={14}
                        style={{ marginRight: 6 }}
                      />
                      {fixSaving[activeFinding.id] ? "Saving decision…" : "Dismiss Finding"}
                    </button>

                    <button
                      className="secondary-button"
                      disabled={
                        Boolean(fixSaving[activeFinding.id]) ||
                        Boolean(suggestionLoading[activeFinding.id])
                      }
                      onClick={() => void handleIgnoreAll(activeFinding)}
                    >
                      {fixSaving[activeFinding.id] ? "Saving decision…" : "Dismiss Matching Findings"}
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() => handleAskAi(activeFinding)}
                      disabled={
                        Boolean(aiLoading[activeFinding.id])
                      }
                      style={{
                        borderColor: "var(--cyan)",
                        color: "var(--cyan)",
                      }}
                    >
                      {aiLoading[activeFinding.id]
                        ? "Analyzing..."
                        : "🤖 Ask AI"}
                    </button>
                  </div>

                  {(aiChats[activeFinding.id] ?? []).map(
                    (turn, index) => (
                      <div
                        key={index}
                        style={{
                          marginTop: "8px",
                          background: "rgba(18, 196, 212, 0.08)",
                          border: "1px solid var(--cyan)",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontSize: "12px",
                          color: "#e2e8f0",
                          overflowWrap: "anywhere",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        <strong
                          style={{
                            color: "var(--cyan)",
                            display: "block",
                            marginBottom: "4px",
                          }}
                        >
                          {turn.role === "user"
                            ? "You asked:"
                            : "AI response:"}
                        </strong>
                        {turn.text}
                      </div>
                    )
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <input
                      type="text"
                      value={aiInputs[activeFinding.id] ?? ""}
                      onChange={(event) =>
                        setAiInputs((previous) => ({
                          ...previous,
                          [activeFinding.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey
                        ) {
                          event.preventDefault();
                          handleAskAi(
                            activeFinding,
                            aiInputs[activeFinding.id] ?? ""
                          );
                        }
                      }}
                      placeholder="Ask a compliance follow-up..."
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        color: "#fff",
                        fontSize: "12px",
                      }}
                    />

                    <button
                      className="secondary-button"
                      disabled={
                        Boolean(aiLoading[activeFinding.id]) ||
                        !(aiInputs[activeFinding.id] ?? "").trim()
                      }
                      onClick={() =>
                        handleAskAi(
                          activeFinding,
                          aiInputs[activeFinding.id] ?? ""
                        )
                      }
                      style={{
                        borderColor: "var(--cyan)",
                        color: "var(--cyan)",
                      }}
                    >
                      Send
                    </button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  Select a finding to review it.
                </div>
              )}
            </div>
          </div>

          {/* Right: updated specification and preview */}
          <div className="review-document-workspace">
            <div className="updated-ad-card">
              <div
                className="creative-topline"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  UPDATED ADVERTISEMENT &amp; REVISED SPECIFICATIONS
                </span>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="icon-button"
                    onClick={handleCopy}
                    style={{
                      border: "1px solid var(--border)",
                      color: "#94a3b8",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    <Copy size={12} /> Copy
                  </button>

                  <button
                    className="icon-button"
                    onClick={handleDownload}
                    style={{
                      border: "1px solid var(--border)",
                      color: "var(--cyan)",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    <Download size={12} /> Download
                  </button>
                </div>
              </div>

              <div
                style={{
                  padding: "20px",
                  maxHeight: "560px",
                  overflowY: "auto",
                }}
              >
                {isImageMode && imageUrl ? (
                  <div>
                    <img
                      src={imageUrl}
                      alt="Marketing asset preview"
                      style={{
                        width: "100%",
                        maxHeight: "240px",
                        objectFit: "contain",
                        borderRadius: "8px",
                        marginBottom: "16px",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      {pageFindings.map((finding) => (
                        <div
                          key={finding.id}
                          style={{
                            background:
                              finding.status === "resolved"
                                ? "rgba(198, 244, 91, 0.08)"
                                : "#101329",
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            padding: "10px 14px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "8px",
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#fff",
                              }}
                            >
                              Marker #{finding.markerId}:{" "}
                              {finding.location ||
                                "Location not specified"}
                            </strong>

                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 800,
                                color:
                                  finding.status === "resolved"
                                    ? "var(--lime)"
                                    : finding.status === "dismissed"
                                      ? "#94a3b8"
                                      : "#f59e0b",
                              }}
                            >
                              {finding.status === "resolved"
                                ? "✓ ADDRESSED"
                                : finding.status === "dismissed"
                                  ? "DISMISSED"
                                  : "OPEN"}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--lime)",
                              marginTop: "4px",
                              fontWeight: 700,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {finding.suggested_fix ||
                              "No replacement suggested"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#080a1c",
                      border: "1px solid var(--border)",
                      borderRadius: "10px",
                      padding: "18px",
                      color: "#f8fafc",
                      fontSize: "14px",
                      lineHeight: "2",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {activePageText ||
                      "No extracted document text is available."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen preview */}
      {isFullscreen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(3, 7, 18, 0.95)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            padding: "30px 50px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <span
              style={{
                color: "#12c4d4",
                fontWeight: 800,
                fontSize: "16px",
              }}
            >
              ⛶ THEATER MODE • {docTitle.toUpperCase()}
            </span>

            <button
              onClick={() => setIsFullscreen(false)}
              className="primary-button"
            >
              ✕ Close Fullscreen
            </button>
          </div>

          <div
            style={{
              flex: 1,
              background: "#080a1c",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              padding: "40px",
              overflowY: "auto",
              color: "#f8fafc",
              fontSize: "16px",
              lineHeight: "2",
              whiteSpace: "pre-line",
            }}
          >
            {isImageMode && imageUrl ? (
              <img
                src={imageUrl}
                alt="Fullscreen marketing asset"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  margin: "0 auto",
                }}
              />
            ) : (
              originalPageText
            )}
          </div>
        </div>
      )}
    </div>
  );
}
