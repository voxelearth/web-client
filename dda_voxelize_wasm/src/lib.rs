use dda_voxelize::{DdaVoxelizer, VoxelPosition};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[derive(Clone, Copy, Default)]
struct ColorAccum {
    rgb: [f32; 3],
    weight: f32,
}

impl ColorAccum {
    fn add_sample(&mut self, c: [f32; 3]) {
        self.rgb[0] += c[0];
        self.rgb[1] += c[1];
        self.rgb[2] += c[2];
        self.weight += 1.0;
    }

    fn to_u8_rgb(&self) -> [u8; 3] {
        if self.weight <= 0.0 {
            return [255, 255, 255];
        }
        let inv = 1.0 / self.weight;
        let r_lin = (self.rgb[0] * inv).clamp(0.0, 1.0);
        let g_lin = (self.rgb[1] * inv).clamp(0.0, 1.0);
        let b_lin = (self.rgb[2] * inv).clamp(0.0, 1.0);

        let r_srgb = linear_to_srgb(r_lin);
        let g_srgb = linear_to_srgb(g_lin);
        let b_srgb = linear_to_srgb(b_lin);

        [
            (r_srgb * 255.0).round() as u8,
            (g_srgb * 255.0).round() as u8,
            (b_srgb * 255.0).round() as u8,
        ]
    }
}

#[wasm_bindgen]
pub struct VoxelizationResult {
    positions: Vec<i32>,
    colors: Vec<u8>,
}

