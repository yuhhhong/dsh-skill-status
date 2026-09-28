import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const script = fileURLToPath(new URL('scripts/release-notes.mjs', root));
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

// Release 正文只来自 CHANGELOG.md，发布前不补写段落就会发出空说明。
// 这里把“提取失败”锁在本地测试阶段，避免等到打标签才由工作流拒绝。
test('更新日志含有当前版本的发布说明', async () => {
  const { stdout } = await run(process.execPath, [script], { cwd: fileURLToPath(root) });
  assert.ok(stdout.trim(), `CHANGELOG.md 中 ${manifest.version} 的段落没有内容`);
  assert.doesNotMatch(stdout, /^##\s/m, '提取结果不应包含其他版本的标题');
});

test('更新日志缺少当前版本段落时提取失败', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-skill-status-notes-'));
  try {
    await mkdir(join(scratch, 'scripts'), { recursive: true });
    await writeFile(join(scratch, 'scripts', 'release-notes.mjs'), await readFile(script));
    await writeFile(join(scratch, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    await writeFile(join(scratch, 'CHANGELOG.md'), '# 更新日志\n\n## 0.1.1\n\n- 旧内容\n');
    await assert.rejects(
      run(process.execPath, [join(scratch, 'scripts', 'release-notes.mjs')], { cwd: scratch }),
      error => error.code === 1 && /9\.9\.9/.test(error.stderr),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
