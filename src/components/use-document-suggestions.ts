"use client";
import { useEffect, useRef, useState } from "react";
import type { Intake } from "@/lib/types";
type Reading = {
  facts: {
    id: string;
    revision: number;
    source_stale: boolean;
    applicant_review: string;
    staff_review: string;
  }[];
  applications: { fact_id: string }[];
  intake: Intake[];
  jobs: { status: string }[];
  workerOnline: boolean;
};
export function useDocumentAutofill(
  personId: string,
  readOnly: boolean,
  canSync: () => boolean,
  onSync: (rows: Intake[]) => void,
) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(!readOnly);
  const [error, setError] = useState("");
  const callbacks = useRef({ canSync, onSync });
  callbacks.current = { canSync, onSync };
  useEffect(() => {
    let active = true,
      loading = false,
      signature = "";
    async function load() {
      if (loading || !callbacks.current.canSync()) {
        if (active) setBusy(false);
        return;
      }
      loading = true;
      try {
        const r = await fetch(
          `/api/workspace/reading?personId=${encodeURIComponent(personId)}`,
        );
        if (!r.ok)
          throw Error(
            "Document details could not be loaded. Refresh to retry.",
          );
        let result: Reading = await r.json();
        const applied = new Set(result.applications.map((a) => a.fact_id));
        const pending = result.facts.filter(
          (f) =>
            !applied.has(f.id) &&
            !f.source_stale &&
            f.applicant_review !== "rejected" &&
            f.staff_review !== "rejected",
        );
        const nextSignature = pending
          .map((f) => `${f.id}:${f.revision}`)
          .join("|");
        if (
          active &&
          !readOnly &&
          pending.length &&
          signature !== nextSignature &&
          callbacks.current.canSync()
        ) {
          setBusy(true);
          const fill = await fetch("/api/workspace/reading", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "autofill", personId }),
          });
          const filled = await fill.json();
          if (!fill.ok)
            throw Error(
              filled.error ||
                "Document details could not be filled. Refresh to retry.",
            );
          result = { ...result, intake: filled.intake };
          signature = nextSignature;
        }
        if (active) {
          setReading(result);
          setError("");
          if (callbacks.current.canSync())
            callbacks.current.onSync(result.intake);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        loading = false;
        if (active) setBusy(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [personId, readOnly]);
  return { reading, busy, error };
}
