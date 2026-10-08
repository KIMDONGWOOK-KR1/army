"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getSupabase, requestGame, requestGameAny, requestGameV2, backend } from "@/lib/client";
import type { Snapshot, Command } from "@/supabase/functions/_shared/types";
import { requestId } from "@/lib/request-id";
import { isV2Response, type GameResponse, type V2Response } from "@/lib/game-snapshot";

function refreshV1(id?: string) {
  return requestGame({ action: "get-game", game_id: id });
}
async function refreshV2(id?: string) {
  const next = await requestGameV2({ action: "get-game", game_id: id });
  if (next.game.status === "playing" && next.game.site_phase !== "travel") {
    return requestGameV2({ action: "get-stage", game_id: next.game.id, stage_id: next.game.stage_id });
  }
  return next;
}

async function refreshAny(id?: string) {
  const next = await requestGameAny({ action: "get-game", game_id: id });
  if (isV2Response(next) && next.game.status === "playing" && next.game.site_phase !== "travel") {
    return requestGameV2({ action: "get-stage", game_id: next.game.id, stage_id: next.game.stage_id });
  }
  return next;
}

export function useGame() {
  return useGameSession(requestGame, refreshV1, "hoguk", true);
}

export function useGameAny() {
  // Reuse the existing room/session. Only known v1 requests retain legacy retry storage.
  return useGameSession<GameResponse>(requestGameAny, refreshAny, "hoguk", "v1");
}

export function useGameV2() {
  // Keep private answers in memory only. A reload recovers server state, not inputs.
  return useGameSession<V2Response>(requestGameV2, refreshV2, "hoguk-v2", false);
}

function useGameSession<S extends Snapshot>(
  request: (command: Command) => Promise<S>,
  read: (id?: string) => Promise<S>,
  storagePrefix: string,
  persistPending: boolean | "v1",
) {
  const gameKey = `${storagePrefix}-game`, pendingKey = `${storagePrefix}-pending`;
  const [snapshot, setSnapshot] = useState<S | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [online, setOnline] = useState(true),
    [restoring, setRestoring] = useState(true),
    [now, setNow] = useState(Date.now());
  const current = useRef<S | null>(null),
    offset = useRef(0),
    pending = useRef<Command | null>(null),
    polling = useRef(false),
    mutation = useRef(false),
    manualReset = useRef(false),
    refreshAgain = useRef(false),
    generation = useRef(0),
    changingGame = useRef(false),
    errorCode = useRef("");
  const apply = useCallback((next: S) => {
    if (
      current.current?.game.id === next.game.id &&
      (next.version < current.current.version ||
        (next.version === current.current.version && next.server_now < current.current.server_now))
    )
      return;
    manualReset.current = false;
    offset.current = next.server_now - Date.now();
    current.current = next;
    setSnapshot(next);
    setOnline(true);
    localStorage.setItem(gameKey, next.game.id);
    if (isV2Response(next)) {
      sessionStorage.removeItem(pendingKey);
      if (errorCode.current === "PENDING" && !pending.current) {
        errorCode.current = "";
        setError("");
      }
    }
    if (
      ["NETWORK", "SERVER_ERROR"].includes(errorCode.current) &&
      !pending.current && (!persistPending || !sessionStorage.getItem(pendingKey))
    ) {
      errorCode.current = "";
      setError("");
    }
  }, [gameKey, pendingKey, persistPending]);
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
        localStorage.getItem(gameKey) ??
        undefined;
      if (backend === "supabase" && !id) return;
      const next = await read(id);
      if (scope === generation.current) apply(next);
    } catch (e) {
      if (scope !== generation.current) return;
      if (
        e instanceof ApiError &&
        ["NO_GAME", "FORBIDDEN", "EXPIRED"].includes(e.code)
      ) {
        setOnline(true);
        if (!current.current) {
          localStorage.removeItem(gameKey);
          if (
            ["NETWORK", "SERVER_ERROR"].includes(errorCode.current) &&
            !pending.current && (!persistPending || !sessionStorage.getItem(pendingKey))
          ) {
            errorCode.current = "";
            setError("");
          }
        } else setError(e.message);
      } else {
        errorCode.current = e instanceof ApiError ? e.code : "NETWORK";
        setOnline(!(e instanceof ApiError) ? false : !["NETWORK", "SERVER_ERROR"].includes(e.code));
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
  }, [apply, gameKey, pendingKey, persistPending, read]);
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
    if (persistPending && sessionStorage.getItem(pendingKey)) {
      errorCode.current = "PENDING";
      setError(
        "이전 요청의 응답을 확인하지 못했다. 같은 요청으로 다시 연결하라.",
      );
    }
  }, [pendingKey, persistPending]);
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
      const persist = !cmd.stage_id && !cmd.step_id &&
        (persistPending === true ||
          (persistPending === "v1" && current.current !== null && !isV2Response(current.current)));
      const saved = persistPending && (!current.current || !isV2Response(current.current))
        ? sessionStorage.getItem(pendingKey)
        : null;
      let previous: Command | null = pending.current;
      try {
        if (saved) previous = JSON.parse(saved);
      } catch {
        // Ignore a malformed legacy retry entry; never inspect or log its body.
      }
      const equal = (a: Command, b: Command) =>
        JSON.stringify({ ...a, request_id: undefined }) ===
        JSON.stringify({ ...b, request_id: undefined });
      if (!persist && previous && !equal(previous, cmd)) {
        setError("이전 요청의 응답을 확인하지 못했다. 먼저 다시 연결을 눌러 같은 요청을 확인하라.");
        mutation.current = false;
        changingGame.current = false;
        setBusy(false);
        return null;
      }
      cmd.request_id =
        previous && equal(previous, cmd)
          ? previous.request_id
          : requestId();
      pending.current = cmd;
      if (persist) sessionStorage.setItem(pendingKey, JSON.stringify(cmd));
      try {
        const next = await request(cmd);
        if (scope !== generation.current) return null;
        apply(next);
        pending.current = null;
        sessionStorage.removeItem(pendingKey);
        errorCode.current = "";
        setError("");
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
          sessionStorage.removeItem(pendingKey);
        }
        if (e instanceof ApiError && e.code === "NETWORK") setOnline(false);
        return null;
      } finally {
        mutation.current = false;
        changingGame.current = false;
        setBusy(false);
      }
    },
    [apply, pendingKey, persistPending, request],
  );
  const retry = useCallback(async (): Promise<S | null> => {
    if (pending.current) {
      return await send(pending.current);
    }
    const saved = persistPending && (!current.current || !isV2Response(current.current))
      ? sessionStorage.getItem(pendingKey)
      : null;
    if (saved) {
      try {
        return await send(JSON.parse(saved));
      } catch {
        // If a legacy retry entry cannot be read, recover server state instead.
      }
    }
    await refresh();
    return null;
  }, [send, refresh, pendingKey, persistPending]);
  const reset = () => {
    generation.current++;
    manualReset.current = true;
    current.current = null;
    pending.current = null;
    setSnapshot(null);
    setError("");
    localStorage.removeItem(gameKey);
    sessionStorage.removeItem(pendingKey);
  };
  return { snapshot, busy, error, online, restoring, now, send, retry, reset };
}
