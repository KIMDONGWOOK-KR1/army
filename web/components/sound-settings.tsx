"use client";
import { useSyncExternalStore } from "react";
import { Music2, Volume2 } from "lucide-react";
import { getAudioMix, getServerAudioMix, isMuted, play, setAudioMix, subscribeMuted, unlock } from "@/lib/sound";
import { MIX_PRESETS } from "@/lib/audio-mix";
import { SoundToggle } from "./sound-toggle";
import styles from "./final-polish.module.css";

export function SoundSettings() {
  const mix = useSyncExternalStore(subscribeMuted, getAudioMix, getServerAudioMix);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return <section className={styles.sound} aria-label="소리 설정" data-sound="none">
    <div className={styles.sectionHeading}><h3>나에게 맞는 소리</h3><span>이 기기에 저장돼요</span></div>
    <div className={styles.presets} role="group" aria-label="소리 프리셋">
      {([['balanced', '기본'], ['focus', '집중'], ['effects', '효과음만']] as const).map(([key, label]) => <button type="button" key={key}
        aria-pressed={mix.music === MIX_PRESETS[key].music && mix.effects === MIX_PRESETS[key].effects}
        onClick={() => { unlock(); setAudioMix(MIX_PRESETS[key]); }}>{label}</button>)}
    </div>
    {([['music', '배경음', Music2], ['effects', '효과음', Volume2]] as const).map(([key, label, Icon]) => <label key={key} className={styles.volume}>
      <span><Icon size={17} aria-hidden="true" />{label}<output aria-live="off">{Math.round(mix[key] * 100)}%</output></span>
      <input type="range" min="0" max="100" step="5" aria-label={`${label} 음량`} aria-valuetext={`${Math.round(mix[key] * 100)}%`} value={Math.round(mix[key] * 100)}
        onChange={(e) => { unlock(); setAudioMix({ [key]: Number(e.target.value) / 100 }); }} />
    </label>)}
    <div className={styles.soundActions}><button type="button" className="button secondary" disabled={muted || mix.effects === 0}
      onClick={() => { unlock(); play('confirm'); }}>효과음 들어보기</button><SoundToggle variant="menu" /></div>
    <p className={styles.note} role="status">{muted ? '전체 소리가 꺼져 있어요. 설정은 저장되고, 소리를 켜면 적용돼요.' : '추모 장면에서는 음악이 잦아들어요. 소리 없이도 모든 안내를 읽을 수 있어요.'}</p>
  </section>;
}
