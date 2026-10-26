// 카메라 영상의 한 장면을 캔버스로 다시 그려 JPEG로 만든다.
// 원본 파일·EXIF를 읽지 않는다. 긴 변 1,600px·2MiB 이내는 미리보기 기본값이다(업로드 정책 확정 아님).
export const MAX_EDGE = 1600;
export const MAX_BYTES = 2 * 1024 * 1024;

export function fitSize(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = fitSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
  for (const quality of [0.86, 0.72, 0.58, 0.45]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("photo too large");
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
