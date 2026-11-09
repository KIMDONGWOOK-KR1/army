import { notFound } from "next/navigation";
import BongjiStart from "./start";

export default function BongjiStartPage() {
  // 개발 서버 전용: 혼자 데모를 봉지 도착까지 넘겨 실제 게임 화면의 봉지 마당부터 본다
  if (process.env.NODE_ENV !== "development") notFound();
  return <BongjiStart />;
}
