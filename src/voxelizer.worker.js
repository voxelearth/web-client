/* voxelizer.worker.js (REPLACEMENT) */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- Helper functions ---
const _samplers = new WeakMap();
function getSampler(tex, imageDatas) {
    if (!tex || !tex.source || !imageDatas.has(tex.source.uuid)) return null;
    if (_samplers.has(tex)) return _samplers.get(tex);

    let sampler = null;
    const imgData = imageDatas.get(tex.source.uuid);

    if (imgData) {
        const { data, width, height } = imgData;
        const { offset, repeat, rotation, center, flipY, wrapS, wrapT } = tex;
        const cosR = Math.cos(rotation), sinR = Math.sin(rotation);

        sampler = (uv, wantRGBA = false) => {
            let u = uv.x * repeat.x + offset.x, v = uv.y * repeat.y + offset.y;
            if (rotation !== 0) {
                u -= center.x; v -= center.y;
                const u2 = u * cosR - v * sinR, v2 = u * sinR + v * cosR;
                u = u2 + center.x; v = v2 + center.y;
            }
            u = wrapS === THREE.RepeatWrapping ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
            v = wrapT === THREE.RepeatWrapping ? ((v % 1) + 1) % 1 : THREE.MathUtils.clamp(v, 0, 1);
            if (flipY) v = 1 - v;

            const x = u * (width - 1), y = v * (height - 1);
            const x0 = Math.floor(x), x1 = Math.min(width - 1, x0 + 1);
            const y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
            const tx = x - x0, ty = y - y0;

            const sample = (ix, iy) => {
                const i = (iy * width + ix) * 4;
                return { r: data[i]/255, g: data[i+1]/255, b: data[i+2]/255, a: data[i+3]/255 };
            };

            const c00 = sample(x0, y0), c10 = sample(x1, y0), c01 = sample(x0, y1), c11 = sample(x1, y1);
            const lerp = (a, b, t) => a + (b - a) * t;
            const r0 = lerp(c00.r, c10.r, tx), g0 = lerp(c00.g, c10.g, tx), b0 = lerp(c00.b, c10.b, tx);
            const r1 = lerp(c01.r, c11.r, tx), g1 = lerp(c01.g, c11.g, tx), b1 = lerp(c01.b, c11.b, tx);

            const color = new THREE.Color(lerp(r0, r1, ty), lerp(g0, g1, ty), lerp(b0, b1, ty));
            if (tex.encoding === THREE.sRGBEncoding) {
                color.convertSRGBToLinear();
            }
            if (wantRGBA) {
                const a0 = lerp(c00.a, c10.a, tx), a1 = lerp(c01.a, c11.a, tx);
                return { r: color.r, g: color.g, b: color.b, a: lerp(a0, a1, ty) };
            }
            return color;
        };
    }
    _samplers.set(tex, sampler);
    return sampler;
}

const COLOR_MAP_KEYS = ['map', 'emissiveMap'];
function* allTextures(mat) {
    for (const k of COLOR_MAP_KEYS) {
        const t = mat[k];
        if (t && t.isTexture) yield t;
    }
}

function kMeansPalette(colors, k = 64, iters = 8) {
    const n = colors.length / 3;
    if (n === 0) return { palette: new Float32Array(k * 3) };
    const cent = new Float32Array(k * 3);
    const sel  = new Set();
    while (sel.size < k && sel.size < n) sel.add(Math.floor(Math.random() * n));
    let ci = 0;
    for (const s of sel) { cent[ci++]=colors[s*3]; cent[ci++]=colors[s*3+1]; cent[ci++]=colors[s*3+2]; }

    const sums = new Float32Array(k*3), cnts = new Uint32Array(k);
    for (let it = 0; it < iters; ++it) {
        sums.fill(0); cnts.fill(0);
        for (let p = 0; p < n; ++p) {
            const r = colors[p*3], g = colors[p*3+1], b = colors[p*3+2];
            let best=0, bestD=1e9;
            for (let c=0; c<k; ++c) {
                const dr=r-cent[c*3], dg=g-cent[c*3+1], db=b-cent[c*3+2];
                const d = dr*dr + dg*dg + db*db;
                if (d < bestD) { bestD = d; best = c; }
            }
            sums[best*3] += r; sums[best*3+1] += g; sums[best*3+2] += b;
            cnts[best]++;
        }
        for (let c=0; c<k; ++c) {
            const ct = Math.max(1, cnts[c]);
            cent[c*3]   = sums[c*3]   / ct;
            cent[c*3+1] = sums[c*3+1] / ct;
            cent[c*3+2] = sums[c*3+2] / ct;
        }
    }
    return { palette: cent };
}

