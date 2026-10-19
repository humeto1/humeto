// Injected only after explicit user action via activeTab. No credentials or tokens enter the page.
(() => {
  if (globalThis.__humetoAssistInstalled) return;
  globalThis.__humetoAssistInstalled = true;
  let reviewedFields = new Map(),
    reviewedFiles = new Map();
  function labelFor(el) {
    const ids = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    return (
      el.labels?.[0]?.innerText ||
      el.getAttribute("aria-label") ||
      ids
        .map((id) => el.getRootNode().getElementById?.(id)?.textContent || "")
        .join(" ") ||
      el.getAttribute("placeholder") ||
      el.name ||
      "Unlabelled field"
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }
  function surfaces() {
    const result = [],
      seen = new Set();
    let skippedFrames = 0;
    function walk(root, location, depth = 0) {
      if (!root || seen.has(root) || depth > 6 || result.length >= 80) return;
      seen.add(root);
      result.push({ root, location });
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot && el.getClientRects().length)
          walk(el.shadowRoot, location + " · shadow", depth + 1);
        if (el.tagName === "IFRAME" && visible(el)) {
          try {
            const doc = el.contentDocument;
            if (!doc?.documentElement) {
              skippedFrames++;
              continue;
            }
            walk(
              doc,
              location + " · frame " + (el.title || el.name || "embedded form"),
              depth + 1,
            );
          } catch {
            skippedFrames++;
          }
        }
      }
    }
    walk(document, "Main page");
    return { result, skippedFrames };
  }
  function visible(el) {
    const win = el.ownerDocument.defaultView;
    return (
      !!el.getClientRects().length &&
      win.getComputedStyle(el).visibility !== "hidden"
    );
  }
  function controls() {
    return surfaces()
      .result.flatMap(({ root }) => [
        ...root.querySelectorAll("input,select,textarea"),
      ])
      .filter(
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
          (el.tagName === "SELECT" || el.getAttribute("role") !== "combobox") &&
          visible(el) &&
          !/password|signature|consent|declaration|convict|health|terror|agree|payment|card number|bank account|captcha/i.test(
            labelFor(el),
          ),
      )
      .slice(0, 500);
  }
  function context(el) {
    const legends = [];
    let node = el;
    for (let i = 0; i < 6; i++) {
      const set = node.closest?.("fieldset");
      if (set) {
        const legend = set.querySelector(":scope > legend")?.textContent;
        if (legend) legends.unshift(legend);
        node = set.parentElement;
      } else {
        const root = node.getRootNode?.();
        if (root?.host) node = root.host;
        else if (root?.defaultView?.frameElement)
          node = root.defaultView.frameElement;
        else break;
      }
      if (!node) break;
    }
    return legends.join(" · ").replace(/\s+/g, " ").trim().slice(0, 350);
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.type === "HUMETO_SCAN") {
      reviewedFields = new Map();
      const surface = surfaces();
      const fields = controls().map((el, i) => {
        reviewedFields.set(String(i), {
          el,
          label: labelFor(el),
          type: el.type,
          context: context(el),
          autocomplete: el.autocomplete,
          document: el.ownerDocument,
          documentUrl: el.ownerDocument.URL,
          options:
            el.tagName === "SELECT"
              ? JSON.stringify(
                  [...el.options].map((o) => [o.value, o.text, o.disabled]),
                )
              : "",
        });
        el.dataset.humetoField = String(i);
        return {
          id: String(i),
          label: labelFor(el),
          name: el.name || "",
          type: el.tagName === "SELECT" ? "select" : el.type || "textarea",
          autocomplete: el.autocomplete || "",
          context: context(el),
          location:
            surface.result.find(({ root }) => root === el.getRootNode())
              ?.location || "Main page",
          value: el.value.slice(0, 500),
          options:
            el.tagName === "SELECT"
              ? [...el.options].map((o) => ({ value: o.value, label: o.text }))
              : [],
        };
      });
      reviewedFiles = new Map();
      const fileFields = surface.result
        .flatMap(({ root }) => [...root.querySelectorAll('input[type="file"]')])
        .filter(
          (el) => !el.disabled && el.getClientRects().length && visible(el),
        )
        .map((el, i) => {
          const id = String(i),
            label = labelFor(el);
          reviewedFiles.set(id, {
            el,
            label,
            accept: el.accept,
            context: context(el),
            document: el.ownerDocument,
            documentUrl: el.ownerDocument.URL,
          });
          return {
            id,
            label,
            accept: el.accept,
            multiple: el.multiple,
            location:
              surface.result.find(({ root }) => root === el.getRootNode())
                ?.location || "Main page",
            hasFile: el.files.length > 0,
          };
        });
      const unsupportedControls = surface.result.reduce(
        (n, { root }) =>
          n +
          [
            ...root.querySelectorAll(
              '[role="combobox"],[contenteditable="true"]',
            ),
          ].filter((el) => el.tagName !== "SELECT" && visible(el)).length,
        0,
      );
      reply({
        url: location.href,
        title: document.title,
        fields,
        fileFields,
        skippedFrames: surface.skippedFrames,
        unsupportedControls,
      });
    }
    if (msg.type === "HUMETO_ATTACH") {
      const reviewed = reviewedFiles.get(String(msg.fieldId)),
        el = reviewed?.el;
      if (
        msg.url !== location.href ||
        !el ||
        !el.isConnected ||
        el.disabled ||
        !surfaces().result.some(({ root }) => root === el.getRootNode()) ||
        el.ownerDocument !== reviewed.document ||
        el.ownerDocument.URL !== reviewed.documentUrl ||
        !visible(el) ||
        !el.getClientRects().length ||
        labelFor(el) !== reviewed.label ||
        msg.label !== reviewed.label ||
        el.accept !== reviewed.accept ||
        context(el) !== reviewed.context ||
        el.files.length
      ) {
        reply({
          ok: false,
          error:
            "Upload field changed or already contains a file. Scan and review again.",
        });
        return;
      }
      if (
        typeof msg.base64 !== "string" ||
        msg.base64.length > 14 * 1024 * 1024
      ) {
        reply({
          ok: false,
          error: "File exceeds the attachment-assistance limit.",
        });
        return;
      }
      try {
        const accepted = el.accept
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
          mime = String(msg.mime || "").toLowerCase(),
          name = String(msg.name || "document").replace(/[\/]/g, "_");
        if (
          accepted.length &&
          !accepted.some((a) =>
            a.startsWith(".")
              ? name.toLowerCase().endsWith(a)
              : a.endsWith("/*")
                ? mime.startsWith(a.slice(0, -1))
                : a === mime,
          )
        ) {
          reply({
            ok: false,
            error:
              "This file type is not accepted by the page. Attach a compatible document manually.",
          });
          return;
        }
        const bytes = Uint8Array.from(atob(msg.base64), (c) => c.charCodeAt(0)),
          file = new File([bytes], name, { type: mime }),
          transfer = new DataTransfer();
        transfer.items.add(file);
        el.files = transfer.files;
        el.dispatchEvent(
          new el.ownerDocument.defaultView.Event("input", { bubbles: true }),
        );
        el.dispatchEvent(
          new el.ownerDocument.defaultView.Event("change", { bubbles: true }),
        );
        reply({
          ok: el.files.length === 1,
          error: "The page did not retain the file. Attach it manually.",
        });
      } catch {
        reply({
          ok: false,
          error:
            "The page could not accept this attachment. Attach it manually.",
        });
      }
      return;
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
          el.ownerDocument !== reviewed.document ||
          el.ownerDocument.URL !== reviewed.documentUrl ||
          reviewed.options !==
            (el.tagName === "SELECT"
              ? JSON.stringify(
                  [...el.options].map((o) => [o.value, o.text, o.disabled]),
                )
              : "") ||
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
              !o.disabled &&
              (norm(o.text) === norm(value) || norm(o.value) === norm(value)),
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
        const win = el.ownerDocument.defaultView;
        const proto =
          el.tagName === "SELECT"
            ? win.HTMLSelectElement.prototype
            : el.tagName === "TEXTAREA"
              ? win.HTMLTextAreaElement.prototype
              : win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(
          new el.ownerDocument.defaultView.Event("input", { bubbles: true }),
        );
        el.dispatchEvent(
          new el.ownerDocument.defaultView.Event("change", { bubbles: true }),
        );
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
