"use client";
import { useState, useEffect } from "react";
import { webApi } from "../../shared/transport";
import { subscriptionAccess } from "../lib/subscription-access.mjs";
import {
  ArrowUpRight,
  Building2,
  ShieldCheck,
  Ticket,
  Layers,
} from "lucide-react";
import "./platform-portal.css";
export const platformSections = [
  ["overview", "Overview"],
  ["workspaces", "Workspaces & plans"],
  ["vouchers", "Access vouchers"],
  ["moderation", "Moderation"],
] as const;
export default function PlatformOverview({
  tenants,
  onSection,
  onWorkspace,
  onCreate,
  onManage,
}: {
  tenants: any[];
  onSection: (s: string) => void;
  onWorkspace: () => void;
  onCreate: () => void;
  onManage: (t: any) => void;
}) {
  const attention = tenants.filter(
    (t) => t.upgrade_requested_at || !subscriptionAccess(t),
  );
  return (
    <div className="platform-overview">
      <section className="platform-hero">
        <div>
          <span className="eyebrow">HUMETO · PLATFORM ADMINISTRATION</span>
          <h1>
            Your platform.
            <br />
            <em>A clearer view.</em>
          </h1>
          <p>
            Manage customer access, subscriptions and safety, then step into
            your own workspace to run your business.
          </p>
          <div className="platform-actions">
            <button className="btn primary" onClick={onCreate}>
              <Building2 size={17} /> Add workspace
            </button>
            <button className="btn secondary" onClick={onWorkspace}>
              Open my workspace <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
        <div className="platform-hero-note">
          <ShieldCheck size={28} />
          <strong>Superadmin access</strong>
          <span>
            Platform controls stay above your workspace tools. Customer CRM
            records remain outside this console.
          </span>
        </div>
      </section>
      <div className="platform-metrics">
        {[
          ["Workspaces", tenants.length],
          [
            "Active plans",
            tenants.filter(
              (t) => t.status === "active" && subscriptionAccess(t),
            ).length,
          ],
          [
            "On trial",
            tenants.filter((t) => t.status === "trial" && subscriptionAccess(t))
              .length,
          ],
          ["Needs attention", attention.length],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="platform-shortcuts">
        {[
          [
            Building2,
            "workspaces",
            "Workspaces & plans",
            "Manage subscriptions, limits and access.",
          ],
          [
            Ticket,
            "vouchers",
            "Access vouchers",
            "Create, review and revoke access codes.",
          ],
          [
            ShieldCheck,
            "moderation",
            "Moderation",
            "Review reports and keep Break chat safe.",
          ],
        ].map(([Icon, key, label, note]: any) => (
          <button key={key} onClick={() => onSection(key)}>
            <Icon size={23} />
            <strong>{label}</strong>
            <span>{note}</span>
            <ArrowUpRight size={18} />
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Needs attention</h2>
          <button
            className="btn secondary small"
            onClick={() => onSection("workspaces")}
          >
            View all workspaces
          </button>
        </div>
        {attention.length ? (
          <div className="platform-attention">
            {attention.slice(0, 8).map((t) => (
              <div key={t.id}>
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {t.upgrade_requested_at ? "Activation requested" : t.status}{" "}
                    · {t.plan}
                  </small>
                </span>
                <button
                  className="btn secondary small"
                  onClick={() => onManage(t)}
                >
                  Manage plan
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No workspace access issues to review.</p>
        )}
      </section>
      <section className="platform-own-workspace">
        <Layers size={24} />
        <div>
          <h2>Your own workspace</h2>
          <p>
            Your CRM, clients, tasks and projects are available under My
            workspace. Return to platform administration at any time.
          </p>
        </div>
        <button className="btn secondary" onClick={onWorkspace}>
          Go to my workspace <ArrowUpRight size={16} />
        </button>
      </section>
    </div>
  );
}

export function PlatformModeration() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      webApi("/api/break-chat")
        .then((v) => {
          if (live) setData(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function decide(id: string, decision: string) {
    setBusy(true);
    setError("");
    try {
      await webApi("/api/break-chat", {
        action: "moderate",
        messageId: id,
        decision,
      });
      setData(await webApi("/api/break-chat"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel platform-moderation"
      aria-label="Platform moderation queue"
    >
      <h2>Reports to review {data?.review ? "· " + data.review.length : ""}</h2>
      {error && <p role="alert">{error}</p>}
      {!data && <p role="status">Loading reports…</p>}
      {data?.review?.length === 0 && (
        <p className="muted">No reports are waiting for review.</p>
      )}
      {data?.review?.map((r: any, i: number) => (
        <article className="platform-report" key={r.id + ":" + i}>
          <strong>{r.alias}</strong>
          <p>{r.content}</p>
          <small>
            {r.reason} · {new Date(r.created_at).toLocaleString()}
          </small>
          <div className="platform-actions">
            {["dismiss", "remove", "ban"].map((decision) => (
              <button
                className="btn secondary small"
                key={decision}
                disabled={busy}
                onClick={() => void decide(r.id, decision)}
              >
                {decision === "ban"
                  ? "Remove & ban for 30 days"
                  : decision === "remove"
                    ? "Remove message"
                    : "Dismiss report"}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
