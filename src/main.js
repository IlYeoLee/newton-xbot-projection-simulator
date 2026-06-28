import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import xbotModelUrl from '../assets/xbot.fbx?url';
import runningMotionUrl from '../assets/anim-running.fbx?url';
import standardRunMotionUrl from '../assets/anim-standard-run.fbx?url';
import hookMotionUrl from '../assets/anim-hook.fbx?url';
import mmaKickMotionUrl from '../assets/anim-mma-kick.fbx?url';
import kettlebellSwingMotionUrl from '../assets/anim-kettlebell-swing.fbx?url';
import jumpingJacksMotionUrl from '../assets/anim-jumping-jacks.fbx?url';
import hipHopMotionUrl from '../assets/anim-hiphop.fbx?url';

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
let leftFoot = null;
let rightFoot = null;
let leftToe = null;
let rightToe = null;
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
let eyeFovLines = null;
let eyeFovVisible = false;
let wallGrid;
let currentPreset = 'running';
let currentMotion = '';
let currentView = 'orbit';
let stabilize = true;
let floorBeamVisible = true;
let wallBeamVisible = true;
let activeSurface = 'floor';
let eyeMode = 'neutral';
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
let autoMove = true;
const eyeFiltered = new THREE.Vector3(0, 1.58, 0.15);
const lookFiltered = new THREE.Vector3(0, 1.36, -2.2);
let gaitPhase = 0;
let lastFloorAngle = 0;
let smoothedFloorAngle = 45;
let lastAssessmentTime = 0;
const stabVelocity = new THREE.Vector3(0, 0, 0);

// HW spec panel tracking
const HW_BUF = 300; // ~5s at 60fps
const hwBufX = new Float32Array(HW_BUF);
const hwBufZ = new Float32Array(HW_BUF);
let hwBufIdx = 0;
let hwBufCount = 0;
let hwPrevPitch = 52.5;
let hwPrevPitchVel = 0;
let hwMaxPitchVel = 0;
let hwMaxPitchAcc = 0;
let hwPitchMin = 90;
let hwPitchMax = 0;
let hwMaxErr = 0;
let hwCovHits = 0;
let hwCovTotal = 0;
let hwLastDom = 0;
const cachedModelFwd = new THREE.Vector3(0, 0, -1);

// ──── Simulation realism parameters ────
let imuEnabled = false;
let imuSigmaAcc = 3;    // mm — accelerometer noise σ
let imuDriftRate = 0.1; // °/s — gyro drift rate
let hfvEnabled = false;
let hfvAmp = 2;         // cm — high-freq vibration amplitude
let hfvFreq = 10;       // Hz — vibration frequency
let latEnabled = false;
let latDelayMs = 50;    // ms — sensor→servo system latency
let srvEnabled = false;
let srvMaxVelDeg = 300; // °/s — servo max angular velocity
let kfEnabled = false;
let kfQval = 0.04;      // process noise (velocity)
let kfRval = 0.0009;    // measurement noise variance

// IMU drift & vibration state
const imuDrift = new THREE.Vector3();
let hfvPhase = 0;

// Latency circular buffer (128 slots ≈ 2s at 60fps)
const LAT_BUF = 128;
const latBufX = new Float32Array(LAT_BUF);
const latBufY = new Float32Array(LAT_BUF);
const latBufZ = new Float32Array(LAT_BUF);
let latBufHead = 0;
let latBufFilled = 0;

// Kalman 1D filter instances (knee X and Z)
function mkKF() { return { pos: 0, vel: 0, p00: 1, p01: 0, p10: 0, p11: 1 }; }
let kfX = mkKF();
let kfZ = mkKF();

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

const ASSETS = {
  model: xbotModelUrl,
  motions: {
    Running: runningMotionUrl,
    'Standard Run': standardRunMotionUrl,
    Hook: hookMotionUrl,
    'MMA Kick': mmaKickMotionUrl,
    'Kettlebell Swing': kettlebellSwingMotionUrl,
    'Start Jumping Jacks': jumpingJacksMotionUrl,
    'Hip Hop Dancing': hipHopMotionUrl
  }
};

const PRESETS = {
  idle:    { label: '제자리 대기', motions: [], floor: [0, 0.012, -1.0], floorStart: 40, wall: [0, 1.18, -2.25], height: 170, yaw: 180, tau: 0.12, fov: 50, pitch: -15, floorW: 90, floorD: 140, wallW: 160, wallH: 160 },
  running: { label: '러닝 / 걷기', motions: ['Running', 'Standard Run'], floor: [0, 0.012, -1.0], floorStart: 40, wall: [0, 1.18, -2.25], height: 170, yaw: 180, tau: 0.03, fov: 50, pitch: -18, floorW: 95, floorD: 160, wallW: 42, wallH: 155 },
  boxing:  { label: '복싱 / 격투', motions: ['Hook', 'MMA Kick'], floor: [0, 0.012, -1.0], floorStart: 40, wall: [0, 1.25, -2.05], height: 170, yaw: 180, tau: 0.08, fov: 48, pitch: -12, floorW: 90, floorD: 160, wallW: 200, wallH: 200 },
  fitness: { label: '홈트 / 근력', motions: ['Kettlebell Swing', 'Start Jumping Jacks'], floor: [0, 0.012, -1.0], floorStart: 40, wall: [0, 1.25, -2.15], height: 170, yaw: 180, tau: 0.1, fov: 48, pitch: -12, floorW: 110, floorD: 160, wallW: 200, wallH: 200 },
  dance:   { label: '댄스 / 리듬', motions: ['Hip Hop Dancing'], floor: [0, 0.012, -1.0], floorStart: 40, wall: [0, 1.35, -2.35], height: 170, yaw: 180, tau: 0.1, fov: 48, pitch: -10, floorW: 120, floorD: 160, wallW: 200, wallH: 200 }
};

