export type Backend = 'github' | 'server'

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
