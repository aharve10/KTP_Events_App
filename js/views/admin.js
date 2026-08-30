/* ==========================================================================
   Manage (officers only) — create events and series, work the at-risk queue,
   record turnout on things that already happened.
   ========================================================================== */

import { esc, toDate, fmtDateTime, fmtDate, toast, $, $$ } from "../util.js";
import { computeStatus, CADENCES, seriesOccurrences, S } from "../lifecycle.js";
import * as store from "../store.js";
import { eventCard, emptyState, sectionHead, openModal, categoryLabel } from "../components.js";
import { eventForm, seriesForm } from "../officer.js";
import { seedChapterData, SEED_SUMMARY } from "../seed.js";
import { DEFAULTS } from "../config.js";

export function render() {
  if (!store.isOfficer()) {
    return `
      <div class="page-head"><h1 class="page-title">Manage</h1></div>
      ${emptyState("Officers only.", "Enter the officer passcode on your Profile page to unlock this.")}`;
  }

  const now = new Date();
  const rows = store.state.events.map((ev) => ({
    ev, status: computeStatus(ev, store.countsFor(ev.id, ev).going, now),
  }));

  const atRisk = rows.filter((r) => r.status.key === S.AT_RISK);
  const upcoming = rows.filter((r) => !r.status.isPast).sort((a, b) => toDate(a.ev.startAt) - toDate(b.ev.startAt));
  const needsTurnout = rows
    .filter((r) => r.status.key === S.HAPPENED && !r.ev.attendance)
    .sort((a, b) => toDate(b.ev.startAt) - toDate(a.ev.startAt));

  return `
    <div class="page-head">
      <h1 class="page-title">Manage</h1>
      <p class="page-sub">Create events, run recurring series, and close the loop on what already happened.</p>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px">
      <button class="btn btn-primary" id="new-event">New event</button>
      <button class="btn btn-ghost" id="new-series">New recurring series</button>
    </div>

    ${atRisk.length ? `
      <section class="section">
        ${sectionHead("At risk — decide on these", `${atRisk.length}`)}
        ${atRisk.map(({ ev }) => eventCard(ev, { expanded: true })).join("")}
      </section>` : ""}

    ${needsTurnout.length ? `
      <section class="section">
        ${sectionHead("Turnout not recorded", `${needsTurnout.length} waiting`)}
        <div class="note-box" style="margin-bottom:12px">
          Recording who actually showed up is what makes the archive worth anything to next year's chair.
          It takes about fifteen seconds per event.
        </div>
        ${needsTurnout.slice(0, 8).map(({ ev }) => turnoutRow(ev)).join("")}
      </section>` : ""}

    <section class="section">
      ${sectionHead("Recurring series", `${store.state.series.length}`)}
      ${store.state.series.length
        ? store.state.series.map(seriesRow).join("")
        : emptyState("No recurring series yet.", "Use one for weekly soccer or football Saturdays — anything you'd otherwise retype every week.")}
    </section>

    <section class="section">
      ${sectionHead("All upcoming", `${upcoming.length}`)}
      ${upcoming.length
        ? upcoming.map(({ ev }) => eventCard(ev, { expanded: false })).join("")
        : emptyState("Nothing upcoming.")}
    </section>

    <section class="section">
      ${sectionHead("Officers", `${officers().length}`)}
      ${officerList()}
    </section>

    <section class="section">
      ${sectionHead("Chapter starter data")}
      <div class="card" style="padding:18px">
        <p class="card-desc" style="margin:0 0 12px">
          Loads a starting set so the app isn't empty on day one: ${esc(SEED_SUMMARY)}
          Dates are placeholders — edit or delete anything that doesn't match your calendar.
        </p>
        <button class="btn btn-ghost" id="seed-btn">Load starter data</button>
        <p class="field-help" style="margin-top:8px">Safe to press twice — it skips anything with a name that already exists.</p>
      </div>
    </section>

    <section class="section">
      ${sectionHead("Danger zone")}
      <div class="card" style="padding:18px">
        <p class="card-desc" style="margin:0 0 12px">
          Deleting an event wipes its RSVPs permanently and removes it from the archive.
          Prefer <strong>Cancel</strong> — that keeps the record.
        </p>
        <label class="field" style="margin-bottom:10px">
          <span class="field-label">Delete an event</span>
          <select id="del-select">
            <option value="">Choose one…</option>
            ${store.state.events.slice(0, 100).map((e) =>
              `<option value="${esc(e.id)}">${esc(e.title)} — ${esc(fmtDate(toDate(e.startAt)))}</option>`).join("")}
          </select>
        </label>
        <button class="btn btn-danger" id="del-btn" disabled>Delete permanently</button>
      </div>
    </section>
  `;
}

function turnoutRow(ev) {
  const c = store.countsFor(ev.id, ev);
  return `
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:14px 16px;justify-content:space-between;flex-wrap:wrap">
      <div style="min-width:0">
        <div class="card-title" style="font-size:15px">${esc(ev.title)}</div>
        <div class="card-meta">${esc(fmtDateTime(toDate(ev.startAt)))} · ${c.going} RSVP'd</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-act="turnout" data-id="${ev.id}">Mark turnout</button>
    </div>`;
}

