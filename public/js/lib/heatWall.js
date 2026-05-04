export function createHeatWallMesh(U, params, options = {}) {
  const { THREE } = options;
  if (!THREE) {
    throw new Error('THREE instance required in createHeatWallMesh');
  }
  const Nt = U.length - 1;
  const Ny = U[0].length;
  let width = options.width ?? 5;
  const height = options.height ?? 2.4;
  const scaleZ = options.scaleZ ?? 0.6;
  const thickness = Math.max(options.thickness ?? 0.12, 0);
  const backZ = 0;
  const pathNormalSign = options.pathNormalSign ?? 1;
  const inputPathPoints = Array.isArray(options.pathPoints) ? options.pathPoints : null;
  let pathPoints = null;
  let pathSegments = null;
  let pathLength = 0;
  const curveAngleDeg = Number.isFinite(options.curveAngleDeg) ? options.curveAngleDeg : 0;
  const curveAngleRad = THREE.MathUtils.degToRad(curveAngleDeg);
  let useCurve = Math.abs(curveAngleRad) > 1e-5;
  const halfWidth = width * 0.5;
  const curveRadius = useCurve ? (width / curveAngleRad) : 0;

  if (inputPathPoints && inputPathPoints.length >= 2) {
    const parsed = [];
    inputPathPoints.forEach(point => {
      if (!point) return;
      if (Array.isArray(point) && point.length >= 3) {
        parsed.push(new THREE.Vector3(point[0], point[1], point[2]));
        return;
      }
      if (point.isVector3) {
        parsed.push(point.clone());
      }
    });

    const deduped = [];
    parsed.forEach(point => {
      const previous = deduped[deduped.length - 1];
      if (!previous || previous.distanceToSquared(point) > 1e-10) {
        deduped.push(point);
      }
    });

    if (deduped.length >= 2) {
      const segments = [];
      for (let i = 0; i < deduped.length - 1; i += 1) {
        const start = deduped[i];
        const end = deduped[i + 1];
        const length = start.distanceTo(end);
        if (length <= 1e-8) continue;
        segments.push({
          start,
          end,
          length,
          cumulativeStart: pathLength,
          cumulativeEnd: pathLength + length
        });
        pathLength += length;
      }

      if (segments.length > 0 && pathLength > 1e-5) {
        pathPoints = deduped;
        pathSegments = segments;
        width = pathLength;
        useCurve = false;
      }
    }
  }

  const samplePath = distance => {
    if (!pathSegments || pathSegments.length === 0) return null;
    const clamped = THREE.MathUtils.clamp(distance, 0, pathLength);
    let segment = pathSegments[pathSegments.length - 1];
    for (let i = 0; i < pathSegments.length; i += 1) {
      if (clamped <= pathSegments[i].cumulativeEnd) {
        segment = pathSegments[i];
        break;
      }
    }
    const denom = Math.max(segment.length, 1e-8);
    const t = THREE.MathUtils.clamp((clamped - segment.cumulativeStart) / denom, 0, 1);
    const point = segment.start.clone().lerp(segment.end, t);
    const tangent = segment.end.clone().sub(segment.start).normalize();
    return { point, tangent };
  };

  const minU = Number.isFinite(params.minU) ? params.minU : -1;
  const maxU = Number.isFinite(params.maxU) ? params.maxU : 1;
  const rangeU = Math.max(maxU - minU, 1e-6);

  const colorLow = new THREE.Color(options.colorLow ?? 0x2456ff);
  const colorMid = new THREE.Color(options.colorMid ?? 0xffffff);
  const colorHigh = new THREE.Color(options.colorHigh ?? 0xff8a3d);
  const colorMidPoint = THREE.MathUtils.clamp(options.colorMidPoint ?? 0.5, 0.05, 0.95);
  const colorLowPower = Math.max(options.colorLowPower ?? 1, 0.05);
  const colorHighPower = Math.max(options.colorHighPower ?? 1, 0.05);
  const toonBands = Math.max(2, Math.min(32, Math.floor(options.toonBands ?? 4)));
  const maxLocalZ = thickness + scaleZ * rangeU;
  const depthRange = Math.max(maxLocalZ - backZ, 1e-6);

  const nx = Nt + 1;
  const ny = Ny;
  const dx = width / Nt;
  const dy = height / (Ny - 1);

  const frontCount = nx * ny;
  const totalCount = frontCount * 2;

  const positions = new Float32Array(totalCount * 3);
  const colors = new Float32Array(totalCount * 3);
  const heatSlices = new Float32Array(totalCount);

  const writeVertex = (index, x, y, z, t) => {
    let curvedX = x;
    let curvedY = y;
    let curvedZ = z;
    if (pathPoints) {
      const sample = samplePath(x);
      if (sample) {
        const normal = new THREE.Vector3(-sample.tangent.z, 0, sample.tangent.x);
        if (normal.lengthSq() <= 1e-10) {
          normal.set(1, 0, 0);
        }
        normal.normalize().multiplyScalar(pathNormalSign);
        curvedX = sample.point.x + normal.x * z;
        curvedY = sample.point.y + y;
        curvedZ = sample.point.z + normal.z * z;
      }
    } else if (useCurve) {
      const localX = x - halfWidth;
      const theta = (localX / width) * curveAngleRad;
      const radial = curveRadius + z;
      curvedX = Math.sin(theta) * radial + halfWidth;
      curvedZ = Math.cos(theta) * radial - curveRadius;
    }

    const i3 = index * 3;
    positions[i3] = curvedX;
    positions[i3 + 1] = curvedY;
    positions[i3 + 2] = curvedZ;
    // Drive the heat color bands from local thickness/depth so each transition is an x/y-plane cut.
    const depthT = THREE.MathUtils.clamp((z - backZ) / depthRange, 0, 1);
    heatSlices[index] = depthT;
    const bandedT = Math.round(depthT * (toonBands - 1)) / Math.max(toonBands - 1, 1);
    let color;
    if (bandedT <= colorMidPoint) {
      const shapedT = Math.pow(bandedT / colorMidPoint, colorLowPower);
      color = colorLow.clone().lerp(colorMid, shapedT);
    } else {
      const shapedT = Math.pow((bandedT - colorMidPoint) / (1 - colorMidPoint), colorHighPower);
      color = colorMid.clone().lerp(colorHigh, shapedT);
    }
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  };

  for (let ix = 0; ix < nx; ix += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      const u = U[ix][iy];
      const normalized = (u - minU) / rangeU;
      const x = ix * dx;
      const y = iy * dy;
      const z = thickness + scaleZ * (u - minU);
      const frontIndex = ix * ny + iy;
      const backIndex = frontIndex + frontCount;
      writeVertex(frontIndex, x, y, z, normalized);
      writeVertex(backIndex, x, y, backZ, normalized * 0.6);
    }
  }

  const indices = [];
  const frontIndex = (ix, iy) => ix * ny + iy;
  const backIndex = (ix, iy) => frontIndex(ix, iy) + frontCount;

  const slitCount = Math.max(0, Math.floor(options.slitCount ?? 0));
  const slitWidth = Math.max(0, options.slitWidth ?? 0);
  const slitCells = new Array(nx - 1).fill(false);
  const slitRanges = [];
  if (slitCount > 0 && slitWidth > 0) {
    for (let i = 0; i < slitCount; i += 1) {
      const centerX = (width * (i + 1)) / (slitCount + 1);
      const startX = centerX - slitWidth * 0.5;
      const endX = centerX + slitWidth * 0.5;
      let startCol = Math.max(1, Math.round(startX / dx));
      let endCol = Math.min(nx - 1, Math.round(endX / dx));
      if (endCol <= startCol) {
        endCol = Math.min(nx - 1, startCol + 1);
      }
      if (startCol >= nx - 1) continue;
      slitRanges.push({ startCol, endCol });
      for (let ix = startCol; ix < endCol; ix += 1) {
        if (ix >= 0 && ix < slitCells.length) slitCells[ix] = true;
      }
    }
  }

  for (let ix = 0; ix < nx - 1; ix += 1) {
    if (slitCells[ix]) continue;
    for (let iy = 0; iy < ny - 1; iy += 1) {
      const a = frontIndex(ix, iy);
      const b = frontIndex(ix + 1, iy);
      const c = frontIndex(ix + 1, iy + 1);
      const d = frontIndex(ix, iy + 1);
      indices.push(a, b, c, a, c, d);

      const a2 = backIndex(ix, iy);
      const b2 = backIndex(ix + 1, iy);
      const c2 = backIndex(ix + 1, iy + 1);
      const d2 = backIndex(ix, iy + 1);
      indices.push(a2, c2, b2, a2, d2, c2);
    }
  }

  for (let ix = 0; ix < nx - 1; ix += 1) {
    if (slitCells[ix]) continue;
    const a = frontIndex(ix, 0);
    const b = frontIndex(ix + 1, 0);
    const a2 = backIndex(ix, 0);
    const b2 = backIndex(ix + 1, 0);
    indices.push(a, b, b2, a, b2, a2);

    const c = frontIndex(ix, ny - 1);
    const d = frontIndex(ix + 1, ny - 1);
    const c2 = backIndex(ix, ny - 1);
    const d2 = backIndex(ix + 1, ny - 1);
    indices.push(c, c2, d2, c, d2, d);
  }

  for (let iy = 0; iy < ny - 1; iy += 1) {
    const a = frontIndex(0, iy);
    const b = frontIndex(0, iy + 1);
    const a2 = backIndex(0, iy);
    const b2 = backIndex(0, iy + 1);
    indices.push(a, a2, b2, a, b2, b);

    const c = frontIndex(nx - 1, iy);
    const d = frontIndex(nx - 1, iy + 1);
    const c2 = backIndex(nx - 1, iy);
    const d2 = backIndex(nx - 1, iy + 1);
    indices.push(c, d, d2, c, d2, c2);
  }

  slitRanges.forEach(({ startCol, endCol }) => {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      const a = frontIndex(startCol, iy);
      const b = frontIndex(startCol, iy + 1);
      const a2 = backIndex(startCol, iy);
      const b2 = backIndex(startCol, iy + 1);
      indices.push(a, a2, b2, a, b2, b);

      const c = frontIndex(endCol, iy);
      const d = frontIndex(endCol, iy + 1);
      const c2 = backIndex(endCol, iy);
      const d2 = backIndex(endCol, iy + 1);
      indices.push(c, d, d2, c, d2, c2);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('heatSlice', new THREE.BufferAttribute(heatSlices, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: false,
    roughness: 0.45,
    metalness: 0.12,
    side: THREE.DoubleSide
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uHeatLow = { value: colorLow.clone() };
    shader.uniforms.uHeatMid = { value: colorMid.clone() };
    shader.uniforms.uHeatHigh = { value: colorHigh.clone() };
    shader.uniforms.uHeatMidPoint = { value: colorMidPoint };
    shader.uniforms.uHeatLowPower = { value: colorLowPower };
    shader.uniforms.uHeatHighPower = { value: colorHighPower };
    shader.uniforms.uHeatBandCount = { value: toonBands };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float heatSlice;
varying float vHeatSlice;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vHeatSlice = heatSlice;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uHeatLow;
uniform vec3 uHeatMid;
uniform vec3 uHeatHigh;
uniform float uHeatMidPoint;
uniform float uHeatLowPower;
uniform float uHeatHighPower;
uniform float uHeatBandCount;
varying float vHeatSlice;

vec3 getHeatBandColor(float sliceT) {
  float clampedT = clamp(sliceT, 0.0, 1.0);
  float steps = max(uHeatBandCount - 1.0, 1.0);
  float bandedT = round(clampedT * steps) / steps;
  if (bandedT <= uHeatMidPoint) {
    float shapedT = pow(bandedT / max(uHeatMidPoint, 0.0001), uHeatLowPower);
    return mix(uHeatLow, uHeatMid, shapedT);
  }
  float shapedT = pow((bandedT - uHeatMidPoint) / max(1.0 - uHeatMidPoint, 0.0001), uHeatHighPower);
  return mix(uHeatMid, uHeatHigh, shapedT);
}`
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( getHeatBandColor(vHeatSlice), opacity );'
      );
  };
  material.customProgramCacheKey = () => `heat-wall-standard-${toonBands}`;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name ?? 'HeatWall';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}
