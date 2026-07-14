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
 * (a) ANY 13–19 digit run is card-shaped and masked — the Luhn checksum is NOT
 *     required. Real PANs always pass Luhn, so this still catches every real
 *     card; dropping the gate additionally catches a fat-fingered real card
 *     (which leaks ~15 of 16 real digits) and card-shaped test input. The cost
 *     is that a genuine 13–19 digit number (e.g. an international phone with
 *     country code) is also masked — an accepted, recoverable trade-off in the
 *     speech-failure chat, where the guest is on live video (spec §6 / D7).
 * (b) A PAN glued to a short expiry/CVV: for runs of 20–25 digits, a Luhn-valid
 *     window of 13–19 digits anchored at the START or END with <=6 leftover
 *     digits on the other side. Luhn still gates this longer-run case so a
 *     20–25 digit non-card string isn't masked by mere length.
 */
function digitsCarryPan(d: string): boolean {
  const n = d.length;
  if (n < 13) return false;
  if (n <= 19) return true; // (a) any 13–19 digit run is card-shaped → mask
  if (n <= 25) {
    // (b) bounded, anchored embedded scan (PAN glued to expiry/CVV)
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
 * Runs are masked per digitsCarryPan (any 13–19 digit run, or a PAN glued to a
 * short expiry/CVV). The 13-digit floor keeps short numbers (addresses, ZIPs,
 * US phones, room and most confirmation numbers) untouched; longer runs are
 * masked whether or not they pass Luhn (see digitsCarryPan). Prefix (IIN) is
 * intentionally NOT required so no real card slips through an incomplete issuer
 * table. LiveKit is
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
