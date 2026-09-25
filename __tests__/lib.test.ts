import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  aliasedInput,
  cacheLinksValue,
  cacheRevision,
  canReuseCachedMbx,
  callingCard,
  cargoTargetDirectory,
  generatedKey,
  generatedRestoreKey,
  githubCacheGeneration,
  githubObjectGcDefault,
  githubApiHeaders,
  githubTokenValue,
  isEmptyExport,
  mbxReleaseToInstall,
  normalizedVersion,
  parseBackend,
  parseGithubCacheMode,
  parsedMbxVersion,
  pullRequestRestoreKey,
  remoteExports,
  remoteStatus,
  requireGithubCacheRuntime,
  releaseTarget,
  rustcIdentityArgs,
  cacheModePermitsWrites,
  isSameRepositoryPullRequest,
  savePolicy,
  supportsDirectoryBundle,
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
    expect(parseBackend('remote')).toBe('remote')
    expect(parseBackend('server')).toBe('remote')
    expect(() => parseBackend('s3')).toThrow(/"local", "github", or "remote"/)
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

  it('reuses only the exact pinned mbx release from a target cache', () => {
    expect(canReuseCachedMbx('v1.8.0', '1.8.0')).toBe(true)
    expect(canReuseCachedMbx('1.8.0', '1.7.0')).toBe(false)
    expect(canReuseCachedMbx('latest', '1.8.0')).toBe(false)
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

  it("asks for a saving pull request's own runs without naming its base entry", () => {
    const base = generatedKey('linux', 'x64', 'v2', 'rust-0123456789ab', 'abc')
    const key = pullRequestRestoreKey('linux', 'x64', 'v2', 'rust-0123456789ab', 'abc')
    // A restore key equal to a saved key wins over every prefix match, so it
    // must reach this pull request's runs without equalling the base entry.
    expect(key).toBe(`${base}-run-`)
    expect(`${base}-run-42-1`.startsWith(key)).toBe(true)
    expect(base.startsWith(key)).toBe(false)
  })

  it('keeps a directory bundle out of the tar key space', () => {
    // A tar entry and a directory entry cannot restore each other, so they
    // must never share a key. The tar form keeps the bare generation it has
    // always used, so entries saved before this existed still restore.
    expect(githubCacheGeneration('v2', 'objects', 'tar')).toBe('v2')
    expect(githubCacheGeneration('v2', 'objects')).toBe('v2')
    expect(githubCacheGeneration('v2', 'objects', 'directory')).toBe('v2-dir')
    expect(githubCacheGeneration('v2', 'target', 'directory')).toBe('v2-target')
  })

  it('uses a directory bundle only where mbx understands one', () => {
    // `--format directory` arrived in 1.12.0; an older binary fails the export.
    expect(supportsDirectoryBundle('1.12.0')).toBe(true)
    expect(supportsDirectoryBundle('v1.12.0')).toBe(true)
    expect(supportsDirectoryBundle('1.12.3')).toBe(true)
    expect(supportsDirectoryBundle('1.13.0')).toBe(true)
    expect(supportsDirectoryBundle('2.0.0')).toBe(true)
    expect(supportsDirectoryBundle('1.11.1')).toBe(false)
    expect(supportsDirectoryBundle('1.8.0')).toBe(false)
    expect(supportsDirectoryBundle('0.20.0')).toBe(false)
    // Anything unreadable falls back to the form every version can read.
    expect(supportsDirectoryBundle('latest')).toBe(false)
    expect(supportsDirectoryBundle('')).toBe(false)
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
  const saves = (eventName: string, ref: string, extra = {}, options = {}) =>
    savePolicy({eventName, ref, defaultBranch: 'main', ...extra}, options).save

  it('rolls saving non-push runs onto a fresh immutable cache key', () => {
    expect(cacheRevision('workflow_dispatch', 'abc123', true, 42, 3)).toBe(
      'abc123-run-42-3'
    )
    expect(cacheRevision('pull_request', 'abc123', true, 42, 3)).toBe('abc123-run-42-3')
    expect(cacheRevision('workflow_dispatch', 'abc123', false, 42, 3)).toBe('abc123')
    expect(cacheRevision('pull_request', 'abc123', false, 42, 3)).toBe('abc123')
    expect(cacheRevision('push', 'abc123', true, 42, 3)).toBe('abc123')
  })

  it('saves only default-branch pushes by default', () => {
    expect(saves('push', 'refs/heads/main')).toBe(true)
    expect(saves('push', 'refs/heads/main', {defaultBranch: undefined})).toBe(false)
    expect(saves('pull_request', 'refs/pull/1/merge', {sameRepository: true})).toBe(false)
    expect(saves('push', 'refs/heads/topic')).toBe(false)
    expect(saves('push', 'refs/heads/release', {refProtected: true})).toBe(false)
    expect(saves('workflow_dispatch', 'refs/heads/topic')).toBe(false)
    expect(saves('push', 'refs/tags/v1.0.0', {refProtected: true})).toBe(false)
  })

  it('can opt trusted workflow dispatches into saving', () => {
    const options = {workflowDispatch: true}
    expect(saves('workflow_dispatch', 'refs/heads/benchmark', {}, options)).toBe(true)
    expect(saves('pull_request', 'refs/pull/1/merge', {sameRepository: true}, options)).toBe(false)
    expect(saves('push', 'refs/heads/topic', {}, options)).toBe(false)
  })

  it('can opt same-repository pull requests into saving', () => {
    const options = {pullRequest: true}
    expect(saves('pull_request', 'refs/pull/1/merge', {sameRepository: true}, options)).toBe(true)
    expect(saves('pull_request', 'refs/pull/1/merge', {sameRepository: false}, options)).toBe(false)
    expect(saves('pull_request_target', 'refs/heads/main', {sameRepository: true}, options)).toBe(false)
    // A merged pull request's `closed` run reports the branch it merged into.
    expect(saves('pull_request', 'refs/heads/release', {sameRepository: true}, options)).toBe(false)
    expect(saves('push', 'refs/heads/topic', {}, options)).toBe(false)
  })

  it('can opt protected-branch pushes into saving', () => {
    const options = {protectedBranch: true}
    expect(saves('push', 'refs/heads/release', {refProtected: true}, options)).toBe(true)
    expect(saves('push', 'refs/heads/topic', {refProtected: false}, options)).toBe(false)
    expect(saves('push', 'refs/tags/v1.0.0', {refProtected: true}, options)).toBe(false)
    expect(saves('pull_request', 'refs/pull/1/merge', {refProtected: true, sameRepository: true}, options)).toBe(false)
  })

  it('respects the cache-mode GitHub granted the job', () => {
    const run = {eventName: 'push', ref: 'refs/heads/main', defaultBranch: 'main'}
    expect(savePolicy({...run, cacheMode: 'read'})).toEqual({
      save: false,
      reason: 'default-branch push; cache-mode read does not permit writes'
    })
    expect(savePolicy({...run, cacheMode: 'none'}).save).toBe(false)
    expect(savePolicy({...run, cacheMode: 'write'}).save).toBe(true)
    expect(savePolicy({...run, cacheMode: 'write-only'}).save).toBe(true)
    expect(savePolicy({...run, cacheMode: ''}).save).toBe(true)
    expect(savePolicy({...run, cacheMode: 'future-mode'}).save).toBe(true)
    expect(savePolicy({...run, ref: 'refs/heads/topic', cacheMode: 'read'}).reason).toBe(
      'unprotected-branch push'
    )
    expect(savePolicy({...run, cacheMode: ' READ '}).save).toBe(false)
    expect(cacheModePermitsWrites('read')).toBe(false)
  })

  it('explains each decision', () => {
    const reason = (eventName: string, ref: string, extra = {}, options = {}) =>
      savePolicy({eventName, ref, defaultBranch: 'main', ...extra}, options).reason
    expect(reason('push', 'refs/heads/main')).toBe('default-branch push')
    expect(reason('push', 'refs/heads/topic')).toBe('unprotected-branch push')
    expect(reason('pull_request', 'refs/pull/1/merge')).toBe('fork pull request')
    expect(reason('pull_request', 'refs/pull/1/merge', {sameRepository: true})).toBe(
      'pull request; save-on-pull-request is off'
    )
    expect(reason('schedule', 'refs/heads/main')).toBe('schedule event')
    expect(
      reason('pull_request', 'refs/heads/main', {sameRepository: true}, {pullRequest: true})
    ).toBe('pull request outside its merge ref')
  })

  it('treats a pull request as a fork unless its head is in the base repository', () => {
    const repo = (full_name: string) => ({repo: {full_name}})
    expect(isSameRepositoryPullRequest({head: repo('jdx/mbx'), base: repo('jdx/mbx')})).toBe(true)
    expect(isSameRepositoryPullRequest({head: repo('fork/mbx'), base: repo('jdx/mbx')})).toBe(false)
    expect(isSameRepositoryPullRequest({head: {repo: null}, base: repo('jdx/mbx')})).toBe(false)
    expect(isSameRepositoryPullRequest(undefined)).toBe(false)
  })
})

describe('object cache GC policy', () => {
  it('keeps imported objects on GitHub-hosted runners', () => {
    expect(githubObjectGcDefault('github', 'objects', {
      RUNNER_ENVIRONMENT: 'github-hosted'
    })).toBe('0')
  })

  it.each(['1', '0', 'true', 'false', ''])('preserves explicit MBX_GC_AUTO=%s', value => {
    expect(githubObjectGcDefault('github', 'objects', {
      RUNNER_ENVIRONMENT: 'github-hosted', MBX_GC_AUTO: value
    })).toBeUndefined()
  })

  it.each(['self-hosted', undefined, 'unknown'])('preserves GC on %s runners', runner => {
    expect(githubObjectGcDefault('github', 'objects', {
      RUNNER_ENVIRONMENT: runner
    })).toBeUndefined()
  })

  it('leaves target, local, and remote caches alone', () => {
    const env = {RUNNER_ENVIRONMENT: 'github-hosted'}
    expect(githubObjectGcDefault('github', 'target', env)).toBeUndefined()
    expect(githubObjectGcDefault('local', 'objects', env)).toBeUndefined()
    expect(githubObjectGcDefault('remote', 'objects', env)).toBeUndefined()
  })
})

describe('cargo target directory', () => {
  it('defaults to target at the job working directory', () => {
    expect(cargoTargetDirectory('', '/work')).toBe(path.resolve('/work', 'target'))
    expect(cargoTargetDirectory('  ', '/work')).toBe(path.resolve('/work', 'target'))
    expect(cargoTargetDirectory('.', '/work')).toBe(path.resolve('/work', 'target'))
  })

  it('follows a workspace below or outside the checkout', () => {
    expect(cargoTargetDirectory('rust', '/work')).toBe(path.resolve('/work', 'rust', 'target'))
    expect(cargoTargetDirectory('rust/', '/work')).toBe(path.resolve('/work', 'rust', 'target'))
    expect(cargoTargetDirectory('/elsewhere/ws', '/work')).toBe(path.resolve('/elsewhere/ws', 'target'))
  })
})

describe('remote backend', () => {
  const noInputs = {url: '', namespace: '', token: '', tokenFile: '', oidcAudience: '', mode: ''}

  it('exports nothing when no input is set, keeping earlier steps\' variables', () => {
    expect(remoteExports(noInputs)).toEqual({})
  })

  it('exports exactly the inputs that were given', () => {
    expect(
      remoteExports({...noInputs, url: 's3://bucket/cache/mbx', namespace: 'acme', mode: 'read-only'})
    ).toEqual({
      MBX_REMOTE_URL: 's3://bucket/cache/mbx',
      MBX_REMOTE_NAMESPACE: 'acme',
      MBX_REMOTE_MODE: 'read-only'
    })
    expect(remoteExports({...noInputs, oidcAudience: 'mbx-cache'})).toEqual({
      MBX_REMOTE_OIDC_AUDIENCE: 'mbx-cache'
    })
  })

  it('rejects an unknown mode and more than one credential', () => {
    expect(() => remoteExports({...noInputs, mode: 'readwrite'})).toThrow(/invalid remote-mode/)
    expect(() => remoteExports({...noInputs, token: 'secret', oidcAudience: 'mbx-cache'})).toThrow(
      /only one of token/
    )
  })

  it('accepts either spelling of an aliased input but not two different values', () => {
    expect(aliasedInput('remote-url', 'https://a', 'server-url', '')).toBe('https://a')
    expect(aliasedInput('remote-url', '', 'server-url', 'https://b')).toBe('https://b')
    expect(aliasedInput('remote-url', 'https://a', 'server-url', 'https://a')).toBe('https://a')
    expect(() => aliasedInput('remote-url', 'https://a', 'server-url', 'https://b')).toThrow(
      /set only remote-url/
    )
  })

  const doctor = (...checks: {severity: string; name: string; detail: string}[]) =>
    JSON.stringify({version: 1, checks, failures: 0, warnings: 0})

  it('reads a reachable remote from mbx doctor', () => {
    expect(
      remoteStatus(
        doctor(
          {severity: 'pass', name: 'config', detail: '10 GiB budget'},
          {severity: 'pass', name: 'policy', detail: 'configured read-write, effective read-only'},
          {severity: 'pass', name: 'remote', detail: 's3://bucket/cache/mbx (acme) is compatible'}
        )
      )
    ).toEqual({
      state: 'ready',
      detail: 's3://bucket/cache/mbx (acme) is compatible',
      policy: 'configured read-write, effective read-only'
    })
  })

  it('treats no configured URL as missing', () => {
    expect(
      remoteStatus(doctor({severity: 'pass', name: 'remote', detail: 'not configured; using the local cache'}))
        .state
    ).toBe('missing')
  })

  it('tells a failed connection apart from a configuration mbx refuses', () => {
    expect(
      remoteStatus(
        doctor({
          severity: 'fail',
          name: 'remote',
          detail: 'connection check failed: error sending request'
        })
      ).state
    ).toBe('unreachable')
    expect(
      remoteStatus(
        doctor({
          severity: 'fail',
          name: 'remote',
          detail: 'a remote cache namespace is required when a URL is set'
        })
      ).state
    ).toBe('invalid')
    expect(
      remoteStatus(doctor({severity: 'fail', name: 'config', detail: 'invalid remote.mode'}))
    ).toEqual({state: 'invalid', detail: 'invalid remote.mode'})
  })

  it('reports an unreadable doctor as unknown', () => {
    expect(remoteStatus('').state).toBe('unknown')
    expect(remoteStatus('{"version":1}').state).toBe('unknown')
    expect(remoteStatus(doctor({severity: 'pass', name: 'cargo', detail: 'cargo 1.99'})).state).toBe(
      'unknown'
    )
  })
})
