"use client";
import { CalendarDays } from "lucide-react";

// Existing public v1 calendar illustration; contains no server answer mapping.
export function MissionCalendar() {
  return (
    <div className="calendar">
      <div>
        <CalendarDays size={17} /> 1980년 5월
      </div>
      <div className="calendar-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <b key={d}>{d}</b>
        ))}
        {Array.from({ length: 4 }, (_, i) => <span key={`blank${i}`} />)}
        {Array.from(
          { length: 31 },
          (_, i) => (
            <span key={i} className={i === 17 ? "marked" : ""}>
              {i + 1}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
