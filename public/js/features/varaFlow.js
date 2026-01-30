import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

export function createVaraFlow({
  THREE,
  vara,
  registerUpdater,
  registerInteractive,
  interactives,
  options = {}
} = {}) {
  if (!THREE || !vara || typeof registerUpdater !== 'function') return null;

  const {
    Box3,
    CatmullRomCurve3,
    Color,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
    Vector3
  } = THREE;

  vara.updateMatrixWorld(true);

  const worldBounds = new Box3().setFromObject(vara);
  const worldCorners = [
    new Vector3(worldBounds.min.x, worldBounds.min.y, worldBounds.min.z),
    new Vector3(worldBounds.min.x, worldBounds.min.y, worldBounds.max.z),
    new Vector3(worldBounds.min.x, worldBounds.max.y, worldBounds.min.z),
    new Vector3(worldBounds.min.x, worldBounds.max.y, worldBounds.max.z),
    new Vector3(worldBounds.max.x, worldBounds.min.y, worldBounds.min.z),
    new Vector3(worldBounds.max.x, worldBounds.min.y, worldBounds.max.z),
    new Vector3(worldBounds.max.x, worldBounds.max.y, worldBounds.min.z),
    new Vector3(worldBounds.max.x, worldBounds.max.y, worldBounds.max.z)
  ];

  const localBounds = new Box3();
  worldCorners.forEach(corner => {
    const localPoint = vara.worldToLocal(corner.clone());
    localBounds.expandByPoint(localPoint);
  });
  const localCenter = localBounds.getCenter(new Vector3());
  const localSize = localBounds.getSize(new Vector3());
  const localMin = localBounds.min.clone();
  const localMax = localBounds.max.clone();

  const span = Math.max(localSize.x, 0.001);
  const thickness = Math.max(localSize.y, 0.001);
  const chord = Math.max(localSize.z, 0.001);

  const suctionBias = options.suctionBias ?? 0.62;
  const layerLift = thickness * (options.layerLiftFactor ?? 0.42);
  const tailDrop = thickness * (options.tailDropFactor ?? 0.18);

  const flowGroup = new Group();
  flowGroup.name = 'VaraMetaballFlow';
  flowGroup.position.copy(localCenter);
  vara.add(flowGroup);

  const relativeMin = localMin.clone().sub(localCenter);
  const relativeMax = localMax.clone().sub(localCenter);
  const relativeSize = relativeMax.clone().sub(relativeMin);

  // Align splines with Vara's local axes: +Z is upstream, so flow moves toward decreasing Z.
  const upstreamZ = Math.max(relativeMin.z, relativeMax.z);
  const downstreamZ = Math.min(relativeMin.z, relativeMax.z);
  const sumZ = upstreamZ + downstreamZ;
  const mirrorZ = value => sumZ - value;

  let curves;
  if (options.debugLine === true) {
    const start = new Vector3(0, relativeMin.y + thickness * 0.5, upstreamZ + chord * 0.3);
    const end = new Vector3(0, start.y, downstreamZ - chord * 0.4);
    const debugCurve = new CatmullRomCurve3([start, end], false, 'catmullrom', 0.5);
    curves = [debugCurve];
  } else {
    const curveOffsets = options.offsets ?? [-0.55, -0.3, 0, 0.3, 0.55];
    curves = curveOffsets.map(offset => {
      const spanOffset = offset * span * 0.45;
      const basePoints = [
        { x: spanOffset, y: relativeMin.y + thickness * 0.2, z: downstreamZ - chord * 0.25 },
        {
          x: spanOffset * 0.6,
          y: relativeMin.y + thickness * suctionBias + layerLift,
          z: (downstreamZ + upstreamZ) * 0.35
        },
        {
          x: spanOffset * 0.35,
          y: relativeMin.y + thickness * (suctionBias + 0.08),
          z: (downstreamZ + upstreamZ) * 0.65
        },
        { x: spanOffset * 0.18, y: relativeMin.y + tailDrop, z: upstreamZ + chord * 0.22 }
      ];
      const points = basePoints.map(({ x, y, z }) => new Vector3(x, y, mirrorZ(z)));
      return new CatmullRomCurve3(points, false, 'catmullrom', 0.55);
    });
  }

  const resolution = options.resolution ?? 56;
  const material = new MeshStandardMaterial({
    color: new Color(0x4fd1ff),
    transparent: true,
    opacity: 0.65,
    metalness: 0.1,
    roughness: 0.08,
    envMapIntensity: 0.8,
    depthWrite: false
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.time = { value: 0 };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nuniform float time;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>\nfloat fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.0);\nfloat ripple = sin((vUv.y + time * 0.45) * 12.0) * 0.06;\nfloat alpha = clamp(opacity * (0.72 + fresnel * 0.4 + ripple), 0.0, 1.0);\n#if defined( USE_TRANSMISSION )\n  outgoingLight = mix(outgoingLight, vec3(0.8, 0.9, 1.0), fresnel * 0.35);\n#endif\ngl_FragColor = vec4(outgoingLight, alpha);`
    );
    material.userData.shader = shader;
  };

  const metaballs = new MarchingCubes(resolution, material, true, false, options.maxPolyCount ?? 60000);
  metaballs.name = 'VaraMetaballSurface';
  metaballs.position.set(0, 0, 0);
  metaballs.scale.set(relativeSize.x || 1, relativeSize.y || 1, relativeSize.z || 1);
  metaballs.isolation = options.isolation ?? 12;
  flowGroup.add(metaballs);

  const particles = curves.map(curve => ({
    curve,
    t: Math.random(),
    speed: options.baseSpeed ?? 0.22,
    color: 0x58f7ff
  }));

  const particleGeometry = new SphereGeometry(0.05, 10, 8);
  const debugParticles = options.debugParticles ?? false;
  if (debugParticles) {
    particles.forEach(particle => {
      const mesh = new Mesh(
        particleGeometry,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false })
      );
      mesh.name = `VaraFlowDebugParticle_${Math.random().toString(16).slice(2)}`;
      flowGroup.add(mesh);
      particle.debugMesh = mesh;
    });
  }

  const flowState = {
    boostTarget: 0,
    boostValue: 0,
    pointerLocal: null
  };

  const toNormalized = point => {
    return new Vector3(
      (point.x - relativeMin.x) / (relativeSize.x || 1),
      (point.y - relativeMin.y) / (relativeSize.y || 1),
      (point.z - relativeMin.z) / (relativeSize.z || 1)
    );
  };

  const unregisterUpdate = registerUpdater(({ delta = 0, elapsed = 0 }) => {
    if (!metaballs.parent) return;

    metaballs.reset();
    const shader = material.userData.shader;
    if (shader) {
      shader.uniforms.time.value = elapsed;
    }

    flowState.boostValue += (flowState.boostTarget - flowState.boostValue) * Math.min(delta * 6.5, 0.25);

    const boostSpeed = THREE.MathUtils.lerp(1, options.boostMultiplier ?? 3.0, flowState.boostValue);
    const influence = THREE.MathUtils.lerp(options.baseStrength ?? 0.42, options.boostStrength ?? 0.8, flowState.boostValue);
    const subtract = options.subtract ?? 6.0;

    particles.forEach(particle => {
      particle.t = (particle.t + delta * particle.speed * boostSpeed) % 1;
      const localPoint = particle.curve.getPointAt(particle.t);
      const normalized = toNormalized(localPoint);
      metaballs.addBall(normalized.x, normalized.y, normalized.z, influence, subtract, particle.color);
      if (particle.debugMesh) {
        particle.debugMesh.position.copy(localPoint);
      }
    });

    if (flowState.pointerLocal) {
      const normalized = toNormalized(flowState.pointerLocal);
      metaballs.addBall(normalized.x, normalized.y, normalized.z, influence * 0.5, subtract, 0x89ffff);
    }

    metaballs.update();
  });

  const interactiveGeometry = new THREE.BoxGeometry(relativeSize.x * 1.05 || 1, relativeSize.y * 1.15 || 1, relativeSize.z * 1.2 || 1);
  const interactiveMaterial = new MeshBasicMaterial({ visible: false });
  const interactiveMesh = new Mesh(interactiveGeometry, interactiveMaterial);
  interactiveMesh.name = 'VaraFlowInteractive';
  flowGroup.add(interactiveMesh);

  const setBoost = active => {
    flowState.boostTarget = active ? 1 : 0;
  };

  registerInteractive(interactiveMesh, {
    isVaraFlow: true,
    baseScale: 1,
    hoverScale: 1,
    onHover: () => setBoost(true),
    onLeave: () => {
      setBoost(false);
      flowState.pointerLocal = null;
    },
    onPointerMove: (_, hit) => {
      if (hit?.point) {
        const localPoint = flowGroup.worldToLocal(hit.point.clone());
        flowState.pointerLocal = localPoint;
      }
    }
  });

  const dispose = () => {
    unregisterUpdate?.();
    if (Array.isArray(interactives)) {
      const idx = interactives.indexOf(interactiveMesh);
      if (idx >= 0) interactives.splice(idx, 1);
    }
    interactiveMesh.parent?.remove(interactiveMesh);
    interactiveGeometry.dispose();
    interactiveMaterial.dispose();
    metaballs.parent?.remove(metaballs);
    metaballs.geometry?.dispose?.();
    particles.forEach(particle => {
      particle.debugMesh?.parent?.remove(particle.debugMesh);
      particle.debugMesh?.material?.dispose?.();
    });
    particles.length = 0;
    particleGeometry.dispose();
    flowGroup.parent?.remove(flowGroup);
  };

  return {
    group: flowGroup,
    surface: metaballs,
    dispose,
    setBoost
  };
}

