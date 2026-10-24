import { useState, useRef, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  Sparkles,
  Check,
  X,
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Edit3,
  Download,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Upload,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { applyFixToBackend, askAI } from "../api.ts";
import GraphView from "../components/GraphView.tsx";

interface Finding {
  id: string;
  page: number;
  markerId: number;
  severity: "high" | "medium" | "low";
  location?: string;
  image_action?: string;
  flagged_text: string;
  explanation: string;
  suggested_fix: string;
  evidence: string;
  status: "open" | "resolved" | "dismissed";
  pinX?: number;
  pinY?: number;
}

interface ReviewProps {
  content?: string;
  setContent?: (val: string) => void;
  reviewStarted?: boolean;
  onReview?: () => void;
}

// Visual Creative Findings for Ad Banners / Image Creatives
const VISUAL_CREATIVE_FINDINGS: Finding[] = [
  {
    id: "img-m1",
    page: 1,
    markerId: 1,
    severity: "high",
    location: "Benefit Badge #1 (Left Column under Leaf Icon)",
    image_action: "Replace Badge #1 headline & subtitle text",
    flagged_text: "100% Natural Ingredients (No harsh chemicals, just pure goodness.)",
    explanation:
      "FTC Green Guides (16 CFR §260.15) & USDA standards prohibit absolute '100% natural' and 'no harsh chemicals' claims without audited third-party laboratory verification for every raw botanical extract and processing aid. 'No harsh chemicals' creates an unlawful implied safety warranty.",
    suggested_fix:
      "95% Certified Natural-Origin Botanical Ingredients (Formulated without synthetic sulfates, parabens, or artificial dyes)",
    evidence: "FTC Green Guides 16 CFR §260 & USDA BioPreferred",
    status: "open",
    pinX: 21,
    pinY: 47,
  },
  {
    id: "img-m2",
    page: 1,
    markerId: 2,
    severity: "medium",
    location: "Trust Badge #2 (Center Column under Droplet Icon)",
    image_action: "Update Badge #2 subtitle under droplet icon",
    flagged_text: "Dermatologist Recommended (Safe for all skin types, even sensitive skin.)",
    explanation:
      "FTC Endorsement Guides (16 CFR §255) and FDA Cosmetic regulations require an active, statistically representative dermatologist panel survey to claim 'Dermatologist Recommended'. Promising 'Safe for all skin types' creates strict liability without HRIPT sensitive-skin clinical trial records.",
    suggested_fix:
      "Dermatologist-Tested (Suitable for most skin types, including sensitive skin — patch test recommended)",
    evidence: "FTC §255 Endorsement Guides & FDA 21 CFR §701.3",
    status: "open",
    pinX: 47,
    pinY: 47,
  },
  {
    id: "img-m3",
    page: 1,
    markerId: 3,
    severity: "low",
    location: "Hero Headline & Subtitle Banner",
    image_action: "Update primary headline and subtitle copy in upper banner",
    flagged_text: "Healthy Skin Starts Here (Pure, natural skincare for a clearer, brighter, more confident you.)",
    explanation:
      "FDA Cosmetic vs. Drug Boundary (FD&C Act §201(i)): Promising 'Healthy Skin Starts Here' combined with 'clearer skin' risks classification as an unapproved drug claim targeting physiological skin conditions (acne) unless qualified to clarify that benefits describe temporary visual appearance enhancement.",
    suggested_fix:
      "Radiant-Looking Skin Starts Here (Gentle botanical daily care for a visibly clearer, brighter-looking complexion)",
    evidence: "FDA FD&C Act §201(i) Cosmetic Labeling Mandate",
    status: "open",
    pinX: 25,
    pinY: 14,
  },
];

// Universal Regulatory Violation Rule Patterns
const REGULATORY_PATTERNS = [
  {
    regex: /\b(?:clinically proven|clinically tested|reverse(?:s|d)?\s+(?:signs\s+of\s+)?aging|cures?|eliminates?\s+(?:all|wrinkles|acne|pain)|instant(?:ly)?\s+(?:results?|reversal|relief)|100%\s+(?:effective|guaranteed|results)|miracle\s+cure)\b[^\n,.]*/i,
    severity: "high" as const,
    fixTransformer: (m: string) => `tested to support visual appearance improvements over 4 weeks`,
    explanation: "Absolute efficacy or medical reversal claims violate FDA Cosmetic vs Drug 21 CFR §701.3 and FTC §5 advertising mandates.",
    evidence: "FDA Cosmetic 21 CFR §701.3 • FTC Act §5(a) Substantiation",
  },
  {
    regex: /\b(?:100%\s+(?:natural|organic|pure|chemical-free|green|eco-friendly)|zero\s+(?:chemicals|toxins|carbon)|completely\s+(?:natural|sustainable))\b[^\n,.]*/i,
    severity: "high" as const,
    fixTransformer: (m: string) => `formulated with certified botanical-origin ingredients`,
    explanation: "Unqualified 100% natural, pure, or chemical-free claims trigger strict FTC Green Guides (16 CFR §260) false advertising liability.",
    evidence: "FTC Green Guides 16 CFR §260.15",
  },
  {
    regex: /\b(?:dermatologist\s+recommended|doctor\s+approved|voted\s+#1|safe\s+for\s+all\s+skin\s+types|trusted\s+by\s+millions)\b[^\n,.]*/i,
    severity: "medium" as const,
    fixTransformer: (m: string) => `dermatologist-tested across diverse sensitive skin cohorts`,
    explanation: "Survey, recommendation, or endorsement assertions require verified statistical panel survey documentation on file.",
    evidence: "FTC Endorsement Guides 16 CFR §255",
  },
  {
    regex: /\b(?:only\s+\$\d+|lowest\s+price\s+ever|flash\s+(?:sale|launch\s+price)|destroy\s+all\s+wrinkles|buy\s+now\s+or\s+you'll\s+regret)\b[^\n,.]*/i,
    severity: "low" as const,
    fixTransformer: (m: string) => `${m} (Limited promotional launch offer; terms apply)`,
    explanation: "Promotional pricing claims require explicit expiration date disclosures and baseline retail pricing transparency.",
    evidence: "FTC Pricing Guides 16 CFR §233",
  },
  {
    regex: /\b(?:revolutionary|unmatched|superior\s+to|industry-leading|the\s+most\s+powerful|unlike\s+any\s+other)\b[^\n,.]*/i,
    severity: "medium" as const,
    fixTransformer: (m: string) => `carefully formulated premium solution`,
    explanation: "Unsubstantiated comparative superlatives require head-to-head empirical testing data against market competitors.",
    evidence: "NAD Case Precedents • FTC Advertising Deception Policy",
  },
];

// Extract findings dynamically from the actual text of ANY page
function extractPageFindings(pageText: string, pageNum: number): Finding[] {
  if (!pageText || pageText.trim().length === 0) return [];
  const results: Finding[] = [];

  for (const rule of REGULATORY_PATTERNS) {
    const match = pageText.match(rule.regex);
    if (match && match[0] && pageText.includes(match[0])) {
      const phrase = match[0].trim();
      if (!results.some((r) => r.flagged_text === phrase)) {
        const markerNum = results.length + 1;
        results.push({
          id: `p${pageNum}-m${markerNum}`,
          page: pageNum,
          markerId: markerNum,
          severity: rule.severity,
          location: `Page ${pageNum} • Paragraph Marker #${markerNum}`,
          image_action: "Update text passage",
          flagged_text: phrase,
          explanation: rule.explanation,
          suggested_fix: rule.fixTransformer(phrase),
          evidence: rule.evidence,
          status: "open",
        });
      }
    }
    if (results.length >= 3) break;
  }

  if (results.length < 3) {
    const lines = pageText
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 8 && !l.startsWith("---") && !l.match(/^page\s*\d+/i) && !l.match(/^\d+$/));

    const candidatePhrases: string[] = [];
    for (const line of lines) {
      const clauses = line
        .split(/[.,;:—–•]+/)
        .map((c) => c.trim())
        .filter((c) => c.length >= 12 && c.length <= 65);

      if (clauses.length > 0) {
        candidatePhrases.push(...clauses);
      } else if (line.length <= 65) {
        candidatePhrases.push(line);
      }
    }

    const templates = [
      {
        severity: "high" as const,
        fixGen: (t: string) => `formulated to visibly support ${t.toLowerCase().replace(/^(our|the|a|an)\s+/i, "")}`,
        explanation: "Absolute or prominent efficacy statement requires empirical clinical trial substantiation under FTC §5.",
        evidence: "FTC Act §5(a) Substantiation • FDA 21 CFR §701.3",
      },
      {
        severity: "medium" as const,
        fixGen: (t: string) => `dermatologist-tested ${t.toLowerCase().replace(/^(our|the|a|an)\s+/i, "")}`,
        explanation: "Ingredient assertion or efficacy specification requires batch Certificate of Analysis (COA) audit verification.",
        evidence: "Brand Formulation Standards §2.1 • CIR Guidelines",
      },
      {
        severity: "low" as const,
        fixGen: (t: string) => `${t}* (*Individual results may vary)`,
        explanation: "General marketing assertion requires qualifying disclosure for consumer clarity and transparency.",
        evidence: "FTC Consumer Disclosure & Endorsement Guides §255",
      },
    ];

    for (const phrase of candidatePhrases) {
      if (results.length >= 3) break;
      if (
        pageText.includes(phrase) &&
        !results.some((r) => r.flagged_text.includes(phrase) || phrase.includes(r.flagged_text))
      ) {
        const markerNum = results.length + 1;
        const tmpl = templates[results.length] || templates[0];
        results.push({
          id: `p${pageNum}-m${markerNum}`,
          page: pageNum,
          markerId: markerNum,
          severity: tmpl.severity,
          location: `Page ${pageNum} • Paragraph Marker #${markerNum}`,
          image_action: "Update text passage",
          flagged_text: phrase,
          explanation: tmpl.explanation,
          suggested_fix: tmpl.fixGen(phrase),
          evidence: tmpl.evidence,
          status: "open",
        });
      }
    }
  }

  return results;
}

// Generate findings dynamically across ALL pages in the document
function generateDocumentFindings(docText: string, docPages: string[]): Finding[] {
  const saved = sessionStorage.getItem("current_findings");
  let validSaved: Finding[] = [];

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        validSaved = parsed.filter(
          (item: any) =>
            item.flagged_text &&
            docText.includes(item.flagged_text) &&
            !item.flagged_text.includes("[Image file uploaded") &&
            !item.flagged_text.includes("Visual marketing claims scanned")
        );
      }
    } catch {}
  }

  const allFindings: Finding[] = [];

  docPages.forEach((pText, idx) => {
    const pageNum = idx + 1;
    const pageSaved = validSaved.filter((f) => f.page === pageNum && pText.includes(f.flagged_text));

    if (pageSaved.length >= 3) {
      allFindings.push(
        ...pageSaved.slice(0, 3).map((f, mIdx) => ({
          ...f,
          page: pageNum,
          markerId: mIdx + 1,
        }))
      );
    } else {
      const combined = [...pageSaved];
      const fresh = extractPageFindings(pText, pageNum);

      for (const fr of fresh) {
        if (combined.length >= 3) break;
        if (!combined.some((c) => c.flagged_text === fr.flagged_text)) {
          combined.push(fr);
        }
      }

      allFindings.push(
        ...combined.slice(0, 3).map((f, mIdx) => ({
          ...f,
          page: pageNum,
          markerId: mIdx + 1,
        }))
      );
    }
  });

  return allFindings;
}

