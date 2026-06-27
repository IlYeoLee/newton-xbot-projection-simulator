import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

let scene;
let camera;
let renderer;
let controls;
let clock;
let loader;
let modelRoot = null;
let mixer = null;
let activeAction = null;
let paused = false;
let leftKnee = null;
let rightKnee = null;
let spineBone = null;
let eyeBone = null;
let floorPlane;
let wallPlane;
let floorBeamL;
let floorBeamR;
let wallBeam;
let kneeBoxL;
let kneeBoxR;
let backBox;
let externalWallProjector;
let ground;
let wall;
let grid;
let wallGrid;
let currentPreset = 'running';
let currentMotion = '';
let currentView = 'orbit';
let stabilize = true;
let floorBeamVisible = true;
let wallBeamVisible = true;
let activeSurface = 'floor';
let yaw = 180;
let targetHeight = 1.7;
let tau = 0.18;
let kneeSide = 'right';
let modelLoaded = false;
let qStabFloor = new THREE.Vector3(0, 0.012, -1.15);
let qStabWall = new THREE.Vector3(0, 1.18, -2.25);
let previousPreset = currentPreset;
let rawPhase = 0;
let modelHeight = 1.7;
const userPosition = new THREE.Vector3(0, 0, 0);
const moveKeys = new Set();
const eyeFiltered = new THREE.Vector3(0, 1.58, 0.15);
const lookFiltered = new THREE.Vector3(0, 1.36, -2.2);
let gaitPhase = 0;

const DEFAULT_SURFACE_STATE = {
  floor: {
    text: '텍스트를 입력하세요',
    textSize: 28,
    textX: 0,
    textY: 0,
    graphicType: 'footprint',
    graphicSize: 250,
    graphicX: 0,
    graphicY: 0,
    image: null
  },
  wall: {
    text: '텍스트를 입력하세요',
    textSize: 32,
    textX: 0,
    textY: 0,
    graphicType: 'none',
    graphicSize: 250,
    graphicX: 0,
    graphicY: 0,
    image: null
  }
};
const surfaceState = structuredClone(DEFAULT_SURFACE_STATE);
const surfaceTextures = {
  floor: createCanvasTexture(1024, 512),
  wall: createCanvasTexture(512, 1024)
};

const animRegistry = new Map();
const assetUrl = (path) => new URL(path, import.meta.url).href;

const ASSETS = {
  model: assetUrl('../assets/xbot.fbx'),
  motions: {
    Running: assetUrl('../assets/anim-running.fbx'),
    'Standard Run': assetUrl('../assets/anim-standard-run.fbx'),
    Hook: assetUrl('../assets/anim-hook.fbx'),
    'MMA Kick': assetUrl('../assets/anim-mma-kick.fbx'),
    'Kettlebell Swing': assetUrl('../assets/anim-kettlebell-swing.fbx'),
    'Start Jumping Jacks': assetUrl('../assets/anim-jumping-jacks.fbx'),
    'Hip Hop Dancing': assetUrl('../assets/anim-hiphop.fbx')
  }
};

const PRESETS = {
  running: { label: '러닝 / 걷기', motions: ['Running', 'Standard Run'], floor: [0, 0.012, -1.0], wall: [0, 1.18, -2.25], height: 170, yaw: 180, tau: 0.03, fov: 65, pitch: -10, floorW: 95, floorD: 160, wallW: 42, wallH: 155 },
  boxing: { label: '복싱 / 격투', motions: ['Hook', 'MMA Kick'], floor: [0, 0.012, -1.0], wall: [0, 1.25, -2.05], height: 170, yaw: 180, tau: 0.08, fov: 60, pitch: -5, floorW: 90, floorD: 160, wallW: 48, wallH: 150 },
  fitness: { label: '홈트 / 근력', motions: ['Kettlebell Swing', 'Start Jumping Jacks'], floor: [0, 0.012, -1.0], wall: [0, 1.25, -2.15], height: 170, yaw: 180, tau: 0.1, fov: 60, pitch: -5, floorW: 110, floorD: 160, wallW: 50, wallH: 160 },
  dance: { label: '댄스 / 리듬', motions: ['Hip Hop Dancing'], floor: [0, 0.012, -1.0], wall: [0, 1.35, -2.35], height: 170, yaw: 180, tau: 0.1, fov: 62, pitch: -4, floorW: 120, floorD: 160, wallW: 55, wallH: 170 }
};

init();

function by(id) {
  return document.getElementById(id);
}

function log(message) {
  by('log').textContent = `${message}\n${by('log').textContent}`.slice(0, 1800);
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);
  scene.fog = new THREE.FogExp2(0x101010, 0.075);
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.02, 80);
  camera.position.set(2.7, 1.8, 3.1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  by('view').appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0.9, -0.75);
  clock = new THREE.Clock();
  loader = new FBXLoader();

  scene.add(new THREE.AmbientLight(0xffffff, 0.38));
  const d = new THREE.DirectionalLight(0xffffff, 0.8);
  d.position.set(3, 6, 4);
  d.castShadow = true;
  scene.add(d);

  ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  grid = new THREE.GridHelper(8, 16, 0x6a2020, 0x333333);
  grid.position.y = 0.002;
  scene.add(grid);

  wall = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.75 }));
  wall.position.set(0, 1.7, -2.28);
  wall.receiveShadow = true;
  scene.add(wall);

  wallGrid = new THREE.GridHelper(4.5, 9, 0x6a2020, 0x444444);
  wallGrid.rotation.x = Math.PI / 2;
  wallGrid.position.set(0, 1.7, -2.275);
  scene.add(wallGrid);

  makeProjectionSurfaces();
  bind();
  setActiveSurface('floor');
  updateBeamToggleLabels();
  setPreset('running', false);
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  autoLoadAssets();
}

