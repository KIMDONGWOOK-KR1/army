import { notFound } from "next/navigation";
import WallStart from "./start";
export default function WallStartPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <WallStart />;
}
