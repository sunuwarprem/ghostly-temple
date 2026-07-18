(function(){

// ---------- device detection ----------
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

// ---------- sound effects (synthesized, no audio files needed) ----------
const SOUND_KEY = 'jumbieHunt.soundOn';
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
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}
function sfxShoot(){ playTone(180, 0.08, 'sawtooth', 0.2, 0); playTone(90, 0.1, 'square', 0.15, 0.02); }
function sfxHitJumbie(){ playTone(500, 0.08, 'square', 0.18, 0); }
function sfxKillJumbie(){ playTone(260, 0.1, 'sawtooth', 0.2, 0); playTone(140, 0.16, 'sawtooth', 0.18, 0.06); }
function sfxPlayerHurt(){ playTone(140, 0.22, 'sawtooth', 0.28, 0); playTone(80, 0.28, 'square', 0.18, 0.05); }
function sfxFootstep(running, sign){
  const base = running ? (sign > 0 ? 105 : 90) : (sign > 0 ? 85 : 72);
  playTone(base, 0.06, 'square', running ? 0.08 : 0.05, 0);
}
function sfxWave(){ playTone(300, 0.15, 'triangle', 0.22, 0); playTone(400, 0.15, 'triangle', 0.2, 0.12); }
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
function sfxLifeUp(){
  playTone(440, 0.14, 'triangle', 0.22, 0);
  playTone(660, 0.2, 'triangle', 0.2, 0.1);
}

let ambientNodes = null;
function startAmbient(){
  if(!soundOn || ambientNodes) return;
  const ctx = ensureAudio();
  if(!ctx) return;
  const gain = ctx.createGain();
  gain.gain.value = 0.045;
  gain.connect(ctx.destination);
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine'; osc1.frequency.value = 50;
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine'; osc2.frequency.value = 53;
  osc1.connect(gain); osc2.connect(gain);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain); lfoGain.connect(gain.gain);
  osc1.start(); osc2.start(); lfo.start();
  ambientNodes = { osc1, osc2, lfo, gain };
}
function stopAmbient(){
  if(!ambientNodes) return;
  try{ ambientNodes.osc1.stop(); ambientNodes.osc2.stop(); ambientNodes.lfo.stop(); } catch(e){ /* ignore */ }
  ambientNodes = null;
}

// ---------- crash / context-loss recovery ----------
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

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);

canvas.addEventListener('webglcontextlost', (e)=>{
  e.preventDefault();
  showFatalError('The graphics connection was lost. Tap below to reload.');
}, false);
canvas.addEventListener('webglcontextrestored', ()=>{ window.location.reload(); }, false);

const scene = new THREE.Scene();
// smoky sunrise: warm hazy fog, not too dark, not blown out
const SMOKY_COLOR = new THREE.Color(0x8a7568);
const SUNRISE_COLOR = new THREE.Color(0xffd9a8);
scene.fog = new THREE.Fog(SMOKY_COLOR.getHex(), 14, 90);
scene.background = new THREE.Color(SMOKY_COLOR.getHex());

function getFov(){
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 0.7 ? 72 : 58;
}
const camera = new THREE.PerspectiveCamera(getFov(), window.innerWidth/window.innerHeight, 0.1, 300);

window.addEventListener('resize', ()=>{
  camera.fov = getFov();
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- lighting: dawn palette, moderate intensities (avoid blowout) ----------
scene.add(new THREE.AmbientLight(0x8a7a6a, 1.1));
const sunLight = new THREE.DirectionalLight(0xffb37a, 1.3);
sunLight.position.set(-30, 22, -10);
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0x8899cc, 0.35);
fillLight.position.set(20, 15, 20);
scene.add(fillLight);
// low warm "sun disc" for visual anchor, far in the distance
const sunDisc = new THREE.Mesh(
  new THREE.SphereGeometry(6, 16, 16),
  new THREE.MeshBasicMaterial({ color:0xffcf8a, fog:false })
);
sunDisc.position.set(-120, 26, -60);
scene.add(sunDisc);

// moon and Jupiter, visible in the dawn sky alongside the sun — a common enough
// sight in early morning twilight. Both use canvas textures so they're
// recognizable, and fog:false keeps them crisp above the ground-level haze.
function createCelestialTexture(kind){
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if(kind === 'moon'){
    ctx.fillStyle = '#d8d4c8';
    ctx.beginPath(); ctx.arc(128,128,128,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(150,145,135,0.55)';
    for(let i=0;i<9;i++){
      const cx = 40+Math.random()*176, cy = 40+Math.random()*176, r = 8+Math.random()*22;
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    }
  } else {
    const bands = ['#c9a06a','#a8763f','#d9b98a','#8a5a2f','#e0c49a','#b0703a','#c9a06a'];
    const bandH = 256/bands.length;
    bands.forEach((color,i)=>{ ctx.fillStyle = color; ctx.fillRect(0, i*bandH, 256, bandH+1); });
    ctx.fillStyle = '#b8503a';
    ctx.beginPath(); ctx.ellipse(75,150,28,17,0,0,Math.PI*2); ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(7, 16, 16),
  new THREE.MeshBasicMaterial({ map: createCelestialTexture('moon'), fog:false })
);
moonMesh.position.set(150, 85, -170);
scene.add(moonMesh);

const jupiterMesh = new THREE.Mesh(
  new THREE.SphereGeometry(11, 16, 16),
  new THREE.MeshBasicMaterial({ map: createCelestialTexture('jupiter'), fog:false })
);
jupiterMesh.position.set(-160, 65, -190);
scene.add(jupiterMesh);


// ---------- materials shared with the temple game character ----------
const SKIN  = new THREE.MeshStandardMaterial({ color:0xd9a066, roughness:.6 });
const SHIRT = new THREE.MeshStandardMaterial({ color:0x6f7d4a, roughness:.7 });
const PANTS = new THREE.MeshStandardMaterial({ color:0x4a3a28, roughness:.8 });
const ACCENT= new THREE.MeshStandardMaterial({ color:0xa3312a, roughness:.6 });
const HAIR  = new THREE.MeshStandardMaterial({ color:0x2c2016, roughness:.8 });

function buildHumanoid(){
  const player = new THREE.Group();
  const HIP_Y = 0.9, TORSO_H = 0.55, SHOULDER_Y = HIP_Y + TORSO_H, HEAD_R = 0.22;

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.32), PANTS);
  hips.position.y = HIP_Y; player.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, TORSO_H, 0.3), SHIRT);
  torso.position.y = HIP_Y + TORSO_H/2; player.add(torso);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.16), ACCENT);
  pack.position.set(0, SHOULDER_Y - 0.28, -0.22); player.add(pack);

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 12), SKIN);
  head.position.y = SHOULDER_Y + HEAD_R + 0.06; player.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R*1.02, 12, 12, 0, Math.PI*2, 0, Math.PI*0.55), HAIR);
  hair.position.copy(head.position); player.add(hair);

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

  return { group: player, leftArm, rightArm, leftLeg, rightLeg };
}

