// 修改保护或分块规则时递增版本，避免复用旧规则下的重组结果。
export const TRANSLATION_RULE_VERSION = 'markdown-v1';

const commandStart = /(?:sudo[ \t]+)?(?:(?:npm|pnpm|yarn|bun|git|go|cargo|docker|kubectl|pip3?)[ \t]+(?:install|add|remove|run|exec|test|build|start|dev|init|clone|checkout|switch|status|diff|commit|push|pull|fetch|update|upgrade|publish|pack|uninstall|create|version|mod|fmt|check|compose|apply|get|logs)\b|(?:npx|node|python3?|bash|sh|zsh|curl|wget|cd|mkdir|rm|cp|mv|chmod|cat|ls|echo|printf)\b)/y;
const commandStop = /^(?:and|then|or|to|before|after|for|with|from|in|when|please)$/i;
const urlPattern = /(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)[^\s<>"`\[\]]+/iy;
const pathPattern = /(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}\/|~\/|\/(?!\/)|\$\{?[A-Za-z_][\w]*\}?[\\/])[^\s<>"'`|,;，。；]+|(?:[\w@.-]+[\\/])+[\w@./\\-]+|[\w@-]+\.(?:md|mdx|mjs|cjs|js|jsx|ts|tsx|json|ya?ml|toml|sh|py|txt|html|css|lock)\b/uy;
const tagPattern = /<!--[^]*?-->|<\?[^]*?\?>|<!\[CDATA\[[^]*?\]\]>|<![A-Za-z][^>]*>|<\/?[A-Za-z][\w:.-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>|<[^\s<>]+@[^\s<>]+>/y;

function addRange(ranges, start, end) {
  if (end > start) {
    ranges.push([start, end]);
  }
}

function balancedEnd(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === open) {
      depth += 1;
    } else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

function commandEnd(text, start) {
  commandStart.lastIndex = start;
  const match = commandStart.exec(text);
  if (!match || (start > 0 && /[\p{L}\p{N}_]/u.test(text[start - 1]))) {
    return start;
  }
  let end = commandStart.lastIndex;
  const argument = /[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;!?，。；]+)/y;
  while (end < text.length) {
    argument.lastIndex = end;
    const next = argument.exec(text);
    if (!next || commandStop.test(next[0].trim()) || /[\p{Script=Han}]/u.test(next[0])) {
      break;
    }
    end = argument.lastIndex;
  }
  while (/[.!?:)]/.test(text[end - 1] ?? '')) {
    end -= 1;
  }
  return end;
}

