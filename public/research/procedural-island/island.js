import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

export const DEFAULT_ISLAND_PARAMS = {
  seed: 1337,
  resolution: 48,
  isoLevel: 82,
  maxPolyCount: 90000,
  scale: 10.0,
  heightScale: 0.86,
  topHeight: 0.34,
  cliffBottom: 0.05,
  bottomMin: -0.6,
  bottomRise: 0.5,
  topRadius: 0.9,
  bottomRadius: 0.45,
  bottomCurve: 1.6,
  sideTaper: 1.25,
  edgeNoiseAmp: 0.02,
  edgeNoiseFreq: 2.2,
  fieldFalloff: 60,
  boundaryPadding: 0.02,
  cliffFacetStrength: 0.14,
  cliffFacetFreq: 1.6,
  cliffFacetYFreq: 1.9,
  cliffFacetSteps: 3,
  cliffBand: 0.26,
  rockCount: 150,
  rockSizeMin: 0.03,
  rockSizeMax: 0.26,
  rockRadialJitter: 0.04,
  rockColor: 0x4a5563,
  rockBaseBoost: 1.7,
  rockFieldStrength: 0.3,
  rockAngleScale: 1.3,
  rockYScale: 2.2,
  rockRScale: 4.2,
  rockInset: 0.02,
  rockFalloff: 1.4,
  rockStackingStrength: 0.05,
  rockStrataSteps: 6,
  rockStrataMix: 0.55,
  rockMaskThickness: 0.24,
  rockMaskCut: 0.32,
  color: 0xd3b68c,
  wireColor: 0x102030,
  wireOpacity: 0.45,
  wireVisible: true,
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2D(ix, iz, seed) {
  const s = seed | 0;
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1442695041);
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

function hash3D(ix, iy, iz, seed) {
  const s = seed | 0;
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 1442695041) +
    Math.imul(iz, 668265263) +
    Math.imul(s, 362437);
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

function valueNoise2D(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const v00 = hash2D(xi, zi, seed);
  const v10 = hash2D(xi + 1, zi, seed);
  const v01 = hash2D(xi, zi + 1, seed);
  const v11 = hash2D(xi + 1, zi + 1, seed);

  const n0 = lerp(v00, v10, u);
  const n1 = lerp(v01, v11, u);
  return lerp(n0, n1, v) * 2 - 1;
}

function cellNoise3D(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  return hash3D(xi, yi, zi, seed) * 2 - 1;
}

function quantizeSigned(value, steps) {
  if (steps <= 1) return Math.sign(value);
  const t = clamp((value + 1) * 0.5, 0, 1);
  const q = Math.round(t * steps) / steps;
  return q * 2 - 1;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng, min, max) {
  return min + (max - min) * rng();
}

function fillField(mc, params) {
  const size = mc.size;
  const half = mc.halfsize;
  const invHalf = 1 / half;
  const field = mc.field;

  const iso = params.isoLevel;
  const falloff = params.fieldFalloff;
  const seed = params.seed | 0;
  const noiseFreq = params.edgeNoiseFreq;
  const edgeAmp = params.edgeNoiseAmp;
  const boundaryPadding = params.boundaryPadding ?? 0.02;
  const cliffFacetStrength = params.cliffFacetStrength ?? 0;
  const cliffFacetFreq = params.cliffFacetFreq ?? 1;
  const cliffFacetYFreq = params.cliffFacetYFreq ?? cliffFacetFreq;
  const cliffFacetSteps = Math.max(1, params.cliffFacetSteps ?? 1);
  const cliffBand = params.cliffBand ?? 0.2;
  const rockCount = Math.max(0, Math.floor(params.rockCount ?? 0));
  const rockMin = params.rockSizeMin ?? 0.05;
  const rockMax = params.rockSizeMax ?? 0.12;
  const rockRadialJitter = params.rockRadialJitter ?? 0;
  const rockBaseBoost = params.rockBaseBoost ?? 1;
  const rockFieldStrength = params.rockFieldStrength ?? 0;
  const rockAngleScale = params.rockAngleScale ?? 1.6;
  const rockYScale = params.rockYScale ?? 2.4;
  const rockRScale = params.rockRScale ?? 6.0;
  const rockInset = params.rockInset ?? 0.02;
  const rockFalloff = params.rockFalloff ?? 1.5;
  const rockStackingStrength = params.rockStackingStrength ?? 0.03;
  const rockStrataSteps = Math.max(1, params.rockStrataSteps ?? 1);
  const rockStrataMix = clamp(params.rockStrataMix ?? 0, 0, 1);

  const topRadius = params.topRadius;
  const bottomRadius = params.bottomRadius;
  const topHeight = params.topHeight;
  const cliffBottom = params.cliffBottom;
  const bottomMin = params.bottomMin;
  const bottomRise = params.bottomRise;
  const bottomCurve = params.bottomCurve;
  const sideTaper = params.sideTaper;

  const maxCoord = (size - 2 - half) * invHalf;
  const safeMax = Math.max(0.2, maxCoord - boundaryPadding);
  const safeTopHeight = Math.min(topHeight, safeMax);
  const safeBottomMin = Math.max(bottomMin, -safeMax);
  const baseBottomR = clamp(bottomRadius, 0.05, safeMax);
  const rockInfluence = rockMax * 2.2;

  let rockAngles = null;
  let rockHeights = null;
  let rockSizes = null;
  let rockRadials = null;
  let bandLow = 0;
  let bandHigh = 0;

  if (rockCount > 0 && rockFieldStrength > 0) {
    bandLow = clamp(cliffBottom - cliffBand * 0.75, safeBottomMin + 0.05, cliffBottom - 0.02);
    bandHigh = clamp(cliffBottom + cliffBand * 0.25, cliffBottom - 0.02, safeTopHeight - 0.02);
    if (bandHigh > bandLow) {
      rockAngles = new Float32Array(rockCount);
      rockHeights = new Float32Array(rockCount);
      rockSizes = new Float32Array(rockCount);
      rockRadials = new Float32Array(rockCount);
      const rng = makeRng(seed + 717);
      const strataStep = (bandHigh - bandLow) / rockStrataSteps;

      for (let i = 0; i < rockCount; i++) {
        const angle = randRange(rng, 0, TAU);
        let y = randRange(rng, bandLow, bandHigh);
        const heightLerp = clamp((y - bandLow) / Math.max(1e-6, bandHigh - bandLow), 0, 1);
        const heightBias = Math.pow(1 - heightLerp, 1.4);
        const sizeBase = lerp(rockMax, rockMin, heightLerp);
        const size = sizeBase * (1 + (rockBaseBoost - 1) * heightBias) * randRange(rng, 0.8, 1.15);

        y -= rockStackingStrength * heightLerp;
        if (rockStrataSteps > 1 && strataStep > 1e-6) {
          const stepIndex = Math.round((y - bandLow) / strataStep);
          const yStrata = bandLow + stepIndex * strataStep;
          y = lerp(y, yStrata, rockStrataMix);
        }

        rockAngles[i] = angle;
        rockHeights[i] = y;
        rockSizes[i] = size;
        rockRadials[i] = randRange(rng, -rockRadialJitter, rockRadialJitter);
      }
    }
  }

  let idx = 0;
  for (let z = 0; z < size; z++) {
    const nz = (z - half) * invHalf;
    for (let y = 0; y < size; y++) {
      const ny = (y - half) * invHalf;
      for (let x = 0; x < size; x++, idx++) {
        const nx = (x - half) * invHalf;
        const r = Math.sqrt(nx * nx + nz * nz);

        const edgeNoise = edgeAmp !== 0
          ? edgeAmp * valueNoise2D(nx * noiseFreq, nz * noiseFreq, seed)
          : 0;
        const topR = clamp(topRadius + edgeNoise, 0.2, safeMax);
        const bottomR = Math.min(baseBottomR, topR * 0.92);
        const t = smoothstep(safeBottomMin, cliffBottom, ny);
        const taperT = sideTaper === 1 ? t : Math.pow(t, sideTaper);
        const bandTop = Math.min(safeTopHeight, cliffBottom + cliffBand);
        const upperMask = bandTop <= cliffBottom + 1e-6
          ? 1
          : 1 - smoothstep(cliffBottom, bandTop, ny);
        const cliffMask = smoothstep(safeBottomMin, cliffBottom, ny) * upperMask;
        const facetNoise = cliffFacetStrength === 0 ? 0 : cellNoise3D(
          (nx + 1.7) * cliffFacetFreq,
          (ny + 2.3) * cliffFacetYFreq,
          (nz - 1.1) * cliffFacetFreq,
          seed + 911
        );
        const facetQuant = cliffFacetStrength === 0 ? 0 : quantizeSigned(facetNoise, cliffFacetSteps);
        const facetOffset = facetQuant * cliffFacetStrength * cliffMask;
        const rMax = clamp(lerp(bottomR, topR, taperT) + facetOffset, 0.05, safeMax);

        const rNorm = clamp(r / Math.max(1e-6, topR), 0, 1);
        const bottomHeight = safeBottomMin + bottomRise * Math.pow(rNorm, bottomCurve);

        const dTop = ny - safeTopHeight;
        const dBottom = bottomHeight - ny;
        const dSide = r - rMax;
        let dSideRock = dSide;

        if (rockAngles && cliffMask > 0.001 && Math.abs(dSide) < rockInfluence) {
          const a = Math.atan2(nz, nx);
          let rockBump = 0;
          const cellQuant = cliffFacetStrength === 0
            ? 1
            : 0.7 + 0.3 * (0.5 + 0.5 * quantizeSigned(
              cellNoise3D(nx * cliffFacetFreq * 0.6, ny * cliffFacetYFreq * 0.6, nz * cliffFacetFreq * 0.6, seed + 133),
              cliffFacetSteps
            ));

          for (let i = 0; i < rockCount; i++) {
            let da = Math.abs(a - rockAngles[i]);
            if (da > Math.PI) da = TAU - da;
            const dy = ny - rockHeights[i];
            const dr = r - (rMax - rockInset + rockRadials[i]);
            const q = Math.sqrt(
              (da * rockAngleScale) * (da * rockAngleScale) +
              (dy * rockYScale) * (dy * rockYScale) +
              (dr * rockRScale) * (dr * rockRScale)
            );
            const falloff = rockSizes[i] * rockFalloff;
            const qn = q / Math.max(1e-6, falloff);
            if (qn < 1) {
              const bump = rockSizes[i] * smoothstep(1, 0, qn);
              if (bump > rockBump) rockBump = bump;
            }
          }

          rockBump *= rockFieldStrength * cellQuant * cliffMask;
          dSideRock = dSide - rockBump;
        }

        const d = Math.max(dTop, dBottom, dSideRock);

        let density = iso - d * falloff;
        if (!Number.isFinite(density)) density = 100;
        field[idx] = clamp(density, 0, 100);
      }
    }
  }
}

function applyCliffMaskMaterial(material, params, mode) {
  material.customProgramCacheKey = () => `cliffmask_${mode}`;
  material.userData.cliffMaskMode = mode;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScaleXZ = { value: params.scale };
    shader.uniforms.uScaleY = { value: params.scale * params.heightScale };
    shader.uniforms.uTopHeight = { value: params.topHeight };
    shader.uniforms.uCliffBottom = { value: params.cliffBottom };
    shader.uniforms.uBottomMin = { value: params.bottomMin };
    shader.uniforms.uTopRadius = { value: params.topRadius };
    shader.uniforms.uBottomRadius = { value: params.bottomRadius };
    shader.uniforms.uSideTaper = { value: params.sideTaper };
    shader.uniforms.uCliffBand = { value: params.cliffBand };
    shader.uniforms.uRockMaskThickness = { value: params.rockMaskThickness ?? 0.12 };
    shader.uniforms.uRockMaskCut = { value: params.rockMaskCut ?? 0.22 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPosition;'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWorldPosition = worldPosition.xyz;'
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying vec3 vWorldPosition;',
        'uniform float uScaleXZ;',
        'uniform float uScaleY;',
        'uniform float uTopHeight;',
        'uniform float uCliffBottom;',
        'uniform float uBottomMin;',
        'uniform float uTopRadius;',
        'uniform float uBottomRadius;',
        'uniform float uSideTaper;',
        'uniform float uCliffBand;',
        'uniform float uRockMaskThickness;',
        'uniform float uRockMaskCut;',
      ].join('\n')
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      [
        'void main() {',
        '  vec3 p = vWorldPosition;',
        '  float nx = p.x / uScaleXZ;',
        '  float ny = p.y / uScaleY;',
        '  float nz = p.z / uScaleXZ;',
        '  float r = length(vec2(nx, nz));',
        '  float t = smoothstep(uBottomMin, uCliffBottom, ny);',
        '  float taperT = (abs(uSideTaper - 1.0) < 1e-4) ? t : pow(t, uSideTaper);',
        '  float rMax = mix(uBottomRadius, uTopRadius, taperT);',
        '  float bandTop = min(uTopHeight, uCliffBottom + uCliffBand);',
        '  float upperMask = 1.0;',
        '  if (bandTop > uCliffBottom + 1e-5) {',
        '    upperMask = 1.0 - smoothstep(uCliffBottom, bandTop, ny);',
        '  }',
        '  float cliffMask = smoothstep(uBottomMin, uCliffBottom, ny) * upperMask;',
        '  float sideDist = r - rMax;',
        '  float sideMask = 1.0 - smoothstep(0.0, uRockMaskThickness, abs(sideDist));',
        '  float rockMask = cliffMask * sideMask;',
        mode === 'rock'
          ? '  if (rockMask < uRockMaskCut) discard;'
          : '  if (rockMask > uRockMaskCut) discard;',
      ].join('\n')
    );
    material.userData.cliffMaskCompiled = true;
  };
  material.needsUpdate = true;
}

