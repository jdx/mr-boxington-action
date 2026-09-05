# mr-boxington-action

Set up [mr boxington](https://github.com/jdx/mr-boxington) and use its local
store directly or back it with GitHub Actions cache or an mbx-compatible server. When
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

## Current CI performance

> [!WARNING]
> mbx performs well for local development. Remote caching works and is
> actively improving, but does not yet consistently outperform
> [`Swatinem/rust-cache`](https://github.com/Swatinem/rust-cache) on
> GitHub-hosted runners. Benchmark your complete workflow before switching.
> Investigations, discussions, and pull requests to improve it are welcome.

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
repository's default branch and, when `save-on-workflow-dispatch` is enabled,
trusted `workflow_dispatch` runs. Pull requests—including forks—are
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

`cache-key` and newline-separated `restore-keys` are available when the default
`${platform}-${architecture}-mbx-${generation}-${toolchain}-${commit}` layout
is not enough.

## Cache server

With OIDC:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v7
  - uses: jdx/mr-boxington-action@v1
    with:
      backend: server
      server-url: https://cache.example.com
      namespace: acme/backend
      oidc-audience: mbx-cache
  - run: mbx build --workspace --all-features
```

Or pass a secret bearer token:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    backend: server
    server-url: https://cache.example.com
    namespace: acme/backend
    token: ${{ secrets.MBX_REMOTE_TOKEN }}
```

The action exports the corresponding `MBX_REMOTE_*` variables for subsequent
steps. mbx itself reduces pull requests and unprotected branches to read-only
and disables the remote on tags and releases. The server must still enforce its
own authorization policy.

## Inputs

| Input                       | Default               | Purpose                                                                        |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `backend`                   | `github`              | `local`, `github`, or `server`                                                 |
| `version`                   |                       | mbx release version, or `latest`; when omitted, prefer `mbx` from `PATH`       |
| `github-token`              | `${{ github.token }}` | Token used when `GITHUB_TOKEN` is not exported                                 |
| `cache-generation`          | `v1`                  | Generated GitHub cache key generation                                          |
| `github-cache-mode`         | `target`              | GitHub payload: warm Cargo `target` tree or portable mbx `objects`             |
| `save-on-workflow-dispatch` | `false`               | Save after a successful trusted `workflow_dispatch` run                        |
| `toolchain`                 |                       | Toolchain the build names, such as `1.91` or `+1.91`; the cache key follows it |
| `cache-links`               | `auto`                | Cache native links; automatically enabled on Linux                             |
| `cache-key`                 | generated             | Complete GitHub cache primary key                                              |
| `restore-keys`              | generated             | Newline-separated GitHub restore prefixes                                      |
| `server-url`                |                       | Required server base URL                                                       |
| `namespace`                 |                       | Required server namespace                                                      |
| `oidc-audience`             |                       | OIDC audience                                                                  |
| `token`                     |                       | Secret bearer token                                                            |
| `token-file`                |                       | Bearer-token file                                                              |
| `server-mode`               | `read-write`          | Requested remote mode                                                          |

`save-on-workflow-dispatch` is intended for explicitly trusted cache-seeding
and benchmark workflows. Pull requests and pushes to non-default branches
remain restore-only even when the input is set. Pair it with a new
`cache-generation` when an mbx upgrade changes cache behavior. Each saving
dispatch restores the latest compatible cache and writes its learned state to
a new immutable key for the next dispatch.

## Outputs

- `mbx-version` — installed version.
- `cache-hit` — `true` for an exact GitHub cache-key match.
- `cache-primary-key` — key used by the GitHub backend.

## License

[MIT](LICENSE)