function protectInline(text, offset, ranges) {
  for (let index = 0; index < text.length;) {
    let end = index;
    const char = text[index];
    if (char === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(text[index + 1] ?? '')) {
      end = index + 2;
    } else if (char === '`') {
      const delimiter = /^`+/.exec(text.slice(index))[0];
      let closing = text.indexOf(delimiter, index + delimiter.length);
      while (closing >= 0 && (text[closing - 1] === '`' || text[closing + delimiter.length] === '`')) {
        closing = text.indexOf(delimiter, closing + delimiter.length);
      }
      end = closing < 0 ? index + delimiter.length : closing + delimiter.length;
    } else if (char === ']' && text[index + 1] === '(') {
      const closing = balancedEnd(text, index + 1, '(', ')');
      end = closing < 0 ? index + 1 : closing;
    } else if (char === ']' && /^\][ \t]*\[/.test(text.slice(index))) {
      const start = text.indexOf('[', index + 1);
      const closing = balancedEnd(text, start, '[', ']');
      end = closing < 0 ? index + 1 : closing;
    } else {
      for (const pattern of [urlPattern, tagPattern, pathPattern]) {
        pattern.lastIndex = index;
        const match = pattern.exec(text);
        if (match && (pattern !== pathPattern || index === 0 || !/[\p{L}\p{N}_]/u.test(text[index - 1]))) {
          end = pattern.lastIndex;
          break;
        }
      }
      if (end === index) {
        end = commandEnd(text, index);
      }
      if (end === index && /[\[\]*_~|]/.test(char)) {
        end = index + 1;
      }
      if (end === index && char === '!' && text[index + 1] === '[') {
        end = index + 1;
      }
      if (end === index && char === '&') {
        const entity = /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i.exec(text.slice(index));
        if (entity) {
          end = index + entity[0].length;
        }
      }
    }
    if (end > index) {
      addRange(ranges, offset + index, offset + end);
      index = end;
    } else {
      index += text.codePointAt(index) > 0xffff ? 2 : 1;
    }
  }
}

function protectedRanges(body) {
  const ranges = [];
  let fence;
  let offset = 0;
  let inlineStart = 0;
  // 连续普通行交给行内扫描，允许代码跨度、标签及注释跨行。
  const flushInline = (end) => {
    protectInline(body.slice(inlineStart, end), inlineStart, ranges);
  };
  for (const match of body.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const line = match[0];
    if (!line) {
      continue;
    }
    const content = line.replace(/[\r\n]+$/, '');
    const container = /^(?: {0,3}>[ \t]?)* {0,3}/.exec(content)[0];
    const plain = content.slice(container.length);
    const opening = /^(`{3,}|~{3,})(.*)$/.exec(plain);
    let protectedLine = false;
    if (fence) {
      protectedLine = true;
      if (opening && opening[1][0] === fence.char && opening[1].length >= fence.size && !opening[2].trim()) {
        fence = undefined;
      }
    } else if (opening && (opening[1][0] === '~' || !opening[2].includes('`'))) {
      fence = { char: opening[1][0], size: opening[1].length };
      protectedLine = true;
    } else if (/^(?: {4}|\t)/.test(content) || /^ {0,3}\[[^\]]+\]:/.test(content) || /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|[=-]+[ \t]*|\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?)[ \t]*$/.test(content)) {
      protectedLine = true;
    } else if (/^(?:\$|PS [^>]+>)[ \t]+/.test(plain) || commandEnd(plain, 0) > 0) {
      protectedLine = true;
    }
    if (protectedLine) {
      flushInline(offset);
      addRange(ranges, offset, offset + line.length);
      inlineStart = offset + line.length;
    } else {
      const prefix = /^(?:(?: {0,3}>[ \t]?)+)?[ \t]*(?:(?:#{1,6}|[-+*]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?/.exec(content)[0];
      addRange(ranges, offset, offset + prefix.length);
      const suffix = /[ \t]+#+[ \t]*$/.exec(content);
      if (suffix && /^ {0,3}#{1,6}[ \t]/.test(content)) {
        addRange(ranges, offset + suffix.index, offset + content.length);
      }
      addRange(ranges, offset + content.length, offset + line.length);
    }
    offset += line.length;
  }
  flushInline(body.length);
  return ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

function appendProtected(parts, original) {
  if (!original) {
    return;
  }
  const previous = parts.at(-1);
  if (previous && !previous.translatable) {
    previous.original += original;
  } else {
    parts.push({ original, translatable: false });
  }
}

function appendText(parts, original, maxTextChars) {
  const leading = /^\s*/.exec(original)[0];
  appendProtected(parts, leading);
  let remaining = original.slice(leading.length);
  const trailing = /\s*$/.exec(remaining)[0];
  remaining = remaining.slice(0, remaining.length - trailing.length);
  while (remaining.length) {
    let end = Math.min(remaining.length, maxTextChars);
    if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end])) {
      end -= 1;
    }
    if (end === 0) {
      // 上限为一时，代理对无法作为翻译输入，仍需完整保留。
      appendProtected(parts, remaining.slice(0, 2));
      remaining = remaining.slice(2);
      continue;
    }
    if (end < remaining.length) {
      const candidate = remaining.slice(0, end);
      const boundaries = [...candidate.matchAll(/[。！？.!?](?:\s+|$)|\s+/gu)];
      const boundary = boundaries.at(-1);
      if (boundary && boundary.index > 0) {
        end = boundary.index + boundary[0].length;
      }
    }
    const chunk = remaining.slice(0, end);
    const text = chunk.trim();
    if (text && /[\p{L}\p{N}]/u.test(text)) {
      const start = chunk.indexOf(text);
      appendProtected(parts, chunk.slice(0, start));
      parts.push({ original: text, translatable: true });
      appendProtected(parts, chunk.slice(start + text.length));
    } else {
      appendProtected(parts, chunk);
    }
    remaining = remaining.slice(end);
  }
  appendProtected(parts, trailing);
}

// 上限使用 translator 的 UTF-16 字符数；保护片段不受服务请求长度限制。
export function splitTranslationText(body, maxTextChars) {
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars < 1) {
    throw new RangeError('翻译分块上限必须是正整数');
  }
  const parts = [];
  let offset = 0;
  for (const [start, end] of protectedRanges(body)) {
    if (start > offset) {
      appendText(parts, body.slice(offset, start), maxTextChars);
    }
    if (end > offset) {
      appendProtected(parts, body.slice(Math.max(offset, start), end));
      offset = end;
    }
  }
  appendText(parts, body.slice(offset), maxTextChars);
  return parts;
}
