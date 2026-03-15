import { ConvaiClient } from "convai-web-sdk";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WORLDS, type Era } from "./worlds.js";

export class ConvaiAgent {
  client: ConvaiClient | null = null;
  mesh: THREE.Object3D | null = null;
  isTalking: boolean = false;
  lastTranscript: string = "";
  _cooldown: boolean = false;
  private currentEra: Era = "present";

  // Idle animation state
  private clock = new THREE.Clock(false);
  private baseY = 0;

  private apiKey = (import.meta as any).env.VITE_CONVAI_API_KEY;

  init(era: Era = "present") {
    this.createClient(WORLDS[era].convaiCharacterId);
    this.currentEra = era;
  }

  private createClient(characterId: string) {
    // Stop any playing audio on the old client before replacing
    if (this.client) {
      this.client.stopCharacterAudio();
    }

    console.log("[ConvaiAgent] Creating client with characterId:", characterId);

    this.client = new ConvaiClient({
      apiKey: this.apiKey,
      characterId,
      enableAudio: true,
      enableFacialData: false,
    });

    this.client.setResponseCallback((response: any) => {
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

    console.log("[ConvaiAgent] ✅ Initialized for era:", this.currentEra);
  }

  switchEra(era: Era) {
    if (era === this.currentEra) return;
    console.log(`[ConvaiAgent] Switching character: ${this.currentEra} -> ${era}`);
    this.currentEra = era;
    this.createClient(WORLDS[era].convaiCharacterId);
  }

  async loadModel(scene: THREE.Scene, position: THREE.Vector3) {
    return new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        "./models/space_maintenance_robot.glb",
        (gltf) => {
          this.mesh = gltf.scene;
          this.mesh.position.copy(position);
          this.baseY = position.y;

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

          // Hook floating animation into the render loop via onBeforeRender
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
          console.log("[ConvaiAgent] ✅ Robot model loaded at", position.toArray());
          resolve();
        },
        undefined,
        (err) => {
          console.error("[ConvaiAgent] ❌ Failed to load robot model:", err);
          reject(err);
        }
      );
    });
  }

  /** Call every frame for floating idle animation. */
  update(_delta: number) {
    if (!this.mesh) return;

    const t = this.clock.getElapsedTime();

    // Gentle hover bob
    this.mesh.position.y = this.baseY + Math.sin(t * 1.5) * 0.05;

    // Slow tilt/rock for life
    this.mesh.rotation.x = Math.sin(t * 0.8) * 0.03;
    this.mesh.rotation.z = Math.sin(t * 0.6 + 1.0) * 0.025;

    // Gentle yaw drift
    this.mesh.rotation.y += Math.sin(t * 0.3) * 0.0003;
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
