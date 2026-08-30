/* ==========================================================================
   Starter data so the app isn't an empty page on day one.

   Dates are computed relative to whenever you press the button — not baked in —
   so this stays sensible whether you seed today or in January. Everything here
   is a placeholder: edit the times, thresholds and locations to match the real
   athletics schedule and your rush calendar.

   Pressing the button twice is safe: anything whose title already exists is
   skipped.
   ========================================================================== */

import * as store from "./store.js";
import { addDays } from "./util.js";
import { DEFAULTS } from "./config.js";

export const SEED_SUMMARY =
  "weekly Men's Soccer and Football at the Dome as recurring series, a Syracuse Mets Dollar Thursday, and three open brotherhood social slots.";

/** Next occurrence of `dow` (0=Sun) at h:m, strictly in the future. */
function nextWeekday(dow, h, m = 0, weeksOut = 0) {
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let delta = (dow - d.getDay() + 7) % 7;
  if (delta === 0 && d <= now) delta = 7;
  d.setDate(d.getDate() + delta + weeksOut * 7);
  return d;
}

const SERIES = [
  {
    title: "Men's Soccer — SU Soccer Stadium",
    location: "SU Soccer Stadium",
    category: "athletics",
    description: "Home match. Student tickets are free with your SU ID — meet outside the gate 20 minutes before kickoff.",
    cadence: "weekly",
    when: () => nextWeekday(5, 19, 0),   // Friday 7:00 PM
    threshold: 6,
    decisionLeadDays: 1,
    durationMinutes: 150,
  },
  {
    title: "Football at the Dome",
    location: "JMA Wireless Dome",
    category: "athletics",
    description: "Home game. We sit together in the student section — check the group chat for the row.",
    cadence: "weekly",
    when: () => nextWeekday(6, 12, 0),   // Saturday noon
    threshold: 10,
    decisionLeadDays: 2,
    durationMinutes: 240,
  },
];

const EVENTS = [
  {
    title: "Syracuse Mets — Dollar Thursday",
    location: "NBT Bank Stadium",
    category: "social",
    description: "$2 hot dogs, $3 drinks, $1 fountain drinks. Tickets are cheap in the outfield — we'll grab a block once we know the count.",
    when: () => nextWeekday(4, 18, 35),  // Thursday 6:35 PM
    threshold: 8,
  },
  {
    title: "Open brotherhood social slot",
    location: "TBD",
    category: "brotherhood",
    description: "Placeholder — replace with the actual plan. RSVP interest here and we'll pick something that fits the count.",
    when: () => nextWeekday(6, 20, 0, 1),
    threshold: 8,
  },
  {
    title: "Open brotherhood social slot (week 2)",
    location: "TBD",
    category: "brotherhood",
    description: "Placeholder around the rush calendar — swap in the real event once the schedule firms up.",
    when: () => nextWeekday(6, 20, 0, 3),
    threshold: 8,
  },
  {
    title: "Open brotherhood social slot (week 3)",
    location: "TBD",
    category: "brotherhood",
    description: "Placeholder around the rush calendar — swap in the real event once the schedule firms up.",
    when: () => nextWeekday(5, 20, 0, 5),
    threshold: 8,
  },
];

/** @returns {Promise<number>} how many things were actually created */
export async function seedChapterData() {
  const haveSeries = new Set(store.state.series.map((s) => s.title.toLowerCase()));
  const haveEvents = new Set(store.state.events.map((e) => e.title.toLowerCase()));
  let created = 0;

  for (const s of SERIES) {
    if (haveSeries.has(s.title.toLowerCase())) continue;
    await store.createSeries({
      title: s.title,
      description: s.description,
      location: s.location,
      category: s.category,
      cadence: s.cadence,
      anchorAt: s.when(),
      durationMinutes: s.durationMinutes,
      threshold: s.threshold,
      decisionLeadDays: s.decisionLeadDays,
      endsAt: null,
    });
    created++;
  }

  for (const e of EVENTS) {
    if (haveEvents.has(e.title.toLowerCase())) continue;
    const startAt = e.when();
    await store.createEvent({
      title: e.title,
      description: e.description,
      location: e.location,
      category: e.category,
      startAt,
      endAt: null,
      threshold: e.threshold,
      decisionDeadline: addDays(startAt, -DEFAULTS.decisionLeadDays),
    });
    created++;
  }

  return created;
}
