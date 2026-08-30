/* ==========================================================================
   Home — the persistent banner (at-risk / new / next two weeks) followed by
   the full live event list.
   ========================================================================== */

import { esc, toDate, addDays, fmtDate, fmtTime, relative } from "../util.js";
import { computeStatus, isNewlyAdded, isCancelled, upcomingSortKey, S } from "../lifecycle.js";
import * as store from "../store.js";
import { eventCard, emptyState, sectionHead } from "../components.js";
import { DEFAULTS, CHAPTER, HERO_IMAGES } from "../config.js";

/* ------------------------------- Hero band -------------------------------
   One photo, chosen once and then held for the life of the page.

   The choice is memoised at module scope on purpose. render() re-runs on every
   store update and on app.js's 60-second status tick, so picking inside it
   would reshuffle the photo underneath whoever is reading — an auto-advancing
   carousel by accident, which is the thing we're avoiding.
   -------------------------------------------------------------------------- */

let heroChoice;            // undefined = not picked yet, null = nothing to show
let heroBroken = false;    // a load failure is permanent for this page load

function heroImage() {
  if (heroBroken) return null;
  if (heroChoice === undefined) {
    const list = (Array.isArray(HERO_IMAGES) ? HERO_IMAGES : []).filter((h) => h?.src);
    heroChoice = list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  return heroChoice;
}

function heroBand() {
  const hero = heroImage();
  if (!hero) return "";
  return `
    <div class="hero">
      <img class="hero-img" src="${esc(hero.src)}" alt="${esc(hero.alt || "")}"
           loading="eager" fetchpriority="high" decoding="async" />
    </div>`;
}

export function render() {
  const now = new Date();

  // Anything that hasn't started yet, plus events still running today.
  const upcoming = store.state.events
    .filter((e) => {
      const start = toDate(e.startAt);
      return start && start >= now;
    })
    .map((e) => {
      const counts = store.countsFor(e.id, e);
      return { ev: e, status: computeStatus(e, counts.going, now), counts };
    })
    .filter((r) => !r.status.killed)
    .sort((a, b) => upcomingSortKey(a.ev, a.status) - upcomingSortKey(b.ev, b.status));

  const atRisk   = upcoming.filter((r) => r.status.key === S.AT_RISK);
  const fresh    = upcoming.filter((r) => isNewlyAdded(r.ev, DEFAULTS.newForDays, now));
  const horizon  = addDays(now, DEFAULTS.upcomingWindowDays);
  const soon     = upcoming.filter((r) => toDate(r.ev.startAt) <= horizon);

  const firstName = (store.state.profile?.displayName || "").split(" ")[0];

  return `
    <div class="page-head">
      <h1 class="page-title">${firstName ? `Hey, ${esc(firstName)}.` : "Upcoming"}</h1>
      <p class="page-sub">
        RSVP so everyone can see who's actually coming. ${CHAPTER.name} · ${CHAPTER.school}
      </p>
    </div>

    ${heroBand()}

    ${banner(atRisk, fresh, soon, now)}

    <section class="section">
      ${sectionHead("All upcoming events", upcoming.length ? `${upcoming.length} scheduled` : "")}
      ${upcoming.length
        ? upcoming.map(({ ev }) => eventCard(ev, { expanded: true })).join("")
        : emptyState("No upcoming events yet.", "Officers can add one from Manage.")}
    </section>

    ${cancelledStrip(now)}
  `;
}

/**
 * Drop the hero band if the photo doesn't load, rather than leaving a broken
 * image or an empty reserved gap. `heroBroken` makes that stick, so the next
 * re-render doesn't put the failing <img> straight back and flicker.
 */
export function mount(root) {
  const img = root.querySelector(".hero-img");
  if (!img) return;

  const drop = () => {
    heroBroken = true;
    img.closest(".hero")?.remove();
  };

  // A cached failure can already have settled before this runs, in which case
  // no error event is coming and we have to check the image directly.
  if (img.complete && img.naturalWidth === 0) drop();
  else img.addEventListener("error", drop, { once: true });
}

/* ------------------------------- Banner ------------------------------- */

function banner(atRisk, fresh, soon, now) {
  return `
    <section class="banner" aria-label="What needs attention">
      ${strip("is-risk", "Needs attention", atRisk, now, (r) => {
        const s = r.status;
        return {
          cta: `${s.needed} more needed`,
          // Deliberately terse: the CTA beside it already says how many more are
          // needed, and the card below carries the full "or this won't happen"
          // sentence. Repeating it here only made the chip wrap.
          meta: `${fmtDate(toDate(r.ev.startAt))} · ${s.goingCount}/${s.threshold} going`,
        };
      }, "Nothing at risk right now.")}

      ${strip("is-new", "Just added", fresh, now, (r) => ({
        cta: relative(toDate(r.ev.createdAt), now),
        meta: `${fmtDate(toDate(r.ev.startAt))} · ${fmtTime(toDate(r.ev.startAt))}${r.ev.location ? " · " + r.ev.location : ""}`,
      }), `Nothing new in the last ${DEFAULTS.newForDays} days.`)}

      ${strip("", `Next ${DEFAULTS.upcomingWindowDays} days`, soon, now, (r) => ({
        cta: relative(toDate(r.ev.startAt), now),
        meta: `${fmtDate(toDate(r.ev.startAt))} · ${fmtTime(toDate(r.ev.startAt))} · ${r.status.goingCount} going`,
      }), "Nothing on the calendar for the next two weeks.")}
    </section>`;
}

function strip(cls, label, rows, now, describe, emptyText) {
  const body = rows.length
    ? `<div class="banner-list">${rows.slice(0, 6).map((r) => {
        const d = describe(r);
        return `
          <button class="banner-item" data-act="jump" data-id="${r.ev.id}">
            <span class="banner-item-main">
              <span class="banner-item-title">${esc(r.ev.title)}</span>
              <span class="banner-item-meta">${esc(d.meta)}</span>
            </span>
            <span class="banner-item-cta">${esc(d.cta)}</span>
          </button>`;
      }).join("")}
      ${rows.length > 6 ? `<div class="banner-empty">+ ${rows.length - 6} more below</div>` : ""}
      </div>`
    : `<div class="banner-empty">${esc(emptyText)}</div>`;

  return `
    <div class="banner-strip ${cls}">
      <div class="banner-label"><span class="banner-dot"></span>${esc(label)}</div>
      ${body}
    </div>`;
}

/* Recently cancelled events, so people who saw it on the banner aren't
   left wondering where it went. */
function cancelledStrip(now) {
  const recent = store.state.events.filter((e) => {
    const start = toDate(e.startAt);
    if (!start || start < addDays(now, -7)) return false;
    const status = computeStatus(e, store.countsFor(e.id, e).going, now);
    return isCancelled(status.key) && start >= addDays(now, -7);
  });
  if (!recent.length) return "";
  return `
    <section class="section">
      ${sectionHead("Recently cancelled", `${recent.length}`)}
      ${recent.map((ev) => eventCard(ev, { compact: true, expanded: false })).join("")}
    </section>`;
}
