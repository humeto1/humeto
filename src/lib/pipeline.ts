export const leadStages = [
  "New",
  "Contacted",
  "Qualified",
  "Counselling",
  "Awaiting registration",
  "Registered",
  "Lost",
] as const;
export const applicantStages = [
  "Planning",
  "Documents",
  "Applying",
  "Offers",
  "Visa",
  "Enrolled",
  "Closed",
] as const;
export const applicationStages = [
  "Draft",
  "Collecting",
  "Review",
  "Ready",
  "Submitted",
  "Offer received",
  "Conditional offer",
  "Decision received",
  "Visa approved",
  "Enrolled",
  "Failed",
  "Withdrawn",
] as const;
export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  stage: string;
  destination: string;
  course: string;
  notes: string;
  follow_up: string;
  timeline: string;
  expected_fee: number;
  upfront_fee: number;
  incentive: number;
  revision: number;
  person_id: string | null;
  extras: Record<string, string>;
};
export type Finance = {
  person_id: string;
  expected_fee: number;
  upfront_fee: number;
  incentive: number;
  currency: string;
  timeline: string;
  paid: number;
  pending: number;
  revision: number;
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);
