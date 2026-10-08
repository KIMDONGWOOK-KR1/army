// 오픈스트리트맵 내보내기 파일(.osm)을 입체 필드용 작은 JSON으로 굽는다.
// 사용법: node scripts/build-map.mjs <map.osm> <출력.json> [설정.json]
// 좌표는 설정의 기준점(origin)을 원점으로 한 미터 단위다(x 동쪽, z 남쪽).
// 원본 .osm은 저장소에 넣지 않는다. 지도 자료 © OpenStreetMap contributors, ODbL.
//
// 설정(모두 선택):
//   origin   기준점 위치
//   anchors  { 이름: 위치 }  거점·모형을 세울 자리
//   legs     [[출발, (거쳐 갈 곳…), 도착], …]  anchors 사이 도보 경로(길 그물에서 최단 경로)
//   boxes    { 이름: 건물 이름 | {id, faces} }  건물 윤곽에 맞춘 회전 상자(모형 맞춤용).
//            id는 OSM id(w…/r…), faces는 정면이 바라볼 anchors 이름
//   heights  { OSM id: { h | levels, src } }  지도 태그보다 믿을 만한 높이(m)·층수와 그 근거.
//            굽기의 높이 추정(heightOf) 뒤에 덮어쓰고 hs = 1로 표시한다
//   style    { OSM id: { m, win?, round?, src } }  사진·학교 자료로 확인한 외벽 재질.
//            m = brick | white | glass | bands, win = ribbon(가로 띠창),
//            round = { toward: [x, z], r }  그 방향 끝 모서리를 반지름 r m로 크게 굴린다
//   campus   { way }  캠퍼스 경계(amenity=university) 다각형. 건물 분류(캠퍼스/동네)에 쓴다
//   roadWidth { 길 id: 너비m }  지도에 차로 수가 없어 좁게 나오는 길 고치기
//   channels [{ way, offset, from, to, w, reverse }]  길 옆으로 흐르는 물길(지도에 없는 구간)
//   avenues  [{ way, offset, from, to, step, reverse }]  길 양옆 가로수 줄
//   (from·to는 길 첫 점부터 잰 미터, reverse면 끝 점부터 잰다. offset > 0은 진행 방향 오른쪽)
// 위치: {lat,lng} | {node: id} | {name} | {way: id, at: m} | {building: 이름, faces: anchor, gap: m}
//
// 내보내는 건물: { id, p, h, t(building 값), lv?(층수), hs?(1 = 높이·층수가 태그나 설정 근거),
//   m?·win?(설정 style의 재질·창), rr?([윤곽 꼭짓점 번호, 반지름 m]: 크게 굴릴 모서리) }
// 내보내는 캠퍼스 경계 campus: [x0, z0, x1, z1, …]
// 내보내는 지점 pois: [{ k, x, z, a }]  k = bench | bicycle_parking | shelter | bus_stop |
//   waste_basket | entrance | crossing. a는 모형의 +z가 볼 방향(y축 회전, 라디안).
//   crossing은 차도 진행 방향, entrance는 벽 바깥, 나머지는 가장 가까운 길(정류장은 차도) 쪽.
import fs from "node:fs";

const [input, output, configPath] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/build-map.mjs <map.osm> <out.json> [config.json]");
  process.exit(1);
}
const config = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const xml = fs.readFileSync(input, "utf8");

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#"
      ? String.fromCodePoint(
          e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
        )
      : (ENT[e] ?? m),
  );
const attrs = (s) =>
  Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
const tagsOf = (body = "") =>
  Object.fromEntries(
    [...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map((m) => [decode(m[1]), decode(m[2])]),
  );

// ── 읽기 ──────────────────────────────────────────────
const nodes = new Map();
for (const m of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
  const a = attrs(m[1]);
  nodes.set(a.id, { lat: +a.lat, lng: +a.lon, tags: tagsOf(m[2]) });
}
const ways = new Map();
for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
  const a = attrs(m[1]);
  ways.set(a.id, {
    id: a.id,
    refs: [...m[2].matchAll(/<nd ref="(-?\d+)"\s*\/>/g)].map((x) => x[1]),
    tags: tagsOf(m[2]),
  });
}
const relations = [];
for (const m of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
  const a = attrs(m[1]);
  relations.push({
    id: a.id,
    members: [...m[2].matchAll(/<member type="(\w+)" ref="(-?\d+)" role="([^"]*)"\s*\/>/g)].map(
      (x) => ({ type: x[1], ref: x[2], role: x[3] }),
    ),
    tags: tagsOf(m[2]),
  });
}
const b = xml.match(/<bounds minlat="([-\d.]+)" minlon="([-\d.]+)" maxlat="([-\d.]+)" maxlon="([-\d.]+)"/);
const bounds = b ? { minLat: +b[1], minLng: +b[2], maxLat: +b[3], maxLng: +b[4] } : null;
console.log(`nodes ${nodes.size}, ways ${ways.size}, relations ${relations.length}`);

