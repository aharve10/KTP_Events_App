/* ==========================================================================
   Previous Events — the continuity tool.

   The point of this page is pattern-spotting for whoever has the job next:
   filter by type and date range, and the summary strip tells you the average
   turnout for exactly that slice. "Bowling nights pull 15+, weekday trivia
   never breaks 8" should be two clicks, not a survey.
   ========================================================================== */

import { esc, toDate, fromDateInput, toDateInput, addDays, $, $$ } from "../util.js";
import { computeStatus, isCancelled, S } from "../lifecycle.js";
import * as store from "../store.js";
import { eventCard, emptyState, sectionHead, categoryLabel } from "../components.js";
import { CATEGORIES } from "../config.js";

/* Filter state persists while the app is open so re-renders don't reset it. */
const filters = { category: "", from: "", to: "", outcome: "", q: "" };

export function render() {
  const now = new Date();

  const past = store.state.events
    .filter((e) => {
      const start = toDate(e.startAt);
      if (!start) return false;
      const status = computeStatus(e, store.countsFor(e.id, e).going, now);
      return status.isPast;
    })
    .map((e) => ({ ev: e, status: computeStatus(e, store.countsFor(e.id, e).going, now) }))
    .sort((a, b) => toDate(b.ev.startAt) - toDate(a.ev.startAt));

  const shown = past.filter(({ ev, status }) => {
    if (filters.category && ev.category !== filters.category) return false;
    if (filters.outcome === "happened" && status.key !== S.HAPPENED) return false;
    if (filters.outcome === "cancelled" && !isCancelled(status.key)) return false;
    if (filters.outcome === "low" && status.key !== S.CANCELLED_LOW) return false;
    const start = toDate(ev.startAt);
    const from = fromDateInput(filters.from);
    const to = fromDateInput(filters.to, true);
    if (from && start < from) return false;
    if (to && start > to) return false;
    if (filters.q) {
      const hay = `${ev.title} ${ev.location} ${ev.description}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  });

  return `
    <div class="page-head">
      <h1 class="page-title">Previous events</h1>
      <p class="page-sub">
        Everything that already happened, with what it drew. Filter it to see what actually works
        before you plan the same thing again.
      </p>
    </div>

    ${filterBar()}
    ${statsStrip(shown)}

    <section class="section">
      ${sectionHead("Archive", `${shown.length} of ${past.length}`)}
      ${shown.length
        ? shown.map(({ ev }) => eventCard(ev, { archive: true, expanded: true })).join("")
        : past.length
          ? emptyState("No past events match those filters.", "Try widening the date range or clearing the type filter.")
          : emptyState("Nothing in the archive yet.", "Events land here automatically once their date passes.")}
    </section>
  `;
}

function filterBar() {
  const cats = CATEGORIES.map((c) =>
    `<option value="${esc(c.id)}" ${filters.category === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("");
  return `
    <div class="filters" id="past-filters">
      <label class="field">
        <span class="field-label">Type</span>
        <select name="category"><option value="">All types</option>${cats}</select>
      </label>
      <label class="field">
        <span class="field-label">Outcome</span>
        <select name="outcome">
          <option value="">All outcomes</option>
          <option value="happened"  ${filters.outcome === "happened" ? "selected" : ""}>Happened</option>
          <option value="cancelled" ${filters.outcome === "cancelled" ? "selected" : ""}>Cancelled (any)</option>
          <option value="low"       ${filters.outcome === "low" ? "selected" : ""}>Cancelled — low interest</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">From</span>
        <input type="date" name="from" value="${esc(filters.from)}" />
      </label>
      <label class="field">
        <span class="field-label">To</span>
        <input type="date" name="to" value="${esc(filters.to)}" />
      </label>
      <label class="field">
        <span class="field-label">Search</span>
        <input type="search" name="q" value="${esc(filters.q)}" placeholder="bowling, trivia, Dome…" />
      </label>
      <div class="filters-foot">
        <span class="filters-summary" id="filters-summary"></span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-range="90">Last 90 days</button>
          <button class="btn btn-ghost btn-sm" data-range="365">Last year</button>
          <button class="btn btn-ghost btn-sm" id="filters-clear">Clear</button>
        </span>
      </div>
    </div>`;
}

/**
 * Turnout summary for the current slice. Averages only count events that
 * actually happened — including cancellations would drag every number down and
 * make the comparison useless.
 */
function statsStrip(rows) {
  const happened = rows.filter((r) => r.status.key === S.HAPPENED);
  const cancelledLow = rows.filter((r) => r.status.key === S.CANCELLED_LOW);
  const withTurnout = happened.filter((r) => r.ev.attendance);

  const avgRsvp = happened.length
    ? Math.round(happened.reduce((n, r) => n + store.countsFor(r.ev.id, r.ev).going, 0) / happened.length)
    : 0;
  const avgTurnout = withTurnout.length
    ? Math.round(withTurnout.reduce((n, r) => n + (r.ev.attendance.count || 0), 0) / withTurnout.length)
    : null;
  const showRate = withTurnout.length
    ? Math.round(100 * withTurnout.reduce((n, r) => n + (r.ev.attendance.count || 0), 0) /
        Math.max(1, withTurnout.reduce((n, r) => n + store.countsFor(r.ev.id, r.ev).going, 0)))
    : null;

  const best = [...happened]
    .filter((r) => r.ev.attendance)
    .sort((a, b) => (b.ev.attendance.count || 0) - (a.ev.attendance.count || 0))[0];

  return `
    <div class="stats">
      <div class="stat"><div class="stat-n">${happened.length}</div><div class="stat-l">Happened</div></div>
      <div class="stat"><div class="stat-n">${cancelledLow.length}</div><div class="stat-l">Low interest</div></div>
      <div class="stat"><div class="stat-n">${avgRsvp}</div><div class="stat-l">Avg RSVP'd</div></div>
      <div class="stat"><div class="stat-n">${avgTurnout ?? "—"}</div><div class="stat-l">Avg turnout</div></div>
      <div class="stat"><div class="stat-n">${showRate !== null ? showRate + "%" : "—"}</div><div class="stat-l">Show rate</div></div>
    </div>
    ${best ? `<div class="note-box" style="margin:-8px 0 20px">
      <strong>Best draw in this slice:</strong> ${esc(best.ev.title)} —
      ${best.ev.attendance.count} showed up${best.ev.category ? ` (${esc(categoryLabel(best.ev.category))})` : ""}.
      ${withTurnout.length < happened.length
        ? `<br><span style="color:var(--faint)">${happened.length - withTurnout.length}
             ${happened.length - withTurnout.length === 1 ? "event has" : "events have"} no turnout recorded,
             so the turnout averages only cover the ${withTurnout.length} that ${withTurnout.length === 1 ? "does" : "do"}.</span>`
        : ""}
    </div>` : ""}`;
}

export function mount(root, rerender) {
  const bar = $("#past-filters", root);
  if (!bar) return;

  const sync = () => {
    filters.category = bar.querySelector("[name=category]").value;
    filters.outcome  = bar.querySelector("[name=outcome]").value;
    filters.from     = bar.querySelector("[name=from]").value;
    filters.to       = bar.querySelector("[name=to]").value;
    filters.q        = bar.querySelector("[name=q]").value;
    rerender();
  };

  bar.addEventListener("change", sync);
  let t = 0;
  bar.addEventListener("input", (e) => {
    if (e.target.name !== "q") return;
    clearTimeout(t); t = setTimeout(sync, 260);
  });

  $$("[data-range]", bar).forEach((btn) => btn.addEventListener("click", () => {
    filters.from = toDateInput(addDays(new Date(), -Number(btn.dataset.range)));
    filters.to = "";
    rerender();
  }));

  $("#filters-clear", bar)?.addEventListener("click", () => {
    Object.assign(filters, { category: "", from: "", to: "", outcome: "", q: "" });
    rerender();
  });
}
