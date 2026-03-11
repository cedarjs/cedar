# AI analysis

This is what Gemini says:

---

Based on the analysis of your `.github` folder and workflow configurations, here are three high-impact optimization options for your CI pipeline.

### Option 1: "Build Once, Reuse Everywhere" (Highest Impact)

Currently, nearly every job in your matrix (Smoke Tests, CLI Tests, E2E) runs `set-up-job`, which executes `yarn build` to build the entire framework. Even with Nx caching, this incurs overhead for initialization, dependency resolution, and checking cache hits across 15+ parallel jobs.

- **Strategy:** Create a dedicated `build-framework` job that runs immediately after `check`.
- **Action:**
  1.  Run `yarn build` in this single job.
  2.  Upload the `packages` directory (specifically `dist` folders and build artifacts) as a GitHub Action Artifact.
  3.  Update downstream jobs (`smoke-tests`, etc.) to download this artifact and skip the `yarn build` step in `set-up-job`.
- **Benefit:** Eliminates redundant build times across your massive job matrix and reduces API calls/token usage for Nx Cloud.

### Option 2: Optimize the Windows Matrix

Your `ci.yml` runs almost every test suite on both `ubuntu-latest` and `windows-latest`. Windows runners on GitHub Actions are significantly slower to start up and perform file I/O operations (like `npm install` or `yarn build`) compared to Linux.

- **Strategy:** Reduce the frequency of Windows tests.
- **Action:**
  - **PRs:** Run tests only on `ubuntu-latest`. Add a single "Windows Sanity Check" job that runs a subset of critical tests (e.g., `cli-smoke-tests` only).
  - **Merge/Release:** Keep the full Windows matrix for runs on the `main` or `release` branches.
- **Benefit:** Drastically reduces the "time-to-green" for Pull Requests, as they won't be blocked waiting for slower Windows runners.

### Option 3: Refine Caching Strategy (node_modules vs. Global Cache)

Your `set-up-yarn-cache` action currently caches the `node_modules` directory. While intuitively good, restoring a massive `node_modules` folder (containing tens of thousands of small files) on GitHub Actions—especially on Windows—can often take _longer_ than a fresh `yarn install` using a hot global cache.

- **Strategy:** Switch to caching only the Yarn Global Cache.
- **Action:** Modify `set-up-yarn-cache/action.yml` to cache the global cache directory (which you are already fetching) but stop caching/restoring `node_modules` directly. Rely on `yarn install` to link files quickly from the global cache.
- **Benefit:** Faster `set-up-job` times, particularly on Windows, by avoiding the slow I/O of unzipping `node_modules`.

### Recommendation

**Start with Option 2 (Windows Matrix).** It requires the least amount of complex configuration change (mostly simple YAML editing in `ci.yml`) and usually yields the most immediate perceived speedup for developers waiting on PRs. Follow up with **Option 1** for structural efficiency.

---

# My Course of Action

1. Write a script to measure current runtimes to get a baseline to compare
   against.
2. Start with Option 3, because its impact will be easier to notice before we
   implement any of the other options.
