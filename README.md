# mr-boxington-action

Install [mr boxington](https://github.com/jdx/mr-boxington) and back its Rust
build cache with either GitHub Actions cache or an mbx-compatible server.

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

The default backend restores the action closure from the previous compatible
build on every run. It saves a new immutable entry for pushes to the
repository's default branch and, when `save-on-workflow-dispatch` is enabled,
trusted `workflow_dispatch` runs. Pull requests—including forks—are
restore-only.

The action imports the restored bundle before any build steps and exports the
deduplicated closure of every completed `mbx` command in the job afterward.
This keeps GitHub Actions cache entries focused on what the job actually used,
including warm cache hits, rather than uploading the entire local store. The
action assigns a unique `MBX_CACHE_EXPORT_GROUP` automatically; workflows do
not need to set it themselves.

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
immutable and supplies an asset digest. Release metadata requests use the
workflow token by default, which requires `contents: read` permission.

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

| Input | Default | Purpose |
| --- | --- | --- |
| `backend` | `github` | `github` or `server` |
| `version` | `latest` | mbx release version, or `latest` |
| `github-token` | `${{ github.token }}` | Token used to resolve mbx release metadata |
| `cache-generation` | `v1` | Generated GitHub cache key generation |
| `save-on-workflow-dispatch` | `false` | Save after a successful trusted `workflow_dispatch` run |
| `toolchain` | | Toolchain the build names, such as `1.91` or `+1.91`; the cache key follows it |
| `max-size` | `3GB` | Deprecated; ignored by closure-bundle exports |
| `cache-links` | `auto` | Cache native links; automatically enabled on Linux |
| `cache-key` | generated | Complete GitHub cache primary key |
| `restore-keys` | generated | Newline-separated GitHub restore prefixes |
| `server-url` | | Required server base URL |
| `namespace` | | Required server namespace |
| `oidc-audience` | | OIDC audience |
| `token` | | Secret bearer token |
| `token-file` | | Bearer-token file |
| `server-mode` | `read-write` | Requested remote mode |

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