function makeProjectionSurfaces() {
  floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: surfaceTextures.floor.texture, side: THREE.DoubleSide, transparent: true }));
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.scale.set(0.95, 1.35, 1);
  scene.add(floorPlane);

  wallPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: surfaceTextures.wall.texture, side: THREE.DoubleSide, transparent: true }));
  wallPlane.scale.set(0.42, 1.55, 1);
  scene.add(wallPlane);

  floorBeamL = beamMesh();
  floorBeamR = beamMesh();
  wallBeam = beamMesh();
  scene.add(floorBeamL, floorBeamR, wallBeam);

  kneeBoxL = box(0.065, 0xff2828);
  kneeBoxR = box(0.065, 0xff2828);
  backBox = box(0.08, 0xff2828);
  externalWallProjector = box(0.1, 0xff2828);
  scene.add(kneeBoxL, kneeBoxR, backBox, externalWallProjector);

  refreshSurfaceTexture('floor');
  refreshSurfaceTexture('wall');
}

function labelTexture(text, w, h, vertical = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff2828';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.lineWidth = 12;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.fillStyle = '#050505';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 54px sans-serif';
  if (vertical) {
    const chars = text.replace(/\s/g, '').split('');
    const lh = 58;
    const total = (chars.length - 1) * lh;
    chars.forEach((ch, i) => ctx.fillText(ch, w / 2, h / 2 - total / 2 + i * lh));
  } else {
    text.split(',').forEach((s, i, a) => ctx.fillText(s.trim(), w / 2, h / 2 + (i - (a.length - 1) / 2) * 70));
  }
  return new THREE.CanvasTexture(c);
}

function box(s, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color }));
}

function beamMesh() {
  return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff2828, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
}

function createCanvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { canvas, ctx: canvas.getContext('2d'), texture, width: w, height: h };
}

function mmToCanvasPx(surface, mm) {
  const state = surfaceState[surface];
  const plane = surface === 'floor' ? floorPlane : wallPlane;
  const physicalWidthMm = Math.max(1, plane.scale.x * 1000);
  return (mm / physicalWidthMm) * surfaceTextures[surface].width;
}

function cmToCanvasPx(surface, cm, axis) {
  const plane = surface === 'floor' ? floorPlane : wallPlane;
  const physical = axis === 'x' ? Math.max(1, plane.scale.x * 100) : Math.max(1, plane.scale.y * 100);
  const canvas = surfaceTextures[surface];
  const size = axis === 'x' ? canvas.width : canvas.height;
  return (cm / physical) * size;
}

