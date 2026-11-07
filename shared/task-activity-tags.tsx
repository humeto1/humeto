"use client";
import { useState } from "react";
import { ActivityMeasures } from "./activity-measures";
import { ActivityTags } from "./activity-markers";
import { webApi, type Transport } from "./transport";
export function TaskActivityTags({
  task,
  writable,
  request = webApi,
  refresh,
}: {
  task: {
    id: string;
    revision: number;
    stage: string;
    is_csf?: boolean;
    is_kpi?: boolean;
  };
  writable: boolean;
  request?: Transport;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <form
        className="task-activity-tags"
        key={task.id + ":" + task.revision}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await request(
              "/api/workspace/tasks/" + encodeURIComponent(task.id),
              {
                stage: task.stage,
                revision: task.revision,
                isCsf: f.get("isCsf") === "on",
                isKpi: f.get("isKpi") === "on",
              },
              "PATCH",
            );
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ActivityTags
          isCsf={task.is_csf}
          isKpi={task.is_kpi}
          disabled={!writable || busy}
        />
        <small>
          Tags do not change completion or repetition. Repeating occurrences
          share the same activity tags.
        </small>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!writable || busy}>
          {busy ? "Saving…" : "Save tags"}
        </button>
      </form>
      <ActivityMeasures
        activityId={task.id}
        isKpi={task.is_kpi}
        writable={writable}
        request={request}
        refresh={refresh}
      />
    </>
  );
}
