/* ==========================================================================
   Officer actions. These are reachable from any event card (Home, Past,
   Calendar) as well as the Manage page, so they live here rather than inside a
   single view.
   ========================================================================== */

import {
  esc, el, toDate, addDays, toLocalInput, fromLocalInput, toDateInput,
  fromDateInput, fmtDateTime, toast, debounce,
  normalizePhotoUrl, isExternalPhotoUrl, $, $$,
} from "./util.js";
import { OUTCOMES, CADENCES, computeStatus } from "./lifecycle.js";
import * as store from "./store.js";
import { openModal, closeModal, eventOneLiner } from "./components.js";
import { CATEGORIES, DEFAULTS } from "./config.js";

const catOptions = (sel) => CATEGORIES
  .map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("");

const findEvent = (id) => store.state.events.find((e) => e.id === id);

/* ---------------------------- photo URL field ---------------------------- */

/** Markup for the shared "Photo URL" field + its live preview. */
function photoField(current) {
  return `
    <label class="field" style="margin-bottom:8px">
      <span class="field-label">Photo URL <span class="opt">(optional)</span></span>
      <input name="photoUrl" type="text" inputmode="url" maxlength="500"
             autocomplete="off" spellcheck="false"
             value="${esc(current || "")}"
             placeholder="assets/photos/bowling.jpg" />
      <span class="field-help">
        A file committed under <span class="mono">assets/photos/</span> is permanent.
        Google Photos and Google Drive links usually stop working within a few months
        and the photo quietly disappears. External links must be <span class="mono">https://</span>.
      </span>
    </label>
    <div class="photo-preview" data-preview hidden>
      <img data-preview-img alt="" />
      <span data-preview-msg></span>
    </div>`;
}

/**
 * Wire the live thumbnail. The point is that a bad link is caught here, while
 * the officer is looking at it, rather than turning into a silently missing
 * image on everyone's Home page.
 */
function wirePhotoField(form) {
  const input = $("[name=photoUrl]", form);
  if (!input) return;
  const box = $("[data-preview]", form);
  const img = $("[data-preview-img]", form);
  const msg = $("[data-preview-msg]", form);

  const bad = (text) => {
    box.hidden = false;
    box.classList.add("is-bad");
    img.hidden = true;
    img.removeAttribute("src");
    msg.textContent = text;
  };

  const refresh = () => {
    const res = normalizePhotoUrl(input.value);
    if (res.error) return bad(res.error);
    if (!res.value) { box.hidden = true; return; }

    box.hidden = false;
    box.classList.remove("is-bad");
    img.hidden = false;
    msg.textContent = "Checking the link…";
    // Don't leak the app URL to whatever host was pasted.
    if (isExternalPhotoUrl(res.value)) img.referrerPolicy = "no-referrer";
    img.src = res.value;
  };

  img.addEventListener("load", () => {
    box.classList.remove("is-bad");
    msg.textContent = `Looks good — ${img.naturalWidth}×${img.naturalHeight}.`;
  });
  img.addEventListener("error", () => {
    bad("That link didn't load. Check the path, or whether the file is shared publicly.");
  });

  input.addEventListener("input", debounce(refresh, 400));
  refresh();
}

/* --------------------------- create / edit event --------------------------- */

