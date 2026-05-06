# Windows Cache Race Condition — CI Failure Summary

**Context:** PR #1650 (replace `eslint-plugin-import` with `eslint-plugin-import-x`)  
**Failing job:** `🔄 CLI smoke tests / windows-latest / node 24 latest / cli-smoke-tests`  
**Failed step:** `Post Set up job` (step 53 of 55)

---

## Hard facts

1. **All actual test steps passed.** Every CLI smoke-test step (`cedar info`, `cedar lint`, `cedar build`, `cedar test`, `cedar prisma migrate`, codemod, etc.) reported `conclusion: success`.
2. **The only failure is in the post-job cleanup step.** The GitHub Actions runner reported `Post Set up job` as `conclusion: failure`.
3. **The log shows a cache-save race.** In the `Post Set up job` logs we see:
   ```
   Failed to save: Unable to reserve cache with key node-modules-Windows-cf8eb20554b974eb5a05ea8f99090f398b4433a4904c4ac5a15f40ff4fe305c6,
   another job may be creating this cache.
   ```
4. **The same cache key is shared across multiple concurrent Windows jobs.** The `actions/cache` step in `.github/actions/set-up-yarn-cache/action.yml` uses a key derived from `hashFiles('package.json', 'yarn.lock', '.yarnrc.yml')` with **no** per-job or per-matrix suffix for the `node_modules` cache:
   ```yaml
   key: node-modules-${{ runner.os }}-${{ hashFiles('package.json', 'yarn.lock', '.yarnrc.yml') }}
   ```
   This means every Windows job in the same workflow run computes the **identical** key and all try to save to it simultaneously.
5. **This failure is not new to this PR.** Other unrelated PRs (e.g. PR #1679, PR #1711) show the exact same Windows `cli-smoke-tests` and `smoke-tests` jobs failing with the same cache-reservation error.

---

## Best guesses / assumptions

1. **Why only Windows?** `actions/cache` on Windows uses `tar.exe` with `zstd` compression. The Windows runner implementation appears to treat a cache-reservation conflict as a hard step failure more aggressively than the Ubuntu runner, where the same concurrent save is silently ignored or retried.
2. **Why now and not always?** The race is timing-dependent. If one Windows job finishes its `Post Set up job` a few seconds before the others, the first one successfully reserves the key and the rest fail. The exact timing varies per-run based on network speed, build duration, etc.
3. **The fix is likely to stop caching `node_modules` on Windows.** The `node_modules` cache avoids Yarn's "link" step, but with `nodeLinker: node-modules` and warm yarn-cache + install-state caches, the link step is already fast. Removing the `node_modules` cache on Windows would eliminate the race entirely without materially slowing the job.
4. **This is NOT caused by the PR's code changes.** The PR only touches `eslint.config.mjs`, `packages/eslint-config`, and `yarn.lock`. It does not modify `.github/actions/set-up-yarn-cache` or any CI workflow file.

---

## Recommended next step

Modify `.github/actions/set-up-yarn-cache/action.yml` to skip the `node_modules` cache step when `runner.os == 'Windows'`, while keeping the yarn-cache and install-state caches (those are already keyed with `github.run_id` and do not race).

---

## A Better Fix

Split `actions/cache` into explicit restore + save steps, which lets you add `continue-on-error: true` to the save:

```yaml
- uses: actions/cache/restore@v4
  id: node-modules-cache
  with:
    path: node_modules
    key: node-modules-${{ runner.os }}-${{ hashFiles('package.json', 'yarn.lock', '.yarnrc.yml') }}

# ... install step ...

- uses: actions/cache/save@v4
  if: steps.node-modules-cache.outputs.cache-hit != 'true'
  continue-on-error: true # ← silences the race condition failure
  with:
    path: node_modules
    key: node-modules-${{ runner.os }}-${{ hashFiles('package.json', 'yarn.lock', '.yarnrc.yml') }}
```

This keeps the cache (so no speed regression) and silences the race. The first job to save wins; the rest fail gracefully.
