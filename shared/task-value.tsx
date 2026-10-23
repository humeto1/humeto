"use client";
import React, { useState } from "react";
export const valuePayload = (f: FormData) => ({
  valueType: f.get("valueType") || "none",
  valueAmount: String(f.get("valueAmount") || ""),
  valueCurrency: String(f.get("valueCurrency") || "PKR").toUpperCase(),
  valueNote: f.get("valueNote") || "",
});
export function TaskValueFields({ task = {} }: { task?: any }) {
  const [type, setType] = useState(task.value_type || "none");
  return (
    <fieldset className="task-value-fields">
      <legend>Expected financial impact · optional</legend>
      <label>
        Impact
        <select
          name="valueType"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="none">No estimate</option>
          <option value="profit">Potential profit</option>
          <option value="avoid_loss">Avoid loss / penalty</option>
        </select>
      </label>
      {type !== "none" && (
        <>
          <label>
            {type === "profit"
              ? "Expected profit"
              : "Loss that could be avoided"}
            <input
              name="valueAmount"
              inputMode="decimal"
              type="number"
              step="0.01"
              min="0"
              max="999999999.99"
              defaultValue={
                task.value_minor == null
                  ? ""
                  : (Number(task.value_minor) / 100).toFixed(2)
              }
              placeholder="Amount, if known"
            />
          </label>
          <label>
            Currency
            <input
              name="valueCurrency"
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              defaultValue={task.value_currency || "PKR"}
              required
            />
          </label>
          <label>
            Why does this matter?
            <input
              name="valueNote"
              maxLength={300}
              defaultValue={task.value_note || ""}
              placeholder={
                type === "profit"
                  ? "Expected commission if this succeeds"
                  : "Late fee or lost opportunity to avoid"
              }
            />
          </label>
        </>
      )}
      <small>
        Estimates for prioritisation. No payment, income or expense is recorded.
      </small>
    </fieldset>
  );
}
export function TaskValueBadge({ task }: { task: any }) {
  const parent = task.project_target_currency ? (
    <span
      className="task-value-badge"
      title="Parent project target; this task contributes to it. Do not add it again as task income."
    >
      Project target
      {task.project_target_basis && task.project_target_basis !== "project"
        ? " / " + task.project_target_basis
        : ""}{" "}
      · {task.project_target_currency}{" "}
      {(
        (Number(task.project_target_upfront) +
          Number(task.project_target_completion)) /
        100
      ).toLocaleString()}
      {Number(task.project_target_conditional) > 0
        ? " + " +
          (Number(task.project_target_conditional) / 100).toLocaleString() +
          " conditional"
        : ""}
    </span>
  ) : null;
  if (!task.value_type || task.value_type === "none") return parent;
  const text =
    (task.value_type === "profit" ? "Potential profit" : "Avoid loss") +
    (task.value_minor == null
      ? ""
      : " · " +
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: task.value_currency || "PKR",
          maximumFractionDigits: 2,
        }).format(Number(task.value_minor) / 100));
  return (
    <>
      {parent}
      <span
        className={"task-value-badge " + task.value_type}
        title={task.value_note || "Estimated impact, not realised money"}
      >
        {text}
      </span>
    </>
  );
}