// ── 위치 찾기(위도·경도) ─────────────────────────────
const R = 6371000,
  RAD = Math.PI / 180;
const haversine = (p, q) => {
  const x =
    Math.sin(((q.lat - p.lat) * RAD) / 2) ** 2 +
    Math.cos(p.lat * RAD) * Math.cos(q.lat * RAD) * Math.sin(((q.lng - p.lng) * RAD) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const wayNodes = (w) => w.refs.map((r) => nodes.get(r)).filter(Boolean);
// 길을 따라 at 미터 간 지점
function alongWay(id, at) {
  const w = ways.get(String(id));
  if (!w) throw new Error(`way ${id} not found`);
  const ps = wayNodes(w);
  for (let i = 1; i < ps.length; i++) {
    const d = haversine(ps[i - 1], ps[i]);
    if (at <= d) {
      const t = at / (d || 1);
      return { lat: ps[i - 1].lat + (ps[i].lat - ps[i - 1].lat) * t, lng: ps[i - 1].lng + (ps[i].lng - ps[i - 1].lng) * t };
    }
    at -= d;
  }
  return { lat: ps.at(-1).lat, lng: ps.at(-1).lng };
}
function locate(spec) {
  if (spec.lat !== undefined) return { lat: spec.lat, lng: spec.lng };
  if (spec.node) {
    const n = nodes.get(String(spec.node));
    if (!n) throw new Error(`node ${spec.node} not found`);
    return { lat: n.lat, lng: n.lng };
  }
  if (spec.way) return alongWay(spec.way, spec.at ?? 0);
  if (spec.name) {
    for (const n of nodes.values()) if (n.tags.name === spec.name) return { lat: n.lat, lng: n.lng };
    for (const w of ways.values())
      if (w.tags.name === spec.name) {
        const ps = wayNodes(w);
        if (ps.length > 1 && w.refs[0] === w.refs.at(-1)) ps.pop();
        return {
          lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
          lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length,
        };
      }
    throw new Error(`name ${spec.name} not found`);
  }
  return null; // building 위치는 건물을 다 읽은 뒤에 정한다
}

// ── 투영 ──────────────────────────────────────────────
const origin = config.origin
  ? locate(config.origin)
  : bounds
    ? { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }
    : { lat: 0, lng: 0 };
const kz = R * RAD,
  kx = kz * Math.cos(origin.lat * RAD);
const proj = (p) => [(p.lng - origin.lng) * kx, -(p.lat - origin.lat) * kz];
const coordsOf = (refs) => refs.map((r) => nodes.get(r)).filter(Boolean);

// ── 분류 ──────────────────────────────────────────────
const ROAD = {
  motorway: 20, trunk: 18, primary: 16, secondary: 14, tertiary: 12,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 8, tertiary_link: 8,
  residential: 8, unclassified: 8, living_street: 7, road: 7, service: 5,
  pedestrian: 5, footway: 3, path: 2.5, cycleway: 3, track: 3, bridleway: 2.5, steps: 2.5,
};
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link",
  "trunk_link", "primary_link", "secondary_link", "tertiary_link", "residential", "unclassified",
  "living_street", "road"]);
