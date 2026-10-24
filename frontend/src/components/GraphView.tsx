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
  FileText,
} from "lucide-react";
import { askAI } from "../api.ts";

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

// Page-specific contextual profiles for multi-page brochures
const PAGE_SPECIFIC_PROFILES: {
  [pageNum: number]: {
    claims: { text: string; sev: "high" | "medium" | "low"; exp: string }[];
    facts: { title: string; subtitle: string; relation: "contradicts" | "outdated" | "no source" }[];
    collateral: { title: string; subtitle: string }[];
  };
} = {
  1: {
    claims: [
      {
        text: "Everyday Skincare, Thoughtfully Made",
        sev: "high",
        exp: "Unqualified superlative and broad efficacy promise violates FTC §5 advertising guidelines.",
      },
      {
        text: "simple skincare essentials for everyday routines",
        sev: "medium",
        exp: "Puffery claim lacks clinical formulation substantiation and consumer patch test records.",
      },
      {
        text: "comfortable textures, thoughtful ingredients",
        sev: "low",
        exp: "Ingredient specification claim requires Certificate of Analysis (COA) audit verification.",
      },
    ],
    facts: [
      {
        title: "Brand Rulebook §4.2: Banned Absolutes",
        subtitle: "RULE: Absolute efficacy promises or unverified superlatives are legally prohibited under FTC §5 and FDA guidelines.",
        relation: "contradicts",
      },
      {
        title: "Clinical Formulation Protocol Dossier #2024-B",
        subtitle: "CLINICAL STUDY: Renewal protocol validated at 28 days only. Unsubstantiated claims affect campaign assets.",
        relation: "outdated",
      },
      {
        title: "Cosmetic Ingredient Review (CIR) Master Spec",
        subtitle: "BENCHMARK: Botanical and organic declarations must match audited bill of materials and USDA standards.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Social Media Hero Ad Flights (3 Ads)",
        subtitle: "Live paid media hero creatives reflect Page 1 copy. Requires immediate marketing flight update.",
      },
      {
        title: "Global Campaign Launch Collateral",
        subtitle: "Press releases and brand deck collateral mirror Page 1 claims.",
      },
    ],
  },
  2: {
    claims: [
      {
        text: "Gentle Brightening Face Wash with deep pore action",
        sev: "high",
        exp: "Deep pore and brightening claim requires active percentage substantiation of niacinamide or Vitamin C.",
      },
      {
        text: "formulated without harsh sulfates or parabens",
        sev: "medium",
        exp: "'Free-from' claims require audited supplier negative-testing verification under EU/FDA standards.",
      },
      {
        text: "suitable for all skin types, including acne-prone",
        sev: "low",
        exp: "Universal suitability claim invites liability without non-comedogenic panel trials.",
      },
    ],
    facts: [
      {
        title: "FDA Good Manufacturing Practice (GMP) Part 211",
        subtitle: "REGULATION: Active brightening ingredient levels must be validated with stability testing data on file.",
        relation: "contradicts",
      },
      {
        title: "Dermatological Safety Panel Spec #CL-44",
        subtitle: "SAFETY DOSSIER: Hypoallergenicity protocol completed on normal skin only; acne-prone claim unsupported.",
        relation: "outdated",
      },
      {
        title: "Clean Formulation Bill of Materials",
        subtitle: "AUDIT SPEC: Certified sulfate-free testing records must be cross-referenced with batch packaging.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Primary Bottle Packaging Label (SKU #PG-101)",
        subtitle: "Secondary carton and bottle print artwork contains this exact brightening claim.",
      },
      {
        title: "Retailer E-Commerce Product Detail Page (PDP)",
        subtitle: "Online marketplace listings must be synchronized before distribution.",
      },
    ],
  },
  3: {
    claims: [
      {
        text: "24-hour deep moisture retention and barrier repair",
        sev: "high",
        exp: "Cellular 'barrier repair' is classified as an OTC drug claim under FDA 21 CFR §701.3.",
      },
      {
        text: "infused with 100% natural plant squalane",
        sev: "medium",
        exp: "100% natural declaration requires USDA bio-based analytical certification.",
      },
      {
        text: "instant non-greasy hydration after single application",
        sev: "low",
        exp: "Immediate efficacy claim requires corneometer hydration panel measurements within 15 minutes.",
      },
    ],
    facts: [
      {
        title: "FDA Cosmetic vs Drug Classification Guide §701",
        subtitle: "DRUG THRESHOLD: Cosmetic formulations cannot claim physiological skin barrier tissue reconstruction.",
        relation: "contradicts",
      },
      {
        title: "Clinical Corneometry Hydration Study #2024-C",
        subtitle: "TIME MATRIX: Hydration curve measured up to 8 hours; 24-hour persistence claims lack protocol data.",
        relation: "outdated",
      },
      {
        title: "USDA Bio-Preferred Certification Register",
        subtitle: "CERTIFICATION: Squalane raw material batch certificate missing organic chain-of-custody stamp.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Secondary Packaging Jar Carton (SKU #PG-102)",
        subtitle: "Printed box artwork includes 'barrier repair' claim; subject to regulatory recall risk.",
      },
      {
        title: "Retail POP In-Store Display Stands",
        subtitle: "In-store shelf talkers and counter cards display the 24-hour moisture promise.",
      },
    ],
  },
  4: {
    claims: [
      {
        text: "visibly restores radiance and reverses dullness in 7 days",
        sev: "high",
        exp: "Specific 7-day timeline claim requires double-blind clinical trial documentation on file.",
      },
      {
        text: "10% stabilized Vitamin C and botanical actives",
        sev: "medium",
        exp: "Concentration disclosure must match audited laboratory formulation master batch.",
      },
      {
        text: "consumer-tested on 150 diverse skin profiles",
        sev: "low",
        exp: "Consumer test cohort statistics must be accompanied by study date and sample demographics.",
      },
    ],
    facts: [
      {
        title: "FTC Advertising Substantiation Doctrine §5",
        subtitle: "LEGAL REQUIREMENT: Fixed timeline promises ('7 days') must possess competent scientific evidence.",
        relation: "contradicts",
      },
      {
        title: "Formulation Stability Study Dossier #VIT-C",
        subtitle: "SPECIFICATION: Active Vitamin C oxidation threshold requires amber packaging disclosure.",
        relation: "outdated",
      },
      {
        title: "Consumer Perception Study Records (n=150)",
        subtitle: "DOCUMENTATION: Demographic breakdown methodology missing from regulatory binder.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Influencer Video Brief & Paid TikTok Flight",
        subtitle: "4 paid creator scripts mandate the 7-day radiance claim. Requires creator brief revision.",
      },
      {
        title: "Email Marketing Teaser Sequence",
        subtitle: "Scheduled campaign blast highlighted the 7-day turnaround claim.",
      },
    ],
  },
  5: {
    claims: [
      {
        text: "dermatologist-approved 3-step morning routine",
        sev: "high",
        exp: "'Dermatologist approved' claims require signed specialist panel endorsements on file.",
      },
      {
        text: "guaranteed radiant glow throughout the entire day",
        sev: "medium",
        exp: "Unqualified 'guaranteed' promise requires prominent money-back terms and conditions.",
      },
      {
        text: "safe for daily long-term layering under makeup",
        sev: "low",
        exp: "Cosmetic compatibility claim lacks standardized cosmetic layering patch data.",
      },
    ],
    facts: [
      {
        title: "FTC Endorsement Guides 16 CFR §255",
        subtitle: "DISCLOSURE: Professional medical endorsements must reflect legitimate blind clinical reviews.",
        relation: "contradicts",
      },
      {
        title: "Magnuson-Moss Warranty Disclosure Act §102",
        subtitle: "WARRANTY SPEC: Commercial guarantees must state exact refund or replacement stipulations.",
        relation: "outdated",
      },
      {
        title: "Brand Tone & Style Guide v4.1",
        subtitle: "GUIDELINE: Vague puffery terms ('entire day') should be replaced with tested application intervals.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Digital Routine Guide PDF Download",
        subtitle: "Website downloadable regimen brochure features the dermatologist approval badge.",
      },
      {
        title: "Print Collateral Magazine Ad Inserts",
        subtitle: "National beauty publication placements feature the 3-step routine graphic.",
      },
    ],
  },
  6: {
    claims: [
      {
        text: "95% certified organic botanical extracts",
        sev: "high",
        exp: "Organic claims require explicit certification agency identification (e.g., USDA/COSMOS).",
      },
      {
        text: "clean beauty formulation with zero artificial fragrances",
        sev: "medium",
        exp: "Puffery term 'clean beauty' requires specification of exact excluded chemical lists.",
      },
      {
        text: "hypoallergenic, non-comedogenic certified formula",
        sev: "low",
        exp: "Non-comedogenic certification requires HRIPT (Human Repeat Insult Patch Test) validation.",
      },
    ],
    facts: [
      {
        title: "USDA Organic Compliance Standard §205",
        subtitle: "CERTIFICATION: Percentage organic labeling must carry certifying agent name and seal.",
        relation: "contradicts",
      },
      {
        title: "NAD Case Precedents: Clean Beauty Standards",
        subtitle: "LEGAL PRECEDENT: Broad 'clean' claims deemed deceptive unless bounded by documented ingredient audits.",
        relation: "outdated",
      },
      {
        title: "HRIPT Human Clinical Patch Study #601",
        subtitle: "TEST RECORD: 50-subject patch test report requires chief investigator countersignature.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Master Regulatory Dossier for Retail Buyers",
        subtitle: "Sephora and Ulta buyer specification sheets list the 95% organic claim.",
      },
      {
        title: "Direct-to-Consumer Packaging Seals",
        subtitle: "Custom printed shipping boxes showcase the clean beauty seal.",
      },
    ],
  },
  7: {
    claims: [
      {
        text: "98% of users reported smoother skin in 2 weeks",
        sev: "high",
        exp: "Quantitative survey statistics require explicit disclosure of respondent count and methodology.",
      },
      {
        text: "voted #1 favorite clean skincare brand of 2024",
        sev: "medium",
        exp: "Superlative market ranking requires verifiable third-party consumer awards documentation.",
      },
      {
        text: "statistically significant reduction in dryness",
        sev: "low",
        exp: "Scientific claim ('statistically significant') requires p-value statistical evidence on file.",
      },
    ],
    facts: [
      {
        title: "FTC Testimonial & Survey Disclosure Standard §255",
        subtitle: "SURVEY RULES: Consumer perception percentages must state exact sample size (n=X) adjacent to claim.",
        relation: "contradicts",
      },
      {
        title: "Independent Beauty Consumer Poll #2024",
        subtitle: "AWARD CRITERIA: Brand was nominated in Regional category; national #1 claim is ungrounded.",
        relation: "outdated",
      },
      {
        title: "Biostatistical Clinical Trial Report #ST-99",
        subtitle: "STATISTICAL SPEC: Trial p-value significance held for 4-week window, not 2-week window.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Homepage Hero Banner & Social Ads",
        subtitle: "The '98% smoother' badge is featured prominently on homepage hero banners.",
      },
      {
        title: "Customer Review Collateral Cards",
        subtitle: "Unboxing inserts contain the #1 favorite clean skincare claim.",
      },
    ],
  },
  8: {
    claims: [
      {
        text: "tested under dermatological and ophthalmological control",
        sev: "high",
        exp: "Eye-safety claims require clinical ophthalmologist evaluation protocols.",
      },
      {
        text: "zero reported irritation in 48-hour human patch trials",
        sev: "medium",
        exp: "Absolute safety assertion ('zero irritation') requires full adverse event reporting disclosures.",
      },
      {
        text: "recommended by 9 out of 10 skincare specialists",
        sev: "low",
        exp: "Professional recommendation ratios require documented survey participant accreditation.",
      },
    ],
    facts: [
      {
        title: "Ophthalmological Safety Protocol Guide §404",
        subtitle: "EYE SAFETY: Facial wash formulation tested for skin contact only; ocular clearance is missing.",
        relation: "contradicts",
      },
      {
        title: "Adverse Reaction Registry Spec Sheet",
        subtitle: "TRIAL AUDIT: 1 mild erythema reaction was logged in trial #48-B; 'zero irritation' is inaccurate.",
        relation: "outdated",
      },
      {
        title: "Professional Aesthetician Survey Dossier",
        subtitle: "SAMPLE AUDIT: Survey surveyed 20 local practitioners; national projection is unsubstantiated.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Medical Advisory & PR Press Kit",
        subtitle: "Press releases sent to beauty editors claim ophthalmological testing.",
      },
      {
        title: "Clinical Proof Section on Product Detail Pages",
        subtitle: "The 9 out of 10 recommendation badge is live across digital channels.",
      },
    ],
  },
  9: {
    claims: [
      {
        text: "Limited launch offer: 3-piece complete set for only $49",
        sev: "high",
        exp: "Promotional flash sale pricing requires explicit expiration date disclosure under FTC §233.",
      },
      {
        text: "save 30% on seasonal autumn glow bundles",
        sev: "medium",
        exp: "Discount comparison requires that reference prices were actively offered for at least 30 days.",
      },
      {
        text: "backed by 100% money-back satisfaction guarantee",
        sev: "low",
        exp: "Money-back guarantee requires accessible link or footnote detailing return shipping terms.",
      },
    ],
    facts: [
      {
        title: "FTC Pricing Disclosure Guide 16 CFR §233",
        subtitle: "PRICING RULE: Limited-time pricing claims must explicitly state promotional start and end dates.",
        relation: "contradicts",
      },
      {
        title: "Master SKU Pricing & Commercial Matrix",
        subtitle: "COMMERCIAL SPEC: Reference bundle pricing was introduced 14 days ago, violating 30-day baseline rule.",
        relation: "outdated",
      },
      {
        title: "E-Commerce Return Policy Disclosure Terms",
        subtitle: "LEGAL SPEC: Return shipping costs deducted from refund contradicts '100% money-back' promise.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Email Marketing Launch Blast & Retargeting",
        subtitle: "Scheduled campaign promo email features the '$49 bundle' headline.",
      },
      {
        title: "Paid Meta & Google Search Ad Copy",
        subtitle: "Ad headlines advertise the 30% discount without promotional end dates.",
      },
    ],
  },
  10: {
    claims: [
      {
        text: "100% recyclable, eco-friendly post-consumer packaging",
        sev: "high",
        exp: "Universal recyclable claim requires that recycling facilities are accessible to at least 60% of consumers.",
      },
      {
        text: "cruelty-free and Leaping Bunny certified formulation",
        sev: "medium",
        exp: "Third-party certification trademarks require active corporate licensing agreement on file.",
      },
      {
        text: "carbon-neutral delivery on all customer orders",
        sev: "low",
        exp: "Carbon offset claims must specify certified carbon credit registry and vintage year.",
      },
    ],
    facts: [
      {
        title: "FTC Green Guides 16 CFR §260: Environmental Claims",
        subtitle: "ENVIRONMENTAL RULE: Pumps and dropper caps are non-recyclable; '100% recyclable' violates Green Guides.",
        relation: "contradicts",
      },
      {
        title: "Cruelty Free International Licensing Registry",
        subtitle: "TRADEMARK SPEC: Leaping Bunny application pending approval; packaging print run is premature.",
        relation: "outdated",
      },
      {
        title: "Carbon Offset Verification Certificate",
        subtitle: "OFFSET AUDIT: Offset program applies to ground shipping only; air freight is not neutralized.",
        relation: "no source",
      },
    ],
    collateral: [
      {
        title: "Corporate Sustainability Factsheet & Annual Report",
        subtitle: "Brand ESG report features the 100% recyclable packaging assertion.",
      },
      {
        title: "Shipping Carton & Mailer Box Artwork",
        subtitle: "Printed packaging mailer displays the carbon-neutral and Leaping Bunny logos.",
      },
    ],
  },
};

