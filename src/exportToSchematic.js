/* exportToSchematic.js */
import { Schematic }  from 'prismarine-schematic';
import mcData         from 'minecraft-data';
import { saveAs }     from 'file-saver';

export async function exportToSchematic(voxelGrid, BLOCKS, mcVersion = '1.20') {
  const size = voxelGrid.gridSize;                 // THREE.Vector3 {x,y,z}
  const total = size.x * size.y * size.z;

  // Sponge v3 wants blocks ordered Y-Z-X.
  const toIndex = (x, y, z) => y * size.z * size.x + z * size.x + x;

  const mcd   = mcData(mcVersion);
  const idFor = name => mcd.blocksByName[name]?.defaultState ?? mcd.blocksByName.air.defaultState;

  const palette      = [];                   // array of stateIds
  const paletteIndex = new Map();            // blockName → palette slot
  const blocks       = new Uint16Array(total);

  const airSlot = 0;
  palette.push(idFor('air'));                // palette[0] = air
  paletteIndex.set('air', airSlot);

  const addToPalette = name => {
    if (paletteIndex.has(name)) return paletteIndex.get(name);
    const idx = palette.push(idFor(name)) - 1;
    paletteIndex.set(name, idx);
    return idx;
  };

  const { assigned } = voxelGrid;            // Int32Array of block indices
  for (let x = 0; x < size.x; x++)
    for (let y = 0; y < size.y; y++)
      for (let z = 0; z < size.z; z++) {
        const vIdx = x + size.x * (y + size.y * z);
        const blk  = assigned[vIdx] >= 0 ? BLOCKS[assigned[vIdx]].name : 'air';
        blocks[toIndex(x, y, z)] = addToPalette(blk);
      }

  // Assemble and write the schematic
  const schem = new Schematic(mcVersion, size, { x: 0, y: 0, z: 0 }, palette, blocks);
  const buffer = await schem.write();        // gzipped NBT

  saveAs(new Blob([buffer]), 'model.schem'); // triggers download in browser
}
