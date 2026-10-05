"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="fallback">
      <h1>기록을 불러오지 못했다.</h1>
      <p>서버에 저장된 진행은 유지된다. 다시 연결하라.</p>
      <button className="button primary" onClick={reset}>
        다시 연결
      </button>
    </main>
  );
}
