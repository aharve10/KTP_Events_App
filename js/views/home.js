/* ==========================================================================
   Home — editorial layout:
     1. Page head (greeting + subtitle)
     2. Photo hero. When the soonest non-athletics event within HERO_HORIZON_DAYS
        exists, its details overlay the photo; otherwise the photo carries the
        chapter mark alone. When HERO_IMAGES is empty the section is skipped
        entirely, matching the historical behaviour.
     3. Attention band (single at-risk event that most needs a nudge)
     4. This-week timeline (7 columns, today first)
     5. All upcoming (existing eventCard, unchanged)
     6. Recently cancelled (unchanged)
   Every field read from an event comes from the existing schema — nothing on
   this page depends on properties that don't already exist in Firestore.
   ========================================================================== */

import { esc, toDate, addDays, fmtDate, fmtTime, relative, DOW_LONG } from "../util.js";
import { computeStatus, isCancelled, upcomingSortKey, S } from "../lifecycle.js";
import * as store from "../store.js";
import { eventCard, emptyState, sectionHead } from "../components.js";
import { DEFAULTS, CHAPTER, HERO_IMAGES } from "../config.js";

/** How far ahead to look when picking a hero-worthy event. */
const HERO_HORIZON_DAYS = 21;

/* ------------------------------- Hero photo -------------------------------
   Chosen once and held for the life of the page — same rule as before. */

let heroChoice;            // undefined = not picked, null = nothing to show
let heroBroken = false;

