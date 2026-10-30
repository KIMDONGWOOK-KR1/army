import type { PhotoOutcome } from "./contract";

/**
 * 개발 서버 전용: 사진을 같은 서버의 /api/dev/photo-verify로 보내 로컬 사진 판정 서버(photo-verify)의 결과를 받는다.
 * 판정 서버 키는 Next 서버 환경변수에만 있고 브라우저로 오지 않는다. 사진은 판정에만 쓰고 남기지 않는다.
 */
export const localVerifyEnabled = () => process.env.NEXT_PUBLIC_PHOTO_VERIFY === "local";

export async function judgeWithLocalVerifier(siteId: string, photo: Blob, signal?: AbortSignal): Promise<PhotoOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/dev/photo-verify?site_id=${encodeURIComponent(siteId)}`, {
      method: "POST",
      headers: { "content-type": photo.type || "image/jpeg" },
      body: photo,
      signal,
    });
  } catch (error) {
    // 화면이 요청을 취소한 경우는 그대로 알린다. 그 밖의 연결 실패는 다시 시도할 수 있는 장애다.
    if (signal?.aborted) throw error;
    return "service_error";
  }
  // 판정 서버가 사진을 읽지 못하면(깨짐·너무 큼) 실패로 세지 않고 다시 찍게 한다.
  if (response.status === 400) return "retake";
  if (!response.ok) return "service_error";
  const body = await response.json().catch(() => null) as { match?: unknown; reason_code?: unknown } | null;
  if (body?.match === true) return "match";
  if (body?.reason_code === "RETAKE") return "retake";
  if (body?.reason_code === "NO_MATCH") return "no_match";
  return "service_error";
}
