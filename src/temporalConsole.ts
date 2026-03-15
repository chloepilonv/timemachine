/**
 * TemporalConsole — A 3D XR console with lever and era buttons.
 * Uses raw Three.js raycasting against XR controllers for reliable
 * custom-mesh interaction in immersive mode.
 *
 * Quest-safe: all materials are MeshBasicMaterial (no lighting passes,
 * no transmission). Visible = true from construction. Fixed scene position.
 */

import * as THREE from "three";
import { Era } from "./worlds.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ERA_COLORS: number[] = [
  0xffc800, // Past    — Gold
  0xffffff, // Present — White
  0x00ffd5, // Future  — Cyan
];

const ERA_LABELS: string[] = ["PAST", "PRESENT", "FUTURE"];
const INDEX_ERA: Era[] = ["past", "present", "future"];

const LEVER_SWING_TIME = 0.9;
const PULSE_DURATION = 0.65;

// ── Button bookkeeping ───────────────────────────────────────────────────────

interface ButtonEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  hovered: boolean;
}

interface ControllerEntry {
  controller: THREE.XRTargetRaySpace;
  rayLine: THREE.Line;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC CLASS
// ═════════════════════════════════════════════════════════════════════════════

export class TemporalConsole {
  private root: THREE.Group;
  private scene: THREE.Scene;
  private onEra: (era: Era) => void;

  // Sub-groups
  private leverPivot!: THREE.Group;
  private leverGlowMat!: THREE.MeshBasicMaterial;

  private buttons: ButtonEntry[] = [];
  private interactiveObjects: THREE.Mesh[] = [];
  private controllerEntries: ControllerEntry[] = [];
  private controllersSetUp = false;

  // Animation state
  private anim = {
    leverActive: false,
    leverTimer: 0,
    buttonPulse: [-1, -1, -1],
  };

  // Shared scratch objects
  private raycaster = new THREE.Raycaster();
  private tempMatrix = new THREE.Matrix4();
  private pointer = new THREE.Vector2(-9, -9);

  // Desktop interaction
  private camera: THREE.Camera | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(scene: THREE.Scene, onEra: (era: Era) => void, camera?: THREE.Camera) {
    this.scene = scene;
    this.onEra = onEra;

    this.root = new THREE.Group();
    // Cockpit dashboard: below eye level, close, tilted up toward user
    this.root.position.set(0, -0.15, -0.55);
    this.root.visible = true;

    // Parent to camera so it follows the user like a dashboard
    if (camera) {
      camera.add(this.root);
    } else {
      scene.add(this.root);
    }

    this.buildConsole();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show(): void {
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  /**
   * Set up desktop mouse interaction. Call once after renderer is available.
   */
  setupDesktopPointer(canvas: HTMLCanvasElement, camera: THREE.Camera): void {
    this.canvas = canvas;
    this.camera = camera;

    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!this.root.visible) return;

      this.raycaster.setFromCamera(this.pointer, camera);
      const hits = this.raycaster.intersectObjects(this.interactiveObjects);
      if (hits.length > 0) {
        const idx = hits[0].object.userData.buttonIndex;
        if (idx !== undefined) this.activateEra(idx, null);
      }
    });

