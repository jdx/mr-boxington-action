import {chmod, mkdtemp, mkdir, lstat, realpath, rm, symlink, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as core from '@actions/core'
import {getCacheVersion} from '../node_modules/@actions/cache/lib/internal/cacheUtils.js'
import {CompressionMethod} from '../node_modules/@actions/cache/lib/internal/constants.js'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {generatedKey, primaryCacheKey} from '../src/lib.js'
import {
  assertIsolatedObjectsActionStore,
  assertObjectsBundleAbsent,
  classifyCacheSaveFailure,
  cleanupIsolatedObjectsCachePost,
  createObjectsCachePaths,
  importObjectsBundle,
  measureTree,
  pathsFromObjectsCacheRoot,
  reportObjectsResourcePhase,
  saveIsolatedObjectsBundle,
  withIsolatedObjectsPostCleanup,
  withObjectsResourceSampler,
  validateObjectsBundle,
  validateObjectsCachePaths,
  withBoundedActionOutput
} from '../src/objects-cache.js'

const temporaryRoots: string[] = []

async function makeTemp(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mbx-objects-test-'))
  temporaryRoots.push(root)
  return root
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function chmodIfPresent(target: string, mode: number): Promise<void> {
  try {
    await chmod(target, mode)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return {promise, resolve}
}

function sampledMount(role: string, freeBytes: string, freeInodes: string) {
  return {identity: 'test-filesystem', roles: [role], freeBytes, freeInodes}
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

describe('isolated objects cache paths', () => {
  it('creates the exact private siblings beneath canonical RUNNER_TEMP', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const secondPaths = await createObjectsCachePaths(runnerTemp, 'directory')
    expect(paths.runnerTemp).toBe(await realpath(runnerTemp))
    expect(paths.root).toBe(path.join(paths.runnerTemp, path.basename(paths.root)))
    expect(paths.store).toBe(path.join(paths.root, 'store'))
    expect(paths.bundle).toBe(path.join(paths.runnerTemp, 'mbx-github-objects-bundle-v1'))
    expect(secondPaths.root).not.toBe(paths.root)
    expect(secondPaths.bundle).toBe(paths.bundle)
    expect(await pathExists(paths.store)).toBe(true)
    await expect(assertObjectsBundleAbsent(paths)).resolves.toBeUndefined()
    expect(() => assertIsolatedObjectsActionStore(paths, path.join(paths.store, 'actions'))).not.toThrow()
    expect(() => assertIsolatedObjectsActionStore(paths, path.join(runnerTemp, 'shared', 'actions'))).toThrow(
      /outside the private isolated cache store/
    )
  })

  it('keeps the cache archive version shared when primary suffixes differ', async () => {
    const runnerTemp = await makeTemp()
    const first = await createObjectsCachePaths(runnerTemp, 'directory')
    const second = await createObjectsCachePaths(runnerTemp, 'directory')
    const generated = generatedKey('linux', 'x64', 'objects-v1', 'rust-0123456789ab', 'abc123')
    const firstKey = primaryCacheKey('', 'matrix-a', generated)
    const secondKey = primaryCacheKey('', 'matrix-b', generated)
    expect(firstKey).not.toBe(secondKey)
    expect(first.bundle).toBe(second.bundle)
    expect(getCacheVersion([first.bundle], CompressionMethod.Gzip)).toBe(
      getCacheVersion([second.bundle], CompressionMethod.Gzip)
    )
  })

  it('rejects a root outside RUNNER_TEMP, overlapping paths, and symlinked bundle paths', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const outside = path.join(await makeTemp(), 'mbx-github-objects-outside')
    await mkdir(outside)
    await expect(
      pathsFromObjectsCacheRoot(runnerTemp, outside, 'directory')
    ).rejects.toThrow(/exact private RUNNER_TEMP layout/)
    await expect(validateObjectsCachePaths({...paths, store: paths.bundle})).rejects.toThrow(
      /exact private RUNNER_TEMP layout/
    )
    if (process.platform !== 'win32') {
      const outside = path.join(runnerTemp, 'outside')
      await mkdir(outside)
      await symlink(outside, paths.bundle, 'dir')
      await expect(validateObjectsBundle(paths)).rejects.toThrow(/must not be a symlink/)
    }
  })

  it('rejects symlinks inside a restored directory bundle', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    await mkdir(paths.bundle)
    await writeFile(path.join(paths.bundle, 'manifest.json'), '{}')
    if (process.platform !== 'win32') {
      await symlink(runnerTemp, path.join(paths.bundle, 'escape'), 'dir')
      await expect(validateObjectsBundle(paths)).rejects.toThrow(/contains a symlink/)
    }
  })

  it('caps wide tree walks while streaming entries and fails closed for bundle validation', async () => {
    const runnerTemp = await makeTemp()
    const tree = path.join(runnerTemp, 'wide-tree')
    await mkdir(tree)
    await Promise.all(
      Array.from({length: 5}, (_, index) => writeFile(path.join(tree, `entry-${index}`), 'x'))
    )
    const measured = await measureTree(tree, false, 3)
    expect(measured.complete).toBe(false)
    expect(measured.entriesScanned).toBeLessThanOrEqual(3)
    await expect(measureTree(tree, true, 3)).rejects.toThrow(/exceeds the 3 entry validation limit/)
  })

  it('measures a symlinked Cargo target through its real directory', async () => {
    if (process.platform === 'win32') return
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const actualTarget = path.join(runnerTemp, 'actual-target')
    const cargoTarget = path.join(runnerTemp, 'workspace-target')
    await mkdir(actualTarget)
    await writeFile(path.join(actualTarget, 'fingerprint'), 'target-data')
    await symlink(actualTarget, cargoTarget, 'dir')
    const events: string[] = []
    const cargo = await reportObjectsResourcePhase(paths, 'symlink-target-test', cargoTarget, event => {
      events.push(event)
    })
    expect(cargo?.files).toBe(1)
    expect(cargo?.apparentBytes).toBe(String(Buffer.byteLength('target-data')))
    expect(events[0]).toContain('"phase":"symlink-target-test"')
  })

  it('samples free space for a symlinked Cargo target on another filesystem', async () => {
    if (process.platform === 'win32') return
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const cargoTarget = path.join(runnerTemp, 'workspace-target')
    await symlink('/dev', cargoTarget, 'dir')
    const events: string[] = []
    await withObjectsResourceSampler(paths, cargoTarget, 'symlink-mount-test', async () => {}, event => {
      events.push(event)
    })
    const sampleEvent = events.find(event => event.startsWith('Objects cache sample '))
    if (!sampleEvent) throw new Error('resource sampler emitted no filesystem sample')
    const sample = JSON.parse(sampleEvent.slice('Objects cache sample '.length)) as {
      mounts: Array<{identity: string; roles: string[]; freeBytes: string; freeInodes: string}>
    }
    const runnerTempMount = sample.mounts.find(mount => mount.roles.includes('runnerTemp'))
    const cargoTargetMount = sample.mounts.find(mount => mount.roles.includes('cargoTarget'))
    expect(runnerTempMount).toBeDefined()
    expect(cargoTargetMount).toBeDefined()
    expect(cargoTargetMount?.identity).not.toBe(runnerTempMount?.identity)
    expect(cargoTargetMount?.freeBytes).toMatch(/^\d+$/)
    expect(cargoTargetMount?.freeInodes).toMatch(/^\d+$/)
  })

  it('awaits an active scan and a fresh final scan before emitting the resource summary', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const operationStarted = deferred<void>()
    const finishOperation = deferred<void>()
    const periodicScanStarted = deferred<void>()
    const finishPeriodicScan = deferred<void>()
    const finalScanStarted = deferred<void>()
    const finishFinalScan = deferred<void>()
    const events: string[] = []
    let mountCalls = 0
    let archiveCalls = 0

    vi.useFakeTimers()
    try {
      const run = withObjectsResourceSampler(
        paths,
        path.join(runnerTemp, 'workspace', 'target'),
        'deferred-scan-test',
        async () => {
          operationStarted.resolve(undefined)
          await finishOperation.promise
          return 'complete'
        },
        event => events.push(event),
        {
          intervalMs: 10,
          mountUsages: async () => {
            mountCalls++
            if (mountCalls === 2) {
              periodicScanStarted.resolve(undefined)
              await finishPeriodicScan.promise
              return [sampledMount('runnerTemp', '200', '20')]
            }
            if (mountCalls === 3) {
              finalScanStarted.resolve(undefined)
              await finishFinalScan.promise
              return [sampledMount('bundle', '100', '10')]
            }
            return [sampledMount('runnerTemp', '1000', '100')]
          },
          cacheArchiveFiles: async () => {
            archiveCalls++
            if (archiveCalls < 3) return {files: [], complete: true}
            const size = archiveCalls === 3 ? 64n : 256n
            return {
              files: [
                {
                  path: path.join(runnerTemp, 'cache-save', 'cache.tgz'),
                  size,
                  allocated: size,
                  mtimeMs: Number(size)
                }
              ],
              complete: true
            }
          }
        }
      )

      await operationStarted.promise
      await vi.advanceTimersByTimeAsync(10)
      await periodicScanStarted.promise
      finishOperation.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(events).toEqual([])

      finishPeriodicScan.resolve()
      await finalScanStarted.promise
      expect(events).toEqual([])

      finishFinalScan.resolve()
      const result = await run
      expect(result.result).toBe('complete')
      expect(result.archives).toMatchObject({
        observed: true,
        samples: 2,
        maxObservedApparentBytes: '256',
        maxObservedAllocatedBytes: '256'
      })
      expect(events).toHaveLength(1)
      const summary = JSON.parse(events[0]!.slice('Objects cache sample '.length)) as {
        sampleCount: number
        mounts: Array<{roles: string[]; freeBytes: string; freeInodes: string}>
        cacheArchiveStaging: {maxObservedApparentBytes: string | null}
      }
      expect(summary.sampleCount).toBe(3)
      expect(summary.mounts).toEqual([
        {identity: 'test-filesystem', roles: ['runnerTemp', 'bundle'], freeBytes: '100', freeInodes: '10'}
      ])
      expect(summary.cacheArchiveStaging.maxObservedApparentBytes).toBe('256')
    } finally {
      finishOperation.resolve(undefined)
      finishPeriodicScan.resolve(undefined)
      finishFinalScan.resolve(undefined)
      vi.useRealTimers()
    }
  })

  it('records sampler rejections, finishes final sampling, and preserves the operation error', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const operationStarted = deferred<void>()
    const periodicScanStarted = deferred<void>()
    const finishPeriodicScan = deferred<void>()
    const finalScanStarted = deferred<void>()
    const finishFinalScan = deferred<void>()
    const events: string[] = []
    const operationError = new Error('original operation failure')
    const diagnosticError = Object.assign(new Error('private path /secret/private'), {code: 'EIO'})
    let mountCalls = 0
    let archiveCalls = 0

    vi.useFakeTimers()
    try {
      const run = withObjectsResourceSampler(
        paths,
        path.join(runnerTemp, 'workspace', 'target'),
        'rejected-scan-test',
        async () => {
          operationStarted.resolve(undefined)
          await periodicScanStarted.promise
          throw operationError
        },
        event => events.push(event),
        {
          intervalMs: 10,
          mountUsages: async () => {
            mountCalls++
            if (mountCalls === 2) {
              periodicScanStarted.resolve(undefined)
              await finishPeriodicScan.promise
              throw diagnosticError
            }
            if (mountCalls === 3) {
              finalScanStarted.resolve(undefined)
              await finishFinalScan.promise
              return [sampledMount('bundle', '500', '50')]
            }
            return [sampledMount('runnerTemp', '1000', '100')]
          },
          cacheArchiveFiles: async () => {
            archiveCalls++
            return {files: [], complete: true}
          }
        }
      )
      const outcome = run.then(
        () => ({kind: 'resolved' as const}),
        error => ({kind: 'rejected' as const, error})
      )

      await operationStarted.promise
      await vi.advanceTimersByTimeAsync(10)
      await periodicScanStarted.promise
      await vi.advanceTimersByTimeAsync(0)
      expect(events).toEqual([])

      finishPeriodicScan.resolve(undefined)
      await finalScanStarted.promise
      expect(events).toEqual([])

      finishFinalScan.resolve(undefined)
      const settled = await outcome
      expect(settled.kind).toBe('rejected')
      if (settled.kind === 'rejected') expect(settled.error).toBe(operationError)
      expect(events).toHaveLength(1)
      const summaryText = events[0]!.slice('Objects cache sample '.length)
      expect(summaryText).not.toContain('/secret/private')
      const summary = JSON.parse(summaryText) as {
        sampleCount: number
        samplingFailures: {count: number; countCapped: boolean; firstReason: string | null}
        cacheArchiveStaging: {scanComplete: boolean; scanIncompleteReason: string | null}
        mounts: Array<{freeBytes: string; freeInodes: string}>
      }
      expect(summary.sampleCount).toBe(3)
      expect(summary.samplingFailures).toEqual({count: 1, countCapped: false, firstReason: 'code:EIO'})
      expect(summary.cacheArchiveStaging).toMatchObject({
        scanComplete: false,
        scanIncompleteReason: 'resource-sample-failed'
      })
      expect(summary.mounts).toEqual([
        {identity: 'test-filesystem', roles: ['runnerTemp', 'bundle'], freeBytes: '500', freeInodes: '50'}
      ])
      expect(archiveCalls).toBe(3)
    } finally {
      finishPeriodicScan.resolve(undefined)
      finishFinalScan.resolve(undefined)
      vi.useRealTimers()
    }
  })

  it('includes BSD tar staging files in sampled cache archive accounting', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const cacheTemp = path.join(runnerTemp, 'cache-save-staging')
    const operationReady = deferred<void>()
    const finishOperation = deferred<void>()
    const periodicMountStarted = deferred<void>()
    const finishPeriodicMount = deferred<void>()
    const events: string[] = []
    const tarBytes = Buffer.alloc(41, 0x7a)
    let mountCalls = 0

    vi.useFakeTimers()
    try {
      const run = withObjectsResourceSampler(
        paths,
        path.join(runnerTemp, 'workspace', 'target'),
        'bsd-tar-staging-test',
        async () => {
          await mkdir(cacheTemp)
          await writeFile(path.join(cacheTemp, 'cache.tar'), tarBytes)
          operationReady.resolve(undefined)
          await finishOperation.promise
          return 'saved'
        },
        event => events.push(event),
        {
          intervalMs: 10,
          mountUsages: async () => {
            mountCalls++
            if (mountCalls === 2) {
              periodicMountStarted.resolve(undefined)
              await finishPeriodicMount.promise
            }
            return []
          }
        }
      )

      await operationReady.promise
      await vi.advanceTimersByTimeAsync(10)
      await periodicMountStarted.promise
      finishOperation.resolve(undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(events).toEqual([])

      finishPeriodicMount.resolve(undefined)
      const result = await run
      expect(result.result).toBe('saved')
      expect(result.archives).toMatchObject({
        observed: true,
        maxObservedApparentBytes: String(tarBytes.byteLength)
      })
      expect(events).toHaveLength(1)
      const summary = JSON.parse(events[0]!.slice('Objects cache sample '.length)) as {
        cacheArchiveStaging: {observed: boolean; maxObservedApparentBytes: string | null}
      }
      expect(summary.cacheArchiveStaging).toMatchObject({
        observed: true,
        maxObservedApparentBytes: String(tarBytes.byteLength)
      })
    } finally {
      finishOperation.resolve(undefined)
      finishPeriodicMount.resolve(undefined)
      vi.useRealTimers()
    }
  })

  it('cleans the validated private root after successful and failed post operations', async () => {
    const runnerTemp = await makeTemp()
    const successPaths = await createObjectsCachePaths(runnerTemp, 'directory')
    await mkdir(path.join(successPaths.store, 'actions'), {recursive: true})
    await writeFile(path.join(successPaths.store, 'actions', 'store-object'), 'store')
    await mkdir(successPaths.bundle)
    await writeFile(path.join(successPaths.bundle, 'manifest.json'), '{}')
    const order: string[] = []
    const result = await withIsolatedObjectsPostCleanup(
      successPaths,
      async () => {
        order.push('post-operation')
        expect(await pathExists(successPaths.store)).toBe(true)
        expect(await pathExists(successPaths.bundle)).toBe(true)
        return 'saved'
      },
      () => order.push('warning')
    )
    order.push('post-cleanup')
    expect(result).toBe('saved')
    expect(order).toEqual(['post-operation', 'post-cleanup'])
    expect(await pathExists(successPaths.root)).toBe(false)
    expect(await pathExists(successPaths.store)).toBe(false)
    expect(await pathExists(successPaths.bundle)).toBe(false)

    const failurePaths = await createObjectsCachePaths(runnerTemp, 'directory')
    await mkdir(path.join(failurePaths.store, 'actions'), {recursive: true})
    await mkdir(failurePaths.bundle)
    await writeFile(path.join(failurePaths.bundle, 'partial'), 'export')
    const primaryError = new Error('actions/cache local staging failed')
    await expect(
      withIsolatedObjectsPostCleanup(
        failurePaths,
        async () => {
          throw primaryError
        },
        () => {}
      )
    ).rejects.toBe(primaryError)
    expect(await pathExists(failurePaths.root)).toBe(false)
    expect(await pathExists(failurePaths.bundle)).toBe(false)
  })

  it('preserves the post failure when unsafe paths prevent cleanup', async () => {
    if (process.platform === 'win32') return
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const outside = path.join(runnerTemp, 'outside')
    await mkdir(outside)
    await symlink(outside, paths.bundle, 'dir')
    const primaryError = new Error('export validation failed')
    const warnings: string[] = []
    await expect(
      withIsolatedObjectsPostCleanup(
        paths,
        async () => {
          throw primaryError
        },
        message => warnings.push(message)
      )
    ).rejects.toBe(primaryError)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Could not remove isolated mbx cache after post failure/)
    expect(await pathExists(paths.root)).toBe(true)
  })

  it('removes immutable MBX out-dir trees without following nested symlinks', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const storeOutDirs = path.join(paths.store, 'out-dirs')
    const storeVersionDir = path.join(storeOutDirs, 'v1')
    const storeHashDir = path.join(paths.store, 'out-dirs', 'v1', 'digest')
    const storeFile = path.join(storeHashDir, 'private.rs')
    const bundleOutDirs = path.join(paths.bundle, 'out-dirs')
    const bundleVersionDir = path.join(bundleOutDirs, 'v1')
    const bundleHashDir = path.join(paths.bundle, 'out-dirs', 'v1', 'digest')
    const bundleFile = path.join(bundleHashDir, 'private.rs')
    const outside = path.join(runnerTemp, 'outside')
    const outsideFile = path.join(outside, 'keep')
    await mkdir(storeHashDir, {recursive: true})
    await writeFile(storeFile, 'store output')
    await mkdir(bundleHashDir, {recursive: true})
    await writeFile(bundleFile, 'bundle output')
    await mkdir(outside)
    await writeFile(outsideFile, 'external')
    if (process.platform !== 'win32') {
      await symlink(outside, path.join(storeHashDir, 'external'), 'dir')
      await chmod(outside, 0o555)
    }
    await chmod(storeFile, 0o444)
    await chmod(storeOutDirs, 0o555)
    await chmod(storeVersionDir, 0o555)
    await chmod(storeHashDir, 0o555)
    await chmod(bundleFile, 0o444)
    await chmod(bundleOutDirs, 0o555)
    await chmod(bundleVersionDir, 0o555)
    await chmod(bundleHashDir, 0o555)

    try {
      await cleanupIsolatedObjectsCachePost(paths)
      expect(await pathExists(paths.root)).toBe(false)
      expect(await pathExists(outsideFile)).toBe(true)
      if (process.platform !== 'win32') {
        expect((await lstat(outside)).mode & 0o777).toBe(0o555)
      }
    } finally {
      await chmodIfPresent(storeOutDirs, 0o700)
      await chmodIfPresent(storeVersionDir, 0o700)
      await chmodIfPresent(storeHashDir, 0o700)
      await chmodIfPresent(storeFile, 0o600)
      await chmodIfPresent(bundleOutDirs, 0o700)
      await chmodIfPresent(bundleVersionDir, 0o700)
      await chmodIfPresent(bundleHashDir, 0o700)
      await chmodIfPresent(bundleFile, 0o600)
      await chmodIfPresent(outside, 0o700)
    }
  })

  it('imports a valid bundle and removes it only after import succeeds', async () => {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    await mkdir(paths.bundle)
    await writeFile(path.join(paths.bundle, 'manifest.json'), '{"objects":1}')
    const order: string[] = []
    await importObjectsBundle(paths, async bundle => {
      order.push('import')
      expect(bundle).toBe(paths.bundle)
      expect(await pathExists(bundle)).toBe(true)
    })
    order.push('removed')
    expect(order).toEqual(['import', 'removed'])
    expect(await pathExists(paths.bundle)).toBe(false)

    await mkdir(paths.bundle)
    await writeFile(path.join(paths.bundle, 'manifest.json'), '{"objects":1}')
    await expect(importObjectsBundle(paths, async () => { throw new Error('corrupt bundle') })).rejects.toThrow(
      /corrupt bundle/
    )
    expect(await pathExists(paths.bundle)).toBe(true)
  })
})

