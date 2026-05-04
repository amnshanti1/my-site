import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { CrtShader } from './shader.js';

export function initCrtScene({ renderer, resolution = 1280 } = {}) {
  if (!renderer) {
    console.warn('[CRT] initCrtScene requires a renderer.');
    return null;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050b);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  scene.add(new THREE.AmbientLight(0xffffff, 0.1));

  const spot = new THREE.SpotLight(0xffffff, 1);
  spot.distance = 1000;
  spot.angle = 0.9;
  spot.penumbra = 1;
  spot.decay = 0;
  spot.position.set(10, 10, 10);
  spot.target.position.set(0, 0, 0);
  scene.add(spot);
  scene.add(spot.target);

  const point = new THREE.PointLight(0xffffff, 10, 0, 1);
  point.position.set(-10, -10, -10);
  scene.add(point);

  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  const colors = [0xff5555, 0x55bb55, 0x5555ff, 0xffffff];
  const offsets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const boxes = colors.map(color => {
    const material = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(boxGeometry, material);
    orbitGroup.add(mesh);
    return mesh;
  });

  const renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false
  });
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setSize(resolution, resolution);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 2, 0.8, 0);
  const crtPass = new ShaderPass(CrtShader);
  crtPass.material.uniforms.iResolution.value.set(resolution, resolution);

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(crtPass);

  let time = 0;

  function update({ delta = 0.016 } = {}) {
    time += 0.01;
    const radius = 0.5 * (Math.sin(time * 0.5) + 2) * 1.5;
    boxes.forEach((mesh, index) => {
      const angle = time + offsets[index];
      mesh.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
      mesh.rotation.x += 0.01;
      mesh.rotation.y += 0.01;
    });
    composer.render();
  }

  function resize(size = resolution) {
    const next = Math.max(256, Math.floor(size));
    composer.setSize(next, next);
    crtPass.material.uniforms.iResolution.value.set(next, next);
  }

  function dispose() {
    boxes.forEach(mesh => mesh.material.dispose());
    boxGeometry.dispose();
    renderTarget.dispose();
    composer.dispose();
  }

  return {
    texture: renderTarget.texture,
    update,
    resize,
    dispose
  };
}
