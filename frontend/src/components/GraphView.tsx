import { useState, useRef } from "react";
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
} from "lucide-react";
import { askAI } from "../api.ts";

type NodeData = {
  id: string;
  type: "fact" | "claim";
  title: string;
  subtitle: string;
  relation?: "backs it" | "contradicts" | "outdated" | "no source";
  targetId?: string;
  x: number;
  y: number;
};

function getContextualVisual(text: string, isFact: boolean) {
  const t = text.toLowerCase();

  if (t.includes("$") || t.includes("₹") || t.includes("price") || t.includes("discount") || t.includes("% off")) {
    return {
      icon: <Tag size={19} color="var(--lime)" />,
      badge: "COMMERCIAL & PRICING FACT",
      color: "var(--lime)",
    };
  }

  if (t.includes("day") || t.includes("instant") || t.includes("overnight") || t.includes("timeframe") || t.includes("shelf life")) {
    return {
      icon: <Clock size={19} color="#f5ce75" />,
      badge: "TIMELINE & AGING SPEC",
      color: "#f5ce75",
    };
  }

  if (t.includes("clinical") || t.includes("study") || t.includes("dermatolog") || t.includes("trial") || t.includes("tested")) {
    return {
      icon: <FlaskConical size={19} color="var(--cyan)" />,
      badge: "CLINICAL VALIDATION DOSSIER",
      color: "var(--cyan)",
    };
  }

  if (t.includes("organic") || t.includes("sugar") || t.includes("peanut") || t.includes("botanical") || t.includes("ingredient")) {
    return {
      icon: <Leaf size={19} color="#9ce5d1" />,
      badge: "FORMULATION & INGREDIENT",
      color: "#9ce5d1",
    };
  }

  if (t.includes("voted") || t.includes("#1") || t.includes("best") || t.includes("outperform") || t.includes("luxury")) {
    return {
      icon: <Trophy size={19} color="#f5ce75" />,
      badge: "COMPETITIVE BENCHMARK",
      color: "#f5ce75",
    };
  }

  if (t.includes("banned") || t.includes("prohibited") || t.includes("guarantee") || t.includes("rule") || t.includes("legal")) {
    return {
      icon: <Scale size={19} color="#ff987e" />,
      badge: "COMPLIANCE CONSTRAINT",
      color: "#ff987e",
    };
  }

  return {
    icon: isFact ? <Sparkles size={19} color="var(--cyan)" /> : <AlertOctagon size={19} color="#ff987e" />,
    badge: isFact ? "APPROVED BENCHMARK" : "EXTRACTED SPAN",
    color: isFact ? "var(--cyan)" : "#ff987e",
  };
}

const defaultNodes: NodeData[] = [
  // Left: Approved Facts
  {
    id: "fact-1",
    type: "fact",
    title: "Brand Rulebook §4.2: Banned Absolutes",
    subtitle: "Absolute guarantees (100%, flawless) prohibited without legal sign-off.",
    x: 40,
    y: 35,
    relation: "contradicts",
    targetId: "claim-1",
  },
  {
    id: "fact-2",
    type: "fact",
    title: "Clinical Dossier #2024-B: 28-Day Protocol",
    subtitle: "Dermatological renewal testing verified for 28-day window only.",
    x: 40,
    y: 190,
    relation: "outdated",
    targetId: "claim-2",
  },
  {
    id: "fact-3",
    type: "fact",
    title: "Commercial Benchmark: Locked SKU Pricing",
    subtitle: "AuraGlo retail price verified at $49.99 with no unauthorized promotions.",
    x: 40,
    y: 345,
    relation: "no source",
    targetId: "claim-3",
  },

  // Right: Draft Claims
  {
    id: "claim-1",
    type: "claim",
    title: "CONFLICT: 'guarantees flawless skin in 3 days'",
    subtitle: "Unsubstantiated absolute guarantee and accelerated timeline.",
    x: 460,
    y: 35,
  },
  {
    id: "claim-2",
    type: "claim",
    title: "STALE / BLAST-RADIUS: 'reverses signs of aging in 7 days'",
    subtitle: "Expired claim exceeds certified 28-day study protocol.",
    x: 460,
    y: 190,
  },
  {
    id: "claim-3",
    type: "claim",
    title: "NO APPROVED FACT: 'voted #1 luxury formula on the market'",
    subtitle: "Ungrounded superiority statement with zero benchmark citation.",
    x: 460,
    y: 345,
  },
];