function drawFootprint(ctx, cx, cy, lengthPx) {
  const widthPx = Math.max(18, lengthPx * 0.42);
  const heelW = widthPx * 0.74;
  const heelH = lengthPx * 0.38;
  const toeR = widthPx * 0.115;
  ctx.save();
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.ellipse(cx, cy + lengthPx * 0.18, heelW * 0.45, heelH * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - widthPx * 0.28, cy - lengthPx * 0.22, widthPx * 0.56, lengthPx * 0.43, widthPx * 0.22);
  ctx.fill();
  const toes = [
    [-0.18, -0.38, 1.0],
    [-0.05, -0.46, 0.92],
    [0.08, -0.49, 0.84],
    [0.21, -0.46, 0.76],
    [0.32, -0.39, 0.68]
  ];
  toes.forEach(([dx, dy, scale]) => {
    ctx.beginPath();
    ctx.ellipse(cx + dx * widthPx, cy + dy * lengthPx, toeR * scale, toeR * scale * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawCenteredLabel(surface, text, sizePx, xOffsetPx, yOffsetPx, color = '#f5f5f5') {
  const { ctx, width, height } = surfaceTextures[surface];
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${sizePx}px sans-serif`;
  const lines = String(text || '').split('\n').filter(Boolean);
  const lineGap = Math.max(4, sizePx * 0.18);
  const totalHeight = lines.length * sizePx + Math.max(0, lines.length - 1) * lineGap;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2 + xOffsetPx, height / 2 + yOffsetPx - totalHeight / 2 + sizePx / 2 + i * (sizePx + lineGap));
  });
  ctx.restore();
}

function drawSurfaceGraphic(surface) {
  const cfg = surfaceState[surface];
  const { ctx, width, height } = surfaceTextures[surface];
  const graphicCenterX = width / 2 + cmToCanvasPx(surface, cfg.graphicX, 'x');
  const graphicCenterY = height / 2 + cmToCanvasPx(surface, cfg.graphicY, 'y');
  const graphicSizePx = mmToCanvasPx(surface, cfg.graphicSize);

  if (cfg.graphicType === 'none') return;

  if (cfg.graphicType === 'footprint') {
    drawFootprint(ctx, graphicCenterX, graphicCenterY, Math.max(16, graphicSizePx));
    return;
  }

  if (cfg.graphicType === 'image' && cfg.image) {
    const aspect = cfg.image.width / Math.max(1, cfg.image.height);
    const drawW = graphicSizePx;
    const drawH = graphicSizePx / Math.max(0.1, aspect);
    ctx.drawImage(cfg.image, graphicCenterX - drawW / 2, graphicCenterY - drawH / 2, drawW, drawH);
  }
}

function refreshSurfaceTexture(surface) {
  const cfg = surfaceState[surface];
  const tex = surfaceTextures[surface];
  const { ctx, width, height } = tex;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(4, Math.round(Math.min(width, height) * 0.015));
  ctx.strokeRect(18, 18, width - 36, height - 36);

  drawSurfaceGraphic(surface);

  const textSize = Math.max(10, cfg.textSize);
  const textX = cmToCanvasPx(surface, cfg.textX, 'x');
  const textY = cmToCanvasPx(surface, cfg.textY, 'y');
  ctx.fillStyle = '#fafafa';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(3, Math.round(textSize * 0.14));
  ctx.font = `900 ${textSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = String(cfg.text || '').split('\n').filter(Boolean);
  const lineGap = Math.max(4, textSize * 0.18);
  const totalHeight = lines.length * textSize + Math.max(0, lines.length - 1) * lineGap;
  lines.forEach((line, i) => {
    const x = width / 2 + textX;
    const y = height / 2 + textY - totalHeight / 2 + textSize / 2 + i * (textSize + lineGap);
    ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });

  tex.texture.needsUpdate = true;
}

function syncSurfaceEditor(surface) {
  const cfg = surfaceState[surface];
  by('surfaceText').value = cfg.text;
  by('surfaceTextSize').value = by('surfaceTextSizeN').value = cfg.textSize;
  by('surfaceTextX').value = by('surfaceTextXN').value = cfg.textX;
  by('surfaceTextY').value = by('surfaceTextYN').value = cfg.textY;
  by('surfaceGraphicType').value = cfg.graphicType;
  by('surfaceGraphicSize').value = by('surfaceGraphicSizeN').value = cfg.graphicSize;
  by('surfaceGraphicX').value = by('surfaceGraphicXN').value = cfg.graphicX;
  by('surfaceGraphicY').value = by('surfaceGraphicYN').value = cfg.graphicY;
  updateSurfaceEditorLabels();
}

function updateSurfaceEditorLabels() {
  by('surfaceTextSizeVal').textContent = `${by('surfaceTextSize').value} px`;
  by('surfaceTextXVal').textContent = `${by('surfaceTextX').value} cm`;
  by('surfaceTextYVal').textContent = `${by('surfaceTextY').value} cm`;
  by('surfaceGraphicSizeVal').textContent = `${by('surfaceGraphicSize').value} mm`;
  by('surfaceGraphicXVal').textContent = `${by('surfaceGraphicX').value} cm`;
  by('surfaceGraphicYVal').textContent = `${by('surfaceGraphicY').value} cm`;
}

function updateBeamToggleLabels() {
  by('floorBeamToggle').textContent = floorBeamVisible ? '바닥 빔 ON' : '바닥 빔 OFF';
  by('wallBeamToggle').textContent = wallBeamVisible ? '벽면 빔 ON' : '벽면 빔 OFF';
  by('floorBeamToggle').classList.toggle('active', floorBeamVisible);
  by('wallBeamToggle').classList.toggle('active', wallBeamVisible);
}

function setActiveSurface(surface) {
  activeSurface = surface;
  document.querySelectorAll('.surface-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.surface === surface));
  syncSurfaceEditor(surface);
}

async function loadSurfaceImage(surface, file) {
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  surfaceState[surface].image = img;
  surfaceState[surface].graphicType = 'image';
  if (activeSurface === surface) {
    by('surfaceGraphicType').value = 'image';
  }
  refreshSurfaceTexture(surface);
}

async function autoLoadAssets() {
  log('assets 자동 로드 시작...');
  try {
    await loadModelUrl(ASSETS.model, 'assets/xbot.fbx');
    for (const [name, url] of Object.entries(ASSETS.motions)) {
      animRegistry.set(name, { name, url });
    }
    refreshMotionSelect();
    const first = PRESETS[currentPreset].motions.find((m) => animRegistry.has(m));
    if (first) await selectMotion(first);
    log('assets 자동 로드 완료');
  } catch (e) {
    log(`assets 자동 로드 실패: ${errText(e)}`);
    by('personaState').textContent = '자동 로드 실패';
  }
}

async function loadModelUrl(url, label) {
  const buf = await fetchArray(url);
  return loadModelArray(buf, label);
}

async function fetchArray(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.arrayBuffer();
}

async function loadModelFile(file) {
  if (!file) return;
  log(`모델 파일 로드: ${file.name}`);
  try {
    const buf = await file.arrayBuffer();
    await loadModelArray(buf, file.name);
    log('모델 로드 완료');
  } catch (e) {
    log(`모델 로드 실패: ${errText(e)}`);
  }
}

async function loadModelArray(buf, label) {
  const obj = loader.parse(buf, '');
  if (modelRoot) scene.remove(modelRoot);
  modelRoot = obj;
  modelRoot.name = 'Actual_XBot_Model';
  scene.add(modelRoot);
  modelRoot.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.filter(Boolean).forEach((m) => {
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      });
    }
  });
  modelLoaded = true;
  by('personaState').textContent = `모델 로드됨 · ${label}`;
  fitModel();
  findBones();
  if (mixer) mixer.stopAllAction();
  mixer = new THREE.AnimationMixer(modelRoot);
  applyViewVisibility();
  return obj;
}

function registerAnimFiles(files) {
  Array.from(files || []).forEach((file) => {
    const n = motionName(file.name);
    animRegistry.set(n, { name: n, file });
    log(`동작 등록: ${n} ← ${file.name}`);
  });
  refreshMotionSelect();
}

function motionName(fname) {
  let n = fname.replace(/\.fbx$/i, '').replace(/^xbot@/i, '').replace(/^anim-/i, '').replace(/\(1\)$/i, '').trim();
  const map = {
    running: 'Running',
    'standard-run': 'Standard Run',
    hook: 'Hook',
    'mma-kick': 'MMA Kick',
    'kettlebell-swing': 'Kettlebell Swing',
    'jumping-jacks': 'Start Jumping Jacks',
    hiphop: 'Hip Hop Dancing'
  };
  if (/^Running \(1\)/i.test(n)) n = 'Running';
  return map[n] || n;
}

function refreshMotionSelect() {
  const sel = by('motionSelect');
  sel.innerHTML = '';
  PRESETS[currentPreset].motions.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = animRegistry.has(m) ? m : `${m} · 파일 필요`;
    opt.disabled = !animRegistry.has(m);
    sel.appendChild(opt);
  });
  const first = PRESETS[currentPreset].motions.find((m) => animRegistry.has(m));
  if (first) sel.value = first;
}

async function selectMotion(name) {
  currentMotion = name;
  const entry = animRegistry.get(name);
  if (!entry) {
    log(`동작 파일이 없습니다: ${name}`);
    by('personaState').textContent = `동작 파일 필요 · ${name}`;
    return;
  }
  if (!modelLoaded) {
    log('모델을 먼저 로드하세요.');
    return;
  }
  try {
    const buf = entry.file ? await entry.file.arrayBuffer() : await fetchArray(entry.url);
    const obj = loader.parse(buf, '');
    const clip = obj.animations && obj.animations[0];
    if (!clip) throw new Error('애니메이션 클립 없음');
    if (!mixer) mixer = new THREE.AnimationMixer(modelRoot);
    mixer.stopAllAction();
    activeAction = mixer.clipAction(clip);
    activeAction.reset().fadeIn(0.15).play();
    activeAction.timeScale = Number(by('speed').value || 1);
    by('personaState').textContent = `동작 적용됨 · ${name}`;
    log(`실제 FBX 동작 적용: ${name} / clip ${clip.name || 'animation'}`);
  } catch (e) {
    log(`동작 적용 실패 ${name}: ${errText(e)}`);
    by('personaState').textContent = `동작 실패 · ${name}`;
  }
}

function restartMotion() {
  if (activeAction) {
    activeAction.reset().play();
    paused = false;
  }
}

function playPause() {
  if (!activeAction) return;
  paused = !paused;
  activeAction.paused = paused;
}

function fitModel() {
  if (!modelRoot) return;
  modelRoot.scale.set(1, 1, 1);
  modelRoot.rotation.set(0, 0, 0);
  modelRoot.position.set(0, 0, 0);
  const box1 = new THREE.Box3().setFromObject(modelRoot);
  const size = new THREE.Vector3();
  box1.getSize(size);
  const h = size.y || 1;
  targetHeight = Number(by('height').value) * 0.01;
  const s = targetHeight / h;
  modelRoot.scale.setScalar(s);
  modelRoot.rotation.y = THREE.MathUtils.degToRad(yaw);
  const box2 = new THREE.Box3().setFromObject(modelRoot);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  modelRoot.position.sub(new THREE.Vector3(center.x, box2.min.y, center.z));
  modelHeight = targetHeight;
  findBones();
}

function findBoneByCandidates(root, candidates) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone) {
      const name = obj.name.toLowerCase();
      if (candidates.some((c) => name.includes(c.toLowerCase()))) found = obj;
    }
  });
  return found;
}

