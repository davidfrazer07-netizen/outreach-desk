// "Build" for a no-bundler app: syntax-check every module and confirm each relative import resolves.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['app/assets/js', 'engine', 'worker'];
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.m?js$/.test(f) && files.push(p); });
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`✗ ${f}\n${e.stderr}`); continue; }
  for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
    if (!existsSync(resolve(dirname(f), m[1]))) { bad++; console.error(`✗ ${f}: missing import ${m[1]}`); }
  }
}
const lines = files.map((f) => [f, readFileSync(f, 'utf8').split('\n').length]).filter(([, n]) => n > 500);
lines.forEach(([f, n]) => console.warn(`! ${f} has ${n} lines`));
console.log(`${files.length} files checked, ${bad} problems`);
process.exit(bad ? 1 : 0);
