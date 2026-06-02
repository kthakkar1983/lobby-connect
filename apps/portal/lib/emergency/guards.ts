export interface EmergencyGuardInput {
  state: string;
  channel: string;
  handledByUserId: string | null;
  userId: string;
}

/** Emergency may be triggered only by the agent currently on an audio call. */
export function canTriggerEmergency(i: EmergencyGuardInput): boolean {
  return (
    i.state === "IN_PROGRESS" &&
    i.channel === "AUDIO" &&
    i.handledByUserId !== null &&
    i.handledByUserId === i.userId
  );
}
