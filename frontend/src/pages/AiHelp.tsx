import { useState } from "react";
import { askAI } from "../api.ts";

interface ChatMessage {
  sender: "user" | "ai";
  text: string;
  source?: string;
  timestamp: string;
}

export default function AiHelp() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: "ai",
      text: "👋 Welcome to the Brand & Compliance AI Help Center. You can ask me any questions about approved claims, regulatory policies (FDA, FTC, EU Cosmetics), or ask me to draft compliant copy before you submit it.",
      source: "Gemini 1.5 Flash",
      timestamp: "Just now",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async (questionText?: string) => {
    const q = questionText || input;
    if (!q.trim() || loading) return;

    const userMsg: ChatMessage = {
      sender: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!questionText) setInput("");
    setLoading(true);

    try {
      const res = await askAI({
        question: q,
        node_text: "Brand Policy & Guideline Assistance",
        node_type: "General Compliance Inquiry",
      });

      const aiMsg: ChatMessage = {
        sender: "ai",
        text: res.answer,
        source: res.source,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: "Sorry, I could not connect to the backend server. Please make sure the Python server is running.",
          timestamp: "Error",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sampleQuestions = [
    "Can we claim 'Reverses aging' on US skincare packaging?",
    "What is our approved wording for clinical trial results?",
    "What fine-print disclaimer is required for discount promo codes?",
    "How should I state that our ingredients are organic without legal risk?",
  ];

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "32px 24px", color: "#f1f5f9" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <span style={{ fontSize: "30px" }}>🤖</span>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, color: "#ffffff" }}>
            Brand & Regulatory AI Help Center
          </h1>
          <span style={{ fontSize: "11px", background: "#6366f120", color: "#a5b4fc", border: "1px solid #6366f150", padding: "3px 10px", borderRadius: "12px", fontWeight: 600 }}>
            Gemini 1.5 Flash Connected
          </span>
        </div>
        <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
          Ask compliance questions, verify regulatory boundaries, and get pre-approved marketing phrasing before creating assets.
        </p>
      </div>

      {/* Suggested Quick Prompts */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
        {sampleQuestions.map((sq, i) => (
          <button
            key={i}
            onClick={() => handleSend(sq)}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#cbd5e1",
              fontSize: "12px",
              padding: "7px 12px",
              borderRadius: "20px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            💡 {sq}
          </button>
        ))}
      </div>

      {/* Chat Thread Container */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: "14px",
          height: "500px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
          {messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                maxWidth: "75%",
                display: "flex",
                flexDirection: "column",
                alignItems: m.sender === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  background: m.sender === "user" ? "#4f46e5" : "#1e293b",
                  color: "#f8fafc",
                  padding: "12px 16px",
                  borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                  fontSize: "14px",
                  lineHeight: "1.6",
                  whiteSpace: "pre-wrap",
                  border: m.sender === "user" ? "none" : "1px solid #334155",
                }}
              >
                {m.text}
              </div>
              <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "#64748b", marginTop: "4px", padding: "0 4px" }}>
                <span>{m.timestamp}</span>
                {m.source && <span>• {m.source}</span>}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start", background: "#1e293b", padding: "10px 16px", borderRadius: "12px", color: "#94a3b8", fontSize: "13px" }}>
              ✨ Gemini AI is analyzing brand guidelines...
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div style={{ padding: "16px", background: "#090d16", borderTop: "1px solid #334155", display: "flex", gap: "10px" }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask anything about brand guidelines, legal phrasing, or claim rules..."
            style={{
              flex: 1,
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "8px",
              padding: "12px 16px",
              color: "#f8fafc",
              fontSize: "14px",
              outline: "none",
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={loading}
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "0 22px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}