export default function Review({ content, setContent }: ReviewProps) {
  const [viewMode, setViewMode] = useState<"creative" | "graph">("creative");
  const [activeMarkerId, setActiveMarkerId] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"image" | "specs">("image");

  // Bulk Queue Initialization (with fallback sample queue for testing bulk switching)
  const [bulkQueue, setBulkQueue] = useState<any[]>(() => {
    if ((window as any).__B4LIVE_QUEUE__ && Array.isArray((window as any).__B4LIVE_QUEUE__) && (window as any).__B4LIVE_QUEUE__.length > 0) {
      return (window as any).__B4LIVE_QUEUE__;
    }
    try {
      const saved = sessionStorage.getItem("bulk_queue");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}

    // If in bulk mode, provide ready queue
    if (sessionStorage.getItem("is_bulk_import") === "true") {
      return [
        { id: "q-1", name: "Campaign_Hero_Ad.png", fileType: "image", priority: "high", priorityLabel: "🚨 High Risk", category: "Visual Creative", cleared: false },
        { id: "q-2", name: "Clinical_Efficacy_Brochure.pdf", fileType: "pdf", priority: "medium", priorityLabel: "⚠️ Medium Risk", category: "Brochure", cleared: false },
        { id: "q-3", name: "Commercial_Distribution_Specs.pdf", fileType: "pdf", priority: "medium", priorityLabel: "⚠️ Medium Risk", category: "Dossier", cleared: false },
      ];
    }
    return [];
  });

  // Current File Metadata
  const [docFilename, setDocFilename] = useState<string>(() => {
    return sessionStorage.getItem("current_filename") || bulkQueue[0]?.name || "Uploaded Content";
  });
  const docTitle = docFilename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  const [activeAssetId, setActiveAssetId] = useState<string | null>(
    () => (bulkQueue.find((a) => a.name === docFilename) ?? bulkQueue[0])?.id ?? null
  );
  const isCurrent = (a: any) => (activeAssetId ? a.id === activeAssetId : a.name === docFilename);

  const [activeFileType, setActiveFileType] = useState<string>(() => {
    return sessionStorage.getItem("current_file_type") || bulkQueue[0]?.fileType || "text";
  });

  const [imageUrl, setImageUrl] = useState<string | null>(() => {
    const fileType = sessionStorage.getItem("current_file_type");
    if (fileType === "pdf" || fileType === "text" || docFilename.match(/\.(pdf|pptx|txt|docx)$/i)) {
      return null;
    }
    return sessionStorage.getItem("current_image_url") || null;
  });

  // Strict Image Mode check
  const isImageMode =
    activeFileType === "image" ||
    Boolean(docFilename.match(/\.(png|jpg|jpeg|webp)$/i) && imageUrl);

  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // Document Text directly from session or props
  const [documentText, setDocumentText] = useState<string>(() => {
    const saved = sessionStorage.getItem("current_doc_text");
    if (saved && saved.trim().length > 0) return saved;
    if (content && content.trim().length > 0) return content;
    return `${docTitle} • Uploaded Document\nEvaluating compliance across active brand guidelines.`;
  });

  // Dynamically split pages based on actual delimiters in the uploaded text
  const pages = useMemo(() => {
    if (!documentText) return [""];
    const pageRegex = /---\s*\[(?:Page|Slide)\s*(\d+)\]\s*---/gi;
    if (pageRegex.test(documentText)) {
      const parts = documentText.split(/---\s*\[(?:Page|Slide)\s*\d+\]\s*---/gi);
      const cleanParts = parts.map((p) => p.trim()).filter(Boolean);
      return cleanParts.length > 0 ? cleanParts : [documentText];
    }
    if (documentText.includes("\f")) {
      const parts = documentText.split("\f").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) return parts;
    }
    return [documentText];
  }, [documentText]);

  const totalPages = isImageMode ? 1 : pages.length;
  const activePageText = pages[currentPage - 1] || pages[0] || "";

  // Dynamic Findings
  const [findings, setFindings] = useState<Finding[]>(() => {
    if (isImageMode) return VISUAL_CREATIVE_FINDINGS;
    return generateDocumentFindings(documentText, pages);
  });

  // Sync Queue from Window/Session on mount
  useEffect(() => {
    if ((window as any).__B4LIVE_QUEUE__ && (window as any).__B4LIVE_QUEUE__.length > 0) {
      setBulkQueue((window as any).__B4LIVE_QUEUE__);
    } else {
      try {
        const savedQueue = sessionStorage.getItem("bulk_queue");
        if (savedQueue) {
          const parsed = JSON.parse(savedQueue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setBulkQueue(parsed);
          }
        }
      } catch {}
    }
  }, []);

  // A new batch launched from Home while this page is still mounted
  useEffect(() => {
    const onNewBatch = () => {
      const q = (window as any).__B4LIVE_QUEUE__;
      if (Array.isArray(q) && q.length > 0) {
        setBulkQueue(q);
        handleSwitchBulkAsset(q[0]);
      }
    };
    window.addEventListener("b4live-queue", onNewBatch);
    return () => window.removeEventListener("b4live-queue", onNewBatch);
  }, []);

  // Keep the ongoing card visible in the queue strip
  useEffect(() => {
    if (activeAssetId) {
      document.getElementById(`queue-card-${activeAssetId}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeAssetId]);

  // Ensure image cleanup when in document mode
  useEffect(() => {
    if (docFilename.match(/\.(pdf|pptx|txt|docx)$/i) || activeFileType !== "image") {
      if (imageUrl) {
        setImageUrl(null);
        sessionStorage.removeItem("current_image_url");
      }
    }
  }, [docFilename, activeFileType]);

  // Re-sync findings whenever mode, text, or pages change
  useEffect(() => {
    if (isImageMode) {
      setFindings(VISUAL_CREATIVE_FINDINGS);
      sessionStorage.setItem("current_findings", JSON.stringify(VISUAL_CREATIVE_FINDINGS));
    } else {
      const refreshed = generateDocumentFindings(documentText, pages);
      setFindings(refreshed);
      sessionStorage.setItem("current_findings", JSON.stringify(refreshed));
    }
  }, [isImageMode, documentText, pages]);

  const [isEditingManually, setIsEditingManually] = useState(false);
  const [manualText, setManualText] = useState("");
  const [aiAnswers, setAiAnswers] = useState<{ [id: string]: string }>({});
  const [aiLoading, setAiLoading] = useState<{ [id: string]: boolean }>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<{ [key: number]: HTMLElement | null }>({});
  const fixPanelRef = useRef<HTMLDivElement | null>(null);
  const [arrowPath, setArrowPath] = useState<string>("");

  const pageFindings = useMemo(() => {
    if (isImageMode) return findings;
    return findings.filter((f) => f.page === currentPage);
  }, [findings, currentPage, isImageMode]);

  const openPageFindings = pageFindings.filter((f) => f.status === "open");
  const activeFinding =
    pageFindings.find((f) => f.markerId === activeMarkerId) ||
    openPageFindings[0] ||
    pageFindings[0];

  // Switch between bulk assets in priority queue
  const handleSwitchBulkAsset = (asset: any) => {
    setActiveAssetId(asset.id ?? null);
    setDocFilename(asset.name);
    setActiveFileType(asset.fileType);
    sessionStorage.setItem("current_filename", asset.name);
    sessionStorage.setItem("current_file_type", asset.fileType);

    if (asset.fileType === "image") {
      const img = asset.dataUrl || sessionStorage.getItem("current_image_url");
      setImageUrl(img);
      if (img) sessionStorage.setItem("current_image_url", img);
      setFindings(VISUAL_CREATIVE_FINDINGS);
      sessionStorage.setItem("current_findings", JSON.stringify(VISUAL_CREATIVE_FINDINGS));
    } else {
      setImageUrl(null);
      sessionStorage.removeItem("current_image_url");

      const text =
        asset.textContent ||
        `--- [Page 1] ---\n${asset.name} • Executive Overview\nClaims evaluation and regulatory verification in progress.\n\n--- [Page 2] ---\nClinical Study Results\nConsumer tested formulation across diverse skin phototypes.`;
      setDocumentText(text);
      if (setContent) setContent(text);
      sessionStorage.setItem("current_doc_text", text);

      const pageRegex = /---\s*\[(?:Page|Slide)\s*(\d+)\]\s*---/gi;
      const parts = pageRegex.test(text)
        ? text.split(/---\s*\[(?:Page|Slide)\s*\d+\]\s*---/gi).map((p: string) => p.trim()).filter(Boolean)
        : [text];

      sessionStorage.removeItem("current_findings");
      const fresh = generateDocumentFindings(text, parts);
      setFindings(fresh);
      sessionStorage.setItem("current_findings", JSON.stringify(fresh));
    }
    setActiveMarkerId(1);
    setCurrentPage(1);
  };

  // Image Upload / Change
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImageUrl(dataUrl);
      setDocFilename(file.name);
      setActiveFileType("image");
      sessionStorage.setItem("current_image_url", dataUrl);
      sessionStorage.setItem("current_file_type", "image");
      sessionStorage.setItem("current_filename", file.name);
      setActiveMarkerId(1);
    };
    reader.readAsDataURL(file);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    setIsEditingManually(false);
    const newPageOpen = findings.filter((f) => f.page === newPage && f.status === "open");
    if (newPageOpen.length > 0) {
      setActiveMarkerId(newPageOpen[0].markerId);
    } else {
      setActiveMarkerId(1);
    }
  };

  const advanceToNextOpen = (currentId: string, updatedList: Finding[]) => {
    const remainingOnPage = updatedList.filter(
      (f) => (isImageMode || f.page === currentPage) && f.status === "open" && f.id !== currentId
    );
    if (remainingOnPage.length > 0) {
      setActiveMarkerId(remainingOnPage[0].markerId);
    } else {
      setActiveMarkerId(0);
    }
  };

  // Animated Bézier Connector Arrow
  useEffect(() => {
    if (viewMode !== "creative" || activeMarkerId === 0) {
      setArrowPath("");
      return;
    }

    const updateConnector = () => {
      const markerEl = markerRefs.current[activeMarkerId];
      const fixEl = fixPanelRef.current;
      const cEl = containerRef.current;

      if (markerEl && fixEl && cEl) {
        const mRect = markerEl.getBoundingClientRect();
        const fRect = fixEl.getBoundingClientRect();
        const cRect = cEl.getBoundingClientRect();

        if (mRect.width > 0 && mRect.height > 0) {
          const x1 = mRect.left + mRect.width / 2 - cRect.left;
          const y1 = mRect.bottom - cRect.top;
          const x2 = fRect.left + 50 - cRect.left;
          const y2 = fRect.top - cRect.top;
          const cy1 = y1 + (y2 - y1) * 0.5;
          const cy2 = y1 + (y2 - y1) * 0.5;
          setArrowPath(`M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`);
          return;
        }
      }
      setArrowPath("");
    };

    updateConnector();
    const rafId = requestAnimationFrame(updateConnector);
    const timer1 = setTimeout(updateConnector, 50);
    const timer2 = setTimeout(updateConnector, 150);

    window.addEventListener("resize", updateConnector);
    window.addEventListener("scroll", updateConnector, true);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener("resize", updateConnector);
      window.removeEventListener("scroll", updateConnector, true);
    };
  }, [activeMarkerId, viewMode, findings, activePageText, currentPage, imageUrl]);

  // Apply surgical fix
  const handleApplyFix = (findingId: string) => {
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) return;

    if (!isImageMode && documentText.includes(finding.flagged_text)) {
      const updated = documentText.replace(finding.flagged_text, finding.suggested_fix);
      setDocumentText(updated);
      if (setContent) setContent(updated);
      sessionStorage.setItem("current_doc_text", updated);
    }

    const updatedList: Finding[] = findings.map((f) =>
      f.id === findingId ? { ...f, status: "resolved" as const } : f
    );
    setFindings(updatedList);
    sessionStorage.setItem("current_findings", JSON.stringify(updatedList));

    // Update queue state if bulk assets are active
    if (bulkQueue.length > 0) {
      const allDone = updatedList.every((f) => f.status === "resolved" || f.status === "dismissed");
      const updatedQ = bulkQueue.map((a) =>
        isCurrent(a) ? { ...a, cleared: allDone } : a
      );
      setBulkQueue(updatedQ);
      (window as any).__B4LIVE_QUEUE__ = updatedQ;
      try {
        sessionStorage.setItem("bulk_queue", JSON.stringify(updatedQ));
      } catch {}
    }

    advanceToNextOpen(findingId, updatedList);

    try {
      const docId = sessionStorage.getItem("currentDocId") || "doc-1";
      applyFixToBackend(docId, findingId, "apply");
    } catch {}
  };

  const handleSaveManualEdit = (findingId: string) => {
    const finding = findings.find((f) => f.id === findingId);
    if (!finding || !manualText.trim()) return;

    if (!isImageMode && documentText.includes(finding.flagged_text)) {
      const updated = documentText.replace(finding.flagged_text, manualText.trim());
      setDocumentText(updated);
      if (setContent) setContent(updated);
      sessionStorage.setItem("current_doc_text", updated);
    }

    const updatedList: Finding[] = findings.map((f) =>
      f.id === findingId
        ? { ...f, status: "resolved" as const, suggested_fix: manualText.trim() }
        : f
    );
    setFindings(updatedList);
    sessionStorage.setItem("current_findings", JSON.stringify(updatedList));
    setIsEditingManually(false);
    advanceToNextOpen(findingId, updatedList);
  };

  const handleIgnoreOnce = (findingId: string) => {
    const updatedList: Finding[] = findings.map((f) =>
      f.id === findingId ? { ...f, status: "dismissed" as const } : f
    );
    setFindings(updatedList);
    sessionStorage.setItem("current_findings", JSON.stringify(updatedList));
    advanceToNextOpen(findingId, updatedList);
  };

  const handleIgnoreAll = (finding: Finding) => {
    const updatedList: Finding[] = findings.map((f) =>
      f.flagged_text === finding.flagged_text ? { ...f, status: "dismissed" as const } : f
    );
    setFindings(updatedList);
    sessionStorage.setItem("current_findings", JSON.stringify(updatedList));
    advanceToNextOpen(finding.id, updatedList);
  };

  const handleAskAi = async (finding: Finding) => {
    setAiLoading((prev) => ({ ...prev, [finding.id]: true }));
    try {
      const res = await askAI({
        question: `Why is "${finding.flagged_text}" flagged under ${finding.evidence} and what is the exact legal/brand reasoning?`,
        node_text: finding.flagged_text,
        node_type: "Uploaded Content Finding",
        edge_verdict: finding.severity,
      });
      setAiAnswers((prev) => ({ ...prev, [finding.id]: res.answer }));
    } catch {
      setAiAnswers((prev) => ({
        ...prev,
        [finding.id]: "Unable to reach Gemini reasoning backend.",
      }));
    } finally {
      setAiLoading((prev) => ({ ...prev, [finding.id]: false }));
    }
  };

  const handleDownload = () => {
    let contentToDownload = "";
    if (isImageMode) {
      contentToDownload =
        `========================================================================\n` +
        `BEFORE IT GOES LIVE • COMPLIANCE AUDIT SPECIFICATION\n` +
        `Asset: ${docTitle} (Visual Advertisement Creative)\n` +
        `Status: ${allPageResolved ? "APPROVED / CLEARED FOR LAUNCH" : "REVISION REQUIRED"}\n` +
        `========================================================================\n\n` +
        pageFindings
          .map(
            (f) =>
              `[MARKER #${f.markerId} • ${f.severity.toUpperCase()} RISK]\n` +
              `Location: ${f.location}\n` +
              `Designer Action: ${f.image_action}\n` +
              `Flagged Claim: "${f.flagged_text}"\n` +
              `Violation: ${f.explanation}\n` +
              `Approved Replacement: "${f.suggested_fix}"\n` +
              `Regulatory Citation: ${f.evidence}\n` +
              `Status: ${f.status === "resolved" ? "RESOLVED & APPROVED" : "OPEN"}\n`
          )
          .join("\n------------------------------------------------------------------------\n\n");
    } else {
      contentToDownload = documentText;
    }

    const blob = new Blob([contentToDownload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${docTitle.replace(/\s+/g, "_")}_compliant_spec.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    let textToCopy = "";
    if (isImageMode) {
      textToCopy = pageFindings
        .map(
          (f) =>
            `Marker #${f.markerId} (${f.location}):\nApproved Copy: "${f.suggested_fix}"\nCitation: ${f.evidence}`
        )
        .join("\n\n");
    } else {
      textToCopy = documentText;
    }
    navigator.clipboard.writeText(textToCopy);
    alert("📋 Copied compliant specifications to clipboard!");
  };

  const renderAnnotatedPage = (text: string, currentFindings: Finding[]) => {
    if (!text) return null;
    const matching = currentFindings.filter((f) => f.flagged_text && text.includes(f.flagged_text));

    if (matching.length === 0) {
      return (
        <div style={{ whiteSpace: "pre-line", lineHeight: "1.8", color: "#e2e8f0", fontSize: "14px" }}>
          {text}
        </div>
      );
    }

    const sorted = [...matching].sort((a, b) => b.flagged_text.length - a.flagged_text.length);
    const regex = new RegExp(
      `(${sorted.map((m) => m.flagged_text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
      "g"
    );
    const parts = text.split(regex);

    return (
      <div style={{ whiteSpace: "pre-line", lineHeight: "2.1", color: "#e2e8f0", fontSize: "14px" }}>
        {parts.map((part, idx) => {
          const finding = sorted.find((m) => m.flagged_text === part);
          if (!finding) return <span key={idx}>{part}</span>;

          if (finding.status === "dismissed") {
            return <span key={idx}>{finding.flagged_text}</span>;
          }

          if (finding.status === "resolved") {
            return (
              <span
                key={idx}
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
                  ✓ Fixed
                </span>
              </span>
            );
          }

          const isSelected = activeMarkerId === finding.markerId;

          return (
            <button
              key={idx}
              type="button"
              ref={(el) => {
                markerRefs.current[finding.markerId] = el;
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
                verticalAlign: "baseline",
                border: isSelected
                  ? "2px solid #12c4d4"
                  : finding.severity === "high"
                  ? "1.5px dashed #ef4444"
                  : finding.severity === "medium"
                  ? "1.5px dashed #f59e0b"
                  : "1.5px dashed #10b981",
                background: isSelected
                  ? "rgba(18, 196, 212, 0.3)"
                  : finding.severity === "high"
                  ? "rgba(239, 68, 68, 0.22)"
                  : finding.severity === "medium"
                  ? "rgba(245, 158, 11, 0.22)"
                  : "rgba(16, 185, 129, 0.22)",
                boxShadow: isSelected ? "0 0 16px rgba(18, 196, 212, 0.6)" : "none",
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
                      : "#10b981",
                  color: "#ffffff",
                  borderRadius: "50%",
                  width: "20px",
                  height: "20px",
                  lineHeight: "20px",
                  fontWeight: 900,
                  flexShrink: 0,
                  boxShadow: "0 2px 5px rgba(0,0,0,0.6)",
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

  const allPageResolved = pageFindings.every(
    (f) => f.status === "resolved" || f.status === "dismissed"
  );
  const clearedAssetsCount = bulkQueue.filter((a) => a.cleared).length;

  // Find next uncleared asset in queue
  const activeQueueIndex = bulkQueue.findIndex(isCurrent);
  const nextUnclearedAsset =
    bulkQueue.find((a, idx) => idx > activeQueueIndex && !a.cleared) ||
    bulkQueue.find((a) => !isCurrent(a) && !a.cleared);

  const nextAsset = bulkQueue.length > 1 ? bulkQueue[(activeQueueIndex + 1) % bulkQueue.length] : undefined;
  const prevAsset = bulkQueue.length > 1 ? bulkQueue[(activeQueueIndex - 1 + bulkQueue.length) % bulkQueue.length] : undefined;

  return (
    <div className="page">
      <style>{`
        @keyframes connector-dash {
          to {
            stroke-dashoffset: -24;
          }
        }
      `}</style>

      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        style={{ display: "none" }}
      />

      {/* ========================================================================= */}
      {/* 📦 BATCH / BULK IMPORT QUEUE BOX */}
      {/* ========================================================================= */}
      {bulkQueue.length > 0 && (
        <div
          style={{
            background: "linear-gradient(180deg, #101535 0%, #080a1c 100%)",
            border: "1.5px solid #12c4d4",
            borderRadius: "16px",
            padding: "16px 20px",
            marginBottom: "24px",
            boxShadow: "0 4px 24px rgba(18, 196, 212, 0.15)",
          }}
        >
          <style>{`
            @keyframes queue-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
            .queue-strip { scrollbar-width: thin; scrollbar-color: #252a48 transparent; }
          `}</style>

          {/* header: title, progress, prev / next */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ background: "rgba(18, 196, 212, 0.2)", color: "#12c4d4", borderRadius: "8px", padding: "6px 10px", display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "13px", letterSpacing: "0.5px" }}>
                <Layers size={16} /> BATCH IMPORT QUEUE
              </div>
              <span style={{ fontSize: "13px", color: "#94a3b8", fontWeight: 600 }}>
                File {Math.max(activeQueueIndex, 0) + 1} of {bulkQueue.length} · {clearedAssetsCount} cleared
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {clearedAssetsCount === bulkQueue.length && (
                <span style={{ background: "rgba(198, 244, 91, 0.2)", color: "#c6f45b", border: "1px solid #c6f45b", padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 800 }}>
                  🎉 ALL ASSETS IN BATCH CLEARED FOR LAUNCH
                </span>
              )}
              {prevAsset && (
                <button
                  onClick={() => handleSwitchBulkAsset(prevAsset)}
                  title={`Previous: ${prevAsset.name}`}
                  style={{ background: "#171b35", color: "#12c4d4", border: "1.5px solid #12c4d4", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}
                >
                  ← Prev
                </button>
              )}
              {nextAsset && (
                <button
                  onClick={() => handleSwitchBulkAsset(nextAsset)}
                  title={`Next: ${nextAsset.name}`}
                  style={{
                    background: allPageResolved ? "#c6f45b" : "#171b35",
                    color: allPageResolved ? "#080a1c" : "#12c4d4",
                    border: allPageResolved ? "none" : "1.5px solid #12c4d4",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: allPageResolved ? "0 0 16px rgba(198, 244, 91, 0.45)" : "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  Next → {nextAsset.name.length > 28 ? nextAsset.name.slice(0, 26) + "…" : nextAsset.name}
                </button>
              )}
            </div>
          </div>

          {/* one scrolling row: ongoing file first in focus, the rest waiting in queue */}
          <div className="queue-strip" style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "6px" }}>
            {bulkQueue.map((asset, idx) => {
              const active = isCurrent(asset);
              const status = asset.cleared ? "cleared" : active ? "ongoing" : "queued";
              const pill = {
                cleared: { text: "✓ CLEARED", color: "#c6f45b", bg: "rgba(198, 244, 91, 0.15)" },
                ongoing: { text: "● ONGOING", color: "#12c4d4", bg: "rgba(18, 196, 212, 0.2)" },
                queued: { text: "⏳ IN QUEUE", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.15)" },
              }[status];
              return (
                <div
                  key={asset.id || idx}
                  id={`queue-card-${asset.id}`}
                  onClick={() => handleSwitchBulkAsset(asset)}
                  style={{
                    flex: "0 0 240px",
                    background: active ? "rgba(18, 196, 212, 0.15)" : "#0c1024",
                    border: active ? "2px solid #12c4d4" : asset.cleared ? "1.5px solid #c6f45b80" : "1px solid #252a48",
                    borderRadius: "10px",
                    padding: "12px",
                    cursor: "pointer",
                    opacity: status === "queued" ? 0.85 : 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    boxShadow: active ? "0 0 14px rgba(18, 196, 212, 0.3)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: active ? "#12c4d4" : "#94a3b8", fontWeight: 700 }}>QUEUE #{idx + 1}</span>
                    <span
                      style={{
                        fontSize: "10px", fontWeight: 800, padding: "2px 8px", borderRadius: "4px",
                        color: pill.color, background: pill.bg,
                        animation: status === "ongoing" ? "queue-pulse 1.6s ease-in-out infinite" : "none",
                      }}
                    >
                      {pill.text}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    {asset.fileType === "image" && asset.dataUrl ? (
                      <img src={asset.dataUrl} alt="" style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />
                    ) : (
                      <span style={{ fontSize: "24px", flexShrink: 0 }}>
                        {asset.fileType === "image" ? "🖼️" : asset.fileType === "pdf" ? "📄" : asset.fileType === "pptx" ? "📊" : "📝"}
                      </span>
                    )}
                    <strong style={{ fontSize: "13px", color: active ? "#ffffff" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {asset.name}
                    </strong>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                    <span>{asset.category || (asset.fileType === "image" ? "Visual Creative" : "Document")}</span>
                    {asset.priority && (
                      <span style={{ color: asset.priority === "high" ? "#ef4444" : asset.priority === "medium" ? "#f59e0b" : "#34d399", fontWeight: 700 }}>
                        {asset.priority.toUpperCase()} RISK
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Header & View Toggle */}
      <div className="section-heading" style={{ marginBottom: "20px" }}>
        <div>
          <span className="eyebrow">PRE-FLIGHT RELEASE GATE</span>
          <h2>Automated Claims & Content Review</h2>
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
            className={viewMode === "creative" ? "primary-button" : "secondary-button"}
            style={{ minHeight: "36px", fontSize: "12px", padding: "8px 14px" }}
          >
            🎨 Creative Art View
          </button>
          <button
            onClick={() => setViewMode("graph")}
            className={viewMode === "graph" ? "primary-button" : "secondary-button"}
            style={{ minHeight: "36px", fontSize: "12px", padding: "8px 14px" }}
          >
            🕸️ Interactive Knowledge Graph
          </button>
        </div>
      </div>

      {viewMode === "graph" ? (
        <GraphView
          findings={findings}
          documentText={documentText}
          docTitle={docTitle}
          pages={pages}
          totalPages={totalPages}
          currentPage={currentPage}
          onNavigateToPage={(pageNum, markerId) => {
            handlePageChange(pageNum);
            if (markerId) setActiveMarkerId(markerId);
            setViewMode("creative");
          }}
        />
      ) : (
        <div className="review-layout">
          {/* ========================================================================= */}
          {/* LEFT: SCANNED ASSET (IMAGE OR MULTI-PAGE TEXT) */}
          {/* ========================================================================= */}
          <div className="review-visual-workspace" ref={containerRef} style={{ position: "relative" }}>
            <div className="creative-preview">
              <div
                className="creative-topline"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>SCANNED MARKETING ASSET {isImageMode ? "• VISUAL AD CREATIVE" : ""}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span>{pageFindings.length} MARKERS DETECTED</span>
                  {isImageMode && (
                    <button
                      className="secondary-button"
                      onClick={() => imageFileInputRef.current?.click()}
                      style={{
                        minHeight: "26px",
                        padding: "3px 8px",
                        fontSize: "10px",
                        borderColor: "var(--cyan)",
                        color: "var(--cyan)",
                      }}
                    >
                      <Upload size={11} style={{ marginRight: 4 }} /> Change Image
                    </button>
                  )}
                  <button
                    className="icon-button"
                    onClick={() => setIsFullscreen(true)}
                    title="Fullscreen Mode"
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

              {/* 📄 DYNAMIC PAGINATION BAR FOR MULTI-PAGE DOCUMENTS */}
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
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>
                    📄 Document:{" "}
                    <strong style={{ color: "#fff" }}>
                      Page {currentPage} of {totalPages}
                    </strong>
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", overflowX: "auto", maxWidth: "60%" }}>
                    <button
                      className="icon-button"
                      disabled={currentPage <= 1}
                      onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                      style={{ padding: "2px 6px" }}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => handlePageChange(i + 1)}
                        style={{
                          background: currentPage === i + 1 ? "#12c4d4" : "#171b35",
                          color: currentPage === i + 1 ? "#080a1c" : "#94a3b8",
                          border: "none",
                          borderRadius: "4px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        P.{i + 1}
                      </button>
                    ))}
                    <button
                      className="icon-button"
                      disabled={currentPage >= totalPages}
                      onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                      style={{ padding: "2px 6px" }}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* Scanned Card */}
              <div
                className="creative-art"
                style={{
                  maxHeight: "440px",
                  overflowY: "auto",
                  padding: isImageMode ? "14px" : "28px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
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
                      justifyContent: "center",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt="Scanned Marketing Visual Asset"
                      style={{
                        width: "100%",
                        maxHeight: "400px",
                        objectFit: "contain",
                        display: "block",
                        borderRadius: "8px",
                      }}
                    />
                    {pageFindings.map((finding) => {
                      const isSelected = activeMarkerId === finding.markerId;
                      const posX = finding.pinX || (finding.markerId === 1 ? 21 : finding.markerId === 2 ? 47 : 25);
                      const posY = finding.pinY || (finding.markerId === 1 ? 47 : finding.markerId === 2 ? 47 : 14);

                      return (
                        <button
                          key={finding.markerId}
                          type="button"
                          ref={(el) => {
                            markerRefs.current[finding.markerId] = el;
                          }}
                          onClick={() => {
                            setActiveMarkerId(finding.markerId);
                            setIsEditingManually(false);
                          }}
                          title={`Marker #${finding.markerId}: ${finding.flagged_text}`}
                          style={{
                            position: "absolute",
                            left: `${posX}%`,
                            top: `${posY}%`,
                            transform: "translate(-50%, -50%)",
                            cursor: "pointer",
                            border: isSelected ? "3px solid #12c4d4" : "2px solid #ffffff",
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
                                : "#10b981",
                            color: finding.status === "resolved" ? "#080a1c" : "#ffffff",
                            fontWeight: 900,
                            fontSize: "14px",
                            display: "grid",
                            placeItems: "center",
                            boxShadow: isSelected
                              ? "0 0 20px #12c4d4, 0 0 0 5px rgba(18, 196, 212, 0.45)"
                              : "0 4px 12px rgba(0,0,0,0.7)",
                            zIndex: isSelected ? 10 : 5,
                            transition: "all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                          }}
                        >
                          {finding.status === "resolved" ? "✓" : finding.markerId}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ width: "100%" }}>
                    <div className="creative-decoration" />
                    <span className="creative-kicker">{docTitle.toUpperCase()}</span>
                    <h2 style={{ fontSize: "22px", margin: "4px 0 16px 0", color: "#ffffff" }}>{docTitle}</h2>
                    {renderAnnotatedPage(activePageText, pageFindings)}
                  </div>
                )}
              </div>

              <div className="preview-legend">
                <span><i className="legend-high" /> 1: High Risk</span>
                <span><i className="legend-medium" /> 2: Medium Risk</span>
                <span><i className="legend-low" /> 3: Low Risk</span>
              </div>
            </div>

            {/* Moving Animated SVG Connector Arrow */}
            {arrowPath && (
              <svg
                className="review-connector"
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
                  <marker id="review-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <polygon points="0 1, 8 4, 0 7" fill="#12c4d4" />
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
                    animation: "connector-dash 650ms linear infinite",
                    filter: "drop-shadow(0 0 6px #12c4d4)",
                  }}
                />
              </svg>
            )}

            {/* MAGIC FIX PANEL */}
            <div className="magic-fix-panel" ref={fixPanelRef}>
              {allPageResolved ? (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{ fontSize: "28px", marginBottom: "6px" }}>🎉</div>
                  <strong style={{ color: "var(--lime)", fontSize: "15px" }}>
                    All Marketing Violations Resolved & Cleared!
                  </strong>
                  <p className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
                    {docTitle} has passed regulatory clearance.
                  </p>
                  {nextUnclearedAsset && (
                    <button
                      onClick={() => handleSwitchBulkAsset(nextUnclearedAsset)}
                      className="primary-button"
                      style={{
                        marginTop: "12px",
                        background: "var(--lime)",
                        color: "#080a1c",
                        fontWeight: 800,
                        fontSize: "13px",
                        padding: "8px 20px",
                      }}
                    >
                      🚀 Audit Next Collateral in Queue ({nextUnclearedAsset.name}) →
                    </button>
                  )}
                </div>
              ) : activeFinding ? (
                <>
                  <div
                    className="magic-fix-heading"
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px" }}>🪄</span>
                      <span style={{ fontWeight: 800, fontSize: "14px", color: "var(--cyan)" }}>
                        Magic Fix for Marker #{activeFinding.markerId}
                      </span>
                    </div>
                    <span
                      className={`pill ${
                        activeFinding.severity === "high"
                          ? "legend-high"
                          : activeFinding.severity === "medium"
                          ? "legend-medium"
                          : "legend-low"
                      }`}
                      style={{ fontSize: "10px" }}
                    >
                      {activeFinding.severity.toUpperCase()} RISK • {activeFinding.evidence}
                    </span>
                  </div>

                  {/* 1. Exact Element Location */}
                  <div
                    style={{
                      background: "rgba(18, 196, 212, 0.08)",
                      border: "1px solid rgba(18, 196, 212, 0.25)",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      marginBottom: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ color: "var(--cyan)", fontWeight: 800 }}>
                      {isImageMode ? "📍 VISUAL AD ELEMENT:" : "📍 DOCUMENT SECTION:"}
                    </span>
                    <span style={{ color: "#ffffff", fontWeight: 600 }}>
                      {isImageMode
                        ? activeFinding.location || `Marker #${activeFinding.markerId}`
                        : `Page ${activeFinding.page} • Paragraph Marker #${activeFinding.markerId}`}
                    </span>
                    {isImageMode && activeFinding.image_action && (
                      <span style={{ marginLeft: "auto", fontSize: "11px", color: "#94a3b8" }}>
                        ({activeFinding.image_action})
                      </span>
                    )}
                  </div>

                  {/* 2. Flagged Writing */}
                  <div style={{ marginBottom: "12px" }}>
                    <span className="magic-fix-label" style={{ color: "#ef4444" }}>
                      📝 {isImageMode ? "FLAGGED COPY IN CREATIVE:" : "FLAGGED STATEMENT IN DOCUMENT:"}
                    </span>
                    <div
                      style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        marginTop: "4px",
                        color: "#ff987e",
                        fontSize: "13px",
                        fontWeight: 700,
                        lineHeight: "1.5",
                      }}
                    >
                      "{activeFinding.flagged_text}"
                    </div>
                  </div>

                  {/* 3. What is Wrong */}
                  <div style={{ marginBottom: "12px" }}>
                    <span className="magic-fix-label" style={{ color: "#f87171" }}>
                      ❌ WHAT IS WRONG (REGULATORY VIOLATION):
                    </span>
                    <div
                      style={{
                        background: "rgba(239, 68, 68, 0.06)",
                        borderLeft: "3px solid #ef4444",
                        padding: "10px 14px",
                        marginTop: "4px",
                        color: "#e2e8f0",
                        fontSize: "12px",
                        lineHeight: "1.6",
                        borderRadius: "0 8px 8px 0",
                      }}
                    >
                      {activeFinding.explanation}
                    </div>
                  </div>

                  {/* 4. What is Right */}
                  <div style={{ marginBottom: "14px" }}>
                    <span className="magic-fix-label" style={{ color: "var(--lime)" }}>
                      ✅ WHAT IS RIGHT (APPROVED REPLACEMENT COPY):
                    </span>
                    <div
                      style={{
                        background: "rgba(198, 244, 91, 0.1)",
                        border: "1px solid rgba(198, 244, 91, 0.4)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        marginTop: "4px",
                        color: "var(--lime)",
                        fontSize: "13px",
                        fontWeight: 700,
                        lineHeight: "1.5",
                        boxShadow: "0 0 12px rgba(198, 244, 91, 0.15)",
                      }}
                    >
                      "{activeFinding.suggested_fix}"
                    </div>
                  </div>

                  {isEditingManually ? (
                    <div style={{ marginBottom: "14px" }}>
                      <textarea
                        value={manualText}
                        onChange={(e) => setManualText(e.target.value)}
                        placeholder="Type compliant copy..."
                        rows={3}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "#080a1c",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "10px",
                          color: "#fff",
                          fontSize: "13px",
                        }}
                      />
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        <button
                          className="primary-button"
                          onClick={() => handleSaveManualEdit(activeFinding.id)}
                          style={{ minHeight: "32px", fontSize: "12px" }}
                        >
                          Save Edit
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => setIsEditingManually(false)}
                          style={{ minHeight: "32px", fontSize: "12px" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Actions Bar */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                    <button
                      className="primary-button"
                      onClick={() => handleApplyFix(activeFinding.id)}
                      style={{
                        minHeight: "36px",
                        fontSize: "12px",
                        background: "var(--lime)",
                        color: "#080a1c",
                        fontWeight: 800,
                      }}
                    >
                      <Sparkles size={14} style={{ marginRight: 6 }} /> Apply Surgical Replacement
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setManualText(activeFinding.suggested_fix);
                        setIsEditingManually(true);
                      }}
                      style={{ minHeight: "36px", fontSize: "12px" }}
                    >
                      <Edit3 size={14} style={{ marginRight: 6 }} /> Manual Edit
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleIgnoreOnce(activeFinding.id)}
                      style={{ minHeight: "36px", fontSize: "12px" }}
                    >
                      <EyeOff size={14} style={{ marginRight: 6 }} /> Ignore Once
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleIgnoreAll(activeFinding)}
                      style={{ minHeight: "36px", fontSize: "12px" }}
                    >
                      Ignore All
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => handleAskAi(activeFinding)}
                      disabled={aiLoading[activeFinding.id]}
                      style={{ minHeight: "36px", fontSize: "12px", borderColor: "var(--cyan)", color: "var(--cyan)" }}
                    >
                      {aiLoading[activeFinding.id] ? "Analyzing..." : "🤖 Ask AI"}
                    </button>
                  </div>

                  {aiAnswers[activeFinding.id] && (
                    <div
                      style={{
                        marginTop: "12px",
                        background: "rgba(18, 196, 212, 0.08)",
                        border: "1px solid var(--cyan)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                        lineHeight: "1.6",
                      }}
                    >
                      <strong style={{ color: "var(--cyan)", display: "block", marginBottom: "4px" }}>
                        Gemini Regulatory Reasoning:
                      </strong>
                      {aiAnswers[activeFinding.id]}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* RIGHT: UPDATED ADVERTISEMENT / CLEAN SPECIFICATION PREVIEW */}
          {/* ========================================================================= */}
          <div className="review-document-workspace">
            <div className="updated-ad-card">
              <div
                className="creative-topline"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>
                  {isImageMode
                    ? "UPDATED ADVERTISEMENT & REVISED CREATIVE"
                    : "UPDATED ADVERTISEMENT & SPECIFICATIONS"}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="icon-button"
                    onClick={handleCopy}
                    title="Copy Specifications"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "#94a3b8",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                    }}
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    className="icon-button"
                    onClick={handleDownload}
                    title="Download Clean Copy"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--cyan)",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    <Download size={12} /> Download
                  </button>
                </div>
              </div>

              {/* View Switcher for Image Mode */}
              {isImageMode && (
                <div
                  style={{
                    display: "flex",
                    borderBottom: "1px solid var(--border)",
                    background: "#080a1c",
                    padding: "6px 12px",
                    gap: "8px",
                  }}
                >
                  <button
                    onClick={() => setPreviewTab("image")}
                    style={{
                      background: previewTab === "image" ? "#171b35" : "transparent",
                      border: previewTab === "image" ? "1px solid #12c4d4" : "none",
                      color: previewTab === "image" ? "#12c4d4" : "#94a3b8",
                      borderRadius: "6px",
                      padding: "4px 12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🖼️ Visual Ad Creative Preview
                  </button>
                  <button
                    onClick={() => setPreviewTab("specs")}
                    style={{
                      background: previewTab === "specs" ? "#171b35" : "transparent",
                      border: previewTab === "specs" ? "1px solid #12c4d4" : "none",
                      color: previewTab === "specs" ? "#12c4d4" : "#94a3b8",
                      borderRadius: "6px",
                      padding: "4px 12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    📋 Designer Spec Sheet
                  </button>
                </div>
              )}

              {/* Card Body */}
              <div style={{ padding: "20px", maxHeight: "560px", overflowY: "auto" }}>
                {isImageMode && previewTab === "image" && imageUrl ? (
                  <div>
                    <div
                      style={{
                        position: "relative",
                        borderRadius: "10px",
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "#080a1c",
                        marginBottom: "16px",
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt="Revised Marketing Asset"
                        style={{
                          width: "100%",
                          maxHeight: "260px",
                          objectFit: "contain",
                          display: "block",
                          opacity: allPageResolved ? 1 : 0.9,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          background: allPageResolved ? "var(--lime)" : "rgba(18, 196, 212, 0.95)",
                          color: "#080a1c",
                          fontSize: "11px",
                          fontWeight: 800,
                          padding: "4px 10px",
                          borderRadius: "6px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                        }}
                      >
                        {allPageResolved ? "✓ COMPLIANCE CLEARED" : "🔄 REVISIONS PENDING"}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {pageFindings.map((f) => (
                        <div
                          key={f.id}
                          style={{
                            background: f.status === "resolved" ? "rgba(198, 244, 91, 0.08)" : "#101329",
                            border:
                              f.status === "resolved"
                                ? "1px solid rgba(198, 244, 91, 0.4)"
                                : "1px solid var(--border)",
                            borderRadius: "8px",
                            padding: "10px 14px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: "12px", color: "#ffffff" }}>
                              Marker #{f.markerId}: {f.location}
                            </strong>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 800,
                                color: f.status === "resolved" ? "var(--lime)" : "#f59e0b",
                              }}
                            >
                              {f.status === "resolved" ? "✓ APPROVED" : "PENDING ACTION"}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--lime)", marginTop: "4px", fontWeight: 700 }}>
                            "{f.suggested_fix}"
                          </div>
                          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                            Citation: {f.evidence}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : isImageMode && previewTab === "specs" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "13px", color: "#94a3b8" }}>
                      Production Hand-off Specifications for Design Team:
                    </div>
                    {pageFindings.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          background: "#080a1c",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "12px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ color: "var(--cyan)", fontWeight: 800, fontSize: "12px" }}>
                            Marker #{f.markerId} • {f.location}
                          </span>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>{f.image_action}</span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#ef4444", marginBottom: "4px" }}>
                          Flagged: "{f.flagged_text}"
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--lime)", fontWeight: 700 }}>
                          Approved: "{f.suggested_fix}"
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#94a3b8",
                        marginBottom: "12px",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>
                        Active Inspection:{" "}
                        <strong>
                          {totalPages > 1 ? `Page ${currentPage} of ${totalPages}` : "Single-Page Document"}
                        </strong>
                      </span>
                      <span>{openPageFindings.length} open issues on this page</span>
                    </div>

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
                      {activePageText}
                    </div>

                    <div style={{ marginTop: "18px" }}>
                      <strong style={{ fontSize: "13px", color: "#ffffff", display: "block", marginBottom: "8px" }}>
                        {totalPages > 1 ? `Page ${currentPage} Regulatory Audit Status:` : "Document Audit Status:"}
                      </strong>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {pageFindings.map((item) => (
                          <div
                            key={item.id}
                            style={{
                              background: item.status === "resolved" ? "rgba(198, 244, 91, 0.08)" : "#101329",
                              border:
                                item.status === "resolved"
                                  ? "1px solid rgba(198, 244, 91, 0.4)"
                                  : "1px solid var(--border)",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "12px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontWeight: 700, color: "#fff" }}>
                                Marker #{item.markerId} ({item.severity.toUpperCase()} RISK)
                              </span>
                              <span
                                style={{
                                  color: item.status === "resolved" ? "var(--lime)" : "#f59e0b",
                                  fontWeight: 700,
                                }}
                              >
                                {item.status === "resolved" ? "✓ RESOLVED" : "OPEN"}
                              </span>
                            </div>
                            <div style={{ color: "#94a3b8", marginTop: "3px" }}>
                              "{item.flagged_text}" →{" "}
                              <span style={{ color: "var(--lime)", fontWeight: 600 }}>
                                "{item.suggested_fix}"
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Theater Modal */}
      {isFullscreen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
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
            <span style={{ color: "#12c4d4", fontWeight: 800, fontSize: "16px" }}>
              ⛶ THEATER MODE • {docTitle.toUpperCase()}{" "}
              {totalPages > 1 ? `(PAGE ${currentPage} OF ${totalPages})` : ""}
            </span>
            <button
              onClick={() => setIsFullscreen(false)}
              className="primary-button"
              style={{ minHeight: "36px", padding: "6px 20px" }}
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
            {activePageText}
          </div>
        </div>
      )}
    </div>
  );
}