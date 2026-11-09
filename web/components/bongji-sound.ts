import { isAudioForeground, subscribeAudioFocus } from "@/lib/audio-focus";
import { acquireBgmSilence, getAudioMix, isMuted, subscribeMuted } from "@/lib/sound";
import { isWebKitAudio } from "@/lib/sound-files";
import { PLAZA_MUSIC, phraseOffset, type PlazaZone } from "./bongji-music";
export const PLAZA_SOUNDS = {
 pond:{mp3:`${PLAZA_MUSIC.pond.file}.mp3`,wav:`${PLAZA_MUSIC.pond.file}.wav`},
 statue:{mp3:`${PLAZA_MUSIC.statue.file}.mp3`,wav:`${PLAZA_MUSIC.statue.file}.wav`},
 boat:{mp3:"hoguk-bongji-boat.mp3"},page:{mp3:"hoguk-bongji-page.mp3"},shutter:{mp3:"hoguk-bongji-shutter.mp3"},
} as const;
export type PlazaSound=keyof typeof PLAZA_SOUNDS;
export function createPlazaAudio(){
 const Ctx=typeof window!=="undefined"?window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext:undefined;
 if(!Ctx)return null;
 let ctx:AudioContext;try{ctx=new Ctx();}catch{return null;}
 const releaseBgm=acquireBgmSilence(),master=ctx.createGain(),music=ctx.createGain(),sfx=ctx.createGain();
 music.connect(master);sfx.connect(master);master.connect(ctx.destination);
 let covered=false,hushed=false,closed=false,failed=false;
 let wanted:PlazaZone="pond",pending:PlazaZone|null=null,request=0;
 type Loop={src:AudioBufferSourceNode;gain:GainNode;zone:PlazaZone;at:number;offset:number};
 let current:Loop|null=null;
 const playing=new Set<AudioBufferSourceNode>();
 const updateMix=()=>{const mix=getAudioMix();master.gain.setTargetAtTime(isMuted()||covered||!isAudioForeground()?0:1,ctx.currentTime,.08);music.gain.setTargetAtTime(mix.music*.8*(hushed?.4:1),ctx.currentTime,.25);sfx.gain.setTargetAtTime(mix.effects,ctx.currentTime,.08);};
 master.gain.value=isMuted()||!isAudioForeground()?0:1;music.gain.value=getAudioMix().music*.8;sfx.gain.value=getAudioMix().effects;
 const unsub=subscribeMuted(updateMix),buffers=new Map<PlazaSound,Promise<AudioBuffer|null>>();
 const load=(name:PlazaSound)=>{
  let promise=buffers.get(name);
  if(!promise){const f=PLAZA_SOUNDS[name] as {mp3:string;wav?:string},file=isWebKitAudio(navigator.userAgent)&&f.wav?f.wav:f.mp3;
   promise=fetch(`/sound/${file}`).then(r=>r.ok?r.arrayBuffer():Promise.reject()).then(b=>new Promise<AudioBuffer>((resolve,reject)=>ctx.decodeAudioData(b,resolve,reject))).catch(()=>{buffers.delete(name);return null;});buffers.set(name,promise);
  }return promise;
 };
 const resume=()=>{if(!closed&&ctx.state==="suspended"&&!isMuted()&&!covered&&isAudioForeground())void ctx.resume().catch(()=>undefined);};
 const setZone=(zone:PlazaZone)=>{
  if(closed)return;wanted=zone;resume();
  if(pending===zone||(!pending&&current?.zone===zone))return;
  const token=++request;pending=zone;
  if(current?.zone===zone){pending=null;return;}
  void load(zone).then(buf=>{
   if(closed||token!==request||wanted!==zone)return;
   pending=null;failed=!buf;if(!buf)return;
   const old=current,now=ctx.currentTime,at=now+(old?.24:.02);
   const offset=old?phraseOffset(old.offset,at-old.at,PLAZA_MUSIC[old.zone].seconds,PLAZA_MUSIC[zone].seconds):0;
   // Fade through silence: the next arrangement starts only after the old one stops.
   if(old){old.gain.gain.cancelScheduledValues(now);old.gain.gain.setValueAtTime(old.at>now?0:old.gain.gain.value,now);old.gain.gain.linearRampToValueAtTime(0,at);old.src.stop(at);}
   const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buf;src.loop=true;src.loopEnd=Math.min(buf.duration,PLAZA_MUSIC[zone].seconds);
   gain.gain.value=0;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(1,at+.45);src.connect(gain).connect(music);
   playing.add(src);src.onended=()=>{playing.delete(src);src.disconnect();gain.disconnect();};src.start(at,offset);current={src,gain,zone,at,offset};
  });
 };
 const releaseFocus=subscribeAudioFocus(()=>{updateMix();if(!isAudioForeground())void ctx.suspend().catch(()=>undefined);else resume();});
 const enter=()=>{setZone(wanted);void load("statue");};
 window.addEventListener("pointerdown",enter,{capture:true});window.addEventListener("keydown",enter,{capture:true});
 return {
  enter,setZone,get ready(){return !!current;},get failed(){return failed;},get zone(){return current?.zone??"pond";},
  get beat(){if(!current||ctx.state!=="running"||isMuted())return performance.now()/(60000/PLAZA_MUSIC[wanted].bpm);const song=PLAZA_MUSIC[current.zone];return (Math.max(0,ctx.currentTime-current.at)+current.offset-song.beatOffset)/(60/song.bpm);},
  get phase(){return (this.beat%1+1)%1;},
  play(name:Exclude<PlazaSound,PlazaZone>,level=1){
   if(closed||covered||isMuted())return;resume();const requestedAt=performance.now();
   void load(name).then(buf=>{if(!buf||closed||covered||isMuted()||performance.now()-requestedAt>700)return;const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buf;gain.gain.value=level;src.connect(gain).connect(sfx);playing.add(src);src.onended=()=>{playing.delete(src);src.disconnect();gain.disconnect();};src.start();});
  },
  hush(on:boolean){hushed=on;updateMix();},cover(on:boolean){covered=on;updateMix();if(!on)resume();},
  dispose(){if(closed)return;closed=true;request++;unsub();releaseFocus();window.removeEventListener("pointerdown",enter,{capture:true});window.removeEventListener("keydown",enter,{capture:true});master.gain.cancelScheduledValues(ctx.currentTime);master.gain.value=0;for(const src of playing){try{src.stop();}catch{}}playing.clear();current=null;void ctx.close().catch(()=>undefined);releaseBgm();},
 };
}
export type PlazaAudio=NonNullable<ReturnType<typeof createPlazaAudio>>;