// --- The Main Voxelizer Class ---
class WorkerVoxelizer {
    async init({ modelData, voxelSize, maxGrid = Infinity, paletteSize = 256 }) {
        this.voxelSize = voxelSize;
        this.paletteSize = paletteSize;
        this.imageDatas = new Map(modelData.imageDatas);

        const model = this.#reconstructModel(modelData);
        const baked = this.#bakeAndMerge(model);
        this.positions = baked.positions; this.uvs = baked.uvs;
        this.indices = baked.indices; this.triMats = baked.triMats;
        this.palette = baked.palette; this.materials = baked.materials;

        this.bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); this.bbox.getSize(size);
        let nx = Math.ceil(size.x/voxelSize), ny = Math.ceil(size.y/voxelSize), nz = Math.ceil(size.z/voxelSize);
        const m = Math.max(nx,ny,nz), scale = Number.isFinite(maxGrid) && m>maxGrid ? maxGrid/m : 1;
        this.grid = new THREE.Vector3(Math.ceil(nx*scale), Math.ceil(ny*scale), Math.ceil(nz*scale));
        this.voxelSize /= scale;

        this.#cpuRasterize();
        this.filledVoxelCount = this.voxelTris.size;
        const result = this.#buildMesh();
        const voxelGridData = this.#getVoxelGridData();