const playerRig = buildHumanoid();
const player = playerRig.group;
player.position.set(0, 0, 30);
scene.add(player);

// simple gun silhouette in the player's right hand for readability
const gunMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.08, 0.4),
  new THREE.MeshStandardMaterial({ color:0x1c1815, roughness:.4, metalness:.6 })
);
gunMesh.position.set(0.34, -0.35, 0.25);
playerRig.rightArm.add(gunMesh);

// ---------- Pooza (reused design) ----------
function createPoozaMesh(){
  const g = new THREE.Group();
  const skin  = new THREE.MeshStandardMaterial({ color:0xe8c39a, roughness:.6 });
  const dress = new THREE.MeshStandardMaterial({ color:0xd6488a, roughness:.55 });
  const hairMat  = new THREE.MeshStandardMaterial({ color:0x2a1810, roughness:.8 });
  const crownMat = new THREE.MeshStandardMaterial({ color:0xffd54a, emissive:0x553d00, emissiveIntensity:.6, roughness:.3, metalness:.7 });

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.25, 10), dress);
  skirt.position.y = 0.75; g.add(skirt);
  const bodice = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.26), dress);
  bodice.position.y = 1.35; g.add(bodice);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), skin);
  head.position.y = 1.85; g.add(head);
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.235, 12, 12, 0, Math.PI*2, 0, Math.PI*0.6), hairMat);
  hairTop.position.y = 1.87; g.add(hairTop);
  const hairFlow = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.65, 8), hairMat);
  hairFlow.position.set(0, 1.5, -0.1); hairFlow.rotation.x = Math.PI; g.add(hairFlow);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.032, 6, 12), crownMat);
  crown.position.y = 2.02; crown.rotation.x = Math.PI/2; g.add(crown);

  return g;
}

// a tall beam of light marks where Pooza is, visible from across the city as a search aid
const POOZA_POS = { x: 34, z: -34 };
const KILLS_TO_REVEAL = 30;
let poozaRevealed = false;
const poozaMesh = createPoozaMesh();
poozaMesh.position.set(POOZA_POS.x, 0, POOZA_POS.z);
poozaMesh.visible = false;
scene.add(poozaMesh);
const poozaBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.15, 0.15, 40, 8, 1, true),
  new THREE.MeshBasicMaterial({ color:0xffe0a0, transparent:true, opacity:.35, side:THREE.DoubleSide })
);
poozaBeam.position.set(POOZA_POS.x, 20, POOZA_POS.z);
poozaBeam.visible = false;
scene.add(poozaBeam);
let poozaFound = false;
let celebrating = false;
let celebrateTimer = 0;

// ---------- jumbie variants ----------
function createJumbieMesh(kind){
  const g = new THREE.Group();
  if(kind === 'skeleton'){
    const boneMat = new THREE.MeshStandardMaterial({ color:0xdcd3b8, roughness:.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.22), boneMat);
    torso.position.y = 1.0; g.add(torso);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), boneMat);
    headM.position.y = 1.55; g.add(headM);
    const eyeMat = new THREE.MeshStandardMaterial({ color:0xff5533, emissive:0xff2200, emissiveIntensity:1.8 });
    for(const side of [-1,1]){
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045,6,6), eyeMat);
      eye.position.set(side*0.09, 1.57, 0.2);
      g.add(eye);
    }
    for(const side of [-1,1]){
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.9,5), boneMat);
      leg.position.set(side*0.13, 0.45, 0);
      g.add(leg);
    }
    return g;
  }
  if(kind === 'neon'){
    const bodyMat = new THREE.MeshStandardMaterial({ color:0x1a1a2a, roughness:.7, emissive:0x220033, emissiveIntensity:.4 });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), bodyMat);
    robe.position.y = 0.95; g.add(robe);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), bodyMat);
    headM.position.y = 1.95; g.add(headM);
    const neonMat = new THREE.MeshStandardMaterial({ color:0xff3df0, emissive:0xff2df0, emissiveIntensity:2.2 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 16), neonMat);
    ring.position.y = 1.1; ring.rotation.x = Math.PI/2; g.add(ring);
    for(const side of [-1,1]){
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6), neonMat);
      eye.position.set(side*0.12, 1.98, 0.26);
      g.add(eye);
    }
    return g;
  }
  // default ghost jumbie (same as the temple game)
  const robeMat = new THREE.MeshStandardMaterial({ color:0x3a4a3a, roughness:.9, transparent:true, opacity:.93 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), robeMat);
  robe.position.y = 0.95; g.add(robe);
  const headMat = new THREE.MeshStandardMaterial({ color:0x8fae8f, roughness:.6, emissive:0x152a15, emissiveIntensity:.6 });
  const jHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), headMat);
  jHead.position.y = 1.95; g.add(jHead);
  const eyeMat = new THREE.MeshStandardMaterial({ color:0x9dffb0, emissive:0x66ff88, emissiveIntensity:1.6 });
  for(const side of [-1,1]){
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6), eyeMat);
    eye.position.set(side*0.12, 1.98, 0.26);
    g.add(eye);
  }
  return g;
}

// ---------- city generation ----------
const CITY_HALF = 95;
const blockers = []; // { x, z, radius } — simple circular collision for houses/cars
const decorGroup = new THREE.Group();
scene.add(decorGroup);

// ground: road + sidewalk tint, with dark "crack" decals
const groundMat = new THREE.MeshStandardMaterial({ color:0x4a4438, roughness:1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_HALF*2, CITY_HALF*2), groundMat);
ground.rotation.x = -Math.PI/2;
scene.add(ground);

const crackMat = new THREE.MeshBasicMaterial({ color:0x2a251c, transparent:true, opacity:.55 });
for(let i=0;i<70;i++){
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.15 + Math.random()*0.3, 2 + Math.random()*5), crackMat);
  crack.rotation.x = -Math.PI/2;
  crack.rotation.z = Math.random()*Math.PI;
  crack.position.set((Math.random()-0.5)*CITY_HALF*2, 0.01, (Math.random()-0.5)*CITY_HALF*2);
  scene.add(crack);
}

// reusable canvas-texture sign, used for building names / posters
function createTextSign(text, width, height, opts){
  opts = opts || {};
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.bg || 'rgba(20,15,10,0.9)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = opts.border || 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, canvas.width-6, canvas.height-6);
  ctx.font = (opts.fontWeight || 'bold') + ' ' + (opts.fontSize || 62) + 'px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color || '#ffcf8a';
  ctx.fillText(text, canvas.width/2, canvas.height/2);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent:true, fog:false });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

