"use client";
import { useRef, useState } from "react";
import {
  FolderOpen,
  Files,
  Upload,
  Check,
  AlertCircle,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import type { Person } from "@/lib/types";
type Item = { file: File; path: string; status: string; error?: string };
export default function ImportPanel({
  people,
  defaultPerson,
  onComplete,
}: {
  people: Person[];
  defaultPerson?: string;
  onComplete: () => void;
}) {
  const [personId, setPersonId] = useState(
      defaultPerson || people[0]?.id || "",
    ),
    [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [finished, setFinished] = useState(false);
  const folder = useRef<HTMLInputElement>(null),
    files = useRef<HTMLInputElement>(null);
  function choose(list: FileList | null) {
    if (!list) return;
    setFinished(false);
    setError("");
    setItems(
      [...list].slice(0, 100).map((file) => ({
        file,
        path: file.webkitRelativePath || file.name,
        status:
          /\.(pdf|png|jpe?g)$/i.test(file.name) && file.size <= 15 * 1024 * 1024
            ? "Ready"
            : "Unsupported / too large",
      })),
    );
    if (list.length > 100)
      setError(
        "Only the first 100 files are included. Import the rest in another batch.",
      );
  }
  async function run() {
    setBusy(true);
    setError("");
    let failures = 0;
    try {
      const selected = items.filter((i) => i.status === "Ready");
      if (!selected.length)
        throw new Error("Choose at least one supported file.");
      const response = await fetch("/api/workspace/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId,
          name: selected[0].path.split("/")[0] || "Selected files",
          count: selected.length,
        }),
      });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error);
      for (const item of selected) {
        setItems((old) =>
          old.map((i) => (i === item ? { ...i, status: "Uploading…" } : i)),
        );
        const form = new FormData();
        form.set("personId", personId);
        form.set("title", item.file.name);
        form.set("category", "Other");
        form.set("file", item.file);
        form.set("sourcePath", item.path);
        form.set("importRunId", created.id);
        try {
          const r = await fetch("/api/workspace/documents", {
            method: "POST",
            body: form,
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setItems((old) =>
            old.map((i) =>
              i.file === item.file
                ? {
                    ...i,
                    status: result.duplicate ? "Duplicate linked" : "Imported",
                  }
                : i,
            ),
          );
        } catch (e) {
          failures++;
          setItems((old) =>
            old.map((i) =>
              i.file === item.file
                ? { ...i, status: "Failed", error: (e as Error).message }
                : i,
            ),
          );
        }
      }
      await fetch("/api/workspace/imports/" + created.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: failures ? "Needs attention" : "Complete",
        }),
      });
      setFinished(true);
      onComplete();
      if (failures)
        setError(
          `${failures} file(s) need attention. Originals that succeeded remain saved; retry failed files in a new batch.`,
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">A SELECTED FOLDER. A CLEARER START.</span>
      <h2 id="modal-title">Bring the pieces together.</h2>
      <p>
        Import up to 100 files for one selected applicant. Mixed-applicant
        folders should be split before importing. No automatic identity
        assignment or OCR runs.
      </p>
      <label className="import-person">
        Applicant
        <select
          value={personId}
          disabled={busy}
          onChange={(e) => setPersonId(e.target.value)}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(e) => choose(e.target.files)}
      />
      <input
        ref={files}
        type="file"
        multiple
        hidden
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={(e) => choose(e.target.files)}
      />
      <div className="import-buttons">
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => folder.current?.click()}
        >
          <FolderOpen size={16} />
          Select folder
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => files.current?.click()}
        >
          <Files size={16} />
          Select files
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {items.length > 0 && (
        <div className="import-list">
          {items.map((item, i) => (
            <div key={item.path + i}>
              <span>
                <strong>{item.path}</strong>
                <small>
                  {(item.file.size / 1024).toFixed(0)} KB · {item.status}
                  {item.error ? " · " + item.error : ""}
                </small>
              </span>
              {!busy && !finished ? (
                <button
                  className="icon-btn"
                  aria-label={"Exclude " + item.path}
                  onClick={() =>
                    setItems((old) => old.filter((_, index) => index !== i))
                  }
                >
                  <Trash2 size={13} />
                </button>
              ) : item.status === "Imported" ||
                item.status === "Duplicate linked" ? (
                <Check size={15} />
              ) : item.status === "Uploading…" ? (
                <LoaderCircle className="spin" size={14} />
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div className="notice quiet">
        Files remain unchanged. Relative folder paths are preserved as metadata;
        stored filenames are private generated IDs. Duplicate content is checked
        only within this applicant’s workspace.
      </div>
      <button
        className="btn primary full"
        disabled={busy || !items.some((i) => i.status === "Ready") || !personId}
        onClick={() => void run()}
      >
        {busy ? (
          <>
            <LoaderCircle className="spin" size={15} />
            Importing…
          </>
        ) : finished ? (
          "Import finished"
        ) : (
          <>
            <Upload size={15} />
            Confirm & import selected files
          </>
        )}
      </button>
    </>
  );
}
