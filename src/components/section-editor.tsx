"use client";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  Plus,
  Trash2,
  CloudCheck,
  LoaderCircle,
  AlertCircle,
  FolderOpen,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import type { Section, Intake } from "@/lib/types";
export type EditorHandle = { flush: () => Promise<boolean> };
type Props = {
  personId: string;
  section: Section;
  initial?: Intake;
  onSaved: (row: Intake) => void;
  onDocuments: () => void;
  onNext: () => void;
  readOnly?: boolean;
};
export default forwardRef<EditorHandle, Props>(function SectionEditor(
  { personId, section, initial, onSaved, onDocuments, onNext, readOnly },
  ref,
) {
  const [step, setStep] = useState(0),
    [activeRecord, setActiveRecord] = useState(0);
  const [data, setData] = useState<Record<string, unknown>>(
    initial?.data || (section.repeatable ? { items: [] } : {}),
  );
  const [state, setState] = useState(initial?.state || "draft");
  const [saveStatus, setSaveStatus] = useState("All changes saved");
  const [error, setError] = useState("");
  const latest = useRef({ data, state }),
    revision = useRef(initial?.revision || 0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pending = useRef(false),
    running = useRef<Promise<boolean> | null>(null),
    alive = useRef(true),
    changed = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function drain(): Promise<boolean> {
    if (running.current) return running.current;
    const work = (async () => {
      while (pending.current) {
        pending.current = false;
        const payload = latest.current;
        try {
          if (alive.current) {
            setSaveStatus("Saving…");
            setError("");
          }
          const r = await fetch(`/api/workspace/students/${personId}/intake`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sectionKey: section.key,
              data: payload.data,
              state: payload.state,
              revision: revision.current,
            }),
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          revision.current = result.revision;
          changed.current = false;
          onSaved({
            section_key: section.key,
            data: payload.data,
            state: payload.state,
            revision: result.revision,
            updated_at: result.savedAt,
          });
          if (alive.current && !pending.current)
            setSaveStatus("All changes saved");
        } catch (e) {
          pending.current = true;
          if (alive.current) {
            setError((e as Error).message);
            setSaveStatus("Not saved");
          }
          return false;
        }
      }
      return true;
    })();
    running.current = work;
    try {
      return await work;
    } finally {
      running.current = null;
    }
  }
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) {
      const ok = await running.current;
      if (!ok) return false;
    }
    return pending.current ? drain() : !error;
  }
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(() => {
    function leave(e: BeforeUnloadEvent) {
      if (changed.current || pending.current || running.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function update(next: Record<string, unknown>, nextState = state) {
    setData(next);
    setState(nextState);
    latest.current = { data: next, state: nextState };
    pending.current = true;
    changed.current = true;
    setSaveStatus("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void drain(), 800);
  }
  function fieldChange(key: string, value: string, index?: number) {
    if (index === undefined) update({ ...data, [key]: value });
    else {
      const items = [...((data.items as Record<string, string>[]) || [])];
      items[index] = { ...items[index], [key]: value };
      update({ items });
    }
  }
  const groupSize = 6,
    groupCount = Math.ceil(section.fields.length / groupSize),
    visibleFields = section.fields.slice(
      step * groupSize,
      (step + 1) * groupSize,
    );
  const records = section.repeatable
    ? (data.items as Record<string, string>[]) || []
    : [data as Record<string, string>];
  return (
    <section className="section-editor">
      <div className="editor-heading">
        <span className="eyebrow">
          {section.journey.toUpperCase()} / SMALL STEPS, YOUR PACE
        </span>
        <h2>{section.title}</h2>
        <p>{section.description}</p>
      </div>
      {readOnly && (
        <div className="notice">
          Your workspace is read-only. You can still view and download your
          records.
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={17} />
          <span>
            {error} Your current answers remain visible.{" "}
            <button onClick={() => void drain()}>Retry saving</button>
          </span>
        </div>
      )}
      {groupCount > 1 && (
        <div className="question-parts">
          <div>
            <strong>One small group at a time.</strong>
            <span>
              {step + 1} of {groupCount} · switch freely
            </span>
          </div>
          <nav aria-label="Question groups">
            {Array.from({ length: groupCount }, (_, i) => (
              <button
                key={i}
                className={step === i ? "active" : ""}
                onClick={() => setStep(i)}
              >
                {i + 1}
                <span>{section.fields[i * groupSize].label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {section.repeatable && records.length > 0 && (
        <div className="record-switcher" aria-label="Your records">
          {records.map((record, index) => (
            <button
              key={String(record._id || index)}
              className={activeRecord === index ? "active" : ""}
              onClick={() => {
                setActiveRecord(index);
                setStep(0);
              }}
            >
              {index + 1}.{" "}
              {String(
                record.institution ||
                  record.name ||
                  record.employer ||
                  record.country ||
                  record.test ||
                  record.type ||
                  "Record",
              )}
            </button>
          ))}
        </div>
      )}
      {records.length === 0 && (
        <div className="empty-card">
          <FolderOpen size={27} />
          <h3>Start with one record.</h3>
          <p>
            Add what you know. Dates and supporting evidence can come later.
          </p>
        </div>
      )}
      {records.map((record, index) =>
        section.repeatable && index !== activeRecord ? null : (
          <div
            key={String(record._id || section.key)}
            className={section.repeatable ? "record-card" : "plain-record"}
          >
            {section.repeatable && (
              <div className="record-heading">
                <strong>
                  {String(
                    record.institution ||
                      record.name ||
                      record.employer ||
                      record.country ||
                      record.test ||
                      record.type ||
                      `Record ${index + 1}`,
                  )}
                </strong>
                <button
                  disabled={readOnly}
                  className="icon-btn danger-hover"
                  aria-label={`Remove record ${index + 1}`}
                  onClick={() => {
                    update({ items: records.filter((_, i) => i !== index) });
                    setActiveRecord(Math.max(0, index - 1));
                    setStep(0);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
            <div className="field-grid">
              {visibleFields.map((f) => (
                <label
                  key={f.key}
                  className={f.type === "textarea" ? "wide" : ""}
                >
                  <span>
                    {f.label}
                    {f.sensitive && (
                      <span className="private-tag">Private</span>
                    )}
                  </span>
                  {f.type === "textarea" ? (
                    <textarea
                      disabled={readOnly}
                      rows={3}
                      value={String(record[f.key] || "")}
                      onChange={(e) =>
                        fieldChange(
                          f.key,
                          e.target.value,
                          section.repeatable ? index : undefined,
                        )
                      }
                    />
                  ) : f.type === "select" ? (
                    <select
                      disabled={readOnly}
                      value={String(record[f.key] || "")}
                      onChange={(e) =>
                        fieldChange(
                          f.key,
                          e.target.value,
                          section.repeatable ? index : undefined,
                        )
                      }
                    >
                      <option value="">Add later / not answered</option>
                      {f.options?.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      disabled={readOnly}
                      type={f.type || "text"}
                      value={String(record[f.key] || "")}
                      onChange={(e) =>
                        fieldChange(
                          f.key,
                          e.target.value,
                          section.repeatable ? index : undefined,
                        )
                      }
                      placeholder="Add what you know"
                    />
                  )}
                  {f.hint && <small>{f.hint}</small>}
                </label>
              ))}
            </div>
          </div>
        ),
      )}
      {section.repeatable && (
        <button
          className="btn secondary"
          disabled={readOnly}
          onClick={() => {
            update({ items: [...records, { _id: crypto.randomUUID() }] });
            setActiveRecord(records.length);
            setStep(0);
          }}
        >
          <Plus size={15} /> Add another record
        </button>
      )}
      {groupCount > 1 && (
        <div className="question-parts-footer">
          <button
            className="btn ghost small"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            ← Previous group
          </button>
          <span>Nothing here is compulsory to save.</span>
          <button
            className="btn secondary small"
            disabled={step === groupCount - 1}
            onClick={async () => {
              if (await flush()) setStep(step + 1);
            }}
          >
            Next small group <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="evidence-area">
        <div>
          <FolderOpen size={21} />
          <span>
            <strong>Supporting documents</strong>
            <small>
              Upload evidence or link a file to this section. You can add it
              later.
            </small>
          </span>
        </div>
        <button
          className="btn secondary small"
          onClick={async () => {
            if (await flush()) onDocuments();
          }}
        >
          Choose / upload documents
        </button>
      </div>
      <div className="editor-footer">
        <span className={`save-state ${error ? "failed" : ""}`} role="status">
          {saveStatus === "Saving…" ? (
            <LoaderCircle size={15} className="spin" />
          ) : error ? (
            <AlertCircle size={15} />
          ) : (
            <CloudCheck size={15} />
          )}{" "}
          {saveStatus}
        </span>
        <div className="editor-actions">
          <button
            className="btn ghost small"
            disabled={readOnly}
            onClick={async () => {
              update(data, "skipped");
              if (await flush()) onNext();
            }}
          >
            Skip for now <ArrowRight size={14} />
          </button>
          <button
            className="btn primary small"
            disabled={readOnly}
            onClick={async () => {
              update(data, "ready");
              await flush();
            }}
          >
            Mark entered & save
          </button>
        </div>
      </div>
      <p className="editor-footnote">
        “Entered” means you have supplied this section. It is not verification
        or confirmation that an external application is ready.
      </p>
    </section>
  );
});
