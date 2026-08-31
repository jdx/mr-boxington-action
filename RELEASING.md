# Releasing

The release flow follows `jdx/mise-action`: conventional commits on `main`
produce a release PR, and merging that PR publishes the release. Nobody needs
to update the package version or move the major action tag by hand.

## Flow

1. `.github/workflows/release-plz.yml` runs after a push to `main` and opens or
   updates the `release` PR. `git-cliff` chooses the next semantic version and
   writes `CHANGELOG.md`.
2. CI validates the release PR, including the checked-in `dist/index.js`.
3. The scheduled auto-merge workflow enables squash auto-merge when at least seven
   days have passed since the last release and a `fix` or `feat` is pending.
   A manual dispatch bypasses those cadence checks.
4. Merging a PR labeled `release` triggers `.github/workflows/release.yml`. It
   creates the immutable version tag and GitHub release, then force-moves the
   major tag (for example, `v1`) to the same commit.
5. When `ANTHROPIC_API_KEY` is configured, Communiqué rewrites the generated
   notes with a user-oriented summary. This enhancement is not a release gate.

## Repository setup

- Add a `release` label.
- Add `RELEASE_PLZ_GITHUB_TOKEN`, a fine-grained token able to write repository
  contents and pull requests. A separate token is required because pushes made
  with the workflow `GITHUB_TOKEN` do not start CI for the release branch.
- Optionally add `ANTHROPIC_API_KEY` for Communiqué release notes.
- Enable auto-merge in the repository settings if scheduled releases should
  merge automatically.
- Enable immutable releases so published action tags and assets cannot be
  rewritten. The moving major tag remains the supported floating entry point.

Run `mise run release-plz` locally for a dry run. It prints the proposed
version and release notes without changing the working tree unless `DRY_RUN=0`
is set.
