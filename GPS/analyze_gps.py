#!/usr/bin/env python3
"""
호국실록 GPS 실측 분석 스크립트

GPS 실측기(index.html)에서 저장한 CSV를 읽어, 논문 3.2절의 도착 판정 규칙을
그대로 적용해 성공률 · 오판정 · 지연을 계산한다.

판정 규칙 (논문 3.2절)
  1. 추정 오차(acc)가 --acc-max(기본 40m)를 넘는 측위값은 버린다.
  2. 남은 값 중 최근 --avg(기본 3)개의 좌표를 평균한다.
  3. 평균 좌표가 기준점에서 반경 R 안에 --dwell(기본 5)초 이상 머물면 도착으로 본다.
     반경을 벗어나면 머무른 시간은 0으로 돌아간다.

시행 종류별 지표
  정지   : 원시 측위값과 기준점 사이 거리의 평균 · 중앙값 · 95% · 최대 (반경을 정하는 근거)
  진입   : 성공률 = 도착 판정이 난 시행 / 전체 진입 시행
           지연   = 판정 시각 - 표시선 통과 버튼 시각 (중앙값, 초)
  스치기 : 오판정 = 도착 판정이 난 시행 / 전체 스치기 시행
  경계   : 반경 안/밖이 바뀐 횟수 (판정 흔들림)

사용법
  python3 analyze_gps.py 기록1.csv 기록2.csv ...
  python3 analyze_gps.py data/*.csv --radii 20,25,30,35,40,45 --out 결과
  python3 analyze_gps.py --demo              # 가상 데이터로 동작 확인

외부 라이브러리 없이 Python 3.8 이상에서 돈다.
"""
import argparse
import csv
import glob
import math
import os
import random
import statistics
import sys
from collections import defaultdict

R_EARTH = 6371008.8


def hav(a1, o1, a2, o2):
    t = math.pi / 180
    da, do = (a2 - a1) * t, (o2 - o1) * t
    h = math.sin(da / 2) ** 2 + math.cos(a1 * t) * math.cos(a2 * t) * math.sin(do / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(h)))


def pct(values, p):
    """선형 보간 백분위수 (p: 0~100)."""
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    f, c = math.floor(k), math.ceil(k)
    return s[int(k)] if f == c else s[f] + (s[c] - s[f]) * (k - f)


