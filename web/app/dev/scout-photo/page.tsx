import { notFound } from "next/navigation";
import { ScoutPhotoPreview } from "@/components/scout-photo-preview";

export const metadata = { title: "정찰원 사진 미션 · 개발용", robots: { index: false } };

// 개발 서버에서만 여는 화면. 운영 빌드에서는 404다.
export default function ScoutPhotoDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ScoutPhotoPreview />;
}