    // Hover cursor
    canvas.addEventListener("pointermove", () => {
      if (!this.root.visible || !this.camera) return;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.interactiveObjects);
      canvas.style.cursor = hits.length > 0 ? "pointer" : "default";
    });
  }

  /**
   * Call every frame while the console is visible.
   */
  tick(delta: number, renderer: THREE.WebGLRenderer): void {
    if (!this.root.visible) return;

    // Lazily set up controllers on first tick (renderer must have XR active)
    if (!this.controllersSetUp && renderer.xr.isPresenting) {
      this.setupXRControllers(renderer);
      this.controllersSetUp = true;
    }

    this.tickAnimations(delta);

    if (renderer.xr.isPresenting) {
      this.tickControllerRaycasting();
    }
  }

  dispose(): void {
    this.hide();
    this.scene.remove(this.root);
  }

  // ── Console geometry ───────────────────────────────────────────────────────

  private buildConsole(): void {
    const consoleGroup = new THREE.Group();
    consoleGroup.scale.setScalar(0.4);
    this.root.add(consoleGroup);

    // All MeshBasicMaterial — Quest-safe, no lighting passes
    const slabMat = new THREE.MeshBasicMaterial({ color: 0x1e1e36 });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x2e2e50 });

    // Main slab
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.048, 0.38),
      slabMat,
    );
    consoleGroup.add(slab);

    // Lower trim bezel
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 0.018, 0.4),
      trimMat,
    );
    bezel.position.y = -0.022;
    consoleGroup.add(bezel);

    // Edge glow strips
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.6,
    });
    for (const zOff of [-0.185, 0.185]) {
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.005, 0.005),
        edgeMat,
      );
      ch.position.set(0, 0.025, zOff);
      consoleGroup.add(ch);
    }
    for (const xOff of [-0.365, 0.365]) {
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.005, 0.37),
        edgeMat,
      );
      ch.position.set(xOff, 0.025, 0);
      consoleGroup.add(ch);
    }

    this.buildLever(consoleGroup);
    this.buildEraButtons(consoleGroup);
  }

  private buildLever(parent: THREE.Group): void {
    this.leverPivot = new THREE.Group();
    this.leverPivot.position.set(-0.2, 0.024, 0.0);
    parent.add(this.leverPivot);

    const leverMat = new THREE.MeshBasicMaterial({ color: 0x6688cc });

    // Socket
    const socket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.038, 0.022, 8),
      new THREE.MeshBasicMaterial({ color: 0x1e1e36 }),
    );
    socket.position.y = 0.011;
    this.leverPivot.add(socket);

    // Shaft
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.013, 0.17, 6),
      leverMat,
    );
    shaft.position.y = 0.11;
    this.leverPivot.add(shaft);

    // Crystal head
    const head = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.034, 0),
      leverMat,
    );
    head.position.y = 0.215;
    head.rotation.set(0.25, 0.6, 0.1);
    this.leverPivot.add(head);

    // Inner glow core
    this.leverGlowMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.35,
    });
    const glowCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.014, 1),
      this.leverGlowMat,
    );
    glowCore.position.y = 0.215;
    this.leverPivot.add(glowCore);
  }

  private buildEraButtons(parent: THREE.Group): void {
    const configs = [
      { color: 0xffc800, x: 0.08 },
      { color: 0xffffff, x: 0.185 },
      { color: 0x00ffd5, x: 0.29 },
    ];

    configs.forEach((cfg, index) => {
      const btnGroup = new THREE.Group();
      btnGroup.position.set(cfg.x, 0.024, 0.01);
      parent.add(btnGroup);

      // Ring mount
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.033, 0.004, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0x333355 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.001;
      btnGroup.add(ring);

      // Glow pedestal disc
      const pedDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.022, 20),
        new THREE.MeshBasicMaterial({
          color: cfg.color,
          transparent: true,
          opacity: 0.3,
        }),
      );
      pedDisc.rotation.x = -Math.PI / 2;
      pedDisc.position.y = 0.002;
      btnGroup.add(pedDisc);

      // Glowing orb — interactive target
      const orbMat = new THREE.MeshBasicMaterial({
        color: cfg.color,
      });
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.019, 16, 16),
        orbMat,
      );
      orb.position.y = 0.02;
      orb.userData.buttonIndex = index;
      btnGroup.add(orb);

      // Label
      // (No text geometry needed — orb color is enough for now)

      this.buttons.push({
        mesh: orb,
        material: orbMat,
        baseColor: new THREE.Color(cfg.color),
        hovered: false,
      });
      this.interactiveObjects.push(orb);
    });
  }

  // ── XR controller setup ────────────────────────────────────────────────────

  private setupXRControllers(renderer: THREE.WebGLRenderer): void {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);

      controller.addEventListener("selectstart", (event: any) => {
        this.onXRSelect(event.target as THREE.XRTargetRaySpace);
      });
      controller.addEventListener("connected", (evt: any) => {
        controller.userData.inputSource = evt.data;
      });
      controller.addEventListener("disconnected", () => {
        controller.userData.inputSource = null;
        controller.userData.hoveredIndex = null;
      });

      // Ray line
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5)];
      const rayMat = new THREE.LineBasicMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.45,
      });
      const rayLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        rayMat,
      );
      rayLine.frustumCulled = false;
      controller.add(rayLine);

      // Reticle dot
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.004, 12),
        new THREE.MeshBasicMaterial({
          color: 0x88aaff,
          side: THREE.DoubleSide,
        }),
      );
      dot.position.z = -0.015;
      dot.rotation.x = -Math.PI / 2;
      controller.add(dot);

      this.controllerEntries.push({ controller, rayLine });
    }
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  private onXRSelect(controller: THREE.XRTargetRaySpace): void {
    if (!this.root.visible) return;
    const idx = (controller as any).userData.hoveredIndex;
    if (idx !== null && idx !== undefined) {
      this.activateEra(idx, controller);
    }
  }

  private activateEra(
    index: number,
    controller: THREE.XRTargetRaySpace | null,
  ): void {
    this.anim.buttonPulse[index] = PULSE_DURATION;
    this.anim.leverActive = true;
    this.anim.leverTimer = 0;

    if (controller) this.fireHaptic(controller);

    // Fire the callback
    this.onEra(INDEX_ERA[index]);
  }

  private fireHaptic(controller: THREE.XRTargetRaySpace): void {
    const src = (controller as any).userData?.inputSource as
      | XRInputSource
      | undefined;
    if (!src?.gamepad) return;

    const gp = src.gamepad as any;

    const actuator = gp.hapticActuators?.[0];
    if (actuator) {
      actuator.pulse(0.7, 120);
      return;
    }

    const vib = gp.vibrationActuator;
    if (vib?.playEffect) {
      vib.playEffect("dual-rumble", {
        duration: 120,
        strongMagnitude: 0.65,
        weakMagnitude: 0.3,
      });
    }
  }

  // ── Per-frame raycasting ───────────────────────────────────────────────────

  private tickControllerRaycasting(): void {
    for (const btn of this.buttons) btn.hovered = false;

    for (const { controller, rayLine } of this.controllerEntries) {
      this.tempMatrix
        .identity()
        .extractRotation(controller.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(
        controller.matrixWorld,
      );
      this.raycaster.ray.direction
        .set(0, 0, -1)
        .applyMatrix4(this.tempMatrix);

      const hits = this.raycaster.intersectObjects(this.interactiveObjects);
      const mat = rayLine.material as THREE.LineBasicMaterial;
      if (hits.length > 0) {
        const idx = hits[0].object.userData.buttonIndex;
        (controller as any).userData.hoveredIndex = idx;
        this.buttons[idx].hovered = true;
        mat.color.setHex(0xffcc44);
        mat.opacity = 0.75;
      } else {
        (controller as any).userData.hoveredIndex = null;
        mat.color.setHex(0x4488ff);
        mat.opacity = 0.45;
      }
    }
  }

  // ── Per-frame animations ───────────────────────────────────────────────────

  private tickAnimations(delta: number): void {
    const now = performance.now() * 0.001;

    // Crystal lever
    if (this.anim.leverActive) {
      this.anim.leverTimer += delta;
      const t = this.anim.leverTimer / LEVER_SWING_TIME;
      if (t >= 1.0) {
        this.anim.leverActive = false;
        this.anim.leverTimer = 0;
        this.leverPivot.rotation.x = 0;
      } else {
        this.leverPivot.rotation.x = Math.sin(t * Math.PI) * 0.42;
      }
      this.leverGlowMat.opacity =
        0.35 + Math.sin(this.anim.leverTimer * 12) * 0.2;
    } else {
      this.leverGlowMat.opacity = 0.3 + Math.sin(now * 1.5) * 0.08;
    }

    // Button pulses & hover
    for (let i = 0; i < 3; i++) {
      const btn = this.buttons[i];

      if (this.anim.buttonPulse[i] > 0) {
        this.anim.buttonPulse[i] -= delta;
        // Flash white during pulse
        btn.material.color.setHex(0xffffff);
      } else if (btn.hovered) {
        // Brighten on hover
        btn.material.color.copy(btn.baseColor).multiplyScalar(1.5);
      } else {
        // Idle gentle pulse
        const pulse = 0.85 + Math.sin(now * 2.0 + i * 2.2) * 0.15;
        btn.material.color.copy(btn.baseColor).multiplyScalar(pulse);
      }
    }
  }
}
