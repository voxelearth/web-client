// voxelize-model.js
import OptimizedVoxelizer from './voxelizer.js';
import * as THREE from 'three';

/**
 * Voxelises a THREE.Object3D (or Group) and returns the voxeliser instance.
 *
 * @param {THREE.Object3D} model         – Object already placed in the scene.
 * @param {THREE.Renderer} renderer      – WebGLRenderer *or* WebGPURenderer.
 * @param {number}         resolution    – Number of voxels along model’s longest axis.
 * @param {THREE.Scene}    scene         – Scene to which voxel meshes are added.
 */
export async function voxelizeModel({model, renderer, resolution = 200, scene}) {

  // calculate voxel size from bounding-box longest edge
  const bbox  = new THREE.Box3().setFromObject(model);
  const size  = new THREE.Vector3();  bbox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const voxelSize = maxDim / resolution;

  const voxelizer = new OptimizedVoxelizer();
  await voxelizer.init({ renderer, model, voxelSize });

  // add resulting meshes
  if (voxelizer.voxelMesh)  scene.add(voxelizer.voxelMesh);
  if (voxelizer.mergedMesh) scene.add(voxelizer.mergedMesh);

  return voxelizer;   // caller can inspect .voxelCount etc.
}
