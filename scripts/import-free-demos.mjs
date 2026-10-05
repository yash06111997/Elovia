// Snapshot only the publisher's explicitly free clips. No account, payment,
// paid catalogue, video download or standalone media redistribution.
import { writeFile } from 'node:fs/promises';
const page = 'https://ymove.app/free-exercise-videos';
const response = await fetch(page, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Free demo source returned ${response.status}`);
const html = await response.text();
if (!html.includes('Free for commercial use') || !html.includes('Do not resell')) {
  throw new Error('License text changed; review the publisher terms before importing');
}
const next = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
if (!next) throw new Error('Publisher metadata format changed');
const exercises = JSON.parse(next[1]).props.pageProps.exercises;
const names = [
  'Barbell Back Squat', 'Barbell Bench Press', 'Barbell Deadlift',
  'Dumbbell Lateral Raise', 'Hammer Curls', 'Dumbbell Goblet Squat',
  'Kettlebell swing', 'Lat Pulldown with V-Grip', 'Seated Cable Row Neutral Grip',
  'Pec Deck Fly', 'Cable Tricep Pushdown', 'Overhead Cable Rope Extension',
  'Machine Bicep Curl', 'High Cable Curl', 'Leg Extension', 'Hack Squat',
  'Lying Leg Curl', 'Cable Woodchop (High to Low)',
];
const manifest = {};
for (const name of names) {
  const matches = exercises.filter(e => e.title === name);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous clip: ${name}`);
  const clip = matches[0];
  const url = new URL(clip.videoUrl);
  if (url.origin !== 'https://ymove.app' || !/^\/api\/free\/[\da-f-]{36}$/.test(url.pathname) || url.search) {
    throw new Error(`Not an explicitly free media endpoint: ${name}`);
  }
  // This public route rejects HEAD. A ranged GET checks native streaming
  // headers without saving media or downloading the whole source clip.
  const media = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
  const usable = media.ok && media.headers.get('content-type')?.startsWith('video/');
  await media.body?.cancel();
  if (!usable) {
    throw new Error(`Unavailable media: ${name} (${media.status})`);
  }
  manifest[name] = { url: clip.videoUrl, source: {
    provider: 'YMove', author: 'Your Move B.V.', url: page,
    license: 'Free commercial in-app use; no standalone redistribution',
    licenseUrl: page,
  } };
}
await writeFile(new URL('../artifacts/mobile/data/freeExerciseDemos.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ freeClips: names.length, streamingHeadersVerified: true, licenseCheckedAt: new Date().toISOString() }));
