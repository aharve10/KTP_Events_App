/* ==========================================================================
   Event lifecycle — the "termination system".

   Status is DERIVED, never stored, for anything that can still change. That way
   an event can't get stuck in a stale state just because nobody had the app open
   at the moment a deadline passed. The only things persisted are the inputs:

     threshold          how many "Going" it needs
     decisionDeadline   when we judge it
     startAt            when it actually happens
     override           officer forced it on / killed it early
     outcome            officer's final word on a past event (+ outcomeNote)

   Flow for an event nobody has overridden:

     going >= threshold ................................. CONFIRMED
     going <  threshold, before deadline ................ SCHEDULED  ("collecting")
     going <  threshold, past deadline, before start .... AT_RISK    (warning phase)
     going <  threshold, start time passed .............. CANCELLED_LOW (auto-archive)
     going >= threshold, start time passed .............. HAPPENED
   ========================================================================== */

import { toDate, relative, fmtDate, plural } from "./util.js";

export const S = {
  CONFIRMED:      "confirmed",
  SCHEDULED:      "scheduled",
  AT_RISK:        "at_risk",
  HAPPENED:       "happened",
  CANCELLED_LOW:  "cancelled_low_interest",
  CANCELLED_OTHER:"cancelled_other",
};

/** Officer-settable final outcomes for an event that's already in the past. */
export const OUTCOMES = [
  { id: S.HAPPENED,        label: "Happened" },
  { id: S.CANCELLED_LOW,   label: "Cancelled — low interest" },
  { id: S.CANCELLED_OTHER, label: "Cancelled — other reason" },
];

const META = {
  [S.CONFIRMED]:       { label: "Confirmed",  tone: "go",    past: false },
  [S.SCHEDULED]:       { label: "Collecting", tone: "plain", past: false },
  [S.AT_RISK]:         { label: "At risk",    tone: "risk",  past: false },
  [S.HAPPENED]:        { label: "Happened",   tone: "go",    past: true  },
  [S.CANCELLED_LOW]:   { label: "Cancelled — low interest", tone: "dead", past: true },
  [S.CANCELLED_OTHER]: { label: "Cancelled",  tone: "dead",  past: true },
};

export const statusMeta = (key) => META[key] ?? META[S.SCHEDULED];
export const isCancelled = (key) => key === S.CANCELLED_LOW || key === S.CANCELLED_OTHER;

/**
 * @param {object} ev        event doc (raw Firestore shape)
 * @param {number} goingCount number of "Going" RSVPs
 * @param {Date}   now
 * @returns {{key,label,tone,isPast,needed,met,forced,killed,deadlinePassed,message}}
 */
export function computeStatus(ev, goingCount, now = new Date()) {
  const start    = toDate(ev?.startAt);
  const deadline = toDate(ev?.decisionDeadline) ?? start;
  const threshold = Number.isFinite(ev?.threshold) ? ev.threshold : 0;

  const met    = threshold <= 0 || goingCount >= threshold;
  const needed = Math.max(0, threshold - goingCount);
  const forced = ev?.override === "force";
  const killed = ev?.override === "cancel";

  const started        = start ? now >= start : false;
  const deadlinePassed = deadline ? now >= deadline : false;

  let key;
  if (killed) {
    key = S.CANCELLED_OTHER;
  } else if (started) {
    // Past events: an explicit officer outcome always wins over the derived one.
    key = ev?.outcome ?? (forced || met ? S.HAPPENED : S.CANCELLED_LOW);
  } else if (forced || met) {
    key = S.CONFIRMED;
  } else if (deadlinePassed) {
    key = S.AT_RISK;
  } else {
    key = S.SCHEDULED;
  }

  const meta = statusMeta(key);
  return {
    key,
    label: meta.label,
    tone: meta.tone,
    isPast: started || killed,
    started,
    needed, met, forced, killed, deadlinePassed,
    threshold,
    goingCount,
    message: buildMessage(key, { needed, threshold, deadline, start, forced, killed, ev, now }),
  };
}

function buildMessage(key, c) {
  switch (key) {
    case S.AT_RISK:
      return `Needs ${plural(c.needed, "more person", "more people")} by ${fmtDate(c.start)} or this won't happen.`;
    case S.SCHEDULED:
      return c.needed > 0
        ? `Needs ${plural(c.needed, "more person", "more people")} by ${fmtDate(c.deadline)} (${relative(c.deadline, c.now)}).`
        : "";
    case S.CONFIRMED:
      return c.forced && c.needed > 0
        ? "An officer confirmed this — it's happening regardless of the count."
        : "Threshold met — this is on.";
    case S.CANCELLED_LOW:
      return `Cancelled — only reached ${c.ev?.counts?.going ?? 0} of ${c.threshold} needed.`;
    case S.CANCELLED_OTHER:
      return c.ev?.outcomeNote || "Cancelled by an officer.";
    default:
      return "";
  }
}

/**
 * Sort key for the home list: most urgent first, then soonest.
 * At-risk floats to the top because that's the one people can still act on.
 */
export function upcomingSortKey(ev, status) {
  const rank = status.key === S.AT_RISK ? 0 : 1;
  const t = toDate(ev.startAt)?.getTime() ?? Infinity;
  return rank * 1e15 + t;
}

/** Was this event created within the last `days` days? */
export function isNewlyAdded(ev, days, now = new Date()) {
  const created = toDate(ev?.createdAt);
  if (!created) return false;
  return now - created <= days * 86400000;
}

/* --------------------------------------------------------------------------
   Recurring series → concrete occurrence dates.
   -------------------------------------------------------------------------- */

/**
 * Occurrence datetimes for a series between `from` and `until`, inclusive.
 * `anchorAt` is the first occurrence and defines both the time of day and the
 * weekday/day-of-month. Cadence steps forward from there so instances never
 * drift, even if generation is skipped for weeks.
 */
export function seriesOccurrences(series, from, until) {
  const anchor = toDate(series?.anchorAt);
  if (!anchor) return [];

  const ends = toDate(series?.endsAt);
  const hardStop = ends && ends < until ? ends : until;
  if (hardStop < from) return [];

  const out = [];
  const cadence = series.cadence || "weekly";
  const stepDays = cadence === "weekly" ? 7 : cadence === "biweekly" ? 14 : 0;

  if (stepDays > 0) {
    const cur = new Date(anchor);
    // Jump forward in whole cadence steps rather than looping day by day.
    if (cur < from) {
      const steps = Math.ceil((from - cur) / (stepDays * 86400000));
      cur.setDate(cur.getDate() + steps * stepDays);
    }
    let guard = 0;
    while (cur <= hardStop && guard++ < 400) {
      if (cur >= from) out.push(new Date(cur));
      cur.setDate(cur.getDate() + stepDays);
    }
  } else {
    // monthly — same day-of-month, clamped for short months
    const dom = anchor.getDate();
    const cur = new Date(anchor);
    let guard = 0;
    while (cur <= hardStop && guard++ < 120) {
      if (cur >= from) out.push(new Date(cur));
      const y = cur.getFullYear(), m = cur.getMonth();
      const lastOfNext = new Date(y, m + 2, 0).getDate();
      cur.setFullYear(y, m + 1, Math.min(dom, lastOfNext));
    }
  }
  return out;
}

export const CADENCES = [
  { id: "weekly",   label: "Every week" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly",  label: "Every month" },
];
