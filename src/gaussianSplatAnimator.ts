
import { SplatMesh, dyno } from "@sparkjsdev/spark";


// ------------------------------------------------------------
// Constants & Config
// ------------------------------------------------------------

/** Default fly-in / fly-out duration in seconds. */
export const DEFAULT_ANIMATION_DURATION = 1.5;

const DEFAULT_SPREAD = 0.4;

export interface SplatAnimationOptions {
  duration?: number;
  /** Per-splat stagger spread (0–1). */
  spread?: number;
}


// ------------------------------------------------------------
// Animator – GPU-accelerated fly-in / fly-out for SplatMesh
// ------------------------------------------------------------

/**
 * GPU-accelerated fly-in / fly-out animation for a `SplatMesh`.
 *
 * The CPU only advances a single `progress` uniform each frame; all per-splat
 * work (position offset, turbulence, scale pop, opacity fade) runs in GLSL
 * via SparkJS `dyno`.
 *
 * ```ts
 * const animator = new GaussianSplatAnimator(splat, { duration: 2.0 });
 * animator.apply();            // attach modifier & recompile (after load)
 * await animator.animateIn();  // fly-in
 * await animator.animateOut(); // fly-out
 * animator.dispose();
 * ```
 *
 * Call `tick()` every frame from the owning system's `update()`.
 */
export class GaussianSplatAnimator {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  readonly splat: SplatMesh;
  duration: number;

  get isAnimating(): boolean {
    return this._animating;
  }

  private flyInProgress: ReturnType<typeof dyno.dynoFloat>;
  private spread: number;
  private _animating = false;
  private direction: "in" | "out" = "in";
  private startTime = 0;
  private activeDuration = 0;
  private resolveAnimation: (() => void) | null = null;


  // ----------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------

  constructor(splat: SplatMesh, options?: SplatAnimationOptions) {
    this.splat = splat;
    this.duration = options?.duration ?? DEFAULT_ANIMATION_DURATION;
    this.spread = options?.spread ?? DEFAULT_SPREAD;
    this.flyInProgress = dyno.dynoFloat(0.0);
  }


  // ----------------------------------------------------------
  // Shader Setup – attach the fly-in modifier & recompile
  // ----------------------------------------------------------

  apply(): void {
    this.splat.objectModifier = this.createFlyInModifier();
    this.splat.updateGenerator();
  }


  // ----------------------------------------------------------
  // Animation Controls – fly-in, fly-out, stop, dispose
  // ----------------------------------------------------------

  animateIn(duration?: number): Promise<void> {
    return this.start("in", duration ?? this.duration);
  }

  animateOut(duration?: number): Promise<void> {
    return this.start("out", duration ?? this.duration);
  }

  stop(): void {
    if (!this._animating) return;
    this._animating = false;
    if (this.resolveAnimation) {
      const resolve = this.resolveAnimation;
      this.resolveAnimation = null;
      resolve();
    }
  }

  dispose(): void {
    this.stop();
  }


  // ----------------------------------------------------------
  // Frame Tick – advance the progress uniform each frame
  // ----------------------------------------------------------

  tick(): void {
    if (!this._animating) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const t = Math.min(elapsed / this.activeDuration, 1);

    this.flyInProgress.value = this.direction === "in" ? t : 1 - t;
    this.splat.updateVersion();

    if (t >= 1) {
      this._animating = false;
      if (this.resolveAnimation) {
        const resolve = this.resolveAnimation;
        this.resolveAnimation = null;
        resolve();
      }
    }
  }


  // ----------------------------------------------------------
  // Manual Progress – set or read the animation progress (0–1)
  // ----------------------------------------------------------

  /** Set progress directly (0 = origin, 1 = final position). */
  setProgress(value: number): void {
    this.flyInProgress.value = Math.max(0, Math.min(1, value));
    this.splat.updateVersion();
  }

  getProgress(): number {
    return this.flyInProgress.value;
  }


  // ----------------------------------------------------------
  // Internal – start helper
  // ----------------------------------------------------------

  private start(direction: "in" | "out", duration: number): Promise<void> {
    this.stop();
    this.direction = direction;
    this.activeDuration = duration;
    this.startTime = performance.now();
    this._animating = true;
    return new Promise<void>((resolve) => {
      this.resolveAnimation = resolve;
    });
  }


  // ----------------------------------------------------------
  // GPU Modifier (GLSL) – per-splat rise, turbulence, scale pop
  // ----------------------------------------------------------

  /**
   * Each splat rises from 2 m below with staggered timing,
   * layered turbulence, scale pop (30 % -> 100 %), and opacity fade.
   */
  private createFlyInModifier() {
    const progress = this.flyInProgress;
    const spreadValue = this.spread.toFixed(4);

    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const flyInDyno = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            progress: "float",
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              const float FLY_IN_SPREAD = ${spreadValue};

              float hashPosition(vec3 p) {
                p = fract(p * 0.3183099 + 0.1);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
              }

              vec3 hashPosition3(vec3 p) {
                p = fract(p * vec3(0.1031, 0.1030, 0.0973));
                p += dot(p, p.yxz + 33.33);
                return fract((p.xxy + p.yxx) * p.zyx);
              }

              float subtleEase(float t) {
                return mix(t, t * t * (3.0 - 2.0 * t), 0.3);
              }

              float computeLocalProgress(float globalProgress, float rand) {
                float startOffset = rand * (1.0 - FLY_IN_SPREAD);
                float localLinear = clamp(
                  (globalProgress - startOffset) / FLY_IN_SPREAD, 0.0, 1.0
                );
                return subtleEase(localLinear);
              }

              vec3 computeTurbulence(vec3 pos, vec3 randVec, float progress) {
                float turbStrength = (1.0 - progress) * (1.0 - progress);

                float phase = randVec.x * 6.28318;
                float speed = 3.0 + randVec.y * 2.0;
                float t = progress * speed + phase;

                vec3 turb = vec3(
                  sin(t * 2.3 + pos.z * 1.5) * 0.15 + sin(t * 4.1) * 0.08,
                  sin(t * 1.7 + pos.x * 1.2) * 0.05,
                  sin(t * 3.1 + pos.x * 1.8) * 0.15 + cos(t * 2.7) * 0.08
                );

                vec3 randomOffset = vec3(
                  (randVec.x - 0.5) * 0.2,
                  0.0,
                  (randVec.z - 0.5) * 0.2
                );

                return (turb + randomOffset) * turbStrength;
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};

              vec3 originalCenter = ${inputs.gsplat}.center;
              float rand = hashPosition(originalCenter * 10.0);
              vec3 rand3 = hashPosition3(originalCenter * 7.0);

              float easedProgress = computeLocalProgress(${inputs.progress}, rand);

              vec3 startPos = originalCenter + vec3(0.0, -2.0, 0.0);
              vec3 turbulence = computeTurbulence(originalCenter, rand3, easedProgress);

              vec3 basePos = mix(startPos, originalCenter, easedProgress);
              ${outputs.gsplat}.center = basePos + turbulence;

              float scaleMultiplier = 0.3 + 0.7 * easedProgress;
              ${outputs.gsplat}.scales *= scaleMultiplier;

              ${outputs.gsplat}.rgba.a *= easedProgress;
            `),
        });

        const result = flyInDyno.apply({ gsplat, progress });
        return { gsplat: result.gsplat };
      },
    );
  }
}