# ---------------------------------------------------------------- 읽기
def read_rows(paths):
    rows = []
    for p in paths:
        with open(p, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                r["_file"] = os.path.basename(p)
                rows.append(r)
    return rows


def to_trials(rows):
    """(파일, session, trial) 단위로 묶는다. 서로 다른 폰의 trial 번호가 겹쳐도 섞이지 않게."""
    groups = defaultdict(list)
    for r in rows:
        groups[(r["_file"], r.get("session", ""), r["trial"])].append(r)
    trials = []
    for (fname, sess, tid), rs in groups.items():
        rs.sort(key=lambda r: int(float(r["t_ms"])))
        first = rs[0]
        fixes, marks, t_start, t_end = [], [], None, None
        for r in rs:
            t = int(float(r["t_ms"]))
            ev = r["event"]
            if ev == "start":
                t_start = t
            elif ev == "end":
                t_end = t
            elif ev == "mark":
                marks.append(t)
            elif ev == "fix" and r["lat"] not in ("", None):
                fixes.append((t, float(r["lat"]), float(r["lng"]), float(r["acc"])))
        trials.append({
            "file": fname, "session": sess, "id": tid,
            "site": first["site"], "device": first["device"], "type": first["type"],
            "ref": (float(first["ref_lat"]), float(first["ref_lng"])),
            "line_m": float(first["line_m"] or 30),
            "start": t_start if t_start is not None else (fixes[0][0] if fixes else 0),
            "end": t_end if t_end is not None else (fixes[-1][0] if fixes else 0),
            "fixes": fixes, "marks": marks,
        })
    return trials


# ---------------------------------------------------------------- 판정
def smoothed_track(trial, acc_max, avg_n):
    """규칙 1·2를 적용한 (시각, 보정 거리) 목록."""
    kept = [f for f in trial["fixes"] if f[3] <= acc_max]
    lat0, lng0 = trial["ref"]
    out = []
    for i in range(len(kept)):
        win = kept[max(0, i - avg_n + 1): i + 1]
        lat = sum(w[1] for w in win) / len(win)
        lng = sum(w[2] for w in win) / len(win)
        out.append((kept[i][0], hav(lat, lng, lat0, lng0)))
    return out


def detect(track, radius, dwell_s):
    """규칙 3. 도착 판정 시각(ms)을 돌려준다. 없으면 None."""
    in_since = None
    for t, d in track:
        if d <= radius:
            if in_since is None:
                in_since = t
            if t - in_since >= dwell_s * 1000:
                return t
        else:
            in_since = None
    return None


def transitions(track, radius):
    n, prev = 0, None
    for _, d in track:
        cur = d <= radius
        if prev is not None and cur != prev:
            n += 1
        prev = cur
    return n


# ---------------------------------------------------------------- 집계
def analyze(trials, radii, acc_max, avg_n, dwell_s):
    per_trial = []
    for tr in trials:
        track = smoothed_track(tr, acc_max, avg_n)
        raw = [hav(f[1], f[2], *tr["ref"]) for f in tr["fixes"]]
        accs = [f[3] for f in tr["fixes"]]
        dropped = sum(1 for a in accs if a > acc_max)
        base = {
            "site": tr["site"], "device": tr["device"], "type": tr["type"],
            "trial": tr["id"], "file": tr["file"],
            "duration_s": round((tr["end"] - tr["start"]) / 1000, 1),
            "fixes": len(tr["fixes"]), "dropped_acc": dropped,
            "acc_mean": round(statistics.mean(accs), 1) if accs else "",
            "raw_dist_mean": round(statistics.mean(raw), 1) if raw else "",
            "raw_dist_p95": round(pct(raw, 95), 1) if raw else "",
            "marks": len(tr["marks"]),
        }
        for R in radii:
            hit = detect(track, R, dwell_s)
            row = dict(base, radius=R, detected=hit is not None,
                       detect_after_start_s=round((hit - tr["start"]) / 1000, 1) if hit else "",
                       delay_from_mark_s="", transitions=transitions(track, R))
            if hit and tr["marks"]:
                row["delay_from_mark_s"] = round((hit - tr["marks"][0]) / 1000, 1)
            per_trial.append(row)
    return per_trial


def summarize(per_trial, trials, radii):
    lines = []
    keys = sorted({(t["site"], t["device"]) for t in trials})
    sites = sorted({t["site"] for t in trials})

    site_p95 = {}
    lines.append("## 1. 정지 시행: 기준점에 서 있을 때 오차 (반경을 정하는 근거)\n")
    lines.append("| 거점 | 기기 | 시행 수 | 측위 수 | 거리 평균 m | 중앙값 m | 95% m | 최대 m | 추정 오차 평균 m |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for site, dev in keys:
        ts = [t for t in trials if t["site"] == site and t["device"] == dev and t["type"] == "정지"]
        d = [hav(f[1], f[2], *t["ref"]) for t in ts for f in t["fixes"]]
        a = [f[3] for t in ts for f in t["fixes"]]
        if not d:
            continue
        site_p95[site] = max(site_p95.get(site, 0), pct(d, 95))
        lines.append(f"| {site} | {dev} | {len(ts)} | {len(d)} | {statistics.mean(d):.1f} | {statistics.median(d):.1f} | "
                     f"{pct(d, 95):.1f} | {max(d):.1f} | {statistics.mean(a):.1f} |")

    lines.append("\n## 2. 반경별 도착 판정 (논문 표 1)\n")
    lines.append("성공률은 진입 시행 기준, 오판정은 스치기 시행 기준. 지연은 표시선 통과 버튼부터 판정까지의 중앙값(초)이다.\n")
    lines.append("| 거점 | 기기 | 반경 m | 진입 n | 성공률 | 지연 중앙값 s | 스치기 n | 오판정률 | 경계 흔들림(평균 전환 수) |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    rec = {}
    for site, dev in keys + [(s, "전체") for s in sites]:
        for R in radii:
            rows = [r for r in per_trial if r["site"] == site and r["radius"] == R and (dev == "전체" or r["device"] == dev)]
            ent = [r for r in rows if r["type"] == "진입"]
            pas = [r for r in rows if r["type"] == "스치기"]
            bnd = [r for r in rows if r["type"] == "경계"]
            if not (ent or pas or bnd):
                continue
            succ = sum(r["detected"] for r in ent) / len(ent) if ent else None
            fp = sum(r["detected"] for r in pas) / len(pas) if pas else None
            delays = [r["delay_from_mark_s"] for r in ent if r["delay_from_mark_s"] != ""]
            trans = statistics.mean(r["transitions"] for r in bnd) if bnd else None
            if dev == "전체":
                rec.setdefault(site, []).append((R, succ, fp, statistics.median(delays) if delays else None))
            f = lambda v, pctg=True: "-" if v is None else (f"{v*100:.0f}%" if pctg else f"{v:.1f}")
            lines.append(f"| {site} | {dev} | {R} | {len(ent)} | {f(succ)} | "
                         f"{(f'{statistics.median(delays):.1f}' if delays else '-')} | {len(pas)} | {f(fp)} | {f(trans, False)} |")

    lines.append("\n## 3. 반경 제안 (기기 합산 기준)\n")
    lines.append("기준: ① 정지 시행 95% 오차(기기 중 큰 값) 이상이고 ② 진입 성공률 90% 이상, "
                 "③ 스치기 오판정률 10% 이하인 반경 중 가장 작은 값. "
                 "①은 기준점에 서 있어도 흔들려서 판정이 늦어지는 것을 막는 하한이다. "
                 "시행 수가 적으면 참고용으로만 쓴다.\n")
    for site, vals in rec.items():
        floor = site_p95.get(site)
        ok = [(R, d) for R, s_, p, d in vals
              if s_ is not None and p is not None and s_ >= 0.9 and p <= 0.1 and (floor is None or R >= floor)]
        fl = f"정지 95% 오차 {floor:.1f}m" if floor is not None else "정지 시행 없음"
        if ok:
            R, d = min(ok)
            dd = f", 지연 중앙값 {d:.1f}초" if d is not None else ""
            lines.append(f"- {site}: **{R}m** ({fl}{dd} · 조건을 만족하는 반경: {', '.join(str(x[0]) for x in ok)})")
        else:
            lines.append(f"- {site}: 조건을 만족하는 반경 없음 ({fl}) → 기준점을 트인 곳으로 옮기거나 QR 판정을 검토")
    return "\n".join(lines)


# ---------------------------------------------------------------- 가상 데이터
def demo_rows(seed=7):
    """동작 확인용 가상 데이터. 실제 결과로 쓰지 말 것."""
    rnd = random.Random(seed)
    ref = (35.17650, 126.90720)
    m_lat = 1 / 111_320
    m_lng = 1 / (111_320 * math.cos(math.radians(ref[0])))
    rows, tid = [], 0

    def pt(x, y, sigma):
        return ref[0] + (y + rnd.gauss(0, sigma)) * m_lat, ref[1] + (x + rnd.gauss(0, sigma)) * m_lng

    for site in ("정문", "용봉관"):
        for dev, sigma in (("iPhone", 6 if site == "정문" else 11), ("Android", 8 if site == "정문" else 14)):
            def emit(kind, path, mark_at=None):
                nonlocal tid
                tid += 1
                t0 = 1_760_000_000_000 + tid * 600_000
                base = dict(session="demo", site=site, device=dev, observer="demo", trial=tid, type=kind,
                            ref_lat=ref[0], ref_lng=ref[1], line_m=30)
                rows.append(dict(base, event="start", t_ms=t0))
                for i, (x, y) in enumerate(path):
                    lat, lng = pt(x, y, sigma)
                    acc = max(4, rnd.gauss(sigma * 1.4, 3)) if rnd.random() > 0.05 else rnd.uniform(45, 90)
                    rows.append(dict(base, event="fix", t_ms=t0 + i * 1000, lat=lat, lng=lng, acc=round(acc, 1)))
                    if mark_at is not None and i == mark_at:
                        rows.append(dict(base, event="mark", t_ms=t0 + i * 1000))
                rows.append(dict(base, event="end", t_ms=t0 + len(path) * 1000))

            emit("정지", [(0, 0)] * 120)
            for _ in range(5):  # 진입: 60m 밖에서 1.3m/s로 걸어와 기준점에서 15초 정지
                path = [(0, 60 - 1.3 * i) for i in range(int(60 / 1.3))] + [(0, 0)] * 15
                mark = next(i for i, (_, y) in enumerate(path) if y <= 30)
                emit("진입", path, mark)
            for _ in range(5):  # 스치기: 기준점에서 47m 떨어진 선을 따라 통과
                emit("스치기", [(-60 + 1.3 * i, 47) for i in range(int(120 / 1.3))])
            emit("경계", [(0, 30)] * 60)
    return rows


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="호국실록 GPS 실측 분석")
    ap.add_argument("csv", nargs="*", help="실측기에서 저장한 CSV (여러 개 가능, 와일드카드 가능)")
    ap.add_argument("--radii", default="20,25,30,35,40,45", help="비교할 반경 목록 (m)")
    ap.add_argument("--acc-max", type=float, default=40, help="이보다 추정 오차가 큰 측위값은 버림 (m)")
    ap.add_argument("--avg", type=int, default=3, help="평균할 최근 측위값 개수")
    ap.add_argument("--dwell", type=float, default=5, help="반경 안에 머물러야 하는 시간 (초)")
    ap.add_argument("--out", default="gps_result", help="결과 파일 이름 앞부분")
    ap.add_argument("--demo", action="store_true", help="가상 데이터로 동작 확인")
    a = ap.parse_args()

    radii = [float(x) if "." in x else int(x) for x in a.radii.split(",")]
    if a.demo:
        rows = [dict({k: ("" if v is None else str(v)) for k, v in r.items()}, _file="demo") for r in demo_rows()]
        for r in rows:
            for k in ("lat", "lng", "acc"):
                r.setdefault(k, "")
        print("※ 가상 데이터입니다. 실제 결과로 쓰지 마세요.\n")
    else:
        paths = sorted({p for pat in a.csv for p in glob.glob(pat)})
        if not paths:
            ap.error("CSV 파일을 지정하세요. 예: python3 analyze_gps.py data/*.csv")
        rows = read_rows(paths)
        print(f"읽은 파일 {len(paths)}개, 행 {len(rows)}개\n")

    trials = to_trials(rows)
    per_trial = analyze(trials, radii, a.acc_max, a.avg, a.dwell)
    report = (f"# GPS 도착 판정 분석\n\n규칙: 추정 오차 {a.acc_max}m 초과 제거 · 최근 {a.avg}개 평균 · "
              f"반경 안 {a.dwell}초 유지\n\n" + summarize(per_trial, trials, radii))

    with open(a.out + "_trials.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(per_trial[0].keys()))
        w.writeheader()
        w.writerows(per_trial)
    with open(a.out + "_summary.md", "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(report)
    print(f"\n저장: {a.out}_summary.md, {a.out}_trials.csv")


if __name__ == "__main__":
    sys.exit(main())
