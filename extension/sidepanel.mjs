import { reviewFields, reviewCounts } from "./review-state.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let profile = null,
  scan = null,
  activeTab = null,
  base = "",
  token = "";
let rows = [],
  view = "suggested";
function status(s) {
  $("#status").textContent = s;
}
function refreshReview() {
  const counts = reviewCounts(rows);
  for (const group of ["suggested", "attention", "preserved"])
    $("#" + group + "-count").textContent = counts[group];
  let shown = 0;
  for (const card of document.querySelectorAll(".match")) {
    const row = rows[Number(card.dataset.row)];
    card.hidden = view !== "all" && row.group !== view;
    if (!card.hidden) shown++;
  }
  for (const button of document.querySelectorAll("[data-view]"))
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  $("#empty-view").hidden = shown > 0;
  const selected = [
    ...document.querySelectorAll("input[data-index]:checked:not(:disabled)"),
  ].filter(
    (check) =>
      document.querySelector(`[data-fact="${check.dataset.index}"]`).value !==
      "",
  ).length;
  $("#fill").textContent =
    `Fill ${selected} selected empty field${selected === 1 ? "" : "s"} →`;
  $("#fill").disabled = selected === 0 || !scan;
}
for (const button of document.querySelectorAll("[data-view]"))
  button.onclick = () => {
    view = button.dataset.view;
    refreshReview();
  };
