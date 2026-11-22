# Releasing

Releases are published to npm by `.github/workflows/release.yml`, which you start by hand. Homebridge installs and updates plugins from npm, so nothing else is needed for the Homebridge UI to offer the new version.

## Cutting a release

1. In the Actions tab, open "Release", click "Run workflow" on `main`, and choose `patch`, `minor` or `major`. Or from a terminal:

   ```shell
   gh workflow run release.yml --ref main -f bump=patch
   ```

2. Approve the `npm` environment deployment when GitHub asks.

The workflow runs `npm version <bump>` on the version in `package.json`, so `0.1.0` becomes `0.1.1`, `0.2.0` or `1.0.0`. Releases are published to the npm `latest` tag, which the Homebridge UI offers as an update.

## What the workflow does

1. Runs the full CI suite on every supported Node.js version.
2. Bumps the version and checks that the new version has no tag and is not on npm yet.
3. Builds and packs the plugin with install scripts disabled and without a dependency cache, checks the package contents, and records the tarball's SHA-256.
4. In a separate job that runs no project code, verifies the checksum and publishes that exact tarball with npm trusted publishing. npm attaches a signed provenance statement that links the package to this repository, workflow and commit.
5. Only after the publish succeeds, commits the bump as `chore: release <version>`, tags that commit `v<version>`, creates a GitHub release with generated notes, the tarball and its checksum, and pushes the commit to `main`.

If `main` changed while the release ran, the last push fails. The version is still published, tagged and released; merge the tag into `main` by hand with `git fetch --tags && git merge v<version> && git push`.

## One-time setup

### npm

1. Publish the first version by hand so the package exists, from a clean checkout of `main`:

   ```shell
   npm login
   npm ci
   npm pkg delete scripts.prepare
   npm run build
   npm publish --access public
   git checkout package.json
   ```

   Removing `prepare` matches what the workflow publishes. Leave `package.json` at this version: the workflow bumps from it.
2. On npmjs.com, open the package's settings and add a trusted publisher:
   - Publisher: GitHub Actions
   - Organization or user: `josegonzalez`
   - Repository: `homebridge-rabbitair`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
3. In the same settings, set "Publishing access" to require two-factor authentication and disallow tokens. Trusted publishing keeps working, and no token can be used to publish.
4. Revoke any npm tokens created for the first publish.

### GitHub

1. Create an environment named `npm` (Settings, Environments) and:
   - add yourself as a required reviewer, so every publish waits for approval, and
   - limit deployment branches to `main`.
2. Add a tag ruleset for `v*` that blocks updates and deletions, so a released tag can never be moved. Leave creation allowed, since the workflow creates the tag.
3. The release workflow pushes its version bump commit straight to `main` as `github-actions[bot]`. If you protect `main` with a ruleset that requires pull requests or signed commits, add GitHub Actions to the ruleset's bypass list, or the final push fails. Classic branch protection rules cannot exempt the workflow. Only people with write access can run the release workflow.
4. Under Settings, Actions, General, set the default `GITHUB_TOKEN` permissions to read-only. The workflow asks for the extra permissions it needs per job.
5. Turn on Dependabot alerts and security updates. `.github/dependabot.yml` keeps the pinned action SHAs and dependencies up to date, waiting 7 days before proposing new versions.

## Verifying a published version

```shell
npm audit signatures
npm view @josediazgonzalez/homebridge-rabbitair dist.attestations
```

The release page also lists the tarball's SHA-256, which matches `npm pack @josediazgonzalez/homebridge-rabbitair@<version>`.
