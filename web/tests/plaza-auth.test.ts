import { expect,it,vi } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullTeam } from "./helpers/full-v2";
import { sha256 } from "../supabase/functions/_shared/engine";
it("authorizes the stored team member in Bongji without writing progress",async()=>{
 const t=await fullTeam();await t.arrive();await t.wallComplete();await t.depart();await t.arrive();
 const session=crypto.randomUUID();t.game.members[0].userId=await sha256(session);t.game.expiresAt=Date.now()+60000;
 const folder=await mkdtemp(join(tmpdir(),"plaza-auth-"));
 const previous=process.env.LOCAL_GAME_DATA_DIR;process.env.LOCAL_GAME_DATA_DIR=folder;
 const raw=JSON.stringify({games:{[t.game.id]:t.game},courses:{[t.course.id]:t.course},sessions:{},creates:{},failures:{}});
 await writeFile(join(folder,"state.json"),raw);vi.resetModules();
 try{
  const {localPlazaIdentity}=await import("../lib/server/store");
  expect(await localPlazaIdentity(session,t.game.id)).toEqual({game:t.game.id,member:t.game.members[0].id});
  await expect(localPlazaIdentity(crypto.randomUUID(),t.game.id)).rejects.toThrow("FORBIDDEN");
  await expect(localPlazaIdentity(session,t.game.id,1)).rejects.toThrow("FORBIDDEN");
  await expect(localPlazaIdentity(session,"another-team")).rejects.toThrow("FORBIDDEN");
  const {readFile}=await import("node:fs/promises");expect(await readFile(join(folder,"state.json"),"utf8")).toBe(raw);
 }finally{if(previous===undefined)delete process.env.LOCAL_GAME_DATA_DIR;else process.env.LOCAL_GAME_DATA_DIR=previous;await rm(folder,{recursive:true,force:true});}
});
