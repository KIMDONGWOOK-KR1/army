// One audible tab for all WebAudio engines. Audio preferences remain unchanged.
let owned = true;
let cleanup: (() => void) | null = null;
const listeners = new Set<() => void>();
export const isAudioForeground = () => owned && (typeof document === "undefined" || !document.hidden);
export function subscribeAudioFocus(listener: () => void) {
  listeners.add(listener);
  if (!cleanup && typeof window !== "undefined" && typeof document !== "undefined") {
    const channel = typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel("hoguk-audio-focus") : null;
    const notify = () => listeners.forEach(fn => fn());
    const claim = () => { if (document.hidden) return; owned = true; channel?.postMessage("claim"); notify(); };
    const gesture = (e: Event) => { if (e.isTrusted && !owned) claim(); };
    const visibility = () => { if (document.hidden) { owned = false; notify(); } else claim(); };
    if (channel) channel.onmessage = e => { if (e.data === "claim") { owned = false; notify(); } };
    window.addEventListener("focus", claim);
    window.addEventListener("pointerdown", gesture, true);
    window.addEventListener("keydown", gesture, true);
    document.addEventListener("visibilitychange", visibility);
    cleanup = () => { channel?.close(); window.removeEventListener("focus", claim);
      window.removeEventListener("pointerdown", gesture, true); window.removeEventListener("keydown", gesture, true);
      document.removeEventListener("visibilitychange", visibility); owned = true; };
    visibility();
  }
  return () => { listeners.delete(listener); if (!listeners.size) { cleanup?.(); cleanup = null; } };
}
