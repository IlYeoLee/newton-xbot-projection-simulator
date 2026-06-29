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
let lastIdealTarget = new THREE.Vector3(0, 0.012, -1.15);
let stabMode = 'ideal'; // 'off' | 'ideal' | 'hw' | 'ois'
let stabInitialized = false; // snap qStabFloor to lastIdealTarget on first valid projection frame
// OIS + SW mode state
const qOisSettled = new THREE.Vector3(0, 0.012, -1.15);
let oisInitialized = false;
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
const PITCH_REAL  = { idle: -15, running: -18, boxing: -12, fitness: -12, dance: -10 };
const PITCH_TRAIN = { idle: -40, running: -45, boxing: -40, fitness: -40, dance: -35 };
let exerciseMode = 'real'; // 'real' | 'train'
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

  // When tab comes back from background, clock may have accumulated several seconds.
  // Discard that time and re-snap the spring so the beam doesn't fly away.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clock.getDelta(); // flush accumulated time
      stabInitialized = false; // re-snap spring to current target on next frame
    }
  });

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
  eyeFovLines.frustumCulled = false; // bounding box of line geometry is unreliable — never cull
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
  stabInitialized = false; // force snap on next projection frame
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
  // 복싱·홈트·댄스 → 훈련 모드 자동 전환 (스텝/동작 따라하기 필요)
  // 달리기·제자리 → 실전 모드 유지
  const autoMode = ['boxing', 'fitness', 'dance'].includes(p) ? 'train' : 'real';
  if (autoMode !== exerciseMode) {
    exerciseMode = autoMode;
    ['modeReal', 'modeTrain'].forEach(id => { const el = by(id); if (el) el.classList.remove('active'); });
    const activeBtn = by(autoMode === 'train' ? 'modeTrain' : 'modeReal');
    if (activeBtn) activeBtn.classList.add('active');
    const desc = by('modeDesc');
    if (desc) desc.textContent = autoMode === 'train'
      ? '훈련: 발 내려보기(-45°) 기준 — 투사가 발 바로 앞 ~20cm부터 시작. 발 위치·동작 따라하며 연습.'
      : '실전: 자연 시선(-18°) 기준 — 투사가 발 앞 ~110cm부터 시작. 빠르게 달려도 고개 숙임 없이 보임.';
  }
  const pitchMap = exerciseMode === 'train' ? PITCH_TRAIN : PITCH_REAL;
  setNumberPair('pitch', pitchMap[p] ?? preset.pitch);
  setNumberPair('floorW', preset.floorW);
  setNumberPair('floorD', preset.floorD);
  // floorZ is auto-calculated from height+pitch+fov — preset hardcoded value is ignored
  setNumberPair('wallW', preset.wallW);
  setNumberPair('wallH', preset.wallH);
  setNumberPair('wallZ', Math.abs(preset.wall[2] * 100));
  yaw = preset.yaw;
  tau = preset.tau;
  // Use lastIdealTarget if available (body-relative), otherwise fall back to preset world coords
  qStabFloor.copy(lastIdealTarget.lengthSq() > 0.001 ? lastIdealTarget : new THREE.Vector3().fromArray(preset.floor));
  qStabWall.fromArray(preset.wall);
  autoFloorStart();
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
  const eyeHeightCm = modelLoaded ? (getWorld(eyeBone, 'E').y + modelHeight * 0.07) * 100 : modelHeight * 93;
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

function setSimToggle(feature, on) {
  const onBtn = by(`${feature}On`), offBtn = by(`${feature}Off`);
  if (onBtn) onBtn.classList.toggle('active', on);
  if (offBtn) offBtn.classList.toggle('active', !on);
}

function setRealismAll(on) {
  imuEnabled = on; hfvEnabled = on; latEnabled = on; srvEnabled = on; kfEnabled = on;
  ['imuNoise', 'hfv', 'lat', 'srv', 'kf'].forEach(f => setSimToggle(f, on));
  resetHWStats(); resetKF();
  if (by('realismOn')) by('realismOn').classList.toggle('active', on);
  if (by('realismOff')) by('realismOff').classList.toggle('active', !on);
}

