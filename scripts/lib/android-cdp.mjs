export async function connectWebView(port) {
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(2500),
    })
  ).json();
  const page =
    pages.find((p) => p.url.startsWith("https://localhost")) || pages[0];
  if (!page) throw Error("No Android WebView found.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    const timer = setTimeout(() => {
      ws.close();
      j(Error("WebView socket timeout"));
    }, 3000);
    ws.onopen = () => {
      clearTimeout(timer);
      r();
    };
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.id) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p?.reject(Error(d.error.message)) : p?.resolve(d.result);
    }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(Error("Android WebView command timed out: " + method));
      }, 45000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result?.value;
  }
  async function wait(expression, timeout = 25000) {
    const until = Date.now() + timeout;
    let last;
    while (Date.now() < until) {
      try {
        last = await evaluate(expression);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw Error(
      "Android UI wait timed out: " +
        expression +
        "; last=" +
        JSON.stringify(last),
    );
  }
  const findButton = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)})`;
  async function click(text) {
    await wait(
      `Boolean((${findButton(text)}) && !(${findButton(text)}).disabled)`,
    );
    await evaluate(
      `(()=>{const e=${findButton(text)};if(e.disabled)throw Error('Button disabled');e.scrollIntoView({block:'center'});e.click();return true;})()`,
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  async function fill(selector, value) {
    await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
  }
  async function select(selector, value) {
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
  }
  return { evaluate, send, wait, click, fill, select, close: () => ws.close() };
}
