import { z } from "zod";
export const impactFields = {
  valueType: z.enum(["none", "profit", "avoid_loss"]).optional(),
  valueAmount: z
    .string()
    .trim()
    .regex(
      /^(?:\d{1,9}(?:\.\d{1,2})?)?$/,
      "Use a positive amount with up to two decimal places.",
    )
    .optional(),
  valueCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .optional(),
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
  ] as const;
}
