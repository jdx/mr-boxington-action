import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {context} from '@actions/github'
import * as tc from '@actions/tool-cache'
import {createHash, randomUUID} from 'node:crypto'
import {access, chmod, copyFile, mkdir, readFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {homedir} from 'node:os'
import path from 'node:path'
import {
  cacheLinksValue,
  cacheRevision,
  canReuseCachedMbx,
  callingCard,
  type CallingCardRow,
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
  verifiedReleaseAsset,
  type GithubRelease,
  type VerifiedReleaseAsset
} from './lib.js'
import {
  dehydrateMbxShimBinaries,
  hasReusableCargoTarget,
  hydrateMbxShimBinaries,
  pruneCargoTargetCache
} from './target-cache.js'

const POST_STATE = 'mbx-post'
const CACHE_KEY_STATE = 'mbx-cache-key'
const CACHE_HIT_STATE = 'mbx-cache-hit'
const CACHE_ARCHIVE_STATE = 'mbx-cache-archive'
const CACHE_EXPORT_GROUP_STATE = 'mbx-cache-export-group'
const CACHE_PATHS_STATE = 'mbx-cache-paths'
const MBX_STATE = 'mbx-bin'
const CACHE_ARCHIVE_NAME = 'github-actions-cache-v1.tar'
const TARGET_TOOL_DIRECTORY = 'mbx-target-tool'

interface MbxInstallation {
  bin: string
  version: string
}

async function leaveCallingCard(note: string, rows: CallingCardRow[]): Promise<void> {
  try {
    await core.summary
      .addDetails(
        '📦 <strong>Mr Boxington inspected the premises.</strong>',
        callingCard(note, rows)
      )
      .write()
  } catch (error) {
    core.debug(`Could not write Mr Boxington's run summary: ${String(error)}`)
  }
}

async function capture(command: string, args: string[]): Promise<string> {
  let output = ''
  const exitCode = await exec.exec(command, args, {
    silent: true,
    listeners: {stdout: data => (output += data.toString())}
  })
  if (exitCode !== 0) throw new Error(`${command} exited with code ${exitCode}`)
  return output.trim()
}

/**
 * The verbose rustc identity, or null when the toolchain cannot be probed.
 *
 * `toolchain` is the empty string unless the caller named one, in which case
 * that toolchain is asked rather than whichever one `rustc` on `PATH` resolves
 * to.
 */
async function rustcIdentity(toolchain: string): Promise<string | null> {
  try {
    return await capture('rustc', rustcIdentityArgs(toolchain))
  } catch (error) {
    core.debug(`rustc identity probe failed: ${String(error)}`)
    return null
  }
}

async function resolveRelease(
  requested: string,
  archiveName: string,
  githubToken: string
): Promise<VerifiedReleaseAsset> {
  const endpoint =
    requested === 'latest'
      ? 'https://api.github.com/repos/jdx/mr-boxington/releases/latest'
      : `https://api.github.com/repos/jdx/mr-boxington/releases/tags/v${encodeURIComponent(requested)}`
  const response = await fetch(endpoint, {
    headers: githubApiHeaders(githubToken),
    redirect: 'error'
  })
  if (!response.ok) {
    throw new Error(`could not resolve mbx ${requested}: GitHub returned ${response.status}`)
  }
  return verifiedReleaseAsset((await response.json()) as GithubRelease, requested, archiveName)
}

async function installMbx(
  requested: string,
  githubToken: string
): Promise<MbxInstallation> {
  const requestedVersion = normalizedVersion(requested)
  const target = releaseTarget(process.platform, process.arch)
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveName = `mbx-${target}.${extension}`
  const {version, sha256} = await resolveRelease(requestedVersion, archiveName, githubToken)
  const toolName = `mbx-${sha256}`
  const found = tc.find(toolName, version)
  if (found) {
    core.addPath(found)
    return {bin: path.join(found, process.platform === 'win32' ? 'mbx.exe' : 'mbx'), version}
  }

  const base = `https://github.com/jdx/mr-boxington/releases/download/v${version}`
  const archive = await tc.downloadTool(`${base}/${archiveName}`)
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (actual !== sha256) throw new Error(`checksum mismatch for ${archiveName}`)

  const extracted =
    process.platform === 'win32' ? await tc.extractZip(archive) : await tc.extractTar(archive)
  const extractedBin = path.join(extracted, process.platform === 'win32' ? 'mbx.exe' : 'mbx')
  if (process.platform !== 'win32') await chmod(extractedBin, 0o755)
  const rawVersion = await capture(extractedBin, ['--version'])
  const installedVersion = parsedMbxVersion(rawVersion)
  if (!installedVersion) throw new Error(`could not parse mbx version from ${JSON.stringify(rawVersion)}`)
  if (installedVersion !== version) {
    throw new Error(`mbx archive for ${version} contains version ${installedVersion}`)
  }
  const toolDir = await tc.cacheDir(extracted, toolName, installedVersion)
  core.addPath(toolDir)
  return {
    bin: path.join(toolDir, process.platform === 'win32' ? 'mbx.exe' : 'mbx'),
    version: installedVersion
  }
}

async function mbxOnPath(): Promise<MbxInstallation | undefined> {
  try {
    const names =
      process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(extension => `mbx${extension}`)
        : ['mbx']
    let bin = ''
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      for (const name of names) {
        const candidate = path.resolve(directory, name)
        try {
          await access(candidate, constants.X_OK)
          bin = candidate
          break
        } catch {}
      }
      if (bin) break
    }
    if (!bin) throw new Error('mbx was not found on PATH')
    const rawVersion = await capture(bin, ['--version'])
    const version = parsedMbxVersion(rawVersion)
    if (!version) throw new Error(`could not parse mbx version from ${JSON.stringify(rawVersion)}`)
    return {bin, version}
  } catch (error) {
    core.debug(`mbx PATH probe failed: ${String(error)}`)
    return undefined
  }
}

