# mr-boxington-action

Install [mr boxington](https://github.com/jdx/mr-boxington) and back its Rust
build cache with either GitHub Actions cache or an mbx-compatible server.

## GitHub Actions cache

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7
  - uses: jdx/mr-boxington-action@v1
  - run: mbx test --workspace
```

The default backend restores `mbx`'s local store on every run. It saves a new
immutable entry only for pushes to the repository's default branch, so pull
requests—including forks—are restore-only. Before saving, it prunes the store
to `3GB` by default.

The action pins the checksum of its default mbx version. Any other resolved
version—including a newer release selected by `latest`—is accepted only when
GitHub reports that release as immutable and supplies an asset digest.

Change `cache-generation` when a cache-format or policy change should start
fresh:

```yaml
- uses: jdx/mr-boxington-action@v1
  with:
    version: 0.3.0
    cache-generation: v2
    max-size: 5GB
```

`cache-key` and newline-separated `restore-keys` are available when the default
`${platform}-${architecture}-mbx-${generation}-${commit}` layout is not enough.

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
| `cache-generation` | `v1` | Generated GitHub cache key generation |
| `max-size` | `3GB` | Store budget applied before save |
| `cache-key` | generated | Complete GitHub cache primary key |
| `restore-keys` | generated | Newline-separated GitHub restore prefixes |
| `server-url` | | Required server base URL |
| `namespace` | | Required server namespace |
| `oidc-audience` | | OIDC audience |
| `token` | | Secret bearer token |
| `token-file` | | Bearer-token file |
| `server-mode` | `read-write` | Requested remote mode |

## Outputs

- `mbx-version` — installed version.
- `cache-hit` — `true` for an exact GitHub cache-key match.
- `cache-primary-key` — key used by the GitHub backend.

## License

[MIT](LICENSE)
