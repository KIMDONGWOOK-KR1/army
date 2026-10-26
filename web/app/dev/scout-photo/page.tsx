import { notFound } from "next/navigation";
import ScoutPhotoPreview from "@/components/scout-photo-preview";
import "./scout-photo.css";

export default function ScoutPhotoPreviewPage() {
  // This isolated mock must never become an alternative to real game grading.
  if (process.env.NODE_ENV !== "development") notFound();
  return <ScoutPhotoPreview />;
}
