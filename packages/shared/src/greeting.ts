/** Time-of-day greeting from a 24h hour (0–23). Caller passes local hour. */
export function greetingForHour(hour: number): string {
  if (hour <= 10) return "Good morning";
  if (hour <= 16) return "Good afternoon";
  return "Good evening";
}
