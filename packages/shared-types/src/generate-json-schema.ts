/**
 * Script: generates schema.json from the Zod schema.
 * Run via: pnpm --filter @ghost-doc/shared-types generate-schema
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TraceEventSchema } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const jsonSchema = zodToJsonSchema(TraceEventSchema, {
  name: "TraceEvent",
  $refStrategy: "none",
});

const outputPath = resolve(__dirname, "../schema.json");
writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2) + "\n", "utf-8");

console.log(`[ghost-doc] schema.json written to ${outputPath}`);
