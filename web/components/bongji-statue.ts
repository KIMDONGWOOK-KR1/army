import * as THREE from "three";

export const STATUE = { offset: { x: 19, z: 5 }, body: 3.8, enter: 9, leave: 12, height: 14 };
export function statueNearby(distance: number, alreadyNear: boolean) {
  return distance <= (alreadyNear ? STATUE.leave : STATUE.enter);
}

/** User-provided photographs: rounded plinth, rising pale stone, folded asymmetric lobes.
 * A lightweight interpretation, not a measured scan or an attribution of its historical meaning. */
export function createBongjiStatue() {
  const group = new THREE.Group();
  group.name = "bongji-stone-sculpture";
  const stone = new THREE.MeshStandardMaterial({ color: "#ded6c3", roughness: .96, vertexColors: true });
  const colors = new THREE.Color();
  const positions: number[] = [], shades: number[] = [], indices: number[] = [];
  const rows = 64, cols = 40;
  for (let row=0; row<=rows; row++) {
    const t=row/rows, y=2.1+t*11.2;
    const taper=Math.pow(Math.sin(Math.PI*(.13+.84*t)),.62);
    for (let col=0; col<=cols; col++) {
      const a=col/cols*Math.PI*2;
      const fold = Math.pow(Math.max(0, Math.cos(3*a-t*12)), 2);
      const lobe = .5+.5*Math.sin(t*29+a*1.4);
      const radius=(1.18+2.7*fold*lobe+.48*Math.cos(a*2+t*18))*taper;
      positions.push(Math.cos(a)*radius+Math.sin(t*6)*.72, y, Math.sin(a)*radius+Math.sin(t*4)*.38);
      const shade=.94+.055*Math.sin(row*31+col*17);
      colors.setRGB(shade,shade*.98,shade*.93);
      shades.push(colors.r,colors.g,colors.b);
      if(row<rows&&col<cols) {
        const i=row*(cols+1)+col;
        indices.push(i,i+cols+1,i+1,i+1,i+cols+1,i+cols+2);
      }
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute("color",new THREE.Float32BufferAttribute(shades,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  const sculpture=new THREE.Mesh(geo,stone);
  sculpture.castShadow=true;sculpture.receiveShadow=true;
  group.add(sculpture);
  const plain=new THREE.MeshStandardMaterial({ color:"#cfc4ab",roughness:.98 });
  const base=new THREE.Mesh(new THREE.SphereGeometry(1,40,16,0,Math.PI*2,0,Math.PI/2),plain);
  base.scale.set(4.2,2.5,3.5);base.position.y=.08;base.castShadow=true;base.receiveShadow=true;group.add(base);
  // Short, angled crown rather than a flat cylinder cap.
  for(let i=0;i<3;i++) {
    const crown=new THREE.Mesh(new THREE.DodecahedronGeometry(1.2,0),plain);
    crown.scale.set(.68,1.2,.62);crown.position.set((i-1)*.65,12.7+i*.3,-.12+i*.15);
    crown.rotation.z=(i-1)*.28;crown.castShadow=true;group.add(crown);
  }
  const rings: THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>[]=[];
  for(let i=0;i<3;i++) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(4.8+i*1.8,4.92+i*1.8,72).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:["#d7ad58","#82bba8","#b9a9df"][i],transparent:true,opacity:.2,depthWrite:false}));
    ring.position.y=.12+i*.01;group.add(ring);rings.push(ring);
  }
  const dots: THREE.Mesh<THREE.SphereGeometry,THREE.MeshStandardMaterial>[]=[];
  for(let i=0;i<12;i++) {
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),new THREE.MeshStandardMaterial({color:"#d4ad5e",emissive:"#ffd78c",emissiveIntensity:.05,roughness:.8}));
    const a=i/12*Math.PI*2;dot.position.set(Math.cos(a)*5,.25,Math.sin(a)*5);group.add(dot);dots.push(dot);
  }
  return {
    group,
    update(on: boolean, phase: number, reduced: boolean) {
      rings.forEach((ring,i)=>{
        ring.material.opacity=on ? (reduced?.35:.2+.18*(.5+.5*Math.cos((phase-i/3)*Math.PI*2))) : .14;
        ring.scale.setScalar(on&&!reduced?1+.025*Math.sin((phase-i/3)*Math.PI*2):1);
      });
      dots.forEach((dot,i)=>{dot.material.emissiveIntensity=on?(reduced?.3:.2+.5*Math.max(0,Math.sin(phase*Math.PI*2-i*.5))):.05;});
    },
  };
}
