import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return walk(path);
  return /\.(css|tsx|ts)$/.test(entry.name) ? [path] : [];
});

const files = walk('src/renderer');
const source = files.filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
const cssFiles = files.filter(f => f.endsWith('.css'));

/** A class is live if the renderer names it, on a word boundary. */
const isUsed = name => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(source);
const classesOf = sel => [...new Set((sel.match(/\.[a-zA-Z][\w-]*/g) || []).map(c => c.slice(1)))];
const isDead = sel => { const c = classesOf(sel); return c.length > 0 && !c.some(isUsed); };

/** Selector text of every top-level rule in a stylesheet, media blocks flattened. */
function ruleSelectors(css) {
  const out = [];
  const scan = (text, from, end) => {
    let depth = 0, start = from, open = -1, quote = null;
    for (let i = from; i < end; i++) {
      const c = text[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') { if (depth === 0) open = i; depth++; continue; }
      if (c === '}') {
        depth--;
        if (depth === 0) {
          const head = text.slice(start, open);
          if (head.trim().startsWith('@') && !head.startsWith('@keyframes') && !head.startsWith('@font-face')) {
            scan(text, open + 1, i);
          } else if (!head.trim().startsWith('@')) {
            out.push({ sel: head.trim(), index: out.length });
          }
          start = i + 1;
        }
      }
    }
  };
  scan(css, 0, css.length);
  return out.map(r => r.sel);
}

/**
 * Two stylesheets were layered on each other and an unused half accumulated: 423 rules styled
 * class names no component ever rendered. Nothing caught it, because unreferenced CSS is still
 * valid CSS and still builds. This fails `npm test` when it starts happening again.
 *
 * The invariant is per rule, not per class name: a selector list like `.a, .b` where only `.a`
 * is live is legitimately kept, and only `.b` is removable from it.
 */
test('no CSS rule styles only classes the renderer never renders', () => {
  const dead = [];
  for (const file of cssFiles) {
    for (const sel of ruleSelectors(readFileSync(file, 'utf8'))) {
      if (isDead(sel)) dead.push(`${file}: ${sel.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(dead, [], `rules with no live class:\n  ${dead.join('\n  ')}`);
});

test('every CSS file is brace-balanced', () => {
  for (const file of cssFiles) {
    let depth = 0;
    for (const char of readFileSync(file, 'utf8')) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
      assert.ok(depth >= 0, `${file}: unbalanced }`);
    }
    assert.equal(depth, 0, `${file}: ${depth} unclosed {`);
  }
});

test('the renderer type-checks', () => {
  execSync('npx tsc --noEmit', { stdio: 'pipe' });
});
