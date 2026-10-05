// Reproducible import of openly licensed exercise metadata. Generated data is
// checked in so browsing and instructions work without an API or connection.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const text = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const equipment = {
  'body only': 'none', bodyweight: 'none', dumbbell: 'dumbbells', dumbbells: 'dumbbells',
  barbell: 'barbell', cable: 'cable_machine', cables: 'cable_machine', kettlebells: 'kettlebells', kettlebell: 'kettlebells',
  bands: 'resistance_bands', 'sz-bar': 'ez_bar', 'e-z curl bar': 'ez_bar', machine: 'machine',
  'exercise ball': 'stability_ball', 'medicine ball': 'medicine_ball', 'foam roll': 'foam_roller',
  bench: 'bench', 'incline bench': 'bench', 'pull-up bar': 'pull_up_bar',
};
const categoryForMuscle = (m) => {
  if (/chest|pectoral/i.test(m)) return 'Chest';
  if (/biceps femoris|hamstring/i.test(m)) return 'Legs';
  if (/bicep|tricep|forearm/i.test(m)) return 'Arms';
  if (/shoulder|delt/i.test(m)) return 'Shoulders';
  if (/abdom|abs|oblique|core/i.test(m)) return 'Core';
  if (/glute/i.test(m)) return 'Glutes';
  if (/quad|hamstring|calf|calves|adductor|abductor/i.test(m)) return 'Legs';
  return 'Back';
};
async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
const [free, wger, licenseResponse, revision] = await Promise.all([
  json('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'),
  json('https://wger.de/api/v2/exerciseinfo/?limit=1000'),
  json('https://wger.de/api/v2/license/?limit=100'),
  json('https://api.github.com/repos/yuhonas/free-exercise-db/commits/main'),
]);
if (wger.next) throw new Error('wger exceeds page size; add pagination before importing');
const licenses = new Map(licenseResponse.results.map(l => [l.id, l]));
const allowed = (l) => l && /creativecommons.org\/(licenses\/(by|by-sa)\/|publicdomain\/)/.test(l.url);
const source = (provider, url, license, author) => ({ provider, url, license: license.short_name, licenseUrl: license.url, author });
const entries = [];
for (const ex of free) {
  const primary = title(ex.primaryMuscles[0] || 'Full body');
  entries.push({
    id: `free_${ex.id}`, name: ex.name,
    category: ex.category === 'cardio' ? 'Cardio' : ex.category === 'stretching' ? 'Mobility' : categoryForMuscle(primary),
    muscleGroup: primary, primaryMuscle: primary, secondaryMuscles: ex.secondaryMuscles.map(title),
    equipment: [equipment[ex.equipment] || 'other'], difficulty: ex.level === 'expert' ? 'advanced' : ex.level || 'intermediate',
    type: ex.category === 'stretching' ? 'mobility' : ex.category === 'cardio' ? 'cardio' : ex.mechanic || 'compound',
    sets: 3, reps: ex.category === 'stretching' ? '20-30s' : '8-12', restSeconds: 60,
    notes: ex.instructions.join('\n\n'), images: ex.images.map(p => `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${revision.sha}/exercises/${p}`),
    source: { provider: 'Free Exercise DB', url: `https://github.com/yuhonas/free-exercise-db/blob/${revision.sha}/exercises/${ex.id}.json`, license: 'Unlicense', licenseUrl: 'https://unlicense.org/', author: 'Free Exercise DB contributors' },
  });
}
const seen = new Map(entries.map(e => [normalize(e.name), e]));
for (const ex of wger.results) {
  const en = ex.translations.find(t => t.language === 2);
  const license = licenses.get(en?.license);
  if (!en?.name || !allowed(license)) continue;
  const primary = ex.muscles[0]?.name_en || ex.muscles[0]?.name || 'Full body';
  const video = (ex.videos || []).filter(v => allowed(licenses.get(v.license)) && v.video.startsWith('https://'))
    .sort((a, b) => (a.codec === 'h264' ? -1 : 0) - (b.codec === 'h264' ? -1 : 0) || a.size - b.size)[0];
  const entrySource = source('wger', `https://wger.de/en/exercise/${ex.id}/view/`, license, en.license_author || ex.license_author || 'wger contributors');
  const demo = video ? { url: video.video, durationSeconds: Number(video.duration), source: source('wger', `https://wger.de/en/exercise/${ex.id}/view/`, licenses.get(video.license), video.license_author || 'wger contributors') } : undefined;
  const existing = seen.get(normalize(en.name));
  if (existing) {
    if (demo) existing.demo = demo;
    continue;
  }
  const entry = {
    id: `wger_${ex.id}`, name: en.name,
    category: /cardio/i.test(ex.category.name) ? 'Cardio' : categoryForMuscle(primary),
    muscleGroup: primary, primaryMuscle: primary,
    secondaryMuscles: ex.muscles_secondary.map(m => m.name_en || m.name),
    equipment: ex.equipment.length ? ex.equipment.map(e => equipment[e.name.toLowerCase()] || 'other') : ['other'],
    // wger does not supply an experience rating or compound/isolation label.
    difficulty: 'unrated', type: /cardio/i.test(ex.category.name) ? 'cardio' : 'unspecified',
    sets: 3, reps: '8-12', restSeconds: 60, notes: text(en.description), source: entrySource, demo,
  };
  entries.push(entry); seen.set(normalize(entry.name), entry);
}
const target = fileURLToPath(new URL('../artifacts/mobile/data/importedExercises.json', import.meta.url));
await writeFile(target, JSON.stringify(entries, null, 2) + '\n');
console.log(JSON.stringify({ entries: entries.length, freeRevision: revision.sha, wgerVideos: entries.filter(e => e.demo).length, sourceCounts: entries.reduce((a,e) => ({...a,[e.source.provider]: (a[e.source.provider] || 0)+1}), {}) }));
