import { useState, useRef, useEffect, useMemo } from "react";
import {
  Tag,
  Clock,
  FlaskConical,
  Leaf,
  Scale,
  Trophy,
  AlertOctagon,
  Sparkles,
  GitMerge,
  X,
  Send,
  MessageSquare,
  RefreshCw,
  ArrowUpRight,
  Layers,
} from "lucide-react";
import { askAI, type ChatTurn } from "../api.ts";

export type NodeData = {
  id: string;
  page?: number;
  markerId?: number;
  type: "fact" | "claim" | "collateral";
  category: "pricing" | "spec" | "banned_rule" | "conflict" | "stale" | "ungrounded" | "match" | "collateral";
  technicalType: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
};

export type EdgeData = {
  id: string;
  sourceId: string;
  targetId: string;
  relation: "backs it" | "contradicts" | "outdated" | "no source" | "impacts collateral";
};

interface GraphViewProps {
  findings?: any[];
  documentText?: string;
  docTitle?: string;
  pages?: string[];
  totalPages?: number;
  currentPage?: number;
  onNavigateToPage?: (page: number, markerId?: number) => void;
}

// Visual icons and badges based on semantic keywords
function getContextualVisual(text: string, type: "fact" | "claim" | "collateral") {
  const t = text.toLowerCase();
  if (type === "collateral") {
    return {
      icon: <Layers size={18} color="#a99aff" />,
      badge: "CAMPAIGN BLAST-RADIUS",
      color: "#a99aff",
    };
  }
  // 1. Commercial / Pricing
  if (t.includes("$") || t.includes("₹") || t.includes("price") || t.includes("discount") || t.includes("% off") || t.includes("bundle")) {
    return {
      icon: <Tag size={18} color="var(--lime)" />,
      badge: "COMMERCIAL FACT · PRICING",
      color: "var(--lime)",
    };
  }
  // 2. Timeline / Urgency
  if (t.includes("day") || t.includes("instant") || t.includes("overnight") || t.includes("timeframe") || t.includes("routine") || t.includes("24-hour")) {
    return {
      icon: <Clock size={18} color="#f5ce75" />,
      badge: "TIMELINE & AGING SPEC",
      color: "#f5ce75",
    };
  }
  // 3. Clinical & Medical Proof
  if (t.includes("clinical") || t.includes("study") || t.includes("dermatolog") || t.includes("protocol") || t.includes("tested") || t.includes("trial")) {
    return {
      icon: <FlaskConical size={18} color="var(--cyan)" />,
      badge: "CLINICAL VALIDATION DOSSIER",
      color: "var(--cyan)",
    };
  }
  // 4. Ingredients & Sustainability
  if (t.includes("organic") || t.includes("botanical") || t.includes("ingredient") || t.includes("texture") || t.includes("formulat") || t.includes("squalane")) {
    return {
      icon: <Leaf size={18} color="#9ce5d1" />,
      badge: "FORMULATION & INGREDIENT",
      color: "#9ce5d1",
    };
  }
  // 5. Market Standing / Superiority
  if (t.includes("voted") || t.includes("#1") || t.includes("best") || t.includes("outperform") || t.includes("favorite")) {
    return {
      icon: <Trophy size={18} color="#f5ce75" />,
      badge: "COMPETITIVE BENCHMARK",
      color: "#f5ce75",
    };
  }
  // 6. Legal & Banned Constraints
  if (t.includes("banned") || t.includes("prohibited") || t.includes("guarantee") || t.includes("rule") || t.includes("legal") || t.includes("ftc") || t.includes("fda")) {
    return {
      icon: <Scale size={18} color="#ff987e" />,
      badge: "LEGAL & COMPLIANCE RULE",
      color: "#ff987e",
    };
  }
  return {
    icon: type === "fact" ? <Sparkles size={18} color="var(--cyan)" /> : <AlertOctagon size={18} color="#ff987e" />,
    badge: type === "fact" ? "APPROVED BENCHMARK" : "EXTRACTED SPAN",
    color: type === "fact" ? "var(--cyan)" : "#ff987e",
  };
}

