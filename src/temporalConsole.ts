/**
 * TemporalConsole — Loads a .glb cockpit control panel model.
 * Positioned at the bottom of the user's view like holding a controller.
 * Purely decorative — era switching uses A/B buttons.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class TemporalConsole {
  private root: THREE.Group;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, _onEra: (era: string) => void, _camera?: THREE.Camera) {
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    // No console model for now — era switching via A/B buttons
  }

  show(): void { this.root.visible = true; }
  hide(): void { this.root.visible = false; }
  setupDesktopPointer(_c: HTMLCanvasElement, _cam: THREE.Camera): void {}
  tick(_d: number, _r: THREE.WebGLRenderer): void {}
  dispose(): void { this.hide(); this.scene.remove(this.root); }
}