/**
 * Creates a smoothed guide line slightly above the Vara airfoil by slicing it with a YZ plane.
 * The input x-coordinate is interpreted in Vara's centered local space (+X outboard, +Y upward, +Z upstream).
 */
export function createVaraCrossSectionGuide({
  THREE,
  vara,
  xCoord = 0,
  offset = 0.08,
  attach = true,
  material = null,
  sampleStep = 0.015
} = {}) {
  if (!THREE || !vara) return null;

  const {
    Box3,
    BufferGeometry,
    CatmullRomCurve3,
    Line,
    LineBasicMaterial,
    Matrix4,
    Vector3
  } = THREE;

  vara.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(vara);
  const localCenter = bounds.getCenter(new Vector3());
  const targetX = xCoord + localCenter.x;

  const inverseVaraMatrix = new Matrix4().copy(vara.matrixWorld).invert();

  const EPS = 1e-6;
  const segments = [];
  const tempMatrix = new Matrix4();
  const edgeIndices = [
    [0, 1],
    [1, 2],
    [2, 0]
  ];

  const fetchVertex = (positionAttribute, index, matrix, target) => {
    target.set(
      positionAttribute.getX(index),
      positionAttribute.getY(index),
      positionAttribute.getZ(index)
    );
    return target.applyMatrix4(matrix);
  };

  const ensureUnique = (collection, candidate, epsilonSquared = 1e-10) => {
    for (let i = 0; i < collection.length; i += 1) {
      if (collection[i].distanceToSquared(candidate) < epsilonSquared) {
        return false;
      }
    }
    return true;
  };

  const samplePoint = new Vector3();
  const vertexTargets = [new Vector3(), new Vector3(), new Vector3()];

  vara.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;

    const geometry = node.geometry;
    const positionAttr = geometry.attributes.position;
    const indexAttr = geometry.index;

    node.updateMatrixWorld(true);
    tempMatrix.copy(node.matrixWorld).premultiply(inverseVaraMatrix);

    const getIndex = idx => (indexAttr ? indexAttr.getX(idx) : idx);
    const triangleCount = indexAttr ? indexAttr.count / 3 : positionAttr.count / 3;

    for (let tri = 0; tri < triangleCount; tri += 1) {
      const i0 = getIndex(tri * 3);
      const i1 = getIndex(tri * 3 + 1);
      const i2 = getIndex(tri * 3 + 2);

      const p0 = fetchVertex(positionAttr, i0, tempMatrix, vertexTargets[0]);
      const p1 = fetchVertex(positionAttr, i1, tempMatrix, vertexTargets[1]);
      const p2 = fetchVertex(positionAttr, i2, tempMatrix, vertexTargets[2]);

      const distances = [p0.x - targetX, p1.x - targetX, p2.x - targetX];
      let allPositive = true;
      let allNegative = true;
      for (let d = 0; d < 3; d += 1) {
        const value = distances[d];
        if (value < -EPS) allPositive = false;
        if (value > EPS) allNegative = false;
      }
      if (allPositive || allNegative) continue;

      const intersections = [];
      edgeIndices.forEach(([startIdx, endIdx]) => {
        const start = vertexTargets[startIdx];
        const end = vertexTargets[endIdx];
        const dStart = start.x - targetX;
        const dEnd = end.x - targetX;

        if (Math.abs(dStart) <= EPS && ensureUnique(intersections, start)) {
          intersections.push(start.clone());
        }
        if (Math.abs(dEnd) <= EPS && ensureUnique(intersections, end)) {
          intersections.push(end.clone());
        }

        if ((dStart < -EPS && dEnd > EPS) || (dStart > EPS && dEnd < -EPS)) {
          const t = (targetX - start.x) / (end.x - start.x);
          if (t >= 0 && t <= 1) {
            intersections.push(new Vector3().copy(start).lerp(end, t));
          }
        }
      });

      if (intersections.length < 2) continue;

      const unique = [];
      intersections.forEach(point => {
        if (ensureUnique(unique, point)) {
          unique.push(point.clone());
        }
      });

      if (unique.length < 2) continue;
      if (unique.length === 2) {
        segments.push([unique[0], unique[1]]);
      } else {
        for (let i = 0; i < unique.length; i += 1) {
          const next = (i + 1) % unique.length;
          segments.push([unique[i], unique[next]]);
        }
      }
    }
  });

  if (segments.length === 0) return null;

  const toKey = value => Math.round(value / sampleStep);
  const topLookup = new Map();

  const sampleSegment = (start, end) => {
    const length = start.distanceTo(end);
    const steps = Math.max(2, Math.ceil(length / sampleStep));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      samplePoint.lerpVectors(start, end, t);
      samplePoint.x = targetX;
      const key = toKey(samplePoint.z);
      const existing = topLookup.get(key);
      if (!existing || samplePoint.y > existing.y) {
        topLookup.set(key, samplePoint.clone());
      }
    }
  };

  segments.forEach(([start, end]) => {
    sampleSegment(start, end);
  });

  if (topLookup.size === 0) return null;

  const topPoints = Array.from(topLookup.values()).sort((a, b) => b.z - a.z);
  if (topPoints.length < 2) return null;

  const offsetPoints = topPoints.map(point =>
    new Vector3(targetX, point.y + offset, point.z)
  );

  let smoothedPoints = offsetPoints;
  if (offsetPoints.length >= 3) {
    const smoothing = new CatmullRomCurve3(offsetPoints, false, 'catmullrom', 0.45);
    smoothedPoints = smoothing.getSpacedPoints(Math.max(offsetPoints.length * 2, 24));
  }

  const geometry = new BufferGeometry().setFromPoints(smoothedPoints);
  const lineMaterial =
    material ||
    new LineBasicMaterial({
      color: 0xff4444,
      linewidth: 1,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false
    });

  const line = new Line(geometry, lineMaterial);
  line.name = `VaraCrossSectionGuide_${Number.parseFloat(xCoord).toFixed(3)}`;
  line.renderOrder = 10;

  if (attach) {
    vara.add(line);
  }

  const dispose = () => {
    if (attach) {
      line.parent?.remove(line);
    }
    geometry.dispose();
    if (!material) {
      lineMaterial.dispose();
    }
  };

  return {
    line,
    points: smoothedPoints,
    dispose
  };
}
