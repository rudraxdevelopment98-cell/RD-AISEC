// Resource Vault types. Separate module so the "use server" actions file can
// import them (a "use server" file may only export async functions).
export const RESOURCE_TYPES = [
  "link",
  "book",
  "exploit",
  "tool",
  "cheatsheet",
  "other",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];
