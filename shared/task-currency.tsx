"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { webApi, type Transport } from "./transport";
import { worldCurrencies, currencyLabel } from "./currencies";
const CurrencyContext = createContext({
  ready: false,
  loadError: "",
  currency: "PKR",
  revision: 0,
  request: webApi,
  changed: (_v: any) => {},
});
export const useTaskCurrency = () => useContext(CurrencyContext);
export function TaskCurrencyProvider({
  children,
  request = webApi,
  syncToken,
}: {
  children: ReactNode;
  request?: Transport;
  syncToken?: unknown;
}) {
  const [pref, setPref] = useState({ default_currency: "PKR", revision: 0 });
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void request("/api/workspace/task-preferences")
        .then((p) => {
          if (live) {
            setPref((old) => (p.revision >= old.revision ? p : old));
            setReady(true);
            setLoadError("");
          }
        })
        .catch(() => {
          if (live)
            setLoadError(
              "Unable to load currency settings. Reopen this screen to retry.",
            );
        });
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [request, syncToken]);
  return (
    <CurrencyContext.Provider
      value={{
        ready,
        loadError,
        currency: pref.default_currency,
        revision: pref.revision,
        request,
        changed: setPref,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}
export function CurrencyPreferences() {
  const ctx = useTaskCurrency();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel currency-preferences">
      <h3>Default currency</h3>
      <label>
        Currency for new task estimates
        <select
          aria-label="Default currency"
          value={ctx.currency}
          disabled={busy || !ctx.ready}
          onChange={async (e) => {
            setBusy(true);
            setError("");
            try {
              ctx.changed(
                await ctx.request("/api/workspace/task-preferences", {
                  currency: e.target.value,
                  revision: ctx.revision,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {worldCurrencies.map((c) => (
            <option key={c} value={c}>
              {currencyLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <small>
        Synced with your account on web and phone. You can choose another
        currency for any task.
      </small>
      {(error || ctx.loadError) && <p role="alert">{error || ctx.loadError}</p>}
    </section>
  );
}