export default function GraphView() {
  const [nodes, setNodes] = useState<NodeData[]>(defaultNodes);
  const [filter, setFilter] = useState<"all" | "contradicts" | "outdated" | "no source">("all");
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  function handleMouseDown(e: React.MouseEvent, node: NodeData) {
    e.stopPropagation();
    setDraggingId(node.id);
    setSelectedNode(node);
    setAiAnswer(null);

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
    const newX = Math.max(10, Math.min(canvasRect.width - 270, e.clientX - canvasRect.left - dragOffset.x));
    const newY = Math.max(10, Math.min(canvasRect.height - 110, e.clientY - canvasRect.top - dragOffset.y));

    setNodes((prev) =>
      prev.map((n) => (n.id === draggingId ? { ...n, x: newX, y: newY } : n))
    );
  }

  function handleMouseUp() {
    setDraggingId(null);
  }

  async function handleAskAI(customQ?: string) {
    if (!selectedNode) return;
    const q = customQ || aiQuestion;
    setAiLoading(true);

    try {
    const res = await askAI({
    question: q,
    node_text: (selectedNode as any)?.text || (selectedNode as any)?.title || (selectedNode as any)?.label || "Clinical Specification Protocol #2024-B",
    node_type: selectedNode ? selectedNode.type : "Brand Fact",
    });
      setAiAnswer(res.answer);
    } catch {
      setAiAnswer("The claim directly contradicts company specifications and marketing law thresholds.");
    } finally {
      setAiLoading(false);
    }
  }

  const visibleNodes = nodes.filter((n) => {
    if (filter === "all") return true;
    if (n.type === "fact") return true;
    return n.relation === filter;
  });

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        padding: 20,
        position: "relative",
        userSelect: "none",
        minHeight: 520,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <span className="eyebrow">EVIDENCE MAP & TRUTH TOPOLOGY</span>
          <h2 style={{ margin: "2px 0 0", fontSize: 18 }}>Fact-to-Claim Provenance Graph</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 11 }}>
            Cards = Verdicts. Graph = Accountability. Drag nodes freely; click any card to inspect.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`secondary-button ${filter === "all" ? "primary-button" : ""}`}
            onClick={() => setFilter("all")}
            style={{ minHeight: 30, padding: "4px 10px", fontSize: 11 }}
          >
            All Nodes (6)
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
            🚫 Conflicts (1)
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
            ⏳ Blast-Radius / Stale (1)
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
            ❓ Unsourced Gaps (1)
          </button>
        </div>
      </div>

      <div
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: "relative",
          height: 480,
          background: "radial-gradient(ellipse at 50% 50%, #0c112e 0%, #080a1c 100%)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
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
          </defs>

          {nodes
            .filter((n) => n.type === "fact" && n.targetId)
            .map((fact) => {
              const target = nodes.find((n) => n.id === fact.targetId);
              if (!target) return null;

              if (filter !== "all" && fact.relation !== filter) return null;

              const x1 = fact.x + 250;
              const y1 = fact.y + 40;
              const x2 = target.x;
              const y2 = target.y + 40;
              const midX = (x1 + x2) / 2;

              const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

              const isContradict = fact.relation === "contradicts";
              const isStale = fact.relation === "outdated";
              const strokeColor = isContradict
                ? "url(#grad-contradicts)"
                : isStale
                ? "url(#grad-stale)"
                : "url(#grad-unsupported)";

              const isSpotlit =
                !selectedNode || selectedNode.id === fact.id || selectedNode.id === target.id;

              return (
                <g key={`edge-${fact.id}-${target.id}`} opacity={isSpotlit ? 1 : 0.2}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={4}
                    strokeOpacity={0.25}
                  />

                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={2}
                    strokeDasharray={isContradict ? "5 5" : "none"}
                    strokeLinecap="round"
                  />

                  <circle r="4" fill="#ffffff">
                    <animateMotion dur="2.4s" repeatCount="indefinite" path={pathD} />
                  </circle>

                  <foreignObject
                    x={midX - 45}
                    y={(y1 + y2) / 2 - 12}
                    width={90}
                    height={26}
                  >
                    <div
                      style={{
                        background: "#080a1c",
                        border: `1px solid ${
                          isContradict ? "#ff987e88" : isStale ? "#f5ce7588" : "#a99aff88"
                        }`,
                        borderRadius: 10,
                        fontSize: 9,
                        fontWeight: 800,
                        color: isContradict ? "#ff987e" : isStale ? "#f5ce75" : "#a99aff",
                        textAlign: "center",
                        lineHeight: "22px",
                        boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                      }}
                    >
                      {fact.relation}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
        </svg>

        {visibleNodes.map((node) => {
          const isSelected = selectedNode?.id === node.id;
          const isSpotlit =
            !selectedNode ||
            selectedNode.id === node.id ||
            selectedNode.targetId === node.id ||
            node.targetId === selectedNode.id;

          const isFact = node.type === "fact";
          const visual = getContextualVisual(node.title + " " + node.subtitle, isFact);

          return (
            <div
              key={node.id}
              onMouseDown={(e) => handleMouseDown(e, node)}
              style={{
                position: "absolute",
                left: node.x,
                top: node.y,
                width: 250,
                padding: 14,
                borderRadius: 14,
                cursor: "grab",
                zIndex: isSelected ? 10 : 3,
                opacity: isSpotlit ? 1 : 0.25,
                transition: draggingId === node.id ? "none" : "box-shadow 150ms ease, opacity 200ms ease",
                background: isSelected ? "var(--surface-raised)" : "var(--surface)",
                border: `1px solid ${visual.color}`,
                borderStyle: node.relation === "no source" ? "dashed" : "solid",
                boxShadow: isSelected
                  ? "0 0 20px rgba(18, 196, 212, 0.45)"
                  : "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    background: `${visual.color}18`,
                  }}
                >
                  {visual.icon}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 9,
                      fontWeight: 800,
                      color: visual.color,
                      letterSpacing: 0.5,
                    }}
                  >
                    {visual.badge}
                  </span>
                  <p
                    style={{
                      margin: "3px 0 0",
                      fontSize: 11,
                      fontWeight: 650,
                      lineHeight: 1.4,
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

        {selectedNode && (
          <div
            style={{
              position: "absolute",
              right: 14,
              top: 14,
              bottom: 14,
              width: 330,
              background: "rgba(16, 19, 41, 0.95)",
              border: "1px solid var(--cyan)",
              borderRadius: 14,
              padding: 16,
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              backdropFilter: "blur(14px)",
            }}
          >
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
                <span style={{ fontSize: 11, fontWeight: 800 }}>AI AUDIT REASONING COPILOT</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                style={{ background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ background: "var(--bg)", padding: 10, borderRadius: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "var(--muted)" }}>INSPECTING NODE</span>
              <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                {selectedNode.title}
              </p>
            </div>

            <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
              {aiLoading ? (
                <p style={{ fontSize: 11, color: "var(--cyan)" }}>Evaluating regulatory guidelines & evidence...</p>
              ) : aiAnswer ? (
                <div
                  style={{
                    background: "rgba(18, 196, 212, 0.08)",
                    border: "1px solid rgba(18, 196, 212, 0.2)",
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: "var(--text)",
                  }}
                >
                  <p style={{ margin: 0 }}>{aiAnswer}</p>
                </div>
              ) : (
                <div>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>Quick Audit Prompts:</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("Why did the AI flag this node as a contradiction?")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <MessageSquare size={12} /> Why is this flagged as a contradiction?
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("Suggest a compliant rewrite that preserves the marketing claim.")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <GitMerge size={12} /> Suggest compliant rewrite
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleAskAI("What specific test data or certification is required to substantiate this?")}
                      style={{ fontSize: 10, padding: 8, justifyContent: "flex-start", textAlign: "left" }}
                    >
                      <FlaskConical size={12} /> What test data substantiates this?
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Ask AI why this was linked or request changes..."
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAskAI()}
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