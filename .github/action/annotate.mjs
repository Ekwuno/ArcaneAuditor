#!/usr/bin/env node
// Turns an Arcane Auditor JSON report into GitHub Actions annotations and a
// job summary. Zero dependencies. Node 18+.
//
//   node annotate.mjs <report.json> [--no-summary] [--max-annotations N]
//
// Annotations use workflow commands (::error / ::warning) so they work on
// pull requests from forks, where the job has no write token. GitHub shows at
// most 10 errors and 10 warnings per step, so ACTION findings are emitted
// first and the full list always goes to the job summary.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const reportPath = args.find((a) => !a.startsWith("--"));
if (!reportPath) {
  console.error("usage: annotate.mjs <report.json> [--no-summary] [--max-annotations N]");
  process.exit(2);
}
const noSummary = args.includes("--no-summary");
const maxIdx = args.indexOf("--max-annotations");
const maxPerLevel = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 10;

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const findings = [...(report.findings ?? [])].sort((a, b) => rank(a) - rank(b));

// Annotations -------------------------------------------------------------
const emitted = { error: 0, warning: 0 };
for (const f of findings) {
  const level = f.severity === "ACTION" ? "error" : "warning";
  if (emitted[level] >= maxPerLevel) continue;
  emitted[level]++;
  const loc = f.location ?? {};
  const props = [];
  if (loc.file_path) props.push(`file=${esc(loc.file_path)}`);
  if (loc.line > 0) props.push(`line=${loc.line}`);
  if (loc.end_line > loc.line) props.push(`endLine=${loc.end_line}`);
  props.push(`title=${esc(`${f.rule_id} (${f.severity})`)}`);
  console.log(`::${level} ${props.join(",")}::${escData(messageWithFix(f))}`);
}

const hidden = findings.length - emitted.error - emitted.warning;
if (hidden > 0) {
  console.log(`::notice title=Arcane Auditor::${hidden} more finding(s) not shown as annotations. See the job summary for the full list.`);
}

// Job summary ---------------------------------------------------------------
if (!noSummary && process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report, findings), { flag: "a" });
}

function summary(report, findings) {
  const s = report.summary ?? {};
  const by = s.findings_by_severity ?? {};
  const runs = report.runs ?? [];
  const lines = [];
  lines.push("## Arcane Auditor");
  lines.push("");
  if (findings.length === 0) {
    lines.push("No findings. Nice work.");
    lines.push("");
  } else {
    lines.push(`**${by.ACTION ?? 0} ACTION** finding(s) to fix and **${by.ADVICE ?? 0} ADVICE** suggestion(s).`);
    lines.push("");
    lines.push("| Severity | Rule | File | Line | Message | Suggested fix |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const f of findings.slice(0, 200)) {
      const loc = f.location ?? {};
      const fix = f.suggested_replacement
        ? `\`${cell(f.target_text ?? "")}\` → \`${cell(f.suggested_replacement)}\``
        : "";
      lines.push(
        `| ${f.severity} | \`${f.rule_id}\` | \`${cell(loc.file_path ?? "")}\` | ${loc.line > 0 ? loc.line : ""} | ${cell(f.message)} | ${fix} |`
      );
    }
    if (findings.length > 200) lines.push(`| | | | | ... ${findings.length - 200} more | |`);
    lines.push("");
  }
  if (runs.length) {
    lines.push("<details><summary>Audited paths</summary>");
    lines.push("");
    lines.push("| Path | Status | Findings |");
    lines.push("| --- | --- | --- |");
    for (const r of runs) {
      const status = r.status + (r.exit_code != null ? ` (exit ${r.exit_code})` : "") + (r.warnings ? " with parser warnings" : "");
      lines.push(`| \`${cell(r.path)}\` | ${status} | ${r.findings ?? ""} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  lines.push("ACTION findings should be addressed before merge. ADVICE findings are recommendations. Rule details: `ArcaneAuditorCLI describe-rule <RuleId>` or [docs/RULES.md](https://github.com/Developers-and-Dragons/ArcaneAuditor/blob/main/docs/RULES.md).");
  lines.push("");
  return lines.join("\n");
}

function messageWithFix(f) {
  let msg = f.message ?? "";
  if (f.suggested_replacement && f.target_text) {
    msg += ` Suggested fix: replace "${f.target_text}" with "${f.suggested_replacement}".`;
  } else if (f.suggested_replacement) {
    msg += ` Suggested fix: ${f.suggested_replacement}`;
  }
  return msg;
}

function rank(f) {
  return f.severity === "ACTION" ? 0 : 1;
}

// Escaping rules match @actions/core: properties also escape ":" and ",",
// message data only escapes "%" and line breaks.
function escData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function esc(s) {
  return escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function cell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 300);
}