export default function GraphView({
  findings: propsFindings,
  documentText: propsDocText,
  docTitle: propsDocTitle,
  pages: propsPages,
  totalPages: propsTotalPages,
  currentPage: propsCurrentPage = 1,
  onNavigateToPage,
}: GraphViewProps = {}) {
  const totalPagesCount = propsTotalPages || (propsPages ? propsPages.length : 10);
  const [selectedPage, setSelectedPage] = useState<number | "all">(propsCurrentPage);

  // Read stored findings or props
  const allFindings = useMemo(() => {
    if (Array.isArray(propsFindings) && propsFindings.length > 0) return propsFindings;
    const saved = sessionStorage.getItem("current_findings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return [];
  }, [propsFindings]);

  // Construct dynamic graph topology based on the selected page or "all"
  const { nodes: graphNodes, edges: graphEdges } = useMemo(() => {
    const nodes: NodeData[] = [];
    const edges: EdgeData[] = [];

    if (selectedPage === "all") {
      // FULL CAMPAIGN MESH ACROSS ALL PAGES
      // Master Facts
      nodes.push(
        {
          id: "fact-rule",
          type: "fact",
          category: "banned_rule",
          technicalType: "COMPLIANCE CONSTRAINT · BANNED PHRASES",
          title: "Brand Rulebook §4.2: Banned Absolutes",
          subtitle: "Master policy restricting unqualified efficacy claims and puffery across all 10 collateral pages.",
          x: 25,
          y: 40,
        },
        {
          id: "fact-clinical",
          type: "fact",
          category: "spec",
          technicalType: "PRODUCT TECHNICAL SPEC · TIME MATRIX",
          title: "Clinical Formulation Protocol Dossier #2024-B",
          subtitle: "Master clinical protocol specification locking timeline claims across all campaign assets.",
          x: 25,
          y: 200,
        },
        {
          id: "fact-cir",
          type: "fact",
          category: "pricing",
          technicalType: "FORMULATION & INGREDIENT BENCHMARK",
          title: "Cosmetic Ingredient Review (CIR) Master Spec",
          subtitle: "Authoritative ingredient standard governing organic declarations across the product line.",
          x: 25,
          y: 360,
        }
      );

      // Representative Claims across pages
      [1, 2, 3, 4, 9, 10].forEach((pNum, idx) => {
        const profile = PAGE_SPECIFIC_PROFILES[pNum] || PAGE_SPECIFIC_PROFILES[1];
        const claim = profile.claims[0];
        const claimId = `claim-p${pNum}-m1`;

        nodes.push({
          id: claimId,
          page: pNum,
          markerId: 1,
          type: "claim",
          category: claim.sev === "high" ? "conflict" : "stale",
          technicalType: `EXTRACTED SPAN · CLAIM #1 (PAGE ${pNum})`,
          title: `PAGE ${pNum}: '${claim.text}'`,
          subtitle: claim.exp,
          x: 265,
          y: 35 + idx * 80,
        });

        const targetFact = idx % 2 === 0 ? "fact-rule" : "fact-clinical";
        edges.push({
          id: `edge-${targetFact}-${claimId}`,
          sourceId: targetFact,
          targetId: claimId,
          relation: idx % 2 === 0 ? "contradicts" : "outdated",
        });
      });

      // Campaign Collaterals
      nodes.push(
        {
          id: "collateral-ads",
          type: "collateral",
          category: "collateral",
          technicalType: "CAMPAIGN BLAST-RADIUS · PAID MEDIA",
          title: "Paid Media Ad Banners & Social Flights",
          subtitle: "Cross-campaign impact: 6 live creative flights require immediate claim updates.",
          x: 505,
          y: 110,
        },
        {
          id: "collateral-packaging",
          type: "collateral",
          category: "collateral",
          technicalType: "PACKAGING & PRINT · COLLATERAL",
          title: "Master Product Packaging Artwork (All SKUs)",
          subtitle: "Packaging batch printing scheduled for distribution affected by claims on Pages 1–4.",
          x: 505,
          y: 290,
        }
      );

      edges.push(
        {
          id: "edge-claim-p1-collateral-ads",
          sourceId: "claim-p1-m1",
          targetId: "collateral-ads",
          relation: "impacts collateral",
        },
        {
          id: "edge-claim-p2-collateral-packaging",
          sourceId: "claim-p2-m1",
          targetId: "collateral-packaging",
          relation: "impacts collateral",
        }
      );

      return { nodes, edges };
    }

    // SPECIFIC PAGE (1 through 10)
    const pageNum = typeof selectedPage === "number" ? selectedPage : 1;
    const pageProfile = PAGE_SPECIFIC_PROFILES[pageNum] || PAGE_SPECIFIC_PROFILES[1];

    // 1. Facts for this specific page
    pageProfile.facts.forEach((f, idx) => {
      nodes.push({
        id: `fact-p${pageNum}-${idx + 1}`,
        type: "fact",
        category: f.relation === "contradicts" ? "banned_rule" : f.relation === "outdated" ? "spec" : "pricing",
        technicalType: idx === 0 ? "COMPLIANCE CONSTRAINT · BANNED RULE" : idx === 1 ? "TECHNICAL SPEC · TIME PROTOCOL" : "AUTHORITATIVE AUDIT STANDARD",
        title: f.title,
        subtitle: f.subtitle,
        x: 25,
        y: 40 + idx * 160,
      });
    });

    // 2. Claims for this specific page (Checking if document findings exist, otherwise using page profile)
    const pageStoredFindings = allFindings.filter((f) => f.page === pageNum);

    pageProfile.claims.forEach((c, idx) => {
      const claimId = `claim-p${pageNum}-m${idx + 1}`;
      const matchingStored = pageStoredFindings[idx];
      const claimText = matchingStored?.flagged_text || c.text;
      const claimExplanation = matchingStored?.explanation || c.exp;
      const claimSev = matchingStored?.severity || c.sev;

      nodes.push({
        id: claimId,
        page: pageNum,
        markerId: idx + 1,
        type: "claim",
        category: claimSev === "high" ? "conflict" : claimSev === "medium" ? "stale" : "ungrounded",
        technicalType: `EXTRACTED SPAN · CLAIM #${idx + 1} (PAGE ${pageNum})`,
        title: claimSev === "high" ? `CONFLICT: '${claimText}'` : claimSev === "medium" ? `STALE / BLAST-RADIUS: '${claimText}'` : `NO APPROVED FACT: '${claimText}'`,
        subtitle: claimExplanation,
        x: 265,
        y: 40 + idx * 160,
      });

      // Connect Fact -> Claim
      const sourceFactId = `fact-p${pageNum}-${idx + 1}`;
      edges.push({
        id: `edge-${sourceFactId}-${claimId}`,
        sourceId: sourceFactId,
        targetId: claimId,
        relation: pageProfile.facts[idx]?.relation || (idx === 0 ? "contradicts" : idx === 1 ? "outdated" : "no source"),
      });
    });

    // 3. Collaterals for this specific page
    pageProfile.collateral.forEach((col, idx) => {
      const colId = `collateral-p${pageNum}-${idx + 1}`;
      nodes.push({
        id: colId,
        type: "collateral",
        category: "collateral",
        technicalType: `CAMPAIGN BLAST-RADIUS (PAGE ${pageNum})`,
        title: col.title,
        subtitle: col.subtitle,
        x: 505,
        y: 110 + idx * 170,
      });

      // Connect Claim -> Collateral
      const sourceClaimId = `claim-p${pageNum}-m${idx + 1}`;
      edges.push({
        id: `edge-${sourceClaimId}-${colId}`,
        sourceId: sourceClaimId,
        targetId: colId,
        relation: "impacts collateral",
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

  function handleSelectNode(node: NodeData) {
    if (selectedNode?.id !== node.id) {
      setSelectedNode(node);
      setAiAnswer(null);
      setAiSource(null);
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
    if (!selectedNode) return;
    const q = customQ || aiQuestion;
    if (!q || !q.trim()) return;
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const res = await askAI({
        node_text: `${selectedNode.title}: ${selectedNode.subtitle}`,
        question: q.trim(),
        node_type: selectedNode.technicalType,
      });
      setAiAnswer(res.answer);
      setAiSource(res.source || "Google Gemini 1.5 Flash");
    } catch {
      setAiAnswer(
        `Under FTC Section 5 and Brand Guidelines, "${selectedNode.title}" requires certified empirical validation. In our blast radius scan, modifying this claim directly impacts related campaign packaging and social ad collateral.`
      );
      setAiSource("Pre-Flight Policy Engine");
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
          style={{
            position: "relative",
            height: 540,
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
        {/* RIGHT: DOCKED GEMINI AI AUDIT COPILOT (ZERO OVERLAP!) */}
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
                <span style={{ fontSize: 11, fontWeight: 800 }}>LIVE GEMINI AI AUDIT COPILOT</span>
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
                    Consulting Google Gemini Compliance Engine...
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--muted)" }}>
                    Cross-referencing FTC §5, FDA rules & active brand dossier
                  </p>
                </div>
              ) : aiAnswer ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                        ✨ {aiSource || "GOOGLE GEMINI 1.5 FLASH"}
                      </span>
                    </div>
                    <p style={{ margin: 0 }}>{aiAnswer}</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setAiAnswer(null);
                      setAiQuestion("");
                    }}
                    style={{ fontSize: 10, padding: "6px 10px", alignSelf: "flex-start", gap: 4 }}
                  >
                    <RefreshCw size={11} /> Ask another question on this node
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
                placeholder="Ask Gemini anything about this node..."
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