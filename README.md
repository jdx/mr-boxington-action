# mr-boxington-action

Set up [mr boxington](https://github.com/jdx/mr-boxington) and use its local
store directly or back it with GitHub Actions cache, an mbx-compatible server, or an S3
bucket. When
`version` is omitted, the action uses `mbx` from `PATH` and downloads the latest
release only when it is absent. Setting `version` always installs that release.

## Local filesystem

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: jdx/mr-boxington-action@v1
    with:
      backend: local
  - run: mbx test --workspace
```

The local backend installs or reuses mbx and leaves its store on the filesystem without
configuring a remote transport or an upload/download phase. This is useful on
persistent runners and with volume actions that mount mbx's cache directory.

## GitHub Actions cache

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7
  - uses: jdx/mr-boxington-action@v1
  - run: mbx test --workspace
```

The default backend restores Cargo's pruned target directory and registry from
the previous compatible build on every run, so a job that changes a few files
recompiles only those crates. It saves a new immutable entry for pushes to the
repository's default branch. Pull requests and other branches are
restore-only unless opted in below, and fork pull requests are always
restore-only.

The action disables mbx-managed target views and native-link object caching so
it can transport the in-place `target` tree without also transporting mbx's
object cache. The post step removes final products and unrelated Cargo state
before saving, while retaining fingerprints, dependencies, build-script state,
and the registry. Full mbx executables used by build-script shims, including
legacy hard-linked copies, are omitted from transport and rehydrated from the
installed mbx after restore; tiny launchers and Cargo freshness timestamps
remain intact. When `version` pins an exact release, the archive also carries
one mbx executable so later warm jobs avoid a separate release download.

The earlier `objects` payload is still available for workflows whose builds
must share across differing target directories or checkout layouts:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    github-cache-mode: objects
- run: mbx test --workspace
```

That mode imports the restored bundle before any build steps and exports the
deduplicated closure of every completed `mbx` command in the job afterward,
assigning a unique `MBX_CACHE_EXPORT_GROUP` automatically. Its entries are
smaller because they omit the Cargo registry, which Cargo then downloads again
inside the build; in paired measurements on GitHub-hosted runners it restored
and built a small edit roughly ten seconds slower than the `target` payload.

From mbx 1.12.0 the bundle is a directory instead of a tar. `actions/cache`
archives whatever path it is given, so a tar meant every byte was written twice
on restore: once when the cache action unpacked its own archive, and again when
the importer unpacked the tar inside it. The importer now reads the restored
tree in place. On a warm restore of a 4,071-object closure this took
`mbx cache import` from 6.5s to 2.0s, against roughly 1.3s more spent inside
the cache action's own restore, which handles many files less quickly than one
archive. Earlier mbx versions keep the tar form. The two use separate cache
keys, so the first job after an mbx version crosses 1.12.0 restores cold.

On GitHub-hosted runners, `objects` mode sets `MBX_GC_AUTO=0` for the job unless
that environment variable is already set. This prevents mbx's local disk budget
from immediately evicting a large restored bundle. The cache can grow during
the job; set `MBX_GC_AUTO=1` in the job's environment to keep automatic cleanup.
Self-hosted and unrecognized runners retain their existing GC policy. For a
disposable self-hosted runner, set `MBX_GC_AUTO=0` in the job's environment to
opt into the same behavior.

The generated cache key includes the identity of the `rustc` on `PATH`
(a hash of `rustc -vV`, the same identity Swatinem/rust-cache keys on). mbx
keys every cached compilation on the compiler, so a store built by one
toolchain matches nothing under another; scoping the key keeps each toolchain
on its own cache instead of restoring one that can no longer produce hits—
which otherwise happens whenever a runner image updates its preinstalled Rust.
Install your toolchain **before** this action so the key sees the compiler the
build will use; without a `rustc` on `PATH` the segment is the literal
`norust`.

A build that names its toolchain on its own command line is the one case the
probe cannot see: `mbx +1.91 check` compiles with 1.91 while `rustc` on `PATH`
still reports the default, so the 1.91 store lands under the default
toolchain's key and the two share an entry. Name it with `toolchain` and the
key follows it:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    toolchain: "1.91"
- run: mbx +1.91 check --workspace
```

`toolchain` scopes the cache key only — it neither installs the toolchain nor
selects it for the build.

On Linux, the action also enables mbx's native link cache. This avoids relinking
eligible test binaries and executables on a warm build. Set `cache-links: false`
to opt out, or `cache-links: true` to opt in explicitly on another supported
platform.

The action accepts a resolved version only when GitHub reports that release as
immutable and supplies an asset digest. Release metadata requests use
`GITHUB_TOKEN` when set and otherwise use the `github-token` input; either requires
`contents: read` permission.

Change `cache-generation` when a cache-format or policy change should start
fresh:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    version: 0.3.0
    cache-generation: v2
```

When the Cargo workspace is not at the checkout root, point `working-directory`
at it so the `target` payload caches that workspace's `target/` and prunes it
against its own `cargo metadata`:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    working-directory: rust
- run: mbx test --workspace
  working-directory: rust
```

`cache-key` and newline-separated `restore-keys` are available when the default
`${platform}-${architecture}-mbx-${generation}-${toolchain}-${commit}` layout
is not enough.

### Saving beyond the default branch

By default each pull request restores the default branch's baseline and throws away what it compiled, so the next revision of that pull request compiles it again. Three inputs opt other trusted runs into saving:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    save-on-pull-request: true
    save-on-protected-branch: true
```

- `save-on-pull-request` saves successful `pull_request` runs whose head branch is in the same repository. GitHub scopes a pull request's cache entries to its merge ref (`refs/pull/<number>/merge`), so they are restored only by later runs of that pull request, never by the default branch, sibling pull requests, or other branches. Each saving run writes a new key. It restores the pull request's own latest entry when there is one, preferring one saved on the same base commit, and otherwise the base branch's latest entry, so `cache-hit` is `false` on these runs. Fork pull requests, `pull_request_target` runs, and the `closed` run of a merged pull request (which GitHub reports on the branch it merged into) never save.
- `save-on-protected-branch` saves successful pushes to any non-default branch that has branch protection or rulesets (`GITHUB_REF_PROTECTED`), the same rule mbx applies when it decides whether a run may write to a cache server. Later pushes to that branch and pull requests that target it restore those entries.
- `save-on-workflow-dispatch` saves successful `workflow_dispatch` runs; see [Inputs](#inputs).

Every saved entry counts against the repository's cache storage limit (10 GB by default), and GitHub evicts the least recently used entries once it is exceeded. Pull requests that save a large `target` tree on every revision can push the default branch's baseline out; deleting a pull request's entries when it closes with `gh cache delete --all --ref refs/pull/<number>/merge` keeps that in check.

A job whose `cache-mode` does not permit writes (`read` or `none`, set in the workflow or by GitHub's default for the trigger) never saves, whatever these inputs say.

An explicit `cache-key` is used as given, so saving pull requests and dispatches do not get a fresh key per run. With a constant `cache-key`, the second revision restores the first one's entry as an exact hit and skips its save. Give the key a per-run suffix and a matching restore prefix:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    save-on-pull-request: true
    cache-key: my-build-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}
    restore-keys: my-build-
```

To keep one workflow's entries apart from another's, changing `cache-generation` is simpler and keeps the generated keys.

The `cache-save-eligible` and `cache-save-reason` outputs say whether a run may attempt a save and why, for example `same-repository pull request` or `fork pull request`. An eligible run still skips the save after an exact cache hit or when the job produced nothing to cache.

## Remote cache

The `remote` backend points mbx at a cache server or an `s3://` bucket. With a
cache server and OIDC:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v7
  - uses: jdx/mr-boxington-action@v1
    with:
      backend: remote
      remote-url: https://cache.example.com
      namespace: acme/backend
      oidc-audience: mbx-cache
  - run: mbx build --workspace --all-features
```

Or pass a secret bearer token:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    backend: remote
    remote-url: https://cache.example.com
    namespace: acme/backend
    token: ${{ secrets.MBX_REMOTE_TOKEN }}
```

An S3 bucket authenticates with the `AWS_*` variables instead, which
`aws-actions/configure-aws-credentials` exports:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v7
  - uses: aws-actions/configure-aws-credentials@v6
    with:
      role-to-assume: arn:aws:iam::123456789012:role/mbx-cache
      aws-region: us-east-1
  - uses: jdx/mr-boxington-action@v1
    with:
      backend: remote
      remote-url: s3://acme-build-cache/mbx
      namespace: acme/backend
  - run: mbx build --workspace --all-features
```

Each input the backend receives is exported as the matching `MBX_REMOTE_*`
variable. A setting without an input keeps the value an earlier step exported,
so a step that already configured mbx's remote needs no inputs repeated here:

```yaml
- run: |
    echo "MBX_REMOTE_URL=s3://acme-build-cache/mbx" >> "$GITHUB_ENV"
    echo "MBX_REMOTE_NAMESPACE=acme/backend" >> "$GITHUB_ENV"
- uses: jdx/mr-boxington-action@v1
  with:
    backend: remote
```

After exporting, the action runs `mbx doctor` and fails the step when mbx finds
no remote URL in its inputs, the environment, or mbx's user config file, or
when mbx rejects the configuration, for example a URL without a namespace. A
remote that is configured but cannot be reached only produces a warning.

mbx itself writes to the remote only from pushes to protected branches. Every
other run, including pull requests, tags, and releases, reads only, and a
`write-only` remote is left unused. The server or bucket policy must still
enforce its own authorization, and a release build that must not read from a
shared cache should not configure a remote at all.

`server` is an alias for `remote`, and `server-url` and `server-mode` are
aliases for `remote-url` and `remote-mode`.

## Inputs

| Input                       | Default               | Purpose                                                                        |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `backend`                   | `github`              | `local`, `github`, or `remote`                                                 |
| `version`                   |                       | mbx release version, or `latest`; when omitted, prefer `mbx` from `PATH`       |
| `github-token`              | `${{ github.token }}` | Token used when `GITHUB_TOKEN` is not exported                                 |
| `cache-generation`          | `v1`                  | Generated GitHub cache key generation                                          |
| `github-cache-mode`         | `target`              | GitHub payload: warm Cargo `target` tree or portable mbx `objects`             |
| `save-on-workflow-dispatch` | `false`               | Save after a successful trusted `workflow_dispatch` run                        |
| `save-on-pull-request`      | `false`               | Save after a successful same-repository pull request, scoped to it             |
| `save-on-protected-branch`  | `false`               | Save after a successful push to a protected non-default branch                 |
| `toolchain`                 |                       | Toolchain the build names, such as `1.91` or `+1.91`; the cache key follows it |
| `working-directory`         | `.`                   | Cargo workspace whose `target/` the `target` payload caches                    |
| `cache-links`               | `auto`                | Cache native links; automatically enabled on Linux                             |
| `cache-key`                 | generated             | Complete GitHub cache primary key                                              |
| `restore-keys`              | generated             | Newline-separated GitHub restore prefixes                                      |
| `remote-url`                |                       | Cache server URL or `s3://` bucket; keeps `MBX_REMOTE_URL` when omitted        |
| `namespace`                 |                       | Remote namespace; keeps `MBX_REMOTE_NAMESPACE` when omitted                    |
| `oidc-audience`             |                       | OIDC audience for a cache server                                               |
| `token`                     |                       | Secret bearer token for a cache server                                         |
| `token-file`                |                       | Bearer-token file for a cache server                                           |
| `remote-mode`               |                       | Remote mode; keeps `MBX_REMOTE_MODE` when omitted, and mbx defaults to `read-write` |

`save-on-workflow-dispatch` is intended for explicitly trusted cache-seeding
and benchmark workflows. It does not affect pull requests or pushes, which
follow `save-on-pull-request` and `save-on-protected-branch`. Pair it with a new
`cache-generation` when an mbx upgrade changes cache behavior. Each saving
dispatch restores the latest compatible cache and writes its learned state to
a new immutable key for the next dispatch.

## Outputs

- `mbx-version` — installed version.
- `cache-hit` — `true` for an exact GitHub cache-key match.
- `cache-primary-key` — key used by the GitHub backend.
- `cache-save-eligible` — `true` when the GitHub backend may attempt a save after a successful job.
- `cache-save-reason` — why the GitHub backend may or may not save.

## License

[MIT](LICENSE)
