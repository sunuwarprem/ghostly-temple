(function(){

// ---------- device detection ----------
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

// ---------- persistence keys ----------
const LB_KEY = 'ruinRunner.leaderboard';
const NAME_KEY = 'ruinRunner.lastName';
const MAX_LEADERBOARD = 5;

function loadLeaderboard(){
  try{
    const raw = localStorage.getItem(LB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
function saveLeaderboard(list){
  try{ localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch(e){ /* storage unavailable, ignore */ }
}
function submitScore(name, score, level, coinsCollected){
  const list = loadLeaderboard();
  list.push({ name: name || 'Explorer', score: Math.floor(score), level, coins: coinsCollected, date: Date.now() });
  list.sort((a,b)=> b.score - a.score);
  const trimmed = list.slice(0, MAX_LEADERBOARD);
  saveLeaderboard(trimmed);
  return trimmed;
}
function renderLeaderboard(listEl){
  const list = loadLeaderboard();
  listEl.innerHTML = '';
  if(list.length === 0){
    listEl.innerHTML = '<li class="leaderboard-empty">No runs recorded yet</li>';
    return;
  }
  list.forEach((entry, i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank">${i+1}.</span><span class="lb-name">${escapeHtml(entry.name)}</span><span class="lb-score">${entry.score}</span>`;
    listEl.appendChild(li);
  });
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Removing a mesh from the scene does NOT free its GPU memory by itself.
// Since this game spawns obstacles/coins/particles continuously for an
// unbounded run, skipping disposal here was leaking GPU memory over time
// until the WebGL context crashed (showing as a black screen). This walks
// the object (and any children, for groups like the jumbie/gap models) and
// frees geometry + material before removal.
function removeFromScene(obj){
  if(!obj) return;
  obj.traverse(child=>{
    if(child.geometry) child.geometry.dispose();
    if(child.material){
      if(Array.isArray(child.material)) child.material.forEach(m=>m.dispose());
      else child.material.dispose();
    }
  });
  scene.remove(obj);
}

// ---------- sound effects (synthesized, no audio files needed) ----------
const SOUND_KEY = 'ruinRunner.soundOn';
let soundOn = true;
try{ const stored = localStorage.getItem(SOUND_KEY); if(stored !== null) soundOn = stored === '1'; } catch(e){ /* ignore */ }

const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function ensureAudio(){
  if(!AudioCtxClass) return null;
  if(!audioCtx) audioCtx = new AudioCtxClass();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, volume, startDelay){
  if(!soundOn) return;
  const ctx = ensureAudio();
  if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + (startDelay || 0);
  const vol = volume === undefined ? 0.22 : volume;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function sfxCoin(){
  playTone(880, 0.12, 'sine', 0.22, 0);
  playTone(1320, 0.12, 'sine', 0.14, 0.05);
}
function sfxLifeUp(){
  playTone(440, 0.14, 'triangle', 0.22, 0);
  playTone(660, 0.2, 'triangle', 0.2, 0.1);
}
function sfxFootstep(sign){
  playTone(sign > 0 ? 95 : 80, 0.06, 'square', 0.06, 0);
}
function sfxHit(){
  playTone(150, 0.22, 'sawtooth', 0.28, 0);
  playTone(90, 0.28, 'square', 0.18, 0.05);
}
function sfxGameOver(){
  playTone(300, 0.22, 'triangle', 0.24, 0);
  playTone(220, 0.22, 'triangle', 0.24, 0.18);
  playTone(140, 0.4, 'triangle', 0.24, 0.36);
}
function sfxVictory(){
  playTone(523, 0.16, 'sine', 0.24, 0);
  playTone(659, 0.16, 'sine', 0.24, 0.15);
  playTone(784, 0.3, 'sine', 0.24, 0.3);
}

// low ghostly ambient drone, loops for the whole run
let ambientNodes = null;
function startAmbient(){
  if(!soundOn || ambientNodes) return;
  const ctx = ensureAudio();
  if(!ctx) return;

  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  gain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine'; osc1.frequency.value = 55;
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine'; osc2.frequency.value = 58; // slight detune for an eerie beating effect
  osc1.connect(gain); osc2.connect(gain);

  // slow LFO makes the drone swell and fade like breathing
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  osc1.start(); osc2.start(); lfo.start();
  ambientNodes = { osc1, osc2, lfo, gain };
}
function stopAmbient(){
  if(!ambientNodes) return;
  try{
    ambientNodes.osc1.stop(); ambientNodes.osc2.stop(); ambientNodes.lfo.stop();
  } catch(e){ /* already stopped */ }
  ambientNodes = null;
}

// ---------- crash / context-loss recovery ----------
// If anything goes seriously wrong (a runtime error, or the browser reclaiming
// the WebGL context — common on mobile when the tab is backgrounded or the
// device is low on GPU memory), show a clear "reload" prompt instead of
// silently leaving a black screen with no explanation.
let fatalErrorShown = false;
function showFatalError(message){
  if(fatalErrorShown) return;
  fatalErrorShown = true;
  running = false;
  try{ stopAmbient(); }catch(e){ /* ignore */ }
  const el = document.getElementById('fatalOverlay');
  const msgEl = document.getElementById('fatalMessage');
  if(msgEl) msgEl.textContent = message;
  if(el) el.style.display = 'flex';
}
window.addEventListener('error', (e)=>{
  console.error('Game error:', e.error || e.message);
  showFatalError('Something interrupted the game. Tap below to reload and keep going.');
});
window.addEventListener('unhandledrejection', (e)=>{
  console.error('Game promise error:', e.reason);
  showFatalError('Something interrupted the game. Tap below to reload and keep going.');
});

// ---------- basic setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);

canvas.addEventListener('webglcontextlost', (e)=>{
  e.preventDefault(); // signal we intend to try to recover
  showFatalError('The graphics connection was lost (this can happen if the tab was backgrounded for a while). Tap below to reload.');
}, false);
canvas.addEventListener('webglcontextrestored', ()=>{
  // rebuilding the whole scene in place is fragile; a clean reload is the reliable fix
  window.location.reload();
}, false);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x3d362a, 26, 80);
scene.background = new THREE.Color(0x3d362a);

function getFov(){
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 0.7 ? 74 : 62;
}

const CAM_BASE = { x:0, y:5.2 };
const camera = new THREE.PerspectiveCamera(getFov(), window.innerWidth/window.innerHeight, 0.1, 200);
camera.position.set(CAM_BASE.x, CAM_BASE.y, 9);
camera.lookAt(0,2,-10);

window.addEventListener('resize', ()=>{
  camera.fov = getFov();
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0xb8a888, 2.8));
scene.add(new THREE.HemisphereLight(0x9db0d8, 0x4a3f2e, 1.0));
const torchLight = new THREE.PointLight(0xff9a3d, 2.8, 28);
torchLight.position.set(0, 4, 4);
scene.add(torchLight);
const moonLight = new THREE.DirectionalLight(0xc0d0ee, 1.4);
moonLight.position.set(-5, 10, -10);
scene.add(moonLight);
const fillLight = new THREE.DirectionalLight(0xffe8c0, 0.75);
fillLight.position.set(4, 6, 8);
scene.add(fillLight);

// ---------- starfield backdrop ----------
(function createStarfield(){
  const starCount = 260;
  const positions = new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    positions[i*3]   = (Math.random()-0.5)*90;
    positions[i*3+1] = Math.random()*28 + 8;
    positions[i*3+2] = (Math.random()-0.5)*90 - 20;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const starMat = new THREE.PointsMaterial({ color:0xfff3d6, size:0.12, transparent:true, opacity:.75 });
  scene.add(new THREE.Points(starGeo, starMat));
})();

// ---------- lanes / constants ----------
const LANE_X = [-2.4, 0, 2.4];
let laneIndex = 1;
let targetX = 0;

const GRAVITY = -0.028;
let velY = 0;
let playerY = 0;
let isJumping = false;
let isSliding = false;
let slideTimer = 0;

// ---------- player: low-poly humanoid rig ----------
const player = new THREE.Group();

const SKIN    = new THREE.MeshStandardMaterial({ color:0xd9a066, roughness:.6 });
const SHIRT   = new THREE.MeshStandardMaterial({ color:0x6f7d4a, roughness:.7 });
const PANTS   = new THREE.MeshStandardMaterial({ color:0x4a3a28, roughness:.8 });
const ACCENT  = new THREE.MeshStandardMaterial({ color:0xa3312a, roughness:.6 });
const HAIR    = new THREE.MeshStandardMaterial({ color:0x2c2016, roughness:.8 });

const HIP_Y      = 0.9;
const TORSO_H    = 0.55;
const SHOULDER_Y = HIP_Y + TORSO_H;
const HEAD_R     = 0.22;

const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.32), PANTS);
hips.position.y = HIP_Y;
player.add(hips);

const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, TORSO_H, 0.3), SHIRT);
torso.position.y = HIP_Y + TORSO_H/2;
player.add(torso);

const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.16), ACCENT);
pack.position.set(0, SHOULDER_Y - 0.28, -0.22);
player.add(pack);

const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 12), SKIN);
head.position.y = SHOULDER_Y + HEAD_R + 0.06;
player.add(head);
const hair = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.02, 12, 12, 0, Math.PI*2, 0, Math.PI*0.55), HAIR);
hair.position.copy(head.position);
player.add(hair);