// EYE_MODES pitch calibrated so floor projection center is visible in 1P view:
// Eye h=1.58m, floor center ~1.18m ahead → 53° below horiz → need pitch+FOV/2 ≥ 53°
const EYE_MODES = {
  neutral: {
    label: '정면 중심',
    note: '자연스러운 전방 시선. 바닥 UI 원거리 끝부분만 시야 하단에 걸림. 몰입형 달리기 뷰.',
    fov: 50,
    pitch: -15,
    lowerField: 40
  },
  active: {
    label: '운동 기본',
    note: '운동 중 자연스러운 하향 시선 (−30°). 바닥 UI 중심부가 시야 하단 1/3에 들어옵니다.',
    fov: 54,
    pitch: -30,
    lowerField: 57
  },
  inspect: {
    label: '바닥 확인',
    note: '바닥 UI 전체를 확인하는 모드 (−45°). 시야 하단 기준 발 앞 40cm까지 커버.',
    fov: 58,
    pitch: -45,
    lowerField: 74
  }
};

init();

function by(id) {
  return document.getElementById(id);
}

function setTextIfPresent(id, value) {
  const el = by(id);
  if (el) el.textContent = value;
}

function log(message) {
  by('log').textContent = `${message}\n${by('log').textContent}`.slice(0, 1800);
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);
  scene.fog = new THREE.FogExp2(0x101010, 0.075);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.02, 80);
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

  ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  grid = new THREE.GridHelper(300, 150, 0x6a2020, 0x333333);
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
  setEyeMode('neutral');
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
  floorPlane.rotation.order = 'YXZ';
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

  // Eye FOV wireframe frustum: 12 line segments (cyan, distinct from red beam)
  const fovGeom = new THREE.BufferGeometry();
  fovGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 2 * 3), 3));
  eyeFovLines = new THREE.LineSegments(fovGeom, new THREE.LineBasicMaterial({ color: 0x22eeff, transparent: true, opacity: 0.55 }));
  eyeFovLines.visible = false;
  scene.add(eyeFovLines);
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

function drawFootprint(ctx, cx, cy, lengthPx, widthPx) {
  widthPx = Math.max(10, widthPx ?? lengthPx * 0.42);
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
  const plane = surface === 'floor' ? floorPlane : wallPlane;
  const pxPerMmX = width / Math.max(1, plane.scale.x * 1000);
  const pxPerMmY = height / Math.max(1, plane.scale.y * 1000);

  if (cfg.graphicType === 'none') return;

  if (cfg.graphicType === 'footprint') {
    // length maps to depth axis (Y), width maps to lateral axis (X) independently
    const footLen = Math.max(16, cfg.graphicSize * pxPerMmY);
    const footWid = Math.max(10, cfg.graphicSize * 0.42 * pxPerMmX);
    drawFootprint(ctx, graphicCenterX, graphicCenterY, footLen, footWid);
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
  ctx.fillStyle = '#7d7d7d';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.01));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);

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
  resetHWStats();
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
    // Strip root bone position tracks so the clip loops without snapping
    clip.tracks = clip.tracks.filter(t => !/\.position$/.test(t.name) || !/hips|rootnode/i.test(t.name));
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
  leftFoot = findBoneByCandidates(modelRoot, ['LeftFoot', 'mixamorigLeftFoot', 'mixamorig:LeftFoot']);
  rightFoot = findBoneByCandidates(modelRoot, ['RightFoot', 'mixamorigRightFoot', 'mixamorig:RightFoot']);
  leftToe = findBoneByCandidates(modelRoot, ['LeftToeBase', 'LeftToe_End', 'mixamorigLeftToeBase', 'mixamorig:LeftToeBase']);
  rightToe = findBoneByCandidates(modelRoot, ['RightToeBase', 'RightToe_End', 'mixamorigRightToeBase', 'mixamorig:RightToeBase']);
  spineBone = findBoneByCandidates(modelRoot, ['Spine2', 'Spine1', 'mixamorigSpine', 'mixamorig:Hips', 'Hips', 'Spine']);
  eyeBone = findBoneByCandidates(modelRoot, ['mixamorigHead', 'Head', 'Neck']);
  setTextIfPresent('leftBone', leftKnee ? leftKnee.name : 'fallback');
  setTextIfPresent('rightBone', rightKnee ? rightKnee.name : 'fallback');
  setTextIfPresent('spineBone', spineBone ? spineBone.name : 'fallback');
  setTextIfPresent('eyeBone', eyeBone ? eyeBone.name : 'height fallback');
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
  setNumberPair('floorZ', preset.floorStart ?? 20);
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

