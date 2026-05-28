import type { Role } from "@lc/shared";

export type UserPatch = {
  full_name?: string;
  role?: Role;
  active?: boolean;
};

type EditArgs = {
  actorId: string;
  targetId: string;
  patch: UserPatch;
};

export function assertNotSelfDemote(args: EditArgs): string | null {
  if (args.actorId !== args.targetId) return null;
  if (args.patch.role === undefined) return null;
  return "You can't change your own role.";
}

export function assertNotSelfDeactivate(args: EditArgs): string | null {
  if (args.actorId !== args.targetId) return null;
  if (args.patch.active !== false) return null;
  return "You can't deactivate yourself.";
}

export function assertNotSelfDelete(args: {
  actorId: string;
  targetId: string;
}): string | null {
  if (args.actorId !== args.targetId) return null;
  return "You can't delete yourself.";
}
