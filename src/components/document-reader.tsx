"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScanText,
  FileCheck2,
  RefreshCw,
  ArrowUpRight,
  Check,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  Link2,
} from "lucide-react";
import { sections } from "@/lib/sections";
import type { DocumentRow, Actor, Intake } from "@/lib/types";
import styles from "./document-reader.module.css";
type Fact = {
  id: string;
  job_id: string;
  document_id: string;
  document_version: number;
  document_title: string;
  page_number: number;
  section_key: string;
  field_key: string;
  group_key: string;
  label: string;
  extracted_value: string;
  chosen_value: string;
  source_excerpt: string;
  source_box: number[] | null;
  confidence: number | null;
  method: string;
  warnings: string[];
  applicant_review: string;
  staff_review: string;
  source_stale: boolean;
  revision: number;
};
type Page = {
  id: string;
  job_id: string;
  page_number: number;
  width: number;
  height: number;
  text_content: string;
  lines: { text: string; box: number[] | null; confidence: number | null }[];
  method: string;
};
type Job = {
  id: string;
  document_version: number;
  status: string;
  progress: number;
  page_count: number;
  error: string;
  engine: string;
  warnings: string[];
  revision: number;
  attempts: number;
};
type Link = {
  id: string;
  fact_id: string;
  field_key: string;
  record_id: string;
  applied_value: string;
  currentMatches: boolean;
  reviewMatches: boolean;
  created_at: string;
};
type Data = {
  jobs: Job[];
  facts: Fact[];
  pages: Page[];
  applications: Link[];
  events: {
    id: string;
    fact_id: string;
    event: string;
    value: string;
    actor_name: string;
    created_at: string;
    note: string;
  }[];
  intake: Intake[];
  enabled: boolean;
  workerOnline: boolean;
  engine: string;
  canConfirm: boolean;
  canStaffReview: boolean;
};
export default function DocumentReader({
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
  const [did, setDid] = useState(""),
    [data, setData] = useState<Data | null>(null),
    [jid, setJid] = useState(""),
    [pageNumber, setPageNumber] = useState(1),
    [highlight, setHighlight] = useState<Fact | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("facts"),
    [mapLine, setMapLine] = useState(""),
    [mapSection, setMapSection] = useState("identity"),
    [mapField, setMapField] = useState("givenNames"),
    [mapValue, setMapValue] = useState("");
  const polling = useRef({ active: false, last: 0 });
  const sourceRef = useRef<HTMLElement | null>(null);
  const activeId = useRef("");
  activeId.current = did;
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("documentId");
    setDid(
      documents.some((d) => d.id === from) ? from! : documents[0]?.id || "",
    );
  }, []);
  const doc = documents.find((d) => d.id === did);
  const load = useCallback(async () => {
    if (!doc) return;
    const id = doc.id;
    const r = await fetch(
        `/api/workspace/reading?documentId=${encodeURIComponent(id)}&personId=${encodeURIComponent(doc.person_id)}`,
        { cache: "no-store" },
      ),
      j = await r.json();
    if (!r.ok) throw Error(j.error || "Could not load document reading.");
    if (activeId.current !== id) return;
    polling.current = {
      active: j.jobs.some((job: Job) =>
        ["queued", "running"].includes(job.status),
      ),
      last: Date.now(),
    };
    setData(j);
    setJid((old) =>
      j.jobs.some((job: Job) => job.id === old)
        ? old
        : j.jobs.find(
            (job: Job) => job.document_version === doc.current_version,
          )?.id ||
          j.jobs[0]?.id ||
          "",
    );
  }, [doc?.id, doc?.current_version, doc?.person_id]);
  useEffect(() => {
    setData(null);
    setJid("");
    setHighlight(null);
    setPageNumber(1);
    setError("");
    setNotice("");
    void load().catch((e) => setError(e.message));
    const interval = setInterval(() => {
      if (
        !document.hidden &&
        (polling.current.active || Date.now() - polling.current.last > 15000)
      )
        void load().catch((e) => setError(e.message));
    }, 3000);
    return () => clearInterval(interval);
  }, [load]);
  const job = data?.jobs.find((j) => j.id === jid),
    pages = (data?.pages || []).filter((p) => p.job_id === jid),
    page = pages.find((p) => p.page_number === pageNumber) || pages[0],
    facts = (data?.facts || []).filter((f) => f.job_id === jid),
    stale = !!job && job.document_version !== doc?.current_version;
  async function run(body: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/workspace/reading", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not save this change.");
      await load();
      await onChange();
      setNotice(message);
      return j;
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function locate(f: Fact) {
    setPageNumber(f.page_number);
    setHighlight(f);
    setTab("facts");
    if (window.matchMedia("(max-width:1050px)").matches)
      sourceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const mapDefinition = sections.find((s) => s.key === mapSection)!;
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">FROM DOCUMENTS TO DETAILS</span>
          <h1>
            A little less typing.
            <br />A lot more certainty.
          </h1>
          <p>
            Documents fill your main form automatically. Review and edit the
            details there.
          </p>
        </div>
        <a className="btn secondary small" href="/workspace/documents">
          Your documents <ArrowUpRight size={14} />
        </a>
      </header>
      <div className={styles.chooser}>
        <label>
          Applicant document
          <select
            aria-label="Document to read"
            value={did}
            onChange={(e) => setDid(e.target.value)}
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.person_name || actor.name} · {d.title} · v{d.current_version}
              </option>
            ))}
          </select>
        </label>
        {doc && (
          <button
            className="btn primary"
            disabled={
              !writable ||
              busy ||
              !data?.enabled ||
              !!data.jobs.find(
                (j) =>
                  j.document_version === doc.current_version &&
                  ["queued", "running", "completed"].includes(j.status),
              )
            }
            onClick={() =>
              void run(
                {
                  action: "queue",
                  documentId: doc.id,
                  version: doc.current_version,
                  retryRevision: data?.jobs.find(
                    (j) => j.document_version === doc.current_version,
                  )?.revision,
                },
                "Queued for local reading. You can leave this page while it works.",
              )
            }
          >
            <ScanText size={16} />
            Read document
          </button>
        )}
        <button
          className="btn secondary small"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {!documents.length && (
        <section className={styles.empty}>
          <ScanText size={30} />
          <h2>Bring the first piece of the story.</h2>
          <p>Upload a PDF, PNG or JPEG. Original files stay unchanged.</p>
          <a className="btn primary" href="/workspace/documents">
            Upload a document
          </a>
        </section>
      )}
      {doc && (
        <>
          <div className={styles.status}>
            <span
              className={data?.workerOnline ? styles.online : styles.offline}
            />
            {data
              ? data.enabled
                ? data.workerOnline
                  ? "Local reader is ready · English printed text"
                  : "Reader unavailable · queued documents will resume when it reconnects"
                : "Document reading is disabled on this server"
              : "Loading your reading space…"}
            <small>
              No external AI service · OCR scores are reading quality, not proof
              of correctness
            </small>
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {data?.jobs.length ? (
            <div className={styles.jobBar}>
              <label>
                Reading version
                <select
                  aria-label="Reading job"
                  value={jid}
                  onChange={(e) => {
                    setJid(e.target.value);
                    setPageNumber(1);
                    setHighlight(null);
                  }}
                >
                  {data.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      Version {j.document_version} · {j.status}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {job?.status === "running"
                  ? `Reading page ${job.progress || 1}${job.page_count ? " of " + job.page_count : ""}…`
                  : job?.status === "queued"
                    ? "Waiting in the reading queue"
                    : job?.status === "completed"
                      ? `${pages.length} pages · ${facts.length} suggested facts`
                      : job?.status}
              </span>
              {job?.status === "failed" && !stale && (
                <button
                  className="btn secondary small"
                  disabled={!writable || busy}
                  onClick={() =>
                    void run(
                      {
                        action: "queue",
                        documentId: doc.id,
                        version: doc.current_version,
                        retryRevision: job.revision,
                      },
                      "Reading queued again.",
                    )
                  }
                >
                  <RefreshCw size={13} />
                  Retry reading
                </button>
              )}
            </div>
          ) : (
            data && (
              <section className={styles.empty}>
                <FileCheck2 size={26} />
                <h2>Ready when you are.</h2>
                <p>
                  Read this file to find reusable details. Scans use OCR; PDFs
                  with usable embedded text use text extraction.
                </p>
                <p>
                  Up to 20 pages / 15 MB. Unclear or unsupported fields stay for
                  manual review.
                </p>
              </section>
            )
          )}
          {job?.error && (
            <p role="alert" className="notice error">
              {job.error}
            </p>
          )}
          {job?.warnings?.map((w, i) => (
            <p key={i} className={styles.warning}>
              {w}
            </p>
          ))}
          {stale && (
            <p className={styles.warning}>
              A newer file version exists. This history is preserved, but its
              facts cannot be applied. Read the current version.
            </p>
          )}
          {!!pages.length && (
            <div className={styles.workspace}>
              <section
                ref={sourceRef}
                className={styles.source}
                aria-label="Document source"
              >
                <div className={styles.sourceTop}>
                  <strong>Source · page {page?.page_number}</strong>
                  <div>
                    <button
                      aria-label="Previous source page"
                      disabled={!page || page.page_number <= 1}
                      onClick={() => {
                        setPageNumber(page.page_number - 1);
                        setHighlight(null);
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      aria-label="Next source page"
                      disabled={!page || page.page_number >= pages.length}
                      onClick={() => {
                        setPageNumber(page.page_number + 1);
                        setHighlight(null);
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                {page && (
                  <>
                    <div className={styles.previewViewport}>
                      <div className={styles.preview}>
                        <img
                          src={`/api/workspace/reading/page?id=${encodeURIComponent(page.id)}`}
                          alt={`Original document rendering, page ${page.page_number}`}
                        />
                        {highlight?.page_number === page.page_number &&
                          highlight.source_box && (
                            <span
                              className={styles.highlight}
                              style={{
                                left:
                                  (highlight.source_box[0] / page.width) * 100 +
                                  "%",
                                top:
                                  (highlight.source_box[1] / page.height) *
                                    100 +
                                  "%",
                                width:
                                  (highlight.source_box[2] / page.width) * 100 +
                                  "%",
                                height:
                                  (highlight.source_box[3] / page.height) *
                                    100 +
                                  "%",
                              }}
                            />
                          )}
                      </div>
                    </div>
                    <div className={styles.sourceLinks}>
                      <span>
                        {page.method === "pdf-text"
                          ? "Embedded PDF text"
                          : "Tesseract OCR"}{" "}
                        · v{job?.document_version}
                      </span>
                      {highlight && (
                        <button
                          className={styles.sourceButton}
                          onClick={() =>
                            document
                              .getElementById("fact-" + highlight.id)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                              })
                          }
                        >
                          Back to selected fact
                        </button>
                      )}
                      <a
                        href={`/api/workspace/documents/${doc.id}/download?version=${job?.document_version}&inline=1#page=${page.page_number}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open original <ArrowUpRight size={12} />
                      </a>
                    </div>
                  </>
                )}
              </section>
              <section className={styles.review}>
                <nav className="segmented" aria-label="Document reading views">
                  {[
                    ["facts", "Suggested facts"],
                    ["text", "Read text / map a field"],
                    ["history", "Review history"],
                  ].map(([key, title]) => (
                    <button
                      key={key}
                      className={tab === key ? "active" : ""}
                      onClick={() => setTab(key)}
                    >
                      {title}
                    </button>
                  ))}
                </nav>
                {tab === "facts" && (
                  <>
                    <p className={styles.hint}>
                      Extracted details fill the main form automatically. Review
                      and edit them there. This view shows the source evidence.
                    </p>
                    {!facts.length && (
                      <p>
                        No automatic field matches. Use “Read text / map a
                        field” to link a source line to the correct question.
                      </p>
                    )}
                    {[...new Set(facts.map((f) => f.section_key))].map(
                      (sectionKey) => {
                        const group = facts.filter(
                            (f) => f.section_key === sectionKey,
                          ),
                          section = sections.find((s) => s.key === sectionKey)!,
                          intake = data?.intake.find(
                            (i) => i.section_key === sectionKey,
                          ),
                          records = (intake?.data.items || []) as Record<
                            string,
                            string
                          >[];
                        return (
                          <div key={sectionKey} className={styles.group}>
                            <h2>{section?.title || sectionKey}</h2>
                            {group.map((f) => {
                              const links =
                                  data?.applications.filter(
                                    (a) => a.fact_id === f.id,
                                  ) || [],
                                value = f.chosen_value;
                              return (
                                <article
                                  key={f.id}
                                  id={"fact-" + f.id}
                                  className={styles.fact}
                                  data-testid="document-fact"
                                >
                                  <div className={styles.factTop}>
                                    <label>
                                      <strong>{f.label}</strong>
                                    </label>
                                    <button
                                      className={styles.sourceButton}
                                      onClick={() => locate(f)}
                                    >
                                      <Link2 size={12} />
                                      p. {f.page_number}
                                    </button>
                                  </div>
                                  <blockquote>{f.source_excerpt}</blockquote>
                                  <label className={styles.value}>
                                    Suggested value
                                    {section.fields.find(
                                      (x) => x.key === f.field_key,
                                    )?.type === "select" ? (
                                      <select
                                        aria-label={`Value for ${f.label}`}
                                        value={value}
                                        disabled
                                      >
                                        <option value="">Choose…</option>
                                        {section.fields
                                          .find((x) => x.key === f.field_key)
                                          ?.options?.map((o) => (
                                            <option key={o}>{o}</option>
                                          ))}
                                      </select>
                                    ) : (
                                      <input
                                        aria-label={`Value for ${f.label}`}
                                        type={
                                          section.fields.find(
                                            (x) => x.key === f.field_key,
                                          )?.type === "date"
                                            ? "date"
                                            : "text"
                                        }
                                        value={value}
                                        maxLength={10000}
                                        disabled
                                      />
                                    )}
                                  </label>
                                  {value !== f.extracted_value && (
                                    <small className={styles.hint}>
                                      Original reading:{" "}
                                      {f.extracted_value ||
                                        "(date order needs clarification)"}
                                    </small>
                                  )}
                                  {f.warnings.map((w, i) => (
                                    <p key={i} className={styles.warning}>
                                      {w}
                                    </p>
                                  ))}
                                  <div className={styles.badges}>
                                    <span>
                                      Review and edit in the main form
                                    </span>
                                    {f.confidence !== null && (
                                      <span>
                                        OCR score {Math.round(f.confidence)}/100
                                      </span>
                                    )}
                                    {f.source_stale && (
                                      <span>Source replaced</span>
                                    )}
                                  </div>
                                  {links[0] && (
                                    <p
                                      className={
                                        links[0].currentMatches &&
                                        links[0].reviewMatches &&
                                        !f.source_stale
                                          ? styles.linked
                                          : styles.warning
                                      }
                                    >
                                      {links[0].currentMatches &&
                                      links[0].reviewMatches &&
                                      !f.source_stale
                                        ? "Saved answer matches this source-linked value."
                                        : "Saved answer or source changed since this fact was applied. Review again."}
                                    </p>
                                  )}
                                </article>
                              );
                            })}
                            <div className={styles.apply}>
                              <a
                                href={`/workspace/students/${doc.person_id}?section=${sectionKey}`}
                              >
                                Review main form <ArrowUpRight size={12} />
                              </a>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </>
                )}
                {tab === "text" && page && (
                  <>
                    <h2>Read text, keep the source.</h2>
                    <p className={styles.hint}>
                      Choose a line to map it to a question. OCR can misread
                      names and numbers; check the original before confirming.
                    </p>
                    <div className={styles.textLines}>
                      {page.lines.map((line, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setMapLine(line.text);
                            setMapValue(line.text);
                          }}
                        >
                          {line.text}
                        </button>
                      ))}
                    </div>
                    {mapLine && (
                      <form
                        className={styles.mapping}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const result = await run(
                            {
                              action: "map",
                              pageId: page.id,
                              sectionKey: mapSection,
                              fieldKey: mapField,
                              excerpt: mapLine,
                              value: mapValue,
                            },
                            "Source-linked suggestion created. Review it before applying.",
                          );
                          if (result) {
                            setMapLine("");
                            setTab("facts");
                          }
                        }}
                      >
                        <blockquote>{mapLine}</blockquote>
                        <label>
                          Question group
                          <select
                            value={mapSection}
                            onChange={(e) => {
                              setMapSection(e.target.value);
                              setMapField(
                                sections
                                  .find((s) => s.key === e.target.value)!
                                  .fields.find((f) => !f.sensitive)!.key,
                              );
                            }}
                          >
                            {sections
                              .filter(
                                (s) =>
                                  !s.restricted && s.key !== "declarations",
                              )
                              .map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Field
                          <select
                            value={mapField}
                            onChange={(e) => setMapField(e.target.value)}
                          >
                            {mapDefinition.fields
                              .filter((f) => !f.sensitive)
                              .map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Value to review
                          <input
                            value={mapValue}
                            maxLength={300}
                            onChange={(e) => setMapValue(e.target.value)}
                          />
                        </label>
                        <button
                          className="btn primary small"
                          disabled={!writable || busy || stale}
                        >
                          Create linked suggestion
                        </button>
                      </form>
                    )}
                  </>
                )}
                {tab === "history" && (
                  <div className={styles.history}>
                    <h2>A visible review trail.</h2>
                    {data?.events.length ? (
                      data.events.map((e) => (
                        <article key={e.id}>
                          <Clock size={13} />
                          <div>
                            <strong>
                              {e.event} · {e.actor_name || "Local reader"}
                            </strong>
                            <p>{e.value}</p>
                            <small>
                              {new Date(e.created_at).toLocaleString()} ·{" "}
                              {e.note}
                            </small>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p>No review actions yet.</p>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
          <p className={styles.disclaimer}>
            Reading and confirmation do not authenticate a document. Missing or
            uncertain information stays for a person to resolve.
          </p>
        </>
      )}
    </div>
  );
}
