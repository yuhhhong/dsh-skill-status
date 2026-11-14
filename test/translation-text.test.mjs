import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATION_RULE_VERSION, splitTranslationText } from '../src/translation-text.js';

function verify(body, limit) {
  const parts = splitTranslationText(body, limit);
  assert.equal(parts.map(part => part.original).join(''), body);
  assert.deepEqual(parts, splitTranslationText(body, limit));
  for (const part of parts) {
    assert.equal(typeof part.translatable, 'boolean');
    assert.ok(part.original.length > 0);
    if (part.translatable) {
      assert.ok(part.original.length <= limit, `片段超过上限：${part.original.length}/${limit}`);
      assert.equal(part.original, part.original.trim());
    }
    assert.doesNotMatch(part.original, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
  return parts;
}

function translated(parts) {
  return parts.filter(part => part.translatable).map(part => part.original).join(' ');
}

function protectedText(parts) {
  return parts.filter(part => !part.translatable).map(part => part.original).join('');
}

test('导出非空规则版本，空正文与空白保持原样', () => {
  assert.equal(typeof TRANSLATION_RULE_VERSION, 'string');
  assert.ok(TRANSLATION_RULE_VERSION.length > 0);
  assert.deepEqual(verify('', 20), []);
  const parts = verify(' \t\r\n\n  ', 20);
  assert.ok(parts.every(part => !part.translatable));
});

test('按段落与 Markdown 边界分块并精确保留空白', () => {
  const body = '# Heading  \r\n\r\nFirst paragraph.\r\nSecond line.\r\n\r\n- [x] **Read** the _guide_.\r\n> Another paragraph.\r\n';
  const parts = verify(body, 60);
  assert.deepEqual(parts.filter(part => part.translatable).map(part => part.original), ['Heading', 'First paragraph.', 'Second line.', 'Read', 'the', 'guide', 'Another paragraph.']);
  const result = parts.map(part => part.translatable ? '译文' : part.original).join('');
  assert.ok(result.startsWith('# 译文  \r\n\r\n'));
  assert.ok(result.includes('- [x] **译文** 译文 _译文_.'));
  assert.ok(result.endsWith('> 译文\r\n'));
});

test('超长单段按实际服务上限拆分并保持 Unicode 代理对完整', () => {
  const body = `  ${'这里包含😀与𠮷字符而且没有空格'.repeat(900)}  `;
  for (const limit of [7, 31, 4096, 5200]) {
    const parts = verify(body, limit);
    const chunks = parts.filter(part => part.translatable);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(part => part.original.length <= limit));
    if (limit > 4000) {
      assert.ok(chunks.some(part => part.original.length > 4000));
    }
  }
});

test('超长英文优先在空白和句子边界拆分', () => {
  const parts = verify('Alpha beta gamma. Delta epsilon zeta. Eta theta iota.', 20);
  assert.deepEqual(parts.filter(part => part.translatable).map(part => part.original), ['Alpha beta gamma.', 'Delta epsilon zeta.', 'Eta theta iota.']);
});

test('围栏代码与不闭合围栏全部保护，围栏长度与类型必须匹配', () => {
  const body = 'Before code.\n````js\nconst text = "do not translate";\n```\n~~~~\n````\nAfter code.\n~~~bash\nnpm install very-long-package-name\n';
  const parts = verify(body, 12);
  const sent = translated(parts);
  assert.match(sent, /Before code/);
  assert.match(sent, /After code/);
  assert.doesNotMatch(sent, /const|translate|npm|package|bash/);
  assert.ok(protectedText(parts).includes('````js\nconst text = "do not translate";\n```\n~~~~\n````'));
  assert.ok(protectedText(parts).endsWith('~~~bash\nnpm install very-long-package-name\n'));
});

test('缩进代码、引用内围栏和行内不同长度反引号全部保护', () => {
  const body = 'Read this.\n    const value = "private code";\n\tconsole.log(value);\n> ~~~sh\n> echo secret\n> ~~~\nUse `npm run test` and ``a `nested` code`` safely.\n';
  const parts = verify(body, 15);
  const sent = translated(parts);
  assert.doesNotMatch(sent, /const|private|console|secret|npm|nested/);
  assert.match(sent, /Read this/);
  assert.match(sent, /safely/);
  assert.ok(protectedText(parts).includes('``a `nested` code``'));
});

test('命令、路径、网址与链接目标不送翻译，自然语言标签仍可翻译', () => {
  const body = 'Run npm install --save demo, then read the guide.\n$ git diff -- src/main.js\npnpm run build\nOpen ./docs/guide.md and /usr/local/bin/tool or C:\\Users\\demo\\file.txt.\nRead [the helpful guide](https://example.com/a_(b)?lang=en "Guide title") and ![a useful diagram](../assets/diagram.svg).\nSee [reference label][guide-id] or https://example.com/help?q=test.\n[guide-id]: https://example.com/reference "Keep title"\n';
  const parts = verify(body, 25);
  const sent = translated(parts);
  assert.doesNotMatch(sent, /npm|install|--save|git|diff|pnpm|build|guide\.md|\/usr|Users|file\.txt|https|example|assets|diagram\.svg|guide-id|Guide title|Keep title/);
  assert.match(sent, /the helpful guide/);
  assert.match(sent, /a useful diagram/);
  assert.match(sent, /reference label/);
  assert.ok(protectedText(parts).includes('](https://example.com/a_(b)?lang=en "Guide title")'));
});

test('HTML 与 XML 标签、跨行注释及 Markdown 结构原样保留', () => {
  const body = '<section title="a > b"><skill:rule enabled="yes">Read this text.</skill:rule></section>\n<!-- hidden\nmultiline words -->\n| Name | Meaning |\n| :--- | ---: |\n| **File** | Read &amp; write |\n\n---\nTitle\n=====\n';
  const parts = verify(body, 40);
  const sent = translated(parts);
  assert.match(sent, /Read this text/);
  assert.match(sent, /Meaning/);
  assert.doesNotMatch(sent, /section|title=|skill:rule|enabled|hidden|multiline|amp/);
  assert.ok(protectedText(parts).includes('<section title="a > b"><skill:rule enabled="yes">'));
  assert.ok(protectedText(parts).includes('<!-- hidden\nmultiline words -->'));
  const rendered = parts.map(part => part.translatable ? '译文' : part.original).join('');
  assert.ok(rendered.includes('| :--- | ---: |'));
  assert.ok(rendered.endsWith('译文\n=====\n'));
});

test('最小上限仍可重组代理对，非法上限明确拒绝', () => {
  verify('A😀B𠮷C', 1);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => splitTranslationText('正文', limit), RangeError);
  }
});

test('混合正文重复分块保持确定性且不引入占位符', () => {
  const body = '# Read first\n\nUse ``literal ` code`` then [read more](../readme.md).\n\n```\nprivate words\n```\n\n普通文字😀继续阅读。\n';
  for (const limit of [2, 11, 100]) {
    const parts = verify(body, limit);
    assert.ok(parts.every(part => body.includes(part.original)));
    assert.doesNotMatch(translated(parts), /private|literal|readme/);
  }
});
