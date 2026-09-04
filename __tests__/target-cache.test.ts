import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  cargoKeepSets,
  dehydrateMbxShimBinaries,
  hasReusableCargoTarget,
  hydrateMbxShimBinaries,
  matchesCargoEntry,
  pruneCargoTargetCache
} from '../src/target-cache.js'

const metadata = JSON.stringify({
  packages: [
    {
      name: 'my-package',
      targets: [{name: 'my_lib'}, {name: 'helper-bin'}]
    },
    {name: 'serde', targets: [{name: 'serde'}]}
  ]
})

describe('target cache pruning', () => {
  it('derives Cargo artifact names from packages and targets', () => {
    const keep = cargoKeepSets(metadata)
    expect(keep.packages).toContain('my-package')
    expect(keep.packages).toContain('my_package')
    expect(keep.packages).toContain('helper_bin')
    expect(keep.dependencies).toContain('libmy_package')
    expect(keep.registry).toEqual(new Set(['my-package', 'serde']))
    expect(matchesCargoEntry('libmy_package-0123.rlib', keep.dependencies)).toBe(true)
    expect(matchesCargoEntry('libunrelated-0123.rlib', keep.dependencies)).toBe(false)
  })

  it('keeps reusable Cargo state and removes final products and unused sparse entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mbx-target-cache-'))
    const target = path.join(root, 'target')
    const cargoHome = path.join(root, 'cargo')
    const profile = path.join(target, 'debug')
    const sparse = path.join(cargoHome, 'registry', 'index', 'index.test')

    for (const directory of [
      path.join(profile, 'build'),
      path.join(profile, '.fingerprint'),
      path.join(profile, 'deps'),
      path.join(profile, '.mbx-build-script-shims', 'identity'),
      path.join(sparse, '.cache', 'se', 'rd')
    ]) {
      await mkdir(directory, {recursive: true})
    }
    const files: Record<string, string> = {
      'target/CACHEDIR.TAG': 'tag',
      'target/debug/my-package': 'final binary',
      'target/debug/build/my-package-abcd/output': 'build state',
      'target/debug/build/unrelated-abcd/output': 'unused',
      'target/debug/.fingerprint/my-package-abcd': 'fingerprint',
      'target/debug/.fingerprint/unrelated-abcd': 'unused',
      'target/debug/deps/libmy_package-abcd.rlib': 'dependency',
      'target/debug/deps/libunrelated-abcd.rlib': 'unused',
      'target/debug/.mbx-build-script-shims/identity/mbx': 'shim',
      'cargo/registry/index/index.test/config.json': 'config',
      'cargo/registry/index/index.test/.cache/se/rd/serde': 'serde index',
      'cargo/registry/index/index.test/.cache/un/us/unused': 'unused index'
    }
    for (const [relative, contents] of Object.entries(files)) {
      const file = path.join(root, relative)
      await mkdir(path.dirname(file), {recursive: true})
      await writeFile(file, contents)
    }

    await pruneCargoTargetCache(target, cargoHome, metadata)

    await expect(readFile(path.join(target, 'CACHEDIR.TAG'), 'utf8')).resolves.toBe('tag')
    await expect(
      readFile(path.join(profile, 'build', 'my-package-abcd', 'output'), 'utf8')
    ).resolves.toBe('build state')
    await expect(
      readFile(path.join(profile, '.mbx-build-script-shims', 'identity', 'mbx'), 'utf8')
    ).resolves.toBe('shim')
    await expect(readFile(path.join(profile, 'my-package'), 'utf8')).rejects.toThrow()
    await expect(
      readFile(path.join(profile, 'deps', 'libunrelated-abcd.rlib'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(path.join(sparse, '.cache', 'se', 'rd', 'serde'), 'utf8')
    ).resolves.toBe('serde index')
    await expect(
      readFile(path.join(sparse, '.cache', 'un', 'us', 'unused'), 'utf8')
    ).rejects.toThrow()
    await expect(readFile(path.join(sparse, 'config.json'), 'utf8')).resolves.toBe('config')
    await expect(hasReusableCargoTarget(target)).resolves.toBe(true)
  })

  it('distinguishes an empty target from reusable Cargo state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mbx-empty-target-'))
    await expect(hasReusableCargoTarget(path.join(root, 'missing'))).resolves.toBe(false)
    await mkdir(path.join(root, 'target', 'debug', '.fingerprint'), {recursive: true})
    await expect(hasReusableCargoTarget(path.join(root, 'target'))).resolves.toBe(false)
    await writeFile(path.join(root, 'target', 'debug', '.fingerprint', 'crate-hash'), 'state')
    await expect(hasReusableCargoTarget(path.join(root, 'target'))).resolves.toBe(true)
  })

  it('omits and restores shared mbx shim binaries around transport', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mbx-target-shims-'))
    const target = path.join(root, 'target')
    const mbxName = process.platform === 'win32' ? 'mbx.exe' : 'mbx'
    const source = path.join(root, mbxName)
    const shim = path.join(target, 'debug', '.mbx-build-script-shims', 'identity', mbxName)
    await mkdir(path.dirname(shim), {recursive: true})
    await writeFile(source, 'current mbx')
    await writeFile(shim, 'cached mbx')

    await expect(dehydrateMbxShimBinaries(target)).resolves.toBe(1)
    await expect(readFile(shim, 'utf8')).rejects.toThrow()
    await expect(hydrateMbxShimBinaries(target, source)).resolves.toBe(1)
    await expect(readFile(shim, 'utf8')).resolves.toBe('current mbx')
    await writeFile(shim, 'stale mbx')
    await expect(hydrateMbxShimBinaries(target, source)).resolves.toBe(1)
    await expect(readFile(shim, 'utf8')).resolves.toBe('current mbx')
  })

  it('omits legacy copied build-script shims but preserves tiny launchers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mbx-target-legacy-shims-'))
    const target = path.join(root, 'target')
    const source = path.join(root, process.platform === 'win32' ? 'mbx.exe' : 'mbx')
    const legacy = path.join(target, 'debug', 'build', 'legacy-hash', 'build-script-build')
    const launcher = path.join(target, 'debug', 'build', 'current-hash', 'build-script-build')
    for (const shim of [legacy, launcher]) {
      await mkdir(path.dirname(shim), {recursive: true})
      await writeFile(`${shim}.mbx-real`, 'compiled build script')
    }
    await writeFile(source, 'current mbx')
    await writeFile(legacy, 'copied mbx executable')
    await writeFile(launcher, '#!/bin/sh\nexec mbx "$@"\n')

    await expect(dehydrateMbxShimBinaries(target)).resolves.toBe(1)
    await expect(readFile(legacy, 'utf8')).rejects.toThrow()
    await expect(readFile(launcher, 'utf8')).resolves.toMatch(/^#!\/bin\/sh/)
    await expect(hydrateMbxShimBinaries(target, source)).resolves.toBe(1)
    await expect(readFile(legacy, 'utf8')).resolves.toBe('current mbx')
    await expect(readFile(launcher, 'utf8')).resolves.toMatch(/^#!\/bin\/sh/)
  })
})