        return {
            geometries: result.geometries,
            voxelCount: this.filledVoxelCount,
            voxelGrid: voxelGridData,
        };
    }

    #reconstructModel(modelData) {
        const group = new THREE.Group();
        const materials = new Map();
        const textures = new Map();

        for (const matData of modelData.materials) {
            const MaterialClass = THREE[matData.type] || THREE.MeshStandardMaterial;
            const mat = new MaterialClass();
            mat.uuid = matData.uuid;
            if (matData.color !== undefined) mat.color.setHex(matData.color);
            if (matData.emissive !== undefined) mat.emissive.setHex(matData.emissive);

            for (const key of ['map', 'emissiveMap', 'alphaMap']) {
                if (matData[key]) {
                    const texData = matData[key];
                    if (!textures.has(texData.imageUuid)) {
                        const tex = new THREE.Texture();
                        tex.source.uuid = texData.imageUuid; tex.encoding = texData.encoding;
                        tex.flipY = texData.flipY; tex.wrapS = texData.wrapS; tex.wrapT = texData.wrapT;
                        tex.offset.fromArray(texData.offset); tex.repeat.fromArray(texData.repeat);
                        tex.rotation = texData.rotation; tex.center.fromArray(texData.center);
                        textures.set(texData.imageUuid, tex);
                    }
                    mat[key] = textures.get(texData.imageUuid);
                }
            }
            materials.set(mat.uuid, mat);
        }

        for (const meshData of modelData.meshes) {
            const geometry = new THREE.BufferGeometry();
            for (const [attr, {array, itemSize}] of Object.entries(meshData.geometry.attributes)) {
                geometry.setAttribute(attr, new THREE.BufferAttribute(array, itemSize));
            }
            if (meshData.geometry.index) {
                geometry.setIndex(new THREE.BufferAttribute(meshData.geometry.index.array, 1));
            }
            geometry.groups = meshData.geometry.groups;
            const meshMaterials = meshData.materials.map(uuid => materials.get(uuid));
            const mesh = new THREE.Mesh(geometry, meshMaterials.length > 1 ? meshMaterials : meshMaterials[0]);
            mesh.applyMatrix4(new THREE.Matrix4().fromArray(meshData.matrixWorld));
            group.add(mesh);
        }
        return group;
    }

    #bakeAndMerge(root) {
        const geoms = [], indices = [], allRGB = [], triMats = [], uvs = [], materials = [];
        const matMap = new Map();
        let offset = 0;
        root.traverse(o => {
            if (!o.isMesh || !o.geometry.getAttribute('position')) return;
            o.updateWorldMatrix(true, false);
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
            const posA = g.getAttribute('position');
            if (!posA) return;

            const meshMats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of meshMats) { if (m && !matMap.has(m)) { matMap.set(m, materials.length); materials.push(m); } }
            
            const groups = g.groups.length ? g.groups : [{ start:0, count:posA.count, materialIndex:0 }];
            const uvA  = g.getAttribute('uv');

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
                if (!m) continue;
                for (let vi=grp.start; vi<grp.start+grp.count; ++vi) {
                    let col = (m.color ? m.color.clone() : new THREE.Color(1,1,1));
                    if (m.emissive && m.emissive.getHSL({h:0,s:0,l:0}) > 0) col.add(m.emissive);
                    if (uvA) {
                        const uvv = new THREE.Vector2(uvA.getX(vi), uvA.getY(vi));
                        for (const tex of allTextures(m)) {
                            const samp = getSampler(tex, this.imageDatas);
                            if (samp) col.multiply(samp(uvv));
                        }
                    }
                    allRGB.push(col.r, col.g, col.b);
                }
            }

            if (uvA) { for (let i=0; i<posA.count; ++i) uvs.push(uvA.getX(i), uvA.getY(i)); }
            else { for (let i=0; i<posA.count; ++i) uvs.push(0,0); }

            for (const grp of groups) {
                const m = meshMats[grp.materialIndex];
                if (!m) continue;
                const globalMatIdx = matMap.get(m);
                for (let i=grp.start; i<grp.start+grp.count; i+=3) {
                    indices.push(offset + i, offset + i + 1, offset + i + 2);
                    triMats.push(globalMatIdx);
                }
            }
            offset += posA.count;
            geoms.push(g);
        });
        
        if (geoms.length === 0) return { positions: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), triMats: new Uint32Array(), palette: new Float32Array(), materials: [] };
        
        const merged = mergeGeometries(geoms, false);
        return {
            positions: merged.attributes.position.array, uvs: new Float32Array(uvs),
            indices: new Uint32Array(indices), triMats: new Uint32Array(triMats),
            palette: kMeansPalette(new Float32Array(allRGB), this.paletteSize).palette,
            materials
        };
    }
    
    #cpuRasterize() {
        this.voxelTris = new Map();
        const dists = new Map();
        
        const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
        const triBox = new THREE.Box3();
        const voxelCenter = new THREE.Vector3();
        const gridMax = new THREE.Vector3().copy(this.grid).subScalar(1);
        
        // Temporary vectors for triangle-voxel intersection tests
        const tv0 = new THREE.Vector3(), tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3();
        const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const n = new THREE.Vector3();

        const numTriangles = this.indices.length / 3;
        for (let i = 0; i < numTriangles; i++) {
            v0.fromArray(this.positions, this.indices[i*3 + 0] * 3);
            v1.fromArray(this.positions, this.indices[i*3 + 1] * 3);
            v2.fromArray(this.positions, this.indices[i*3 + 2] * 3);

            // Triangle AABB in world space
            triBox.setFromPoints([v0, v1, v2]);
            // Expand slightly to be conservative
            triBox.expandByScalar(this.voxelSize * 1e-4);

            // Convert to voxel space
            const vMin = new THREE.Vector3().copy(triBox.min).sub(this.bbox.min).divideScalar(this.voxelSize).floor();
            const vMax = new THREE.Vector3().copy(triBox.max).sub(this.bbox.min).divideScalar(this.voxelSize).floor();

            vMin.clamp(new THREE.Vector3(0,0,0), gridMax);
            vMax.clamp(new THREE.Vector3(0,0,0), gridMax);
            
            // Triangle normal and edges (matching GPU version exactly)
            e0.subVectors(v1, v0);  // v1 - v0
            e1.subVectors(v2, v1);  // v2 - v1  
            e2.subVectors(v0, v2);  // v0 - v2
            n.crossVectors(e0, new THREE.Vector3().subVectors(v2, v0)); // cross(v1-v0, v2-v0)
            const nn = n.dot(n);
            if (nn < 1e-12) continue; // Degenerate triangle
            
            const absN = new THREE.Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
            const half = this.voxelSize * 0.5;

            for (let z = vMin.z; z <= vMax.z; z++) {
                for (let y = vMin.y; y <= vMax.y; y++) {
                    for (let x = vMin.x; x <= vMax.x; x++) {
                        // Voxel center in world space
                        voxelCenter.set(x + 0.5, y + 0.5, z + 0.5).multiplyScalar(this.voxelSize).add(this.bbox.min);
                        
                        // Translate triangle vertices relative to voxel center
                        tv0.subVectors(v0, voxelCenter);
                        tv1.subVectors(v1, voxelCenter);
                        tv2.subVectors(v2, voxelCenter);
                        
                        // 1) Separating axis test: triangle normal
                        const rP = half * (absN.x + absN.y + absN.z);
                        if (Math.abs(n.dot(tv0)) > rP) continue;
                        
                        // 2) Edge × axis tests (9 in total)
                        const testEdgeAxis = (edge, tv0, tv1, tv2, axisX, axisY, axisZ) => {
                            const axis = new THREE.Vector3();
                            axis.crossVectors(edge, new THREE.Vector3(axisX, axisY, axisZ));
                            // Skip if axis is too small (parallel edge and axis)
                            if (axis.lengthSq() < 1e-12) return true;
                            
                            const p0 = axis.dot(tv0);
                            const p1 = axis.dot(tv1);
                            const p2 = axis.dot(tv2);
                            const mn = Math.min(p0, Math.min(p1, p2));
                            const mx = Math.max(p0, Math.max(p1, p2));
                            const r = half * (Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z));
                            return !(mn > r || mx < -r);
                        };
                        
                        const edge0 = e0.clone();
                        const edge1 = e1.clone();
                        const edge2 = e2.clone();
                        
                        if (!testEdgeAxis(edge0, tv0, tv1, tv2, 1, 0, 0)) continue;
                        if (!testEdgeAxis(edge0, tv0, tv1, tv2, 0, 1, 0)) continue;
                        if (!testEdgeAxis(edge0, tv0, tv1, tv2, 0, 0, 1)) continue;
                        
                        if (!testEdgeAxis(edge1, tv0, tv1, tv2, 1, 0, 0)) continue;
                        if (!testEdgeAxis(edge1, tv0, tv1, tv2, 0, 1, 0)) continue;
                        if (!testEdgeAxis(edge1, tv0, tv1, tv2, 0, 0, 1)) continue;
                        
                        if (!testEdgeAxis(edge2, tv0, tv1, tv2, 1, 0, 0)) continue;
                        if (!testEdgeAxis(edge2, tv0, tv1, tv2, 0, 1, 0)) continue;
                        if (!testEdgeAxis(edge2, tv0, tv1, tv2, 0, 0, 1)) continue;
                        
                        // If we get here, the triangle intersects the voxel
                        const key = `${x},${y},${z}`;
                        const dist2 = (n.dot(tv0) * n.dot(tv0)) / nn;
                        
                        if (!dists.has(key) || dist2 < dists.get(key)) {
                            dists.set(key, dist2);
                            this.voxelTris.set(key, i);
                        }
                    }
                }
            }
        }
    }

    #buildMesh() {
        const voxelMap = new Map();
        const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
        const uv0 = new THREE.Vector2(), uv1 = new THREE.Vector2(), uv2 = new THREE.Vector2();
        const center = new THREE.Vector3(), uvp = new THREE.Vector2();
        const e0 = new THREE.Vector3(), e1 = new THREE.Vector3(), ep = new THREE.Vector3();

        for (const [key, triId] of this.voxelTris.entries()) {
            const [gx, gy, gz] = key.split(',').map(Number);
            center.set(gx + 0.5, gy + 0.5, gz + 0.5).multiplyScalar(this.voxelSize).add(this.bbox.min);
            
            const i0 = this.indices[triId*3], i1 = this.indices[triId*3+1], i2 = this.indices[triId*3+2];
            v0.fromArray(this.positions, i0 * 3); v1.fromArray(this.positions, i1 * 3); v2.fromArray(this.positions, i2 * 3);
            uv0.fromArray(this.uvs, i0 * 2); uv1.fromArray(this.uvs, i1 * 2); uv2.fromArray(this.uvs, i2 * 2);

            e0.subVectors(v1, v0); e1.subVectors(v2, v0); ep.subVectors(center, v0);
            const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1);
            const d20 = ep.dot(e0), d21 = ep.dot(e1);
            const denom = d00 * d11 - d01 * d01;

            if (Math.abs(denom) < 1e-9) continue; 

            const invDenom = 1.0 / denom;
            let v_bary = (d11 * d20 - d01 * d21) * invDenom;
            let w_bary = (d00 * d21 - d01 * d20) * invDenom;
            let u_bary = 1.0 - v_bary - w_bary;
            
            if (u_bary < 0 || v_bary < 0 || w_bary < 0) {
                const tri = new THREE.Triangle(v0, v1, v2);
                const closestPoint = tri.closestPointToPoint(center, new THREE.Vector3());
                ep.subVectors(closestPoint, v0);
                const d20c = ep.dot(e0), d21c = ep.dot(e1);
                v_bary = (d11 * d20c - d01 * d21c) * invDenom;
                w_bary = (d00 * d21c - d01 * d20c) * invDenom;
                u_bary = 1.0 - v_bary - w_bary;
            }
            uvp.set(0,0).addScaledVector(uv0, u_bary).addScaledVector(uv1, v_bary).addScaledVector(uv2, w_bary);

            const mat = this.materials[this.triMats[triId]] || this.materials[0];
            if (!mat) continue;

            let col = mat.color.clone();
            if (mat.emissive && mat.emissive.getHSL({ h: 0, s: 0, l: 0 }) > 0) col.add(mat.emissive);
            for (const tex of allTextures(mat)) {
                const s = getSampler(tex, this.imageDatas);
                if (s) col.multiply(s(uvp));
            }

            let best=0, bestD=Infinity;
            for (let c=0; c<this.paletteSize; ++c) {
                const dr=col.r-this.palette[c*3], dg=col.g-this.palette[c*3+1], db=col.b-this.palette[c*3+2];
                const d = dr*dr+dg*dg+db*db;
                if (d < bestD) { bestD = d; best = c; }
            }
            voxelMap.set(key, { x: gx, y: gy, z: gz, r: this.palette[best*3], g: this.palette[best*3+1], b: this.palette[best*3+2] });
        }
        
        this.voxelMap = voxelMap;
        this.filledVoxelCount = voxelMap.size;

        const faces = [
            { dir: [ 1, 0, 0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] }, { dir: [-1, 0, 0], v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
            { dir: [ 0, 1, 0], v: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] }, { dir: [ 0,-1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
            { dir: [ 0, 0, 1], v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] }, { dir: [ 0, 0,-1], v: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
        ];
        
        const hasVoxel = (x, y, z) => voxelMap.has(`${x},${y},${z}`);
        let faceCount = 0;
        for (const voxel of voxelMap.values()) {
            for (const face of faces) if (!hasVoxel(voxel.x+face.dir[0], voxel.y+face.dir[1], voxel.z+face.dir[2])) faceCount++;
        }
        
        const p = new Float32Array(faceCount * 12), c = new Float32Array(faceCount * 12), n = new Float32Array(faceCount * 12);
        const ind = new Uint32Array(faceCount * 6);
        let vOff = 0, iOff = 0, vIdx = 0;

        for (const voxel of voxelMap.values()) {
            const bx = this.bbox.min.x + voxel.x * this.voxelSize, by = this.bbox.min.y + voxel.y * this.voxelSize, bz = this.bbox.min.z + voxel.z * this.voxelSize;
            for (const face of faces) {
                if (!hasVoxel(voxel.x + face.dir[0], voxel.y + face.dir[1], voxel.z + face.dir[2])) {
                    const norm = face.dir;
                    for (const vert of face.v) {
                        p[vOff*3+0] = bx + vert[0] * this.voxelSize; p[vOff*3+1] = by + vert[1] * this.voxelSize; p[vOff*3+2] = bz + vert[2] * this.voxelSize;
                        c[vOff*3+0] = voxel.r; c[vOff*3+1] = voxel.g; c[vOff*3+2] = voxel.b;
                        n[vOff*3+0] = norm[0]; n[vOff*3+1] = norm[1]; n[vOff*3+2] = norm[2];
                        vOff++;
                    }
                    ind[iOff++] = vIdx; ind[iOff++] = vIdx+1; ind[iOff++] = vIdx+2;
                    ind[iOff++] = vIdx; ind[iOff++] = vIdx+2; ind[iOff++] = vIdx+3;
                    vIdx += 4;
                }
            }
        }
        return { geometries: [{ positions: p, colors: c, normals: n, indices: ind }] };
    }
    
    #getVoxelGridData() {
        if (!this.voxelMap) return null;
        const { x: NX, y: NY, z: NZ } = this.grid;
        const tot = NX * NY * NZ;
        const voxelColors = new Float32Array(tot * 4);
        const voxelCounts = new Uint32Array(tot);
        const idxXYZ = (x,y,z) => x + NX * (y + NY * z);

        for (const [key, voxel] of this.voxelMap.entries()) {
            const i = idxXYZ(voxel.x, voxel.y, voxel.z);
            voxelCounts[i] = 1;
            voxelColors[i * 4 + 0] = voxel.r;
            voxelColors[i * 4 + 1] = voxel.g;
            voxelColors[i * 4 + 2] = voxel.b;
            voxelColors[i * 4 + 3] = 1.0;
        }
        return {
            gridSize: { x: NX, y: NY, z: NZ },
            unit: { x: this.voxelSize, y: this.voxelSize, z: this.voxelSize },
            bbox: { min: this.bbox.min, max: this.bbox.max },
            voxelColors: voxelColors,
            voxelCounts: voxelCounts
        };
    }
}

// --- Worker Entry Point ---
self.onmessage = async (event) => {
    try {
        const { modelData, resolution } = event.data;
        
        const bbox = new THREE.Box3(
            new THREE.Vector3().fromArray(modelData.bbox.min),
            new THREE.Vector3().fromArray(modelData.bbox.max)
        );
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const voxelSize = maxDim / resolution;

        const voxelizer = new WorkerVoxelizer();
        const result = await voxelizer.init({ modelData, voxelSize });
        
        const transferList = [
            result.voxelGrid.voxelColors.buffer,
            result.voxelGrid.voxelCounts.buffer,
        ];
        result.geometries.forEach(g => {
            transferList.push(g.positions.buffer, g.colors.buffer, g.normals.buffer, g.indices.buffer);
        });

        self.postMessage({ status: 'success', result }, transferList);
    } catch (error) {
        console.error('Error in voxelizer worker:', error);
        self.postMessage({ status: 'error', message: error.message, stack: error.stack });
    }
};