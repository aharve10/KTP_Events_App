/* ==========================================================================
   Shared UI pieces. Views build HTML strings; all interactivity is handled by
   one delegated listener (bindCardActions) bound once to the view container.
   ========================================================================== */

import {
  esc, el, toDate, fmtDate, fmtTime, fmtDateFull, monthShort, dowShort,
  relative, shortName, toast, isExternalPhotoUrl, $,
} from "./util.js";
import { computeStatus, statusMeta, isCancelled, S } from "./lifecycle.js";
import * as store from "./store.js";
import { CATEGORIES } from "./config.js";

export const categoryLabel = (id) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? "Other";

/* ------------------------------- Modal ------------------------------- */

let modalOnClose = null;

export function openModal(title, bodyNode, onClose) {
  const host = $("#modal-host");
  const body = $("#modal-body");
  $("#modal-title").textContent = title;
  body.replaceChildren(typeof bodyNode === "string" ? el(`<div>${bodyNode}</div>`) : bodyNode);
  host.hidden = false;
  document.body.style.overflow = "hidden";
  modalOnClose = onClose || null;
  body.scrollTop = 0;
  const first = body.querySelector("input,select,textarea,button");
  if (first && window.matchMedia("(min-width: 900px)").matches) first.focus();
}

export function closeModal() {
  const host = $("#modal-host");
  if (host.hidden) return;
  host.hidden = true;
  document.body.style.overflow = "";
  const fn = modalOnClose; modalOnClose = null;
  if (fn) fn();
}

export function initModal() {
  const host = $("#modal-host");
  host.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}

/* ------------------------------- People ------------------------------- */

/** "Andrew H. [Under 21]" — badges come from that person's public specs only. */
export function personChip(uid) {
  const isMe = uid === store.state.user?.uid;
  const name = isMe ? "You" : shortName(store.memberName(uid));
  const badges = store.publicBadges(uid)
    .map((b) => `<span class="person-badge" title="${esc(b.note || b.label)}">${esc(b.label)}</span>`)
    .join("");
  return `<span class="person ${isMe ? "me" : ""}">${esc(name)}${badges}</span>`;
}

function nameList(uids) {
  if (!uids.length) return `<span class="person-none">Nobody yet</span>`;
  const me = store.state.user?.uid;
  // Put the signed-in user first, then alphabetical — easier to find yourself.
  const sorted = [...uids].sort((a, b) => {
    if (a === me) return -1;
    if (b === me) return 1;
    return store.memberName(a).localeCompare(store.memberName(b));
  });
  return sorted.map(personChip).join("");
}

/* ------------------------------ Status bits ------------------------------ */

function statusPill(status) {
  return `<span class="pill ${status.tone}">${esc(status.label)}</span>`;
}

function thresholdBar(status) {
  if (!status.threshold) return "";
  const pct = Math.min(100, Math.round((status.goingCount / status.threshold) * 100));
  const cls = status.met ? "is-met" : status.key === S.AT_RISK ? "is-risk" : "";
  return `
    <div class="thresh">
      <div class="thresh-bar"><div class="thresh-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="thresh-cap">${status.goingCount} of ${status.threshold} needed${status.met ? " — met" : ""}</div>
    </div>`;
}

/* ---------------------------- Officer planning ---------------------------- */

function planningPanel(ev, going, deciding) {
  if (!store.isOfficer()) return "";
  const uids = [...new Set([...going, ...deciding])];
  if (!uids.length) return "";
  const rows = store.aggregateSpecs(uids);
  if (!rows.length) {
    return `<div class="planning">
      <div class="planning-head"><span class="banner-dot"></span>Planning notes</div>
      <div class="planning-note">Nobody on this list has set any profile specifications yet.</div>
    </div>`;
  }
  const chips = rows.map((r) => `
    <span class="planning-stat" title="${esc(r.notes.join(" · "))}">
      <b>${r.count}</b><span>${esc(r.label.toLowerCase())}</span>
    </span>`).join("");
  return `
    <div class="planning">
      <div class="planning-head"><span class="banner-dot"></span>Planning notes — officers only</div>
      <div class="planning-grid">${chips}</div>
      <div class="planning-note">
        Counts cover everyone Going or Still deciding, ${store.hasFullSpecAccess()
          ? "including people who kept the badge private."
          : "based on publicly shown badges only (private specs still loading)."}
        Names aren't shown for privately-kept specs.
      </div>
    </div>`;
}

/* ------------------------------ Event photo ------------------------------ */

/**
 * URLs that have already failed to load. Broken links are the accepted cost of
 * letting officers paste a URL, so a dead one degrades to the no-photo layout —
 * and stays degraded, rather than being re-added and re-removed on every
 * re-render.
 */
const brokenPhotos = new Set();

