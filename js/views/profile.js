/* ==========================================================================
   Profile — name/grad year, specifications with per-spec visibility, and the
   officer passcode gate.

   Visibility model, stated plainly on the page because it matters:
     • Private (default) — nobody sees the badge. Officers still see you inside
       aggregate counts for planning, but never tied to your name.
     • Shown — the badge appears next to your name on every RSVP list.
   ========================================================================== */

import { esc, initials, toast, $, $$ } from "../util.js";
import * as store from "../store.js";
import { SPEC_PRESETS, OFFICER_TITLES } from "../config.js";

export function render() {
  const p = store.state.profile || {};
  const specs = store.state.mySpecs || [];
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const customs = specs.filter((s) => !SPEC_PRESETS.some((x) => x.key === s.key));

  return `
    <div class="page-head">
      <h1 class="page-title">Your profile</h1>
      <p class="page-sub">This follows your account, so it's the same on your phone and your laptop.</p>
    </div>

    <section class="section">
      ${head("Account")}
      <div class="card" style="padding:18px">
        <div class="sb-user" style="margin-bottom:16px">
          <div class="sb-avatar" style="width:44px;height:44px;font-size:14px">${esc(initials(p.displayName))}</div>
          <div class="sb-userinfo">
            <div class="sb-username" style="font-size:15px">${esc(p.displayName || "—")}</div>
            <div class="sb-userrole">${esc(p.email || "")}</div>
          </div>
        </div>
        <form id="basics-form">
          <label class="field">
            <span class="field-label">Display name</span>
            <input name="displayName" value="${esc(p.displayName || "")}" required maxlength="60" />
            <span class="field-help">This is the name brothers see on RSVP lists.</span>
          </label>
          <label class="field">
            <span class="field-label">Grad year <span class="opt">(optional)</span></span>
            <input name="gradYear" type="number" min="2024" max="2035" value="${p.gradYear ?? ""}" />
          </label>
          <button class="btn btn-primary" type="submit">Save</button>
        </form>
      </div>
    </section>

    <section class="section">
      ${head("Specifications")}
      <div class="note-box" style="margin-bottom:14px">
        <strong>Private is the default.</strong> Flip a spec to <em>Shown</em> and it appears as a
        badge next to your name wherever you show up on an RSVP list — e.g.
        &ldquo;${esc((p.displayName || "Andrew").split(" ")[0])} <span class="person-badge">Under 21</span>&rdquo;.
        Either way, officers planning an event see <em>anonymous totals</em>
        (&ldquo;3 non-drinkers, 2 under 21&rdquo;) so they can pick a venue that works.
      </div>

      <div class="spec-list" id="spec-list">
        ${SPEC_PRESETS.map((preset) => specRow(preset, byKey.get(preset.key))).join("")}
        ${customs.map((c) => specRow({ key: c.key, label: c.label, hint: "Custom" }, c, true)).join("")}
      </div>

      <div class="card" style="padding:16px;margin-top:14px">
        <form id="custom-form">
          <label class="field">
            <span class="field-label">Add your own</span>
            <input name="label" placeholder="e.g. Works Thursday nights" maxlength="60" required />
            <span class="field-help">Anything a social chair should know when planning around you.</span>
          </label>
          <button class="btn btn-ghost" type="submit">Add specification</button>
        </form>
      </div>
    </section>

    <section class="section">
      ${head("Officer access")}
      ${p.isOfficer ? officerOn(p) : officerOff()}
    </section>
  `;
}

const head = (t) => `<div class="section-head"><h2 class="section-title">${esc(t)}</h2></div>`;

function specRow(preset, current, isCustom = false) {
  const on = Boolean(current);
  const vis = current?.visibility === "public" ? "public" : "private";
  return `
    <div class="spec ${on ? "is-on" : ""}" data-key="${esc(preset.key)}" data-label="${esc(preset.label)}">
      <label class="switch">
        <input type="checkbox" class="spec-on" ${on ? "checked" : ""} aria-label="${esc(preset.label)}" />
        <span class="switch-track"></span>
      </label>
      <div class="spec-main">
        <div class="spec-label">${esc(preset.label)}</div>
        <div class="spec-note">${esc(preset.hint || "")}</div>
        ${on ? `<input class="spec-note-input" placeholder="Add a detail (optional) — e.g. peanut allergy"
                  value="${esc(current?.note || "")}" maxlength="200"
                  style="margin-top:8px;width:100%;padding:8px 10px;border:1px solid var(--line-strong);font-size:14px" />` : ""}
      </div>
      <div class="spec-ctrl">
        <div class="vis-toggle" role="group" aria-label="Visibility">
          <button type="button" class="spec-vis ${vis === "private" ? "on" : ""}" data-vis="private" ${on ? "" : "disabled"}>Private</button>
          <button type="button" class="spec-vis ${vis === "public" ? "on" : ""}"  data-vis="public"  ${on ? "" : "disabled"}>Shown</button>
        </div>
        ${isCustom ? `<button type="button" class="icon-btn spec-del" aria-label="Remove">&times;</button>` : ""}
      </div>
    </div>`;
}