const STREAM = { river: 8, canal: 4, stream: 2.2, ditch: 1.4, drain: 1.4 };
function areaKind(t) {
  if (t.natural === "water" || t.water || t.landuse === "reservoir" || t.landuse === "basin" ||
      (t.leisure === "swimming_pool" && t.indoor !== "yes")) return "water";
  if (t.landuse === "flowerbed") return "flower";
  if (t.leisure === "track") return "track";
  if (t.leisure === "pitch") return "pitch";
  if (t.natural === "wood" || t.landuse === "forest" || t.natural === "scrub") return "wood";
  if (["grass", "meadow", "village_green", "recreation_ground", "cemetery"].includes(t.landuse) ||
      ["park", "garden", "common", "playground"].includes(t.leisure) || t.natural === "grassland")
    return "grass";
  if (t.amenity === "parking" && t.parking !== "underground" && t.parking !== "multi-storey")
    return "parking";
  if ((t.highway === "pedestrian" && t.area === "yes") || t.place === "square" ||
      t["area:highway"] === "pedestrian") return "plaza";
  return null;
}
const skip = (t) => t.indoor === "yes" || t.tunnel === "yes" || t.tunnel === "culvert" ||
  t.location === "underground" || (t.level && parseFloat(t.level) < 0) ||
  t.highway === "corridor" || t.highway === "construction" || t.highway === "proposed";

// 높이(m)와, 그 값이 태그(높이·층수)에서 왔는지
function heightOf(t, areaM2) {
  const h = parseFloat(t.height ?? t["building:height"] ?? "");
  if (Number.isFinite(h) && h > 0) return { h, tagged: true };
  // 지붕만 있는 쉼터·공연장·매점은 낮게
  if (t.building === "roof" || t.leisure === "bandstand" || t.amenity === "shelter" || t.building === "kiosk")
    return { h: 4.5, tagged: false };
  const lv = levelsOf(t);
  if (lv) return { h: lv * 3.4 + 1, tagged: true };
  return { h: areaM2 < 60 ? 3.5 : areaM2 < 300 ? 7.5 : 13, tagged: false };
}
function levelsOf(t) {
  const lv = parseFloat(t["building:levels"] ?? "");
  return Number.isFinite(lv) && lv > 0 ? lv : 0;
}

// ── 기하 도구 ─────────────────────────────────────────
const area2 = (r) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
};
// 위에서 볼 때(동=+x, 북=-z) 반시계가 되게: x·(-z) 평면 넓이가 양수
const ccw = (r) => (area2(r.map(([x, z]) => [x, -z])) < 0 ? r.slice().reverse() : r);
const cw = (r) => ccw(r).slice().reverse();
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, c] = stack.pop();
    let best = -1, dmax = tol;
    const [ax, az] = pts[a], [cx, cz] = pts[c], L = Math.hypot(cx - ax, cz - az) || 1e-9;
    for (let i = a + 1; i < c; i++) {
      const d = Math.abs((cx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (cz - az)) / L;
      if (d > dmax) { dmax = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, c]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
const ring = (refs) => {
  const pts = coordsOf(refs).map(proj);
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  return pts;
};
// 꺾은선의 from~to 미터 구간을 왼쪽(+)·오른쪽(-)으로 offset 미터 옮긴 점들
function offsetPart(pts, offset, from = 0, to = Infinity, step = 0) {
  const out = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az) || 1e-9;
    // (nx, nz)는 진행 방향의 오른쪽(북쪽으로 갈 때 동쪽). offset > 0 이면 오른쪽으로 옮긴다.
    const nx = -(bz - az) / L, nz = (bx - ax) / L;
    const a = Math.max(from, s), c = Math.min(to, s + L);
    if (c > a) {
      if (step > 0) {
        for (let d = Math.ceil(a / step) * step; d <= c; d += step) {
          const t = (d - s) / L;
          out.push([ax + (bx - ax) * t + nx * offset, az + (bz - az) * t + nz * offset]);
        }
      } else {
        for (const d of [a, c]) {
          const t = (d - s) / L;
          out.push([ax + (bx - ax) * t + nx * offset, az + (bz - az) * t + nz * offset]);
        }
      }
    }
    s += L;
  }
  return out;
}
// 관계(multipolygon)의 바깥·안쪽 길을 이어 고리로 만든다
function assemble(memberWays) {
  const segs = memberWays.map((w) => w.refs.slice()).filter((r) => r.length > 1);
  const rings = [];
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (cur[0] !== cur.at(-1) && guard++ < 1000) {
      const i = segs.findIndex((s) => s[0] === cur.at(-1) || s.at(-1) === cur.at(-1));
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      cur = cur.concat((s[0] === cur.at(-1) ? s : s.slice().reverse()).slice(1));
    }
    if (cur[0] === cur.at(-1)) rings.push(cur);
  }
  return rings;
}
function centroid(r) {
  let x = 0, z = 0;
  for (const [a, c] of r) { x += a; z += c; }
  return [x / r.length, z / r.length];
}

