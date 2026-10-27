import { afterEach, describe, expect, it, vi } from "vitest";
import { scoutPhotoMission } from "../lib/scout-photo/fixture";
import { createMockPhotoGateClient } from "../lib/scout-photo/mock";

const photoInput = (requestId: string) => ({
  requestId,
  stepId: scoutPhotoMission.photoStep.id,
  photo: new Blob(["synthetic-fixture"], { type: "image/jpeg" }),
});
const choiceInput = (requestId: string) => ({
  requestId,
  stepId: scoutPhotoMission.choiceSteps[0].id,
  answer: "1",
});

afterEach(() => vi.unstubAllEnvs());

describe("scout photo UI mock", () => {
  it("auto-passes only the photo after three failures without claiming verification", async () => {
    const client = createMockPhotoGateClient({ delayMs: 0 });
    expect((await client.submitPhoto(photoInput("a"))).result.kind).toBe("photo_retry");
    await client.submitPhoto(photoInput("b"));
    const third = await client.submitPhoto(photoInput("c"));
    expect(third.result.kind).toBe("photo_failed_pass");
    expect(third.state.photo).toEqual({
      status: "failed_pass", failureCount: 3, verified: false, completionReason: "photo_failed_3",
    });
    expect(third.state.completed).toBe(false);
    expect(Object.values(third.state.choiceProgress)).toEqual([false]);
    expect((await client.submitChoice(choiceInput("quiz"))).state.completed).toBe(true);
  });

  it("counts explicit camera/prohibition failures with photo failures in the same limit", async () => {
    const client = createMockPhotoGateClient({ delayMs: 0 });
    await client.reportUnavailable({ requestId: "a", stepId: "G-02.photo", reason: "camera_unavailable" });
    await client.submitPhoto(photoInput("b"));
    const result = await client.reportUnavailable({
      requestId: "c", stepId: "G-02.photo", reason: "photography_prohibited",
    });
    expect(result.state.photo.status).toBe("failed_pass");
    expect(result.state.photo.failureCount).toBe(3);
    expect(result.state.photo.verified).toBe(false);
  });

  it("retries a service error with the same ID without recording a failure", async () => {
    const client = createMockPhotoGateClient({ delayMs: 0 });
    client.setPhotoOutcome("service_error");
    const failed = await client.submitPhoto(photoInput("same-id"));
    expect(failed.result).toMatchObject({ kind: "error", error: { code: "SERVICE_UNAVAILABLE", retryable: true } });
    expect(failed.state.photo.failureCount).toBe(0);
    client.setPhotoOutcome("match");
    expect((await client.submitPhoto(photoInput("same-id"))).state.photo.status).toBe("verified");
  });

  it("applies concurrent and later retries once, and rejects changed action metadata", async () => {
    const client = createMockPhotoGateClient({ delayMs: 0 });
    const replies = await Promise.all([
      client.submitPhoto(photoInput("same-id")), client.submitPhoto(photoInput("same-id")),
    ]);
    expect(replies.every((reply) => reply.state.photo.failureCount === 1)).toBe(true);
    client.setPhotoOutcome("match");
    expect((await client.submitPhoto(photoInput("same-id"))).result.kind).toBe("photo_retry");
    const conflict = await client.reportUnavailable({
      requestId: "same-id", stepId: "G-02.photo", reason: "camera_unavailable",
    });
    expect(conflict.result).toMatchObject({ kind: "error", error: { code: "REQUEST_CONFLICT" } });
    expect((await client.getState()).state.photo.failureCount).toBe(1);
  });

  it("requires photo completion and accepts a configurable sequence of ordinary choices", async () => {
    const mission = structuredClone(scoutPhotoMission);
    mission.choiceSteps.push({ ...structuredClone(mission.choiceSteps[0]), id: "G-02.quiz-2" });
    const client = createMockPhotoGateClient({ mission, delayMs: 0 });
    expect((await client.submitChoice(choiceInput("early"))).result)
      .toMatchObject({ kind: "error", error: { code: "STEP_LOCKED" } });
    client.setPhotoOutcome("match");
    await client.submitPhoto(photoInput("photo"));
    expect((await client.submitChoice({ ...choiceInput("second-first"), stepId: "G-02.quiz-2" })).result)
      .toMatchObject({ kind: "error", error: { code: "STEP_LOCKED" } });
    client.setChoiceOutcome("rejected");
    expect((await client.submitChoice(choiceInput("wrong"))).state.completed).toBe(false);
    client.setChoiceOutcome("accepted");
    expect((await client.submitChoice(choiceInput("first"))).state.completed).toBe(false);
    expect((await client.submitChoice({ ...choiceInput("second"), stepId: "G-02.quiz-2" })).state.completed).toBe(true);
  });

  it("aborts without state mutation or consuming the request ID", async () => {
    const client = createMockPhotoGateClient({ delayMs: 10 });
    const controller = new AbortController();
    const pending = client.submitPhoto(photoInput("retry"), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect((await client.getState()).state.photo.failureCount).toBe(0);
    client.setPhotoOutcome("match");
    expect((await client.submitPhoto(photoInput("retry"))).result.kind).toBe("photo_verified");
  });

  it("returns detached state and no image/vector/score or actual answer data", async () => {
    const client = createMockPhotoGateClient({ delayMs: 0 });
    const reply = await client.submitPhoto(photoInput("private"));
    reply.state.photo.failureCount = 999;
    expect((await client.getState()).state.photo.failureCount).toBe(1);
    expect(JSON.stringify(reply)).not.toMatch(/synthetic-fixture|image\/jpeg|embedding|similarity|blob:/);
    expect(scoutPhotoMission.asset).toMatchObject({ url: null, confirmed: false });
    expect(scoutPhotoMission.photoStep.failurePenalty).toMatchObject({ value: null, confirmed: false });
    expect(scoutPhotoMission.photoStep).not.toHaveProperty("threshold");
    expect(scoutPhotoMission.choiceSteps[0]).not.toHaveProperty("answer");
    expect((await client.getState()).source).toBe("mock");
  });

  it("cannot instantiate in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createMockPhotoGateClient()).toThrow("개발 환경");
  });
});
