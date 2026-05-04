function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function generateHeatParams(seedInput = null) {
  const seed = Number.isFinite(seedInput) ? seedInput : randomSeed();
  const rng = mulberry32(seed);

  const L = lerp(1, 3, rng());
  const T = 0.5;
  const alpha = lerp(0.05, 0.5, rng());
  const A = lerp(-1, 1, rng());
  const B = A;

  const kMax = 6;
  const coeffs = [];
  for (let k = 1; k <= kMax; k += 1) {
    const amp = lerp(0.15, 0.45, rng());
    const sign = rng() < 0.5 ? -1 : 1;
    coeffs.push(sign * amp * rng());
  }

  return {
    seed,
    L,
    T,
    alpha,
    A,
    B,
    coeffs
  };
}

export function solveHeatEquation(params, Ny = 64, Nt = 128, { debug = false } = {}) {
  const { L, T, alpha, A, B, coeffs } = params;
  const dy = L / (Ny - 1);
  const dt = T / Nt;
  const r = (alpha * dt) / (dy * dy);
  const interiorCount = Ny - 2;

  const makeInitial = y => {
    const linear = A + (B - A) * (y / L);
    let g = 0;
    for (let k = 1; k <= coeffs.length; k += 1) {
      g += coeffs[k - 1] * Math.sin((k * Math.PI * y) / L);
    }
    return linear + g;
  };

  const U = new Array(Nt + 1);
  U[0] = new Float32Array(Ny);
  for (let iy = 0; iy < Ny; iy += 1) {
    const y = iy * dy;
    U[0][iy] = makeInitial(y);
  }
  U[0][0] = A;
  U[0][Ny - 1] = B;

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  const updateMinMax = arr => {
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      if (v < minU) minU = v;
      if (v > maxU) maxU = v;
    }
  };
  updateMinMax(U[0]);

  const a = new Float32Array(interiorCount);
  const b = new Float32Array(interiorCount);
  const c = new Float32Array(interiorCount);
  for (let i = 0; i < interiorCount; i += 1) {
    a[i] = -0.5 * r;
    b[i] = 1 + r;
    c[i] = -0.5 * r;
  }

  const solveTridiagonal = (aIn, bIn, cIn, d) => {
    const n = d.length;
    const cp = new Float32Array(n);
    const dp = new Float32Array(n);
    cp[0] = cIn[0] / bIn[0];
    dp[0] = d[0] / bIn[0];
    for (let i = 1; i < n; i += 1) {
      const denom = bIn[i] - aIn[i] * cp[i - 1];
      cp[i] = i < n - 1 ? cIn[i] / denom : 0;
      dp[i] = (d[i] - aIn[i] * dp[i - 1]) / denom;
    }
    const x = new Float32Array(n);
    x[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i -= 1) {
      x[i] = dp[i] - cp[i] * x[i + 1];
    }
    return x;
  };

  for (let n = 0; n < Nt; n += 1) {
    const prev = U[n];
    const rhs = new Float32Array(interiorCount);
    for (let j = 0; j < interiorCount; j += 1) {
      const i = j + 1;
      const left = prev[i - 1];
      const mid = prev[i];
      const right = prev[i + 1];
      rhs[j] = 0.5 * r * left + (1 - r) * mid + 0.5 * r * right;
    }
    if (interiorCount > 0) {
      rhs[0] += 0.5 * r * A;
      rhs[interiorCount - 1] += 0.5 * r * B;
    }

    const interior = solveTridiagonal(a, b, c, rhs);
    const next = new Float32Array(Ny);
    next[0] = A;
    next[Ny - 1] = B;
    for (let j = 0; j < interiorCount; j += 1) {
      next[j + 1] = interior[j];
    }
    U[n + 1] = next;
    updateMinMax(next);
  }

  if (debug) {
    let maxBCError = 0;
    for (let n = 0; n < U.length; n += 1) {
      maxBCError = Math.max(maxBCError, Math.abs(U[n][0] - A), Math.abs(U[n][Ny - 1] - B));
    }
    console.log('[HeatEquation] BC max error:', maxBCError.toExponential(3));
    console.log('[HeatEquation] min/max:', minU.toFixed(3), maxU.toFixed(3));
  }

  return {
    U,
    meta: {
      L,
      T,
      alpha,
      A,
      B,
      dt,
      dy,
      minU,
      maxU
    }
  };
}