function createHouse(x, z, w, d, h){
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: [0x6b5a42,0x5a4c3a,0x4a4438,0x6a4838][Math.floor(Math.random()*4)], roughness:.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color:0x2e241a, roughness:.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  body.position.y = h/2;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*0.75, h*0.5, 4), roofMat);
  roof.rotation.y = Math.PI/4;
  roof.position.y = h + h*0.22;
  g.add(roof);
  // a couple of dark window openings and one lit window for atmosphere
  for(let i=0;i<2;i++){
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w*0.14, w*0.14),
      new THREE.MeshStandardMaterial({ color:0x0a0806, roughness:1 }));
    win.position.set((i===0?-1:1)*w*0.22, h*0.55, d/2 + 0.01);
    g.add(win);
  }
  if(Math.random() < 0.4){
    const litWin = new THREE.Mesh(new THREE.PlaneGeometry(w*0.12, w*0.12),
      new THREE.MeshStandardMaterial({ color:0xffcf8a, emissive:0xffae42, emissiveIntensity:1.1 }));
    litWin.position.set(0, h*0.6, -d/2 - 0.01);
    litWin.rotation.y = Math.PI;
    g.add(litWin);
  }
  g.position.set(x, 0, z);
  g.rotation.y = (Math.random()-0.5)*0.15;
  return g;
}

// City Hall: wide columned building with a low dome, a real landmark you can navigate by
function createCityHall(x, z){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color:0x8a8272, roughness:.8 });
  const domeMat = new THREE.MeshStandardMaterial({ color:0x5a6a68, roughness:.6, metalness:.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), stoneMat);
  body.position.y = 3;
  g.add(body);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12, 0, Math.PI*2, 0, Math.PI/2), domeMat);
  dome.position.y = 6;
  g.add(dome);

  // front columns
  for(let i=-3;i<=3;i++){
    if(i === 0) continue;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5.4, 8), stoneMat);
    col.position.set(i*2, 2.7, 5.2);
    g.add(col);
  }
  // steps
  const steps = new THREE.Mesh(new THREE.BoxGeometry(17, 0.6, 2.5), stoneMat);
  steps.position.set(0, 0.3, 6.5);
  g.add(steps);

  const nameSign = createTextSign('POOZA CITY HALL', 9, 1.3, { bg:'rgba(30,26,20,0.9)', color:'#ffd98a', fontSize:52 });
  nameSign.position.set(0, 5.7, 5.02);
  g.add(nameSign);

  g.position.set(x, 0, z);
  return g;
}

// Church: tall spire with a cross, unmistakable silhouette from a distance
function createChurch(x, z){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color:0x6b6258, roughness:.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color:0x2a2420, roughness:.8 });
  const crossMat = new THREE.MeshStandardMaterial({ color:0xd9c88a, emissive:0x554422, emissiveIntensity:.5, roughness:.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 8, 14), stoneMat);
  body.position.y = 4;
  g.add(body);

  const towerBase = new THREE.Mesh(new THREE.BoxGeometry(3.4, 6, 3.4), stoneMat);
  towerBase.position.set(0, 11, -5);
  g.add(towerBase);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 4), roofMat);
  spire.position.set(0, 17, -5);
  spire.rotation.y = Math.PI/4;
  g.add(spire);

  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), crossMat);
  crossV.position.set(0, 21, -5);
  g.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.25), crossMat);
  crossH.position.set(0, 20.6, -5);
  g.add(crossH);

  // stained-glass-ish glowing window on the front
  const window1 = new THREE.Mesh(new THREE.CircleGeometry(1.4, 12),
    new THREE.MeshStandardMaterial({ color:0x7a4fd6, emissive:0x5a2fb0, emissiveIntensity:.9 }));
  window1.position.set(0, 5, 7.01);
  g.add(window1);

  g.position.set(x, 0, z);
  return g;
}

// Shopping Mall: wide flat building with a big sign, unmistakable from the road
function createMall(x, z){
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color:0x4a4a52, roughness:.75, metalness:.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color:0x2a3a4a, roughness:.3, metalness:.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 12), wallMat);
  body.position.y = 2.5;
  g.add(body);

  const glassFront = new THREE.Mesh(new THREE.BoxGeometry(19, 3.2, 0.2), glassMat);
  glassFront.position.set(0, 2, 6.05);
  g.add(glassFront);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 0.4),
    new THREE.MeshStandardMaterial({ color:0xff3df0, emissive:0xff2df0, emissiveIntensity:1.6 }));
  sign.position.set(0, 5.8, 6.1);
  g.add(sign);

  g.position.set(x, 0, z);
  return g;
}

// Movie Hall: purple-lit windows and a lit marquee sign with the movie title
function createMovieHall(x, z){
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color:0x2e2430, roughness:.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 10), wallMat);
  body.position.y = 3;
  g.add(body);

  // purple-lit windows across the front
  const purpleMat = new THREE.MeshStandardMaterial({ color:0xb84dff, emissive:0x9910ff, emissiveIntensity:1.5 });
  for(let i=-2;i<=2;i++){
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.3), purpleMat);
    win.position.set(i*2.4, 3.3, 5.01);
    g.add(win);
  }

  // marquee canopy over the entrance
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.3, 1.6),
    new THREE.MeshStandardMaterial({ color:0x1a1420, roughness:.7 }));
  canopy.position.set(0, 4.3, 6.0);
  g.add(canopy);

  // lit movie title sign, mounted on the marquee
  const titleSign = createTextSign('EVIL DEAD', 8.6, 1.3, { bg:'#160018', color:'#e83dff', border:'rgba(232,61,255,0.5)', fontSize:56 });
  titleSign.position.set(0, 5.35, 5.05);
  g.add(titleSign);

  g.position.set(x, 0, z);
  return g;
}

function createCar(x, z){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: [0x6b2020,0x2a3a5a,0x4a4438,0x2e2e2e][Math.floor(Math.random()*4)], roughness:.5, metalness:.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color:0x2a3a44, roughness:.3, metalness:.3 });
  const wheelMat = new THREE.MeshStandardMaterial({ color:0x0e0e0e, roughness:.8 });
  const lightMatF = new THREE.MeshStandardMaterial({ color:0xffe8b0, emissive:0xffcf7a, emissiveIntensity:1.0 });
  const lightMatR = new THREE.MeshStandardMaterial({ color:0xff4030, emissive:0xff2010, emissiveIntensity:.8 });

  // main body sits a bit higher off the ground, wheels fill the gap underneath
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 0.95), bodyMat);
  body.position.y = 0.42;
  g.add(body);

  // cabin/roof, set back and narrower than the body for a real car silhouette
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.36, 0.82), bodyMat);
  cabin.position.set(-0.15, 0.79, 0);
  g.add(cabin);

  // windshield + rear window (angled slightly via thin boxes rather than true angled glass, keeps it simple)
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.76), glassMat);
  windshield.position.set(0.34, 0.78, 0);
  g.add(windshield);
  const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.76), glassMat);
  rearWindow.position.set(-0.64, 0.77, 0);
  g.add(rearWindow);
  const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.06), glassMat);
  sideWindow.position.set(-0.15, 0.8, 0.41);
  g.add(sideWindow);

  // four wheels
  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10);
  for(const wx of [0.62, -0.62]){
    for(const wz of [0.48, -0.48]){
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(wx, 0.22, wz);
      g.add(wheel);
    }
  }

  // head/tail lights so front vs back reads clearly
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), lightMatF);
  headL.position.set(0.95, 0.4, 0.32);
  g.add(headL);
  const headR = headL.clone(); headR.position.z = -0.32; g.add(headR);
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.14), lightMatR);
  tailL.position.set(-0.95, 0.4, 0.3);
  g.add(tailL);
  const tailR = tailL.clone(); tailR.position.z = -0.3; g.add(tailR);

  g.position.set(x, 0, z);
  g.rotation.y = Math.random()*Math.PI*2;
  return g;
}

