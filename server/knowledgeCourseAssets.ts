/**
 * Documents the course links but does not host as lessons.
 *
 * `transcripts/downloadable_assets.tsv` records six files discovered while
 * collecting the lessons — a course-hosted supplier list and five third-party
 * publications. Manus registered them and deliberately did not ingest them.
 *
 * They are ingested here as **citations only**: a `knowledge_sources` row each,
 * and **no chunks**. That is the rights position, not a shortcut. Perfumer &
 * Flavorist articles belong to Allured Business Media and the FEMA list to the
 * Flavor and Extract Manufacturers Association; we may cite and summarise them,
 * we may not hold their text. The same treatment the 24 external practitioner
 * sources already get.
 *
 * WHERE THE FACTS COME FROM
 *
 * Every title, author and affiliation below was read from the actual PDF's
 * first page (`pdftotext -f 1 -l 1`) on 2026-08-31, not inferred from a URL or
 * recalled. They are recorded here as data so the ingest stays a pure
 * transform and nobody has to re-derive them — or worse, guess them — on a
 * later run.
 *
 * Where a document could not be read, `summary_grounded` is false and the
 * governed summary says so rather than describing content nobody has seen.
 */
import type { SourcePayload } from "./knowledgeCorpus";

export type CourseAsset = {
  /** Stable key. `AOD-ASSET-<lesson>-<n>`. */
  source_key: string;
  /** The lesson whose page linked it — the citable relationship. */
  lesson_id: string;
  lesson_number: string;
  lesson_title: string;
  url: string;
  publisher: string;
  /** Read from the document itself, or null when it could not be read. */
  title: string | null;
  creator: string | null;
  /**
   * True when `governed_summary` describes text actually read from the
   * document. False means the summary states only what is externally
   * verifiable — availability, format, size — and claims nothing about content.
   */
  summary_grounded: boolean;
  /** Verified by HTTP HEAD on 2026-08-31. */
  retrievable: boolean;
  governed_summary: string;
  topics: string[];
};

/**
 * Rights posture is the same for all of them: cite and summarise, never hold
 * the text. `reference_only` keeps them out of any approved-control path.
 */