export default function GraphView({
  findings: propsFindings,
  documentText: _propsDocText,
  docTitle: _propsDocTitle,
  pages: propsPages,
  totalPages: propsTotalPages,
  currentPage: propsCurrentPage = 1,
  onNavigateToPage,
}: GraphViewProps = {}) {
  void _propsDocText;
  void _propsDocTitle;

  const [selectedPage, setSelectedPage] = useState<number | "all">(propsCurrentPage);

  // An explicitly supplied array (including []) belongs to the current document
  // and must not be replaced with findings left in sessionStorage by another file.
  const allFindings = useMemo(() => {
    if (Array.isArray(propsFindings)) return propsFindings;
    if (typeof window !== "undefined") {
      try {
        const saved = window.sessionStorage.getItem("current_findings");
        const parsed = saved ? JSON.parse(saved) : null;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Invalid or unavailable session data is ignored; no sample findings are added.
      }
    }
    return [];
  }, [propsFindings]);

  const highestFindingPage = allFindings.reduce((highest: number, finding: any) => {
    const page = Number(finding?.page);
    return Number.isInteger(page) && page > highest ? page : highest;
  }, 1);
  const totalPagesCount = Math.max(1, propsTotalPages || propsPages?.length || highestFindingPage);

  // Build the graph only from actual findings and relationships supplied by the
  // backend. Severity alone is not proof of a contradiction or an outdated fact.
  const { nodes: graphNodes, edges: graphEdges } = useMemo(() => {
    const nodes: NodeData[] = [];
    const edges: EdgeData[] = [];
    const findingsInScope = allFindings
      .map((finding: any, index: number) => ({ finding, index }))
      .filter(({ finding }) => {
        const pageValue = Number(finding?.page);
        const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
        return selectedPage === "all" || page === selectedPage;
      });

    const normalizeRelation = (value: unknown): EdgeData["relation"] | null => {
      const relation = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
      if (["backs it", "supports", "supported by", "supports claim"].includes(relation)) return "backs it";
      if (["contradicts", "contradiction", "conflicts with"].includes(relation)) return "contradicts";
      if (["outdated", "out of date", "stale", "expired"].includes(relation)) return "outdated";
      if (["no source", "unsourced", "missing source", "unverified source"].includes(relation)) return "no source";
      if (["impacts collateral", "impact collateral", "affects collateral"].includes(relation)) return "impacts collateral";
      return null;
    };

    const positiveInteger = (...values: unknown[]): number | undefined => {
      for (const value of values) {
        const number = Number(value);
        if (value !== null && value !== undefined && value !== "" && Number.isInteger(number) && number > 0) {
          return number;
        }
      }
      return undefined;
    };

    const safeId = (value: unknown, fallback: string) => {
      const text = String(value ?? "").trim();
      return text ? text.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90) : fallback;
    };

    let claimRow = 0;
    let factRow = 0;
    let collateralRow = 0;

    findingsInScope.forEach(({ finding, index }) => {
      const flaggedText = String(finding?.flagged_text ?? finding?.claim_text ?? "").trim();
      // Without an actual extracted span there is no claim node to display.
      if (!flaggedText) return;

      const pageValue = Number(finding?.page);
      const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
      const rawId = safeId(finding?.id ?? finding?.finding_id, `finding-${index + 1}`);
      const claimId = `claim-${rawId}-${index}`;
      const markerId = positiveInteger(finding?.marker_id, finding?.markerId);
      const severity = String(finding?.severity ?? "").trim().toLowerCase();
      const rawCategory = String(finding?.category ?? finding?.finding_type ?? finding?.type ?? "").trim().toLowerCase();
      let category: NodeData["category"] = "match";
      if (rawCategory.includes("conflict") || rawCategory.includes("contradict")) category = "conflict";
      else if (rawCategory.includes("stale") || rawCategory.includes("outdated")) category = "stale";
      else if (rawCategory.includes("ungrounded") || rawCategory.includes("unsourced") || rawCategory.includes("unsupported")) category = "ungrounded";
      else if (rawCategory.includes("pricing")) category = "pricing";
      else if (rawCategory.includes("spec")) category = "spec";
      else if (rawCategory.includes("banned") || rawCategory.includes("rule")) category = "banned_rule";

      const claimY = 35 + claimRow * 145;
      claimRow += 1;
      nodes.push({
        id: claimId,
        page,
        ...(markerId ? { markerId } : {}),
        type: "claim",
        category,
        technicalType: `EXTRACTED SPAN · PAGE ${page}${severity ? ` · ${severity.toUpperCase()} SEVERITY` : ""}`,
        title: flaggedText,
        subtitle: String(finding?.explanation ?? finding?.reason ?? finding?.description ?? "No explanation was supplied for this finding."),
        x: 265,
        y: claimY,
      });

      // A fact/rule node is shown only if the finding actually names one.
      const factTitle = String(
        finding?.rule_title ?? finding?.rule_name ?? finding?.source_title ??
        finding?.evidence_title ?? finding?.policy_title ?? ""
      ).trim();
      const factSubtitle = String(
        finding?.rule_text ?? finding?.source_text ?? finding?.approved_fact ??
        finding?.evidence_text ?? finding?.policy_text ?? ""
      ).trim();
      const relation = normalizeRelation(finding?.relation ?? finding?.relationship);
      let factId: string | undefined;

      if (factTitle) {
        factId = `fact-${safeId(finding?.rule_id ?? finding?.source_id ?? factTitle, `finding-${index + 1}`)}-${index}`;
        const factY = 35 + factRow * 145;
        factRow += 1;
        const factText = `${factTitle} ${factSubtitle}`.toLowerCase();
        let factCategory: NodeData["category"] = "spec";
        if (factText.includes("banned") || factText.includes("prohibit") || factText.includes("policy") || factText.includes("rule")) factCategory = "banned_rule";
        else if (factText.includes("price") || factText.includes("discount") || factText.includes("cost")) factCategory = "pricing";
        nodes.push({
          id: factId,
          page,
          type: "fact",
          category: factCategory,
          technicalType: "SOURCE / RULE PROVIDED WITH FINDING",
          title: factTitle,
          subtitle: factSubtitle || "The finding references this source but provides no additional source text.",
          x: 25,
          y: factY,
        });
        // A relation edge is created only when the finding explicitly supplies
        // a recognized relation and the corresponding source node exists.
        if (relation) {
          edges.push({
            id: `edge-${factId}-${claimId}-${relation}`,
            sourceId: factId,
            targetId: claimId,
            relation,
          });
        }
      } else if (relation === "no source") {
        // This is a missing-source status marker, not a fabricated evidence item.
        factId = `missing-source-${claimId}`;
        const factY = 35 + factRow * 145;
        factRow += 1;
        nodes.push({
          id: factId,
          page,
          type: "fact",
          category: "ungrounded",
          technicalType: "SOURCE STATUS · MISSING EVIDENCE",
          title: "Source not provided",
          subtitle: "The finding is marked as missing a source; no supporting source was supplied.",
          x: 25,
          y: factY,
        });
        edges.push({
          id: `edge-${factId}-${claimId}-no-source`,
          sourceId: factId,
          targetId: claimId,
          relation: "no source",
        });
      }

      const collateralValue = finding?.impacted_collateral ?? finding?.impactedCollateral;
      const collateralItems = Array.isArray(collateralValue)
        ? collateralValue
        : typeof collateralValue === "string" && collateralValue.trim()
          ? [collateralValue]
          : [];
      collateralItems.forEach((item: any, collateralIndex: number) => {
        const title = typeof item === "string"
          ? item.trim()
          : String(item?.title ?? item?.name ?? "").trim();
        if (!title) return;
        const collateralId = `collateral-${safeId(item?.id ?? title, `finding-${index + 1}-${collateralIndex + 1}`)}-${index}-${collateralIndex}`;
        const collateralY = 35 + collateralRow * 145;
        collateralRow += 1;
        nodes.push({
          id: collateralId,
          page,
          type: "collateral",
          category: "collateral",
          technicalType: "IMPACTED COLLATERAL · SOURCE DATA",
          title,
          subtitle: typeof item === "object" && item ? String(item?.description ?? item?.subtitle ?? "") : "",
          x: 505,
          y: collateralY,
        });
        edges.push({
          id: `edge-${claimId}-${collateralId}`,
          sourceId: claimId,
          targetId: collateralId,
          relation: "impacts collateral",
        });
      });
    });

    return { nodes, edges };
  }, [allFindings, selectedPage]);

  const [nodes, setNodes] = useState<NodeData[]>(graphNodes);
  const [filter, setFilter] = useState<"all" | "contradicts" | "outdated" | "no source" | "impacts collateral">("all");
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  // Sync state when page changes or nodes regenerate
  useEffect(() => {
    setNodes(graphNodes);
    const initialSelect = graphNodes.find((n) => n.type === "claim") || graphNodes[0] || null;
    setSelectedNode(initialSelect);
  }, [graphNodes]);

  // Canvas Dragging State
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Live Dynamic AI Copilot State
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAsked, setAiAsked] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiHistory, setAiHistory] = useState<ChatTurn[]>([]); // conversation about the selected node

  function handleSelectNode(node: NodeData) {
    if (selectedNode?.id !== node.id) {
      setSelectedNode(node);
      setAiAnswer(null);
      setAiSource(null);
      setAiAsked(null);
      setAiError(null);
      setAiHistory([]);
      setAiQuestion("");
    }
  }

  function handleMouseDown(e: React.MouseEvent, node: NodeData) {
    e.stopPropagation();
    setDraggingId(node.id);
    handleSelectNode(node);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (canvasRect) {
      setDragOffset({
        x: e.clientX - canvasRect.left - node.x,
        y: e.clientY - canvasRect.top - node.y,
      });
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!draggingId || !canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const newX = Math.max(10, Math.min(canvasRect.width - 230, e.clientX - canvasRect.left - dragOffset.x));
    const newY = Math.max(10, Math.min(canvasRect.height - 110, e.clientY - canvasRect.top - dragOffset.y));
    setNodes((prev) =>
      prev.map((n) => (n.id === draggingId ? { ...n, x: newX, y: newY } : n))
    );
  }

  function handleMouseUp() {
    setDraggingId(null);
  }

  async function handleAskAI(customQ?: string) {
    if (!selectedNode || aiLoading) return;
    const q = customQ || aiQuestion;
    if (!q || !q.trim()) return;
    setAiAsked(q.trim());
    setAiQuestion("");
    setAiError(null);
    setAiSource(null);
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const res = await askAI({
        node_text: `${selectedNode.title}: ${selectedNode.subtitle}`,
        question: q.trim(),
        node_type: selectedNode.technicalType,
        history: aiHistory,
      });
      setAiHistory((h) => [...h, { role: "user", text: q.trim() }, { role: "ai", text: res.answer }]);
      setAiAnswer(res.answer);
      setAiSource(res.source || "AI Copilot");
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "The AI request failed. Check the backend configuration and try again."
      );
    } finally {
      setAiLoading(false);
    }
  }

  const conflictsCount = graphEdges.filter((e) => e.relation === "contradicts").length;
  const staleCount = graphEdges.filter((e) => e.relation === "outdated").length;
  const unsourcedCount = graphEdges.filter((e) => e.relation === "no source").length;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        padding: 20,
        position: "relative",
        userSelect: "none",
        minHeight: 580,
      }}
    >
      {/* Top Header and Triage Filter Chips */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <span className="eyebrow">TOPOLOGICAL EVIDENCE AUDIT</span>
          <h2 style={{ margin: "2px 0 0", fontSize: 18 }}>Fact-to-Claim Provenance Graph</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11 }}>
            Cards = Verdicts. Graph = Accountability. Drag nodes freely; click any card to inspect.
          </p>
        </div>

        {/* Triage Filter Chips */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`secondary-button ${filter === "all" ? "primary-button" : ""}`}
            onClick={() => setFilter("all")}
            style={{ minHeight: 30, padding: "4px 10px", fontSize: 11 }}
          >
            All Nodes ({nodes.length})
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFilter("contradicts")}
            style={{
              minHeight: 30,
              padding: "4px 10px",
              fontSize: 11,
              color: "#ff987e",
              borderColor: filter === "contradicts" ? "#ff987e" : "var(--border)",
            }}
          >
            🚫 Conflicts ({conflictsCount})
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFilter("outdated")}
            style={{
              minHeight: 30,
              padding: "4px 10px",
              fontSize: 11,
              color: "#f5ce75",
              borderColor: filter === "outdated" ? "#f5ce75" : "var(--border)",
            }}
          >
            ⏳ Blast-Radius / Stale ({staleCount})
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFilter("no source")}
            style={{
              minHeight: 30,
              padding: "4px 10px",
              fontSize: 11,
              color: "#a99aff",
              borderColor: filter === "no source" ? "#a99aff" : "var(--border)",
            }}
          >
            ❓ Unsourced Gaps ({unsourcedCount})
          </button>
        </div>
      </div>

      {/* PAGE SCOPE SELECTOR BAR */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 14,
          background: "#080a1c",
          padding: "8px 14px",
          borderRadius: 12,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--cyan)", letterSpacing: 0.5 }}>
            📄 GRAPH VIEW SCOPE:
          </span>
          <button
            type="button"
            onClick={() => setSelectedPage("all")}
            style={{
              background: selectedPage === "all" ? "var(--cyan)" : "#171b35",
              color: selectedPage === "all" ? "#080a1c" : "var(--text)",
              border: "none",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🌐 Full Campaign Mesh ({totalPagesCount} Pages)
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", maxWidth: "65%" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", marginRight: 4 }}>Pages:</span>
          {Array.from({ length: totalPagesCount }).map((_, i) => {
            const pNum = i + 1;
            const isCurrent = selectedPage === pNum;

            return (
              <button
                key={pNum}
                type="button"
                onClick={() => setSelectedPage(pNum)}
                style={{
                  background: isCurrent ? "var(--cyan)" : "#171b35",
                  color: isCurrent ? "#080a1c" : "var(--muted)",
                  border: "none",
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                P.{pNum}
              </button>
            );
          })}
        </div>
      </div>

      {/* DOCKED SIDE-BY-SIDE GRID LAYOUT (ZERO SUPERIMPOSITION) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: selectedNode ? "minmax(0, 1fr) 340px" : "1fr",
          gap: 16,
          alignItems: "stretch",
          transition: "grid-template-columns 200ms ease",
        }}
      >
        {/* ========================================================================= */}
        {/* LEFT: UNOBSTRUCTED GRAPH CANVAS */}
        {/* ========================================================================= */}
        <div
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: "relative",
            height: Math.max(540, ...nodes.map((node) => node.y + 140)),
            background: "radial-gradient(ellipse at 50% 50%, #0c112e 0%, #080a1c 100%)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {/* Dynamic Curved Energy Beams with Traveling Particles */}
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <defs>
              <linearGradient id="grad-contradicts" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ff987e" />
                <stop offset="100%" stopColor="#ff5757" />
              </linearGradient>
              <linearGradient id="grad-stale" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f5ce75" />
                <stop offset="100%" stopColor="#e6a858" />
              </linearGradient>
              <linearGradient id="grad-unsupported" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#a99aff" />
                <stop offset="100%" stopColor="#6c5ce7" />
              </linearGradient>
              <linearGradient id="grad-collateral" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cyan)" />
                <stop offset="100%" stopColor="#a99aff" />
              </linearGradient>
            </defs>

            {graphEdges.map((edge) => {
              const source = nodes.find((n) => n.id === edge.sourceId);
              const target = nodes.find((n) => n.id === edge.targetId);
              if (!source || !target) return null;
              if (filter !== "all" && edge.relation !== filter) return null;

              const x1 = source.x + 215;
              const y1 = source.y + 40;
              const x2 = target.x;
              const y2 = target.y + 40;
              const midX = (x1 + x2) / 2;
              const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

              const isContradict = edge.relation === "contradicts";
              const isStale = edge.relation === "outdated";
              const isCollateral = edge.relation === "impacts collateral";

              const strokeColor = isContradict
                ? "url(#grad-contradicts)"
                : isStale
                ? "url(#grad-stale)"
                : isCollateral
                ? "url(#grad-collateral)"
                : "url(#grad-unsupported)";

              const isSpotlit =
                !selectedNode || selectedNode.id === source.id || selectedNode.id === target.id;

              return (
                <g key={edge.id} opacity={isSpotlit ? 1 : 0.2}>
                  <path d={pathD} fill="none" stroke={strokeColor} strokeWidth={4} strokeOpacity={0.25} />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={2}
                    strokeDasharray={isContradict ? "6 4" : "none"}
                    strokeLinecap="round"
                  />
                  <circle r="3.5" fill="#ffffff">
                    <animateMotion dur="2.4s" repeatCount="indefinite" path={pathD} />
                  </circle>
                  <foreignObject x={midX - 44} y={(y1 + y2) / 2 - 11} width={88} height={24}>
                    <div
                      style={{
                        background: "#080a1c",
                        border: `1px solid ${
                          isContradict
                            ? "#ff987e88"
                            : isStale
                            ? "#f5ce7588"
                            : isCollateral
                            ? "#12c4d488"
                            : "#a99aff88"
                        }`,
                        borderRadius: 10,
                        fontSize: 8,
                        fontWeight: 800,
                        color: isContradict
                          ? "#ff987e"
                          : isStale
                          ? "#f5ce75"
                          : isCollateral
                          ? "var(--cyan)"
                          : "#a99aff",
                        textAlign: "center",
                        lineHeight: "20px",
                        boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                      }}
                    >
                      {edge.relation}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>

          {/* Draggable Active-Reasoning Cards */}
          {nodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const isSpotlit =
              !selectedNode ||
              selectedNode.id === node.id ||
              graphEdges.some(
                (e) =>
                  (e.sourceId === selectedNode.id && e.targetId === node.id) ||
                  (e.targetId === selectedNode.id && e.sourceId === node.id)
              );

            const visual = getContextualVisual(node.title + " " + node.subtitle, node.type);

            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleMouseDown(e, node)}
                style={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  width: 215,
                  padding: 12,
                  borderRadius: 12,
                  cursor: "grab",
                  zIndex: isSelected ? 10 : 3,
                  opacity: isSpotlit ? 1 : 0.25,
                  transition: draggingId === node.id ? "none" : "box-shadow 150ms ease, opacity 200ms ease",
                  background: isSelected ? "var(--surface-raised)" : "var(--surface)",
                  border: `1px solid ${visual.color}`,
                  boxShadow: isSelected
                    ? "0 0 20px rgba(18, 196, 212, 0.45)"
                    : "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      background: `${visual.color}18`,
                    }}
                  >
                    {visual.icon}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 8.5,
                          fontWeight: 800,
                          color: visual.color,
                          letterSpacing: 0.5,
                        }}
                      >
                        {visual.badge}
                      </span>
                      {node.page && (
                        <span
                          style={{
                            fontSize: 8.5,
                            fontWeight: 800,
                            background: "#12c4d420",
                            color: "var(--cyan)",
                            padding: "1px 4px",
                            borderRadius: 4,
                          }}
                        >
                          P.{node.page}
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        margin: "3px 0 0",
                        fontSize: 10.5,
                        fontWeight: 650,
                        lineHeight: 1.35,
                        color: "var(--text)",
                      }}
                    >
                      {node.title}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* RIGHT: DOCKED AI AUDIT COPILOT (ZERO OVERLAP!) */}
        {/* ========================================================================= */}
        {selectedNode && (
          <div
            style={{
              background: "rgba(16, 19, 41, 0.98)",
              border: "1px solid var(--cyan)",
              borderRadius: 16,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              height: 540,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--cyan)" }}>
                <Sparkles size={16} />
                <span style={{ fontSize: 11, fontWeight: 800 }}>LIVE AI AUDIT COPILOT</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                style={{ background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Jump to Creative View Button if Node is a Document Claim */}
            {selectedNode.type === "claim" && selectedNode.page && (
              <button
                type="button"
                onClick={() => {
                  if (onNavigateToPage && selectedNode.page) {
                    onNavigateToPage(selectedNode.page, selectedNode.markerId);
                  }
                }}
                className="primary-button"
                style={{
                  width: "100%",
                  marginBottom: 12,
                  minHeight: 32,
                  fontSize: 11,
                  padding: "6px 12px",
                  background: "var(--cyan)",
                  color: "#080a1c",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 800,
                }}
              >
                <span>🎨 Inspect on Page {selectedNode.page} in Creative View</span>
                <ArrowUpRight size={13} />
              </button>
            )}

            {/* Inspected Node Card */}
            <div style={{ background: "var(--bg)", padding: 10, borderRadius: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: "var(--cyan)" }}>
                {selectedNode.technicalType}
              </span>
              <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                {selectedNode.title}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 9.5, color: "var(--muted)", lineHeight: 1.5 }}>
                {selectedNode.subtitle}
              </p>
            </div>

            {/* AI Reasoning Response Box */}
            <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
              {aiLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      border: "2px solid var(--cyan)",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      margin: "0 auto 10px",
                    }}
                  />
                  <p style={{ margin: 0, fontSize: 11, color: "var(--cyan)", fontWeight: 600 }}>
                    Consulting the configured AI provider...
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--muted)" }}>
                    Cross-referencing FTC §5, FDA rules & active brand dossier
                  </p>
                </div>
              ) : aiError ? (
                <p role="alert" style={{ color: "#f5ce75", fontSize: 11, lineHeight: 1.5 }}>
                  {aiError}
                </p>
              ) : aiAnswer ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {aiHistory.slice(0, -2).map((turn, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 10, lineHeight: 1.5, color: "var(--muted)", fontStyle: turn.role === "user" ? "italic" : "normal" }}>
                      {turn.role === "user" ? "You: " : "AI: "}{turn.text}
                    </p>
                  ))}
                  <div
                    style={{
                      background: "rgba(18, 196, 212, 0.08)",
                      border: "1px solid rgba(18, 196, 212, 0.25)",
                      borderRadius: 10,
                      padding: 12,
                      fontSize: 11,
                      lineHeight: 1.6,
                      color: "var(--text)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: "var(--cyan)", letterSpacing: 0.5 }}>
                        ✨ {aiSource || "AI COPILOT"}
                      </span>
                    </div>
                    {aiAsked && (
                      <p style={{ margin: "0 0 8px", fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
                        You asked: {aiAsked}
                      </p>
                    )}
                    <p style={{ margin: 0 }}>{aiAnswer}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Explain that more simply", "Give a concrete example", "Make it shorter"].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="secondary-button"
                        disabled={aiLoading}
                        onClick={() => handleAskAI(p)}
                        style={{ fontSize: 10, padding: "5px 9px" }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setAiAnswer(null);
                      setAiAsked(null);
                      setAiError(null);
                      setAiHistory([]);
                      setAiQuestion("");
                    }}
                    style={{ fontSize: 10, padding: "6px 10px", alignSelf: "flex-start", gap: 4 }}
                  >
                    <RefreshCw size={11} /> New topic on this node
                  </button>
                </div>
              ) : (
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Select an AI Audit Prompt:
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("Why did the AI flag this node as a contradiction or compliance issue?")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <MessageSquare size={12} color="#ff987e" /> Why is this flagged as a contradiction?
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("Calculate the blast radius: which other collateral files or pages depend on this claim?")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left", color: "#f5ce75" }}
                    >
                      <Clock size={12} color="#f5ce75" /> ⏳ Calculate Blast Radius across collateral
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("Suggest a legally compliant rewrite that preserves marketing tone.")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <GitMerge size={12} color="var(--cyan)" /> Suggest compliant rewrite
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("What specific clinical or regulatory test data is required under FTC/FDA to substantiate this?")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <FlaskConical size={12} color="#9ce5d1" /> What test data substantiates this?
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Free-form Custom AI Prompt Input */}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder={aiAnswer ? "Ask a follow-up, e.g. explain it more simply..." : "Ask the AI about this node..."}
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !aiLoading && handleAskAI()}
                style={{
                  flex: 1,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "var(--text)",
                  fontSize: 11,
                }}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => handleAskAI()}
                style={{ padding: "8px 12px", minHeight: "auto" }}
                disabled={aiLoading}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}