function createBus(x, z){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color:0xd9a52a, roughness:.5, metalness:.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color:0x8ab0c0, roughness:.3, metalness:.2 });
  const wheelMat = new THREE.MeshStandardMaterial({ color:0x0e0e0e, roughness:.8 });
  const lightMatF = new THREE.MeshStandardMaterial({ color:0xffe8b0, emissive:0xffcf7a, emissiveIntensity:1.0 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.15), bodyMat);
  body.position.y = 0.85;
  g.add(body);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.22, 1.17),
    new THREE.MeshStandardMaterial({ color:0x1a1a1a }));
  stripe.position.y = 0.48;
  g.add(stripe);

  // windshield at the front end
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.05), glassMat);
  windshield.position.set(1.68, 1.0, 0);
  g.add(windshield);

  // side windows in a row
  for(let i=-1;i<=1;i++){
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), glassMat);
    win.position.set(i*0.95, 1.05, 0.576);
    g.add(win);
  }

  // wheels — a pair front and back on each side
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10);
  for(const wx of [1.15, -1.15]){
    for(const wz of [0.62, -0.62]){
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(wx, 0.32, wz);
      g.add(wheel);
    }
  }

  // headlights at the front
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.16), lightMatF);
  headL.position.set(1.71, 0.5, 0.4);
  g.add(headL);
  const headR = headL.clone(); headR.position.z = -0.4; g.add(headR);

  g.position.set(x, 0, z);
  return g;
}

function createFireSmoke(x, z){
  const g = new THREE.Group();

  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8),
    new THREE.MeshBasicMaterial({ color:0xff7a2a }));
  fire.position.y = 0.35;
  g.add(fire);
  const light = new THREE.PointLight(0xff6a2a, 1.6, 6);
  light.position.y = 0.6;
  g.add(light);
  g.position.set(x, 0, z);
  g.userData.isFire = true;
  g.userData.fireMesh = fire;
  g.userData.light = light;
  decorFires.push(g);
  return g;
}
let decorFires = [];
let smokeParticles = [];
function spawnSmokePuff(x, z){
  const mat = new THREE.MeshBasicMaterial({ color:0x6a6258, transparent:true, opacity:.5 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25 + Math.random()*0.2, 6, 6), mat);
  mesh.position.set(x + (Math.random()-0.5)*0.4, 0.6, z + (Math.random()-0.5)*0.4);
  scene.add(mesh);
  smokeParticles.push({ mesh, life: 140, maxLife: 140, vy: 0.008 + Math.random()*0.006 });
}

function createBody(x, z){
  const mat = new THREE.MeshStandardMaterial({ color:0x2a2420, roughness:1 });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), mat);
  torso.position.y = 0.06;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat);
  head.position.set(0, 0.08, 0.72);
  g.add(head);
  g.position.set(x, 0, z);
  g.rotation.y = Math.random()*Math.PI*2;
  return g;
}

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
function createGrassTuft(x, z){
  const mat = new THREE.MeshStandardMaterial({ color:0x5a7a3f, roughness:.9 });
  const g = new THREE.Group();
  for(let i=0;i<4;i++){
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28 + Math.random()*0.15, 4), mat);
    blade.position.set((Math.random()-0.5)*0.2, 0.14, (Math.random()-0.5)*0.2);
    blade.rotation.z = (Math.random()-0.5)*0.4;
    g.add(blade);
  }
  g.position.set(x, 0, z);
  return g;
}
function createPumpkin(x, z){
  const p = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6),
    new THREE.MeshStandardMaterial({ color:0xd9611a, roughness:.6, emissive:0x3d1a02, emissiveIntensity:.6 }));
  body.scale.y = 0.82; body.position.y = 0.24;
  p.add(body);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.14, 5),
    new THREE.MeshStandardMaterial({ color:0x3c5a2e, roughness:.8 }));
  stem.position.y = 0.48;
  p.add(stem);
  p.position.set(x, 0, z);
  return p;
}

// lay out city blocks in a grid, leaving road corridors clear
const BLOCK = 20, STREET_HALF_W = 3.2;
for(let bx=-4; bx<=4; bx++){
  for(let bz=-4; bz<=4; bz++){
    const cx = bx*BLOCK, cz = bz*BLOCK;
    if(Math.abs(cx) < 6 && Math.abs(cz) < 6) continue; // keep spawn area clear

    // 1-2 houses per block, offset from the block center so streets stay open
    const houseCount = 1 + Math.floor(Math.random()*2);
    for(let h=0; h<houseCount; h++){
      const hx = cx + (Math.random()-0.5)*8;
      const hz = cz + (Math.random()-0.5)*8;
      const w = 4 + Math.random()*2.5, d = 4 + Math.random()*2.5, ht = 3.2 + Math.random()*2.2;
      decorGroup.add(createHouse(hx, hz, w, d, ht));
      blockers.push({ x:hx, z:hz, radius: Math.max(w,d)/2 + 0.4 });
    }

    if(Math.random() < 0.5){
      decorGroup.add(createBush(cx + (Math.random()-0.5)*6, cz + (Math.random()-0.5)*6));
    }
    if(Math.random() < 0.35){
      decorGroup.add(createPumpkin(cx + (Math.random()-0.5)*6, cz + (Math.random()-0.5)*6));
    }
    for(let i=0;i<3;i++){
      if(Math.random() < 0.6) decorGroup.add(createGrassTuft(cx + (Math.random()-0.5)*9, cz + (Math.random()-0.5)*9));
    }
  }
}

// landmark buildings — fixed, distinctive locations so the city has real
// navigational reference points, not just repeating houses
const cityHall = createCityHall(0, -70);
decorGroup.add(cityHall);
blockers.push({ x:0, z:-70, radius: 10 });

const church = createChurch(-70, 25);
decorGroup.add(church);
blockers.push({ x:-70, z:25, radius: 8 });

const mall = createMall(70, 25);
decorGroup.add(mall);
blockers.push({ x:70, z:25, radius: 11 });

const movieHall = createMovieHall(0, 70);
decorGroup.add(movieHall);
blockers.push({ x:0, z:70, radius: 9 });