// ── 굽기 ──────────────────────────────────────────────
const out = { buildings: [], roads: [], areas: [], streams: [], trees: [] };
const named = [];
const footprints = new Map(); // 건물 이름·OSM id → 단순화 전 윤곽(맞춤 상자용)
const buildingRings = []; // 건물 바깥 고리의 노드 id와 좌표(출입구 방향용)
const heightFix = config.heights ?? {},
  heightUsed = new Set(),
  styleFix = config.style ?? {},
  styleUsed = new Set();
const STYLE_M = new Set(["brick", "white", "glass", "bands"]);
// 설정 style: 확인한 재질·창 모양과, 한 방향 끝 모서리를 크게 굴리기
function applyStyle(item, o, id) {
  const st = styleFix[id];
  if (!st || typeof st !== "object") return;
  if (!STYLE_M.has(st.m)) throw new Error(`style ${id}: unknown m ${st.m}`);
  item.m = st.m;
  if (st.win) item.win = st.win;
  if (st.round) {
    const [cx, cz] = centroid(o), [tx, tz] = st.round.toward;
    let best = 0, bd = -Infinity;
    o.forEach(([x, z], i) => {
      const d = (x - cx) * tx + (z - cz) * tz;
      if (d > bd) { bd = d; best = i; }
    });
    item.rr = [best, st.round.r];
  }
  styleUsed.add(id);
}
function addPolygon(tags, outerRefsList, innerRefsList, id) {
  if (skip(tags)) return;
  for (const refs of outerRefsList) {
    const outer = ring(refs);
    if (outer.length < 3) continue;
    const holes = innerRefsList.map(ring).filter((h) => h.length >= 3).map(cw).map((h) => flat(simplify(h, 0.3)));
    const o = ccw(simplify(outer, tags.building ? 0.15 : 0.4));
    const a = Math.abs(area2(o));
    // 차도 위 주차 요금소는 덩어리로 그리면 길을 막아 보이니 뺀다
    if (tags.barrier === "toll_booth") continue;
    if (tags.building && tags.building !== "no" && !tags["building:part"]) {
      const est = heightOf(tags, a);
      const item = { id, p: flat(o), h: r1(est.h) };
      if (holes.length) item.holes = holes;
      if (tags.name) {
        item.name = tags.name;
        if (!footprints.has(tags.name)) footprints.set(tags.name, outer);
      }
      if (!footprints.has(id)) footprints.set(id, outer);
      item.t = tags.building;
      const lv = levelsOf(tags);
      if (lv) item.lv = lv;
      if (est.tagged) item.hs = 1;
      // 설정의 높이 근거(현장 사진·학교 자료)가 지도 태그·추정보다 앞선다
      const fix = heightFix[id];
      if (fix) {
        if (fix.levels) item.lv = fix.levels;
        if (fix.h) item.h = r1(fix.h);
        else if (fix.levels) item.h = r1(fix.levels * 3.4 + 1);
        item.hs = 1;
        heightUsed.add(id);
      }
      applyStyle(item, o, id);
      out.buildings.push(item);
      buildingRings.push({ refs, pts: outer });
    } else {
      const k = areaKind(tags);
      if (!k) continue;
      const item = { k, p: flat(o) };
      if (holes.length) item.holes = holes;
      if (k === "pitch" && tags.surface) item.surface = tags.surface;
      out.areas.push(item);
    }
    if (tags.name) named.push({ id, name: tags.name, tags, c: centroid(o), kind: "poly" });
  }
}

const usedAsMember = new Set();
for (const rel of relations) {
  if (rel.tags.type !== "multipolygon" && rel.tags.type !== "building") continue;
  const get = (role) => rel.members.filter((m) => m.type === "way" && m.role === role)
    .map((m) => ways.get(m.ref)).filter(Boolean);
  const outer = get("outer"), inner = get("inner");
  let tags = rel.tags;
  // 예전 방식: 태그가 바깥 길에만 붙은 경우
  if (!tags.building && !areaKind(tags) && outer.length === 1) tags = { ...outer[0].tags, ...tags };
  if (!tags.building && !areaKind(tags)) continue;
  outer.forEach((w) => usedAsMember.add(w.id));
  addPolygon(tags, assemble(outer), assemble(inner), "r" + rel.id);
}

