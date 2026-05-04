import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CrtShader, DEFAULT_MULTICOLOR_CRT_PARAMS } from '../crtShader.js';

export function createMulticolorCrtPass({ width, height }) {
  const pass = new ShaderPass(CrtShader);
  const { uniforms } = pass.material;
  const resolutionUniform = uniforms.iResolution;

  function setSize(nextWidth, nextHeight) {
    resolutionUniform.value.set(nextWidth, nextHeight);
  }

  function setParams(params = {}) {
    if (typeof params.resDiv === 'number') uniforms.resDiv.value = params.resDiv;
    if (typeof params.hardScan === 'number') uniforms.hardScan.value = params.hardScan;
    if (typeof params.hardPix === 'number') uniforms.hardPix.value = params.hardPix;
    if (typeof params.warpX === 'number') uniforms.warpX.value = params.warpX;
    if (typeof params.warpY === 'number') uniforms.warpY.value = params.warpY;
    if (typeof params.maskDark === 'number') uniforms.maskDark.value = params.maskDark;
    if (typeof params.maskLight === 'number') uniforms.maskLight.value = params.maskLight;
    if (typeof params.phosphorAmount === 'number') uniforms.phosphorAmount.value = params.phosphorAmount;
  }

  // Initialize resolution once on creation.
  setSize(width, height);
  setParams(DEFAULT_MULTICOLOR_CRT_PARAMS);

  return {
    key: 'multicolor',
    label: 'Multicolor CRT',
    pass,
    setSize,
    setParams,
    update(time = 0) {
      uniforms.iTime.value = time;
    },
    dispose() {
      pass.dispose();
    }
  };
}