// cars scattered along streets (parked, decorative + collidable)
for(let i=0;i<70;i++){
  const alongX = Math.random() < 0.5;
  const laneOffset = (Math.random()-0.5)*STREET_HALF_W*1.4;
  const along = (Math.random()-0.5)*CITY_HALF*1.8;
  const x = alongX ? along : (Math.round((Math.random()*8-4))*BLOCK + laneOffset);
  const z = alongX ? (Math.round((Math.random()*8-4))*BLOCK + laneOffset) : along;
  decorGroup.add(createCar(x, z));
  blockers.push({ x, z, radius: 1.3 });
}

// moving vehicles: buses and cars actually driving along streets, not just parked
let vehicles = [];
function spawnMovingVehicle(isBus){
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const laneOffset = (Math.random()-0.5)*STREET_HALF_W*0.9;
  const gridLine = Math.round((Math.random()*8-4)) * BLOCK + laneOffset;
  const range = CITY_HALF * 0.85;
  const mesh = isBus ? createBus(0,0) : createCar(0,0);
  const radius = isBus ? 2.0 : 1.2;
  const speed = (isBus ? 3.0 : 4.5) + Math.random()*1.5;
  const startPos = (Math.random()-0.5) * range * 2;
  const dir = Math.random()<0.5?1:-1;
  if(axis === 'x'){
    mesh.position.set(startPos, 0, gridLine);
    mesh.rotation.y = dir > 0 ? 0 : Math.PI;
  } else {
    mesh.position.set(gridLine, 0, startPos);
    mesh.rotation.y = dir > 0 ? -Math.PI/2 : Math.PI/2;
  }
  scene.add(mesh);
  vehicles.push({ mesh, axis, gridLine, min: -range, max: range, speed, dir, radius });
}
for(let i=0;i<10;i++) spawnMovingVehicle(false);
for(let i=0;i<5;i++) spawnMovingVehicle(true);

// fire + smoke damage sites
for(let i=0;i<16;i++){
  const x = (Math.random()-0.5)*CITY_HALF*1.7;
  const z = (Math.random()-0.5)*CITY_HALF*1.7;
  decorGroup.add(createFireSmoke(x, z));
}

// fallen bodies, sparse, purely atmospheric
for(let i=0;i<26;i++){
  const x = (Math.random()-0.5)*CITY_HALF*1.8;
  const z = (Math.random()-0.5)*CITY_HALF*1.8;
  decorGroup.add(createBody(x, z));
}

// ---------- player movement state (temple-run style: turn + forward/back, no strafe) ----------
let facing = 0; // radians, current facing direction
let forwardSpeed = 0; // current forward velocity (negative = moving backward)
const MAX_FORWARD_SPEED = 6.5;
const MAX_BACKWARD_SPEED = 3.2;
const ACCEL = 16;
const TURN_SPEED = 1.5; // radians/sec, how fast turning input swings your facing
const PLAYER_RADIUS = 0.5;
let playerHealth = 3;
const MAX_HEALTH = 3;
let invulnTime = 0;
const LIFE_CAP = 5;
let lifePickups = [];
let lifeSpawnTimer = 0;
let lastStepSign = 0;

// cosmetic jump hop, temple-run feel
let playerY = 0, jumpVelY = 0, isJumping = false;
const JUMP_GRAVITY = -0.028;
const JUMP_VELOCITY = 0.32;
function tryJump(){
  if(!isJumping){ isJumping = true; jumpVelY = JUMP_VELOCITY; }
}

function updateMovement(dt){
  const kb = readKeyboardAxes();
  let turnInput = kb.dx + joystickDX;
  let throttleInput = -(kb.dz + joystickDZ);
  turnInput = Math.max(-1, Math.min(1, turnInput));
  throttleInput = Math.max(-1, Math.min(1, throttleInput));

  facing -= turnInput * TURN_SPEED * dt;

  const targetSpeed = throttleInput >= 0 ? throttleInput * MAX_FORWARD_SPEED : throttleInput * MAX_BACKWARD_SPEED;
  const speedDiff = targetSpeed - forwardSpeed;
  const maxDelta = ACCEL * dt;
  forwardSpeed = (Math.abs(speedDiff) < maxDelta) ? targetSpeed : forwardSpeed + Math.sign(speedDiff) * maxDelta;

  if(Math.abs(forwardSpeed) > 0.001){
    let nx = player.position.x + Math.sin(facing) * forwardSpeed * dt;
    let nz = player.position.z + Math.cos(facing) * forwardSpeed * dt;
    nx = Math.max(-CITY_HALF+1, Math.min(CITY_HALF-1, nx));
    nz = Math.max(-CITY_HALF+1, Math.min(CITY_HALF-1, nz));
    for(const b of blockers){
      const ddx = nx - b.x, ddz = nz - b.z;
      const dist = Math.sqrt(ddx*ddx + ddz*ddz);
      const minDist = b.radius + PLAYER_RADIUS;
      if(dist < minDist && dist > 0.0001){
        nx = b.x + (ddx/dist) * minDist;
        nz = b.z + (ddz/dist) * minDist;
        forwardSpeed *= 0.5; // bumping into something bleeds off speed
      }
    }
    for(const v of vehicles){
      const ddx = nx - v.mesh.position.x, ddz = nz - v.mesh.position.z;
      const dist = Math.sqrt(ddx*ddx + ddz*ddz);
      const minDist = v.radius + PLAYER_RADIUS;
      if(dist < minDist && dist > 0.0001){
        nx = v.mesh.position.x + (ddx/dist) * minDist;
        nz = v.mesh.position.z + (ddz/dist) * minDist;
        forwardSpeed *= 0.4; // getting clipped by traffic bleeds off more speed
      }
    }
    player.position.x = nx;
    player.position.z = nz;
  }

  if(isJumping){
    jumpVelY += JUMP_GRAVITY;
    playerY += jumpVelY;
    if(playerY <= 0){ playerY = 0; isJumping = false; jumpVelY = 0; }
  }
  player.position.y = playerY;

  return { moving: Math.abs(forwardSpeed) > 0.3 };
}

// ---------- keyboard input ----------
const keys = {};
window.addEventListener('keydown', (e)=>{
  keys[e.code] = true;
  if(e.code === 'Escape' || e.code === 'KeyP'){ togglePause(); }
  if(e.code === 'Space' && running && !paused) tryJump();
});
window.addEventListener('keyup', (e)=>{ keys[e.code] = false; });