const widths = config.roadWidth ?? {};
for (const w of ways.values()) {
  const t = w.tags;
  if (skip(t)) continue;
  const closed = w.refs.length > 3 && w.refs[0] === w.refs.at(-1);
  if (t.highway && ROAD[t.highway] && !(closed && t.area === "yes")) {
    const pts = simplify(coordsOf(w.refs).map(proj), 0.3);
    if (pts.length < 2) continue;
    let width = ROAD[t.highway];
    const lanes = parseFloat(t.lanes ?? "");
    if (CAR.has(t.highway) && Number.isFinite(lanes)) width = Math.max(width, lanes * 3.3 + 1);
    if (widths[w.id]) width = widths[w.id];
    const k = CAR.has(t.highway) || widths[w.id] >= 10 ? 0 : t.highway === "service" ? 1 : 2;
    out.roads.push({ k, w: width, p: flat(pts), refs: w.refs, foot: !CAR.has(t.highway) && t.highway !== "service" });
    if (t.name) named.push({ id: "w" + w.id, name: t.name, tags: t, c: centroid(pts), kind: "road" });
    continue;
  }
  if (t.waterway && STREAM[t.waterway] && !closed) {
    const pts = simplify(coordsOf(w.refs).map(proj), 0.3);
    if (pts.length >= 2) out.streams.push({ w: STREAM[t.waterway], p: flat(pts) });
    continue;
  }
  if (t.natural === "tree_row") {
    const pts = coordsOf(w.refs).map(proj);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 7) out.trees.push(r1(ax + ((bx - ax) * s) / L), r1(az + ((bz - az) * s) / L));
    }
    continue;
  }
  if (closed && !usedAsMember.has(w.id) && (t.building || areaKind(t) || (t.highway === "pedestrian" && t.area === "yes")))
    addPolygon(t, [w.refs], [], "w" + w.id);
  else if (t.name && (t.junction === "roundabout" || t.historic || t.tourism || t.amenity))
    named.push({ id: "w" + w.id, name: t.name, tags: t, c: centroid(coordsOf(w.refs).map(proj)), kind: "way" });
}
for (const [id, n] of nodes) {
  if (n.tags.natural === "tree") out.trees.push(...proj(n).map(r1));
  if (n.tags.name || n.tags.barrier || n.tags.entrance) named.push({ id: "n" + id, name: n.tags.name ?? "", tags: n.tags, c: proj(n), kind: "node" });
}

// 이름 붙은 지물 목록은 기준점을 고를 때만 본다(저장소 밖 경로로만 쓴다)
if (process.env.MAP_DEBUG)
  fs.writeFileSync(process.env.MAP_DEBUG, JSON.stringify({ origin, named: named.map(({ id, name, c, kind, tags }) => ({ id, name, kind, c: c.map((v) => Math.round(v)), tags })) }, null, 1));
console.log(`buildings ${out.buildings.length}, roads ${out.roads.length}, areas ${out.areas.length}, streams ${out.streams.length}, trees ${out.trees.length / 2}`);

for (const id of Object.keys(heightFix))
  if (!id.startsWith("_") && !heightUsed.has(id)) console.warn(`heights: building ${id} not found`);
for (const id of Object.keys(styleFix))
  if (!id.startsWith("_") && !styleUsed.has(id)) console.warn(`style: building ${id} not found`);

// 캠퍼스 경계: 건물을 캠퍼스(크림 콘크리트)와 동네(파스텔 주택·상가)로 가른다
let campus = null;
if (config.campus?.way) {
  const w = ways.get(String(config.campus.way));
  if (!w) throw new Error(`campus way ${config.campus.way} not found`);
  campus = flat(ccw(simplify(ring(w.refs), config.campus.tol ?? 2)));
}

