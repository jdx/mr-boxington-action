import {spawnSync} from 'node:child_process'
import {readFileSync, rmSync} from 'node:fs'
import path from 'node:path'

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
const runnerTemp = process.env.RUNNER_TEMP
const exportGroup = process.env.MBX_CACHE_EXPORT_GROUP
if (!runnerTemp) throw new Error('RUNNER_TEMP is not set')
if (!exportGroup) throw new Error('the action did not export MBX_CACHE_EXPORT_GROUP')

const fixture = path.join(workspace, '.github', 'e2e', 'fixture', 'Cargo.toml')
const fixtureTarget = path.join(path.dirname(fixture), 'target')
const bundle = path.join(runnerTemp, 'mbx-e2e-cache.tar')
const importedCache = path.join(runnerTemp, 'mbx-e2e-imported-cache')
const importedTargets = path.join(runnerTemp, 'mbx-e2e-imported-targets')
const report = path.join(runnerTemp, 'mbx-e2e-warm.json')

function run(args, env = process.env) {
  const result = spawnSync('mbx', args, {env, stdio: 'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`mbx ${args.join(' ')} exited with ${result.status}`)
  }
}

// Populate the action-configured store and its job-scoped build receipt.
rmSync(fixtureTarget, {force: true, recursive: true})
run(['build', '--locked', '--manifest-path', fixture])
run(['cache', 'export', '--group', exportGroup, bundle])
rmSync(fixtureTarget, {force: true, recursive: true})

// Import into an entirely separate store and build into an empty managed
// target. A hit here proves the archive is sufficient on a fresh runner; a
// successful Cargo no-op in the original target would prove much less.
const isolatedEnv = {
  ...process.env,
  MBX_CACHE_DIR: importedCache,
  MBX_TARGET_ROOT: importedTargets,
  MBX_STATS_REPORT: report
}
run(['cache', 'import', bundle], isolatedEnv)
run(['build', '--locked', '--manifest-path', fixture], isolatedEnv)

const stats = JSON.parse(readFileSync(report, 'utf8'))
if (!Number.isInteger(stats.hits) || stats.hits < 1) {
  throw new Error(`imported closure produced no cache hit: ${JSON.stringify(stats)}`)
}
console.log(`Imported closure produced ${stats.hits} cache hit(s)`)
