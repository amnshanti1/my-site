export function createMetaballField({
  THREE,
  scene,
  controller,

  // geometry
  radius = 0.008,                 // base tube radius (world units)
  tubeRadiusScale = 1.0,
  tubeMeshRadialSegments = 64,
  tubeMeshTubularSegments = 360,
  tubeMeshClosed = false,

  // smoke shading
  smokeOpacity = 0.34,
  smokeEdgeSoftness = 2.2,
  smokeNoiseAmp = 0.65,
  smokeNoiseFreq = 2.0,
  smokeNoiseFlow = 0.25,
  smokeColorA = 0xf5f9ff,
  smokeColorB = 0x6fa7ff,
  coreAlphaFrac = 0.30,           // minimum center opacity

  // sequential deformation controls (fractions of base radius unless noted)
  // 1) bottlenecking = axial scale (uniform radius change)
  scaleAmp = 0.6,
  scaleFreq = 1.0,
  scaleSpeed = 0.15,
  scalePhase = 0.0,

  // 2) normal-direction translation (move ring center along frame-N, no size change)
  transNAmp = 0.4,
  transNFreq = 0.9,
  transNSpeed = 0.20,
  transNPhase = 0.0,

  // 3) binormal-direction translation (move ring center along frame-B, no size change)
  transBAmp = 0.4,
  transBFreq = 0.7,
  transBSpeed = 0.18,
  transBPhase = 0.0,

  // safety clamps on final radius after scale
  minRadiusFrac = 0.35,
  maxRadiusFrac = 2.0,

  // material stability
  doubleSided = false,
  writeDepth = true,

  // misc
  updateEveryN = 1,
  padding = 0.5,
  showBoundsHelper = false,
  helperColor = 0xffaa00
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!controller) throw new Error('stream controller is required');

  const {
    MeshStandardMaterial, Vector3, Box3, CatmullRomCurve3,
    TubeGeometry, Mesh, DoubleSide, FrontSide, NormalBlending, Color, BufferAttribute
  } = THREE;

  const pathInit = typeof controller.getPath === 'function' ? controller.getPath() : [];
  const bounds = new Box3();
  for (const p of (pathInit || [])) if (p) bounds.expandByPoint(new Vector3(p.x, p.y, p.z));
  bounds.expandByScalar(padding);

  let helper = null;
  if (showBoundsHelper) {
    const half = bounds.getSize(new Vector3()).multiplyScalar(0.5);
    const ctr = bounds.getCenter(new Vector3());
    const box = new Box3(ctr.clone().sub(half), ctr.clone().add(half));
    helper = new THREE.Box3Helper(box, helperColor);
    scene.add(helper);
  }

  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.0,
    transparent: true,
    depthWrite: writeDepth,
    premultipliedAlpha: true,
    blending: NormalBlending,
    side: doubleSided ? DoubleSide : FrontSide
  });

  const colorA = new Color(smokeColorA);
  const colorB = new Color(smokeColorB);

  // Build TubeGeometry and attach per-vertex frame-N and frame-B (constant across the ring)
  function buildParallelTransportFrames(curve, segments, closed) {
    const normals = [];
    const binormals = [];
    const tangents = [];
    const twistAngles = new Float32Array(segments + 1);
    const EPS = 1e-5;
    const tmpAxis = new Vector3();
    const tmpNormal = new Vector3();
    const tmpBinormal = new Vector3();
    const tmpCross = new Vector3();

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      tangents[i] = curve.getTangentAt(u).clone().normalize();
    }

    tmpNormal.set(0, 1, 0);
    if (Math.abs(tmpNormal.dot(tangents[0])) > 0.999) {
      tmpNormal.set(1, 0, 0);
    }
    tmpBinormal.crossVectors(tangents[0], tmpNormal).normalize();
    tmpNormal.crossVectors(tmpBinormal, tangents[0]).normalize();

    normals[0] = tmpNormal.clone();
    binormals[0] = tmpBinormal.clone();
    twistAngles[0] = 0;

    for (let i = 1; i <= segments; i++) {
      const tPrev = tangents[i - 1];
      const tCurr = tangents[i];
      tmpAxis.crossVectors(tPrev, tCurr);
      if (tmpAxis.lengthSq() < EPS) {
        normals[i] = normals[i - 1].clone();
        binormals[i] = binormals[i - 1].clone();
        twistAngles[i] = twistAngles[i - 1];
        continue;
      }
      tmpAxis.normalize();
      const dot = THREE.MathUtils.clamp(tPrev.dot(tCurr), -1, 1);
      const angle = Math.acos(dot);

      tmpNormal.copy(normals[i - 1]).applyAxisAngle(tmpAxis, angle).normalize();
      tmpBinormal.copy(binormals[i - 1]).applyAxisAngle(tmpAxis, angle).normalize();

      tmpBinormal.crossVectors(tCurr, tmpNormal).normalize();
      tmpNormal.crossVectors(tmpBinormal, tCurr).normalize();

      normals[i] = tmpNormal.clone();
      binormals[i] = tmpBinormal.clone();

      tmpCross.crossVectors(normals[i - 1], tmpNormal);
      const crossLen = tmpCross.length();
      let signed = 0;
      if (crossLen > EPS) {
        const cosTheta = THREE.MathUtils.clamp(normals[i - 1].dot(tmpNormal), -1, 1);
        signed = Math.atan2(crossLen, cosTheta);
        signed *= Math.sign(tmpCross.dot(tCurr));
      }
      twistAngles[i] = twistAngles[i - 1] + signed;
    }

    if (closed) {
      const avgNormal = normals[0].clone().add(normals[segments]).normalize();
      const avgBinormal = binormals[0].clone().add(binormals[segments]).normalize();
      normals[segments] = avgNormal;
      binormals[segments] = avgBinormal;
      twistAngles[segments] = 0;
    }

    return { normals, binormals, tangents, twistAngles };
  }

  function buildTubeFromPoints(pointsArray) {
    const pts = pointsArray?.map(p => new Vector3(p.x, p.y, p.z)) || [];
    if (pts.length < 2) {
      const a = new Vector3(0, 0, 0), b = new Vector3(0, 0.0001, 0);
      pts.push(a, b);
    }

    const curve = new CatmullRomCurve3(pts, !!tubeMeshClosed, 'catmullrom', 0.0);
    const baseR = Math.max(1e-6, radius * tubeRadiusScale);

    const tubularSegments = tubeMeshTubularSegments;
    const radialSegments = tubeMeshRadialSegments;
    const isClosed = !!tubeMeshClosed;

    const geom = new TubeGeometry(curve, tubularSegments, baseR, radialSegments, isClosed);
    geom.computeBoundingSphere();

    const frames = buildParallelTransportFrames(curve, tubularSegments, isClosed);
    const { normals, binormals, twistAngles } = frames;
    const centers = [];
    for (let j = 0; j <= tubularSegments; j++) {
      centers[j] = curve.getPointAt(j / tubularSegments).clone();
    }

    const TB = tubularSegments;
    const RS = radialSegments;
    const aFrameN = new Float32Array((RS + 1) * (TB + 1) * 3);
    const aFrameB = new Float32Array((RS + 1) * (TB + 1) * 3);
    const aTwist = new Float32Array((RS + 1) * (TB + 1));

    // overwrite geometry vertex positions so base mesh follows the parallel-transport frame (no baked twist)
    const posAttr = geom.attributes.position;
    const tmpRadial = new Vector3();
    let vertIdx = 0;

    let idx = 0; // same vertex index for both attributes
    for (let j = 0; j <= TB; j++) {
      const Nf = normals[j];
      const Bf = binormals[j];
      const center = centers[j];
      const twist = twistAngles[j];

      for (let i = 0; i <= RS; i++) {
        aFrameN[idx + 0] = Nf.x;  aFrameB[idx + 0] = Bf.x;
        aFrameN[idx + 1] = Nf.y;  aFrameB[idx + 1] = Bf.y;
        aFrameN[idx + 2] = Nf.z;  aFrameB[idx + 2] = Bf.z;
        idx += 3;
        aTwist[vertIdx] = twist;

        const theta = (i / RS) * Math.PI * 2;
        tmpRadial
          .copy(Nf).multiplyScalar(Math.cos(theta))
          .addScaledVector(Bf, Math.sin(theta))
          .multiplyScalar(baseR);
        posAttr.setXYZ(vertIdx++, center.x + tmpRadial.x, center.y + tmpRadial.y, center.z + tmpRadial.z);
      }
    }
    posAttr.needsUpdate = true;
    geom.computeVertexNormals();
    geom.setAttribute('aFrameN', new BufferAttribute(aFrameN, 3));
    geom.setAttribute('aFrameB', new BufferAttribute(aFrameB, 3));
    geom.setAttribute('aTwist', new BufferAttribute(aTwist, 1));

    return { geom, baseR };
  }

  let { geom: tubeGeom, baseR } = buildTubeFromPoints(pathInit);

  mat.onBeforeCompile = (shader) => {
    // uniforms
    shader.uniforms.uTime = { value: 0 };

    // smoke
    shader.uniforms.uBaseAlpha  = { value: smokeOpacity };
    shader.uniforms.uEdge       = { value: smokeEdgeSoftness };
    shader.uniforms.uNoiseAmp   = { value: smokeNoiseAmp };
    shader.uniforms.uNoiseFreq  = { value: smokeNoiseFreq };
    shader.uniforms.uNoiseFlow  = { value: smokeNoiseFlow };
    shader.uniforms.uColA       = { value: colorA };
    shader.uniforms.uColB       = { value: colorB };
    shader.uniforms.uCoreAlpha  = { value: coreAlphaFrac };

    // base radius and clamps
    shader.uniforms.uBaseR   = { value: baseR };
    shader.uniforms.uMinFrac = { value: minRadiusFrac };
    shader.uniforms.uMaxFrac = { value: maxRadiusFrac };

    // sequential deformation controls
    shader.uniforms.uScaleAmp   = { value: scaleAmp };
    shader.uniforms.uScaleFreq  = { value: scaleFreq };
    shader.uniforms.uScaleSpeed = { value: scaleSpeed };
    shader.uniforms.uScalePhase = { value: scalePhase };

    shader.uniforms.uTransNAmp   = { value: transNAmp };
    shader.uniforms.uTransNFreq  = { value: transNFreq };
    shader.uniforms.uTransNSpeed = { value: transNSpeed };
    shader.uniforms.uTransNPhase = { value: transNPhase };

    shader.uniforms.uTransBAmp   = { value: transBAmp };
    shader.uniforms.uTransBFreq  = { value: transBFreq };
    shader.uniforms.uTransBSpeed = { value: transBSpeed };
    shader.uniforms.uTransBPhase = { value: transBPhase };

    // vertex: pure scale (radial), then pure translations in frame N/B
    shader.vertexShader =
      `
      attribute vec3 aFrameN;
      attribute vec3 aFrameB;
      attribute float aTwist;
      varying vec2 vUv;

      uniform float uTime;

      uniform float uBaseR, uMinFrac, uMaxFrac;

      // axial scale (bottleneck)
      uniform float uScaleAmp, uScaleFreq, uScaleSpeed, uScalePhase;

      // translations
      uniform float uTransNAmp, uTransNFreq, uTransNSpeed, uTransNPhase;
      uniform float uTransBAmp, uTransBFreq, uTransBSpeed, uTransBPhase;
      ` + shader.vertexShader
        .replace('void main() {', 'void main(){ vUv = uv;')
        .replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>

          float yAx = vUv.y; // axial 0..1

          // 1) uniform radius change (bottlenecking)
          float scaleWave = uScaleAmp * sin(6.28318530718 * (yAx * uScaleFreq - uTime * uScaleSpeed) + uScalePhase);
          float rMin = uBaseR * uMinFrac;
          float rMax = uBaseR * uMaxFrac;
          float targetR = clamp(uBaseR * (1.0 + scaleWave), rMin, rMax);

          // push purely radially using frame N/B, not the mesh normal
          float theta = vUv.x * 6.28318530718 - aTwist;      // angle around ring, de-twisted
          vec3 radial = normalize(aFrameN * cos(theta) + aFrameB * sin(theta));
          vec3 centerPos = transformed - radial * uBaseR;    // remove existing base radius
          transformed = centerPos + radial * targetR;

          // 2) and 3) pure translations of the ring center in frame N and B (do not change size)
          float tN = (uTransNAmp * uBaseR) * sin(6.28318530718 * (yAx * uTransNFreq - uTime * uTransNSpeed) + uTransNPhase);
          float tB = (uTransBAmp * uBaseR) * sin(6.28318530718 * (yAx * uTransBFreq - uTime * uTransBSpeed) + uTransBPhase);

          transformed += aFrameN * tN + aFrameB * tB;
          `
        );

    // fragment (core alpha floor + discard tiny alpha)
    shader.fragmentShader =
      `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uBaseAlpha, uEdge;
      uniform float uNoiseAmp, uNoiseFreq, uNoiseFlow;
      uniform vec3 uColA, uColB;
      uniform float uCoreAlpha;

      float flowNoise(vec2 uv, float t){
        float w = 0.0, a = 1.0, f = uNoiseFreq;
        for(int i=0;i<3;i++){
          float s = sin((uv.y * f - t * uNoiseFlow) * 6.28318 + uv.x * 6.28318);
          float c = cos((uv.y * (f*1.3) + t * (uNoiseFlow*0.6)) * 6.28318);
          w += a * (0.5 + 0.5 * s * c);
          a *= 0.55; f *= 1.73;
        }
        return clamp(w, 0.0, 1.0);
      }
      ` + shader.fragmentShader
        .replace(
          '#include <output_fragment>',
          `
          vec3 V = normalize(-vViewPosition);
          float ndv = clamp(dot(normalize(normal), V), 0.0, 1.0);

          float rim = pow(1.0 - ndv, uEdge);
          float vis = max(uCoreAlpha, rim);

          float n = flowNoise(vUv, uTime) * uNoiseAmp;
          vec3 tint = mix(uColA, uColB, clamp(0.4 + 0.6 * n, 0.0, 1.0));

          vec3 lit = outgoingLight * tint;
          float alpha = uBaseAlpha * vis * clamp(0.6 + 0.6 * n, 0.0, 1.0);
          if (alpha < 0.02) discard;

          gl_FragColor = vec4(lit, alpha);
          `
        );

    mat.userData.shader = shader;
  };

  const tubeMesh = new Mesh(tubeGeom, mat);
  tubeMesh.name = 'MetaballTubeMesh';
  scene.add(tubeMesh);

  let disposed = false;
  let frame = 0;

  function rebuildHelperFromPoints(pointsArr) {
    if (!showBoundsHelper) return;
    if (helper && helper.parent) helper.parent.remove(helper);
    const b = new Box3();
    for (const p of pointsArr || []) if (p) b.expandByPoint(new Vector3(p.x, p.y, p.z));
    b.expandByScalar(padding);
    const half = b.getSize(new Vector3()).multiplyScalar(0.5);
    const ctr = b.getCenter(new Vector3());
    const box = new Box3(ctr.clone().sub(half), ctr.clone().add(half));
    helper = new THREE.Box3Helper(box, helperColor);
    scene.add(helper);
  }

  const adapter = {
    field: tubeMesh,
    helper,
    update() {
      if (disposed) return;
      if ((frame++ % updateEveryN) !== 0) return;
      const sh = mat.userData?.shader;
      if (sh && sh.uniforms?.uTime) {
        sh.uniforms.uTime.value = (typeof performance !== 'undefined' ? performance.now() * 0.001 : frame / 60);
      }
    },
    reframeFromPoints(pointsArr) {
      const built = buildTubeFromPoints(pointsArr);
      baseR = built.baseR;
      const newGeom = built.geom;
      const sh = mat.userData?.shader;
      if (sh && sh.uniforms?.uBaseR) sh.uniforms.uBaseR.value = baseR;
      tubeMesh.geometry.dispose();
      tubeMesh.geometry = newGeom;
      rebuildHelperFromPoints(pointsArr);
    },
    dispose() {
      if (disposed) return; disposed = true;
      tubeMesh.parent?.remove(tubeMesh);
      tubeMesh.geometry?.dispose?.();
      tubeMesh.material?.dispose?.();
      if (helper) helper.parent?.remove(helper);
    }
  };

  adapter.update();
  return adapter;
}
