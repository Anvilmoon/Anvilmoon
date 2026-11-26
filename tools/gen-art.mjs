// Generate game art with OpenAI's image model. Run on your own computer only:
//   node tools/gen-art.mjs <jobs.json> [outDir]        (ART_PARALLEL=4 runs up to 4 requests at once)
// jobs.json is a list of { "name": "workshop_bg", "prompt": "...", "size": "1536x1024", "transparent": false, "quality": "medium" }.
// Optional "ref": a reference image path (or a list of paths, relative to the repo root or absolute). A job with a ref
// goes to the image edits endpoint with the reference attached, so it can copy that picture's style.
// A job whose output file already exists is skipped (delete the file to generate it again).
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

const PARALLEL = Math.max(1, Math.min(8, Number(process.env.ART_PARALLEL) || 1));
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const exists = (f) => readFile(f).then(() => true, () => false);

async function run(j) {
  const f = path.join(out, `${j.name}.png`);
  if (await exists(f)) { console.log(`${j.name}: ${path.relative(ROOT, f)} exists, skipped`); return; }
  const size = j.size || '1024x1024', quality = j.quality || 'medium';
  const refs = j.ref ? [].concat(j.ref) : [];
  let req;
  if (refs.length) {
    // image edits: multipart form with the reference image(s)
    const form = new FormData();
    form.append('model', MODEL); form.append('prompt', j.prompt); form.append('size', size); form.append('quality', quality); form.append('n', '1');
    if (j.transparent) { form.append('background', 'transparent'); form.append('output_format', 'png'); }
    for (const p of refs) form.append(refs.length > 1 ? 'image[]' : 'image', new Blob([await readFile(abs(p))], { type: 'image/png' }), path.basename(p));
    req = { url: 'https://api.openai.com/v1/images/edits', init: { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form } };
  } else {
    const body = { model: MODEL, prompt: j.prompt, size, quality, n: 1 };
    if (j.transparent) { body.background = 'transparent'; body.output_format = 'png'; }
    req = { url: 'https://api.openai.com/v1/images/generations', init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) } };
  }
  const t0 = Date.now();
  let r, x = {};
  try { r = await fetch(req.url, req.init); x = await r.json().catch(() => ({})); } catch (e) { r = { ok: false, status: 'network' }; x = { error: { message: e.message } }; }
  // one line per API call, so a batch's spend can be counted (never the key)
  await writeFile(path.join(out, 'calls.log'), `${new Date().toISOString()} ${j.name} ${r.status}
`, { flag: 'a' });
  if (!r.ok) { console.log(`${j.name}: failed (${r.status}) ${String(x.error && x.error.message || '').replace(/sk-[\w*-]+/g, 'sk-***')}`); return; }
  const b64 = x.data && x.data[0] && x.data[0].b64_json;
  if (!b64) { console.log(`${j.name}: no image in the answer`); return; }
  await writeFile(f, Buffer.from(b64, 'base64'));
  console.log(`${j.name}: saved ${path.relative(ROOT, f)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const queue = jobs.slice();
await Promise.all(Array.from({ length: PARALLEL }, async () => { while (queue.length) await run(queue.shift()); }));
