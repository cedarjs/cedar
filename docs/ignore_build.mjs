// We only want Netlify to build the site if a PR changes files in this
// directory (./docs).
// See https://docs.netlify.com/configure-builds/ignore-builds.
// Netlify runs this via Node.js v22 (even though their docs say Node 18).
// If the exit-code is 0, the build will be ignored.

import { execSync } from 'node:child_process'

async function main() {
  if (process.env.BRANCH === 'main') {
    try {
      // Reproduce the default behavior for main.
      // See https://docs.netlify.com/configure-builds/ignore-builds/#mimic-default-behavior.
      // `execSync` throws if the process times out or has a non-zero exit code.
      execSync('git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF')
      // If we come here, git diff exited with code 0, which means that there
      // were no changes since the last cached build. So no need to build -> We
      // can exit with 0 to ignore this build.
      process.exitCode = 0
      return
    } catch {
      // Continue to check what files changed
    }
  }

  // Query the GithHub API to get the changed files in the PR
  // See below for REVIEW_ID
  // https://docs.netlify.com/configure-builds/environment-variables/#git-metadata
  // If we don't have a review ID the best we can do is check the commit (this
  // happens when we're committing straight to main)
  const url = process.env.REVIEW_ID
    ? `https://api.github.com/repos/cedarjs/cedar/pulls/${process.env.REVIEW_ID}/files?per_page=100`
    : `https://api.github.com/repos/cedarjs/cedar/commits/${process.env.COMMIT_REF}`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.CEDAR_GITHUB_TOKEN}`,
      ['X-GitHub-Api-Version']: '2022-11-28',
      Accept: 'application/vnd.github+json',
    },
  })
  const json = await resp.json()
  // Account for both PRs and commits in the returned json object
  const changedFiles = (json.files || json).map((file) => file.filename)

  console.log({
    changedFiles,
  })

  const docFilesChanged = changedFiles.filter((changedFile) =>
    changedFile.startsWith('docs')
  )
  console.log({
    docFilesChanged,
  })

  // We don't handle pagination here. If there are more than 100 changed files,
  // we assume that there are docs changes.
  if (docFilesChanged.length > 0 || changedFiles.length >= 100) {
    console.log(
      `PR '${process.env.HEAD}' has docs changes. Proceeding with build`
    )
    process.exitCode = 1
    return
  }

  console.log(`PR '${process.env.HEAD}' doesn't have doc changes. Ignoring`)
}

const dashes = '-'.repeat(10)
console.log(`${dashes} IGNORE BUILD START ${dashes}`)
main().finally(() => {
  console.log(`${dashes} IGNORE BUILD END ${dashes}`)
})
