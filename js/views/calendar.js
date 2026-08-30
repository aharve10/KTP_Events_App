/* ==========================================================================
   Calendar — month grid of everything: past, upcoming, and the recurring
   instances that have already been generated.

   Recurring series are also projected forward past the generation horizon as
   faint "planned" chips, so a chair looking at November in September still
   sees that football Saturdays exist.
   ========================================================================== */

import {
  esc, toDate, startOfDay, addDays, sameDay, dayKey, fmtTime,
  fmtDateFull, DOW_LONG, $$,
} from "../util.js";
import { computeStatus, isCancelled, seriesOccurrences, S } from "../lifecycle.js";
import * as store from "../store.js";
import { eventCard, openModal } from "../components.js";
import { DEFAULTS } from "../config.js";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
let cursor = null; // first of the displayed month

export function render() {
  const now = new Date();
  if (!cursor) cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  const first = new Date(cursor);
  const gridStart = addDays(startOfDay(first), -first.getDay());
  const gridEnd = addDays(gridStart, 41);

  const byDay = buildDayIndex(gridStart, gridEnd, now);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const items = byDay.get(dayKey(d)) || [];
    const isOut = d.getMonth() !== cursor.getMonth();
    const isToday = sameDay(d, now);

    const chips = items.slice(0, 3).map((it) => `
      <span class="cal-chip ${it.tone}" title="${esc(it.title)} — ${esc(fmtTime(it.when))}">${esc(it.title)}</span>`).join("");

    cells.push(`
      <div class="cal-cell ${isOut ? "is-out" : ""} ${isToday ? "is-today" : ""} ${items.length ? "has-events" : ""}"
           ${items.length ? `data-day="${dayKey(d)}" role="button" tabindex="0"` : ""}>
        <span class="cal-daynum">${d.getDate()}</span>
        ${chips}
        ${items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : ""}
      </div>`);
  }

  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return `
    <div class="page-head">
      <h1 class="page-title">Calendar</h1>
      <p class="page-sub">Everything on one grid. Tap a day to see the events and RSVP.</p>
    </div>

    <div class="cal-head">
      <div class="cal-month">${esc(monthName)}</div>
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" data-cal="prev">&larr;</button>
        <button class="btn btn-ghost btn-sm" data-cal="today">Today</button>
        <button class="btn btn-ghost btn-sm" data-cal="next">&rarr;</button>
      </div>
    </div>

    <div class="cal-grid">
      ${DOW.map((d, i) => `<div class="cal-dow" aria-label="${DOW_LONG[i]}">${d}</div>`).join("")}
      ${cells.join("")}
    </div>

    <div class="cal-legend">
      <span><i style="background:var(--go)"></i>Confirmed / happened</span>
      <span><i style="background:var(--blue)"></i>Collecting RSVPs</span>
      <span><i style="background:var(--risk)"></i>At risk</span>
      <span><i style="background:var(--dead)"></i>Cancelled</span>
      <span><i style="background:var(--line-strong)"></i>Planned recurring</span>
    </div>
  `;
}

/** dayKey -> [{title, tone, when, eventId?}] */
function buildDayIndex(from, to, now) {
  const map = new Map();
  const push = (d, item) => {
    const k = dayKey(d);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  };

  const realDays = new Set();

  for (const ev of store.state.events) {
    const when = toDate(ev.startAt);
    if (!when || when < from || when > to) continue;
    const status = computeStatus(ev, store.countsFor(ev.id, ev).going, now);
    const tone = isCancelled(status.key) ? "dead"
      : status.key === S.AT_RISK ? "risk"
      : status.key === S.CONFIRMED || status.key === S.HAPPENED ? "go"
      : "";
    push(when, { title: ev.title, tone, when, eventId: ev.id });
    if (ev.seriesId) realDays.add(`${ev.seriesId}|${dayKey(when)}`);
  }

  // Project active series beyond the generated horizon so future months aren't
  // misleadingly blank. These are display-only — no RSVP until they generate.
  const horizon = addDays(now, DEFAULTS.seriesHorizonDays);
  for (const s of store.state.series) {
    if (s.paused) continue;
    const projFrom = new Date(Math.max(from.getTime(), horizon.getTime()));
    if (projFrom > to) continue;
    for (const when of seriesOccurrences(s, projFrom, to)) {
      if (realDays.has(`${s.id}|${dayKey(when)}`)) continue;
      push(when, { title: s.title, tone: "", when, planned: true });
    }
  }

  map.forEach((list) => list.sort((a, b) => a.when - b.when));
  return map;
}

export function mount(root, rerender) {
  $$("[data-cal]", root).forEach((btn) => btn.addEventListener("click", () => {
    const dir = btn.dataset.cal;
    if (dir === "today") cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + (dir === "next" ? 1 : -1), 1);
    rerender();
  }));

  const openDay = (key) => {
    const d = new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8));
    const body = document.createElement("div");

    // Repaint on store changes: RSVPing from inside this modal has to update the
    // card you just tapped. The main view's re-render doesn't reach in here.
    const paint = () => {
      const events = store.state.events
        .filter((e) => { const t = toDate(e.startAt); return t && dayKey(t) === key; })
        .sort((a, b) => toDate(a.startAt) - toDate(b.startAt));

      const planned = store.state.series
        .filter((s) => !s.paused && seriesOccurrences(s, startOfDay(d), addDays(startOfDay(d), 1)).length)
        .filter((s) => !events.some((e) => e.seriesId === s.id));

      body.innerHTML = `
        ${events.map((ev) => eventCard(ev, { expanded: true })).join("")}
        ${planned.length ? `<div class="note-box" style="margin-top:12px">
          <strong>Planned recurring:</strong> ${esc(planned.map((s) => s.title).join(", "))}.
          RSVPs open about ${DEFAULTS.seriesHorizonDays} days out, when the instance is generated.
        </div>` : ""}
        ${!events.length && !planned.length ? `<div class="empty">Nothing scheduled.</div>` : ""}`;
    };

    paint();
    const stopWatching = store.subscribe(paint);
    openModal(fmtDateFull(d), body, stopWatching);
  };

  $$(".cal-cell[data-day]", root).forEach((cell) => {
    cell.addEventListener("click", () => openDay(cell.dataset.day));
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDay(cell.dataset.day); }
    });
  });
}
