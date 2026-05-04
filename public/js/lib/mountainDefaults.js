export const MOUNTAIN_STACK_DEFAULTS = {
  widthScale: 2.05,
  heightScale: 0.78,
  worldScale: 20,
  layerGap: 5,
  groupX: 0,
  groupY: 0,
  groupZ: -30,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  alphaTest: 0.06
};

export const MOUNTAIN_LAYER_DEFAULTS = [
  { name: 'mountain_01', path: '/images/mountain_01.png', xOffset: 0, zOffset: -0.01, yOffset: 0, widthMultiplier: 1.2, heightMultiplier: 1, opacity: 1, tint: '#f3eff7' },
  { name: 'mountain_02', path: '/images/mountain_02.png', xOffset: -3.5, zOffset: -0.5, yOffset: 0, widthMultiplier: 1.2, heightMultiplier: 2.5, opacity: 1, tint: '#ede8f4' },
  { name: 'mountain_03', path: '/images/mountain_03.png', xOffset: 0, zOffset: -0.03, yOffset: 0, widthMultiplier: 1.4, heightMultiplier: 1.5, opacity: 1, tint: '#d9d6ef' },
  { name: 'mountain_04', path: '/images/mountain_04.png', xOffset: 0, zOffset: -0.04, yOffset: 0, widthMultiplier: 1.6, heightMultiplier: 1.5, opacity: 1, tint: '#c6cceb' },
  { name: 'mountain_05', path: '/images/mountain_05.png', xOffset: 0, zOffset: -0.05, yOffset: 0, widthMultiplier: 1.8, heightMultiplier: 1.5, opacity: 1, tint: '#afbde5' },
  { name: 'mountain_06', path: '/images/mountain_06.png', xOffset: 0, zOffset: -0.06, yOffset: 0, widthMultiplier: 2, heightMultiplier: 2, opacity: 1, tint: '#98b1db' }
];

export function getDefaultLayerTints() {
  return MOUNTAIN_LAYER_DEFAULTS.map(layer => layer.tint);
}

export function getUniformLayerTints(color) {
  return MOUNTAIN_LAYER_DEFAULTS.map(() => color);
}

export const MOUNTAIN_TINT_PRESETS = {
  day: getUniformLayerTints('#c7d8ff'),
  sunset: getUniformLayerTints('#746582'),
  night: getUniformLayerTints('#414768')
};

export function getMountainTintStack(presetName) {
  if (presetName === 'fullsun' || presetName === 'day') return MOUNTAIN_TINT_PRESETS.day;
  if (presetName === 'night') return MOUNTAIN_TINT_PRESETS.night;
  return MOUNTAIN_TINT_PRESETS.sunset;
}