function makeLimb(pivotY, length, width, mat, sideX){
  const pivot = new THREE.Group();
  pivot.position.set(sideX, pivotY, 0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), mat);
  mesh.position.y = -length/2;
  pivot.add(mesh);
  player.add(pivot);
  return pivot;
}

const ARM_LEN = 0.62, LEG_LEN = 0.85;
const leftArm  = makeLimb(SHOULDER_Y - 0.03, ARM_LEN, 0.15, SKIN,  -0.34);
const rightArm = makeLimb(SHOULDER_Y - 0.03, ARM_LEN, 0.15, SKIN,   0.34);
const leftLeg  = makeLimb(HIP_Y - 0.1,       LEG_LEN, 0.2,  PANTS, -0.16);
const rightLeg = makeLimb(HIP_Y - 0.1,       LEG_LEN, 0.2,  PANTS,  0.16);

player.position.set(0, 0, 3);
scene.add(player);

// ---------- ground / track ----------
const trackGroup = new THREE.Group();
scene.add(trackGroup);

const SEGMENT_LEN = 10;
const SEGMENTS_VISIBLE = 8;
let segments = [];
let flameMeshes = [];

// decorative dead tree, purely visual, planted beyond the pillars
function createDeadTree(x, z){
  const tree = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color:0x241d17, roughness:.95 });
  const trunkH = 2.4 + Math.random()*1.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.22, trunkH, 6), woodMat);
  trunk.position.y = trunkH/2;
  tree.add(trunk);

  const branchCount = 3 + Math.floor(Math.random()*3);
  for(let i=0;i<branchCount;i++){
    const branchLen = 0.6 + Math.random()*0.8;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, branchLen, 5), woodMat);
    const angle = (Math.random()-0.5)*1.4;
    branch.position.y = trunkH*0.55 + Math.random()*trunkH*0.4;
    branch.position.x = Math.sin(angle)*branchLen*0.4;
    branch.rotation.z = angle;
    branch.rotation.x = (Math.random()-0.5)*0.8;
    tree.add(branch);
  }
  tree.position.set(x, 0, z);
  return tree;
}

