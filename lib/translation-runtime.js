import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LANGUAGE_PATTERN, supportsTranslation } from './translation.js';

// 以宿主安装为锚点，避免本地开发依赖被误当成当前 DSH 的版本和 Schema。
export async function translationRuntime(installDir = process.env.DSH_INSTALL_DIR) {
  try {
    // 宿主进程不一定设置命令工具的 DSH_INSTALL_DIR；已声明的 DSH peer 也能定位安装。
    const anchor = installDir ? join(installDir, 'package.json') : createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
    const runtimeRequire = createRequire(anchor);
    const manifest = JSON.parse(readFileSync(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot/package.json'), 'utf8'));
    const version = manifest.version;
    if (!supportsTranslation(version)) {
      return { version, Config: undefined };
    }
    const { default: z } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/schemastery')).href);
    const Config = z.object({
      provider: z.union(['bing', 'google']).default('bing').volatile(),
      targetLanguage: z.string().pattern(LANGUAGE_PATTERN).default('auto').volatile(),
    });
    return { version, Config };
  } catch {
    // 旧宿主缺少探测入口时，仅关闭可选机翻；不影响技能状态模块加载。
    return { version: null, Config: undefined };
  }
}
