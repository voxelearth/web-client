import * as THREE from 'three';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader }   from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader }  from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader }   from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class SingleSceneViewer {
	constructor() {
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 100);
		camera.position.z = -0.25; 
		camera.position.y = 0.2;

		// Enable voxel layer (1) so voxel meshes assigned to that layer render in this viewer
		try {
			camera.layers.enable(1);
		} catch (e) { /* ignore if layers unsupported */ }

		const renderer = new THREE.WebGLRenderer({ antialias: true });
				renderer.setSize(window.innerWidth, window.innerHeight);
				// Use sRGB color space so GLTF colors match expected appearance
				if (THREE.SRGBColorSpace !== undefined) {
					renderer.outputColorSpace = THREE.SRGBColorSpace;
				} else if (THREE.sRGBEncoding !== undefined) {
					renderer.outputEncoding = THREE.sRGBEncoding;
				}
		document.body.appendChild(renderer.domElement);
		
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.update();
		this.controls = controls;
		controls.minDistance = 0.1;
		controls.maxDistance = 5;

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
		scene.add(directionalLight);
		const light = new THREE.AmbientLight(0x404040); 
		scene.add(light);
		// Ensure lights illuminate voxel layer as well
		try { directionalLight.layers.enable(1); } catch(e) {}
		try { light.layers.enable(1); } catch(e) {}

		window.addEventListener('resize', this.resizeCanvas.bind(this));
		this.scene = scene;
		this.camera = camera;
		this.renderer = renderer;
	this.tilesContainer = null;
	this.gltfArray = [];
	this.voxelMeshes = []; // Initialize voxel meshes array
	this._debugTilesOn = false;
	this._debugHelpers = [];
	this.gltfLoader = this._makeGLTFLoader(renderer);

		this.render();
		this.resizeCanvas();
	}

	_makeGLTFLoader(renderer) {
		const THREE_PATH = `https://unpkg.com/three@0.160`;
		const draco = new DRACOLoader().setDecoderPath(`${THREE_PATH}/examples/jsm/libs/draco/gltf/`);
		const ktx2  = new KTX2Loader().setTranscoderPath(`${THREE_PATH}/examples/jsm/libs/basis/`);
		ktx2.detectSupport(renderer);
		const loader = new GLTFLoader();
		loader.setDRACOLoader(draco);
		loader.setKTX2Loader(ktx2);
		loader.setMeshoptDecoder(MeshoptDecoder);
		// Enable three.js in-memory cache to short-circuit duplicate GLB / texture fetches this session
		THREE.Cache.enabled = true;
		return loader;
	}

	render() {
		const { renderer, camera, scene } = this;
	  	requestAnimationFrame(this.render.bind(this));
	  	renderer.render(scene, camera);
	}

	resizeCanvas() {
		const { camera, renderer } = this;
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	}

	async loadGLTFTiles(urlArray, logFn) {
		// Resizing/recentering code inspired by by gltf-viewer
		// https://github.com/donmccurdy/three-gltf-viewer/blob/de78a07180e4141b0b87a0ff4572bc4f7aafec56/src/viewer.js#L246
		const { scene, controls, camera } = this;
		// Remove any previous 3D Tiles we were rendering
		if (this.tilesContainer) {
			scene.remove(this.tilesContainer);
			this.tilesContainer = null;
		}
		const tilesContainer = new THREE.Object3D();
		// Fetch individual glTF's (with DRACO/KTX2/Meshopt support) and add them to the scene
		const gltfArray = [];
		for (let i = 0; i < urlArray.length; i++) {
			const url = urlArray[i];
			if (logFn) logFn(`Fetching glTF ${i + 1}/${urlArray.length}`);
			try {
				const gltf = await new Promise((res, rej) => this.gltfLoader.load(url, res, undefined, rej));
				gltfArray.push(gltf);
				tilesContainer.add(gltf.scene);
			} catch (e) {
				logFn?.(`Skipped one tile (${e?.message ?? 'load error'})`);
			}
		}

		if (logFn) logFn(`Normalizing & stitching together ${gltfArray.length} glTFs`);


		// Re-center & normalize the *whole* container
		const box = new THREE.Box3().setFromObject(tilesContainer);
		const sizeVec = box.getSize(new THREE.Vector3());
		const diag = sizeVec.length() || 1;
		const center = box.getCenter(new THREE.Vector3());
		const ecefUp = center.clone().normalize(); // keep before moving
		// move each child by -center (do NOT move the container) so transform order matches the main viewer
		tilesContainer.children.forEach(child => {
			if (child.position) child.position.sub(center);
		});
		scene.add(tilesContainer);

		// Rotate ECEF up → +Y
		const upVector = ecefUp;
		const targetNorthVector = new THREE.Vector3(0, 1, 0);
		const rotationAxis = new THREE.Vector3().crossVectors(upVector, targetNorthVector).normalize();
		const rotationAngle = Math.acos(THREE.MathUtils.clamp(upVector.dot(targetNorthVector), -1, 1));
		const quaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, rotationAngle);
		tilesContainer.quaternion.multiply(quaternion);

		// Normalize scale ~[0,1]
		const newScale = 1 / diag;
		tilesContainer.scale.setScalar(newScale);

		// make sure children have the final matrixWorld after rotation+scale
		tilesContainer.updateMatrixWorld(true);
		
		controls.update();
				// Save the tiles we added to remove them next time we add new tiles
				this.tilesContainer = tilesContainer;
				this.gltfArray = gltfArray;

				// Refresh debug helpers according to current toggle
				if (this._debugTilesOn) this._ensureDebugHelpers();
				else                    this._clearDebugHelpers();

				// Frame the camera on the stitched model so it’s visible immediately
				this._frame(tilesContainer);
	}

	_frame(object3D) {
		const { camera, controls } = this;
		const box = new THREE.Box3().setFromObject(object3D);
		if (box.isEmpty()) return;
		const center = box.getCenter(new THREE.Vector3());
		const size   = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		const fov    = THREE.MathUtils.degToRad(camera.fov);
		const dist   = Math.max(0.6, (maxDim * 0.5) / Math.tan(fov * 0.5));
		camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.4, dist));
		controls.target.copy(center);
		controls.update();
	}

	async generateCombineGltf({ preferMinecraft = true } = {}) {
		const exporterOpts = { binary: true, maxTextureSize: 4096, onlyVisible: true };
		const mcApplied = !!(this.voxelMeshes && this.voxelMeshes.some(m => m?.userData?.__mcApplied));
		const useMinecraft = preferMinecraft && mcApplied;
		if (useMinecraft && this.voxelizer) {
			const grid = this.voxelizer._voxelGridRebased || this.voxelizer._voxelGrid;
			if (grid) {
				try {
					const { buildExportGroupFromVoxelGrid } = await import('./assignToBlocksForGLB.js');
					const exportGroup = await buildExportGroupFromVoxelGrid(grid);
					if (exportGroup) {
						exportGLTF(exportGroup, exporterOpts);
						return;
					}
				} catch (err) {
					console.warn('Falling back to scene export after Minecraft bake error.', err);
				}
			}
		}
		exportGLTF(this.scene, exporterOpts);
	}

	destroy() {
		// Clean up voxel meshes
		if (this.voxelMeshes) {
			this.voxelMeshes.forEach(mesh => {
				this.scene.remove(mesh);
				if (mesh.geometry) mesh.geometry.dispose();
				if (mesh.material) {
					if (Array.isArray(mesh.material)) {
						mesh.material.forEach(mat => mat.dispose());
					} else {
						mesh.material.dispose();
					}
				}
			});
			this.voxelMeshes = [];
		}
		
		// Clean up resources
		if (this.tilesContainer) {
			this.scene.remove(this.tilesContainer);
		}
		if (this.renderer.domElement.parentNode) {
			this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
		}
		this.renderer.dispose();
	}

	// ───────────────────── Debug Tiles helpers ─────────────────────
	setDebugTiles(on) {
		this._debugTilesOn = !!on;
		if (this._debugTilesOn) this._ensureDebugHelpers();
		else                    this._clearDebugHelpers();
	}

	_ensureDebugHelpers() {
		if (!this.tilesContainer) return;
		this._clearDebugHelpers();
		const addHelperFor = (obj) => {
			const box = new THREE.Box3().setFromObject(obj);
			if (box.isEmpty()) return;
			const helper = new THREE.Box3Helper(box, 0xffff00);
			try { helper.layers.enable(1); } catch(e) {}
			this.scene.add(helper);
			this._debugHelpers.push(helper);
		};
		for (const child of this.tilesContainer.children) addHelperFor(child);
	}

	_clearDebugHelpers() {
		if (!this._debugHelpers?.length) return;
		for (const h of this._debugHelpers) {
			this.scene.remove(h);
			try { h.geometry?.dispose?.(); } catch {}
			try { h.material?.dispose?.(); } catch {}
		}
		this._debugHelpers.length = 0;
	}
}