async function setupMbx(
  requested: string,
  githubToken: string,
  cachedDirectory = ''
): Promise<MbxInstallation> {
  const found = requested ? undefined : await mbxOnPath()
  const release = mbxReleaseToInstall(requested, Boolean(found))
  if (!release && found) {
    core.info(`Using mbx ${found.version} from PATH`)
    return found
  }
  if (cachedDirectory && release && release !== 'latest') {
    const cached = path.join(cachedDirectory, process.platform === 'win32' ? 'mbx.exe' : 'mbx')
    try {
      await access(cached, constants.X_OK)
      const version = parsedMbxVersion(await capture(cached, ['--version']))
      if (version && canReuseCachedMbx(release, version)) {
        core.info(`Using mbx ${version} from the restored target cache`)
        core.addPath(cachedDirectory)
        return {bin: cached, version}
      }
      core.debug(`Ignoring cached mbx ${version ?? 'with an unknown version'}; ${release} was requested`)
    } catch (error) {
      core.debug(`Cached mbx probe failed: ${String(error)}`)
    }
  }
  return installMbx(release ?? 'latest', githubToken)
}

async function stageTargetCacheMbx(
  installed: MbxInstallation,
  directory: string
): Promise<MbxInstallation> {
  const bin = path.join(directory, process.platform === 'win32' ? 'mbx.exe' : 'mbx')
  if (path.resolve(installed.bin) !== path.resolve(bin)) {
    await mkdir(directory, {recursive: true})
    await copyFile(installed.bin, bin)
    if (process.platform !== 'win32') await chmod(bin, 0o755)
  }
  core.addPath(directory)
  return {...installed, bin}
}

function configureServer(): void {
  const url = core.getInput('server-url', {required: true})
  const namespace = core.getInput('namespace', {required: true})
  const token = core.getInput('token')
  const tokenFile = core.getInput('token-file')
  const audience = core.getInput('oidc-audience')
  const mode = core.getInput('server-mode')
  if (!['read-write', 'read-only', 'write-only'].includes(mode)) {
    throw new Error(`invalid server-mode ${JSON.stringify(mode)}`)
  }
  if ([token, tokenFile, audience].filter(Boolean).length > 1) {
    throw new Error('set only one of token, token-file, or oidc-audience')
  }
  core.exportVariable('MBX_REMOTE_URL', url)
  core.exportVariable('MBX_REMOTE_NAMESPACE', namespace)
  core.exportVariable('MBX_REMOTE_MODE', mode)
  if (token) {
    core.setSecret(token)
    core.exportVariable('MBX_REMOTE_TOKEN', token)
  }
  if (tokenFile) core.exportVariable('MBX_REMOTE_TOKEN_FILE', tokenFile)
  if (audience) core.exportVariable('MBX_REMOTE_OIDC_AUDIENCE', audience)
}

