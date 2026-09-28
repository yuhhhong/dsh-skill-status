import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';

// 默认写入仓库中随版本控制的 lib/；一致性检查会指定临时目录做对比构建。
const outDir = process.env.DSH_SKILL_STATUS_OUT_DIR ?? 'lib';

await mkdir(outDir, { recursive: true });
for (const name of ['index', 'analyze', 'monitor']) await copyFile(`src/${name}.js`, `${outDir}/${name}.js`);
const result = await build({
  entryPoints: ['src/client.jsx'], bundle: true, write: false, format: 'cjs', platform: 'browser',
  target: 'es2022', external: ['react'], jsx: 'transform', legalComments: 'none',
});
const wrapper = `window.__ModuleLoader__.load({id:"dsh-skill-status",factory:(require)=>{\nvar module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n}});\n`;
await writeFile(`${outDir}/client.js`, wrapper);
console.log(`已构建宿主与客户端插件：${outDir}`);