const THREE_PATH = `https://unpkg.com/three@0.160`;
const DRACO_LOADER = new DRACOLoader().setDecoderPath(`${THREE_PATH}/examples/jsm/libs/draco/gltf/`);
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(DRACO_LOADER);

function fetchGltf(url) {
	return new Promise((resolve, reject) => {
		gltfLoader.load(url, 
			(gltf) => {
				resolve(gltf);
			}, () => {},
			(error) => {
				reject(error);
			});
	});
}

function exportGLTF(input, params) {
	const gltfExporter = new GLTFExporter();
	const options = {
		trs: params.trs,
		onlyVisible: params.onlyVisible,
		binary: params.binary,
		maxTextureSize: params.maxTextureSize
	};
	gltfExporter.parse(
		input,
		function (result) {
			if (result instanceof ArrayBuffer) {
				saveArrayBuffer(result, 'combined_3d_tiles.glb');
			} else {
				const output = JSON.stringify(result, null, 2);
				saveString(output, 'combined_3d_tiles.gltf');
			}
		},
		function (error) {
			console.log('An error happened during parsing', error);
		},
		options
	);
}

const link = document.createElement('a');
link.style.display = 'none';
document.body.appendChild(link);

function save(blob, filename) {
	link.href = URL.createObjectURL(blob);
	link.download = filename;
	link.click();
}

function saveString(text, filename) {
	save(new Blob([text], { type: 'text/plain' }), filename);
}

function saveArrayBuffer(buffer, filename) {
	save(new Blob([buffer], { type: 'application/octet-stream' }), filename);
}