function updateEyeModePanel() {
  const cfg = EYE_MODES[eyeMode];
  const eyeHeightCm = modelLoaded ? getWorld(eyeBone, 'E').y * 100 : modelHeight * 93;
  const visibleStartCm = Math.max(0, eyeHeightCm / Math.tan(THREE.MathUtils.degToRad(cfg.lowerField)));
  const coverageText = visibleStartCm <= 20
    ? '발 앞 20~180cm 기본 커버'
    : `발 앞 ${visibleStartCm.toFixed(0)}cm부터 안정적으로 보임`;
  document.querySelectorAll('[data-eye-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.eyeMode === eyeMode));
  setTextIfPresent('eyeModeLabel', cfg.label);
  setTextIfPresent('eyeVisibleStart', `발 앞 ${visibleStartCm.toFixed(0)}cm`);
  setTextIfPresent('eyeCoverage', coverageText);
  setTextIfPresent('eyeModeNote', cfg.note);
}

function setEyeMode(mode) {
  eyeMode = mode;
  const cfg = EYE_MODES[mode];
  setNumberPair('fov', cfg.fov);
  setNumberPair('pitch', cfg.pitch);
  camera.fov = cfg.fov;
  camera.updateProjectionMatrix();
  updateEyeModePanel();
  if (currentView === 'eye') updateFirstPersonCamera(0.016, true);
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
  document.querySelectorAll('[data-eye-mode]').forEach((btn) => btn.addEventListener('click', () => setEyeMode(btn.dataset.eyeMode)));
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
  by('hwResetMax').addEventListener('click', resetHWStats);
  by('toggleLeft').classList.add('active');
  by('toggleRight').classList.add('active');
  window.addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      moveKeys.add(e.code);
      e.preventDefault();
    }
    // Space = toggle auto-move
    if (e.code === 'Space') { autoMove = !autoMove; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => moveKeys.delete(e.code));
  const autoMoveBtn = by('autoMoveBtn');
  if (autoMoveBtn) autoMoveBtn.addEventListener('click', () => {
    autoMove = !autoMove;
    autoMoveBtn.textContent = autoMove ? '자동이동 ON' : '자동이동 OFF';
    autoMoveBtn.classList.toggle('active', autoMove);
  });
  const eyeFovBtn = by('eyeFovBtn');
  if (eyeFovBtn) eyeFovBtn.addEventListener('click', () => {
    eyeFovVisible = !eyeFovVisible;
    eyeFovBtn.textContent = eyeFovVisible ? '시야콘 ON' : '시야콘 OFF';
    eyeFovBtn.classList.toggle('active', eyeFovVisible);
  });
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

  // ── Section 08: Simulation realism ──
  function setSimToggle(feature, on) {
    const onBtn = by(`${feature}On`), offBtn = by(`${feature}Off`);
    if (onBtn) onBtn.classList.toggle('active', on);
    if (offBtn) offBtn.classList.toggle('active', !on);
  }
  by('imuNoiseOn').addEventListener('click', () => { imuEnabled = true; setSimToggle('imuNoise', true); resetHWStats(); });
  by('imuNoiseOff').addEventListener('click', () => { imuEnabled = false; setSimToggle('imuNoise', false); resetHWStats(); });
  bindPair('imuSigma', 'imuSigmaN', (v) => { imuSigmaAcc = Number(v); by('imuSigmaVal').textContent = `${v} mm`; });
  bindPair('imuDrift', 'imuDriftN', (v) => { imuDriftRate = Number(v); by('imuDriftVal').textContent = `${v} °/s`; });

  by('hfvOn').addEventListener('click', () => { hfvEnabled = true; setSimToggle('hfv', true); resetHWStats(); });
  by('hfvOff').addEventListener('click', () => { hfvEnabled = false; setSimToggle('hfv', false); resetHWStats(); });
  bindPair('hfvAmp', 'hfvAmpN', (v) => { hfvAmp = Number(v); by('hfvAmpVal').textContent = `${v} cm`; });
  bindPair('hfvFreq', 'hfvFreqN', (v) => { hfvFreq = Number(v); by('hfvFreqVal').textContent = `${v} Hz`; });

  by('latOn').addEventListener('click', () => { latEnabled = true; setSimToggle('lat', true); resetHWStats(); });
  by('latOff').addEventListener('click', () => { latEnabled = false; setSimToggle('lat', false); resetHWStats(); });
  bindPair('latDelay', 'latDelayN', (v) => { latDelayMs = Number(v); by('latDelayVal').textContent = `${v} ms`; });

  by('srvOn').addEventListener('click', () => { srvEnabled = true; setSimToggle('srv', true); });
  by('srvOff').addEventListener('click', () => { srvEnabled = false; setSimToggle('srv', false); });
  bindPair('srvMaxVel', 'srvMaxVelN', (v) => { srvMaxVelDeg = Number(v); by('srvMaxVelVal').textContent = `${v} °/s`; });

  by('kfOn').addEventListener('click', () => { kfEnabled = true; setSimToggle('kf', true); resetKF(); });
  by('kfOff').addEventListener('click', () => { kfEnabled = false; setSimToggle('kf', false); });
  bindPair('kfQ', 'kfQN', (v) => { kfQval = Number(v); by('kfQVal').textContent = v; });
  bindPair('kfR', 'kfRN', (v) => { kfRval = Number(v); by('kfRVal').textContent = v; });

  by('runMC').addEventListener('click', () => {
    by('runMC').textContent = '계산 중...';
    by('runMC').disabled = true;
    setTimeout(() => {
      const r = runMonteCarlo();
      setTextIfPresent('mc-p50', `${r.p50.toFixed(1)} cm`);
      setTextIfPresent('mc-p95', `${r.p95.toFixed(1)} cm`);
      setTextIfPresent('mc-p99', `${r.p99.toFixed(1)} cm`);
      setTextIfPresent('mc-rms', `${r.meanRms.toFixed(1)} cm`);
      setTextIfPresent('mc-p95rms', `${r.p95rms.toFixed(1)} cm`);
      by('mcResults').style.display = '';
      by('runMC').textContent = 'Monte Carlo 재실행 (N=50)';
      by('runMC').disabled = false;
    }, 10);
  });

  // Master realism toggle
  function setRealismAll(on) {
    imuEnabled = on; hfvEnabled = on; latEnabled = on; srvEnabled = on; kfEnabled = on;
    ['imuNoise', 'hfv', 'lat', 'srv', 'kf'].forEach(f => setSimToggle(f, on));
    resetHWStats(); resetKF();
    by('realismOn').classList.toggle('active', on);
    by('realismOff').classList.toggle('active', !on);
    const desc = by('realismDesc');
    if (desc) desc.innerHTML = on
      ? '<b>실제 HW 모드</b>: IMU 노이즈 3mm σ · 기계진동 2cm/10Hz · 시스템 지연 50ms · 서보 대역폭 300°/s · 칼만 필터 보정 동작 중.'
      : '<b>이상적 모드</b>: 노이즈·지연·대역폭 제한 없음. 순수 안정화 알고리즘만 동작.';
  }
  by('realismOn').addEventListener('click', () => setRealismAll(true));
  by('realismOff').addEventListener('click', () => setRealismAll(false));

  // Advanced params accordion
  by('advancedRealismToggle').addEventListener('click', () => {
    const body = by('advancedRealismBody');
    const arrow = by('advancedRealismArrow');
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    arrow.textContent = open ? '▼ 접기' : '▶ 펼치기';
  });
}

function resetSettings() {
  moveKeys.clear();
  userPosition.set(0, 0, 0);
  stabVelocity.set(0, 0, 0);
  resetHWStats();
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
  setEyeMode('neutral');
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
  by('speedVal').textContent = `${Number(by('speed').value).toFixed(2)}x`;
  updateEyeModePanel();
}

