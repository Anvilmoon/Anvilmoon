// Generate game art with OpenAI's image model. Run on your own computer only:
//   node tools/gen-art.mjs <jobs.json> [outDir]
// jobs.json is a list of { "name": "workshop_bg", "prompt": "...", "size": "1536x1024", "transparent": false, "quality": "medium" }.
// The API key is read from the git-ignored .env file in the repo root (OPENAI_API_KEY=...). It is never printed.
// Each image costs money, so the script refuses more than MAX_JOBS jobs per run.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JOBS = 30;
const MODEL = process.env.ART_MODEL || 'gpt-image-2';

async function apiKey() {
  const env = await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
  const m = env.match(/^\s*OPENAI_API_KEY\s*=\s*(\S+)/m);
  if (!m) throw new Error('No OPENAI_API_KEY line in .env');
  return m[1].replace(/^["']|["']$/g, '');
}

const [jobsFile, outArg] = process.argv.slice(2);
if (!jobsFile) { console.log('usage: node tools/gen-art.mjs <jobs.json> [outDir]'); process.exit(1); }
const jobs = JSON.parse(await readFile(jobsFile, 'utf8'));
if (jobs.length > MAX_JOBS) throw new Error(`${jobs.length} jobs is more than the ${MAX_JOBS} allowed in one run.`);
const out = outArg || path.join(ROOT, 'art-src');
await mkdir(out, { recursive: true });
const key = await apiKey();

for (const j of jobs) {
  const body = { model: MODEL, prompt: j.prompt, size: j.size || '1024x1024', quality: j.quality || 'medium', n: 1 };
  if (j.transparent) { body.background = 'transparent'; body.output_format = 'png'; }
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });
  const x = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`${j.name}: failed (${r.status}) ${x.error && x.error.message || ''}`); continue; }
  const b64 = x.data && x.data[0] && x.data[0].b64_json;
  if (!b64) { console.log(`${j.name}: no image in the answer`); continue; }
  const f = path.join(out, `${j.name}.png`);
  await writeFile(f, Buffer.from(b64, 'base64'));
  console.log(`${j.name}: saved ${path.relative(ROOT, f)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
