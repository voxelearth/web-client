/* tslint:disable */
/* eslint-disable */
export function start(): void;
export function voxelize_mesh(vertices: Float32Array, indices: Uint32Array, voxel_size: number): VoxelizationResult;
export function voxelize_mesh_with_vertex_colors(vertices: Float32Array, indices: Uint32Array, vertex_colors: Float32Array, voxel_size: number): VoxelizationResult;
export function voxelize_mesh_with_vertex_colors_packed(vertices: Float32Array, indices: Uint32Array, vertex_colors: Float32Array, voxel_size: number, origin_x: number, origin_y: number, origin_z: number, grid_x: number, grid_y: number, grid_z: number): Uint32Array;
export function voxelize_mesh_with_uv_and_texture(vertices: Float32Array, indices: Uint32Array, uvs: Float32Array, texture: Uint8Array, tex_width: number, tex_height: number, voxel_size: number): VoxelizationResult;
export function voxelize_mesh_with_uv_and_texture_params(vertices: Float32Array, indices: Uint32Array, uvs: Float32Array, texture: Uint8Array, tex_width: number, tex_height: number, offset_u: number, offset_v: number, repeat_u: number, repeat_v: number, rotation: number, center_u: number, center_v: number, flip_y: boolean, voxel_size: number): VoxelizationResult;
export function voxelize_mesh_with_uv_and_texture_params_packed(vertices: Float32Array, indices: Uint32Array, uvs: Float32Array, texture: Uint8Array, tex_width: number, tex_height: number, offset_u: number, offset_v: number, repeat_u: number, repeat_v: number, rotation: number, center_u: number, center_v: number, flip_y: boolean, voxel_size: number, origin_x: number, origin_y: number, origin_z: number, grid_x: number, grid_y: number, grid_z: number): Uint32Array;
export function rasterize_mesh_2d5_packed(positions: Float32Array, indices: Uint32Array, bbox_min_x: number, bbox_min_y: number, bbox_min_z: number, voxel_size: number, grid_x: number, grid_y: number, grid_z: number, dense_threshold: number): Uint32Array;
export class VoxelizationResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly positions: Int32Array;
  readonly colors: Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_voxelizationresult_free: (a: number, b: number) => void;
  readonly voxelizationresult_positions: (a: number) => [number, number];
  readonly voxelizationresult_colors: (a: number) => [number, number];
  readonly voxelize_mesh: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly voxelize_mesh_with_vertex_colors: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly voxelize_mesh_with_vertex_colors_packed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number];
  readonly voxelize_mesh_with_uv_and_texture: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
  readonly voxelize_mesh_with_uv_and_texture_params: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => number;
  readonly voxelize_mesh_with_uv_and_texture_params_packed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number) => [number, number];
  readonly rasterize_mesh_2d5_packed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
  readonly start: () => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
