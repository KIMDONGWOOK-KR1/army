"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="fallback">
      <h1>기록을 불러오지 못했어요.</h1>
      <p>서버에 저장된 진행은 그대로예요. 다시 연결해 주세요.</p>
      <button className="button primary" onClick={reset}>
        다시 연결
      </button>
    </main>
  );
}
