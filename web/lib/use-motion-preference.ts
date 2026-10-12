"use client";
import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
function subscribe(update: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
const read = () => window.matchMedia(query).matches;
const server = () => true;

/** Motion 14's hook snapshots its initial preference. Subscribe for live OS changes and safe SSR. */
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, read, server);
}