// decorative jack-o-lantern, purely visual
function createPumpkin(x, z){
  const p = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 8, 6),
    new THREE.MeshStandardMaterial({ color:0xd9611a, roughness:.6, emissive:0x3d1a02, emissiveIntensity:.7 })
  );
  body.scale.y = 0.82;
  body.position.y = 0.26;
  p.add(body);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.06, 0.16, 5),
    new THREE.MeshStandardMaterial({ color:0x3c5a2e, roughness:.8 })
  );
  stem.position.y = 0.52;
  p.add(stem);
  p.position.set(x, 0, z);
  return p;
}

// decorative mossy bush, purely visual, softens the stone/dead-tree palette
function createBush(x, z){
  const bush = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color:0x4d6b3f, roughness:.9 });
  const clumps = 3 + Math.floor(Math.random()*2);
  for(let i=0;i<clumps;i++){
    const r = 0.16 + Math.random()*0.14;
    const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    clump.position.set((Math.random()-0.5)*0.32, r*0.85, (Math.random()-0.5)*0.32);
    bush.add(clump);
  }
  bush.position.set(x, 0, z);
  return bush;
}

// small decorative house, sized to sit inside the corridor
function createHouse(x, z){
  const house = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color:0x6b5a42, roughness:.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color:0x3d2f22, roughness:.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.85), wallMat);
  body.position.y = 0.38;
  house.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.55, 4), roofMat);
  roof.rotation.y = Math.PI/4;
  roof.position.y = 1.03;
  house.add(roof);
  const windowLight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshStandardMaterial({ color:0xffd98a, emissive:0xffae42, emissiveIntensity:1.3 })
  );
  windowLight.position.set(0, 0.42, 0.43);
  house.add(windowLight);
  house.position.set(x, 0, z);
  house.rotation.y = (Math.random()-0.5)*0.4;
  return house;
}

// small decorative villager, purely visual, no collision/interaction
function createVillager(x, z){
  const v = new THREE.Group();
  const clothColors = [0x6b4a3a, 0x3a4a6b, 0x4a6b3a, 0x6b3a5a];
  const cloth = new THREE.MeshStandardMaterial({ color: clothColors[Math.floor(Math.random()*clothColors.length)], roughness:.8 });
  const skin = new THREE.MeshStandardMaterial({ color:0xd9a066, roughness:.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.6, 8), cloth);
  body.position.y = 0.48;
  v.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), skin);
  head.position.y = 0.88;
  v.add(head);
  v.position.set(x, 0, z);
  v.rotation.y = Math.random()*Math.PI*2;
  return v;
}

function makeGroundSegment(zPos){
  const g = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color:0x6e5f48, roughness:.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, SEGMENT_LEN), floorMat);
  floor.position.set(0, -0.2, zPos);
  g.add(floor);

  for(const side of [-1,1]){
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 4.2, SEGMENT_LEN),
      new THREE.MeshStandardMaterial({ color:0x5a4c38, roughness:.9 })
    );
    pillar.position.set(side*4.3, 1.9, zPos);
    g.add(pillar);

    // flickering torch flame mounted on the pillar
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 6, 6),
      new THREE.MeshStandardMaterial({ color:0xffae42, emissive:0xff6a10, emissiveIntensity:1.2, roughness:.4 })
    );
    flame.position.set(side*4.3, 3.6, zPos - SEGMENT_LEN/2 + 1);
    g.add(flame);
    flameMeshes.push(flame);

    // patch of moss growing on the pillar stone
    if(Math.random() < 0.85){
      const moss = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.26, 0),
        new THREE.MeshStandardMaterial({ color:0x5a7a45, roughness:1 })
      );
      moss.scale.set(1, 0.5, 0.6);
      moss.position.set(side*(4.3 - side*0.32), 0.6 + Math.random()*1.8, zPos + (Math.random()-0.5)*4);
      g.add(moss);
    }

    // bush hugging the inside base of each pillar
    if(Math.random() < 0.75){
      g.add(createBush(side*(3.85 + Math.random()*0.3), zPos + (Math.random()-0.5)*4));
    }
  }

  // scattered atmosphere, all placed INSIDE the walls (between the outer lane and the pillars)
  // so it's actually visible rather than hidden behind the corridor walls
  if(Math.random() < 0.5){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createDeadTree(side*(3.0 + Math.random()*0.7), zPos + (Math.random()-0.5)*SEGMENT_LEN*0.7));
  }
  if(Math.random() < 0.4){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createPumpkin(side*(2.7 + Math.random()*0.5), zPos + (Math.random()-0.5)*SEGMENT_LEN*0.7));
  }
  if(Math.random() < 0.7){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createBush(side*(3.2 + Math.random()*0.6), zPos + (Math.random()-0.5)*SEGMENT_LEN*0.7));
  }
  if(Math.random() < 0.45){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createBush(side*(2.8 + Math.random()*0.4), zPos - SEGMENT_LEN/2 + Math.random()*SEGMENT_LEN));
  }
  if(Math.random() < 0.22){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createHouse(side*(3.1 + Math.random()*0.5), zPos + (Math.random()-0.5)*SEGMENT_LEN*0.6));
  }
  if(Math.random() < 0.3){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.add(createVillager(side*(2.75 + Math.random()*0.4), zPos + (Math.random()-0.5)*SEGMENT_LEN*0.7));
  }

  trackGroup.add(g);
  return g;
}