function heroImage() {
  if (heroBroken) return null;
  if (heroChoice === undefined) {
    const list = (Array.isArray(HERO_IMAGES) ? HERO_IMAGES : []).filter((h) => h?.src);
    heroChoice = list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  return heroChoice;
}

/* --------------------------- Featured-event pick ---------------------------
   Explicit officer pin wins: an event flagged `featured: true` is heroed even
   if a "better" candidate exists further down. If two are flagged, the soonest
   wins (upcoming is already sorted). If none are flagged, we fall back to a
   deterministic pick — the soonest upcoming event that isn't part of a
   recurring series and isn't athletics (weekly games belong in the timeline).
   If nothing matches, the hero shows the photo alone. */

function pickFeatured(upcoming, now) {
  const pinned = upcoming.find((r) => r.ev.featured === true);
  if (pinned) return pinned;

  const horizon = addDays(now, HERO_HORIZON_DAYS);
  return upcoming.find((r) => {
    const ev = r.ev;
    if (ev.seriesId) return false;
    if (ev.category === "athletics") return false;
    const start = toDate(ev.startAt);
    return start && start <= horizon;
  }) || null;
}

/* --------------------------------- Render --------------------------------- */

export function render() {
  const now = new Date();

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
  const featured = pickFeatured(upcoming, now);
  const firstName = (store.state.profile?.displayName || "").split(" ")[0];

  return `
    <div class="page-head">
      <div class="page-head-body">
        <h1 class="page-title">${firstName ? `Hey, ${esc(firstName)}.` : "Upcoming."}</h1>
        <p class="page-sub">
          RSVP so everyone can see who's actually coming. ${esc(CHAPTER.name)} · ${esc(CHAPTER.school)}
        </p>
      </div>
      ${headStats(upcoming, atRisk, now)}
    </div>

    ${heroBand(featured)}

    ${atRisk.length ? attentionBand(atRisk[0], now) : ""}

    ${weekTimeline(upcoming, now)}

    <section class="section">
      ${sectionHead("All upcoming", upcoming.length ? `${upcoming.length} scheduled` : "")}
      ${upcoming.length
        ? upcoming.map(({ ev }) => eventCard(ev, { expanded: true })).join("")
        : emptyState("No upcoming events yet.", "Officers can add one from Manage.")}
    </section>

    ${cancelledStrip(now)}
  `;
}

/* ------------------------------- Hero band -------------------------------
   Uses `background-image` so a missing file leaves the deep-navy overlay in
   place rather than a broken <img>. mount() no longer has to hand-remove a
   broken image node — the CSS gradient is the fallback. */

function heroBand(featured) {
  const hero = heroImage();
  if (!hero) return "";

  const style = `background-image: url('${esc(hero.src)}');`;
  const alt   = esc(hero.alt || "");

  if (!featured) {
    return `
      <section class="home-hero" aria-label="${alt || "Chapter photo"}">
        <div class="home-hero-photo" style="${style}" role="img" aria-label="${alt}"></div>
        <div class="home-hero-body no-event">
          <div>
            <p class="home-hero-brand">Kappa Theta <em>Pi</em></p>
            <p class="home-hero-brand-sub">${esc(CHAPTER.school)}</p>
          </div>
        </div>
      </section>`;
  }

  const { ev, status, counts } = featured;
  const start = toDate(ev.startAt);
  const mine  = store.myRsvp(ev.id);

  const hasThreshold = Number.isFinite(ev.threshold) && ev.threshold > 0;
  const pct = hasThreshold ? Math.min(100, Math.round((counts.going / ev.threshold) * 100)) : 100;
  const barCls = !hasThreshold ? "" : status.met ? "is-met" : status.key === S.AT_RISK ? "is-risk" : "";

  const rsvpLabel = mine === "going" ? "You're in ✓" : "RSVP going";

  return `
    <section class="home-hero" aria-label="Featured event">
      <div class="home-hero-photo" style="${style}" role="img" aria-label="${alt}"></div>
      <div class="home-hero-body">
        <div class="home-hero-left">
          <div class="home-hero-eyebrow">
            <span class="home-hero-eyebrow-dot"></span>
            ${esc(categoryEyebrow(ev.category))}
          </div>
          <h2 class="home-hero-title">${esc(ev.title)}</h2>
          ${ev.description ? `<p class="home-hero-desc">${esc(ev.description)}</p>` : ""}
          <div class="home-hero-actions">
            <button class="btn btn-primary" data-act="rsvp" data-id="${esc(ev.id)}" data-v="going">${rsvpLabel}</button>
            ${mine !== "deciding" ? `<button class="btn btn-ghost" data-act="rsvp" data-id="${esc(ev.id)}" data-v="deciding">Still deciding</button>` : ""}
          </div>
        </div>
        <div class="home-hero-right">
          <div class="home-hero-card">
            <div class="home-hero-card-row">
              <div class="home-hero-card-lbl">When</div>
              <div class="home-hero-card-val">${esc(fmtDate(start))}<span class="sub">${esc(fmtTime(start))}</span></div>
            </div>
            ${ev.location ? `
            <div class="home-hero-card-row">
              <div class="home-hero-card-lbl">Where</div>
              <div class="home-hero-card-val">${esc(ev.location)}</div>
            </div>` : ""}
            <div class="home-hero-card-row">
              <div class="home-hero-card-lbl">Going</div>
              <div class="home-hero-card-val">
                ${counts.going}${hasThreshold ? `<span class="inline">of ${ev.threshold} needed</span>` : ""}
                ${hasThreshold ? `<div class="home-hero-bar"><div class="home-hero-bar-fill ${barCls}" style="width:${pct}%"></div></div>` : ""}
              </div>
            </div>
            ${heroTargetRow(ev, counts)}
            ${heroDriversRow(ev)}
          </div>
        </div>
      </div>
    </section>`;
}

/* Aspirational count above the threshold. Only rendered when set and greater
   than the current going count — a target that's already met is noise. */
function heroTargetRow(ev, counts) {
  const target = Number(ev.target);
  if (!Number.isFinite(target) || target <= 0) return "";
  if (target <= counts.going) return "";
  return `
    <div class="home-hero-card-row">
      <div class="home-hero-card-lbl">Target</div>
      <div class="home-hero-card-val">${target}<span class="sub">${target - counts.going} more to hit it</span></div>
    </div>`;
}

/* Off-campus trips can flag `driversNeeded`. Row hidden entirely when the
   event doesn't opt in. `driversCount` defaults to 0. */
function heroDriversRow(ev) {
  const need = Number(ev.driversNeeded);
  if (!Number.isFinite(need) || need <= 0) return "";
  const have = Number(ev.driversCount) || 0;
  const short = Math.max(0, need - have);
  const note = short === 0 ? "covered" : `${short} more needed`;
  return `
    <div class="home-hero-card-row">
      <div class="home-hero-card-lbl">Drivers</div>
      <div class="home-hero-card-val">${have}<span class="sub">of ${need} · ${note}</span></div>
    </div>`;
}

function categoryEyebrow(cat) {
  switch (cat) {
    case "brotherhood":  return "Brotherhood";
    case "social":       return "Chapter social";
    case "philanthropy": return "Philanthropy";
    case "professional": return "Professional";
    case "rush":         return "Rush";
    case "athletics":    return "SU athletics";
    default:             return "Coming up";
  }
}

/* --------------------------------- Head stats ---------------------------------
   Three tiles drawn from state we already have. Every value is safe when the
   underlying data is empty — an empty chapter simply renders zeros. */

function headStats(upcoming, atRisk, now) {
  const memberCount = store.state.members?.size ?? 0;
  const upcomingCount = upcoming.length;
  const atRiskCount = atRisk.length;

  // "Next up" is the soonest upcoming event, formatted just as its month + day.
  // If nothing is upcoming, we show a soft dash rather than hiding the tile so
  // the row keeps its three-column rhythm.
  const nextUp = upcoming[0];
  const nextLabel = nextUp
    ? `${esc(fmtDate(toDate(nextUp.ev.startAt)))}`
    : "—";

  return `
    <aside class="head-stats" aria-label="Chapter at a glance">
      <div class="head-stat">
        <div class="head-stat-val">${upcomingCount}</div>
        <div class="head-stat-lbl">Upcoming</div>
      </div>
      <div class="head-stat">
        <div class="head-stat-val">${atRiskCount}</div>
        <div class="head-stat-lbl">At risk</div>
      </div>
      <div class="head-stat">
        <div class="head-stat-val">${memberCount}</div>
        <div class="head-stat-lbl">Members</div>
      </div>
      <div class="head-stat head-stat-wide">
        <div class="head-stat-val head-stat-val-sm">${nextLabel}</div>
        <div class="head-stat-lbl">Next up</div>
      </div>
    </aside>`;
}

/* ------------------------------- Attention -------------------------------
   Surfaces the single most-urgent at-risk event as its own band. Reuses the
   existing lifecycle computation — status.needed comes straight from
   computeStatus() so the count can't drift. */

function attentionBand({ ev, status }, now) {
  const start = toDate(ev.startAt);
  const need  = status.needed === 1 ? "1 more RSVP" : `${status.needed} more RSVPs`;
  const where = ev.location ? ` · ${ev.location}` : "";
  // Countdown reads "in 3 hours", "tomorrow", "in 4 days" — same phrasing the
  // banner used before. relative() handles the direction and unit for us.
  const countdown = start ? ` · decide ${relative(start, now)}` : "";
  return `
    <section class="attention" aria-label="Needs your attention">
      <div class="attention-icon" aria-hidden="true">!</div>
      <div class="attention-body">
        <div class="attention-label">Won't happen without you</div>
        <div class="attention-title"><strong>${esc(ev.title)}</strong> needs ${esc(need)}</div>
        <div class="attention-meta">${esc(fmtDate(start))} · ${esc(fmtTime(start))}${esc(where)}${esc(countdown)}</div>
      </div>
      <button class="btn attention-cta" data-act="rsvp" data-id="${esc(ev.id)}" data-v="going">I'll be there</button>
    </section>`;
}

/* ------------------------------- Week timeline -------------------------------
   Seven columns starting today. Each column lists the events whose startAt
   falls inside that calendar day. Everything is drawn from the same `upcoming`
   the list below uses, so the two never disagree. */

function weekTimeline(upcoming, now) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekEnd = addDays(startOfToday, 7);

  const inWeek = upcoming.filter((r) => {
    const s = toDate(r.ev.startAt);
    return s && s >= startOfToday && s < weekEnd;
  });

  const dowShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = addDays(startOfToday, i);
    const dayEnd   = addDays(startOfToday, i + 1);
    const items = inWeek.filter((r) => {
      const s = toDate(r.ev.startAt);
      return s >= dayStart && s < dayEnd;
    });
    cols.push({
      dow: dowShort[dayStart.getDay()],
      date: dayStart.getDate(),
      isToday: i === 0,
      items,
    });
  }

  const grid = cols.map((c) => `
    <div class="week-tl-day ${c.isToday ? "is-today" : ""}" role="listitem">
      <div class="week-tl-day-head">
        <span class="week-tl-dow">${esc(c.dow)}</span>
        <span class="week-tl-date">${c.date}</span>
      </div>
      ${c.items.length
        ? c.items.map((r) => {
            const cls = r.status.key === S.AT_RISK ? "is-risk" : r.status.met ? "is-full" : "";
            return `
              <div class="week-tl-item ${cls}" title="${esc(r.ev.title)}">
                <span class="week-tl-time">${esc(fmtTime(toDate(r.ev.startAt)))}</span>
                <span class="week-tl-name">${esc(r.ev.title)}</span>
              </div>`;
          }).join("")
        : `<div class="week-tl-empty">—</div>`}
    </div>`).join("");

  const count = inWeek.length;
  const label = count ? `${count} scheduled` : "";
  return `
    <section class="section">
      ${sectionHead("This week", label)}
      <div class="week-tl" role="list">${grid}</div>
    </section>`;
}

/* ------------------------------ Recently cancelled ------------------------------
   Unchanged from the previous version — same helper, same rule (past 7 days,
   cancelled status). Kept so people who saw an event on the banner aren't left
   wondering where it went. */

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

/* --------------------------------- mount ---------------------------------
   The hero used to render an <img> and mount() dropped the whole band on
   error. The new hero uses a CSS background-image, so a failed file simply
   leaves the deep-navy overlay in place — nothing to unmount. */

export function mount(_root) { /* no-op */ }
