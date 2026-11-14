import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
// 장병 모형(public/models/soldier.glb)을 노드에서 읽는다. 무늬 그림은 노드에서 읽을 수 없어 빼고
// 뼈대와 동작만 읽는다.
export async function loadSoldier(): Promise<GLTF> {
  const buf = readFileSync(join(__dirname, "..", "..", "public", "models", "soldier.glb"));
  const len = buf.readUInt32LE(12);
  const j = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  delete j.textures;
  delete j.images;
  delete j.samplers;
  for (const m of j.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
  }
  let json = Buffer.from(JSON.stringify(j));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const rest = buf.subarray(20 + len),
    head = Buffer.alloc(20);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.write("JSON", 16);
  const glb = Buffer.concat([head, json, rest]);
  return new Promise((res, rej) =>
    new GLTFLoader().parse(
      glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length),
      "",
      res,
      rej,
    ),
  );
}

