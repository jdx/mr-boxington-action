import {describe, expect, it} from 'vitest'
import {
  callingCard,
  generatedKey,
  generatedRestoreKey,
  normalizedVersion,
  parseBackend,
  releaseTarget,
  shouldSave,
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
  it('validates backends and versions', () => {
    expect(parseBackend('github')).toBe('github')
    expect(parseBackend('server')).toBe('server')
    expect(() => parseBackend('s3')).toThrow()
    expect(normalizedVersion('v0.3.0')).toBe('0.3.0')
    expect(normalizedVersion('latest')).toBe('latest')
    expect(() => normalizedVersion('../main')).toThrow()
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
    expect(generatedKey('linux', 'x64', 'v2', 'abc')).toBe('linux-x64-mbx-v2-abc')
    expect(generatedRestoreKey('linux', 'x64', 'v2')).toBe('linux-x64-mbx-v2-')
  })
})

describe('save policy', () => {
  it('saves only default-branch pushes', () => {
    expect(shouldSave('push', 'refs/heads/main', 'main')).toBe(true)
    expect(shouldSave('pull_request', 'refs/pull/1/merge', 'main')).toBe(false)
    expect(shouldSave('push', 'refs/heads/topic', 'main')).toBe(false)
  })
})