function findBones() {
  if (!modelRoot) return;
  leftKnee = findBoneByCandidates(modelRoot, ['LeftLowerLeg', 'mixamorigLeftLeg', 'mixamorig:LeftLeg', 'LeftLeg', 'LeftKnee']);
  rightKnee = findBoneByCandidates(modelRoot, ['RightLowerLeg', 'mixamorigRightLeg', 'mixamorig:RightLeg', 'RightLeg', 'RightKnee']);
  spineBone = findBoneByCandidates(modelRoot, ['Spine2', 'Spine1', 'mixamorigSpine', 'mixamorig:Hips', 'Hips', 'Spine']);
  eyeBone = findBoneByCandidates(modelRoot, ['mixamorigHead', 'Head', 'Neck']);
  by('leftBone').textContent = leftKnee ? leftKnee.name : 'fallback';
  by('rightBone').textContent = rightKnee ? rightKnee.name : 'fallback';
  by('spineBone').textContent = spineBone ? spineBone.name : 'fallback';
  by('eyeBone').textContent = eyeBone ? eyeBone.name : 'height fallback';
}

function setPreset(p, apply = true) {
  previousPreset = currentPreset;
  currentPreset = p;
  document.querySelectorAll('.preset button').forEach((b) => b.classList.toggle('active', b.dataset.preset === p));
  const preset = PRESETS[p];
  by('personaState').textContent = `${preset.label} · 프리셋 적용`;
  setNumberPair('yaw', preset.yaw);
  setNumberPair('height', preset.height);
  setNumberPair('tau', preset.tau);
  setNumberPair('fov', preset.fov);
  setNumberPair('pitch', preset.pitch);
  setNumberPair('floorW', preset.floorW);
  setNumberPair('floorD', preset.floorD);
  setNumberPair('floorZ', Math.abs(preset.floor[2] * 100));
  setNumberPair('wallW', preset.wallW);
  setNumberPair('wallH', preset.wallH);
  setNumberPair('wallZ', Math.abs(preset.wall[2] * 100));
  yaw = preset.yaw;
  tau = preset.tau;
  qStabFloor.fromArray(preset.floor);
  qStabWall.fromArray(preset.wall);
  updateSurfaceFromInputs(true);
  syncControlLabels();
  refreshMotionSelect();
  if (modelRoot) fitModel();
  updateScenarioVisibility();
  updateViewAvailability();
  if (apply) {
    const first = preset.motions.find((m) => animRegistry.has(m));
    if (first) selectMotion(first);
    else log(`이 프리셋의 동작 FBX를 먼저 등록해야 합니다: ${preset.motions.join(', ')}`);
  }
}

function rotateModel(deg) {
  yaw = ((yaw + deg + 540) % 360) - 180;
  setNumberPair('yaw', yaw);
  if (modelRoot) modelRoot.rotation.y = THREE.MathUtils.degToRad(yaw);
}

