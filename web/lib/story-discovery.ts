/** Presentation memory only. Never stores answers, records, clues or server progress. */
export type DiscoveryMemory = { opened: string[]; collected: string[] };
export const emptyDiscovery = (): DiscoveryMemory => ({ opened: [], collected: [] });
export function readDiscovery(raw: string | null, allowed: readonly string[]): DiscoveryMemory {
  try {
    const value = JSON.parse(raw ?? "null");
    const ids = (key: keyof DiscoveryMemory): string[] => Array.isArray(value?.[key])
      ? [...new Set<string>(value[key].filter((id: unknown) => typeof id === "string" && allowed.includes(id)))] : [];
    return { opened: ids("opened"), collected: ids("collected") };
  } catch { return emptyDiscovery(); }
}
export const discoveryKey = (game: string, stage: string, role: string) => `hoguk:discovery:${game}:${stage}:${role}`;
