export class DomainError extends Error {
  constructor(public code: string, message: string, public retry_at?: number) {
    super(message);
  }
}
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateNickname(value: unknown) {
  if (typeof value !== "string" || !/^[가-힣a-zA-Z0-9]{1,6}$/.test(value)) {
    throw new DomainError(
      "INVALID_NICKNAME",
      "호출명은 한글·영문·숫자 1~6자로 입력하라.",
    );
  }
  return value;
}
export function domainHttpStatus(code: string) {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (["NO_GAME", "NO_STAGE", "NO_STEP"].includes(code)) return 404;
  if (code === "CONTENT_UNCONFIRMED") return 503;
  if (code === "SERVER_ERROR") return 500;
  if (["COOLDOWN", "RATE_LIMITED"].includes(code)) return 429;
  if (
    [
      "WRONG_PHASE",
      "STALE_STAGE",
      "STALE_DRAFT",
      "RECORD_REQUIRED",
      "RETROS_REQUIRED",
      "STEP_LOCKED",
      "REPORTS_REQUIRED",
      "HINT_ORDER",
      "EXPLANATION_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
    ].includes(code)
  ) return 409;
  return 400;
}
