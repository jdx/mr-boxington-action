# Changelog

---
## [1.6.0](https://github.com/jdx/mr-boxington-action/compare/v1.5.0..v1.6.0) - 2026-09-25

### 🚀 Features

- **(cache)** opt in to saving from pull requests and protected branches (#48) by [@garysassano](https://github.com/garysassano) in [#48](https://github.com/jdx/mr-boxington-action/pull/48)
- add a remote backend that keeps MBX_REMOTE_* settings from earlier steps (#53) by [@jdx](https://github.com/jdx) in [#53](https://github.com/jdx/mr-boxington-action/pull/53)

### 🐛 Bug Fixes

- **(cache)** restore a saving pull request's own entries before its base (#52) by [@garysassano](https://github.com/garysassano) in [#52](https://github.com/jdx/mr-boxington-action/pull/52)

---
## [1.5.0](https://github.com/jdx/mr-boxington-action/compare/v1.4.0..v1.5.0) - 2026-09-24

### 🚀 Features

- **(target)** cache a Cargo workspace below the checkout root (#46) by [@garysassano](https://github.com/garysassano) in [#46](https://github.com/jdx/mr-boxington-action/pull/46)

### ⚙️ Miscellaneous Tasks

- **(deps-dev)** bump @types/node from 26.5.1 to 26.6.1 (#44) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#44](https://github.com/jdx/mr-boxington-action/pull/44)
- **(deps-dev)** bump vitest from 5.0.0 to 5.0.1 (#45) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#45](https://github.com/jdx/mr-boxington-action/pull/45)
- add entire trail runners (#42) by [@jdx](https://github.com/jdx) in [#42](https://github.com/jdx/mr-boxington-action/pull/42)

### New Contributors

* @garysassano made their first contribution in [#46](https://github.com/jdx/mr-boxington-action/pull/46)

---
## [1.4.0](https://github.com/jdx/mr-boxington-action/compare/v1.3.1..v1.4.0) - 2026-09-16

### 🚀 Features

- restore object-mode caches from a directory bundle (#41) by [@jdx](https://github.com/jdx) in [#41](https://github.com/jdx/mr-boxington-action/pull/41)

### ⚙️ Miscellaneous Tasks

- **(deps)** bump zizmorcore/zizmor-action from 0.6.3 to 0.6.4 (#38) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#38](https://github.com/jdx/mr-boxington-action/pull/38)
- **(deps-dev)** bump @types/node from 26.4.1 to 26.5.1 (#39) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#39](https://github.com/jdx/mr-boxington-action/pull/39)

---
## [1.3.1](https://github.com/jdx/mr-boxington-action/compare/v1.3.0..v1.3.1) - 2026-09-10

### 🐛 Bug Fixes

- **(cache)** preserve imported objects on hosted runners (#37) by [@jdx](https://github.com/jdx) in [#37](https://github.com/jdx/mr-boxington-action/pull/37)

### 📚 Documentation

- drop the CI performance warning (#32) by [@jdx](https://github.com/jdx) in [#32](https://github.com/jdx/mr-boxington-action/pull/32)

### ⚙️ Miscellaneous Tasks

- **(deps)** bump zizmorcore/zizmor-action from 0.6.2 to 0.6.3 (#34) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#34](https://github.com/jdx/mr-boxington-action/pull/34)
- **(deps-dev)** bump vitest from 4.1.11 to 5.0.0 (#36) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#36](https://github.com/jdx/mr-boxington-action/pull/36)
- **(deps-dev)** bump @types/node from 26.4.0 to 26.4.1 (#35) by [@dependabot[bot]](https://github.com/dependabot[bot]) in [#35](https://github.com/jdx/mr-boxington-action/pull/35)

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
