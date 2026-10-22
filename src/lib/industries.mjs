export const companyIndustries = [
  { key: "education", label: "Education consultant" },
  { key: "immigration", label: "Immigration consultant" },
  { key: "lawyer", label: "Lawyer / law firm" },
  { key: "travel", label: "Travel agency" },
  { key: "custom", label: "Custom CRM" },
];
export const companyIndustryKeys = companyIndustries.map((i) => i.key);
export const industryKeys = [...companyIndustryKeys, "individual"];
export const legacyIndustryKeys = ["consultant", "agency"];
export function industryLabel(key) {
  return (
    companyIndustries.find((i) => i.key === key)?.label ||
    {
      individual: "Individual",
      any: "Any account",
      consultant: "Legacy consultant — choose education or immigration",
      agency: "Legacy agency — choose travel or custom CRM",
    }[key] ||
    key
  );
}
export function audienceMatches(audience, industry) {
  if (audience === "any" || audience === industry) return true;
  // Previously issued broad vouchers retain their original audience coverage.
  if (audience === "consultant")
    return ["consultant", "education", "immigration"].includes(industry);
  if (audience === "agency")
    return ["agency", "travel", "custom"].includes(industry);
  return false;
}