#[wasm_bindgen]
impl VoxelizationResult {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<i32> {
        self.positions.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn colors(&self) -> Vec<u8> {
        self.colors.clone()
    }
}

#[wasm_bindgen]
pub fn voxelize_mesh(vertices: &[f32], indices: &[u32], voxel_size: f32) -> VoxelizationResult {
    voxelize_mesh_with_vertex_colors(vertices, indices, &[], voxel_size)
}

#[wasm_bindgen]
pub fn voxelize_mesh_with_vertex_colors(
    vertices: &[f32],
    indices: &[u32],
    vertex_colors: &[f32],
    voxel_size: f32,
) -> VoxelizationResult {
    emit_result(build_vertex_color_voxelizer(
        vertices,
        indices,
        vertex_colors,
        voxel_size,
    ))
}

#[wasm_bindgen]
pub fn voxelize_mesh_with_vertex_colors_packed(
    vertices: &[f32],
    indices: &[u32],
    vertex_colors: &[f32],
    voxel_size: f32,
    origin_x: i32,
    origin_y: i32,
    origin_z: i32,
    grid_x: u32,
    grid_y: u32,
    grid_z: u32,
) -> Vec<u32> {
    emit_packed_result(
        build_vertex_color_voxelizer(vertices, indices, vertex_colors, voxel_size),
        [origin_x, origin_y, origin_z],
        [grid_x, grid_y, grid_z],
    )
}

fn build_vertex_color_voxelizer(
    vertices: &[f32],
    indices: &[u32],
    vertex_colors: &[f32],
    voxel_size: f32,
) -> DdaVoxelizer<ColorAccum> {
    assert!(vertices.len() % 3 == 0, "vertices len must be multiple of 3");
    assert!(indices.len() % 3 == 0, "indices len must be multiple of 3");

    let vertex_count = vertices.len() / 3;
    let has_colors = vertex_colors.len() == vertex_count * 3;
    let scale = 1.0 / voxel_size.max(1e-6);

    let mut voxelizer: DdaVoxelizer<ColorAccum> = DdaVoxelizer::new();

    for tri in indices.chunks_exact(3) {
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        debug_assert!(i0 < vertex_count && i1 < vertex_count && i2 < vertex_count);

        let p0 = [
            vertices[3 * i0] * scale,
            vertices[3 * i0 + 1] * scale,
            vertices[3 * i0 + 2] * scale,
        ];
        let p1 = [
            vertices[3 * i1] * scale,
            vertices[3 * i1 + 1] * scale,
            vertices[3 * i1 + 2] * scale,
        ];
        let p2 = [
            vertices[3 * i2] * scale,
            vertices[3 * i2 + 1] * scale,
            vertices[3 * i2 + 2] * scale,
        ];
        let triangle = [p0, p1, p2];

        let tri_colors: [[f32; 3]; 3] = if has_colors {
            [
                [
                    vertex_colors[3 * i0],
                    vertex_colors[3 * i0 + 1],
                    vertex_colors[3 * i0 + 2],
                ],
                [
                    vertex_colors[3 * i1],
                    vertex_colors[3 * i1 + 1],
                    vertex_colors[3 * i1 + 2],
                ],
                [
                    vertex_colors[3 * i2],
                    vertex_colors[3 * i2 + 1],
                    vertex_colors[3 * i2 + 2],
                ],
            ]
        } else {
            [[1.0, 1.0, 1.0]; 3]
        };

        let shader = move |current: Option<&ColorAccum>,
                           _pos: VoxelPosition,
                           w: [f32; 3]|
              -> ColorAccum {
            let mut acc = current.copied().unwrap_or_default();
            let [w0, w1, w2] = w;

            let r = tri_colors[0][0] * w0 + tri_colors[1][0] * w1 + tri_colors[2][0] * w2;
            let g = tri_colors[0][1] * w0 + tri_colors[1][1] * w1 + tri_colors[2][1] * w2;
            let b = tri_colors[0][2] * w0 + tri_colors[1][2] * w1 + tri_colors[2][2] * w2;

            acc.add_sample([r, g, b]);
            acc
        };

        voxelizer.add_triangle(&triangle, &shader);
    }

    voxelizer
}

#[wasm_bindgen]
pub fn voxelize_mesh_with_uv_and_texture(
    vertices: &[f32],
    indices: &[u32],
    uvs: &[f32],
    texture: &[u8],
    tex_width: u32,
    tex_height: u32,
    voxel_size: f32,
) -> VoxelizationResult {
    voxelize_mesh_with_uv_and_texture_params(
        vertices,
        indices,
        uvs,
        texture,
        tex_width,
        tex_height,
        0.0,
        0.0,
        1.0,
        1.0,
        0.0,
        0.0,
        0.0,
        false,
        voxel_size,
    )
}

#[wasm_bindgen]
pub fn voxelize_mesh_with_uv_and_texture_params(
    vertices: &[f32],
    indices: &[u32],
    uvs: &[f32],
    texture: &[u8],
    tex_width: u32,
    tex_height: u32,
    offset_u: f32,
    offset_v: f32,
    repeat_u: f32,
    repeat_v: f32,
    rotation: f32,
    center_u: f32,
    center_v: f32,
    flip_y: bool,
    voxel_size: f32,
) -> VoxelizationResult {
    emit_result(build_textured_voxelizer(
        vertices,
        indices,
        uvs,
        texture,
        tex_width,
        tex_height,
        offset_u,
        offset_v,
        repeat_u,
        repeat_v,
        rotation,
        center_u,
        center_v,
        flip_y,
        voxel_size,
    ))
}

#[wasm_bindgen]
pub fn voxelize_mesh_with_uv_and_texture_params_packed(
    vertices: &[f32],
    indices: &[u32],
    uvs: &[f32],
    texture: &[u8],
    tex_width: u32,
    tex_height: u32,
    offset_u: f32,
    offset_v: f32,
    repeat_u: f32,
    repeat_v: f32,
    rotation: f32,
    center_u: f32,
    center_v: f32,
    flip_y: bool,
    voxel_size: f32,
    origin_x: i32,
    origin_y: i32,
    origin_z: i32,
    grid_x: u32,
    grid_y: u32,
    grid_z: u32,
) -> Vec<u32> {
    emit_packed_result(
        build_textured_voxelizer(
            vertices,
            indices,
            uvs,
            texture,
            tex_width,
            tex_height,
            offset_u,
            offset_v,
            repeat_u,
            repeat_v,
            rotation,
            center_u,
            center_v,
            flip_y,
            voxel_size,
        ),
        [origin_x, origin_y, origin_z],
        [grid_x, grid_y, grid_z],
    )
}

fn build_textured_voxelizer(
    vertices: &[f32],
    indices: &[u32],
    uvs: &[f32],
    texture: &[u8],
    tex_width: u32,
    tex_height: u32,
    offset_u: f32,
    offset_v: f32,
    repeat_u: f32,
    repeat_v: f32,
    rotation: f32,
    center_u: f32,
    center_v: f32,
    flip_y: bool,
    voxel_size: f32,
) -> DdaVoxelizer<ColorAccum> {
    assert!(vertices.len() % 3 == 0, "vertices len must be multiple of 3");
    assert!(indices.len() % 3 == 0, "indices len must be multiple of 3");

    let vertex_count = vertices.len() / 3;
    assert!(uvs.len() == vertex_count * 2, "uvs must be 2 * vertex_count");

    let expected_tex_len = tex_width as usize * tex_height as usize * 4;
    assert!(
        texture.len() == expected_tex_len,
        "texture must be width * height * 4 RGBA bytes"
    );

    let scale = 1.0 / voxel_size.max(1e-6);
    let mut voxelizer: DdaVoxelizer<ColorAccum> = DdaVoxelizer::new();

    for tri in indices.chunks_exact(3) {
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        let p0 = [
            vertices[3 * i0] * scale,
            vertices[3 * i0 + 1] * scale,
            vertices[3 * i0 + 2] * scale,
        ];
        let p1 = [
            vertices[3 * i1] * scale,
            vertices[3 * i1 + 1] * scale,
            vertices[3 * i1 + 2] * scale,
        ];
        let p2 = [
            vertices[3 * i2] * scale,
            vertices[3 * i2 + 1] * scale,
            vertices[3 * i2 + 2] * scale,
        ];
        let triangle = [p0, p1, p2];

        let t_p0 = p0;
        let t_p1 = p1;
        let t_p2 = p2;

        let uv0 = [uvs[2 * i0], uvs[2 * i0 + 1]];
        let uv1 = [uvs[2 * i1], uvs[2 * i1 + 1]];
        let uv2 = [uvs[2 * i2], uvs[2 * i2 + 1]];

        let shader = move |current: Option<&ColorAccum>,
                           pos: VoxelPosition,
                           _w: [f32; 3]|
              -> ColorAccum {
            let mut acc = current.copied().unwrap_or_default();
            let p = [pos[0] as f32 + 0.5, pos[1] as f32 + 0.5, pos[2] as f32 + 0.5];

            let (u_b, v_b, w_b) = barycentric(t_p0, t_p1, t_p2, p);
            let u_raw = uv0[0] * u_b + uv1[0] * v_b + uv2[0] * w_b;
            let v_raw = uv0[1] * u_b + uv1[1] * v_b + uv2[1] * w_b;

            let sample = sample_texture_rgba_with_transform_bilinear(
                texture,
                tex_width,
                tex_height,
                [u_raw, v_raw],
                offset_u,
                offset_v,
                repeat_u,
                repeat_v,
                rotation,
                center_u,
                center_v,
                flip_y,
            );
            acc.add_sample(sample);
            acc
        };

        voxelizer.add_triangle(&triangle, &shader);
    }

    voxelizer
}

fn emit_result(voxelizer: DdaVoxelizer<ColorAccum>) -> VoxelizationResult {
    let voxels_map = voxelizer.finalize();

    let mut positions = Vec::with_capacity(voxels_map.len() * 3);
    let mut colors = Vec::with_capacity(voxels_map.len() * 3);

    for (pos, acc) in voxels_map {
        positions.extend_from_slice(&pos);
        let rgb = acc.to_u8_rgb();
        colors.extend_from_slice(&rgb);
    }

    VoxelizationResult { positions, colors }
}

fn emit_packed_result(
    voxelizer: DdaVoxelizer<ColorAccum>,
    origin: [i32; 3],
    grid: [u32; 3],
) -> Vec<u32> {
    let voxels_map = voxelizer.finalize();
    let grid_x = grid[0] as u64;
    let grid_y = grid[1] as u64;
    let grid_z = grid[2] as u64;
    let mut packed = Vec::with_capacity(voxels_map.len() * 2);

    for (pos, acc) in voxels_map {
        let lx = pos[0] - origin[0];
        let ly = pos[1] - origin[1];
        let lz = pos[2] - origin[2];
        if lx < 0 || ly < 0 || lz < 0 {
            continue;
        }

        let lx = lx as u64;
        let ly = ly as u64;
        let lz = lz as u64;
        if lx >= grid_x || ly >= grid_y || lz >= grid_z {
            continue;
        }

        let linear_index = lx + grid_x * (ly + grid_y * lz);
        if linear_index > u32::MAX as u64 {
            continue;
        }

        let rgb = acc.to_u8_rgb();
        let packed_rgb = rgb[0] as u32 | ((rgb[1] as u32) << 8) | ((rgb[2] as u32) << 16);

        packed.push(linear_index as u32);
        packed.push(packed_rgb);
    }

    packed
}

#[wasm_bindgen]
pub fn rasterize_mesh_2d5_packed(
    positions: &[f32],
    indices: &[u32],
    bbox_min_x: f32,
    bbox_min_y: f32,
    bbox_min_z: f32,
    voxel_size: f32,
    grid_x: u32,
    grid_y: u32,
    grid_z: u32,
    dense_threshold: u32,
) -> Vec<u32> {
    assert!(positions.len() % 3 == 0, "positions len must be multiple of 3");
    assert!(indices.len() % 3 == 0, "indices len must be multiple of 3");

    let nx = grid_x as i32;
    let ny = grid_y as i32;
    let nz = grid_z as i32;
    let total = grid_x as usize * grid_y as usize * grid_z as usize;
    let inv_vs = 1.0 / voxel_size.max(1e-6);

    let mut p_vox = Vec::with_capacity(positions.len());
    for i in (0..positions.len()).step_by(3) {
        p_vox.push((positions[i] - bbox_min_x) * inv_vs);
        p_vox.push((positions[i + 1] - bbox_min_y) * inv_vs);
        p_vox.push((positions[i + 2] - bbox_min_z) * inv_vs);
    }

    if total <= dense_threshold as usize {
        let mut hit_tris = vec![-1i32; total];
        let mut hit_dist2 = vec![f32::INFINITY; total];

        rasterize_2d5_inner(&p_vox, indices, nx, ny, nz, |lin, tri, dist2| {
            if hit_tris[lin] == -1 || dist2 < hit_dist2[lin] {
                hit_tris[lin] = tri as i32;
                hit_dist2[lin] = dist2;
            }
        });

        let mut packed = Vec::new();
        packed.reserve(total.min(indices.len()) * 2);
        for (lin, tri) in hit_tris.iter().enumerate() {
            if *tri >= 0 {
                packed.push(lin as u32);
                packed.push(*tri as u32);
            }
        }
        packed
    } else {
        let mut hits: HashMap<u32, (u32, f32)> = HashMap::new();

        rasterize_2d5_inner(&p_vox, indices, nx, ny, nz, |lin, tri, dist2| {
            let key = lin as u32;
            match hits.get_mut(&key) {
                Some((prev_tri, prev_dist2)) => {
                    if dist2 < *prev_dist2 {
                        *prev_tri = tri;
                        *prev_dist2 = dist2;
                    }
                }
                None => {
                    hits.insert(key, (tri, dist2));
                }
            }
        });

        let mut packed = Vec::with_capacity(hits.len() * 2);
        for (lin, (tri, _dist2)) in hits {
            packed.push(lin);
            packed.push(tri);
        }
        packed
    }
}

fn rasterize_2d5_inner<F>(
    p_vox: &[f32],
    indices: &[u32],
    nx: i32,
    ny: i32,
    nz: i32,
    mut set_hit: F,
) where
    F: FnMut(usize, u32, f32),
{
    let tri_count = indices.len() / 3;

    for tri_idx in 0..tri_count {
        let i0 = indices[tri_idx * 3] as usize;
        let i1 = indices[tri_idx * 3 + 1] as usize;
        let i2 = indices[tri_idx * 3 + 2] as usize;

        let x0 = p_vox[i0 * 3];
        let y0 = p_vox[i0 * 3 + 1];
        let z0 = p_vox[i0 * 3 + 2];
        let x1 = p_vox[i1 * 3];
        let y1 = p_vox[i1 * 3 + 1];
        let z1 = p_vox[i1 * 3 + 2];
        let x2 = p_vox[i2 * 3];
        let y2 = p_vox[i2 * 3 + 1];
        let z2 = p_vox[i2 * 3 + 2];

        let e10x = x1 - x0;
        let e10y = y1 - y0;
        let e10z = z1 - z0;
        let e20x = x2 - x0;
        let e20y = y2 - y0;
        let e20z = z2 - z0;
        let nx_n = e10y * e20z - e10z * e20y;
        let ny_n = e10z * e20x - e10x * e20z;
        let nz_n = e10x * e20y - e10y * e20x;
        let abx = nx_n.abs();
        let aby = ny_n.abs();
        let abz = nz_n.abs();
        let nn = nx_n * nx_n + ny_n * ny_n + nz_n * nz_n;
        if nn < 1e-12 {
            continue;
        }

        let (w_axis, u_axis, v_axis) = if abx >= aby && abx >= abz {
            (0usize, 1usize, 2usize)
        } else if aby >= abx && aby >= abz {
            (1usize, 2usize, 0usize)
        } else {
            (2usize, 0usize, 1usize)
        };

        let u0 = axis_component(u_axis, x0, y0, z0);
        let v0 = axis_component(v_axis, x0, y0, z0);
        let w0 = axis_component(w_axis, x0, y0, z0);
        let u1 = axis_component(u_axis, x1, y1, z1);
        let v1 = axis_component(v_axis, x1, y1, z1);
        let w1 = axis_component(w_axis, x1, y1, z1);
        let u2 = axis_component(u_axis, x2, y2, z2);
        let v2 = axis_component(v_axis, x2, y2, z2);
        let w2 = axis_component(w_axis, x2, y2, z2);

        let denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
        if denom.abs() < 1e-12 {
            continue;
        }
        let inv_den = 1.0 / denom;
        let d_l0_du = (v1 - v2) * inv_den;
        let d_l1_du = (v2 - v0) * inv_den;

        let u_limit = axis_limit(u_axis, nx, ny, nz) - 1;
        let v_limit = axis_limit(v_axis, nx, ny, nz) - 1;
        let w_limit = axis_limit(w_axis, nx, ny, nz);
        let u_min = clamp_i32(min3(u0, u1, u2).floor() as i32, 0, u_limit);
        let v_min = clamp_i32(min3(v0, v1, v2).floor() as i32, 0, v_limit);
        let u_max = clamp_i32(max3(u0, u1, u2).floor() as i32, 0, u_limit);
        let v_max = clamp_i32(max3(v0, v1, v2).floor() as i32, 0, v_limit);
        if u_min > u_max || v_min > v_max {
            continue;
        }

        let n_w = axis_component(w_axis, nx_n, ny_n, nz_n);
        let dist_scale = (n_w * n_w) / nn;
        let eps = 1e-6f32;

        for v in v_min..=v_max {
            let uu0 = u_min as f32 + 0.5;
            let vv0 = v as f32 + 0.5;
            let mut l0 = ((v1 - v2) * (uu0 - u2) + (u2 - u1) * (vv0 - v2)) * inv_den;
            let mut l1 = ((v2 - v0) * (uu0 - u2) + (u0 - u2) * (vv0 - v2)) * inv_den;
            let mut l2 = 1.0 - l0 - l1;
            let mut w = l0 * w0 + l1 * w1 + l2 * w2;
            let d_w_du = d_l0_du * w0 + d_l1_du * w1 - (d_l0_du + d_l1_du) * w2;

            for u in u_min..=u_max {
                if l0 >= -eps && l1 >= -eps && l2 >= -eps {
                    let w_idx = w.floor() as i32;
                    if w_idx >= 0 && w_idx < w_limit {
                        let delta = w - (w_idx as f32 + 0.5);
                        let d2 = delta * delta * dist_scale;
                        let (x, y, z) = map_axes(w_axis, u, v, w_idx);
                        let lin = index_1d(x, y, z, nx, ny);
                        set_hit(lin, tri_idx as u32, d2);
                    }

                    let frac = w - w.floor();
                    if frac < 0.15 || frac > 0.85 {
                        let w2_idx = if (w - (w_idx as f32 + 0.5)) < 0.0 {
                            w_idx - 1
                        } else {
                            w_idx + 1
                        };
                        if w2_idx >= 0 && w2_idx < w_limit {
                            let (x2, y2, z2) = map_axes(w_axis, u, v, w2_idx);
                            let lin2 = index_1d(x2, y2, z2, nx, ny);
                            let delta2 = w - (w2_idx as f32 + 0.5);
                            set_hit(lin2, tri_idx as u32, delta2 * delta2 * dist_scale);
                        }
                    }
                }

                l0 += d_l0_du;
                l1 += d_l1_du;
                l2 = 1.0 - l0 - l1;
                w += d_w_du;
            }
        }
    }
}

fn axis_component(axis: usize, x: f32, y: f32, z: f32) -> f32 {
    match axis {
        0 => x,
        1 => y,
        _ => z,
    }
}

fn axis_limit(axis: usize, nx: i32, ny: i32, nz: i32) -> i32 {
    match axis {
        0 => nx,
        1 => ny,
        _ => nz,
    }
}

fn map_axes(w_axis: usize, u: i32, v: i32, w: i32) -> (i32, i32, i32) {
    match w_axis {
        2 => (u, v, w),
        1 => (v, w, u),
        _ => (w, u, v),
    }
}

fn index_1d(x: i32, y: i32, z: i32, nx: i32, ny: i32) -> usize {
    (x + nx * (y + ny * z)) as usize
}

fn min3(a: f32, b: f32, c: f32) -> f32 {
    a.min(b).min(c)
}

fn max3(a: f32, b: f32, c: f32) -> f32 {
    a.max(b).max(c)
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn barycentric(p0: [f32; 3], p1: [f32; 3], p2: [f32; 3], p: [f32; 3]) -> (f32, f32, f32) {
    let v0 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let v1 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let v2 = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];

    let d00 = dot(v0, v0);
    let d01 = dot(v0, v1);
    let d11 = dot(v1, v1);
    let d20 = dot(v2, v0);
    let d21 = dot(v2, v1);
    let denom = d00 * d11 - d01 * d01;

    if denom.abs() < 1e-8 {
        return (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0);
    }

    let inv_denom = 1.0 / denom;
    let v = (d11 * d20 - d01 * d21) * inv_denom;
    let w = (d00 * d21 - d01 * d20) * inv_denom;
    let u = 1.0 - v - w;

    (u, v, w)
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn srgb_to_linear(x: f32) -> f32 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(x: f32) -> f32 {
    if x <= 0.0031308 {
        x * 12.92
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

fn sample_texture_rgba_with_transform_bilinear(
    tex: &[u8],
    width: u32,
    height: u32,
    uv: [f32; 2],
    offset_u: f32,
    offset_v: f32,
    repeat_u: f32,
    repeat_v: f32,
    rotation: f32,
    center_u: f32,
    center_v: f32,
    flip_y: bool,
) -> [f32; 3] {
    let w = width as usize;
    let h = height as usize;

    let mut u = uv[0] * repeat_u + offset_u;
    let mut v = uv[1] * repeat_v + offset_v;

    if rotation != 0.0 {
        let cu = center_u;
        let cv = center_v;
        u -= cu;
        v -= cv;
        let cos_r = rotation.cos();
        let sin_r = rotation.sin();
        let u2 = u * cos_r - v * sin_r;
        let v2 = u * sin_r + v * cos_r;
        u = u2 + cu;
        v = v2 + cv;
    }

    u = u.clamp(0.0, 1.0);
    v = v.clamp(0.0, 1.0);

    if flip_y {
        v = 1.0 - v;
    }

    let x = u * (w as f32 - 1.0);
    let y = v * (h as f32 - 1.0);

    let x0 = x.floor().max(0.0) as usize;
    let y0 = y.floor().max(0.0) as usize;
    let x1 = x0.saturating_add(1).min(w - 1);
    let y1 = y0.saturating_add(1).min(h - 1);

    let tx = x - x0 as f32;
    let ty = y - y0 as f32;

    let sample = |ix: usize, iy: usize| -> [f32; 4] {
        let idx = (iy * w + ix) * 4;
        let r_s = tex[idx] as f32 / 255.0;
        let g_s = tex[idx + 1] as f32 / 255.0;
        let b_s = tex[idx + 2] as f32 / 255.0;
        let a = tex[idx + 3] as f32 / 255.0;
        let r_l = srgb_to_linear(r_s);
        let g_l = srgb_to_linear(g_s);
        let b_l = srgb_to_linear(b_s);
        [r_l, g_l, b_l, a]
    };

    let c00 = sample(x0, y0);
    let c10 = sample(x1, y0);
    let c01 = sample(x0, y1);
    let c11 = sample(x1, y1);

    let w00 = (1.0 - tx) * (1.0 - ty);
    let w10 = tx * (1.0 - ty);
    let w01 = (1.0 - tx) * ty;
    let w11 = tx * ty;

    let mut a_acc = 0.0;
    let mut r_acc = 0.0;
    let mut g_acc = 0.0;
    let mut b_acc = 0.0;

    for (c, wgt) in [c00, c10, c01, c11].into_iter().zip([w00, w10, w01, w11]) {
        let a = c[3] * wgt;
        if a > 0.0 {
            r_acc += c[0] * a;
            g_acc += c[1] * a;
            b_acc += c[2] * a;
            a_acc += a;
        }
    }

    if a_acc > 1e-5 {
        [r_acc / a_acc, g_acc / a_acc, b_acc / a_acc]
    } else {
        [0.0, 0.0, 0.0]
    }
}
