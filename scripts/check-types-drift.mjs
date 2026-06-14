// Regenerate DB types from the running local Supabase DB and compare to the
// committed packages/shared/src/database.generated.ts. Fails (exit 1) on drift.
// Requires `supabase start` to have run (local DB on the config.toml port).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { format, resolveConfig } from "prettier";

const committedPath = "packages/shared/src/database.generated.ts";

// Format with the repo's .prettierrc (printWidth, trailingComma, …) so this
// matches exactly how `pnpm gen:types` (CLI `prettier --write`) writes the
// committed file. The programmatic format() does NOT auto-resolve config, so
// resolve it explicitly — otherwise prettier defaults cause false drift.
const prettierOptions = (await resolveConfig(committedPath)) ?? {};

const raw = execSync("supabase gen types typescript --local", {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const fresh = (
  await format(raw, { ...prettierOptions, parser: "typescript" })
).trim();
const committed = readFileSync(committedPath, "utf8").trim();

if (fresh !== committed) {
  console.error(
    "\nDB types drift detected.\n" +
      "The committed packages/shared/src/database.generated.ts no longer matches the\n" +
      "migrations. Run `pnpm gen:types` and commit the result.\n",
  );
  process.exit(1);
}
console.log("DB types in sync.");
