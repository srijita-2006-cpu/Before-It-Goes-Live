# Before It Goes Live

Automated Pre-Flight Marketing Governance & Legal Compliance Release Gate

---

## Overview

### The Problem
Marketing teams frequently publish content across multiple channels (social media ads, brochures, product packaging, and presentation decks). Before publication, every asset must satisfy strict regulatory standards:
- FDA Regulations: Prohibits unapproved medical and drug claims on cosmetic products.
- FTC Green Guides: Prohibits absolute claims such as "100% natural" or "chemical-free" without third-party laboratory verification.
- FTC Endorsement Guides: Requires statistically valid survey data before using claims like "Dermatologist Recommended".

Manual legal and brand review creates delays, while unvetted publishing risks regulatory fines, mandatory retractions, and brand damage.

# Before It Goes Live
> A visual pre-flight check for marketing campaigns. Catch regulatory issues, verify claims, and fix copy on real designs before anything gets published.
---
## Why We Built This (And What Makes It Different)
Most legal and brand compliance tools are boring text boxes. You paste a paragraph, wait for an error list, and get handed a giant wall of legal jargon. 
Real marketing doesn't live in plain text documents—it lives in **Instagram ads, product brochures, slide decks, and banner graphics**. 
We built **Before It Goes Live** to treat marketing compliance like a visual design review:
- **Visual Pin Mapping Instead of Text Lists**: When you upload an ad banner, we place numbered pins (1, 2, 3) directly over the visual elements that have compliance issues.
- **The Animated Connector Arrow**: Clicking an issue draws a live, animated cyan curve linking the exact spot on your artwork directly to the suggested fix card. You never have to hunt across a screen to understand what needs changing.
- **Dual Review Modes (Art View vs. Knowledge Graph)**: Designers can stay in the visual Creative Art View to inspect the layout. Compliance reviewers can flip into an interactive Knowledge Graph to see how a claim connects to brand rules and federal evidence.
- **Context-Aware Corrections**: The review card can request a suggestion from the configured AI provider using the stored copy and applicable company rule. Gemini is the default primary provider and Groq is the fallback. Suggestions remain proposals until reviewed and explicitly applied; deterministic rule checks reject suggestions that still match an active restriction.
- **Built for Whole Campaigns (Batch Queue)**: Hold `Ctrl` or `Shift` and select up to 20 files per batch, within the documented upload limits. The app sorts them into High, Medium, and Low risk so you tackle high-risk claims first, with a clean "Next in Queue" button to move through collateral fast.
---
## Key Features & Visual Highlights
### 1. Visual Creative Canvas & Pin Mapping
Upload actual image creatives (PNG, JPG) or multi-page brochures (PDF). The canvas renders the asset with color-coded risk markers placed on the creative itself. High-risk issues (like absolute medical claims) show up in red, while medium-risk issues (unverified survey claims) show up in amber.
### 2. Animated Connector Arrow
An interactive SVG curve moves dynamically as you click different markers. It visually guides your eyes from the pin on the artwork straight to the correction panel, making reviews feel like an intuitive design tool rather than a spreadsheet audit.
### 3. Clean Fix Cards (No Fluff)
Each flagged item shows the actual matched copy and rule. A reviewer can request a contextual AI replacement, provide a manual edit, or dismiss the finding. Generated suggestions are not treated as verified or applied until the reviewer explicitly applies them and the server confirms the rule recheck.
### 4. Interactive Knowledge Graph
Flip from the creative view into a full node-and-edge visual graph. It lets you see how marketing claims connect to governing rules (like FDA cosmetic guidelines or FTC Green Guides) and supporting lab evidence, giving legal teams complete transparency.
### 5. On-Demand AI Explanations
Rather than filling up your screen with pre-written explanations, the app stays clean and minimal. When you want deeper context, clicking **"Ask AI Why"** calls the configured provider to explain the finding using its supplied evidence.
### 6. Dynamic Multi-Page Reader
Upload a 10-page or 20-page PDF brochure, and the app splits it into clean, clickable page tabs (`P.1`, `P.2`, `P.3`...). You can review findings page-by-page or expand into a Fullscreen Theater Mode for client presentations.
### 7. Instant Batch Queue
Select multiple assets at once during upload. The batch queue ranks them by risk level, keeps track of how many assets you have cleared (`3 of 12 Cleared`), and lets you switch between images and PDFs with a single click.
### 8. Production-Ready Export
Once all markers are cleared, download a clean specification sheet (`.txt`) for your copywriters and designers, or copy the updated text straight to your clipboard.


