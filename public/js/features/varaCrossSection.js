export function createVaraCrossSectionGuide({
  THREE,
  vara,
  xCoord = 0,
  useNormalizedX = false,
  clampToBounds = true,
  offset = 0.05,
  attach = true,
  color = 0xff3333,
  material = null,
  sampleStep = 0.01,
  smoothingSegments = 32,
  upstreamExtension = 0.18,
  downstreamExtension = 0.22,
  registerUpdater = null,
  follower = {}
} = {}) {
  if (!THREE || !vara) return null;

  const {
    Box3,
    BufferGeometry,
    CatmullRomCurve3,
    Line,
    LineBasicMaterial,
    Matrix4,
    MathUtils,
    MeshPhysicalMaterial,
    Vector3
  } = THREE;

  vara.updateMatrixWorld(true);

  const worldBounds = new Box3().setFromObject(vara);
  if (!Number.isFinite(worldBounds.min.x) || !Number.isFinite(worldBounds.max.x)) return null;

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
    const local = vara.worldToLocal(corner);
    localBounds.expandByPoint(local);
  });

  const rawPlaneX = useNormalizedX
    ? MathUtils.lerp(localBounds.min.x, localBounds.max.x, MathUtils.clamp(xCoord, 0, 1))
    : xCoord;
  const planeX = clampToBounds
    ? MathUtils.clamp(rawPlaneX, localBounds.min.x, localBounds.max.x)
    : rawPlaneX;

  const inverseRoot = new Matrix4().copy(vara.matrixWorld).invert();
  const tempMatrix = new Matrix4();
  const segments = [];
  const EPS = 1e-6;
  const vertexTargets = [new Vector3(), new Vector3(), new Vector3()];

  const fetchVertex = (positionAttr, index, matrix, target) => {
    target.set(
      positionAttr.getX(index),
      positionAttr.getY(index),
      positionAttr.getZ(index)
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

  const edgeIndices = [
    [0, 1],
    [1, 2],
    [2, 0]
  ];

  vara.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;

    const geometry = node.geometry;
    const positionAttr = geometry.attributes.position;
    const indexAttr = geometry.index;

    node.updateMatrixWorld(true);
    tempMatrix.copy(node.matrixWorld).premultiply(inverseRoot);

    const getIndex = idx => (indexAttr ? indexAttr.getX(idx) : idx);
    const triangleCount = indexAttr ? indexAttr.count / 3 : positionAttr.count / 3;

    for (let tri = 0; tri < triangleCount; tri += 1) {
      const i0 = getIndex(tri * 3);
      const i1 = getIndex(tri * 3 + 1);
      const i2 = getIndex(tri * 3 + 2);

      const p0 = fetchVertex(positionAttr, i0, tempMatrix, vertexTargets[0]);
      const p1 = fetchVertex(positionAttr, i1, tempMatrix, vertexTargets[1]);
      const p2 = fetchVertex(positionAttr, i2, tempMatrix, vertexTargets[2]);

      const distances = [p0.x - planeX, p1.x - planeX, p2.x - planeX];
      let hasPositive = false;
      let hasNegative = false;
      let hasOnPlane = false;
      for (let d = 0; d < 3; d += 1) {
        const value = distances[d];
        if (value > EPS) {
          hasPositive = true;
        } else if (value < -EPS) {
          hasNegative = true;
        } else {
          hasOnPlane = true;
        }
      }
      if (!(hasOnPlane || (hasPositive && hasNegative))) continue;

      const intersections = [];
      edgeIndices.forEach(([startIdx, endIdx]) => {
        const start = vertexTargets[startIdx];
        const end = vertexTargets[endIdx];
        const dStart = start.x - planeX;
        const dEnd = end.x - planeX;

        if (Math.abs(dStart) <= EPS && ensureUnique(intersections, start)) {
          intersections.push(start.clone());
        }
        if (Math.abs(dEnd) <= EPS && ensureUnique(intersections, end)) {
          intersections.push(end.clone());
        }

        if ((dStart < -EPS && dEnd > EPS) || (dStart > EPS && dEnd < -EPS)) {
          const t = (planeX - start.x) / (end.x - start.x);
          if (t >= 0 && t <= 1) {
            intersections.push(start.clone().lerp(end, t));
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
  const samplePoint = new Vector3();

  const sampleSegment = (start, end) => {
    const length = start.distanceTo(end);
    const steps = Math.max(2, Math.ceil(length / sampleStep));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      samplePoint.lerpVectors(start, end, t);
      samplePoint.x = planeX;
      const key = toKey(samplePoint.z);
      const existing = topLookup.get(key);
      if (!existing || samplePoint.y > existing.y) {
        topLookup.set(key, samplePoint.clone());
      }
    }
  };

  segments.forEach(([start, end]) => sampleSegment(start, end));

  if (topLookup.size === 0) return null;

  const topPoints = Array.from(topLookup.values()).sort((a, b) => b.z - a.z);
  if (topPoints.length < 2) return null;

  const offsetPoints = topPoints.map(point => new Vector3(planeX, point.y + offset, point.z));

  let linePoints = offsetPoints;
  if (offsetPoints.length >= 3) {
    const curve = new CatmullRomCurve3(offsetPoints, false, 'catmullrom', 0.5);
    linePoints = curve.getSpacedPoints(Math.max(offsetPoints.length, smoothingSegments));
  }

  const finalPoints = linePoints.map(point => point.clone());
  const upstreamDistance = Math.max(0, upstreamExtension);
  const downstreamDistance = Math.max(0, downstreamExtension);
  if (upstreamDistance > 0 && finalPoints.length) {
    const upstreamPoint = finalPoints[0].clone();
    upstreamPoint.x = planeX;
    upstreamPoint.z += upstreamDistance;
    finalPoints.unshift(upstreamPoint);
  }
  if (downstreamDistance > 0 && finalPoints.length) {
    const downstreamPoint = finalPoints[finalPoints.length - 1].clone();
    downstreamPoint.x = planeX;
    downstreamPoint.z -= downstreamDistance;
    finalPoints.push(downstreamPoint);
  }

  let followerState = null;
  const followerDefaults = {
    enabled: true,
    radius: 0.05,
    color: 0xffffff,
    emissive: 0x181818,
    roughness: 0.3,
    metalness: 0.1,
    speed: 0.25,
    loop: true,
    offsetY: 0,
    material: null,
    type: 'metaball',
    MarchingCubes: null,
    count: 1,
    spacing: 0.08,
    resolution: 28,
    maxPolyCount: 8000,
    isolation: 60,
    strength: 0.65,
    subtract: 5.5,
    scale: null,
    dropColor: null,
    pulseFrequency: 2.2,
    pulseAmplitude: 0.04,
    offsetPhase: 0
  };
  const followerOptions = { ...followerDefaults, ...(follower || {}) };

  const enableFollower =
    attach &&
    typeof registerUpdater === 'function' &&
    followerOptions.enabled !== false &&
    finalPoints.length >= 2;

  let followerGeometry = null;
  let followerMaterial = followerOptions.material || null;
  let followerMaterialOwned = false;

  if (enableFollower) {
    const segmentLengths = [];
    const cumulative = [0];
    let totalLength = 0;
    for (let i = 1; i < finalPoints.length; i += 1) {
      const length = finalPoints[i].distanceTo(finalPoints[i - 1]);
      segmentLengths.push(length);
      totalLength += length;
      cumulative.push(totalLength);
    }

    if (totalLength > 0) {
      const getPointAt = t => {
        if (t <= 0) return finalPoints[0];
        if (t >= 1) return finalPoints[finalPoints.length - 1];
        const targetDistance = t * totalLength;
        let segmentIndex = 0;
        while (segmentIndex < segmentLengths.length && cumulative[segmentIndex + 1] < targetDistance) {
          segmentIndex += 1;
        }
        const segmentStart = finalPoints[segmentIndex];
        const segmentEnd = finalPoints[segmentIndex + 1];
        const segmentLength = segmentLengths[segmentIndex] || 1;
        const distanceIntoSegment = targetDistance - cumulative[segmentIndex];
        const segmentT = Math.min(Math.max(distanceIntoSegment / segmentLength, 0), 1);
        return segmentStart.clone().lerp(segmentEnd, segmentT);
      };

      const MarchingCubesCtor = followerOptions.MarchingCubes;
      const useMetaball =
        followerOptions.type === 'metaball' && typeof MarchingCubesCtor === 'function';
      const radius = Math.max(0.005, followerOptions.radius);
      const speed = Math.max(0, followerOptions.speed);
      const loop = followerOptions.loop !== false;
      let progress = followerOptions.offsetPhase || 0;
      const count = Math.max(1, Math.floor(followerOptions.count ?? 1));
      const spacingDistance = Math.max(0, followerOptions.spacing ?? 0.08);
      const spacingT = spacingDistance / Math.max(totalLength, 1e-4);

      if (useMetaball) {
        if (!followerMaterial) {
          followerMaterial = new MeshPhysicalMaterial({
            color: followerOptions.color,
            emissive: followerOptions.emissive,
            roughness: followerOptions.roughness,
            metalness: followerOptions.metalness,
            transmission: 0.75,
            thickness: 0.85,
            transparent: true,
            opacity: 1,
            envMapIntensity: 1.1,
            depthWrite: false
          });
          followerMaterialOwned = true;
        }

        const dropColor = followerOptions.dropColor ?? followerOptions.color;
        const baseStrength = followerOptions.strength;
        const subtract = followerOptions.subtract;
        const pulseAmp = Math.max(0, followerOptions.pulseAmplitude);
        const pulseFreq = followerOptions.pulseFrequency;

        const pathBounds = new Box3();
        finalPoints.forEach(point => pathBounds.expandByPoint(point));
        const boundsSize = pathBounds.getSize(new Vector3());
        const safeSize = new Vector3(
          Math.max(boundsSize.x, 0.001),
          Math.max(boundsSize.y, 0.001),
          Math.max(boundsSize.z, 0.001)
        );

        const maxDimension = Math.max(safeSize.x, safeSize.y, safeSize.z);
        const dropField = new MarchingCubesCtor(
          followerOptions.resolution,
          followerMaterial,
          true,
          false,
          followerOptions.maxPolyCount
        );
        dropField.name = 'VaraMetaballStream';
        const boundsCenter = pathBounds.getCenter(new Vector3());
        dropField.position.copy(boundsCenter);
        dropField.scale.setScalar(maxDimension);
        dropField.isolation = followerOptions.isolation;
        dropField.frustumCulled = false;
        vara.add(dropField);

        const normalizePoint = point => {
          const normalized = new Vector3(
            (point.x - boundsCenter.x) / maxDimension + 0.5,
            (point.y - boundsCenter.y) / maxDimension + 0.5,
            (point.z - boundsCenter.z) / maxDimension + 0.5
          );
          normalized.x = Math.min(Math.max(normalized.x, 1e-4), 0.9999);
          normalized.y = Math.min(Math.max(normalized.y, 1e-4), 0.9999);
          normalized.z = Math.min(Math.max(normalized.z, 1e-4), 0.9999);
          return normalized;
        };

        const drops = Array.from({ length: count }, (_, index) => ({
          offset: spacingT * index,
          progress: 0,
          lastPoint: null
        }));

        const applyField = (elapsed = 0) => {
          dropField.reset();
          drops.forEach(drop => {
            const point = getPointAt(drop.progress);
            drop.lastPoint = point.clone();
            const normalized = normalizePoint(point);
            const strength =
              baseStrength + pulseAmp * Math.sin(elapsed * pulseFreq + drop.progress * Math.PI * 2);
            dropField.addBall(normalized.x, normalized.y, normalized.z, strength, subtract, dropColor);
          });
          dropField.update();
        };

        drops.forEach(drop => {
          let initialProgress = progress - drop.offset;
          if (loop) {
            initialProgress = ((initialProgress % 1) + 1) % 1;
          } else {
            initialProgress = Math.max(0, Math.min(1, initialProgress));
          }
          drop.progress = initialProgress;
        });
        applyField(0);

        const unregister = registerUpdater(({ delta = 0, elapsed = 0 }) => {
          if (!dropField.parent) return;
          const deltaProgress = speed * delta / Math.max(totalLength, 1e-4);
          progress += deltaProgress;
          drops.forEach(drop => {
            let nextProgress = progress - drop.offset;
            if (loop) {
              nextProgress = ((nextProgress % 1) + 1) % 1;
            } else {
              nextProgress = Math.max(0, Math.min(1, nextProgress));
            }
            drop.progress = nextProgress;
          });
          applyField(elapsed);
        });

        followerGeometry = dropField.geometry;
        followerState = {
          mesh: dropField,
          unregister,
          geometry: followerGeometry,
          material: followerMaterial,
          options: followerOptions,
          field: dropField,
          drops,
          bounds: pathBounds,
          normalizePoint
        };
      }
    }
  }

  const geometry = new BufferGeometry().setFromPoints(finalPoints);
  const lineMaterial =
    material ||
    new LineBasicMaterial({
      color,
      linewidth: 1,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });

  const line = new Line(geometry, lineMaterial);
  line.name = `VaraCrossSectionGuide_${Number.parseFloat(planeX).toFixed(3)}`;
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
    if (followerState) {
      followerState.unregister?.();
      if (followerState.field) {
        followerState.field.parent?.remove(followerState.field);
        followerState.field.geometry?.dispose?.();
      }
      if (followerMaterialOwned) {
        followerState.material?.dispose?.();
      }
      followerState = null;
    }
  };

  return {
    line,
    points: finalPoints,
    planeX,
    dispose,
    follower: followerState
  };
}