for(let i=0;i<SEGMENTS_VISIBLE;i++){
  segments.push({ mesh: makeGroundSegment(-i*SEGMENT_LEN), z: -i*SEGMENT_LEN });
}

// ---------- jumbie enemy ----------
function createJumbieMesh(){
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color:0x3a4a3a, roughness:.9, transparent:true, opacity:.93 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), robeMat);
  robe.position.y = 0.95;
  g.add(robe);

  const headMat = new THREE.MeshStandardMaterial({ color:0x8fae8f, roughness:.6, emissive:0x152a15, emissiveIntensity:.6 });
  const jHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), headMat);
  jHead.position.y = 1.95;
  g.add(jHead);

  const eyeMat = new THREE.MeshStandardMaterial({ color:0x9dffb0, emissive:0x66ff88, emissiveIntensity:1.6 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6), eyeMat);
  eyeL.position.set(-0.12, 1.98, 0.26);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.12;
  g.add(eyeR);

  return g;
}

// Princess Pooza's model — appears in the scene for the reunion moment
function createPoozaMesh(){
  const g = new THREE.Group();
  const skin  = new THREE.MeshStandardMaterial({ color:0xe8c39a, roughness:.6 });
  const dress = new THREE.MeshStandardMaterial({ color:0xd6488a, roughness:.55 });
  const hairMat  = new THREE.MeshStandardMaterial({ color:0x2a1810, roughness:.8 });
  const crownMat = new THREE.MeshStandardMaterial({ color:0xffd54a, emissive:0x553d00, emissiveIntensity:.6, roughness:.3, metalness:.7 });

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.25, 10), dress);
  skirt.position.y = 0.75;
  g.add(skirt);

  const bodice = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.26), dress);
  bodice.position.y = 1.35;
  g.add(bodice);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), skin);
  head.position.y = 1.85;
  g.add(head);

  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.235, 12, 12, 0, Math.PI*2, 0, Math.PI*0.6), hairMat);
  hairTop.position.y = 1.87;
  g.add(hairTop);
  const hairFlow = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.65, 8), hairMat);
  hairFlow.position.set(0, 1.5, -0.1);
  hairFlow.rotation.x = Math.PI;
  g.add(hairFlow);

  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.032, 6, 12), crownMat);
  crown.position.y = 2.02;
  crown.rotation.x = Math.PI/2;
  g.add(crown);

  const armGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.48, 6);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.3, 1.35, 0.05);
  armL.rotation.z = 0.55;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.3;
  armR.rotation.z = -0.55;
  g.add(armR);

  return g;
}

// ---------- obstacles & coins ----------
let obstacles = [];
let coins = [];
let particles = [];
let lifePickups = [];
const LIFE_CAP = 5;

function pickObstacleType(level){
  const types = ['barrier','beam','gap'];
  if(level === 1 && Math.random() < 0.09) types.push('jumbie'); // rare level-1 cameo, ~1-2 per run
  if(level >= 2) types.push('jumbie');
  if(level >= 8) types.push('jumbie'); // extra weight only once things ramp back up late-game
  if(level >= MAX_LEVEL) types.push('jumbie'); // final level: more frequent, some will be the big variant
  return types[Math.floor(Math.random()*types.length)];
}

function spawnRowAt(z, level){
  // difficulty (obstacle density) stays flat through level 5, same as pace
  const difficultyLevel = level <= 5 ? 1 : (level - 4);
  const skipChance = Math.max(0.1, 0.26 - difficultyLevel*0.02);
  if(Math.random() < skipChance) return;

  const type = pickObstacleType(level);
  const lane = Math.floor(Math.random()*3);

  if(type === 'barrier'){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.1, 0.5),
      new THREE.MeshStandardMaterial({ color:0x6b5030, roughness:.8 })
    );
    mesh.position.set(LANE_X[lane], 0.55, z);
    scene.add(mesh);
    obstacles.push({ mesh, lane, z, type:'barrier' });
  } else if(type === 'beam'){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color:0x8a6a2f, roughness:.7 })
    );
    mesh.position.set(LANE_X[lane], 2.05, z);
    scene.add(mesh);
    obstacles.push({ mesh, lane, z, type:'beam' });
  } else if(type === 'gap'){
    const group = new THREE.Group();

    // the pit itself: dark indigo rather than pure black so it reads against the floor
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.2, 1.8),
      new THREE.MeshStandardMaterial({ color:0x241830, roughness:1 })
    );
    group.add(pit);

    // glowing warning rim traced around the edge, like carved temple hazard glyphs
    const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.86, 0.22, 1.86));
    const rimMat = new THREE.LineBasicMaterial({ color:0xffb04d, transparent:true, opacity:1 });
    const rim = new THREE.LineSegments(rimGeo, rimMat);
    group.add(rim);

    // glowing floor decal just past the rim, extra visibility from a distance
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ color:0xffb04d, transparent:true, opacity:.28, side:THREE.DoubleSide })
    );
    glow.rotation.x = -Math.PI/2;
    glow.position.y = 0.11;
    group.add(glow);

    group.position.set(LANE_X[lane], -0.15, z);
    scene.add(group);
    obstacles.push({ mesh: group, lane, z, type:'gap' });
  } else if(type === 'jumbie'){
    const mesh = createJumbieMesh();
    const isBig = level >= MAX_LEVEL && Math.random() < 0.4;
    if(isBig){
      mesh.scale.set(1.7, 1.7, 1.7);
      // darken the robe and intensify the glowing parts so it reads as a bigger threat
      mesh.traverse(child=>{
        if(!child.material) return;
        if(child.material.emissiveIntensity){
          child.material.emissiveIntensity *= 1.6;
        } else if(child.material.color){
          child.material.color.multiplyScalar(0.75);
        }
      });
    }
    mesh.position.set(LANE_X[lane], 0, z);
    scene.add(mesh);
    obstacles.push({ mesh, lane, z, type:'jumbie', bobSeed: Math.random()*10, baseX: LANE_X[lane], big: isBig });
  }

  if(Math.random() < 0.6){
    let coinLane = Math.floor(Math.random()*3);
    const coinMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.1, 8, 16),
      new THREE.MeshStandardMaterial({ color:0xffd54a, emissive:0x553d00, roughness:.3, metalness:.6 })
    );
    coinMesh.position.set(LANE_X[coinLane], 1.1, z - 1.2);
    coinMesh.rotation.x = Math.PI/2;
    scene.add(coinMesh);
    coins.push({ mesh: coinMesh, lane: coinLane, z: z-1.2 });
  }

  // rare extra-life crystal, a little less common the closer you are to the cap
  const lifeChance = lives >= LIFE_CAP ? 0 : 0.03;
  if(Math.random() < lifeChance){
    const lifeLane = Math.floor(Math.random()*3);
    const lifeMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({ color:0xff4d4d, emissive:0x6a0000, emissiveIntensity:.9, roughness:.3, metalness:.4 })
    );
    lifeMesh.position.set(LANE_X[lifeLane], 1.1, z - 3.4);
    scene.add(lifeMesh);
    lifePickups.push({ mesh: lifeMesh, lane: lifeLane, z: z-3.4, bobSeed: Math.random()*10 });
  }
}

