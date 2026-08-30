/* ==========================================================================
   Data layer. Owns all Firestore reads/writes and holds the in-memory mirror
   the views render from. Views never touch Firestore directly.

   Firestore shape
   ---------------
   users/{uid}                 public profile — readable by any signed-in member
       email, displayName, gradYear, isOfficer, officerTitle,
       publicSpecs: [{key,label,note}]      <- only the ones marked "shown"
   userSpecs/{uid}             full spec list — owner + officers only
       specs: [{key,label,note,visibility}]
   officerClaims/{uid}         write-only proof of the officer passcode
   config/officer              { codeHash }  — never client-readable
   events/{eventId}
       title, description, location, category, startAt, endAt,
       threshold, decisionDeadline, override, outcome, outcomeNote,
       seriesId, counts:{going,deciding}, attendance:{uids,count,...},
       createdBy, createdByName, createdAt, updatedAt
   events/{eventId}/rsvps/{uid}   { uid, status:'going'|'deciding', updatedAt }
   series/{seriesId}           recurring template

   Counts on the event doc are denormalised so archived events render without
   extra reads. They're kept correct by doing the RSVP write in a transaction.
   ========================================================================== */

import {
  db, auth, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp, Timestamp,
  runTransaction, increment, writeBatch,
} from "./firebase.js";
import { DEFAULTS } from "./config.js";
import { toDate, dayKey, sha256Hex, addDays, startOfDay, normalizePhotoUrl } from "./util.js";
import { seriesOccurrences } from "./lifecycle.js";

/** How far back we keep live RSVP listeners attached. */
const LIVE_RSVP_WINDOW_DAYS = 2;
/** Cap on how many events we mirror locally. Years of chapter history. */
const EVENT_LIMIT = 500;

export const state = {
  user: null,          // firebase auth user
  profile: null,       // users/{uid}
  mySpecs: [],         // full spec list for the signed-in user
  members: new Map(),  // uid -> public profile
  events: [],          // newest-first
  series: [],
  rsvps: new Map(),    // eventId -> Map(uid -> 'going'|'deciding')
  allSpecs: new Map(), // uid -> full specs  (officers only)
  ready: false,
};

export const isOfficer = () => Boolean(state.profile?.isOfficer);

/* --------------------------- change notification --------------------------- */

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let notifyQueued = false;
function notify() {
  // Batch bursts of snapshot callbacks into one render per frame.
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  });
}

/* ------------------------------ subscriptions ------------------------------ */

let unsubs = [];
const rsvpUnsubs = new Map(); // eventId -> unsubscribe

export function teardown() {
  unsubs.forEach((u) => { try { u(); } catch {} });
  unsubs = [];
  rsvpUnsubs.forEach((u) => { try { u(); } catch {} });
  rsvpUnsubs.clear();
  state.profile = null;
  state.mySpecs = [];
  state.members.clear();
  state.events = [];
  state.series = [];
  state.rsvps.clear();
  state.allSpecs.clear();
  state.ready = false;
}

