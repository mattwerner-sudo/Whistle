/**
 * Thin wrapper: 5-row teaser CSV for outreach DMs.
 * Same engine as export-list.ts, forced into --sample mode.
 *
 * Usage: npx tsx scripts/make-sample.ts --titles "ticket" [--conference SEC]
 */
process.argv.push("--sample");
import("./export-list");