export function create_island(THREE, opts = {}) {
  const params = {
    ...DEFAULT_ISLAND_PARAMS,
    ...opts,
  };

  if (!Number.isFinite(params.bottomRise)) {
    params.bottomRise = params.cliffBottom - params.bottomMin;
  }

  const group = new THREE.Group();
  group.name = 'ISLAND';
  group.scale.set(params.scale, params.scale * params.heightScale, params.scale);

  const sandMaterial = new THREE.MeshStandardMaterial({
    color: params.color,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  });
  applyCliffMaskMaterial(sandMaterial, params, 'sand');

  const rockMaterial = new THREE.MeshStandardMaterial({
    color: params.rockColor,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  applyCliffMaskMaterial(rockMaterial, params, 'rock');

  const mc = new MarchingCubes(
    params.resolution,
    sandMaterial,
    false,
    false,
    params.maxPolyCount
  );
  mc.isolation = params.isoLevel;
  mc.castShadow = true;
  mc.receiveShadow = true;
  mc.name = 'ISLAND_SOLID';

  fillField(mc, params);
  mc.update();

  if (!Number.isFinite(mc.count) || mc.count <= 0) {
    throw new Error('MarchingCubes produced empty geometry; adjust island params.');
  }

  mc.geometry.computeBoundingBox();
  mc.geometry.computeBoundingSphere();

  const rockMesh = new THREE.Mesh(mc.geometry, rockMaterial);
  rockMesh.name = 'ISLAND_ROCK';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;

  const wire = new THREE.Mesh(
    mc.geometry,
    new THREE.MeshBasicMaterial({
      color: params.wireColor,
      wireframe: true,
      transparent: true,
      opacity: params.wireOpacity,
    })
  );
  wire.name = 'ISLAND_WIRE';
  wire.visible = params.wireVisible;

  group.add(mc);
  group.add(rockMesh);
  group.add(wire);

  return {
    group,
    stats: {
      triangles: mc.count / 3,
      resolution: params.resolution,
      isoLevel: params.isoLevel,
    },
    paramsUsed: params,
  };
}
