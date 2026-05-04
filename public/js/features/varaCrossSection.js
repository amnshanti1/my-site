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
  upstreamExtension = 0.18,
  downstreamExtension = 0.22
} = {}) {
  if (!THREE || !vara) return null;

  const {
    Box3,
    BufferGeometry,
    Line,
    LineBasicMaterial,
    Matrix4,
    MathUtils,
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

  const useTangentExtensions = false;
  let finalPoints = offsetPoints.map(point => point.clone());
  const upstreamDistance = Math.max(0, upstreamExtension);
  const downstreamDistance = Math.max(0, downstreamExtension);
  if (upstreamDistance > 0) {
    extendEndpoint(finalPoints, upstreamDistance, true, useTangentExtensions, planeX);
  }
  if (downstreamDistance > 0) {
    extendEndpoint(finalPoints, downstreamDistance, false, useTangentExtensions, planeX);
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
  };

  return {
    line,
    points: finalPoints,
    planeX,
    dispose
  };

  function extendEndpoint(points, distance, atStart, useTangent, plane) {
    if (!points?.length || distance <= 0) return;
    if (!useTangent) {
      const idx = atStart ? 0 : points.length - 1;
      const clone = points[idx].clone();
      clone.x = plane;
      clone.z += atStart ? distance : -distance;
      if (atStart) {
        points.unshift(clone);
      } else {
        points.push(clone);
      }
      return;
    }
    const idx = atStart ? 0 : points.length - 1;
    const neighborIdx = atStart ? Math.min(1, points.length - 1) : Math.max(points.length - 2, 0);
    if (idx === neighborIdx) return;
    const tangent = points[idx].clone().sub(points[neighborIdx]);
    if (!tangent.lengthSq()) return;
    tangent.normalize().multiplyScalar(distance);
    const extended = points[idx].clone().add(tangent);
    extended.x = plane;
    if (atStart) {
      points.unshift(extended);
    } else {
      points.push(extended);
    }
  }

}
