import * as THREE from 'three';
import { OrbitControls }  from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader }     from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }    from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter }   from 'three/addons/exporters/GLTFExporter.js';
import { WebGPURenderer } from 'three/webgpu';

/**
 * Minimal viewer for Google-3D-Tiles.
 * Emits `onTilesReady({tilesContainer, renderer, scene})`
 * so callers can voxelise / post-process.
 */
export class Viewer {
  /**
   * @param {Object}   opts
   * @param {Function} opts.onTilesReady
   */
  constructor({ onTilesReady } = {}) {
    /* ─── Scene / camera ──────────────────────────────────────────── */
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.01, 100);
    camera.position.set(0, 0.2, -0.25);

    /* ─── Renderer (WebGPU → WebGL fallback) ──────────────────────── */
    let renderer;
    if (navigator.gpu) {
      renderer = new WebGPURenderer({ antialias: true, forceWebGL: false });
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    }
    document.body.appendChild(renderer.domElement);

    /* ─── Controls & lights ───────────────────────────────────────── */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.1;
    controls.maxDistance = 5;

    scene.add(new THREE.DirectionalLight(0xffffff, 0.5));
    scene.add(new THREE.AmbientLight(0x404040));

    /* ─── Store refs ──────────────────────────────────────────────── */
    this.scene        = scene;
    this.camera       = camera;
    this.renderer     = renderer;
    this.controls     = controls;
    this.onTilesReady = onTilesReady;

    /** {THREE.Object3D} current Google-Tiles container */
    this.tilesContainer = null;
    /** {THREE.InstancedMesh} voxel representation (set by index.js) */
    this.voxelMesh = null;

    window.addEventListener('resize', () => this.#resizeCanvas());

    /* ─── Initialise renderer & start loop ───────────────────────── */
    (async () => {
      if (renderer.init) await renderer.init();   // WebGPU needs init()
      this.#resizeCanvas();
      this.#render();
    })();
  }

  /* ───────────────────────── render loop ─────────────────────────── */
  #render() {
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.#render());
  }

  #resizeCanvas() {
    const { camera, renderer } = this;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }

  /* ─────── Load an array of glTF URLs (one per tile) ─────────────── */
  async loadGLTFTiles(urlArray, log = console.log) {
    const { scene, controls } = this;

    /* remove previous tiles */
    if (this.tilesContainer) scene.remove(this.tilesContainer);

    const tilesContainer = new THREE.Object3D();
    const gltfArray      = [];

    for (let i = 0; i < urlArray.length; ++i) {
      const url = urlArray[i];
      log(`Fetching glTF ${i + 1}/${urlArray.length}`);
      const gltf = await fetchGltf(url);
      gltfArray.push(gltf);
      tilesContainer.add(gltf.scene);
    }

    log(`Normalising & stitching ${urlArray.length} glTFs`);

    /* centre at origin */
    const box    = new THREE.Box3().setFromObject(tilesContainer);
    const size   = box.getSize(new THREE.Vector3()).length();
    const centre = box.getCenter(new THREE.Vector3());

    for (const gltf of gltfArray) {
      gltf.scene.position.sub(centre);
    }
    scene.add(tilesContainer);

    /* rotate so “up” is +Y */
    const up    = centre.normalize();
    const north = new THREE.Vector3(0, 1, 0);
    const axis  = new THREE.Vector3().crossVectors(up, north).normalize();
    tilesContainer.quaternion.setFromAxisAngle(axis, Math.acos(up.dot(north)));

    /* uniform scale to unit cube */
    tilesContainer.scale.setScalar(1 / size);

    controls.update();

    /* save & notify */
    this.tilesContainer = tilesContainer;
    this.gltfArray      = gltfArray;

    if (typeof this.onTilesReady === 'function') {
      this.onTilesReady({ tilesContainer, renderer: this.renderer, scene: this.scene });
    }
  }

  /* ───────────────────── Export combined glTF ────────────────────── */
  generateCombineGltf() {
    exportGLTF(this.scene, { maxTextureSize: 4096 });
  }
}

/* ────────────────────────── helpers ──────────────────────────────── */

const THREE_PATH   = `https://unpkg.com/three@0.${THREE.REVISION}.x`;
const DRACO_LOADER = new DRACOLoader().setDecoderPath(`${THREE_PATH}/examples/jsm/libs/draco/gltf/`);
const gltfLoader   = new GLTFLoader().setDRACOLoader(DRACO_LOADER);

function fetchGltf(url) {
  return new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
}

function exportGLTF(input, params) {
  new GLTFExporter().parse(
    input,
    (out) => {
      if (out instanceof ArrayBuffer) {
        saveBlob(out, 'combined_3d_tiles.glb', 'application/octet-stream');
      } else {
        saveBlob(JSON.stringify(out, null, 2), 'combined_3d_tiles.gltf', 'text/plain');
      }
    },
    (err) => console.error('GLTF export error', err),
    { binary: params.binary, onlyVisible: params.onlyVisible, maxTextureSize: params.maxTextureSize }
  );
}

function saveBlob(data, filename, mime) {
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = URL.createObjectURL(new Blob([data], { type: mime }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}