function updateSurfaceFromInputs(reset = false) {
  const floorW = Number(by('floorW').value) / 100;
  const floorD = Number(by('floorD').value) / 100;
  const floorStart = Number(by('floorZ').value) / 100;
  const floorCenterZ = -(floorStart + floorD / 2);
  const wallW = Number(by('wallW').value) / 100;
  const wallH = Number(by('wallH').value) / 100;
  const wallZ = -Number(by('wallZ').value) / 100;
  floorPlane.scale.set(floorW, floorD, 1);
  wallPlane.scale.set(wallW, wallH, 1);
  by('floorWVal').textContent = `${Math.round(floorW * 100)} cm`;
  by('floorDVal').textContent = `${Math.round(floorD * 100)} cm`;
  by('floorZVal').textContent = `${Math.round(floorStart * 100)} cm`;
  by('wallWVal').textContent = `${Math.round(wallW * 100)} cm`;
  by('wallHVal').textContent = `${Math.round(wallH * 100)} cm`;
  by('wallZVal').textContent = `${Math.round(Math.abs(wallZ) * 100)} cm`;
  if (reset) {
    floorPlane.position.set(0, PRESETS[currentPreset].floor[1], floorCenterZ);
    wallPlane.position.fromArray(PRESETS[currentPreset].wall);
  } else {
    floorPlane.position.z = floorCenterZ;
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

function modelForwardOffset(distance) {
  const offset = new THREE.Vector3(0, 0, -distance);
  if (modelRoot) {
    const q = new THREE.Quaternion();
    modelRoot.getWorldQuaternion(q);
    offset.applyQuaternion(q);
  }
  return offset;
}

function getFootFrontPoint(side) {
  const toeBone = side === 'left' ? leftToe : rightToe;
  const footBone = side === 'left' ? leftFoot : rightFoot;
  if (toeBone) return getWorld(toeBone, side === 'left' ? 'LT' : 'RT');
  if (footBone) return getWorld(footBone, side === 'left' ? 'LF' : 'RF').add(modelForwardOffset(0.14));
  const kneePoint = getWorld(side === 'left' ? leftKnee : rightKnee, side === 'left' ? 'L' : 'R');
  return kneePoint.clone().add(new THREE.Vector3(0, -0.48, 0)).add(modelForwardOffset(0.18));
}

function planeCorners(mesh) {
  mesh.updateMatrixWorld(true);
  // PlaneGeometry(1,1) has unit half-extents; scale is already in matrixWorld
  return [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, 0.5, 0]
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

function updateEyeFov() {
  if (!eyeFovLines) return;
  eyeFovLines.visible = eyeFovVisible;
  if (!eyeFovVisible) return;

  const eye = getWorld(eyeBone, 'E');
  const pitchRad = THREE.MathUtils.degToRad(Number(by('pitch').value || -15));
  const fovVRad = THREE.MathUtils.degToRad(Number(by('fov').value || 50));
  const fovHRad = 2 * Math.atan(Math.tan(fovVRad / 2) * camera.aspect);

  // Look direction (pitch applied to model forward)
  const fwd = cachedModelFwd.clone();
  const look = new THREE.Vector3(
    fwd.x * Math.cos(pitchRad),
    Math.sin(pitchRad),
    fwd.z * Math.cos(pitchRad)
  ).normalize();
  const right = new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, look).normalize();

  const tH = Math.tan(fovHRad / 2);
  const tV = Math.tan(fovVRad / 2);

  // 4 corner rays of the frustum
  const dirs = [
    look.clone().addScaledVector(right, -tH).addScaledVector(up,  tV).normalize(),
    look.clone().addScaledVector(right,  tH).addScaledVector(up,  tV).normalize(),
    look.clone().addScaledVector(right,  tH).addScaledVector(up, -tV).normalize(),
    look.clone().addScaledVector(right, -tH).addScaledVector(up, -tV).normalize(),
  ];

  // Intersect rays with floor (y = 0.015); cap at 8m if ray points up
  const FLOOR_Y = 0.015;
  const MAX_D = 8;
  const far = dirs.map(d => {
    if (d.y >= -0.01) return eye.clone().addScaledVector(d, MAX_D);
    const t = (FLOOR_Y - eye.y) / d.y;
    return t > 0 && t < MAX_D ? eye.clone().addScaledVector(d, t) : eye.clone().addScaledVector(d, MAX_D);
  });
  // Near cross at 0.8m
  const near = dirs.map(d => eye.clone().addScaledVector(d, 0.8));

  const buf = eyeFovLines.geometry.attributes.position.array;
  let i = 0;
  const s = p => { buf[i++] = p.x; buf[i++] = p.y; buf[i++] = p.z; };
  // 4 rays eye→far corners
  dirs.forEach((_, c) => { s(eye); s(far[c]); });
  // 4 far edges (floor footprint)
  for (let c = 0; c < 4; c++) { s(far[c]); s(far[(c + 1) % 4]); }
  // 4 near edges (inner frame at 0.8m)
  for (let c = 0; c < 4; c++) { s(near[c]); s(near[(c + 1) % 4]); }
  eyeFovLines.geometry.attributes.position.needsUpdate = true;
}

function updateProjection(dt) {
  updateUserMovement(dt);
  if (modelRoot) modelRoot.position.copy(userPosition);
  if (modelRoot) modelRoot.updateMatrixWorld(true);

  const L = getWorld(leftKnee, 'L');
  const R = getWorld(rightKnee, 'R');
  const S = getWorld(spineBone, 'S');
  const activeKnee = kneeSide === 'left' ? L : R;
  const kneeOffset = new THREE.Vector3(kneeSide === 'left' ? -0.03 : 0.03, -0.03, 0.03);
  const kneeModule = activeKnee.clone().add(kneeOffset);
  kneeBoxL.position.copy(L).add(new THREE.Vector3(-0.03, -0.03, 0.03));
  kneeBoxR.position.copy(R).add(new THREE.Vector3(0.03, -0.03, 0.03));
  kneeBoxL.visible = kneeSide === 'left';
  kneeBoxR.visible = kneeSide === 'right';

  const bodyPos = modelRoot ? modelRoot.position.clone() : new THREE.Vector3();
  const floorStart = Math.abs(Number(by('floorZ').value || 20)) / 100;
  const floorDepth = Math.abs(Number(by('floorD').value || 160)) / 100;
  const wallDistance = Math.abs(Number(by('wallZ').value || 225)) / 100;
  const externalProjector = bodyPos.clone().add(new THREE.Vector3(-0.85, 1.3, 0.78));
  externalWallProjector.position.copy(externalProjector);
  backBox.visible = false;
  const baseWall = new THREE.Vector3(bodyPos.x, PRESETS[currentPreset].wall[1], bodyPos.z - wallDistance);

  // --- Body forward direction in world space (yaw-aware) ---
  // Mixamo xbot local forward = +Z; apply model quaternion to get world forward
  const modelFwd = new THREE.Vector3(0, 0, 1);
  if (modelRoot) modelFwd.applyQuaternion(modelRoot.quaternion);
  modelFwd.y = 0;
  if (modelFwd.lengthSq() < 0.001) modelFwd.set(0, 0, -1);
  modelFwd.normalize();
  cachedModelFwd.copy(modelFwd);

  // Floor center distance comes from sliders: near edge offset + half depth
  const planeCenterDist = floorStart + floorDepth / 2;

  // ── Realism layer: get sensor-noisy knee estimate ──
  const sensed = getSensedKnee(kneeModule, dt);

  const kneeH = Math.max(0.15, sensed.y);

  // Spring target: bodyPos + toe-forward offset + planeCenterDist.
  // During running the front foot extends ~50cm ahead of bodyPos (hip root),
  // so we add a fixed stance offset so floorStart=0 ≈ toe tip, not hip center.
  const STANCE_TOE_OFFSET = 0.45; // m: typical max forward foot extent from bodyPos
  const angleTarget = new THREE.Vector3(
    bodyPos.x + modelFwd.x * (STANCE_TOE_OFFSET + planeCenterDist),
    0.012,
    bodyPos.z + modelFwd.z * (STANCE_TOE_OFFSET + planeCenterDist)
  );

  // Rotate floor plane to always face body forward direction (YXZ order keeps plane horizontal)
  floorPlane.rotation.y = Math.atan2(-modelFwd.x, -modelFwd.z);

  if (stabilize) {
    // --- 2nd-order spring-damper (models physical servo gimbal) ---
    // Critical damping: K_d = 2√K_s  →  K_s=22, K_d≈9
    const K_s = 22;
    const K_d = 9;
    const errVec = angleTarget.clone().sub(qStabFloor);
    const acc = errVec.multiplyScalar(K_s).sub(stabVelocity.clone().multiplyScalar(K_d));
    stabVelocity.addScaledVector(acc, dt);
    // Servo bandwidth limit: convert max angular velocity to linear floor velocity
    const vFloorMax = srvEnabled
      ? (srvMaxVelDeg * Math.PI / 180) * kneeH
      : 3.0;
    if (stabVelocity.length() > vFloorMax) stabVelocity.setLength(vFloorMax);
    qStabFloor.addScaledVector(stabVelocity, dt);

    const wallAlpha = 1 - Math.exp(-dt / Math.max(0.03, tau));
    qStabWall.lerp(baseWall, wallAlpha);
    floorPlane.position.copy(qStabFloor);
    wallPlane.position.copy(qStabWall);
  } else {
    rawPhase += dt * 6;
    // Raw mode: slider-defined center + instability noise
    const rawTarget = new THREE.Vector3(
      bodyPos.x + modelFwd.x * (STANCE_TOE_OFFSET + planeCenterDist) + Math.sin(rawPhase * 1.7) * 0.08,
      0.012,
      bodyPos.z + modelFwd.z * (STANCE_TOE_OFFSET + planeCenterDist) + Math.cos(rawPhase * 1.2) * 0.05
    );
    floorPlane.position.copy(rawTarget);
    wallPlane.position.copy(baseWall).add(new THREE.Vector3(S.x * 0.35, (S.y - 1.1) * 0.12, 0));
  }

  wall.position.z = wallPlane.position.z - 0.02;
  wallGrid.position.z = wallPlane.position.z - 0.015;
  const fc = planeCorners(floorPlane);
  const wc = planeCorners(wallPlane);
  // Near edge = floor center minus half-depth in model's forward direction
  const floorNearEdge = new THREE.Vector3(
    floorPlane.position.x - modelFwd.x * floorDepth / 2,
    0.012,
    floorPlane.position.z - modelFwd.z * floorDepth / 2
  );
  const floorRun = Math.hypot(kneeModule.x - floorNearEdge.x, kneeModule.z - floorNearEdge.z);
  const rawFloorAngle = THREE.MathUtils.radToDeg(Math.atan2(Math.max(0.001, kneeModule.y - floorNearEdge.y), Math.max(0.001, floorRun)));
  smoothedFloorAngle += (rawFloorAngle - smoothedFloorAngle) * 0.04;
  lastFloorAngle = smoothedFloorAngle;
  floorPlane.visible = floorBeamVisible;
  floorBeamL.visible = floorBeamVisible && kneeSide === 'left';
  floorBeamR.visible = floorBeamVisible && kneeSide === 'right';
  if (floorBeamVisible) {
    if (kneeSide === 'left') setBeam(floorBeamL, kneeModule, fc);
    else setBeam(floorBeamR, kneeModule, fc);
  }
  const wallOn = wallBeamVisible && currentPreset !== 'running';
  wallPlane.visible = wallOn;
  wallBeam.visible = wallOn;
  externalWallProjector.visible = wallOn;
  if (wallOn) setBeam(wallBeam, externalProjector, wc);
  updateScenarioVisibility();
  by('floorM').textContent = `시작 ${(floorStart * 100).toFixed(0)} / 끝 ${((floorStart + floorDepth) * 100).toFixed(0)}cm`;
  updateHWPanel(dt, kneeModule, qStabFloor, planeCenterDist, floorStart, floorDepth, Number(by('floorW').value) / 100, bodyPos);
}

// Auto-move speed per preset (m/s); 0 = stationary exercise
const AUTO_MOVE_SPEED = { idle: 0, running: 1.8, boxing: 0, fitness: 0, dance: 0 };

function updateUserMovement(dt) {
  const step = currentPreset === 'running' ? 1.8 : 0.9;
  const manual = new THREE.Vector3();
  if (moveKeys.has('KeyW') || moveKeys.has('ArrowUp')) manual.copy(cachedModelFwd);
  if (moveKeys.has('KeyS') || moveKeys.has('ArrowDown')) manual.copy(cachedModelFwd).negate();
  if (moveKeys.has('KeyA') || moveKeys.has('ArrowLeft')) { manual.set(-cachedModelFwd.z, 0, cachedModelFwd.x); }
  if (moveKeys.has('KeyD') || moveKeys.has('ArrowRight')) { manual.set(cachedModelFwd.z, 0, -cachedModelFwd.x); }

  if (manual.lengthSq() > 0) {
    manual.normalize().multiplyScalar(step * dt);
  } else if (autoMove && activeAction) {
    const autoSpeed = AUTO_MOVE_SPEED[currentPreset] ?? 0;
    if (autoSpeed > 0) manual.copy(cachedModelFwd).multiplyScalar(autoSpeed * dt);
  }
  userPosition.add(manual);

  // Infinite ground: snap in 60m steps so character never approaches edge
  // (do NOT set exactly = userPosition — that cancels parallax and looks like standing still)
  const SNAP = 60;
  ground.position.x = Math.round(userPosition.x / SNAP) * SNAP;
  ground.position.z = Math.round(userPosition.z / SNAP) * SNAP;
  grid.position.x = ground.position.x;
  grid.position.z = ground.position.z;
}

function updateScenarioVisibility() {
  const running = currentPreset === 'running';
  wall.visible = !running;
  wallGrid.visible = !running;
}

function resetHWStats() {
  hwBufIdx = 0; hwBufCount = 0;
  hwBufX.fill(0); hwBufZ.fill(0);
  hwPrevPitch = 52.5; hwPrevPitchVel = 0;
  hwMaxPitchVel = 0; hwMaxPitchAcc = 0;
  hwPitchMin = 90; hwPitchMax = 0;
  hwMaxErr = 0; hwCovHits = 0; hwCovTotal = 0;
  // Reset noise & estimation state
  imuDrift.set(0, 0, 0);
  hfvPhase = 0;
  latBufHead = 0; latBufFilled = 0;
  latBufX.fill(0); latBufY.fill(0); latBufZ.fill(0);
  resetKF();
}

function updateHWPanel(dt, kneeModule, stabPos, planeCenterDist, floorStart, floorDepth, floorW, bodyPos) {
  if (!modelLoaded) return;
  const kneeH = Math.max(0.15, kneeModule.y);
  const safedt = Math.max(0.005, dt);

  // ① Servo / gimbal angles
  const dx = stabPos.x - kneeModule.x;
  const dz = stabPos.z - kneeModule.z;
  const dh = Math.max(0.01, Math.sqrt(dx * dx + dz * dz));
  const pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(kneeH, dh));
  const pitchVel = Math.abs(pitchDeg - hwPrevPitch) / safedt;
  const pitchAcc = Math.abs(pitchVel - hwPrevPitchVel) / safedt;

  if (hwBufCount > 2 && pitchVel < 400) {
    hwMaxPitchVel = Math.max(hwMaxPitchVel, pitchVel);
    hwMaxPitchAcc = Math.max(hwMaxPitchAcc, pitchAcc);
    hwPitchMin = Math.min(hwPitchMin, pitchDeg);
    hwPitchMax = Math.max(hwPitchMax, pitchDeg);
  }
  hwPrevPitch = pitchDeg;
  hwPrevPitchVel = pitchVel;

  // ③ Position error: how far servo lags behind the body-based ideal target
  const refX = bodyPos ? bodyPos.x : kneeModule.x;
  const refZ = bodyPos ? bodyPos.z : kneeModule.z;
  const idealX = refX + cachedModelFwd.x * planeCenterDist;
  const idealZ = refZ + cachedModelFwd.z * planeCenterDist;
  const errX = (stabPos.x - idealX) * 100;
  const errZ = (stabPos.z - idealZ) * 100;
  const instErr = Math.sqrt(errX * errX + errZ * errZ);
  if (hwBufCount > 2) hwMaxErr = Math.max(hwMaxErr, instErr);

  hwBufX[hwBufIdx] = errX;
  hwBufZ[hwBufIdx] = errZ;
  hwBufIdx = (hwBufIdx + 1) % HW_BUF;
  hwBufCount = Math.min(hwBufCount + 1, HW_BUF);
  hwCovTotal++;
  if (instErr <= 5) hwCovHits++;

  // DOM update throttled to 250ms
  const now = performance.now();
  if (now - hwLastDom < 250) return;
  hwLastDom = now;

  // RMS over buffer
  let sumX2 = 0, sumZ2 = 0;
  for (let i = 0; i < hwBufCount; i++) { sumX2 += hwBufX[i] ** 2; sumZ2 += hwBufZ[i] ** 2; }
  const rmsX = Math.sqrt(sumX2 / hwBufCount);
  const rmsZ = Math.sqrt(sumZ2 / hwBufCount);
  const cov = hwCovTotal > 0 ? (hwCovHits / hwCovTotal * 100) : 100;

  // ② Lens / throw specs — slider value IS the near distance (no auto-override)
  const nearCm = floorStart * 100;
  const farCm = (floorStart + floorDepth) * 100;
  const throwRatio = (kneeH / Math.max(0.01, floorW)).toFixed(2);
  const hFovDeg = 2 * THREE.MathUtils.radToDeg(Math.atan2(floorW / 2, Math.max(0.01, floorStart)));
  const vFovDeg = THREE.MathUtils.radToDeg(Math.atan2(floorStart + floorDepth, kneeH))
               - THREE.MathUtils.radToDeg(Math.atan2(floorStart, kneeH));
  // Display reference: how far current angle deviates from 52.5° target
  const currentProjAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(kneeH, Math.max(0.01, floorStart)));
  const servoOffsetCm = 0; // servo no longer overrides slider

  setTextIfPresent('hw-pitch-angle', `${pitchDeg.toFixed(1)}°`);
  setTextIfPresent('hw-pitch-vel', `${pitchVel.toFixed(1)} °/s`);
  setTextIfPresent('hw-pitch-vel-max', `${hwMaxPitchVel.toFixed(1)} °/s`);
  setTextIfPresent('hw-pitch-acc-max', `${hwMaxPitchAcc.toFixed(0)} °/s²`);
  setTextIfPresent('hw-pitch-range', hwPitchMin <= hwPitchMax ? `${hwPitchMin.toFixed(1)}° ~ ${hwPitchMax.toFixed(1)}°` : '-');
  setTextIfPresent('hw-proj-angle', `${currentProjAngleDeg.toFixed(1)}° (권장 52.5°)`);
  setTextIfPresent('hw-near-dist', `${nearCm.toFixed(0)} cm`);
  setTextIfPresent('hw-far-dist', `${farCm.toFixed(0)} cm`);
  setTextIfPresent('hw-throw-ratio', `${throwRatio} (h/W)`);
  setTextIfPresent('hw-fov-h', `${hFovDeg.toFixed(1)}°`);
  setTextIfPresent('hw-fov-v', `${vFovDeg.toFixed(1)}°`);
  setTextIfPresent('hw-rms-x', `${rmsX.toFixed(1)} cm`);
  setTextIfPresent('hw-rms-z', `${rmsZ.toFixed(1)} cm`);
  setTextIfPresent('hw-max-err', `${hwMaxErr.toFixed(1)} cm`);
  const covEl = document.getElementById('hw-coverage');
  if (covEl) {
    covEl.textContent = `${cov.toFixed(1)}%`;
    covEl.className = cov >= 95 ? 'ok' : cov >= 80 ? 'warn' : 'bad';
  }
}

