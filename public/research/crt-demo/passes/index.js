import { createMulticolorCrtPass } from './multicolorCrtPass.js';
import { createMonochromeCrtPass } from './monochromeCrtPass.js';

const OVERLAY_DEFINITIONS = [
  { key: 'multicolor', label: 'Multicolor CRT', factory: createMulticolorCrtPass },
  { key: 'monochrome', label: 'Monochrome CRT', factory: createMonochromeCrtPass }
];

export const OVERLAY_FACTORIES = OVERLAY_DEFINITIONS.reduce((acc, def) => {
  acc[def.key] = def.factory;
  return acc;
}, {});

export const OVERLAY_OPTIONS = OVERLAY_DEFINITIONS.map(({ key, label }) => ({ key, label }));

export const DEFAULT_OVERLAY_KEY = 'multicolor';
