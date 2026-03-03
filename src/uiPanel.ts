import {
  createSystem,
  Entity,
  PanelUI,
  PanelDocument,
  eq,
  VisibilityState,
  UIKitDocument,
  UIKit,
} from "@iwsdk/core";
import * as THREE from "three";

// Render UI on top of splats using AlwaysDepth + high renderOrder.
// depthWrite stays true so the IWSDK laser pointer depth-tests correctly
// against the panel surface (depthTest=false would break it).

const UI_RENDER_ORDER = 10_000;
const APPLIED_FLAG = "__uiDepthConfigApplied";

function configureUIMaterial(material: THREE.Material | null | undefined) {
  if (!material) return;
  material.depthTest = true;
  material.depthWrite = true;
  material.depthFunc = THREE.AlwaysDepth;

  // Use texture alpha for images (e.g. logo) so transparent pixels don’t show black
  if (material instanceof THREE.MeshBasicMaterial && material.map) {
    material.transparent = true;
    material.alphaTest = 0.01;
  }
}

function applyRenderOrderToObject(object3D: THREE.Object3D) {
  object3D.traverse((obj) => {
    obj.renderOrder = UI_RENDER_ORDER;

    if (obj instanceof THREE.Mesh) {
      if (obj.userData[APPLIED_FLAG]) return;
      obj.userData[APPLIED_FLAG] = true;

      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => configureUIMaterial(m));
      } else {
        configureUIMaterial(obj.material);
      }

      // Re-apply every render in case IWSDK replaces materials
      const originalOnBeforeRender = obj.onBeforeRender;
      obj.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        material,
        group,
      ) {
        configureUIMaterial(material as THREE.Material);
        if (typeof originalOnBeforeRender === "function") {
          originalOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            material,
            group,
          );
        }
      };
    }
  });
}

/**
 * Force an entity's UI meshes to render on top of Gaussian Splats.
 * Retries for up to 10 frames since IWSDK may not have built the
 * panel meshes yet at qualify time.
 */
export function makeEntityRenderOnTop(entity: Entity): void {
  let attempts = 0;

  const tryApply = () => {
    if (entity.object3D) {
      applyRenderOrderToObject(entity.object3D);
      return;
    }
    if (++attempts < 10) {
      requestAnimationFrame(tryApply);
    } else {
      console.warn(
        `[Panel] makeEntityRenderOnTop: entity ${entity.index} had no object3D after 10 frames.`,
      );
    }
  };

  tryApply();
}

export class PanelSystem extends createSystem({
  sensaiPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/sensai.json")],
  },
}) {
  init() {
    // replayExisting: true so we run setup for entities that already qualified
    // (e.g. when PanelDocument loads before or in the same tick as init).
    this.queries.sensaiPanel.subscribe("qualify", (entity) => {
      makeEntityRenderOnTop(entity);

      const document = PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;
      if (!document) return;

      const xrButton = document.getElementById("xr-button") as UIKit.Text;
      xrButton.addEventListener("click", () => {
        if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
          this.world.launchXR();
        } else {
          this.world.exitXR();
        }
      });

      this.world.visibilityState.subscribe((visibilityState) => {
        xrButton.setProperties({
          text:
            visibilityState === VisibilityState.NonImmersive
              ? "Enter XR"
              : "Exit to Browser",
        });
      });
    }, true);
  }
}
