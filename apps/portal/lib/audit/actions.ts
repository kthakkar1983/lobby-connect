// Single source for the audit-log action vocabulary. The /admin/audit filter
// dropdown derives KNOWN_ACTIONS from this map, so it can never drift from the
// strings written at call sites.
export const AUDIT_ACTIONS = {
  USER_SIGNED_IN: "user.signed_in",
  USER_SIGNED_OUT: "user.signed_out",
  USER_CREATED: "user.created",
  USER_INVITED: "user.invited",
  USER_ONBOARDED: "user.onboarded",
  USER_PASSWORD_RESET: "user.password_reset",
  USER_PASSWORD_RESET_BY_ADMIN: "user.password_reset_by_admin",
  USER_PROFILE_EDITED: "user.profile_edited",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_ACTIVE_TOGGLED: "user.active_toggled",
  USER_DELETED: "user.deleted",
  PROPERTY_CREATED: "property.created",
  PROPERTY_EDITED: "property.edited",
  PROPERTY_ACTIVE_TOGGLED: "property.active_toggled",
  PROPERTY_KIOSK_EDITED: "property.kiosk_edited",
  PROPERTY_KIOSK_LINK_GENERATED: "property.kiosk_link_generated",
  PROPERTY_PLAYBOOK_UPLOADED: "property.playbook_uploaded",
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_CHANGED: "assignment.changed",
  ASSIGNMENT_REMOVED: "assignment.removed",
  INCIDENT_RESOLVED: "incident.resolved",
  TRIGGER_EMERGENCY: "trigger_emergency",
  REMOTE_ACCESS_UPDATED: "remote_access.updated",
  REMOTE_ACCESS_ROTATED: "remote_access.rotated",
  REMOTE_ACCESS_REMOVED: "remote_access.removed",
  REMOTE_ACCESS_CREDENTIALS_ISSUED: "remote_access.credentials_issued",
  SHIFT_EDITED: "shift.edited",
  SHIFT_DELETED: "shift.deleted",
  SHIFT_CREATED_MANUAL: "shift.created_manual",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Ordered list for the /admin/audit filter dropdown — derived, never hand-synced. */
export const KNOWN_ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS);
