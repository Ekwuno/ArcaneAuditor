#!/usr/bin/env node
// Merges the per-path JSON reports produced by run.sh into one report.
// Zero dependencies. Node 18+.
//
//   node merge.mjs <manifest.tsv> <output.json>
//
// The manifest has one tab-separated line per audited path:
//   path <TAB> exitCode|missing|skipped <TAB> stdoutFile <TAB> stderrFile
//
// Output keeps Arcane's schema 2.0 layout (summary + findings) so existing
// consumers keep working, and adds:
//   runs[]        one entry per path with its exit code and status
//   findings[].location.file_path is prefixed with the audited path for
//                 directory inputs, so paths are relative to the workspace.

import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) {
  console.error("usage: merge.mjs <manifest.tsv> <output.json>");
  process.exit(2);
}

const runs = [];
const findings = [];
let totalFiles = 0;
let totalRules = 0;
let context = undefined;

for (const line of readFileSync(manifestPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const [path, status, stdoutFile, stderrFile] = line.split("\t");
  const run = { path, status: "ok", exit_code: null };

  if (status === "missing" || status === "skipped") {
    run.status = status;
    runs.push(run);
    continue;
  }

  const exitCode = Number(status);
  run.exit_code = exitCode;
  const stderr = stderrFile && existsSync(stderrFile) ? readFileSync(stderrFile, "utf8") : "";

  if (exitCode >= 2) {
    run.status = "error";
    run.stderr = tail(stderr, 20);
    findings.push({
      rule_id: "ArcaneAuditorError",
      severity: "ACTION",
      category: "tooling",
      fix_strategy: "human_review",
      fix_strategy_overridden: false,
      message:
        exitCode === 2
          ? `Arcane Auditor could not analyze this path (usage error, exit 2). ${firstLine(stderr)}`
          : `Arcane Auditor failed while analyzing this path (exit ${exitCode}). ${firstLine(stderr)}`,
      location: { file_path: path, line: 0, column: null, end_line: null, end_column: null, path: null },
      snippet: tail(stderr, 10),
      suggested_replacement: null,
      target_text: null,
      replacement_context: null,
      finding_id: `error:${path}:${exitCode}`
    });
    runs.push(run);
    continue;
  }

  let report;
  let preamble = "";
  try {
    ({ report, preamble } = parseAgentJson(readFileSync(stdoutFile, "utf8")));
  } catch (err) {
    run.status = "error";
    run.stderr = `could not parse JSON output: ${err.message}`;
    runs.push(run);
    continue;
  }

  const prefix = existsSync(path) && statSync(path).isDirectory() ? path.replace(/\/+$/, "") : null;
  for (const f of report.findings ?? []) {
    const loc = f.location ?? {};
    let filePath = loc.file_path ?? "";
    if (prefix && filePath && !filePath.startsWith(prefix + "/") && filePath !== prefix) {
      filePath = join(prefix, filePath);
    }
    findings.push({ ...f, location: { ...loc, file_path: filePath } });
  }
  if (preamble.trim()) {
    // The CLI printed a warning before the JSON (usually a script block its
    // parser gave up on). Keep it visible on the run record.
    run.warnings = tail(preamble, 12);
  }
  totalFiles += report.summary?.total_files ?? 0;
  totalRules = Math.max(totalRules, report.summary?.total_rules ?? 0);
  if (report.context && !context) context = report.context;
  run.findings = (report.findings ?? []).length;
  runs.push(run);
}

findings.sort((a, b) =>
  cmp(a.location?.file_path, b.location?.file_path) ||
  cmp(a.location?.line ?? 0, b.location?.line ?? 0) ||
  cmp(a.rule_id, b.rule_id) ||
  cmp(a.message, b.message)
);

const bySeverity = { ACTION: 0, ADVICE: 0 };
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

const merged = {
  schema_version: "2.0",
  generated_by: "arcane-auditor-action",
  summary: {
    total_files: totalFiles,
    total_rules: totalRules,
    total_findings: findings.length,
    findings_by_severity: bySeverity
  },
  runs,
  findings
};
if (context) merged.context = context;

writeFileSync(outputPath, JSON.stringify(merged, null, 2) + "\n");

const errors = runs.filter((r) => r.status === "error").length;
console.log(
  `Merged ${runs.length} run(s) into ${outputPath}: ${bySeverity.ACTION} ACTION, ${bySeverity.ADVICE} ADVICE` +
    (errors ? `, ${errors} run(s) failed` : "")
);

if (process.env.GITHUB_OUTPUT) {
  const out = [
    `report=${outputPath}`,
    `action-count=${bySeverity.ACTION}`,
    `advice-count=${bySeverity.ADVICE}`,
    `error-count=${errors}`,
    `exit-code=${bySeverity.ACTION > 0 || errors > 0 ? 1 : 0}`
  ].join("\n");
  writeFileSync(process.env.GITHUB_OUTPUT, out + "\n", { flag: "a" });
}

// Agent mode prints JSON to stdout, but the CLI can still print a warning
// line first. Skip anything before the line that starts the JSON document.
function parseAgentJson(text) {
  text = String(text);
  const idx = text.search(/^[{\[]/m);
  if (idx === -1) throw new Error(`no JSON document in output: ${text.trim().split("\n")[0] ?? ""}`);
  return { report: JSON.parse(text.slice(idx)), preamble: text.slice(0, idx) };
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function tail(text, n) {
  return text.trim().split("\n").slice(-n).join("\n");
}
function firstLine(text) {
  return (text.trim().split("\n")[0] ?? "").trim();
}