// ── 맞춤 상자: 건물 윤곽의 주축(가로)·폭과, 정면(faces 쪽 긴 변)의 방향 ──
// name은 건물 이름 또는 OSM id(w…/r…)
function fitBox(name, faces) {
  const o = footprints.get(name);
  if (!o) throw new Error(`building ${name} not found`);
  const [mx, mz] = centroid(o);
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of o) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  let w0 = Infinity, w1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const [x, z] of o) {
    const a = (x - mx) * ux + (z - mz) * uz, c = -(x - mx) * uz + (z - mz) * ux;
    w0 = Math.min(w0, a); w1 = Math.max(w1, a); d0 = Math.min(d0, c); d1 = Math.max(d1, c);
  }
  const cx = mx + ux * ((w0 + w1) / 2) - uz * ((d0 + d1) / 2),
    cz = mz + uz * ((w0 + w1) / 2) + ux * ((d0 + d1) / 2);
  let fx = -uz, fz = ux;
  if (faces && (faces[0] - cx) * fx + (faces[1] - cz) * fz < 0) { fx = -fx; fz = -fz; }
  // a: 모형의 정면(+z)이 (fx, fz)를 보게 하는 y축 회전
  return { c: [r1(cx), r1(cz)], w: r1(w1 - w0), d: r1(d1 - d0), a: Math.round(Math.atan2(fx, fz) * 1000) / 1000, f: [fx, fz] };
}

// ── 기준점·맞춤 상자·도보 경로 ───────────────────────
const anchors = {};
const specs = Object.entries(config.anchors ?? {});
for (const [key, spec] of specs) {
  const p = locate(spec);
  if (p) anchors[key] = proj(p);
}
const boxes = {};
for (const [key, spec] of Object.entries(config.boxes ?? {})) {
  // "건물 이름"이면 정면은 같은 이름 anchors의 faces를, {id, faces}면 제 faces를 본다
  const name = typeof spec === "string" ? spec : (spec.id ?? spec.name),
    faces = typeof spec === "string" ? specs.find(([k]) => k === key)?.[1]?.faces : spec.faces;
  boxes[key] = fitBox(name, faces ? anchors[faces] : null);
}
for (const [key, spec] of specs) {
  if (!spec.building) continue;
  const box = fitBox(spec.building, anchors[spec.faces]);
  const gap = box.d / 2 + (spec.gap ?? 10);
  anchors[key] = [box.c[0] + box.f[0] * gap, box.c[1] + box.f[1] * gap];
}

// 걷는 사람은 보행로를 좋아한다: 차도는 1.4배 멀게 친다
const graph = new Map();
const link = (a, b2, d) => {
  if (!graph.has(a)) graph.set(a, []);
  graph.get(a).push([b2, d]);
};
for (const r of out.roads) {
  const cost = r.foot ? 1 : 1.4;
  for (let i = 1; i < r.refs.length; i++) {
    const a = nodes.get(r.refs[i - 1]), c = nodes.get(r.refs[i]);
    if (!a || !c) continue;
    const [ax, az] = proj(a), [cx, cz] = proj(c), d = Math.hypot(cx - ax, cz - az) * cost;
    link(r.refs[i - 1], r.refs[i], d);
    link(r.refs[i], r.refs[i - 1], d);
  }
}
// 기준점을 가장 가까운 길 위로 내려 임시 마디로 잇는다(마디 사이가 먼 큰길에서도 길 위에서 출발)
const edges = [];
for (const [u, list] of graph) for (const [v, w] of list) if (u < v) edges.push([u, v, w]);
let tmpId = 0;
function attach([x, z]) {
  let best = null, bd = Infinity;
  for (const [u, v, w] of edges) {
    const [ax, az] = proj(nodes.get(u)), [bx, bz] = proj(nodes.get(v));
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
    const qx = ax + (bx - ax) * t, qz = az + (bz - az) * t, d = Math.hypot(qx - x, qz - z);
    if (d < bd) { bd = d; best = { u, v, w, t, q: [qx, qz] }; }
  }
  const id = `tmp${tmpId++}`;
  link(id, best.u, best.w * best.t);
  link(best.u, id, best.w * best.t);
  link(id, best.v, best.w * (1 - best.t));
  link(best.v, id, best.w * (1 - best.t));
  tmpPos.set(id, best.q);
  return id;
}
const tmpPos = new Map();
const posOf = (id) => tmpPos.get(id) ?? proj(nodes.get(id));
function route(a, c) {
  const s = attach(a), t = attach(c);
  const dist = new Map([[s, 0]]), prev = new Map(), done = new Set();
  const queue = [[0, s]];
  while (queue.length) {
    queue.sort((p, q) => p[0] - q[0]);
    const [d, u] = queue.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === t) break;
    for (const [v, w] of graph.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); queue.push([nd, v]); }
    }
  }
  if (!done.has(t)) {
    console.warn("route: no walkable connection, using a straight line");
    return flat([a, c]);
  }
  const path = [];
  for (let u = t; u; u = prev.get(u)) path.unshift(posOf(u));
  return flat(simplify([a, ...path, c], 0.5));
}
// 경로는 [출발, (거쳐 갈 곳…), 도착]
const legs = [];
for (const names of config.legs ?? []) {
  if (!names.every((n) => anchors[n])) {
    console.warn(`leg ${names.join(" → ")}: missing anchor`);
    continue;
  }
  const parts = [];
  for (let i = 1; i < names.length; i++) {
    const r = route(anchors[names[i - 1]], anchors[names[i]]);
    parts.push(...(i > 1 ? r.slice(2) : r));
  }
  legs.push(parts);
}

