import {describe, expect, it} from 'vitest'
import {
  cacheLinksValue,
  cacheRevision,
  callingCard,
  generatedKey,
  generatedRestoreKey,
  githubCacheGeneration,
  githubApiHeaders,
  githubTokenValue,
  isEmptyExport,
  mbxReleaseToInstall,
  normalizedVersion,
  parseBackend,
  parseGithubCacheMode,
  parsedMbxVersion,
  requireGithubCacheRuntime,
  releaseTarget,
  rustcIdentityArgs,
  shouldSave,
  toolchainSegment,
  verifiedReleaseAsset
} from '../src/lib.js'

describe('calling card', () => {
  it('renders useful details and escapes action inputs', () => {
    expect(
      callingCard('<quite so>', [
        {label: 'mbx', value: '0.3.0'},
        {label: 'Backend', value: '<cache & server>'}
      ])
    ).toBe(
      '<blockquote>&lt;quite so&gt;</blockquote>' +
        '<table><tr><th align="left">mbx</th><td>0.3.0</td></tr>' +
        '<tr><th align="left">Backend</th><td>&lt;cache &amp; server&gt;</td></tr></table>'
    )
  })
})

describe('inputs', () => {
  it('authenticates GitHub API requests when a token is available', () => {
    expect(githubApiHeaders('secret')).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer secret'
    })
    expect(githubApiHeaders('')).not.toHaveProperty('Authorization')
  })

  it('prefers GITHUB_TOKEN over the action input', () => {
    expect(githubTokenValue('workflow-token', {GITHUB_TOKEN: 'environment-token'})).toBe(
      'environment-token'
    )
    expect(githubTokenValue('workflow-token', {})).toBe('workflow-token')
  })

  it('requires runtime credentials for GitHub cache service v2', () => {
    expect(() =>
      requireGithubCacheRuntime({
        ACTIONS_CACHE_SERVICE_V2: 'true',
        ACTIONS_RUNTIME_TOKEN: 'runtime-token',
        ACTIONS_RESULTS_URL: 'https://results.example.test'
      })
    ).not.toThrow()
    expect(() =>
      requireGithubCacheRuntime({
        ACTIONS_CACHE_SERVICE_V2: 'true',
        ACTIONS_RESULTS_URL: 'https://results.example.test'
      })
    ).toThrow(/missing ACTIONS_RUNTIME_TOKEN/)
    expect(() =>
      requireGithubCacheRuntime({
        ACTIONS_CACHE_SERVICE_V2: 'true',
        ACTIONS_RUNTIME_TOKEN: 'runtime-token'
      })
    ).toThrow(/missing ACTIONS_RESULTS_URL/)
  })

  it('accepts either cache service URL for the legacy client', () => {
    expect(() =>
      requireGithubCacheRuntime({
        ACTIONS_RUNTIME_TOKEN: 'runtime-token',
        ACTIONS_CACHE_URL: 'https://cache.example.test'
      })
    ).not.toThrow()
    expect(() =>
      requireGithubCacheRuntime({
        ACTIONS_RUNTIME_TOKEN: 'runtime-token',
        ACTIONS_RESULTS_URL: 'https://results.example.test'
      })
    ).not.toThrow()
    expect(() => requireGithubCacheRuntime({ACTIONS_RUNTIME_TOKEN: 'runtime-token'})).toThrow(
      /ACTIONS_CACHE_URL or ACTIONS_RESULTS_URL/
    )
  })

  it('explains that direct bundle invocation is unsupported', () => {
    expect(() => requireGithubCacheRuntime({})).toThrow(/must run through a uses: action step/)
  })

  it('validates backends and versions', () => {
    expect(parseBackend('local')).toBe('local')
    expect(parseBackend('github')).toBe('github')
    expect(parseBackend('server')).toBe('server')
    expect(() => parseBackend('s3')).toThrow()
    expect(parseGithubCacheMode('objects')).toBe('objects')
    expect(parseGithubCacheMode('target')).toBe('target')
    expect(() => parseGithubCacheMode('archive')).toThrow(/github-cache-mode/)
    expect(normalizedVersion('v0.3.0')).toBe('0.3.0')
    expect(normalizedVersion('latest')).toBe('latest')
    expect(() => normalizedVersion('../main')).toThrow()
    expect(parsedMbxVersion('mbx 1.3.1')).toBe('1.3.1')
    expect(parsedMbxVersion('mbx 1.3.1-beta.2+build.4')).toBe('1.3.1-beta.2+build.4')
    expect(parsedMbxVersion('not a version')).toBeUndefined()
  })

  it('uses PATH only when no release was requested', () => {
    expect(mbxReleaseToInstall('', true)).toBeUndefined()
    expect(mbxReleaseToInstall('', false)).toBe('latest')
    expect(mbxReleaseToInstall('v1.3.1', true)).toBe('1.3.1')
  })

  it('enables native link caching automatically only on Linux', () => {
    expect(cacheLinksValue('auto', 'linux')).toBe('1')
    expect(cacheLinksValue('auto', 'darwin')).toBeUndefined()
    expect(cacheLinksValue('auto', 'win32')).toBeUndefined()
    expect(cacheLinksValue('true', 'darwin')).toBe('1')
    expect(cacheLinksValue('false', 'linux')).toBe('0')
    expect(() => cacheLinksValue('sometimes', 'linux')).toThrow(/cache-links/)
  })

  it('selects release targets', () => {
    expect(releaseTarget('linux', 'x64')).toBe('x86_64-unknown-linux-musl')
    expect(releaseTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin')
    expect(releaseTarget('win32', 'x64')).toBe('x86_64-pc-windows-msvc')
    expect(releaseTarget('win32', 'arm64')).toBe('aarch64-pc-windows-msvc')
  })

  it('accepts assets only from immutable releases', () => {
    const release = {
      tag_name: 'v0.5.0',
      immutable: true,
      assets: [
        {
          name: 'mbx-x86_64-unknown-linux-musl.tar.gz',
          digest: `sha256:${'a'.repeat(64)}`
        }
      ]
    }
    expect(
      verifiedReleaseAsset(release, '0.5.0', 'mbx-x86_64-unknown-linux-musl.tar.gz')
    ).toEqual({version: '0.5.0', sha256: 'a'.repeat(64)})
    expect(() =>
      verifiedReleaseAsset(
        {...release, immutable: false},
        '0.5.0',
        'mbx-x86_64-unknown-linux-musl.tar.gz'
      )
    ).toThrow(/not an immutable GitHub release/)
  })

  it('rejects mismatched releases and malformed asset digests', () => {
    expect(() =>
      verifiedReleaseAsset(
        {tag_name: 'v0.5.1', immutable: true, assets: []},
        '0.5.0',
        'mbx-x86_64-unknown-linux-musl.tar.gz'
      )
    ).toThrow(/when 0.5.0 was requested/)
    expect(() =>
      verifiedReleaseAsset(
        {
          tag_name: 'v0.5.0',
          immutable: true,
          assets: [
            {name: 'mbx-x86_64-unknown-linux-musl.tar.gz', digest: 'sha256:invalid'}
          ]
        },
        '0.5.0',
        'mbx-x86_64-unknown-linux-musl.tar.gz'
      )
    ).toThrow(/no valid SHA-256 digest/)
  })

  it('generates scoped keys', () => {
    expect(generatedKey('linux', 'x64', 'v2', 'rust-0123456789ab', 'abc')).toBe(
      'linux-x64-mbx-v2-rust-0123456789ab-abc'
    )
    expect(generatedRestoreKey('linux', 'x64', 'v2', 'rust-0123456789ab')).toBe(
      'linux-x64-mbx-v2-rust-0123456789ab-'
    )
    expect(githubCacheGeneration('v2', 'objects')).toBe('v2')
    expect(githubCacheGeneration('v2', 'target')).toBe('v2-target')
  })

  it('recognizes an export group with no completed build', () => {
    expect(
      isEmptyExport('Error: no completed mbx builds are recorded for export group "ci-123"')
    ).toBe(true)
    expect(isEmptyExport('Error: cache export is incomplete or corrupt')).toBe(false)
  })

  it('keys each toolchain identity separately', () => {
    const stable = toolchainSegment('rustc 1.98.0 (88d9e12ae 2026-07-01)\nhost: x86_64-pc-windows-msvc')
    expect(stable).toMatch(/^rust-[0-9a-f]{12}$/)
    // Deterministic, so two runs of one toolchain share a key...
    expect(
      toolchainSegment('rustc 1.98.0 (88d9e12ae 2026-07-01)\nhost: x86_64-pc-windows-msvc')
    ).toBe(stable)
    // ...and a runner-image toolchain bump starts a fresh one.
    expect(
      toolchainSegment('rustc 1.97.1 (a1b2c3d4e 2026-05-20)\nhost: x86_64-pc-windows-msvc')
    ).not.toBe(stable)
  })

  it('probes the toolchain the build names, not the default one', () => {
    expect(rustcIdentityArgs('1.91')).toEqual(['+1.91', '-vV'])
    // The build spells it `mbx +1.91 check`; either spelling names 1.91 here.
    expect(rustcIdentityArgs('+1.91')).toEqual(['+1.91', '-vV'])
    expect(rustcIdentityArgs('nightly-2026-01-15')).toEqual(['+nightly-2026-01-15', '-vV'])
  })

  it('probes whatever rustup resolves when no toolchain is named', () => {
    // The shim already honours rust-toolchain.toml, so an unset input must not
    // become a `+` argument that overrides it.
    expect(rustcIdentityArgs('')).toEqual(['-vV'])
    expect(rustcIdentityArgs('  ')).toEqual(['-vV'])
    expect(rustcIdentityArgs('+')).toEqual(['-vV'])
  })

  it('keys a runner without rust on a stable fallback', () => {
    expect(toolchainSegment(null)).toBe('norust')
    expect(toolchainSegment('')).toBe('norust')
    expect(toolchainSegment('  \n')).toBe('norust')
  })
})

describe('save policy', () => {
  it('rolls saving dispatches onto a fresh immutable cache key', () => {
    expect(cacheRevision('workflow_dispatch', 'abc123', true, 42, 3)).toBe(
      'abc123-run-42-3'
    )
    expect(cacheRevision('workflow_dispatch', 'abc123', false, 42, 3)).toBe('abc123')
    expect(cacheRevision('push', 'abc123', true, 42, 3)).toBe('abc123')
  })

  it('saves only default-branch pushes', () => {
    expect(shouldSave('push', 'refs/heads/main', 'main')).toBe(true)
    expect(shouldSave('pull_request', 'refs/pull/1/merge', 'main')).toBe(false)
    expect(shouldSave('push', 'refs/heads/topic', 'main')).toBe(false)
    expect(shouldSave('workflow_dispatch', 'refs/heads/topic', 'main')).toBe(false)
  })

  it('can opt trusted workflow dispatches into saving', () => {
    expect(shouldSave('workflow_dispatch', 'refs/heads/benchmark', 'main', true)).toBe(true)
    expect(shouldSave('pull_request', 'refs/pull/1/merge', 'main', true)).toBe(false)
    expect(shouldSave('push', 'refs/heads/topic', 'main', true)).toBe(false)
  })
})
