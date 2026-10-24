"use client";
import React, { useState, useEffect } from "react";
import { worldCurrencies, currencyLabel, groupedAmount } from "./currencies";
import { useTaskCurrency } from "./task-currency";
export const valuePayload = (f: FormData) => ({
  valueType: f.get("valueType") || "none",
  valueAmount: String(f.get("valueAmount") || ""),
  valueCurrency: String(f.get("valueCurrency") || "PKR").toUpperCase(),
  valueNote: f.get("valueNote") || "",
  valueTiming: f.get("valueTiming") || "prompt",
  paymentPattern: f.get("paymentPattern") || "one_time",
});
export function TaskValueFields({ task = {} }: { task?: any }) {
  const pref = useTaskCurrency();
  const [type, setType] = useState(task.value_type || "none");
  const [amount, setAmount] = useState(
    task.value_minor == null
      ? ""
      : groupedAmount((Number(task.value_minor) / 100).toFixed(2)),
  );
  const [currency, setCurrency] = useState(
    task.value_currency || pref.currency,
  );
  const [overridden, setOverridden] = useState(false);
  useEffect(() => {
    if (!task.value_currency && !overridden) setCurrency(pref.currency);
  }, [pref.currency, task.value_currency, overridden]);
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
              type="text"
              value={amount}
              onChange={(e) => {
                const raw = e.target.value.replaceAll(",", "");
                if (/^\d{0,9}(?:\.\d{0,2})?$/.test(raw))
                  setAmount(groupedAmount(raw));
              }}
              placeholder="Amount, if known"
            />
          </label>
          <label>
            Currency
            <select
              aria-label="Currency"
              name="valueCurrency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setOverridden(true);
              }}
            >
              {worldCurrencies.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {type === "profit" ? "Profit timing" : "Impact timing"}
            <select
              aria-label={type === "profit" ? "Profit timing" : "Impact timing"}
              name="valueTiming"
              defaultValue={task.value_timing || "prompt"}
            >
              <option value="prompt">Prompt</option>
              <option value="deferred">Deferred</option>
            </select>
          </label>
          <label>
            Payment
            <select
              aria-label="Payment"
              name="paymentPattern"
              defaultValue={task.payment_pattern || "one_time"}
            >
              <option value="one_time">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="installments">In installments</option>
            </select>
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
        {task.value_timing === "deferred" ? " · Deferred" : ""}
        {task.payment_pattern === "monthly"
          ? " · Monthly"
          : task.payment_pattern === "installments"
            ? " · Installments"
            : ""}
      </span>
    </>
  );
}
