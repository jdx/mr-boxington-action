# mr-boxington-action

Install [mr boxington](https://github.com/jdx/mr-boxington) and back its Rust
build cache with either GitHub Actions cache or an mbx-compatible server.

## Current CI performance

mbx does not currently outperform
[`Swatinem/rust-cache`](https://github.com/Swatinem/rust-cache) in our
GitHub-hosted runner benchmarks consistently. In a warm-cache comparison for
[`jdx/hk`](https://github.com/jdx/hk/actions/runs/33395159164), rust-cache
finished the measured Cargo build substantially sooner on Linux, macOS, and
Windows. The server-backed mbx runs transferred large action closures and
could not predict every compilation from a fresh `target/` directory.

The GitHub-cache backend narrowed the gap but did not reverse it. In a
[separately seeded warm run](https://github.com/jdx/hk/actions/runs/33439934246),
the measured Cargo builds took 15.54 versus 22.24 seconds on Linux, 24.64
versus 33.01 seconds on macOS, and 55.65 versus 123 seconds on Windows for
rust-cache and mbx respectively. Including checkout, cache restore, and action
setup, the corresponding full jobs took 24 versus 49 seconds, 45 versus 60
seconds, and 93 versus 183 seconds.

The result depends on the workload. In a
[warm `jdx/mise` run](https://github.com/jdx/mise/actions/runs/33440683366),
GitHub-backed mbx beat rust-cache on Linux: 38.79 versus 129 seconds for the
Cargo build and 97 versus 163 seconds for the full job. It lost on macOS
(307 versus 207 seconds for Cargo; 379 versus 276 seconds for the job) and
Windows (737 versus 305 seconds for Cargo; 1,070 versus 392 seconds for the
job). The Windows mbx job spent 199 seconds restoring and importing its cache
before Cargo started.

Do not replace rust-cache with this action solely to make GitHub Actions
faster. The tradeoff can still favor mbx when the same cache should serve
local worktrees as well as CI, when concurrent builds benefit from shared
scheduling and in-flight deduplication, when fine-grained reuse across changed
builds matters more than restoring one target archive, or when detailed
hit/miss/bypass diagnostics are valuable. A nearby self-hosted remote can also
change the transfer tradeoff. Benchmark your own workflow before migrating;
improving fresh-run prediction coverage and transfer cost is active work.

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