/** `photoUrl` is optional: absent, null and "" all mean no photo. */
function cardPhoto(ev) {
  const url = ev?.photoUrl;
  if (!url || brokenPhotos.has(url)) return "";
  return `
    <div class="card-photo">
      <img class="card-photo-img" src="${esc(url)}" alt="${esc(ev.title)}"
           loading="lazy" decoding="async" data-photo="${esc(url)}"
           ${isExternalPhotoUrl(url) ? 'referrerpolicy="no-referrer"' : ""} />
    </div>`;
}

/* ------------------------------ Event card ------------------------------ */

/**
 * @param {object} ev
 * @param {object} [opts]
 * @param {boolean} [opts.expanded]   show roster
 * @param {boolean} [opts.archive]    archive presentation (turnout, outcome)
 * @param {boolean} [opts.compact]    hide description + officer actions
 */
export function eventCard(ev, opts = {}) {
  const now = new Date();
  const start = toDate(ev.startAt);
  const live = store.rsvpsFor(ev.id);
  const counts = store.countsFor(ev.id, ev);
  const status = computeStatus(ev, counts.going, now);
  const going = live?.going ?? [];
  const deciding = live?.deciding ?? [];
  const mine = store.myRsvp(ev.id);
  const officer = store.isOfficer();
  const dead = isCancelled(status.key);
  const expanded = opts.expanded ?? !status.isPast;

  /* --- header -------------------------------------------------------- */
  const chip = start ? `
    <div class="datechip">
      <div class="datechip-m">${monthShort(start)}</div>
      <div class="datechip-d">${start.getDate()}</div>
      <div class="datechip-w">${dowShort(start)}</div>
    </div>` : "";

  const metaBits = [
    start ? fmtTime(start) : null,
    ev.location || null,
    !status.isPast && start ? relative(start, now) : null,
  ].filter(Boolean);

  const tags = [
    statusPill(status),
    `<span class="pill plain">${esc(categoryLabel(ev.category))}</span>`,
    ev.seriesId ? `<span class="pill info">Recurring</span>` : "",
    status.forced ? `<span class="pill info">Officer-confirmed</span>` : "",
  ].filter(Boolean).join("");

  /* --- notes --------------------------------------------------------- */
  let note = "";
  if (status.key === S.AT_RISK) {
    note = `<div class="risk-note">${esc(status.message)}</div>`;
  } else if (dead) {
    note = `<div class="dead-note">${esc(status.message)}</div>`;
  }

  /* --- RSVP ---------------------------------------------------------- */
  const canRsvp = !status.isPast && !dead;
  const rsvp = canRsvp ? `
    <div class="rsvp" role="group" aria-label="Your RSVP">
      <button class="rsvp-btn ${mine === "going" ? "on-going" : ""}"    data-act="rsvp" data-id="${ev.id}" data-v="going">Going</button>
      <button class="rsvp-btn ${mine === "deciding" ? "on-deciding" : ""}" data-act="rsvp" data-id="${ev.id}" data-v="deciding">Still deciding</button>
      <button class="rsvp-btn ${mine === null ? "on-out" : ""}"          data-act="rsvp" data-id="${ev.id}" data-v="">Not going</button>
    </div>` : "";

  /* --- roster -------------------------------------------------------- */
  let roster = "";
  if (expanded) {
    if (!live && status.isPast) {
      roster = `<button class="disclosure" data-act="load-rsvps" data-id="${ev.id}">
        Show who RSVP'd (${counts.going} going, ${counts.deciding} deciding)</button>`;
    } else {
      roster = `
        <div class="roster">
          <div class="roster-group">
            <div class="roster-head">Going — ${going.length}</div>
            <div class="roster-names">${nameList(going)}</div>
          </div>
          <div class="roster-group">
            <div class="roster-head">Still deciding — ${deciding.length}</div>
            <div class="roster-names">${nameList(deciding)}</div>
          </div>
          ${opts.archive ? attendanceBlock(ev, going) : ""}
        </div>`;
    }
  } else {
    roster = `<button class="disclosure" data-act="expand" data-id="${ev.id}">
      Show who's going (${counts.going} going · ${counts.deciding} deciding)</button>`;
  }

  /* --- officer actions ------------------------------------------------ */
  const actions = officer && !opts.compact ? officerActions(ev, status) : "";
  const footNote = opts.archive && ev.attendance
    ? `${counts.going} RSVP'd · ${ev.attendance.count} attended`
    : ev.createdByName ? `Added by ${esc(ev.createdByName)}` : "";

  const foot = (actions || footNote) ? `
    <div class="card-foot">
      <span class="card-foot-note">${footNote}</span>
      <span class="card-actions">${actions}</span>
    </div>` : "";

  return `
  <article class="card ${status.key === S.AT_RISK ? "is-risk" : ""} ${dead ? "is-dead" : ""}" data-event="${ev.id}">
    ${cardPhoto(ev)}
    <div class="card-top">
      ${chip}
      <div class="card-main">
        <h3 class="card-title">${esc(ev.title)}</h3>
        <div class="card-meta">${esc(metaBits.join(" · "))}</div>
        ${ev.description && !opts.compact ? `<p class="card-desc">${esc(ev.description)}</p>` : ""}
        <div class="tagrow">${tags}</div>
      </div>
    </div>
    ${note}
    ${!status.isPast ? thresholdBar(status) : ""}
    ${rsvp}
    ${roster}
    ${planningPanel(ev, going, deciding)}
    ${foot}
  </article>`;
}

