# dsh-skill-status

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](<./README.md>) | English

A session skill status plugin for DeepSeek Harness (DSH). It shows the number of confirmed loaded skills in the conversation header. Click **技能** (Skills) to open the right sidebar and check whether each skill's full main body remains in the current main assistant context, along with its recorded versions and sources. You can also translate skill bodies on demand.

## Features

- Combines the current skill catalog with historical loading records, with filtering by name or description.
- Lists loaded skills first, with each group sorted by name.
- Recognizes official loading through `/skill-name` and the `skill` tool, and checks whether the full main body is retained.
- Shows historical body versions, load counts, and resource guidance recorded at load time. Multiple versions of one skill count as one skill.
- Displays load-time sources separately from current catalog sources. Later edits to source files do not replace historical bodies.
- Updates on session events and rechecks catalog and file status every five seconds during quiet periods.
- Translates the body you are viewing through Bing or Google, with target language settings, original/translation switching, chunk progress, and retries for unfinished chunks only.

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

The current plugin version is `0.1.5`. The supported DSH range is `>=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0`. Within that range, skill body translation requires `0.2.2-rc.2` or later. Earlier versions still support skill status queries but do not show the translation controls.

## Skill body translation

First enable **思考过程机器翻译** (Thinking process machine translation) in DSH's **插件** (Plugins) page. Expand a skill entry, then click **机翻** (Translate) next to **上下文正文** (Context body) or **历史正文** (Historical body). The body is translated in chunks, with each completed chunk shown as it arrives. Unfinished or failed chunks keep the original text and show a status message.

During translation, click **取消** (Cancel) to stop, or switch between **查看原文** (View original) and **查看译文** (View translation). After cancellation or failure, click **重试未完成块** (Retry unfinished chunks) to continue. Successfully translated chunks are reused.

Open this plugin's details on the Plugins page to configure:

- Translation service: Bing or Google. The default is Bing.
- Target language: follows the DSH interface language by default, or accepts a language code such as `zh-CN`, `en`, or `ja`.

Click **保存** (Save) to apply both settings together. Settings persist across restarts. Collapsing a skill entry, switching body versions, or closing the panel cancels unfinished translation requests. Successful chunks are cached only in host memory and cleared when DSH restarts or this plugin is unloaded.

If the translation service is not enabled when you click Translate, the plugin displays:

> 未检测到翻译服务。请前往「插件」启用「思考过程机器翻译」

This means: “No translation service detected. Go to Plugins and enable Thinking process machine translation.” Enable it, then click Translate again to recheck.

Translations are for reading only. They do not change the skill's original text, source, or loading status, and are not written into the session context. Code, commands, paths, and link destinations are kept unchanged.

## Status meanings

The plugin UI currently uses Chinese labels.

| UI label | Meaning |
| --- | --- |
| 已加载 (Loaded) | The full main body of at least one officially loaded version remains in the current context. |
| 未检测到加载 (No load detected) | The verifiable history contains no successful load through an official entry point. |
| 完整正文不在上下文 (Full body absent from context) | A previous load is confirmed, but every verifiable version is now incomplete or absent from the current context. |
| 无法确认 (Unknown) | Evidence from history, the body, or the current context is insufficient. |

In the header, `…` means the first result is pending. `?` means a query failed or some scope remains unverified. `2 · ?` means two skills are confirmed loaded, with some status still unresolved.

Issues attributable to a skill appear directly in its collapsed row, such as a missing original body, indirect-call logs without the original body, ambiguous body matching, or an unavailable context snapshot. Loading and catalog status are separate: `已加载 · 目录待确认` means the body is confirmed retained while catalog membership remains unverified, without reducing the loaded count. Uncertainty affecting only other versions is labeled `其他版本` (Other versions). Incomplete history or catalog data can hide entries altogether, so the panel shows separate notices for those gaps.

Ordinary file reads do not count as official loading evidence. A compaction summary mentioning a skill or a successful past load does not, by itself, prove that the full body remains in context. Whether referenced materials have been read does not affect the main-body completeness check.

Resource guidance in a loading record may not include an exact source file path. The plugin checks file existence only when the current skill catalog supplies an explicit path, and displays that result under **当前目录来源** (Current catalog source).

## Local development

After installing dependencies, run the syntax checks and tests.

```sh
pnpm run check
pnpm test
```

`pnpm test` builds the project before running tests. `pnpm pack` also builds automatically through `prepack`. Building this project does not automatically update a running DSH page.

The built `lib/` artifacts are committed to the repository. Do not delete or ignore them. When pnpm installs a dependency from a git source, it checks whether the file `main` points to (`lib/index.js`) exists. If it does not, pnpm requires build scripts and `allowBuilds` authorization; if it does, pnpm skips the build stage. Keeping `lib/` committed allows installation from GitHub without build approval. `prepack` rebuilds the package when packing.

After changing `src/`, run `pnpm run build` and commit the updated `lib/`. Tests compare the artifacts against a fresh build and fail when they are stale.

Automatic peer dependency installation is disabled. The target environment supplies the DSH host. The supported version range is listed in the installation section above.

## Releasing

Pushing a `v`-prefixed tag triggers GitHub Actions. It verifies the tag against the package version, extracts the release notes, checks the committed artifacts, and runs the syntax checks and tests. Once all checks pass, it creates the GitHub Release without an attached archive.

Before releasing, update the package version, write its changelog entry, and commit the source and `lib/`. The workflow fails before publishing if the tag disagrees with the package version or the changelog lacks the matching version.

```sh
git tag -a v0.1.5 -m "Release v0.1.5"
git push origin v0.1.5
```

| File | Purpose |
| --- | --- |
| [src/analyze.js](<./src/analyze.js>) | Official-load recognition, body completeness checks, history merging, and counting |
| [src/monitor.js](<./src/monitor.js>) | Session observation, source checks, and long polling |
| [src/index.js](<./src/index.js>) | Host event subscriptions, status queries, and translation routes |
| [src/client.jsx](<./src/client.jsx>) | Header entry, right sidebar, body switching, and translation settings |
| [src/translation.js](<./src/translation.js>) | Translation requests, successful chunk caching, and cancellation |
| [src/translation-text.js](<./src/translation-text.js>) | Body splitting and preservation of code, paths, and similar fragments |
| [src/translation-runtime.js](<./src/translation-runtime.js>) | Translation version detection and configuration schema |
| [src/translation-client.js](<./src/translation-client.js>) | Translation progress, retries, and client state |
| [scripts/build.mjs](<./scripts/build.mjs>) | Host and DSH client module builds |
| [scripts/release-notes.mjs](<./scripts/release-notes.mjs>) | Extracts the Release body for the package version from the changelog |
| [lib/](<./lib>) | Committed build artifacts, so git installs need no build approval |

## License

Licensed under the MIT License. Copyright (c) 2026 yuhong.
