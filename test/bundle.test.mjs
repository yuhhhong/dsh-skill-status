import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const patches = load(await readFile(new URL(`../${manifest.dsh.bundle.patch}`, import.meta.url), 'utf8'), { schema: entryListSchema });

test('发布配置在空组合中创建插件条目，而非覆盖不存在的条目', () => {
  const warnings = [];
  const entries = applyEntryPatches([], patches, (...args) => warnings.push(args));
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries.map(({ id, name }) => ({ id, name })), [{ id: 'dsh-skill-status', name: manifest.name }]);
  assert.notEqual(entries[0].disabled, true);
});

test('发布配置加入现有组合时保留原有插件，允许后续启停覆盖', () => {
  const original = [{ id: 'existing', name: 'existing-plugin' }];
  const warnings = [];
  const entries = applyEntryPatches(original, [...patches, { id: 'dsh-skill-status', disabled: true }], (...args) => warnings.push(args));
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries[0], original[0]);
  assert.equal(entries.find(entry => entry.id === 'dsh-skill-status').disabled, true);
  assert.equal(original.length, 1);
});
