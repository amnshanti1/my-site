export function createStreamController({
  points = [],
  count = 1,
  spacing = null,   // optional world spacing between droplets; defaults to totalLen / count
  speed = 0,        // cycles (full loop) per second when loop = true; world units/sec when loop = false
  loop = true,
  offset = 0,       // head offset in world length units along the path
  direction = 1     // +1 forward, -1 backward
} = {}) {
  // keep a live reference to the user-provided points array when it's [{x,y,z},...]
  let pointsRef = normalizePoints(points);
  if (pointsRef.length < 2) throw new Error('Stream controller requires at least two path points.');

  let { cum, total } = buildLengths(pointsRef);
  if (total <= 0) throw new Error('Stream controller path must span a positive distance.');

  const dropletCount = Math.max(1, Math.floor(count));
  const spacingDistance =
    typeof spacing === 'number' && spacing > 0 ? spacing : total / dropletCount;

  const dir = direction >= 0 ? 1 : -1;
  let headLen = clampLen(offset ?? 0, total);

  // evenly spaced droplets behind the head
  const droplets = Array.from({ length: dropletCount }, (_, i) => ({
    offset: spacingDistance * i * dir,
    arcLength: 0,
    position: clonePoint(pointsRef[0])
  }));

  const api = {
    getTotalLength: () => total,
    getSpacing: () => spacingDistance,
    getPath: () => pointsRef,                  // return live reference (callers should not mutate unless they also call syncPathInPlace)
    getState: () => droplets.map(cloneDroplet),

    // advance time by dt seconds
    step(dt = 0) {
      const dtSec = Math.max(0, Number(dt) || 0);
      const advance = loop ? dtSec * speed * total * dir : dtSec * speed * dir;
      headLen = wrapLen(headLen + advance, total, loop);
      updateDroplets();
      return api.getState();
    },

    // replace the path reference entirely and rebuild internal caches
    setPathRef(newPoints, opts = {}) {
      const preservePhase = opts.preservePhase !== false;
      const preserveWorld = opts.preserveWorld === true;

      if (!newPoints || newPoints.length < 2) return;

      // optional: preserve world positions of droplets during retarget
      let savedWorld = null;
      if (preserveWorld) {
        savedWorld = droplets.map(d => clonePoint(d.position));
      }

      pointsRef = normalizePoints(newPoints);
      ({ cum, total } = buildLengths(pointsRef));
      if (total <= 0) total = 1;

      if (preserveWorld && savedWorld) {
        // project each saved position to nearest param on the new path
        for (let i = 0; i < droplets.length; i++) {
          const t = projectToPath(pointsRef, cum, total, savedWorld[i]);
          droplets[i].arcLength = t * total;
        }
        // keep head aligned with droplet 0’s target minus its offset
        headLen = wrapLen(droplets[0].arcLength - droplets[0].offset, total, loop);
      } else if (preservePhase) {
        // keep the same head phase along the new total length
        const phase = total > 0 ? clamp01(headLen / total) : 0;
        headLen = phase * total;
      } else {
        headLen = clampLen(0, total);
      }

      updateDroplets();
    },

    // call this after mutating the SAME array in place (keeps the reference)
    syncPathInPlace(opts = {}) {
      return api.setPathRef(pointsRef, opts);
    }
  };

  // initial positions
  updateDroplets();
  return api;

  // internals

  function updateDroplets() {
    for (let i = 0; i < droplets.length; i++) {
      const d = droplets[i];
      let target = headLen + d.offset;
      target = loop ? wrapLen(target, total, true) : clampLen(target, total);
      d.arcLength = target;
      d.position = sampleAtLength(pointsRef, cum, total, target);
    }
  }
}

// utilities

function normalizePoints(arr) {
  // when input is [{x,y,z}, ...] keep the original objects by reference (live updates)
  if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object' && 'x' in arr[0]) {
    return arr;
  }
  // fallback: map [x,y,z] arrays to objects
  return (arr || [])
    .map(p => {
      if (!p) return null;
      if (typeof p.x === 'number') return { x: p.x, y: p.y, z: p.z };
      if (Array.isArray(p) && p.length >= 3) return { x: Number(p[0]), y: Number(p[1]), z: Number(p[2]) };
      return null;
    })
    .filter(Boolean);
}

function buildLengths(pts) {
  const n = pts.length;
  const cum = new Float32Array(n);
  let acc = 0;
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    acc += dist3(pts[i - 1], pts[i]);
    cum[i] = acc;
  }
  return { cum, total: acc };
}

function sampleAtLength(pts, cum, total, s) {
  if (s <= 0) return clonePoint(pts[0]);
  if (s >= total) return clonePoint(pts[pts.length - 1]);

  // binary search segment
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1; else hi = mid;
  }
  const i1 = lo;
  const i0 = Math.max(0, i1 - 1);
  const segLen = Math.max(1e-6, cum[i1] - cum[i0]);
  const a = (s - cum[i0]) / segLen;

  return lerpPoint(pts[i0], pts[i1], a);
}

// nearest parameter t in [0,1] to world point p along polyline
function projectToPath(pts, cum, total, p) {
  let bestT = 0, bestD2 = Infinity;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const ab2 = Math.max(1e-9, abx*abx + aby*aby + abz*abz);
    let u = (abx*apx + aby*apy + abz*apz) / ab2;
    u = Math.max(0, Math.min(1, u));

    const qx = a.x + abx * u;
    const qy = a.y + aby * u;
    const qz = a.z + abz * u;

    const dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
    const d2 = dx*dx + dy*dy + dz*dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      const s = cum[i - 1] + u * (cum[i] - cum[i - 1]);
      bestT = total > 0 ? s / total : 0;
    }
  }
  return bestT;
}

function wrapLen(s, total, loop) {
  if (!loop) return clampLen(s, total);
  return ((s % total) + total) % total;
}

function clampLen(s, total) {
  if (s <= 0) return 0;
  if (s >= total) return total;
  return s;
}

function dist3(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.hypot(dx, dy, dz);
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function clonePoint(p) {
  return { x: p.x, y: p.y, z: p.z };
}

function cloneDroplet(d) {
  return { arcLength: d.arcLength, offset: d.offset, position: clonePoint(d.position) };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}