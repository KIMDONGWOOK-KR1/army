import { expect, it } from 'vitest';
import { facePoint } from '../components/soldier-face';
import { HOME_VARIANTS, soldierVariant } from '../components/soldier-variants';
it('keeps uniforms and rear silhouette stable while differentiating facial features',()=>{
  for(let f=0;f<4;f++) {
    for(const point of [[.2,.2,.1],[0,.8,-.3]] as [number,number,number][]) {
      facePoint(...point,f).forEach((v,i)=>expect(Math.abs(v-point[i])).toBeLessThan(.0001));
    }
    for(const point of [[.09,.625,.15],[.04,.527,.15],[.16,.55,.15]] as [number,number,number][]) {
      facePoint(...point,f).forEach((v,i)=>expect(Math.abs(v-point[i])).toBeLessThan(.04));
    }
  }
  expect(new Set(Object.values(HOME_VARIANTS).map(v=>v.face)).size).toBe(4);
  expect(new Set([0,1,2,3].map(f=>JSON.stringify(facePoint(.04,.527,.15,f)))).size).toBe(4);
  expect(soldierVariant('same-person').face).toBe(soldierVariant('same-person').face);
});
