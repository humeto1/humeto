import { z } from "zod";
import { worldCurrencies } from "../../shared/currencies";
export const impactFields = {
  valueType: z.enum(["none", "profit", "avoid_loss"]).optional(),
  valueAmount: z
    .string()
    .trim()
    .transform((v) =>
      /^(?:\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(v)
        ? v.replaceAll(",", "")
        : v,
    )
    .pipe(
      z
        .string()
        .regex(
          /^(?:\d{1,9}(?:\.\d{1,2})?)?$/,
          "Use a positive amount with up to two decimal places.",
        ),
    )
    .optional(),
  valueCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => worldCurrencies.includes(c), "Choose a supported currency.")
    .optional(),
  valueTiming: z.enum(["prompt", "deferred"]).optional(),
  paymentPattern: z.enum(["one_time", "monthly", "installments"]).optional(),
  valueNote: z.string().trim().max(300).optional(),
};
export function impactValues(input: any, current: any = {}) {
  const type = input.valueType ?? current.value_type ?? "none";
  let amount = current.value_minor ?? null;
  if (input.valueAmount !== undefined) {
    if (input.valueAmount === "") amount = null;
    else {
      const [whole, decimal = ""] = input.valueAmount.split(".");
      amount = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
    }
  }
  return [
    type,
    type === "none" ? null : amount,
    input.valueCurrency ?? current.value_currency ?? "PKR",
    input.valueNote ?? current.value_note ?? "",
    input.valueTiming ?? current.value_timing ?? "prompt",
    input.paymentPattern ?? current.payment_pattern ?? "one_time",
  ] as const;
}
