import type { JSONSchema, ContractDefinition } from "../types.js";

export type ContractFormat = "json-schema" | "typescript" | "yaml";

// ---------------------------------------------------------------------------
// JSON Schema export (default)
// ---------------------------------------------------------------------------

function toJsonSchema(contract: ContractDefinition): string {
  return JSON.stringify(contract, null, 2);
}

// ---------------------------------------------------------------------------
// TypeScript interface export
// ---------------------------------------------------------------------------

function schemaToTsType(schema: JSONSchema, indent = 0): string {
  const pad = " ".repeat(indent);

  if (schema.enum !== undefined) {
    return schema.enum.map((e) => JSON.stringify(e)).join(" | ");
  }

  if (schema.oneOf !== undefined) {
    return schema.oneOf.map((s) => schemaToTsType(s, indent)).join(" | ");
  }

  if (schema.type === undefined) return "unknown";

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const tsTypes = types.map((t) => {
    switch (t) {
      case "null":
        return "null";
      case "boolean":
        return "boolean";
      case "number":
        return "number";
      case "string":
        return "string";
      case "array": {
        const itemType =
          schema.items !== undefined ? schemaToTsType(schema.items, indent) : "unknown";
        return `Array<${itemType}>`;
      }
      case "object": {
        if (schema.properties === undefined) return "Record<string, unknown>";
        const props = Object.entries(schema.properties)
          .map(([key, sub]) => {
            const isRequired = schema.required?.includes(key) ?? false;
            const optMark = isRequired ? "" : "?";
            return `${pad}  ${JSON.stringify(key)}${optMark}: ${schemaToTsType(sub, indent + 2)};`;
          })
          .join("\n");
        return `{\n${props}\n${pad}}`;
      }
      default:
        return "unknown";
    }
  });

  return tsTypes.join(" | ");
}

function toTypeScript(contract: ContractDefinition): string {
  const lines: string[] = [];

  lines.push(
    `// Ghost Doc Contract — ${contract.functionName}`,
    `// Generated: ${contract.generatedAt}  Samples: ${contract.sampleCount}`,
    "",
  );

  // Arg interfaces
  if (contract.args.length > 0) {
    contract.args.forEach((schema, i) => {
      const typeName = `${contract.functionName}Arg${i}`;
      lines.push(`export type ${typeName} = ${schemaToTsType(schema)};`);
    });
    lines.push("");
  }

  // Return type
  lines.push(`export type ${contract.functionName}Return = ${schemaToTsType(contract.returns)};`);

  // Function signature
  const argList = contract.args
    .map((_, i) => `arg${i}: ${contract.functionName}Arg${i}`)
    .join(", ");
  lines.push(
    "",
    `export type ${contract.functionName}Fn = (${argList}) => ${contract.functionName}Return;`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// YAML export (lightweight serializer for JSON Schema subset)
// ---------------------------------------------------------------------------

function toYamlValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);

  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Quote strings that could be misinterpreted
    if (
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      /[:#\[\]{},&*!|>'"@`%]/.test(value[0] ?? "") ||
      /\n/.test(value)
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `\n${pad}- ${toYamlValue(item, indent + 2)}`).join("");
    return items;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return (
      "\n" +
      entries
        .map(([k, v]) => {
          const valStr = toYamlValue(v, indent + 2);
          const needsNewline = typeof v === "object" && v !== null && !Array.isArray(v);
          return `${pad}${k}:${needsNewline ? "" : " "}${valStr}`;
        })
        .join("\n")
    );
  }
  return String(value);
}

function toYaml(contract: ContractDefinition): string {
  // Serialize ContractDefinition as YAML
  const lines: string[] = [
    `# Ghost Doc Contract — ${contract.functionName}`,
    `# Generated: ${contract.generatedAt}`,
    "",
    `version: "${contract.version}"`,
    `functionName: ${contract.functionName}`,
    `generatedAt: ${contract.generatedAt}`,
    `sampleCount: ${contract.sampleCount}`,
  ];

  lines.push("args:");
  if (contract.args.length === 0) {
    lines.push("  []");
  } else {
    for (const arg of contract.args) {
      lines.push(`  -${toYamlValue(arg, 4)}`);
    }
  }

  lines.push(`returns:${toYamlValue(contract.returns, 2)}`);

  if (contract.errors !== undefined && contract.errors.length > 0) {
    lines.push("errors:");
    for (const err of contract.errors) {
      lines.push(`  -${toYamlValue(err, 4)}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise a ContractDefinition to the requested format string.
 */
export function exportContract(
  contract: ContractDefinition,
  format: ContractFormat = "json-schema",
): string {
  switch (format) {
    case "json-schema":
      return toJsonSchema(contract);
    case "typescript":
      return toTypeScript(contract);
    case "yaml":
      return toYaml(contract);
    default:
      throw new Error(`Unknown contract format: ${String(format)}`);
  }
}

/**
 * Parse and validate a ContractDefinition from an unknown value.
 * Accepts raw JSON (parsed object) or a JSON string.
 */
export function loadContract(data: unknown): ContractDefinition {
  const obj: unknown = typeof data === "string" ? (JSON.parse(data) as unknown) : data;

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("loadContract: expected a JSON object");
  }

  const raw = obj as Record<string, unknown>;

  if (raw["version"] !== "1.0") {
    throw new Error(`loadContract: unsupported version "${String(raw["version"])}"`);
  }
  if (typeof raw["functionName"] !== "string") {
    throw new Error('loadContract: missing string field "functionName"');
  }
  if (!Array.isArray(raw["args"])) {
    throw new Error('loadContract: "args" must be an array');
  }

  return {
    version: "1.0",
    functionName: raw["functionName"],
    generatedAt:
      typeof raw["generatedAt"] === "string" ? raw["generatedAt"] : new Date().toISOString(),
    sampleCount: typeof raw["sampleCount"] === "number" ? raw["sampleCount"] : 0,
    args: raw["args"] as JSONSchema[],
    returns: (raw["returns"] as JSONSchema | undefined) ?? {},
    ...(Array.isArray(raw["errors"]) ? { errors: raw["errors"] as JSONSchema[] } : {}),
  };
}