function readKeyboardAxes(){
  let dx = 0, dz = 0;
  if(keys['KeyW'] || keys['ArrowUp']) dz -= 1;
  if(keys['KeyS'] || keys['ArrowDown']) dz += 1;
  if(keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
  if(keys['KeyD'] || keys['ArrowRight']) dx += 1;
  return { dx, dz };
}

// ---------- joystick (touch) ----------
const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');
let joystickActive = false, joystickDX = 0, joystickDZ = 0, joystickTouchId = null;
joystickZone.addEventListener('touchstart', (e)=>{
  const t = e.changedTouches[0];
  joystickTouchId = t.identifier;
  joystickActive = true;
}, { passive:true });
joystickZone.addEventListener('touchmove', (e)=>{
  if(!joystickActive) return;
  let touch = null;
  for(const t of e.changedTouches){ if(t.identifier === joystickTouchId) touch = t; }
  if(!touch) return;
  const rect = joystickZone.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  let dx = (touch.clientX - cx) / (rect.width/2);
  let dz = (touch.clientY - cy) / (rect.height/2);
  const mag = Math.sqrt(dx*dx+dz*dz);
  if(mag > 1){ dx /= mag; dz /= mag; }
  joystickDX = dx; joystickDZ = dz;
  joystickKnob.style.transform = `translate(-50%,-50%) translate(${dx*36}px, ${dz*36}px)`;
}, { passive:true });
function endJoystick(e){
  joystickActive = false; joystickDX = 0; joystickDZ = 0; joystickTouchId = null;
  joystickKnob.style.transform = 'translate(-50%,-50%)';
}
joystickZone.addEventListener('touchend', endJoystick, { passive:true });
joystickZone.addEventListener('touchcancel', endJoystick, { passive:true });

document.getElementById('shootBtn').addEventListener('touchstart', (e)=>{
  e.preventDefault();
  if(running && !paused) tryShoot();
}, { passive:false });
document.getElementById('jumpBtn').addEventListener('touchstart', (e)=>{
  e.preventDefault();
  if(running && !paused) tryJump();
}, { passive:false });
canvas.addEventListener('mousedown', ()=>{ if(running && !paused) tryShoot(); });

// ---------- camera follow ----------
// slower lerp than before so turning the character doesn't whip the camera around
const CAM_BACK = 5.2, CAM_UP = 2.7, CAM_LOOK_UP = 1.3;
function updateCamera(){
  const camX = player.position.x - Math.sin(facing) * CAM_BACK;
  const camZ = player.position.z - Math.cos(facing) * CAM_BACK;
  camera.position.x += (camX - camera.position.x) * 0.07;
  camera.position.y += (CAM_UP - camera.position.y) * 0.07;
  camera.position.z += (camZ - camera.position.z) * 0.07;
  const lookX = player.position.x + Math.sin(facing) * 4;
  const lookZ = player.position.z + Math.cos(facing) * 4;
  camera.lookAt(lookX, CAM_LOOK_UP, lookZ);
}
camera.position.set(player.position.x, CAM_UP, player.position.z + CAM_BACK);

// ---------- shooting ----------
let tracers = [];
const SHOOT_RANGE = 22, SHOOT_CONE = 0.5; // radians half-angle
const NOISE_RADIUS = 16;
function tryShoot(){
  sfxShoot();
  const forward = { x: Math.sin(facing), z: Math.cos(facing) };
  let best = null, bestDist = SHOOT_RANGE;
  for(const j of jumbies){
    if(!j.alive) continue;
    const ddx = j.mesh.position.x - player.position.x;
    const ddz = j.mesh.position.z - player.position.z;
    const dist = Math.sqrt(ddx*ddx + ddz*ddz);
    if(dist > SHOOT_RANGE || dist < 0.001) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (ddx*forward.x + ddz*forward.z)/dist)));
    if(angle < SHOOT_CONE && dist < bestDist){ best = j; bestDist = dist; }
  }
  // tracer visual toward hit target or straight ahead
  const targetPos = best ? best.mesh.position.clone() : new THREE.Vector3(
    player.position.x + forward.x*SHOOT_RANGE, 1.4, player.position.z + forward.z*SHOOT_RANGE);
  const startPos = new THREE.Vector3(player.position.x + forward.x*0.6, 1.4, player.position.z + forward.z*0.6);
  const tracerGeo = new THREE.BufferGeometry().setFromPoints([startPos, targetPos]);
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color:0xfff2c0, transparent:true, opacity:.9 }));
  scene.add(tracer);
  tracers.push({ mesh: tracer, life: 6 });

  // gunfire alerts nearby idle jumbies even if they haven't seen the player yet
  for(const j of jumbies){
    if(!j.alive || j.state !== 'idle') continue;
    const ddx = j.mesh.position.x - player.position.x;
    const ddz = j.mesh.position.z - player.position.z;
    if(Math.sqrt(ddx*ddx+ddz*ddz) < NOISE_RADIUS) j.state = 'chase';
  }

  if(best){
    best.health--;
    sfxHitJumbie();
    if(best.health <= 0){
      killJumbie(best);
    }
  }
}

function killJumbie(j){
  j.alive = false;
  sfxKillJumbie();
  removeFromScene(j.mesh);
  kills++;
  jumbiesRemaining--;
  updateHUD();
  if(!poozaRevealed && kills >= KILLS_TO_REVEAL){
    poozaRevealed = true;
    poozaMesh.visible = true;
    poozaBeam.visible = true;
    flashBanner('POOZA SPOTTED');
    sfxWave();
  }
  if(jumbiesRemaining <= 0 && running && !paused){
    spawnNextWave();
  }
}

// ---------- jumbies & waves ----------
let jumbies = [];
let jumbiesRemaining = 0;
let wave = 1;
let kills = 0;
const JUMBIE_SPEED = 3.6;
const SIGHT_RADIUS = 13;
const ATTACK_RANGE = 1.1;

function spawnJumbie(){
  const roll = Math.random();
  const kind = roll < 0.55 ? 'ghost' : (roll < 0.8 ? 'skeleton' : 'neon');
  const mesh = createJumbieMesh(kind);
  let x, z, tries = 0;
  do{
    x = (Math.random()-0.5)*CITY_HALF*1.8;
    z = (Math.random()-0.5)*CITY_HALF*1.8;
    tries++;
  } while(Math.sqrt((x-player.position.x)**2 + (z-player.position.z)**2) < 15 && tries < 20);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const health = kind === 'neon' ? 2 : 1;
  jumbies.push({ mesh, kind, health, alive:true, state:'idle', bobSeed: Math.random()*10, attackCooldown:0 });
}

function spawnWave(count){
  for(let i=0;i<count;i++) spawnJumbie();
  jumbiesRemaining = count;
  updateHUD();
}
function spawnNextWave(){
  wave++;
  const count = 10 + Math.floor((wave-1) * (2 + Math.random()));
  flashBanner('WAVE ' + wave);
  sfxWave();
  spawnWave(count);
}

