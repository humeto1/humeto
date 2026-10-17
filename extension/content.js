// Injected only after explicit user action via activeTab. No credentials or tokens enter the page.
(() => {
  if (globalThis.__humetoAssistInstalled) return;
  globalThis.__humetoAssistInstalled = true;
  let reviewedFields = new Map();
  function labelFor(el) {
    const ids = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    return (
      el.labels?.[0]?.innerText ||
      el.getAttribute("aria-label") ||
      ids.map((id) => document.getElementById(id)?.innerText || "").join(" ") ||
      el.getAttribute("placeholder") ||
      el.name ||
      "Unlabelled field"
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }
  function controls() {
    return [...document.querySelectorAll("input,select,textarea")].filter(
      (el) =>
        !el.disabled &&
        !el.readOnly &&
        ![
          "hidden",
          "password",
          "file",
          "submit",
          "button",
          "checkbox",
          "radio",
          "reset",
        ].includes(el.type) &&
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== "hidden" &&
        !/password|signature|consent|declaration|convict|health|terror|agree|payment|card number|bank account/i.test(
          labelFor(el),
        ),
    );
  }
  function context(el) {
    return (
      el.closest("fieldset")?.querySelector("legend")?.innerText || ""
    ).slice(0, 160);
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.type === "HUMETO_SCAN") {
      reviewedFields = new Map();
      const fields = controls().map((el, i) => {
        reviewedFields.set(String(i), {
          el,
          label: labelFor(el),
          type: el.type,
          context: context(el),
          autocomplete: el.autocomplete,
        });
        el.dataset.humetoField = String(i);
        return {
          id: String(i),
          label: labelFor(el),
          name: el.name || "",
          type: el.tagName === "SELECT" ? "select" : el.type || "textarea",
          autocomplete: el.autocomplete || "",
          context: context(el),
          value: el.value.slice(0, 500),
          options:
            el.tagName === "SELECT"
              ? [...el.options].map((o) => ({ value: o.value, label: o.text }))
              : [],
        };
      });
      reply({ url: location.href, title: document.title, fields });
    }
    if (msg.type === "HUMETO_FILL") {
      if (msg.url !== location.href) {
        reply({ results: [], error: "The page changed. Scan it again." });
        return;
      }
      const results = [];
      for (const item of msg.items || []) {
        const reviewed = reviewedFields.get(String(item.id));
        const el = reviewed?.el;
        if (
          !el ||
          !el.isConnected ||
          !controls().includes(el) ||
          reviewed.type !== el.type ||
          reviewed.context !== context(el) ||
          reviewed.autocomplete !== el.autocomplete ||
          labelFor(el) !== item.label ||
          reviewed.label !== item.label
        ) {
          results.push({
            id: item.id,
            ok: false,
            reason: "Field changed. Scan again.",
          });
          continue;
        }
        if (el.value) {
          results.push({
            id: item.id,
            ok: false,
            reason: "Existing answer preserved.",
          });
          continue;
        }
        let value = String(item.value);
        if (el.maxLength > 0 && value.length > el.maxLength) {
          results.push({
            id: item.id,
            ok: false,
            reason: "Value exceeds field limit. Manual review needed.",
          });
          continue;
        }
        if (el.tagName === "SELECT") {
          const norm = (s) => s.trim().toLowerCase();
          const matches = [...el.options].filter(
            (o) =>
              norm(o.text) === norm(value) || norm(o.value) === norm(value),
          );
          if (matches.length !== 1) {
            results.push({
              id: item.id,
              ok: false,
              reason: "No unique dropdown option. Choose manually.",
            });
            continue;
          }
          value = matches[0].value;
        }
        const proto =
          el.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({
          id: item.id,
          ok: el.value === value,
          reason:
            el.value === value
              ? "Filled; review before continuing."
              : "Page rejected this value.",
        });
      }
      reply({ results });
    }
  });
})();
