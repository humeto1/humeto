"use client";
import { useState } from "react";
import "./activity-markers.css";
export function ActivityBadges({
  activity,
}: {
  activity: { is_csf?: boolean; is_kpi?: boolean };
}) {
  return (
    <span className="activity-badges">
      {activity.is_csf && (
        <span className="activity-csf" title="Critical success factor">
          CSF
        </span>
      )}
      {activity.is_kpi && (
        <span className="activity-kpi" title="Key performance indicator">
          KPI
        </span>
      )}
    </span>
  );
}

export function ActivityTags({
  isCsf = false,
  isKpi = false,
  disabled = false,
}: {
  isCsf?: boolean;
  isKpi?: boolean;
  disabled?: boolean;
}) {
  const [csf, setCsf] = useState(isCsf),
    [kpi, setKpi] = useState(isKpi);
  return (
    <fieldset className="activity-indicator-options">
      <legend>Tags</legend>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!csf && !kpi}
        onClick={() => {
          setCsf(false);
          setKpi(false);
        }}
      >
        None
      </button>
      <label>
        <input
          type="checkbox"
          name="isKpi"
          checked={kpi}
          onChange={(e) => setKpi(e.target.checked)}
          disabled={disabled}
        />{" "}
        KPI · Measure this activity
      </label>
      <label>
        <input
          type="checkbox"
          name="isCsf"
          checked={csf}
          onChange={(e) => setCsf(e.target.checked)}
          disabled={disabled}
        />{" "}
        CSF · Critical success factor
      </label>
    </fieldset>
  );
}