function updatePersonaAssessment() {
  const floorZ = Number(by('floorZ').value || 20);
  const floorD = Number(by('floorD').value || 160);
  const floorStart = floorZ;
  const floorEnd = floorZ + floorD;
  const coversCore = floorStart <= 20 && floorEnd >= 150;
  const coversAux = floorStart <= 20 && floorEnd >= 180;
  const coversAngle = lastFloorAngle >= 45 && lastFloorAngle <= 60;
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
  } else if (!coversAngle) {
    verdict = '서보 보정 중';
    verdictClass = 'warn';
    reason = `무릎 높이 기반 서보가 사출각 52.5° 유지를 위해 플로어 거리를 자동 조정 중입니다 (현재 ${lastFloorAngle.toFixed(1)}°)。`;
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
  by('projAngle').textContent = `${lastFloorAngle.toFixed(1)}°`;
  by('projAngle').className = coversAngle ? 'ok' : 'warn';
  by('defaultSpan').textContent = `발 앞 ${floorStart.toFixed(0)}cm ~ ${floorEnd.toFixed(0)}cm`;
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
  const pitchRad = THREE.MathUtils.degToRad(Number(by('pitch').value || 0));
  const rawEye = getWorld(eyeBone, 'E');
  const bodyEye = userPosition.clone().add(new THREE.Vector3(0, modelHeight * 0.93, 0.04));

  // Eye position: 65% animation-driven (head bob, body lean), 35% stable height
  // Previous code was 94% stable → essentially static. Now animation breathes through.
  const targetEye = rawEye.clone().lerp(bodyEye, 0.35);

  // Look direction: body forward + user pitch + animation lean
  // When body bends forward (kettlebell, boxing guard), head drops below expected height.
  // That height deficit maps to extra downward tilt on the look target.
  const expectedEyeY = userPosition.y + modelHeight * 0.93;
  const leanOffset = (rawEye.y - expectedEyeY) * 1.4; // negative when bending → look down more

  const fwd = cachedModelFwd.clone(); // body facing direction
  const lookDist = 2.8;
  const lookTarget = new THREE.Vector3(
    targetEye.x + fwd.x * lookDist,
    targetEye.y + Math.sin(pitchRad) * lookDist + leanOffset,
    targetEye.z + fwd.z * lookDist
  );

  // Faster response so head bob is actually felt (tau 0.10 vs previous 0.25)
  const eyeAlpha = snap ? 1 : 1 - Math.exp(-dt / 0.10);
  const lookAlpha = snap ? 1 : 1 - Math.exp(-dt / 0.12);
  eyeFiltered.lerp(targetEye, eyeAlpha);
  lookFiltered.lerp(lookTarget, lookAlpha);
  camera.position.copy(eyeFiltered);
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

// ──── Noise & Kalman utilities ────

function gaussRand() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 1D Kalman: state = [position, velocity], measurement = position
function kfPredict(k, dt) {
  const pos = k.pos + k.vel * dt;
  const p00 = k.p00 + dt * (k.p01 + k.p10) + dt * dt * k.p11 + kfQval * 0.01 * dt;
  const p01 = k.p01 + dt * k.p11;
  const p10 = k.p10 + dt * k.p11;
  const p11 = k.p11 + kfQval * dt;
  k.pos = pos;
  k.p00 = p00; k.p01 = p01; k.p10 = p10; k.p11 = p11;
}
function kfUpdate(k, meas) {
  const y = meas - k.pos;
  const s = k.p00 + kfRval;
  const g0 = k.p00 / s;
  const g1 = k.p10 / s;
  k.pos += g0 * y;
  k.vel += g1 * y;
  const p00 = (1 - g0) * k.p00;
  const p01 = (1 - g0) * k.p01;
  const p10 = k.p10 - g1 * k.p00;
  const p11 = k.p11 - g1 * k.p01;
  k.p00 = p00; k.p01 = p01; k.p10 = p10; k.p11 = p11;
}
function resetKF() {
  kfX = mkKF(); kfX.pos = cachedModelFwd.x;
  kfZ = mkKF(); kfZ.pos = cachedModelFwd.z;
}

// Apply latency + noise + Kalman to get "sensed" knee position
function getSensedKnee(trueKnee, dt) {
  // 1. Store true knee in latency buffer every frame
  latBufX[latBufHead] = trueKnee.x;
  latBufY[latBufHead] = trueKnee.y;
  latBufZ[latBufHead] = trueKnee.z;
  latBufHead = (latBufHead + 1) % LAT_BUF;
  latBufFilled = Math.min(latBufFilled + 1, LAT_BUF);

  // 2. Latency: read from N frames ago
  let sx = trueKnee.x, sy = trueKnee.y, sz = trueKnee.z;
  if (latEnabled && latBufFilled > 1) {
    const delayFrames = Math.min(Math.round(latDelayMs / 16.67), latBufFilled - 1);
    const readIdx = ((latBufHead - 1 - delayFrames) % LAT_BUF + LAT_BUF) % LAT_BUF;
    sx = latBufX[readIdx]; sy = latBufY[readIdx]; sz = latBufZ[readIdx];
  }

  // 3. High-frequency vibration (simulates residual mechanical vibration on knee mount)
  if (hfvEnabled) {
    hfvPhase += 2 * Math.PI * hfvFreq * dt;
    const amp = hfvAmp / 100;
    sx += Math.sin(hfvPhase * 1.3) * amp * 0.3;
    sy += Math.abs(Math.sin(hfvPhase) * amp * 0.6);
    sz += Math.cos(hfvPhase * 0.9) * amp * 0.5;
  }

  // 4. IMU noise: Gaussian + slow gyro drift
  if (imuEnabled) {
    const sigma = imuSigmaAcc / 1000;
    sx += gaussRand() * sigma;
    sy = Math.max(0.15, sy + gaussRand() * sigma * 0.5);
    sz += gaussRand() * sigma;
    // Random-walk drift (integrated gyro error → position offset)
    imuDrift.x += gaussRand() * imuDriftRate * dt * 0.0002;
    imuDrift.z += gaussRand() * imuDriftRate * dt * 0.0002;
    sx += imuDrift.x;
    sz += imuDrift.z;
  }

  // 5. Kalman filter: estimate true position from noisy sensor output
  if (kfEnabled) {
    kfPredict(kfX, dt); kfUpdate(kfX, sx);
    kfPredict(kfZ, dt); kfUpdate(kfZ, sz);
    sx = kfX.pos;
    sz = kfZ.pos;
  }

  return new THREE.Vector3(sx, sy, sz);
}

// ──── Monte Carlo headless simulation ────
function runMonteCarlo() {
  const N = 50, FRAMES = 300, DT = 1 / 60;
  const sigma = imuEnabled ? imuSigmaAcc / 1000 : 0.003;
  const amp = hfvEnabled ? hfvAmp / 100 : 0;
  const Ks = 22, Kd = 9;
  const maxErrs = [], rmsErrs = [];

  for (let trial = 0; trial < N; trial++) {
    let stabZ = -1.0, vZ = 0, phase = Math.random() * Math.PI * 2;
    const errs = [];
    for (let f = 0; f < FRAMES; f++) {
      const t = f * DT;
      // Parametric running gait model
      const ky = 0.52 + 0.04 * Math.sin(2 * Math.PI * 2.5 * t + phase);
      const kz = -0.02 + 0.03 * Math.cos(2 * Math.PI * 2.5 * t + phase);
      // Sensed knee (noise + vibration, no Kalman in MC for worst-case)
      let sz = kz + gaussRand() * sigma;
      if (amp > 0) sz += Math.cos(t * 2 * Math.PI * hfvFreq * 0.9) * amp * 0.5;
      // Spring target: center = start(0.2m) + depth/2(0.8m) = 1.0m forward
      const targetZ = sz - 1.0;
      const errZ = targetZ - stabZ;
      vZ += (Ks * errZ - Kd * vZ) * DT;
      const vMax = srvEnabled ? (srvMaxVelDeg * Math.PI / 180) * Math.max(0.15, ky) : 3.0;
      vZ = Math.max(-vMax, Math.min(vMax, vZ));
      stabZ += vZ * DT;
      errs.push(Math.abs(stabZ - (kz - 1.0)) * 100); // cm error vs true ideal
    }
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    maxErrs.push(Math.max(...errs));
    rmsErrs.push(rms);
  }

  maxErrs.sort((a, b) => a - b);
  rmsErrs.sort((a, b) => a - b);
  const idx = (p) => Math.min(Math.floor(N * p), N - 1);
  return {
    p50: maxErrs[idx(0.5)], p95: maxErrs[idx(0.95)], p99: maxErrs[idx(0.99)],
    meanRms: rmsErrs.reduce((s, v) => s + v, 0) / N,
    p95rms: rmsErrs[idx(0.95)]
  };
}

function errText(e) {
  return e && e.message ? e.message : String(e);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  try {
    if (mixer) mixer.update(dt);
    if (currentView === 'eye') updateFirstPersonCamera(dt || 0.016);
    else {
      updateCameraFollow();
      controls.update();
    }
    updateProjection(dt || 0.016);
    updateEyeFov();
    const now = performance.now();
    if (now - lastAssessmentTime >= 700) {
      updatePersonaAssessment();
      lastAssessmentTime = now;
    }
  } catch (e) {
    const el = document.getElementById('runtimeError') || (() => {
      const d = document.createElement('div');
      d.id = 'runtimeError';
      d.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#c00;color:#fff;font:13px monospace;padding:8px 16px;z-index:9999;max-width:90vw;word-break:break-all;';
      document.body.appendChild(d);
      return d;
    })();
    el.textContent = `JS 오류: ${e.message} @ ${e.stack?.split('\n')[1]?.trim() || '?'}`;
  }
  renderer.render(scene, camera);
}
