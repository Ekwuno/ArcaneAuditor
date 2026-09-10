# Action self-test fixture

`sample/` is a deliberately flawed one-page Extend app used by
`.github/workflows/action-selftest.yml` to prove the GitHub Action installs
the CLI, runs it, and reports findings. It should always trigger at least:

- `HardcodedWorkdayAPIRule` (ACTION) on the `getWorkers` endpoint URL
- `ScriptConsoleLogRule` (ACTION) on the `console.debug` call in `onLoad`
- `ScriptVarUsageRule` (ADVICE) on `var count`

Do not "fix" these files.
