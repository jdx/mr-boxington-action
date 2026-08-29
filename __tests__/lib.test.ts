import {describe, expect, it} from 'vitest'
import {
  cacheLinksValue,
  callingCard,
  generatedKey,
  generatedRestoreKey,
  githubApiHeaders,
  normalizedVersion,
  parseBackend,
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

  it('validates backends and versions', () => {
    expect(parseBackend('github')).toBe('github')
    expect(parseBackend('server')).toBe('server')
    expect(() => parseBackend('s3')).toThrow()
    expect(normalizedVersion('v0.3.0')).toBe('0.3.0')
    expect(normalizedVersion('latest')).toBe('latest')
    expect(() => normalizedVersion('../main')).toThrow()
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
