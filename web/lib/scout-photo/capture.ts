/** Preview defaults, not a deployed upload policy. No file or EXIF is uploaded. */
export const PHOTO_PREVIEW_LIMITS = { maxEdge: 1600, maxBytes: 2 * 1024 * 1024 };

export function fitPhotoSize(width: number, height: number, maxEdge = PHOTO_PREVIEW_LIMITS.maxEdge) {
  if (![width, height, maxEdge].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("카메라 영상을 아직 읽지 못했습니다. 잠시 후 촬영해 주세요.");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Drawing video pixels to a fresh canvas creates a JPEG without source metadata. */
export async function capturePhoto(video: HTMLVideoElement): Promise<Blob> {
  const size = fitPhotoSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진을 준비하지 못했습니다. 다시 촬영해 주세요.");
  try {
    context.drawImage(video, 0, 0, size.width, size.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("사진 변환에 실패했습니다.")), "image/jpeg", quality);
      });
      if (blob.size <= PHOTO_PREVIEW_LIMITS.maxBytes) return blob;
    }
    throw new Error("사진이 너무 큽니다. 다시 촬영해 주세요.");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function stopPhotoStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
