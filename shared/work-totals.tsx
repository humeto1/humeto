"use client";
import { useEffect, useState, useRef } from "react";
import { webApi, type Transport } from "./transport";
import { profitFrequency } from "./plan-summary";
import "./work-totals.css";
export function WorkTotals({
  type,
  id,
  request = webApi,
  compact = false,
}: {
  type: "task" | "project" | "goal";
  id: string;
  request?: Transport;
  compact?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "150px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const load = () =>
      void request(`/api/work-profit?type=${type}&id=${encodeURIComponent(id)}`)
        .then((v) => {
          if (live) {
            setData(v);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    load();
    const t = setInterval(load, 60000);
    window.addEventListener("humeto-profit", load);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("humeto-profit", load);
    };
  }, [type, id, request, visible]);
  const money = (items: any[]) =>
    items?.length
      ? items
          .map(
            (v) =>
              `${v.currency} ${(Number(v.amount) / 100).toLocaleString()}${v.basis && v.basis !== "project" ? " / " + (profitFrequency[v.basis] || v.basis) : ""}`,
          )
          .join(" · ")
      : "—";
  return (
    <div
      ref={host}
      className={`work-totals ${compact ? "work-totals-compact" : ""}`}
      aria-label="Profit and focus totals"
    >
      <span>
        <small>Est. profit</small>
        <strong>{data ? money(data.estimated) : failed ? "—" : "…"}</strong>
      </span>
      <span>
        <small>Actual profit</small>
        <strong>
          {data
            ? data.actual?.length
              ? money(data.actual)
              : "0"
            : failed
              ? "—"
              : "…"}
        </strong>
      </span>
      <span>
        <small>Focus hrs done</small>
        <strong>
          {data
            ? (data.focusSeconds / 3600).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })
            : failed
              ? "—"
              : "…"}
        </strong>
      </span>
    </div>
  );
}
