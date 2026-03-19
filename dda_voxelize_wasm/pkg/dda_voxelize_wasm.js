let wasm;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

export function start() {
    wasm.start();
}

let cachedInt32ArrayMemory0 = null;

function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;

function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {number} voxel_size
 * @returns {VoxelizationResult}
 */
export function voxelize_mesh(vertices, indices, voxel_size) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh(ptr0, len0, ptr1, len1, voxel_size);
    return VoxelizationResult.__wrap(ret);
}

/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {Float32Array} vertex_colors
 * @param {number} voxel_size
 * @returns {VoxelizationResult}
 */
export function voxelize_mesh_with_vertex_colors(vertices, indices, vertex_colors, voxel_size) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(vertex_colors, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh_with_vertex_colors(ptr0, len0, ptr1, len1, ptr2, len2, voxel_size);
    return VoxelizationResult.__wrap(ret);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {Float32Array} vertex_colors
 * @param {number} voxel_size
 * @param {number} origin_x
 * @param {number} origin_y
 * @param {number} origin_z
 * @param {number} grid_x
 * @param {number} grid_y
 * @param {number} grid_z
 * @returns {Uint32Array}
 */
export function voxelize_mesh_with_vertex_colors_packed(vertices, indices, vertex_colors, voxel_size, origin_x, origin_y, origin_z, grid_x, grid_y, grid_z) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(vertex_colors, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh_with_vertex_colors_packed(ptr0, len0, ptr1, len1, ptr2, len2, voxel_size, origin_x, origin_y, origin_z, grid_x, grid_y, grid_z);
    var v4 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {Float32Array} uvs
 * @param {Uint8Array} texture
 * @param {number} tex_width
 * @param {number} tex_height
 * @param {number} voxel_size
 * @returns {VoxelizationResult}
 */
export function voxelize_mesh_with_uv_and_texture(vertices, indices, uvs, texture, tex_width, tex_height, voxel_size) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(uvs, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(texture, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh_with_uv_and_texture(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, tex_width, tex_height, voxel_size);
    return VoxelizationResult.__wrap(ret);
}

/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {Float32Array} uvs
 * @param {Uint8Array} texture
 * @param {number} tex_width
 * @param {number} tex_height
 * @param {number} offset_u
 * @param {number} offset_v
 * @param {number} repeat_u
 * @param {number} repeat_v
 * @param {number} rotation
 * @param {number} center_u
 * @param {number} center_v
 * @param {boolean} flip_y
 * @param {number} voxel_size
 * @returns {VoxelizationResult}
 */
export function voxelize_mesh_with_uv_and_texture_params(vertices, indices, uvs, texture, tex_width, tex_height, offset_u, offset_v, repeat_u, repeat_v, rotation, center_u, center_v, flip_y, voxel_size) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(uvs, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(texture, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh_with_uv_and_texture_params(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, tex_width, tex_height, offset_u, offset_v, repeat_u, repeat_v, rotation, center_u, center_v, flip_y, voxel_size);
    return VoxelizationResult.__wrap(ret);
}

/**
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {Float32Array} uvs
 * @param {Uint8Array} texture
 * @param {number} tex_width
 * @param {number} tex_height
 * @param {number} offset_u
 * @param {number} offset_v
 * @param {number} repeat_u
 * @param {number} repeat_v
 * @param {number} rotation
 * @param {number} center_u
 * @param {number} center_v
 * @param {boolean} flip_y
 * @param {number} voxel_size
 * @param {number} origin_x
 * @param {number} origin_y
 * @param {number} origin_z
 * @param {number} grid_x
 * @param {number} grid_y
 * @param {number} grid_z
 * @returns {Uint32Array}
 */
export function voxelize_mesh_with_uv_and_texture_params_packed(vertices, indices, uvs, texture, tex_width, tex_height, offset_u, offset_v, repeat_u, repeat_v, rotation, center_u, center_v, flip_y, voxel_size, origin_x, origin_y, origin_z, grid_x, grid_y, grid_z) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(uvs, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(texture, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.voxelize_mesh_with_uv_and_texture_params_packed(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, tex_width, tex_height, offset_u, offset_v, repeat_u, repeat_v, rotation, center_u, center_v, flip_y, voxel_size, origin_x, origin_y, origin_z, grid_x, grid_y, grid_z);
    var v5 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v5;
}

/**
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @param {number} bbox_min_x
 * @param {number} bbox_min_y
 * @param {number} bbox_min_z
 * @param {number} voxel_size
 * @param {number} grid_x
 * @param {number} grid_y
 * @param {number} grid_z
 * @param {number} dense_threshold
 * @returns {Uint32Array}
 */
export function rasterize_mesh_2d5_packed(positions, indices, bbox_min_x, bbox_min_y, bbox_min_z, voxel_size, grid_x, grid_y, grid_z, dense_threshold) {
    const ptr0 = passArrayF32ToWasm0(positions, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rasterize_mesh_2d5_packed(ptr0, len0, ptr1, len1, bbox_min_x, bbox_min_y, bbox_min_z, voxel_size, grid_x, grid_y, grid_z, dense_threshold);
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

const VoxelizationResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_voxelizationresult_free(ptr >>> 0, 1));

export class VoxelizationResult {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(VoxelizationResult.prototype);
        obj.__wbg_ptr = ptr;
        VoxelizationResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VoxelizationResultFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_voxelizationresult_free(ptr, 0);
    }
    /**
     * @returns {Int32Array}
     */
    get positions() {
        const ret = wasm.voxelizationresult_positions(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get colors() {
        const ret = wasm.voxelizationresult_colors(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) VoxelizationResult.prototype[Symbol.dispose] = VoxelizationResult.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_throw_b855445ff6a94295 = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('dda_voxelize_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
