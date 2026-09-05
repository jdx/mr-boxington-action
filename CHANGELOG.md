# Changelog

---
## [1.3.1](https://github.com/jdx/mr-boxington-action/compare/v1.3.0..v1.3.1) - 2026-09-05

### 📚 Documentation

- drop the CI performance warning (#32) by [@jdx](https://github.com/jdx) in [#32](https://github.com/jdx/mr-boxington-action/pull/32)

---
## [1.3.0](https://github.com/jdx/mr-boxington-action/compare/v1.2.0..v1.3.0) - 2026-09-05

### 🚀 Features

- add local cache backend (#28) by [@jdx](https://github.com/jdx) in [#28](https://github.com/jdx/mr-boxington-action/pull/28)
- remove the deprecated max-size input (#30) by [@jdx](https://github.com/jdx) in [#30](https://github.com/jdx/mr-boxington-action/pull/30)
- cache the Cargo target tree by default (#31) by [@jdx](https://github.com/jdx) in [#31](https://github.com/jdx/mr-boxington-action/pull/31)

---
## [1.2.0](https://github.com/jdx/mr-boxington-action/compare/v1.1.0..v1.2.0) - 2026-09-01

### 🚀 Features

- use mbx from path when version is omitted (#27) by [@jdx](https://github.com/jdx) in [#27](https://github.com/jdx/mr-boxington-action/pull/27)

### 📚 Documentation

- disclose current CI performance (#23) by [@jdx](https://github.com/jdx) in [#23](https://github.com/jdx/mr-boxington-action/pull/23)

---
## [1.1.0](https://github.com/jdx/mr-boxington-action/compare/v1.0.1..v1.1.0) - 2026-08-31

### 🚀 Features

- scope the generated cache key by rustc identity (#16) by [@jdx](https://github.com/jdx) in [#16](https://github.com/jdx/mr-boxington-action/pull/16)
- key the cache by the toolchain the build names (#17) by [@jdx](https://github.com/jdx) in [#17](https://github.com/jdx/mr-boxington-action/pull/17)
- allow trusted dispatches to seed caches (#18) by [@jdx](https://github.com/jdx) in [#18](https://github.com/jdx/mr-boxington-action/pull/18)
- cache exact mbx build closures (#20) by [@jdx](https://github.com/jdx) in [#20](https://github.com/jdx/mr-boxington-action/pull/20)

### 🐛 Bug Fixes

- roll cache keys for saving dispatches (#19) by [@jdx](https://github.com/jdx) in [#19](https://github.com/jdx/mr-boxington-action/pull/19)
- diagnose unavailable GitHub cache runtime (#22) by [@jdx](https://github.com/jdx) in [#22](https://github.com/jdx/mr-boxington-action/pull/22)

### ⚡ Performance

- cache native links on Linux (#15) by [@jdx](https://github.com/jdx) in [#15](https://github.com/jdx/mr-boxington-action/pull/15)

### ⚙️ Miscellaneous Tasks

- **(deps-dev)** bump @types/node from 26.3.0 to 26.4.0 (#21) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#21](https://github.com/jdx/mr-boxington-action/pull/21)
- automate action releases (#24) by [@jdx](https://github.com/jdx) in [#24](https://github.com/jdx/mr-boxington-action/pull/24)

---
## [1.0.1](https://github.com/jdx/mr-boxington-action/compare/v1.0.0..v1.0.1) - 2026-08-28

### 🚀 Features

- leave a calling card in run summaries (#9) by [@jdx](https://github.com/jdx) in [#9](https://github.com/jdx/mr-boxington-action/pull/9)
- support Windows ARM64 and require immutable releases (#13) by [@jdx](https://github.com/jdx) in [#13](https://github.com/jdx/mr-boxington-action/pull/13)

### 🐛 Bug Fixes

- authenticate release metadata requests (#14) by [@jdx](https://github.com/jdx) in [#14](https://github.com/jdx/mr-boxington-action/pull/14)

### 🔍 Other Changes

- verify mbx downloads against trusted digests (#11) by [@jdx](https://github.com/jdx) in [#11](https://github.com/jdx/mr-boxington-action/pull/11)

### ⚙️ Miscellaneous Tasks

- **(deps)** bump actions/setup-node from 6.5.0 to 7.0.0 (#2) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#2](https://github.com/jdx/mr-boxington-action/pull/2)
- **(deps-dev)** bump typescript from 5.9.3 to 7.0.2 (#5) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#5](https://github.com/jdx/mr-boxington-action/pull/5)
- **(deps-dev)** bump vitest from 3.2.7 to 4.1.11 (#4) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#4](https://github.com/jdx/mr-boxington-action/pull/4)
- **(deps-dev)** bump @types/node from 24.13.3 to 26.3.0 (#3) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#3](https://github.com/jdx/mr-boxington-action/pull/3)
- add zizmor workflow (#8) by [@jdx](https://github.com/jdx) in [#8](https://github.com/jdx/mr-boxington-action/pull/8)
- watch for advisories on a schedule (#10) by [@jdx](https://github.com/jdx) in [#10](https://github.com/jdx/mr-boxington-action/pull/10)

### New Contributors

* @dependabot[bot] made their first contribution in [#3](https://github.com/jdx/mr-boxington-action/pull/3)

---
## [1.0.0] - 2026-08-24

### 🚀 Features

- add mr boxington setup action by [@jdx](https://github.com/jdx) in [a28458e](https://github.com/jdx/mr-boxington-action/commit/a28458e7450448f44f04002f8eae0da58fa68cc0)

### 🐛 Bug Fixes

- create an empty cache store before saving by [@jdx](https://github.com/jdx) in [db50c8d](https://github.com/jdx/mr-boxington-action/commit/db50c8de19725c43542bf153251e18e19acc3440)

### 🔍 Other Changes

- Configure Renovate (#1) by [@renovate[bot]](https://github.com/renovate[bot]) in [#1](https://github.com/jdx/mr-boxington-action/pull/1)

### 🧪 Testing

- smoke-test the server backend by [@jdx](https://github.com/jdx) in [4bc8084](https://github.com/jdx/mr-boxington-action/commit/4bc808411ff3e26970cdcc17ec61ddb86744e5fe)

### ⚙️ Miscellaneous Tasks

- standardize the final job (#7) by [@jdx](https://github.com/jdx) in [#7](https://github.com/jdx/mr-boxington-action/pull/7)

### New Contributors

* @jdx made their first contribution in [#7](https://github.com/jdx/mr-boxington-action/pull/7)
* @renovate[bot] made their first contribution in [#1](https://github.com/jdx/mr-boxington-action/pull/1)

<!-- generated by git-cliff -->
