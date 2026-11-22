# Releasing

Releases are published to npm by `.github/workflows/release.yml` when a GitHub release is published. Homebridge installs and updates plugins from npm, so nothing else is needed for the Homebridge UI to offer the new version.

## Cutting a release

1. Update `version` in `package.json` (and `package-lock.json`) with `npm version <version> --no-git-tag-version`, and commit it to `main`.
2. Create a GitHub release with the tag `v<version>`.
   - For a stable release, leave "Set as a pre-release" unchecked. It is published to the npm `latest` tag, which the Homebridge UI offers as an update.
   - For a beta, use a version such as `1.2.0-beta.1` and check "Set as a pre-release". It is published to the npm `beta` tag. Homebridge users can install it from the plugin's version list, and it is not offered as an update to everyone else.
3. Approve the `npm` environment deployment if required reviewers are set up.

The workflow refuses to publish if the tag does not match `package.json`, or if the pre-release checkbox does not match the version.

## What the workflow does

1. Runs the full CI suite on every supported Node.js version.
2. Builds and packs the plugin with install scripts disabled and without a dependency cache, checks the package contents, and records the tarball's SHA-256.
3. In a separate job that runs no project code, verifies the checksum and publishes that exact tarball with npm trusted publishing. npm attaches a signed provenance statement that links the package to this repository, workflow and commit.
4. Attaches the tarball and its checksum to the GitHub release.

## One-time setup

### npm

1. Publish the first version by hand so the package exists: `npm publish --access public`. Alternatively, create the package with trusted publishing configured from the start, if npm offers that for new packages.
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
   - limit deployments to tags matching `v*`.
2. Add a tag ruleset for `v*` that restricts creation, updates and deletion to maintainers.
3. Protect `main`: require pull requests and the CI checks to pass.
4. Under Settings, Actions, General, set the default `GITHUB_TOKEN` permissions to read-only.
5. Turn on Dependabot alerts and security updates. `.github/dependabot.yml` keeps the pinned action SHAs and dependencies up to date, waiting 7 days before proposing new versions.

## Verifying a published version

```shell
npm audit signatures
npm view @josediazgonzalez/homebridge-rabbitair dist.attestations
```

The release page also lists the tarball's SHA-256, which matches `npm pack @josediazgonzalez/homebridge-rabbitair@<version>`.