// ── 지도에 없는 물길과 가로수 줄 ─────────────────────
const wayPts = (id, reverse) => {
  const w = ways.get(String(id));
  if (!w) throw new Error(`way ${id} not found`);
  const pts = coordsOf(w.refs).map(proj);
  return reverse ? pts.reverse() : pts;
};
for (const c of config.channels ?? []) {
  const pts = offsetPart(wayPts(c.way, c.reverse), c.offset ?? 0, c.from, c.to);
  if (pts.length >= 2) out.streams.push({ w: c.w ?? 1.4, p: flat(simplify(pts, 0.2)) });
}
const rows = [];
for (const a of config.avenues ?? []) {
  const pts = wayPts(a.way, a.reverse);
  for (const side of [-1, 1])
    for (const p of offsetPart(pts, side * (a.offset ?? 9), a.from, a.to, a.step ?? 8)) rows.push(p);
}
// 가로수 줄과 겹치는 지도 나무는 뺀다
if (rows.length) {
  const kept = [];
  for (let i = 0; i < out.trees.length; i += 2) {
    const x = out.trees[i], z = out.trees[i + 1];
    if (!rows.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 6)) kept.push(x, z);
  }
  out.trees = kept;
}

// ── 거리 소품 자리(벤치·거치대·쉼터·정류장·휴지통·출입구·차도 횡단보도) ──
// 모형을 바로 세울 수 있게 방향 a(모형 +z가 볼 쪽의 y축 회전)를 함께 굽는다.
const bearing = (dx, dz) => Math.round(Math.atan2(dx, dz) * 100) / 100;
const insideRing = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
// 고리(닫힌 길)나 꺾은선의 노드 refs[i] 앞뒤로 본 진행 방향
function tangentAt(refs, i) {
  const closed = refs.length > 2 && refs[0] === refs.at(-1);
  const prev = i > 0 ? refs[i - 1] : closed ? refs.at(-2) : refs[i],
    next = i < refs.length - 1 ? refs[i + 1] : closed ? refs[1] : refs[i];
  const a = nodes.get(prev), c = nodes.get(next);
  if (!a || !c) return null;
  const [ax, az] = proj(a), [cx, cz] = proj(c);
  return Math.hypot(cx - ax, cz - az) > 1e-6 ? [cx - ax, cz - az] : null;
}
// 점에서 가장 가까운 길 위 지점(roads 중에서)
function nearestOn(roads, x, z) {
  let best = null, bd = Infinity;
  for (const r of roads)
    for (let i = 2; i < r.p.length; i += 2) {
      const ax = r.p[i - 2], az = r.p[i - 1], dx = r.p[i] - ax, dz = r.p[i + 1] - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - x, qz - z);
      if (d < bd) { bd = d; best = { q: [qx, qz], dir: [dx, dz], d }; }
    }
  return best;
}
// 길을 바라보는 방향. 길 위에 있으면 길을 가로지르는 방향
function faceRoad(roads, x, z) {
  const n = nearestOn(roads, x, z);
  if (!n) return 0;
  return n.d > 0.3 ? bearing(n.q[0] - x, n.q[1] - z) : bearing(-n.dir[1], n.dir[0]);
}
const carRoads = out.roads.filter((r) => r.k === 0);
const carNodes = new Map(); // 차도 노드 id → [refs, 순번]
for (const r of carRoads) r.refs.forEach((id, i) => { if (!carNodes.has(id)) carNodes.set(id, [r.refs, i]); });
const ringOfNode = new Map(); // 건물 고리 노드 id → [고리, 순번]
for (const g of buildingRings) g.refs.forEach((id, i) => { if (!ringOfNode.has(id)) ringOfNode.set(id, [g, i]); });
const AMENITY_POI = new Set(["bench", "bicycle_parking", "shelter", "waste_basket"]);
const pois = [],
  stopOnRoad = new Set();
