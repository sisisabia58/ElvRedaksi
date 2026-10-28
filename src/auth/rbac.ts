export const ROLES = ["admin", "social_media", "viewer", "kol_specialist"] as const;
export type Role = (typeof ROLES)[number];
export const ACTIONS = [
  "studio.read",
  "review.write",
  "brain.write",
  "source.write",
  "team.write",
  "settings.write",
  "publish",
] as const;
export type Action = (typeof ACTIONS)[number];

const GRANTS: Record<Role, Action[]> = {
  admin: [...ACTIONS],
  social_media: ["studio.read", "review.write", "brain.write", "publish"],
  viewer: ["studio.read"],
  kol_specialist: ["studio.read"],
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}