function spawnBurst(position, color){
  for(let i=0;i<7;i++){
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent:true, opacity:1 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6), mat);
    mesh.position.copy(position);
    scene.add(mesh);
    const angle = Math.random()*Math.PI*2;
    const spd = 0.04 + Math.random()*0.05;
    particles.push({
      mesh, life: 26, maxLife: 26,
      vx: Math.cos(angle)*spd, vy: 0.09 + Math.random()*0.05, vz: Math.sin(angle)*spd
    });
  }
}
function spawnCoinBurst(position){ spawnBurst(position, 0xffd54a); }

// ---------- game state ----------
const LEVEL_DISTANCE = 650;   // meters of distance per level (~1.5 min per level at base pace)
const MAX_LEVEL = 10;
let speed = 0.20;
let distance = 0;
let coinCount = 0;
let level = 1;
let running = false;
let paused = false;
let nextSpawnZ = -14;
let shakeTime = 0;

const MAX_LIVES = 3;
let lives = MAX_LIVES;
let invulnTime = 0;
let lastStepSign = 0;

const FIND_DISTANCE = 1295; // partway through level 2, near its end
let foundPrincess = false;
let celebrating = false;
let celebrateTimer = 0;
let poozaMesh = null;

const WIN_DISTANCE = LEVEL_DISTANCE * MAX_LEVEL; // clearing the final level = winning the game
let gameWon = false;

function computeLevel(dist){
  return Math.min(MAX_LEVEL, 1 + Math.floor(dist / LEVEL_DISTANCE));
}
function computeSpeed(dist, lvl){
  // pace stays flat through level 5, only ramps up from level 6 onward
  const BASE = 0.20;
  if(lvl <= 5) return BASE;
  return BASE + (lvl - 5) * 0.016;
}
function computeScore(){
  return Math.floor(distance) + coinCount*15;
}

// ---------- input actions ----------
function tryMoveLane(dir){
  if(paused) return;
  const newLane = laneIndex + dir;
  if(newLane < 0 || newLane > 2) return;
  laneIndex = newLane;
  targetX = LANE_X[laneIndex];
}
function tryJump(){
  if(paused) return;
  if(!isJumping && !isSliding){
    isJumping = true;
    velY = 0.34;
  }
}
function trySlide(){
  if(paused) return;
  if(!isJumping){
    isSliding = true;
    slideTimer = 32;
  }
}