export function eventForm(existing = null, onDone) {
  const start = existing ? toDate(existing.startAt) : defaultStart();
  const deadline = existing
    ? toDate(existing.decisionDeadline)
    : addDays(start, -DEFAULTS.decisionLeadDays);

  const form = el(`
    <form class="officer-form">
      <label class="field">
        <span class="field-label">Event name</span>
        <input name="title" required maxlength="120" value="${esc(existing?.title || "")}"
               placeholder="Bowling night at Bowl Mor" />
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field-label">Starts</span>
          <input name="startAt" type="datetime-local" required value="${toLocalInput(start)}" />
        </label>
        <label class="field">
          <span class="field-label">Type</span>
          <select name="category">${catOptions(existing?.category || "brotherhood")}</select>
        </label>
      </div>

      <label class="field">
        <span class="field-label">Location</span>
        <input name="location" maxlength="160" value="${esc(existing?.location || "")}"
               placeholder="Hinds Hall / JMA Dome / 123 Euclid" />
      </label>

      <label class="field">
        <span class="field-label">Description <span class="opt">(optional)</span></span>
        <textarea name="description" maxlength="1200" placeholder="Cost, what to bring, meeting spot…">${esc(existing?.description || "")}</textarea>
      </label>

      ${photoField(existing?.photoUrl)}

      <hr class="divider" />

      <div class="field-row">
        <label class="field">
          <span class="field-label">Interest threshold</span>
          <input name="threshold" type="number" min="0" max="200" required
                 value="${existing?.threshold ?? DEFAULTS.threshold}" />
          <span class="field-help">"Going" RSVPs needed for this to be on.</span>
        </label>
        <label class="field">
          <span class="field-label">Decision deadline</span>
          <input name="decisionDeadline" type="datetime-local" required value="${toLocalInput(deadline)}" />
          <span class="field-help">Miss it and the event is flagged At Risk.</span>
        </label>
      </div>

      <div class="note-box">
        Under the threshold at the deadline &rarr; <strong>At Risk</strong> warning on the home banner.
        Still under it when the event starts &rarr; auto-archived as <strong>cancelled for low interest</strong>.
        You can force it on or cancel it early at any point.
      </div>

      <p class="auth-err" data-err hidden></p>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? "Save changes" : "Create event"}</button>
      </div>
    </form>`);

  wirePhotoField(form);

  // Keep the deadline glued to the start date until the officer touches it.
  let deadlineTouched = Boolean(existing);
  $("[name=decisionDeadline]", form).addEventListener("input", () => (deadlineTouched = true));
  $("[name=startAt]", form).addEventListener("change", (e) => {
    if (deadlineTouched) return;
    const d = fromLocalInput(e.target.value);
    if (d) $("[name=decisionDeadline]", form).value = toLocalInput(addDays(d, -DEFAULTS.decisionLeadDays));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("[data-err]", form);
    err.hidden = true;
    const fd = new FormData(form);
    const startAt = fromLocalInput(fd.get("startAt"));
    const dl = fromLocalInput(fd.get("decisionDeadline"));

    if (!startAt) return fail(err, "Pick a start date and time.");
    if (!dl) return fail(err, "Pick a decision deadline.");
    if (dl > startAt) return fail(err, "The decision deadline has to be on or before the event starts.");
    if (!existing && startAt < new Date()) return fail(err, "That start time is in the past.");

    const photo = normalizePhotoUrl(fd.get("photoUrl"));
    if (photo.error) return fail(err, photo.error);

    const data = {
      title: fd.get("title"),
      description: fd.get("description"),
      location: fd.get("location"),
      category: fd.get("category"),
      startAt,
      endAt: null,
      threshold: fd.get("threshold"),
      decisionDeadline: dl,
      photoUrl: photo.value,
    };

    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true; submit.textContent = "Saving…";
    try {
      if (existing) { await store.updateEvent(existing.id, data); toast("Event updated."); }
      else { await store.createEvent(data); toast("Event created."); }
      closeModal();
      onDone?.();
    } catch (ex) {
      console.error(ex);
      fail(err, "Couldn't save that. " + (ex?.message || ""));
      submit.disabled = false; submit.textContent = existing ? "Save changes" : "Create event";
    }
  });

  return form;
}

function defaultStart() {
  const d = addDays(new Date(), 7);
  d.setHours(19, 0, 0, 0);
  return d;
}

function fail(err, msg) { err.textContent = msg; err.hidden = false; }

/* ------------------------------ recurring ------------------------------ */

