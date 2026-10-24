import currencies from "./currency-data.json";
// Snapshot of built-in Intl ISO currencies, identical during SSR and on Android.
export const worldCurrencies = currencies.map((c) => c.code);
export function currencyLabel(code: string) {
  return code + " — " + (currencies.find((c) => c.code === code)?.name || code);
}
export function groupedAmount(value: string) {
  const [whole, decimals] = value.replaceAll(",", "").split(".");
  return (
    (whole || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (decimals === undefined ? "" : "." + decimals)
  );
}