## System Architecture & How It Works

The platform consists of a lightweight React frontend and a FastAPI backend with local database persistence and centralized Gemini/Groq AI integration.

### 1. Ingestion Layer
- Users can import visual ad banners (PNG, JPG), multi-page brochures (PDF), presentation decks (PPTX), or raw copy drafts.
- Supports bulk upload using Ctrl+Click or Shift+Click to stage dozens of files at once.
- The backend parses supported documents, extracts available text, and keeps page references for multi-page reviews.

### 2. Regulatory Compliance Engine
- The backend runs rulebooks based on FDA, FTC, and brand governance standards.
- Scans ingested text against regulatory patterns and assigns risk levels: High Risk, Medium Risk, or Low Risk.
- Generates pinpoint markers for visual ads and text highlights for multi-page documents.

### 3. Pre-Flight Review Interface
- Creative Art View: Displays the creative with interactive numbered pins and a dynamic connector arrow pointing to the active issue.
- Knowledge Graph View: Visualizes relationships between flagged claims, governing rules, and evidentiary standards.
- Batch Queue: Manages multi-asset review, allowing users to clear one asset and immediately advance to the next in the queue.

### 4. Magic Fix & Remediation Panel
- Displays the flagged claim and an optional context-aware replacement proposal.
- Allows users to request a suggestion, explicitly apply a validated replacement, edit manually, or dismiss the finding.
- Real-time updates: Applying a fix automatically updates the active document and marks the asset cleared.

### 5. On-Demand AI Copilot
- Uses the configured provider and model; Gemini is the default primary and Groq the default fallback.
- Each review checks the uploaded text against the workspace's active, approved rules. Exact prohibited terms and explicitly quoted required wording are checked deterministically; the configured AI provider also checks semantic conflicts such as unsupported claims, missing offer conditions, scope, tone, or disclosures when an active rule covers that aspect. Findings must cite an active rule and source text. AI cannot add unrelated policies.
- If an AI semantic check or content extraction fails, the review is marked incomplete rather than compliant. Scanned PDF pages are OCR-processed when they contain page images; any page that cannot be read is disclosed and prevents a compliant result.
- A correction proposal receives the exact flagged phrase, surrounding stored copy, the linked active rule, and configured source information. The server validates the structured response and checks proposed text against current active restrictions. If information is missing or the proposal fails validation, no replacement is presented as ready.
- Validated AI suggestions are cached in SQLite per organization and reused only when the flagged phrase, surrounding copy, and active rules match exactly. Cached suggestions are rechecked and still require reviewer confirmation; rejected drafts and manual edits are not cached.
- Applying a proposal is an explicit user action. The backend rechecks the replacement, updates the stored document and finding only on success, and records the applied copy in the activity log. Uploaded originals are not overwritten.

### 6. Storage & Audit Ledger
- SQLite database stores document metadata, active brand rules, and review decisions.
- Generates downloadable compliance audit specification sheets (.txt) and clean copy exports for legal and production teams.

---

## Intake Validation and Limits

Single uploads support PDF, PPTX, DOCX, TXT, MD, CSV, and supported image formats. ZIP archives are accepted only for bulk uploads. The backend validates file contents as well as extensions and enforces these limits:

- 20 MiB per file
- 50 MiB total per batch, with at most 20 files
- 100,000 characters of extracted or pasted text
- 100 pages per PDF

Pasted text and text extracted from PDF, DOCX, PPTX, TXT, MD, CSV, and supported images are checked only against active workspace rules that you provide, approve from uploaded guidelines, or choose from the starter templates. Exact prohibited terms and exact required phrases are deterministic checks; semantic AI review checks the meaning of the extracted content against those same saved rules. Rules extracted from a brand-guideline upload are stored as candidates and are not enforced until a reviewer verifies and activates them. Starter rules include optional checks for unsupported objective claims, absolute uptime/error-free promises, guaranteed outcomes, and competitor comparisons, alongside other areas such as disclosures, testimonials, environmental claims, terminology, visual accessibility, and audience/channel scope. Activate only rules that fit your business and intended content. Rule extraction processes the full source in bounded sections and looks for stated aspects; it does not add policies that are absent from the source. Results are not a certification or guarantee of compliance and are not checked against every law, standard, or factual source. Review active rules and supporting evidence before relying on a result. If text extraction or semantic review fails, the audit is incomplete rather than compliant. Images and scanned PDF pages use the configured AI provider for text transcription; unreadable content is not treated as cleared. The uploaded document's text is sent to the configured AI provider for semantic review, so configure provider keys and consider the data-handling implications before reviewing sensitive content. URL review is not supported; upload a file or paste text instead.