async function main(): Promise<void> {
  const backend = parseBackend(core.getInput('backend'))
  const githubCacheMode = parseGithubCacheMode(core.getInput('github-cache-mode'))
  const targetCache = backend === 'github' && githubCacheMode === 'target'
  if (backend === 'github') requireGithubCacheRuntime()
  const githubToken = githubTokenValue(core.getInput('github-token'))
  if (githubToken) core.setSecret(githubToken)
  let installed = targetCache ? undefined : await setupMbx(core.getInput('version'), githubToken)
  const cacheLinks =
    targetCache
      ? '0'
      : cacheLinksValue(core.getInput('cache-links'), process.platform)
  if (cacheLinks !== undefined) core.exportVariable('MBX_CACHE_LINKS', cacheLinks)

  if (backend === 'local') {
    if (!installed) throw new Error('mbx setup did not complete')
    core.info(`Set up mbx ${installed.version}`)
    core.setOutput('mbx-version', installed.version)
    core.saveState(POST_STATE, backend)
    core.saveState(MBX_STATE, installed.bin)
    core.exportVariable('MBX_REMOTE_URL', '')
    const cacheDir = await capture(installed.bin, ['cache', 'dir'])
    await mkdir(cacheDir, {recursive: true})
    await leaveCallingCard('Everything is being kept on the premises.', [
      {label: 'mbx', value: installed.version},
      {label: 'Backend', value: 'local filesystem'},
      {label: 'Cache', value: cacheDir}
    ])
    return
  }

  if (backend === 'server') {
    if (!installed) throw new Error('mbx setup did not complete')
    core.info(`Set up mbx ${installed.version}`)
    core.setOutput('mbx-version', installed.version)
    core.saveState(POST_STATE, backend)
    core.saveState(MBX_STATE, installed.bin)
    configureServer()
    await leaveCallingCard('I have made the necessary arrangements.', [
      {label: 'mbx', value: installed.version},
      {label: 'Backend', value: 'cache server'},
      {label: 'Mode', value: core.getInput('server-mode')}
    ])
    return
  }

  let cacheArchive = ''
  if (githubCacheMode === 'objects') {
    if (!installed) throw new Error('mbx setup did not complete')
    const cacheDir = await capture(installed.bin, ['cache', 'dir'])
    await mkdir(cacheDir, {recursive: true})
    cacheArchive = path.join(cacheDir, CACHE_ARCHIVE_NAME)
  }
  const exportGroup =
    githubCacheMode === 'objects'
      ? `github-actions-${context.runId}-${context.runAttempt}-${randomUUID()}`
      : ''
  if (exportGroup) core.exportVariable('MBX_CACHE_EXPORT_GROUP', exportGroup)
  if (githubCacheMode === 'target') {
    core.exportVariable('MBX_REMOTE_URL', '')
    core.exportVariable('MBX_TARGET_VIEWS', '0')
  }
  const generation = githubCacheGeneration(core.getInput('cache-generation'), githubCacheMode)
  const requestedToolchain = core.getInput('toolchain')
  const toolchain = toolchainSegment(await rustcIdentity(requestedToolchain))
  if (toolchain === 'norust') {
    // A named toolchain that will not answer is a louder failure than no Rust
    // at all: the caller has said which compiler the build uses, and keying the
    // store as if it had none puts it back in the shared bucket the input was
    // reached for to escape.
    if (requestedToolchain) {
      core.warning(
        `Could not ask the ${requestedToolchain} toolchain for its identity; the generated ` +
          'cache key carries none. Install that toolchain before this action.'
      )
    } else {
      core.info(
        'No rustc found on PATH; the generated cache key carries no toolchain identity. ' +
          'Install the Rust toolchain before this action so a toolchain update starts a fresh cache.'
      )
    }
  }
  const saveOnWorkflowDispatch = core.getBooleanInput('save-on-workflow-dispatch')
  const sha = cacheRevision(
    context.eventName,
    context.payload.pull_request?.base.sha ?? context.sha,
    saveOnWorkflowDispatch,
    context.runId,
    context.runAttempt
  )
  const primaryKey =
    core.getInput('cache-key') ||
    generatedKey(process.platform, process.arch, generation, toolchain, sha)
  const restoreKeys = core.getMultilineInput('restore-keys').filter(Boolean)
  if (restoreKeys.length === 0) {
    restoreKeys.push(generatedRestoreKey(process.platform, process.arch, generation, toolchain))
  }
  const cargoHome = process.env.CARGO_HOME || path.join(homedir(), '.cargo')
  const targetToolDirectory = path.join(
    process.env.RUNNER_TEMP || path.join(homedir(), '.cache'),
    TARGET_TOOL_DIRECTORY
  )
  const targetPaths = [
    path.resolve('target'),
    path.join(cargoHome, 'registry'),
    path.join(cargoHome, 'git'),
    targetToolDirectory
  ]
  const cachePaths = githubCacheMode === 'target' ? targetPaths : [cacheArchive]
  const restoredKey = await cache.restoreCache(cachePaths, primaryKey, restoreKeys)
  if (targetCache) {
    installed = await stageTargetCacheMbx(
      await setupMbx(core.getInput('version'), githubToken, targetToolDirectory),
      targetToolDirectory
    )
  }
  if (!installed) throw new Error('mbx setup did not complete')
  core.info(`Set up mbx ${installed.version}`)
  core.setOutput('mbx-version', installed.version)
  core.saveState(POST_STATE, backend)
  core.saveState(MBX_STATE, installed.bin)
  if (restoredKey && githubCacheMode === 'objects') {
    await exec.exec(installed.bin, ['cache', 'import', cacheArchive])
  } else if (restoredKey && githubCacheMode === 'target') {
    const hydrated = await hydrateMbxShimBinaries(path.resolve('target'), installed.bin)
    if (hydrated > 0) core.info(`Restored ${hydrated} shared mbx build-script shim binaries`)
  }
  const hit = restoredKey === primaryKey
  core.setOutput('cache-hit', hit ? 'true' : 'false')
  core.setOutput('cache-primary-key', primaryKey)
  core.info(restoredKey ? `Restored mbx cache from ${restoredKey}` : 'No mbx cache found')

  core.saveState(CACHE_ARCHIVE_STATE, cacheArchive)
  core.saveState(CACHE_EXPORT_GROUP_STATE, exportGroup)
  core.saveState(CACHE_PATHS_STATE, JSON.stringify(cachePaths))
  core.saveState(CACHE_KEY_STATE, primaryKey)
  core.saveState(CACHE_HIT_STATE, hit ? 'true' : 'false')
  const defaultBranch = (context.payload.repository as {default_branch?: string} | undefined)
    ?.default_branch
  const save = shouldSave(
    context.eventName,
    context.ref,
    defaultBranch,
    saveOnWorkflowDispatch
  )
  core.saveState(
    POST_STATE,
    save ? 'github-save' : 'github-restore-only'
  )
  const cacheResult = hit ? 'exact hit' : restoredKey ? 'warm start' : 'miss'
  const note = hit
    ? 'Just as I left it.'
    : restoredKey
      ? 'Not precisely what I ordered, but quite serviceable.'
      : 'The cupboard was bare. How stimulating.'
  await leaveCallingCard(note, [
    {label: 'mbx', value: installed.version},
    {label: 'Backend', value: 'GitHub Actions cache'},
    {label: 'Payload', value: githubCacheMode === 'target' ? 'Cargo target tree' : 'mbx objects'},
    {label: 'Cache', value: cacheResult},
    {label: 'Policy', value: save ? 'save after a successful job' : 'restore only'}
  ])
}

