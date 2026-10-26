import { describe, expect, it } from "vitest";
import { createMockPhotoGateClient } from "../lib/scout-photo/mock";
import { scoutPhotoMission as mission } from "../lib/scout-photo/fixture";
import { fitSize } from "../lib/scout-photo/capture";

const photo = new Blob(["[합성]"], { type: "image/jpeg" });
const stepId = mission.photoStep.id;
let n = 0;
const id = () => `req-${n++}`;

describe("scout photo gate mock", () => {
  it("moves from a verified photo to every data-driven question", async () => {
    const c = createMockPhotoGateClient({ mission });
    expect((await c.submitPhoto({ requestId: id(), stepId, photo })).state.photo.status).toBe("verified");
    for (const q of mission.choiceSteps) await c.submitChoice({ requestId: id(), stepId: q.id, answer: "1" });
    expect(c.getState().completed).toBe(true);
  });
  it("passes only the photo step after three failures and keeps it unverified", async () => {
    const c = createMockPhotoGateClient({ mission }); c.setPhotoOutcome("no_match");
    const r1 = await c.submitPhoto({ requestId: id(), stepId, photo });
    expect(r1.result).toEqual({ kind: "photo_retry", failureCount: 1 });
    await c.reportUnavailable({ requestId: id(), stepId, reason: "camera_unavailable" });
    const r3 = await c.submitPhoto({ requestId: id(), stepId, photo });
    expect(r3.result.kind).toBe("photo_failed_pass");
    expect(r3.state.photo.status).toBe("failed_pass");
    expect(r3.state.completed).toBe(false);
    for (const q of mission.choiceSteps) await c.submitChoice({ requestId: id(), stepId: q.id, answer: "2" });
    expect(c.getState().photo.status).toBe("failed_pass");
  });
  it("does not count a service error and keeps the same request retryable", async () => {
    const c = createMockPhotoGateClient({ mission }); c.setPhotoOutcome("service_error");
    const r = await c.submitPhoto({ requestId: "same", stepId, photo });
    expect(r.result.kind).toBe("service_error");
    expect(r.state.photo.failureCount).toBe(0);
    c.setPhotoOutcome("match");
    expect((await c.submitPhoto({ requestId: "same", stepId, photo })).result.kind).toBe("photo_verified");
  });
  it("replays a repeated request id and keeps a rejected question open", async () => {
    const c = createMockPhotoGateClient({ mission }); c.setPhotoOutcome("no_match");
    await c.submitPhoto({ requestId: "dup", stepId, photo });
    await c.submitPhoto({ requestId: "dup", stepId, photo });
    expect(c.getState().photo.failureCount).toBe(1);
    c.setPhotoOutcome("match"); await c.submitPhoto({ requestId: id(), stepId, photo });
    c.setChoiceOutcome("rejected");
    const q = mission.choiceSteps[0];
    expect((await c.submitChoice({ requestId: id(), stepId: q.id, answer: "1" })).state.choiceProgress[q.id]).toBe(false);
  });
  it("refuses questions before the photo step and exposes no scoring data", async () => {
    const c = createMockPhotoGateClient({ mission });
    await expect(c.submitChoice({ requestId: id(), stepId: mission.choiceSteps[0].id, answer: "1" })).rejects.toThrow();
    const text = JSON.stringify({ mission, state: c.getState() });
    expect(text).not.toMatch(/answer|similarity|threshold|embedding/i);
  });
  it("shrinks frames to the preview size limit", () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
