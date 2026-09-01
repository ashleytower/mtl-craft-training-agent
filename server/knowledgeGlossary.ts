/**
 * The course vocabulary Whisper is primed with.
 *
 * This list exists in three places by necessity — the shell script that runs
 * Whisper, the Python that verifies the result, and here — because they are
 * three runtimes with no shared import. `knowledgeTranscriptPipeline.test.ts`
 * pins all three against each other, so drift fails a test rather than silently
 * un-checking a term or blinding the echo detector.
 *
 * Every term is attested in the course's own written material: the Jargon File
 * (lesson 5136) or a saved lesson page. That is the rule for what may bias the
 * decoder — spelling may be nudged toward vocabulary the course uses, never
 * toward a word from nowhere — and a test pins that too.
 */
export const GLOSSARY_TERMS: readonly string[] = [
  "ABV", "ABW", "Brix", "CAS", "cloud agent", "Codex Alimentarius", "CO2",
  "EtOH", "FCC", "FEMA", "flavour house", "FIDS", "FMP", "GMP", "GRAS",
  "immiscible", "miscible", "JECFA", "MOQ", "MSDS", "WONF", "organoleptic",
  "PPM", "process authority", "RDA", "RTD", "shelf stable", "SKU", "TA",
  "TTB", "USP", "terpenes", "terpenoids", "limonene", "gentian", "wormwood",
  "percolation", "macerated", "tincture", "solvent", "emulsion", "HLB",
];

/**
 * How many distinct glossary terms in one comma-separated cue mean the decoder
 * is reading its own prompt back rather than transcribing speech.
 *
 * Eight is set high deliberately. This course teaches jargon, so a lesson
 * genuinely saying "we'll cover ABV, Brix, GRAS and TTB" must not be refused —
 * but no real sentence lists eight glossary terms in a comma run, while a
 * recited prompt fragment reaches eight immediately.
 */
export const ECHO_TERM_THRESHOLD = 8;
