"use client";

import Image from "next/image";
import { useState } from "react";
import type { Role, RoleMission } from "@/supabase/functions/_shared/types";
import styles from "./mission-asset.module.css";

const PLACEHOLDER = "/images/course-material-placeholder.svg";

function isPlaceholder(url: string) {
  try {
    return new URL(url, "https://placeholder.invalid").pathname === PLACEHOLDER;
  } catch {
    return false;
  }
}

function MaterialImage({ asset }: { asset?: RoleMission["asset"] }) {
  const [failed, setFailed] = useState(false);
  const url = asset?.url?.trim();
  const temporary = failed || !url || isPlaceholder(url);

  return (
    <figure className={styles.figure} data-testid="mission-asset" data-temporary={temporary}>
      <Image
        className={styles.image}
        src={temporary ? PLACEHOLDER : url}
        alt={temporary ? "임시 이미지 · 실제 현장 자료 아님" : asset?.alt ?? "조사 사진 자료"}
        width={720}
        height={420}
        unoptimized
        loading="eager"
        onError={() => { if (!temporary) setFailed(true); }}
      />
      <figcaption className={styles.caption}>
        {temporary ? <>
          <strong>임시 이미지 · 실제 현장 자료 아님</strong>
          <span>{failed ? "사진을 불러오지 못해 임시 이미지를 표시합니다." : "사진 자료가 준비되면 교체됩니다."}</span>
        </> : <span>{asset?.alt}</span>}
      </figcaption>
    </figure>
  );
}

/** The server supplies only this role's asset; known observation roles also show missing material. */
export function MissionAsset({ asset, stageId, role }: {
  asset?: RoleMission["asset"];
  stageId: string;
  role: Role;
}) {
  if (!asset && !(role === "scout" && (stageId === "gate" || stageId === "yongbong"))) return null;
  return <MaterialImage key={`${stageId}:${role}:${asset?.url ?? ""}`} asset={asset} />;
}
