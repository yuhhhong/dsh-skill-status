import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { translationRuntime } from '../src/translation-runtime.js';

// 在没有新版 Schema 的安装夹具中验证，旧宿主不会加载可选的新配置接口。
for (const version of ['0.1.7-rc.2', '0.2.2-rc.1']) {
  test(`旧版 ${version} 不要求翻译或新版 Schema 包`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-status-old-runtime-'));
    try {
      const packageDir = join(root, 'node_modules/@deepseek-ai/dsh-app-boot');
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version, exports: { './package.json': './package.json' } }));
      const runtime = await translationRuntime(root);
      assert.equal(runtime.version, version);
      assert.equal(runtime.Config, undefined);
    } finally {
      assert.equal(resolve(root).startsWith(join(tmpdir(), 'skill-status-old-runtime-')), true);
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('无法确认宿主版本时主模块仍可加载，不冒充版本支持', async () => {
  assert.deepEqual(await translationRuntime(''), { version: null, Config: undefined });
  assert.deepEqual(await translationRuntime('/不存在的技能状态测试目录'), { version: null, Config: undefined });
});