for (const [id, n] of nodes) {
  const t = n.tags;
  let k = null;
  if (AMENITY_POI.has(t.amenity)) k = t.amenity;
  // 정류장은 사람이 기다리는 자리(platform·bus_stop)만. 차가 서는 stop_position은 길 위라 뺀다
  else if (t.highway === "bus_stop" || (t.public_transport === "platform" && t.bus === "yes")) k = "bus_stop";
  else if (t.entrance) k = "entrance";
  else if (t.highway === "crossing" && carNodes.has(id)) k = "crossing";
  if (!k || skip(t)) continue;
  const [x, z] = proj(n);
  let a = null;
  if (k === "crossing") {
    const [refs, i] = carNodes.get(id), d = tangentAt(refs, i);
    if (d) a = bearing(d[0], d[1]);
  } else if (k === "entrance" && ringOfNode.has(id)) {
    // 벽을 따라가는 방향에 수직인 두 쪽 가운데 건물 밖을 본다
    const [g, i] = ringOfNode.get(id), d = tangentAt(g.refs, i);
    if (d) {
      const L = Math.hypot(d[0], d[1]);
      let nx = d[1] / L, nz = -d[0] / L;
      if (insideRing(g.pts, x + nx * 0.3, z + nz * 0.3)) { nx = -nx; nz = -nz; }
      a = bearing(nx, nz);
    }
  }
  if (a === null) a = faceRoad(k === "bus_stop" && carRoads.length ? carRoads : out.roads, x, z);
  const poi = { k, x: r1(x), z: r1(z), a };
  if (k === "bus_stop" && t.public_transport !== "platform") stopOnRoad.add(poi);
  pois.push(poi);
}
// 한 정류장을 기다리는 자리와 차가 서는 자리로 두 번 그린 경우: 기다리는 자리만 남긴다
for (let i = pois.length - 1; i >= 0; i--) {
  const p = pois[i];
  if (stopOnRoad.has(p) &&
      pois.some((q) => q.k === "bus_stop" && !stopOnRoad.has(q) && Math.hypot(q.x - p.x, q.z - p.z) < 8))
    pois.splice(i, 1);
}
const poiCount = {};
for (const p of pois) poiCount[p.k] = (poiCount[p.k] ?? 0) + 1;
console.log(`pois ${JSON.stringify(poiCount)}`);

for (const r of out.roads) { delete r.refs; delete r.foot; }
const result = {
  credit: "© OpenStreetMap contributors",
  // 오픈스트리트맵에서 만든 파생 자료라 같은 ODbL 1.0을 따른다
  license: "ODbL-1.0 https://www.openstreetmap.org/copyright",
  origin: { lat: Math.round(origin.lat * 1e7) / 1e7, lng: Math.round(origin.lng * 1e7) / 1e7 },
  anchors: Object.fromEntries(Object.entries(anchors).map(([k, [x, z]]) => [k, [r1(x), r1(z)]])),
  boxes: Object.fromEntries(Object.entries(boxes).map(([k, { f, ...rest }]) => (void f, [k, rest]))),
  legs,
  rows: flat(rows),
  ...out,
  pois,
  ...(campus ? { campus } : {}),
};
fs.writeFileSync(output, JSON.stringify(result));
console.log(
  `wrote ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB), legs ${legs.map((l) => l.length / 2).join("/")} pts, ` +
    `anchors ${JSON.stringify(result.anchors)}, boxes ${JSON.stringify(result.boxes)}`,
);
