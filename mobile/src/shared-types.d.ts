declare module "*scheduling-clock.mjs" {
  export function scheduledAt(day: string, time: string, zone: string): string;
  export function nextDay(
    day: string,
    frequency: string,
    interval?: number,
    anchor?: number,
  ): string;
  export function quietUntil(at: Date, prefs: object): string | null;
}
