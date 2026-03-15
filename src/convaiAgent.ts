import { ConvaiClient } from "convai-web-sdk";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class ConvaiAgent {
  client: ConvaiClient | null = null;
  mesh: THREE.Object3D | null = null;
  isTalking: boolean = false;
  lastTranscript: string = "";
  _cooldown: boolean = false;

  // Idle animation state
  private clock = new THREE.Clock(false);
  private bones: {
    hips: THREE.Bone | null;
    spine1: THREE.Bone | null;
    head: THREE.Bone | null;
    leftArm: THREE.Bone | null;
    rightArm: THREE.Bone | null;
  } = { hips: null, spine1: null, head: null, leftArm: null, rightArm: null };

  init() {
    if (this.client) return;

    const apiKey = (import.meta as any).env.VITE_CONVAI_API_KEY;
    const characterId = (import.meta as any).env.VITE_CONVAI_CHARACTER_ID;

    console.log("[ConvaiAgent] Initializing with characterId:", characterId);
    console.log("[ConvaiAgent] API key present:", !!apiKey);

    this.client = new ConvaiClient({
      apiKey,
      characterId,
      enableAudio: true,
      enableFacialData: false,
    });

    // CRITICAL: This callback receives the AI's response (text + audio)
    this.client.setResponseCallback((response: any) => {
      // The audio is handled automatically by the SDK's internal audio player.
      // Here we just log the text transcript for debugging.
      if (response?.hasAudioResponse?.()) {
        const audioResponse = response.getAudioResponse();
        if (audioResponse) {
          const textData = audioResponse.getTextData();
          if (textData) {
            this.lastTranscript = textData;
            console.log("[ConvaiAgent] AI says:", textData);
          }
          const userData = audioResponse.getUserQuery?.();
          if (userData) {
            const userTranscript = userData.getTextData();
            if (userTranscript) {
              console.log("[ConvaiAgent] User said:", userTranscript);
            }
          }
        }
      }
    });

    this.client.setErrorCallback((type: string, statusMessage: string) => {
      console.error("[ConvaiAgent] Error:", type, statusMessage);
    });

    this.client.onAudioPlay(() => {
      console.log("[ConvaiAgent] 🔊 Agent audio playing...");
    });

    this.client.onAudioStop(() => {
      console.log("[ConvaiAgent] 🔇 Agent audio stopped.");
    });

    console.log("[ConvaiAgent] ✅ Initialized successfully.");
  }

  async loadModel(scene: THREE.Scene, position: THREE.Vector3) {
    return new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        "./models/model_tourguide_v1.glb",
        (gltf) => {
          this.mesh = gltf.scene;
          this.mesh.position.copy(position);

          // Basic shadow and material setup
          this.mesh.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              if (node.material && node.material instanceof THREE.MeshStandardMaterial) {
                node.material.envMapIntensity = 1.0;
              }
            }
          });

          // Find key bones for procedural animation
          this.mesh.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Bone) {
              switch (node.name) {
                case "Hips": this.bones.hips = node; break;
                case "Spine1": this.bones.spine1 = node; break;
                case "Head": this.bones.head = node; break;
                case "LeftArm": this.bones.leftArm = node; break;
                case "RightArm": this.bones.rightArm = node; break;
              }
            }
          });

          // Take avatar out of T-pose: rotate arms down ~65°
          const armAngle = THREE.MathUtils.degToRad(65);
          if (this.bones.leftArm) {
            this.bones.leftArm.rotation.z = armAngle;
          }
          if (this.bones.rightArm) {
            this.bones.rightArm.rotation.z = -armAngle;
          }

          const foundBones = Object.entries(this.bones)
            .filter(([, b]) => b !== null)
            .map(([name]) => name);
          console.log("[ConvaiAgent] Found bones:", foundBones.join(", "));

          // Hook idle animation into the render loop via onBeforeRender
          // (fires every frame in both desktop and XR modes)
          let firstMesh: THREE.Mesh | null = null;
          this.mesh.traverse((node: THREE.Object3D) => {
            if (!firstMesh && node instanceof THREE.Mesh) firstMesh = node;
          });
          if (firstMesh) {
            (firstMesh as THREE.Mesh).onBeforeRender = () => {
              this.update(0);
            };
          }

          this.clock.start();
          scene.add(this.mesh);
          console.log("[ConvaiAgent] ✅ Avaturn model loaded at", position.toArray());
          resolve();
        },
        undefined,
        (err) => {
          console.error("[ConvaiAgent] ❌ Failed to load Avaturn model:", err);
          reject(err);
        }
      );
    });
  }

  /** Call every frame with delta time (seconds) for idle animation. */
  update(delta: number) {
    if (!this.mesh) return;

    const elapsed = this.clock.getElapsedTime();

    // Breathing: gentle sine on Spine1 scale Y
    if (this.bones.spine1) {
      this.bones.spine1.scale.y = 1.0 + Math.sin(elapsed * 1.5 * Math.PI * 2) * 0.02;
    }

    // Body sway: slow sine on Hips rotation Z
    if (this.bones.hips) {
      this.bones.hips.rotation.z = Math.sin(elapsed * 0.5 * Math.PI * 2) * 0.02;
    }

    // Head micro-movement: gentle wander on X and Y
    if (this.bones.head) {
      this.bones.head.rotation.x = Math.sin(elapsed * 0.7 * Math.PI * 2) * 0.01;
      this.bones.head.rotation.y = Math.sin(elapsed * 0.4 * Math.PI * 2) * 0.01;
    }
  }

  startInteraction() {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot start — client not initialized!");
      return;
    }
    if (this._cooldown) {
      console.warn("[ConvaiAgent] ⏳ Cooldown active — please wait a moment...");
      return;
    }
    console.log("[ConvaiAgent] 🎤 Start listening...");
    this.isTalking = true;
    this.client.startAudioChunk();
  }

  stopInteraction() {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot stop — client not initialized!");
      return;
    }
    console.log("[ConvaiAgent] ⏹️ Stop listening — sending audio to Convai...");
    this.isTalking = false;
    this.client.endAudioChunk();

    // Cooldown: prevent immediate re-start so AudioRecorder can fully reset
    this._cooldown = true;
    setTimeout(() => {
      this._cooldown = false;
      console.log("[ConvaiAgent] ✅ Ready for next interaction.");
    }, 1500);
  }

  // Text-based input for testing multi-turn without mic
  sendText(text: string) {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot send text — client not initialized!");
      return;
    }
    // Must stop any playing audio and close old gRPC connection first
    this.client.stopCharacterAudio();
    console.log("[ConvaiAgent] 📝 Sending text:", text);
    this.client.sendTextChunk(text);
  }
}

export const convaiAgent = new ConvaiAgent();
