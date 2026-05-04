const EPS = 1e-4;

export function createVaraFlowTube({
  THREE,
  scene,
  pathPoints = [],
  maxFlows = 3,
  tubularSegments = 200,
  radialSegments = 18,
  radius = 0.015,
  growSpeed = 0.7,
  slideSpeed = 0.45,
  shrinkSpeed = 0.45,
  minSpan = 0.02,
  scaleAmp = 0.2,
  scaleSpeed = 2.2,
  scaleFreq = Math.PI * 4,
  material = null
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const {
    MeshBasicMaterial,
    Mesh,
    BufferGeometry,
    BufferAttribute,
    Vector3
  } = THREE;

  const flows = [];
  let active = false;
  let currentFlow = null;
  let vectors = [];
  let cumulativeLengths = [];
  let totalLength = 0;

  const baseMaterial =
    material ||
    new MeshBasicMaterial({
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.85
    });

  function setPath(points) {
    vectors = (points || []).map(p => new Vector3(p.x, p.y, p.z));
    recomputeLengthTable();
    flows.forEach(flow => rebuildFlowGeometry(flow));
  }

  setPath(pathPoints);

  function disposeFlow(flow) {
    scene.remove(flow.mesh);
    flow.mesh.geometry?.dispose?.();
    flow.mesh.material?.dispose?.();
  }

  function spawnFlow() {
    if (vectors.length < 2) return null;
    if (flows.length >= maxFlows) {
      const oldest = flows.shift();
      disposeFlow(oldest);
    }
    const initialPoints = vectors.length >= 2 ? [vectors[0], vectors[1]] : [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1e-3, z: 0 }];
    const mesh = new Mesh(createStraightTubeGeometry(initialPoints, 1), baseMaterial.clone());
    mesh.frustumCulled = false;
    scene.add(mesh);
    const flow = {
      mesh,
      head: minSpan,
      tail: 0,
      state: 'growing',
      scalePhase: Math.random() * Math.PI * 2
    };
    flows.push(flow);
    return flow;
  }

  function endCurrentFlow() {
    if (!currentFlow) return;
    currentFlow.state = currentFlow.head >= 1 - EPS ? 'fullDraining' : 'draining';
    currentFlow = null;
  }

  function setActive(flag) {
    if (flag && !active) {
      currentFlow = spawnFlow();
    } else if (!flag && active) {
      endCurrentFlow();
    }
    active = flag;
  }

  function update(delta = 0) {
    if (!vectors.length) return;
    for (let i = flows.length - 1; i >= 0; i--) {
      const flow = flows[i];
      switch (flow.state) {
        case 'growing':
          flow.head = Math.min(1, flow.head + growSpeed * delta);
          if (flow.head >= 1 - EPS) {
            flow.head = 1;
            flow.tail = 0;
            flow.state = 'full';
          }
          break;
        case 'full':
          flow.head = 1;
          flow.tail = 0;
          if (!active || flow !== currentFlow) {
            flow.state = 'fullDraining';
            currentFlow = null;
          }
          break;
        case 'draining':
          flow.head = Math.min(1, flow.head + slideSpeed * delta);
          const targetTail = Math.max(0, flow.head - minSpan);
          flow.tail = Math.min(targetTail, flow.tail + shrinkSpeed * delta);
          if (flow.head >= 1 - EPS && flow.tail >= 1 - minSpan - EPS) {
            flow.state = 'done';
          } else if (flow.tail >= targetTail - EPS && flow.head < 1 - EPS) {
            flow.state = 'done';
          }
          break;
        case 'fullDraining':
          flow.head = 1;
          flow.tail = Math.min(1, flow.tail + shrinkSpeed * delta);
          if (flow.tail >= 1 - EPS) flow.state = 'done';
          break;
      }

      flow.scalePhase += delta * scaleSpeed;

      if (flow.state === 'done') {
        disposeFlow(flow);
        flows.splice(i, 1);
        continue;
      }

      rebuildFlowGeometry(flow);
    }
  }

  function rebuildFlowGeometry(flow) {
    const start = THREE.MathUtils.clamp(flow.tail, 0, Math.max(0, flow.head - minSpan));
    const end = THREE.MathUtils.clamp(flow.head, start + minSpan, 1);
    const subset = sampleCurveRange(vectors, start, end);
    const span = end - start;
    if (!subset.length || span <= 1e-4) {
      flow.mesh.visible = false;
      return;
    }

    const tubularSegs = Math.max(6, Math.floor(tubularSegments * span));
    flow.mesh.geometry?.dispose?.();
    flow.mesh.geometry = createStraightTubeGeometry(subset, tubularSegs);
    applyCrossSectionWarp(flow.mesh.geometry, flow, tubularSegs);
    flow.mesh.visible = true;
  }

  function sampleCurveRange(vectors, startT, endT) {
    if (vectors.length < 2 || totalLength <= 1e-6) return [];
    const start = THREE.MathUtils.clamp(startT, 0, 1);
    const end = THREE.MathUtils.clamp(endT, 0, 1);
    if (end - start <= 1e-4) return [];

    const startDist = start * totalLength;
    const endDist = end * totalLength;
    if (endDist - startDist <= 1e-4) return [];

    const subset = [sampleAtDistance(startDist)];
    for (let i = 1; i < cumulativeLengths.length - 1; i++) {
      const dist = cumulativeLengths[i];
      if (dist > startDist + 1e-4 && dist < endDist - 1e-4) {
        subset.push(vectors[i].clone());
      }
    }
    subset.push(sampleAtDistance(endDist));
    return subset;
  }

  function sampleAtDistance(distance) {
    if (distance <= 0) return vectors[0]?.clone?.() || new Vector3();
    if (distance >= totalLength) return vectors[vectors.length - 1]?.clone?.() || new Vector3();
    for (let i = 1; i < cumulativeLengths.length; i++) {
      if (distance <= cumulativeLengths[i]) {
        const prevDist = cumulativeLengths[i - 1];
        const span = Math.max(1e-6, cumulativeLengths[i] - prevDist);
        const t = (distance - prevDist) / span;
        return vectors[i - 1].clone().lerp(vectors[i], t);
      }
    }
    return vectors[vectors.length - 1].clone();
  }

  function recomputeLengthTable() {
    cumulativeLengths = [];
    totalLength = 0;
    if (vectors.length < 2) return;
    cumulativeLengths[0] = 0;
    for (let i = 1; i < vectors.length; i++) {
      totalLength += vectors[i - 1].distanceTo(vectors[i]);
      cumulativeLengths[i] = totalLength;
    }
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      totalLength = 0;
    }
  }

  function applyCrossSectionWarp(geometry, flow, tubularSegs) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    if (!position || !normal) return;
    const radialCount = radialSegments + 1;

    for (let i = 0; i < position.count; i++) {
      const ringIndex = Math.floor(i / radialCount);
      const progress = tubularSegs > 0 ? ringIndex / tubularSegs : 0;
      const scale = 1 + scaleAmp * Math.sin(flow.scalePhase + progress * scaleFreq);
      const offset = radius * (scale - 1);
      if (Math.abs(offset) < 1e-4) continue;
      const nx = normal.getX(i);
      const ny = normal.getY(i);
      const nz = normal.getZ(i);
      position.setXYZ(
        i,
        position.getX(i) + nx * offset,
        position.getY(i) + ny * offset,
        position.getZ(i) + nz * offset
      );
    }
    position.needsUpdate = true;
  }

  function createStraightTubeGeometry(points, tubularSegs) {
    const segments = tubularSegs;
    const radial = radialSegments;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const binormal = new Vector3();
    const tangent = new Vector3();
    const normal = new Vector3();
    const prevBinormal = new Vector3(0, 1, 0);
    const tmp = new Vector3();

    const curve = createPiecewiseLinearCurve(points);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPoint(t);
      tangent.copy(curve.getTangent(t)).normalize();
      if (i === 0) {
        normal.copy(prevBinormal);
        binormal.crossVectors(tangent, normal).normalize();
        normal.crossVectors(binormal, tangent).normalize();
      } else {
        binormal.crossVectors(prevBinormal, tangent).normalize();
        if (binormal.lengthSq() === 0) {
          binormal.copy(prevBinormal);
        }
        normal.crossVectors(binormal, tangent).normalize();
      }
      prevBinormal.copy(binormal);

      for (let j = 0; j <= radial; j++) {
        const v = (j / radial) * Math.PI * 2;
        tmp.copy(normal).multiplyScalar(Math.cos(v));
        tmp.addScaledVector(binormal, Math.sin(v));
        positions.push(point.x + tmp.x * radius, point.y + tmp.y * radius, point.z + tmp.z * radius);
        normals.push(tmp.x, tmp.y, tmp.z);
        uvs.push(i / segments, j / radial);
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = (radial + 1) * i + j;
        const b = (radial + 1) * (i + 1) + j;
        const c = (radial + 1) * (i + 1) + j + 1;
        const d = (radial + 1) * i + j + 1;
        indices.push(a, b, d, b, c, d);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  function createPiecewiseLinearCurve(points) {
    const vectors = points.map(p => new Vector3(p.x, p.y, p.z));
    const lengths = [];
    let total = 0;
    lengths[0] = 0;
    for (let i = 1; i < vectors.length; i++) {
      total += vectors[i].distanceTo(vectors[i - 1]);
      lengths[i] = total;
    }
    return {
      getPoint(t) {
        const target = t * total;
        for (let i = 1; i < lengths.length; i++) {
          if (target <= lengths[i]) {
            const span = lengths[i] - lengths[i - 1] || 1;
            const f = (target - lengths[i - 1]) / span;
            return vectors[i - 1].clone().lerp(vectors[i], f);
          }
        }
        return vectors[vectors.length - 1].clone();
      },
      getTangent(t) {
        const delta = 1e-3;
        const p1 = this.getPoint(Math.max(0, t - delta));
        const p2 = this.getPoint(Math.min(1, t + delta));
        return p2.clone().sub(p1).normalize();
      }
    };
  }

  function dispose() {
    flows.forEach(disposeFlow);
    flows.length = 0;
    currentFlow = null;
  }

  return {
    setPath,
    setActive,
    update,
    dispose
  };
}
