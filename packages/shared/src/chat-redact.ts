const MASK = "•••• (card number hidden)";

/** Luhn (mod-10) checksum over a pure-digit string. */
export function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const c = digits.charCodeAt(i) - 48; // '0' === 48
    if (c < 0 || c > 9) return false;
    let d = c;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Mask card-number-like runs from user-typed chat text BEFORE it is published.
 * A run of digits (optionally separated by single spaces/hyphens) is masked iff,
 * after stripping separators, it is 13–19 digits AND passes Luhn. The length
 * floor keeps addresses, ZIPs, phones, room and confirmation numbers untouched;
 * Luhn adds specificity. Prefix (IIN) is intentionally NOT required so no real
 * card slips through an incomplete issuer table.
 */
export function redactCardNumbers(text: string): string {
  // A digit, then 11+ chars of [digit|space|hyphen], ending on a digit → 13+ chars.
  return text.replace(/\d[\d -]{11,}\d/g, (run) => {
    const digits = run.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return MASK;
    return run;
  });
}
