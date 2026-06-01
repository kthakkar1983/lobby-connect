import "server-only";
import { RtcTokenBuilder, RtcRole } from "agora-token";

export interface RtcTokenArgs {
  appId: string;
  appCertificate: string;
  channelName: string;
  uid: number;
  expireSeconds: number;
}

/** Mint a PUBLISHER RTC token for a channel + uid (two-way A/V). */
export function buildRtcPublisherToken(args: RtcTokenArgs): string {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + args.expireSeconds;
  return RtcTokenBuilder.buildTokenWithUid(
    args.appId,
    args.appCertificate,
    args.channelName,
    args.uid,
    RtcRole.PUBLISHER,
    expire,
    expire,
  );
}
