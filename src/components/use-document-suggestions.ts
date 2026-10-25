"use client";
import { useEffect, useRef, useState } from "react";
import type { Intake, Section } from "@/lib/types";

type Fact = {
  id: string;
  section_key: string;
  field_key: string;
  group_key: string;
  document_id: string;
  document_title: string;
  document_version: number;
  current_version: number;
  source_stale: boolean;
  page_number: number;
  chosen_value: string;
  revision: number;
  warnings: string[];
  applicant_review: string;
  staff_review: string;
};
type Reading = {
  facts: Fact[];
  applications: { fact_id: string }[];
  intake: Intake[];
  jobs: { status: string; error: string }[];
  workerOnline: boolean;
  canConfirm: boolean;
  canStaffReview: boolean;
};
export function useDocumentSuggestions(personId: string, section: Section) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch(
          `/api/workspace/reading?personId=${encodeURIComponent(personId)}`,
        );
        if (!r.ok)
          throw Error(
            "Document suggestions could not be loaded. Retry by refreshing this page.",
          );
        const result = await r.json();
        if (active && !lock.current) {
          setReading(result);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!lock.current && !document.hidden) void load();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [personId, section.key]);
  const applied = new Set(reading?.applications.map((a) => a.fact_id));
  const facts = (reading?.facts || []).filter(
    (f) =>
      f.section_key === section.key &&
      !f.source_stale &&
      f.document_version === f.current_version &&
      !applied.has(f.id) &&
      f.applicant_review !== "rejected" &&
      f.staff_review !== "rejected" &&
      section.fields.some(
        (field) => field.key === f.field_key && !field.sensitive,
      ) &&
      !section.restricted &&
      f.chosen_value.trim(),
  );
  const groups = [
    ...new Set(facts.map((f) => `${f.document_id}|${f.group_key}`)),
  ];
  function candidates(group?: string) {
    return facts.filter(
      (f) => !group || `${f.document_id}|${f.group_key}` === group,
    );
  }
  function value(f: Fact) {
    return edits[f.id] ?? f.chosen_value;
  }
  async function approve(
    selected: Fact[],
    intakeRevision: number,
    recordId: string,
    newRecord: boolean,
  ) {
    if (lock.current || !selected.length) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    async function post(body: unknown) {
      const r = await fetch("/api/workspace/reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(result.error || "Could not approve document details.");
      return result;
    }
    try {
      for (const f of selected)
        await post({
          action: "review",
          factId: f.id,
          revision: f.revision,
          review: reading?.canConfirm ? "confirm" : "staff-accept",
          value: value(f),
        });
      await post({
        action: "apply",
        factIds: selected.map((f) => f.id),
        sectionKey: section.key,
        intakeRevision,
        recordId,
        newRecord,
        replaceExisting: false,
      });
      const r = await fetch(
        `/api/workspace/reading?personId=${encodeURIComponent(personId)}`,
      );
      if (!r.ok)
        throw Error("Details were saved. Refresh to see the updated form.");
      const result: Reading = await r.json();
      setReading(result);
      setEdits({});
      return (
        result.intake.find((row) => row.section_key === section.key) || null
      );
    } catch (e) {
      setError((e as Error).message);
      // Reviews can succeed before a later apply fails. Reload revisions before retrying.
      const r = await fetch(
        `/api/workspace/reading?personId=${encodeURIComponent(personId)}`,
      ).catch(() => null);
      if (r?.ok) setReading(await r.json());
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    reading,
    candidates,
    groups,
    value,
    edit: (f: Fact, value: string) =>
      setEdits((old) => ({ ...old, [f.id]: value })),
    approve,
    busy,
    error,
  };
}