async function post(): Promise<void> {
  const postState = core.getState(POST_STATE)
  if (postState !== 'github-save') return
  const primaryKey = core.getState(CACHE_KEY_STATE)
  if (core.getState(CACHE_HIT_STATE) === 'true') {
    core.info(`Exact cache ${primaryKey} already exists; not saving it again`)
    return
  }
  const mbx = core.getState(MBX_STATE)
  const archive = core.getState(CACHE_ARCHIVE_STATE)
  const group = core.getState(CACHE_EXPORT_GROUP_STATE)
  const paths = JSON.parse(core.getState(CACHE_PATHS_STATE)) as string[]
  if (!group) {
    if (!(await hasReusableCargoTarget(path.resolve('target')))) {
      core.info('No reusable Cargo target state was produced; not saving a registry-only cache')
      return
    }
    const metadata = await capture('cargo', ['metadata', '--format-version', '1'])
    const cargoHome = process.env.CARGO_HOME || path.join(homedir(), '.cargo')
    await pruneCargoTargetCache(path.resolve('target'), cargoHome, metadata)
    const dehydrated = await dehydrateMbxShimBinaries(path.resolve('target'))
    if (dehydrated > 0) core.info(`Omitted ${dehydrated} shared mbx build-script shim binaries`)
    const cacheId = await cache.saveCache(paths, primaryKey)
    core.info(`Saved mbx target cache ${primaryKey} (ID ${cacheId})`)
    return
  }
  let output = ''
  const exportExitCode = await exec.exec(mbx, ['cache', 'export', '--group', group, archive], {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => (output += data.toString()),
      stderr: data => (output += data.toString())
    }
  })
  if (exportExitCode !== 0) {
    if (isEmptyExport(output)) {
      core.info('No completed mbx build was recorded; not saving an empty cache')
      return
    }
    throw new Error(`mbx cache export exited with code ${exportExitCode}`)
  }
  const cacheId = await cache.saveCache([archive], primaryKey)
  core.info(`Saved mbx cache ${primaryKey} (ID ${cacheId})`)
}

const isPost = Boolean(core.getState(POST_STATE))
;(isPost ? post() : main()).catch(error => core.setFailed(error instanceof Error ? error : String(error)))
