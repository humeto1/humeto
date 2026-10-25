"use client";
import { useState, useEffect, useCallback } from "react";
import { Check, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { sections } from "@/lib/sections";
import type { DocumentRow, Actor } from "@/lib/types";
import styles from "./section-review.module.css";
const LOW_CONFIDENCE = 80;
type Fact = {
  id: string;
  document_id: string;
  document_title: string;
  section_key: string;
  field_key: string;
  label: string;
  extracted_value: string;
  chosen_value: string;
  confidence: number | null;
  warnings: string[];
  applicant_review: string;
  staff_review: string;
  source_stale: boolean;
  revision: number;
};
type Data = {
  facts: Fact[];
  canConfirm: boolean;
  canStaffReview: boolean;
};
// One field_key within a section, aggregated across every document the
// person has supplied. Distinct chosen/extracted values across documents
// are a conflict the applicant must resolve before the section can be
// approved; duplicates of the same value are not.
type FieldGroup = {
  fieldKey: string;
  label: string;
  facts: Fact[];
  distinctValues: string[];
  conflict: boolean;
  lowConfidence: boolean;
  reviewed: boolean;
};
function groupBySection(facts: Fact[]) {
  const bySection = new Map<string, Map<string, Fact[]>>();
  for (const f of facts) {
    if (!bySection.has(f.section_key)) bySection.set(f.section_key, new Map());
    const byField = bySection.get(f.section_key)!;
    if (!byField.has(f.field_key)) byField.set(f.field_key, []);
    byField.get(f.field_key)!.push(f);
  }
  return bySection;
}
function fieldGroups(byField: Map<string, Fact[]>): FieldGroup[] {
  return [...byField.entries()].map(([fieldKey, facts]) => {
    const values = [
      ...new Set(
        facts.map((f) => (f.chosen_value || f.extracted_value).trim()),
      ),
    ].filter(Boolean);
    return {
      fieldKey,
      label: facts[0].label,
      facts,
      distinctValues: values,
      conflict: values.length > 1,
      lowConfidence: facts.some(
        (f) => f.confidence !== null && f.confidence < LOW_CONFIDENCE,
      ),
      reviewed: facts.every(
        (f) =>
          f.applicant_review === "confirmed" ||
          f.staff_review === "accepted",
      ),
    };
  });
}
export default function SectionReview({
  documents,
  actor,
  writable,
  onChange,
}: {
  documents: DocumentRow[];
  actor: Actor;
  writable: boolean;
  onChange: () => Promise<void>;
}) {
  const personId = documents[0]?.person_id || "";
  const [data, setData] = useState<Data | null>(null),
    [picked, setPicked] = useState<Record<string, string>>({}),
    [open, setOpen] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!personId) return;
    const r = await fetch(
        `/api/workspace/reading?personId=${encodeURIComponent(personId)}`,
        { cache: "no-store" },
      ),
      j = await r.json();
    if (!r.ok) throw Error(j.error || "Could not load the reviewed facts.");
    setData(j);
  }, [personId]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const action = data?.canConfirm
    ? "confirm"
    : data?.canStaffReview
      ? "staff-accept"
      : "";
  async function reviewOne(f: Fact, value: string) {
    const r = await fetch("/api/workspace/reading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review",
        factId: f.id,
        revision: f.revision,
        review: action,
        value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error || "Could not save this review.");
  }
  // One tick approves every field in the section at once: conflicting
  // fields must already have a chosen value (picked[fieldKey] or an
  // unambiguous source), and every fact in the field is confirmed with
  // that same value. Low-confidence fields are still approvable, but
  // stay visibly flagged beforehand so nothing is accepted unseen.
  async function approveSection(sectionKey: string, groups: FieldGroup[]) {
    if (!action) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const blocking = groups.find(
        (g) => g.conflict && !picked[g.fieldKey] && !g.reviewed,
      );
      if (blocking)
        throw Error(
          `Choose the correct value for "${blocking.label}" before approving this section.`,
        );
      for (const g of groups) {
        if (g.reviewed) continue;
        const value = picked[g.fieldKey] ?? g.distinctValues[0] ?? "";
        for (const f of g.facts) {
          if (f.applicant_review === "confirmed" || f.staff_review === "accepted")
            continue;
          if (f.source_stale) continue;
          await reviewOne(f, value);
        }
      }
      await load();
      await onChange();
      setNotice(
        sections.find((s) => s.key === sectionKey)?.title + " approved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return error ? (
      <div className={styles.notice} role="alert">
        {error}
      </div>
    ) : (
      <div className={styles.notice}>Loading reviewed facts…</div>
    );
  if (!action)
    return (
      <div className={styles.notice}>
        You don't have permission to approve information for this applicant.
      </div>
    );
  const bySection = groupBySection(data.facts);
  const sectionKeys = sections
    .filter((s) => bySection.has(s.key))
    .map((s) => s.key);
  if (!sectionKeys.length)
    return (
      <div className={styles.notice}>
        No document information has been read yet. Upload documents and
        enable reading to see suggestions here, grouped by section.
      </div>
    );
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1>Review by section</h1>
        <p>
          Every value proposed from this applicant's documents, grouped the
          same way as the profile. Confirm a section once its fields look
          right; conflicting values from different documents must be
          resolved first.
        </p>
      </div>
      {error && (
        <div className={styles.notice} role="alert">
          {error}
        </div>
      )}
      {notice && <div className={styles.success}>{notice}</div>}
      {sectionKeys.map((sectionKey) => {
        const section = sections.find((s) => s.key === sectionKey)!,
          byField = bySection.get(sectionKey)!,
          groups = fieldGroups(byField),
          allReviewed = groups.every((g) => g.reviewed),
          hasConflict = groups.some((g) => g.conflict && !g.reviewed),
          isOpen = open[sectionKey] ?? !allReviewed;
        return (
          <section key={sectionKey} className={styles.section}>
            <button
              className={styles.sectionHead}
              onClick={() =>
                setOpen((o) => ({ ...o, [sectionKey]: !isOpen }))
              }
            >
              {isOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
              <span className={styles.sectionTitle}>{section.title}</span>
              <span className={styles.sectionMeta}>
                {groups.filter((g) => g.reviewed).length}/{groups.length}{" "}
                approved
                {hasConflict && (
                  <span className={styles.conflictBadge}>
                    <AlertTriangle size={12} /> conflict
                  </span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className={styles.sectionBody}>
                {groups.map((g) => (
                  <div
                    key={g.fieldKey}
                    className={
                      styles.field +
                      (g.conflict && !g.reviewed ? " " + styles.conflict : "") +
                      (g.lowConfidence && !g.reviewed
                        ? " " + styles.lowConfidence
                        : "")
                    }
                  >
                    <div className={styles.fieldHead}>
                      <span className={styles.fieldLabel}>{g.label}</span>
                      {g.reviewed && (
                        <span className={styles.approvedBadge}>
                          <Check size={12} /> approved
                        </span>
                      )}
                      {!g.reviewed && g.lowConfidence && (
                        <span className={styles.lowBadge}>
                          Low OCR confidence — check every character
                        </span>
                      )}
                    </div>
                    {g.conflict && !g.reviewed ? (
                      <div className={styles.conflictValues}>
                        <p className={styles.conflictHint}>
                          Different documents suggest different values. Pick
                          the correct one, or fix the source document's
                          spelling and re-upload it.
                        </p>
                        {g.distinctValues.map((value) => (
                          <label key={value} className={styles.option}>
                            <input
                              type="radio"
                              name={sectionKey + ":" + g.fieldKey}
                              checked={picked[g.fieldKey] === value}
                              onChange={() =>
                                setPicked((p) => ({
                                  ...p,
                                  [g.fieldKey]: value,
                                }))
                              }
                            />
                            <span>{value}</span>
                            <small>
                              {
                                g.facts.find(
                                  (f) =>
                                    (f.chosen_value || f.extracted_value).trim() ===
                                    value,
                                )?.document_title
                              }
                            </small>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.singleValue}>
                        <input
                          type="text"
                          disabled={!writable || g.reviewed}
                          value={
                            picked[g.fieldKey] ??
                            g.distinctValues[0] ??
                            ""
                          }
                          onChange={(e) =>
                            setPicked((p) => ({
                              ...p,
                              [g.fieldKey]: e.target.value,
                            }))
                          }
                        />
                        <small>
                          from {g.facts.map((f) => f.document_title).join(", ")}
                        </small>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  className={styles.approveSection}
                  disabled={!writable || busy || allReviewed}
                  onClick={() => void approveSection(sectionKey, groups)}
                >
                  <Check size={14} />
                  {allReviewed
                    ? "Section approved"
                    : `Approve ${section.title}`}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
