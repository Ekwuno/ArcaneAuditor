# GitHub Action

Arcane Auditor ships as a composite GitHub Action so any repository holding
Workday Extend or Orchestrate source can review it on every push or pull
request. The action downloads the pinned CLI release, verifies its sha256,
runs `review-app` over the paths you give it, and reports findings as
annotations and a job summary. Nothing leaves the runner: no telemetry, no
hosted service, no LLM.

## Quick start

```yaml
name: Arcane Auditor

on:
  pull_request:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Developers-and-Dragons/ArcaneAuditor@v2.1.0
        with:
          path: apps/myApp
```

That fails the job on any ACTION finding, shows every finding as an
annotation in the Files changed tab, and writes a table to the job summary.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `path` | `.` | Directories, zip files, or source files to review. Separate several with spaces or newlines. Directories with no Extend or Orchestrate files are skipped, not failed. |
| `config` | bundled `production-ready` | A preset name (`production-ready`, `development`) or a path to a JSON config file in your repository. See [CONFIGURATION.md](CONFIGURATION.md). |
| `version` | `2.0.0` | Release to install, without the leading `v`. The action pins a sha256 for each version it knows about and refuses to install an unknown one without a hash. |
| `output` | `arcane-report.json` | Where the merged JSON report is written. |
| `fail-on` | `action` | `action` fails on ACTION findings, `advice` fails on any finding, `none` never fails. A path Arcane cannot analyze always counts as ACTION. |
| `annotate` | `true` | Emit annotations and the job summary. Set to `false` when another step renders the report. |
| `rules` | | Comma-separated rule ids to run. |
| `exclude-rules` | | Comma-separated rule ids to skip. |
| `files` | | Comma-separated file globs passed to `--files`. |

## Outputs

| Output | Meaning |
| --- | --- |
| `report` | Path to the merged JSON report. |
| `action-count` | Number of ACTION findings. |
| `advice-count` | Number of ADVICE findings. |
| `error-count` | Number of paths Arcane could not analyze (usage or runtime error). |
| `exit-code` | `1` when there are ACTION findings or errors, otherwise `0`. Independent of `fail-on`, so you can read it even with `fail-on: none`. |

## The report

The report is Arcane's [agent JSON (schema 2.0)](../SKILL.md) with two
additions: findings from every path are merged into one `findings` array with
`location.file_path` prefixed by the directory you passed in, and a `runs`
array records what happened to each path:

```json
{
  "schema_version": "2.0",
  "generated_by": "arcane-auditor-action",
  "summary": { "total_findings": 3, "findings_by_severity": { "ACTION": 1, "ADVICE": 2 } },
  "runs": [
    { "path": "apps/myApp", "status": "ok", "exit_code": 1, "findings": 3 },
    { "path": "docs", "status": "skipped", "exit_code": null }
  ],
  "findings": [
    {
      "rule_id": "HardcodedWorkdayAPIRule",
      "severity": "ACTION",
      "fix_strategy": "actionable",
      "message": "Inbound endpoint 'getWorkers' uses hardcoded *.workday.com URL ...",
      "location": { "file_path": "apps/myApp/presentation/home.pmd", "line": 8, "path": "$.endPoints[0].url" },
      "target_text": "https://api.workday.com/common/v1/workers",
      "suggested_replacement": "<% apiGatewayEndpoint + '/common/v1/workers' %>",
      "replacement_context": "substring"
    }
  ]
}
```

`status` is one of `ok`, `skipped` (no relevant files), `missing` (path does
not exist), or `error` (the CLI exited 2 or 3; the stderr tail is kept on the
run and a synthetic `ArcaneAuditorError` finding is added so the failure is
never silent).

## Recipes

### Only review what a pull request changed

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
- id: dirs
  run: |
    dirs=$(git diff --name-only "${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}" -- apps \
      | cut -d/ -f1-2 | sort -u | tr '\n' ' ')
    echo "list=$dirs" >> "$GITHUB_OUTPUT"
- if: steps.dirs.outputs.list != ''
  uses: Developers-and-Dragons/ArcaneAuditor@v2.1.0
  with:
    path: ${{ steps.dirs.outputs.list }}
```

### Use a config file from your repository

```yaml
- uses: Developers-and-Dragons/ArcaneAuditor@v2.1.0
  with:
    path: apps/myApp
    config: .arcane-auditor/config.json
```

Generate a starting point with `ArcaneAuditorCLI generate-config -o .arcane-auditor/config.json`.

### Feed the report to your own step

```yaml
- id: audit
  uses: Developers-and-Dragons/ArcaneAuditor@v2.1.0
  with:
    path: apps/myApp
    annotate: "false"
    fail-on: none
- run: node scripts/render-audit.mjs "${{ steps.audit.outputs.report }}"
```

### Pull requests from forks

The action only needs `contents: read`, so it runs on fork pull requests with
the default read-only token. Annotations and the job summary still appear;
posting review comments needs a separate `workflow_run` job with
`pull-requests: write`, which is outside this action on purpose.

## Pinning

The action first ships in v2.1.0. Pin to a release tag (`@v2.1.0`) or a full commit sha. Every CLI download is
verified against a sha256 recorded in `.github/action/install.sh`; bumping
`version` to a release the action does not know requires adding its hash
there (or, for experiments, `ARCANE_SHA256` / `ARCANE_ALLOW_UNPINNED=1` when
calling the script directly).

## Running the same scripts locally

The action is three small scripts under `.github/action/` and works without
GitHub:

```bash
ARCANE_INSTALL_DIR=~/.arcane-auditor/bin bash .github/action/install.sh
export PATH="$HOME/.arcane-auditor/bin:$PATH"
ARCANE_PATHS="apps/myApp" ARCANE_OUTPUT=arcane-report.json bash .github/action/run.sh
node .github/action/annotate.mjs arcane-report.json --no-summary
```

`install.sh` supports Linux and macOS. Windows users can download
`ArcaneAuditorCLI.exe` from the release page and run `review-app` directly.
