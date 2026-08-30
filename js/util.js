/* ==========================================================================
   Small shared helpers: DOM, dates, formatting.
   Everything here is pure / side-effect free apart from the DOM builders.
   ========================================================================== */

/* ----------------------------- DOM ----------------------------- */

/** Escape text for safe interpolation into an HTML template string. */
export function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Build a detached element from an HTML string. */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Delegated event binding: on(root, 'click', '[data-x]', handler). */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}

let toastTimer = 0;
export function toast(message, kind = "ok") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = el(`<div class="toast ${kind === "err" ? "err" : ""}">${esc(message)}</div>`);
  host.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === "err" ? 5200 : 3000);
}

/* ----------------------------- Dates ----------------------------- */
/* All events are stored as Firestore Timestamps and rendered in the viewer's
   local timezone. Everyone in the chapter is in Syracuse, so local time is the
   right frame of reference. */

export const DAY_MS = 86400000;

/** Firestore Timestamp | Date | number | ISO string -> Date (or null). */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
export const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay    = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_SHORT    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const DOW_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export const monthShort = (d) => MONTHS_SHORT[d.getMonth()];
export const dowShort   = (d) => DOW_SHORT[d.getDay()];

/** "Fri, Sep 12" */
export function fmtDate(d) {
  if (!d) return "—";
  return `${DOW_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "Fri, Sep 12, 2026" — used where the year genuinely matters (archive). */
export function fmtDateFull(d) {
  if (!d) return "—";
  return `${fmtDate(d)}, ${d.getFullYear()}`;
}

/** "7:30 PM" — drops ":00" so "7 PM" reads cleaner. */
export function fmtTime(d) {
  if (!d) return "";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Fri, Sep 12 · 7:30 PM" */
export function fmtDateTime(d) {
  if (!d) return "—";
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

/**
 * Human distance from now: "in 3 days", "tomorrow", "2 hours ago".
 * Day-granularity above 24h so "in 6 days" doesn't drift with the clock.
 */
export function relative(target, now = new Date()) {
  if (!target) return "";
  const ms = target - now;
  const abs = Math.abs(ms);
  if (abs < 60000) return ms >= 0 ? "in under a minute" : "just now";
  if (abs < 3600000) {
    const n = Math.round(abs / 60000);
    return ms >= 0 ? `in ${n} min` : `${n} min ago`;
  }
  if (abs < DAY_MS) {
    const n = Math.round(abs / 3600000);
    return ms >= 0 ? `in ${n} hour${n === 1 ? "" : "s"}` : `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  const days = Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);
  if (days === 0)  return "today";
  if (days === 1)  return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/* ---- <input type="datetime-local"> <-> Date -------------------------------
   datetime-local has no timezone; both directions must use local components. */

export function toLocalInput(d) {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

export function toDateInput(d) {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateInput(s, endOfTheDay = false) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return endOfTheDay
    ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
    : new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
}

/** "20260912" — stable, timezone-free key used for recurring instance doc IDs. */
export function dayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/* ----------------------------- Text ----------------------------- */

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Andrew Harvey" -> "Andrew H." — RSVP lists get long on a phone. */
export function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Someone";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many ?? one + "s"}`;
}

/** SHA-256 hex — used for the officer passcode proof. Needs https or localhost. */
export async function sha256Hex(text) {
  if (!crypto?.subtle) throw new Error("This browser can't hash the passcode. Use HTTPS.");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------- Photo URLs --------------------------- */

/**
 * Validate a photo URL an officer pasted in.
 *
 * Two shapes are allowed:
 *   • A relative path — "assets/photos/bowling.jpg". Same-origin, so it inherits
 *     the page's scheme and can't cause mixed content. This is the good case:
 *     files committed to the repo don't rot.
 *   • An absolute https:// URL.
 *
 * Plain http:// is rejected outright rather than upgraded. An http image on an
 * https page is blocked by the browser with no visible error — the photo just
 * never appears — which is a miserable thing for an officer to debug.
 *
 * Empty normalises to null, never to "", so "no photo" has exactly one
 * representation in Firestore alongside the field simply being absent.
 *
 * @returns {{value: string|null} | {error: string}}
 */
export function normalizePhotoUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);

  if (!hasScheme) {
    try { new URL(s, document.baseURI); }
    catch { return { error: "That doesn't look like a valid link or file path." }; }
    return { value: s };
  }

  let u;
  try { u = new URL(s); }
  catch { return { error: "That doesn't look like a valid link." }; }

  if (u.protocol === "http:") {
    return { error: "Use an https:// link. Browsers block plain http images on a secure page, so this would silently never show up." };
  }
  if (u.protocol !== "https:") {
    return { error: `${u.protocol} links don't work for photos — use https:// or a file in assets/photos/.` };
  }
  return { value: u.href };
}

/** Absolute http(s) links are third-party; relative paths are our own files. */
export const isExternalPhotoUrl = (url) => /^https?:\/\//i.test(String(url || ""));

export function debounce(fn, ms = 200) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
