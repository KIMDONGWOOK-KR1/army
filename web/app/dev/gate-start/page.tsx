import { notFound } from "next/navigation";
import GateStart from "./start";
export default function GateStartPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GateStart />;
}
