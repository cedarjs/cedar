#!/usr/bin/env node

import { execSync } from 'node:child_process'

const REPO = 'cedarjs/cedar'
const API = 'https://api.github.com'

interface GitHubCache {
  id: number
  key: string
}

interface GitHubCacheResponse {
  actions_caches: GitHubCache[]
}

function getToken(): string {
  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim()
  } catch {
    console.error('Failed to get GitHub token. Run `gh auth login` first.')
    process.exit(1)
  }
}

async function listCaches(token: string): Promise<GitHubCache[]> {
  const caches: GitHubCache[] = []
  let page = 1
  let hasNextPage = true

  while (hasNextPage) {
    const res = await fetch(
      `${API}/repos/${REPO}/actions/caches?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    )

    if (!res.ok) {
      console.error(`Failed to list caches: ${res.status} ${await res.text()}`)
      process.exit(1)
    }

    const data: GitHubCacheResponse = await res.json()
    caches.push(...data.actions_caches)

    if (data.actions_caches.length < 100) {
      hasNextPage = false
    }

    page++
  }

  return caches
}

async function deleteCache(token: string, id: number): Promise<boolean> {
  const res = await fetch(`${API}/repos/${REPO}/actions/caches/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  return res.ok
}

async function deleteCachesByKey(token: string, key: string): Promise<boolean> {
  const res = await fetch(
    `${API}/repos/${REPO}/actions/caches?key=${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  )
  return res.ok
}

const token = getToken()

const keyFilter = process.argv[2]

if (keyFilter) {
  console.log(`Deleting all caches matching key "${keyFilter}"...`)
  const ok = await deleteCachesByKey(token, keyFilter)
  if (ok) {
    console.log('Done.')
  } else {
    console.error('Failed to delete caches.')
    process.exit(1)
  }
} else {
  console.log('Listing all caches...')
  const caches = await listCaches(token)
  console.log(`Found ${caches.length} cache(s).`)

  if (caches.length === 0) {
    console.log('Nothing to delete.')
    process.exit(0)
  }

  let deleted = 0
  for (const cache of caches) {
    const ok = await deleteCache(token, cache.id)
    if (ok) {
      deleted++
      process.stdout.write('.')
    } else {
      process.stdout.write('!')
    }
  }
  console.log(`\nDeleted ${deleted}/${caches.length} cache(s).`)
}