function setKneeSide(v) {
  kneeSide = v;
  by('kneeSideM').textContent = `${v === 'left' ? '왼쪽' : '오른쪽'} 무릎 1개`;
  log(`무릎 빔프로젝터 위치: ${v === 'left' ? '왼쪽' : '오른쪽'} 1개`);
}

function setStab(v) {
  stabilize = v;
  by('stabOn').classList.toggle('active', v);
  by('stabOff').classList.toggle('active', !v);
  by('stabState').textContent = v ? 'ON' : 'OFF';
  by('stabState').className = v ? 'ok' : 'warn';
}

function bind() {
  document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  document.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => setPreset(btn.dataset.preset)));
  document.querySelectorAll('[data-rotate]').forEach((btn) => btn.addEventListener('click', () => rotateModel(Number(btn.dataset.rotate))));
  document.querySelectorAll('.surface-tab').forEach((btn) => btn.addEventListener('click', () => setActiveSurface(btn.dataset.surface)));
  by('flipForward').addEventListener('click', () => rotateModel(180));
  by('reloadAssets').addEventListener('click', autoLoadAssets);
  by('playPause').addEventListener('click', playPause);
  by('restartMotion').addEventListener('click', restartMotion);
  by('modelFile').addEventListener('change', (e) => loadModelFile(e.target.files[0]));
  by('animFiles').addEventListener('change', (e) => registerAnimFiles(e.target.files));
  by('motionSelect').addEventListener('change', (e) => selectMotion(e.target.value));
  by('kneeSide').addEventListener('change', (e) => setKneeSide(e.target.value));
  by('stabOn').addEventListener('click', () => setStab(true));
  by('stabOff').addEventListener('click', () => setStab(false));
  by('floorBeamToggle').addEventListener('click', () => {
    floorBeamVisible = !floorBeamVisible;
    updateBeamToggleLabels();
  });
  by('wallBeamToggle').addEventListener('click', () => {
    wallBeamVisible = !wallBeamVisible;
    updateBeamToggleLabels();
  });
  by('surfaceText').addEventListener('input', (e) => {
    surfaceState[activeSurface].text = e.target.value;
    refreshSurfaceTexture(activeSurface);
  });
  by('surfaceGraphicType').addEventListener('change', (e) => {
    surfaceState[activeSurface].graphicType = e.target.value;
    refreshSurfaceTexture(activeSurface);
  });
  by('surfaceImageFile').addEventListener('change', (e) => loadSurfaceImage(activeSurface, e.target.files[0]));
  const toggleLeftPanel = () => {
    document.body.classList.toggle('hide-left');
    const visible = !document.body.classList.contains('hide-left');
    by('toggleLeft').classList.toggle('active', visible);
    by('toggleLeft').textContent = visible ? '설정 접기' : '설정 열기';
  };
  const toggleRightPanel = () => {
    document.body.classList.toggle('hide-right');
    const visible = !document.body.classList.contains('hide-right');
    by('toggleRight').classList.toggle('active', visible);
    by('toggleRight').textContent = visible ? '상태 접기' : '상태 열기';
  };
  by('toggleLeft').addEventListener('click', toggleLeftPanel);
  by('toggleRight').addEventListener('click', toggleRightPanel);
  by('resetSettings').addEventListener('click', resetSettings);
  by('toggleLeft').classList.add('active');
  by('toggleRight').classList.add('active');
  window.addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      moveKeys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => moveKeys.delete(e.code));
  document.querySelectorAll('.card-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const card = by(button.dataset.card);
      card.classList.toggle('collapsed');
      button.textContent = card.classList.contains('collapsed') ? '펼치기' : '접기';
    });
  });

  bindPair('yaw', 'yawN', (v) => {
    yaw = Number(v);
    by('yawVal').textContent = `${yaw}°`;
    if (modelRoot) modelRoot.rotation.y = THREE.MathUtils.degToRad(yaw);
  });
  bindPair('height', 'heightN', (v) => {
    by('heightVal').textContent = `${v} cm`;
    if (modelRoot) fitModel();
  });
  bindPair('tau', 'tauN', (v) => {
    tau = Number(v);
    by('tauVal').textContent = `${tau.toFixed(2)}s`;
  });
  bindPair('speed', 'speedN', (v) => {
    by('speedVal').textContent = `${Number(v).toFixed(2)}x`;
    if (activeAction) activeAction.timeScale = Number(v);
  });
  bindPair('floorW', 'floorWN', () => updateSurfaceFromInputs());
  bindPair('floorD', 'floorDN', () => updateSurfaceFromInputs());
  bindPair('floorZ', 'floorZN', () => updateSurfaceFromInputs());
  bindPair('wallW', 'wallWN', () => updateSurfaceFromInputs());
  bindPair('wallH', 'wallHN', () => updateSurfaceFromInputs());
  bindPair('wallZ', 'wallZN', () => updateSurfaceFromInputs());
  bindPair('fov', 'fovN', (v) => {
    camera.fov = Number(v);
    camera.updateProjectionMatrix();
    by('fovVal').textContent = `${v}°`;
  });
  bindPair('pitch', 'pitchN', (v) => {
    by('pitchVal').textContent = `${v}°`;
    if (currentView === 'eye') setView('eye');
  });
  bindPair('surfaceTextSize', 'surfaceTextSizeN', (v) => {
    surfaceState[activeSurface].textSize = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
  bindPair('surfaceTextX', 'surfaceTextXN', (v) => {
    surfaceState[activeSurface].textX = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
  bindPair('surfaceTextY', 'surfaceTextYN', (v) => {
    surfaceState[activeSurface].textY = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
  bindPair('surfaceGraphicSize', 'surfaceGraphicSizeN', (v) => {
    surfaceState[activeSurface].graphicSize = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
  bindPair('surfaceGraphicX', 'surfaceGraphicXN', (v) => {
    surfaceState[activeSurface].graphicX = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
  bindPair('surfaceGraphicY', 'surfaceGraphicYN', (v) => {
    surfaceState[activeSurface].graphicY = Number(v);
    updateSurfaceEditorLabels();
    refreshSurfaceTexture(activeSurface);
  });
}

function resetSettings() {
  moveKeys.clear();
  userPosition.set(0, 0, 0);
  gaitPhase = 0;
  rawPhase = 0;
  floorBeamVisible = true;
  wallBeamVisible = true;
  surfaceState.floor = structuredClone(DEFAULT_SURFACE_STATE.floor);
  surfaceState.wall = structuredClone(DEFAULT_SURFACE_STATE.wall);
  eyeFiltered.set(0, 1.58, 0.15);
  lookFiltered.set(0, 1.36, -2.2);
  runTravelReset();
  setKneeSide('right');
  by('kneeSide').value = 'right';
  setStab(true);
  setPreset('running', true);
  setActiveSurface('floor');
  refreshSurfaceTexture('floor');
  refreshSurfaceTexture('wall');
  updateBeamToggleLabels();
  setView('orbit');
  log('설정 초기화: 러닝 / 오른쪽 무릎 / 안정화 ON / 위치 원점');
}

function runTravelReset() {
  if (modelRoot) {
    modelRoot.position.copy(userPosition);
    modelRoot.updateMatrixWorld(true);
  }
  qStabFloor.fromArray(PRESETS.running.floor);
  qStabWall.fromArray(PRESETS.running.wall);
}

function bindPair(a, b, fn) {
  const r = by(a);
  const n = by(b);
  const h = (v) => {
    r.value = v;
    n.value = v;
    fn(v);
  };
  r.addEventListener('input', (e) => h(e.target.value));
  n.addEventListener('change', (e) => h(e.target.value));
}

function setNumberPair(id, value) {
  by(id).value = value;
  by(`${id}N`).value = value;
}

function syncControlLabels() {
  by('yawVal').textContent = `${by('yaw').value}°`;
  by('heightVal').textContent = `${by('height').value} cm`;
  by('tauVal').textContent = `${Number(by('tau').value).toFixed(2)}s`;
  by('fovVal').textContent = `${by('fov').value}°`;
  by('pitchVal').textContent = `${by('pitch').value}°`;
  by('speedVal').textContent = `${Number(by('speed').value).toFixed(2)}x`;
}

function updateSurfaceFromInputs(reset = false) {
  const floorW = Number(by('floorW').value) / 100;
  const floorD = Number(by('floorD').value) / 100;
  const floorZ = -Number(by('floorZ').value) / 100;
  const wallW = Number(by('wallW').value) / 100;
  const wallH = Number(by('wallH').value) / 100;
  const wallZ = -Number(by('wallZ').value) / 100;
  floorPlane.scale.set(floorW, floorD, 1);
  wallPlane.scale.set(wallW, wallH, 1);
  by('floorWVal').textContent = `${Math.round(floorW * 100)} cm`;
  by('floorDVal').textContent = `${Math.round(floorD * 100)} cm`;
  by('floorZVal').textContent = `${Math.round(Math.abs(floorZ) * 100)} cm`;
  by('wallWVal').textContent = `${Math.round(wallW * 100)} cm`;
  by('wallHVal').textContent = `${Math.round(wallH * 100)} cm`;
  by('wallZVal').textContent = `${Math.round(Math.abs(wallZ) * 100)} cm`;
  if (reset) {
    floorPlane.position.fromArray(PRESETS[currentPreset].floor);
    wallPlane.position.fromArray(PRESETS[currentPreset].wall);
  } else {
    floorPlane.position.z = floorZ;
    wallPlane.position.z = wallZ;
    floorPlane.position.x = 0;
    wallPlane.position.x = 0;
  }
}

function fallbackPoint(type) {
  if (type === 'L') return new THREE.Vector3(-0.12, 0.52, -0.02);
  if (type === 'R') return new THREE.Vector3(0.12, 0.52, -0.02);
  if (type === 'E') return new THREE.Vector3(0, modelHeight * 0.93, 0.04);
  return new THREE.Vector3(0, 1.18, 0.22);
}

function getWorld(obj, type) {
  if (obj) {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    return v;
  }
  return fallbackPoint(type);
}

function planeCorners(mesh) {
  mesh.updateMatrixWorld(true);
  const sx = mesh.scale.x;
  const sy = mesh.scale.y;
  return [
    [-sx / 2, -sy / 2, 0],
    [sx / 2, -sy / 2, 0],
    [sx / 2, sy / 2, 0],
    [-sx / 2, sy / 2, 0]
  ].map((p) => mesh.localToWorld(new THREE.Vector3(...p)));
}

function setBeam(mesh, apex, corners) {
  const pts = [];
  for (let i = 0; i < 4; i += 1) {
    pts.push(apex.x, apex.y, apex.z, corners[i].x, corners[i].y, corners[i].z, corners[(i + 1) % 4].x, corners[(i + 1) % 4].y, corners[(i + 1) % 4].z);
  }
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  mesh.geometry.computeVertexNormals();
}

function updateProjection(dt) {
  updateUserMovement(dt);
  if (modelRoot) modelRoot.position.copy(userPosition);
  grid.position.x = userPosition.x;
  grid.position.z = userPosition.z;
  if (modelRoot) modelRoot.updateMatrixWorld(true);

  const L = getWorld(leftKnee, 'L');
  const R = getWorld(rightKnee, 'R');
  const S = getWorld(spineBone, 'S');
  const activeKnee = kneeSide === 'left' ? L : R;
  const kneeOffset = new THREE.Vector3(kneeSide === 'left' ? -0.03 : 0.03, 0.02, 0.02);
  const kneeModule = activeKnee.clone().add(kneeOffset);
  kneeBoxL.position.copy(L).add(new THREE.Vector3(-0.03, 0.02, 0.02));
  kneeBoxR.position.copy(R).add(new THREE.Vector3(0.03, 0.02, 0.02));
  kneeBoxL.visible = kneeSide === 'left';
  kneeBoxR.visible = kneeSide === 'right';

  const bodyPos = modelRoot ? modelRoot.position.clone() : new THREE.Vector3();
  const floorDistance = Math.abs(Number(by('floorZ').value || 100)) / 100;
  const wallDistance = Math.abs(Number(by('wallZ').value || 225)) / 100;
  const eye = getWorld(eyeBone, 'E');
  const userAnchor = new THREE.Vector3(bodyPos.x * 0.55 + eye.x * 0.45, 0, bodyPos.z * 0.65 + eye.z * 0.35);
  const stableFloorTarget = new THREE.Vector3(userAnchor.x, 0.012, userAnchor.z - floorDistance);
  const rawFloorTarget = new THREE.Vector3(
    kneeModule.x + Math.sin(rawPhase * 1.7) * 0.08,
    0.012,
    kneeModule.z - floorDistance * 0.78 + Math.cos(rawPhase * 1.2) * 0.1
  );
  const externalProjector = bodyPos.clone().add(new THREE.Vector3(-0.85, 1.3, 0.78));
  externalWallProjector.position.copy(externalProjector);
  backBox.visible = false;
  const baseWall = new THREE.Vector3(bodyPos.x, PRESETS[currentPreset].wall[1], bodyPos.z - wallDistance);

  if (stabilize) {
    const alpha = currentPreset === 'running' ? 1 : Math.max(0.9, 1 - Math.exp(-(dt || 0.016) / tau));
    qStabFloor.lerp(stableFloorTarget, alpha);
    qStabWall.lerp(baseWall, alpha);
    floorPlane.position.copy(qStabFloor);
    wallPlane.position.copy(qStabWall);
  } else {
    rawPhase += dt * 6;
    floorPlane.position.copy(rawFloorTarget);
    wallPlane.position.copy(baseWall).add(new THREE.Vector3(S.x * 0.35, (S.y - 1.1) * 0.12, 0));
  }

  wall.position.z = wallPlane.position.z - 0.02;
  wallGrid.position.z = wallPlane.position.z - 0.015;
  const fc = planeCorners(floorPlane);
  const wc = planeCorners(wallPlane);
  floorBeamL.visible = floorBeamVisible && kneeSide === 'left';
  floorBeamR.visible = floorBeamVisible && kneeSide === 'right';
  if (floorBeamVisible) {
    if (kneeSide === 'left') setBeam(floorBeamL, kneeModule, fc);
    else setBeam(floorBeamR, kneeModule, fc);
  }
  wallBeam.visible = wallBeamVisible && currentPreset !== 'running';
  externalWallProjector.visible = wallBeamVisible && currentPreset !== 'running';
  if (wallBeamVisible && currentPreset !== 'running') setBeam(wallBeam, externalProjector, wc);
  updateScenarioVisibility();
  by('floorM').textContent = `x ${(floorPlane.position.x * 100).toFixed(0)}, z ${(floorPlane.position.z * 100).toFixed(0)}cm`;
}

function updateUserMovement(dt) {
  const step = currentPreset === 'running' ? 1.05 : 0.72;
  const manual = new THREE.Vector3();
  if (moveKeys.has('KeyW') || moveKeys.has('ArrowUp')) manual.z -= 1;
  if (moveKeys.has('KeyS') || moveKeys.has('ArrowDown')) manual.z += 1;
  if (moveKeys.has('KeyA') || moveKeys.has('ArrowLeft')) manual.x -= 1;
  if (moveKeys.has('KeyD') || moveKeys.has('ArrowRight')) manual.x += 1;
  if (manual.lengthSq() > 0) manual.normalize().multiplyScalar(step * dt);
  userPosition.add(manual);
  if (currentPreset === 'running') userPosition.z -= step * dt;
}

function updateScenarioVisibility() {
  const running = currentPreset === 'running';
  wall.visible = !running;
  wallGrid.visible = !running;
  wallPlane.visible = !running;
  wallBeam.visible = !running && wallBeamVisible;
  externalWallProjector.visible = !running && wallBeamVisible;
}

function updatePersonaAssessment() {
  const floorZ = Number(by('floorZ').value || 100);
  const floorD = Number(by('floorD').value || 160);
  const floorStart = floorZ - floorD / 2;
  const floorEnd = floorZ + floorD / 2;
  const coversCore = floorStart <= 20 && floorEnd >= 150;
  const coversAux = floorStart <= 20 && floorEnd >= 180;
  const hasMotion = Boolean(activeAction);
  const hasModel = Boolean(modelLoaded);
  const running = currentPreset === 'running';
  const modelText = hasModel ? '모델 로드됨' : '모델 미로드';
  const motionText = currentMotion ? `${currentMotion} 적용됨` : '동작 미적용';
  by('personaState').textContent = `${modelText} · ${motionText} · ${stabilize ? '안정화 ON' : '안정화 OFF'}`;

  let verdict = '무리 없음';
  let verdictClass = 'ok';
  let reason = '발 앞 20~180cm 기본 범위와 무릎 사출각 45°~60° 권장 구간을 안정적으로 커버합니다.';
  if (!hasModel) {
    verdict = '모델 필요';
    verdictClass = 'warn';
    reason = 'X Bot 모델이 아직 로드되지 않았습니다.';
  } else if (!coversCore) {
    verdict = '조정 필요';
    verdictClass = 'warn';
    reason = '핵심 시야 범위 20~150cm를 아직 충분히 덮지 못합니다.';
  } else if (!coversAux) {
    verdict = '대체로 무리 없음';
    verdictClass = 'warn';
    reason = '핵심 범위는 맞지만 150~180cm 보조 범위를 조금 더 넓히면 좋습니다.';
  } else if (!stabilize) {
    verdict = '사용 가능';
    verdictClass = 'warn';
    reason = '범위는 맞지만 안정화가 꺼져 있어 움직임이 더 직접적으로 보입니다.';
  } else if (!hasMotion) {
    verdict = '기본 준비 완료';
    verdictClass = 'ok';
    reason = '기본 범위와 안정화가 맞아 있어 바로 동작 확인이 가능합니다.';
  }

  by('personaVerdict').textContent = verdict;
  by('personaVerdict').className = verdictClass;
  by('personaReason').textContent = reason;
  by('personaNote').textContent = running
    ? '러닝에서는 전방 20~180cm를 기본 커버값으로 두고, 1인칭 흔들림은 저역 통과로 줄입니다.'
    : '정지 동작에서도 시야 범위와 사출각을 자연스럽게 보이도록 유지합니다.';

  by('coreSight').textContent = '20~150cm';
  by('auxSight').textContent = '150~180cm';
  by('projAngle').textContent = '45°~60°';
  by('defaultSpan').textContent = '발 앞 20cm ~ 180cm';
}

function updateViewAvailability() {
  const wallButton = by('view-wall');
  if (!wallButton) return;
  const running = currentPreset === 'running';
  wallButton.disabled = running;
  wallButton.classList.toggle('disabled', running);
  if (running && currentView === 'wall') setView('orbit');
}

function setView(v) {
  currentView = v;
  document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  controls.enabled = true;
  applyViewVisibility();
  if (v === 'orbit') {
    camera.position.copy(userPosition).add(new THREE.Vector3(2.7, 1.8, 3.1));
    controls.target.copy(userPosition).add(new THREE.Vector3(0, 0.9, -0.75));
  } else if (v === 'side') {
    camera.position.copy(userPosition).add(new THREE.Vector3(3.4, 1.12, -0.2));
    controls.target.copy(userPosition).add(new THREE.Vector3(0, 0.92, -0.75));
  } else if (v === 'top') {
    camera.position.copy(userPosition).add(new THREE.Vector3(0, 4.4, -0.65));
    controls.target.copy(userPosition).add(new THREE.Vector3(0, 0.02, -0.75));
  } else if (v === 'floor') {
    camera.position.set(0, 1.25, 1.05);
    controls.target.copy(floorPlane.position);
  } else if (v === 'wall') {
    camera.position.set(0, 1.45, 0.65);
    controls.target.copy(wallPlane.position);
  } else if (v === 'eye') {
    controls.enabled = false;
    updateFirstPersonCamera(0.016, true);
  }
  controls.update();
}

function updateFirstPersonCamera(dt, snap = false) {
  const speed = currentPreset === 'running' ? 1.05 : 0.72;
  gaitPhase += dt * speed * (currentPreset === 'running' ? 8.2 : 5.4);
  const pitch = THREE.MathUtils.degToRad(Number(by('pitch').value || 0));
  const rawEye = getWorld(eyeBone, 'E');
  const bodyEye = userPosition.clone().add(new THREE.Vector3(0, modelHeight * 0.93, 0.08));
  const targetEye = rawEye.lerp(bodyEye, 0.78);
  const bobY = Math.sin(gaitPhase * 2) * (currentPreset === 'running' ? 0.018 : 0.008);
  const swayX = Math.sin(gaitPhase) * (currentPreset === 'running' ? 0.012 : 0.005);
  targetEye.add(new THREE.Vector3(swayX, bobY, 0));

  const lookTarget = userPosition.clone().add(new THREE.Vector3(0, 1.2 + Math.sin(pitch) * 0.9, -2.4));
  const eyeAlpha = snap ? 1 : 1 - Math.exp(-dt / 0.12);
  const lookAlpha = snap ? 1 : 1 - Math.exp(-dt / 0.18);
  eyeFiltered.lerp(targetEye, eyeAlpha);
  lookFiltered.lerp(lookTarget, lookAlpha);
  camera.position.copy(eyeFiltered);
  camera.up.set(Math.sin(gaitPhase) * 0.012, 1, 0).normalize();
  camera.lookAt(lookFiltered);
}

function updateCameraFollow() {
  if (!controls.enabled || currentView === 'floor' || currentView === 'wall') return;
  const offsets = {
    orbit: new THREE.Vector3(2.7, 1.8, 3.1),
    side: new THREE.Vector3(3.4, 1.12, -0.2),
    top: new THREE.Vector3(0, 4.4, -0.65)
  };
  const targets = {
    orbit: new THREE.Vector3(0, 0.9, -0.75),
    side: new THREE.Vector3(0, 0.92, -0.75),
    top: new THREE.Vector3(0, 0.02, -0.75)
  };
  const offset = offsets[currentView];
  const target = targets[currentView];
  if (!offset || !target) return;
  camera.position.lerp(userPosition.clone().add(offset), 0.08);
  controls.target.lerp(userPosition.clone().add(target), 0.16);
}

function applyViewVisibility() {
  if (!modelRoot) return;
  modelRoot.visible = currentView !== 'eye';
}

function errText(e) {
  return e && e.message ? e.message : String(e);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  if (currentView === 'eye') updateFirstPersonCamera(dt || 0.016);
  else {
    updateCameraFollow();
    controls.update();
  }
  updateProjection(dt || 0.016);
  updatePersonaAssessment();
  renderer.render(scene, camera);
}
