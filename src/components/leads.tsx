"use client";
import QRCode from "qrcode";
import { useState, useEffect, useRef } from "react";
import { Plus, Upload, Sparkles, Users, ArrowUpRight } from "lucide-react";
import type { Lead } from "@/lib/pipeline";
import { leadStages, money } from "@/lib/pipeline";
import { parseLeadCSV } from "@/lib/lead-csv.mjs";
import PipelineBoard from "./pipeline-board";
type Draft = Partial<Lead>;
export default function Leads({
  leads,
  refresh,
  writable,
  search,
}: {
  leads: Lead[];
  refresh: () => Promise<void>;
  writable: boolean;
  search: string;
}) {
  const [editing, setEditing] = useState<Draft | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("board"),
    [rows, setRows] = useState<unknown[]>([]),
    [preview, setPreview] = useState<{
      accepted: number;
      duplicates: number[];
      total: number;
    } | null>(null),
    [command, setCommand] = useState("");
  const [inquiry, setInquiry] = useState<{ url: string; qr: string } | null>(
    null,
  );
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement as HTMLElement;
    const el = dialogRef.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setEditing(null);
      if (e.key === "Tab") {
        const controls = focusable(),
          first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [!!editing, busy]);
  async function api(path: string, body: unknown, method = "POST") {
    const r = await fetch("/api/workspace/" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function prepareCommand() {
    const match = command
      .trim()
      .match(
        /^(?:add|create) (?:a )?(?:new )?lead\s+(.+?)\s+<?([^\s<>]+@[^\s<>]+\.[^\s<>]+)>?$/i,
      );
    if (!match) {
      setError(
        "Try: Add lead Noor Ahmed noor@example.com. Review the details before saving.",
      );
      return;
    }
    setEditing({ name: match[1], email: match[2], source: "AI command" });
    setNotice(
      "Local command understood. Review the proposed lead before creating it.",
    );
  }
  const filtered = leads.filter((l) =>
    (l.name + " " + l.email + " " + l.destination)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="crm-leads">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            FROM FIRST HELLO TO REGISTERED APPLICANT
          </span>
          <h1>Every next chapter starts here.</h1>
          <p>
            Follow up with intent. Keep the conversation, value and next step
            together.
          </p>
        </div>
        <div className="crm-actions">
          <button
            className="btn secondary"
            onClick={() => {
              setMode(mode === "import" ? "board" : "import");
              setError("");
            }}
          >
            <Upload size={15} />
            Import leads
          </button>
          <button
            className="btn primary"
            disabled={!writable}
            onClick={() => {
              setEditing({ source: "Manual" });
              setError("");
            }}
          >
            <Plus size={15} />
            New lead
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <details className="crm-import">
        <summary>Inquiry form & QR code</summary>
        <p>
          Create a 30-day inquiry link for your institute. The form asks only
          for contact details and study interests. On this local preview, the
          link and QR work on this computer; public sharing requires deployment.
        </p>
        <div className="crm-actions">
          <button
            className="btn secondary"
            disabled={!writable || busy}
            onClick={() =>
              void run(async () => {
                const r = await api("inquiry-links", {});
                const url = location.origin + r.path;
                setInquiry({
                  url,
                  qr: await QRCode.toDataURL(url, { width: 220, margin: 2 }),
                });
              })
            }
          >
            Create inquiry link & QR
          </button>
          <button
            className="btn secondary"
            disabled={!writable || busy}
            onClick={() =>
              void run(async () => {
                await api("inquiry-links/revoke", {});
                setInquiry(null);
                setNotice("All inquiry links have been revoked.");
              })
            }
          >
            Revoke inquiry links
          </button>
        </div>
        {inquiry && (
          <div className="inquiry-share">
            <img
              width={180}
              height={180}
              src={inquiry.qr}
              alt="Inquiry form QR code"
            />
            <div>
              <a href={inquiry.url} target="_blank" rel="noreferrer">
                Open inquiry form →
              </a>
              <p>{inquiry.url}</p>
              <button
                className="btn secondary small"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inquiry.url)
                    .then(() => setNotice("Inquiry link copied."))
                    .catch(() => setError("Copy the displayed link manually."))
                }
              >
                Copy link
              </button>
              <a
                className="btn secondary small"
                download="humeto-inquiry-qr.png"
                href={inquiry.qr}
              >
                Download QR
              </a>
            </div>
          </div>
        )}
      </details>
      <div className="crm-stats">
        <div>
          <small>Open conversations</small>
          <strong>
            {
              leads.filter((l) => !["Registered", "Lost"].includes(l.stage))
                .length
            }
          </strong>
        </div>
        <div>
          <small>Potential service fees · PKR</small>
          <strong>
            {money(
              leads
                .filter((l) => !["Registered", "Lost"].includes(l.stage))
                .reduce((n, l) => n + l.expected_fee, 0),
            )}
          </strong>
        </div>
        <div>
          <small>Registered applicants</small>
          <strong>{leads.filter((l) => l.person_id).length}</strong>
        </div>
      </div>
      <div className="crm-command">
        <Sparkles size={20} />
        <div>
          <strong>CRM AI · local command testing</strong>
          <p>
            Add a lead by telling Humeto. Nothing is saved until you review it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              prepareCommand();
            }}
          >
            <input
              aria-label="CRM command"
              placeholder="Add lead Noor Ahmed noor@example.com"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <button className="btn secondary" disabled={!writable}>
              Review command
            </button>
          </form>
        </div>
      </div>
      <div className="filter-bar">
        <span>
          <Users size={16} /> {filtered.length} leads
        </span>
        <span className="subtle">
          Drag to change stage · choose Registered to review the conversion
        </span>
      </div>
      {mode === "import" && (
        <section className="crm-import">
          <h2>Bring your spreadsheet along.</h2>
          <p>
            CSV, up to 500 leads. Required: name, email. Optional: phone,
            destination, course, expected_fee, upfront_fee, incentive, timeline,
            follow_up, notes. Extra columns become custom fields. Amounts are
            whole PKR.
          </p>
          <a
            download="humeto-leads.csv"
            href="data:text/csv;charset=utf-8,name%2Cemail%2Cphone%2Cexpected_fee%2Cupfront_fee%2Cincentive%0ANoor%20Ahmed%2Cnoor%40example.com%2C%2C100000%2C50000%2C25000"
          >
            Download sample CSV
          </a>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Lead CSV"
            disabled={busy || !writable}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              setRows([]);
              if (!file) return;
              void run(async () => {
                if (file.size > 2 * 1024 * 1024)
                  throw new Error("Use a CSV smaller than 2 MB.");
                const parsed = parseLeadCSV(await file.text());
                const result = await api("leads/bulk", {
                  rows: parsed,
                  preview: true,
                });
                setRows(parsed);
                setPreview(result);
              });
            }}
          />
          {preview && (
            <>
              <p>
                {preview.accepted} ready to import · {preview.duplicates.length}{" "}
                duplicate emails skipped{" "}
                {preview.duplicates.length > 0 &&
                  `(CSV rows ${preview.duplicates.join(", ")})`}
              </p>
              <button
                className="btn primary"
                disabled={busy || !writable || !preview.accepted}
                onClick={() =>
                  void run(async () => {
                    const result = await api("leads/bulk", {
                      rows,
                      preview: false,
                    });
                    setNotice(
                      `${result.created} leads imported. ${result.duplicates.length} duplicates skipped.`,
                    );
                    setMode("board");
                    setPreview(null);
                    setRows([]);
                  })
                }
              >
                Import {preview.accepted} leads
              </button>
            </>
          )}
        </section>
      )}
      <PipelineBoard
        label="Lead pipeline"
        items={filtered}
        stages={leadStages}
        stageOf={(l) => l.stage}
        editable={writable && !busy}
        move={async (l, stage) => {
          if (l.person_id) {
            setError(
              "This lead is already registered. Continue in Applicants.",
            );
            return;
          }
          if (stage === "Registered") {
            setEditing({ ...l, stage: "Registered" });
            return;
          }
          await run(async () => {
            await api(
              "leads/" + l.id,
              { stage, revision: l.revision },
              "PATCH",
            );
          });
        }}
        render={(l) => (
          <article className="crm-lead-card">
            <div className="lead-source">
              {l.source}
              <span>
                {l.follow_up ? "Follow up " + l.follow_up : "Set a follow-up"}
              </span>
            </div>
            <button
              className="crm-card-title"
              onClick={() => {
                setEditing(l);
                setError("");
              }}
            >
              {l.name}
              <ArrowUpRight size={15} />
            </button>
            <p>{l.email}</p>
            <p>
              {l.destination || "Destination undecided"} ·{" "}
              {l.course || "Study plans to discuss"}
            </p>
            <div className="lead-values">
              <span>Fee PKR {money(l.expected_fee)}</span>
              <span>Upfront {money(l.upfront_fee)}</span>
              <span>Incentive {money(l.incentive)} · contingent</span>
            </div>
            {l.timeline && <p>{l.timeline}</p>}
            {l.person_id && (
              <a href={"/workspace/students/" + l.person_id}>
                Open registered applicant →
              </a>
            )}
          </article>
        )}
      />
      <p className="subtle">
        Email and WhatsApp intake connections are planned. “Email” and
        “WhatsApp” source tags currently record leads entered by your team.
      </p>
      {editing && (
        <div className="modal-backdrop">
          <section
            ref={dialogRef}
            className="app-modal crm-editor"
            role="dialog"
            aria-modal="true"
            aria-label="Lead details"
          >
            <button
              className="crm-close"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Close ✕
            </button>
            <h2>
              {editing.stage === "Registered" && !editing.person_id
                ? "Register this lead"
                : "Lead details"}
            </h2>
            <p>
              PKR fees are agreed amounts. Registration creates an applicant; it
              does not record a payment.
            </p>
            {error && (
              <p role="alert" className="notice">
                {error}
              </p>
            )}
            {editing.person_id ? (
              <>
                <p>
                  This inquiry has been registered. Its original information is
                  kept here.
                </p>
                <a
                  className="btn primary"
                  href={"/workspace/students/" + editing.person_id}
                >
                  Open applicant
                </a>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const extras: Record<string, string> = {};
                    const custom = String(f.get("extras") || "");
                    for (const line of custom.split("\n").filter(Boolean)) {
                      const split = line.indexOf("=");
                      if (split < 1)
                        throw new Error(
                          "Custom fields use one Label=Value per line.",
                        );
                      extras[line.slice(0, split).trim()] = line
                        .slice(split + 1)
                        .trim();
                    }
                    const details = {
                      name: f.get("name"),
                      email: f.get("email"),
                      phone: f.get("phone"),
                      source: f.get("source"),
                      destination: f.get("destination"),
                      course: f.get("course"),
                      notes: f.get("notes"),
                      follow_up: f.get("follow_up"),
                      timeline: f.get("timeline"),
                      expected_fee: Number(f.get("expected_fee")),
                      upfront_fee: Number(f.get("upfront_fee")),
                      incentive: Number(f.get("incentive")),
                      extras,
                    };
                    let lid = editing.id;
                    if (lid)
                      await api(
                        "leads/" + lid,
                        {
                          stage:
                            editing.stage === "Registered"
                              ? "Awaiting registration"
                              : editing.stage,
                          revision: editing.revision,
                          details,
                        },
                        "PATCH",
                      );
                    else lid = (await api("leads", details)).id;
                    if (editing.stage === "Registered") {
                      const current = await (
                        await fetch("/api/workspace/bootstrap")
                      ).json();
                      const lead = current.leads.find(
                        (l: Lead) => l.id === lid,
                      );
                      await api("leads/" + lid + "/register", {
                        revision: lead.revision,
                      });
                      setNotice(
                        "Lead registered. Applicant profile and agreed fees are ready.",
                      );
                    } else setNotice("Lead saved.");
                    setEditing(null);
                  });
                }}
              >
                <div className="crm-fields">
                  {[
                    ["name", "Full name"],
                    ["email", "Primary email"],
                    ["phone", "Phone"],
                    ["destination", "Destination"],
                    ["course", "Course / interest"],
                    ["timeline", "Tentative timeline"],
                    ["follow_up", "Next follow-up"],
                    ["expected_fee", "Total agreed fee · PKR"],
                    ["upfront_fee", "Upfront target · PKR"],
                    ["incentive", "Contingent university incentive · PKR"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        name={key}
                        required={["name", "email"].includes(key)}
                        readOnly={key === "email" && !!editing.id}
                        type={
                          key === "email"
                            ? "email"
                            : key === "follow_up"
                              ? "date"
                              : key.endsWith("fee") || key === "incentive"
                                ? "number"
                                : "text"
                        }
                        min={0}
                        maxLength={key === "name" ? 100 : 500}
                        defaultValue={String(editing[key as keyof Draft] ?? "")}
                      />
                    </label>
                  ))}
                  <label>
                    Source
                    <select
                      name="source"
                      defaultValue={editing.source || "Manual"}
                    >
                      {[
                        "Manual",
                        "CSV",
                        "Inquiry",
                        "Email",
                        "WhatsApp",
                        "AI command",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    defaultValue={editing.notes}
                    maxLength={5000}
                  />
                </label>
                <label>
                  Custom fields · one Label=Value per line
                  <textarea
                    name="extras"
                    placeholder={
                      "Preferred intake=September 2027\nCounsellor=Leila"
                    }
                    defaultValue={Object.entries(editing.extras || {})
                      .map(([k, v]) => `${k}=${v}`)
                      .join("\n")}
                  />
                </label>
                <button
                  className="btn primary full"
                  disabled={busy || !writable}
                >
                  {busy
                    ? "Saving…"
                    : editing.stage === "Registered"
                      ? "Confirm registration & create applicant"
                      : "Save lead"}
                </button>
                {editing.id && editing.stage !== "Registered" && (
                  <button
                    type="button"
                    className="btn secondary full"
                    onClick={() =>
                      setEditing({ ...editing, stage: "Registered" })
                    }
                  >
                    Register as applicant →
                  </button>
                )}
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