export function seriesForm(existing = null, onDone) {
  const anchor = existing ? toDate(existing.anchorAt) : defaultStart();
  const form = el(`
    <form class="officer-form">
      <div class="note-box" style="margin-bottom:16px">
        A series is a template. It keeps ${DEFAULTS.seriesHorizonDays} days of instances generated ahead,
        each with its own fresh RSVP list. Editing a single week doesn't touch the template, and the
        template never overwrites an instance that already exists.
      </div>

      <label class="field">
        <span class="field-label">Event name</span>
        <input name="title" required maxlength="120" value="${esc(existing?.title || "")}"
               placeholder="Football at the Dome" />
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field-label">First occurrence</span>
          <input name="anchorAt" type="datetime-local" required value="${toLocalInput(anchor)}" />
          <span class="field-help">Sets the day of week and time for every instance.</span>
        </label>
        <label class="field">
          <span class="field-label">Repeats</span>
          <select name="cadence">
            ${CADENCES.map((c) => `<option value="${c.id}" ${existing?.cadence === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span class="field-label">Type</span>
          <select name="category">${catOptions(existing?.category || "athletics")}</select>
        </label>
        <label class="field">
          <span class="field-label">Ends <span class="opt">(optional)</span></span>
          <input name="endsAt" type="date" value="${existing?.endsAt ? toDateInput(toDate(existing.endsAt)) : ""}" />
          <span class="field-help">Leave blank to run until you pause it.</span>
        </label>
      </div>

      <label class="field">
        <span class="field-label">Location</span>
        <input name="location" maxlength="160" value="${esc(existing?.location || "")}" placeholder="JMA Wireless Dome" />
      </label>

      <label class="field">
        <span class="field-label">Description <span class="opt">(optional)</span></span>
        <textarea name="description" maxlength="1200">${esc(existing?.description || "")}</textarea>
      </label>

      ${photoField(existing?.photoUrl)}

      <div class="field-row">
        <label class="field">
          <span class="field-label">Threshold per instance</span>
          <input name="threshold" type="number" min="0" max="200" required
                 value="${existing?.threshold ?? DEFAULTS.threshold}" />
        </label>
        <label class="field">
          <span class="field-label">Decide this many days before</span>
          <input name="decisionLeadDays" type="number" min="0" max="30" required
                 value="${existing?.decisionLeadDays ?? DEFAULTS.decisionLeadDays}" />
        </label>
      </div>

      <p class="auth-err" data-err hidden></p>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? "Save series" : "Create series"}</button>
      </div>
    </form>`);

  wirePhotoField(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("[data-err]", form);
    err.hidden = true;
    const fd = new FormData(form);
    const anchorAt = fromLocalInput(fd.get("anchorAt"));
    if (!anchorAt) return fail(err, "Pick a first occurrence.");

    const photo = normalizePhotoUrl(fd.get("photoUrl"));
    if (photo.error) return fail(err, photo.error);

    const data = {
      title: fd.get("title"),
      description: fd.get("description"),
      location: fd.get("location"),
      category: fd.get("category"),
      cadence: fd.get("cadence"),
      anchorAt,
      durationMinutes: 180,
      threshold: fd.get("threshold"),
      decisionLeadDays: fd.get("decisionLeadDays"),
      photoUrl: photo.value,
      endsAt: fromDateInput(fd.get("endsAt"), true),
    };

    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true; submit.textContent = "Saving…";
    try {
      if (existing) { await store.updateSeries(existing.id, data); toast("Series updated."); }
      else { await store.createSeries(data); toast("Series created — first instances are live."); }
      closeModal();
      onDone?.();
    } catch (ex) {
      console.error(ex);
      fail(err, "Couldn't save that. " + (ex?.message || ""));
      submit.disabled = false; submit.textContent = existing ? "Save series" : "Create series";
    }
  });

  return form;
}

/* ------------------------------- turnout ------------------------------- */

function turnoutModal(ev, onDone) {
  const rsvps = store.rsvpsFor(ev.id);
  const rsvpGoing = new Set(rsvps?.going ?? []);
  const already = new Set(ev.attendance?.uids ?? (rsvps ? rsvps.going : []));

  // Everyone in the chapter, with RSVP'd-going people first — most of the
  // checking is confirming that list, but walk-ons need to be checkable too.
  const members = [...store.state.members.values()].sort((a, b) => {
    const ag = rsvpGoing.has(a.uid), bg = rsvpGoing.has(b.uid);
    if (ag !== bg) return ag ? -1 : 1;
    return (a.displayName || "").localeCompare(b.displayName || "");
  });

  const body = el(`
    <div>
      <p class="card-desc" style="margin-bottom:14px">
        <strong>${esc(ev.title)}</strong><br>
        <span style="color:var(--muted);font-size:13px">${esc(eventOneLiner(ev))}</span>
      </p>
      <div class="note-box" style="margin-bottom:14px">
        Check who <em>actually showed up</em>. This is tracked separately from RSVPs so the archive can
        show both — e.g. &ldquo;18 RSVP'd, 12 attended&rdquo;. Walk-ons who never RSVP'd count too.
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button type="button" class="btn btn-ghost btn-sm" data-bulk="rsvp">Check everyone who RSVP'd</button>
        <button type="button" class="btn btn-ghost btn-sm" data-bulk="none">Clear all</button>
      </div>
      <div id="turnout-list" style="max-height:44vh;overflow-y:auto;border:1px solid var(--line);padding:4px 12px">
        ${members.map((m) => `
          <label class="check">
            <input type="checkbox" value="${esc(m.uid)}" ${already.has(m.uid) ? "checked" : ""} />
            <span>${esc(m.displayName || m.email)}
              ${rsvpGoing.has(m.uid) ? `<span class="person-badge" style="margin-left:6px">RSVP'd</span>` : ""}
            </span>
          </label>`).join("") || `<p class="person-none" style="padding:12px 0">No members yet.</p>`}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>Save turnout <span data-count></span></button>
      </div>
    </div>`);

  const boxes = () => $$("#turnout-list input", body);
  const refresh = () => {
    const n = boxes().filter((b) => b.checked).length;
    $("[data-count]", body).textContent = `(${n})`;
  };
  body.addEventListener("change", refresh);
  $$("[data-bulk]", body).forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.bulk;
    boxes().forEach((box) => (box.checked = mode === "rsvp" ? rsvpGoing.has(box.value) : false));
    refresh();
  }));
  refresh();

  $("[data-save]", body).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await store.setAttendance(ev.id, boxes().filter((b) => b.checked).map((b) => b.value));
      toast("Turnout recorded.");
      closeModal(); onDone?.();
    } catch (ex) {
      console.error(ex); toast("Couldn't save turnout.", "err");
      btn.disabled = false; btn.textContent = "Save turnout";
    }
  });

  openModal("Mark turnout", body);
}