function setStabMode(mode) {
  const wasOff = !stabilize;
  stabMode = mode;
  const nowOn = mode !== 'off';

  if (nowOn && wasOff) {
    qStabFloor.copy(lastIdealTarget);
    stabVelocity.set(0, 0, 0);
  }
  stabilize = nowOn;

  // HW realism flags (OIS mode: SW-only, no HW servo realism)
  const hw = mode === 'hw';
  setRealismAll(hw);

  // Reset OIS state when entering/leaving OIS mode
  if (mode === 'ois') { oisInitialized = false; }

  // Button states
  ['stabOff', 'stabOn', 'stabHW', 'stabOIS'].forEach(id => {
    const el = by(id); if (el) el.classList.remove('active');
  });
  const activeId = mode === 'off' ? 'stabOff' : mode === 'hw' ? 'stabHW' : mode === 'ois' ? 'stabOIS' : 'stabOn';
  const activeEl = by(activeId); if (activeEl) activeEl.classList.add('active');

  // OIS button: green styling only when active
  const oisBtn = by('stabOIS');
  if (oisBtn) {
    if (mode === 'ois') {
      oisBtn.style.background = 'rgba(103,242,167,0.2)';
      oisBtn.style.borderColor = 'rgba(103,242,167,0.7)';
      oisBtn.style.color = '#67f2a7';
    } else {
      oisBtn.style.background = '';
      oisBtn.style.borderColor = '';
      oisBtn.style.color = '';
    }
  }

  // Status
  const stateEl = by('stabState');
  if (stateEl) {
    stateEl.textContent = mode === 'off' ? 'OFF' : mode === 'hw' ? 'HW' : mode === 'ois' ? 'OIS' : 'ON';
    stateEl.className = mode === 'off' ? 'warn' : 'ok';
  }

  // Desc
  const desc = by('stabDesc');
  if (desc) desc.innerHTML = {
    off:   '<b>보정 없음</b>: 무릎 흔들림이 투사에 그대로 반영됩니다.',
    ideal: '<b>이상적 보정</b>: 센서 완벽·지연 없음. 서보 스프링이 몸 움직임만 흡수.',
    hw:    '<b>실제 HW 보정</b>: IMU 노이즈 3mm · 지연 50ms · 서보 대역폭 300°/s · 칼만 필터 동작.',
    ois:   '<b>OIS + 소프트웨어</b>: 서보 없음. bodyPos 기반 SW 보정(±85%) + OIS ±7.5cm 범위 내 잔여 떨림 흡수.'
  }[mode];

  // Show/hide tau slider (not relevant in off mode)
  const tf = by('tauField'); if (tf) tf.style.display = mode === 'off' ? 'none' : '';

  // Update detail panel content for currently selected mode
  const STAB_DETAILS = {
    off: `<div style="color:#ffd166;font-weight:900;margin-bottom:8px">■ 보정 없음 — 이것이 해결해야 할 문제</div>
<b>무릎 XZ 진폭 ±30~50 cm</b>: 달리기 중 무릎이 한 보행 주기(~0.5s)마다 전후로 크게 흔들립니다.<br>
서보가 없으면 이 진폭 그대로 투사면이 이동하며, 사용자 눈에 빔프가 앞뒤로 휙휙 날아다닙니다.<br><br>
<div style="border:1px solid rgba(255,209,102,0.3);border-radius:6px;padding:8px;margin:6px 0;font-size:10px">
  달리기 무릎 진동: ±40 cm / 주기<br>
  투사면 이동 거리: ±40 cm → 거의 쓸 수 없음<br>
  비교 기준: 보정된 화면과 얼마나 개선됐는지 확인용
</div>
이 화면이 "해결하지 않으면 어떻게 되는가"의 기준선(baseline)입니다.<br>
<b>보정 없음 → 이상적 보정</b> 버튼을 눌러 차이를 직접 확인하세요.`,

    ideal: `<div style="color:#67f2a7;font-weight:900;margin-bottom:8px">■ 이상적 보정 — 양산에서 달성 가능한 목표 수준</div>

<b>왜 투사면이 거의 안 움직이는가?</b><br>
추적 기준을 무릎(±40cm)이 아닌 <b>골반(bodyPos)</b>으로 바꿨기 때문입니다.<br>
인체 바이오메카닉 상, 달리는 동안 골반은 XZ로 <b>±2~3cm</b>만 이동합니다.<br>
무릎보다 10배 이상 안정적인 기준점입니다.<br><br>

<div style="border:1px solid rgba(103,242,167,0.3);border-radius:6px;padding:8px;margin:6px 0;font-size:10px">
  무릎 진동: ±40 cm<br>
  골반(기준점) 진동: ±2~3 cm → <b>약 15배 감소</b><br>
  잔류 투사 오차: 이상적 조건 ±5 mm 이하
</div>

<b>스프링-댐퍼 서보 수식:</b><br>
<code>a = Ks·(target − pos) − Kd·vel</code><br>
&nbsp;&nbsp;Ks = 22 (복원력) · Kd = 9 (임계 제동, 오버슈트 없음)<br>
&nbsp;&nbsp;자연 진동수 ωn ≈ 4.7 rad/s · 정착 시간 ≈ 0.85s<br><br>

<b>양산에서 이 수준이 가능한 이유:</b><br>
&nbsp;&nbsp;• <b>IMU 200Hz</b> → 골반 위치를 5ms 주기로 갱신<br>
&nbsp;&nbsp;• <b>2축 짐벌 서보</b> → ±3cm 보정에 필요한 각도는 불과 2~3°<br>
&nbsp;&nbsp;&nbsp;&nbsp;서보 최대 성능의 1~2%만 사용 → 충분한 여유<br>
&nbsp;&nbsp;• <b>서보 반응 속도(tau 슬라이더)</b>: 0.03s 설정 시<br>
&nbsp;&nbsp;&nbsp;&nbsp;러닝 진동(2Hz)을 95% 이상 차단 가능<br><br>

<div style="border:1px solid rgba(103,242,167,0.2);border-radius:6px;padding:8px;margin:4px 0;font-size:10px;color:#aaa">
  tau 권장값: 러닝 0.03s · 복싱 0.08s · 댄스 0.10s<br>
  tau ↓: 빠른 반응 (고주파 일부 통과) · tau ↑: 부드러움 (방향전환 시 지연)
</div>
지금 화면에서 캐릭터가 전속력으로 달려도 투사면이 거의 고정되는 것,<br>이것이 <b>완성된 양산품의 목표 성능 수준</b>입니다.`,

    hw: `<div style="color:#ff8585;font-weight:900;margin-bottom:8px">■ 실제 HW 보정 — 양산품의 현실적 성능</div>
이상적 보정에서 실제 부품 5가지 제약이 추가됩니다.<br>
각 제약이 얼마나 성능을 깎는지, 그래도 왜 쓸 수 있는지를 보여줍니다.<br><br>

<b>① IMU 센서 노이즈 ±3mm</b><br>
&nbsp;&nbsp;MEMS 가속도계(예: ICM-42688-P, ~$2) 기준 위치 추정 오차.<br>
&nbsp;&nbsp;→ 투사면 미세 떨림(jitter) 원인. 칼만 필터로 50~70% 감소 가능.<br><br>

<b>② 발 착지 충격 진동 2cm / 10Hz</b><br>
&nbsp;&nbsp;달리기 착지 시 무릎 장치에 10Hz 고주파 충격 발생.<br>
&nbsp;&nbsp;서보 유효 대역(~5Hz) 초과 → 필터 후에도 잔류 ±5mm.<br><br>

<b>③ 시스템 지연 50ms</b><br>
&nbsp;&nbsp;IMU → MCU 처리 → 서보 명령 파이프라인 전체 지연.<br>
&nbsp;&nbsp;러닝 1.8m/s × 50ms = 9cm 위치 오차 발생<br>
&nbsp;&nbsp;→ 칼만 예측 보정으로 실효 오차 3~4cm로 감소.<br><br>

<b>④ 서보 최대 속도 300°/s</b><br>
&nbsp;&nbsp;급격한 방향전환(예: 스탑-앤-고) 시 0.1~0.2s 추종 지연.<br>
&nbsp;&nbsp;일반 러닝·홈트에서는 포화(saturating) 없이 정상 동작.<br><br>

<b>⑤ 칼만 필터 (Q=0.04, R=0.0009)</b><br>
&nbsp;&nbsp;IMU 노이즈를 줄이면서 지연 없이 실제 위치 추정.<br>
&nbsp;&nbsp;Q/R ↑ → 센서 신뢰(빠름·노이즈 多) · Q/R ↓ → 모델 신뢰(부드러움·지연)<br><br>

<div style="border:1px solid rgba(255,133,133,0.3);border-radius:6px;padding:8px;margin:6px 0;font-size:10px">
  5가지 제약 합산 잔류 오차: ±1~2 cm 수준<br>
  사람이 달리며 투사 흔들림 인식 임계: 약 ±3~4 cm<br>
  → <b>실제 HW도 인식 임계 이하 달성 가능</b>
</div>

<b>양산 BOM 예시 (추가 원가):</b><br>
&nbsp;&nbsp;• IMU: ICM-42688-P 약 $2<br>
&nbsp;&nbsp;• MCU: STM32G0 약 $1.5<br>
&nbsp;&nbsp;• 2축 짐벌 서보(25g): 약 $8~15<br>
&nbsp;&nbsp;→ 총 하드웨어 추가 원가 <b>$15~25 수준</b>에서 구현 가능`,

    ois: `<div style="color:#67f2a7;font-weight:900;margin-bottom:8px">■ OIS + 소프트웨어 보정 — 서보 없는 대안</div>
물리적 서보 짐벌 없이 두 가지 메커니즘만 사용합니다.<br><br>

<b>① 소프트웨어 보정 (SW, 85% 감소)</b><br>
&nbsp;&nbsp;골반(bodyPos) 기준으로 투사 위치 계산 → 무릎 진동(±40cm)의 85% 제거.<br>
&nbsp;&nbsp;잔류: ±40cm × 15% = <b>±6cm</b><br>
&nbsp;&nbsp;별도 하드웨어 없음. 기존 IMU/포즈 추정 재활용.<br><br>

<b>② OIS 보이스코일 (±7.5cm = ±2.5°@1.7m)</b><br>
&nbsp;&nbsp;카메라 OIS 모듈과 동일 원리. 응답 1~5ms.<br>
&nbsp;&nbsp;SW 잔류 ±6cm → OIS 범위(±7.5cm) <b>이내 → 거의 완전 흡수</b>.<br><br>

<div style="border:1px solid rgba(103,242,167,0.3);border-radius:6px;padding:8px;margin:6px 0;font-size:10px">
  무릎 진동: ±40 cm → SW 후 ±6 cm → OIS 후 <b>≈ 0~1 cm</b><br>
  ※ 급격한 자세 변화 &gt;7.5cm 시 OIS 포화 → 일시 오차
</div>

<b>서보 대비 장단점:</b><br>
&nbsp;&nbsp;✅ 두께 ~3mm (서보보다 훨씬 납작)<br>
&nbsp;&nbsp;✅ 응답 1ms (서보 10~100ms보다 빠름)<br>
&nbsp;&nbsp;❌ 보정 범위 ±7.5cm 한계 — 큰 자세변화 시 포화<br>
&nbsp;&nbsp;❌ 피치 각도 능동 조절 불가`
  };
  const detail = by('stabDetail');
  if (detail) detail.innerHTML = STAB_DETAILS[mode] || '';
}

