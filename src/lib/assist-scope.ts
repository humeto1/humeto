// Explicitly scoped, reusable facts. Disclosure/health/security answers are never paired.
export const assistSectionKeys = [
  "identity",
  "contact",
  "passports",
  "family",
  "education",
  "tests",
  "employment",
  "references",
  "study-goals",
  "travel-history",
  "trip-plans",
  "study-visa",
] as const;
export function assistAllowed(key: string) {
  return (assistSectionKeys as readonly string[]).includes(key);
}