/** Attach all live listeners for a signed-in user. Resolves on first data. */
export async function start(user) {
  teardown();
  state.user = user;

  await ensureProfile(user);

  const firstLoad = [];
  const gate = () => { let r; const p = new Promise((res) => (r = res)); firstLoad.push(p); return r; };

  // --- my profile ---------------------------------------------------------
  const doneMe = gate();
  unsubs.push(onSnapshot(doc(db, "users", user.uid), (snap) => {
    if (snap.exists()) state.profile = { uid: snap.id, ...snap.data() };
    doneMe(); notify();
    if (state.profile?.isOfficer) watchAllSpecs();
  }, (e) => { console.error("profile listener", e); doneMe(); }));

  // --- my full spec list --------------------------------------------------
  const doneSpecs = gate();
  unsubs.push(onSnapshot(doc(db, "userSpecs", user.uid), (snap) => {
    state.mySpecs = snap.exists() ? (snap.data().specs || []) : [];
    doneSpecs(); notify();
  }, (e) => { console.error("specs listener", e); doneSpecs(); }));

  // --- chapter roster (public profiles) -----------------------------------
  const doneMembers = gate();
  unsubs.push(onSnapshot(collection(db, "users"), (snap) => {
    state.members.clear();
    snap.forEach((d) => state.members.set(d.id, { uid: d.id, ...d.data() }));
    doneMembers(); notify();
  }, (e) => { console.error("members listener", e); doneMembers(); }));

  // --- events -------------------------------------------------------------
  const doneEvents = gate();
  unsubs.push(onSnapshot(
    query(collection(db, "events"), orderBy("startAt", "desc"), limit(EVENT_LIMIT)),
    (snap) => {
      state.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      syncRsvpListeners();
      doneEvents(); notify();
    },
    (e) => { console.error("events listener", e); doneEvents(); }
  ));

  // --- recurring series ---------------------------------------------------
  const doneSeries = gate();
  unsubs.push(onSnapshot(collection(db, "series"), (snap) => {
    state.series = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    doneSeries(); notify();
  }, (e) => { console.error("series listener", e); doneSeries(); }));

  await Promise.all(firstLoad);
  state.ready = true;
  notify();

  // Top up recurring instances once the initial picture has loaded.
  ensureSeriesInstances().catch((e) => console.warn("series generation skipped:", e?.message));
}

/** Keep one RSVP listener per recent/upcoming event; drop the rest. */
function syncRsvpListeners() {
  const cutoff = addDays(new Date(), -LIVE_RSVP_WINDOW_DAYS);
  const wanted = new Set(
    state.events.filter((e) => (toDate(e.startAt) ?? 0) >= cutoff).map((e) => e.id)
  );

  rsvpUnsubs.forEach((un, id) => {
    if (!wanted.has(id)) { un(); rsvpUnsubs.delete(id); }
  });

  wanted.forEach((id) => {
    if (rsvpUnsubs.has(id)) return;
    const un = onSnapshot(collection(db, "events", id, "rsvps"), (snap) => {
      const m = new Map();
      snap.forEach((d) => m.set(d.id, d.data().status));
      state.rsvps.set(id, m);
      notify();
    }, (e) => console.error("rsvp listener", id, e));
    rsvpUnsubs.set(id, un);
  });
}

let specsWatching = false;
/** Officers mirror every member's full spec list so aggregates always work. */
function watchAllSpecs() {
  if (specsWatching) return;
  specsWatching = true;
  unsubs.push(onSnapshot(collection(db, "userSpecs"), (snap) => {
    state.allSpecs.clear();
    snap.forEach((d) => state.allSpecs.set(d.id, d.data().specs || []));
    notify();
  }, (e) => { console.warn("allSpecs listener", e); specsWatching = false; }));
}

/* ------------------------------ profile ------------------------------ */

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    email: user.email || "",
    displayName: user.displayName || (user.email || "").split("@")[0],
    gradYear: null,
    isOfficer: false,
    officerTitle: "",
    publicSpecs: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, "userSpecs", user.uid), { specs: [], updatedAt: serverTimestamp() });
}