function updateJumbies(dt){
  for(const j of jumbies){
    if(!j.alive) continue;
    const ddx = player.position.x - j.mesh.position.x;
    const ddz = player.position.z - j.mesh.position.z;
    const dist = Math.sqrt(ddx*ddx + ddz*ddz);

    if(j.state === 'idle'){
      j.mesh.position.x += Math.sin(frameCount*0.01 + j.bobSeed) * 0.004;
      j.mesh.position.z += Math.cos(frameCount*0.013 + j.bobSeed) * 0.004;
      if(dist < SIGHT_RADIUS) j.state = 'chase';
    } else if(j.state === 'chase'){
      if(dist > 0.01){
        let nx = j.mesh.position.x + (ddx/dist) * JUMBIE_SPEED * dt;
        let nz = j.mesh.position.z + (ddz/dist) * JUMBIE_SPEED * dt;
        for(const b of blockers){
          const bdx = nx - b.x, bdz = nz - b.z;
          const bd = Math.sqrt(bdx*bdx + bdz*bdz);
          const minD = b.radius + 0.4;
          if(bd < minD && bd > 0.0001){ nx = b.x + (bdx/bd)*minD; nz = b.z + (bdz/bd)*minD; }
        }
        j.mesh.position.x = nx; j.mesh.position.z = nz;
        j.mesh.rotation.y = Math.atan2(ddx, ddz);
      }
      if(dist < ATTACK_RANGE) j.state = 'attack';
    } else if(j.state === 'attack'){
      if(dist > ATTACK_RANGE * 1.4){ j.state = 'chase'; }
      else{
        j.attackCooldown -= dt;
        if(j.attackCooldown <= 0){
          j.attackCooldown = 1.0;
          damagePlayer();
        }
      }
    }
    j.mesh.position.y = Math.sin(frameCount*0.08 + j.bobSeed) * 0.06;
  }
}

function damagePlayer(){
  if(invulnTime > 0) return;
  playerHealth--;
  sfxPlayerHurt();
  invulnTime = 60;
  updateHUD();
  if(playerHealth <= 0) finishRun(false);
}

// ---------- life pickups: scattered around the city, respawn over time ----------
function createLifePickupMesh(){
  const mat = new THREE.MeshStandardMaterial({ color:0xff4d4d, emissive:0x6a0000, emissiveIntensity:.9, roughness:.3, metalness:.4 });
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), mat);
}
function spawnLifePickup(){
  let x, z, tries = 0;
  do{
    x = (Math.random()-0.5)*CITY_HALF*1.7;
    z = (Math.random()-0.5)*CITY_HALF*1.7;
    tries++;
  } while(Math.sqrt((x-player.position.x)**2 + (z-player.position.z)**2) < 8 && tries < 20);
  const mesh = createLifePickupMesh();
  mesh.position.set(x, 1.1, z);
  scene.add(mesh);
  lifePickups.push({ mesh, x, z, bobSeed: Math.random()*10 });
}
function updateLifePickups(){
  for(const lp of lifePickups) lp.mesh.rotation.y += 0.05;
  for(let i=lifePickups.length-1; i>=0; i--){
    const lp = lifePickups[i];
    const dx = player.position.x - lp.x, dz = player.position.z - lp.z;
    if(Math.sqrt(dx*dx+dz*dz) < 1.0){
      if(playerHealth < LIFE_CAP){ playerHealth++; sfxLifeUp(); updateHUD(); }
      removeFromScene(lp.mesh);
      lifePickups.splice(i,1);
    }
  }
  lifeSpawnTimer--;
  if(lifeSpawnTimer <= 0){
    lifeSpawnTimer = 900 + Math.floor(Math.random()*600); // every ~15-25 seconds
    if(lifePickups.length < 4 && playerHealth < LIFE_CAP) spawnLifePickup();
  }
}

// ---------- UI wiring ----------
const overlay = document.getElementById('overlay');
const startPanelBody = document.getElementById('startPanelBody');
const countdownPanelBody = document.getElementById('countdownPanelBody');
const pausePanelBody = document.getElementById('pausePanelBody');
const endPanelBody = document.getElementById('endPanelBody');
const nameInput = document.getElementById('nameInput');
const bannerMsg = document.getElementById('bannerMsg');
const bannerText = document.getElementById('bannerText');
const countdownNumber = document.getElementById('countdownNumber');

let running = false;
let paused = false;
let frameCount = 0;

