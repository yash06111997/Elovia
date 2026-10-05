import type { WorkoutSession } from "@/context/WorkoutContext";
const cell = (value: string | number) => {
  // Prevent spreadsheet formula injection from user-created workout names.
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${safe.replace(/"/g, '""')}"`;
};
export function workoutsToCsv(sessions: WorkoutSession[]): string {
  const rows: (string | number)[][] = [["session_id", "date", "workout", "duration_minutes", "exercise_id", "exercise", "primary_muscle", "set_number", "set_type", "weight_kg", "reps", "volume_kg"]];
  for (const session of sessions.filter(s => s.completed)) {
    for (const log of session.exerciseLogs) for (const set of log.sets.filter(s => s.completed)) {
      rows.push([session.id, session.date, session.workoutDayName, session.durationMins, log.exerciseId, log.exerciseName, log.primaryMuscle ?? "", set.setNumber, set.setType ?? "normal", set.weightKg, set.reps, set.weightKg * set.reps]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