/* ------------------------------- outcome ------------------------------- */

function outcomeModal(ev, onDone) {
  const status = computeStatus(ev, store.countsFor(ev.id, ev).going);
  const body = el(`
    <div>
      <p class="card-desc" style="margin-bottom:14px"><strong>${esc(ev.title)}</strong><br>
        <span style="color:var(--muted);font-size:13px">${esc(eventOneLiner(ev))}</span></p>
      <div class="note-box" style="margin-bottom:14px">
        Right now this reads as <strong>${esc(status.label)}</strong>, worked out from the RSVP count.
        Set it explicitly if that's wrong — your answer sticks.
      </div>
      <label class="field">
        <span class="field-label">Outcome</span>
        <select name="outcome">
          <option value="">Leave it automatic</option>
          ${OUTCOMES.map((o) => `<option value="${o.id}" ${ev.outcome === o.id ? "selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span class="field-label">Note <span class="opt">(optional)</span></span>
        <input name="note" maxlength="300" value="${esc(ev.outcomeNote || "")}" placeholder="Rained out; moved to next week" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>Save outcome</button>
      </div>
    </div>`);

  $("[data-save]", body).addEventListener("click", async () => {
    try {
      await store.setOutcome(ev.id, $("[name=outcome]", body).value, $("[name=note]", body).value);
      toast("Outcome saved."); closeModal(); onDone?.();
    } catch { toast("Couldn't save that.", "err"); }
  });

  openModal("Set outcome", body);
}

/* ------------------------- extend / force / cancel ------------------------- */

function extendModal(ev, onDone) {
  const start = toDate(ev.startAt);
  const current = toDate(ev.decisionDeadline);
  const body = el(`
    <div>
      <p class="card-desc" style="margin-bottom:14px">
        Deadline is currently <strong>${esc(fmtDateTime(current))}</strong>.
        The event starts ${esc(fmtDateTime(start))}.
      </p>
      <label class="field">
        <span class="field-label">New decision deadline</span>
        <input type="datetime-local" name="dl" value="${toLocalInput(current)}" />
      </label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        <button type="button" class="btn btn-ghost btn-sm" data-add="1">+1 day</button>
        <button type="button" class="btn btn-ghost btn-sm" data-add="3">+3 days</button>
        <button type="button" class="btn btn-ghost btn-sm" data-add="7">+1 week</button>
        <button type="button" class="btn btn-ghost btn-sm" data-start>Right up to start</button>
      </div>
      <p class="auth-err" data-err hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>Save deadline</button>
      </div>
    </div>`);

  const input = $("[name=dl]", body);
  $$("[data-add]", body).forEach((b) => b.addEventListener("click", () => {
    const base = fromLocalInput(input.value) || current || new Date();
    input.value = toLocalInput(addDays(base, Number(b.dataset.add)));
  }));
  $("[data-start]", body).addEventListener("click", () => (input.value = toLocalInput(start)));

  $("[data-save]", body).addEventListener("click", async () => {
    const err = $("[data-err]", body);
    const d = fromLocalInput(input.value);
    if (!d) return fail(err, "Pick a date and time.");
    if (d > start) return fail(err, "The deadline can't be after the event starts.");
    try { await store.extendDeadline(ev.id, d); toast("Deadline moved."); closeModal(); onDone?.(); }
    catch { fail(err, "Couldn't save that."); }
  });

  openModal("Extend deadline", body);
}

function killModal(ev, onDone) {
  const body = el(`
    <div>
      <p class="card-desc" style="margin-bottom:14px">
        Cancelling <strong>${esc(ev.title)}</strong> takes it off the home list immediately and files it
        in Previous Events as cancelled. RSVPs are kept.
      </p>
      <label class="field">
        <span class="field-label">Reason <span class="opt">(shown to everyone)</span></span>
        <input name="note" maxlength="300" placeholder="Venue fell through" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Keep it</button>
        <button type="button" class="btn btn-danger" data-save>Cancel this event</button>
      </div>
    </div>`);

  $("[data-save]", body).addEventListener("click", async () => {
    try {
      await store.setOverride(ev.id, "cancel", $("[name=note]", body).value);
      toast("Event cancelled."); closeModal(); onDone?.();
    } catch { toast("Couldn't cancel that.", "err"); }
  });

  openModal("Cancel event", body);
}

/* ---------------------------- action dispatch ---------------------------- */

/** Handlers keyed by the `data-act` values used on event cards. */
export function officerHandlers(rerender) {
  const guard = (fn) => async (id, btn) => {
    const ev = findEvent(id);
    if (!ev) return toast("That event isn't loaded.", "err");
    if (!store.isOfficer()) return toast("Officers only.", "err");
    try { await fn(ev, btn); } catch (e) { console.error(e); toast("That didn't work.", "err"); }
  };

  return {
    edit:    guard((ev) => openModal("Edit event", eventForm(ev, rerender))),
    turnout: guard((ev) => turnoutModal(ev, rerender)),
    outcome: guard((ev) => outcomeModal(ev, rerender)),
    extend:  guard((ev) => extendModal(ev, rerender)),
    kill:    guard((ev) => killModal(ev, rerender)),
    force:   guard(async (ev) => { await store.setOverride(ev.id, "force"); toast("Locked in — this is happening."); rerender(); }),
    unforce: guard(async (ev) => { await store.setOverride(ev.id, null);    toast("Back to automatic."); rerender(); }),
    revive:  guard(async (ev) => { await store.setOverride(ev.id, null);    toast("Un-cancelled."); rerender(); }),
  };
}

export { turnoutModal, outcomeModal, extendModal, killModal };
