import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/dev/photo-verify/route';
const req = (headers: Record<string,string> = {}, body: Uint8Array<ArrayBuffer> = new Uint8Array([1,2,3])) => new NextRequest('https://localhost:3022/api/dev/photo-verify?site_id=gate', {
 method: 'POST', headers: {origin:'https://localhost:3022',host:'localhost:3022','content-type':'image/jpeg',cookie:'hoguk_session=12345678-1234-1234-1234-123456789abc',...headers}, body,
});
beforeEach(()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('VERCEL','');vi.stubEnv('NEXT_PUBLIC_BACKEND','local');vi.stubEnv('PV_URL','http://127.0.0.1:8077');vi.stubEnv('PV_API_KEY','test-private-key');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('local photo proxy',()=>{
 it.each([[true,'MATCH'],[false,'NO_MATCH'],[false,'RETAKE']])('forwards only the verdict %s %s',async(match,reason_code)=>{
  const fetcher=vi.fn(async()=>Response.json({match,reason_code,score:.99,latency_ms:90,private:'hidden'}));vi.stubGlobal('fetch',fetcher);
  const response=await POST(req());expect(response.status).toBe(200);expect(await response.json()).toEqual({match,reason_code});
  expect(fetcher.mock.calls.length).toBe(1);expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('does not call a model for cross-origin or unauthenticated requests',async()=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);expect((await POST(req({origin:'https://other.test'}))).status).toBe(403);
  expect((await POST(req({cookie:''}))).status).toBe(401);expect(f).not.toHaveBeenCalled();
 });
 it('rejects oversize uploads without relying on content-length',async()=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);expect((await POST(req({},new Uint8Array(2*1024*1024+1)))).status).toBe(400);expect(f).not.toHaveBeenCalled();
 });
 it('fails closed when unavailable or a response contradicts itself',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({match:true,reason_code:'NO_MATCH'})));
  expect((await POST(req())).status).toBe(503);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('private error');}));
  expect(await (await POST(req())).json()).toEqual({error:'UNAVAILABLE'});
  vi.stubEnv('PV_API_KEY','');expect((await POST(req())).status).toBe(503);
 });
 it('is disabled in production and hosted environments',async()=>{
  vi.stubEnv('NODE_ENV','production');expect((await POST(req())).status).toBe(404);
  vi.stubEnv('NODE_ENV','development');vi.stubEnv('VERCEL','1');expect((await POST(req())).status).toBe(404);
 });
});
