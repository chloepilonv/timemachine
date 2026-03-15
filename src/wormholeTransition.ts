/**
 * WormholeTransition — bright flash + color burst during era transitions.
 * No video file needed. A sphere around the camera flashes white, then
 * fades through the era color before clearing to reveal the new world.
 *
 * Hardened for Quest 3: every async path has timeouts, every state flag
 * resets on forceEnd(), and stale setTimeout callbacks are guarded by a
 * monotonically-increasing generation counter.
 */

import * as THREE from "three";
import { WORLDS, type Era } from "./worlds.js";

const FLASH_IN_MS = 150; // white flash ramps up
const HOLD_MS = 400; // hold at full brightness while splat loads
const FLASH_OUT_MS = 350; // fade out to reveal new world
const MIN_DISPLAY_MS = 600; // minimum total time before fade-out starts

export class WormholeTransition {
  private sphere: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private scene: THREE.Scene;
  private active = false;
  private phase: "flash-in" | "hold" | "flash-out" | "done" = "done";
  private phaseStart = 0;
  private resolveTransition: (() => void) | null = null;
  private splatReady = false;
  private generation = 0;
  private targetEra: Era = "present";

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        opacity: { value: 0.0 },
        color: { value: new THREE.Color(1, 1, 1) },
        progress: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        uniform vec3 color;
        uniform float progress;
        varying vec3 vPos;
        void main() {
          // Radial gradient from center — bright core fading to edges
          float dist = length(vPos.xz) / 3.0;
          float radial = 1.0 - smoothstep(0.0, 1.0, dist);
          float core = radial * 0.4 + 0.6;

          // Mix white flash with era color as progress increases
          vec3 flashColor = mix(vec3(1.0), color, progress * 0.6);

          gl_FragColor = vec4(flashColor * core, opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
    });

    // Big sphere around the camera
    const geo = new THREE.SphereGeometry(4, 32, 32);
    this.sphere = new THREE.Mesh(geo, this.material);
    this.sphere.renderOrder = 9999;
    this.sphere.visible = false;
  }

  setTargetEra(era: Era): void {
    this.targetEra = era;
  }

  start(): void {
    if (this.active) {
      this.forceEnd();
    }

    this.generation++;
    this.active = true;
    this.splatReady = false;
    this.phase = "flash-in";
    this.phaseStart = performance.now();
    this.resolveTransition = null;

    // Set era color
    const eraColor = WORLDS[this.targetEra]?.color ?? 0xffffff;
    this.material.uniforms.color.value.setHex(eraColor);
    this.material.uniforms.opacity.value = 0;
    this.material.uniforms.progress.value = 0;

    this.sphere.visible = true;
    this.scene.add(this.sphere);

    console.log("[Wormhole] Flash started (generation=" + this.generation + ")");
  }

  signalSplatReady(): void {
    if (!this.active) return;
    this.splatReady = true;
    console.log("[Wormhole] Splat ready");
    this.tryFlashOut();
  }

  waitForComplete(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => {
      if (this.resolveTransition) {
        const old = this.resolveTransition;
        this.resolveTransition = null;
        old();
      }
      this.resolveTransition = resolve;
    });
  }

  isFullyOpaque(): boolean {
    return this.active && this.phase !== "flash-in" && this.material.uniforms.opacity.value >= 0.95;
  }

  isActive(): boolean {
    return this.active;
  }

  tick(camera: THREE.Camera): void {
    if (!this.active) return;

    this.sphere.position.copy(camera.position);

    const now = performance.now();
    const elapsed = now - this.phaseStart;

    switch (this.phase) {
      case "flash-in": {
        const t = Math.min(elapsed / FLASH_IN_MS, 1);
        // Ease-in: accelerating flash
        const eased = t * t;
        this.material.uniforms.opacity.value = eased;
        this.material.uniforms.progress.value = t * 0.3;

        if (t >= 1) {
          this.phase = "hold";
          this.phaseStart = now;
        }
        break;
      }

      case "hold": {
        // Full brightness, slowly shift toward era color
        this.material.uniforms.opacity.value = 1.0;
        const holdT = Math.min(elapsed / 1000, 1);
        this.material.uniforms.progress.value = 0.3 + holdT * 0.7;
        break;
      }

      case "flash-out": {
        const t = Math.min(elapsed / FLASH_OUT_MS, 1);
        // Ease-out: decelerating fade
        const eased = 1 - (1 - t) * (1 - t);
        this.material.uniforms.opacity.value = 1.0 - eased;
        this.material.uniforms.progress.value = 1.0;

        if (t >= 1) {
          this.finish();
        }
        break;
      }
    }
  }

  private tryFlashOut(): void {
    if (!this.active || !this.splatReady) return;

    const gen = this.generation;
    const elapsed = performance.now() - this.phaseStart;

    // If still in flash-in, wait until hold phase
    if (this.phase === "flash-in") {
      setTimeout(() => {
        if (this.generation !== gen) return;
        this.tryFlashOut();
      }, 50);
      return;
    }

    // Ensure minimum display time
    const totalElapsed = performance.now() - (this.phaseStart - (this.phase === "hold" ? FLASH_IN_MS : 0));
    if (totalElapsed < MIN_DISPLAY_MS) {
      setTimeout(() => {
        if (this.generation !== gen) return;
        this.tryFlashOut();
      }, MIN_DISPLAY_MS - totalElapsed);
      return;
    }

    console.log("[Wormhole] Flashing out");
    this.phase = "flash-out";
    this.phaseStart = performance.now();
  }

  private finish(): void {
    if (!this.active) return;

    this.active = false;
    this.splatReady = false;
    this.phase = "done";
    this.sphere.visible = false;
    this.scene.remove(this.sphere);
    this.material.uniforms.opacity.value = 0;
    console.log("[Wormhole] Complete (generation=" + this.generation + ")");

    if (this.resolveTransition) {
      const cb = this.resolveTransition;
      this.resolveTransition = null;
      cb();
    }
  }

  forceEnd(): void {
    console.warn("[Wormhole] Force-ended (generation=" + this.generation + ")");
    this.finish();
  }

  dispose(): void {
    this.forceEnd();
    this.material.dispose();
    this.sphere.geometry.dispose();
  }
}
