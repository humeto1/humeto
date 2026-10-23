"use client";
import type { ReactNode } from "react";
import "./task-detail-group.css";

/** Keep fields mounted when folded so saving never erases hidden values. */
export function TaskDetailGroup({
  title,
  hint,
  open = false,
  children,
}: {
  title: string;
  hint?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="task-detail-group" open={open}>
      <summary>
        <span>
          {title}
          {hint && <small>{hint}</small>}
        </span>
        <span className="task-group-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="task-group-content">{children}</div>
    </details>
  );
}
