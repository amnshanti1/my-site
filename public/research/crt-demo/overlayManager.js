import { OVERLAY_FACTORIES, OVERLAY_OPTIONS, DEFAULT_OVERLAY_KEY } from './passes/index.js';

function detachPass(composer, target) {
  const index = composer.passes.indexOf(target);
  if (index >= 0) {
    composer.passes.splice(index, 1);
  }
}

export function createOverlayManager({ composer, bloomPass, initialSize }) {
  let activeKey = null;
  let activeInstance = null;
  let width = initialSize.x;
  let height = initialSize.y;

  const instances = new Map();

  function ensureInstance(key) {
    const factory = OVERLAY_FACTORIES[key];
    if (!factory) {
      throw new Error(`Unknown overlay key: ${key}`);
    }

    if (!instances.has(key)) {
      const instance = factory({ width, height });
      instances.set(key, instance);
    }

    return instances.get(key);
  }

  function setOverlay(key) {
    if (activeKey === key) return;

    const nextInstance = ensureInstance(key);
    const overlayPass = nextInstance.pass;

    // Remove any existing reference of this pass first.
    detachPass(composer, overlayPass);

    if (activeInstance && activeInstance.pass) {
      detachPass(composer, activeInstance.pass);
    }

    // Insert before bloom pass if available, otherwise push to end.
    const bloomIndex = composer.passes.indexOf(bloomPass);
    if (bloomIndex >= 0) {
      composer.passes.splice(bloomIndex, 0, overlayPass);
    } else {
      composer.addPass(overlayPass);
    }

    overlayPass.renderToScreen = false;
    if (bloomPass) {
      bloomPass.renderToScreen = true;
    }

    activeKey = key;
    activeInstance = nextInstance;
  }

  function update(time) {
    if (activeInstance && typeof activeInstance.update === 'function') {
      activeInstance.update(time);
    }
  }

  function resize(nextWidth, nextHeight) {
    width = nextWidth;
    height = nextHeight;

    instances.forEach(instance => {
      if (typeof instance.setSize === 'function') {
        instance.setSize(nextWidth, nextHeight);
      }
    });
  }

  function dispose() {
    instances.forEach(instance => {
      if (typeof instance.dispose === 'function') {
        instance.dispose();
      }
    });
    instances.clear();
  }

  function mutateOverlay(key, handler) {
    const instance = ensureInstance(key);
    if (instance && typeof handler === 'function') {
      handler(instance);
    }
  }

  return {
    setOverlay,
    update,
    resize,
    dispose,
    mutateOverlay,
    getActiveKey: () => activeKey,
    getOptions: () => OVERLAY_OPTIONS,
    DEFAULT_OVERLAY_KEY
  };
}

export { DEFAULT_OVERLAY_KEY, OVERLAY_OPTIONS } from './passes/index.js';