$("#clear-selection").onclick = () => {
  for (const check of document.querySelectorAll("input[data-index]"))
    check.checked = false;
  refreshReview();
};
$("#select-suggestions").onclick = () => {
  for (const check of document.querySelectorAll("input[data-index]")) {
    const row = rows[Number(check.dataset.index)];
    if (!check.disabled && row.group === "suggested") check.checked = true;
  }
  refreshReview();
};
$("#matches").onchange = (event) => {
  const selected = event.target;
  if (selected.matches("select[data-fact]")) {
    const check = document.querySelector(
      `[data-index="${selected.dataset.fact}"]`,
    );
    if (!check.disabled) check.checked = selected.value !== "";
  }
  refreshReview();
};
async function load() {
  const r = await fetch(base + "/api/assist", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  profile = data;
  $("#name").textContent = data.applicant.name;
  $("#expiry").textContent =
    "Read-only pairing · expires " +
    new Date(data.expiresAt).toLocaleTimeString();
  $("#pair").hidden = true;
  $("#connected").hidden = false;
}
$("#connect").onclick = async () => {
  base = $("#base").value;
  token = $("#token").value.trim();
  if (!token) return status("Paste a pairing token first.");
  $("#connect").disabled = true;
  try {
    await load();
    await chrome.storage.session.set({ humetoPair: { base, token } });
    $("#token").value = "";
    status(
      "Paired. Your profile stays in the extension, not the application page.",
    );
  } catch (e) {
    status(e.message);
  } finally {
    $("#connect").disabled = false;
  }
};
$("#disconnect").onclick = async () => {
  await chrome.storage.session.remove("humetoPair");
  token = "";
  profile = null;
  scan = null;
  $("#pair").hidden = false;
  $("#connected").hidden = true;
  $("#matches").replaceChildren();
  $("#review-tools").hidden = true;
  rows = [];
  status(
    "Disconnected. Revoke the token in Humeto settings if you no longer need it.",
  );
};
$("#scan").onclick = async () => {
  status("Inspecting visible fields…");
  $("#fill").hidden = true;
  $("#review-tools").hidden = true;
  $("#matches").replaceChildren();
  scan = null;
  rows = [];
  $("#scan").disabled = true;
  try {
    await load();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !/^https?:/.test(tab.url || ""))
      throw new Error(
        "Open an ordinary HTTP/HTTPS application page and click the extension toolbar icon there.",
      );
    activeTab = tab.id;
    await chrome.scripting.executeScript({
      target: { tabId: activeTab },
      files: ["content.js"],
    });
    scan = await chrome.tabs.sendMessage(activeTab, { type: "HUMETO_SCAN" });
    $("#page-name").textContent =
      scan.title + " · " + new URL(scan.url).hostname;
    rows = reviewFields(scan.fields, profile.facts);
    view = rows.some((row) => row.group === "suggested")
      ? "suggested"
      : rows.some((row) => row.group === "attention")
        ? "attention"
        : "preserved";
    $("#matches").innerHTML = rows
      .map(
        ({ field, match, index: i, selected, group }) =>
          `<article class="match" data-row="${i}"><label><input type="checkbox" data-index="${i}" ${selected ? "checked" : ""} ${field.value ? "disabled" : ""}><strong>${esc(field.label)}</strong></label><small>${field.value ? "Existing answer preserved" : "Empty " + esc(field.type) + " field"}</small><select data-fact="${i}" aria-label="Profile field for ${esc(field.label)}" ${field.value ? "disabled" : ""}><option value="">Leave for manual entry</option>${profile.facts.map((f, j) => `<option value="${j}" ${match?.fact === f ? "selected" : ""}>${esc(f.label)} · ${esc(f.value.slice(0, 60))}</option>`).join("")}</select><small>${group === "preserved" ? "Humeto will not replace this answer" : match ? "Suggested mapping · review the value before applying" : "No unique match · keep manual or choose a value"}</small><div data-result="${i}"></div></article>`,
      )
      .join("");
    $("#review-tools").hidden = !scan.fields.length;
    refreshReview();
    $("#fill").hidden = !scan.fields.length;
    status(
      `${scan.fields.length} visible fields. Review suggestions together and fill one approved batch. Uncertain matches and file uploads stay under your control.`,
    );
  } catch (e) {
    status(e.message);
  } finally {
    $("#scan").disabled = false;
  }
};
$("#fill").onclick = async () => {
  if (!scan || !profile) return;
  $("#fill").disabled = true;
  try {
    const reviewed = JSON.stringify(profile.facts);
    await load();
    if (JSON.stringify(profile.facts) !== reviewed)
      throw new Error(
        "The source profile changed. Scan again and review the latest values.",
      );
    const [visibleTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (visibleTab?.id !== activeTab)
      throw new Error(
        "The active tab changed. Scan the page you want to fill.",
      );
    const current = await chrome.tabs.get(activeTab);
    if (current.url !== scan.url)
      throw new Error("The application page changed. Scan again.");
    const items = [];
    for (const check of document.querySelectorAll(
      "input[data-index]:checked",
    )) {
      const i = Number(check.dataset.index),
        selected = document.querySelector(`[data-fact="${i}"]`).value;
      if (selected === "") continue;
      const fact = profile.facts[Number(selected)];
      if (!fact) continue;
      items.push({
        id: scan.fields[i].id,
        label: scan.fields[i].label,
        value: fact.value,
      });
    }
    if (!items.length)
      return status("Select at least one empty field and a profile value.");
    const result = await chrome.tabs.sendMessage(activeTab, {
      type: "HUMETO_FILL",
      url: scan.url,
      items,
    });
    if (result.error) throw new Error(result.error);
    for (const row of result.results) {
      const index = scan.fields.findIndex((f) => f.id === row.id),
        el = document.querySelector(`[data-result="${index}"]`);
      if (el) el.textContent = row.reason;
      if (row.ok && index >= 0) {
        const check = document.querySelector(`[data-index="${index}"]`);
        check.checked = false;
        check.disabled = true;
        document.querySelector(`[data-fact="${index}"]`).disabled = true;
        rows[index].group = "preserved";
      }
    }
    status(
      `${result.results.filter((r) => r.ok).length} field(s) filled. Verify all values in the portal yourself. Nothing was submitted.`,
    );
  } catch (e) {
    scan = null;
    status(e.message);
  } finally {
    refreshReview();
  }
};
const stored = await chrome.storage.session.get("humetoPair");
if (stored.humetoPair) {
  base = stored.humetoPair.base;
  token = stored.humetoPair.token;
  try {
    await load();
  } catch (e) {
    status(e.message);
  }
}