document.getElementById('startBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('retryBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('exitBtn').addEventListener('click', ()=>{
  stopHeartRain();
  endPanelBody.style.display = 'none';
  startPanelBody.style.display = 'block';
});

const muteBtn = document.getElementById('muteBtn');
function updateMuteBtn(){ muteBtn.textContent = soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07'; }
updateMuteBtn();
muteBtn.addEventListener('click', ()=>{
  soundOn = !soundOn;
  try{ localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch(e){ /* ignore */ }
  updateMuteBtn();
  if(soundOn){ ensureAudio(); if(running) startAmbient(); } else { stopAmbient(); }
});

const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.addEventListener('click', togglePause);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('pauseRestartBtn').addEventListener('click', ()=>{
  paused = false;
  pausePanelBody.style.display = 'none';
  overlay.classList.add('hidden');
  beginSequence();
});
document.getElementById('pauseExitBtn').addEventListener('click', ()=>{
  running = false; paused = false;
  stopAmbient();
  pausePanelBody.style.display = 'none';
  startPanelBody.style.display = 'block';
});
function togglePause(){
  if(!running) return;
  paused = !paused;
  if(paused){
    try{ if(audioCtx && audioCtx.state==='running') audioCtx.suspend(); }catch(e){}
    startPanelBody.style.display = 'none';
    countdownPanelBody.style.display = 'none';
    endPanelBody.style.display = 'none';
    pausePanelBody.style.display = 'block';
    overlay.classList.remove('hidden');
  } else {
    try{ if(audioCtx && audioCtx.state==='suspended') audioCtx.resume(); }catch(e){}
    pausePanelBody.style.display = 'none';
    overlay.classList.add('hidden');
  }
}

let bannerTimeout = null;
function flashBanner(text){
  bannerText.textContent = text;
  bannerMsg.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(()=> bannerMsg.classList.remove('show'), 1600);
}

const poozaMessageEl = document.getElementById('poozaMessage');
function showPoozaMessage(){
  poozaMessageEl.classList.add('show');
}
function hidePoozaMessage(){
  poozaMessageEl.classList.remove('show');
}

function startHeartRain(){
  const container = document.getElementById('heartRain');
  if(!container) return;
  container.innerHTML = '';
  for(let i=0;i<44;i++){
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
    if(count > 0){ countdownNumber.textContent = count; }
    else{
      clearInterval(timer);
      countdownPanelBody.style.display = 'none';
      overlay.classList.add('hidden');
      startGame();
    }
  }, 800);
}

function startGame(){
  stopHeartRain();
  hidePoozaMessage();
  jumbies.forEach(j=>{ if(j.alive) removeFromScene(j.mesh); });
  jumbies = [];
  tracers.forEach(t=>removeFromScene(t.mesh));
  tracers = [];
  smokeParticles.forEach(p=>removeFromScene(p.mesh));
  smokeParticles = [];
  lifePickups.forEach(l=>removeFromScene(l.mesh));
  lifePickups = [];

  player.position.set(0, 0, 30);
  facing = 0;
  playerHealth = MAX_HEALTH;
  invulnTime = 0;
  wave = 1;
  kills = 0;
  lastStepSign = 0;
  poozaFound = false;
  celebrating = false;
  celebrateTimer = 0;
  poozaRevealed = false;
  poozaMesh.visible = false;
  poozaBeam.visible = false;
  scene.fog.color.copy(SMOKY_COLOR);
  scene.background.copy(SMOKY_COLOR);
  sunLight.intensity = 1.3;

  try{ localStorage.setItem('jumbieHunt.lastName', nameInput.value.trim()); } catch(e){}

  spawnWave(10);
  for(let i=0;i<3;i++) spawnLifePickup();
  lifeSpawnTimer = 900;
  startAmbient();
  running = true;
  paused = false;
  overlay.classList.add('hidden');
  updateHUD();
}

function finishRun(victory){
  running = false;
  stopAmbient();
  if(victory) sfxVictory(); else sfxGameOver();

  const endHeading = document.getElementById('endHeading');
  const endSub = document.getElementById('endSub');
  if(victory){
    endHeading.textContent = 'You Found Her';
    endSub.textContent = 'Princess Pooza is safe. The city can breathe again.';
    startHeartRain();
  } else {
    endHeading.textContent = 'You Fell';
    endSub.textContent = 'The jumbies got too close...';
  }
  document.getElementById('finalWave').textContent = wave;
  document.getElementById('finalKills').textContent = kills;

  if(window.JumbieHuntAPI && typeof window.JumbieHuntAPI.onRunEnd === 'function'){
    window.JumbieHuntAPI.onRunEnd({ victory, wave, kills });
  }

  startPanelBody.style.display = 'none';
  countdownPanelBody.style.display = 'none';
  pausePanelBody.style.display = 'none';
  endPanelBody.style.display = 'block';
  overlay.classList.remove('hidden');
}

function updateHUD(){
  const heartsEl = document.getElementById('healthVal');
  let hearts = '';
  for(let i=0;i<playerHealth;i++) hearts += '\u2665';
  heartsEl.textContent = hearts || '\u2661';
  document.getElementById('waveVal').textContent = wave;
  document.getElementById('jumbieVal').textContent = Math.max(0, jumbiesRemaining);
  document.getElementById('killsVal').textContent = poozaRevealed
    ? 'FOUND HER'
    : Math.min(kills, KILLS_TO_REVEAL) + '/' + KILLS_TO_REVEAL;
}

// ---------- main loop ----------
let lastTime = performance.now();
function animate(){
  requestAnimationFrame(animate);
  if(fatalErrorShown) return;

  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  try{
    frameCount++;

    if(running && !paused){
      if(celebrating){
        celebrateTimer--;
        poozaMesh.rotation.y += 0.02;
        const progress = 1 - (celebrateTimer / 420);
        scene.fog.color.copy(SMOKY_COLOR).lerp(SUNRISE_COLOR, progress);
        scene.background.copy(SMOKY_COLOR).lerp(SUNRISE_COLOR, progress);
        sunLight.intensity = 1.3 + progress * 0.9;
        if(celebrateTimer <= 0){
          celebrating = false;
          hidePoozaMessage();
          finishRun(true);
        }
      } else {
      // movement: turn-based steering (keyboard + joystick combined inside updateMovement)
      const moveResult = updateMovement(dt);
      player.rotation.y = facing;

      const moving = moveResult.moving;
      if(moving){
        const runSpeed = 0.25 + Math.abs(forwardSpeed) * 0.03;
        const swing = Math.sin(frameCount*runSpeed) * 0.7;
        const stepSign = Math.sign(swing);
        if(stepSign !== 0 && stepSign !== lastStepSign){
          lastStepSign = stepSign;
          sfxFootstep(Math.abs(forwardSpeed) > 4.5, stepSign);
        }
        playerRig.leftLeg.rotation.x  += (swing - playerRig.leftLeg.rotation.x) * 0.4;
        playerRig.rightLeg.rotation.x += (-swing - playerRig.rightLeg.rotation.x) * 0.4;
        playerRig.leftArm.rotation.x  += (-swing*0.7 - playerRig.leftArm.rotation.x) * 0.4;
      } else {
        playerRig.leftLeg.rotation.x *= 0.8;
        playerRig.rightLeg.rotation.x *= 0.8;
        playerRig.leftArm.rotation.x *= 0.8;
      }

      if(invulnTime > 0){
        invulnTime--;
        player.visible = Math.floor(invulnTime/4) % 2 === 0;
      } else {
        player.visible = true;
      }

      updateJumbies(dt);
      vehicles.forEach(v=>{
        const delta = v.speed * v.dir * dt;
        if(v.axis === 'x') v.mesh.position.x += delta;
        else v.mesh.position.z += delta;
        const pos = v.axis === 'x' ? v.mesh.position.x : v.mesh.position.z;
        if(pos > v.max || pos < v.min){
          v.dir *= -1;
          v.mesh.rotation.y = v.axis === 'x'
            ? (v.dir > 0 ? 0 : Math.PI)
            : (v.dir > 0 ? -Math.PI/2 : Math.PI/2);
        }
      });
      updateLifePickups();

      // tracers fade out
      tracers = tracers.filter(t=>{
        t.life--;
        t.mesh.material.opacity = Math.max(0, t.life/6);
        if(t.life <= 0){ removeFromScene(t.mesh); return false; }
        return true;
      });

      // smoke puffs from fire sites
      if(frameCount % 12 === 0){
        for(const f of decorFires){ spawnSmokePuff(f.position.x, f.position.z); }
      }
      smokeParticles = smokeParticles.filter(p=>{
        p.life--;
        p.mesh.position.y += p.vy;
        p.mesh.material.opacity = Math.max(0, 0.5 * (p.life/p.maxLife));
        p.mesh.scale.multiplyScalar(1.004);
        if(p.life <= 0){ removeFromScene(p.mesh); return false; }
        return true;
      });
      // fire flicker
      if(frameCount % 3 === 0){
        for(const f of decorFires){ f.userData.light.intensity = 1.2 + Math.random()*0.8; }
      }

      // Pooza rescue check
      if(poozaRevealed && !poozaFound){
        const pdx = player.position.x - POOZA_POS.x;
        const pdz = player.position.z - POOZA_POS.z;
        if(Math.sqrt(pdx*pdx + pdz*pdz) < 2.2){
          poozaFound = true;
          celebrating = true;
          celebrateTimer = 420; // 7 seconds
          sfxVictory();
          showPoozaMessage();
        }
      }

      updateCamera();
      }
    }

    renderer.render(scene, camera);
  } catch(err){
    console.error('Frame error:', err);
    showFatalError('Something interrupted the game. Tap below to reload and keep going.');
  }
}

// ---------- multiplayer hook: a small controlled API, nothing else in this
// file needs to know multiplayer.js exists ----------
window.JumbieHuntAPI = {
  scene,
  buildHumanoid,
  removeFromScene,
  getPlayerState: () => ({ x: player.position.x, z: player.position.z, facing }),
  isActive: () => running && !paused,
  getPlayerName: () => (nameInput.value || '').trim() || 'Explorer',
  // multiplayer.js sets this; finishRun() calls it if present so a global
  // leaderboard can be submitted without game.js needing to know how
  onRunEnd: null
};

animate();

})();
