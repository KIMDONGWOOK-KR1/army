"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getSupabase, requestGame, backend } from "@/lib/client";
import type { Snapshot, Command } from "@/supabase/functions/_shared/types";
export function useGame() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [online, setOnline] = useState(true),
    [restoring, setRestoring] = useState(true),
    [now, setNow] = useState(Date.now());
  const current = useRef<Snapshot | null>(null),
    offset = useRef(0),
    pending = useRef<Command | null>(null),
    polling = useRef(false),
    mutation = useRef(false),
    manualReset = useRef(false),
    refreshAgain = useRef(false),
    generation = useRef(0),
    changingGame = useRef(false),
    errorCode = useRef("");
  const apply = useCallback((next: Snapshot) => {
    if (
      current.current?.game.id === next.game.id &&
      next.version < current.current.version
    )
      return;
    manualReset.current = false;
    offset.current = next.server_now - Date.now();
    current.current = next;
    setSnapshot(next);
    setOnline(true);
    localStorage.setItem("hoguk-game", next.game.id);
    if (
      ["NETWORK", "SERVER_ERROR"].includes(errorCode.current) &&
      !sessionStorage.getItem("hoguk-pending")
    ) {
      errorCode.current = "";
      setError("");
    }
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    if (changingGame.current || (manualReset.current && !current.current))
      return;
    if (polling.current) {
      refreshAgain.current = true;
      return;
    }
    polling.current = true;
    const scope = generation.current;
    try {
      const id =
        current.current?.game.id ??
        localStorage.getItem("hoguk-game") ??
        undefined;
      if (backend === "supabase" && !id) return;
      const next = await requestGame({ action: "get-game", game_id: id });
      if (scope === generation.current) apply(next);
    } catch (e) {
      if (scope !== generation.current) return;
      if (
        e instanceof ApiError &&
        ["NO_GAME", "FORBIDDEN", "EXPIRED"].includes(e.code)
      ) {
        setOnline(true);
        if (!current.current) {
          localStorage.removeItem("hoguk-game");
          if (
            ["NETWORK", "SERVER_ERROR"].includes(errorCode.current) &&
            !sessionStorage.getItem("hoguk-pending")
          ) {
            errorCode.current = "";
            setError("");
          }
        } else setError(e.message);
      } else {
        errorCode.current = e instanceof ApiError ? e.code : "NETWORK";
        setOnline(false);
        setError(e instanceof Error ? e.message : "연결을 확인하라.");
      }
    } finally {
      polling.current = false;
      setRestoring(false);
      if (refreshAgain.current) {
        refreshAgain.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  }, [apply]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 500);
    const focus = () => void refresh();
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (sessionStorage.getItem("hoguk-pending"))
      setError(
        "이전 요청의 응답을 확인하지 못했다. 같은 요청으로 다시 연결하라.",
      );
  }, []);
  useEffect(() => {
    if (
      snapshot?.game.status !== "briefing" ||
      snapshot.game.reveal_at === null
    )
      return;
    const timer = setTimeout(
      () => void refresh(),
      Math.max(0, snapshot.game.reveal_at - (Date.now() + offset.current)) + 30,
    );
    return () => clearTimeout(timer);
  }, [snapshot?.game.status, snapshot?.game.reveal_at, refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const interval = setInterval(
      () => void refresh(),
      backend === "local" ? 1500 : 10000,
    );
    let cleanup = () => {};
    if (backend === "supabase") {
      try {
        const client = getSupabase()!,
          channel = client.channel(`game:${snapshot.game.id}`, {
            config: { private: true, presence: { key: snapshot.self.id } },
          });
        channel
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "game_public",
              filter: `game_id=eq.${snapshot.game.id}`,
            },
            () => void refresh(),
          )
          .on("broadcast", { event: "stage" }, () => void refresh())
          .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
              await channel.track({ member_id: snapshot.self.id });
              void refresh();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              setOnline(false);
            }
          });
        cleanup = () => {
          void client.removeChannel(channel);
        };
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "실시간 연결 설정을 확인하라.",
        );
      }
    }
    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, [snapshot?.game.id, refresh]); // Only resubscribe when the operation changes.
  const send = useCallback(
    async (command: Command) => {
      if (mutation.current) return null;
      mutation.current = true;
      setBusy(true);
      setError("");
      const creating = ["create-game", "create-demo", "join-game"].includes(
        command.action,
      );
      const { game_id: oldId, ...fields } = command;
      const cmd: Command = creating
        ? fields
        : { ...command, game_id: oldId ?? current.current?.game.id };
      if (creating) {
        generation.current++;
        changingGame.current = true;
      }
      const scope = generation.current;
      const saved = sessionStorage.getItem("hoguk-pending");
      let previous: Command | null = null;
      try {
        previous = saved ? JSON.parse(saved) : null;
      } catch {}
      const equal = (a: Command, b: Command) =>
        JSON.stringify({ ...a, request_id: undefined }) ===
        JSON.stringify({ ...b, request_id: undefined });
      cmd.request_id =
        previous && equal(previous, cmd)
          ? previous.request_id
          : crypto.randomUUID();
      pending.current = cmd;
      sessionStorage.setItem("hoguk-pending", JSON.stringify(cmd));
      try {
        const next = await requestGame(cmd);
        if (scope !== generation.current) return null;
        apply(next);
        pending.current = null;
        sessionStorage.removeItem("hoguk-pending");
        return next;
      } catch (e) {
        if (scope !== generation.current) return null;
        errorCode.current = e instanceof ApiError ? e.code : "NETWORK";
        setError(e instanceof Error ? e.message : "요청을 처리하지 못했다.");
        if (
          e instanceof ApiError &&
          e.code !== "NETWORK" &&
          e.code !== "RETRY" &&
          e.code !== "SERVER_ERROR"
        ) {
          pending.current = null;
          sessionStorage.removeItem("hoguk-pending");
        }
        if (e instanceof ApiError && e.code === "NETWORK") setOnline(false);
        return null;
      } finally {
        mutation.current = false;
        changingGame.current = false;
        setBusy(false);
      }
    },
    [apply],
  );
  const retry = useCallback(async () => {
    const saved = sessionStorage.getItem("hoguk-pending");
    if (saved) {
      try {
        await send(JSON.parse(saved));
        return;
      } catch {}
    }
    await refresh();
  }, [send, refresh]);
  const reset = () => {
    generation.current++;
    manualReset.current = true;
    current.current = null;
    setSnapshot(null);
    setError("");
    localStorage.removeItem("hoguk-game");
    sessionStorage.removeItem("hoguk-pending");
  };
  return { snapshot, busy, error, online, restoring, now, send, retry, reset };
}
