import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const canvas = document.getElementById('demo-canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1427);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0.8, 3.2, 8.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.8, 0);
controls.minDistance = 3;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI * 0.495;

const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffd5a1, 1.5);
key.position.set(-4, 8, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0002;
scene.add(key);

const fill = new THREE.DirectionalLight(0x9fb9ff, 0.4);
fill.position.set(6, 4, -7);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3c2f43, roughness: 0.95, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.001;
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader();
loader.load(
  '/models/PrimaryIslandv1.glb',
  gltf => {
    const islandModel = gltf.scene;
    islandModel.name = 'PrimaryIslandv1Demo';

    islandModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });

    const bounds = new THREE.Box3().setFromObject(islandModel);
    const center = bounds.getCenter(new THREE.Vector3());
    islandModel.position.set(-center.x, -bounds.min.y, -center.z);
    islandModel.scale.setScalar(1.0);

    scene.add(islandModel);

    const size = bounds.getSize(new THREE.Vector3());
    controls.target.set(0, size.y * 0.35, 0);
  },
  undefined,
  error => {
    console.error('Failed to load /models/PrimaryIslandv1.glb', error);
  }
);

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
