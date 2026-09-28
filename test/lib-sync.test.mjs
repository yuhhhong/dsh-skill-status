import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');

// lib/ 随仓库发布，pnpm 靠它的存在跳过安装期的构建脚本。
// 一旦 lib/ 与 src/ 不同步，用户装到的就是过期产物，所以在这里锁死一致性。
test('随仓库发布的 lib 产物与当前源码构建结果一致', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-skill-status-lib-'));
  try {
    await run(process.execPath, [fileURLToPath(new URL('scripts/build.mjs', root))], {
      cwd: fileURLToPath(root), env: { ...process.env, DSH_SKILL_STATUS_OUT_DIR: scratch },
    });
    const expected = (await readdir(scratch)).sort();
    const published = (await readdir(new URL('lib', root))).sort();
    assert.deepEqual(published, expected, 'lib/ 的文件清单与构建输出不一致');
    for (const name of expected) {
      assert.equal(
        await digest(new URL(`lib/${name}`, root)),
        await digest(join(scratch, name)),
        `lib/${name} 与当前源码构建结果不一致，请重新运行 pnpm run build 并提交 lib/`,
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
