/**
 * Set up a coach so the in-app booking screen has something to offer.
 *
 * Until a row exists in `coach_profiles`, /api/coaching/slots correctly reports
 * that nobody is accepting clients and the booking screen stays empty. This is
 * the one-off that turns an existing account into the coach.
 *
 * Run from the repo root, with DATABASE_URL pointing at the live database:
 *
 *   COACH_EMAIL=you@example.com COACH_NAME="Your Name" \
 *   COACH_TZ=Asia/Karachi COACH_SLOTS="1@09:00,3@09:00,5@17:30" \
 *   node lib/db/scripts/seed-coach.mjs
 *
 * COACH_SLOTS is weekday@HH:MM, comma separated, where 0 is Sunday. Times are
 * WALL-CLOCK in COACH_TZ — that is the point of storing them this way, so they
 * follow daylight saving instead of drifting an hour twice a year.
 *
 * Re-running updates in place; it never creates duplicate availability.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const {
  DATABASE_URL,
  COACH_EMAIL,
  COACH_NAME,
  COACH_TZ = "UTC",
  COACH_SLOTS = "1@09:00,3@09:00,5@09:00",
  COACH_MEETING_URL = "",
  COACH_SESSION_MINS = "45",
} = process.env;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!DATABASE_URL) fail("DATABASE_URL is not set.");
if (!COACH_EMAIL) fail("COACH_EMAIL is required — it identifies which existing account becomes the coach.");

// Validate the timezone before writing it. A typo here produces availability
// that expands to nothing, with no error anywhere to explain why.
try {
  new Intl.DateTimeFormat("en-US", { timeZone: COACH_TZ });
} catch {
  fail(`COACH_TZ "${COACH_TZ}" is not a valid IANA timezone (e.g. Europe/London, Asia/Karachi).`);
}

const rules = COACH_SLOTS.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^([0-6])@([01]?\d|2[0-3]):([0-5]\d)$/.exec(entry);
    if (!match) fail(`COACH_SLOTS entry "${entry}" is malformed. Expected weekday@HH:MM, e.g. 2@09:30.`);
    return {
      weekday: Number(match[1]),
      startMinute: Number(match[2]) * 60 + Number(match[3]),
      label: entry,
    };
  });

if (rules.length === 0) fail("COACH_SLOTS produced no availability.");

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

await client.connect();

try {
  const { rows } = await client.query(
    `SELECT id, email, first_name FROM users WHERE lower(email) = lower($1)`,
    [COACH_EMAIL],
  );

  if (rows.length === 0) {
    fail(
      `No account found for ${COACH_EMAIL}. Sign in to the app with that address first, ` +
        `then run this again — the coach must be a real user row.`,
    );
  }

  const user = rows[0];
  const displayName = COACH_NAME || user.first_name || "Your coach";

  // Everything below is one transaction: a profile without availability, or
  // availability without a profile, is a half-configured coach that the API
  // would report as accepting clients with no times to offer.
  await client.query("BEGIN");

  await client.query(
    `INSERT INTO coach_profiles (user_id, display_name, timezone, default_meeting_url, accepting_clients)
     VALUES ($1, $2, $3, NULLIF($4, ''), true)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           timezone = EXCLUDED.timezone,
           default_meeting_url = EXCLUDED.default_meeting_url,
           accepting_clients = true,
           updated_at = now()`,
    [user.id, displayName, COACH_TZ, COACH_MEETING_URL],
  );

  // Retire anything not in this run rather than deleting it, so a slot that is
  // removed today does not cascade-delete sessions already booked into it.
  await client.query(
    `UPDATE coach_availability SET active = false, updated_at = now() WHERE coach_user_id = $1`,
    [user.id],
  );

  for (const rule of rules) {
    await client.query(
      `INSERT INTO coach_availability (id, coach_user_id, weekday, start_minute, duration_mins, timezone, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (coach_user_id, weekday, start_minute) DO UPDATE
         SET duration_mins = EXCLUDED.duration_mins,
             timezone = EXCLUDED.timezone,
             active = true,
             updated_at = now()`,
      [randomUUID(), user.id, rule.weekday, rule.startMinute, Number(COACH_SESSION_MINS), COACH_TZ],
    );
  }

  await client.query("COMMIT");

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  console.log(`\n  Coach set up: ${displayName} <${user.email}>`);
  console.log(`  Timezone: ${COACH_TZ}`);
  console.log(`  Weekly availability (${COACH_SESSION_MINS} min each):`);
  for (const rule of rules) {
    const hh = String(Math.floor(rule.startMinute / 60)).padStart(2, "0");
    const mm = String(rule.startMinute % 60).padStart(2, "0");
    console.log(`    - ${weekdays[rule.weekday]} ${hh}:${mm}`);
  }
  console.log(`\n  Clients can now book from the Coaching screen.\n`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  fail(`Seeding failed: ${err.message}`);
} finally {
  await client.end();
}
