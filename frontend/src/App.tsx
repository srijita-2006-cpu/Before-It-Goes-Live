
import { useState } from "react";
import {
  ShieldCheck,
  FileSearch,
  ChartNoAxesCombined,
  BookOpen,
  Moon,
  Sun,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Search,
  RotateCcw,
} from "lucide-react";

type Screen = "home" | "check" | "results" | "rules";

type Analysis = {
  claim: string;
  verdict: string;
  confidence: number;
  explanation: string;
  evidence: { label: string; score: number }[];
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [dark, setDark] = useState(false);
  const [claim, setClaim] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  function analyseClaim() {
    if (!claim.trim()) {
      setError("Enter a claim before continuing.");
      return;
    }

    setError("");

    // Demo result only. Replace with the Python API in the backend stage.
    setAnalysis({
      claim: claim.trim(),
      verdict: "Needs verification",
      confidence: 0,
      explanation:
        "This demo has captured your claim, but has not checked it against external sources. A reliable verdict requires evidence, source credibility checks, and contextual analysis.",
      evidence: [
        { label: "Supporting evidence", score: 0 },
        { label: "Contradicting evidence", score: 0 },
        { label: "Unverified information", score: 100 },
      ],
    });

    setScreen("results");
  }

  function resetCheck() {
    setClaim("");
    setAnalysis(null);
    setError("");
    setScreen("check");
  }

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-stone-50 pb-24 text-stone-900 transition-colors dark:bg-stone-950 dark:text-stone-100">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-stone-200 bg-white/90 px-5 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90 sm:px-8">
          <button
            onClick={() => setScreen("home")}
            className="flex items-center gap-3 text-left"
          >
            <span className="rounded-xl bg-orange-600 p-2 text-white">
              <ShieldCheck size={23} />
            </span>
            <span>
              <span className="block font-bold tracking-tight">
                Before It Goes Live
              </span>
              <span className="block text-xs text-stone-500">
                Check before you share
              </span>
            </span>
          </button>

          <button
            onClick={() => setDark(!dark)}
            aria-label="Toggle light or dark mode"
            className="rounded-xl border border-stone-200 p-2.5 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>

        <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
          {screen === "home" && (
            <>
              <section className="relative overflow-hidden rounded-3xl bg-stone-900 px-7 py-10 text-white sm:px-12 sm:py-14">
                <div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full border-[35px] border-orange-500/20" />
                <div className="pointer-events-none absolute -bottom-24 right-28 h-48 w-48 rounded-full bg-orange-600/20 blur-2xl" />

                <div className="relative max-w-2xl">
                  <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-orange-300">
                    <ShieldCheck size={14} />
                    Pause. Check. Share.
                  </p>

                  <h1 className="text-4xl font-bold leading-tight sm:text-6xl">
                    Before it goes live, make sure it holds up.
                  </h1>

                  <p className="mt-5 max-w-xl leading-7 text-stone-300">
                    Examine claims, explore evidence, and identify what is
                    missing before information reaches other people.
                  </p>

                  <button
                    onClick={() => setScreen("check")}
                    className="mt-8 inline-flex items-center gap-3 rounded-xl bg-orange-600 px-5 py-3.5 font-semibold hover:bg-orange-500"
                  >
                    Check a claim <ArrowRight size={18} />
                  </button>
                </div>
              </section>

              <section className="mt-12">
                <div className="mb-6">
                  <p className="text-sm font-semibold uppercase tracking-widest text-orange-600">
                    How it works
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">
                    Look beyond the headline.
                  </h2>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Feature
                    number="01"
                    icon={<FileSearch size={23} />}
                    title="Examine the claim"
                    description="Start with the exact statement you want to check."
                  />
                  <Feature
                    number="02"
                    icon={<ChartNoAxesCombined size={23} />}
                    title="Explore the evidence"
                    description="See what is supported, contradicted, or still unknown."
                  />
                  <Feature
                    number="03"
                    icon={<BookOpen size={23} />}
                    title="Make an informed choice"
                    description="Understand the limits of the evidence before sharing."
                  />
                </div>
              </section>

              <section className="mt-8 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-bold">Not sure what to look for?</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    Learn the basic rules for evaluating a claim.
                  </p>
                </div>
                <button
                  onClick={() => setScreen("rules")}
                  className="inline-flex shrink-0 items-center gap-2 font-semibold text-orange-600"
                >
                  Explore the rules <ArrowRight size={17} />
                </button>
              </section>
            </>
          )}

          {screen === "check" && (
            <section className="mx-auto max-w-3xl">
              <BackButton onClick={() => setScreen("home")}>
                Back home
              </BackButton>

              <p className="mt-8 text-sm font-semibold uppercase tracking-widest text-orange-600">
                Claim checker
              </p>
              <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
                What do you want to verify?
              </h1>
              <p className="mt-4 leading-7 text-stone-600 dark:text-stone-400">
                Paste a factual statement, headline, or claim. Keep the
                original wording so it can be evaluated in context.
              </p>

              <div className="mt-7 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-6">
                <label htmlFor="claim" className="font-semibold">
                  Your claim
                </label>
                <textarea
                  id="claim"
                  value={claim}
                  onChange={(event) => {
                    setClaim(event.target.value);
                    setError("");
                  }}
                  maxLength={3000}
                  placeholder="Paste the statement you want to check..."
                  className="mt-3 min-h-48 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 p-4 leading-7 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-stone-700 dark:bg-stone-950"
                />

                <div className="mt-2 flex justify-between text-xs text-stone-500">
                  <span>{error || "Avoid removing important context."}</span>
                  <span>{claim.length}/3000</span>
                </div>

                <button
                  onClick={analyseClaim}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3.5 font-semibold text-white hover:bg-orange-700"
                >
                  <Search size={18} />
                  Examine claim
                </button>

                <p className="mt-3 text-center text-xs leading-5 text-stone-500">
                  The current demo does not retrieve sources or establish
                  whether a claim is true.
                </p>
              </div>
            </section>
          )}

          {screen === "results" && analysis && (
            <section className="mx-auto max-w-3xl">
              <BackButton onClick={() => setScreen("check")}>
                Edit claim
              </BackButton>

              <div className="mt-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-orange-600">
                <ChartNoAxesCombined size={18} />
                Analysis overview
              </div>

              <h1 className="mt-3 text-3xl font-bold">What we found</h1>

              <div className="mt-6 rounded-2xl border border-orange-300 bg-orange-50 p-5 dark:border-orange-900 dark:bg-orange-950/40">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="shrink-0 text-orange-600" size={24} />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-orange-700 dark:text-orange-400">
                      Current status
                    </p>
                    <h2 className="mt-1 text-xl font-bold">
                      {analysis.verdict}
                    </h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6">
                  This is a demo status, not a fact-checking verdict. No
                  external evidence has been evaluated yet.
                </p>
              </div>

              <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:p-6">
                <h3 className="font-bold">Claim submitted</h3>
                <p className="mt-3 whitespace-pre-wrap leading-7 text-stone-600 dark:text-stone-300">
                  {analysis.claim}
                </p>
                <div className="mt-5 border-t border-stone-200 pt-5 dark:border-stone-800">
                  <h3 className="font-bold">Explanation</h3>
                  <p className="mt-3 leading-7 text-stone-600 dark:text-stone-300">
                    {analysis.explanation}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 sm:p-6">
                <h3 className="font-bold">Evidence breakdown</h3>
                <p className="mt-2 text-sm text-stone-500">
                  Evidence categories are placeholders until the analysis
                  backend is connected.
                </p>

                <div className="mt-5 space-y-5">
                  {analysis.evidence.map((item) => (
                    <div key={item.label}>
                      <div className="mb-2 flex justify-between gap-3 text-sm">
                        <span>{item.label}</span>
                        <span className="font-semibold">{item.score}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <div
                          className="h-full rounded-full bg-orange-500 transition-all"
                          style={{ width: `${item.score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={resetCheck}
                  className="flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700"
                >
                  <RotateCcw size={17} /> Check another claim
                </button>
                <button
                  onClick={() => setScreen("rules")}
                  className="flex items-center justify-center gap-2 rounded-xl border border-stone-300 px-5 py-3 font-semibold dark:border-stone-700"
                >
                  <BookOpen size={17} /> Review the rules
                </button>
              </div>
            </section>
          )}

          {screen === "rules" && (
            <section className="mx-auto max-w-3xl">
              <BackButton onClick={() => setScreen("home")}>
                Back home
              </BackButton>

              <p className="mt-8 text-sm font-semibold uppercase tracking-widest text-orange-600">
                A practical guide
              </p>
              <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
                Don't stop at the headline.
              </h1>
              <p className="mt-4 leading-7 text-stone-600 dark:text-stone-400">
                Use these checks to assess information thoughtfully. No single
                check guarantees that a claim is true.
              </p>

              <div className="mt-8 space-y-4">
                <Rule
                  number="01"
                  title="Find the original source"
                  description="Look for the original report, dataset, research paper, or statement instead of relying only on a repost."
                />
                <Rule
                  number="02"
                  title="Check the context"
                  description="Check dates, location, surrounding events, and whether an image or quotation is being presented accurately."
                />
                <Rule
                  number="03"
                  title="Look for independent evidence"
                  description="Prefer credible sources that independently support a claim. Multiple copies of the same report are not independent confirmation."
                />
                <Rule
                  number="04"
                  title="Search for contradictions"
                  description="Look for reliable evidence that challenges the claim, not just evidence that agrees with your first impression."
                />
                <Rule
                  number="05"
                  title="Separate evidence from certainty"
                  description="A missing source does not automatically make a claim false. Be clear about what is known, unknown, and uncertain."
                />
              </div>

              <div className="mt-7 rounded-2xl border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950/30">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 size={20} className="text-green-700 dark:text-green-400" />
                  The key principle
                </div>
                <p className="mt-2 leading-7 text-stone-700 dark:text-stone-300">
                  A good check explains why a conclusion is justified and
                  clearly identifies what the available evidence cannot prove.
                </p>
              </div>
            </section>
          )}
        </main>

        <footer className="border-t border-stone-200 px-5 py-5 text-center text-xs text-stone-500 dark:border-stone-800">
          Before It Goes Live · Think critically before sharing.
        </footer>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
          <div className="mx-auto grid max-w-xl grid-cols-3">
            <NavItem
              active={screen === "home"}
              icon={<ShieldCheck size={19} />}
              onClick={() => setScreen("home")}
            >
              Home
            </NavItem>
            <NavItem
              active={screen === "check" || screen === "results"}
              icon={<FileSearch size={19} />}
              onClick={() => setScreen("check")}
            >
              Check
            </NavItem>
            <NavItem
              active={screen === "rules"}
              icon={<BookOpen size={19} />}
              onClick={() => setScreen("rules")}
            >
              Rules
            </NavItem>
          </div>
        </nav>
      </div>
    </div>
  );
}

function Feature({
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-widest text-stone-400">
          {number}
        </span>
        <span className="rounded-xl bg-orange-50 p-3 text-orange-600 dark:bg-orange-950/50">
          {icon}
        </span>
      </div>
      <h3 className="mt-5 font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
        {description}
      </p>
    </article>
  );
}

function BackButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 text-sm font-semibold text-stone-500 hover:text-orange-600"
    >
      <ArrowLeft size={16} />
      {children}
    </button>
  );
}

function Rule({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-sm font-bold text-orange-600 dark:bg-orange-950/50">
        {number}
      </span>
      <div>
        <h3 className="font-bold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
          {description}
        </p>
      </div>
    </article>
  );
}

function NavItem({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-3 text-xs ${
        active ? "font-bold text-orange-600" : "text-stone-500"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
