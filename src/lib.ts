export type Backend = 'github' | 'server'

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

// v0.4.0 predates GitHub release immutability, so the action itself is the
// independent trust anchor for the version it installs by default.
const TRUSTED_RELEASE_DIGESTS: Record<string, Record<string, string>> = {
  '0.4.0': {
    'mbx-aarch64-apple-darwin.tar.gz':
      '416cab92e23c4652183e4a794af3fdcbc50b56296d8c09f8b6548e7577416307',
    'mbx-aarch64-unknown-linux-musl.tar.gz':
      'ed81dab87775bcc8764c7257d8bea0dd8b7f811d6263b71bc7cd83a879661593',
    'mbx-x86_64-apple-darwin.tar.gz':
      '9f1016b0592ffd3b4b4000640223e10a2100cc6136d722fac5c4829cb89fc7ed',
    'mbx-x86_64-pc-windows-msvc.zip':
      'f841b1907cf86c54db4d3d2d1e88f87303ccc8f720efff90b6331d7d5592bf4e',
    'mbx-x86_64-unknown-linux-musl.tar.gz':
      'b288265404b8fa4620ea1d082ba9b33a0a1695212d88a385e76aa07a743da250'
  }
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
  if (value === 'github' || value === 'server') return value
  throw new Error(`backend must be "github" or "server", got ${JSON.stringify(value)}`)
}

export function releaseTarget(platform: NodeJS.Platform, arch: string): string {
  const targets: Record<string, string> = {
    'linux:x64': 'x86_64-unknown-linux-musl',
    'linux:arm64': 'aarch64-unknown-linux-musl',
    'darwin:x64': 'x86_64-apple-darwin',
    'darwin:arm64': 'aarch64-apple-darwin',
    'win32:x64': 'x86_64-pc-windows-msvc'
  }
  const target = targets[`${platform}:${arch}`]
  if (!target) throw new Error(`mbx does not publish a binary for ${platform}/${arch}`)
  return target
}

export function normalizedVersion(value: string): string {
  const version = value.trim()
  if (version === 'latest') return version
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid mbx version ${JSON.stringify(value)}`)
  }
  return version.replace(/^v/, '')
}

export function trustedReleaseAsset(
  version: string,
  archiveName: string
): VerifiedReleaseAsset | undefined {
  const sha256 = TRUSTED_RELEASE_DIGESTS[version]?.[archiveName]
  return sha256 ? {version, sha256} : undefined
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
  const trusted = trustedReleaseAsset(version, archiveName)
  if (trusted) return trusted
  if (release.immutable !== true) {
    throw new Error(
      `mbx ${version} is not an immutable GitHub release and has no checksum pinned by this action`
    )
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
  sha: string
): string {
  return `${os}-${arch}-mbx-${generation}-${sha}`
}

export function generatedRestoreKey(os: string, arch: string, generation: string): string {
  return `${os}-${arch}-mbx-${generation}-`
}

export function shouldSave(eventName: string, ref: string, defaultBranch?: string | null): boolean {
  return Boolean(
    eventName === 'push' &&
      defaultBranch &&
      ref === `refs/heads/${defaultBranch}`
  )
}
