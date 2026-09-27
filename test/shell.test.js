import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the offline copy lists every script, and only files that exist', async () => {
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of await readdir(join(root, 'js'))) if (f.endsWith('.js')) assert.ok(shell.includes(`js/${f}`), `sw.js is missing js/${f}`);
  for (const f of shell.filter(f => f !== './')) await access(join(root, f));
});
