import * as THREE from 'three';
import { OrbitControls }  from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader }     from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }    from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter }   from 'three/addons/exporters/GLTFExporter.js';
import { WebGPURenderer } from 'three/webgpu';

/**
 * A minimal viewer that can be notified when its Google-3D-Tiles
 * are ready (normalised, scaled, added to scene).
 *
 * @param {Object}   [opts]
 * @param {Function} [opts.onTilesReady] – callback({tilesContainer, renderer, scene})
 */
export class Viewer {
  constructor({ onTilesReady } = {}) {
    /* ─────────────────── Scene / camera ─────────────────── */
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      innerWidth / innerHeight,
      0.01,
      100
    );
    camera.position.set(0, 0.2, -0.25);

    /* ─────────────────── Renderer (GPU -> WebGL fallback) ─ */
    let renderer;
    if (navigator.gpu) {
      renderer = new WebGPURenderer({ antialias: true, forceWebGL: false });
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    }
    document.body.appendChild(renderer.domElement);

    /* ─────────────────── Controls / lights ───────────────── */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.1;
    controls.maxDistance = 5;

    scene.add(new THREE.DirectionalLight(0xffffff, 0.5));
    scene.add(new THREE.AmbientLight(0x404040));

    /* ─────────────────── State ───────────────────────────── */
    this.scene     = scene;
    this.camera    = camera;
    this.renderer  = renderer;
    this.controls  = controls;
    this.onTilesReady = onTilesReady;

    window.addEventListener('resize', () => this.resizeCanvas());

    /* ─────────────────── Initialise & start loop ─────────── */
    (async () => {
      if (renderer.init) await renderer.init(); // only WebGPU has .init()
      this.resizeCanvas();
      this.render();            // safe to call after init finished
    })();
  }

  /* ─────────────────── Main loop ─────────────────────────── */
  render() {
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.render());
  }

  resizeCanvas() {
    const { camera, renderer } = this;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }

  /* ─────────────────── Google-3D-Tiles → glTF loader ────── */
  async loadGLTFTiles(urlArray, log) {
    const { scene, controls } = this;

    /* clear previous tiles */
    if (this.tilesContainer) {
      scene.remove(this.tilesContainer);
      this.tilesContainer = null;
    }

    const tilesContainer = new THREE.Object3D();
    const gltfArray = [];

    for (let i = 0; i < urlArray.length; i++) {
      const url = urlArray[i];
      if (log) log(`Fetching glTF ${i + 1}/${urlArray.length}`);
      const gltf = await fetchGltf(url);
      gltfArray.push(gltf);
      tilesContainer.add(gltf.scene);
    }

    if (log) log(`Normalising & stitching ${urlArray.length} glTFs`);

    /* recenter & scale */
    const box    = new THREE.Box3().setFromObject(tilesContainer);
    const size   = box.getSize(new THREE.Vector3()).length();
    const centre = box.getCenter(new THREE.Vector3());

    for (const gltf of gltfArray) {
      const obj = gltf.scene.children[0];
      obj.position.sub(centre);
    }
    scene.add(tilesContainer);

    /* rotate so ‘up’ == +Y */
    const up      = centre.normalize();
    const north   = new THREE.Vector3(0, 1, 0);
    const axis    = new THREE.Vector3().crossVectors(up, north).normalize();
    const angle   = Math.acos(up.dot(north));
    tilesContainer.quaternion.setFromAxisAngle(axis, angle);

    /* scale to [0‥1] cube */
    tilesContainer.scale.setScalar(1 / size);

    controls.update();

    /* save refs & notify */
    this.tilesContainer = tilesContainer;
    this.gltfArray      = gltfArray;

    if (typeof this.onTilesReady === 'function') {
      this.onTilesReady({
        tilesContainer,
        renderer: this.renderer,
        scene: this.scene
      });
    }
  }

  /* ─────────────────── Export combined glTF ─────────────── */
  generateCombineGltf() {
    exportGLTF(this.scene, { maxTextureSize: 4096 });
  }
}

/* ─────────────────────── Helpers ─────────────────────────── */

const THREE_PATH = `https://unpkg.com/three@0.${THREE.REVISION}.x`;
const DRACO_LOADER = new DRACOLoader().setDecoderPath(
  `${THREE_PATH}/examples/jsm/libs/draco/gltf/`
);
const gltfLoader = new GLTFLoader().setDRACOLoader(DRACO_LOADER);

function fetchGltf(url) {
  return new Promise((resolve, reject) =>
    gltfLoader.load(url, resolve, undefined, reject)
  );
}

function exportGLTF(input, params) {
  const exporter = new GLTFExporter();
  exporter.parse(
    input,
    (res) =>
      res instanceof ArrayBuffer
        ? saveArrayBuffer(res, 'combined_3d_tiles.glb')
        : saveString(JSON.stringify(res, null, 2), 'combined_3d_tiles.gltf'),
    (err) => console.error('GLTF export error', err),
    {
      trs: params.trs,
      onlyVisible: params.onlyVisible,
      binary: params.binary,
      maxTextureSize: params.maxTextureSize
    }
  );
}

/* file-save utilities */
const link = Object.assign(document.createElement('a'), { style: 'display:none' });
document.body.appendChild(link);

function save(blob, filename) {
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

const saveString      = (txt, name)   => save(new Blob([txt], { type: 'text/plain' }), name);
const saveArrayBuffer = (buf, name)   => save(new Blob([buf], { type: 'application/octet-stream' }), name);
