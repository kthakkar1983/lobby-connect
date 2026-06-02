export type OwnerTab = "home" | "calls" | "incidents";

export function activeOwnerTab(pathname: string): OwnerTab {
  if (pathname.startsWith("/owner/calls")) return "calls";
  if (pathname.startsWith("/owner/incidents")) return "incidents";
  return "home";
}