function seriesRow(s) {
  const now = new Date();
  const next = seriesOccurrences(s, now, new Date(now.getTime() + 90 * 86400000))[0];
  const cadence = CADENCES.find((c) => c.id === s.cadence)?.label ?? s.cadence;
  const ends = toDate(s.endsAt);
  const done = ends && ends < now;

  return `
    <div class="card ${s.paused || done ? "is-dead" : ""}" style="padding:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0;flex:1">
          <div class="card-title" style="font-size:16px">${esc(s.title)}</div>
          <div class="card-meta">
            ${esc(cadence)}${s.location ? " · " + esc(s.location) : ""} · threshold ${s.threshold ?? DEFAULTS.threshold}
          </div>
          <div class="tagrow">
            <span class="pill plain">${esc(categoryLabel(s.category))}</span>
            ${done ? `<span class="pill dead">Ended</span>`
              : s.paused ? `<span class="pill dead">Paused</span>`
              : `<span class="pill go">Active</span>`}
            ${next && !s.paused && !done ? `<span class="pill info">Next ${esc(fmtDate(next))}</span>` : ""}
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-series="edit"  data-id="${s.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-series="pause" data-id="${s.id}">${s.paused ? "Resume" : "Pause"}</button>
          ${!done ? `<button class="btn btn-ghost btn-sm" data-series="end" data-id="${s.id}">End series</button>` : ""}
          <button class="btn btn-danger btn-sm" data-series="delete" data-id="${s.id}">Delete</button>
        </div>
      </div>
      <p class="planning-note" style="margin-top:10px">
        Instances are generated ${DEFAULTS.seriesHorizonDays} days ahead, each with a fresh RSVP list.
        Deleting the template leaves already-generated instances in place.
      </p>
    </div>`;
}

const officers = () => [...store.state.members.values()].filter((m) => m.isOfficer);

function officerList() {
  const list = officers();
  if (!list.length) return emptyState("No officers yet.");
  return `<div class="card" style="padding:8px 16px">
    ${list.map((m) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
        <span class="pill go">Officer</span>
        <span style="flex:1;min-width:0">${esc(m.displayName || m.email)}</span>
        <span style="font-size:12px;color:var(--muted)">${esc(m.officerTitle || "")}</span>
      </div>`).join("")}
  </div>
  <p class="field-help" style="margin-top:8px">
    Officer access is per-account, unlocked with the shared passcode on the Profile page.
    Rotate the passcode by changing <span class="mono">config/officer.codeHash</span> in Firestore
    (use <span class="mono">tools/passcode.html</span> to generate the new hash).
  </p>`;
}

/* ------------------------------- behaviour ------------------------------- */

export function mount(root, rerender) {
  if (!store.isOfficer()) return;

  $("#new-event", root)?.addEventListener("click", () =>
    openModal("New event", eventForm(null, rerender)));

  $("#new-series", root)?.addEventListener("click", () =>
    openModal("New recurring series", seriesForm(null, rerender)));

  $$("[data-series]", root).forEach((btn) => btn.addEventListener("click", async () => {
    const s = store.state.series.find((x) => x.id === btn.dataset.id);
    if (!s) return;
    const act = btn.dataset.series;
    try {
      if (act === "edit") return openModal("Edit series", seriesForm(s, rerender));
      if (act === "pause") { await store.pauseSeries(s.id, !s.paused); toast(s.paused ? "Series resumed." : "Series paused."); }
      if (act === "end") {
        if (!confirm(`End "${s.title}"? Already-generated instances stay put; no new ones are created.`)) return;
        await store.endSeries(s.id); toast("Series ended.");
      }
      if (act === "delete") {
        if (!confirm(`Delete the "${s.title}" template? Instances already on the calendar are kept.`)) return;
        await store.deleteSeries(s.id); toast("Template deleted.");
      }
      rerender();
    } catch (e) { console.error(e); toast("That didn't work.", "err"); }
  }));

  /* --- seed --- */
  $("#seed-btn", root)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Loading…";
    try {
      const n = await seedChapterData();
      toast(n ? `Added ${n} item${n === 1 ? "" : "s"}.` : "Everything was already there.");
      rerender();
    } catch (ex) {
      console.error(ex); toast("Couldn't load starter data.", "err");
      btn.disabled = false; btn.textContent = "Load starter data";
    }
  });

  /* --- delete --- */
  const sel = $("#del-select", root);
  const delBtn = $("#del-btn", root);
  sel?.addEventListener("change", () => (delBtn.disabled = !sel.value));
  delBtn?.addEventListener("click", async () => {
    const ev = store.state.events.find((x) => x.id === sel.value);
    if (!ev) return;
    if (!confirm(`Permanently delete "${ev.title}" and its RSVPs? This can't be undone.`)) return;
    delBtn.disabled = true;
    try { await store.deleteEvent(ev.id); toast("Deleted."); rerender(); }
    catch { toast("Couldn't delete that.", "err"); delBtn.disabled = false; }
  });
}
