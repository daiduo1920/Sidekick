import * as THREE from './three.module.min.js';
import { GLTFLoader } from './GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './three-vrm.module.min.js';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
} from './three-vrm-animation.module.min.js';

window.KuroVrmLib = {
  THREE,
  GLTFLoader,
  VRMLoaderPlugin,
  VRMUtils,
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
};

window.dispatchEvent(new CustomEvent('kuro-vrm-ready'));
