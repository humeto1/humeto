"use client";
import { useEffect, useState } from "react";
import { PlanSuccess } from "./plan-success";
import { webApi, type Transport } from "./transport";
export function ActivityMeasures({
  activityId,
  isKpi = false,
  writable,
  request = webApi,
  refresh,
}: {
  activityId: string;
  isKpi?: boolean;
  writable: boolean;
  request?: Transport;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(isKpi);
  useEffect(() => {
    if (isKpi) setOpen(true);
  }, [isKpi]);
  return (
    <details
      className="activity-measures"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>KPI targets & CSF review</summary>
      {open && (
        <PlanSuccess
          type="activity"
          id={activityId}
          request={request}
          writable={writable}
          active={open}
          onUpdate={refresh}
        />
      )}
    </details>
  );
}
