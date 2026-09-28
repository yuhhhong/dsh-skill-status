# dsh-skill-status

[中文](<./README.md>) | English

A session skill status plugin for DeepSeek Harness (DSH). It shows the number of confirmed loaded skills in the conversation header. Click **技能** (Skills) to open the right sidebar and check whether each skill's full main body remains in the current main assistant context, along with its recorded versions and sources.

## Features

- Combines the current skill catalog with historical loading records, with filtering by name or description.
- Lists loaded skills first, with each group sorted by name.
- Recognizes official loading through `/skill-name` and the `skill` tool, and checks whether the full main body is retained.
- Shows historical body versions, load counts, and resource guidance recorded at load time. Multiple versions of one skill count as one skill.
- Displays load-time sources separately from current catalog sources. Later edits to source files do not replace historical bodies.
- Updates on session events and rechecks catalog and file status every five seconds during quiet periods.

The plugin only queries skill status for the current main assistant. It does not load, reload, or unload skills, or modify session content.

## Installation

Install directly from GitHub in the DSH web profile:

```sh
dsh plugin --profile web add github:yuhhhong/dsh-skill-status
```

After installation, restart DSH and refresh the DSH page. Open an existing conversation and click **技能** on the right side of the conversation header to view the current skill status.

To uninstall:

```sh
dsh plugin --profile web remove dsh-skill-status
```

The current plugin version is `0.1.2`, targeting DSH `0.1.7-rc.2`.

## Status meanings

The plugin UI currently uses Chinese labels.

| UI label | Meaning |
| --- | --- |
| 已加载 (Loaded) | The full main body of at least one officially loaded version remains in the current context. |
| 未检测到加载 (No load detected) | The verifiable history contains no successful load through an official entry point. |
| 完整正文不在上下文 (Full body absent from context) | A previous load is confirmed, but every verifiable version is now incomplete or absent from the current context. |
| 无法确认 (Unknown) | Evidence from history, the body, or the current context is insufficient. |

In the header, `…` means the first result is pending. `?` means a query failed or some scope remains unverified. `2 · ?` means two skills are confirmed loaded, with some status still unresolved.

Ordinary file reads do not count as official loading evidence. A compaction summary mentioning a skill or a successful past load does not, by itself, prove that the full body remains in context. Whether referenced materials have been read does not affect the main-body completeness check.

Resource guidance in a loading record may not include an exact source file path. The plugin checks file existence only when the current skill catalog supplies an explicit path, and displays that result under **当前目录来源** (Current catalog source).

## Local development

After installing dependencies, run the syntax checks and tests.

```sh
pnpm run check
pnpm test
```

`pnpm test` builds the project before running tests. `pnpm pack` also builds automatically through `prepack`. Building this project does not automatically update a running DSH page.

The built `lib/` artifacts are committed to the repository — do not delete or ignore them. When pnpm installs a dependency from a git source, it checks whether the file `main` points at (`lib/index.js`) exists: if it does not, pnpm decides the package needs its build scripts and demands `allowBuilds` authorization; if it does, pnpm skips the build stage entirely. Keeping `lib/` committed is therefore what makes installation from GitHub require no build approval. `prepack` stays, because publishing to npm needs it to rebuild.

After changing `src/`, run `pnpm run build` and commit the updated `lib/`. A [test](<./test/lib-sync.test.mjs>) compares `lib/` against a fresh build and fails when the artifacts are stale.

Automatic peer dependency installation is disabled. The target environment supplies the DSH host. See `peerDependencies` in the [package manifest](<./package.json>) for the compatibility constraint.

## Releasing

Pushing a `v`-prefixed tag triggers the [release workflow](<.github/workflows/release.yml>): it verifies the tag against the package version, extracts the release notes, checks the committed artifacts, runs the syntax checks and tests, and then creates the GitHub Release automatically. No archive is attached.

Before releasing, write that version's section in the [changelog](<./CHANGELOG.md>), commit `lib/`, and push the tag. The workflow fails before publishing when the tag disagrees with the `package.json` version or the changelog lacks that version's section.

```sh
git tag -a v0.1.2 -m "Release v0.1.2"
git push origin v0.1.2
```

| File | Purpose |
| --- | --- |
| [src/analyze.js](<./src/analyze.js>) | Official-load recognition, body completeness checks, history merging, and counting |
| [src/monitor.js](<./src/monitor.js>) | Session observation, source checks, and long polling |
| [src/index.js](<./src/index.js>) | Host event subscriptions and the status query route |
| [src/client.jsx](<./src/client.jsx>) | Header entry, right sidebar, and version switching |
| [scripts/build.mjs](<./scripts/build.mjs>) | Host and DSH client module builds |
| [scripts/release-notes.mjs](<./scripts/release-notes.mjs>) | Extracts the Release body for the package version from the changelog |
| [lib/](<./lib>) | Committed build artifacts, so git installs need no build approval |

## Project documentation

- [Glossary](<./CONTEXT.md>) (Chinese): project terminology and requirement agreements.

## License

Licensed under the [MIT License](<./LICENSE>). Copyright (c) 2026 yuhong.
