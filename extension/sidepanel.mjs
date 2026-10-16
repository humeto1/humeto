import { matchField } from "./matcher.mjs";
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
function status(s) {
  $("#status").textContent = s;
}
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
  status(
    "Disconnected. Revoke the token in Humeto settings if you no longer need it.",
  );
};
$("#scan").onclick = async () => {
  status("Inspecting visible fields…");
  $("#fill").hidden = true;
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
    $("#matches").innerHTML = scan.fields
      .map((field, i) => {
        const matched = matchField(field, profile.facts);
        return `<article class="match"><label><input type="checkbox" data-index="${i}" ${matched && !field.value ? "checked" : ""} ${field.value ? "disabled" : ""}><strong>${esc(field.label)}</strong></label><small>${field.value ? "Existing answer preserved" : "Empty " + esc(field.type) + " field"}</small><select data-fact="${i}" aria-label="Profile field for ${esc(field.label)}"><option value="">Leave for manual entry</option>${profile.facts.map((f, j) => `<option value="${j}" ${matched?.fact === f ? "selected" : ""}>${esc(f.label)} · ${esc(f.value.slice(0, 60))}</option>`).join("")}</select><small>${matched ? "Suggested match · review required" : "No confident match · choose manually if appropriate"}</small><div data-result="${i}"></div></article>`;
      })
      .join("");
    $("#fill").hidden = !scan.fields.length;
    status(
      `${scan.fields.length} visible field(s). Review each mapping before filling. File uploads and unusual controls need manual assistance.`,
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
    }
    status(
      `${result.results.filter((r) => r.ok).length} field(s) filled. Verify all values in the portal yourself. Nothing was submitted.`,
    );
  } catch (e) {
    status(e.message);
  } finally {
    $("#fill").disabled = false;
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
