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
- **Clean Fixes Without the Clutter**: Instead of overwhelming you with long legal paragraphs, the main card shows you only what matters: the original phrase and the approved replacement copy. If you want the legal background, one click on "Ask AI Why" uses the configured provider to explain the finding on demand.
- **Built for Whole Campaigns (Batch Queue)**: Hold `Ctrl` or `Shift` and drop in 20 or 50 files at once. The app sorts them into High, Medium, and Low risk so you tackle high-risk claims first, with a clean "Next in Queue" button to move through collateral fast.
---
## Key Features & Visual Highlights
### 1. Visual Creative Canvas & Pin Mapping
Upload actual image creatives (PNG, JPG) or multi-page brochures (PDF). The canvas renders the asset with color-coded risk markers placed on the creative itself. High-risk issues (like absolute medical claims) show up in red, while medium-risk issues (unverified survey claims) show up in amber.
### 2. Animated Connector Arrow
An interactive SVG curve moves dynamically as you click different markers. It visually guides your eyes from the pin on the artwork straight to the correction panel, making reviews feel like an intuitive design tool rather than a spreadsheet audit.
### 3. Clean Fix Cards (No Fluff)
Each flagged item gives you an instant, brand-approved replacement that protects your legal standing while keeping the marketing voice strong. You can apply the fix with one click, tweak the wording manually, or dismiss it. 
### 4. Interactive Knowledge Graph
Flip from the creative view into a full node-and-edge visual graph. It lets you see how marketing claims connect to governing rules (like FDA cosmetic guidelines or FTC Green Guides) and supporting lab evidence, giving legal teams complete transparency.
### 5. On-Demand AI Explanations
Rather than filling up your screen with pre-written explanations, the app stays clean and minimal. When you want deeper context, clicking **"Ask AI Why"** uses the configured provider and the evidence attached to the finding.
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
- A client-side parser splits multi-page documents into individual pages while extracting text streams and coordinates.

### 2. Regulatory Compliance Engine
- The backend runs rulebooks based on FDA, FTC, and brand governance standards.
- Scans ingested text against regulatory patterns and assigns risk levels: High Risk, Medium Risk, or Low Risk.
- Generates pinpoint markers for visual ads and text highlights for multi-page documents.

### 3. Pre-Flight Review Interface
- Creative Art View: Displays the creative with interactive numbered pins and a dynamic connector arrow pointing to the active issue.
- Knowledge Graph View: Visualizes relationships between flagged claims, governing rules, and evidentiary standards.
- Batch Queue: Manages multi-asset review, allowing users to clear one asset and immediately advance to the next in the queue.

### 4. Magic Fix & Remediation Panel
- Displays the flagged claim and the approved replacement copy.
- Allows users to apply the surgical replacement with one click, edit the text manually, or ignore specific flags.
- Real-time updates: Applying a fix automatically updates the active document and marks the asset cleared.

### 5. On-Demand AI Copilot
- Gemini is the default primary provider and Groq is the fallback; either provider can be used alone when only its key is configured.
- Explanations are strictly on-demand: clicking "Ask AI Why" uses the configured provider and the finding's supplied evidence.

### 6. Storage & Audit Ledger
- SQLite database stores document metadata, active brand rules, and review decisions.
- Generates downloadable compliance audit specification sheets (.txt) and clean copy exports for legal and production teams.

---

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Lucide Icons
- Backend: Python, FastAPI, Uvicorn, Python-Multipart
- Database: SQLite (local, zero-configuration)
- AI Engine: centralized Google Gemini / Groq provider configuration (see the project README for setup)
- Styling: Custom dark glassmorphic CSS design system

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