import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {context} from '@actions/github'
import * as tc from '@actions/tool-cache'
import {createHash} from 'node:crypto'
import {chmod, mkdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {
  callingCard,
  type CallingCardRow,
  generatedKey,
  generatedRestoreKey,
  normalizedVersion,
  parseBackend,
  releaseTarget,
  shouldSave,
  trustedReleaseAsset,
  verifiedReleaseAsset,
  type GithubRelease,
  type VerifiedReleaseAsset
} from './lib.js'

const POST_STATE = 'mbx-post'
const CACHE_DIR_STATE = 'mbx-cache-dir'
const CACHE_KEY_STATE = 'mbx-cache-key'
const CACHE_HIT_STATE = 'mbx-cache-hit'
const MBX_STATE = 'mbx-bin'
const MAX_SIZE_STATE = 'mbx-max-size'

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

async function resolveRelease(
  requested: string,
  archiveName: string
): Promise<VerifiedReleaseAsset> {
  if (requested !== 'latest') {
    const trusted = trustedReleaseAsset(requested, archiveName)
    if (trusted) return trusted
  }
  const endpoint =
    requested === 'latest'
      ? 'https://api.github.com/repos/jdx/mr-boxington/releases/latest'
      : `https://api.github.com/repos/jdx/mr-boxington/releases/tags/v${encodeURIComponent(requested)}`
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'error'
  })
  if (!response.ok) {
    throw new Error(`could not resolve mbx ${requested}: GitHub returned ${response.status}`)
  }
  return verifiedReleaseAsset((await response.json()) as GithubRelease, requested, archiveName)
}

async function installMbx(requested: string): Promise<{bin: string; version: string}> {
  const requestedVersion = normalizedVersion(requested)
  const target = releaseTarget(process.platform, process.arch)
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveName = `mbx-${target}.${extension}`
  const {version, sha256} = await resolveRelease(requestedVersion, archiveName)
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
  const installedVersion = rawVersion.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0]
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
  const installed = await installMbx(core.getInput('version'))
  core.info(`Installed mbx ${installed.version}`)
  core.setOutput('mbx-version', installed.version)
  core.saveState(POST_STATE, backend)
  core.saveState(MBX_STATE, installed.bin)
  core.saveState(MAX_SIZE_STATE, core.getInput('max-size'))

  if (backend === 'server') {
    configureServer()
    await leaveCallingCard('I have made the necessary arrangements.', [
      {label: 'mbx', value: installed.version},
      {label: 'Backend', value: 'cache server'},
      {label: 'Mode', value: core.getInput('server-mode')}
    ])
    return
  }

  const cacheDir = await capture(installed.bin, ['cache', 'dir'])
  await mkdir(cacheDir, {recursive: true})
  const generation = core.getInput('cache-generation')
  const sha = context.payload.pull_request?.base.sha ?? context.sha
  const primaryKey =
    core.getInput('cache-key') || generatedKey(process.platform, process.arch, generation, sha)
  const restoreKeys = core.getMultilineInput('restore-keys').filter(Boolean)
  if (restoreKeys.length === 0) {
    restoreKeys.push(generatedRestoreKey(process.platform, process.arch, generation))
  }
  const restoredKey = await cache.restoreCache([cacheDir], primaryKey, restoreKeys)
  const hit = restoredKey === primaryKey
  core.setOutput('cache-hit', hit ? 'true' : 'false')
  core.setOutput('cache-primary-key', primaryKey)
  core.info(restoredKey ? `Restored mbx cache from ${restoredKey}` : 'No mbx cache found')

  core.saveState(CACHE_DIR_STATE, cacheDir)
  core.saveState(CACHE_KEY_STATE, primaryKey)
  core.saveState(CACHE_HIT_STATE, hit ? 'true' : 'false')
  const defaultBranch = (context.payload.repository as {default_branch?: string} | undefined)
    ?.default_branch
  const save = shouldSave(context.eventName, context.ref, defaultBranch)
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
    {label: 'Cache', value: cacheResult},
    {label: 'Policy', value: save ? 'save after a successful job' : 'restore only'}
  ])
}

async function post(): Promise<void> {
  if (core.getState(POST_STATE) !== 'github-save') return
  const primaryKey = core.getState(CACHE_KEY_STATE)
  if (core.getState(CACHE_HIT_STATE) === 'true') {
    core.info(`Exact cache ${primaryKey} already exists; not saving it again`)
    return
  }
  const maxSize = core.getState(MAX_SIZE_STATE)
  if (maxSize) await exec.exec(core.getState(MBX_STATE), ['gc', '--max-size', maxSize])
  const cacheId = await cache.saveCache([core.getState(CACHE_DIR_STATE)], primaryKey)
  core.info(`Saved mbx cache ${primaryKey} (ID ${cacheId})`)
}

const isPost = Boolean(core.getState(POST_STATE))
;(isPost ? post() : main()).catch(error => core.setFailed(error instanceof Error ? error : String(error)))
