import { NextResponse } from "next/server";

import type { DialTarget } from "@/lib/voice/plan-dial";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

export const APOLOGY_MESSAGE =
  "We're sorry, no one is available right now. Please try again or call us directly.";

export function twimlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, { status, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface IncomingTwimlOpts {
  greeting: string;
  timeoutSeconds: number;
  actionUrl: string;
  apologyMessage: string;
  callId: string;
  /** Hotel name, surfaced on the agent's ringing softphone so they know who they're answering for. */
  propertyName: string;
}

export function buildApologyTwiml(message: string): string {
  return `${XML_DECL}<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`;
}

// 5a: a "number not in service" situation reuses the generic apology text.
// Kept as its own function so switching to a distinct message later is one line.
export function buildNotInServiceTwiml(message: string): string {
  return buildApologyTwiml(message);
}

export function buildHangupTwiml(): string {
  return `${XML_DECL}<Response><Hangup/></Response>`;
}

export function buildIncomingTwiml(
  targets: DialTarget[],
  opts: IncomingTwimlOpts,
): string {
  if (targets.length === 0) return buildApologyTwiml(opts.apologyMessage);

  const clients = targets
    .map(
      (t) =>
        `<Client><Identity>${escapeXml(t.identity)}</Identity>` +
        `<Parameter name="callId" value="${escapeXml(opts.callId)}"/>` +
        `<Parameter name="propertyName" value="${escapeXml(opts.propertyName)}"/></Client>`,
    )
    .join("");

  return (
    `${XML_DECL}<Response>` +
    `<Say>${escapeXml(opts.greeting)}</Say>` +
    `<Dial timeout="${opts.timeoutSeconds}" action="${escapeXml(opts.actionUrl)}" method="POST">` +
    clients +
    `</Dial></Response>`
  );
}
