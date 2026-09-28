import { readFile } from 'node:fs/promises';

// Release 正文的唯一来源是 CHANGELOG.md，版本号取自 package.json。
// 段落缺失或为空时以非零状态退出，避免发布出没有说明的版本。
const root = new URL('..', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8');

const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`);
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex(line => heading.test(line));

if (start === -1) {
  console.error(`CHANGELOG.md 缺少 ${manifest.version} 的段落，请先补充该版本说明。`);
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex(line => /^##\s/.test(line));
const notes = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!notes) {
  console.error(`CHANGELOG.md 中 ${manifest.version} 的段落没有内容。`);
  process.exit(1);
}

process.stdout.write(`${notes}\n`);
