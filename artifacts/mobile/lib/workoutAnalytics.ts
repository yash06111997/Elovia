import type { ExerciseLog, PersonalRecord, SetLog, WorkoutSession } from "@/context/WorkoutContext";
import { findExercise } from "@/utils/exerciseDatabase";

export const workingSets = (sets: SetLog[]) => sets.filter(s => s.completed && s.setType !== "warmup" && Number.isFinite(s.reps) && Number.isInteger(s.reps) && s.reps > 0 && Number.isFinite(s.weightKg) && s.weightKg >= 0);
export function summarizeSets(sets: SetLog[]) {
  const valid = workingSets(sets);
  return { sets: valid.length, reps: valid.reduce((n, s) => n + s.reps, 0), volume: valid.reduce((n, s) => n + s.reps * s.weightKg, 0), maxWeight: Math.max(0, ...valid.map(s => s.weightKg)), maxReps: Math.max(0, ...valid.map(s => s.reps)), setVolume: Math.max(0, ...valid.map(s => s.weightKg * s.reps)) };
}
export function summarizeSession(session: WorkoutSession) {
  return summarizeSets(session.exerciseLogs.flatMap(l => l.sets));
}
export type RecordKind = "weight" | "reps" | "setVolume" | "sets" | "totalReps" | "totalVolume" | "workoutVolume" | "workoutSets" | "workoutReps";
export interface RecordAchievement { key: string; kind: RecordKind; exerciseName: string; value: number; previous: number; unit: string; label: string }
export type RecordBaseline = Record<string, number>;
const fields = [
  ["weight", "maxWeight", "Heaviest weight", "kg"], ["reps", "maxReps", "Most reps in a set", "reps"],
  ["setVolume", "setVolume", "Best set volume", "kg"], ["sets", "sets", "Most working sets", "sets"],
  ["totalReps", "reps", "Most reps in an exercise", "reps"], ["totalVolume", "volume", "Best exercise volume", "kg"],
] as const;
function mergedLogs(logs: ExerciseLog[]): ExerciseLog[] {
  const map = new Map<string, ExerciseLog>();
  for (const log of logs) {
    const existing = map.get(log.exerciseId);
    map.set(log.exerciseId, existing ? { ...existing, sets: [...existing.sets, ...log.sets] } : log);
  }
  return [...map.values()];
}
export function sessionRecordValues(session: WorkoutSession): RecordAchievement[] {
  const records: RecordAchievement[] = [];
  for (const log of mergedLogs(session.exerciseLogs)) {
    const totals = summarizeSets(log.sets);
    for (const [kind, field, label, unit] of fields) records.push({ key: `${log.exerciseId}:${kind}`, kind, label, unit, exerciseName: log.exerciseName, value: totals[field], previous: 0 });
  }
  const totals = summarizeSession(session);
  for (const [kind, field, label, unit] of [["workoutVolume", "volume", "Total workout volume", "kg"], ["workoutSets", "sets", "Total workout sets", "sets"], ["workoutReps", "reps", "Total workout reps", "reps"]] as const) {
    records.push({ key: `workout:${kind}`, kind, label, unit, exerciseName: "Whole workout", value: totals[field], previous: 0 });
  }
  return records;
}
export function recordBaseline(sessions: WorkoutSession[], records: PersonalRecord[] = []): RecordBaseline {
  const baseline: RecordBaseline = {};
  for (const session of sessions.filter(s => s.completed)) for (const record of sessionRecordValues(session)) baseline[record.key] = Math.max(baseline[record.key] || 0, record.value);
  for (const pr of records) {
    for (const [kind, value] of [["weight", pr.maxWeightKg], ["reps", pr.maxReps], ["setVolume", pr.bestVolume], ["sets", pr.maxSets], ["totalReps", pr.maxTotalReps], ["totalVolume", pr.maxTotalVolume]] as const) {
      baseline[`${pr.exerciseId}:${kind}`] = Math.max(baseline[`${pr.exerciseId}:${kind}`] || 0, value || 0);
    }
  }
  return baseline;
}
/** Updates high-water marks, so ties, deleting/re-adding and editing cannot replay celebrations. */
export function detectRecords(session: WorkoutSession, baseline: RecordBaseline) {
  const next = { ...baseline };
  const achievements: RecordAchievement[] = [];
  for (const record of sessionRecordValues(session)) {
    const previous = baseline[record.key] || 0;
    if (record.value > previous) {
      next[record.key] = record.value;
      achievements.push({ ...record, previous });
    }
  }
  return { achievements, baseline: next };
}
export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms", "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Other"];
function group(muscle: string) {
  const m = muscle.toLowerCase();
  if (/hamstring|biceps femoris/.test(m)) return "Hamstrings";
  if (/pector|chest/.test(m)) return "Chest";
  if (/bicep|brachialis/.test(m)) return "Biceps";
  if (/tricep/.test(m)) return "Triceps";
  if (/forearm/.test(m)) return "Forearms";
  if (/delt|shoulder/.test(m)) return "Shoulders";
  if (/quad/.test(m)) return "Quads";
  if (/glute/.test(m)) return "Glutes";
  if (/calv|calf|gastrocnemius|soleus/.test(m)) return "Calves";
  if (/abdom|abs|oblique|core/.test(m)) return "Core";
  if (/lat|back|trap|rhomboid/.test(m)) return "Back";
  return "Other";
}
export interface MuscleSession { sessionId: string; date: string; name: string; volume: number; sets: number; reps: number; exercises: { id: string; name: string; volume: number; sets: number; reps: number }[] }
/** Attribute each set once, to its primary muscle. Secondary muscles are not double-counted. */
export function muscleHistory(sessions: WorkoutSession[], muscle: string): MuscleSession[] {
  return sessions.filter(s => s.completed).map(session => {
    const exercises = mergedLogs(session.exerciseLogs).filter(log => group(log.primaryMuscle || findExercise(log.exerciseId, log.exerciseName)?.primaryMuscle || "") === muscle).map(log => ({ id: log.exerciseId, name: log.exerciseName, ...summarizeSets(log.sets) })).filter(e => e.sets > 0);
    return { sessionId: session.id, date: session.date, name: session.workoutDayName, exercises, volume: exercises.reduce((n,e) => n + e.volume, 0), sets: exercises.reduce((n,e) => n + e.sets, 0), reps: exercises.reduce((n,e) => n + e.reps, 0) };
  }).filter(s => s.sets > 0).sort((a,b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId, undefined, { numeric: true }));
}