describe('isolated objects bundle save lifecycle', () => {
  async function setup() {
    const runnerTemp = await makeTemp()
    const paths = await createObjectsCachePaths(runnerTemp, 'directory')
    const cargoTarget = path.join(runnerTemp, 'workspace', 'target')
    await mkdir(cargoTarget, {recursive: true})
    await writeFile(path.join(cargoTarget, 'fingerprint'), 'target-data')
    await mkdir(path.join(paths.store, 'actions'), {recursive: true})
    await writeFile(path.join(paths.store, 'actions', 'object'), 'store-data')
    return {paths, cargoTarget}
  }

  it('exports, validates, removes the isolated store, then saves only the external bundle', async () => {
    const {paths, cargoTarget} = await setup()
    const order: string[] = []
    const events: string[] = []
    const originalMode = process.env.ACTIONS_CACHE_SERVICE_V2
    delete process.env.ACTIONS_CACHE_SERVICE_V2
    try {
      const result = await saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        prepareExport: async () => {
          order.push('clean-target')
          await rm(cargoTarget, {recursive: true, force: true})
        },
        exportBundle: async bundle => {
          order.push('export')
          expect(bundle).toBe(paths.bundle)
          expect(await pathExists(bundle)).toBe(false)
          expect(await pathExists(cargoTarget)).toBe(false)
          await mkdir(bundle)
          await writeFile(path.join(bundle, 'manifest.json'), '{"objects":1}')
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: output => /no completed builds/i.test(output),
        saveCache: async (cachePaths, key) => {
          order.push('save')
          expect(key).toBe('generated-key')
          expect(cachePaths).toEqual([paths.bundle])
          expect(await pathExists(paths.store)).toBe(false)
          core.info('Cache saved successfully')
          return 17
        },
        emit: message => events.push(message),
        warn: message => events.push(`warning: ${message}`)
      })
      expect(result).toBe('saved')
      expect(order).toEqual(['clean-target', 'export', 'save'])
      expect(await pathExists(paths.bundle)).toBe(false)
      expect(await pathExists(paths.store)).toBe(false)
      expect(events.some(event => event.includes('after-build-before-export'))).toBe(true)
      expect(events.some(event => event.includes('after-export-preparation'))).toBe(true)
      expect(events.some(event => event.includes('after-bundle-export'))).toBe(true)
      expect(events.some(event => event.includes('after-store-removal'))).toBe(true)
      expect(events.some(event => event.includes('actions-cache-save'))).toBe(true)
      expect(events.some(event => event.includes('after-cache-save'))).toBe(true)
      expect(events.some(event => event.includes('bundleApparentBytes'))).toBe(true)
      expect(events.some(event => event.includes('not instantaneous peak pressure'))).toBe(true)
      expect(events.some(event => event.includes('maxObservedIntervalMs'))).toBe(true)
    } finally {
      if (originalMode === undefined) delete process.env.ACTIONS_CACHE_SERVICE_V2
      else process.env.ACTIONS_CACHE_SERVICE_V2 = originalMode
    }
  })

  it('does not save an empty export or remove the live store', async () => {
    const {paths, cargoTarget} = await setup()
    let saveCalls = 0
    const result = await saveIsolatedObjectsBundle({
      paths,
      primaryKey: 'generated-key',
      saveEligible: true,
      exactHit: false,
      cargoTarget,
      exportBundle: async () => ({exitCode: 1, output: 'no completed builds for this group'}),
      isEmptyExport: output => /no completed builds/i.test(output),
      saveCache: async () => {
        saveCalls++
        return 1
      },
      emit: () => {},
      warn: () => {}
    })
    expect(result).toBe('empty')
    expect(saveCalls).toBe(0)
    expect(await pathExists(paths.store)).toBe(true)
  })

  it('fails on export errors and leaves the isolated store intact', async () => {
    const {paths, cargoTarget} = await setup()
    let saveCalls = 0
    await expect(
      saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        exportBundle: async () => ({exitCode: 2, output: 'corrupt receipt'}),
        isEmptyExport: () => false,
        saveCache: async () => {
          saveCalls++
          return 1
        },
        emit: () => {},
        warn: () => {}
      })
    ).rejects.toThrow(/export exited with code 2/)
    expect(saveCalls).toBe(0)
    expect(await pathExists(paths.store)).toBe(true)
  })

  it('does not export when target cleanup fails', async () => {
    const {paths, cargoTarget} = await setup()
    let exportCalls = 0
    await expect(
      saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        prepareExport: async () => {
          throw new Error('target cleanup failed')
        },
        exportBundle: async () => {
          exportCalls++
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: () => false,
        saveCache: async () => 1,
        emit: () => {},
        warn: () => {}
      })
    ).rejects.toThrow(/target cleanup failed/)
    expect(exportCalls).toBe(0)
    expect(await pathExists(paths.store)).toBe(true)
  })

  it('warns and continues on the cache service reservation result', async () => {
    const {paths, cargoTarget} = await setup()
    const warnings: string[] = []
    const result = await saveIsolatedObjectsBundle({
      paths,
      primaryKey: 'generated-key',
      saveEligible: true,
      exactHit: false,
      cargoTarget,
      exportBundle: async bundle => {
        await mkdir(bundle)
        await writeFile(path.join(bundle, 'manifest.json'), '{}')
        return {exitCode: 0, output: ''}
      },
      isEmptyExport: () => false,
      saveCache: async () => {
        // @actions/cache 6.2.0 logs ReserveCacheError through core.info. This
        // exercises the exact plain stdout bytes captured around saveCache.
        core.info(
          'Failed to save: Unable to reserve cache with key generated-key, another job may be creating this cache.'
        )
        return -1
      },
      emit: () => {},
      warn: message => warnings.push(message)
    })
    expect(result).toBe('save-unavailable')
    expect(warnings).toEqual(['GitHub cache save skipped after classified service-reservation'])
    expect(await pathExists(paths.store)).toBe(false)
    expect(await pathExists(paths.bundle)).toBe(false)
  })

  it('warns and continues on the V2 terminal finalization contention result', async () => {
    const {paths, cargoTarget} = await setup()
    const warnings: string[] = []
    const result = await saveIsolatedObjectsBundle({
      paths,
      primaryKey: 'generated-key',
      saveEligible: true,
      exactHit: false,
      cargoTarget,
      exportBundle: async bundle => {
        await mkdir(bundle)
        await writeFile(path.join(bundle, 'manifest.json'), '{}')
        return {exitCode: 0, output: ''}
      },
      isEmptyExport: () => false,
      saveCache: async () => {
        core.warning(
          'Unable to finalize cache with key generated-key, another job may be finalizing this cache.'
        )
        return 17
      },
      emit: () => {},
      warn: message => warnings.push(message)
    })
    expect(result).toBe('save-unavailable')
    expect(warnings).toEqual(['GitHub cache save skipped after classified service-reservation'])
    expect(await pathExists(paths.bundle)).toBe(false)
  })

  it('keeps an intermediate SDK ENOSPC warning nonfatal after a successful save', async () => {
    const {paths, cargoTarget} = await setup()
    const result = await saveIsolatedObjectsBundle({
      paths,
      primaryKey: 'generated-key',
      saveEligible: true,
      exactHit: false,
      cargoTarget,
      exportBundle: async bundle => {
        await mkdir(bundle)
        await writeFile(path.join(bundle, 'manifest.json'), '{}')
        return {exitCode: 0, output: ''}
      },
      isEmptyExport: () => false,
      saveCache: async () => {
        core.warning('uploadCacheArchiveSDK: internal error uploading cache archive: ENOSPC')
        core.info('Cache saved successfully')
        return 17
      },
      emit: () => {},
      warn: () => {}
    })
    expect(result).toBe('saved')
    expect(await pathExists(paths.bundle)).toBe(false)
  })

  it('fails on ENOSPC from local actions/cache staging', async () => {
    const {paths, cargoTarget} = await setup()
    await expect(
      saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        exportBundle: async bundle => {
          await mkdir(bundle)
          await writeFile(path.join(bundle, 'manifest.json'), '{}')
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: () => false,
        saveCache: async () => {
          core.warning('Failed to save: tar failed: No space left on device (os error 28)')
          return -1
        },
        emit: () => {},
        warn: () => {}
      })
    ).rejects.toThrow(/runner storage is full/)
    expect(await pathExists(paths.store)).toBe(false)
    expect(await pathExists(paths.bundle)).toBe(true)
  })

  it('keeps a structured ENOSPC save error hard without relying on logged text', async () => {
    const {paths, cargoTarget} = await setup()
    const noSpaceError = Object.assign(new Error('archive staging failed'), {code: 'ENOSPC'})
    await expect(
      saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        exportBundle: async bundle => {
          await mkdir(bundle)
          await writeFile(path.join(bundle, 'manifest.json'), '{}')
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: () => false,
        saveCache: async () => {
          throw noSpaceError
        },
        emit: () => {},
        warn: () => {}
      })
    ).rejects.toBe(noSpaceError)
    expect(await pathExists(paths.bundle)).toBe(true)
  })

  it.each([
    ['ineligible policy', false, false, 'ineligible'],
    ['exact cache hit', true, true, 'exact-hit']
  ] as const)('preserves %s by skipping export and save', async (_name, saveEligible, exactHit, expected) => {
    const {paths, cargoTarget} = await setup()
    let exportCalls = 0
    let saveCalls = 0
    let prepareCalls = 0
    const result = await saveIsolatedObjectsBundle({
      paths,
      primaryKey: 'generated-key',
      saveEligible,
      exactHit,
      cargoTarget,
      prepareExport: async () => {
        prepareCalls++
      },
      exportBundle: async () => {
        exportCalls++
        return {exitCode: 0, output: ''}
      },
      isEmptyExport: () => false,
      saveCache: async () => {
        saveCalls++
        return 1
      },
      emit: () => {},
      warn: () => {}
    })
    expect(result).toBe(expected)
    expect(exportCalls).toBe(0)
    expect(saveCalls).toBe(0)
    expect(prepareCalls).toBe(0)
    expect(await pathExists(paths.store)).toBe(true)
  })

  it('fails closed for unknown save results and ENOSPC, but warns on terminal transport failures', async () => {
    const captureWarning = async (message: string) =>
      (await withBoundedActionOutput(async () => core.warning(message))).output
    const captureError = async (message: string) =>
      (await withBoundedActionOutput(async () => core.error(message))).output
    const v1CommitFailure = await captureWarning(
      'Failed to save: commitCache failed: Cache service responded with 503'
    )
    expect(v1CommitFailure).toBe(
      '::warning::Failed to save: commitCache failed: Cache service responded with 503\n'
    )
    expect(classifyCacheSaveFailure(v1CommitFailure)).toBe('service-5xx')

    const v2FinalizeFailure = await captureWarning(
      'Failed to save: Failed to FinalizeCacheEntryUpload: Failed to make request after 5 attempts: Failed request: (503) Service Unavailable'
    )
    expect(v2FinalizeFailure).toBe(
      '::warning::Failed to save: Failed to FinalizeCacheEntryUpload: Failed to make request after 5 attempts: Failed request: (503) Service Unavailable\n'
    )
    expect(classifyCacheSaveFailure(v2FinalizeFailure)).toBe('service-5xx')

    const v2FinalizeHttpError = await captureError(
      'Failed to save: Failed to FinalizeCacheEntryUpload: Failed to make request after 5 attempts: Failed request: (503) Service Unavailable'
    )
    expect(v2FinalizeHttpError).toBe(
      '::error::Failed to save: Failed to FinalizeCacheEntryUpload: Failed to make request after 5 attempts: Failed request: (503) Service Unavailable\n'
    )
    expect(classifyCacheSaveFailure(v2FinalizeHttpError)).toBe('service-5xx')

    const uploadStatusFailure = (
      await withBoundedActionOutput(async () => {
        core.warning(
          'uploadCacheArchiveSDK: internal error uploading cache archive: uploadCacheArchiveSDK: upload failed with status code 503'
        )
        core.warning('Failed to save: uploadCacheArchiveSDK: upload failed with status code 503')
      })
    ).output
    expect(uploadStatusFailure).toBe(
      '::warning::uploadCacheArchiveSDK: internal error uploading cache archive: uploadCacheArchiveSDK: upload failed with status code 503\n' +
        '::warning::Failed to save: uploadCacheArchiveSDK: upload failed with status code 503\n'
    )
    expect(classifyCacheSaveFailure(uploadStatusFailure)).toBe('service-5xx')
    const uploadStatusAttemptOnly = await captureWarning(
      'uploadCacheArchiveSDK: internal error uploading cache archive: uploadCacheArchiveSDK: upload failed with status code 503'
    )
    expect(classifyCacheSaveFailure(uploadStatusAttemptOnly)).toBe('unknown')

    const uploadStatusHttpError = await captureError(
      'Failed to save: uploadCacheArchiveSDK: upload failed with status code 503'
    )
    expect(classifyCacheSaveFailure(uploadStatusHttpError)).toBe('service-5xx')

    const v2FinalizeTransport = await captureWarning(
      'Failed to save: Failed to FinalizeCacheEntryUpload: Unable to make request: ETIMEDOUT\n' +
        'If you are using self-hosted runners, please make sure your runner has access to all GitHub endpoints: https://docs.github.com/en/actions/hosting-your-own-runners/managing-your-own-runners#communication-between-self-hosted-runners-and-github'
    )
    expect(v2FinalizeTransport).toContain(
      '::warning::Failed to save: Failed to FinalizeCacheEntryUpload: Unable to make request: ETIMEDOUT%0A'
    )
    expect(classifyCacheSaveFailure(v2FinalizeTransport)).toBe('network-transport')

    const uploadTransport = (
      await withBoundedActionOutput(async () => {
        core.warning(
          'uploadCacheArchiveSDK: internal error uploading cache archive: RestError: connect ETIMEDOUT 10.0.0.1:443'
        )
        core.warning('Failed to save: RestError: connect ETIMEDOUT 10.0.0.1:443')
      })
    ).output
    expect(uploadTransport).toContain(
      '::warning::uploadCacheArchiveSDK: internal error uploading cache archive: RestError: connect ETIMEDOUT 10.0.0.1:443\n'
    )
    expect(uploadTransport).toContain(
      '::warning::Failed to save: RestError: connect ETIMEDOUT 10.0.0.1:443\n'
    )
    expect(classifyCacheSaveFailure(uploadTransport)).toBe('network-transport')
    const uploadTransportHttpError = await captureError(
      'Failed to save: RestError: connect ETIMEDOUT 10.0.0.1:443'
    )
    expect(classifyCacheSaveFailure(uploadTransportHttpError)).toBe('network-transport')
    const uploadTransportAttemptOnly = await captureWarning(
      'uploadCacheArchiveSDK: internal error uploading cache archive: RestError: connect ETIMEDOUT 10.0.0.1:443'
    )
    expect(classifyCacheSaveFailure(uploadTransportAttemptOnly)).toBe('unknown')

    const v2Retry = (
      await withBoundedActionOutput(async () =>
        core.info(
          'Attempt 1 of 5 failed with error: Failed request: (503) Service Unavailable. Retrying request in 3456 ms...'
        )
      )
    ).output
    expect(classifyCacheSaveFailure(v2Retry)).toBe('unknown')
    expect(
      classifyCacheSaveFailure(
        'Failed to save: Unable to reserve cache with key key, another job may be creating this cache.\n'
      )
    ).toBe('service-reservation')
    expect(
      classifyCacheSaveFailure(
        'Failed to save: Unable to reserve cache with key key, another job may be creating this cache. More details: already reserved\n'
      )
    ).toBe('service-reservation')
    const v2FinalizeContention = await captureWarning(
      'Failed to save: Unable to finalize cache with key generated-key, another job may be finalizing this cache.'
    )
    expect(v2FinalizeContention).toBe(
      '::warning::Failed to save: Unable to finalize cache with key generated-key, another job may be finalizing this cache.\n'
    )
    expect(classifyCacheSaveFailure(v2FinalizeContention)).toBe('service-reservation')
    const bareV2FinalizeContention = await captureWarning(
      'Unable to finalize cache with key generated-key, another job may be finalizing this cache.'
    )
    expect(bareV2FinalizeContention).toBe(
      '::warning::Unable to finalize cache with key generated-key, another job may be finalizing this cache.\n'
    )
    expect(classifyCacheSaveFailure(bareV2FinalizeContention)).toBe('service-reservation')
    expect(classifyCacheSaveFailure(await captureWarning('cache entry not found'))).toBe(
      'unknown'
    )

    const terminalNoSpace = await captureWarning(
      'Failed to save: tar failed: No space left on device (os error 28)'
    )
    expect(classifyCacheSaveFailure(terminalNoSpace)).toBe('local-storage')
    const intermediateNoSpace = await captureWarning(
      'uploadCacheArchiveSDK: internal error uploading cache archive: write failed: ENOSPC'
    )
    expect(classifyCacheSaveFailure(intermediateNoSpace)).toBe('unknown')
    expect(
      classifyCacheSaveFailure(
        'Failed to save: Unable to reserve cache with key X, another job may be creating this cache\n'
      )
    ).toBe('unknown')
    const policyDenial = await captureWarning(
      'Failed to save: Unable to reserve cache with key key. More details: cache write denied: read only'
    )
    expect(classifyCacheSaveFailure(policyDenial)).toBe('unknown')
  })

  it('accepts V2 save IDs only with the V2 service and fails closed on V1 reservation IDs', async () => {
    const {paths, cargoTarget} = await setup()
    const originalV2 = process.env.ACTIONS_CACHE_SERVICE_V2
    const originalServer = process.env.GITHUB_SERVER_URL
    process.env.ACTIONS_CACHE_SERVICE_V2 = 'true'
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    try {
      const result = await saveIsolatedObjectsBundle({
        paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget,
        exportBundle: async bundle => {
          await mkdir(bundle)
          await writeFile(path.join(bundle, 'manifest.json'), '{}')
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: () => false,
        saveCache: async () => 23,
        emit: () => {},
        warn: () => {}
      })
      expect(result).toBe('saved')
    } finally {
      if (originalV2 === undefined) delete process.env.ACTIONS_CACHE_SERVICE_V2
      else process.env.ACTIONS_CACHE_SERVICE_V2 = originalV2
      if (originalServer === undefined) delete process.env.GITHUB_SERVER_URL
      else process.env.GITHUB_SERVER_URL = originalServer
    }

    const second = await setup()
    delete process.env.ACTIONS_CACHE_SERVICE_V2
    await expect(
      saveIsolatedObjectsBundle({
        paths: second.paths,
        primaryKey: 'generated-key',
        saveEligible: true,
        exactHit: false,
        cargoTarget: second.cargoTarget,
        exportBundle: async bundle => {
          await mkdir(bundle)
          await writeFile(path.join(bundle, 'manifest.json'), '{}')
          return {exitCode: 0, output: ''}
        },
        isEmptyExport: () => false,
        saveCache: async () => 23,
        emit: () => {},
        warn: () => {}
      })
    ).rejects.toThrow(/did not provide evidence/)
  })
})