export async function saveProfileBasics({ displayName, gradYear }) {
  await updateDoc(doc(db, "users", state.user.uid), {
    displayName: displayName.trim(),
    gradYear: gradYear ? Number(gradYear) : null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Persist the full spec list, and mirror the "shown" ones onto the public
 * profile so RSVP badges render without reading anyone's private doc.
 */
export async function saveSpecs(specs) {
  const uid = state.user.uid;
  const clean = specs.map((s) => ({
    key: s.key,
    label: String(s.label || "").slice(0, 60),
    note: String(s.note || "").slice(0, 200),
    visibility: s.visibility === "public" ? "public" : "private",
  }));

  const batch = writeBatch(db);
  batch.set(doc(db, "userSpecs", uid), { specs: clean, updatedAt: serverTimestamp() });
  batch.update(doc(db, "users", uid), {
    publicSpecs: clean.filter((s) => s.visibility === "public")
                      .map(({ key, label, note }) => ({ key, label, note })),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Officer passcode. The plaintext never leaves the browser: we send SHA-256 of
 * it, and the Firestore rule compares that against config/officer.codeHash,
 * which no client can read. A wrong code fails as permission-denied.
 */
export async function claimOfficer(passcode, title = "") {
  const uid = state.user.uid;
  const hash = await sha256Hex(String(passcode).trim());
  try {
    await setDoc(doc(db, "officerClaims", uid), { hash, at: serverTimestamp() });
  } catch (e) {
    if (e?.code === "permission-denied") throw new Error("That passcode isn't right.");
    throw e;
  }
  await updateDoc(doc(db, "users", uid), {
    isOfficer: true, officerTitle: title || "", updatedAt: serverTimestamp(),
  });
}

export async function releaseOfficer() {
  const uid = state.user.uid;
  await updateDoc(doc(db, "users", uid), { isOfficer: false, officerTitle: "", updatedAt: serverTimestamp() });
  try { await deleteDoc(doc(db, "officerClaims", uid)); } catch {}
}

/* ------------------------------- RSVP ------------------------------- */

export const myRsvp = (eventId) => state.rsvps.get(eventId)?.get(state.user?.uid) ?? null;

export function rsvpsFor(eventId) {
  const m = state.rsvps.get(eventId);
  if (!m) return null;                       // not loaded — caller shows counts only
  const going = [], deciding = [];
  m.forEach((status, uid) => (status === "going" ? going : deciding).push(uid));
  return { going, deciding };
}

export function countsFor(eventId, ev) {
  const live = rsvpsFor(eventId);
  if (live) return { going: live.going.length, deciding: live.deciding.length };
  return { going: ev?.counts?.going ?? 0, deciding: ev?.counts?.deciding ?? 0 };
}

/**
 * Set / clear my RSVP. Transactional so the denormalised counts on the event
 * can't drift, even with two devices tapping at once.
 * @param {'going'|'deciding'|null} next
 */
export async function setRsvp(eventId, next) {
  const uid = state.user.uid;
  const rsvpRef = doc(db, "events", eventId, "rsvps", uid);
  const evRef = doc(db, "events", eventId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(rsvpRef);
    const prev = snap.exists() ? snap.data().status : null;
    if (prev === next) return;

    const delta = {};
    if (prev) delta[`counts.${prev}`] = increment(-1);
    if (next) delta[`counts.${next}`] = increment(1);
    if (Object.keys(delta).length) tx.update(evRef, delta);

    if (next) tx.set(rsvpRef, { uid, status: next, updatedAt: serverTimestamp() });
    else tx.delete(rsvpRef);
  });
}

/** Load RSVPs for an archived event on demand (no live listener that far back). */
export async function loadRsvpsOnce(eventId) {
  if (state.rsvps.has(eventId)) return state.rsvps.get(eventId);
  const snap = await getDocs(collection(db, "events", eventId, "rsvps"));
  const m = new Map();
  snap.forEach((d) => m.set(d.id, d.data().status));
  state.rsvps.set(eventId, m);
  notify();
  return m;
}

/* ------------------------------- events ------------------------------- */

function eventPayload(data) {
  return {
    title: String(data.title || "").trim().slice(0, 120),
    description: String(data.description || "").trim().slice(0, 1200),
    location: String(data.location || "").trim().slice(0, 160),
    category: data.category || "other",
    startAt: Timestamp.fromDate(data.startAt),
    endAt: data.endAt ? Timestamp.fromDate(data.endAt) : null,
    threshold: Math.max(0, Number(data.threshold) || 0),
    decisionDeadline: Timestamp.fromDate(data.decisionDeadline),
    // Belt and braces — the form validates first and refuses to submit a bad
    // one, so anything invalid reaching here is stored as "no photo".
    photoUrl: normalizePhotoUrl(data.photoUrl).value ?? null,
  };
}

export async function createEvent(data) {
  const ref = await addDoc(collection(db, "events"), {
    ...eventPayload(data),
    seriesId: data.seriesId ?? null,
    override: null,
    outcome: null,
    outcomeNote: "",
    counts: { going: 0, deciding: 0 },
    attendance: null,
    createdBy: state.user.uid,
    createdByName: state.profile?.displayName || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateEvent(id, data) {
  await updateDoc(doc(db, "events", id), { ...eventPayload(data), updatedAt: serverTimestamp() });
}

/** Officer override: 'force' (happen regardless), 'cancel' (kill now), null (clear). */
export async function setOverride(id, override, note = "") {
  await updateDoc(doc(db, "events", id), {
    override,
    outcomeNote: override === "cancel" ? String(note || "").slice(0, 300) : "",
    updatedAt: serverTimestamp(),
  });
}

export async function extendDeadline(id, newDeadline) {
  await updateDoc(doc(db, "events", id), {
    decisionDeadline: Timestamp.fromDate(newDeadline), updatedAt: serverTimestamp(),
  });
}

/** Officer's final word on an archived event. */
export async function setOutcome(id, outcome, note = "") {
  await updateDoc(doc(db, "events", id), {
    outcome: outcome || null,
    outcomeNote: String(note || "").slice(0, 300),
    updatedAt: serverTimestamp(),
  });
}

/** Who actually showed up — deliberately separate from who RSVP'd. */
export async function setAttendance(id, uids) {
  await updateDoc(doc(db, "events", id), {
    attendance: {
      uids: [...new Set(uids)],
      count: new Set(uids).size,
      markedBy: state.profile?.displayName || state.user.uid,
      markedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEvent(id) {
  const snap = await getDocs(collection(db, "events", id, "rsvps"));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "events", id));
  await batch.commit();
}

/* ------------------------------- series ------------------------------- */

export async function createSeries(data) {
  const ref = await addDoc(collection(db, "series"), {
    title: String(data.title || "").trim().slice(0, 120),
    description: String(data.description || "").trim().slice(0, 1200),
    location: String(data.location || "").trim().slice(0, 160),
    category: data.category || "other",
    cadence: data.cadence || "weekly",
    anchorAt: Timestamp.fromDate(data.anchorAt),
    durationMinutes: Number(data.durationMinutes) || 120,
    threshold: Math.max(0, Number(data.threshold) || DEFAULTS.threshold),
    decisionLeadDays: Math.max(0, Number(data.decisionLeadDays) ?? DEFAULTS.decisionLeadDays),
    // Instances must match this exactly or firestore.rules refuses to let a
    // member's browser generate them — see ensureSeriesInstances().
    photoUrl: normalizePhotoUrl(data.photoUrl).value ?? null,
    paused: false,
    endsAt: data.endsAt ? Timestamp.fromDate(data.endsAt) : null,
    createdBy: state.user.uid,
    createdByName: state.profile?.displayName || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await ensureSeriesInstances();
  return ref.id;
}

export async function updateSeries(id, patch) {
  const clean = { ...patch, updatedAt: serverTimestamp() };
  if (patch.anchorAt) clean.anchorAt = Timestamp.fromDate(patch.anchorAt);
  if ("endsAt" in patch) clean.endsAt = patch.endsAt ? Timestamp.fromDate(patch.endsAt) : null;
  if ("photoUrl" in patch) clean.photoUrl = normalizePhotoUrl(patch.photoUrl).value ?? null;
  await updateDoc(doc(db, "series", id), clean);
  if (!clean.paused) await ensureSeriesInstances();
}

export const pauseSeries = (id, paused) => updateSeries(id, { paused });

/** End the series but leave already-generated instances alone. */
export const endSeries = (id) => updateSeries(id, { paused: true, endsAt: Timestamp.fromDate(new Date()) });

export async function deleteSeries(id) { await deleteDoc(doc(db, "series", id)); }

/**
 * Make sure every active series has its next instances materialised.
 *
 * Instance IDs are deterministic (`s-<seriesId>-<yyyymmdd>`) so two people
 * opening the app at the same time can't create duplicates, and so an officer
 * editing one week's instance is never overwritten — we only ever create docs
 * that don't already exist.
 */
export async function ensureSeriesInstances() {
  if (!state.user) return;
  const now = new Date();
  const horizon = addDays(now, DEFAULTS.seriesHorizonDays);
  const existing = new Set(state.events.map((e) => e.id));
  const created = [];

  for (const s of state.series) {
    if (s.paused) continue;
    const ends = toDate(s.endsAt);
    if (ends && ends < now) continue;

    const occurrences = seriesOccurrences(s, startOfDay(now), horizon);
    for (const when of occurrences) {
      const id = `s-${s.id}-${dayKey(when)}`;
      if (existing.has(id)) continue;

      const ref = doc(db, "events", id);
      // Cheap existence check — the local mirror can lag a fresh write.
      if ((await getDoc(ref)).exists()) continue;

      const lead = Number.isFinite(s.decisionLeadDays) ? s.decisionLeadDays : DEFAULTS.decisionLeadDays;
      const deadline = addDays(when, -lead);
      const endAt = new Date(when.getTime() + (Number(s.durationMinutes) || 120) * 60000);

      try {
        await setDoc(ref, {
          title: s.title,
          description: s.description || "",
          location: s.location || "",
          category: s.category || "other",
          startAt: Timestamp.fromDate(when),
          endAt: Timestamp.fromDate(endAt),
          threshold: s.threshold ?? DEFAULTS.threshold,
          decisionDeadline: Timestamp.fromDate(deadline < now ? when : deadline),
          // Must equal the template's value or the rules reject this create and
          // the series silently stops generating. `?? null` matters: templates
          // made before photoUrl existed have no such key, and the rule compares
          // with .get('photoUrl', null) on both sides.
          photoUrl: s.photoUrl ?? null,
          seriesId: s.id,
          override: null,
          outcome: null,
          outcomeNote: "",
          counts: { going: 0, deciding: 0 },
          attendance: null,
          createdBy: s.createdBy || state.user.uid,
          createdByName: s.createdByName || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        created.push(id);
      } catch (e) {
        if (e?.code === "permission-denied") {
          // The rules compare every generated field against the template. If this
          // fires, the two disagree and the series has quietly stopped generating —
          // which is invisible in the UI, so say so loudly here.
          console.warn(
            `[KTP] firestore.rules rejected recurring instance "${id}".\n` +
            `The generated event no longer matches series/${s.id}, so this series has ` +
            `stopped producing new dates. Check that title, location, category, ` +
            `threshold and photoUrl all agree on both sides, and that the rules use ` +
            `.get('photoUrl', null) rather than direct field access.`
          );
        } else {
          console.warn("series instance failed", id, e);
        }
      }
    }
  }
  return created;
}

/* --------------------------- officer aggregates --------------------------- */

/**
 * Spec counts across a set of people, honouring the promise that officers see
 * aggregates even for specs their owners kept private.
 * Returns [{key, label, count, uids}] sorted by count desc.
 */
export function aggregateSpecs(uids) {
  const byKey = new Map();
  for (const uid of uids) {
    const specs = state.allSpecs.get(uid) ?? state.members.get(uid)?.publicSpecs ?? [];
    for (const s of specs) {
      if (!s?.key) continue;
      const row = byKey.get(s.key) ?? { key: s.key, label: s.label || s.key, count: 0, uids: [], notes: [] };
      row.count += 1;
      row.uids.push(uid);
      if (s.note) row.notes.push(s.note);
      byKey.set(s.key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** True when officers are seeing the full (private-inclusive) picture. */
export const hasFullSpecAccess = () => isOfficer() && state.allSpecs.size > 0;

export const memberName = (uid) =>
  state.members.get(uid)?.displayName || (uid === state.user?.uid ? "You" : "Unknown member");

export const publicBadges = (uid) => state.members.get(uid)?.publicSpecs ?? [];
