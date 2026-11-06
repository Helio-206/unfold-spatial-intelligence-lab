import type { Family } from './types';
import { vehicleFamily } from './vehicle';
import { furnitureFamily } from './furniture';
import { electronicsFamily } from './electronics';
import { applianceFamily } from './appliance';
import { architectureFamily } from './architecture';
import { toolFamily } from './tool';
import { organicFamily } from './organic';
import { constructionFamily } from './construction';

/** Every family the engine can use. Adding one is adding an entry here; nothing else knows family names. */
export const FAMILY_LIST: Family[] = [constructionFamily, vehicleFamily, furnitureFamily, electronicsFamily, applianceFamily, architectureFamily, toolFamily, organicFamily];
