import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

export type DerivationReport = {
  ok: boolean;
  error: string | null;
  targetMatches: boolean;
  steps: { line: number | null; name: string; status: "passed" | "failed"; explanation: string; value: string | null }[];
  required: { status: "passed" | "failed"; explanation: string }[];
};

function uvBin(): string {
  const local = path.join(os.homedir(), ".local", "bin", "uv");
  return fs.existsSync(local) ? local : "uv";
}

function readSteps(value: unknown): DerivationReport["steps"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const status = row.status === "passed" || row.status === "failed" ? row.status : null;
    if (!status) return [];
    const valueText = typeof row.value === "string" ? row.value.slice(0, 300) : null;
    return [
      {
        line: typeof row.line === "number" ? row.line : null,
        name: typeof row.name === "string" ? row.name : "",
        status,
        explanation: typeof row.explanation === "string" ? row.explanation : "",
        value: valueText,
      },
    ];
  });
}

function failed(error: string): DerivationReport {
  return { ok: false, error, targetMatches: false, steps: [], required: [] };
}

export function checkDerivation(input: {
  steps: { line: number; name: string; expr: string }[];
  target: string;
  reference: string;
  required: string[];
}): Promise<DerivationReport> {
  const project = path.join(config.root, "checker");
  return new Promise((resolve) => {
    const child = spawn(
      uvBin(),
      ["run", "--directory", project, "python", "check_derivation.py"],
      { cwd: config.root, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 8000);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(failed("The derivation checker could not be started."));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as Partial<DerivationReport>;
        if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
          resolve(failed("The derivation checker did not return a result."));
          return;
        }
        resolve({
          ok: parsed.ok,
          error: typeof parsed.error === "string" ? parsed.error : null,
          targetMatches: Boolean(parsed.targetMatches),
          steps: readSteps(parsed.steps),
          required: Array.isArray(parsed.required) ? parsed.required : [],
        });
      } catch {
        resolve(failed("The derivation checker did not return a result."));
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
