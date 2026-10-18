"use client";
import { useState, useEffect } from "react";
import { Link2, ArrowUpRight } from "lucide-react";
export default function SectionEvidence({
  personId,
  sectionKey,
  revision,
}: {
  personId: string;
  sectionKey: string;
  revision: number;
}) {
  const [rows, setRows] = useState<
    {
      id: string;
      label: string;
      document_title: string;
      page_number: number;
      document_version: number;
      document_id: string;
      source_stale: boolean;
      applicant_review: string;
      staff_review: string;
      currentMatches: boolean;
      reviewMatches: boolean;
    }[]
  >([]);
  useEffect(() => {
    let current = true;
    fetch(`/api/workspace/reading?personId=${encodeURIComponent(personId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!current || !data) return;
        const latest = new Map();
        for (const link of data.applications) {
          if (
            !latest.has(
              link.section_key + "|" + link.field_key + "|" + link.record_id,
            )
          )
            latest.set(
              link.section_key + "|" + link.field_key + "|" + link.record_id,
              link,
            );
        }
        setRows(
          [...latest.values()]
            .filter((a) => a.section_key === sectionKey)
            .map((link) => ({
              ...data.facts.find((f: { id: string }) => f.id === link.fact_id),
              currentMatches: link.currentMatches,
              reviewMatches: link.reviewMatches,
            }))
            .filter((f) => f.id),
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [personId, sectionKey, revision]);
  if (!rows.length) return null;
  return (
    <section
      style={{
        padding: 16,
        border: "1px solid #dce6d4",
        borderRadius: 12,
        marginTop: 20,
        background: "#f5f8ef",
      }}
      aria-label="Source-linked answers"
    >
      <strong
        style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center" }}
      >
        <Link2 size={14} />
        Sources for saved answers
      </strong>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{ fontSize: 11, lineHeight: 1.7, marginTop: 10 }}
        >
          <a href={`/workspace/reading?documentId=${r.document_id}`}>
            {r.label} · {r.document_title} · v{r.document_version}, page{" "}
            {r.page_number} <ArrowUpRight size={11} />
          </a>
          <div
            style={{
              color:
                r.source_stale || !r.currentMatches || !r.reviewMatches
                  ? "#a57840"
                  : "#76886a",
            }}
          >
            {r.source_stale
              ? "Source replaced; review again"
              : !r.currentMatches || !r.reviewMatches
                ? "Answer or source review changed since this value was applied"
                : `Student ${r.applicant_review} · Staff ${r.staff_review}`}
          </div>
        </div>
      ))}
    </section>
  );
}