export const COURSE_ASSETS: CourseAsset[] = [
  {
    source_key: "AOD-ASSET-4761-1",
    lesson_id: "4761",
    lesson_number: "27",
    lesson_title: "Flavour Levels and Calculations",
    url: "https://img.perfumerflavorist.com/files/base/allured/all/document/2016/02/pf.9515.pdf",
    publisher: "Perfumer & Flavorist (Allured Business Media)",
    title: "A Novel Approach to Flavor Development: Using an Equation to Make Flavors",
    creator: "Frank Fischetti, Jr., Craftmaster Flavor Technology",
    summary_grounded: true,
    retrievable: true,
    governed_summary:
      "Trade-journal article linked from lesson 27 (Flavour Levels and Calculations). " +
      "Presents an equation-driven method for constructing a flavour formula, from the " +
      "same author as the categorizing-technique article linked from lesson 23. Cite and " +
      "summarise only — the text belongs to Allured Business Media. It explains an " +
      "approach; it is not an MTL Craft formula or dosing authority.",
    topics: ["flavour formulation", "dosing", "flavour development method"],
  },
  {
    source_key: "AOD-ASSET-4761-2",
    lesson_id: "4761",
    lesson_number: "27",
    lesson_title: "Flavour Levels and Calculations",
    url: "https://www.femaflavor.org/sites/default/files/3.%20GRAS%20Substances%282001-3124%29_0.pdf",
    publisher: "Flavor and Extract Manufacturers Association (FEMA)",
    title:
      "Recent Progress in the Consideration of Flavoring Ingredients Under the Food Additives Amendment (GRAS substances 2001-3124)",
    creator: "FEMA Expert Panel",
    summary_grounded: true,
    retrievable: true,
    governed_summary:
      "The FEMA GRAS substances list linked from lesson 27, covering entries 2001-3124. " +
      "A reference register of flavouring ingredients considered under the US Food " +
      "Additives Amendment. Lesson 7 of the course is explicit that FEMA figures are " +
      "average-use guidance, not hard legal limits, so this must never be read as a " +
      "jurisdiction-specific regulatory conclusion, a shelf-life decision, or a batch " +
      "release authority. Cite and summarise only.",
    topics: ["GRAS", "FEMA", "flavouring ingredients", "usage levels", "regulatory reference"],
  },
  {
    source_key: "AOD-ASSET-4746-1",
    lesson_id: "4746",
    lesson_number: "16",
    lesson_title: "Emulsions",
    url: "https://img.perfumerflavorist.com/files/base/allured/all/document/2016/03/pf.8804.pdf",
    publisher: "Perfumer & Flavorist (Allured Business Media)",
    title: "Stability of Beverage Flavor Emulsions",
    creator:
      "Chee-Teck Tan and Joanna Wu Holmes, International Flavors & Fragrances, Research and Development Center",
    summary_grounded: true,
    retrievable: true,
    governed_summary:
      "Trade-journal article linked from lesson 16 (Emulsions), on the stability of " +
      "beverage flavour emulsions. Directly supports the lesson's material on droplet " +
      "size, creaming and separation. Cite and summarise only — the text belongs to " +
      "Allured Business Media. It cannot declare an MTL Craft formula stable; that " +
      "requires an approved testing protocol and recorded results.",
    topics: ["emulsion stability", "beverage emulsions", "droplet size", "creaming"],
  },
  {
    source_key: "AOD-ASSET-6476-1",
    lesson_id: "6476",
    lesson_number: "23",
    lesson_title: "Prototyping a Flavour",
    url: "https://img.perfumerflavorist.com/files/base/allured/all/document/2016/02/pf.9507.pdf",
    publisher: "Perfumer & Flavorist (Allured Business Media)",
    title:
      "A Novel Approach to Flavor Development: Using the Categorizing Technique to Make Flavors",
    creator: "Frank Fischetti, Jr., Craftmaster Flavor Technology, Inc., Amityville, New York",
    summary_grounded: true,
    retrievable: true,
    governed_summary:
      "Trade-journal article linked from lesson 23 (Prototyping a Flavour). Describes a " +
      "categorizing technique for building flavours, the companion piece to the " +
      "equation-based article linked from lesson 27. Cite and summarise only — the text " +
      "belongs to Allured Business Media.",
    topics: ["flavour prototyping", "categorizing technique", "flavour development method"],
  },
  {
    source_key: "AOD-ASSET-4736-1",
    lesson_id: "4736",
    lesson_number: "7",
    lesson_title: "Regulations",
    url: "https://www.ars.usda.gov/ARSUserFiles/60701000/Pickle%20Pubs/p234.pdf",
    publisher: "USDA Agricultural Research Service",
    title: null,
    creator: null,
    // Retrievable, but every page is a scanned image with no text layer, so
    // nothing about its content has actually been read.
    summary_grounded: false,
    retrievable: true,
    governed_summary:
      "A 26-page USDA Agricultural Research Service publication linked from lesson 7 " +
      "(Regulations), served from the ARS 'Pickle Pubs' collection. The file is a " +
      "scanned image with no extractable text layer, so its contents have NOT been read " +
      "and nothing is asserted about them here. Registered as a citation so the link is " +
      "traceable; it needs OCR and a human read before it can be summarised.",
    topics: ["USDA", "acidified foods", "regulatory reference", "not yet reviewed"],
  },
  {
    source_key: "AOD-ASSET-5841-1",
    lesson_id: "5841",
    lesson_number: "6",
    lesson_title: "Food Grade Ingredients",
    url: "https://edu.artofdrink.com/wp-content/uploads/2024/06/Supplier.pdf",
    publisher: "Art of Drink Education",
    title: "Supplier.pdf (course-provided supplier list)",
    creator: "Darcy O'Neil",
    summary_grounded: false,
    // HTTP 403 — the course host is Cloudflare-protected and refuses
    // server-side retrieval. Needs the authenticated browser session.
    retrievable: false,
    governed_summary:
      "The supplier list the Food Grade Ingredients lesson provides as a download. " +
      "Course-hosted, so it is Tier B material Ashley is entitled to hold — but it is " +
      "Cloudflare-protected and returned HTTP 403 to server-side retrieval, so it has " +
      "NOT been collected and nothing is asserted about its contents. Registered so the " +
      "gap is visible; needs the authorised browser session.",
    topics: ["suppliers", "food grade ingredients", "not yet collected"],
  },
];

/**
 * Citation rows. Deliberately returns sources only — there is no chunk
 * counterpart, because holding the text of any of these is the thing the
 * rights posture forbids.
 */
export function courseAssetSources(assets: CourseAsset[] = COURSE_ASSETS): SourcePayload[] {
  return assets.map(a => ({
    source_key: a.source_key,
    title: a.title ?? `Untitled document linked from lesson ${a.lesson_number}`,
    publisher: a.publisher,
    creator: a.creator,
    source_url: a.url,
    // Course-hosted material is Tier B; everything else is an outside
    // publication, which is Tier C exactly as the 24 practitioner sources are.
    authority_tier:
      a.publisher === "Art of Drink Education"
        ? "tier_b_authorized_course"
        : "tier_c_external_practitioner",
    rights_status:
      a.publisher === "Art of Drink Education" ? "authorized_private" : "public_summary_only",
    // Never an approved control. These are references a lesson points at.
    operational_status: "reference_only",
    citation_required: true,
    governed_summary: a.governed_summary,
    source_metadata: {
      linked_from_lesson_id: a.lesson_id,
      linked_from_lesson_number: a.lesson_number,
      linked_from_lesson_title: a.lesson_title,
      media_type: "pdf",
      topics: a.topics,
      retrievable: a.retrievable,
      // The honest flag: false means the summary describes availability, not
      // content, because the document was never actually read.
      summary_grounded_in_document: a.summary_grounded,
      registered_from: "batch1/transcripts/downloadable_assets.tsv",
    },
  }));
}
