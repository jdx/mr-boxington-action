import {createHash} from 'node:crypto'

export type Backend = 'local' | 'github' | 'server'

export interface CallingCardRow {
  label: string
  value: string
}

export interface GithubRelease {
  tag_name: string
  immutable: boolean
  assets: {
    name: string
    digest: string | null
  }[]
}

export interface VerifiedReleaseAsset {
  version: string
  sha256: string
}

export function parsedMbxVersion(value: string): string | undefined {
  return value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/)?.[0]
}

export function mbxReleaseToInstall(requested: string, foundOnPath: boolean): string | undefined {
  if (requested) return normalizedVersion(requested)
  return foundOnPath ? undefined : 'latest'
}

export function githubApiHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export function githubTokenValue(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.GITHUB_TOKEN || input
}

export function requireGithubCacheRuntime(env: NodeJS.ProcessEnv = process.env): void {
  const missing: string[] = []
  if (!env.ACTIONS_RUNTIME_TOKEN) missing.push('ACTIONS_RUNTIME_TOKEN')
  if (env.ACTIONS_CACHE_SERVICE_V2) {
    if (!env.ACTIONS_RESULTS_URL) missing.push('ACTIONS_RESULTS_URL')
  } else if (!env.ACTIONS_CACHE_URL && !env.ACTIONS_RESULTS_URL) {
    missing.push('ACTIONS_CACHE_URL or ACTIONS_RESULTS_URL')
  }
  if (missing.length === 0) return

  throw new Error(
    `GitHub Actions cache runtime credentials are unavailable (missing ${missing.join(', ')}). ` +
      'The GitHub backend must run through a uses: action step; invoking the distribution ' +
      'bundle from a shell step is unsupported.'
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function callingCard(note: string, rows: CallingCardRow[]): string {
  const tableRows = rows
    .map(
      ({label, value}) =>
        `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join('')
  return [
    `<blockquote>${escapeHtml(note)}</blockquote>`,
    `<table>${tableRows}</table>`
  ].join('')
}

export function parseBackend(value: string): Backend {
  if (value === 'local' || value === 'github' || value === 'server') return value
  throw new Error(`backend must be "local", "github", or "server", got ${JSON.stringify(value)}`)
}

export function cacheLinksValue(value: string, platform: NodeJS.Platform): string | undefined {
  if (value === 'auto') return platform === 'linux' ? '1' : undefined
  if (value === 'true') return '1'
  if (value === 'false') return '0'
  throw new Error(`cache-links must be "auto", "true", or "false", got ${JSON.stringify(value)}`)
}

export function releaseTarget(platform: NodeJS.Platform, arch: string): string {
  const targets: Record<string, string> = {
    'linux:x64': 'x86_64-unknown-linux-musl',
    'linux:arm64': 'aarch64-unknown-linux-musl',
    'darwin:x64': 'x86_64-apple-darwin',
    'darwin:arm64': 'aarch64-apple-darwin',
    'win32:x64': 'x86_64-pc-windows-msvc',
    'win32:arm64': 'aarch64-pc-windows-msvc'
  }
  const target = targets[`${platform}:${arch}`]
  if (!target) throw new Error(`mbx does not publish a binary for ${platform}/${arch}`)
  return target
}

export function normalizedVersion(value: string): string {
  const version = value.trim()
  if (version === 'latest') return version
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid mbx version ${JSON.stringify(value)}`)
  }
  return version.replace(/^v/, '')
}

export function verifiedReleaseAsset(
  release: GithubRelease,
  requested: string,
  archiveName: string
): VerifiedReleaseAsset {
  const version = normalizedVersion(release.tag_name)
  if (requested !== 'latest' && version !== requested) {
    throw new Error(`GitHub returned mbx ${version} when ${requested} was requested`)
  }
  if (release.immutable !== true) {
    throw new Error(`mbx ${version} is not an immutable GitHub release`)
  }
  const asset = release.assets.find(candidate => candidate.name === archiveName)
  const sha256 = asset?.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1]
  if (!sha256) {
    throw new Error(`${archiveName} has no valid SHA-256 digest in the mbx ${version} release`)
  }
  return {version, sha256}
}

export function generatedKey(
  os: string,
  arch: string,
  generation: string,
  toolchain: string,
  sha: string
): string {
  return `${os}-${arch}-mbx-${generation}-${toolchain}-${sha}`
}

export function generatedRestoreKey(
  os: string,
  arch: string,
  generation: string,
  toolchain: string
): string {
  return `${os}-${arch}-mbx-${generation}-${toolchain}-`
}

/** The export error that means a job completed without running an mbx build. */
export function isEmptyExport(output: string): boolean {
  return output.includes('no completed mbx builds are recorded for export group')
}

/**
 * `rustc` arguments that probe the identity of the toolchain a build will use.
 *
 * Bare `rustc` on `PATH` is rustup's shim, so it already answers for a
 * `rust-toolchain.toml` or a directory override. What it cannot see is a
 * toolchain named on the build's own command line — `mbx +1.91 check` compiles
 * with 1.91 while the shim still reports the default — and keying on the
 * default there files the 1.91 store under stable's identity, where the two
 * toolchains share one cache entry and neither restores cleanly.
 *
 * The name is the one rustup takes after a `+`, so a caller who writes the
 * sigil out the way the build spells it means the same toolchain as one who
 * does not.
 */
export function rustcIdentityArgs(toolchain: string): string[] {
  const name = toolchain.trim().replace(/^\+/, '')
  return name ? [`+${name}`, '-vV'] : ['-vV']
}

/**
 * Cache-key segment naming the Rust toolchain the cache was built by.
 *
 * mbx keys every cached compilation on the compiler's identity, so a store
 * built by one toolchain matches nothing once the toolchain changes — which
 * happens under a workflow whenever a runner image updates its preinstalled
 * Rust. Scoping the generated cache key by `rustc -vV` (the same identity
 * Swatinem/rust-cache keys on) keeps each toolchain's store on its own key
 * instead of restoring hundreds of megabytes that can no longer match.
 *
 * Without a `rustc` on `PATH` the segment is the literal `norust`: the cache
 * may still hold C/C++ compilations, and a stable fallback keeps those keyed
 * consistently rather than failing the job.
 */
export function toolchainSegment(rustcIdentity: string | null): string {
  const identity = rustcIdentity?.trim()
  if (!identity) return 'norust'
  return `rust-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`
}

/**
 * Give saving dispatches a fresh primary key so GitHub's immutable cache can
 * preserve state learned after restoring the previous compatible dispatch.
 */
export function cacheRevision(
  eventName: string,
  sha: string,
  saveOnWorkflowDispatch: boolean,
  runId: number,
  runAttempt: number
): string {
  return eventName === 'workflow_dispatch' && saveOnWorkflowDispatch
    ? `${sha}-run-${runId}-${runAttempt}`
    : sha
}

export function shouldSave(
  eventName: string,
  ref: string,
  defaultBranch?: string | null,
  saveOnWorkflowDispatch = false
): boolean {
  if (eventName === 'workflow_dispatch') return saveOnWorkflowDispatch
  return Boolean(
    eventName === 'push' &&
      defaultBranch &&
      ref === `refs/heads/${defaultBranch}`
  )
}