// ---------- keyboard input ----------
window.addEventListener('keydown', (e)=>{
  if(!running) return;
  if(e.code === 'Escape' || e.code === 'KeyP'){ togglePause(); return; }
  if(paused) return;
  if(e.code === 'ArrowLeft' || e.code === 'KeyA') tryMoveLane(-1);
  else if(e.code === 'ArrowRight' || e.code === 'KeyD') tryMoveLane(1);
  else if(e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') tryJump();
  else if(e.code === 'ArrowDown' || e.code === 'KeyS') trySlide();
});

// ---------- swipe input ----------
let touchStartX=0, touchStartY=0;
canvas.addEventListener('touchstart', (e)=>{
  touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
}, { passive:true });
canvas.addEventListener('touchend', (e)=>{
  if(!running) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if(Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30){
    tryMoveLane(dx > 0 ? 1 : -1);
  } else if(dy < -30){
    tryJump();
  } else if(dy > 30){
    trySlide();
  }
}, { passive:true });

// ---------- on-screen button controls ----------
function bindHoldButton(el, action){
  if(!el) return;
  const fire = (e)=>{ e.preventDefault(); if(running) action(); };
  el.addEventListener('touchstart', fire, { passive:false });
  el.addEventListener('mousedown', fire);
}
bindHoldButton(document.getElementById('btnLeft'),  ()=>tryMoveLane(-1));
bindHoldButton(document.getElementById('btnRight'), ()=>tryMoveLane(1));
bindHoldButton(document.getElementById('btnJump'),  tryJump);

// ---------- UI wiring ----------
const overlay = document.getElementById('overlay');
const startPanelBody = document.getElementById('startPanelBody');
const countdownPanelBody = document.getElementById('countdownPanelBody');
const endPanelBody = document.getElementById('endPanelBody');
const nameInput = document.getElementById('nameInput');
const levelUpBanner = document.getElementById('levelUpBanner');
const levelUpText = document.getElementById('levelUpText');
const loveBanner = document.getElementById('loveBanner');
const countdownNumber = document.getElementById('countdownNumber');

nameInput.value = (function(){
  try{ return localStorage.getItem(NAME_KEY) || ''; } catch(e){ return ''; }
})();
renderLeaderboard(document.getElementById('startLeaderboardList'));

document.getElementById('startBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('retryBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('exitBtn').addEventListener('click', ()=>{
  stopHeartRain();
  endPanelBody.style.display = 'none';
  startPanelBody.style.display = 'block';
  renderLeaderboard(document.getElementById('startLeaderboardList'));
});

const muteBtn = document.getElementById('muteBtn');
function updateMuteBtn(){ muteBtn.textContent = soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'; }
updateMuteBtn();
muteBtn.addEventListener('click', ()=>{
  soundOn = !soundOn;
  try{ localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch(e){ /* ignore */ }
  updateMuteBtn();
  if(soundOn){ ensureAudio(); sfxCoin(); if(running) startAmbient(); }
  else { stopAmbient(); }
});

const pauseBtn = document.getElementById('pauseBtn');
const pausePanelBody = document.getElementById('pausePanelBody');
pauseBtn.addEventListener('click', togglePause);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('pauseRestartBtn').addEventListener('click', ()=>{
  paused = false;
  pausePanelBody.style.display = 'none';
  overlay.classList.add('hidden');
  beginSequence();
});
document.getElementById('pauseExitBtn').addEventListener('click', ()=>{
  running = false;
  paused = false;
  stopAmbient();
  pausePanelBody.style.display = 'none';
  startPanelBody.style.display = 'block';
  renderLeaderboard(document.getElementById('startLeaderboardList'));
});

function togglePause(){
  if(!running) return;
  paused = !paused;
  console.log('Pause toggled. paused =', paused);
  if(paused){
    try{ if(audioCtx && audioCtx.state === 'running') audioCtx.suspend(); } catch(e){ /* ignore */ }
    startPanelBody.style.display = 'none';
    countdownPanelBody.style.display = 'none';
    endPanelBody.style.display = 'none';
    pausePanelBody.style.display = 'block';
    overlay.classList.remove('hidden');
  } else {
    try{ if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){ /* ignore */ }
    pausePanelBody.style.display = 'none';
    overlay.classList.add('hidden');
  }
}

let levelUpTimeout = null;
function flashLevelUp(lvl){
  levelUpText.textContent = 'LEVEL ' + lvl;
  levelUpBanner.classList.add('show');
  clearTimeout(levelUpTimeout);
  levelUpTimeout = setTimeout(()=> levelUpBanner.classList.remove('show'), 1400);
}

let loveBannerTimeout = null;
function showLoveBanner(){
  loveBanner.classList.add('show');
  clearTimeout(loveBannerTimeout);
  loveBannerTimeout = setTimeout(()=> loveBanner.classList.remove('show'), 1900);
}

function startHeartRain(){
  const container = document.getElementById('heartRain');
  if(!container) return;
  container.innerHTML = '';
  const count = 44;
  for(let i=0;i<count;i++){
    const span = document.createElement('span');
    span.className = 'falling-heart';
    span.textContent = '\u2665';
    span.style.left = (Math.random()*100) + 'vw';
    span.style.fontSize = (14 + Math.random()*24) + 'px';
    span.style.animationDuration = (3 + Math.random()*3.5) + 's';
    span.style.animationDelay = (Math.random()*2.5) + 's';
    container.appendChild(span);
  }
  container.classList.add('active');
}
function stopHeartRain(){
  const container = document.getElementById('heartRain');
  if(!container) return;
  container.classList.remove('active');
  container.innerHTML = '';
}

function beginSequence(){
  startPanelBody.style.display = 'none';
  endPanelBody.style.display = 'none';
  countdownPanelBody.style.display = 'block';
  overlay.classList.remove('hidden');

  let count = 3;
  countdownNumber.textContent = count;
  const timer = setInterval(()=>{
    count--;
    if(count > 0){
      countdownNumber.textContent = count;
    } else {
      clearInterval(timer);
      countdownPanelBody.style.display = 'none';
      overlay.classList.add('hidden');
      startGame();
    }
  }, 800);
}

function startGame(){
  stopHeartRain();
  obstacles.forEach(o=>removeFromScene(o.mesh));
  coins.forEach(c=>removeFromScene(c.mesh));
  particles.forEach(p=>removeFromScene(p.mesh));
  lifePickups.forEach(l=>removeFromScene(l.mesh));
  obstacles = []; coins = []; particles = []; lifePickups = [];
  if(poozaMesh){ removeFromScene(poozaMesh); poozaMesh = null; }

  distance = 0; coinCount = 0; speed = 0.20; level = 1;
  laneIndex = 1; targetX = 0; player.position.x = 0;
  playerY = 0; velY = 0; isJumping = false; isSliding = false; slideTimer = 0;
  player.rotation.x = 0;
  leftLeg.rotation.x = 0; rightLeg.rotation.x = 0;
  leftArm.rotation.x = 0; rightArm.rotation.x = 0;
  nextSpawnZ = -14;
  shakeTime = 0;
  lives = MAX_LIVES;
  invulnTime = 0;
  lastStepSign = 0;
  paused = false;
  foundPrincess = false;
  celebrating = false;
  celebrateTimer = 0;
  gameWon = false;
  player.visible = true;
  camera.position.x = CAM_BASE.x; camera.position.y = CAM_BASE.y;

  try{ localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch(e){ /* ignore */ }

  startAmbient();

  running = true;
  overlay.classList.add('hidden');
  updateHUD();
}

// called when the player runs out of lives
function loseLife(){
  lives--;
  shakeTime = 14;
  sfxHit();
  updateHUD();
  if(lives <= 0){
    finishRun(false);
    return;
  }
  // brief invulnerability so the same obstacle can't hit twice in a row
  invulnTime = 70;
  isJumping = false; isSliding = false; velY = 0; playerY = 0;
  player.position.y = 0; player.rotation.x = 0;
  leftLeg.rotation.x = 0; rightLeg.rotation.x = 0;
  leftArm.rotation.x = 0; rightArm.rotation.x = 0;
}

// unified ending for both game-over and finding Pooza
function finishRun(victory){
  running = false;
  if(!victory) shakeTime = 18;
  if(victory) sfxVictory(); else sfxGameOver();
  stopAmbient();

  const finalScore = computeScore();
  const playerName = (nameInput.value || '').trim() || 'Explorer';
  const board = submitScore(playerName, finalScore, level, coinCount);
  const isNewBest = board.length > 0 && board[0].score === Math.floor(finalScore) && (Date.now() - board[0].date) < 2000;

  const endHeading = document.getElementById('endHeading');
  const endSub = document.getElementById('endSub');
  if(victory){
    endHeading.textContent = 'You Found Her Forever';
    endSub.textContent = 'You cleared the temple and Princess Pooza is safe at last.';
    startHeartRain();
  } else {
    endHeading.textContent = 'You Were Caught';
    endSub.textContent = 'The temple claims another explorer...';
  }

  document.getElementById('finalScore').textContent = finalScore;
  document.getElementById('finalLevel').textContent = level;
  document.getElementById('finalCoins').textContent = coinCount;
  document.getElementById('newRecordLine').style.display = isNewBest ? 'block' : 'none';
  renderLeaderboard(document.getElementById('endLeaderboardList'));

  startPanelBody.style.display = 'none';
  countdownPanelBody.style.display = 'none';
  endPanelBody.style.display = 'block';
  overlay.classList.remove('hidden');
}

function updateHUD(){
  document.getElementById('scoreVal').textContent = computeScore();
  document.getElementById('levelVal').textContent = level;
  document.getElementById('coinVal').textContent = coinCount;
  const heartsEl = document.getElementById('livesVal');
  let hearts = '';
  for(let i=0;i<lives;i++) hearts += '\u2665';
  heartsEl.textContent = hearts || '\u2661';
}

// ---------- collision ----------
function checkCollisions(){
  if(invulnTime > 0) return; // brief grace period after losing a life
  const pz = player.position.z;
  for(let i = obstacles.length - 1; i >= 0; i--){
    const o = obstacles[i];
    if(Math.abs(o.z - pz) < 0.55 && o.lane === laneIndex){
      if(o.type === 'barrier' && !isJumping){ loseLife(); return; }
      if(o.type === 'beam' && !isSliding){ loseLife(); return; }
      if(o.type === 'gap' && !isJumping){ loseLife(); return; }
      if(o.type === 'jumbie'){ loseLife(); return; } // jumbies can only be dodged by switching lanes
    }
  }
  for(let i = coins.length - 1; i >= 0; i--){
    const c = coins[i];
    if(Math.abs(c.z - pz) < 0.6 && c.lane === laneIndex){
      spawnCoinBurst(c.mesh.position);
      sfxCoin();
      removeFromScene(c.mesh);
      coins.splice(i,1);
      coinCount++;
    }
  }
  for(let i = lifePickups.length - 1; i >= 0; i--){
    const l = lifePickups[i];
    if(Math.abs(l.z - pz) < 0.6 && l.lane === laneIndex){
      spawnBurst(l.mesh.position, 0xff4d4d);
      if(lives < LIFE_CAP){ lives++; sfxLifeUp(); } else { sfxCoin(); }
      removeFromScene(l.mesh);
      lifePickups.splice(i,1);
      updateHUD();
    }
  }
}

// ---------- main loop ----------
let frameCount = 0;
function animate(){
  requestAnimationFrame(animate);
  if(fatalErrorShown) return;

  try{
    frameCount++;

    if(running && !paused){
      const prevLevel = level;
    level = computeLevel(distance);
    speed = computeSpeed(distance, level);
    if(level !== prevLevel) flashLevelUp(level);

    if(celebrating){
      celebrateTimer--;
      if(poozaMesh) poozaMesh.rotation.y += 0.02;
      if(celebrateTimer <= 0){
        celebrating = false;
        if(poozaMesh){ removeFromScene(poozaMesh); poozaMesh = null; }
      }
    } else {
      distance += speed * 0.6;

      if(!foundPrincess && distance >= FIND_DISTANCE){
        foundPrincess = true;
        celebrating = true;
        celebrateTimer = 420; // ~7 seconds, run pauses right here then resumes
        poozaMesh = createPoozaMesh();
        poozaMesh.position.set(player.position.x, 0, player.position.z - 2.3);
        scene.add(poozaMesh);
        spawnCoinBurst(poozaMesh.position);
        sfxVictory();
        showLoveBanner();
      }

      if(!gameWon && distance >= WIN_DISTANCE){
        gameWon = true;
        finishRun(true);
      }
    }

    if(!celebrating && running){
      const dz = speed;
      obstacles.forEach(o=>{
        o.z += dz; o.mesh.position.z = o.z;
        if(o.type === 'jumbie'){
          o.mesh.position.y = Math.sin(frameCount*0.08 + o.bobSeed) * 0.08;
          o.mesh.position.x = o.baseX + Math.sin(frameCount*0.025 + o.bobSeed) * 0.22;
          o.mesh.rotation.y += 0.015;
        }
      });
      coins.forEach(c=>{ c.z += dz; c.mesh.position.z = c.z; c.mesh.rotation.z += 0.12; });
      lifePickups.forEach(l=>{
        l.z += dz; l.mesh.position.z = l.z;
        l.mesh.rotation.y += 0.06;
        l.mesh.position.y = 1.1 + Math.sin(frameCount*0.1 + l.bobSeed) * 0.1;
      });
      segments.forEach(s=>{ s.z += dz; s.mesh.position.z = s.z; });

      segments.forEach(s=>{
        if(s.z > 14){
          s.z -= SEGMENT_LEN * SEGMENTS_VISIBLE;
          s.mesh.position.z = s.z;
        }
      });

      obstacles = obstacles.filter(o=>{
        if(o.z > 14){ removeFromScene(o.mesh); return false; }
        return true;
      });
      coins = coins.filter(c=>{
        if(c.z > 14){ removeFromScene(c.mesh); return false; }
        return true;
      });
      lifePickups = lifePickups.filter(l=>{
        if(l.z > 14){ removeFromScene(l.mesh); return false; }
        return true;
      });

      // coin/spark particle update
      particles = particles.filter(p=>{
        p.life--;
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.006;
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
        if(p.life <= 0){ removeFromScene(p.mesh); return false; }
        return true;
      });

      nextSpawnZ += dz;
      const spacingLevel = level <= 5 ? 1 : (level - 4);
      while(nextSpawnZ > -50){
        spawnRowAt(nextSpawnZ - 60, level);
        nextSpawnZ -= Math.max(4.2, 6 - spacingLevel*0.15);
      }

      player.position.x += (targetX - player.position.x) * 0.22;

      if(isJumping){
        velY += GRAVITY;
        playerY += velY;
        if(playerY <= 0){
          playerY = 0; isJumping = false; velY = 0;
        }
      }

      if(isSliding){
        slideTimer--;
        if(slideTimer <= 0) isSliding = false;
      }

      player.position.y = playerY;

      const targetTiltX = isSliding ? 1.0 : 0;
      player.rotation.x += (targetTiltX - player.rotation.x) * 0.35;

      if(isJumping){
        leftLeg.rotation.x  += (-0.9 - leftLeg.rotation.x) * 0.3;
        rightLeg.rotation.x += (-0.6 - rightLeg.rotation.x) * 0.3;
        leftArm.rotation.x  += (-0.4 - leftArm.rotation.x) * 0.3;
        rightArm.rotation.x += ( 0.7 - rightArm.rotation.x) * 0.3;
      } else if(isSliding){
        leftLeg.rotation.x  += (0.3 - leftLeg.rotation.x) * 0.3;
        rightLeg.rotation.x += (0.3 - rightLeg.rotation.x) * 0.3;
        leftArm.rotation.x  += (-0.6 - leftArm.rotation.x) * 0.3;
        rightArm.rotation.x += (-0.6 - rightArm.rotation.x) * 0.3;
      } else {
        const swing = Math.sin(distance * 9) * 0.75;
        const stepSign = Math.sign(swing);
        if(stepSign !== 0 && stepSign !== lastStepSign){
          lastStepSign = stepSign;
          sfxFootstep(stepSign);
        }
        leftLeg.rotation.x  += (swing - leftLeg.rotation.x) * 0.4;
        rightLeg.rotation.x += (-swing - rightLeg.rotation.x) * 0.4;
        leftArm.rotation.x  += (-swing*0.8 - leftArm.rotation.x) * 0.4;
        rightArm.rotation.x += ( swing*0.8 - rightArm.rotation.x) * 0.4;
      }

      player.rotation.z = Math.sin(distance*0.4) * 0.03;

      torchLight.position.z = player.position.z + 1;

      // invulnerability window after losing a life: skip collisions, flicker the model
      if(invulnTime > 0){
        invulnTime--;
        player.visible = Math.floor(invulnTime / 4) % 2 === 0;
      } else {
        player.visible = true;
      }

      if(running){ // finishRun() may have fired above on this same frame
        checkCollisions();
      }
    }

    // torch flicker keeps going even during the celebration pause
    if(frameCount % 4 === 0){
      flameMeshes.forEach(f=>{ f.material.emissiveIntensity = 0.9 + Math.random()*0.7; });
    }

    updateHUD();
  }

  // screen shake (runs even after game over, decaying out)
  if(shakeTime > 0){
    shakeTime--;
    camera.position.x = CAM_BASE.x + (Math.random()-0.5)*0.15;
    camera.position.y = CAM_BASE.y + (Math.random()-0.5)*0.15;
  } else {
    camera.position.x = CAM_BASE.x;
    camera.position.y = CAM_BASE.y;
  }

  renderer.render(scene, camera);
  } catch(err){
    console.error('Frame error:', err);
    showFatalError('Something interrupted the game. Tap below to reload and keep going.');
  }
}

animate();

})();