function attendanceBlock(ev, going) {
  if (!ev.attendance) {
    return `<div class="roster-group">
      <div class="roster-head">Actual turnout</div>
      <span class="person-none">Not recorded${store.isOfficer() ? " — use “Mark turnout” below." : "."}</span>
    </div>`;
  }
  const uids = ev.attendance.uids || [];
  const noShows = going.filter((u) => !uids.includes(u));
  return `
    <div class="roster-group">
      <div class="roster-head">Actually showed up — ${ev.attendance.count}</div>
      <div class="roster-names">${nameList(uids)}</div>
      ${noShows.length ? `<div class="planning-note">RSVP'd Going but didn't show: ${esc(noShows.map((u) => shortName(store.memberName(u))).join(", "))}</div>` : ""}
    </div>`;
}

function officerActions(ev, status) {
  const b = [];
  if (status.isPast) {
    b.push(`<button class="btn btn-ghost btn-sm" data-act="turnout" data-id="${ev.id}">Mark turnout</button>`);
    b.push(`<button class="btn btn-ghost btn-sm" data-act="outcome" data-id="${ev.id}">Set outcome</button>`);
  } else {
    if (!status.forced) b.push(`<button class="btn btn-ghost btn-sm" data-act="force" data-id="${ev.id}">Force on</button>`);
    else b.push(`<button class="btn btn-ghost btn-sm" data-act="unforce" data-id="${ev.id}">Undo force</button>`);
    b.push(`<button class="btn btn-ghost btn-sm" data-act="extend" data-id="${ev.id}">Extend deadline</button>`);
    b.push(`<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${ev.id}">Edit</button>`);
    if (!status.killed) b.push(`<button class="btn btn-danger btn-sm" data-act="kill" data-id="${ev.id}">Cancel</button>`);
    else b.push(`<button class="btn btn-ghost btn-sm" data-act="revive" data-id="${ev.id}">Un-cancel</button>`);
  }
  return b.join("");
}

/* --------------------------- Card interactions --------------------------- */

const expandedIds = new Set();
export const isExpanded = (id) => expandedIds.has(id);

/**
 * Bind once to the persistent view container. `rerender` re-runs the current
 * view; `officerHandlers` is supplied by app.js so components.js stays free of
 * admin-form code.
 */
export function bindCardActions(root, rerender, officerHandlers) {
  /* Drop a photo that fails to load, so the card falls back to exactly the
     layout it has with no photo at all.

     Bound at document, with capture: `error` on <img> does not bubble, and event
     cards are also rendered into the calendar's day modal, which lives outside
     the view container. */
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.classList.contains("card-photo-img")) return;
    if (img.dataset.photo) brokenPhotos.add(img.dataset.photo);
    img.closest(".card-photo")?.remove();
  }, true);

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, id } = btn.dataset;

    if (act === "rsvp") {
      const v = btn.dataset.v || null;
      const prev = store.myRsvp(id);
      if (prev === v) return;
      btn.disabled = true;
      try {
        await store.setRsvp(id, v);
        toast(v === "going" ? "You're in." : v === "deciding" ? "Marked as still deciding." : "RSVP cleared.");
      } catch (err) {
        console.error(err);
        toast("Couldn't save that RSVP — try again.", "err");
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (act === "expand") { expandedIds.add(id); rerender(); return; }

    if (act === "load-rsvps") {
      btn.textContent = "Loading…";
      try { await store.loadRsvpsOnce(id); expandedIds.add(id); rerender(); }
      catch { toast("Couldn't load that RSVP list.", "err"); }
      return;
    }

    if (officerHandlers && act in officerHandlers) {
      officerHandlers[act](id, btn);
    }
  });
}

/* ------------------------------- Misc bits ------------------------------- */

/**
 * @param {string} lead   the headline — what isn't here
 * @param {string} [hint] optional second line — why, or what to do about it
 */
export function emptyState(lead, hint) {
  return `<div class="empty">
    <p class="empty-lead">${esc(lead)}</p>
    ${hint ? `<p>${esc(hint)}</p>` : ""}
  </div>`;
}

export function sectionHead(title, count) {
  return `<div class="section-head">
    <h2 class="section-title">${esc(title)}</h2>
    ${count !== undefined ? `<span class="section-count">${esc(count)}</span>` : ""}
  </div>`;
}

export function eventOneLiner(ev) {
  const start = toDate(ev.startAt);
  return `${fmtDateFull(start)} · ${fmtTime(start)}${ev.location ? " · " + ev.location : ""}`;
}
