"use client";
import { useEffect, useState } from "react";
type Voucher = {
  id: string;
  code_hint: string;
  label: string;
  audience: string;
  features_json: string;
  seats: number;
  case_limit: number;
  storage_mb: number;
  duration_days: number;
  expires_at: number;
  uses: number;
  max_uses: number;
  revoked: number;
};
type Redemption = {
  id: string;
  label: string;
  workspace?: string;
  access_until: string;
};
export default function VoucherCenter({
  platform,
  onChange,
}: {
  platform: boolean;
  onChange: () => unknown;
}) {
  const [vouchers, setVouchers] = useState<Voucher[]>([]),
    [history, setHistory] = useState<Redemption[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(""),
    [newCode, setNewCode] = useState("");
  async function load() {
    const r = await fetch("/api/workspace/vouchers");
    if (r.ok) {
      const v = await r.json();
      setVouchers(v.vouchers || []);
      setHistory(v.redemptions || []);
    }
  }
  useEffect(() => {
    load().catch(() => setMessage("Unable to load vouchers."));
  }, []);
  async function send(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/workspace/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      if (v.code) setNewCode(v.code);
      setMessage(v.message || "Voucher access updated.");
      setCode("");
      await load();
      onChange();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel voucher-center">
      <h2>{platform ? "Access vouchers" : "Redeem a voucher"}</h2>
      <p>
        {platform
          ? "Create access for consultants, lawyers, agencies or individuals. Codes grant access without taking a payment."
          : "Enter a code from Humeto. It replaces your feature and capacity limits and adds access days after any remaining trial or paid period."}
      </p>
      {platform ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            send({
              action: "create",
              label: f.get("label"),
              audience: f.get("audience"),
              recipientEmail: f.get("recipientEmail") || "",
              features: f.getAll("feature"),
              durationDays: Number(f.get("durationDays")),
              seats: Number(f.get("seats")),
              caseLimit: Number(f.get("caseLimit")),
              storageMb: Number(f.get("storageMb")),
              maxUses: Number(f.get("maxUses")),
              startsAt: f.get("startsAt")
                ? Date.parse(String(f.get("startsAt")))
                : Date.now(),
              expiresAt: Date.parse(String(f.get("expiresAt"))),
            });
          }}
        >
          <div className="voucher-fields">
            <label>
              Voucher name
              <input
                required
                name="label"
                maxLength={100}
                placeholder="Founding consultant access"
              />
            </label>
            <label>
              For
              <select name="audience">
                <option value="any">Any account</option>
                <option value="consultant">Consultants</option>
                <option value="lawyer">Lawyers</option>
                <option value="agency">Agencies</option>
                <option value="individual">Individuals</option>
              </select>
            </label>
            <label>
              Restrict to owner email (optional)
              <input name="recipientEmail" type="email" />
            </label>
            <label>
              Access days
              <input
                name="durationDays"
                type="number"
                min={1}
                max={730}
                defaultValue={30}
                required
              />
            </label>
            <label>
              Seats
              <input
                name="seats"
                type="number"
                min={1}
                max={1000}
                defaultValue={5}
                required
              />
            </label>
            <label>
              Cases
              <input
                name="caseLimit"
                type="number"
                min={1}
                max={100000}
                defaultValue={100}
                required
              />
            </label>
            <label>
              Storage (MB)
              <input
                name="storageMb"
                type="number"
                min={1}
                max={1000000}
                defaultValue={1024}
                required
              />
            </label>
            <label>
              Maximum redemptions
              <input
                name="maxUses"
                type="number"
                min={1}
                max={100000}
                defaultValue={1}
                required
              />
            </label>
            <label>
              Redeem from (optional)
              <input type="datetime-local" name="startsAt" />
            </label>
            <label>
              Redeem before
              <input type="datetime-local" name="expiresAt" required />
            </label>
          </div>
          <fieldset>
            <legend>Included features</legend>
            {[
              ["crm", "CRM"],
              ["tasks", "Tasks to-do"],
              ["forms", "AI form filling"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  name="feature"
                  value={key}
                  defaultChecked
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button className="btn primary small" disabled={busy}>
            Create voucher
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send({ action: "redeem", code });
          }}
        >
          <label>
            Voucher code
            <input
              required
              minLength={8}
              maxLength={40}
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="btn primary small" disabled={busy}>
            Redeem voucher
          </button>
        </form>
      )}
      {newCode && (
        <div className="notice">
          <strong>Save this code now</strong>
          <p>
            <code>{newCode}</code>
          </p>
          <p>The full code is only shown once.</p>
          <button
            className="btn secondary small"
            onClick={() =>
              navigator.clipboard
                .writeText(newCode)
                .then(() => setMessage("Code copied."))
                .catch(() => setMessage("Select and copy the code above."))
            }
          >
            Copy code
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {platform && vouchers.length > 0 && (
        <div className="voucher-list">
          {vouchers.map((v) => (
            <article key={v.id}>
              <strong>
                {v.label} · {v.code_hint}
              </strong>
              <p>
                {v.audience} · {JSON.parse(v.features_json).join(", ")} ·{" "}
                {v.duration_days} days · {v.uses}/{v.max_uses} uses
              </p>
              <p>
                {v.seats} seats · {v.case_limit} cases · {v.storage_mb} MB ·
                redeem by {new Date(v.expires_at).toLocaleString()}
              </p>
              {v.revoked ? (
                <span>Revoked for future redemptions</span>
              ) : (
                <button
                  className="btn secondary small"
                  disabled={busy}
                  onClick={() => send({ action: "revoke", id: v.id })}
                >
                  Revoke future use
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <>
          <h3>Redemption history</h3>
          {history.map((r) => (
            <p key={r.id}>
              {r.label}
              {r.workspace ? " · " + r.workspace : ""} · access until{" "}
              {new Date(r.access_until).toLocaleDateString()}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