Focused backend validation and API tests can be run from `backend\` with `python -m unittest test_validation test_api_reliability test_ai_provider`.

## Windows Setup

1. Clone the GitHub repository and open PowerShell in its project folder.
2. Install the backend and frontend dependencies:

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   cd ..\frontend
   npm install
   ```

3. In the project folder, copy the example settings to the backend's local environment file:

   ```powershell
   cd ..
   Copy-Item backend\.env.example backend\.env
   ```

4. Open `backend\.env` and enter your personal `GEMINI_API_KEY`, `GROQ_API_KEY`, or both. Each person must use their own API key; never put keys in frontend files or commit `.env`.
5. Optionally change `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER`, `GEMINI_MODEL`, or `GROQ_MODEL` in `backend\.env`. Compatible API endpoint overrides (`GEMINI_API_URL`, `GROQ_API_URL`) are also available. With only one key configured, that provider is selected automatically. Defaults are Gemini primary and Groq fallback.
6. Start the backend and frontend in separate PowerShell windows:

   ```powershell
   cd backend
   .\.venv\Scripts\Activate.ps1
   uvicorn main:app --reload
   ```

   ```powershell
   cd frontend
   npm run dev
   ```

   Gemini's default model is `gemini-3.1-flash-lite`, listed as stable in [Google's model documentation](https://ai.google.dev/gemini-api/docs/models). Groq defaults to `qwen/qwen3.8-27b`, documented for vision input and strict structured outputs in [Groq's vision](https://console.groq.com/docs/vision), [structured outputs](https://console.groq.com/docs/structured-outputs), and [model catalog](https://console.groq.com/docs/models). API usage may be subject to provider rate limits, quotas, and costs.

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Lucide Icons
- Backend: Python, FastAPI, Uvicorn, Python-Multipart
- Database: SQLite (local, zero-configuration)
- AI Engine: centralized Google Gemini primary / Groq fallback (models configurable with `GEMINI_MODEL` and `GROQ_MODEL`)
- Styling: Custom dark glassmorphic CSS design system

The backend loads `backend/.env` without overriding environment variables configured by a deployment. Restart the backend after changing local configuration. Keep all provider keys in that backend-only file.

Correction suggestions use a bounded provider request with a 35-second overall budget. Transient errors are retried up to the configured limit, then the other configured provider is tried when available. Invalid or unusable provider responses may also trigger fallback; deterministic rule conflicts and failed correction checks never do. Suggestions are saved as ready only after the same validation pipeline passes, and a reviewer must still explicitly apply them. Provider logs omit API keys and submitted content. If providers fail, no replacement is saved.

---

## Project Structure

Before_It_Goes_Live/
├── backend/
│   ├── uploads/               Temporary staging folder for uploaded files
│   ├── before_it_goes_live.db SQLite database file
│   ├── database.py            Database connection, schemas, and models
│   ├── engine.py              Regulatory rule matching and claim extractor
│   ├── main.py                FastAPI REST server and compliance workflow
│   ├── ai_provider.py         Central provider configuration and fallback
│   ├── requirements.txt       Python dependencies
│   └── test_workflow.py       Backend integration tests
│
└── frontend/
    ├── public/                Static assets, icons, and logo
    ├── src/
    │   ├── assets/            Local images and illustrations
    │   ├── components/        GraphView, IssueCard, Navigation, Splash screen
    │   ├── pages/             Home, Review, RuleSetup, Activity, Account
    │   ├── api.ts             Central API client for backend communication
    │   ├── App.css            Core stylesheet and theme variables
    │   ├── App.tsx            Root component and route state
    │   └── main.tsx           Application entry point
    ├── package.json           Frontend packages and build scripts
    └── vite.config.ts         Vite configuration
