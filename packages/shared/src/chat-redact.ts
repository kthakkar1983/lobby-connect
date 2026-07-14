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
 * True if the pure-digit string `d` should be treated as carrying a card number.
 * (a) The whole run is a 13–19 digit PAN (Luhn-valid) — the base rule.
 * (b) A PAN (13–19 Luhn-valid) glued to a short expiry/CVV: for runs of 19–25
 *     digits, a Luhn-valid window of 13–19 digits anchored at the START or END
 *     with <=6 leftover digits on the other side. Anchoring + the 19–25 length
 *     bound keep this from masking legitimate long numbers by interior
 *     coincidence, and runs of <=18 digits are never embedded-scanned — so a
 *     non-card 16-digit run (e.g. a mistyped Luhn-failing group) is untouched.
 */
function digitsCarryPan(d: string): boolean {
  const n = d.length;
  if (n < 13) return false;
  if (n <= 19 && luhnValid(d)) return true; // (a) whole run is a PAN
  if (n >= 19 && n <= 25) {
    // (b) bounded, anchored embedded scan
    for (let L = 13; L <= 19 && L < n; L++) {
      if (n - L > 6) continue;
      if (luhnValid(d.slice(0, L))) return true; // PAN + short trailer (expiry/CVV)
      if (luhnValid(d.slice(n - L))) return true; // short leader + PAN
    }
  }
  return false;
}

/**
 * Mask card-number-like runs from user-typed chat text BEFORE it is published.
 * A "run" is digits optionally separated by single spaces, dots, or hyphens.
 * Runs are masked per digitsCarryPan (whole-run PAN, or a PAN glued to a short
 * expiry/CVV). The length floor + anchoring keep addresses, ZIPs, phones, room
 * and confirmation numbers untouched. Prefix (IIN) is intentionally NOT required
 * so no real card slips through an incomplete issuer table. LiveKit is
 * self-hosted, so a transmitted PAN would pull cardholder data into our path —
 * this keeps "LC never touches card data" literally true (spec §6 / D7).
 */
export function redactCardNumbers(text: string): string {
  // A digit, then 11+ of [digit|space|dot|hyphen], ending on a digit → 13+ chars.
  return text.replace(/\d[\d .-]{11,}\d/g, (run) => {
    const digits = run.replace(/[ .-]/g, "");
    return digitsCarryPan(digits) ? MASK : run;
  });
}