function setStab(v) { setStabMode(v ? 'ideal' : 'off'); }


function setExerciseMode(mode) {
  exerciseMode = mode;
  const pitchMap = mode === 'train' ? PITCH_TRAIN : PITCH_REAL;
  const pitch = pitchMap[currentPreset] ?? (mode === 'train' ? -40 : -18);
  setNumberPair('pitch', pitch);
  autoFloorStart();

  ['modeReal', 'modeTrain'].forEach(id => { const el = by(id); if (el) el.classList.remove('active'); });
  const activeBtn = by(mode === 'train' ? 'modeTrain' : 'modeReal');
  if (activeBtn) activeBtn.classList.add('active');

  const desc = by('modeDesc');
  if (desc) desc.textContent = mode === 'train'
    ? '훈련: 발 내려보기(-45°) 기준 — 투사가 발 바로 앞 ~20cm부터 시작. 발 위치·보폭 느끼며 연습.'
    : '실전: 자연 시선(-18°) 기준 — 투사가 발 앞 ~110cm부터 시작. 빠르게 달려도 고개 숙임 없이 보임.';
}

// Auto-calculate floorStart so the near edge aligns with the natural gaze floor-hit point.
// Formula: floorStart = eyeH / tan(|pitch - fov/2|) - BODY_TO_TOE
// This ensures the projection begins exactly where the lower FOV edge meets the floor.
function autoFloorStart() {
  const h = Number(by('height').value || 170) / 100;
  const pitchRad = THREE.MathUtils.degToRad(Number(by('pitch').value || -18));
  const fovVRad = THREE.MathUtils.degToRad(Number(by('fov').value || 50));
  const eyeH = h * 0.93;
  const BODY_TO_TOE = h * 0.35;
  const lowerAngle = pitchRad - fovVRad / 2;
  if (lowerAngle >= 0) return; // gaze not pointing down — skip
  const floorNear = eyeH / Math.tan(-lowerAngle);
  const startCm = Math.round(Math.max(20, (floorNear - BODY_TO_TOE) * 100) / 5) * 5;
  setNumberPair('floorZ', Math.min(300, startCm));
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
  by('stabOn').addEventListener('click', () => setStabMode('ideal'));
  by('stabOff').addEventListener('click', () => setStabMode('off'));
  if (by('stabHW')) by('stabHW').addEventListener('click', () => setStabMode('hw'));
  if (by('stabOIS')) by('stabOIS').addEventListener('click', () => setStabMode('ois'));
  if (by('modeReal')) by('modeReal').addEventListener('click', () => setExerciseMode('real'));
  if (by('modeTrain')) by('modeTrain').addEventListener('click', () => setExerciseMode('train'));
  if (by('stabDetailToggle')) by('stabDetailToggle').addEventListener('click', () => {
    const d = by('stabDetail');
    const t = by('stabDetailToggle');
    const open = d.style.display === 'none';
    d.style.display = open ? '' : 'none';
    t.textContent = open ? '▼ 알고리즘 상세 닫기' : '▶ 알고리즘 상세 보기';
  });
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
  const autoOptimizeBtn = by('autoOptimizeBtn');
  if (autoOptimizeBtn) autoOptimizeBtn.addEventListener('click', () => {
    // Set floorStart/floorD so the projection covers the eye FOV floor footprint.
    // The FOV lower edge (most downward ray) is where the projection must START —
    // anything closer is below the natural gaze and invisible without looking straight down.
    const eyeH = modelLoaded
      ? (getWorld(eyeBone, 'E').y + modelHeight * 0.07)
      : modelHeight * 0.93;
    const pitchRad = THREE.MathUtils.degToRad(Number(by('pitch').value || -18));
    const fovVRad = THREE.MathUtils.degToRad(Number(by('fov').value || 50));
    const BODY_TO_TOE = modelHeight * 0.35;

    // Distance from bodyPos where bottom FOV ray meets the floor
    const lowerAngleRad = pitchRad - fovVRad / 2;
    const floorNearM = eyeH / Math.tan(-lowerAngleRad); // metres from bodyPos

    // Slider values are relative to BODY_TO_TOE reference point
    const newStart = Math.round(Math.max(20, (floorNearM - BODY_TO_TOE) * 100) / 5) * 5;
    // Upper FOV ray doesn't hit floor → depth is unbounded; cap at slider max (3m).
    const newDepth = 300;

    setNumberPair('floorZ', Math.min(300, newStart));
    setNumberPair('floorD', newDepth);
    updateSurfaceFromInputs();
    updatePersonaAssessment();
  });

  const autoMoveBtn = by('autoMoveBtn');
  if (autoMoveBtn) autoMoveBtn.addEventListener('click', () => {
    autoMove = !autoMove;
    autoMoveBtn.textContent = autoMove ? '자동이동 ON' : '자동이동 OFF';
    autoMoveBtn.classList.toggle('active', autoMove);
  });
  function toggleEyeFov() {
    eyeFovVisible = !eyeFovVisible;
    const panelBtn = by('eyeFovBtn');
    const topBtn = by('eyeFovBtnTop');
    if (panelBtn) { panelBtn.textContent = eyeFovVisible ? '시야콘 ON' : '시야콘 OFF'; panelBtn.classList.toggle('active', eyeFovVisible); }
    if (topBtn) topBtn.classList.toggle('active', eyeFovVisible);
  }
  const eyeFovBtn = by('eyeFovBtn');
  if (eyeFovBtn) eyeFovBtn.addEventListener('click', toggleEyeFov);
  const eyeFovBtnTop = by('eyeFovBtnTop');
  if (eyeFovBtnTop) eyeFovBtnTop.addEventListener('click', toggleEyeFov);
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
    autoFloorStart();
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
    autoFloorStart();
  });
  bindPair('pitch', 'pitchN', (v) => {
    by('pitchVal').textContent = `${v}°`;
    if (currentView === 'eye') setView('eye');
    autoFloorStart();
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

  if (by('realismOn')) by('realismOn').addEventListener('click', () => setRealismAll(true));
  if (by('realismOff')) by('realismOff').addEventListener('click', () => setRealismAll(false));
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
  const inEyeView = currentView === 'eye';
  // Keep top button active state even in eye-view (cone is ON, just hidden in this view)
  const topBtn = by('eyeFovBtnTop');
  if (topBtn) topBtn.classList.toggle('active', eyeFovVisible);

  // If OFF or in eye view, hide and bail
  if (!eyeFovVisible || inEyeView) { eyeFovLines.visible = false; return; }

  // Guard: need valid forward vector and head bone before touching geometry
  if (cachedModelFwd.lengthSq() < 0.01) { eyeFovLines.visible = false; return; }
  const headPos = getWorld(eyeBone, 'E');
  if (!headPos || isNaN(headPos.x)) { eyeFovLines.visible = false; return; }
  // mixamorigHead bone is at chin/base-of-skull level; eyes are ~7% of modelHeight above it
  const eye = headPos.clone().add(new THREE.Vector3(0, modelHeight * 0.07, 0));
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
  // Set visible only after geometry is confirmed written this frame
  eyeFovLines.visible = true;
}

function updateProjection(dt) {
  updateUserMovement(dt);
  if (modelRoot) modelRoot.position.copy(userPosition);

  // Real running body oscillation: FBX root is static but an actual runner's COM moves.
  // Without this, bodyPos is unrealistically stable making OIS look better than reality.
  if (currentPreset === 'running' && activeAction && !paused && modelRoot) {
    const clip = activeAction.getClip();
    const ph = clip.duration > 0 ? (activeAction.time / clip.duration) * Math.PI * 2 : 0;
    gaitPhase = ph;
    // Vertical bounce ±5.5cm at 2Hz
    modelRoot.position.y += Math.sin(ph * 2) * 0.055;
    // Forward-back COM shift ±4cm at 2Hz
    modelRoot.position.x += cachedModelFwd.x * Math.cos(ph * 2) * 0.04;
    modelRoot.position.z += cachedModelFwd.z * Math.cos(ph * 2) * 0.04;
    // Lateral sway ±2.5cm at 1Hz
    modelRoot.position.x += cachedModelFwd.z * Math.sin(ph) * 0.025;
    modelRoot.position.z -= cachedModelFwd.x * Math.sin(ph) * 0.025;
  }

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

  // "발을 닫는 기준" — near edge anchored to bodyPos + max-stride toe extent (~35% height),
  // so the spring reference is stable (bodyPos barely moves during running: ±2-3cm).
  // Forward-toe bone tracking caused spring lag that pushed the floor backward under the body.
  const BODY_TO_TOE = modelHeight * 0.35;

  const stableTarget = new THREE.Vector3(
    bodyPos.x + modelFwd.x * (BODY_TO_TOE + planeCenterDist),
    0.012,
    bodyPos.z + modelFwd.z * (BODY_TO_TOE + planeCenterDist)
  );
  lastIdealTarget.copy(stableTarget);

  if (!stabInitialized) {
    qStabFloor.copy(stableTarget);
    stabVelocity.set(0, 0, 0);
    stabInitialized = true;
  }

  const KNEE_TO_TOE = modelHeight * 0.09;
  const rawFloorCenter = new THREE.Vector3(
    kneeModule.x + modelFwd.x * (KNEE_TO_TOE + planeCenterDist),
    0.012,
    kneeModule.z + modelFwd.z * (KNEE_TO_TOE + planeCenterDist)
  );

  const sensedTarget = new THREE.Vector3(
    stableTarget.x + (sensed.x - bodyPos.x) * 0.4,
    0.012,
    stableTarget.z + (sensed.z - bodyPos.z) * 0.4
  );

  // Angle target for spring: ideal→stableTarget, HW→sensedTarget (adds noise)
  const angleTarget = stabMode === 'hw' ? sensedTarget : stableTarget;

  floorPlane.rotation.y = Math.atan2(-modelFwd.x, -modelFwd.z);
  floorPlane.rotation.x = -Math.PI / 2; // keep flat on ground

  if (stabMode === 'ois') {
    // OIS + SW mode: no physical servo. bodyPos reference (SW) removes ~85% of knee oscillation.
    // OIS voice-coil catches residual fast tremor, clamped to ±7.5cm (≈ ±2.5° at 1.7m).
    const SW_EFF = 0.85;
    const swTarget = new THREE.Vector3(
      stableTarget.x + (rawFloorCenter.x - stableTarget.x) * (1 - SW_EFF),
      0.012,
      stableTarget.z + (rawFloorCenter.z - stableTarget.z) * (1 - SW_EFF)
    );

    if (!oisInitialized) {
      qOisSettled.copy(swTarget);
      oisInitialized = true;
    }

    // Settled position: slow macro-tracking (tau 0.5s), follows gradual posture shifts
    qOisSettled.lerp(swTarget, 1 - Math.exp(-dt / 0.5));

    // OIS fast correction: clamp to physical range (±7.5cm linear ≈ ±2.5° at 1.7m)
    const OIS_LIMIT = 0.075;
    const oisErr = swTarget.clone().sub(qOisSettled);
    if (oisErr.length() > OIS_LIMIT) oisErr.setLength(OIS_LIMIT);

    floorPlane.position.copy(qOisSettled).add(oisErr);
    floorPlane.position.y = 0.012;
    const wallAlpha = 1 - Math.exp(-dt / Math.max(0.03, tau));
    qStabWall.lerp(baseWall, wallAlpha);
    wallPlane.position.copy(qStabWall);
  } else if (stabilize) {
    // Safety: if spring drifted far from target (e.g. huge dt spike), snap immediately.
    if (qStabFloor.distanceTo(angleTarget) > 3.0) {
      qStabFloor.copy(angleTarget);
      stabVelocity.set(0, 0, 0);
    }
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
    // Raw mode: floor directly follows actual knee bone — no artificial oscillation.
    // Floor moves exactly as fast/slow as the animation; paused anim = static floor.
    floorPlane.position.copy(rawFloorCenter);
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
  const floorStart = floorZ / 100; // metres
  const floorDepth = floorD / 100;
  const pitchDeg = Number(by('pitch').value || -18);
  const fovDeg = Number(by('fov').value || 50);
  const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
  const fovVRad = THREE.MathUtils.degToRad(fovDeg);

  const hasMotion = Boolean(activeAction);
  const hasModel = Boolean(modelLoaded);
  const running = currentPreset === 'running';
  const modelText = hasModel ? '모델 로드됨' : '모델 미로드';
  const motionText = currentMotion ? `${currentMotion} 적용됨` : '동작 미적용';
  by('personaState').textContent = `${modelText} · ${motionText} · ${stabilize ? '안정화 ON' : '안정화 OFF'}`;

  // Eye height (with offset for bone position vs actual eye)
  const eyeH = hasModel
    ? (getWorld(eyeBone, 'E').y + modelHeight * 0.07)
    : modelHeight * 0.93;

  // BODY_TO_TOE matches updateProjection (max stride toe extent)
  const BODY_TO_TOE = modelHeight * 0.35;

  // Floor projection extents in world space ahead of body
  const nearDist = BODY_TO_TOE + floorStart;
  const farDist  = BODY_TO_TOE + floorStart + floorDepth;
  const centerDist = (nearDist + farDist) / 2;

  // Natural gaze: pitch slider is the center gaze angle
  // FOV lower edge = most downward ray the eye can see without moving head
  const lowerEdgeAngle = pitchRad - fovVRad / 2; // e.g. -18° - 25° = -43°
  // Distance on floor where lower FOV edge meets ground
  const floorVisibleFromDist = eyeH / Math.tan(-lowerEdgeAngle);
  // Visible floor range within natural gaze
  const visNear = Math.max(nearDist, floorVisibleFromDist);
  const visFar  = farDist;
  const covFrac = visFar > visNear
    ? Math.min(1, (visFar - visNear) / (farDist - nearDist))
    : 0;
  const covPct = covFrac * 100;

  // Angle to look at projection center, and how much extra tilt is needed
  const angleToCenter = -THREE.MathUtils.radToDeg(Math.atan2(eyeH, centerDist));
  const extraTilt = Math.max(0, Math.abs(angleToCenter) - Math.abs(lowerEdgeAngle * 180 / Math.PI));

  // Update gaze metrics display
  const covEl = by('gazeCoverage');
  if (covEl) { covEl.textContent = `${covPct.toFixed(0)}%`; covEl.className = covPct >= 60 ? 'ok mono' : covPct >= 30 ? 'warn mono' : 'bad mono'; }
  const extraEl = by('extraGazeAngle');
  if (extraEl) { extraEl.textContent = extraTilt < 1 ? '없음 (자연 시선 내)' : `+${extraTilt.toFixed(1)}° 더 숙여야 보임`; extraEl.className = extraTilt < 1 ? 'ok mono' : extraTilt < 10 ? 'warn mono' : 'bad mono'; }
  const centerEl = by('projCenterAngle');
  if (centerEl) centerEl.textContent = `${angleToCenter.toFixed(1)}° (자연 시선 ${pitchDeg.toFixed(0)}°)`;
  by('projAngle').textContent = `${lastFloorAngle.toFixed(1)}°`;
  by('projAngle').className = 'mono';

  // Verdict based on gaze coverage
  let verdict, verdictClass, reason;
  if (!hasModel) {
    verdict = '모델 필요'; verdictClass = 'warn';
    reason = 'X Bot 모델이 아직 로드되지 않았습니다.';
  } else if (covPct >= 60) {
    verdict = '시야 양호'; verdictClass = 'ok';
    reason = `자연 시선 안에 투사 영역 ${covPct.toFixed(0)}% 가 들어옵니다. 고개를 과하게 숙이지 않아도 정보 확인 가능합니다.`;
  } else if (covPct >= 20) {
    verdict = '시선 조정 필요'; verdictClass = 'warn';
    reason = `현재 자연 시선 커버율 ${covPct.toFixed(0)}% — 투사 중심을 보려면 고개를 ${extraTilt.toFixed(1)}° 더 숙여야 합니다. 피치 각도를 키우거나 바닥 시작 거리를 늘리면 개선됩니다.`;
  } else {
    verdict = '시야 밖'; verdictClass = 'bad';
    reason = `현재 설정에서 투사 영역이 자연 시선(${pitchDeg}°±${(fovDeg/2).toFixed(0)}°) 바깥에 있습니다. 머리 IMU 연동 짐벌 조향이 근본 해법입니다.`;
  }
  if (!stabilize && hasModel) { verdict = '안정화 꺼짐'; verdictClass = 'warn'; reason = '안정화가 꺼져 있어 투사 위치가 걸음에 따라 크게 흔들립니다.'; }

  by('personaVerdict').textContent = verdict;
  by('personaVerdict').className = verdictClass;
  by('personaReason').textContent = reason;

  // Auto-optimize: set pitch to bring projection center into natural gaze
  const needsOptimize = covPct < 60 && hasModel;
  const optPitch = Math.round(Math.max(-55, Math.min(-10, angleToCenter)));
  const optHint = `피치를 ${optPitch}° 로 조정하면 투사 중심이 자연 시선 내에 들어옵니다.`;
  const optRow = by('autoOptimizeRow');
  if (optRow) optRow.style.display = needsOptimize ? '' : 'none';
  const optHintEl = by('autoOptimizeHint');
  if (optHintEl) optHintEl.textContent = optHint;

  by('personaNote').textContent = running
    ? `러닝 중 자연 시선(${pitchDeg}°)에서 전방 ${(floorVisibleFromDist*100).toFixed(0)}cm 이상 바닥이 시야에 들어옵니다. 머리 IMU 연동 시 시선 방향 자동 추적으로 커버율 100% 달성 가능합니다.`
    : '머리 IMU + 짐벌 조향 시 고개 방향에 따라 투사가 자동으로 따라옵니다.';

  by('floorM').textContent = `시작 ${(floorStart*100).toFixed(0)} / 끝 ${((floorStart+floorDepth)*100).toFixed(0)}cm`;
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
  const dt = Math.min(clock.getDelta(), 0.05); // cap dt: prevents spring explosion on tab-resume
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
