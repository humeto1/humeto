"use client";
import { useState, useEffect } from "react";
import { Package, Download, CheckCircle2 } from "lucide-react";
import type { DocumentRow, Person } from "@/lib/types";
import styles from "./document-bundle.module.css";
type Preview = {
  manifest: {
    id: string;
    version: number;
    name: string;
    size: number;
    status: string;
    sha256: string;
  }[];
  totalBytes: number;
  fingerprint: string;
};
const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + " MB";
export default function DocumentBundle({
  documents,
  people,
  personId: fixedPerson,
}: {
  documents: DocumentRow[];
  people: Person[];
  personId?: string;
}) {
  const [open, setOpen] = useState(false),
    [personId, setPerson] = useState(fixedPerson || ""),
    [selected, setSelected] = useState<string[]>([]),
    [nameMode, setMode] = useState("title"),
    [maxFileMB, setLimit] = useState(15),
    [pdfOnly, setPDF] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (fixedPerson) setPerson(fixedPerson);
  }, [fixedPerson]);
  useEffect(() => {
    setSelected([]);
    setPreview(null);
    setMessage("");
  }, [personId]);
  useEffect(() => {
    setPreview(null);
  }, [selected, nameMode, maxFileMB, pdfOnly, documents]);
  const available = documents.filter((d) => d.person_id === personId),
    chosen = available.filter((d) => selected.includes(d.id));
  const run = async (download = false) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/document-bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: download ? "download" : "preview",
          personId,
          items: chosen.map((d) => ({ id: d.id, version: d.current_version })),
          nameMode,
          maxFileMB,
          pdfOnly,
          fingerprint: preview?.fingerprint,
        }),
      });
      if (!response.ok) {
        const v = await response.json();
        throw Error(v.error);
      }
      if (download) {
        const blob = await response.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "humeto-document-bundle.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setMessage(
          "Bundle downloaded. Original files and a source/version manifest are included.",
        );
      } else setPreview(await response.json());
    } catch (e) {
      setPreview(null);
      setMessage(e instanceof Error ? e.message : "Unable to prepare bundle.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.shell} aria-label="Document bundle">
      <button
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          <Package size={18} />
          <strong>Prepare a document bundle</strong>
          <small>Review selected originals before downloading</small>
        </span>
        <span>{open ? "Close" : "Prepare files"}</span>
      </button>
      {open && (
        <div className={styles.body}>
          <p>
            Choose one applicant and up to 20 current originals (50 MB total).
            Files keep their contents. Naming and file-size checks help you
            prepare a download; they do not confirm a portal’s requirements or
            document authenticity.
          </p>
          <div className={styles.options}>
            {!fixedPerson && (
              <label>
                Applicant
                <select
                  aria-label="Bundle applicant"
                  value={personId}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  <option value="">Choose an applicant</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              File names
              <select
                aria-label="Bundle file naming"
                value={nameMode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="title">Document title</option>
                <option value="original">Original filename</option>
              </select>
            </label>
            <label>
              Maximum per file (MB)
              <input
                type="number"
                aria-label="Bundle maximum file size"
                min={1}
                max={15}
                value={maxFileMB}
                onChange={(e) =>
                  setLimit(
                    Math.max(1, Math.min(15, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={pdfOnly}
                onChange={(e) => setPDF(e.target.checked)}
              />
              My portal accepts PDFs only
            </label>
          </div>
          {personId && (
            <div className={styles.documents}>
              {available.map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    aria-label={"Bundle " + d.title}
                    checked={selected.includes(d.id)}
                    disabled={
                      busy ||
                      (!selected.includes(d.id) && selected.length >= 20)
                    }
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, d.id]
                          : old.filter((id) => id !== d.id),
                      )
                    }
                  />
                  <span>
                    <strong>{d.title}</strong>
                    <small>
                      Version {d.current_version} · {d.status} ·{" "}
                      {mb(d.byte_size)} · {d.mime_type}
                    </small>
                  </span>
                </label>
              ))}
              {!available.length && (
                <p>
                  This applicant has no available documents yet. Upload files to
                  prepare a bundle.
                </p>
              )}
            </div>
          )}
          <div className={styles.footer}>
            <span>
              {chosen.length} selected ·{" "}
              {mb(chosen.reduce((n, d) => n + d.byte_size, 0))}
            </span>
            <button
              className="btn secondary"
              disabled={busy || !personId || !chosen.length}
              onClick={() => void run()}
            >
              Preview bundle
            </button>
          </div>
          {preview && (
            <div className={styles.preview}>
              <h3>
                <CheckCircle2 size={16} />
                Ready to download {preview.manifest.length} originals
              </h3>
              <p>
                {mb(preview.totalBytes)} · Flat, numbered names · No
                compression, merging or content edits
              </p>
              {preview.manifest.map((f) => (
                <div key={f.id}>
                  <strong>{f.name}</strong>
                  <span>
                    v{f.version} · {mb(f.size)} · {f.status}
                  </span>
                </div>
              ))}
              <small>
                A manifest records each source ID, original name, version and
                SHA-256. Any source/version or metadata change requires a new
                preview.
              </small>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void run(true)}
              >
                <Download size={15} />
                Download reviewed ZIP
              </button>
            </div>
          )}
          {message && (
            <p role="status" className={styles.message}>
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
