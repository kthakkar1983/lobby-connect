export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Reject if `promise` does not settle within `ms`. Used to bound the irreversible
 * 911 REST calls: a hung Twilio dependency surfaces as a handled rejection (the
 * route's existing catch → degraded dispatch → agent falls back to verbal relay)
 * instead of silently hanging the request open until the platform function limit.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
