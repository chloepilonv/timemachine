
import * as THREE from "three";
import {
  DistanceGrabbable,
  Interactable,
  Mesh,
  MovementMode,
  World,
} from "@iwsdk/core";


// ------------------------------------------------------------
// Spawn – creates the sphere entity and starts the time uniform
// ------------------------------------------------------------
export interface HologramSphereOptions {
  position?: THREE.Vector3Tuple;
  radius?: number;
}

export function spawnHologramSphere(
  world: World,
  options?: HologramSphereOptions,
): void {
  const radius = options?.radius ?? 0.25;
  const position = options?.position ?? [-1, 1.29, -1.9];


  // ------------------------------------------------------------
  // Material
  // ------------------------------------------------------------
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(0x00aaff) },
      uRimColor: { value: new THREE.Color(0x66ddff) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRimColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.0);
        vec3 color = mix(uColor, uRimColor, fresnel);
        float alpha = fresnel * 0.85 + 0.08;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });


  // ------------------------------------------------------------
  // Sphere
  // ------------------------------------------------------------
  const sphere = new Mesh(
    new THREE.SphereGeometry(radius, 48, 48),
    material,
  );
  sphere.position.set(...position);
  sphere.renderOrder = 999;


  // ------------------------------------------------------------
  // Entity
  // ------------------------------------------------------------
  world
    .createTransformEntity(sphere)
    .addComponent(Interactable)
    .addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveAtSource,
      translate: true,
      rotate: true,
      scale: false,
    });
}

