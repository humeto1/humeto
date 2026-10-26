"use client";
import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

export default function DocumentDropInput({
  multiple = false,
  disabled = false,
}: {
  multiple?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    depth = useRef(0);
  const [dragging, setDragging] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState("");
  function choose(next: File[]) {
    if (disabled) return;
    if (next.length > (multiple ? 20 : 1)) {
      setError(
        multiple
          ? "Choose up to 20 documents at once."
          : "Choose one replacement document.",
      );
      return;
    }
    if (
      next.some(
        (file) =>
          file.size > 15 * 1024 * 1024 ||
          !["application/pdf", "image/png", "image/jpeg"].includes(file.type),
      )
    ) {
      setError("Each document must be a PDF, PNG or JPEG up to 15 MB.");
      return;
    }
    const transfer = new DataTransfer();
    next.forEach((file) => transfer.items.add(file));
    if (input.current) input.current.files = transfer.files;
    setFiles(next);
    setError("");
  }
  return (
    <div className="document-drop-input">
      <label
        className={`upload-field document-drop-zone${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) {
            depth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          depth.current = 0;
          setDragging(false);
          if (disabled) return;
          const dropped = Array.from(e.dataTransfer.files);
          if (!dropped.length) {
            setError(
              "Drop PDF, PNG or JPEG files, rather than folders or links.",
            );
            return;
          }
          const combined = multiple ? [...files, ...dropped] : dropped;
          choose(
            combined.filter(
              (file, i) =>
                combined.findIndex(
                  (other) =>
                    other.name === file.name &&
                    other.size === file.size &&
                    other.lastModified === file.lastModified,
                ) === i,
            ),
          );
        }}
      >
        <Upload size={25} />
        <strong>
          {dragging
            ? "Drop documents here"
            : multiple
              ? "Drag documents here or choose files"
              : "Drag a document here or choose a file"}
        </strong>
        <small>
          PDF, PNG or JPEG · up to 15 MB each
          {multiple ? " · up to 20 files" : ""}
        </small>
        <input
          ref={input}
          name="file"
          type="file"
          multiple={multiple}
          disabled={disabled}
          accept="application/pdf,image/png,image/jpeg"
          required
          aria-label={multiple ? "Documents" : "Replacement document"}
          onChange={(e) => {
            const next = Array.from(e.target.files || []);
            const previous = files;
            choose(next);
            // Restore the previous valid selection if the native picker supplied invalid files.
            if (
              next.length > (multiple ? 20 : 1) ||
              next.some(
                (f) =>
                  f.size > 15 * 1024 * 1024 ||
                  !["application/pdf", "image/png", "image/jpeg"].includes(
                    f.type,
                  ),
              )
            ) {
              const transfer = new DataTransfer();
              previous.forEach((f) => transfer.items.add(f));
              e.target.files = transfer.files;
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <div className="document-drop-files" aria-label="Selected documents">
          <small role="status">
            {files.length} document{files.length === 1 ? "" : "s"} ready to
            upload
          </small>
          {files.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`}>
              <span>{file.name}</span>
              <button
                className="icon-btn"
                type="button"
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => choose(files.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
