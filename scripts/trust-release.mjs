#!/usr/bin/env node

import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const EXPECTED_ASSETS = [
  'mbx-aarch64-apple-darwin.tar.gz',
  'mbx-aarch64-unknown-linux-musl.tar.gz',
  'mbx-x86_64-apple-darwin.tar.gz',
  'mbx-x86_64-pc-windows-msvc.zip',
  'mbx-x86_64-unknown-linux-musl.tar.gz'
]

const [version, checksumPath] = process.argv.slice(2)
if (!version || !checksumPath) {
  throw new Error('usage: npm run trust-release -- <version> <SHA256SUMS>')
}
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`invalid mbx version ${JSON.stringify(version)}`)
}

const checksums = {}
for (const line of (await readFile(checksumPath, 'utf8')).trim().split('\n')) {
  const match = line.match(/^([0-9a-f]{64}) [ *](\S+)$/)
  if (!match) throw new Error(`invalid SHA256SUMS line: ${JSON.stringify(line)}`)
  const [, digest, name] = match
  if (name in checksums) throw new Error(`duplicate checksum for ${name}`)
  checksums[name] = digest
}

const names = Object.keys(checksums).sort()
if (JSON.stringify(names) !== JSON.stringify(EXPECTED_ASSETS)) {
  throw new Error(`release assets differ from the expected set: ${names.join(', ')}`)
}
const releaseDigests = Object.fromEntries(
  EXPECTED_ASSETS.map(name => [name, checksums[name]])
)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trustPath = path.join(root, 'src', 'trusted-release-digests.json')
const trusted = JSON.parse(await readFile(trustPath, 'utf8'))
if (version in trusted && JSON.stringify(trusted[version]) !== JSON.stringify(releaseDigests)) {
  throw new Error(`refusing to replace trusted checksums for mbx ${version}`)
}
trusted[version] = releaseDigests
await writeFile(trustPath, `${JSON.stringify(trusted, null, 2)}\n`)
