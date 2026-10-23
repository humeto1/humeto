import { useState } from "react";
export function PlanFinancial({
  type,
  id,
  request,
  writable,
}: {
  type: string;
  id: string;
  request: (path: string, body?: any) => Promise<any>;
  writable: boolean;
}) {
  const [target, setTarget] = useState<any>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `/api/plan-targets?type=${type}&id=${encodeURIComponent(id)}`;
  async function load() {
    setBusy(true);
    try {
      setTarget(
        (await request(path)).target || {
          revision: 0,
          currency: "PKR",
          upfront: 0,
          completion: 0,
          conditional: 0,
          basis: type === "routine" ? "occurrence" : "project",
        },
      );
      setOpen(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Plan financial target">
      <button
        type="button"
        disabled={busy}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        Financial target & reward timing
      </button>
      {error && <p role="alert">{error}</p>}
      {open && target && (
        <>
          <p>
            Estimated profit target:{" "}
            <strong>
              {target.currency}{" "}
              {(
                (Number(target.upfront) + Number(target.completion)) /
                100
              ).toLocaleString()}
            </strong>{" "}
            · Conditional reward:{" "}
            <strong>
              {target.currency}{" "}
              {(Number(target.conditional) / 100).toLocaleString()}
            </strong>
          </p>
          <p>
            Planning estimates only. Conditional money is not confirmed income.
            Task estimates are contributions, not extra amounts added to this
            target. Actual receipts and profit remain in Finance.
          </p>
          <form
            key={target.revision}
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              void request(path, { ...body, revision: target.revision })
                .then(load)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Currency
              <input
                name="currency"
                defaultValue={target.currency}
                pattern="[A-Z]{3}"
                maxLength={3}
                required
              />
            </label>
            <label>
              Target basis
              <select name="basis" defaultValue={target.basis}>
                <option value="project">Whole plan / project</option>
                <option value="occurrence">Each occurrence</option>
                <option value="month">Each month</option>
                <option value="year">Each year</option>
              </select>
            </label>
            {[
              ["upfront", "Upfront / now"],
              ["completion", "On completion"],
              ["conditional", "Conditional reward"],
            ].map(([key, label]) => (
              <fieldset key={key}>
                <legend>{label}</legend>
                <label>
                  Expected profit amount
                  <input
                    name={key}
                    type="number"
                    min="0"
                    step="0.01"
                    max="9999999999.99"
                    defaultValue={Number(target[key]) / 100}
                    required
                  />
                </label>
                <label>
                  Expected date
                  <input
                    name={key + "_date"}
                    type="date"
                    defaultValue={target[key + "_date"] || ""}
                  />
                </label>
              </fieldset>
            ))}
            <label>
              Condition to receive the reward
              <textarea
                name="condition"
                defaultValue={target.condition || ""}
                maxLength={1000}
                placeholder="For example: student enrols and university confirms commission"
              />
            </label>
            <button disabled={busy || !writable}>Save financial target</button>
          </form>
        </>
      )}
    </section>
  );
}
