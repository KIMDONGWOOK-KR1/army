import { Compass, Flag, Radio, ScrollText, type LucideIcon } from "lucide-react";
import type { Role } from "@/supabase/functions/_shared/types";

// 네 보직의 색과 아이콘. 이동 화면 표시, 거점 도착 화면, 미션 화면이 함께 쓴다.
export const ROLE_COLORS: Record<Role, string> = {
  commander: "#2867b2",
  scout: "#237a58",
  signal: "#c56a2d",
  cipher: "#7655ad",
};

export const ROLE_ICONS: Record<Role, LucideIcon> = {
  commander: Flag,
  scout: Compass,
  signal: Radio,
  cipher: ScrollText,
};
