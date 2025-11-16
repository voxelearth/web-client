/* exportToSchematic.js */
import { Schematic }  from 'prismarine-schematic';
import mcData         from 'minecraft-data';
import { saveAs }     from 'file-saver';

export async function exportToSchematic(denseGrid, mcVersion = '1.20') {
  if (!denseGrid) throw new Error('exportToSchematic: grid required');
  const size = denseGrid.size;
  const total = size.x * size.y * size.z;

  // Sponge v3 wants blocks ordered Y-Z-X.
  const toIndex = (x, y, z) => y * size.z * size.x + z * size.x + x;

  const mcd   = mcData(mcVersion);
  const idFor = name => mcd.blocksByName[name]?.defaultState ?? mcd.blocksByName.air.defaultState;

  const palette      = [];                   // array of stateIds
  const paletteIndex = new Map();            // blockName → palette slot
  const blocks       = new Uint16Array(total);
  const normalizeName = (name) => {
    if (!name) return 'air';
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  };

  const airSlot = 0;
  palette.push(idFor('air'));                // palette[0] = air
  paletteIndex.set('air', airSlot);

  const addToPalette = name => {
    const key = normalizeName(name);
    if (paletteIndex.has(key)) return paletteIndex.get(key);
    const idx = palette.push(idFor(key)) - 1;
    paletteIndex.set(key, idx);
    return idx;
  };

  const paletteNames = denseGrid.palette || [];
  const data = denseGrid.data;
  if (!data) throw new Error('exportToSchematic: dense grid missing data');

  for (let x = 0; x < size.x; x++)
    for (let y = 0; y < size.y; y++)
      for (let z = 0; z < size.z; z++) {
        const vIdx = x + size.x * (y + size.y * z);
        const paletteIdx = data[vIdx];
        const blkName  = paletteIdx >= 0 ? paletteNames[paletteIdx] : 'air';
        blocks[toIndex(x, y, z)] = addToPalette(blkName || 'air');
      }

  // Assemble and write the schematic
  const schem = new Schematic(mcVersion, size, { x: 0, y: 0, z: 0 }, palette, blocks);
  const buffer = await schem.write();        // gzipped NBT

  saveAs(new Blob([buffer]), 'model.schem'); // triggers download in browser
}
