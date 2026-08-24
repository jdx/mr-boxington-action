import {describe, expect, it} from 'vitest'
import {
  generatedKey,
  generatedRestoreKey,
  normalizedVersion,
  parseBackend,
  releaseTarget,
  shouldSave
} from '../src/lib.js'

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
    expect(() => releaseTarget('win32', 'arm64')).toThrow()
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
