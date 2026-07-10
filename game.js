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

// ---------- basic setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0c0a08, 14, 60);
scene.background = new THREE.Color(0x0c0a08);

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
scene.add(new THREE.AmbientLight(0x554433, 1.1));
const torchLight = new THREE.PointLight(0xff9a3d, 2, 20);
torchLight.position.set(0, 4, 4);
scene.add(torchLight);
const moonLight = new THREE.DirectionalLight(0x8899cc, 0.5);
moonLight.position.set(-5, 10, -10);
scene.add(moonLight);

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

function makeGroundSegment(zPos){
  const g = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color:0x3a3226, roughness:.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, SEGMENT_LEN), floorMat);
  floor.position.set(0, -0.2, zPos);
  g.add(floor);

  for(const side of [-1,1]){
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 4.2, SEGMENT_LEN),
      new THREE.MeshStandardMaterial({ color:0x2a241b, roughness:.9 })
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

// ---------- obstacles & coins ----------
let obstacles = [];
let coins = [];
let particles = [];

function pickObstacleType(level){
  const types = ['barrier','beam','gap'];
  if(level === 1 && Math.random() < 0.09) types.push('jumbie'); // rare level-1 cameo, ~1-2 per run
  if(level >= 2) types.push('jumbie');
  if(level >= 8) types.push('jumbie'); // extra weight only once things ramp back up late-game
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
      new THREE.MeshStandardMaterial({ color:0x120a1a, roughness:1 })
    );
    group.add(pit);

    // glowing warning rim traced around the edge, like carved temple hazard glyphs
    const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.86, 0.22, 1.86));
    const rimMat = new THREE.LineBasicMaterial({ color:0xff9a3d, transparent:true, opacity:.9 });
    const rim = new THREE.LineSegments(rimGeo, rimMat);
    group.add(rim);

    // faint glowing floor decal just past the rim, extra visibility from a distance
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ color:0xff9a3d, transparent:true, opacity:.16, side:THREE.DoubleSide })
    );
    glow.rotation.x = -Math.PI/2;
    glow.position.y = 0.11;
    group.add(glow);

    group.position.set(LANE_X[lane], -0.15, z);
    scene.add(group);
    obstacles.push({ mesh: group, lane, z, type:'gap' });
  } else if(type === 'jumbie'){
    const mesh = createJumbieMesh();
    mesh.position.set(LANE_X[lane], 0, z);
    scene.add(mesh);
    obstacles.push({ mesh, lane, z, type:'jumbie', bobSeed: Math.random()*10, baseX: LANE_X[lane] });
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
}

function spawnCoinBurst(position){
  for(let i=0;i<7;i++){
    const mat = new THREE.MeshBasicMaterial({ color:0xffd54a, transparent:true, opacity:1 });
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

// ---------- game state ----------
const LEVEL_DISTANCE = 130;   // meters of distance per level
const MAX_LEVEL = 10;
let speed = 0.20;
let distance = 0;
let coinCount = 0;
let level = 1;
let running = false;
let nextSpawnZ = -14;
let shakeTime = 0;

const MAX_LIVES = 3;
let lives = MAX_LIVES;
let invulnTime = 0;

const FIND_DISTANCE = 900; // distance at which Pooza is found
let foundPrincess = false;

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
  const newLane = laneIndex + dir;
  if(newLane < 0 || newLane > 2) return;
  laneIndex = newLane;
  targetX = LANE_X[laneIndex];
}
function tryJump(){
  if(!isJumping && !isSliding){
    isJumping = true;
    velY = 0.34;
  }
}
function trySlide(){
  if(!isJumping){
    isSliding = true;
    slideTimer = 32;
  }
}

// ---------- keyboard input ----------
window.addEventListener('keydown', (e)=>{
  if(!running) return;
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
const countdownNumber = document.getElementById('countdownNumber');

nameInput.value = (function(){
  try{ return localStorage.getItem(NAME_KEY) || ''; } catch(e){ return ''; }
})();
renderLeaderboard(document.getElementById('startLeaderboardList'));

document.getElementById('startBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('retryBtn').addEventListener('click', ()=>{ ensureAudio(); beginSequence(); });
document.getElementById('exitBtn').addEventListener('click', ()=>{
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
  if(soundOn){ ensureAudio(); sfxCoin(); }
});

let levelUpTimeout = null;
function flashLevelUp(lvl){
  levelUpText.textContent = 'LEVEL ' + lvl;
  levelUpBanner.classList.add('show');
  clearTimeout(levelUpTimeout);
  levelUpTimeout = setTimeout(()=> levelUpBanner.classList.remove('show'), 1400);
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
  obstacles.forEach(o=>scene.remove(o.mesh));
  coins.forEach(c=>scene.remove(c.mesh));
  particles.forEach(p=>scene.remove(p.mesh));
  obstacles = []; coins = []; particles = [];

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
  foundPrincess = false;
  player.visible = true;
  camera.position.x = CAM_BASE.x; camera.position.y = CAM_BASE.y;

  try{ localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch(e){ /* ignore */ }

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

  const finalScore = computeScore();
  const playerName = (nameInput.value || '').trim() || 'Explorer';
  const board = submitScore(playerName, finalScore, level, coinCount);
  const isNewBest = board.length > 0 && board[0].score === Math.floor(finalScore) && (Date.now() - board[0].date) < 2000;

  const endHeading = document.getElementById('endHeading');
  const endSub = document.getElementById('endSub');
  if(victory){
    endHeading.textContent = 'I LOVE YOU';
    endSub.textContent = 'You found Princess Pooza in the ruins.';
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
  for(let i=0;i<MAX_LIVES;i++) hearts += (i < lives) ? '\u2665' : '\u2661';
  heartsEl.textContent = hearts;
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
      scene.remove(c.mesh);
      coins.splice(i,1);
      coinCount++;
    }
  }
}

// ---------- main loop ----------
let frameCount = 0;
function animate(){
  requestAnimationFrame(animate);
  frameCount++;

  if(running){
    const prevLevel = level;
    level = computeLevel(distance);
    speed = computeSpeed(distance, level);
    if(level !== prevLevel) flashLevelUp(level);

    distance += speed * 0.6;

    if(!foundPrincess && distance >= FIND_DISTANCE){
      foundPrincess = true;
      spawnCoinBurst(player.position);
      finishRun(true);
    }

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
    segments.forEach(s=>{ s.z += dz; s.mesh.position.z = s.z; });

    segments.forEach(s=>{
      if(s.z > 14){
        s.z -= SEGMENT_LEN * SEGMENTS_VISIBLE;
        s.mesh.position.z = s.z;
      }
    });

    obstacles = obstacles.filter(o=>{
      if(o.z > 14){ scene.remove(o.mesh); return false; }
      return true;
    });
    coins = coins.filter(c=>{
      if(c.z > 14){ scene.remove(c.mesh); return false; }
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
      if(p.life <= 0){ scene.remove(p.mesh); return false; }
      return true;
    });

    // torch flicker
    if(frameCount % 4 === 0){
      flameMeshes.forEach(f=>{ f.material.emissiveIntensity = 0.9 + Math.random()*0.7; });
    }

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

    if(running){ // finishRun(true) may have fired above on this same frame
      checkCollisions();
      updateHUD();
    }
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
}

animate();

})();
