export const TRIAL_DAYS = 15;
export function trialExpiry(now = Date.now()) {
  return new Date(now + TRIAL_DAYS * 86400000).toISOString();
}
export function subscriptionAccess(s, now = Date.now()) {
  if (!s || !["active", "trial", "grace"].includes(s.status)) return false;
  if (!s.expires_at) return s.status !== "trial";
  const value = String(s.expires_at);
  const end = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T23:59:59.999Z" : value,
  );
  return Number.isFinite(end) && now < end;
}
export function trialDaysLeft(s, now = Date.now()) {
  if (s?.status !== "trial") return null;
  return Math.max(
    0,
    Math.ceil((Date.parse(s.expires_at || "") - now) / 86400000) || 0,
  );
}