function officerOff() {
  return `
    <div class="card" style="padding:18px">
      <p class="card-desc" style="margin:0 0 14px">
        Officers can create and edit events, set up recurring series, mark turnout, and
        override an event's status. Enter the shared officer passcode to unlock it on this account.
      </p>
      <form id="officer-form">
        <label class="field">
          <span class="field-label">Your role</span>
          <select name="title">
            ${OFFICER_TITLES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
            <option value="Other">Other</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Officer passcode</span>
          <input name="code" type="password" autocomplete="off" required placeholder="Ask the current board" />
        </label>
        <p class="auth-err" id="officer-err" hidden></p>
        <button class="btn btn-primary" type="submit">Unlock officer tools</button>
      </form>
    </div>`;
}

function officerOn(p) {
  return `
    <div class="card" style="padding:18px">
      <div class="tagrow" style="margin:0 0 12px">
        <span class="pill go">Officer</span>
        ${p.officerTitle ? `<span class="pill plain">${esc(p.officerTitle)}</span>` : ""}
      </div>
      <p class="card-desc" style="margin:0 0 14px">
        You have access to <strong>Manage</strong> in the sidebar. Hand this off at the end of your
        term by giving the next chair the passcode — then remove it here.
      </p>
      <button class="btn btn-ghost" id="officer-release">Remove officer access from my account</button>
    </div>`;
}

/* ------------------------------- behaviour ------------------------------- */

export function mount(root, rerender) {
  /* --- basics --- */
  const basics = $("#basics-form", root);
  basics?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(basics);
    const name = String(fd.get("displayName") || "").trim();
    if (!name) return toast("Name can't be empty.", "err");
    try {
      await store.saveProfileBasics({ displayName: name, gradYear: fd.get("gradYear") });
      toast("Profile saved.");
    } catch { toast("Couldn't save your profile.", "err"); }
  });

  /* --- specs: collect the whole list from the DOM on every change --- */
  const list = $("#spec-list", root);

  function collect() {
    return $$(".spec", list).flatMap((row) => {
      if (!$(".spec-on", row).checked) return [];
      return [{
        key: row.dataset.key,
        label: row.dataset.label,
        note: $(".spec-note-input", row)?.value || "",
        visibility: $(".spec-vis.on", row)?.dataset.vis === "public" ? "public" : "private",
      }];
    });
  }

  async function persist(msg) {
    try { await store.saveSpecs(collect()); if (msg) toast(msg); }
    catch (err) { console.error(err); toast("Couldn't save that change.", "err"); }
  }

  list?.addEventListener("change", (e) => {
    if (e.target.classList.contains("spec-on")) persist().then(rerender);
  });

  list?.addEventListener("click", (e) => {
    const vis = e.target.closest(".spec-vis");
    if (vis && !vis.disabled) {
      const row = vis.closest(".spec");
      $$(".spec-vis", row).forEach((b) => b.classList.toggle("on", b === vis));
      persist(vis.dataset.vis === "public" ? "Badge is now visible to everyone." : "Badge is private again.");
      return;
    }
    const del = e.target.closest(".spec-del");
    if (del) {
      del.closest(".spec").remove();
      persist("Removed.").then(rerender);
    }
  });

  // Debounced save for the free-text note fields.
  let noteTimer = 0;
  list?.addEventListener("input", (e) => {
    if (!e.target.classList.contains("spec-note-input")) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => persist(), 700);
  });

  /* --- custom spec --- */
  const customForm = $("#custom-form", root);
  customForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = String(new FormData(customForm).get("label") || "").trim();
    if (!label) return;
    const key = "c_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
    const existing = store.state.mySpecs || [];
    if (existing.some((s) => s.key === key)) return toast("You already have that one.", "err");
    try {
      await store.saveSpecs([...existing, { key, label, note: "", visibility: "private" }]);
      toast("Added — private by default.");
      rerender();
    } catch { toast("Couldn't add that.", "err"); }
  });

  /* --- officer gate --- */
  const officerForm = $("#officer-form", root);
  officerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#officer-err", root);
    err.hidden = true;
    const fd = new FormData(officerForm);
    const btn = officerForm.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await store.claimOfficer(fd.get("code"), fd.get("title"));
      toast("Officer tools unlocked.");
      rerender();
    } catch (ex) {
      err.textContent = ex.message || "That passcode isn't right.";
      err.hidden = false;
      btn.disabled = false; btn.textContent = "Unlock officer tools";
    }
  });

  $("#officer-release", root)?.addEventListener("click", async () => {
    if (!confirm("Remove officer access from your account? You'll need the passcode to get it back.")) return;
    try { await store.releaseOfficer(); toast("Officer access removed."); rerender(); }
    catch { toast("Couldn't do that.", "err"); }
  });
}
