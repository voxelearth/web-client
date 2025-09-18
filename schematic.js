'use strict';

var _window = this;

class Schematic {

	constructor(xSize, ySize, zSize, blocks, data) {
		this.create(xSize, ySize, zSize, blocks, data);
	}
	create(xSize, ySize, zSize, blocks, data) {
		if (!xSize || !ySize || !zSize) xSize = ySize = zSize = 1;
		this.x = xSize;
		this.y = ySize;
		this.z = zSize;
        this.history = new Cubical.Lib.EditHistory();
		this.inUse = false;
		this.asset = null;
        this.previewImage = null;
        this.playerLocation = null;
        this.entities = [];
        this.blockEntities = [];
        this.blockTickSpeed = 0; // default is ~3
		
        if (!this.fileInfo) this.setInfo();
		this.offset = [0,0,0];
		
		if (typeof blocks === 'object' && typeof data === 'object') {
			this.blocks = blocks;
			this.data = data;		
		}
		else {
			this.blocks = new Uint8Array(xSize * ySize * zSize);
			this.data = new Uint8Array(xSize * ySize * zSize);				
		}
		return this;

	}
	setBlock(x, y, z, id, data, doUpdate = true, updateNetwork = true) {
		x = Math.floor(x);
		y = Math.floor(y);
		z = Math.floor(z);
		id = Math.floor(id);
		data = Math.floor(data);
		
        if (x < 0 || y < 0 || z < 0 || x >= this.x || y >= this.y || z >= this.z) return;
		
        const i = this.coordToIndex(x, y, z);
		
		this.blocks[i] = id;
		this.data[i] = data;
		
        if (this.mask instanceof Cubical.Lib.VoxelBitMask) {
            this.mask.setBit(x, y, z, true, i);
        }
        
		if(this.inUse == false) return;
		if (doUpdate && Game) {
			Game.scene.onBlockChange(x,y,z);
			if(updateNetwork) Game.network.sendPacket({id: "set_block", block: [x, y, z, id, data]});
		}
	}
	setBlockArea(blocks, doUpdate, updateNetwork = true) {
		doUpdate = typeof doUpdate == 'undefined' ? true : doUpdate;
		var x,y,z,id,data, ii;
        const hasMask = this.mask instanceof Cubical.Lib.VoxelBitMask;
        
		for (var i = 0; i < blocks.length; i += 5) {
			x = blocks[i];
			y = blocks[i + 1];
			z = blocks[i + 2];
			id = blocks[i + 3];
			data = blocks[i + 4];
			
            if (x < 0 || y < 0 || z < 0 || x >= this.x || y >= this.y || z >= this.z) continue;
			ii = this.coordToIndex(x, y, z);
			
			this.blocks[ii] = id;
			this.data[ii] = data;

            if (hasMask) {
                this.mask.setBit(x, y, z, true, ii);
            }
            
			if(doUpdate && Game) Game.scene.onBlockChange(x,y,z);
		}
		
		if(this.inUse == false) return;
		if (doUpdate && Game) {
			if(updateNetwork) Game.network.sendPacket({id: "set_block_area", blocks: blocks});
		}
	}
	setBlockCache(toggle, x, y, z, id, data) {
		if(toggle) {
			if(this.caching) {
				this.caching = false;
				this.setBlockArea(this.cache, true, true);
                this.cache = [];
			}
			else {
				this.caching = true;
				this.cache = [];
			}
		}
		else {
			this.cache.push(x, y, z, id, data);
		}
	}
	getBlock(x, y, z) {
		x = Math.floor(x);
		y = Math.floor(y);
		z = Math.floor(z);
		if (!this.checkCoords(x,y,z)) return false; 
		
		var i = this.coordToIndex(x, y, z);
		var id = this.blocks[i];
		var data = this.data[i];
		
		return {id: id, data: data};

	}
	getBlockId(x, y, z) {
		return this.checkCoords(x,y,z) ? this.blocks[this.coordToIndex(x, y, z)] : 0;
	}
	getBlockData(x, y, z) {
		return this.checkCoords(x,y,z) ? this.data[this.coordToIndex(x, y, z)] : 0;
	}	
	getSize() {			
		return {x: this.x, y: this.y, z: this.z };
	}
	getOffset() {
		return this.offset;
	}
	getInfo() {
		if (typeof this.fileInfo == 'undefined') this.setInfo();
		return this.fileInfo;
	}
	setInfo(fInfo) {
		if (!fInfo) {
            this.fileInfo = {
                file: null,
                ext: "sch",
                name: "New Schematic",
                type: "sch",
                data: null,
                externalSource: false,
                externalType: null,
                extra: {
                    version: (typeof Game !== 'undefined' ? Game.version : '1.2.6'), // Fix this to use the real game version - not setup in workers atm
                    author: "Guest"
                }
            };
        }
		else this.fileInfo = fInfo;
	}
	getName() {
		var name = "NewSchematic";
		if(this.nbt && this.nbt.root.getChild("Cubical")) {
			name = this.nbt.root.getChild("Cubical").getChild("File").getChildValue("Name");
		}
		else if(this.getInfo().name) {
			name = this.getInfo().name;
		}
		return name;
	}
	setName(name) {
		if (!this.fileInfo) this.setInfo(null);
        
        this.fileInfo.name = name;
		
        if(this.nbt && this.nbt.root.getChild("Cubical")) {
			const nameTag = this.nbt.root.getChild("Cubical").getChild("File").getChild("Name");
            nameTag.setValue(name);
		}
        
        return this;
	}
	getAuthor() {
		var author = "Guest";
		if (this.nbt && this.nbt.root.getChild("Cubical")) {
			author = this.nbt.root.getChild("Cubical").getChild("File").getChildValue("Author");
		}
		else if (this.fileInfo && this.fileInfo.extra && this.fileInfo.extra.author) {
			author = this.fileInfo.extra.author;
		}
        
		return author;
	}
	setAuthor(author) {
        if (!this.fileInfo) this.setInfo(null);
        
        if (!this.fileInfo.extra) this.fileInfo.extra = {};
        this.fileInfo.extra.author = author;

		if (this.nbt && this.nbt.root.getChild("Cubical")) {
			const authorTag = this.nbt.root.getChild("Cubical").getChild("File").getChild("Author");
            authorTag.setValue(author);
		}
	}
    getFile() {
        return this.fileInfo.file;
    }
    setFile(file) {
        this.fileInfo.file = file;
        if (file.name) this.setName(file.name);
        
        return this;
    }
    
    getSpawn() {
		
		if(!(this.fileInfo.extra && this.fileInfo.extra.spawnX)) return null;
		
		var spawn = {
			x: parseFloat(this.fileInfo.extra.spawnX),
			y: parseFloat(this.fileInfo.extra.spawnY),
			z: parseFloat(this.fileInfo.extra.spawnZ),
			yaw: parseFloat(this.fileInfo.extra.playerYaw),
			pitch: parseFloat(this.fileInfo.extra.playerPitch)
		};
		
		return spawn;
		
	}
	setSpawn(x, y, z, yaw, pitch, flying = true) {
		if (!this.fileInfo.extra) this.fileInfo.extra = {};

		this.fileInfo.extra.spawnX = parseFloat(x);
		this.fileInfo.extra.spawnY = parseFloat(y);
		this.fileInfo.extra.spawnZ = parseFloat(z);	
		this.fileInfo.extra.playerYaw = parseFloat(yaw);
		this.fileInfo.extra.playerPitch = parseFloat(pitch);
        this.fileInfo.extra.flying = flying;
	}	
	
    iterate(callback) {
		callback = callback.bind(this);
		const s = this.getSize();
		
        for (let x = 0; x < s.x; x++) {
			for (let y = 0; y < s.y; y++) {
				for (let z = 0; z < s.z; z++) {
					if (callback(x,y,z) === false) return;
				}
			}
		}
	}
	indexToCoord(index) {
	
		var cnt = 0;
		var y = Math.floor(index / (this.x * this.z));
		cnt += y * (this.x * this.z);
		var z = Math.floor((index - cnt) / this.x);
		cnt += z * this.x;
		var x = index - cnt;
		
		return {x: x, y: y, z: z};
	}
	coordToIndex(x, y, z) {
		//if (!this.checkCoords(x,y,z)) return false; 
		return (y * (this.x * this.z)) + (z * this.x) + x;
	}
	checkCoords(x, y, z) {
		if (x < 0 || x >= this.x || y < 0 || y >= this.y || z < 0 || z >= this.z) return false; 
		return true;
	}
	hasChunkData(cx, cy, cz){
        const chunkSize = 16;       
        return this.checkCoords(cx * chunkSize, cy * chunkSize, cz * chunkSize)
    }
	getChunkBounds() {
        return [[0, 0, 0], [this.x >> 4, this.y >> 4, this.z >> 4]];
    }
    buildBlob(type, callback, onProgress) {

		var hex,bytes,zip;
		
		if (!callback) {
		
			if (type == 'png') {
				return this.buildImageFile();
			}
			else if (type == 'shp') {
				hex = this.buildShpFile();
				return new Blob([hex], {type: "application/octet-stream"});
			}
			else if (type == 'bo2') {
				hex = this.buildBo2File();
				return new Blob([hex], {type: "application/octet-stream"});
			}			
			else if (type == 'sch' || type == 'schematic') {
				bytes = this.buildSchematicFile();
				zip = Minecraft.util.gzipCompress(bytes);
				return new Blob([zip], {type: "application/octet-stream"});
			}
			else if (type == 'txt') {
				hex = this.buildSetBlockFile();
				return new Blob([hex], {type: "application/octet-stream"});
			}
			else if (type == 'bvm') {
				bytes = this.buildVoxelMapFile();
				return new Blob([bytes], {type: "application/octet-stream"});
			}
			else if (type == 'nbt') {
				bytes = this.buildStructureFile();
				zip = Minecraft.util.gzipCompress(bytes);
				return new Blob([zip], {type: "application/octet-stream"});
			}	
			else {
				return null;
			}
		}
		else {
			if (type == 'png') {
				callback(this.buildImageFile());
			}
			else if (type == 'shp') {
				hex = this.buildShpFile();
				callback(new Blob([hex], {type: "application/octet-stream"}));
			}
			else if (type == 'bo2') {
				hex = this.buildBo2File();
				callback(new Blob([hex], {type: "application/octet-stream"}));
			}			
			else if (type == 'sch' || type == 'schematic') {
				bytes = this.buildSchematicFile();
				Game.worker.createRequest("ZipFileData",  {transfer:[bytes.buffer]}, function(e) {
					var data = [new Uint8Array(e.response.transfer[0])];
                    callback(new Blob(data, {type: "application/octet-stream"}));
				});
			}
			else if (type == 'txt') {
				hex = this.buildSetBlockFile();
				callback(new Blob([hex], {type: "application/octet-stream"}));
			}
			else if (type == 'bvm') {
				bytes = this.buildVoxelMapFile();
				callback(new Blob([bytes], {type: "application/octet-stream"}));
			}
			else if (type == 'nbt') {
				this.buildStructureFile(onProgress).then((res, err) => {
                    Game.worker.createRequest("ZipFileData",  {transfer:[res.buffer]}, function(e) {
                        var data = [new Uint8Array(e.response.transfer[0])];
                        callback(new Blob(data, {type: "application/octet-stream"}));
                    });
                });

			}	
			else {
				callback(null);
			}
		}
		
	}
	buildSchematicFile() {
		this.updateNbt(true);
		return new Uint8Array(this.nbt.data.buffer);
	}
	buildBo2File() {
		
		// bo2 format ref
		// http://dev.bukkit.org/bukkit-plugins/terrain-control/pages/bo2-specefication/r2/source/
		
		var bl, bo2 = '[META]\nversion=2.0\nspawnSunlight=True\nspawnDarkness=True\n' +
			'spawnWater=False\nspawnLava=False\nunderFill=False\nrandomRotation=True\n' +
			'dig=True\ntree=False\nbranch=False\nneedsFoundation=True\nrarity=30\n' +
			'collisionPercentage=5\nspawnElevationMin=0\nspawnElevationMax=200\n' +
			'branchLimit=6\nspawnInBiome=All\n[DATA]\n';
	
		this.iterate(function(x,y,z) {
			bl = this.getBlock(x,y,z);
			if (bl.id != 0) {
				bo2 += (x + ',' + z + ',' + y + ':' + bl.id + (bl.data == 0 ? '' : '.' + bl.data) + '\n');
			}
		});

		return bo2;
	
	}
	buildShpFile() {
	
		// '|0:0@1,1,-2|0:0@1,1,-1|67:0@1,1,';	shp format  - block id, data, x, y, z
		var bl,shp = '^0^#0,0,0#|';
		
		this.iterate(function(x,y,z) {
			bl = this.getBlock(x,y,z);
			if (bl.id != 0) {
				shp += (bl.id + ':' + bl.data + '@' + x + ',' + y + ',' + z + '|');
			}
		});
		shp += '%';

		return shp;
	
	}
	buildImageFile() {
		
		if (Game) return Game.webgl.getCanvasImage();
		else return this.createIsometricImage(600, 500, 0);

	}
	buildSetBlockFile() {
	
		// format to be consistent with Minecraft ingame setblock statements
		// setblock <x> <y> <z> <tilename> [datavalue] [oldblockHandling] [datatag]
		// coordinates may be exact, or use an offset with the tilde (~) sign, eg ~1 ~2 ~ ; ~ = ~0
		
		var bl,txt = '';
		var bName = Minecraft.Blocks.getBlockIdName;
		
		this.iterate(function(x,y,z) {
			bl = this.getBlock(x,y,z);
			if (bl.id != 0) {
				txt += 'setblock';
				txt += (' ~' + x + ' ~' + y + ' ~' + z + ' minecraft:' + Minecraft.Blocks.getBlockIdName(bl.id) + (bl.data == 0 ? '' : ' ' + bl.data) + '\r\n');
			}
		});

		return txt;
	
	}
	buildVoxelMapFile() {
	
		var p = this;
		var sv = Game;

		var extraData = {
			xSize: p.x,
			ySize: p.y,
			zSize: p.z,
			blockNames: null
		};
		
		var hex = '';

		var totalSize = p.x * p.y * p.z;
		var blockData = new Uint8Array(totalSize);
		
		var id = 0;
		var name = "";
		var dataPos = 0;
		
		var blocks = { "Air": 0 };
		var blockCnt = 1;
		
		for (var z = 0; z < p.z; z++) {
			for (var x = 0; x < p.x; x++) {
				for (var y = 0; y < p.y; y++) {	

					id = this.getBlockId(x, y, z);
					name = Minecraft.Blocks.getBlockName(id, 0);

					if (blocks[name] == null) blocks[name] = blockCnt++;
					blockData[dataPos++] = blocks[name];
				}
			}
		}

		console.log("Unique Blocks Mapped: " + blockCnt);
		extraData.blockNames = blocks;
		
		var extraDataStr = JSON.stringify(extraData);
		var extraDataBytes = Minecraft.util.strToByteArr(extraDataStr);
		var extraDataZip = (new Zlib.Deflate(extraDataBytes)).compress();
		var extraSize = extraDataZip.length;
		
		var blockDataZip = (new Zlib.Deflate(blockData)).compress();
		
		var extraZipLength = extraDataZip.length;
		var blockZipLength = blockDataZip.length;
		
		var totalZipLength = extraZipLength + blockZipLength + 2;
		
		var finalBytes = new Uint8Array(totalZipLength);

		finalBytes[1] = (extraSize >> 8);
		finalBytes[0] = (extraSize & 255);
		
		finalBytes.set(extraDataZip, 2);
		finalBytes.set(blockDataZip, 2 + extraDataZip.length);
		
		/*
		for(var i = 0; i < extraDataZip.length; i++) {
			finalBytes[i + offset] = extraDataZip[i];
		}
		
		offset = 2 + extraDataZip.length;
		
		for(var i = 0; i < blockDataZip.length; i++) {
			finalBytes[i + offset] = blockDataZip[i];
		}
		*/
		
		return finalBytes;
	
	}
	async buildStructureFile(onProgress) {
	
        const timer = new Cubical.Lib.Timer("buildStructure", true, false);
        const progress = new Cubical.Lib.ProgressEvent(onProgress);
        await progress.update(0, "Initializiing");
    
		var p = this;
		var sv = Game;
		
		var totalSize = p.x * p.y * p.z;
		var blockData = new Uint8Array(totalSize);
		
		var id = 0, data=0;
		var name = "";
		var dataPos = 0;
		
		var blocks = {};
		var blockCnt = 0;
		var fullName = "";
		var baseName, baseVariant;
		var reverseStates = [];
		
		for (var z = 0; z < p.z; z++) {
			for (var x = 0; x < p.x; x++) {
				for (var y = 0; y < p.y; y++) {	

					id = this.getBlockId(x, y, z);
					data = this.getBlockData(x, y, z);

                    if (id == 217) continue; // skip structure void blocks

					fullName = id + ":" + data;
					
					if (!(blocks[fullName])) {
						blocks[fullName] = blockCnt;
						reverseStates.push(fullName);
						blockCnt++;
					}
					blockData[dataPos++] = blocks[fullName];
				}
			}
		}

        await progress.update(2, "Mapping blocks");

		// console.log("Unique Blocks Mapped: " + blockCnt);
        timer.lap("BlocksMapped");

		if(!this.nbt || !this.nbt.root) {
			this.nbt = new Nbt.NbtDocument();
			this.nbt.root = new Nbt.CompoundTag().setName("");
			this.nbt.root.setRoot(true);
		}
		
		if (!(this.nbt.root.getChild("palette"))) {
			//add missing items
			this.nbt.root.addChild(new Nbt.IntTag().setName("version").setValue(1));
			this.nbt.root.addChild(new Nbt.StringTag().setName("author").setValue(""));
			this.nbt.root.addChild(new Nbt.ListTag().setName("size"));
			this.nbt.root.addChild(new Nbt.ListTag().setName("palette"));
			this.nbt.root.addChild(new Nbt.ListTag().setName("blocks"));
			this.nbt.root.addChild(new Nbt.ListTag().setName("entities"));
		}

		var size = this.nbt.root.getChild("size");
		size.clear();
		size.addChild(new Nbt.IntTag().setValue(this.x));
		size.addChild(new Nbt.IntTag().setValue(this.y));
		size.addChild(new Nbt.IntTag().setValue(this.z));
		var blocksNbt = this.nbt.root.getChild("blocks");
		blocksNbt.clear();
		
        timer.lap("UpdateNBT");
        
		dataPos = 0;
		var block, blockPos;

        await progress.update(4, "Adding blocks");

        // Timing ~30%
		for (var z = 0; z < p.z; z++) {
			for (var x = 0; x < p.x; x++) {
				for (var y = 0; y < p.y; y++) {	
					if (this.getBlockId(x, y, z) == 217) continue; // skip structure void blocks
                    
					block = blocksNbt.addChild(new Nbt.CompoundTag());
					block.addChild(new Nbt.IntTag().setName("state").setValue(blockData[dataPos]));
					blockPos = block.addChild(new Nbt.ListTag().setName("pos"));
					blockPos.addChild(new Nbt.IntTag().setValue(x));
					blockPos.addChild(new Nbt.IntTag().setValue(y));
					blockPos.addChild(new Nbt.IntTag().setValue(z));
					
					dataPos++;
				}
			}
		}

        await progress.update(30, "Building reverse states");
		timer.lap("BlocksAdded");
        
		var palette = this.nbt.root.getChild("palette");
		palette.clear();
		
		var state, props, idName, baseProp, propCnt;
		for (var i = 0; i < reverseStates.length; i++) {
			id = reverseStates[i].split(":")[0];
			data = reverseStates[i].split(":")[1];
			idName = "minecraft:" + Minecraft.Blocks.getBlockIdName(id, data);
			
			state = palette.addChild(new Nbt.CompoundTag());
			name = state.addChild(new Nbt.StringTag().setName("Name").setValue(idName));
			
			baseProp = Minecraft.Blocks.getBlockProperties(id, data);
			if(baseProp != null) {
				props = new Nbt.CompoundTag().setName("Properties");
				propCnt = 0;
				for (var j in baseProp) {
					props.addChild(new Nbt.StringTag().setName(j).setValue(baseProp[j]));
					propCnt++;
				}
				if(propCnt > 0) {
					state.addChild(props);
				}
			}				
		}
        
        timer.lap("ReverseStates");
		await progress.update(35, "Writing NBT data");
        // Timing ~65%
        this.nbt.write();
        timer.lap("WriteNBT").stop().log();
        await progress.update(100, "Finalizing");
       
		return new Uint8Array(this.nbt.data.buffer);
	}
	
    onTick() {
        if (!(this.blockTickSpeed > 0)) return;
        
        const totalBlocks = this.x * this.y * this.z;
        const blockPerTick = this.blockTickSpeed/4096;

        const updateTick =  Minecraft.Blocks.onBlockUpdateTick.bind(Minecraft.Blocks);
        const getBlock = this.getBlock.bind(this);
        const sch = this;
        let block;
        
        const tick = (x, y, z) => {
            block = getBlock(x, y, z);
            updateTick(sch, x, y, z, block.id, block.data);
        }
        
        const maxBlockTicks = Math.floor(totalBlocks * blockPerTick);
        let x, y, z;
        let sx = this.x;
        let sy = this.y;
        let sz = this.z;
       
        for (var i = 0; i < maxBlockTicks; i++) {
            x = Math.floor(Math.random() * sx);
            y = Math.floor(Math.random() * sy);
            z = Math.floor(Math.random() * sz);
            
            tick(x, y, z);
        }        
        
    }
	updateNbt(force) {
		force = force ? true : false;
		
		if (!this.nbt || force) {
			const oldNbt = this.nbt; 
			
            this.nbt = new Nbt.NbtDocument();
			this.nbt.root = new Nbt.CompoundTag("Schematic");
			const root = this.nbt.root;
			
			root.addChild(new Nbt.ShortTag("Width", this.x));
			root.addChild(new Nbt.ShortTag("Height", this.y));
			root.addChild(new Nbt.ShortTag("Length", this.z));
			root.addChild(new Nbt.StringTag("Materials", "Alpha"));
			root.addChild(new Nbt.ByteArrayTag("Blocks", this.blocks));
			root.addChild(new Nbt.ByteArrayTag("Data", this.data));
			// root.addChild(new Nbt.ListTag("Entities"));
			// root.addChild(new Nbt.ListTag("TileEntities"));

			if(oldNbt instanceof Nbt.NbtDocument) {			
                const oldEnts = oldNbt.getRoot().getChild("Entities");
                const oldTileEnts = oldNbt.getRoot().getChild("TileEntities");
                
                root.addChild(oldEnts ? oldEnts.clone() : new Nbt.ListTag("Entities"));
                root.addChild(oldTileEnts ? oldTileEnts.clone() : new Nbt.ListTag("TileEntities"));
			}
            
			const cubical = root.addChild(new Nbt.CompoundTag("Cubical"));
			cubical.addChild(new Nbt.StringTag("Version", Game.version));
			
			var fileData = null;
			if(oldNbt instanceof Nbt.NbtDocument && oldNbt.getRoot().getChild("Cubical")) {
				fileData = oldNbt.getRoot().getChild("Cubical").getChild("File");
				if (fileData) cubical.addChild(fileData);
			}
			if(!fileData) {
				fileData = cubical.addChild(new Nbt.CompoundTag("File"));
				fileData.addChild(new Nbt.StringTag("Name", this.fileInfo.name));
				fileData.addChild(new Nbt.StringTag("Author", this.fileInfo.extra.author));
				fileData.addChild(new Nbt.StringTag("Created", new Date().toJSON()));						
			}
			
			const player = Game.player;				
			const playerData = cubical.addChild(new Nbt.CompoundTag("Player"));
			playerData.addChild(new Nbt.DoubleTag("X", player.x));
			playerData.addChild(new Nbt.DoubleTag("Y", player.y));
			playerData.addChild(new Nbt.DoubleTag("Z", player.z));
			playerData.addChild(new Nbt.DoubleTag("Yaw", player.yaw));
			playerData.addChild(new Nbt.DoubleTag("Pitch", player.pitch));
			playerData.addChild(new Nbt.ByteTag("Flying", player.useGravity ? 0 : 1));
		}
        
		this.nbt.write();
	}
	saveFile(type, fileName, callback, onProgress) {
		fileName = typeof fileName == 'string' ? fileName : this.blocks.length.toString() + "blocks";
        type = type == 'sch' ? 'schematic' : type;
        
        fileName = fileName + "." + type;
        
		if (callback) {
			this.buildBlob(type, (blob) => {
                Minecraft.util.saveBlob(blob, fileName, type == 'png');
                callback(blob);
            }, onProgress);
		}
        else {
            Minecraft.util.saveBlob(this.buildBlob(type), fileName, type == 'png');
        }
	}
	createHeightMap() {
		const size = this.getSize();
		const sxz = size.x * size.z;
        const data = size.y < 256 ? new Uint8Array(sxz) : new Uint16Array(sxz);

        const blocks = this.blocks;
        const notAir = (x, y, z) => {
            return blocks[(y * sxz) + (z * size.x) + x] > 0;
        };

		let index = 0;        
		for (let x = 0; x <  size.x; x++) {
			for (let z = 0; z <  size.z; z++) {
				for (let y = size.y-1; y >= 0; y--) {
					if (notAir(x, y, z) || y == 0) {
						data[index++] = y;
						break;
					}
				}
			}
		}
        
		return data;
	}
    generateSurfaceImage(vecStart, vecEnd, colorByHeight, returnArray, heightOffset = 0) { // TODO: Finish this

        return new Promise((resolve, reject) => {

            const start = [Math.floor(Math.min(vecStart[0], vecEnd[0])), Math.floor(Math.min(vecStart[2], vecEnd[2]))];
            const end = [Math.floor(Math.max(vecStart[0], vecEnd[0])), Math.floor(Math.max(vecStart[2], vecEnd[2]))];
            const mapWidth = end[1] - start[1];
            const mapHeight = end[0] - start[0];

            const p = this;
            const getBlock = (vec) => p.getBlock(vec.x, vec.y, vec.z);
            const Vector3 = Cubical.Lib.Vector3;
            
            const img = returnArray ? null : new Image(mapWidth, mapHeight);
            const blockColors = Minecraft.Blocks.blockColors;
            
            const lightDir = {
                'SEtoNW': new Vector3(1, 0, 1),
                'SWtoNE': new Vector3(-1, 0, 1),
                'NEtoSW': new Vector3(1, 0, -1),
                'NWtoSE': new Vector3(-1, 0, -1)
            }
            
            const imageData = new ImageData(mapWidth, mapHeight);
            const totalValues = mapWidth * mapHeight * 4;
            const colorArray = imageData.data; //new Uint8ClampedArray(totalValues);
            
            const lightAngle = 'NEtoSW';
            const invertLight = new Vector3(-1, 0, -1);
            const hoo = [8,9];
            
            const moda = .75;
            const modb = 1;
            const modc = -130 + heightOffset;
            const modd = 4;
            const darkEdge = -.2;
            const lightEdge = .2;
            const yTop = this.y;
            let cIndex = 0;
            
            for (let x = 0; x < mapHeight; x++) {
                for (let z = 0; z < mapWidth; z++) {            
                    let pos = new Vector3(mapHeight - (start[0] + x), 1, (start[1] + z));
                    let yMax = this.getHighestBlock(pos.x, pos.z, 0, yTop);
                    let topID = getBlock(new Vector3(pos.x, yMax, pos.z)).id;
                    let topVec = new Vector3(pos.x, 0, pos.z);
                    let depth = 0;
                    let edgeL = false;
                    let edgeD = false;
                    let r,g,b;

                    for (let y = yMax; y < yTop; y++) {
                        topVec.y = y;
                        let aboveBlock = getBlock(topVec.add(0,1,0)).id;

                        if (aboveBlock === 0) {
                            topID = getBlock(topVec).id;
                            if (depth === 0) {
                                if (hoo.indexOf(topID) === -1) {
                                    edgeL = getBlock(topVec.addVec(lightDir[lightAngle])).id === 0 ? true : false;
                                    edgeD = getBlock(topVec.addVec(lightDir[lightAngle].multiplyVec(invertLight))).id === 0 ? true : false;	// Check sideblock instead of the actual one... 
                                }
                                else {
                                    for (let wy = 0; wy < y; wy++) {
                                        let under = topVec.add(0,-(wy),0);
                                        if(hoo.indexOf(getBlock(under).id) === -1) {
                                            under = under.add(0,1,0);
                                            edgeL = hoo.indexOf(getBlock(under.addVec(lightDir[lightAngle])).id) === -1 ? false : true;
                                            edgeD = hoo.indexOf(getBlock(under.addVec(lightDir[lightAngle].multiplyVec(invertLight))).id) === -1 ? false : true;	// Check sideblock instead of the actual one... 
                                            depth = wy;
                                            break;
                                        }
                                    }
                                }
                            }
                            break;															
                        }
                        else if(hoo.indexOf(aboveBlock) !== -1) {
                            if (depth === 0) {
                                edgeL = hoo.indexOf(getBlock(topVec.addVec(lightDir[lightAngle].multiplyVec(invertLight))).id) === -1  ? true : false;
                                edgeD = hoo.indexOf(getBlock(topVec.addVec(lightDir[lightAngle])).id) === -1 ? true : false;	// Check sideblock instead of the actual one... 
                            }
                            depth++
                        }				
                    }  	
                    
                    let topStr = topID +':' + String(getBlock(topVec.add(0,0,0)).data);
                    topID = typeof blockColors[topStr] === 'undefined' ? topID : topStr;
                    
                    let clrInc = typeof blockColors[topID] !== 'undefined' ? topID : -1;
                    
                    if (clrInc !== -1) {
                        if (colorByHeight === false) {
                            r = blockColors[clrInc][0]*moda;
                            g = blockColors[clrInc][1]*moda;
                            b = blockColors[clrInc][2]*moda;
                        }
                        else {
                            r = blockColors[clrInc][0] + ((topVec.y + modc) / modb) - depth * modd; 
                            g = blockColors[clrInc][1] + ((topVec.y + modc) / modb) - depth * modd; 
                            b = blockColors[clrInc][2] + ((topVec.y + modc) / modb) - depth * modd;
                            
                            r += ((edgeD ? darkEdge * r : 0) + (edgeL ? lightEdge * (255 - r) : 0));
                            g += ((edgeD ? darkEdge * g : 0) + (edgeL ? lightEdge * (255 - g) : 0));
                            b += ((edgeD ? darkEdge * b : 0) + (edgeL ? lightEdge * (255 - b) : 0));
                        }
                    }
                
                    // let endClr = getColor(clr[0], clr[1], clr[2]) ;
                    
                    colorArray[cIndex++] = r;
                    colorArray[cIndex++] = g;
                    colorArray[cIndex++] = b;
                    colorArray[cIndex++] = 255;
                }
            }
            
            if (!returnArray) {
                let cvs = document.createElement('canvas');
                let ctx = cvs.getContext("2d");
				cvs.width = mapWidth;
				cvs.height = mapHeight;
                
                ctx.putImageData(imageData, 0, 0);
                
                const finalImg = new Image();
                finalImg.src = cvs.toDataURL("image/png");
                
                finalImg.onload = () => {
                    resolve(finalImg);
                }
            }
            else {
                resolve(colorArray);
            }
            
        });
    }

	createSphere(x,y,z,size,id,data) {
	
		var ptr = this;
	
		var cyclerFun = function(xx,yy,zz,dd) {
			ptr.setBlock(xx,yy,zz,id,data);
		};
		
		var cycler = new Cubical.Lib.SphereIterator(cyclerFun, size);
		var ctr = {x: x, y: y, z: z};
		var setTotal = cycler.run(ctr);
	}
	createBox(xa,ya,za,xb,yb,zb,id,data) {
	
		var x,y,z,mx,my,mz,sx,sy,sz;
		
		mx = Math.min(xa,xb);
		my = Math.min(ya,yb);
		mz = Math.min(za,zb);

		sx = Math.max(xa,xb) - mx + 1;
		sy = Math.max(ya,yb) - my + 1;
		sz = Math.max(za,zb) - mz + 1;			
		
		for (x = 0; x < sx; x++) {
			for (y = 0; y < sy; y++) {
				for (z = 0; z < sz; z++) {
					this.setBlock(mx+x,my+y,mz+z,id,data);
				}
			}
		}
	}
	createLine(xa,ya,za,xb,yb,zb,id,data,size) {
		var size = parseInt(size) < 1 ? 1 : parseInt(size);
		var distance = Minecraft.util.getDistance(xa,ya,za,xb,yb,zb);
		var step = .9/distance;
	
		var psx = xa;
		var psy = ya;
		var psz = za;
		var pex = xb;
		var pey = yb;
		var pez = zb;
		var ptr = this;
	
		if (size === 1) {
			for( var i = 0; i <= 1; i += step) {
				var xi = psx + ((pex - psx) * i);
				var yi = psy + ((pey - psy) * i);
				var zi = psz + ((pez - psz) * i);
				this.setBlock(xi, yi, zi, id, data);						
			}
		}
		else {
			var cycleSphere = function(x, y, z, d) {
				for( var i = 0; i <= 1; i += step) {
					var xi = psx + ((pex - psx) * i);
					var yi = psy + ((pey - psy) * i);
					var zi = psz + ((pez - psz) * i);
					ptr.setBlock(xi + x -100, yi + y -100, zi + z -100, id, data);
				}				
			}
			
			var cycler = new Cubical.Lib.SphereIterator(cycleSphere, size, size, size);
			cycler.run({x:100,y:100,z:100}, false); //add 100 because the cycler didn't like (0,0,0)...
		}
	}

    clone() {
        const clone = new Schematic(this.x, this.y, this.z, this.blocks.slice(), this.data.slice());
        clone.offset = this.offset.slice();
        
        if (this.mask) clone.mask = this.mask.clone();

        clone.fileInfo = JSON.parse(JSON.stringify(this.fileInfo));
        
		return clone;
    }
	parseFile(file, callback) {
	
		try {
			var fName = String(file.name).substring(0, file.name.lastIndexOf("."));
			var fileInfo = {file: file, name: fName, type: file.type, data: null, extra: {author: "Guest"}};
			this.fileInfo = fileInfo;
			
			var fileArg = String(file.name);
			var extStr = String(fileArg.slice(fileArg.length-4).toLowerCase());

			var ptr = this;
			
			var finishUpload = function(result) {
				try {
					fileInfo.data = result;
					
					if (fileInfo.ext == "shp") {
						ptr.parseShapeFile(fileInfo.data);
					}
					else if (fileInfo.ext == "bo2") {
						ptr.parseBO2File(fileInfo.data);
					}			
					else if (fileInfo.ext == "sch"){				
						ptr.parseSchematicFile(fileInfo.data);
					}
					else if (fileInfo.ext == "nbt"){				
						ptr.parseStructureFile(fileInfo.data);
					}
					else if (fileInfo.ext == "png" || fileInfo.ext == "gif" || fileInfo.ext == "jpg" || fileInfo.ext == "bmp"){				

						var imgBlob = new Blob([result], {type: 'image'});
						var url = _window.URL.createObjectURL(imgBlob);
						var img = new Image();
						img.src = url;
						img.onload = function(e) {
							ptr.parseImageFile(img);
						}
						img.onerror = function(e) {
							console.log("Error loading image: %O", e);
						}
						
					}
					else if (fileInfo.ext == "mca"){				
                        const mcaFileName = fName.slice();
                        const splitName = fName.slice().substring(2).split(".");
                        const xChunkIndex = parseInt(splitName[0]);
                        const zChunkIndex = parseInt(splitName[1]);
                        
                        const region = new Cubical.File.MinecraftRegionFile(xChunkIndex, zChunkIndex, fileInfo.data);
                        
                        window._region = region;
                        window._sch = region.toSchematic();
                        sch = window._sch;
                        console.log("Finished parsing Region File!");
					}
					else {				
						ptr.parseSchematicFile(fileInfo.data);
					}
					delete fileInfo.data;
                    
					callback(ptr);
				}
				catch(e) {
					console.log("Error: %o",e);
					_window.alert("Error encountered while parsing file " + fileInfo.name + "/nSee console for details.");
					callback(false);
				}
			}
			
			if (extStr == ".shp") fileInfo.ext = "shp";				
			else if (extStr == ".bo2") fileInfo.ext = "bo2";
			else if (extStr == ".mca") fileInfo.ext = "mca";
			else if (extStr == ".nbt") fileInfo.ext = "nbt";
			else if (extStr == ".png") fileInfo.ext = "png";
			else if (extStr == ".gif") fileInfo.ext = "gif";
			else if (extStr == ".jpg" || extStr == "jpeg") fileInfo.ext = "jpg";
			else if (extStr == ".bmp") fileInfo.ext = "bmp";
			else if (file.name.indexOf(".sch") !== -1) fileInfo.ext = "sch";
			else { 
				console.log("Invalid shape extension: %s", extStr);
				callback(false);
				return null;
			}
			
			var reader = new FileReader();
			reader.onload = function(e) {
				finishUpload(new Uint8Array(e.target.result));
			};
			reader.readAsArrayBuffer(file);
			
		}
		catch(e) {
			console.log("Error: %o",e);
			callback(false);
		}
		
	}			
	parseBO2File(shapeStr) {
		
		shapeStr = Minecraft.util.byteArrToStr(shapeStr);

		var inc = shapeStr.indexOf("[DATA]");
		var dataStr = shapeStr.slice(inc);
		
		var lines = dataStr.split("\n");
		var line,vcs,bll,ix,iy,iz,bt,bd,lsp;
		
		var converter = new Cubical.File.VectorShapeConverter(this, 'bo2');
		
		for (var i = 1; i < lines.length; i++) {
			
			line = lines[i];
			if (line.length<4) continue;
			lsp = line.split(":");
			vcs = lsp[0].split(",");
			bll = lsp[1].split(".");
			ix = Math.floor(vcs[0]);
			iy = Math.floor(vcs[1]);
			iz = Math.floor(vcs[2])-1;
			bt = Math.floor(bll[0]);
			bd = Math.floor(bll[1]);
			
			converter.add(ix,iy,iz,bt,bd);
		}
		
		var bCnt = converter.finish();
		console.log("Finished parsing BO2 file - %s blocks set!", bCnt);
        
        return this;
	}
	parseShapeFile(shapeStr) {
		
		shapeStr = Minecraft.util.byteArrToStr(shapeStr);
		var converter = new Cubical.File.VectorShapeConverter(this, 'shp');
	
		//var tmpShape = {};

		//	 |17:4@25,3,-6|			Formatting for old block shapes files
		var cnt = 0;
		var inc = 0;
		while (inc <= shapeStr.length) {
		
			if (shapeStr.slice(inc+1, inc+2) == "%") {
		
				break;
			}
			else if (shapeStr.slice(inc, inc+1) == "^") {
				
				var anglePos = shapeStr.indexOf("^", inc+1);
				var angleInc = anglePos+1;
				var anglePos2 = anglePos;
				//tmpShape.angle = parseFloat(shapeStr.slice(inc+1, anglePos2));
				inc = angleInc;
			}
			else if (shapeStr.slice(inc, inc+1) == "#") {
				
				var offsetPos = shapeStr.indexOf("#", inc+1);
				var offsetInc = offsetPos+1;
				var offsetPos2 = offsetPos;
				//tmpShape.offset = parseVector(String(shapeStr.slice(inc+1, offsetPos2)));
				inc = offsetInc;
			}
			else if (shapeStr.slice(inc, inc+1) == "|") {

				var blockPos = shapeStr.indexOf("@", inc+1);
				var blockInc = blockPos;
				var blockPos2 = blockPos;
				var block = Minecraft.util.parseBlock(String(shapeStr.slice(inc+1, blockPos2)));
				
				var vecPos = shapeStr.indexOf("|", blockInc);
				var vecInc = vecPos+1;
				var vecPos2 = vecPos;
				var vec = Minecraft.util.parseVector(String(shapeStr.slice(blockPos+1, vecPos2)));
				
				var abc = "'" + cnt + "'";
				converter.add(vec.x, vec.z, vec.y, block.id, block.data);
				
				inc = vecInc-1;
				cnt++;
			}
			else {
				inc++;
			}
		}
		
		var bCnt = converter.finish();
		console.log("Finished parsing shape file - %s blocks set!", bCnt);
        
        return this;
	}
	parseStructureFile(data) {
		var timeNow = new Date().getTime();
		var nbt = new Nbt.NbtDocument(data);
		var map = nbt.getRoot();
		this.nbt = nbt;
		
		var size = map.getChild("size");
		this.x = size.getChildValue(0);
		this.y = size.getChildValue(1);
		this.z = size.getChildValue(2);
		
		var paletteArr = map.getChild("palette").getChildren();
		var blockMap = [];
		var bProps = {};
		var name, val, obj;
		
		for (var i = 0; i < paletteArr.length; i++) {
			var baseId = paletteArr[i].getChildValue("Name");
			var variantId = "none";
			obj = {};
			if(paletteArr[i].getChild("Properties")) {
				bProps = paletteArr[i].getChild("Properties").getChildren();
				for (var j in bProps) {
					name = bProps[j].getName();
					val = bProps[j].getValue();
					obj[name] = val;
				}
			}
            const block = Minecraft.Blocks.getBlockFromState(baseId, obj);
			blockMap[i] = block == null ? [1, 0] : block;
		}
		
        const blockArraySize = this.x * this.y * this.z;
        const blockIdArray = new Uint8Array(blockArraySize);
        const blockDataArray = new Uint8Array(blockArraySize);
        
        blockIdArray.fill(217); // Initialize the area with structure void blocks
        this.create(this.x, this.y, this.z, blockIdArray, blockDataArray);
		
        var blockList = map.getChild("blocks").getChildren();
		var index, pos, sid;
		for (var i = 0; i < blockList.length; i++) {
			sid = blockList[i].getChildValue("state");
			pos = blockList[i].getChild("pos").getChildren();

			index = this.coordToIndex(pos[0].getValue(), pos[1].getValue(), pos[2].getValue());
			this.blocks[index] = blockMap[sid][0];
			this.data[index] = blockMap[sid][1];
		}
        
		console.log("Finished parsing nbt structure file in " + (new Date().getTime() - timeNow) + " ms!");
        return this;
	}
	parseSchematicFile(data) {
		// const timeNow = new Date().getTime();
		const nbt = new Nbt.NbtDocument(data);
		const map = nbt.getRoot();
		this.nbt = nbt;
		this.fileInfo.extra = {};

		if (map.getChild("PlayerYaw")) {
			// Old cubical info stored in the root
            this.fileInfo.extra.author = map.getChildValue("Author");
			this.fileInfo.extra.playerYaw = map.getChildValue("PlayerYaw");
			this.fileInfo.extra.playerPitch = map.getChildValue("PlayerPitch");
			this.fileInfo.extra.spawnX = map.getChildValue("SpawnX");
			this.fileInfo.extra.spawnY = map.getChildValue("SpawnY");
			this.fileInfo.extra.spawnZ = map.getChildValue("SpawnZ");
		}
		else if (map.getChild("Cubical")) {
            // New Cubical info stored in a CompoundTag off root
            const cubical = map.getChild("Cubical");
			const player = cubical.getChild("Player");
            const file = cubical.getChild("File");
            
            this.fileInfo.extra.version = cubical.getChildValue("Version");
			
			if (file != null) {
				this.fileInfo.name = file.getChildValue("Name");
				this.fileInfo.extra.author = file.getChildValue("Author");
				this.fileInfo.extra.created = file.getChildValue("Created");
			}
			
			this.fileInfo.extra.playerYaw = player.getChildValue("Yaw");
			this.fileInfo.extra.playerPitch = player.getChildValue("Pitch");
			this.fileInfo.extra.spawnX = player.getChildValue("X");
			this.fileInfo.extra.spawnY = player.getChildValue("Y");
			this.fileInfo.extra.spawnZ = player.getChildValue("Z");
			this.fileInfo.extra.flying = player.getChildValue("Flying") == 1 ? true : false;
		}
		
		this.x = map.getChildValue("Width");
		this.y = map.getChildValue("Height");
		this.z = map.getChildValue("Length");
		
		this.create(this.x, this.y, this.z, map.getChild("Blocks").getValue(), map.getChild("Data").getValue());
		// console.log("Finished parsing schematic file in " + (new Date().getTime() - timeNow) + " ms!");	
        
        const entities = map.getChildValue("Entities");
        const tileEntities = map.getChildValue("TileEntities");
        const tileTicks = map.getChildValue("TileTicks");
        const biomes = map.getChildValue("Biomes");
        
        const store = this.dataStore = new Cubical.Lib.WorldDataStore(this);
        
        if (tileEntities) {
            for (let i = 0; i < tileEntities.length; i++) {
                const tileEntNbt = tileEntities[i];
                const tileEnt = Cubical.Entity.MinecraftTileEntity.fromNbt(tileEntNbt);
                
                store.addTileEntity(tileEnt);
            }
        }
        
        return this;
	}
	parseImageFile(img) {
		// this.parseHeightMapImageFile(img);
		// return;
		
		var cvs = document.createElement('canvas');
		var width = img.width;
		var height = img.height;
		
		cvs.width = width;
		cvs.height = height;
		var ctx = cvs.getContext('2d');
		ctx.drawImage(img, 0, 0, width, height);
		
		this.x = width;
		this.y = 1;
		this.z = height;
		
		var blocks = new Uint8Array(this.x * this.y * this.z);
		var data = new Uint8Array(this.x * this.y * this.z);

		var d, index,indexB, clr, blockData, bid, bdata;
		var imageData = ctx.getImageData(0, 0,  width, height).data;
		
		for (var x = 0; x < width; x++) {
			for (var z = 0; z < height; z++) {
				index = (x * height + z);
				indexB = index * 4;
				if (imageData[indexB+3] < 16) {
					bid = bdata = 0;
				}
				else {

					clr = [imageData[indexB], imageData[indexB+1], imageData[indexB+2]];
					blockData = Minecraft.Blocks.getClosestColorBlock(clr);
				
					bid = parseInt(blockData.id.split(":")[0]);
					bdata = parseInt(blockData.id.split(":")[1]);
					
					if (bid == 0 && bdata == 0) {
						console.log("clr: %O, blockData: %O", clr, blockData);
					}
				}
				
				blocks[index] = bid;
				data[index] = bdata;
			}
		}
		
		this.create(this.x, this.y, this.z, blocks, data);
		
        return this;
	}
	parseHeightMapImageFile(img, args = {}) {
		
		args.maxHeight = 128;
		args.blockId = 1;
		args.blockData = 0;
        
		var width = img.width;
		var height = img.height;

        const cvs = new OffscreenCanvas(width, height);			
        const ctx = cvs.getContext("2d");

		ctx.drawImage(img, 0, 0, width, height);
		
		this.x = width;
		this.y = args.maxHeight;
		this.z = height;
		
		this.create(this.x, this.y, this.z);
		
		// var blocks = new Uint8Array(this.x * this.y * this.z);
		// var data = new Uint8Array(this.x * this.y * this.z);

		var peak, index, scale;
		var imageData = ctx.getImageData(0, 0,  width, height).data;
		
		for (var x = 0; x < width; x++) {
			for (var z = 0; z < height; z++) {
				index = (x * height + z) * 4;
				scale = imageData[index] / 255;
				peak = Math.floor(scale * args.maxHeight);
				
				for (var y = 0; y < peak; y++) {
					this.setBlock(x, y, z, args.blockId, args.blockData);
				}	

			}
		}
		// this.create(this.x, this.y, this.z, blocks, data);
        
        return this;
	}
	
    insertBlockList(blockList) {
        if (!blockList || !(blockList.length > 0)) return;

        for (let i = 0; i < blockList.length; i++) {
            const block = blockList[i];
            this.setBlock(block.x, block.y, block.z, block.id, block.data);
            
            Minecraft.Blocks.changeBlock(this, block.x, block.y, block.z, block.id, block.data, block.id === 0);
        }
	}
    insertShape(shp, x, y, z) {

		var size = {x: shp.maxX - shp.minX, z: shp.maxY - shp.minY, y: shp.maxZ - shp.minZ};
		//var ofs = {x: shp.minX*-1,y: shp.minY*-1, z: shp.minZ*-1}; 
		var ofs = {x: 0, y: 0, z: 0};
		
		this.setBlockCache(true);
		for (var i = 0; i < shp.data.length; i+=5) {
			this.setBlockCache(false, shp.data[i]+ofs.x+x, shp.data[i+1]+ofs.z+y, shp.data[i+2]+ofs.y+z, shp.data[i+3], shp.data[i+4]);
		}
		this.setBlockCache(true);
	}
	insertSchematic(sch, x, y, z, includeAir = false, useMask = false) {
		const ofs = sch.offset ? sch.offset : [0, 0, 0];
		const size = sch.getSize();
        const csx = size.x;
        const csy = size.y;
        const csz = size.z;
        const csxz = csx * csz;
        
        const sx = this.x;
        const sy = this.y;
        const sz = this.z;
        const sxz = sx * sz;
        
        const startPos = [x + ofs[0], y + ofs[1], z + ofs[2]];
        const endPos = [size.x + startPos[0] - 1, size.y + startPos[1] - 1, size.z + startPos[2] - 1];

		useMask = useMask && typeof(sch.mask) !== 'undefined'        

        var wx, wy, wz;
        var wysxz, wzsx;
        var blockId;
        var parentIndex = 0;
        var childIndex = -1;

        for (var yy = 0; yy < csy; yy++) {
            wy = yy + y + ofs[1];
            if (wy < 0 || wy >= this.y) {
                childIndex += (csxz);
                continue;
            }
            
            wysxz = wy * sxz;
            for (var zz = 0; zz < csz; zz++) {
                wz = zz + z + ofs[2];
                if (wz < 0 || wz >= this.z) {
                    childIndex += csx;
                    continue;
                }
                
                wzsx = wz * sx;
                for (var xx = 0; xx < csx; xx++) {
                    wx = xx + x + ofs[0];
                    childIndex++;
                    if (wx < 0 || wx >= this.x) continue;
                    if (useMask && !sch.mask.getBit(xx, yy, zz)) continue;
                    
                    blockId = sch.blocks[childIndex];
					if (blockId > 0 || useMask || includeAir) {
                        parentIndex = wysxz + wzsx + wx;
                        
                        this.blocks[parentIndex] = blockId;
                        this.data[parentIndex] = sch.data[childIndex];
                    }
				}
			}
		}
        
        if (Game && Game.getShape() == this) {
			Game.scene.onBlockChange(...startPos, ...endPos);
		}		
	}
	extractSchematic(start = null, end = null, useMask = false) {
        if (start == null) start = [0, 0, 0];
        if (end == null) end = [this.x - 1, this.y - 1, this.z - 1];
        
        useMask = useMask && typeof(this.mask) !== 'undefined'  
        
		const minPos = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.min(start[2], end[2])];
		const maxPos = [Math.max(start[0], end[0]), Math.max(start[1], end[1]), Math.max(start[2], end[2])];
		const size = [maxPos[0] - minPos[0] + 1, maxPos[1] - minPos[1] + 1, maxPos[2] - minPos[2] + 1];
       
        const x = minPos[0];
        const y = minPos[1];
        const z = minPos[2];
        
        const csx = size[0];
        const csy = size[1];
        const csz = size[2];
        const csxz = csx * csz;
        
		const sch = new Schematic(...size);
        sch.mask = useMask ? new Cubical.Lib.VoxelBitMask(...size) : null;        
        
        const sx = this.x;
        const sy = this.y;
        const sz = this.z;
        const sxz = sx * sz;
        
        var wx, wy, wz;
        var wysxz, wzsx;
        var blockId;
        var parentIndex = 0;
        var childIndex = -1;

        for (var yy = 0; yy < csy; yy++) {
            wy = yy + y;
            if (wy < 0 || wy >= this.y) {
                childIndex += (csxz);
                continue;
            }
            
            wysxz = wy * sxz;
            for (var zz = 0; zz < csz; zz++) {
                wz = zz + z;
                if (wz < 0 || wz >= this.z) {
                    childIndex += csx;
                    continue;
                }
                
                wzsx = wz * sx;
                for (var xx = 0; xx < csx; xx++) {
                    wx = xx + x;
                    childIndex++;
                    if (wx < 0 || wx >= this.x) continue;

                    parentIndex = wysxz + wzsx + wx;
                    blockId = this.blocks[parentIndex];
                    
                    if (useMask) sch.mask.setBit(xx, yy, zz, this.mask.getBit(wx, wy, wz));
                    
                    if (blockId > 0) {
                        sch.blocks[childIndex] = blockId;
                        sch.data[childIndex] = this.data[parentIndex];
                    }
				}
			}
		}
        
        const name = this.fileInfo ? this.fileInfo.name : "ClipboardCopy";
        sch.fileInfo = {file: "None", ext: "sch", name: name, type: "sch", data: null};
        
		return sch;
	}
	toVoxelShape(offset) {
		var shp = new Cubical.Lib.VoxelShape();
		var block;
		
		for (var x = 0; x <= this.x; x++) {
			for (var y = 0; y <= this.y; y++) {
				for (var z = 0; z <= this.z; z++) {
					block = this.getBlock(x, y, z);
					if (block.id > 0) shp.setBlock(x+offset[0], y+offset[1], z+offset[2], block.id, block.data);
				}
			}
		}
		
		return shp;
	}
	toBase64() {
        const byteData = this.buildSchematicFile();
        const zip = Minecraft.util.gzipCompress(byteData);
        return _window.btoa(zip);
    }
    
	trimSize() {
		
		var startTotal = this.x * this.y * this.z;
		var startSz = [this.x, this.y, this.z];
		
		var minBox = this.getBoundingBox();
		var minSize = [minBox[3]-minBox[0]+1, minBox[4]-minBox[1]+1, minBox[5]-minBox[2]+1];
		var offset = [minBox[0], minBox[1], minBox[2]];
		//console.log("MinBox: %o; MinSize: %o; Offset: %o; Total: %n", minBox, minSize, offset, (this.x * this.y * this.z));
		
		this.x = minSize[0];
		this.y = minSize[1];
		this.z = minSize[2];
		
		var endTotal = this.x * this.y * this.z;
		var diffTotal = startTotal - endTotal;
		
		var oldBlocks = this.blocks;
		var oldData = this.data;
		
		this.blocks = new Uint8Array(minSize[0] * minSize[1] * minSize[2]);
		this.data = new Uint8Array(minSize[0] * minSize[1] * minSize[2]);
		
		var indexA, indexB;
		
		for (var iy = 0; iy < this.y; iy++) {
			for (var iz = 0; iz < this.z; iz++) {
				for (var ix = 0; ix < this.x; ix++) {
					indexA = (iy * (this.x * this.z)) + (iz * this.x) + ix;
					indexB = ((iy + offset[1]) * (startSz[0] * startSz[2])) + ((iz + offset[2]) * startSz[0]) + (ix + offset[0]);
					this.blocks[indexA] = oldBlocks[indexB];
					this.data[indexA] = oldData[indexB];
				}
			}
		}
		
		oldBlocks = null;
		oldData = null;
		
		return this;
		
	}
	addOffset(x, y, z) {
        this.offset[0] += x;
        this.offset[1] += y;
        this.offset[2] += z;
    }
    resize(x, y, z, xo, yo, zo) {
		
		var baseSize = {x:this.x, y:this.y, z:this.z};
		var newSize = {x: x, y: y, z: z};
		var deltaSize = {x: x - baseSize.x, y: y - baseSize.y, z: z - baseSize.z};
		var newTotal = newSize.x * newSize.y * newSize.z;
		
		var newBlocks = new Uint8Array(newTotal);
		var newData = new Uint8Array(newTotal);
		
		var iy,iz,ix,ia,ib,bd,bm,iyo,izo,ixo;
		var off = {x: 0, y: 0, z: 0};
		
		if (xo == 0) off.x = 0;
		else if (xo == .5) off.x = Math.floor(-deltaSize.x / 2);
		else if (xo == 1) off.x = -deltaSize.x;
		
		if (yo == 0) off.y = 0;
		else if (yo == .5) off.y = Math.floor(-deltaSize.y / 2);
		else if (yo == 1) off.y = -deltaSize.y;

		if (zo == 0) off.z = 0;
		else if (zo == .5) off.z = Math.floor(-deltaSize.z / 2);
		else if (zo == 1) off.z = -deltaSize.z;			
		
		for (iy = 0; iy < newSize.y; iy++) {
			iyo = iy + off.y;
			for (iz = 0; iz < newSize.z; iz++) {
				izo = iz + off.z;
				for (ix = 0; ix < newSize.x; ix++) {
					ixo = ix + off.x;

					ia = (iy * (newSize.x * newSize.z)) + (iz * newSize.x) + ix;
					ib = ((iyo) * (baseSize.x * baseSize.z)) + ((izo) * baseSize.x) + (ixo);
					
					if (iyo < 0 || iyo >= baseSize.y || izo < 0 || izo >= baseSize.z || ixo < 0 || ixo >= baseSize.x) {
						newBlocks[ia] = 0;
						newData[ia] = 0;
					}
					else {
						newBlocks[ia] = this.blocks[ib];
						newData[ia] = this.data[ib];
					}
				}
			}
		}
		
		this.blocks = newBlocks;
		this.data = newData;
		this.x = newSize.x;
		this.y = newSize.y;
		this.z = newSize.z;
		
		newBlocks = newData = null;
		
		return this;
	}
	getBoundingBox() {
		var ax = -1, ay = -1, az = -1, bx = -1, by = -1, bz = -1;
		var x,y,z;
		for (x = 0; x < this.x; x++) {
			for (y = 0; y < this.y; y++) {
				for (z = 0; z < this.z; z++) {
					if (this.getBlockId(x,y,z) !== 0) ax = x;
					if (ax > -1) break;
				} 
				if (ax > -1) break;
			} 
			if (ax > -1) break;
		}
		
		for (x = this.x-1; x >= 0; x--) {
			for (y = 0; y < this.y; y++) {
				for (z = 0; z < this.z; z++) {
					if (this.getBlockId(x,y,z) !== 0) bx = x;
					if (bx > -1) break;
				} 
				if (bx > -1) break;
			} 
			if (bx > -1) break;
		}

		for (y = 0; y < this.y; y++) {
			for (x = 0; x < this.x; x++) {
				for (z = 0; z < this.z; z++) {
					if (this.getBlockId(x,y,z) !== 0) ay = y;
					if (ay > -1) break;
				} 
				if (ay > -1) break;
			} 
			if (ay > -1) break;
		}
		
		for (y = this.y-1; y >= 0; y--) {
			for (x = 0; x < this.x; x++) {
				for (z = 0; z < this.z; z++) {
					if (this.getBlockId(x,y,z) !== 0) by = y;
					if (by > -1) break;
				} 
				if (by > -1) break;
			} 
			if (by > -1) break;
		}

		for (z = 0; z < this.z; z++) {
			for (x = 0; x < this.x; x++) {
				for (y = 0; y < this.y; y++) {
					if (this.getBlockId(x,y,z) !== 0) az = z;
					if (az > -1) break;
				} 
				if (az > -1) break;
			} 
			if (az > -1) break;
		}
		
		for (z = this.z-1; z >= 0; z--) {
			for (x = 0; x < this.x; x++) {
				for (y = 0; y < this.y; y++) {
					if (this.getBlockId(x,y,z) !== 0) bz = z;
					if (bz > -1) break;
				} 
				if (bz > -1) break;
			} 
			if (bz > -1) break;
		}

		var retAr = [ax, ay, az, bx, by, bz];
		return retAr;
		
	}
	getHighestBlock(x, z, minY, maxY) {
		
		for (var y = maxY; y >= minY; --y) {
			let id = this.getBlockId(x, y, z);
			let data = this.getBlockData(x, y, z);
			if (Minecraft.Blocks.isSolidBlock(id, data)) {
				return y;
			}
		}

		return minY;			
	}
    buildHeightMap() {

        // const start = performance.now();
		
        const size = this.getSize();
        const map = new Uint8Array(size.x * size.z);
        
        let x, y, z;
        let id, index = 0;
        
        for (x = 0; x < size.x; x++) {
			for (z = 0; z < size.z; z++) {
                
                for (y = size.y - 1; y >= 0; y--) {
                    id = this.blocks[this.coordToIndex(x, y, z)]
                    
                    if (id != 0 && !Minecraft.Blocks.isAlphaBlock(id)) {
                        // if (y == 0) map[index] = 0;
                        // else map[index] = y
                        map[index] = y + 1;
                        break;
                    }
                }
                
                index++
            }
		}
        
        // const end = performance.now();        
        // console.log("Finished building height map in " + (end - start) + " ms");
        
        return map;
    }
	buildLightingMap() {
		
        const debugMode = false;
        const start = performance.now();
        const ptr = this;
		const size = this.getSize();
        const sx = size.x;
        const sy = size.y;
        const sz = size.z;
		
        this.light = new Uint8Array(sx * sy * sz);
        const heightMap = this.buildHeightMap();
		
		let inc = 0;
		let id;
		let hit = false;
		let lateTest = [];
		const cdi = (x, y, z) => ptr.coordToIndex(x, y, z);
        const icd = (index) => ptr.indexToCoord(index);
		const getMapIndex = (x, z) => ((x * sz) + z);
        
        let lightTest = new Array(sx * sz);
        let lightTestIndex = 0;
        let lightTestTotal = 0;
        
        const addLightPos = (x, y, z, lightLevel) => {
            lightTest[lightTestTotal++] = [x, y, z, lightLevel];
            
            if (lightTestTotal >= lightTest.length) {
                lightTest = lightTest.concat(new Array(lightTest.length));
            }
        };
        
        let x, y, z;
        let height, sideHeight, index = 0;
        let sideXM, sideXP, sideZM, sideZP;
        
        // Fill side overhangs and main columns
		for (x = 0; x < sx; x++) {
			for (z = 0; z < sz; z++) {	
                sideXM = x > 0 ? heightMap[index - sz] : -1;
                sideXP = x < sx - 1 ? heightMap[index + sz] : -1;
                sideZM = z > 0 ? heightMap[index - 1] : -1;
                sideZP = z < sz - 1 ? heightMap[index + 1] : -1;

                height = heightMap[index]; 
                
                for (y = sy - 1; y >= height; y--) {
                
                    if (sideXM > -1 && y < sideXM) addLightPos(x - 1, y, z, 14);
                    if (sideXP > -1 && y < sideXP) addLightPos(x + 1, y, z, 14);
                    if (sideZM > -1 && y < sideZM) addLightPos(x, y, z - 1, 14);
                    if (sideZP > -1 && y < sideZP) addLightPos(x, y, z + 1, 14);
                    
                    if (y >= height) this.light[cdi(x, y, z)] = 15;
                }
                
                index++;
            }
        }

        let blockIndex, item, lightVal, currentLightVal;
        let xx, yy, zz;
        
        while (lightTestIndex < lightTest.length - 1) {
            item = lightTest[lightTestIndex++];
            
            if (!item) break;

            xx = item[0];
            yy = item[1];
            zz = item[2];
            
            blockIndex = cdi(xx, yy, zz);
            id = this.blocks[blockIndex];
            
            if (id == 0 || Minecraft.Blocks.isAlphaBlock(id, 0) || !Minecraft.Blocks.isSolidBlock(id)) {
                lightVal = item[3];
                currentLightVal = this.light[blockIndex];
                
                if (currentLightVal < lightVal) {
                    this.light[blockIndex] = lightVal;
                    
                    if (lightVal > 1) {
                        lightVal--;
                        addLightPos(xx - 1, yy, zz, lightVal);
                        addLightPos(xx + 1, yy, zz, lightVal);
                        addLightPos(xx, yy - 1, zz, lightVal);
                        addLightPos(xx, yy + 1, zz, lightVal);
                        addLightPos(xx, yy, zz - 1, lightVal);
                        addLightPos(xx, yy, zz + 1, lightVal);
                    }
                }
            }
        }

        if (debugMode) {
            let lightLevel = 0;
            index = 0;
            for (y = 0; y < sy; y++) {
                for (x = 0; x < sx; x++) {
                    for (z = 0; z < sz; z++) {
                        lightLevel = this.light[index];
                        // if (lightLevel == 15 || lightLevel == 0); this.blocks[index] = 20;
                        //else if (lightLevel == 0) ;// this.blocks[index] = 1;
                        if (lightLevel > 0 && lightLevel < 15) {
                            this.blocks[index] = 95;
                            this.data[index] = lightLevel;
                        }
                        index++;
                    }
                }
            }
        }
        
        /*
        
        {
            {
                
				hit = false;
				for (let y = sz.y-1; y >= 0; y--) {
					inc = cdi(x,y,z);
					id = this.blocks[inc];
					
					if (id == 0 && !hit) { // || (id == 0 && (x == 0 || x == sz.x-1 || z == 0 || z == sz.z-1))) {
						this.light[inc] = 15;
						this.blocks[inc] = 20;
					}
					else if (id > 0){
						this.light[inc] = 0;
						hit = true;
						this.blocks[inc] = 22;
                        
                        for (let yy = y; yy >= 0; yy--) {
                           lateTest.push([x,y,z]); 
                        }
                        
					}
					else {
						// this.blocks[inc] = 0;
						// this.light[inc] = 0;
						
						//lateTest.push(x,y,z);
					}
				}
			}
		}
		
		console.log("Half time setting light after %s ms!", (new Date().getTime() - ms));
		
		function testLighting(x,y,z,l) {
			if (ptr.light[cdi(x+1,y,z)] == l) return true;
			if (ptr.light[cdi(x-1,y,z)] == l) return true;
			if (ptr.light[cdi(x,y+1,z)] == l) return true;
			if (ptr.light[cdi(x,y-1,z)] == l) return true;
			if (ptr.light[cdi(x,y,z+1)] == l) return true;
			if (ptr.light[cdi(x,y,z-1)] == l) return true;
			return false;
		}
		
		
		var lvl = 15;	
		var eLight = [];
		
		for (var i = lateTest.length-1; i >= 0; i--) {
			inc = cdi(lateTest[i][0], lateTest[i][1], lateTest[i][2]);
			if (testLighting(lateTest[i][0], lateTest[i][1], lateTest[i][2], lvl)) {	
				this.light[inc] = lvl - 1;
				this.blocks[inc] = lvl - 1;
				eLight.push(lateTest[i]);
			}
		}
		
		var fLight = [];
		
		for (var lvl = 14; lvl > 0; lvl--) {
			fLight[lvl] = [];
			for (var i = fLight[lvl].length-1; i >= 0; i--) {
				inc = cdi(fLight[lvl][i][0], fLight[lvl][i][1], fLight[lvl][i][2]);
				if (testLighting(fLight[lvl][i][0], fLight[lvl][i][1], fLight[lvl][i][2], lvl)) {	
					this.light[inc] = lvl - 1;
					this.blocks[inc] = 95;
                    this.data[inc] = lvl - 1;
					fLight[lvl-1].push(fLight);
				}
			}
		}			
		
        */
        
        const end = performance.now();        
        console.log("Finished building light map in " + (end - start) + " ms");
        Game.scene.onBlockChange(0, 0, 0, sx - 1, sy - 1, sz - 1);
	}	
	blockDistribution()	{
		//var fBlock = fBlock instanceof Array ? fBlock : new Array(fBlock); //params.findBlock;
		//var replCnt = 0;
		var distrObj = {};
		var totalCnt = 0;
		var blockStr, i;
		
		for (i = 0; i < this.blocks.length; i++) {
			if (typeof distrObj[this.blocks[i]] === 'undefined') distrObj[this.blocks[i]] = {};
			if (typeof distrObj[this.blocks[i]][this.data[i]] === 'undefined') distrObj[this.blocks[i]][this.data[i]] = 0;
			distrObj[this.blocks[i]][this.data[i]]++;
			
		/*
			blockStr = (String(this.blocks[i]) + ":" + String(this.data[i]));
			if (typeof distrObj[blockStr] === 'undefined') {
				distrObj[blockStr] = 1;
				totalCnt++;
			}
			else {
				distrObj[blockStr]++;
			}
		*/
		
		}
		//console.log("Block Distribution: %o", distrObj);
		return distrObj;

	}		

    rotate(axis, rotation) {
        const xs = this.x;
        const ys = this.y;
        const zs = this.z;
        let output = null;
        
        if (rotation == 180) {
            output = new Schematic(xs, ys, zs);
        }
        else {
            if (axis == 0) output = new Schematic(xs, zs, ys);
            else if (axis == 1) output = new Schematic(zs, ys, xs);
            else output = new Schematic(ys, xs, zs);
        }
        
        const map = this.getRotationRemapper(axis, rotation, [xs, ys, zs]);
        const blocks = this.blocks;
        const data = this.data;
        
        const newBlocks = output.blocks;
        const newData = output.data;

        const xsn = output.x;
        const zsn = output.z;
        const xzsn = xsn * zsn

        let newIndex = 0;
        let index = 0;
        let mapPos;
        
        let blockId = 0;
        let blockData = 0;
        
        for (let y = 0; y < ys; y++) {
            for (let z = 0; z < zs; z++) {
                for (let x = 0; x < xs; x++) {
                    mapPos = map(x, y, z);
                    newIndex = ((mapPos[1] * xzsn) + (mapPos[2] * xsn) + mapPos[0]);
                    
                    blockId = blocks[index];
                    blockData = data[index];
                    
                    if (axis == 1) blockData = Minecraft.Blocks.getRotatedBlockData(blockId, blockData, rotation);
                    
                    newBlocks[newIndex] = blockId;
                    newData[newIndex] = blockData;
                    index++;
                }
            }
        }
        
        return output;
    }
    getRotationRemapper(axis, rotation, size) {       
        const xs = size[0] - 1;
        const ys = size[1] - 1;
        const zs = size[2] - 1;
        
        switch(axis) {
            case 0: {
                // need to fix this
                switch(rotation) {
                    case 90: return (x, y, z) => [x, zs - z, y];
                    case 180: return (x, y, z) => [x, ys - y, zs - z];
                    case 270: return (x, y, z) => [x, z, ys - y];
                }
            }
            case 1: {
                switch(rotation) {
                    case 90: return (x, y, z) => [zs - z, y, x];
                    case 180: return (x, y, z) => [xs - x, y, zs - z];
                    case 270: return (x, y, z) => [z, y, xs - x];
                }
            }            
            case 2: {
                switch(rotation) {
                    case 90: return (x, y, z) => [ys - y, x, z];
                    case 180: return (x, y, z) => [xs - x, ys - y, z];
                    case 270: return (x, y, z) => [y, xs - x, z];
                }
            }
        }
        
        return (x, y, z) => [x, y, z];     
    }

    static fromBase64(base64) {
        const byteData = _window.atob(base64);
        return new Schematic().parseSchematicFile(byteData);
    }
};

_window.Cubical = new (function Cubical() {
    this._group = true;   
	const _cubical = this;
	
	this.Lib = new (function Lib() {
        this._group = true;
		
		this.WeightedList = class WeightedList {

			constructor(list = [], ready = false) {
				this.list = list;
				this.weightTotal;
				this.weightList = [];
				this.weightIndex = 0;
				if (ready) this.ready();
			}
		
			update() {
				
				var weightTotal = 0;
				for (var inc = 0; inc < this.list.length; inc++) {
					
					this.list[inc].minWeight = weightTotal;
					weightTotal+= this.list[inc].weight === -1 ? parseInt(100 / this.list.length) : this.list[inc].weight ;
					this.list[inc].maxWeight = weightTotal;
				}
				this.weightTotal = weightTotal;
			
			}

			add(item, weight) {
				if (typeof item.item !== 'undefined') {
					item.weight =  typeof item.weight === 'undefined' ? -1 : item.weight;
					this.list.push(item);
				}
				else {
					
					if (typeof item === 'undefined') return null;
					if (typeof weight === 'undefined') {
						this.list.push({item: item, weight: -1});
					}
					else {
						this.list.push({item: item, weight: weight});
					}
				}
			}

			ready(arraySize = 10000) {
				this.update();
				this.weightList = new Array(arraySize);
				
				for (var i = 0; i < this.weightList.length; i++) {
					var rngWeight = Math.floor(Math.random() * this.weightTotal);
					
					for (var inc = 0; inc < this.list.length; inc++) {
						if (rngWeight >= (this.list[inc].minWeight) && rngWeight < this.list[inc].maxWeight) {
							this.weightList[i] = inc;
							break;
						}
					}			
				}
				this.weightIndex = 0;
			}
			
			next() {
				
				this.weightIndex = this.weightIndex >= this.weightList.length-1 ? 0 : this.weightIndex + 1;
				return this.list[this.weightList[this.weightIndex]].item;

			}
			
			loadString(str) {
				try {
					var strArray = String(str).split(",");
					strArray = strArray.length < 2 ? new Array(str) : strArray;
					
					for (var inc = 0; inc < strArray.length; inc++) {
						var weight = 100/strArray.length;
						var strItem = String(strArray[inc]).toLowerCase();
						var pctPos = strItem.indexOf("%");
						if (pctPos !== -1) {
							weight = parseInt(strItem.slice(0, pctPos));
							strItem = strItem.slice(pctPos+1);
						}
						this.add(strItem, weight);
					}
				}
				catch(e) { 
					$err.handle(e);
					return false;
				}
			}

			toString() {
				return String("Weighted List" + "[" + this.list.length + "]");
			}
		};

		this.VoxelWorld = class VoxelWorld {
			constructor() {
				this.chunks = new Map();
				this.chunkMin = null;
				this.chunkMax = null;
                this.history = new _cubical.Lib.EditHistory();
				this.fileInfo = {name: "VoxelWorld", extra: {flying: true}};
				this.total = 0;
				this.buffer = null;
                this.worldGen = null;
			}
            onTick() {
                
                if (this.worldGen != null) {
                    const cx = Game.player.x >> 4;
                    const cy = Game.player.y >> 4;
                    const cz = Game.player.z >> 4;
                    
                    if (this.lastPlayerChunk 
                        && cx == this.lastPlayerChunk[0] 
                        && cy == this.lastPlayerChunk[1]
                        && cz == this.lastPlayerChunk[2]) {
                        
                        return;
                    }

                    const radius = 2;
                    
                    for (let x = cx - radius; x <= cx + radius; x++) {
                        for (let y = cy - radius; y <= cy + radius; y++) {
                            for (let z = cz - radius; z <= cz + radius; z++) {
                    
                                const chunkId = this.getChunkId(x, y, z);
                                const currentChunk = this.chunks.get(chunkId);
                                
                                if (!currentChunk) {                    
                                    this.addGeneratedChunk(x, y, z);
                                    Game.scene.onBlockChange(x * 16, y * 16, z * 16, (x + 1) * 16 - 1, (y + 1) * 16 - 1, (z + 1) * 16 - 1);
                                }
                            }
                        }
                    }
                    
                    this.lastPlayerChunk = [cx, cy, cz];
                }
            }
			addChunk(chunk) {
				const cx = chunk.cx;
                const cy = chunk.cy;
                const cz = chunk.cz;
                
				if (!this.chunkMin) {
					this.chunkMin = [cx, cy, cz];
					this.chunkMax = [cx, cy, cz];
				}
				else {
					if (cx < this.chunkMin[0]) this.chunkMin[0] = cx;
					if (cy < this.chunkMin[1]) this.chunkMin[1] = cy;
					if (cz < this.chunkMin[2]) this.chunkMin[2] = cz;
					
					if (cx > this.chunkMax[0]) this.chunkMax[0] = cx;
					if (cy > this.chunkMax[1]) this.chunkMax[1] = cy;
					if (cz > this.chunkMax[2]) this.chunkMax[2] = cz;
				}
				
				this.chunks.set(chunk.chunkId, chunk);
				this.total = this.chunks.size;
                
				if (this.buffer) this.buffer.addChunkBuffer(cx, cy, cz);
                
                return chunk;
			}
			addEmptyChunk(cx, cy, cz) {
				const chunkId = this.getChunkId(cx, cy, cz);
                const currentChunk = this.chunks.get(chunkId);
                
                if (currentChunk) return currentChunk;
                
                return this.addChunk(new _cubical.Lib.VoxelChunk(chunkId, cx, cy, cz));
			}
            addGeneratedChunk(cx, cy, cz) {
				const chunkId = this.getChunkId(cx, cy, cz);
                const currentChunk = this.chunks.get(chunkId);
                
                if (currentChunk) return currentChunk;
                
                return this.addChunk(this.worldGen.generateChunk(cx, cy, cz));
            }
			getChunkId(cx, cy, cz) {
				return VoxelWorld.getChunkId(cx, cy, cz);
			}
			getChunk(cx, cy, cz) {
				return this.chunks.get(this.getChunkId(cx, cy, cz));
			}	
            hasChunkData(cx, cy, cz){
                return this.chunks.has(this.getChunkId(cx, cy, cz));
            }
            needsChunkGenerated(cx, cy, cz) {
                if (this.worldGen == null) return false;
                
                return this.worldGen.hasGeneratedChunk(cx, cy, cz);
            }
            generateChunk(cx, cy, cz) {               
                return this.worldGen == null ? this.addEmptyChunk(cx, cy, cz) : this.addGeneratedChunk(cx, cy, cz);
            }
            removeChunk(cx, cy, cz) {
				this.chunks.delete(this.getChunkIndex(cx, cy, cz));
				this.total--;
			}
			getChunkSize() {
				return this.chunkMin == null
                    ? [0, 0, 0]
                    : [
                        this.chunkMax[0] - this.chunkMin[0] + 1,
                        this.chunkMax[1] - this.chunkMin[1] + 1,
                        this.chunkMax[2] - this.chunkMin[2] + 1
                    ];
			}
			getChunkBounds() {
                return this.chunkMin == null || this.chunkMax == null ? null : [this.chunkMin, this.chunkMax];
            }
            getSize() {
				var cs = this.getChunkSize();
				return {x: cs[0]*16, y: cs[1]*16, z: cs[2]*16};
			}
			getOffset() {
				return [0, 0, 0];
			}
			getInfo() {
				return this.info;
			}
			getSpawn() {
				const min = this.chunkMin;
                if (min == null) return [0, 10, 0];
                
                return [min[0] * 16, min[1] * 16, min[2] * 16];
			}
			
			getBlock(x, y, z) {
				const chunk = this.getChunk(x >> 4, y >> 4, z >> 4);
				if (!chunk) return {id: 0, data: 0};
                
                return chunk.getBlock(x, y, z);
			}
			getBlockId(x, y, z) {
				const chunk = this.getChunk(x >> 4, y >> 4, z >> 4);
				if (!chunk) return null;
				return chunk.getBlockId(x, y, z);
			}
			getBlockData(x, y, z) {
				var chunk = this.getChunk(x >> 4, y >> 4, z >> 4);
				if (!chunk) return null;
				return chunk.getBlockData(x, y, z);
			}
            setBlock(x, y, z, id, data, update = true) {
				var chunk = this.getChunk(x >> 4, y >> 4, z >> 4);
				if (!chunk) {
					chunk = this.generateChunk(x >> 4, y >> 4, z >> 4);		
				}
                
                chunk.setBlock(x, y, z, id, data);

				if (update) Game.scene.onBlockChange(x, y, z);
			}
            getHighestBlock(x, z, minY, maxY) {
                
                for (var y = maxY; y >= minY; --y) {
                    let id = this.getBlockId(x, y, z);
                    if (id === null) continue;
                    
                    let data = this.getBlockData(x, y, z);
                    if (Minecraft.Blocks.isSolidBlock(id, data)) {
                        return y;
                    }
                }

                return minY;			
            }
            insertBlockList(blockList) {
                if (!blockList || !(blockList.length > 0)) return;

                for (let i = 0; i < blockList.length; i++) {
                    const block = blockList[i];
                    this.setBlock(block.x, block.y, block.z, block.id, block.data);
                    
                    Minecraft.Blocks.changeBlock(this, block.x, block.y, block.z, block.id, block.data, block.id === 0);
                }
            }
            insertShape(shp, x, y, z) {                
                for (var i = 0; i < shp.data.length; i += 5) {
                    this.setBlock(shp.data[i] + x, shp.data[i + 1] + y, shp.data[i + 2] + z, shp.data[i + 3], shp.data[i + 4], false);
                }
                
                if (Game && Game.getShape() == this) {                   
                    const start = [shp.minX, shp.minY, shp.minZ]; 
                    const end = [shp.maxX, shp.maxY, shp.maxZ];
                    
                    Game.scene.onBlockChange(...start, ...end);
                }
			}
			insertSchematic(sch, x, y, z, includeAir = false, useMask = false) {              
                useMask = useMask && typeof(sch.mask) !== 'undefined' 
                
                const ofs = sch.offset ? sch.offset : [0, 0, 0];
                const size = sch.getSize();
                const csx = size.x;
                const csy = size.y;
                const csz = size.z;                
                
                let wx, wy, wz;
                let blockId;
                let childIndex = -1;

                for (let yy = 0; yy < csy; yy++) {
                    wy = yy + y + ofs[1];
                    
                    for (let zz = 0; zz < csz; zz++) {
                        wz = zz + z + ofs[2];
                        
                        for (let xx = 0; xx < csx; xx++) {
                            wx = xx + x + ofs[0];
                            childIndex++;

                            if (useMask && !sch.mask.getBit(xx, yy, zz)) continue;
                            
                            blockId = sch.blocks[childIndex];
                            if (blockId > 0 || useMask || includeAir) {                               
                                this.setBlock(wx, wy, wz, blockId, sch.data[childIndex], false);
                            }
                        }
                    }
                }
                
                if (Game && Game.getShape() == this) {
                    const startPos = [x + ofs[0], y + ofs[1], z + ofs[2]];
                    const endPos = [size.x + startPos[0] - 1, size.y + startPos[1] - 1, size.z + startPos[2] - 1];
                    
                    Game.scene.onBlockChange(...startPos, ...endPos);
                }
			}
            mergeWorld(world) {
                world.chunks.forEach((v, k, m) => {
					this.addChunk(v);
                }); 

                if (Game && Game.getShape() == this) {
                    const min = world.chunkMin;
                    const max = world.chunkMax;
                    
                    if (!min || !max) return;
                    
                    const startPos = [min[0] * 16, min[1] * 16, min[2] * 16];
                    const endPos = [max[0] * 16, max[1] * 16, max[2] * 16];
                    
                    // Game.scene.onBlockChange(...startPos, ...endPos);
                }
                
            }
            extractSchematic(start = null, end = null, useMask = false) {
                
                if (start == null) start = [0, 0, 0];
                if (end == null) end = [this.x - 1, this.y - 1, this.z - 1];
                
                useMask = useMask && typeof(this.mask) !== 'undefined';
                
                var minPos = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.min(start[2], end[2])];
                var maxPos = [Math.max(start[0], end[0]), Math.max(start[1], end[1]), Math.max(start[2], end[2])];
                var size = [maxPos[0]-minPos[0] + 1, maxPos[1]-minPos[1] + 1, maxPos[2]-minPos[2] + 1];

                var sch = new Schematic(...size);
                var mask = useMask ? new Cubical.Lib.VoxelBitMask(...size) : null;
                var block;
                
                for (var x = minPos[0]; x <= maxPos[0]; x++) {
                    for (var y = minPos[1]; y <= maxPos[1]; y++) {
                        for (var z = minPos[2]; z <= maxPos[2]; z++) {
                            if (useMask) {
                                if (this.mask.getBit(x, y, z)) {
                                    block = this.getBlock(x, y, z);
                                    sch.setBlock(x-minPos[0], y-minPos[1], z-minPos[2], block.id, block.data);
                                    mask.setBit(x-minPos[0], y-minPos[1], z-minPos[2], true);
                                }
                            }
                            else {
                                block = this.getBlock(x, y, z);
                                if (block.id > 0) sch.setBlock(x-minPos[0], y-minPos[1], z-minPos[2], block.id, block.data);                        
                            }
                        }
                    }
                }
                
                var name = this.fileInfo ? this.fileInfo.name + "-Copy" : "ClipboardCopy";
                sch.fileInfo = {file: "None", ext: "sch", name: name, type: "sch", data: null};
                if (useMask) sch.mask = mask;
                
                return sch;
            }

			toSchematic() {
				
			}
            static getChunkId(cx, cy, cz) {
				var result = 5519;
				result = 3779 * result + cx;
				result = 3779 * result + cy;
				result = 3779 * result + cz;
				return result;
            }
            static fromSchematic(shp) {
                const world = new VoxelWorld();
                world.insertSchematic(shp, 0, 0, 0);
                return world;
            }
        };
		
		this.VoxelChunk = class VoxelChunk {
			constructor(id, cx, cy, cz, blocks = null, data = null) {
				const chunkSize = 16;
				const blockTotal = chunkSize * chunkSize * chunkSize;
                
                this.setChunkPosition(cx, cy, cz);

				this.blocks = blocks ? blocks : new Uint8Array(blockTotal);
				this.data = data ? data : new Uint8Array(blockTotal);
				this.empty = true;
			}
			
			coordToIndex(x, y, z) {
				const index = ((y + this.oy) << 8) + ((z + this.oz) << 4) + (x + this.ox);
			}
			indexToCoord(index) {
				const y = index >> 8
				const z = (index - y) >> 4;
				const x = index - z - y;
				return [x, y, z];
			}
			getBlock(x, y, z) {
				const index = ((y + this.oy) << 8) + ((z + this.oz) << 4) + (x + this.ox);
				return {id: this.blocks[index], data: this.data[index]};
			}
			getBlockId(x, y, z) {
				const index = ((y + this.oy) << 8) + ((z + this.oz) << 4) + (x + this.ox);
				return this.blocks[index];
			}
			getBlockData(x, y, z) {
				const index = ((y + this.oy) << 8) + ((z + this.oz) << 4) + (x + this.ox);
				return this.data[index];
			}
			setBlock(x, y, z, id, data) {
				const index = ((y + this.oy) << 8) + ((z + this.oz) << 4) + (x + this.ox);
				this.blocks[index] = id;
				this.data[index] = data;
			}
            setChunkPosition(cx, cy, cz) {
				const chunkSize = 16;
                
                this.chunkId = _cubical.Lib.VoxelWorld.getChunkId(cx, cy, cz);
                this.cx = cx;
                this.cy = cy;
                this.cz = cz;
                this.ox = cx * -chunkSize;
                this.oy = cy * -chunkSize;
                this.oz = cz * -chunkSize;
            }
		};
		
        this.VoxelBitMask = class VoxelBitMask {
            constructor(x, y, z, data = null) {
                this.x = x;
                this.y = y;
                this.z = z;
                this.xz = x * z;
                this.data = (data != null ? data : new Uint8Array(Math.ceil((x * y * z) / 8)));
            }
            setBit(x, y, z, mask = true, index = -1) {               
                const coordIndex = index != -1 ? index : (y * this.xz) + (z * this.x) + x;
                const bitIndex = coordIndex & 7;
                const byteIndex = coordIndex >> 3;

                if (mask === true) this.data[byteIndex] |= (1 << bitIndex);
                else this.data[byteIndex] &= ~(1 << bitIndex);
            }
            getBit(x, y, z, index = -1) {
                const coordIndex = index != -1 ? index : (y * this.xz) + (z * this.x) + x;
                const bitIndex = coordIndex & 7;
                const byteIndex = coordIndex >> 3;
                
                return ((this.data[byteIndex] & (1 << bitIndex)) !== 0);
            }
            clone() {
                return new VoxelBitMask(this.x, this.y, this.z, this.data.slice());
            }
        }
        
		this.VoxelShape = class VoxelShape {
			constructor(includeAir = false) {
				this.data = [];
				this.minX = 0;
				this.minY = 0;
				this.minZ = 0;
				this.maxX = 0;
				this.maxY = 0;
				this.maxZ = 0;
				this.cnt = 0;
                this.includeAir = includeAir;
				this.useOffset = false;
			}
			add(x, y, z, id, data) {
                
                if (!this.includeAir && id == 0) return;
				else if (id < 0 || data < 0 || data > 15) return;
				
				if (this.cnt == 0) {
					this.minX = this.maxX = x;
					this.minY = this.maxY = y;
					this.minZ = this.maxZ = z;
				}
				else {
					if (x < this.minX) this.minX = x;
					if (y < this.minY) this.minY = y;
					if (z < this.minZ) this.minZ = z;
					
					if (x > this.maxX) this.maxX = x;
					if (y > this.maxY) this.maxY = y;
					if (z > this.maxZ) this.maxZ = z;
				}
			
				this.data.push(x,y,z,id,data);
				this.cnt++;
			}
			setBlock(x,y,z,id,data) {
				this.add(x,y,z,id,data);
			}
			setBlockCache(cache,x,y,z,id,data) {
				if (cache) return;
				this.add(x,y,z,id,data);
			}
			getBlock(x, y, z) {
				if (this.useOffset) {
					x += this.minX; y += this.minY; z += this.minZ;
				}
				for (var i = 0; i < this.data.length; i += 5) {
					if (this.data[i] == x && this.data[i+1] == y && this.data[i+2] == z) {
						return {id: this.data[i+3], data: this.data[i+4]};
					}
				}
				return {id: 0, data: 0};
			}
			getBlockId(x, y, z) {
				if (this.useOffset) {
					x += this.minX; y += this.minY; z += this.minZ;
				}
				for (var i = 0; i < this.data.length; i += 5) {
					if (this.data[i] == x && this.data[i+1] == y && this.data[i+2] == z) {
						return this.data[i+3];
					}
				}
				return 0;
			}
			getBlockData(x, y, z) {
				if (this.useOffset) {
					x += this.minX; y += this.minY; z += this.minZ;
				}
				for (var i = 0; i < this.data.length; i += 5) {
					if (this.data[i] == x && this.data[i+1] == y && this.data[i+2] == z) {
						return this.data[i+4];
					}
				}
				return 0;
			}
			getSize() {
				if (this.cnt == 0) return {x: 0, y: 0, z: 0};
				
				return {
					x: this.maxX - this.minX + 1,
					y: this.maxY - this.minY + 1,
					z: this.maxZ - this.minZ + 1
				};
			}
			getOffset() {
				return [this.minX, this.minY, this.minZ];
			}
            getDensity() {
                const size = this.getSize();
                const volume = size[0] * size[1] * size[2];
                
                return this.cnt / volume;
            }
            checkCoords(x, y, z) {
                if (x < this.minX || x >= this.maxX || y < this.minY || y >= this.maxY || z < this.minZ || z >= this.maxZ ) return false; 
                return true;
            }
            hasChunkData(cx, cy, cz){
                const chunkSize = 16;       
                return this.checkCoords(cx * chunkSize, cy * chunkSize, cz * chunkSize)
            }
            offsetBlocks(x, y, z) {
				const data = this.data;
                for (var i = 0; i < data.length; i += 5) {
					data[i] += x;
                    data[i+1] += y;
                    data[i+2] += z;
				}
                
				this.minX += x;
				this.minY += y;
				this.minZ += z;
				this.maxX += x;
				this.maxY += y;
				this.maxZ += z;
            }
			insertShape(shp,x,y,z) {
				for (var i = 0; i < shp.data.length; i+=5) {
					this.setBlock(shp.data[i]+x, shp.data[i+1]+y, shp.data[i+2]+z, shp.data[i+3], shp.data[i+4]);
				}
			}
			toSchematic(buildMask = false) {
				
				const schSize = this.getSize();
				const offset = [this.minX, this.minY, this.minZ];
				
				function coordToIndex(x, y, z) {
					return (y * (schSize.x * schSize.z)) + (z * schSize.x) + x;
				}
				
				const totalBlocks = schSize.x * schSize.y * schSize.z;
				const blocks = new Uint8Array(totalBlocks);
				const data = new Uint8Array(totalBlocks);
                const mask = buildMask ? new _cubical.Lib.VoxelBitMask(schSize.x, schSize.y, schSize.z) : null;

				let index = 0;
                let x, y, z;
				for (let i = 0; i < this.data.length; i += 5) {
                    x = this.data[i] - offset[0];
                    y = this.data[i+1] - offset[1];
                    z = this.data[i+2] - offset[2];
                    
					index = coordToIndex(x, y, z);
					blocks[index] = this.data[i+3];
					data[index] = this.data[i+4];
                    
                    if (buildMask) mask.setBit(x, y, z, true);
				}
				
				const sch = new Schematic(schSize.x, schSize.y, schSize.z, blocks, data);
				sch.offset = this.getOffset();
                if (buildMask) sch.mask = mask;
				
				return sch;
			}
			fromBase64(str) {
				const jsonStr = window.atob(str);
				const jsonObj = JSON.parse(jsonStr);
				
				this.minX = jsonObj.min[0];
				this.minY = jsonObj.min[1];
				this.minZ = jsonObj.min[2];
				
				this.maxX = jsonObj.max[0];
				this.maxY = jsonObj.max[1];
				this.maxZ = jsonObj.max[2];
				
				this.data = jsonObj.data;
				this.cnt = jsonObj.data.length / 5;
				return this;
			}
			toBase64() {
				const jsonObj = {min: [this.minX, this.minY, this.minZ], max: [this.maxX, this.maxY, this.maxZ], data: this.data};
				return window.btoa(JSON.stringify(jsonObj));
			}
            clone() {
                const clone = new _cubical.Lib.VoxelShape();
				clone.data = this.data.slice();
				clone.minX = this.minX;
				clone.minY = this.minY;
				clone.minZ = this.minZ;
				clone.maxX = this.maxX;
				clone.maxY = this.maxY;
				clone.maxZ = this.maxZ;
				clone.cnt = this.cnt;
                clone.includeAir = this.includeAir;
				clone.useOffset = this.useOffset;
                
                return clone;
            }			 
        };
	
        this.VoxelBlock = class VoxelBlock {
            constructor(x = 0, y = 0, z = 0, id = 0, data = 0) {
                this.x = x;
                this.y = y;
                this.z = z;
                this.id = id;
                this.data = data;
            }            
        }
    
        this.WorldDataStore = class WorldDataStore {
            constructor(world) {
                this.world = world;
                this.entities = [];
                this.tileEntities = [];
                this.tileTicks = [];
                this.biomes = [];
                this.lastPlayerPos = [0,0,0];
                this.tileEntityCheckDistance = 8
                this.tileEntityViewDistance = 48;
                this.tileEntityViewDirty = true;
                this.tileEntityContentsDirty = true;
                this.renderableTileEntities = [];
                this.localTileEntities = [];
            }
            
            update() {
                
                const checkSq = Math.pow(this.tileEntityCheckDistance, 2);
                const distanceSq = Math.pow(Game.player.x - this.lastPlayerPos[0], 2)
                    + Math.pow(Game.player.y - this.lastPlayerPos[1], 2)
                    + Math.pow(Game.player.z - this.lastPlayerPos[2], 2);
                    
                if (distanceSq >= checkSq) {
                    this.updateLocalTileEntities();
                    this.lastPlayerPos = [Game.player.x, Game.player.y, Game.player.z];                    
                }                
            }
            
            updateLocalTileEntities() {
                this.localTileEntities = [];
                const viewSq = Math.pow(this.tileEntityViewDistance, 2);
                
                for (let i = 0; i < this.renderableTileEntities.length; i++) {
                    
                    const tileEnt = this.renderableTileEntities[i];
                    const distanceSq = Math.pow(Game.player.x - tileEnt.x, 2)
                        + Math.pow(Game.player.y - tileEnt.y, 2)
                        + Math.pow(Game.player.z - tileEnt.z, 2);
                    
                    if (distanceSq <= viewSq) {
                       this.localTileEntities.push(tileEnt); 
                    }                    
                }
            }
            
            draw() {
                this.update(); // TODO: Change this so it is separated from the draw call into normal update
                this.drawTileEntities();
            }
            
            drawTileEntities() {
                for (let i = 0; i < this.localTileEntities.length; i++) {
                    this.localTileEntities[i].draw();                    
                }
            }
            
            addEntity(entity) {
                this.entities.push(entity);                
                entity.onAddToWorld();
            }
            removeEntity(index) {
                const entity = this.entities.slice(index, 1);
                entity.onRemoveFromWorld();

            }
            
            addTileEntity(tileEntity) {
                this.tileEntities.push(tileEntity);
                tileEntity.onAddToWorld();
                
                if (tileEntity.needsDrawing()) {
                    this.renderableTileEntities.push(tileEntity);
                }
            }
            removeTileEntity(index) {
                const tileEntity = this.tileEntities.slice(index, 1);
                tileEntity.onRemoveFromWorld();
                
                if (tileEntity.needsDrawing()) {
                    const renderIndex = this.renderableTileEntities.indexOf(tileEntity);
                    
                    if (renderIndex > -1) {
                        this.renderableTileEntities.slice(renderIndex, 1);
                    }
                }
            }
            
            static fromSchematicNbt(nbt) {
                
            }
        }
    
		this.Vector3 = class Vector3 {
			
			constructor(x = 0, y = 0, z = 0) {
				this.x = x;
				this.y = y;
				this.z = z;
			}
			
			add(x, y, z) {
				if (x instanceof Vector3) return new Vector3(this.x + x.x, this.y + x.y, this.z + x.z)
				return new Vector3(this.x + x, this.y + y, this.z + z);
			}
			addSelf(x, y, z) {
				this.x + x;
				this.y + y;
				this.z + z;
			}
			addVec(vec) {
                return new Vector3(this.x + vec.x, this.y + vec.y, this.z + vec.z);
            }
            sub(x, y, z) {
				return new Vector3(this.x - x, this.y - y, this.z - z);
			}
            multiplyVec(vec) {
                let ret = [0,0,0];
                vec3.multiply(ret, [this.x, this.y, this.z], [vec.x, vec.y, vec.z]);
                return new Vector3(...ret);
            }
			dot(vec) {
                return Vector3.dot(this, vec);
            }
            clone() {
				return new Vector3(this.x, this.y, this.z);
			}
			addPos(x = 0, y = 0, z = 0) {
				return [this.x + x, this.y + y, this.z + z];
			}
			equals(vec) {
				return this.x == vec.x && this.y == vec.y && this.z == vec.z;
			}
			hashCode() {               
                return Vector3.hash(this.x, this.y, this.z);
			}

			static hash(x, y, z) {
				var result = 5519;
				result = 3779 * result + x;
				result = 3779 * result + y;
				result = 3779 * result + z;
				return result;
			}
            static dot(vecA, vecB) {
                return vecA.x * vecB.x + vecA.y * vecB.y + vecA.z * vecB.z;    
            }
            static add(vecA, vecB) {
                return new Vector3(vecA.x + vecB.x, vecA.y + vecB.y, vecA.z + vecB.z);    
            }
		};

        this.WorldGenerator = class WorldGenerator {
            
            constructor(settings) {
                this.settings = settings;
                this.chunks = new Set();
                this.data = null;
                this.isInfinite = true; //settings && settings.isInfinite ? true : false;
                this.minHeight = settings && settings.minHeight ? settings.minHeight : 0;
                this.maxHeight = settings && settings.maxHeight ? settings.maxHeight : 255;
                this.genBounds = settings && settings.bounds ? settings.bounds : [];
            }
            
            hasGeneratedChunk(cx, cy, cz) {
                const chunkId = WorldGenerator.getChunkId(cx, cy, cz);
                return this.chunks.has(chunkId);
            }
            
            generateChunk(cx, cy, cz) {
                const chunkSize = 16;
                const chunkId = WorldGenerator.getChunkId(cx, cy, cz);
                const chunk = new _cubical.Lib.VoxelChunk(chunkId, cx, cy, cz);            

                const xMin = cx * chunkSize;
                const yMin = cy * chunkSize;
                const zMin = cz * chunkSize;

                const xMax = xMin + chunkSize;
                const yMax = yMin + chunkSize;
                const zMax = zMin + chunkSize;
                
                const bounds = this.genBounds;
                const genFunction = this.getGeneratorFunction(chunk, cx, cy, cz);               
                
                for (let y = yMin; y < yMax; y++) {
                    if (!this.isInfinite && y < bounds[1] || y > bounds[4]) continue;
                    if (y < this.minHeight) continue;
                    if (y > this.maxHeight) break;
                    
                    for (let x = xMin; x < xMax; x++) {
                        if (!this.isInfinite && x < bounds[0] || x > bounds[3]) continue;
                    
                        for (let z = zMin; z < zMax; z++) {
                            if (!this.isInfinite && z < bounds[2] || z > bounds[5]) continue;
                            
                            genFunction(x, y, z);                            
                        }
                    }
                }
                
                this.chunks.add(chunkId);                
                return chunk;
            }

            getGeneratorFunction(chunk, cx, cy, cz) {              
                return (x, y, z) => {
                    chunk.setBlock(x, y, z, y == 0 ? 1 : 0, 0);
                };
            }
            
			static getChunkId(cx, cy, cz) {
				var result = 5519;
				result = 3779 * result + cx;
				result = 3779 * result + cy;
				result = 3779 * result + cz;
				return result;
			}
        }
        
        this.FlatWorldGenerator = class FlatWorldGenerator extends this.WorldGenerator {
            constructor(settings) {
                super(settings);
            }
            
            getGeneratorFunction(chunk, cx, cy, cz) {              
                return (x, y, z) => {
                    
                    let blockId = 0;
                    if (y >= 0 && y < 7) {
                        switch(true) {
                            case (y == 0): blockId = 7; break;
                            case (y > 0 && y <= 3): blockId = 1; break;
                            case (y > 3 && y <= 5): blockId = 3; break;
                            case (y == 6): blockId = 2; break;              
                        }
                    }
                    
                    chunk.setBlock(x, y, z, blockId, 0);
                };
            }
        }
        
        this.PerlinWorldGenerator = class PerlinWorldGenerator extends this.WorldGenerator {
            constructor(settings) {
                super(settings);
                this.generator = new _cubical.Lib.PerlinGenerator();
            }
            
            getGeneratorFunction(chunk, cx, cy, cz) {              
                const chunkSize = 16;
                const xOffset = cx * chunkSize;
                const zOffset = cz * chunkSize;
                
                const gen = this.generator;
                gen.setSeed(55531093);
                gen.setOffset([xOffset, zOffset]);
                
                const maxHeight = 64;
                const noiseArray = gen.generate2D(16, 16);
                const heightValue = (x, z) => {
                    return noiseArray[((x - xOffset) * 16 + (z - zOffset))] * maxHeight;
                };
                
                return (x, y, z) => {
                    let yTop = heightValue(x, z);
                    
                    if (y >= 0 && y <= yTop) {
                        chunk.setBlock(x, y, z, 1, 0);
                    }
                };
            }
        }

        this.PerlinGenerator = class PerlinGenerator {
            constructor(octaves = 3, falloff = 0.8, cycles = 48, seed = null, offset = null) {
                this.octaves = octaves;
                this.falloff = falloff;
                this.cycles = cycles;
                this.seed = seed === null ? Math.floor(Math.random() * 99999999 + 9999999) : seed;
                this.offset = offset;                
            }
            
            setOctaves(octaves) {
                this.octaves = octaves;
            }
            setFalloff(falloff) {
                this.falloff = falloff;
            }
            setCycles(cycles) {
                this.cycles = cycles;
            }
            setSeed(seed) {
                this.seed = seed;
            }
            setOffset(offset) {
                this.offset = offset;
            }
            
            updateGeneratorSettings() {
                PerlinGenerator._PerlinRNG.seed = this.seed;
                PerlinGenerator._PerlinGenerator.setRng(PerlinGenerator._PerlinRNG);
				PerlinGenerator._PerlinGenerator.noiseDetail(this.octaves, this.falloff);
            }
            generate1D(xSize) {
                this.updateGeneratorSettings();
                
                const noiseArray = new Float32Array(xSize);
                const scale = 1 / this.cycles;
                const xOffset = this.offset === null ? 0 : this.offset;

                let index = 0;
                
				for (let x = 0; x < xSize; x++) {
                    noiseArray[index++] = PerlinGenerator._PerlinGenerator.noise((x + xOffset) * scale);
                }
                
                return noiseArray;
            }
            generate2D(xSize, ySize) {
                this.updateGeneratorSettings();
                
                const noiseArray = new Float32Array(xSize * ySize);
                const scale = 1 / this.cycles;               
                const xOffset = this.offset === null ? 0 : this.offset[0];
                const yOffset = this.offset === null ? 0 : this.offset[1];
                
                let xScale, yScale;
                let index = 0;
                
				for (let x = 0; x < xSize; x++) {
                    xScale = (x + xOffset) * scale;
                    
					for (let y = 0; y < ySize; y++) {
                        yScale = (y + yOffset) * scale;
                        noiseArray[index++] = PerlinGenerator._PerlinGenerator.noise(xScale, yScale);
                    }
                }
                
                return noiseArray;
            }           
            generate3D(xSize, ySize, zSize) {
                this.updateGeneratorSettings();
                
                const noiseArray = new Float32Array(xSize * ySize * zSize);
                const scale = 1 / this.cycles;
                const xOffset = this.offset === null ? 0 : this.offset[0];
                const yOffset = this.offset === null ? 0 : this.offset[1];
                const zOffset = this.offset === null ? 0 : this.offset[2];
                
                let xScale, yScale, zScale;
                let index = 0;
                
				for (let x = 0; x < xSize; x++) {
                    xScale = (x + xOffset) * scale;
                    
					for (let y = 0; y < ySize; y++) {
                        yScale = (y + yOffset) * scale;
                        
                        for (let z = 0; z < zSize; z++) {
                            zScale = (z + zOffset) * scale;
                            noiseArray[index++] = PerlinGenerator._PerlinGenerator.noise(xScale, yScale, zScale);
                        }
                    }
                }
                
                return noiseArray;
            }
            
            static _init() {
                
                /* 
                // Perlin Generator Info
                // PerlinSimplex Object copied from
                // http://www.sjeiti.com/perlin-noise-versus-simplex-noise-in-javascript-final-comparison/
                // (Info from the author, Sjeiti)
                //
                // Both Perlin and PerlinSimplex are already instantiated as global variables. Both implement the same methods.
                // Simply call Perlin.noise(x,y,z) to get a noise value (y and z are optional).
                //
                // You can set the amount of octaves and falloff by calling Perlin.noisedetail(octaves,falloff). 
                // Octaves can be any whole number greater than zero (but the higher the number, the slower the render).
                // The falloff should be a floating point between 0 and 1 (0.5 usually works just fine).
                //
                // By default Math is used for random number generation. This works fine for static field but is useless for animation
                // because Math.random() cannot be seeded. For this example I've implemented a very simple pseudo random number
                // generator. You can very easily implement your own by setting Perlin.setRng(myRng) as long as it has the 'random' method.
                */
                
                PerlinGenerator._PerlinGenerator = function PerlinGenerator() {

                    var oRng = Math;

                    var p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];

                    var iOctaves = 1;
                    var fPersistence = 0.5;

                    var aOctFreq; // frequency per octave
                    var aOctPers; // persistence per octave
                    var fPersMax; // 1 / max persistence

                    var iXoffset;
                    var iYoffset;
                    var iZoffset;

                    // octFreqPers
                    var octFreqPers = function octFreqPers() {
                        var fFreq, fPers;
                        aOctFreq = [];
                        aOctPers = [];
                        fPersMax = 0;
                        for (var i=0;i<iOctaves;i++) {
                            fFreq = Math.pow(2,i);
                            fPers = Math.pow(fPersistence,i);
                            fPersMax += fPers;
                            aOctFreq.push( fFreq );
                            aOctPers.push( fPers );
                        }
                        fPersMax = 1 / fPersMax;
                    };
                    // setOffset
                    var setOffset = function setOffset(n) {
                        iXoffset = Math.floor(oRng.random()*256);
                        iYoffset = Math.floor(oRng.random()*256);
                        iZoffset = Math.floor(oRng.random()*256);
                    };
                    // init
                    setOffset();
                    octFreqPers();
                    //
                    // return
                    return {
                         noise: function(x,y,z) {

                            x = x||0;
                            y = y||0;
                            z = z||0;

                            var fResult = 0;
                            var fFreq, fPers;
                            var xf, yf, zf, u, v, w, xx, yy, zz;
                            var x1, y1, z1;
                            var X, Y, Z, A, B, AA, AB, BA, BB, hash;
                            var g1, g2, g3, g4, g5, g6, g7, g8;

                            x += iXoffset;
                            y += iYoffset;
                            z += iZoffset;

                            for (var i=0;i<iOctaves;i++) {
                                fFreq = aOctFreq[i];
                                fPers = aOctPers[i];

                                xx = x * fFreq;
                                yy = y * fFreq;
                                zz = z * fFreq;

                                xf = Math.floor(xx);
                                yf = Math.floor(yy);
                                zf = Math.floor(zz);

                                X = Math.floor(xf & 255);
                                Y = Math.floor(yf & 255);
                                Z = Math.floor(zf & 255);

                                xx -= xf;
                                yy -= yf;
                                zz -= zf;

                                u = xx * xx * xx * (xx * (xx*6 - 15) + 10);
                                v = yy * yy * yy * (yy * (yy*6 - 15) + 10);
                                w = zz * zz * zz * (zz * (zz*6 - 15) + 10);

                                A  = Math.round(p[X]) + Y;
                                AA = Math.round(p[A]) + Z;
                                AB = Math.round(p[Math.round(A+1)]) + Z;
                                B  = Math.round(p[Math.round(X+1)]) + Y;
                                BA = Math.round(p[B]) + Z;
                                BB = Math.round(p[Math.round(B+1)]) + Z;

                                x1 = xx-1;
                                y1 = yy-1;
                                z1 = zz-1;

                                hash = Math.round(p[Math.round(BB+1)]) & 15;
                                g1 = ((hash&1) === 0 ? (hash<8 ? x1 : y1) : (hash<8 ? -x1 : -y1)) + ((hash&2) === 0 ? hash<4 ? y1 : ( hash===12 ? x1 : z1 ) : hash<4 ? -y1 : ( hash===14 ? -x1 : -z1 ));

                                hash = Math.round(p[Math.round(AB+1)]) & 15;
                                g2 = ((hash&1) === 0 ? (hash<8 ? xx : y1) : (hash<8 ? -xx : -y1)) + ((hash&2) === 0 ? hash<4 ? y1 : ( hash===12 ? xx : z1 ) : hash<4 ? -y1 : ( hash===14 ? -xx : -z1 ));

                                hash = Math.round(p[Math.round(BA+1)]) & 15;
                                g3 = ((hash&1) === 0 ? (hash<8 ? x1 : yy) : (hash<8 ? -x1 : -yy)) + ((hash&2) === 0 ? hash<4 ? yy : ( hash===12 ? x1 : z1 ) : hash<4 ? -yy : ( hash===14 ? -x1 : -z1 ));

                                hash = Math.round(p[Math.round(AA+1)]) & 15;
                                g4 = ((hash&1) === 0 ? (hash<8 ? xx : yy) : (hash<8 ? -xx : -yy)) + ((hash&2) === 0 ? hash<4 ? yy : ( hash===12 ? xx : z1 ) : hash<4 ? -yy : ( hash===14 ? -xx : -z1 ));

                                hash = Math.round(p[BB]) & 15;
                                g5 = ((hash&1) === 0 ? (hash<8 ? x1 : y1) : (hash<8 ? -x1 : -y1)) + ((hash&2) === 0 ? hash<4 ? y1 : ( hash===12 ? x1 : zz ) : hash<4 ? -y1 : ( hash===14 ? -x1 : -zz ));

                                hash = Math.round(p[AB]) & 15;
                                g6 = ((hash&1) === 0 ? (hash<8 ? xx : y1) : (hash<8 ? -xx : -y1)) + ((hash&2) === 0 ? hash<4 ? y1 : ( hash===12 ? xx : zz ) : hash<4 ? -y1 : ( hash===14 ? -xx : -zz ));

                                hash = Math.round(p[BA]) & 15;
                                g7 = ((hash&1) === 0 ? (hash<8 ? x1 : yy) : (hash<8 ? -x1 : -yy)) + ((hash&2) === 0 ? hash<4 ? yy : ( hash===12 ? x1 : zz ) : hash<4 ? -yy : ( hash===14 ? -x1 : -zz ));

                                hash = Math.round(p[AA]) & 15;
                                g8 = ((hash&1) === 0 ? (hash<8 ? xx : yy) : (hash<8 ? -xx : -yy)) + ((hash&2) === 0 ? hash<4 ? yy : ( hash===12 ? xx : zz ) : hash<4 ? -yy : ( hash===14 ? -xx : -zz ));

                                g2 += u * (g1 - g2);
                                g4 += u * (g3 - g4);
                                g6 += u * (g5 - g6);
                                g8 += u * (g7 - g8);

                                g4 += v * (g2 - g4);
                                g8 += v * (g6 - g8);

                                fResult += ( (g8 + w * (g4 - g8))) * fPers;
                            }

                            return ( fResult * fPersMax + 1 ) * 0.5;
                        },noiseDetail: function(octaves,falloff) {
                            iOctaves = octaves||iOctaves;
                            fPersistence = falloff||fPersistence;
                            octFreqPers();
                        },setRng: function(r) {
                            oRng = r;
                            setOffset();
                            octFreqPers();
                        },toString: function() {
                            return "[object Perlin "+iOctaves+" "+fPersistence+"]";
                        }
                    };
                }();

                PerlinGenerator._PerlinSimplexGenerator = function PerlinSimplexGenerator() {	
                    
                    var F2 = 0.5 * (Math.sqrt(3) - 1);
                    var G2 = (3 - Math.sqrt(3)) / 6;
                    var G22 = 2 * G2 - 1;
                    var F3 = 1 / 3;
                    var G3 = 1 / 6;
                    var F4 = (Math.sqrt(5) - 1) / 4;
                    var G4 = (5 - Math.sqrt(5)) / 20;
                    var G42 = G4 * 2;
                    var G43 = G4 * 3;
                    var G44 = G4 * 4 - 1;
                    var aGrad3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
                    var grad4 = [[0, 1, 1, 1], [0, 1, 1, -1], [0, 1, -1, 1], [0, 1, -1, -1], [0, -1, 1, 1], [0, -1, 1, -1], [0, -1, -1, 1], [0, -1, -1, -1], [1, 0, 1, 1], [1, 0, 1, -1], [1, 0, -1, 1], [1, 0, -1, -1], [-1, 0, 1, 1], [-1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1], [1, 1, 0, 1], [1, 1, 0, -1], [1, -1, 0, 1], [1, -1, 0, -1], [-1, 1, 0, 1], [-1, 1, 0, -1], [-1, -1, 0, 1], [-1, -1, 0, -1], [1, 1, 1, 0], [1, 1, -1, 0], [1, -1, 1, 0], [1, -1, -1, 0], [-1, 1, 1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0], [-1, -1, -1, 0]];
                    var aPerm;
                    var simplex = [[0, 1, 2, 3], [0, 1, 3, 2], [0, 0, 0, 0], [0, 2, 3, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [1, 2, 3, 0], [0, 2, 1, 3], [0, 0, 0, 0], [0, 3, 1, 2], [0, 3, 2, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [1, 3, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [1, 2, 0, 3], [0, 0, 0, 0], [1, 3, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 3, 0, 1], [2, 3, 1, 0], [1, 0, 2, 3], [1, 0, 3, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 3, 1], [0, 0, 0, 0], [2, 1, 3, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 1, 3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [3, 0, 1, 2], [3, 0, 2, 1], [0, 0, 0, 0], [3, 1, 2, 0], [2, 1, 0, 3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [3, 1, 0, 2], [0, 0, 0, 0], [3, 2, 0, 1], [3, 2, 1, 0]];
                    var g;
                    var n0,
                        n1,
                        n2,
                        n3,
                        n4;
                    var s;
                    var c;
                    var sc;
                    var i,
                        j,
                        k,
                        l;
                    var t;
                    var x0,
                        y0,
                        z0,
                        w0;
                    var i1,
                        j1,
                        k1,
                        l1;
                    var i2,
                        j2,
                        k2,
                        l2;
                    var i3,
                        j3,
                        k3,
                        l3;
                    var x1,
                        y1,
                        z1,
                        w1;
                    var x2,
                        y2,
                        z2,
                        w2;
                    var x3,
                        y3,
                        z3,
                        w3;
                    var x4,
                        y4,
                        z4,
                        w4;
                    var ii,
                        jj,
                        kk,
                        ll;
                    var gi0,
                        gi1,
                        gi2,
                        gi3,
                        gi4;
                    var t0,
                        t1,
                        t2,
                        t3,
                        t4;
                    var oRng = Math;
                    var iOctaves = 1;
                    var fPersistence = 0.5;
                    var fResult,
                        fFreq,
                        fPers;
                    var aOctFreq;
                    var aOctPers;
                    var fPersMax;
                    var octFreqPers = function octFreqPers() {
                        var fFreq, fPers, i = 0;
                        aOctFreq = [];
                        aOctPers = [];
                        fPersMax = 0;
                        for (i = 0; i < iOctaves; i++) {
                            fFreq = Math.pow(2, i);
                            fPers = Math.pow(fPersistence, i);
                            fPersMax += fPers;
                            aOctFreq.push(fFreq);
                            aOctPers.push(fPers);
                        }
                        fPersMax = 1 / fPersMax;
                    };
                    var dot1 = function dot1(g, x) {
                        return g[0] * x;
                    };
                    var dot2 = function dot2(g, x, y) {
                        return g[0] * x + g[1] * y;
                    };
                    var dot3 = function dot3(g, x, y, z) {
                        return g[0] * x + g[1] * y + g[2] * z;
                    };
                    var dot4 = function dot4(g, x, y, z, w) {
                        return g[0] * x + g[1] * y + g[2] * z + g[3] * w;
                    };
                    var setPerm = function setPerm() {
                        var i;
                        var p = [];
                        for (i = 0; i < 256; i++) {
                            p[i] = Math.floor(oRng.random() * 256);
                        }
                        aPerm = [];
                        for (i = 0; i < 512; i++) {
                            aPerm[i] = p[i & 255];
                        }
                    };
                    var noise2d = function noise2d(x, y) {
                        s = (x + y) * F2;
                        i = Math.floor(x + s);
                        j = Math.floor(y + s);
                        t = (i + j) * G2;
                        x0 = x - (i - t);
                        y0 = y - (j - t);
                        if (x0 > y0) {
                            i1 = 1;
                            j1 = 0;
                        } else {
                            i1 = 0;
                            j1 = 1;
                        }
                        x1 = x0 - i1 + G2;
                        y1 = y0 - j1 + G2;
                        x2 = x0 + G22;
                        y2 = y0 + G22;
                        ii = i & 255;
                        jj = j & 255;
                        t0 = 0.5 - x0 * x0 - y0 * y0;
                        if (t0 < 0) {
                            n0 = 0;
                        } else {
                            t0 *= t0;
                            gi0 = aPerm[ii + aPerm[jj]] % 12;
                            n0 = t0 * t0 * dot2(aGrad3[gi0], x0, y0);
                        }
                        t1 = 0.5 - x1 * x1 - y1 * y1;
                        if (t1 < 0) {
                            n1 = 0;
                        } else {
                            t1 *= t1;
                            gi1 = aPerm[ii + i1 + aPerm[jj + j1]] % 12;
                            n1 = t1 * t1 * dot2(aGrad3[gi1], x1, y1);
                        }
                        t2 = 0.5 - x2 * x2 - y2 * y2;
                        if (t2 < 0) {
                            n2 = 0;
                        } else {
                            t2 *= t2;
                            gi2 = aPerm[ii + 1 + aPerm[jj + 1]] % 12;
                            n2 = t2 * t2 * dot2(aGrad3[gi2], x2, y2);
                        }
                        return 70 * (n0 + n1 + n2);
                    };
                    var noise3d = function noise3d(x, y, z) {
                        s = (x + y + z) * F3;
                        i = Math.floor(x + s);
                        j = Math.floor(y + s);
                        k = Math.floor(z + s);
                        t = (i + j + k) * G3;
                        x0 = x - (i - t);
                        y0 = y - (j - t);
                        z0 = z - (k - t);
                        if (x0 >= y0) {
                            if (y0 >= z0) {
                                i1 = 1;
                                j1 = 0;
                                k1 = 0;
                                i2 = 1;
                                j2 = 1;
                                k2 = 0;
                            } else if (x0 >= z0) {
                                i1 = 1;
                                j1 = 0;
                                k1 = 0;
                                i2 = 1;
                                j2 = 0;
                                k2 = 1;
                            } else {
                                i1 = 0;
                                j1 = 0;
                                k1 = 1;
                                i2 = 1;
                                j2 = 0;
                                k2 = 1;
                            }
                        } else {
                            if (y0 < z0) {
                                i1 = 0;
                                j1 = 0;
                                k1 = 1;
                                i2 = 0;
                                j2 = 1;
                                k2 = 1;
                            } else if (x0 < z0) {
                                i1 = 0;
                                j1 = 1;
                                k1 = 0;
                                i2 = 0;
                                j2 = 1;
                                k2 = 1;
                            } else {
                                i1 = 0;
                                j1 = 1;
                                k1 = 0;
                                i2 = 1;
                                j2 = 1;
                                k2 = 0;
                            }
                        }
                        x1 = x0 - i1 + G3;
                        y1 = y0 - j1 + G3;
                        z1 = z0 - k1 + G3;
                        x2 = x0 - i2 + F3;
                        y2 = y0 - j2 + F3;
                        z2 = z0 - k2 + F3;
                        x3 = x0 - 0.5;
                        y3 = y0 - 0.5;
                        z3 = z0 - 0.5;
                        ii = i & 255;
                        jj = j & 255;
                        kk = k & 255;
                        t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
                        if (t0 < 0) {
                            n0 = 0;
                        } else {
                            t0 *= t0;
                            gi0 = aPerm[ii + aPerm[jj + aPerm[kk]]] % 12;
                            n0 = t0 * t0 * dot3(aGrad3[gi0], x0, y0, z0);
                        }
                        t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
                        if (t1 < 0) {
                            n1 = 0;
                        } else {
                            t1 *= t1;
                            gi1 = aPerm[ii + i1 + aPerm[jj + j1 + aPerm[kk + k1]]] % 12;
                            n1 = t1 * t1 * dot3(aGrad3[gi1], x1, y1, z1);
                        }
                        t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
                        if (t2 < 0) {
                            n2 = 0;
                        } else {
                            t2 *= t2;
                            gi2 = aPerm[ii + i2 + aPerm[jj + j2 + aPerm[kk + k2]]] % 12;
                            n2 = t2 * t2 * dot3(aGrad3[gi2], x2, y2, z2);
                        }
                        t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
                        if (t3 < 0) {
                            n3 = 0;
                        } else {
                            t3 *= t3;
                            gi3 = aPerm[ii + 1 + aPerm[jj + 1 + aPerm[kk + 1]]] % 12;
                            n3 = t3 * t3 * dot3(aGrad3[gi3], x3, y3, z3);
                        }
                        return 32 * (n0 + n1 + n2 + n3);
                    };
                    var noise4d = function noise4d(x, y, z, w) {
                        s = (x + y + z + w) * F4;
                        i = Math.floor(x + s);
                        j = Math.floor(y + s);
                        k = Math.floor(z + s);
                        l = Math.floor(w + s);
                        t = (i + j + k + l) * G4;
                        x0 = x - (i - t);
                        y0 = y - (j - t);
                        z0 = z - (k - t);
                        w0 = w - (l - t);
                        c = 0;
                        if (x0 > y0) {
                            c = 0x20;
                        }
                        if (x0 > z0) {
                            c |= 0x10;
                        }
                        if (y0 > z0) {
                            c |= 0x08;
                        }
                        if (x0 > w0) {
                            c |= 0x04;
                        }
                        if (y0 > w0) {
                            c |= 0x02;
                        }
                        if (z0 > w0) {
                            c |= 0x01;
                        }
                        sc = simplex[c];
                        i1 = sc[0] >= 3 ? 1 : 0;
                        j1 = sc[1] >= 3 ? 1 : 0;
                        k1 = sc[2] >= 3 ? 1 : 0;
                        l1 = sc[3] >= 3 ? 1 : 0;
                        i2 = sc[0] >= 2 ? 1 : 0;
                        j2 = sc[1] >= 2 ? 1 : 0;
                        k2 = sc[2] >= 2 ? 1 : 0;
                        l2 = sc[3] >= 2 ? 1 : 0;
                        i3 = sc[0] >= 1 ? 1 : 0;
                        j3 = sc[1] >= 1 ? 1 : 0;
                        k3 = sc[2] >= 1 ? 1 : 0;
                        l3 = sc[3] >= 1 ? 1 : 0;
                        x1 = x0 - i1 + G4;
                        y1 = y0 - j1 + G4;
                        z1 = z0 - k1 + G4;
                        w1 = w0 - l1 + G4;
                        x2 = x0 - i2 + G42;
                        y2 = y0 - j2 + G42;
                        z2 = z0 - k2 + G42;
                        w2 = w0 - l2 + G42;
                        x3 = x0 - i3 + G43;
                        y3 = y0 - j3 + G43;
                        z3 = z0 - k3 + G43;
                        w3 = w0 - l3 + G43;
                        x4 = x0 + G44;
                        y4 = y0 + G44;
                        z4 = z0 + G44;
                        w4 = w0 + G44;
                        ii = i & 255;
                        jj = j & 255;
                        kk = k & 255;
                        ll = l & 255;
                        t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
                        if (t0 < 0) {
                            n0 = 0;
                        } else {
                            t0 *= t0;
                            gi0 = aPerm[ii + aPerm[jj + aPerm[kk + aPerm[ll]]]] % 32;
                            n0 = t0 * t0 * dot4(grad4[gi0], x0, y0, z0, w0);
                        }
                        t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
                        if (t1 < 0) {
                            n1 = 0;
                        } else {
                            t1 *= t1;
                            gi1 = aPerm[ii + i1 + aPerm[jj + j1 + aPerm[kk + k1 + aPerm[ll + l1]]]] % 32;
                            n1 = t1 * t1 * dot4(grad4[gi1], x1, y1, z1, w1);
                        }
                        t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
                        if (t2 < 0) {
                            n2 = 0;
                        } else {
                            t2 *= t2;
                            gi2 = aPerm[ii + i2 + aPerm[jj + j2 + aPerm[kk + k2 + aPerm[ll + l2]]]] % 32;
                            n2 = t2 * t2 * dot4(grad4[gi2], x2, y2, z2, w2);
                        }
                        t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
                        if (t3 < 0) {
                            n3 = 0;
                        } else {
                            t3 *= t3;
                            gi3 = aPerm[ii + i3 + aPerm[jj + j3 + aPerm[kk + k3 + aPerm[ll + l3]]]] % 32;
                            n3 = t3 * t3 * dot4(grad4[gi3], x3, y3, z3, w3);
                        }
                        t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
                        if (t4 < 0) {
                            n4 = 0;
                        } else {
                            t4 *= t4;
                            gi4 = aPerm[ii + 1 + aPerm[jj + 1 + aPerm[kk + 1 + aPerm[ll + 1]]]] % 32;
                            n4 = t4 * t4 * dot4(grad4[gi4], x4, y4, z4, w4);
                        }
                        return 27.0 * (n0 + n1 + n2 + n3 + n4);
                    };
                    setPerm();
                    return {
                        noise : function (x, y, z, w) {
                            fResult = 0;
                            for (g = 0; g < iOctaves; g++) {
                                fFreq = aOctFreq[g];
                                fPers = aOctPers[g];
                                switch (arguments.length) {
                                case 4:
                                    fResult += fPers * noise4d(fFreq * x, fFreq * y, fFreq * z, fFreq * w);
                                    break;
                                case 3:
                                    fResult += fPers * noise3d(fFreq * x, fFreq * y, fFreq * z);
                                    break;
                                default:
                                    fResult += fPers * noise2d(fFreq * x, fFreq * y);
                                }
                            }
                            return (fResult * fPersMax + 1) * 0.5;
                        },
                        noiseDetail : function (octaves, falloff) {
                            iOctaves = octaves || iOctaves;
                            fPersistence = falloff || fPersistence;
                            octFreqPers();
                        },
                        setRng : function (r) {
                            oRng = r;
                            setPerm();
                        },
                        toString : function () {
                            return "[object PerlinSimplex " + iOctaves + " " + fPersistence + "]";
                        }
                    };
                }();

                PerlinGenerator._PerlinRNG = function PerlinRNG() {
                    var iMersenne = 2147483647;
                    var rnd = function(seed) {
                        if (arguments.length) {
                            that.seed = arguments[0];
                        }
                        that.seed = that.seed*16807%iMersenne;
                        return that.seed;
                    };
                    var that = {
                        seed: 123,
                        rnd: rnd,
                        random: function(seed) {
                            if (arguments.length) {
                                that.seed = arguments[0];
                            }
                            return rnd()/iMersenne;
                        }
                    };
                    return that;
                }();
            }
        }

		this.WorkerRequest = class WorkerRequest {
		
			constructor(id, action, data, callback, type = "request", force = false, ref = null, reply = true) {
				this.id = id;
				this.action = action;
				this.data = data;
				this.callback = callback;
                this.type = type;
				this.force = force;
                this.reply = reply;
				this.open = true;
				this.response = null;
                this.update = null;
				this.ref = ref;
			}
			onUpdate(msg) {
				this.update = msg;
				this.callback(this, "update");
			}
			onFinish(msg) {
				this.response = msg;
				this.open = false;
				this.callback(this, "finish");
			}
			toMessage() {			
				return {request: {id: this.id, action: this.action, type: this.type, data: this.data, force: this.force}};				
			}
		};

		this.SphereIterator = class SphereIterator {
		
			constructor(callback, xSize, ySize, zSize) {
				if (this.setCallback(callback) === false) return false;
				
                this.setSize(xSize, ySize, zSize);
				this.inDensity = 1;
				this.outDensity = 1;
				this.enabled = true;
			}
			
			run(vec, filled) {
                if (!this.enabled) return false;
				if (typeof vec.x != 'number' || typeof vec.y != 'number' || typeof vec.z != 'number') return false; 
				
				filled = typeof filled === 'undefined' ? true : filled;
				
				const lengthSq = (x, y, z) => { return ((x * x) + (y * y) + (z * z)); };
				
				let setTotal = 0;		
				const bx = Math.floor(vec.x);
				const by = Math.floor(vec.y);
				const bz = Math.floor(vec.z);

				const radiusX = this.size.x * .5 + 0.5;
				const radiusY = this.size.y * .5 + 0.5;
				const radiusZ = this.size.z * .5 + 0.5;

				const invRadiusX = 1 / radiusX;
				const invRadiusY = 1 / radiusY;
				const invRadiusZ = 1 / radiusZ;

				const ceilRadiusX = Math.ceil(radiusX);
				const ceilRadiusY = Math.ceil(radiusY);
				const ceilRadiusZ = Math.ceil(radiusZ);
				
				let x, y, z, xn, yn, zn, lenSq;
				let px, nx, py, ny, pz, nz,nextXn, nextYn, nextZn;

				nextXn = 0;
				forX: for (x = 0; x <= ceilRadiusX; ++x) {
					xn = nextXn;	
					nextXn = (x + 1) * invRadiusX;
					nextYn = 0;
					px = x + bx;
					nx = -x + bx;					
					
                    forY: for (y = 0; y <= ceilRadiusY; ++y) {
                        yn = nextYn;
						nextYn = (y + 1) * invRadiusY;
						nextZn = 0;
						py = y + by;
						ny = -y + by;
						
                        forZ: for (z = 0; z <= ceilRadiusZ; ++z) {
							zn =  nextZn;
							nextZn = (z + 1) * invRadiusZ;
							lenSq = lengthSq(xn, yn, zn);

							if (lenSq > 1) {
								if (z == 0) {
									if (y == 0) {
										break forX;
									}
									break forY;
								}
								break forZ;
							}

							if (!filled) {
								if (lengthSq(nextXn, yn, zn) <= 1 && lengthSq(xn, nextYn, zn) <= 1 && lengthSq(xn, yn, nextZn) <= 1) {
									continue;
								}
							}

							pz = z + bz;
							nz = -z + bz;
							
							if (this.callback(px, py, pz, lenSq) === false) return false;
							if (this.callback(nx, py, pz, lenSq) === false) return false;
							if (this.callback(px, ny, pz, lenSq) === false) return false;
							if (this.callback(px, py, nz, lenSq) === false) return false;
							if (this.callback(nx, ny, pz, lenSq) === false) return false;
							if (this.callback(px, ny, nz, lenSq) === false) return false;
							if (this.callback(nx, py, nz, lenSq) === false) return false;
							if (this.callback(nx, ny, nz, lenSq) === false) return false;

							setTotal += 8;					
						}
					}
				}
				
				return setTotal;
			}

			setSize(x, y, z) {
				this.size = {};
				this.size.x = typeof x === 'number' ? Math.floor(x) : 5;
				this.size.y = typeof y === 'number' ? Math.floor(y) : this.size.x;		
				this.size.z = typeof z === 'number' ? Math.floor(z) : this.size.x;
			}
			
			setCallback(ptr) {
				if (!ptr instanceof Function) return false;
				else this.callback = ptr;
			}
			
		};

		this.SpiralIterator = class SpiralIterator {
			constructor(start = [0, 0], min = [0, 0], max = [10, 10]) {
				this.start = start;
				this.min = min;
				this.max = max;
				this.current = [start[0], start[1]];
				this.limit = 1;
				this.amount = 0;
				this.index = 0;
				this.direction = 0; // x+, y+, x-, y-
				this.directionList = [[1,0], [0,1], [-1,0], [0,-1]];
				this.total = (Math.abs(this.max[0] - this.min[0]) + 1) * (Math.abs(this.max[1] - this.min[1]) + 1) - 1;
				this.found = 0;
			}
			
			next() {
				var nextPos = this.current;
				var spotFound = false;
				
				if (this.found == this.total) return null;
				
				while(!spotFound) {
					
					this.amount++;					
					
					nextPos[0] += this.directionList[this.direction][0];
					nextPos[1] += this.directionList[this.direction][1];
					
					if (nextPos[0] < this.min[0] || nextPos[0] > this.max[0] || nextPos[1] < this.min[1] || nextPos[1] > this.max[1]) {
						spotFound = false;
					}
					else {
						spotFound = true;
						this.found++;
					}
					
					if (this.amount == this.limit) {
						if (this.direction == 0) {
							this.direction++;
						}				
						else if (this.direction == 1) {
							this.direction++;
							this.limit++;
						}
						else if (this.direction == 2) {
							this.direction++;
						}
						else if (this.direction == 3) {
							this.direction = 0;
							this.limit++;
						}
						this.amount = 0;
					}
				}
				
				this.current = nextPos;
				return nextPos;
			}			
		};

		this.TreeLeafNode = class TreeLeafNode extends this.VoxelShape {
			
			constructor() {
				super();
			}
			placeIntoShape(shp, x, y, z) {
				var offset = [this.minX, this.minY, this.minZ];
				var centerPos = [-parseInt((this.maxX - this.minX)/2), 0,-parseInt((this.maxZ - this.minZ)/2)];
				
				shp.insertShape(this, centerPos[0] - offset[0] + x, centerPos[1] - offset[1] + y, centerPos[2] - offset[2] + z);
			}
		};
		
        this.EditOperation = class EditOperation {
            constructor(parentShape, name = "Edit Operation") {
                this.parent = parentShape;
                this.name = name;
                this.useHistory = Game.settings.getKey("editUseHistory") ? true : false;
            }
            setBlock(x, y, z, id, data) { }
            finish() {
                if (this.useHistory) {
                    const historyEvent = new _cubical.Lib.HistoryEvent(this.parent, this);
                    this.parent.history.add(historyEvent);
                }
            }
        };
        
        this.SchematicOperation = class SchematicOperation extends this.EditOperation  {
            constructor(parentShape, name = "Schematic Edit", after = null, x = 1, y = 1, z = 1) {
                super(parentShape, name);
                this.x = x;
                this.y = y;
                this.z = z;

                if (after == null) {
                    if (this.useHistory) this.before = new Schematic(x, y, z);
                    this.after = new Schematic(x, y, z);
                }
                else {
                    this.x = after.x;
                    this.y = after.y;
                    this.z = after.z;
                    this.after = after;
                    if (this.useHistory) this.before = SchematicOperation.createBeforeData(this.parent, this.after);                    
                }
            }
            setBlock(x, y, z, id, data) {
                if (this.useHistory) {
                    const beforeBlock = this.parent.getBlock(x + this.x, y + this.y, z + this.z);
                    this.before.setBlock(x, y, z, beforeBlock.id, beforeBlock.data);
                }
                
                this.after.setBlock(x, y, z, id, data);
            }
            finish(includeAir = false) {
                this.parent.insertSchematic(this.after, 0, 0, 0, includeAir, true);
                super.finish();
            }
            
            static createBeforeData(parent, shape) {
                
                const start = shape.getOffset();
                const end = [start[0] + shape.x, start[1] + shape.y, start[2] + shape.z];
                
                const before = parent.extractSchematic(start, end);
                before.offset = start;

                return before;
            }
        };
        
        this.ShapeOperation = class ShapeOperation extends this.EditOperation  {
            constructor(parentShape, name = "Shape Edit", after = null, x = 0, y = 0, z = 0) {
                super(parentShape, name);
                this.x = x;
                this.y = y;
                this.z = z;

                if (after == null) {
                    if (this.useHistory) this.before = new _cubical.Lib.VoxelShape(true);
                    this.after = new _cubical.Lib.VoxelShape(true);
                }
                else {
                    this.after = after;
                    if (this.useHistory) this.before = ShapeOperation.createBeforeData(this.parent, this.after);                    
                }
            }
            setBlock(x, y, z, id, data) {
                if (this.useHistory) {
                    const beforeBlock = this.parent.getBlock(x + this.x, y + this.y, z + this.z);
                    this.before.setBlock(x, y, z, beforeBlock.id, beforeBlock.data);
                }
                
                this.after.setBlock(x, y, z, id, data);
            }
            finish() {
                this.parent.insertShape(this.after, this.x, this.y, this.z);
                super.finish();
            }
            
            static createBeforeData(parent, shape, x = 0, y = 0, z = 0) {
                const before = shape.clone();
                const data = before.data;
                
				for (var i = 0; i < data.length; i+=5) {
					const block = parent.getBlock(data[i] + x, data[i+1] + y, data[i+2] + z);
                    if (block != null) {
                        data[i + 3] = block.id;
                        data[i + 4] = block.data;
                    }
                    else {
                        data[i + 3] = 0;
                        data[i + 4] = 0;
                    }
				}
                
                return before;
            }
        };
        
        this.BlockOperation = class BlockOperation extends this.EditOperation  {
            constructor(parentShape, name = "Block Edit", x = null, y = null, z = null, id = null, data = null) {
                super(parentShape, name);
                this.before = [];
                this.after = [];

                if (x != null && data != null) {
                    this.setBlock(x, y, z, id, data);
                }
            }
            setBlock(x, y, z, id, data) {
                const beforeBlock = this.parent.getBlock(x, y, z);                
                
                this.before.push(new _cubical.Lib.VoxelBlock(x, y, z, beforeBlock.id, beforeBlock.data));
                this.after.push(new _cubical.Lib.VoxelBlock(x, y, z, id, data));
            }
            finish() {
                if (this.before.length == 0 || this.after.length == 0) return null;
                
                this.parent.insertBlockList(this.after);
                
                super.finish();
            }
        };
        
        this.EditHistory = class EditHistory {
            constructor(maxEvents = 100) {
                this.maxHistoryEvents = maxEvents;
                this.index = 0;
                this.history = [];
            }
            add(event) {
                if (this.index > 0) {
                    this.history.splice(0, this.index);       
                }
                
                this.history.unshift(event);
                this.index = 0;
                
                if (this.history.length > this.maxHistoryEvents) {
                    this.history.pop();
                }
            }
            undo() {
                if (this.history[this.index]) {
                    this.history[this.index].undo();
                    if (this.index < this.history.length) this.index++;
                }
            }
            redo() {
                if (this.history[this.index - 1]) {
                    this.history[this.index - 1].redo();
                    this.index--;
                }
            }
            undoAll() {
                while (this.history[this.index]) {
                    this.history[this.index].undo();
                    if (this.index < this.history.length) this.index++;
                }
            }
            redoAll() {
                while(this.history[this.index - 1]) {
                    this.history[this.index - 1].redo();
                    this.index--;
                }
            }
            getAvailableRedoCount() {
                return this.index;
            }
            getAvailableUndoCount() {
                return this.history.length - this.index;
            }
        };
        
		this.HistoryEvent = class HistoryEvent {
			constructor(parent, operation) {
				this.parent = parent;
                this.operation = operation;
                this.before = operation.before;
                this.after = operation.after;
				this.type = this.getType();
				this.time = new Date().getTime();
				// this.size = this.type == "block" ? [1, 1, 1] : this.before.getSize();
			}
			undo() {                
                switch(this.type) {
                    case "block":
                        this.parent.insertBlockList(this.before);
                        break;
                    case "shape":
                        this.parent.insertShape(this.before, this.operation.x, this.operation.y, this.operation.z); 
                        break;
                    case "schematic":
                        this.parent.insertSchematic(this.before, 0, 0, 0, true);
                        break;
                }
			}
			redo() {
                switch(this.type) {
                    case "block":
                        var block = this.after;
                        this.parent.setBlock(block.id, block.data, block.x, block.y, block.z);
                        break;
                    case "shape":
                        this.parent.insertShape(this.after, this.operation.x, this.operation.y, this.operation.z); 
                        break;
                    case "schematic":
                        this.parent.insertSchematic(this.after, 0, 0, 0, this.after.useAir === true, true);
                        break;
                }
			}
			getType() {
				if (this.before instanceof Array) return 'block';
				else if (this.before instanceof _cubical.Lib.VoxelShape) return 'shape';
				else if (this.before instanceof Schematic) return 'schematic';

				return null;
			}
		};

        this.Keyboard = class Keyboard {
            constructor() {
                this.setNames();
                this.keybinds = [];
                this.heldKeys = [];
                this.clickedKeys = [];
                this.events = new Map();
                
                this.boundKeys = new Set();
                
                $("body").on('keydown', (evt) => this.onKeyDown(evt));
                $("body").on('keyup', (evt) => this.onKeyUp(evt));
                
                this.shiftKeycode = 16;
                this.ctrlKeycode = 17;
                this.altKeycode = 18;
                
                this.initialize();
            }
            initialize() {

                const ptr = this;
                const player = Game.player;
                
                // Player movement
                var category = "playerMovement";
                
                // Handle player forward movement and sprint double tap
                const moveForwardKeybind = new _cubical.Lib.KeyBinding("controlsKeybindMovementForward", "Forward",
                    {keycode: this.getKeycodeFromName("w")}, null
                ).setHeld(true).setRepeat(true).setCategory(category);

                const moveForwardCallback = function moveForwardCallback() {
                    if (!ptr.isCtrlDown()) player.moveForward(1);
                    
                    if (ptr.clickedKeys.includes(this.keycode)) {
                        var lastEvent = ptr.events.get(this.keycode);
                        if (lastEvent.originalEvent.repeat) return;
                        
                        var timeGap = 300;
                        var now = new Date().getTime();

                        if (player.lastForwardTap + timeGap > now) {
                            player.sprinting = true;					
                        }
                        
                        player.lastForwardTap = now;
                    }
                    
                }.bind(moveForwardKeybind);
                
                this.registerKeybind(moveForwardKeybind.setCallback(moveForwardCallback));  
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMovementBackward", "Backward",
                    {keycode: this.getKeycodeFromName("s")}, () => {if (!ptr.isCtrlDown()) player.moveForward(-1);}
                ).setHeld(true).setRepeat(true).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMovementLeft", "Left",
                    {keycode: this.getKeycodeFromName("a")}, () => {if (!ptr.isCtrlDown()) player.moveRight(-1);}
                ).setHeld(true).setRepeat(true).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMovementRight", "Right",
                    {keycode: this.getKeycodeFromName("d")}, () => {if (!ptr.isCtrlDown()) player.moveRight(1);}
                ).setHeld(true).setRepeat(true).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMovementDown", "Down",
                    {keycode: this.getKeycodeFromName("z")}, () => {if (!ptr.isCtrlDown()) player.moveUpNormal(-1);}
                ).setHeld(true).setRepeat(true).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMovementSprint", "Sprint",
                    {keycode: this.getKeycodeFromName("Shift")}, () => { }
                ).setHeld(true).setRepeat(true).setCategory(category));

                const jumpKeybind = new _cubical.Lib.KeyBinding("controlsKeybindMovementJump", "Jump",
                    {keycode: this.getKeycodeFromName("Space")}, null
                ).setHeld(true).setRepeat(true).setCategory(category)

                const jumpCallback = function jumpCallback() {
                    if (!ptr.isCtrlDown()) player.jump();
                    
                    if (ptr.clickedKeys.includes(this.keycode)) {
                        var lastEvent = ptr.events.get(this.keycode);
                        if (lastEvent.originalEvent.repeat) return;
                        
                        var timeGap = 300;
                        var now = new Date().getTime();

                        if (player.lastJump + timeGap > now) {
                            player.useGravity = !player.useGravity;
                            if (player.useGravity) player.hitDetection = true;					
                        }
                        player.lastJump = now;
                    }
                    
                }.bind(jumpKeybind);
                
                this.registerKeybind(jumpKeybind.setCallback(jumpCallback));                
                
                // Editing tools
                category = "editingTools";  
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindHistoryUndo", "Undo",
                    {keycode: this.getKeycodeFromName("z"), ctrl: true}, () => {
                        const shape = Game.getShape();
                        if (!shape || !shape.history) return;
                        shape.history.undo();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindHistoryRedo", "Redo",
                    {keycode: this.getKeycodeFromName("y"), ctrl: true}, () => {
                        const shape = Game.getShape();
                        if (!shape || !shape.history) return;
                        shape.history.redo();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindHistoryUndoAll", "Undo All",
                    {keycode: this.getKeycodeFromName("z"), shift: true, ctrl: true}, () => {
                        const shape = Game.getShape();
                        if (!shape || !shape.history) return;
                        shape.history.undoAll();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindHistoryRedoAll", "Redo All",
                    {keycode: this.getKeycodeFromName("y"), shift: true, ctrl: true}, () => {
                        const shape = Game.getShape();
                        if (!shape || !shape.history) return;
                        shape.history.redoAll();
                    }
                ).setCategory(category));
          
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindRefreshTool", "Refresh Tool",
                    {keycode: this.getKeycodeFromName("r")}, () => {
                        Game.tools.markPreviewDirty();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindCopyArea", "Copy Area",
                    {keycode: this.getKeycodeFromName("c"), ctrl: true}, () => {
                        Game.tools.onCopyArea();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindPasteArea", "Paste Area",
                    {keycode: this.getKeycodeFromName("v"), ctrl: true}, () => {
                        Game.tools.onPasteArea();
                    }
                ).setCategory(category));
                
                // Hotbar slots
                category = "hotbarSlots";
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindDropItem", "Drop Item",
                    {keycode: this.getKeycodeFromName("q")}, () => {
                        Game.gui.actionBar.onDropItem();;
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindDropAllItems", "Drop All Items",
                    {keycode: this.getKeycodeFromName("q"), shift: true}, () => {
                        Game.gui.actionBar.onDropAllItems();
                    }
                ).setCategory(category));
                
                for (var i = 1; i <= 10; i++) {
                    const slot = i;
                    const keycode = this.getKeycodeFromName(`${slot == 10 ? 0 : slot}`);
                    
                    this.registerKeybind(new _cubical.Lib.KeyBinding(`controlsKeybindHotbarSlot${slot}`, `Slot ${slot}`,
                        {keycode: keycode}, () => {
                            Game.gui.actionBar.setCurrentSlot(slot);
                        }
                    ).setCategory(category));
                }
                
                // Misc items
                category = "general";

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIFileSave", "File Save",
                    {keycode: this.getKeycodeFromName("s"), ctrl: true}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.fileSaveB.element);
                    }
                ).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIFileOpen", "File Open",
                    {keycode: this.getKeycodeFromName("o"), ctrl: true}, () => {
                        var fileSelector = $('<input type="file" accept=".bo2,.shp,.sch,.schematic,.nbt,.png,.gif,.jpg,.jpeg,.bmp" multiple />');
                        fileSelector.on("change", Game.shapes.uploadFiles);	
                        fileSelector.click();
                    }
                ).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindHitDetection", "Toggle Clipping",
                    {keycode: this.getKeycodeFromName("h")}, () => {
                        player.hitDetection = !player.hitDetection;
                        if (!player.hitDetection) player.useGravity = false;
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindToggleHUD", "Toggle HUD",
                    {keycode: this.getKeycodeFromName("g")}, () => {
                        Game.gui.toggleHud(); 
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindToggleViewMode", "View Mode",
                    {keycode: this.getKeycodeFromName("v")}, () => {
                        Game.camera.mode = Game.camera.mode == "first" ? "third" : "first";
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindMoveHome", "Teleport Home",
                    {keycode: this.getKeycodeFromName("Home")}, () => {
                        Game.player.teleportSpawn();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSetHome", "Set Home",
                    {keycode: this.getKeycodeFromName("Home"), shift: true}, () => {
                        Game.player.setSpawn();
                    }
                ).setCategory(category)); 
                
                // UI window toggles
                category = "ui";
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindNextFileTab", "Next Tab",
                    {keycode: this.getKeycodeFromName("Tab")}, () => {
                        const nextShape = Game.shapes.getNextShape(1);
                        if (nextShape != Game.shapes.schematic) Game.shapes.setShape(nextShape);
                    }
                ).setCategory(category));                
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindPrevFileTab", "Prev Tab",
                    {keycode: this.getKeycodeFromName("Tab"), shift: true}, () => {
                        const nextShape = Game.shapes.getNextShape(-1);
                        if (nextShape != Game.shapes.schematic) Game.shapes.setShape(nextShape);
                    }
                ).setCategory(category));  
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIBlockPicker", "Block Picker",
                    {keycode: this.getKeycodeFromName("e")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.blockPicker.element);
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIProjectExplorer", "Project Explorer",
                    {keycode: this.getKeycodeFromName("p")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.fileBrowser.element);
                    }
                ).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUINbtEditor", "NBT Editor",
                    {keycode: this.getKeycodeFromName("n")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.nbtEditor.element);
                    }
                ).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIObjectEditor", "Object Editor",
                    {keycode: this.getKeycodeFromName("o")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.objEditor.element);
                    }
                ).setCategory(category));

                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIChatConsole", "Chat Console",
                    {keycode: this.getKeycodeFromName("Enter")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.chat.element);
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIScriptWindow", "Script Window",
                    {keycode: this.getKeycodeFromName("k")}, () => {
                        Game.gui.windows.toggleWindow(Game.gui.panels.base.script.element);
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindUIToolPanel", "Tool Panel",
                    {keycode: this.getKeycodeFromName("t")}, () => {
                        Game.gui.togglePanel($(".canvasPanel#toolList")[0]);
                    }
                ).setCategory(category));
                
                // Selection tools
                category = "selectionTool";  
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindQuickSelect", "Quick Select",
                    {keycode: this.getKeycodeFromName("c")}, () => {
                        Game.tools.onQuickSelect();
                    }
                ).setCategory(category));
              
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectAll", "Select All",
                    {keycode: this.getKeycodeFromName("a"), ctrl: true}, () => {
                        Game.selection.selectAll();
                    }
                ).setCategory(category));
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindClearSelection", "Clear Selection",
                    {keycode: this.getKeycodeFromName("d"), ctrl: true}, () => {
                        Game.selection.clearSelection();
                    }
                ).setCategory(category));

                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindDeleteSelection", "Delete Selection",
                    {keycode: this.getKeycodeFromName("Delete")}, () => {
                        Game.selection.setAll(0, 0);
                    }
                ).setCategory(category));
 
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveLeft", "Move Left",
                    {keycode: this.getKeycodeFromName("Left Arrow")}, () => {                       
                        const right = player.getRightDirection();
                        const left = [right[0] * -1, right[1] * -1, right[2] * -1];
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            if (ptr.isShiftDown()) activeTool.onRotateKeybind([0, -1, 0]);
                            else if(ptr.isCtrlDown()) activeTool.onRotateKeybind(left);
                            else activeTool.onMoveKeybind(left);
                        }
                        else if (Game.selection.isComplete()) {
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(left);
                            }					
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(left);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(left);
                            }						
                        }
                    }
                ).setCategory(category));                
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveRight", "Move Right",
                    {keycode: this.getKeycodeFromName("Right Arrow")}, () => {
                        const right = player.getRightDirection();
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            if (ptr.isShiftDown()) activeTool.onRotateKeybind([0, 1, 0]);
                            else if(ptr.isCtrlDown()) activeTool.onRotateKeybind(right);
                            else activeTool.onMoveKeybind(right);
                        }
                        else if (Game.selection.isComplete()) {                            
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(right);
                            }
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(right);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(right);
                            }
                        }	
                    }
                ).setCategory(category));                
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveForward", "Move Forward",
                    {keycode: this.getKeycodeFromName("Up Arrow")}, () => {
                        const forward = player.getFrontDirection();
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            if(ptr.isCtrlDown()) activeTool.onRotateKeybind(forward);
                            else activeTool.onMoveKeybind(forward);
                        }
                        else if (Game.selection.isComplete()) {  
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(forward);
                            }
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(forward);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(forward);
                            }
                        }
                    }
                ).setCategory(category));                
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveBackward", "Move Backward",
                    {keycode: this.getKeycodeFromName("Down Arrow")}, () => {
                        const forward = player.getFrontDirection();
                        const backward = [forward[0] * -1, forward[1] * -1, forward[2] * -1];
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            if(ptr.isCtrlDown()) activeTool.onRotateKeybind(backward);
                            else activeTool.onMoveKeybind(backward);
                        }
                        else if (Game.selection.isComplete()) {
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(backward);
                            }					
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(backward);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(backward);
                            }
                        }
                    }
                ).setCategory(category));      
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveUp", "Move Up",
                    {keycode: this.getKeycodeFromName("Page Up")}, () => {
                        const up = [0, 1, 0];
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            activeTool.onMoveKeybind(up);
                        }
                        else if (Game.selection.isComplete()) {
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(up);
                            }					
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(up);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(up);
                            }
                        }
                    }
                ).setCategory(category));                
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSelectionMoveDown", "Move Down",
                    {keycode: this.getKeycodeFromName("Page Down")}, () => {
                        const down = [0, -1, 0];
                        
                        const activeTool = Game.tools.getActiveTool();
                        if (activeTool && activeTool.id == "pasteBrush") {
                            activeTool.onMoveKeybind(down);
                        }
                        else if (Game.selection.isComplete()) {
                            if (ptr.isCtrlDown()) {
                                Game.selection.expand(down);
                            }
                            else if (ptr.isShiftDown()) {
                                Game.selection.shift(down);
                            }
                            else if (ptr.isAltDown()) {
                                Game.selection.contract(down);
                            }
                        }
                    }
                ).setCategory(category));
                

                // Hidden keybinds
                category = "hidden";
                
                this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybindSettingsWindow", "Settings Windows",
                    {keycode: this.getKeycodeFromName("Escape")}, () => {
                        if (Game.gui.windows.open.length > 0) Game.gui.windows.closeTopWindow();
                        else Game.gui.windows.toggleWindow(Game.gui.panels.base.settings.element);
                    }
                ).setCategory(category));
                
                // this.registerKeybind(new _cubical.Lib.KeyBinding("controlsKeybind", "NAME_HERE",
                //     {keycode: this.getKeycodeFromName("KEY_HERE")}, () => {
                //         
                //     }
                // ).setCategory(category)); 

            }
            update() {
                
                // Test the clicked keybinds first
                const keydata = [0, this.isShiftDown(), this.isCtrlDown(), this.isAltDown()];
                for (var i = 0; i < this.clickedKeys.length; i++) {
                    const keycode = this.clickedKeys[i];
                    keydata[0] = keycode;
                    
                    const keybind = this.getMatchingKeybind(...keydata);                    
                    if (keybind == null || keybind.held) continue;
                    
                    const consumedKeycode = keybind.consumeTrigger(...keydata);
                    if (consumedKeycode > 0) {
                        var index = this.clickedKeys.indexOf(keycode);
                        if (index > -1) {
                            this.clickedKeys.splice(index, 1);
                        }
                    }
                }
                
                // Now test any held ones
                for (var i = 0; i < this.heldKeys.length; i++) {
                    keydata[0] = this.heldKeys[i];
                    
                    const keybind = this.getMatchingKeybind(...keydata);                    
                    if (keybind == null || !keybind.held) continue;
                    
                    keybind.consumeTrigger(...keydata);
                }
                
                this.clickedKeys = [];
            }
            registerKeybind(keybind) {
                keybind.reloadFromSettings();
                
                if (keybind.keycode > 0 && !this.boundKeys.has(keybind.keycode)) this.boundKeys.add(keybind.keycode);
                this.keybinds.push(keybind);
            }
            getKeybind(id) {
                for (var i = 0; i < this.keybinds.length; i++) {
                    const keybind = this.keybinds[i];
                    if (keybind.id == id) return keybind;
                }
                
                return null;
            }
            onKeyDown(evt) {
                if (evt.target.tagName == "INPUT" || evt.target.tagName == "TEXTAREA" || evt.target.tagName == "SELECT") {
                    this.reset();
                    return;
                }

                if (!this.heldKeys.includes(evt.keyCode)) {
                    this.heldKeys.push(evt.keyCode);
                }
                
                this.events.set(evt.keyCode, evt);
                this.clickedKeys.push(evt.keyCode);
                
                if (this.boundKeys.has(evt.keyCode)) return false;
                else return;
            }
            onKeyUp(evt) {
                if (evt.target.tagName == "INPUT" || evt.target.tagName == "TEXTAREA" || evt.target.tagName == "SELECT") {
                    this.reset();
                    return;
                }
                
                var index = this.heldKeys.indexOf(evt.keyCode);
                if (index > -1) {
                    this.heldKeys.splice(index, 1);
                    evt.preventDefault();
                    return false;
                }
            }
            isModifierKey(keycode) {
               return keycode == this.shiftKeycode || keycode == this.ctrlKeycode || keycode == this.alttKeycode;
            }
            isKeyDown(keycode) {
                return this.heldKeys.includes(keycode);
            }
            isShiftDown() {
                return this.heldKeys.includes(this.shiftKeycode);
            }
            isCtrlDown() {
                return this.heldKeys.includes(this.ctrlKeycode);
            }
            isAltDown() {
                return this.heldKeys.includes(this.altKeycode);
            }
            getModifierData() {
                return {
                    shift: this.isShiftDown(),
                    ctrl: this.isCtrlDown(),
                    alt: this.isAltDown()
                };
            }
            reloadFromSettings() {
                this.boundKeys.clear();
                for (var i = 0; i < this.keybinds.length; i++) {
                    const keybind = this.keybinds[i];
                    keybind.reloadFromSettings();
                    
                    if (keybind.keycode > 0 && !this.boundKeys.has(keybind.keycode)) {
                        this.boundKeys.add(keybind.keycode);
                    }
                }
            }            
            reset() {
                this.heldKeys = [];
                this.clickedKeys = [];
            }
            getKeycodeFromName(name) {
                for (var val in this.keyNames) {
                    if (this.keyNames[val].toLowerCase() == name.toLowerCase()) return parseInt(val);
                }
                
                return null;
            }
            getKeybindKeyText(keybind) {
                var keyText = "";
                
                if (!(keybind.keycode > 0) && !keybind.shift && !keybind.ctrl && !keybind.alt) return "Not Bound";
                if (keybind.shift) keyText = "Shift";
                if (keybind.ctrl) keyText += (keyText.length > 0 ? " + " : "") + "Ctrl";
                if (keybind.alt) keyText += (keyText.length > 0 ? " + " : "") + "Alt";
                
                const keyName = keybind.keycode > 0 ? this.keyNames[keybind.keycode] : "";
                
                keyText += (keyText.length > 0 && keyName.length > 0 ? " + " : "") + keyName;
                
                return keyText;
            }
            getMatchingKeybind(keycode, shift, ctrl, alt, exact = false) {
                if (!this.boundKeys.has(keycode)) return null;
                
                var match = null;                
                var matchPriority = -1;
                for (var i = 0; i < this.keybinds.length; i++) {
                    const keybind = this.keybinds[i];                    
                    
                    if (keybind.shouldTrigger(keycode, shift, ctrl, alt, exact)) {
                        const priority = keybind.getPriority();
                        
                        if (matchPriority == -1 || priority > matchPriority) {
                            match = keybind;
                            matchPriority = priority;
                        }
                    }
                }
                
                return match;                
            }
            setNames() {
                this.keyNames = {
                    8: "Backspace",
                    9: "Tab",
                    13: "Enter",
                    16: "Shift",
                    17: "Ctrl",
                    18: "Alt",
                    19: "Pause/Break",
                    20: "Caps Lock",
                    27: "Escape",
                    32: "Space",
                    33: "Page Up",
                    34: "Page Down",
                    35: "End",
                    36: "Home",
                    37: "Left Arrow",
                    38: "Up Arrow",
                    39: "Right Arrow",
                    40: "Down Arrow",
                    45: "Insert",
                    46: "Delete",
                    48: "0",
                    49: "1",
                    50: "2",
                    51: "3",
                    52: "4",
                    53: "5",
                    54: "6",
                    55: "7",
                    56: "8",
                    57: "9",
                    65: "A",
                    66: "B",
                    67: "C",
                    68: "D",
                    69: "E",
                    70: "F",
                    71: "G",
                    72: "H",
                    73: "I",
                    74: "J",
                    75: "K",
                    76: "L",
                    77: "M",
                    78: "N",
                    79: "O",
                    80: "P",
                    81: "Q",
                    82: "R",
                    83: "S",
                    84: "T",
                    85: "U",
                    86: "V",
                    87: "W",
                    88: "X",
                    89: "Y",
                    90: "Z",
                    91: "Left Window Key",
                    92: "Right Window Key",
                    93: "Select Key",
                    96: "Numpad 0",
                    97: "Numpad 1",
                    98: "Numpad 2",
                    99: "Numpad 3",
                    100: "Numpad 4",
                    101: "Numpad 5",
                    102: "Numpad 6",
                    103: "Numpad 7",
                    104: "Numpad 8",
                    105: "Numpad 9",
                    106: "Multiply",
                    107: "Add",
                    109: "Subtract",
                    110: "Decimal",
                    111: "Divide",
                    112: "F1",
                    113: "F2",
                    114: "F3",
                    115: "F4",
                    116: "F5",
                    117: "F6",
                    118: "F7",
                    119: "F8",
                    120: "F9",
                    121: "F10",
                    122: "F11",
                    123: "F12",
                    144: "Num Lock",
                    145: "Scroll Lock",
                    186: "Semi-colon",
                    187: "Equal Sign",
                    188: "Comma",
                    189: "Dash",
                    190: "Period",
                    191: "Forward Slash",
                    192: "Grave accent",
                    219: "Open Bracket",
                    220: "Back Slash",
                    221: "Close Braket",
                    222: "Single Quote"
                };
            }
        }

        this.KeyBinding = class KeyBinding {
            constructor(id, name, keyData, callback) {
                this.id = id;
                this.name = name;
                
                this.keyData = keyData;
                this.callback = callback;

                this._default = keyData;               
                this.setKeyData(keyData);
                
                this.repeat = false;
                this.held = false;
                this.category = "";
            }            
            consumeTrigger(keycode, shift = false, ctrl = false, alt = false) {                
                const trigger = this.shouldTrigger(keycode, shift, ctrl, alt);
                if (!trigger) return -1;
                
                this.execute();
                return this.repeat ? -1 : this.keycode;
            }
            shouldTrigger(keycode, shift = false, ctrl = false, alt = false, exact = false) {
                if (!this.isBound()
                || this.keycode != keycode
                || this.shift && !shift || exact && this.shift !== shift
                || this.ctrl && !ctrl || exact && this.ctrl !== ctrl
                || this.alt && !alt || exact && this.alt !== alt) return false;
                
                return true;
            }
            execute() {
                if (this.callback) this.callback();
            }
            isBound() {
                return this.keycode > 0;
            }
            getPriority() {
                var priority = 0;
                if (this.keycode > 0) priority++;
                if (this.shift) priority++;
                if (this.ctrl) priority++;
                if (this.alt) priority++;
                
                return priority;
            }
            setShift(shift) {
                this.shift = shift;
                return this;
            }            
            setCtrl(ctrl) {
                this.ctrl = ctrl;
                return this;
            }
            setAlt(alt) {
                this.alt = alt;
                return this;
            }
            setRepeat(repeat) {
                this.repeat = repeat;
                return this;
            }
            setHeld(held) {
                this.held = held;
                return this;
            }
            setCategory(category) {
                this.category = category;
                return this;
            }
            setKeyData(keyData) {
                this.keycode = keyData.keycode;
                this.shift = keyData.shift ? true : false;
                this.ctrl = keyData.ctrl ? true : false;
                this.alt = keyData.alt ? true : false;
            }
            getKeyData() {
                return { keycode: this.keycode, shift: this.shift, ctrl: this.ctrl, alt: this.alt };
            }
            setCallback(callback) {
                this.callback = callback;
                return this;
            }
            reloadFromSettings() {
                const settings = Game.settings;

                if (!settings.defKeys[this.id]) settings.defKeys[this.id] = this._default;                
                
                if (!settings.keys[this.id]) {
                    settings.setKey(this.id, this._default);
                }
                else {
                    this.setKeyData(settings.keys[this.id]);
                }
            }
        };  

		this.ObjectNode = class ObjectNode {
			constructor(obj, name, root = false) {
				this.name = name;
				this.root = root;
				this.type = ObjectNode.getItemType(obj);
				this.data = obj;
				this.path = this.type == "array" ? parseInt(this.name) : name;
				this.childCount = ObjectNode.getChildCount(obj);
				this.children = obj;
				this.value = obj;
			}
			
			static getItemType(obj) {
				
				if (typeof obj === "undefined") return "undefined";
				else if (obj === null) return "null";
				else if (typeof obj === "boolean") return "boolean";
				else if (typeof obj === "string") return "string";
				else if (typeof obj === "number") return "number";
                else if (typeof obj === "function") return "function";
				else if (obj instanceof Array || typeof obj.length === 'number') return "array";
				else if (obj.constructor && obj.constructor.name === "Function") return "function";
				else if (obj.constructor) return "class";
				else if (typeof obj === "object") return "object";

				return "undefined";
			}
			
			static parseItemValue(type, item) {
				
				if (type == "undefined") return item;
				else if (type == "string") return String(item);
				else if (type == "number") return parseFloat(item);
				else if (type == "boolean") return String(item).toLowerCase() == 'true' || item === true;
				else if (type == "null") return null;
			}
			
			static getChildCount(obj) {
				
				var type = ObjectNode.getItemType(obj);
				if (type == "object" || type == "function" || type == "class") {
				
					var childCnt = 0;
					for (let i in obj) {
						childCnt++;
					}
					
					return childCnt;
				}
                else if (type == "array") {
                    return obj.length;
                }

				return 0;
			}
			
		};

        this.GameInfoTooltip = class GameInfoTooltip {
           constructor(parent) {
                this.parent = parent;
                this.visible = false;
                
                this.position = null;
                this.icon = null;
                this.name = null;
                this.data = null;
                
                var element = this.buildElement();
                
                $(this.parent).append(element);
                
                this.element = $(`#${parent.id} #gameInfoTooltip`);
                this.blockIcon = $(`#${parent.id} #gameInfoTooltip #iconPreviewImg`);
                this.blockName = $(`#${parent.id} #gameInfoTooltip #blockName`);
                this.blockData = $(`#${parent.id} #gameInfoTooltip #blockData`);
                this.blockPosition = $(`#${parent.id} #gameInfoTooltip #positionData`);
                
            }
            buildElement(){
               
                var element = `
                    <div id="gameInfoTooltip" style="display: none;">
                        <div id="inner">
                            <div id="positionInfo">
                                <div id="positionData"></div>
                            </div>
                            <div id="blockInfo">
                                <div id="iconPreview"><img id="iconPreviewImg" /></div>
                                <div id="blockName"></div>
                                <div id="blockData"></div>
                            </div>
                        </div>	
                    </div>`;
                    
                return element;
                
            }
            update() {
                const altDown = Game.input.keyboard.isAltDown();
                const overBlock = Game.input.mouse.isOverBlock();
                
                if (altDown && overBlock) {
                    if (!this.visible) this.show();
                    this.updateInfo();
                }
                else {
                    if (this.visible) this.hide();
                }
            }
            show() {
                $(this.element).show();
                this.visible = true;
            }
            hide() {
                $(this.element).hide();
                this.visible = false;
            }
            isOpen() {
                return this.visible;
            }
            updateInfo() {
                if (!Game.input.mouse.isOverBlock()) return;

                const hit = Game.input.mouse.hit;
                const blockId = hit.blockId;
                const blockMeta = hit.blockData;
                const blockName = Minecraft.Blocks.getBlockName(blockId,blockMeta);
                const blockIdName = Minecraft.Blocks.getBlockIdName(blockId, blockMeta);
                const blockData = `${blockId}:${blockMeta} - ${blockIdName}`;
                const blockIcon = Minecraft.Blocks.getBlockIcon(blockId, blockMeta);
                
                this.setPosition(hit.blockPos);
                this.setBlockName(blockName);
                this.setBlockData(blockData);
                this.setBlockIcon(blockIcon);
                
                const posX = Game.input.mouse.x;
                const posY = Game.input.mouse.y;
                
                const offsetX = -16;
                const offsetY = 16
                
                this.element.css("left", `${posX - offsetX}px`).css("top", `${posY + offsetY}px`);
            }
            setPosition(position) {
                if (this.position == position) return;
                
                this.position = position;
                const positionText = `${position[0]}, ${position[1]}, ${position[2]}`;
                this.blockPosition.html(positionText);
            }
            setBlockName(name) {
                if (this.name == name) return;
                
                this.name = name;
                this.blockName.html(name);
            }
            setBlockData(data) {
                if (this.data == data) return;
                
                this.data = data;
                this.blockData.html(data);
            }
            setBlockIcon(icon) {
                if (this.icon == icon) return;
                
                this.icon = icon;
                this.blockIcon[0].src = icon.src;
            }
        };

        this.ImageSteganographer = class ImageSteganographer {
            constructor(img, bitDepth = 1, useAlpha = false) {
                this.img = img;
                this.bitDepth = bitDepth;
                this.useAlpha = useAlpha;
                this.masks = [1, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6, 1 << 7];
            }
            dec2bin(dec){
                var bin = (dec >>> 0).toString(2);
                for (var i = bin.length; i < 8; i++) bin = "0" + bin;

                return bin;
            }
            bin2dec(bin){
              return parseInt(bin, 2).toString(10);
            }    
            str2bin(text) {
                var bin = "";
                for (var i = 0; i < text.length; i++) {
                    bin += this.dec2bin(text.charCodeAt(i));
                }

                return bin;
            }
            bin2str(bin, length) {
                var index = 0;
                var decodedText = "";

                for (var i = 0; i < bin.length; i += 8) {
                    if (index++ >= length) break;           
                    decodedText += String.fromCharCode(this.bin2dec(bin.substring(i, i + 8)));
                }

                return decodedText;
            }
            encodeByteArray(textToEncode, byteArray) {
                var binText = this.str2bin(textToEncode);

                var binIndex = 0;
                var alpha = 0;
                for (var i = 0; i < byteArray.length; i++) {
                    if (alpha == 3) {
                        alpha = 0;
                        continue;
                    }

                    var val = byteArray[i];
                    for (var j = this.bitDepth; j >= 1; j--) {

                        if (binIndex >= binText.length) break;

                        var bin = binText[binIndex];

                        if (bin == "0") val &= ~this.masks[j - 1];
                        else val |= this.masks[j - 1];

                        binIndex++;
                    }

                    byteArray[i] = val;           
                    if (!this.useAlpha) alpha++;
                }

                return byteArray;
            }
            decodeByteArray(byteArray, length) {
                var alpha = 0;

                var out = [];
                for (var i = 0; i < byteArray.length; i++) {
                    if (alpha == 3) {
                        alpha = 0;
                        continue;
                    }

                    out.push(byteArray[i]);
                    if (!this.useAlpha) alpha++;
                }

                var bin = "";
                for (var i = 0; i < out.length; i++) {

                    for (var j = this.bitDepth; j >= 1; j--) {
                        bin += (((out[i] & this.masks[j - 1]) != 0) ? "1" : "0");
                    }
                }

                var decodedText = this.bin2str(bin, length);
                return decodedText;
            }
            encodeImage(text, callback) {
                var img = this.img;
                var totalColors = text.length * 8 / this.bitDepth;
                var totalPixels = Math.ceil(totalColors / this.getColorsPerPixel());

                var width = Math.min(totalPixels, img.width);
                var height = Math.ceil(totalPixels / width);

                var cvs = new OffscreenCanvas(img.width, img.height);			
                var ctx = cvs.getContext("2d");

                ctx.drawImage(img, 0, 0, img.width, img.height);

                var imageData = ctx.getImageData(0, 0, width, height);

                var newData = this.encodeByteArray(text, imageData.data);
                var newImageData = new ImageData(newData, width, height);

                ctx.putImageData(newImageData, 0, 0);

                cvs.convertToBlob().then(function(bData) {
                    var blob = bData;
                    var objurl = window.URL.createObjectURL(blob);
                    var newImg = new Image();
                    newImg.src = objurl;
                    newImg.onload = function() {
                        callback(newImg);
                    }
                });
            }
            decodeImage(length) {
                var img = this.img;
                var totalColors = length * 8 / this.bitDepth;
                var totalPixels = Math.ceil(totalColors / this.getColorsPerPixel());

                var width = Math.min(totalPixels, img.width);
                var height = Math.ceil(totalPixels / width);

                var cvs = new OffscreenCanvas(img.width, img.height);			
                var ctx = cvs.getContext("2d");

                ctx.drawImage(img, 0, 0, img.width, img.height);

                var imageData = ctx.getImageData(0, 0, width, height);
                var decodedText = this.decodeByteArray(imageData.data, length);

                return decodedText;
            }
            getColorsPerPixel() {
                return (3 + (this.useAlpha ? 1 : 0));
            }
            getMaxTextLength() {
                return Math.floor(this.img.width * this.img.height * (this.useAlpha ? 4 : 3) * (this.bitDepth / 8));
            }
        };
        
        this.Color = class Color {
            constructor(r, g, b, a = 1) {
                this.r = r;
                this.g = g;
                this.b = b;
                this.a = a;
            }
            
            toRgb() {
                return [this.r, this.g, this.b];
            }
            toHsl() {
                return Color.rgbToHsl(this.r, this.g, this.b);
            }
            toHsv() {
                return Color.rgbToHsv(this.r, this.g, this.b);
            }
            toHex() {
                return Color.rgbToHex(this.r, this.g, this.b);
            }
            toCssRgba() {
                return Color.rgbaToCssRgba(this.r, this.g, this.b, this.a);
            }
            lighten(ratio) {
                this.r = Math.round(Math.min(this.r + (255 - this.r) * ratio, 255));
                this.g = Math.round(Math.min(this.g + (255 - this.g) * ratio, 255));
                this.b = Math.round(Math.min(this.b + (255 - this.b) * ratio, 255));
                return this;
            }
            darken(ratio) {
                this.r = Math.round(Math.max(this.r - this.r * ratio, 0));
                this.g = Math.round(Math.max(this.g - this.g * ratio, 0));
                this.b = Math.round(Math.max(this.b - this.b * ratio, 0));
                return this;
            }
           
            static fromRgb(r, g, b, a = 1) {
                return new Color(r, g, b, a);
            }
            
            static fromHsl(h, s, l, a = 1) {
                const rgb = Color.hslToRgb(h, s, l);
                return Color.fromRgb(rgb[0], rgb[1], rgb[2], a);
            }

            static fromHsv(h, s, v, a = 1) {
                const rgb = Color.hsvToRgb(h, s, v);
                return Color.fromRgb(...rgb, a);
            }
            
            static fromHex(hex) {
                const rgb = Color.hexToRgb(hex);
                return Color.fromRgb(rgb[0], rgb[1], rgb[2]);
            }
            
            static rgbToHsl(r, g, b) {
                r /= 255;
                g /= 255;
                b /= 255;
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const d = max - min;
                let h;
                
                if (d === 0) h = 0;
                else if (max === r) h = (g - b) / d % 6;
                else if (max === g) h = (b - r) / d + 2;
                else if (max === b) h = (r - g) / d + 4;
                
                let l = (min + max) / 2;
                let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
                return [h * 60, s, l];
            }
            
            static hslToRgb(h, s, l) {
                const c = (1 - Math.abs(2 * l - 1)) * s;
                const hp = h / 60.0;
                const x = c * (1 - Math.abs((hp % 2) - 1));
                let rgb1;
                
                if (isNaN(h)) rgb1 = [0, 0, 0];
                else if (hp <= 1) rgb1 = [c, x, 0];
                else if (hp <= 2) rgb1 = [x, c, 0];
                else if (hp <= 3) rgb1 = [0, c, x];
                else if (hp <= 4) rgb1 = [0, x, c];
                else if (hp <= 5) rgb1 = [x, 0, c];
                else if (hp <= 6) rgb1 = [c, 0, x];

                const m = l - c * 0.5;
                return [
                    Math.round(255 * (rgb1[0] + m)),
                    Math.round(255 * (rgb1[1] + m)),
                    Math.round(255 * (rgb1[2] + m))];
            }
            
            static rgbToHsv(r, g, b) {
                r /= 255;
                g /= 255;
                b /= 255;
                
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const delta = max - min;
                
                let h, s, v;

                if (delta != 0)
                {
                    if (r == max) h = (g - b) / delta;
                    else
                    {
                        if (g == max) h = 2 + (b - r) / delta;
                        else h = 4 + (r - g) / delta;
                    }
                    
                    h *= 60;
                    if (h < 0) h += 360;
                }
                else
                {
                    h = 0;
                }
                
                s = max == 0 ? 0 : (max - min) / max;
                v = max;
                
                return [h, s * 100, v * 100];
            }
            
            static hsvToRgb(h, s, v) {
                h = Math.min(Math.max(h, 0), 359);
                s = Math.min(Math.max(s, 0), 100) / 100;
                v = Math.min(Math.max(v, 0), 100) / 100;
                
                const c = v * s;
                const hh = h / 60;
                const x = c * (1 - Math.abs((hh % 2) - 1));
                
                let r, g, b;
                r = g = b = 0;
                
                switch(true) {
                    case (hh >= 0 && hh < 1):
                        r = c;
                        g = x;
                        break;
                    case (hh >= 1 && hh < 2):
                        r = x;
                        g = c;
                        break;
                    case (hh >= 2 && hh < 3):
                        g = c;
                        b = x;
                        break;
                    case (hh >= 3 && hh < 4):
                        g = x;
                        b = c;
                        break;
                    case (hh >= 4 && hh < 5):
                        r = x;
                        b = c;
                        break;
                    default:
                        r = c;
                        b = x;
                }
                
                const m = v - c;
                return [
                    Math.round((r + m) * 255),
                    Math.round((g + m) * 255),
                    Math.round((b + m) * 255)];
            }
            
            static rgbToHex(r, g, b, includePrefix = true) {
                return ((includePrefix ? "#" : "") + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)).toUpperCase();
            }

            static rgbaToCssRgba(r, g, b, a = 1) {
                return `rgba(${r}, ${g}, ${b}, ${a})`;
            }
            
            static hexToRgb(hex) {
                const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
                hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : null;
            }
        
            static lerp(startColor, endColor, t) {
                if (t <= 0) return startColor;
                if (t >= 1) return endColor;
                
                const start = startColor.toHsv();
                const end = endColor.toHsv();
                const delta = [end[0] - start[0], end[1] - start[1], end[2] - start[2], endColor.a - startColor.a];
                
                const color = Color.fromHsv(
                    Math.round(start[0] + delta[0] * t),
                    Math.round(start[1] + delta[1] * t),
                    Math.round(start[2] + delta[2] * t),
                    startColor.a + delta[3] * t
                );
                
                return color;
            }
        };  
	
        this.Timer = class Timer {
            constructor(id = null, start = true, logChanges = true) {
                this.id = id;
                this.startTime = -1;
                this.endTime = -1;
                this.laps = [];
                this.logChanges = logChanges;
                
                if (start) this.start();
            }
            start() {
                this.startTime = performance.now();
                
                if (this.logChanges) {
                    const total = this.end - this.startTime;                
                    console.log(`Timer Started! - ${this.startTime}`);
                }
                
                return this;
            }
            stop() {
                this.endTime = performance.now();
                
                if (this.logChanges) {
                    const total = this.endTime - this.startTime;                
                    console.log(`Timer Stopped! - Run Time: ${total}`);
                }
                
                return this;
            }
            lap(id = null) {
                const end = performance.now();
                const start = this.laps.length == 0 ? this.startTime : this.laps[this.laps.length - 1].end;
                const total = end - start;
                const lap = {id: id, start: start, end: end, total: total};
                this.laps.push(lap);
                
                if (this.logChanges) {
                    const lapName = id == null ? "" : `${id} - `;
                    console.log(`Lap Finished! | ${lapName}Total: ${total}`);
                }
                
                return this;
            }
            log() {
                if (this.startTime == -1 && this.endTime == -1) {
                    console.log("Timer not started.");
                }
                else if (this.endTime == -1) {
                    const now = performance.now();
                    const total = now - this.startTime;
                    
                    console.log(`Current Time: ${now} | Total: ${total}`);
                }
                else if (this.startTime > -1 && this.endTime > -1) {
                    
                    if (this.laps.length == 0) {
                        console.log(`Start Time: ${this.startTime.toFixed(2)} | End Time: ${this.endTime.toFixed(2)} | Total: ${total.toFixed(2)}`);
                    }
                    else {
                        
                        const total = this.endTime - this.startTime;
                        
                        for (var i = 0; i < this.laps.length; i++) {
                            const lap  = this.laps[i];
                            const lapPercent = lap.total / total * 100;
                            const id = lap.id == null ? "" : ` - ${lap.id}`;

                            console.log(`Lap${id}: Time: ${lap.total.toFixed(2)} | Total %: ${lapPercent.toFixed(2)}`);
                        }
                        
                        console.log(`Total Time: ${total.toFixed(2)} | Total Laps: ${this.laps.length}`);
                    }
                }
                
                return this;
            }
        }
    
        this.ProgressEvent = class ProgressEvent {
            constructor(onProgressCallback) {
                this.onProgress = onProgressCallback;
            }
            update(progressVal, nextSection) {
                if (this.onProgress == null) return;
                
                this.onProgress(progressVal, nextSection);
                return new Promise(res => { setTimeout(res, 0); });
            }
        }
    
        this.TickedEventScheduler = class TickedEventScheduler {
            constructor(start = true) {
                this.currentTick = 0;
                this.events = new Map();
                this.ticksPerSecond = 20;
                this.tickDelayMs = 1000 / this.ticksPerSecond;

                this.lastTime = -1;
                this.nextTime = -1;
                this.nextLowestTick = -1;

                if (start) this.start();
                else this.isRunning = false;
            }
            
            start() {
                this.isRunning = true;
                this.updateTime();
            }
            
            stop() {
                this.isRunning = false;
            }
            
            update() {
                if (!this.isRunning) return;
                
                const now = performance.now();
                
                if (now > this.nextTime) {
                    this.updateTime(now);
                    this.tick();
                }
            }
            
            tick() {
                const tick = ++this.currentTick;
                
                if (this.events.size == 0) return;
                const events = this.events.get(tick);
                
                if (events) {
                    for (const index in events) {
                        const evt = events[index];
                        evt[0](tick, evt[1]);
                    }
                    
                    this.events.delete(tick);
                    this.nextLowestTick = -1;
                }
            }
            
            updateTime(time) {
                if (!time) time = performance.now();
                
                this.lastTime = time;
                this.nextTime = time + this.tickDelayMs;
            }
            
            addEvent(event, tickDelay, data = null) {
                const timeTick = this.currentTick + tickDelay;
                if (this.nextLowestTick == -1 || timeTick < this.nextLowestTick) {
                    this.nextLowestTick  = timeTick;
                }
                
                const currentEvents = this.events.get(timeTick);
                if (currentEvents) {
                    currentEvents.push([[event, data]]);
                }
                else {
                    this.events.set(timeTick, [[event, data]]);
                }
            }
            
        }
    
    });
	
    this.Render = new (function Render() {
        this._group = true;
        
		this.Shader = class Shader {
			constructor(vertexShader, fragmentShader, attributes = null, uniforms = null) {
                this.attributes = new Map();
                this.uniforms = new Map();
                
                this.program = gl.createProgram();
                
                gl.attachShader(this.program, Shader.getCompiledShader(vertexShader));
                gl.attachShader(this.program, Shader.getCompiledShader(fragmentShader));
                
                gl.linkProgram(this.program);
                if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) alert('Shaders not initialized!');

                gl.useProgram(this.program);
                
                if (attributes != null) this.addAttributes(attributes);
                if (uniforms != null) this.addUniforms(uniforms);
            }
            addUniform(id, type, isArray = false) {
                if (this.uniforms.has(id)) return false;
                
                const uniform = new _cubical.Render.Uniform(this.program, id, type, isArray);
                if (uniform != null) this.uniforms.set(id, uniform);
            }
            addUniforms(uniforms) {                
                for (var i = 0; i < uniforms.length; i++) {
                    const uniform = uniforms[i];
                    this.addUniform(uniform.id, uniform.type, uniform.isArray ? true : false);
                }
            }
            setUniform(id, value) {
                const uniform = this.uniforms.get(id);
                if (!uniform) return false;
                
                uniform.setValue(value);
            }
            getUniformLocation(id) {
                const uniform = this.uniforms.get(id);
                if (!uniform) return false;
                
                return uniform.location;
            }
            addAttribute(id, type, size) {
                if (this.attributes.has(id)) return false;
                
                const attribute = new _cubical.Render.Attribute(this.program, id, type, size);
                if (attribute != null) this.attributes.set(id, attribute);
            }
            addAttributes(attributes) {                
                for (var i = 0; i < attributes.length; i++) {
                    const attribute = attributes[i];
                    this.addAttribute(attribute.id, attribute.type, attribute.size);
                }
            }
            prepareAttributeBuffer(id, buffer) {                
                const attribute = this.attributes.get(id);
                if (attribute === undefined) return;
                attribute.prepareBuffer(buffer);
            }
            getAttribute(id) {
                const attribute = this.attributes.get(id);
                return attribute === undefined ? null : attribute;
            }
            getAttributeLocation(id) {
                const attribute = this.attributes.get(id);
                return attribute === undefined ? null : attribute.location;
            }
            static getCompiledShader(id) {
				let shader;
                const script = document.getElementById(id);
				
                if (script.type === 'x-shader/x-fragment') shader = gl.createShader(gl.FRAGMENT_SHADER);
				else if (script.type === 'x-shader/x-vertex') shader = gl.createShader(gl.VERTEX_SHADER);
				else return null;
				
                gl.shaderSource(shader, script.firstChild.data);
				gl.compileShader(shader);
				
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
					alert('GLSL compile error:\n' + gl.getShaderInfoLog(shader));
                }
                
				return shader;
			}
            static _init() {
                /*
                Shader.uType = {
                    "float": gl.FLOAT,
                    "floatVec2": gl.FLOAT_VEC2,
                    "floatVec3": gl.FLOAT_VEC3,
                    "floatVec4": gl.FLOAT_VEC4,
                    "floatMat2": gl.FLOAT_MAT2,
                    "floatMat3": gl.FLOAT_MAT3,
                    "floatMat4": gl.FLOAT_MAT4,                    
                    "int": gl.INT,
                    "intVec2": gl.INT_VEC2,
                    "intVec3": gl.INT_VEC3,
                    "intVec4": gl.INT_VEC4,
                    "bool": gl.BOOL,
                    "boolVec2": gl.BOOL_VEC2,
                    "boolVec3": gl.BOOL_VEC3,
                    "boolVec4": gl.BOOL_VEC4,
                    "texture2D": gl.SAMPLER_2D,
                    "textureCube": gl.SAMPLER_CUBE
                };

                Shader.aType = {
                    "float": gl.FLOAT,
                    "floatVec2": gl.FLOAT_VEC2,
                    "floatVec3": gl.FLOAT_VEC3,
                    "floatVec4": gl.FLOAT_VEC4,
                    "floatMat2": gl.FLOAT_MAT2,
                    "floatMat3": gl.FLOAT_MAT3,
                    "floatMat4": gl.FLOAT_MAT4,
                };
                */
            }
        };
        
        this.Uniform = class Uniform {                    
            constructor (program, id, type, isArray) {
                if (!Uniform._IS_INIT) Uniform.init();
                
                this.program = program;
                this.id = id;
                this.type = type;
                this.isArray = isArray;
                this.location = gl.getUniformLocation(this.program, this.id);

                if (this.location == null) {
                    alert(`Error: Unable to find uniform with id '${this.id}' in shader program ${this.program}`);
                    return null;
                }
            }       
            setValue(val) {
                const location = this.location;
                
                if (!this.isArray) {
                   Uniform.Set[this.type](location, val);
                }
                else {
                   Uniform.SetArray[this.type](location, val);
                }                        
            }
            static init() {
                Uniform._IS_INIT = true;
                
                Uniform.Set = {
                    "float": (l,v) => { gl.uniform1f(l, v); },
                    "floatVec2": (l,v) => { gl.uniform2f(l, ...v); },
                    "floatVec3": (l,v) => { gl.uniform3f(l, ...v); },
                    "floatVec4": (l,v) => { gl.uniform4f(l, ...v); },
                    "floatMat2": (l,v) => { gl.uniformMatrix2fv(l, false, v); },
                    "floatMat3": (l,v) => { gl.uniformMatrix3fv(l, false, v); },
                    "floatMat4": (l,v) => { gl.uniformMatrix4fv(l, false, v); },
                    "int": (l,v) => { gl.uniform1i(l, v); },
                    "intVec2": (l,v) => { gl.uniform2i(l, ...v); },
                    "intVec3": (l,v) => { gl.uniform3i(l, ...v); },
                    "intVec4": (l,v) => { gl.uniform4i(l, ...v); },
                    "bool": (l,v) => { gl.uniform1i(l, v); },
                    "boolVec2": (l,v) => { gl.uniform2i(l, ...v); },
                    "boolVec3": (l,v) => { gl.uniform3i(l, ...v); },
                    "boolVec4": (l,v) => { gl.uniform4i(l, ...v); },
                    "texture2D": (l,v) => { gl.uniform1i(l, v); },
                    "textureCube": (l,v) => { gl.uniform1i(l, v); }
                };
                
                Uniform.SetArray = {
                    "float": (l,v) => { gl.uniform1fv(l, v); },
                    "floatVec2": (l,v) => { gl.uniform2fv(l, v); },
                    "floatVec3": (l,v) => { gl.uniform3fv(l, v); },
                    "floatVec4": (l,v) => { gl.uniform4fv(l, v); },
                    "floatMat2": (l,v) => { gl.uniformMatrix2fv(l, false, v); },
                    "floatMat3": (l,v) => { gl.uniformMatrix3fv(l, false, v); },
                    "floatMat4": (l,v) => { gl.uniformMatrix4fv(l, false, v); },
                    "int": (l,v) => { gl.uniform1iv(l, v); },
                    "intVec2": (l,v) => { gl.uniform2iv(l, v); },
                    "intVec3": (l,v) => { gl.uniform3iv(l, v); },
                    "intVec4": (l,v) => { gl.uniform4iv(l, v); },
                    "bool": (l,v) => { gl.uniform1iv(l, v); },
                    "boolVec2": (l,v) => { gl.uniform2iv(l, v); },
                    "boolVec3": (l,v) => { gl.uniform3iv(l, v); },
                    "boolVec4": (l,v) => { gl.uniform4iv(l, v); },
                    "texture2D": (l,v) => { gl.uniform1i(l, v); },
                    "textureCube": (l,v) => { gl.uniform1i(l, v); }
                };
            }
        };
        
        this.Attribute = class Attribute {                    
            constructor (program, id, type, size) {               
                this.program = program;
                this.id = id;
                this.type = type;
                this.size = size;
                this.location = gl.getAttribLocation(this.program, this.id);

                if (this.location == null) {
                    alert(`Error: Unable to find attribute with id '${this.id}' in shader program ${this.program}`);
                    return null;
                }
            }            
            prepareBuffer(buffer) {
                // TODO: Change this to use a VAO
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.vertexAttribPointer(this.location, this.size, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(this.location, this.id);
            }
        };
        
		this.ModelBuffer = class ModelBuffer {
			constructor() {
				this.attributes = [];
				this.active = true;
				this.sections = [];
				this.ready = false;
				this.matrixLocation = null;
				this.matrix = [];
			}
			draw() {
				if (!this.ready) this.buildBuffer();
				this.prepareBuffers();
				
				for (var i = 0; i < this.sections.length; i++) {
					this.sections[i].draw();
				}
			}		
			drawSection(name) {
				if (!this.ready) this.buildBuffer();
				this.prepareBuffers();
				
				for(var i = 0; i < this.sections.length; i++) {
					if(this.sections[i].name === name) this.sections[i].draw();
				}
			}
			hasSection(name) {
				for(var i = 0; i < this.sections.length; i++) {
					if (this.sections[i].name === name) return true;
				}
				return false;
			}
			done() {
				this.buildBuffer();
			}
			addAttribute(attrObj) {
				this.attributes.push(attrObj);
				attrObj.buffer = gl.createBuffer();
				attrObj.data = [];
			}
			addShaderAttributes(shader, ids) {
                let i = 0;
         
                for (let attr of shader.attributes.values()) {                 
                    const attrObj = {
                        id: ids[i++],
                        pointer: attr.location,
                        size: attr.size,
                        name: attr.id,
                        buffer: gl.createBuffer(),
                        data: []
                    };

                    this.attributes.push(attrObj);
                }
			}
			getTotalItems() {
				return this.attributes.length < 1 ? 0 : this.attributes[0].data.length / this.attributes[0].size;
			}
			buildBuffer() {
				
				for (var i = 0; i < this.attributes.length; i++) {
					this.attributes[i].bufferData = new Float32Array(this.attributes[i].data);
					gl.bindBuffer(gl.ARRAY_BUFFER, this.attributes[i].buffer);
					gl.bufferData(gl.ARRAY_BUFFER, this.attributes[i].bufferData, gl.STATIC_DRAW);
				}
				this.ready = true;
			}
			prepareBuffers() {
				
				for (var i = 0; i < this.attributes.length; i++) {
					gl.bindBuffer(gl.ARRAY_BUFFER, this.attributes[i].buffer);
					gl.vertexAttribPointer(this.attributes[i].pointer, this.attributes[i].size, gl.FLOAT, false, 0, 0);
					gl.enableVertexAttribArray(this.attributes[i].pointer, this.attributes[i].name);
				}
			}
			addModelData(modelData) {
				for (var i = 0; i < this.attributes.length; i++) {
					if (modelData[this.attributes[i].id]) {
                        this.attributes[i].data = this.attributes[i].data.concat(modelData[this.attributes[i].id]);
                    }
				}
			}
			addSection(section) {
                this.removeSection(section.name);
                
				section.parent = this;
				section.itemStart = this.getTotalItems();
				this.sections.push(section);
				return section;
			}
			removeSection(name) {
				for(var i = 0; i < this.sections.length; i++) {
					if (this.sections[i].name === name) {
                        this.sections.splice(i, 1);
                        return;
                    }
				}
			}
			getMatrix() {
				if(this.matrix == null) {
					this.matrix = Minecraft.util.getIdentityMatrix();;
				}
				return this.matrix;
			}
		};

		this.ModelBufferSection = class ModelBufferSection {
			
			constructor(name = "None") {
				this.name = name;
				this.itemStart = 0;
				this.itemTotal = 0;
				this.drawType = gl.TRIANGLES;
				this.ready = false;
				this.active = true;
				this.parent = null;
				this.matrix = null;
			}
			
			done() {
				this.ready = true;
				this.itemTotal = this.parent.getTotalItems() - this.itemStart;;
			}
			
			draw() {
				if (this.parent.matrix && this.parent.matrixLocation) {
					gl.uniformMatrix4fv(this.parent.matrixLocation, false, this.parent.getMatrix());
				}
				
				if (this.itemTotal > 0) gl.drawArrays(this.drawType, this.itemStart, this.itemTotal);	
			}

		};
     
		this.VoxelShapeRenderer = class VoxelShapeRenderer {
		
			constructor(shape = null, worker = null, options = null/*chunkViewDistance = 16, useFrustumCulling = true*/) {
				this.x = 0;
				this.y = 0;
				this.z = 0;
				this.buffers = new Map();
                this.renderBuffers = new Array();
                this.dirtyBuffers = new Set();
                this.localBuffers = new Array();
                this.centerChunkPos = [-100, -100, -100];
				this.shape = shape;
                this.shapeType = null;
                this.fastUpdate = false;
				this.worker = worker;
				this.size = shape ? shape.getSize() : {x: 1, y: 1, z: 1};
				this.chunkSize = [1,1,1];
				this.offset = [0,0,0];
                this.localOffset =  options && options.localOffset instanceof Array ? options.localOffset : [0,0,0];
				this.chunkBlockSize = 16;
				this.matrix = [];
				this.matrixLocation = null;
                this.useFrustumCulling = options && typeof options.frustumCulling === 'boolean' ? options.frustumCulling : true;
                this.chunkViewDistance = options && typeof options.viewDistance === 'number' ? options.viewDistance : 12;
                this.chunkViewMinTotal = 500;
                this.chunkViewDirty = true;
                this.updatesDisabled = false;
                this.renderingDisabled = false;
                this.totalWaitingRequests = 0;
				
				if (shape) {
					if (shape instanceof _window.Cubical.Lib.VoxelShape) {
						shape.useOffset = true;
						this.offset = shape.getOffset();
                        this.shapeType = "VoxelShape";
					}
					else if (shape instanceof Schematic) {
						this.offset = shape.getOffset();
                        this.shapeType = "Schematic";
                        this.fastUpdate = true;
					}
					else if (shape instanceof _window.Cubical.Lib.VoxelWorld) {
                        this.shapeType = "VoxelWorld";
					}
                    
					this.setTranslation(...this.localOffset);
                    
					// this.initBuffers();	
					// this.initShapeData();
                    
                    // const center = [Game.player.x - this.localOffset[0] >> 4, Game.player.y - this.localOffset[1] >> 4, Game.player.z - this.localOffset[2] >> 4];
                    // this.updateLocalChunks(center, center, true);
				}
			}
			initBuffers() {

				this.chunkSize = [
					Math.ceil(this.size.x / this.chunkBlockSize),
					Math.ceil(this.size.y / this.chunkBlockSize),		
					Math.ceil(this.size.z / this.chunkBlockSize)
				];
                
                if (this.chunkSize[0] == 0 && this.chunkSize[1] == 0  && this.chunkSize[2] == 0) return;
				
				this.x = Math.ceil(this.size.x / this.chunkBlockSize);
				this.y = Math.ceil(this.size.y / this.chunkBlockSize);
				this.z = Math.ceil(this.size.z / this.chunkBlockSize);
				
				if (this.shape instanceof _cubical.Lib.VoxelWorld) {
					var index;
					
					var shp = this.shape;
					
					for (var x = shp.chunkMin[0]; x <= shp.chunkMax[0]; x++) {
						for (var y = shp.chunkMin[1]; y <= shp.chunkMax[1]; y++) {
							for (var z = shp.chunkMin[2]; z <= shp.chunkMax[2]; z++) {
					
								index = this.getChunkId(x, y, z);
								if (!this.shape.chunks.has(index)) continue;
								
                                var buffer = new _cubical.Render.VoxelChunkBuffer(this, [x,y,z]);
                                buffer.id = index;
                                this.buffers.set(index, buffer);
                                
                                buffer.updateChunkData(this.fastUpdate);			
                                
                                if (!buffer.empty) {
                                    // this.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "request", false, {bufferId: buffer.bufferId});	
                                    this.sendWorkerChunkRequest(buffer.chunkData, buffer.bufferId);
                                }
                                else if (buffer.hasBufferData()) {
                                    buffer.clearBufferData();
                                }
                                
                                this.localBuffers.push(buffer);
                                this.renderBuffers.push(buffer);
							}
						}
					}
				}
				else {
				
					var index;
					
					for (var x = 0; x < this.chunkSize[0]; x++) {
						for (var y = 0; y < this.chunkSize[1]; y++) {
							for (var z = 0; z < this.chunkSize[2]; z++) {
					
								index = this.getChunkId(x, y, z);
								if (this.buffers.get(index)) console.log("Found duplicate buffer");
                                
                                var buffer = new _cubical.Render.VoxelChunkBuffer(this, [x,y,z]);
                                buffer.id = index;
                                this.buffers.set(index, buffer);
                                
                                buffer.updateChunkData(this.fastUpdate);			
                                
                                if (!buffer.empty) {
                                    // this.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "request", false, {bufferId: buffer.bufferId});	
                                    this.sendWorkerChunkRequest(buffer.chunkData, buffer.bufferId);
                                }
                                else if (buffer.hasBufferData()) {
                                    buffer.clearBufferData();
                                }
                                
                                this.localBuffers.push(buffer);
                                this.renderBuffers.push(buffer);
							}
						}
					}	
				}				
			}
			initShapeData() {
                
                const startTime = new Date().getTime();
                const usePlayerStartPos = false;
                const fastUpdate = this.fastUpdate;
				
                const sch = this.shape;
                const startX = parseInt(sch.x / 2);
				const startZ = parseInt(sch.z / 2);

                
                const proxyData = {
                    fileInfo: sch.fileInfo,
                    chunks: [],
                    size: [sch.x, sch.y, sch.z],
                    pos: Game.player.getPosition(),
                    transfer: [sch.blocks.slice().buffer, sch.data.slice().buffer]
                };
                
                
                if (this.shapeType == "VoxelWorld") {
                
                    if (this.shape.chunkMin == null) return;
                    
                    const cxMin = this.shape.chunkMin[0];
                    const cyMin = this.shape.chunkMin[1];
                    const czMin = this.shape.chunkMin[2];
                    const cxMax = this.shape.chunkMax[0];
                    const cyMax = this.shape.chunkMax[1];
                    const czMax = this.shape.chunkMax[2];
                
                    if (Game.player) {
                        startX = Math.min(Math.max(Game.player.x >> 4, cxMin), cxMax);
                        startZ = Math.min(Math.max(Game.player.z >> 4, czMin), czMax);
                    }
                
                    const spiral = new _window.Cubical.Lib.SpiralIterator([startX, startZ], [cxMin, czMin], [cxMax, czMax]);
                    let nextPos = [startX, startZ];
                    const p = this;
                    
                    while (nextPos) {
                        
                        for (let y = cyMax - 1; y >= cyMin; y--) {
                            const cx = nextPos[0];
                            const cy = y;
                            const cz = nextPos[1]; 
                            const i = this.getChunkIndexFromChunkCoords(cx, cy, cz);
                            
                            let buffer = this.buffers.get(i);
                            if (buffer == null) continue;
                            
                            // buffer.updateChunkData(fastUpdate);			
                            
                            const chunkData = {
                                offset: [cx, cy, cz],
                                maxSize: [size.x, size.y, size.z],
                                bufferId: this.id
                            };
                            
                            this.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "Proxy", false, {bufferId: buffer.bufferId});	
                            // this.sendWorkerChunkRequest(buffer.chunkData, buffer.bufferId);

                        }
                        
                        nextPos = spiral.next();
                    }
                
                }
                else {
                
                    const spiral = new _window.Cubical.Lib.SpiralIterator([startX, startZ], [0,0], [sch.x, sch.z]);
                    var nextPos = [startX, startZ];
                    const p = this;
                    let chunkTotal = 0;
                    
                    while (nextPos) {
                        
                        for (var y = sch.y - 1; y >= 0; y--) {
                            const cx = nextPos[0];
                            const cy = y;
                            const cz = nextPos[1]; 
                            const i = this.getChunkIndexFromChunkCoords(cx, cy, cz);
                            
                            let buffer = this.buffers.get(i);
                            if (buffer == null) continue;
                            
                            // buffer.updateChunkData(fastUpdate);
                            
                            const chunkData = {
                                offset: [cx, cy, cz],
                                maxSize: [size.x, size.y, size.z],
                                bufferId: i
                            };
                            
                            proxyData.chunks[chunkTotal++] = chunkData;
                            
                            // this.worker.createRequest("Proxy", chunkData, p.setBufferData.bind(p), "Proxy", false, {bufferId: buffer.bufferId});	
 
                        }
                        
                        nextPos = spiral.next();
                    }
                
                }
			
                this.worker.createRequest("SetProxy", proxyData, () => {}, "Request", true, {id: "StartProxy"});            
                this.worker.createRequest("EndProxy", {}, null, "Request", true);
            
                const endTime = new Date().getTime();
                const deltaTime = endTime - startTime;
                console.log(`Finished creating chunk list in ${deltaTime} ms`);
            }
			
			update() {
                if (this.updatesDisabled || this.dirtyBuffers.size < 1) return;
                
                const fastUpdate = this.fastUpdate;
                const p = this;
                
                for (const buffer of this.dirtyBuffers) {

                    buffer.updateChunkData(fastUpdate);
                    
                    if (!buffer.empty) {
                        if (buffer.chunkData.transfer) {
                            // p.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "request", false, {bufferId: buffer.id});
                            this.sendWorkerChunkRequest(buffer.chunkData, buffer.id);
                        }
                    }
				};
                
                this.dirtyBuffers.clear();
			}
            updateRenderableChunks() {
                if (this.updatesDisabled) return;
                
                // if (this.buffers.size == 0) {
                //     this.localBuffers = [];
                //     this.renderBuffers = [];
                //     return;
                // }
                
                const chunkViewDistance = this.chunkViewDistance;               
                const center = [Game.player.x - this.localOffset[0] >> 4, Game.player.y - this.localOffset[1] >> 4, Game.player.z - this.localOffset[2] >> 4];
                
                // Only update the local buffers when the view is dirty or the player has moved to a diff chunk
                if (this.chunkViewDirty || !this.useFrustumCulling || center[0] != this.centerChunkPos[0] || center[1] != this.centerChunkPos[1] || center[2] != this.centerChunkPos[2]) {
                    
                    this.updateLocalChunks(center, this.centerChunkPos);
                    
                    this.centerChunkPos = center.slice();                    
                    this.localBuffers = new Array(this.buffers.size);
                    
                    let addedChunks = 0;
                    let total = 0;
                    let distance = 0;
                    
                    for (const [k, bf] of this.buffers) { // Remove all empty, unused, undefined, or culled chunks we can for rendering                  
                        if (!(!bf || !bf.ready || bf.empty || (bf.total < 1 && bf.atotal < 1))) {
                            
                            distance = Minecraft.util.getDistance(...center, ...bf.offset);
                            if (distance > chunkViewDistance && this.useFrustumCulling) {
                                bf.local = false;
                                continue;
                            }

                            bf.local = true;
                            this.localBuffers[total++] = [distance, bf];
                        }
                    }

                    this.localBuffers.length = total;
                    this.localBuffers.sort((a, b) => a[0] - b[0]);
                    this.chunkViewDirty = false;
                }
                
                const frustum = Game.camera.updateViewFrustum();
                this.renderBuffers = new Array(this.localBuffers.length);
                let total = 0; 
                
                let local = null;
                const localTotal = this.localBuffers.length;
                for (let i = 0; i < localTotal; i++) {
                    local = this.localBuffers[i][1];
                    
                    if (this.useFrustumCulling && Game.camera.isBoxCulled(local.bounds, frustum)) {
                        continue;
                    }
                    else {
                        this.renderBuffers[total++] = local;
                    }
                }
                
                this.renderBuffers.length = total;
                
            }
            tryAddRenderChunk(buffer) {
                if (!(!buffer || !buffer.ready || buffer.empty || (buffer.total < 1 && buffer.atotal < 1))) {
                    const center = [Game.player.x - this.localOffset[0] >> 4, Game.player.y - this.localOffset[1] >> 4, Game.player.z - this.localOffset[2] >> 4];
                    const distance = Minecraft.util.getDistance(...center, ...buffer.offset);
                    if (distance > this.chunkViewDistance && this.useFrustumCulling) return;
                    
                    buffer.local = true;
                    this.localBuffers.push([distance, buffer]);
                }
            }
            updateLocalChunks(newCenter, oldCenter, force = false) {
            
                const dx = newCenter[0] - oldCenter[0];
                const dy = newCenter[1] - oldCenter[1];
                const dz = newCenter[2] - oldCenter[2];
                
                const p = this;
                const sch = this.shape;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                if (force || distance > this.chunkViewDistance * .5) {
                    // Redo the initial spiral chunk adding
                    const chunkLoadPadding = 2;
                    const endDistance = this.chunkViewDistance + chunkLoadPadding;
                    const chunkBounds = sch.getChunkBounds();
                    
                    let cxMinB = Math.max(Math.min(newCenter[0] - endDistance, newCenter[0] + endDistance), chunkBounds[0][0]);
                    let cyMinB = Math.max(Math.min(newCenter[1] - endDistance, newCenter[1] + endDistance), chunkBounds[0][1]);
                    let czMinB = Math.max(Math.min(newCenter[2] - endDistance, newCenter[2] + endDistance), chunkBounds[0][2]);
                    let cxMaxB = Math.min(Math.max(newCenter[0] - endDistance, newCenter[0] + endDistance), chunkBounds[1][0]);
                    let cyMaxB = Math.min(Math.max(newCenter[1] - endDistance, newCenter[1] + endDistance), chunkBounds[1][1]);
                    let czMaxB = Math.min(Math.max(newCenter[2] - endDistance, newCenter[2] + endDistance), chunkBounds[1][2]);
                    
                    let cxMin = Math.max(Math.min(cxMinB, cxMaxB), chunkBounds[0][0]);
                    let cyMin = Math.max(Math.min(cyMinB, cyMaxB), chunkBounds[0][1]);
                    let czMin = Math.max(Math.min(czMinB, czMaxB), chunkBounds[0][2]);
                    let cxMax = Math.min(Math.max(cxMinB, cxMaxB), chunkBounds[1][0]);
                    let cyMax = Math.min(Math.max(cyMinB, cyMaxB), chunkBounds[1][1]);
                    let czMax = Math.min(Math.max(czMinB, czMaxB), chunkBounds[1][2]);
                    
                    const startX = Math.min(Math.max(newCenter[0], cxMin), cxMax);
                    const startZ = Math.min(Math.max(newCenter[2], czMin), czMax);
                
                    const spiral = new _window.Cubical.Lib.SpiralIterator([startX, startZ], [cxMin, czMin], [cxMax, czMax]);
                    let nextPos = [startX, startZ];
                    let x, z;
                    
                    while (nextPos) {
                        
                        x = nextPos[0];
                        z = nextPos[1];
                        
                        for (let y = cyMax; y >= cyMin; y--) {
                            const index = this.getChunkId(x, y, z);
                            const oldBuffer = this.buffers.get(index);
                            
                            if (oldBuffer == null && sch.hasChunkData(x, y, z)) {
                                
                                const buffer = new _cubical.Render.VoxelChunkBuffer(this, [x, y, z]);
                                buffer.id = index;
                                this.buffers.set(index, buffer);
                                
                                buffer.updateChunkData(this.fastUpdate);			
                                
                                if (!buffer.empty) {
                                    // this.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "request", false, {bufferId: buffer.bufferId});	
                                    this.sendWorkerChunkRequest(buffer.chunkData, buffer.bufferId);
                                }
                                else if (buffer.hasBufferData()) {
                                    buffer.clearBufferData();
                                }
                            }
                        }
                        
                        nextPos = spiral.next();
                    }                    
                }
                else {
                    // Caluclate the offset sections and add them separately
                    const chunkLoadPadding = 2;
                    const endDistance = this.chunkViewDistance + chunkLoadPadding;
                    const chunkBounds = sch.getChunkBounds();
                    
                    const cxMin = Math.max(Math.min(newCenter[0] - endDistance, oldCenter[0] - endDistance), chunkBounds[0][0]);
                    const cyMin = Math.max(Math.min(newCenter[1] - endDistance, oldCenter[1] - endDistance), chunkBounds[0][1]);
                    const czMin = Math.max(Math.min(newCenter[2] - endDistance, oldCenter[2] - endDistance), chunkBounds[0][2]);
                    const cxMax = Math.min(Math.max(newCenter[0] + endDistance, oldCenter[0] + endDistance), chunkBounds[1][0]);
                    const cyMax = Math.min(Math.max(newCenter[1] + endDistance, oldCenter[1] + endDistance), chunkBounds[1][1]);
                    const czMax = Math.min(Math.max(newCenter[2] + endDistance, oldCenter[2] + endDistance), chunkBounds[1][2]);
                    
                    const bounds = [cxMin, cyMin, czMin, cxMax, cyMax, czMax];
                    const boxes = [];
                    
                    if (dx != 0) {                        
                        const box = bounds.slice();
                        
                        if (dx > 0) box[0] = box[3] - dx;
                        else box[3] = box[0] - dx;
                        
                        boxes.push(box);
                    }
                    
                    if (dy != 0) {                        
                        const box = bounds.slice();
                        
                        if (dy > 0) box[1] = box[4] - dy;
                        else box[4] = box[1] - dy;
                        
                        boxes.push(box);
                    }
                    
                    if (dz != 0) {                        
                        const box = bounds.slice();
                        
                        if (dz > 0) box[2] = box[5] - dz;
                        else box[5] = box[2] - dz;
                        
                        boxes.push(box);
                    }
                    
                    for (let b = 0; b < boxes.length; b++) {
                        const box = boxes[b];
                        
                        for (let x = box[0]; x < box[3] + 1; x++) {
                            for (let y = box[1]; y < box[4] + 1; y++) {
                                for (let z = box[2]; z < box[5] + 1; z++) {
                                    const index = this.getChunkId(x, y, z);
                                    const oldBuffer = this.buffers.get(index);
                                    
                                    if (oldBuffer == null && sch.hasChunkData(x, y, z)) {
                                        
                                        const buffer = new _cubical.Render.VoxelChunkBuffer(this, [x, y, z]);
                                        buffer.id = index;
                                        this.buffers.set(index, buffer);
                                        
                                        buffer.updateChunkData(this.fastUpdate);			
                                        
                                        if (!buffer.empty) {
                                            // this.worker.createRequest("BuildChunk", buffer.chunkData, p.setBufferData.bind(p), "request", false, {bufferId: buffer.bufferId});	
                                            this.sendWorkerChunkRequest(buffer.chunkData, buffer.bufferId);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
            
            }
            clearBuffers(setInactive = false) {
                if (setInactive) this.updatesDisabled = true;

				this.buffers = new Map();
                this.renderBuffers = new Array();
                this.dirtyBuffers = new Set();
                this.chunkViewDirty = true;
            }
			addChunkBuffer(cx, cy, cz) {
				var index = this.getChunkId(cx, cy, cz);
				
                var buffer = new _window.Cubical.Render.VoxelChunkBuffer(this, [cx,cy,cz]);
                buffer.id = index;
                buffer.dirty = true;
                
				this.buffers.set(index, buffer);
                this.dirtyBuffers.add(this.buffers.get(index));
                this.chunkViewDirty = true;
			}
			setBufferData(request) {
				if (!request.ref) return;
                
				var id = request.response.bufferId;
				if(id == null || typeof id === 'undefined' || !this.buffers.get(id)) return
				
				const buffer = this.buffers.get(id);
                // const wasReady = buffer.ready && !buffer.empty;
                
                buffer.setBufferData(request.response);
                
                if (!buffer.local) this.tryAddRenderChunk(buffer);
                // this.chunkViewDirty = true;
                
                this.totalWaitingRequests--;
                
                if (this.totalWaitingRequests == 0) {
                    if (this.onRequestsCleared) this.onRequestsCleared();
                    
                    this.chunkViewDirty = true;
                }
			}
			getChunkId(cx, cy, cz) {
				var result = 5519;
				result = 3779 * result + cx;
				result = 3779 * result + cy;
				result = 3779 * result + cz;
				return result;
			}
            getChunkCoords(chunkId) {
                // TODO: Add a way to revers the chunk id
                /*
				var result = ((((3779 * 5519 + cx) * 3779) + cy) * 3779 + cz)
                
                
                // -------------------------
                var result = 5519;
				result = 3779 * result + cx;
				result = 3779 * result + cy;
				result = 3779 * result + cz;
				return result;
                */
            }
			onBlockChange(x, y, z, xEnd = null, yEnd = null, zEnd = null) {
				if (this.updatesDisabled) return;
                
				const chunks = this.getAffectedChunks(x, y, z, xEnd, yEnd, zEnd);
				for (let i = 0; i < chunks.length; i++) {
					if (!this.buffers.has(chunks[i])) {
						if (typeof chunks[i] === 'number') {
                            this.addChunkBuffer(x >> 4, y >> 4, z >>4);
                            this.dirtyBuffers.add(this.buffers.get(chunks[i]));
                        }
                        else {
                            this.addChunkBuffer(chunks[i][0], chunks[i][1], chunks[i][2]);
                            const newChunkIndex = this.getChunkIndexFromChunkCoords(chunks[i][0], chunks[i][1], chunks[i][2]);
                            this.dirtyBuffers.add(this.buffers.get(newChunkIndex));
                        }
					}
					else {
                        this.dirtyBuffers.add(this.buffers.get(chunks[i]));
                    }
				}
                
                this.chunkViewDirty = true;
			}
            setAllDirty() {
				const p = this;
                this.buffers.forEach((v, k, m) => {
					p.dirtyBuffers.add(v);
                });
                
                this.chunkViewDirty = true;
            }
			getAffectedChunks(x, y, z, xEnd = null, yEnd = null, zEnd = null) {
				var chunks = [];
                const p = this;
                const cx = x >> 4;
				const cy = y >> 4;
				const cz = z >> 4;
				
				const xm = x % 16;
				const ym = y % 16;
				const zm = z % 16;
				
                // No end position found, only check a single block position
                if (xEnd == null || yEnd == null || zEnd == null) {
                    if (xm == 0) chunks.push(this.getChunkIndexFromChunkCoords(cx-1,cy,cz));
                    else if (xm == 15) chunks.push(this.getChunkIndexFromChunkCoords(cx+1,cy,cz));
                    
                    if (ym == 0) chunks.push(this.getChunkIndexFromChunkCoords(cx,cy-1,cz));
                    else if (ym == 15) chunks.push(this.getChunkIndexFromChunkCoords(cx,cy+1,cz));

                    if (zm == 0) chunks.push(this.getChunkIndexFromChunkCoords(cx,cy,cz-1));
                    else if (zm == 15) chunks.push(this.getChunkIndexFromChunkCoords(cx,cy,cz+1));
                    
                    chunks = chunks.filter((val) => p.buffers.has(val));
                    chunks.push(this.getChunkIndexFromChunkCoords(cx,cy,cz));
                    
                    return chunks;
                }
                else { // Check an area for affected chunks
                    const cxMin = xm == 0 ? cx - 1 : cx;
                    const cyMin = ym == 0 ? cy - 1 : cy;
                    const czMin = zm == 0 ? cz - 1 : cz;
                    
                    const cxEnd = xEnd >> 4;
                    const cyEnd = yEnd >> 4;
                    const czEnd = zEnd >> 4;
                    
                    const xmEnd = xEnd % 16;
                    const ymEnd = yEnd % 16;
                    const zmEnd = zEnd % 16;
                    
                    const cxMax = xmEnd == 15 ? cxEnd + 1 : cxEnd;
                    const cyMax = ymEnd == 15 ? cyEnd + 1 : cyEnd;
                    const czMax = zmEnd == 15 ? czEnd + 1 : czEnd;
                    var ci = 0;
                    
                    for (var xi = cxMin; xi <= cxMax; xi++) {
                        for (var yi = cyMin; yi <= cyMax; yi++) {
                            for (var zi = czMin; zi <= czMax; zi++) {
                                ci = this.getChunkIndexFromChunkCoords(xi, yi, zi);
                                if (p.buffers.has(ci)) chunks.push(ci);
                                else chunks.push([xi, yi, zi]);
                            }
                        }
                    }
                    
                    return chunks;                    
                }
			}
			getChunkIndexFromChunkCoords(cx, cy, cz) {
				return this.getChunkId(cx, cy, cz);
				// return ((cx * (this.y * this.z)) + (cy * this.z) + cz);
			}
			getChunkIndexFromWorldCoords(x, y, z) {
				return (Math.floor(x/16) * (this.y * this.z)) + (Math.floor(y/16) * this.z) + Math.floor(z/16);
			}
			getPosition() {
                return vec3.add([0,0,0], this.offset, this.localOffset);
            }
            sendWorkerChunkRequest(chunkData, bufferId) {
                this.worker.createRequest("BuildChunk", chunkData, this.setBufferData.bind(this), "request", false, {bufferId: bufferId});
                this.totalWaitingRequests++;
            }
            setViewDistance(chunkDistance) {
                this.chunkViewDistance = chunkDistance;
                this.chunkViewDirty = true;
            }
			setTranslation(x, y, z, yaw = 0, pitch = 0) {
				var transMat = Minecraft.util.getIdentityMatrix();
                mat4.translate(transMat, transMat, [x + this.offset[0], y + this.offset[1], z + this.offset[2]]);

                if (yaw != 0) mat4.rotateY(transMat, transMat, yaw); 
                if (pitch != 0) mat4.rotateX(transMat, transMat, pitch);
                
				this.matrix = transMat;
                this.localOffset = [x, y, z];
			}		
			drawTexture(shader) {
				if (this.renderingDisabled) return;
                
				if (this.matrix && this.matrix.length > 0) {
                    shader.shader.setUniform("mMatrix", this.matrix);
				}
                
                const aPosAttr = shader.shader.getAttribute("aPos");
                const aColAttr = shader.shader.getAttribute("aCol");
                const aTexAttr = shader.shader.getAttribute("aTex");
                
                const bufferTotal = this.renderBuffers.length;
                let triangleTotal = 0;
                
                for (let i = 0; i < bufferTotal; i++) {
                    const bf = this.renderBuffers[i];
                    const bfTotal = bf.total;
                    
                    if (bfTotal < 1) continue;
					
                    aPosAttr.prepareBuffer(bf.v);
                    aColAttr.prepareBuffer(bf.c);
                    aTexAttr.prepareBuffer(bf.t);
                    
					gl.drawArrays(gl.TRIANGLES, 0, bfTotal);
                    triangleTotal += bfTotal;
                };
                
                return triangleTotal;
			}
			drawAlpha(shader) {
				if (this.renderingDisabled) return;
                
				if (this.matrix && this.matrix.length > 0) {
					shader.shader.setUniform("mMatrix", this.matrix);
				}
				
                const aPosAttr = shader.shader.getAttribute("aPos");
                const aColAttr = shader.shader.getAttribute("aCol");
                const aTexAttr = shader.shader.getAttribute("aTex");
                
                const bufferTotal = this.renderBuffers.length;
                let triangleTotal = 0;
                
                for (let i = 0; i < bufferTotal; i++) {
                    const bf = this.renderBuffers[i];
                    const bfaTotal = bf.atotal;
                    
                    if (bfaTotal < 1) continue;
					
                    aPosAttr.prepareBuffer(bf.av);
                    aColAttr.prepareBuffer(bf.ac);
                    aTexAttr.prepareBuffer(bf.at);
                    
					gl.drawArrays(gl.TRIANGLES, 0, bfaTotal);
                    triangleTotal += bfaTotal;
                };
                
                return triangleTotal;
			}
			drawShadow(shader) {
				if (this.renderingDisabled) return;
                
				if (this.matrix && this.matrix.length > 0) {
					gl.uniformMatrix4fv(shader.mMatrix, false, this.matrix);
				}
				
                // Can't use frustum culled render chunks since we dont draw shadows every frame
				for (var bf of this.buffers.values()) {                 
                    if (!bf || !bf.ready || bf.empty || bf.total < 1) continue;
					
                    gl.enableVertexAttribArray(shader.vertexPositionAttribute, 'aPos');
                    gl.bindBuffer(gl.ARRAY_BUFFER, bf.v);
                    gl.vertexAttribPointer(shader.vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);
                    
                    gl.drawArrays(gl.TRIANGLES, 0, bf.total);
				};

				// gl.uniformMatrix4fv(shader.mMatrix, false, mat4.identity([]));
			}

		};

        this.VoxelChunkBuffer = class VoxelChunkBuffer {
			constructor(parent, offset) {
				this.parent = parent;
				this.offset = offset;
				this.id = 0;
				this.active = true;
				this.waiting = false;
				this.dirty = false;
				this.ready = false;
				this.empty = true;
                this.local = false;
				this.v = gl.createBuffer();
				this.c = gl.createBuffer();
				this.t = gl.createBuffer();
				this.av = gl.createBuffer();
				this.ac = gl.createBuffer();
				this.at = gl.createBuffer();
				this.total = 0;
				this.atotal = 0;
				this.chunkData = null;
				this.blocks = [];
                this.bounds = [
                    this.offset[0] * 16, this.offset[1] * 16, this.offset[2] * 16,
                    (1 + this.offset[0]) * 16, (1 + this.offset[1]) * 16, (1 + this.offset[2]) * 16
                ];
			}
            updateChunkData(fastUpdate = false) {
                const shp = this.parent.shape;
                
                const chunkSize = 18;
                const blockTotal = chunkSize * chunkSize * chunkSize;
                const blockArray = new Uint8Array(blockTotal * 2);

                const xo = this.offset[0] * 16 - 1;
                const yo = this.offset[1] * 16 - 1;
                const zo = this.offset[2] * 16 - 1;
                
                let allOpen = true;
                
                if (fastUpdate) {
                    const chunkSize2 = chunkSize * chunkSize;
                    
                    const sx = shp.x;
                    const sy = shp.y;
                    const sz = shp.z;
                    const sxz = sx * sz;
                    
                    let xx, yy, zz, wx, wy, wz, ey, ez;
                    let blockId, blockData;
                    let parentIndex = 0;
                    let childIndex = -1;

                    for (yy = 0; yy < chunkSize; yy++) {
                        wy = yy + yo;
                        if (wy < 0 || wy >= sy) {
                            childIndex += chunkSize2;
                            continue;
                        }
                        ey = wy * sxz;
                        
                        for (zz = 0; zz < chunkSize; zz++) {
                            wz = zz + zo;
                            if (wz < 0 || wz >= sz) {
                                childIndex += chunkSize;
                                continue;
                            }
                            ez = wz * sx;
                            
                            for (xx = 0; xx < chunkSize; xx++) {
                                wx = xx + xo;
                                childIndex++;
                                if (wx < 0 || wx >= sx) {
                                    continue;
                                }
                            
                                parentIndex = ey + ez + wx;
                                blockId = shp.blocks[parentIndex];
                                blockData = shp.data[parentIndex];
                                
                                if (blockId > 0 || blockData > 0) {
                                    blockArray[childIndex] = blockId;
                                    blockArray[childIndex + blockTotal] = blockData;
                                    
                                    if (allOpen) allOpen = false;
                                } 
                            }
                        }
                    }
                    
                    if (allOpen) {
                        this.empty = true;
                        this.ready = true;
                        return;
                    }
                    else this.empty = false;
                    
                    const maxSize = this.parent.shape.getSize();
                    
                    const data = {};
                    data.offset = this.offset;
                    data.maxSize = [maxSize.x, maxSize.y, maxSize.z];
                    data.bufferId = this.id;
                    data.transfer = [blockArray.buffer];
                    
                    this.chunkData = data;
                    
                }
                else {
                    const sz = this.parent.shape.getSize();
                    
                    let x, y, z, ox, oy, oz;
                    let block;
                    let childIndex = 0;

                    for (y = 0; y < chunkSize; y++) {
                        oy = y + yo;
                        for (z = 0; z < chunkSize; z++) {
                            oz = z + zo;                            
                            for (x = 0; x < chunkSize; x++) {
                                ox = x + xo;
                            
                                block = shp.getBlock(ox, oy, oz);
                            
                                if (block && (block.id > 0 || block.data > 0)) {
                                    blockArray[childIndex] = block.id;
                                    blockArray[childIndex + blockTotal] = block.data;

                                    if (allOpen) allOpen = false;
                                }
                                
                                childIndex++;
                            }
                        }
                    }
                    
                    if (allOpen) {
                        this.empty = true;
                        this.ready = true;
                        
                        return;
                    }
                    
                    this.empty = false;
                    this.chunkData = {
                        offset: this.offset,
                        maxSize: [sz.x, sz.y, sz.z],
                        bufferId: this.id,
                        transfer: [blockArray.buffer]
                    };
                }
			}
			getWorldPosition() {
                
                return [
                    this.offset[0] * 16
                ];
            }
            setBufferData(dataObj) {
				const vd = dataObj.transfer[0];
				const cd = dataObj.transfer[1];
				const td = dataObj.transfer[2];
				
				const avd = dataObj.transfer[3];
				const acd = dataObj.transfer[4];
				const atd = dataObj.transfer[5];
                
                // Using 32 bit floats in the array buffers so all byte lengths are divided by 4 to start
				this.v.numItems = vd.byteLength / 4 / 4;
				this.c.numItems = cd.byteLength / 4 / 4;
				this.t.numItems = td.byteLength / 4 / 2;
				this.total = this.v.numItems;
				
				this.av.numItems = avd.byteLength / 4 / 4;
				this.ac.numItems = acd.byteLength / 4 / 4;
				this.at.numItems = atd.byteLength / 4 / 2;
				this.atotal = this.av.numItems;			
               
				gl.bindBuffer(gl.ARRAY_BUFFER, this.v);
				gl.bufferData(gl.ARRAY_BUFFER, vd, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.c);
				gl.bufferData(gl.ARRAY_BUFFER, cd, gl.STATIC_DRAW);
                
				gl.bindBuffer(gl.ARRAY_BUFFER, this.t);
				gl.bufferData(gl.ARRAY_BUFFER, td, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.av);
				gl.bufferData(gl.ARRAY_BUFFER, avd, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.ac);
				gl.bufferData(gl.ARRAY_BUFFER, acd, gl.STATIC_DRAW);
                
				gl.bindBuffer(gl.ARRAY_BUFFER, this.at);
				gl.bufferData(gl.ARRAY_BUFFER, atd, gl.STATIC_DRAW);
				
				this.waiting = false;
				this.ready = true;
			}
            hasBufferData() {
				return (this.total + this.atotal) > 0;
            }
            clearBufferData() {
				this.v.numItems = 0;
				this.c.numItems = 0;
				this.t.numItems = 0;
				this.total = 0;
				
				this.av.numItems = 0;
				this.ac.numItems = 0;
				this.at.numItems = 0;
                this.atotal = 0;			
               
                const empty = new ArrayBuffer(0);
               
				gl.bindBuffer(gl.ARRAY_BUFFER, this.v);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.c);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
                
				gl.bindBuffer(gl.ARRAY_BUFFER, this.t);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.av);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
				
				gl.bindBuffer(gl.ARRAY_BUFFER, this.ac);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
                
				gl.bindBuffer(gl.ARRAY_BUFFER, this.at);
				gl.bufferData(gl.ARRAY_BUFFER, empty, gl.STATIC_DRAW);
            }

		};

    });
    
	this.Entity = new (function Entity() {
		this._group = true;
		this.Entity = class Entity {
			constructor(id) {
				this.id = id;
				this.x = 0;
				this.y = 0;
				this.z = 0;
				this.yaw = 0;
				this.pitch = 0;
				this.bounds = [-.5, 0, -.5, .5, 1, .5];
                this.blockModel = {id: 1, data: 0};
                this.carryParentEntity = null;
                this.isAsleep = false;
                this.isVisible = true;
			}
			update(dt) {

			}
			draw() {
                if (!this.isVisible) return;
                
				var buffer = Game.webgl.textureShader.staticBuffer;
				
				if(buffer.ready) {
                    gl.bindTexture(gl.TEXTURE_2D, Game.webgl.textureShader.texture);
					let matrix = Minecraft.util.getIdentityMatrix();
					
					mat4.translate(matrix, matrix, [this.x, this.y, this.z]);
					mat4.rotateY(matrix, matrix, this.yaw * Math.PI/180);
					mat4.rotateX(matrix, matrix, this.pitch * Math.PI/180);
					
					buffer.matrix = matrix;
                    const blockName = `staticBlock_${this.blockModel.id}_${this.blockModel.data}`;
                    if (buffer.hasSection(blockName)) buffer.drawSection(blockName);
					else buffer.drawSection("staticBlock");
				}
			}
			getId(){
				return this.id;
			}
			getData() {
				return this.data;
			}
			setData(data) {
				
			}
			getPosition() {
				return [this.x, this.y, this.z];
			}
			setPosition(x, y, z) {
				this.x = x;
				this.y = y;
				this.z = z;
			}
			getDirection() {
				return [this.yaw, this.pitch];
			}
			setDirection(yaw, pitch) {
				this.yaw = yaw;
				this.pitch = pitch;
			}
			getEntityPosition() {
				return [this.x, this.y, this.z, this.yaw, this.pitch];
			}
			setEntityPosition(entPos) {
				this.x = entPos[0];
				this.y = entPos[1];
				this.z = entPos[2];
				this.yaw = entPos[3];
				this.pitch = entPos[4];
			}
			teleport(x = null, y = null, z = null, yaw = null, pitch = null, preserveSpeed = false) {
                if (x != null || y != null || z != null) {
                    this.setPosition(x != null ? x : this.x, y != null ? y : this.y, z != null ? z : this.z);    
                }
                
                if (yaw != null) this.yaw = yaw;
                if (pitch != null) this.pitch = pitch;           
                if (!preserveSpeed) this.vertSpeed = 0;
                
                this.moved = true;
				Game.change = true;
            }
            getBounds() {
				return this.bounds; 
			}
			getBoundingBox() {
				var bounds = this.getBounds();
				var bb = [
					this.x + bounds[0],
					this.y + bounds[1],
					this.z + bounds[2],
					this.x + bounds[3],
					this.y + bounds[4],
					this.z + bounds[5],
				];
				return bb;
			}
			getSize() {
				var sz = [
					this.bounds[3] - this.bounds[0],
					this.bounds[4] - this.bounds[1],
					this.bounds[5] - this.bounds[2]
				];
				return sz;
			}
			interaction(ent, interaction, mods) {
				
			}

			static createEntity(data) {
				var type = data.type;
				var ent;
				switch (type) {
					case ("Waypoint"):
						ent = new _cubical.Entity.WaypointEntity(data.entity, data.entData);
						break;
					case ("Character"):
						ent = new _cubical.Entity.CharacterEntity(data.entity, data.entData);
						break;
					case ("Kinetic"):
						ent = new _cubical.Entity.KineticEntity(data.entity, data.entData);
						break;
					case ("Projectile"):
						ent = new _cubical.Entity.ProjectileEntity(data.entity, data.entData);
						break;
					default:
						return null;
				}
				
				ent.setEntityPosition(data.entPos);
				return ent;
			}
			
		}

		this.PhysicalEntity = class PhysicalEntity extends this.Entity {
			constructor(id) {
                super(id);
				this.speed = 10;
				this.flySpeed = 10;
				this.hitDetection = true;
				this.useGravity = false;
				this.jumpForce = 8.2;
				this.grounded = false;
				this.gravityStr = 26;
				this.vertSpeed = 0;
				this.lastPos = [0,0,0];
                this.autoStepEnabled = true;
                this.entityCollisionEnabled = true;
			}
			update(dt) {
                if (this.isAsleep) return;
                
				this.moveProgress *= .9;
				this.moveForce *= .95;
				var progressLimit = 60;
				this.moveProgress += Math.pow(this.moveForce, 2) * (this.moveNormal ? 1 : -1);
				
                if(this.moveProgress > progressLimit) this.moveNormal = false;
				else if(this.moveProgress < -progressLimit) this.moveNormal = true;
				
				if (this.useGravity == true && this.hitDetection == true) {

					if (this.grounded == true && this.vertSpeed <= 0) {
						this.vertSpeed = 0;
					}
					this.vertSpeed -= this.gravityStr * Game.deltaTime;
					this.move([0, this.vertSpeed * Game.deltaTime, 0]);
				}
				else {
					this.vertSpeed = 0;
					this.move([0, 0, 0]);
				}
			}
			move(moveDir) {
				
				var dir = moveDir.slice();
				var shp = Game.getShape();
				var player = this;
				var size = this.getSize();
				var lastPos = this.lastPos || [];
                var startPos = [this.x, this.y, this.z, this.yaw, this.pitch];
				var playerBox = this.getBoundingBox();
                
				function checkNeighbors(basePos) {
					
					var startPos = [Math.floor(basePos[0]),Math.floor(basePos[1]),Math.floor(basePos[2])];
					var maxOver = [0,0,0];
					var blockBox,ox,oy,oz,bc,b;
                    const baseBox = player.getBoundingBox();
					
					for (var y = -1; y < 2; y++) {
						oy = startPos[1] + y;
						for (var z = -1; z < 2; z++) {
							oz = startPos[2] + z;
							for (var x = -1; x < 2; x++) {
								ox = startPos[0] + x;

								bc = player.collisionCheckBlock(ox, oy, oz, baseBox);
								if (bc.overlap[0] > 0 && bc.overlap[1] > 0 && bc.overlap[2] > 0) return bc;
								
							}
						}
					}
					return {overlap: [0,0,0],limit:[0,0,0]};
				}			
                
                const ents = Game.map.getEntitiesInRange(...this.getPosition(), 4);
                function checkEntities() {
                    const baseBox = player.getBoundingBox();
                    for (var i = 0; i < ents.length; i++) {
                        const ent = ents[i];
                        if (ent.id == player.id) continue;
                        
                        const bc = player.collisionCheckEntity(ent, baseBox);
                        
                        if (bc.overlap[0] > 0 && bc.overlap[1] > 0 && bc.overlap[2] > 0) {
                            bc.ent = ent;
                            return bc;
                        }
                    }
                    
                    return {overlap: [0,0,0],limit:[0,0,0]};
                }
            
				if (this.hitDetection) {
					
					var startHitInfo = checkNeighbors([this.x,this.y,this.z]);
					if(startHitInfo.overlap[0] > 0 || startHitInfo.overlap[1] > 0) this.moveToSurface();
					
					var maxStepUp = .625;
					this.y += dir[1];
					var yHitInfo = checkNeighbors([this.x,this.y,this.z]);
                    var yHitEntityInfo = checkEntities();
					
                    if (yHitEntityInfo.overlap[1] > yHitInfo.overlap[1]) {
                        yHitInfo = yHitEntityInfo;
                    }
                    
					// if (this.grounded == true && dir[1] < 0) { //grounded and moving down
					// 	this.y = startPos[1];
                    //     this.vertSpeed = 0;
					// }
					// else
                    if (yHitInfo.overlap[1] > 0) { //block hit
						if (dir[1] <= 0) { //moving down
							this.grounded = true;
							this.y = yHitInfo.limit[1];
							//this.y -= dir[1];
						}
						else {
							this.y = startPos[1];
						}
                        
                        if (yHitInfo.ent && this instanceof _cubical.Entity.KineticEntity && yHitInfo.ent instanceof _cubical.Entity.KineticEntity) {
                            yHitInfo.ent.velocity[1] += this.velocity[1] * .6;
                            this.velocity[1] *= .4;
                        }
                        else {
                            this.vertSpeed = 0;
                            if (this instanceof _cubical.Entity.KineticEntity) this.velocity[1] = 0;
                        }
					}
					else {	// nothing hit
                        this.grounded = false;
					}				
					
					if (dir[0] != 0) {
						this.x += dir[0];
						var xHitInfo = checkNeighbors([this.x,this.y,this.z]);

                        var xHitEntityInfo = checkEntities();                        
                        if (xHitEntityInfo.overlap[1] > xHitInfo.overlap[1]) xHitInfo = xHitEntityInfo;

						if (xHitInfo.overlap[0] > 0) {
							
                            if (xHitInfo.ent && this instanceof _cubical.Entity.KineticEntity && xHitInfo.ent instanceof _cubical.Entity.KineticEntity) {
                                xHitInfo.ent.velocity[0] += this.velocity[0] * .6;
                                this.velocity[0] *= .4;
                            }
                            
							// test if we can step up to a block
							if (this.autoStepEnabled && ((this.grounded == true && xHitInfo.limit[1] > this.y && xHitInfo.limit[1] - this.y < maxStepUp) || (xHitInfo.limit[1] > this.y && xHitInfo.limit[1] - this.y < maxStepUp * .25))) { 
								var tmpy = this.y;
								this.y = xHitInfo.limit[1];
								var tmpHit = checkNeighbors([this.x,this.y,this.z]);
								if ((tmpHit.overlap[0] > 0 && tmpHit.overlap[1] > 0 && tmpHit.overlap[2] > 0)) {
									this.y = tmpy;
								}
								else {
									this.y -= (xHitInfo.limit[1] - this.y) * .75;
									xHitInfo = tmpHit;
									if (this instanceof _cubical.Entity.LocalPlayer) Game.camera.startSmoothShift(this.y - tmpy, .08); // smoothly shift the view up
								}
								
							}					
							if (xHitInfo.overlap[0] > 0) {
								if (dir[0] <= 0) this.x = xHitInfo.limit[0] + size[0] * .5;
								else this.x = xHitInfo.limit[0] - size[0] * .5;
                                
                                // if (this instanceof _cubical.Entity.KineticEntity) this.velocity[0] = 0;
							}
						}
					}
					
					if (dir[2] != 0) {
						this.z += dir[2];
						var zHitInfo = checkNeighbors([this.x,this.y,this.z]);

                        var zHitEntityInfo = checkEntities();                        
                        if (zHitEntityInfo.overlap[1] > zHitInfo.overlap[1]) zHitInfo = zHitEntityInfo;
                        
						if (zHitInfo.overlap[2] > 0) {
							
                            if (zHitInfo.ent && this instanceof _cubical.Entity.KineticEntity && zHitInfo.ent instanceof _cubical.Entity.KineticEntity) {
                                zHitInfo.ent.velocity[2] += this.velocity[2] * .6;
                                this.velocity[2] *= .4;
                            }
                            
							// test if we can step up to a block
							if (this.autoStepEnabled && ((this.grounded == true && zHitInfo.limit[1] > this.y && zHitInfo.limit[1] - this.y < maxStepUp) || (zHitInfo.limit[1] > this.y && zHitInfo.limit[1] - this.y < maxStepUp * .25))) { 
								var tmpy = this.y;
								this.y = zHitInfo.limit[1];
								var tmpHit = checkNeighbors([this.x,this.y,this.z]);
								if ((tmpHit.overlap[0] > 0 && tmpHit.overlap[1] > 0 && tmpHit.overlap[2] > 0)) this.y = tmpy;
								else {
									this.y -= ((zHitInfo.limit[1] - this.y) * .5);
									zHitInfo = tmpHit;
									if (this instanceof _cubical.Entity.LocalPlayer)Game.camera.startSmoothShift(this.y - tmpy, .08); // smoothly shift the view up
								}
								
							}
							if (zHitInfo.overlap[2] > 0) {
								if (dir[2] <= 0) this.z = zHitInfo.limit[2] + size[2] * .5;
								else this.z = zHitInfo.limit[2] - size[2] * .5;
                                
                                // if (this instanceof _cubical.Entity.KineticEntity) this.velocity[2] = 0;
							}
						}
					}
					
				}
				else {
					this.x += dir[0];
					this.y += dir[1];
					this.z += dir[2];
				}
				// this.updateGroundState();
				//Game.camera.lookAt(25,12,35);
				
				if (this.x != lastPos[0] || this.y != lastPos[1] || this.z != lastPos[2] || Math.abs(this.yaw - lastPos[3]) > .0001 || Math.abs(this.pitch - lastPos[4]) > .0001) {
					this.moved = true;
				}

				var endPos = [this.x, this.y, this.z, this.yaw, this.pitch];
				this.x = startPos[0] || 0;
				this.y = startPos[1] || 0;
				this.z = startPos[2] || 0;
				this.yaw = startPos[3] || 0;
				this.pitch = startPos[4] || 0;
				
				this.setEntityPosition(endPos);
				this.lastPos = endPos;
			}
			getSpeed() {
				return this.speed;
			}
			collisionCheckBB(box2, box1) {
				box1 = box1 ? box1 : this.getBoundingBox();
				var overlap = [0,0,0];
				var sz = this.getSize();
				var limit = [0,0,0];
				
				//x
				if (box1[0] < box2[0] && box1[3] > box2[3]) { //complete overlap - outside
					overlap[0] = box1[3] - box2[0];
					limit[0] = box2[0];
				}
				else if (box1[0] > box2[0] && box1[3] < box2[3]) { //complete overlap - inside			
                    overlap[0] = box1[3] - box2[0];
					limit[0] = box2[0];
				}			
				else if (box1[0] <= box2[3] && box1[0] >= box2[0]) { //partial overlap - entering from min
					overlap[0] = box2[3] - box1[0];
					limit[0] = box2[3];
				}
				else if (box1[3] >= box2[0] && box1[3] <= box2[3]) { //partial overlap - entering from max 
					overlap[0] = box1[3] - box2[0];
					limit[0] = box2[0];
				}
				else if (box1[0] == box2[0] && box1[3] == box2[3]) { //complete overlap - match			
                    overlap[0] = box1[3] - box1[0];
					limit[0] = box2[0];
				}	
				
				
				//y
				if (box1[1] < box2[1] && box1[4] > box2[4]) {
					overlap[1] = box2[4] - box1[1];
					limit[1] = box2[4];
				}
				else if (box1[1] > box2[1] && box1[4] < box2[4]) {
					overlap[1] = box2[4] - box1[1];
					limit[1] = box2[4];
				}			
				else if (box1[1] <= box2[4] && box1[1] >= box2[1]) {
					overlap[1] = box2[4] - box1[1];
					limit[1] = box2[4];
				}
				else if (box1[4] >= box2[1] && box1[4] <= box2[4]) {
					overlap[1] = box1[4] - box2[1];
					limit[1] = box2[1];
				}
				else if (box1[1] == box2[1] && box1[3] == box2[3]) {			
                    overlap[1] = box1[4] - box1[1];
					limit[1] = box2[4];
				}				
				//z
				if (box1[2] < box2[2] && box1[5] > box2[5]) {
					overlap[2] = box2[5] - box1[2];
					limit[2] = box2[5];
				}
				else if (box1[2] > box2[2] && box1[5] < box2[5]) {
					overlap[2] = box2[5] - box1[2];
					limit[2] = box2[5];
				}
				else if (box1[2] <= box2[5] && box1[2] >= box2[2]) {
					overlap[2] = box2[5] - box1[2];
					limit[2] = box2[5];
				}
				else if (box1[5] >= box2[2] && box1[5] <= box2[5]) {
					overlap[2] = box1[5] - box2[2];
					limit[2] = box2[2];
				}
				else if (box1[2] == box2[2] && box1[5] == box2[5]) {
					overlap[2] = box1[5] - box1[2];
					limit[2] = box2[5];
				}
				
				return {overlap: overlap, limit: limit};	
			}
			collisionCheckBlock(x, y, z, playerBox) {
				
				if (this.useGravity && this.y < 0.001 && y < 0) {
					return {overlap: [1, -this.y ,1], limit:[0,0,0]};
				}
                
				const block = Game.getShape().getBlock(x,y,z);
				if (block &&  Minecraft.Blocks.isSolidBlock(block.id) !== false) {
					
					const boxes = Minecraft.Blocks.getBoundingBox(x,y,z, block.id, block.data, true);
					const maxOverlap = [0,0,0];
                    const maxLimit = [0,0,0];
                    
					let blockBox;
					
					for (let j = 0 ; j < boxes.length; j++) {
						blockBox = boxes[j];
						const bc = this.collisionCheckBB(blockBox, playerBox);
						
						if (bc.overlap[0] > 0 && bc.overlap[1] > 0 && bc.overlap[2] > 0) {                            
                            for (let s = 0; s < 3; s++) {
                                if (bc.overlap[s] > maxOverlap[s]) {
                                    maxOverlap[s] = bc.overlap[s];
                                    maxLimit[s] = bc.limit[s];
                                }
                            }
						}
					}
                    
                    if (maxOverlap[0] > 0 && maxOverlap[1] > 0 && maxOverlap[2] > 0) return {overlap: maxOverlap, limit: maxLimit};
				}
                
				return {overlap: [0,0,0], limit: [0,0,0]};
			}
			collisionCheckEntity(ent, playerBox) {

				if (ent instanceof PhysicalEntity && ent.entityCollisionEnabled)	{
					var entityBox = ent.getBoundingBox();
                    var bc = this.collisionCheckBB(entityBox, playerBox);
                    
                    if (bc.overlap[0] > 0 && bc.overlap[1] > 0 && bc.overlap[2] > 0) {
                        return bc;						
                    }
				}		
				return {overlap: [0,0,0], limit:[0,0,0]};
            }
            updateGroundState() {
				
				var startPos = [Math.floor(this.x),Math.floor(this.y),Math.floor(this.z)];
				var maxOver = [0,0,0];
				var blockBox,ox,oy,oz,bc,b;				
				
				var pbb = this.getBoundingBox();
				pbb[1] -= .01;
				pbb[4] -= .01;
				
				for (var y = -1; y <= 2; y++) {
					oy = startPos[1] + y;
					for (var z = -1; z < 2; z++) {
						oz = startPos[2] + z;
						for (var x = -1; x < 2; x++) {
							ox = startPos[0] + x; //
							
							bc = this.collisionCheckBlock(ox,oy,oz,pbb).overlap;
							if (bc[0] != 0 && bc[1] != 0 && bc[2] != 0) {
								this.grounded = true;
								return;
							}
							
						}
					}
				}
				this.grounded = false;
				
			}
			moveToSurface() {
                const x = Math.floor(this.x);
                let y = Math.floor(this.y);
                const z = Math.floor(this.z);
                
                this.x = x + .5;
                this.y = y;
                this.z = z + .5;
                
                // TODO: Need to fix this so it works when the shape doesn't have a y value
                // like for the VoxelWorlds; will cause the y to be NaN, whichs breaks the camera
				const shape = Game.shapes.getShape();
                const shapeHeightMax = shape.y || 260;
                let spaceFound = false;
				
				for (let yi = y; yi < shapeHeightMax; yi++) {
					if (shape.getBlockId(x, yi, z) == 0 && shape.getBlockId(x, yi + 1, z) == 0) {
						this.y = yi;
                        spaceFound = true;
						break;
					}
				}
                
                if (!spaceFound) {
                    this.hitDetection = false;
                }
                
				this.updateGroundState();
				this.moved = true;
				Game.change = true;
			}	
		}

		this.LivingEntity = class LivingEntity extends this.PhysicalEntity {
			
			constructor(id) {
				super(id);
				this.name = "Guest";
				this.skin = "inhaze";
				this.type = "Entity";
				this.health = 100;

				this.bodyYaw = 0;
				this.moveProgress = 0;
				this.moveNormal = true;
				this.moveForce = 0;
				this.velocity = [];
				this.viewHeight = 1.62;
				this.bounds = [-.3,0,-.3,.3, 1.8, .3];
			}
			draw() {
				if (!this.isVisible) return;

				var armBounce = (new Date().getTime() / 50 % 100) / 10;
				if(armBounce > 5) armBounce = 10 - armBounce;
				armBounce /= 2;
			
				if(typeof Game.webgl.skins[this.skin] === 'undefined') {
					Game.webgl.createSkinTexture(this.skin);
					return;
				}
				gl.bindTexture(gl.TEXTURE_2D, Game.webgl.skins[this.skin]);
				
				var matrix = Minecraft.util.getIdentityMatrix();
				mat4.translate(matrix, matrix, [this.x, this.y - (this instanceof _cubical.Entity.LocalPlayer ? Game.camera.yViewShift : 0), this.z]);
				mat4.rotateY(matrix, matrix, this.bodyYaw* Math.PI/180);
				
				var shader = Game.webgl.textureShader;
				shader.staticBuffer.matrix = matrix;
				
				if(shader.staticBuffer.ready) {
					var headMat = Minecraft.util.getIdentityMatrix();
					
					mat4.translate(headMat, headMat, [this.x, this.y + 1.5*.925 - (this instanceof _cubical.Entity.LocalPlayer ? Game.camera.yViewShift : 0), this.z]);
					mat4.rotateY(headMat, headMat, this.yaw * Math.PI/180);
					mat4.rotateX(headMat, headMat, this.pitch * Math.PI/180);
					
					shader.staticBuffer.matrix = headMat;
					shader.staticBuffer.drawSection("head");
					shader.staticBuffer.drawSection("hair");
					
					if (!(this instanceof _cubical.Entity.LocalPlayer)) this.update();
					mat4.translate(headMat, matrix, [0, .75*.9375, 0]);
					mat4.rotateX(headMat, headMat, this.moveProgress * Math.PI/180);
					shader.staticBuffer.matrix = headMat;
					shader.staticBuffer.drawSection("legLeft");
					
					mat4.rotateX(headMat, headMat, -2 * this.moveProgress * Math.PI/180);
					shader.staticBuffer.drawSection("legRight");

					mat4.translate(headMat, matrix, [0, 1.5*.9375, 0]);
					mat4.rotateX(headMat, headMat, armBounce * Math.PI/180 - this.moveProgress * Math.PI/180);
					mat4.rotateZ(headMat, headMat, armBounce * Math.PI/180);
					shader.staticBuffer.drawSection("armLeft");
					
					mat4.rotateX(headMat, headMat, 2 * this.moveProgress * Math.PI/180);
					mat4.rotateZ(headMat, headMat, -2 * armBounce * Math.PI/180);
					shader.staticBuffer.drawSection("armRight");
					
					shader.staticBuffer.matrix = matrix;
					shader.staticBuffer.drawSection("torso");
				}
			}
			
			getLookDirection() {
				var pitchRad = this.pitch * Math.PI/180;
				var yawRad = this.yaw * Math.PI/180;
				
				var len = Math.cos(pitchRad);
				return [-len * Math.sin(yawRad), Math.sin(pitchRad), -len * Math.cos(yawRad)];
			}
			setEntityPosition(entPos) {
				
				var shifted = false;
				var yawGap = 30;

				var testAngle = entPos[3]
				var tempYaw = this.bodyYaw;
				
				if(testAngle <90 && this.yaw > 270 ) {
					tempYaw -= 360;
				}
				else if(testAngle > 270 && this.yaw < 90) {
					tempYaw += 360;
				}

				var minYaw = testAngle - yawGap;
				var maxYaw = testAngle + yawGap;
				
				if(tempYaw >= maxYaw) {
					this.bodyYaw = maxYaw;
				}
				else if(tempYaw <= minYaw) {
					this.bodyYaw = minYaw;
				}
				
				this.velocity[0] = entPos[0] - this.x;
				this.velocity[1] = entPos[1] - this.y;
				this.velocity[2] = entPos[2] - this.z;
				if(vec3.length(this.velocity) > .01) this.bodyYaw = entPos[3];
				
				this.x = entPos[0];
				this.y = entPos[1];
				this.z = entPos[2];
				this.yaw = entPos[3];
				this.pitch = entPos[4];
				
				this.moveForce = Math.min(this.moveForce + Math.sqrt(Minecraft.util.lengthSq(this.velocity[0], 0, this.velocity[2]))*3, 3);
			}
			getHeldItem() {
				return 1;
			}
			damage(amt) {
				this.health -= amt;
				this.setEntityPosition([this.x, this.y+1, this.z, this.yaw, this.pitch]);
				this.lastPos[1] = this.y;
				this.moved = true;
			}
			getViewHeight() {
				return this.viewHeight;
			}
			getEyePosition() {
				return [this.x, this.y + this.getViewHeight(), this.z];
			}
			lookAt(x,y,z) {
				
				var vec = vec3.create();
				vec3.subtract(vec, [x,y,z], this.getEyePosition());
				vec3.normalize(vec, vec);			
			
				var yaw = Math.atan2(vec[0], vec[2]);
				var pitch = Math.asin(vec[1]);
			
				this.yaw = yaw * 180 / Math.PI + 180;
				this.pitch = pitch * 180 / Math.PI;
				this.setEntityPosition([this.x, this.y, this.z, this.yaw, this.pitch]);
				
				return vec;
			}
		}

		this.Player = class Player extends this.LivingEntity {
			constructor(packet) {
				super(packet.player);
				
				this.skin = packet.skin;
				this.name = packet.name;
				this.setEntityPosition(packet.entPos);
				this.type = "Player";
			}
		}

		this.CharacterEntity =  class CharacterEntity extends this.LivingEntity {
			constructor(id, data) {
				super(id);
				this.type = "Character";
				this.setData(data);
			}
			setData(data) {
				this.skin = data.skin || this.skin;
				this.name = data.name || this.name;
			}
		}

		this.LocalPlayer = class LocalPlayer extends this.LivingEntity {

			constructor() {
				super();
				this.name = "Guest";
				this.skin = "steve";
				this.type = "LocalPlayer"
				this.x = 0;
				this.y = 0;
				this.z = 100;
				this.pitch = 0;
				this.yaw = 0;
				this.speed = 3;
				this.flySpeed = 10;
				this.hitDetection = true;
				this.useGravity = false;
				this.jumpForce = 8.2;
				this.grounded = false;
                this.sprinting = false;
                this.sprintSpeedModifier = 1.5;
				this.gravityStr = 26;
				this.vertSpeed = 0;
				this.lastJump = 0;
                this.lastForwardTap = 0;
				this.bounds = [-.3,0,-.3,.3, 1.8, .3];
				this.stance = 0;
				this.stanceTime = 0;
				this.moved = false;
				this.lastPos = [];
                this.carryEntity = null;
                this.carryDistance = 0;
                this.carryOffset = [0, 0, 0];
                this.actionInProgress = null;
                this.maxStepUpHeight = .625;
                this.underwaterView = false;
                
                this.setHeight(Game.settings.getKey('playerHeight'));
                this.speed = Game.settings.getKey('playerSpeed');
                this.jumpForce = Game.settings.getKey('playerJumpStrength');
                this.gravityStr = Game.settings.getKey('playerGravityStrength');
                this.forwardKeybind = null;
                this.sprintKeybind = null;
            }

			update() {
			
				if(this.moved) {
					Game.network.sendPacket({id: "move_player",entPos: [this.x, this.y, this.z, this.yaw, this.pitch]});
				}
                
				var lastPos = this.lastPos.slice();
				this.moved = false;

				if (this.y < -200) {
					this.useGravity = false;
					this.y = Game.getShape().getSize().y + 2;
				}
				
                if (this.forwardKeybind == null) {
                    this.forwardKeybind = Game.input.keyboard.getKeybind('controlsKeybindMovementForward');
                    this.sprintKeybind = Game.input.keyboard.getKeybind("controlsKeybindMovementSprint");
                }
                
                const keyboard = Game.input.keyboard;
                const sprintKeycode = this.sprintKeybind.keycode;
                const matchingKeybind = keyboard.getMatchingKeybind(sprintKeycode, keyboard.isShiftDown(), keyboard.isCtrlDown(), keyboard.isAltDown());
                const isSprintHeld = (keyboard.isKeyDown(sprintKeycode) && matchingKeybind && matchingKeybind.id == this.sprintKeybind.id);

                const forwardKeycode = this.forwardKeybind.keycode;
                const matchingForwardKeybind = keyboard.getMatchingKeybind(forwardKeycode, keyboard.isShiftDown(), keyboard.isCtrlDown(), keyboard.isAltDown());
                const isForwardHeld = (keyboard.isKeyDown(forwardKeycode) && matchingForwardKeybind && matchingForwardKeybind.id == this.forwardKeybind.id);

                // handle moving the carried entity around
                if (this.carryChildEntity) {
                    let targetPosition = Game.player.getEyePosition();
                    let direction = Game.player.getLookDirection();
                    vec3.multiply(direction, direction, Array(3).fill(this.carryDistance));
                    vec3.add(targetPosition, targetPosition, direction);
                    
                    const carryOffset = [];
                    vec3.rotateY(carryOffset, this.carryOffset, [0,0,0], Game.player.yaw * (Math.PI / 180));
                    vec3.add(targetPosition, targetPosition, carryOffset);
                    
                    const hit = Game.input.mouse.hit;
                    if (hit.endPos instanceof Array && hit.distance < this.carryDistance) {
                        // targetPosition = hit.endPos.slice();
                        vec3.add(targetPosition, hit.endPos.slice(), carryOffset);
                    }
                    
                    if (this.carryChildEntity instanceof _cubical.Entity.KineticEntity) {
                    
                        let currentPosition = this.carryChildEntity.getPosition();
                        let force = [0, 0, 0];
                        vec3.subtract(force, targetPosition, currentPosition);
                        const forceLength = vec3.length(force);
                        const forceDirection = [];
                        vec3.normalize(forceDirection, force);
                        
                        let forceStrength = 8;
                        vec3.multiply(force, force, Array(3).fill(forceStrength));
                        
                        this.carryChildEntity.velocity = [0, 0, 0];
                        this.carryChildEntity.addForce(...force);
                    }
                    else {
                        this.carryChildEntity.setPosition(...targetPosition);
                    }
                }
                
                if (this.sprinting) {
                    if (!isForwardHeld) this.resetSprint();
                }
                else {
                    if (isSprintHeld && isForwardHeld) this.sprinting = true;
                }
                
				var moveLimit = .001;
				if (this.x != lastPos[0] || this.y != lastPos[1] || this.z != lastPos[2] || Math.abs(this.yaw - lastPos[3]) > moveLimit || Math.abs(this.pitch - lastPos[4]) > moveLimit) {
					this.moved = true;
				}
				
				this.updateStance();				
				super.update();
			}
			move(moveDir) {
				
				var dir = moveDir.slice();
				const shp = Game.getShape();
				var player = this;
				var size = this.getSize();
				var lastPos = this.lastPos || [];
				
				function checkNeighbors(basePos) {
					
					const startPos = [Math.floor(basePos[0]), Math.floor(basePos[1]), Math.floor(basePos[2])];
					const maxOverlap = [0,0,0];
                    const maxLimit = [0,0,0];
					var blockBox,ox,oy,oz,bc,b;
                    const maxHeight = Math.ceil(player.getBounds()[4]) + 1;
					
					for (let y = -1; y < maxHeight; y++) {
						oy = startPos[1] + y;
						for (let z = -1; z < 2; z++) {
							oz = startPos[2] + z;
							for (let x = -1; x < 2; x++) {
								ox = startPos[0] + x;

								bc = player.collisionCheckBlock(ox, oy, oz);
								if (bc.overlap[0] > 0 && bc.overlap[1] > 0 && bc.overlap[2] > 0) {
                                    for (let s = 0; s < 3; s++) {
                                        if (bc.overlap[s] > maxOverlap[s]) {
                                            maxOverlap[s] = bc.overlap[s];
                                            maxLimit[s] = bc.limit[s];
                                        }
                                    }
                                }
							}
						}
					}
                    
                    if (maxOverlap[0] > 0 && maxOverlap[1] > 0 && maxOverlap[2] > 0) return {overlap: maxOverlap, limit: maxLimit};
					return {overlap: [0,0,0], limit: [0,0,0]};
				}			
			
				if (this.hitDetection) {
					
					var startHitInfo = checkNeighbors([this.x, this.y, this.z]);
					if (startHitInfo.overlap[0] > 0 || startHitInfo.overlap[2] > 0) {
                        this.moveToSurface();
                        // this.hitDetection = false;
                        // return;
                    }
					
					const maxStepUp = this.maxStepUpHeight;
					this.y += dir[1];
					var yHitInfo = checkNeighbors([this.x,this.y,this.z]);
					
					if(this.grounded == true && dir[1] < 0) { //grounded and moving down
						this.y -= dir[1]
					}
					else if (yHitInfo.overlap[1] > 0) { //block hit
						if (dir[1] <= 0) { //moving down
							this.grounded = true;
							this.y = yHitInfo.limit[1] + .0001;
							//this.y -= dir[1];
						}
						else {
							this.y -= dir[1];
							this.vertSpeed = 0;
						}
					}
					else {	// nothing hit
						if (dir[1] > 0) {
							this.grounded = false;
						}
					}				
					
					if (dir[0] != 0) {
						this.x += dir[0];
						var xHitInfo = checkNeighbors([this.x,this.y,this.z]);
						if (xHitInfo.overlap[0] > 0) {
							
							// test if we can step up to a block
							if (this.autoStepEnabled && ((this.grounded == true && xHitInfo.limit[1] > this.y && xHitInfo.limit[1] - this.y < maxStepUp)|| (xHitInfo.limit[1] > this.y && xHitInfo.limit[1] - this.y < maxStepUp * .25 && this.vertSpeed <= 0))) { 
								var tmpy = this.y;
								this.y = xHitInfo.limit[1] + .0001;
								var tmpHit = checkNeighbors([this.x,this.y,this.z]);
								if ((tmpHit.overlap[0] > 0 && tmpHit.overlap[1] > 0 && tmpHit.overlap[2] > 0)) {
									this.y = tmpy;
								}
								else {
									this.y -= (xHitInfo.limit[1] - this.y) * .75;
									xHitInfo = tmpHit;
									Game.camera.startSmoothShift(this.y - tmpy, .08); // smoothly shift the view up
								}
								
							}					
							if (xHitInfo.overlap[0] > 0) {
								if (dir[0] <= 0) this.x = xHitInfo.limit[0] + size[0]/2 + .0001;
								else this.x = xHitInfo.limit[0] - size[0]/2 - .0001;
                                this.resetSprint(); // clear sprint if we collide with something
							}
						}
						else if (this.grounded && this.stance > 0) {
							this.y -= maxStepUp;
							var sneakHitInfo = checkNeighbors([this.x,this.y ,this.z]);
							this.y += maxStepUp;
							if (sneakHitInfo.overlap[1] <= 0) this.x -= dir[0];
						}
					}
					
					if (dir[2] != 0) {
						this.z += dir[2];
						var zHitInfo = checkNeighbors([this.x,this.y,this.z]);
						if (zHitInfo.overlap[2] > 0) {
							// test if we can step up to a block
							if (this.autoStepEnabled && ((this.grounded == true && zHitInfo.limit[1] > this.y && zHitInfo.limit[1] - this.y < maxStepUp) || (zHitInfo.limit[1] > this.y && zHitInfo.limit[1] - this.y < maxStepUp * .25 && this.vertSpeed < 0))) { 
								var tmpy = this.y;
								this.y = zHitInfo.limit[1] + .0001;
								var tmpHit = checkNeighbors([this.x,this.y,this.z]);
								if ((tmpHit.overlap[0] > 0 && tmpHit.overlap[1] > 0 && tmpHit.overlap[2] > 0)) this.y = tmpy;
								else {
									this.y -= ((zHitInfo.limit[1] - this.y) * .5);
									zHitInfo = tmpHit;
									Game.camera.startSmoothShift(this.y - tmpy, .08); // smoothly shift the view up
								}
								
							}
							if (zHitInfo.overlap[2] > 0) {
								if (dir[2] <= 0) this.z = zHitInfo.limit[2] + size[2]/2 + .0001;
								else this.z = zHitInfo.limit[2] - size[2]/2 - .0001;
                                this.resetSprint(); // clear sprint if we collide with something
							}
						}
						else if (this.grounded && this.stance > 0) {
							this.y -= maxStepUp;
							var sneakHitInfo = checkNeighbors([this.x,this.y ,this.z]);
							this.y += maxStepUp;
							if (sneakHitInfo.overlap[1] <= 0) this.z -= dir[2];
						}
					
					}
					
				}
				else {
					this.x += dir[0];
					this.y += dir[1];
					this.z += dir[2];
				}
				this.updateGroundState();
				
				if (this.x != lastPos[0] || this.y != lastPos[1] || this.z != lastPos[2] || Math.abs(this.yaw - lastPos[3]) > .0001 || Math.abs(this.pitch - lastPos[4]) > .0001) {
					this.moved = true;
				}

				const endPos = [this.x, this.y, this.z, this.yaw, this.pitch];
				this.x = this.lastPos[0] || 0;
				this.y = this.lastPos[1] || 0;
				this.z = this.lastPos[2] || 0;
				this.yaw = this.lastPos[3] || 0;
				this.pitch = this.lastPos[4] || 0;
				
				this.setEntityPosition(endPos);
				this.lastPos = endPos;
				Game.change = true;
                
                // Reset and check for the player eye being underwater
                this.underwaterView = false;
                if (shp) {
                    const eyePos = this.getEyePosition();
                    eyePos[0] = Math.floor(eyePos[0]);
                    eyePos[1] = Math.floor(eyePos[1]);
                    eyePos[2] = Math.floor(eyePos[2]);

                    const eyeBlockId = shp.getBlockId(...eyePos);
                    if (eyeBlockId == 8 || eyeBlockId == 9) {
                        this.underwaterView = true;
                    }
                }
                
                // Check if we moved into any movement modifier blocks
                // Move this into the checkNeighbor method if possible
                /*
                if (this.moved) {
                    const endBox = this.getBoundingBox();
                    const xMin = Math.floor(endBox[0]);
                    const yMin = Math.floor(endBox[1]);
                    const zMin = Math.floor(endBox[2]);
                    
                    const xMax = Math.ceil(endBox[3]);
                    const yMax = Math.ceil(endBox[4]);
                    const zMax = Math.ceil(endBox[5]);
                    
					let startPos = [Math.floor(endBox[0]), Math.floor(endBox[1]), Math.floor(endBox[2])];
					let maxOver = [0,0,0];
					let blockBox,ox,oy,oz,bc,b;
                    const maxHeight = Math.ceil(player.getBounds()[4]) + 1;
					
					for (let y = yMin; y < yMax; y++) {

						for (let z = zMin; z < zMax; z++) {
							oz = startPos[2] + z;
							for (let x = xMin; x < xMax; x++) {
								ox = startPos[0] + x;
                                
                                let b = Game.getShape().getBlock(x,y,z);
                                if (b &&  Minecraft.Blocks.isMovementModifierBlock(b.id) === true)	{
                                    
                                    // Check what type of block it is and modify our characters movement!
                                    
                                }
							}
						}
					}
                }
                */
                
			}
			jump() {
				if (this.useGravity == true && this.grounded == true) this.vertSpeed = this.jumpForce;
				else if (this.useGravity == false) this.moveUpNormal(1);
				this.moved = true;
			}
			updateStance(){
				
                if (this.useGravity == false) {
                    this.stance = 0;
                    return;
                }
                
                var now = new Date().getTime();
				const keyboard = Game.input.keyboard;
                
                if (!this.crouchKeybind) {
                    this.crouchKeybind = Game.input.keyboard.getKeybind("controlsKeybindMovementDown");
                }
                
                const crouchKeycode = this.crouchKeybind.keycode;
                const matchingKeybind = keyboard.getMatchingKeybind(crouchKeycode, keyboard.isShiftDown(), keyboard.isCtrlDown(), keyboard.isAltDown());
                
                if (keyboard.isKeyDown(crouchKeycode) && matchingKeybind && matchingKeybind.id == this.crouchKeybind.id) { // if crouch key is held
					
					if(this.grounded == false) {
						if (this.stance != 0) this.stance = 0;
					}				
					else if(this.stanceTime < 0) {
						this.stanceTime += Game.deltaTime;
					}
					else {
						if(this.stance == 0 && this.stanceTime == 0){ //standing
							this.stance = 1;
							this.stanceTime = now;
						}
						else if(this.stance == 1){ //crouching
							if(this.stanceTime == 0) {
								this.stance = 0;
								this.stanceTime = -500;
							}
							if(now - this.stanceTime >= 700 && now - this.stanceTime <= 1000) {
								this.stance = 2;
							}
						}
						else if(this.stance == 2){ //crawling
							if(this.stanceTime == 0) {
								this.stance = 0;
								this.stanceTime = -500;
							}
						}
					}
				}
				else {
					this.stanceTime = 0;
				}
			}
			resetView() {
				this.x = 0;
				this.y = 0;
				this.z = 0;
				this.pitch = 0;
				this.yaw = 0;
				Game.change == true;
			}
			resetSprint() {
                this.sprinting = false;
            }
            getDeltaSpeed() {
				var baseSpeed = this.getSpeed();	
				if (this.useGravity == false) baseSpeed = this.flySpeed;
				
				baseSpeed *= Game.deltaTime;
                if (this.sprinting) baseSpeed *= this.sprintSpeedModifier;

				return baseSpeed;
			}
			moveForward(amt) {
				if (this.useGravity == true || Game.settings.getKey('playerForwardHeightLock')) return this.moveForwardNormal(amt);
				amt *= this.getDeltaSpeed();
				
				var fwd = Game.camera.getForwardVec();
				this.move([fwd[0] * amt, fwd[1] * amt, fwd[2] * amt]);
			}
			moveForwardNormal(amt) {
				amt *= this.getDeltaSpeed();
				var fwd = Game.camera.getForwardVec();
				vec3.normalize(fwd, [fwd[0], 0, fwd[2]])
				this.move([fwd[0] * amt, 0, fwd[2] * amt]);
			}	
			moveRight(amt) {
				amt *= this.getDeltaSpeed();
				var rgt = Game.camera.getRightVec();
				this.move([rgt[0] * amt, rgt[1] * amt, rgt[2] * amt]);
			}
			moveUp(amt) {
				amt *= this.getDeltaSpeed();
				var up = Game.camera.getUpVec();
				this.move([up[0] * amt, up[1] * amt, up[2] * amt]);
			}
			moveUpNormal(amt) {
				amt *= this.getDeltaSpeed();
				var up = [0,1,0];
				this.move([up[0] * amt, up[1] * amt, up[2] * amt]);
			}
			getFrontDirection() {
				
				if (this.yaw >= 45 && this.yaw < 135) return [-1,0,0];
				if (this.yaw >= 135 && this.yaw < 225) return [0,0,1];
				if (this.yaw >= 225 && this.yaw < 315) return [1,0,0];
				if (this.yaw >= 315 || this.yaw < 45) return [0,0,-1];
			}
			getRightDirection() {
				
				if (this.yaw >= 45 && this.yaw < 135) return [0,0,-1];
				if (this.yaw >= 135 && this.yaw < 225) return [-1,0,0];
				if (this.yaw >= 225 && this.yaw < 315) return [0,0,1];
				if (this.yaw >= 315 || this.yaw < 45) return [1,0,0];
			}
			setPosition(x,y,z) {
				this.x = x;
				this.y = y;
				this.z = z;
				this.moved = true;
			}
			getSpeed() {
				if (this.stance == 0) return this.speed;
				else if (this.stance == 1) return this.speed *.5; 
				else if (this.stance == 2) return this.speed *.25;
			}
			getBounds() {
				if (this.stance == 0) return this.bounds; 
				else if (this.stance == 1) return [-.3,0,-.3,.3, 1.4, .3];
				else if (this.stance == 2) return [-.3,0,-.3,.3, .9, .3];
			}
			setHeight(height) {
                const viewHeightOffset = 0.18;
                height = Math.min(Math.max(0.25, height), 10);
                this.bounds[4] = height;
                this.viewHeight = height - viewHeightOffset;
            }
			getViewHeight() {
				if (this.stance == 0) return this.viewHeight; // standing
				else if (this.stance == 1) return 1.2; // crouching
				else if (this.stance == 2) return .75; // crawling
			}
			getSpawn() {
				return Game.getShape().getSpawn();
			}
			setSpawn() {
				const x = this.x;
				const y = this.y;
				const z = this.z;
				const yaw = this.yaw;
				const pitch = this.pitch;
                const flying = !this.useGravity;
				
				Game.getShape().setSpawn(x, y, z, yaw, pitch, flying);
				Game.change = true;
			}
            teleportSpawn() {
				var spawn = this.getSpawn();
				if (spawn == null) return;
		        
                this.teleport(spawn.x, spawn.y, spawn.z, spawn.yaw, spawn.pitch);
			}
			setName(name) {
				this.name = name;
				Game.network.sendPacket({id: "change_player", name: this.name, skin: this.skin});
			}
			setSkin(skin) {
				this.skin = skin;
				Game.network.sendPacket({id: "change_player", name: this.name, skin: this.skin});
			}
			hasActiveAction() {
                return this.actionInProgress != null;
            }
            setActiveAction(action) {
                this.actionInProgress = action;                
            }
            clearActiveAction() {
                this.actionInProgress = null;
            }
            interact(button, mods) {
				
				if (this.hasActiveAction()) {
                    
                    const action = this.actionInProgress;
                    switch (action.id) {
                        case ("CarryEntity"):
                            this.dropEntity();
                            this.clearActiveAction();
                            break;
                    }
                }
                else {
                    if (Game.input.mouse.isOverBlock()) {
                        const hit = Game.input.mouse.getHitVec();
                        new _cubical.Lib.BlockOperation(Game.getShape(), "Break Block", ...hit, 0, 0).finish();
                    }
                }
			}
			placeBlock(x, y, z, id, data) {
				// Game.getShape().setBlock(x, y, z, id, data);
				// var block = {x, y, z, id, data};
				// Game.network.sendPacket({id: "set_block", block: block});
			}
			hitBlock(x, y, z, id, data) {
				// Game.getShape().setBlock(x, y, z, id, data);
				// var block = {x, y, z, id, data};
				// Game.network.sendPacket({id: "set_block", block: block});
			}
			interactBlock(x, y, z, id, data) {
				// Game.getShape().setBlock(x, y, z, id, data);
				// var block = {x, y, z, id, data};
				// Game.network.sendPacket({id: "set_block", block: block});
			}
			interactEntity(ent, button, mods) {
				// ent.damage(5);
				
                switch(true) {
                    case (ent instanceof _cubical.Entity.Player):
                        Game.network.sendPacket({id: "entity_interact", interaction: {type: "hit", target: ent.id}});
                        break;
                    case (ent instanceof _cubical.Entity.KineticEntity):
                    case (ent instanceof _cubical.Entity.Entity):
                        switch (button) {
                            case 0:
                                if (this.carryChildEntity == null) this.pickupEntity(ent);
                                else this.dropEntity();
                                break;
                            case 2:
                                if (this.carryChildEntity != null) this.dropEntity();
                                else ent.interaction(this, "hit", mods);
                                break;
                        }
                        break;
                    default:
                        ent.interaction(this, "hit", mods);
                        break;
                }				
			}
            pickupEntity(ent) {
                if (this.carriedEntity != null || ent == null || ent.carryParentEntity != null) return;
                
                this.carryChildEntity = ent;
                this.carryChildEntity.carryParentEntity = this;
                const startPosition = Game.player.getEyePosition();
                const endPosition = Game.input.mouse.hit.entityHit[0];
                let carryHitOffset = [];
                vec3.subtract(carryHitOffset, ent.getPosition(), endPosition);
                vec3.rotateY(this.carryOffset, carryHitOffset, [0,0,0], -Game.player.yaw * (Math.PI / 180)); 

                this.carryDistance = vec3.distance(startPosition, endPosition);
                // vec3.subtract(this.carryOffset, [ent.x, ent.y, ent.z], endPosition);
                
                this.setActiveAction({id: "CarryEntity"});
            }
            dropEntity() {
                if (this.carryChildEntity == null) return;
                
                // this.carryChildEntity.velocity = [0, 0, 0];
                this.carryChildEntity.acceleration = [0, 0, 0];
                this.carryChildEntity.carryParentEntity = null;
                this.carryChildEntity = null;
                this.carryDistance = 0;
            }
		}

		this.WaypointEntity =  class WaypointEntity extends this.Entity {
			constructor(id, data) {
				super(id);
				this.type = "Waypoint";
				this.name = "Waypoint";
				this.text = "Waypoint Marker";
				this.textSize = 1;
				this.rotation = 0;
				this.height = 1;
				this.width = -1;
				this.hover = false;
				this.action = null;
				if (data) this.setData(data);
				this.updateBuffer();
			}
			
			draw() {
				if (!this.isVisible) return;
                
				if(this.buffer.ready) {
					gl.bindTexture(gl.TEXTURE_2D, this.buffer.texture);
					var matrix = Minecraft.util.getIdentityMatrix();
					mat4.translate(matrix, matrix, [this.x, this.y, this.z]);
					
					if (this.rotation == -1)  mat4.rotateY(matrix, matrix, Game.player.yaw * Math.PI/180 + (Math.PI * .5));
					else mat4.rotateY(matrix, matrix, this.rotation * Math.PI/180);
					
					this.buffer.matrix = matrix;
				
					if (this.hover) {
						gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE_MINUS_SRC_ALPHA);
						gl.blendColor(0.356, 0.656, 1.000, 1.00);

						this.buffer.draw();
						
						gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
					}
					else {
						this.buffer.draw();
					}
				}
			}
			updateBuffer() {
				this.buffer = Game.webgl.helper.createTextQuadBuffer({height: this.height, text: this.text, image: this.image});
				this.bounds = this.buffer.box;
			}
			interaction(ent, type) {
				if (typeof this.action === "function") {
					this.action();
				}
				else console.log("Interaction with waypoint entity.");
			}
			setAction(actionStr) {
				actionStr = "p.action = " + actionStr;
				var p = this;
				try {
					eval(actionStr);
				}
				catch(e) {}
			}
			setData(data) {
				this.name = data.name || this.name;
				this.text = data.text || this.text;
				this.rotation = data.rotation || this.rotation;
				this.height = data.height || this.height;
				this.width = data.width || this.width;
				this.textSize = data.size || this.textSize;
				this.setAction(data.action || "");
				this.image = data.image || null;
			}
		}
	
		this.HelperEntity = class HelperEntity extends this.LivingEntity {
			constructor() {               
				super(HelperEntity._NEXT_ID++);
				this.bounds = [-0.5, 0, -0.5, .5, 1, .5];
				this.action = {id: "move", pos: [2,0,0], left: [2,0,0], dest: null};
				this.speed = 2;
				this.rotateSpeed = 120;
				this.actions = [];
				this.homePos = [0,0,0];
				this.speedMultiplier = 1;
                this.x = Game.player.x;
                this.y = Game.player.y;
                this.z = Game.player.z;
                this.internalRotation = 0;
                this.internalRotationEnabled = true;
			}
			
			draw(dt) {
                if (!this.isVisible) return;
                
				if (this.internalRotationEnabled) {
                    this.internalRotation += dt * 60;
                    if (this.internalRotation > 360) this.internalRotation -= 360;
                }
                
                var rotate = this.internalRotation;
                
				gl.bindTexture(gl.TEXTURE_2D, Game.webgl.textureShader.texture);
				
				var matrix = Minecraft.util.getIdentityMatrix();
				mat4.translate(matrix, matrix, [this.x, this.y, this.z]);
				mat4.rotateY(matrix, matrix, this.yaw* Math.PI/180);
				
				var shader = Game.webgl.textureShader;
				shader.staticBuffer.matrix = matrix;
				
				if(shader.staticBuffer.ready) {
					var bodyMat = matrix.slice();

					mat4.translate(bodyMat, bodyMat, [0, .5, 0]);
					mat4.rotateY(bodyMat, bodyMat, -rotate * Math.PI/180);
					mat4.rotateX(bodyMat, bodyMat, -rotate * Math.PI/180);
					shader.staticBuffer.matrix = bodyMat;
					
					shader.staticBuffer.drawSection("cubieCore");
					
					bodyMat = matrix.slice();
                    mat4.translate(bodyMat, bodyMat, [0, .5, 0]);
					mat4.rotateY(bodyMat, bodyMat, rotate * Math.PI/180);
					mat4.rotateX(bodyMat, bodyMat, rotate * Math.PI/180);
					shader.staticBuffer.matrix = bodyMat;

					shader.staticBuffer.drawSection("cubieInside");
                    
                    bodyMat = matrix.slice();
                    mat4.translate(bodyMat, bodyMat, [0, .03, 0]);
					mat4.scale(bodyMat, bodyMat, [0.94, 0.94, 0.94]);
                    
                    shader.staticBuffer.matrix = bodyMat;
                    shader.staticBuffer.drawSection("cubieOutside");
				}
			}
		
			update() {
				super.update();
				// console.log("helper update");
				if (this.actions.length < 1) return;
				
				this.action = this.actions[0];
				
				this.processAction();
				
				if (this.actions[0].done) {
					this.actions.shift();
				}

				
			}
			
			processAction() {
				
				switch(this.action.id) {
					case ("move"):
					
						var moveAmt = 0;
						if (!this.action.dest) {
							
							if (this.action.direction) {
								var pos = [];
								if (this.action.direction == "forward") pos = this.getForwardDirection(this.action.amt);
								else if (this.action.direction == "backward") pos = this.getForwardDirection(-this.action.amt);
								else if (this.action.direction == "right") pos = this.getRightDirection (this.action.amt);
								else if (this.action.direction == "left") pos = this.getRightDirection(-this.action.amt);
								
								this.action.pos = pos;
							}
							
							this.action.dest = [this.action.pos[0] + this.x, this.action.pos[1] + this.y, this.action.pos[2] + this.z];
						}
						var dest = this.action.dest;

						if (dest[0] == this.x && dest[1] == this.y && dest[2] == this.z) {
							this.action.done = true;
							return;
						}
						
						this.action.left = [dest[0] - this.x, dest[1] - this.y, dest[2] - this.z];
					
						if(this.action.left[0] != 0) {
							moveAmt = this.getMoveSpeed([(this.action.left[0] > 0) ? 1 : -1,0,0]);
							if (this.action.left[0] > 0 && moveAmt[0] > this.action.left[0]) moveAmt[0] = this.action.left[0];
							else if (this.action.left[0] < 0 && moveAmt[0] < this.action.left[0]) moveAmt[0] = this.action.left[0];
							this.move(moveAmt);
						}
						else if(this.action.left[1] != 0) {
							moveAmt = this.getMoveSpeed([0, (this.action.left[1] > 0) ? 1 : -1,0]);
							if (this.action.left[1] > 0 && moveAmt[1] > this.action.left[1]) moveAmt[1] = this.action.left[1];
							else if (this.action.left[1] < 0 && moveAmt[1] < this.action.left[1]) moveAmt[1] = this.action.left[1];
							this.move(moveAmt);
						}
						else if(this.action.left[2] != 0) {
							moveAmt = this.getMoveSpeed([0, 0, (this.action.left[2] > 0) ? 1 : -1]);
							if (this.action.left[2] > 0 && moveAmt[2] > this.action.left[2]) moveAmt[2] = this.action.left[2];
							else if (this.action.left[2] < 0 && moveAmt[2] < this.action.left[2]) moveAmt[2] = this.action.left[2];
							this.move(moveAmt);
						}
						
						break;
						
					case ("rotate"):
					
						if (this.action.left == 0) {
							this.action.done = true;
							return;
						}
						else if (!this.action.left) this.action.left = this.action.rotate;
						
						var rotate = this.action.rotate;
						
						var rotateAmt = this.rotateSpeed * Game.deltaTime * this.speedMultiplier;
						if (this.action.rotate < 0) rotateAmt *= -1;
						
						if (this.action.rotate > 0 && rotateAmt > this.action.left) rotateAmt = this.action.left;
						else if (this.action.rotate < 0 && rotateAmt < this.action.left) rotateAmt = this.action.left;
						
						this.action.left -= rotateAmt;
						this.yaw += rotateAmt;
						
						break;
						
					case ("home"):
						this.action.id = "move";
						this.action.pos = [this.homePos[0] - this.x, this.homePos[1] - this.y, this.homePos[2] - this.z];
						break;
				}				
			}
			
            clearActions() {
                this.actions = [];
            }
			getForwardDirection(amt) {
				var fwd = this.getLookDirection();
				vec3.normalize(fwd, [fwd[0], 0, fwd[2]]);
				return [fwd[0] * amt, 0, fwd[2] * amt];
			}
			getRightDirection(amt) {
				var direction = [0,0,0];
				if (this.yaw >= 45 && this.yaw < 135) direction = [0,0,-1];
				else if (this.yaw >= 135 && this.yaw < 225) direction = [-1,0,0];
				else if (this.yaw >= 225 && this.yaw < 315) direction = [0,0,1];
				else if (this.yaw >= 315 || this.yaw < 45) direction = [1,0,0];
				
				return [direction[0] * amt, 0, direction[2] * amt];
			}
			
			forward(amt = 1) {
				this.actions.push({id:"move", direction: "forward", amt: amt});
				return this;
			}
			backward(amt = 1) {
				this.actions.push({id:"move", direction: "backward", amt: amt});
				return this;
			}
			right(amt = 1) {
				this.actions.push({id:"move", direction: "right", amt: amt});
				return this;
			}
			left(amt = 1) {
				this.actions.push({id:"move", direction: "left", amt: amt});
				return this;
			}
			up(amt = 1) {
				this.actions.push({id:"move", pos: [0, 1, 0]});
				return this;
			}
			down(amt = 1) {
				this.actions.push({id:"move", pos: [0, -1, 0]});
				return this;
			}
			
			turnRight() {
				return this.rotate(-90);
			}
			turnLeft() {
				return this.rotate(90);
			}
			turnAround() {
				return this.rotate(180);
			}
			rotate(amt) {
				this.actions.push({id:"rotate", rotate: amt});
				return this;
			}
			home() {
				this.actions.push({id:"home"});
			}
			
			random(amt) {
				
				for (var i = 0; i < amt; i++) {

					var rng = Math.random();
					if (rng > 0.5) {
						if (rng > .875) this.forward();
						else if (rng > .75) this.backward();
						else if (rng > .625) this.right();
						else this.left();					
					}
					else {
						if (rng > .375) this.rotate(-90);
						else if (rng > .25) this.rotate(90);
						else if (rng > .125) this.rotate(180);
						else this.up();							
					}			
				}
				
			}
			
			getMoveSpeed(moveAmt) {
				var mod = this.speed * Game.deltaTime * this.speedMultiplier;
				return [moveAmt[0]*mod, moveAmt[1]*mod, moveAmt[2]*mod];
			}
		
			interaction(ent, interaction, mods) {
				// console.log("You hit the helper!");
				if (mods.shift) this.turnLeft();
                else if (mods.ctrl) this.turnLeft();
                else if (mods.alt) this.actions = [];
                else this.forward(1);               
			}
            
            static _init() {
                HelperEntity._NEXT_ID = 10001;
            }
		}
	
		this.KineticEntity = class KineticEntity extends this.PhysicalEntity {
			
			constructor(id, data) {
				super(id);
				this.type = "Kinetic";
				this.velocity = [0,0,0];
				this.acceleration = [0,0,0];
				this.airResistance = .00005;
				this.groundResistance = .02;
				this.useGravity = true;
				this.gravityStr = .5;
                this.autoStepEnabled = false;
			}
			update() {
				
				var dt = .02;
				this.acceleration[0] *= dt;
				this.acceleration[1] *= dt;
				this.acceleration[2] *= dt;

				let underwater = false;
				let waterResist = .0003;
				let submergeAmt = 0;
                let gravityMod = 0;

				if (underwater) {
					let waterGravityStr =  - .1;
					if (this.useGravity) gravityMod = -(this.gravityStr * Game.deltaTime);
				}
				else {
					if (this.useGravity) gravityMod = -(this.gravityStr * Game.deltaTime);
				}

				if (this.grounded && this.acceleration[1] < 0) gravityMod = -(this.gravityStr * Game.deltaTime);

				this.velocity[0] += this.acceleration[0];
				this.velocity[1] += this.acceleration[1];
				this.velocity[2] += this.acceleration[2];

				let length = Math.sqrt(this.velocity[0] * this.velocity[0] + this.velocity[1] * this.velocity[1] + this.velocity[2] * this.velocity[2]);
				
				if (length != 0) {
                    let nx = this.velocity[0] / length;
                    let ny = this.velocity[1] / length;
                    let nz = this.velocity[2] / length;

                    let kineticForce = length;
                    let resistance = this.grounded ? this.groundResistance : this.airResistance;

                    if (underwater) {
                        //resistance = MathCi.Lerp(airResistance, waterResist, submergeAmt);
                    }
                    
                    let resistKineticForce = this.makeCloserToZero(kineticForce, resistance);
                    
                    this.velocity[0] = nx * resistKineticForce;
                    this.velocity[1] = ny * resistKineticForce + gravityMod;
                    this.velocity[2] = nz * resistKineticForce;
                }
                else {
                    this.velocity[0] = 0;
                    this.velocity[1] = gravityMod;
                    this.velocity[2] = 0;                    
                }

				this.resetAcceleration();

				let adx = this.velocity[0];
				let ady = this.velocity[1];
				let adz = this.velocity[2];

				adx = Math.abs(adx) < .00005 ? 0 : adx;
				ady = Math.abs(ady) < .00005 ? 0 : ady;
				adz = Math.abs(adz) < .00005 ? 0 : adz;

                if (adx != 0 || ady != 0 || adz != 0) this.move([adx, ady, adz]);
			}
			makeCloserToZero(val, amt) {
				let retAmt = 0;
				if (val > 0) {
					retAmt = val <= amt ? 0 : val - amt;
				} else if (val < 0) {
					retAmt = val >= -amt ? 0 : val + amt;
				} else {
					retAmt = 0;
				}
				return retAmt;
			}
			addForce(x, y, z) {
				this.acceleration[0] += x;
				this.acceleration[1] += y;
				this.acceleration[2] += z;
			}
			resetAcceleration() {
				this.acceleration = [0, 0, 0];
				this.vertSpeed = 0;
			}
			interaction(ent, interaction, mods) {
                const player = Game.player;
                const distance = Minecraft.util.getDistance(player.x, player.y, player.z, this.x, this.y, this.z);
                const speed = 15;

                const direction = player.getLookDirection();
                vec3.multiply(direction, direction, [speed, speed, speed]) ;
                // direction[1] = 0;
                
				this.addForce(...direction);          
			}
		}
		
		this.ProjectileEntity = class ProjectileEntity extends this.KineticEntity {
			
			constructor(id) {
				super(id);
				this.type = "Projectile";
			}
			
		};
		
		this.BlockEntity = class BlockEntity extends this.KineticEntity {
			
			constructor(id, blockId = 1, blockData = 0) {
				super(id);
				this.type = "Block";
				this.blockId = blockId;
				this.blockData = blockData;
			}
		}

		this.VoxelShapeEntity = class VoxelShapeEntity extends this.Entity {
			
			constructor(id, shape, worker = null) {
				super(id);
				this.type = "VoxelShape";
				this.shape = shape;
                this.worker = worker != null ? worker : Game.worker;
                const boxSize = Math.max(Math.max(shape.x, shape.y), shape.z) * .1;
                this.bounds = [0, 0, 0, boxSize, boxSize, boxSize];
                
                this.onAddToWorld(null);
			}
            
            draw() {
                // All drawing is done in and thru the shapebuffers object
                if (this.shapeBuffer) {
                    this.shapeBuffer.setTranslation(this.x, this.y, this.z, this.yaw, this.pitch);
                }               
            }
            
            onAddToWorld(world) {
                this.shapeBuffer = new _cubical.Render.VoxelShapeRenderer(this.shape, this.worker);
                this.shapeBuffer.useFrustumCulling = false;
				this.shapeBufferId = Game.scene.addShapeBuffer(this.shapeBuffer);
            }
            onRemoveFromWorld(world) {

				Game.scene.removeShapeBuffer(this.shapeBufferId);
                this.shapeBuffer = null;
            }
            
		}

        this.MinecraftEntity = class MinecraftEntity extends this.Entity {
            constructor(position, blockPosition, nbt) {
                this.setPosition(...position);
                this.blockPosition = blockPosition;
                this.nbt = nbt;
            }
        }
        
        this.MinecraftTileEntity = class MinecraftTileEntity {
            constructor(x, y, z, nbt) {
                this.x = x;
                this.y = y;
                this.z = z;
                
                if (nbt) this.loadNbt(nbt);
                else this.nbt = null;
            }
            
            draw() {
                
            }
            
            update() {
                
            }
            
            needsDrawing() {
                return false;
            }
            
            needsUpdates() {
                return false;
            }
            
            getEntityId() {
                const entityId = this.constructor.ENTITY_ID;
                return entityId ? entityId : null;
            }
            
            getPosition() {
                return [this.x, this.y, this.z];
            }
            
            setPosition(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }
            
            onAddToWorld(world) {
                
            }
            
            onRemoveFromWorld(world) {
                
            }
            
            loadNbt(nbt) {
                this.nbt = nbt;
            }
            
            toNbt() {
                const tag = new Nbt.CompoundTag();
                tag.addChild(new Nbt.IntTag("x", this.x));
                tag.addChild(new Nbt.IntTag("y", this.y));
                tag.addChild(new Nbt.IntTag("z", this.z));
                tag.addChild(new Nbt.StringTag("id", this.getEntityId()));
                
                return tag;
            }
            
            static fromNbt(nbt, loadMissing = true) {               
                let entityId = nbt.getChildValue("id").toLowerCase();
                
                if (entityId.indexOf(":") == -1) {
                    entityId = `minecraft:${entityId}`; 
                }
                
                let entityConstructor = MinecraftTileEntity.getConstructor(entityId);
                
                if (entityConstructor === null) { // See if we should load tile entities we don't have setup yet
                    if (!loadMissing) return null;
                    
                    entityConstructor = MinecraftTileEntity;
                }
                
                const x = nbt.getChildValue("x");
                const y = nbt.getChildValue("y");
                const z = nbt.getChildValue("z");
                
                return new entityConstructor(x, y, z, nbt);;
            }

            static getConstructor (entityId) {               
                if (!entityId) return null;
                
                const constructor = MinecraftTileEntity.ENTITIES[entityId];
                return !constructor ? null : constructor;
            }
            
            static _init() {
                MinecraftTileEntity.ENTITIES = {
                    "minecraft:sign": _cubical.Entity.MinecraftSignTileEntity,
                };
                
                MinecraftTileEntity.ENTITY_ID = null;
                MinecraftTileEntity.BLOCKS = [];
            }
        }
        
        this.MinecraftSignTileEntity = class MinecraftSignTileEntity extends this.MinecraftTileEntity {
            constructor(x, y, z, nbt) {
                super(x, y, z, nbt)
                
                if (!this.text) {
                    this.text = ["", "", "", ""];
                    this.empty = true;
                }
                
                this.matrix = [];
            }
            
            needsDrawing() {
                return !this.empty;
            }
            
			draw() {
				if (this.buffer.ready) {
					gl.bindTexture(gl.TEXTURE_2D, this.buffer.texture);
                    this.buffer.draw();
				}
			}
			updateBuffer() {
				let textStr = this.getRenderText();
                
                const args = {
                    height: .4375,
                    font: "Minecraft",
                    text: textStr,
                    image: this.image,
                    sign: true,
                    spacing: .9,
                    padding: 8,
                    lockHeight: 162
                };
                
                const block = Game.getShape().getBlock(this.x, this.y, this.z);
                
                this.buffer = Game.webgl.helper.createTextQuadBuffer(args);
                let matrix = Minecraft.util.getIdentityMatrix();

                // Wall sign block
                if (block.id == 68) {
                    mat4.translate(matrix, matrix, [this.x + .5, this.y + .73, this.z + .5]);
                    
                    switch(block.data) {
                        case 2:  mat4.rotateY(matrix, matrix, -Math.PI*.5); break;
                        case 3:  mat4.rotateY(matrix, matrix, Math.PI*.5); break;
                        case 4:  break;
                        case 5:  mat4.rotateY(matrix, matrix, Math.PI); break;
                    }
                    
                    mat4.translate(matrix, matrix, [.36, 0, 0]);
                }
                else if (block.id == 63) { // Rotated ground sign
                    mat4.translate(matrix, matrix, [this.x + .5, this.y + 1 + 1/12, this.z + .5]);
                    
                    const snapInterval = Math.PI / 8;
                    let yaw = block.data == 0 ? Math.PI*.5: (Math.PI - ((block.data * snapInterval) + Math.PI * .5) % (Math.PI * 2));
                    
                    mat4.rotateY(matrix, matrix, yaw);
                    mat4.translate(matrix, matrix, [-.06, 0, 0]);
                }
                
                this.buffer.matrix = matrix;
			}
            
            loadNbt(nbt) {
                this.nbt = nbt;
                
                // Change to only show the text part when drawing the text image
                this.setText(
                    nbt.getChildValue("Text1"),
                    nbt.getChildValue("Text2"),
                    nbt.getChildValue("Text3"),
                    nbt.getChildValue("Text4")
                    
                );
            }
            
            setText(text1, text2, text3, text4) {
                const text = this.text = [
                    (typeof text1 === "string" ? text1 : ""),
                    (typeof text2 === "string" ? text2 : ""),
                    (typeof text3 === "string" ? text3 : ""),
                    (typeof text4 === "string" ? text4 : "")
                ];
                
				
                if (text[0].length == 0 && text[1].length == 0 && text[2].length == 0 && text[3].length == 0) {
                    this.empty = true;
                }
                else this.empty = false;
                
                this.updateBuffer();
            }
            
            getRenderText() {                    
                const txtArray = this.text.slice();
                
                if (txtArray[0].indexOf('"text":') > -1) {
                    for (let i = 0; i < txtArray.length; i++) {
                        txtArray[i] = JSON.parse(txtArray[i])['text'];
                    }
                }
                
                let textStr = `${txtArray[0]} \n`
                    + `${txtArray[1]} \n`
                    + `${txtArray[2]} \n`
                    + `${txtArray[3]} \n`;
                    
                return textStr;
            }
            
            onAddToWorld(world) {
                // create renderer
                if (this.buffer && this.buffer.update) this.buffer.update();
            }
            
            onRemoveFromWorld(world) {
                // remove renderer
            }
            
            toNbt() {
                const tag = super.toNbt();
                tag.addChild(new Nbt.StringTag("Text1", `{"text":"${this.text[0]}"}`));
                tag.addChild(new Nbt.StringTag("Text2", `{"text":"${this.text[1]}"}`));
                tag.addChild(new Nbt.StringTag("Text3", `{"text":"${this.text[2]}"}`));
                tag.addChild(new Nbt.StringTag("Text4", `{"text":"${this.text[3]}"}`));
                
                return tag
            }
            
            static _init() {
                MinecraftSignTileEntity.ENTITY_ID = "minecraft:sign";
                MinecraftSignTileEntity.BLOCKS = [63, 68];
            }
        }
	});
	
	this.File = new (function File() {
		this._group = true;
		this.AssetFile = class AssetFile {
			constructor(blob, src = null) {
				this.id = Minecraft.util.createGUID();
				this.blob = blob;
				this.name = AssetFile.getFileName(blob.name);
				this.type = AssetFile.getFileType(blob.name);
				this.src = src;
				this.size = blob.size;
                this.data = null;
			}
            
            readData() {               
                const promise = new Promise((resolve, reject) => {               
                    const reader = new FileReader();
                    reader.onload = (evt) => resolve(evt.target.result); // ArrayBuffer containing the raw file data
                    reader.onerror = (evt) => reject(evt);
                    reader.onabort = (evt) => reject(evt);
                    
                    reader.readAsArrayBuffer(this.blob);                
                });
                
                return promise;
            }
            
            parseData(dataType = null) {               
                const promise = new Promise((resolve, reject) => {               
                    
                    this.readData().then(
                        (result) => {
                            const data = new Uint8Array(result);
                            const extType = this.type;
                            const name = this.name;
                            let sch = null;
                            
                            // TODO: Enable this once region debugging is done
                            // try {
                                switch(extType) {

                                    case "shp":
                                        sch = new Schematic().setFile(this).parseShapeFile(data);
                                        resolve(sch);
                                        break;

                                    case "bo2":
                                        sch = new Schematic().setFile(this).parseBO2File(data);
                                        resolve(sch);
                                        break;
                                        
                                    case "sch":
                                    case "schematic":
                                        sch = new Schematic().setFile(this).parseSchematicFile(data);
                                        resolve(sch);
                                        break;
                                    
                                    case "nbt":
                                        sch = new Schematic().setFile(this).parseStructureFile(data);
                                        resolve(sch);
                                        break;
                                    
                                    case "png":
                                    case "gif":
                                    case "jpg":
                                    case "jpeg":
                                    case "bmp":
                                        const img = new Image();
                                        img.onload = (evt) => {
                                            sch = new Schematic().setFile(this).parseImageFile(img);
                                            resolve(sch);
                                        }
                                        img.onerror = (evt) => reject(console.log("Error loading image: %O", evt));

                                        const imgBlob = new Blob([data], {type: 'image'});
                                        const url = _window.URL.createObjectURL(imgBlob);
                                        img.src = url;
                                        break;
                                    
                                    case "mca":
                                        const mcaFileName = this.name.slice();
                                        const splitName = this.name.slice().substring(2).split(".");
                                        const xChunkIndex = parseInt(splitName[0]);
                                        const zChunkIndex = parseInt(splitName[1]);
                                        
                                        const region = new _cubical.File.MinecraftRegionFile(xChunkIndex, zChunkIndex, data);                                 
                                        const world = region.toVoxelWorld();
                                        
                                        console.log("Finished parsing region file!"); //  - %O, %O", region, world);
                                        resolve(world);
                                        break;
                                    
                                    case "zip":
                                        const zipFileName = this.name.slice();
                                        
                                        JSZip.loadAsync(data).then(
                                            (zip) => {
                                                resolve(zip);
                                                console.log("Finished parsing zip file! - %O", zip);
                                            },
                                            (err) => {
                                                reject(err);
                                            }
                                        );
                                        break;
                                        
                                    case "dat":
                                        const nbt = new Nbt.NbtDocument(data);
                                        resolve(nbt)

                                        break;
                                    
                                    default: 				
                                        resolve(new Schematic().setFile(this).parseSchematicFile(data));
                                }
                            // }
                            // catch(e) {
                            //     reject(e);
                            // }
                        },
                        (err) => {
                            reject(err);
                        }
                    );                    
                });
                
                return promise;
            }
			
			static getFileType(fileName, knownOnly = true) {
				
				var ext = fileName.substring(fileName.lastIndexOf(".") + 1).toLowerCase();
				switch(ext) {
                    case ("shp"):
					case ("bo2"):
					case ("mca"):
					case ("nbt"):
					case ("png"):
					case ("gif"):
					case ("jpg"):
					case ("jpeg"):
					case ("bmp"):
					case ("sch"):
                    case ("zip"):
					case ("dat"):
						return ext;
					case ("schematic"):
						return "sch";
					default: 
						return knownOnly ? null : ext;
				}				
			}
			
			static getFileName(name) {
				var index = name.lastIndexOf(".");
				return (index > -1 ? name.substring(0, index) : name);
			}
			
		};
		
        this.MinecraftWorld = class MinecraftWorld {
            
            constructor(zipFileObj) {               
                this.zip = null;
                this.regions = new Map();
                
                if (zipFileObj instanceof JSZip) {
                    this.fromZip(zipFileObj);
                }
            }
            
            fromZip(zipFileObj) {
                this.zip = zipFileObj
                
                const worldRootPath = MinecraftWorld.findWorldPath(zipFileObj);
                
                if (worldRootPath == null) {
                    console.log("Unable to find valid level.dat file!")
                    return;
                }
                
                this.rootPath = worldRootPath;
                this.regionPath = `${worldRootPath}region/`;
                
                const regions = new Map();
                const regionSections = [];
                
                zipFileObj.folder(this.regionPath).forEach((path, file) => {
                    if (path.endsWith('.mca')) {
                        const split = path.split('.');
                        const sectionId = split[1] + '.' + split[2];
                        
                        regionSections.push(sectionId);
                        this.regions.set(sectionId, null);
                    }
                });
                
                const total = regionSections.length;
                // const world = new MinecraftWorld(zipFileObj);
                
            }
            
            getRegionFilePath(id) {
                return `${this.regionPath}r.${id}.mca`;
            }
            
            loadLevelInfo() {
                const p = this;
                
                return new Promise((resolve, reject) => {
                    const filePath = `${this.rootPath}level.dat`;
                    
                    this.zip.file(filePath).async("uint8array").then(
                        (data) => {
                            const nbtData = new Nbt.NbtDocument(data);
                            p.levelNbt = nbtData;
                            resolve(nbtData);
                            
                        },
                        (err) => {
                            console.log("Error loading level.dat file: %O", err);
                            reject(err);
                        }
                    );
                });
            }
            
            loadChunkData() {
                return new Promise((resolve, reject) => {
                    const onFilesLoaded = () => resolve(this);
                    
                    let filesToLoad = this.regions.size;
                    
                    this.regions.forEach((v, k, m) => {
                        const regionPath = this.getRegionFilePath(k);
                        const split = k.split('.');
                        const rx = parseInt(split[0]);
                        const rz = parseInt(split[1]);
                        
                        this.zip.file(regionPath).async("uint8array").then(
                            (data) => {
                                const region = new _cubical.File.MinecraftRegionFile(rx, rz);
                                region.parse(data, true);
                                
                                this.regions.set(k, region);

                                if (--filesToLoad == 0) onFilesLoaded();
                            },
                            (err) => {
                                console.log("Error loading zip data: %O", err);
                                if (--filesToLoad == 0) onFilesLoaded();
                            }
                        );
                    });
                });                
            }
            
            getRegionData(rx, rz) {
                
            }
            
            toVoxelWorld() {
                const world = new _cubical.Lib.VoxelWorld();

                this.regions.forEach((region) => {
                    region.chunkData.forEach((chunk) => {
                        if (chunk.hasSectionData) {
                            chunk.sections.forEach((section) => {
                                const voxelChunk = section.voxelChunk;
                                if (voxelChunk) {
                                    world.addChunk(voxelChunk);
                                }
                            });
                        }
                    });
                });
              
                return world;
            }
            
            static findWorldPath(zipFileObj) {
                
                function findLevelFile(path) {
                    if (!path.endsWith('level.dat')) return null;
                    
                    const worldPath = path.substr(0, path.length - 9);
                    return worldPath;
                }
                
                let filePaths = [];
                
                zipFileObj.forEach((path, file) => {
                    filePaths.push(path);
                });
                
                let worldPath = null;
                for (let i in filePaths) {
                    const foundPath = findLevelFile(filePaths[i]);
                    
                    if (foundPath) {
                        worldPath = foundPath;
                        break;
                    }
                    
                }
                
                return worldPath;
            }
            
        }
    
        this.MinecraftRegionFile = class MinecraftRegionFile {
            
            constructor(x, z, data = null) {
                this.data = new Uint8Array(0);
                this.x = x;
                this.z = z;
                this.offset = 0;
                this.chunkOffsetX = x * 32;
                this.chunkOffsetZ = z * 32;
                this.chunkData = new Map();
                
                if (data) this.parse(data);
            }
            parse(data, loadChunkData = true) {
                const sectionSize = 1024;
                const sectionOffset = 4096;
                
                this.locationOffsets = new Uint32Array(sectionSize);
                this.locationSectorCounts = new Uint8Array(sectionSize);
                this.timestamps = new Uint32Array(sectionSize);
                
                const view = new DataView(data.buffer, 0, 8192);
                
                var totalChunkCount = 0;
                var totalSectorCount = 0;
                var offset = 0;
                for (var i = 0; i < sectionSize; i++) {
                    const locationOffset = view.getUint8(offset) << 16 | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2);
                    const locationSectorCount = view.getUint8(offset + 3);
                    const timestamp = view.getUint32(offset + sectionOffset);
                    
                    this.locationOffsets[i] = locationOffset;
                    this.locationSectorCounts[i] = locationSectorCount;
                    this.timestamps[i] = timestamp;
                    
                    if (locationOffset != 0) totalChunkCount++;
                    totalSectorCount += locationSectorCount;
                    
                    offset += 4;
                }
                
                this.data = data;
                if (loadChunkData) this.loadAllChunkData();
            }
            loadAllChunkData() {
                this.chunkData.clear();
                
                for (var x = 0; x < 32; x++) {
                    for (var z = 0; z < 32; z++) {
                        const regionChunkPos = [x, z];
                        const worldChunkPos = [x + this.chunkOffsetX, z + this.chunkOffsetZ];
                        const chunkIndex = MinecraftRegionFile.getChunkIndex(...regionChunkPos);
                        
                        const sectorOffset = this.locationOffsets[chunkIndex];
                        if (sectorOffset == 0) continue;
                        
                        const sectorStart = sectorOffset * 4096;
                        
                        const view = new DataView(this.data.buffer, sectorStart, 5);
                        const chunkByteSize = view.getUint32(0);
                        const compressionType = view.getUint8(4);
                        
                        const dataStart = sectorStart + 5;
                        const compressedData = new Uint8Array(this.data.buffer.slice(dataStart, dataStart + chunkByteSize - 1));
                        
                        const inflatedData = compressionType == 2 ? pako.inflate(compressedData) : compressedData;
                        const nbtChunkData = new Nbt.NbtDocument(inflatedData);
                        const chunk = new _cubical.File.RegionChunk(nbtChunkData, ...worldChunkPos);

                        this.chunkData.set(chunkIndex, chunk);
                    }
                }
                
                var stop = true;
            }
            buildRegionFile() {
                const fileHeaderData = new ArrayBuffer(8192);
                const view = new DataView(fileHeaderData, 0, 8192);
                
                function setHeaderData(index, sectionOffset, sectionCount, timestamp) {
                    const offset = index * 4;
                    view.setUint8(offset, sectionOffset >> 16);
                    view.setUint8(offset + 1, (sectionOffset >> 8) & 255);
                    view.setUint8(offset + 2, sectionOffset & 255);
                    view.setUint8(offset + 3, sectionCount);
                    
                    view.setUint32(offset + 4096, timestamp);
                }
                
                let offset = 0;
                let lastSectionIndex = 0;
                
                // Build the file header data table
                /*
                for (let i = 0; i < 1024; i++) {
                    const sectionOffset = this.locationOffsets[i];
                    const sectionCount = this.locationSectorCounts[i];
                    
                    view.setUint8(offset, sectionOffset >> 16);
                    view.setUint8(offset + 1, (sectionOffset >> 8) & 255);
                    view.setUint8(offset + 2, sectionOffset & 255);
                    view.setUint8(offset + 3, sectionCount);
                    
                    view.setUint32(offset + 4096, this.timestamps[i]);
                    offset += 4;
                    
                    const lastIndex = sectionOffset + sectionCount - 1;
                    if (lastSectionIndex < lastIndex) lastSectionIndex = lastIndex;
                }
                */
                
                // const regionFileData = new Uint8Array((lastSectionIndex + 1) * 4096);
                // const regionFileData = this.data.slice();
                // regionFileData.set(new Uint8Array(fileHeaderData), 0);
                var compressedData = new Array(1024);
                
                const tempTimestamp = this.timestamps[0];
                const offsets = new Uint32Array(1024);
                var sectionIndex = 2;
                
                this.chunkData.forEach((chunk) => {
                    const chunkIndex = MinecraftRegionFile.getChunkIndex(chunk.x, chunk.z);
                    const chunkData = chunk.buildChunkData();
                    
                    const chunkSectionCount = Math.ceil(chunkData.length / 4096);
                    const chunkOffset = sectionIndex;
                    
                    setHeaderData(chunkIndex, chunkOffset, chunkSectionCount, tempTimestamp)
                    
                    // const sectionStart = this.locationOffsets[chunkIndex] * 4096;
                    // regionFileData.set(chunkData, sectionStart);
                    compressedData[chunkIndex] = chunkData;
                    offsets[chunkIndex] = chunkOffset;
                    sectionIndex += chunkSectionCount;
                }); 

                const regionFileData = new Uint8Array(sectionIndex * 4096);
                regionFileData.set(new Uint8Array(fileHeaderData), 0);
                
                for (var i = 0; i < 1024; i++) {
                    if (offsets[i] > 0) {
                        const sectionStart = offsets[i] * 4096;
                        regionFileData.set(compressedData[i], sectionStart);
                    }
                }

                return regionFileData;
            }
            getChunkData(cx, cy) {
                const chunkIndex = MinecraftRegionFile.getChunkIndex(cx, cz);
                
                const cachedChunk = this.chunkData.get(chunkIndex);
                if (cachedChunk) return cachedChunk;
                
                const sectorOffset = this.locationOffsets[chunkIndex];
                if (sectorOffset == 0) return null;
                
                const sectorStart = sectorOffset * 4096;
                
                const view = new DataView(this.data.buffer, sectorStart, 5);
                const chunkByteSize = view.getUint32(0);
                const compressionType = view.getUint8(4);
                
                const dataStart = sectorStart + 5;
                const dataView = new DataView(this.data.buffer, dataStart, chunkByteSize - 1);
                const compressedData = new Uint8Array(this.data.buffer.slice(dataStart, dataStart + chunkByteSize - 1));
                
                const inflatedData = compressionType == 2 ? pako.inflate(compressedData) : compressedData;
                const nbtChunkData = new Nbt.NbtDocument(inflatedData);
                const chunk = new _cubical.File.RegionChunk(nbtChunkData, ...chunkPos);
                
                this.chunkData.set(chunkIndex, new _cubical.File.RegionChunk(nbtChunkData, ...chunkPos));
                return new _cubical.File.RegionChunk(nbtChunkData, cx, cz);
            }
            toSchematic() {
                const schematic = new Schematic(512, 256, 512);
                const stateList = new Set();

                // Iterate set entries with forEach
                this.chunkData.forEach((chunk) => {
                    if (chunk.hasSectionData) {
                        chunk.sections.forEach((section) => {
                            const sectionSchematic = section.schematic;
                            
                            if (sectionSchematic) {
                                const x = section.x * 16;
                                const y = section.y * 16;
                                const z = section.z * 16;
                                schematic.insertSchematic(sectionSchematic, x, y, z);
                            }
                            
                            if (section.palette) {
                                for (var i = 0; i < section.palette.length; i++) {
                                    stateList.add(section.palette[i]);
                                }                                
                            }                            
                        });
                    }
                });

                this.stateList = stateList;                
                return schematic;
            }
            
            toVoxelWorld() {
                const world = new _cubical.Lib.VoxelWorld();

                this.chunkData.forEach((chunk) => {
                    if (chunk.hasSectionData) {
                        chunk.sections.forEach((section) => {
                            const voxelChunk = section.voxelChunk;
                            if (voxelChunk) {
                                world.addChunk(voxelChunk);
                            }
                        });
                    }
                });
              
                return world;
            }
            getMissingPaletteStates() {
                const missingList = new Set();

                this.chunkData.forEach((chunk) => {
                    if (chunk.hasSectionData) {
                        chunk.sections.forEach((section) => {
                            const missingStates = section.paletteMissing;
                            
                            if (missingStates) {
                                for (var i = 0; i < missingStates.length; i++) {
                                    missingList.add(missingStates[i]);
                                }
                            }                          
                        });
                    }
                });

                return missingList;                
            }
            getAllPaletteStates() {
                const stateList = new Set();

                this.chunkData.forEach((chunk) => {
                    if (chunk.hasSectionData) {
                        chunk.sections.forEach((section) => {
                            const states = section.paletteFullName;
                            
                            if (states) {
                                for (var i = 0; i < states.length; i++) {
                                    stateList.add(states[i]);
                                }
                            }                          
                        });
                    }
                });

                return stateList;                
            }
            
            static getChunkIndex(cx, cz) {
                return ((cx % 32) + (cz % 32) * 32);
            }
            static getChunkCoords(index) {
                const cx = index % 32;
                const cz = (index - cx) / 32;
                return [cx, cz];
            }  
        };

        this.RegionChunk = class RegionChunk {
            constructor(chunkNbt, x, z) {
                this.nbt = chunkNbt;
                this.x = x;
                this.z = z;
                this.hasSectionData = false;
                this.sections = new Set();
                
                const level = chunkNbt.root.getChildren().Level;
                if (level.children.Sections) {
                    if (level.children.Sections.children[0]) {
                        if (level.children.Sections.children[0].children.Blocks) {
                            this.formatVersion = "PreFlat";
                            this.hasSectionData = true;
                        }
                        else if (level.children.Sections.children[1].children.BlockStates) {
                            this.formatVersion = "Flat";
                            this.hasSectionData = true;
                        }
                    }
                }
                
                if (this.hasSectionData) {
                    
                    for (var i = 0; i < level.children.Sections.children.length; i++) {
                        const sectionNbt = level.children.Sections.children[i];
                        const yValue = sectionNbt.children.Y.value;
                        if (yValue == 255) continue;
                        
                        const chunkSection = new _cubical.File.RegionChunkSection(sectionNbt, this.x, yValue, this.z, true, this.formatVersion);
                        this.sections.add(chunkSection);                         
                    }                    
                }
            }

            buildChunkData() {               
                const compressionType = 2;
                
                // TODO: Remove this! For debugging only
                // const startData = this.nbt.data.slice();
                
                this.nbt.write();
                
                // TODO: Remove this! For debugging only
                // var match = true;
                // for (var i = 0; i < startData.length; i++) {
                //     if (startData[i] != nbtData[i]) {
                //         match = false;
                //         break;
                //     }
                // }
                
                const compressedData = pako.deflate(this.nbt.data);
                const dataSize = compressedData.length;
                const totalSize = dataSize + 5;

                const sectionBuffer = new ArrayBuffer(totalSize);
                
                const view = new DataView(sectionBuffer, 0, 5);
                view.setUint32(0, dataSize + 1);
                view.setUint8(4, compressionType);

                const typedArray = new Uint8Array(sectionBuffer);
                typedArray.set(compressedData, 5);
                
                return typedArray;
            }
        };
        
        this.RegionChunkSection = class RegionChunkSection {
            
            constructor(sectionNbt, x, y, z, loadData = true, regionFormatVersion = "Flat") {
                this.nbt = sectionNbt;
                this.x = x;
                this.y = y;
                this.z = z;
                
                if (sectionNbt && loadData) {
                    if (regionFormatVersion == "Flat") this.loadFlatNBT(sectionNbt);
                    else if (regionFormatVersion == "PreFlat") this.loadPreFlatNBT(sectionNbt);
                }
            }
            loadPreFlatNBT(sectionNbt) {              
                this.nbt = sectionNbt;
                const blocks = sectionNbt.getChild("Blocks").getValue().slice();
                const nibbleData = sectionNbt.getChild("Data").getValue();
                const data = new Uint8Array(4096);
                
                let index = 0;
                for (let i = 0; i < 2048; i++) {
                    data[index++] = nibbleData[i] & 0x0F;
                    data[index++] = (nibbleData[i] >> 4) & 0x0F;
                }
                
                const chunkId = _cubical.Lib.VoxelWorld.getChunkId(this.x, this.y, this.z);
                this.voxelChunk = new _cubical.Lib.VoxelChunk(chunkId, this.x, this.y, this.z, blocks, data);
            }
            loadFlatNBT(sectionNbt) {              
                this.nbt = sectionNbt;
                
                this.palette = [];
                this.paletteFullName = [];
                this.properties = [];
                
                const palette = sectionNbt.getChild("Palette");
                const states = sectionNbt.getChild("BlockStates");
                
                if (!palette || !states) return;
                
                for (var i = 0; i < palette.children.length; i++) {
                    const paletteState = palette.children[i];
                    const stateName = paletteState.children.Name.value;
                 
                    const propObj = {};
                    const propsList = [];
                    var hasProperties = false;
                    if (paletteState.getChild("Properties")) {
                        const bProps = paletteState.getChild("Properties").getChildren();
                        
                        for (var j in bProps) {
                            const name = bProps[j].getName();
                            const val = bProps[j].getValue();
                            propObj[name] = val;
                            
                            propsList.push(`${name}=${val}`);
                            hasProperties = true;
                        }
                    }
                    
                    const propsText = propsList.sort().join("|");
                    const propsStateName = stateName + (hasProperties ? "|" + propsText : "");
                    
                    this.palette.push(stateName);
                    this.paletteFullName.push(propsStateName);
                    this.properties.push(hasProperties ? propObj : null);
                }

                const paletteSize = this.palette.length;
                const bitSize = states.value.length / 64;

                this.paletteConvert = new Array(paletteSize);
                this.paletteMissing = new Array();
                const paletteMissingBlock = [253, 0];
                
                for (var i = 0; i < paletteSize; i++) {
                    const baseId = this.palette[i];
                    const converted = Minecraft.Blocks.getBlockFromState(baseId, this.properties[i]);
                    
                    if (converted == null) {
                        this.paletteMissing.push(this.paletteFullName[i]);
                        this.paletteConvert[i] = paletteMissingBlock.slice();
                    }
                    else {
                        this.paletteConvert[i] = converted;
                    }
                }

                const unpackedStateData = RegionChunkSection.unpackStateBitData(states.value.buffer, this.paletteConvert.length);
                const convertedStateData = RegionChunkSection.convertBlockStatePaletteData(unpackedStateData, this.paletteConvert);
                
                // Debugging for packed state data
                /* 
                const packedData = RegionChunkSection.packStateBitData(stateData.ids.buffer, paletteSize);

                const start = new Uint8Array(states.value.buffer);
                const end = packedData;

                var match = true;
                for (var i = 0; i < start.length; i++) {
                    if (start[i] != end[i]) {
                        console.log("Save data mismatch at position: %s", i)
                        break;
                    }
                }
                */

                // Finished parsing!
                // this.schematic = new Schematic(16, 16, 16, convertedStateData.blocks, convertedStateData.data);
                
                const chunkId = _cubical.Lib.VoxelWorld.getChunkId(this.x, this.y, this.z);
                this.voxelChunk = new _cubical.Lib.VoxelChunk(chunkId, this.x, this.y, this.z, convertedStateData.blocks, convertedStateData.data);
            }
            
            setBlockStateData(buffer, paletteSize) {
                const packedData = RegionChunkSection.packStateBitData(buffer, paletteSize);
                const longArray = new BigUint64Array(packedData.buffer);
                
                const states = this.nbt.getChild("BlockStates");
                states.setValue(longArray);
            }
            
            clone(x = null, y = null, z = null) {
                x = x == null ? this.x : x;
                y = y == null ? this.y : y;
                z = z == null ? this.z : z;
                
                this.nbt.update();
                const nbtData = new Uint8Array();
                
                const clone = new RegionChunkSection(this.nbt.clone(), x, y, z, false);
                
                clone.palette = this.palette.slice();
                clone.properties = this.properties.slice();
                clone.paletteFullName = this.paletteFullName.slice();                
                clone.paletteConvert = this.paletteConvert.slice();
                clone.paletteMissing = this.paletteMissing.slice();
                clone.schematic = this.schematic.clone();

                return clone;
            }
            
            static unpackStateBitData(buffer, paletteSize) {
                
                /*
                Block State for 5 bit sized pattern
                Each line is a 64 bit unsigned long in memory
                Read from right to left for each line and each byte

                MSB                                                                  LSB
                00010000-10000100-00100001-00001000-01000010-00010000-10000100-00100001
                00100001-00001000-01000010-00010000-10000100-00100001-00001000-01000010
                01000010-00010000-10000100-00100001-00001000-01000010-00010000-10000100
                10000100-00100001-00001000-01000010-00010000-10000100-00100001-00001000
                00001000-01000010-00010000-10000100-00100001-00001000-01000010-00010000
                00010000-10000100-00100001-00001000-01000010-00010000-10000100-00100001
                00100001-00001000-01000010-00010000-10000100-00100001-00001000-01000010
                01000010-00010000-10000100-00100001-00001000-01000010-00010000-10000100

                */
                
                const longBitSize = 64; 
                const totalStates = 4096;
                const bitSize = buffer.byteLength / 8 / longBitSize;
                const totalBits = totalStates * bitSize;
                const total64BitLongs = Math.ceil(totalBits / longBitSize);              
                const view = new DataView(buffer);
                
                let nextVal = 0;
                let bitCycleIndex = 0;
                let stateIndex = 0;
                
                // TODO: Make sure this doesn't screw things up down the line
                // ...maybe just create a new combined Uint16 id number to use, instead of storing both
                const states = paletteSize < 256 ? new Uint8Array(4096) : new Uint16Array(4096); 

                for (let i = 0; i < total64BitLongs; i++) {
                    const byteStartIndex = i * 8;
                    let byteIndex = 0
                    let byteBitIndex = 0;

                    let nextByte = view.getUint8(byteStartIndex + 7);
                    
                    for (let j = 0; j < longBitSize; j++) {
                        nextVal |= (((nextByte >> byteBitIndex) & 1) << bitCycleIndex);

                        bitCycleIndex++
                        if (bitCycleIndex == bitSize) {
                            states[stateIndex] = nextVal;                    
                            
                            nextVal = 0;
                            stateIndex++;
                            bitCycleIndex = 0;
                        }
                        
                        byteBitIndex++;
                        if (byteBitIndex == 8) {
                            byteIndex++;
                            byteBitIndex = 0;
                            
                            if (byteIndex < 8) nextByte = view.getUint8((7 - byteIndex) + byteStartIndex);
                        }
                    }
                }
                
                return states;
            }
            static packStateBitData(buffer, paletteSize) {
                const typeSize = 64;
                const totalStates = 4096;
                const bitSize = RegionChunkSection.getMinBitSize(paletteSize);
                const totalBits = totalStates * bitSize;
                const total64BitLongs = Math.ceil(totalBits / typeSize);              
                const view = new DataView(buffer);
                const packedBytes = new Uint8Array(total64BitLongs * 8);
                
                let nextVal = 0;
                let byteIndex = 0
                let byteBitIndex = 0;
                let longIndex = 0;
                let packedVal = 0;
                
                for (let i = 0; i < totalStates; i++) {
                    nextVal = view.getUint8(i);
                    
                    for (let j = 0; j < bitSize; j++) {
                        packedVal |= (((nextVal >> j) & 1) << byteBitIndex);
                    
                        byteBitIndex++;
                        if (byteBitIndex == 8) {
                            byteBitIndex = 0;

                            packedBytes[(longIndex * 8) + (7 - byteIndex)] = packedVal;
                            packedVal = 0;
                            
                            byteIndex++;
                            
                            if (byteIndex == 8) {
                                byteIndex = 0;
                                longIndex++;
                            }
                        }
                    }
                }

                return packedBytes;
            }
            static convertBlockStatePaletteData(unpackedStates, paletteConverter) {
                const blocks = paletteConverter.length < 256 ? new Uint8Array(4096) : new Uint16Array(4096); 
                const data = paletteConverter.length < 256 ? new Uint8Array(4096) : new Uint16Array(4096); 
                
                for (let i = 0; i < 4096; i++) {
                    const statePaletteId = unpackedStates[i];
                    const paletteConvertVal = paletteConverter[statePaletteId];
                    
                    blocks[i] = paletteConvertVal[0];
                    data[i] = paletteConvertVal[1];
                }
                
                return {blocks, data};
            }
            static getMinBitSize(paletteSize) {
                var b = 2;
                var index = 1;
                while (paletteSize > b) {
                    b <<= 1;
                    index++;
                }

                return Math.max(index, 4);
            }
        };
        
		this.VectorShapeConverter = class VectorShapeConverter {

			constructor(sch,typ) {
				this.type = null;
				this.data = null;
				this.minX = null;
				this.minY = null;
				this.minZ = null;
				this.maxX = null;
				this.maxY = null;
				this.maxZ = null;
				
				this.schematic = sch;
				this.setType(typ);
				this.cnt = 0;
				if (this.type == 'bo2' || this.type == 'shp') {
					this.data = [];
				}
				else {
					this.data = {};
					this.data.id = [];
					this.data.data = [];
				}
			}
			add(x,y,z,id,data) {
				
				if (this.type == 'bo2' || this.type == 'shp') {
					if (id <= 0 || data < 0 || data > 15) return;
					
					if(this.minX == null || x < this.minX) this.minX = x;
					if(this.minY == null || y < this.minY) this.minY = y;
					if(this.minZ == null || z < this.minZ) this.minZ = z;
					
					if(this.maxX == null || x > this.maxX) this.maxX = x;
					if(this.maxY == null || y > this.maxY) this.maxY = y;
					if(this.maxZ == null || z > this.maxZ) this.maxZ = z;			
				
					this.data.push(x,y,z,id,data);
				}
				else {
					this.data.id.push(id);
					this.data.data.push(data);
				}
				this.cnt++;
			}
			finish() {
				
				if (!(this.type == 'sch')) {
					var size = {x: this.maxX - this.minX, z: this.maxY - this.minY, y: this.maxZ - this.minZ};
					var ofs = {x: this.minX*-1,y: this.minY*-1, z: this.minZ*-1}; 
					
					this.schematic.create(size.x+1, size.y+1, size.z+1);
					
					if (this.type == 'bo2') {
						for (var i = 0; i < this.data.length; i+=5) {
							this.schematic.setBlock(this.data[i]+ofs.x, this.data[i+2]+ofs.z, this.data[i+1]+ofs.y, this.data[i+3], this.data[i+4], false, false);
						}
					}
					if (this.type == 'shp') {
						for (var i = 0; i < this.data.length; i+=5) {
							this.schematic.setBlock(this.data[i]+ofs.x, this.data[i+2]+ofs.z, this.data[i+1]+ofs.y, this.data[i+3], this.data[i+4], false, false);
						}
					}
				}
				else {
					this.schematic.create(this.schematic.x,this.schematic.y,this.schematic.z,this.data.id, this.data.data);
				}
				return this.cnt;
			}
			setType(typ) {
				if (typeof typ !== 'undefined') this.type = typ;
			}			
		}

	});
	
    this.UI = new (function UI() {
        this._group = true;   
        this.CubicalWindow = class CubicalWindow {
			constructor(content, title = "", onLoad = null) {
				this.id = CubicalWindow._NEXT_ID++;
                this.element = null;
				this.content = content;
                this.title = title;
                if (onLoad) this.onLoad = onLoad;
                this.isOpen = false;
				this.isLoaded = false;
                this.isResizeable = true;
                this.isMovable = true;
                this.isClosable = true;
                this.isPersistent = true;
			}
            createElement() {
                const element = `
                    <div id="${this.getWindowId()}" class="${(this.isMovable ? "moveableTarget" : "")} ${(this.isResizeable ? "resizeableTarget" : "")} window" tabindex="-1">
                        <div id="inner">
                            <div id="header" ${(this.isMovable ? 'class="moveableSrc"' : '')}>
                                <div class="title">${(this.title == null ? "" : this.title)}</div>
                                ${(this.isClosable ? '<div class="winCloseBtn"></div>' : '')}	
                            </div>
                            <div id="innerContent">
                            </div>	
                        </div>
                        ${(this.isResizeable ? '<div class="resizeableSrc seCorner"></div>' : '')}
                    </div>
                `;
                
                $("#canvas-holder #windowHolder").append(element);
                $(`#${this.getWindowId()} #innerContent`).append(this.content);
                
                this.element = $(`#${this.getWindowId()}.window`)[0];
                this.element.panel = this;
                
                if (this.onLoad) this.onLoad(this.element);
                
                this.isLoaded = true;
            }         
            open() {
                if (!this.isLoaded) this.createElement();
                
                $(this.element).show();
                Game.gui.windows.openWindow(this.element);
                this.isOpen = true;
                
                if (this.onOpen) this.onOpen();
            }
            close() {
                if (!this.isOpen) return;
                
                // this.element.hide();
                Game.gui.windows.closeWindow(this.element);
                this.isOpen = false;
                
                if (!this.isPersistent) this.destroy();
                
                if (this.onClose) this.onClose();
            }
            destroy() {
                $(this.element).remove();
            }
            toggle() {
                if (this.isOpen) this.close();
                else this.open();
            }           
            setSize(width, height) {
                $(this.element).css("width", width + "px").css("height", height + "px");
            }
            setPosition(x, y) {
                $(this.element).css("left", x + "px").css("top", y + "px");
            }
            centerWindow() {
                const rect = this.element.getBoundingClientRect();
                const width = Game.canvas.width;
                const height = Game.canvas.height;
                
                const left = width * .5 - rect.width * .5;
                const top = height * .5 - rect.height * .5;
                
                $(this.element).css("position", "absolute")
                    .css("left", `${left}px`).css("top", `${top}px`)
                    .css("margin-left", "0px").css("margin-top", "0px");
            }
            getWindowId() {
                return `${this.id}CubicalWindow`;
            }
            static getWindowByTitle(titleName) {
                let win = null;
                $(`.window`).each((k, v) => {
                    if ($(v).find(".title").html() == titleName) {
                        win = v;
                    }
                });
                
                return win;
            }
            static _init() {
                CubicalWindow._NEXT_ID = 0;
            }
        };
        
        this.NewFileWindow = class NewFileWindow extends this.CubicalWindow {
			constructor() {
                
                const inner = `
                    <div class="dialogWindowContainer">
                        <div class="dialogWindowContent">
                            <div class="newFileSize">
                                <label class="label optionHeaderLabel">Project Block Size</label>
                                <div class="inputGroup">
                                    <input type="range" name="newFileWidth" class="slider" id="newFileWidthRange" min="16" max="256" step="16" value="64" />
                                    <input value="64" id="newFileWidth" class="sizeInput" type="text" />
                                    <label class="sizeLabel">Width</label>                                    
                                </div>
                                
                                <div class="inputGroup">
                                    <input type="range" name="newFileHeight" class="slider" id="newFileHeightRange" min="16" max="256" step="16" value="64" />
                                    <input value="64" id="newFileHeight" class="sizeInput" type="text" />
                                    <label class="sizeLabel">Height</label>
                                </div>

                                <div class="inputGroup">
                                    <input type="range" name="newFileDepth" class="slider" id="newFileDepthRange" min="16" max="256" step="16" value="64" />
                                    <input value="64" id="newFileDepth" class="sizeInput" type="text" />
                                    <label class="sizeLabel">Depth</label>
                                </div>
                            </div>
                            
                            <div class="newFileOptions">
                                <label class="label optionHeaderLabel">Build Options</label>

                                <div class="inputGroup">
                                    <select id="newFileOptionsTypeSelect" style="height:23px; padding-right:6px; margin-right:7px">
                                        <option value="Basic" selected="selected">Basic</option>
                                        <option value="Generator">Generator</option>
                                        <option value="Template">Template</option>
                                    </select>
                                    <label>Starting Area</label>
                                </div>
                                
                                <div class="horizontalRule" style="margin:6px 0px"></div>
                                
                                <div id="newFileOptionsContainerBasic" class="newFileOptionsContainer">
                                    <div class="inputGroup">
                                        <input type="checkbox" id="addFlatlandCheckbox">
                                        <label class="checkboxLabel">Add Flatland Layers</label>
                                    </div>

                                    <div class="inputGroup">
                                        <input type="checkbox" id="addPlatformCheckbox">
                                        <label class="checkboxLabel">Add Base Platform</label>
                                        <input value="7" class="scrollNumber" id="platformMaterial" type="text" style="display:none" />
                                    </div>
                                    
                                    <div class="inputGroup">
                                        <input type="checkbox" id="addOriginCheckbox">
                                        <label class="checkboxLabel">Add Chunk Markers</label>
                                    </div>
                                </div>
                                
                                <div id="newFileOptionsContainerGenerator" class="newFileOptionsContainer">
                                    <label>Drag a generator tool item icon from the hotbar to the box below</label>
                                    <div id="newFileOptionsGeneratorTarget"></div>
                                </div>
                                
                                <div id="newFileOptionsContainerTemplate" class="newFileOptionsContainer">
                                    <label>Enter a saved cubical project id or project url into the box below</label>
                                    <input value="" id="newFileOptionsTemplateProject" type="text" autocomplete="off" />
                                    <label id="newFileOptionsTemplateOutput" style="margin-top:2px">❌ Project Not Found</label>
                                </div>
                                
                            </div>
                            
                            <div class="inputGroup" style="position:absolute; bottom: 2px;">
                                <input type="checkbox" id="saveQuickFileSettings">
                                <label class="checkboxLabel">Save settings as quick file tab default</label>
                            </div>
                            
                        </div>

                        <div class="dialogWindowFooter">
                            <div class="newFileProjectName">
                                <label>Name</label>
                                <input value="New Project" id="filename" type="text" />
                            </div>
                        
                            <input value="Create" class="button" id="newFileCreate" type="button" />
                            <input value="Cancel" class="button" id="newFileCancel" type="button" />
                        </div>

                    </div>`;
                
                super(inner, "New File...");

                this.isResizeable = false;
                this.generatorArgs = null;
                
			}
            onLoad() {
                this.setSize(500, 250);
                
                const winId = this.getWindowId();
                const p = this;
                
				$(`#${winId} input, #${winId} select`).change(function(evt) {
					
					if (this.type == "range") {
						$(`#${winId} #` + this.name)[0].value = this.value;
					}
					else if (this.className == "sizeInput") {
						const range = $("input[name='" + this.id + "']")[0]
						let newVal = parseInt(this.value);
						
                        if (!(newVal > 0)) newVal = 1;
						
                        range.value = newVal;
						this.value = newVal;
					}
				});
                
				$(`#${winId} input[type='range']`).on("input", function(evt) {
					$(`#${winId}  #` + this.name)[0].value = this.value;
				});
                
                $(`#${winId} .checkboxLabel`).click(function(evt){
					$(this).prev().trigger("click");
				});	
          
                $(`#${winId} .button`).click(function(e){
                    if (this.id == "newFileCreate") {                       
                        p.createNewFile().then(
                            (result) => {
                                
                                if ($(`#${winId} input[type='checkbox']#saveQuickFileSettings`)[0].checked) {
                                    const argsToSave = p.getArgs();
                                    p.saveArgSettings(argsToSave);
                                    
                                    $(`#${winId} input[type='checkbox']#saveQuickFileSettings`)[0].checked = false;
                                }
                                
                                Game.shapes.loadShape(result);
                                Game.shapes.setShape(Game.shapes.uploads.length - 1);
                                
                                p.close();
                            },
                            (error) => {
                                alert(`Error creating new file - ${error}`);
                            }
                        );
                    }
                    else if (this.id == "newFileCancel") {
                        p.close();
                    }
                });
          
                $(`#${winId} input[type='checkbox']`).prop("checked", true);
                
                $(`#${winId} #newFileOptionsTypeSelect`).change(function(evt) {
                    const startingType = this.value;
                    p.onStartingTypeChange(startingType);
                });
                
                $(`#${winId} #newFileOptionsTypeSelect`).trigger("change");
                
                const templateOutput = $(`#${winId} #newFileOptionsTemplateOutput`);
                let checkFileTimeout;
                $(`#${winId} #newFileOptionsTemplateProject`).on("input", function(evt) {
                    
                    if (checkFileTimeout) clearTimeout(checkFileTimeout);
                    let changedProjectId = $(this).val();
                    if (changedProjectId.search("/") > -1) {
                        changedProjectId = changedProjectId.substr(changedProjectId.lastIndexOf("/") + 1);
                    }
                    
                    templateOutput.html("...");
                    
                    checkFileTimeout = setTimeout(() => {                        
                        p.checkProjectState(changedProjectId).then(
                            (result) => {
                                templateOutput.html("✔️ Project Found");
                                p.templateProjectFound = true;
                                p.templateProjectId = changedProjectId;
                            },
                            (err) => {
                                templateOutput.html("❌ Project Not Found");
                                p.templateProjectFound = false;
                                p.templateProjectId = null;
                            }
                        );
                        
                        checkFileTimeout = null;
                    }, 500);
                    
                });
                
                // Generator tool drag and drop
                $("#actionBar .actionBtn").on('dragstart', ".icon", function (evt) {							
    
                    const slotId = parseInt(String(this.parentNode.id).split("action")[1]);
                    const slotData = Game.gui.actionBar.slotData[slotId];

                    p.onToolDragStateChange(true, slotData);
                });
                
                $("#actionBar .actionBtn").on('dragend', ".icon", function (evt) {		
                    p.onToolDragStateChange(false);
                });
                
                const generatorDropTarget = $(`#${winId} #newFileOptionsGeneratorTarget`);
                generatorDropTarget.on('drop', function (evt) {
                    if (Game.tools.draggingTool == true && p.isDraggingGeneratorTool) {

                        const dragData = evt.originalEvent.dataTransfer.getData("text");
                        const toolData = JSON.parse(dragData);
                        
                        p.setGeneratorData(toolData);
                    }
                });
                generatorDropTarget.on('dragenter dragover', function (evt) {
                    if (Game.tools.draggingTool == true && p.isDraggingGeneratorTool) {
                        evt.stopPropagation();
                        evt.preventDefault();
                        generatorDropTarget.css("box-shadow", `inset 0 0 10px 3px rgba(0, 255, 0, 0.25)`);
                        return false;
                    }
                    
                    generatorDropTarget.css("box-shadow", `inset 0 0 10px 3px rgba(255, 0, 0, 0.25)`);
                });			
                generatorDropTarget.on('dragleave', function (evt) {
                    generatorDropTarget.css("box-shadow", "");
                });
                
                const platformMaterialInput = $(`#${winId} input#platformMaterial`);
                Game.gui.panels.base.blockPicker.attach(platformMaterialInput, p);
                platformMaterialInput.trigger("change");
                
                $(`#${winId} input[type='checkbox']#addPlatformCheckbox`)[0].checked = false;
                $(`#${winId} input[type='checkbox']#addOriginCheckbox`)[0].checked = false;
                $(`#${winId} input[type='checkbox']#saveQuickFileSettings`)[0].checked = false;
            }
            onOpen() {
                this.centerWindow();
            }
            createNewFile(quickFile = false) {
                
                const ptr = this;
                const args = quickFile ? this.getSavedArgs() : this.getArgs();
                const size = [args.width, args.height, args.depth];
                const filename = args.filename;
                
                return new Promise((resolveNewFile, rejectNewFile) => {               

                    if (args.options.type == "Basic") {                    
                        const sch = new Schematic(size[0], size[1], size[2]);
                        sch.setName(filename);
                    
                        const addFlatland = args.options.basic.addFlatland;
                        const addPlatform = args.options.basic.addPlatform;
                        const addOrigin = args.options.basic.addOrigin;
                        
                        if (addFlatland) {
                            const flatlandLayers = [7,1,1,1,3,2];
                            
                            for (let y = 0; (y < size[1] && y < flatlandLayers.length); y++) {
                                const layerBlockId = flatlandLayers[y];
                                
                                for (let x = 0; x < size[0]; x++) {
                                    for (let z = 0; z < size[2]; z++) {
                                        sch.setBlock(x, y, z, layerBlockId, 0, false);
                                    }
                                }
                            }
                        }

                        if (addPlatform) {
                            const platformMaterialStr = args.options.basic.platformBlock;
                            const platformBlock = Minecraft.util.parseBlock(platformMaterialStr);
                            
                            for (let x = 0; x < size[0]; x++) {
                                for (let z = 0; z < size[2]; z++) {
                                    sch.setBlock(x, 0, z, platformBlock.id, platformBlock.data, false);
                                }
                            }
                        }
                        
                        if (addOrigin) {
                            for (let x = 0; x < size[0]; x++) {
                                sch.setBlock(x, 0, 0, ((x+1) % 16) == 0 ? 35 : 95, 14, false);
                            }
                            for (let y = 0; y < size[1]; y++) {
                                sch.setBlock(0, y, 0, ((y+1) % 16) == 0 ? 35 : 95, 13, false);
                            }							
                            for (let z = 0; z < size[2]; z++) {
                                sch.setBlock(0, 0, z, ((z+1) % 16) == 0 ? 35 : 95, 11, false);
                            }							
                        }
                        
                        resolveNewFile(sch);
                    }
                    else if (args.options.type == "Generator") {
                        
                        if (!quickFile && !ptr.generatorArgs) {
                            rejectNewFile("You must specify a generator by dragging an appropriate tool icon to the form box!");
                        }
                        else {
                           
                            const toolId = quickFile ? args.options.generator.args.toolId : ptr.generatorArgs.toolId;
                            const generatorTool = Game.tools.generator[toolId];
                            const toolArgs = JSON.parse(JSON.stringify(quickFile ? args.options.generator.args.toolArgs : ptr.generatorArgs.toolArgs));
                            toolArgs.width = args.width;
                            toolArgs.height = args.height;
                            toolArgs.depth = args.depth;
                            
                            generatorTool.generateSchematic(toolArgs).then(
                                (sch) => {
                                    sch.setName(filename);
                                    resolveNewFile(sch);
                                },
                                (error) => {
                                    rejectNewFile(error);
                                }
                            );
                        }
                    }
                    else if (args.options.type == "Template") {
                        if (!quickFile && !this.templateProjectFound) {
                            rejectNewFile("You must specify a valid cubical project to use as a template!");
                        }
                        else {
                            const projectId = quickFile ? args.options.template.project : this.templateProjectId;
                            const downloadProject = new Promise((resolveDownload, rejectDownload) => {
                                
                                const projectUrl = "/project.php?id=" + projectId;
                                const request = new XMLHttpRequest();
                                request.onload = function(e) {
                                    if (this.status == 200) {
                                        const fileBlob = this.response;
                                        
                                        if (fileBlob.size == 0) {
                                            rejectDownload(`Failed to receive file data from: ${projectUrl}`);
                                        }
                                        else {
                                            fileBlob.lastModifiedDate = new Date();
                                            fileBlob.name = `cubical_project_${projectId}.schematic`;
                                            resolveDownload(fileBlob);
                                        }
                                    }
                                };

                                request.timeout = 6000;
                                request.open('POST', projectUrl, true);
                                request.responseType = 'blob';
                                request.send();
                            });
                            
                            downloadProject.then(
                                (downloadResult) => {
                                    
                                    const assetFile = new _cubical.File.AssetFile(downloadResult);
                                    assetFile.parseData().then(
                                        (assetResult) => {                                        
                                            if (assetResult instanceof Schematic) {
                                                assetResult.setName(filename);
                                                resolveNewFile(assetResult);
                                            }
                                            else {
                                                rejectNewFile(`Invalid project type found!`);
                                            }
                                        },
                                        (assetError) => {
                                            rejectNewFile(`Error parsing project data! - ${assetError}`);
                                        }
                                    );
                                    
                                },
                                (downloadError) => {
                                    rejectNewFile(`Error downloading project data! - ${downloadError}`);
                                },
                            );
                        }
                    }
                });
            }
            onStartingTypeChange(type) {
                const winId = this.getWindowId();
                const groupPrefix = "newFileOptionsContainer";
                
                $(`#${winId} .${groupPrefix}`).hide();
                $(`#${winId} .${groupPrefix}#${groupPrefix}${type}`).show();
            }
            onToolDragStateChange(dragStarting, dragData) {
                const winId = this.getWindowId();
                
                if (dragStarting) {
                    let shadowColor;
                    if (dragData && dragData.toolType == "generator") {
                        this.isDraggingGeneratorTool = true;
                    }
                    else {
                        this.isDraggingGeneratorTool = false;
                    }                              }
                else {
                    this.isDraggingGeneratorTool = false;
                    $(`#${winId} #newFileOptionsGeneratorTarget`).css("box-shadow", "");
                }
            }
            getArgs() {
                const element = $(this.element);
                
                const args = {};
                args.width = parseInt(element.find("#newFileWidth").val());
                args.height = parseInt(element.find("#newFileHeight").val());
                args.depth = parseInt(element.find("#newFileDepth").val());
                args.filename = element.find("#filename").val();
                
                args.options = {};
                
                const startType = element.find("#newFileOptionsTypeSelect").val();
                args.options.type = startType;
                
                switch(startType) {
                    case "Basic":
                        args.options.basic = {};
                        args.options.basic.addFlatland = element.find("#addFlatlandCheckbox")[0].checked;
                        args.options.basic.addPlatform = element.find("#addPlatformCheckbox")[0].checked;
                        args.options.basic.addOrigin = element.find("#addOriginCheckbox")[0].checked;
                        args.options.basic.platformBlock = element.find("#platformMaterial").val();
                        
                        break;
                    case "Generator":
                        args.options.generator = {};
                        args.options.generator.args = this.generatorArgs;
                        
                        break;
                    case "Template":
                        args.options.template = {};
                        let templateId = element.find("#newFileOptionsTemplateProject").val();
                        if (templateId.search("/") > -1) {
                            templateId = templateId.substr(templateId.lastIndexOf("/") + 1);
                        }
                        
                        args.options.template.project = templateId;
                        break;                    
                }
                
                return args;
            }
            getSavedArgs() {

                let args = {};
                const savedArgs = Game.settings.getKey("quickFileSavedArgs");
                
                if (savedArgs) {
                    args = JSON.parse(savedArgs);
                }
                else {
                    // Load default args if there aren't any saved
                    
                    args.width = 64;
                    args.height = 64;
                    args.depth = 64;
                    args.filename = "New Project";
                    
                    args.options = {};
                    args.options.type = "Basic";

                    args.options.basic = {};
                    args.options.basic.addFlatland = true;
                    args.options.basic.addPlatform = false;
                    args.options.basic.addOrigin = false;
                    args.options.basic.platformBlock = "7:0"
                }
                
                return args;
            }

            loadArgs(args) {
                const element = $(this.element);
                
                element.find("#newFileWidth").val(args.width);
                element.find("#newFileHeight").val(args.height);
                element.find("#newFileDepth").val(args.depth);
                
                const startType = args.startType;
                element.find("#newFileOptionsTypeSelect").val(startType);
                
                switch(startType) {
                    case "Basic":
                        element.find("#addFlatlandCheckbox")[0].checked = args.options.basic.addFlatland;
                        element.find("#addPlatformCheckbox")[0].checked = args.options.basic.addPlatform;
                        element.find("#addOriginCheckbox")[0].checked = args.options.basic.addOrigin;
                        element.find("#platformMaterial").val(args.options.basic.platformBlock);
                        break;
                    case "Generator":
                        this.generatorArgs = args.options.generator.args;
                        break;
                    case "Template":
                        element.find("#newFileOptionsTemplateProject").val(args.options.template.project);
                        break;                    
                }
                
            }
            saveArgSettings(args) {
                this.savedArgs = args;
                Game.settings.setKey("quickFileSavedArgs", JSON.stringify(args));
                Game.settings.save();
            }
            setGeneratorData(argData) {
                const winId = this.getWindowId();
                const generatorDropTarget = $(`#${winId} #newFileOptionsGeneratorTarget`);
                
                const slotTool = Game.tools[argData.toolType][argData.toolId];
                const toolIcon = new Image();
                toolIcon.src = slotTool.icon;
                
                $(toolIcon).addClass("icon");
                $(generatorDropTarget).html("");
                $(generatorDropTarget).prepend(toolIcon);
                
                this.generatorArgs = argData;
            }
            checkProjectState(projectId) {
                
                this.templateProjectFound = false;
                
                return new Promise((resolve, reject) => {
                    const url = `/project.php?id=${projectId}&v=true`;
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function(e) {
                        if (this.status == 200) {
                            const response = this.response;
                            
                            if (response.size == 0) {
                                reject();
                            }
                            else if (response == "true") {
                                resolve(true);
                            }
                            else {
                                reject();
                            }                            
                        }
                        else {
                            reject();
                        }
                    };

                    xhr.timeout = 2000;
                    xhr.open('POST', url, true);
                    xhr.responseType = 'text';
                    xhr.send();
                });
            }
        }
        
        this.UpdateAnnouncementWindow = class UpdateAnnouncementWindow extends this.CubicalWindow {
			constructor() {
                
                const inner = `<div style="padding:8px;font-size:14px;line-height:20px;"><img src="/images/open_beta.jpg" title="cubical.xyz - 1.16.4 Open Beta Coming Soon" style="width: 100%;">
<p>I am happy to announce that for the past few months I have been working on a huge update to cubical that will allow it to support all the newest blocks and features in Minecraft 1.16.4+.</p> <p>However, before these changes go live to this site, I will be holding an open beta test for anyone that wants to try it out while it's still being developed. If you are interested in being part of this early access testing, please follow the new cubical twitter account where I will post more info once it becomes available. Thanks!</p>
<div style="position: absolute; display: block; margin-top: 4px; text-align: center; left: 0; right: 0;"><a target="_blank" href="https://twitter.com/cubical_xyz?ref_src=twsrc%5Etfw" class="twitter-follow-button" data-size="large" data-show-count="false">Follow @cubical.xyz</a><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></div></div>`;
                
                super(inner, "1.16.4+ Update Announcement");
            }
        };
        
        this.Notifications = class Notifications {
            constructor() {
                this.element = null;
            }
            
            initializeElements() {
                const ptr = this;
                
                this.element = this.constructor.getInnerContent();
                $('#topToolbar').append(this.element);
                
                this.loadAnnouncements();
            }
            
            async loadAnnouncements() {

                const formData = new FormData();
                formData.append("type", "announcements");
                formData.append("host", location.host);

                let responseData;

                try {
                    const result = await fetch('/updates.php', {method: "POST", body: formData});
                    responseData = await result.json();
                }
                catch (e) {
                    return;
                }
                
                if (!responseData || !responseData.list || !responseData.list.length) return;
                
                const announcementItem = responseData.list[0];
                const content = announcementItem.content;
                const title = announcementItem.title || 'Latest Announcement';
                const size = announcementItem.size || null;
                
                const windowClass = typeof _cubical !== 'undefined' ? _cubical.UI.CubicalWindow : (Cubical.UI.CubicalWindow ? Cubical.UI.CubicalWindow : Cubical.UI.Window);
                const announcementWindow = new windowClass(content, title);
                announcementWindow.open();
                
                if (size) {
                    announcementWindow.setSize(size.width, size.height);
                    announcementWindow.centerWindow();
                }
                
            }
            
            static getInnerContent() {
               return `<div id="cubicalNotifications"></div>`;
            }
        }
        
        this.ProjectFileSearch = class ProjectFileSearch {
            constructor(query, category, sortType, sortDirection) {
                this.query = query;
                this.category = category;
                this.sortType = sortType;
                this.sortDirection = sortDirection;
                
                this.results = null;
                this.receivedResults = 0;
                this.totalResults = 0;

                this.isAwaitingResponse = false;
                this.itemsToRequest = 20;
                this.pageSize = 100;
                this.pageOffset = 0;
            }
            
            send(callback, offset = 0) {               
                if (this.isAwaitingResponse) return;
                this.isAwaitingResponse = true;
                
                const xhr = new XMLHttpRequest();
                const ptr = this;
                xhr.onload = function(e) {                    
                    if (this.status == 200) {
                        const response = this.response;
                        
                        if (response.length == 0) {
                            console.log("Failed to recieve data from: " + ProjectFileSearch._URL);
                            ptr.isAwaitingResponse = false;
                            return;
                        }
                        
                        const parsedData = JSON.parse(response);
                        ptr.onSearchResult(parsedData, offset);
                        
                        callback(parsedData);
                    }
                    
                    ptr.isAwaitingResponse = false;                    
                };
                xhr.ontimeout = function(e) {                    
                    console.log("Timemout communicating with: " + ProjectFileSearch._URL);           
                    ptr.isAwaitingResponse = false;
                };

                const searchStr = ProjectFileSearch._URL + `?a=s&q=${this.query}&t=${this.category}&s=${this.sortType}&d=${this.sortDirection}&o=${offset}`;

                xhr.timeout = 3000;
                xhr.open('POST', searchStr, true);
                xhr.responseType = 'text';
                xhr.send();
            }
            onSearchResult(data, offset = 0) {                
                if (data.offset > 0) {
                    if (offset > this.pageOffset && data.offset > this.pageOffset) {
                        this.results.push.apply(this.results, data.projects);
                        this.pageOffset = data.offset;
                    }
                }
                else {
                    this.results = data.projects;
                    this.receivedResults = 0;
                    this.pageOffset = 0;
                    this.totalResults = data.total;
                }
            }
            hasMoreItems() {
                return this.results != null && this.receivedResults < this.totalResults;
            }
            requestItems(count) {
                const resultsLeft = this.totalResults - this.receivedResults;
                const localResultsLeft = this.results.length - this.receivedResults;
                
                count = Math.min(Math.min(count, resultsLeft), localResultsLeft);
                
                if (resultsLeft > count && this.receivedResults + 20 >= this.results.length) {
                    this.send(() => {}, this.pageOffset + 1);
                }
                
                if (count == 0) return [];

                const start = this.receivedResults;
                const itemData = this.results.slice(start, start + count);
                
                this.receivedResults += count;
                
                return itemData;
            }
            
            static _init() {
                ProjectFileSearch._URL = "/project.php";
            }
            
        }
        
        this.CustomDropdown = class CustomDropdown {
            constructor(id, onChange, options, selected = null) {
                this.element = null;
                this.options = options;
                this.selected = selected;
                this.isOpen = false;
                this.lastClosed = 0;
                const p = this;
                
                const template = CustomDropdown.buildDropdownTemplate(id);
                this.container = $(template).find(".customDropdownContainer");
                this.arrow = $(template).find(".customDropdownArrow");
                this.element = template;
                
                for (let i = 0; i < options.length; i++) {				
                    const element = options[i];
                    this.container.append(CustomDropdown.buildOptionTemplate(element));
                }
                
                $(template).find(".customDropdownChild").click(function(e) {
                    p.onSelectOption(this.id);
                    e.stopPropagation();
                    return false;
                });
                
                $(template).find(".customDropdownInput").click(function(e) {
                    p.toggle();                   
                    e.stopPropagation();
                    return false;
                });
                
                $(this.container).on("focusout", function(e){
                    p.close();
                });
                
                if (this.selected == null && options.length > 0) {
                    this.onSelectOption(options[0].id);
                }                    
                
                this.onChange = onChange;
                // $("#contextmenu").css("left", evt.clientX +  "px").css("top", evt.clientY + "px");
                // $(menu).show().focus();
            }
            
            open() {
                if (new Date().getTime() < this.lastClosed + 150) return;
                
                this.isOpen = true;
                $(this.container).addClass("open").focus();
                $(this.arrow).addClass("open");
            }
            
            close() {
                this.isOpen = false;
                $(this.container).removeClass("open");
                $(this.arrow).removeClass("open");
                this.lastClosed = new Date().getTime();
            }
            
            toggle() {               
                if (this.isOpen) this.close();
                else this.open();
            }
            onSelectOption(id) {
                
                if (this.selected != id) {
                    this.selected = id;
                    
                    const toClone = $(this.element).find(`.customDropdownChild#${id}`);
                    const target = $(this.element).find(".customDropdownInput");
                    
                    target.html(toClone.clone());
                    
                    if (this.onChange) this.onChange(id);
                }
                
                this.close();
            }
            
            static buildOptionTemplate(element) {
                return $.parseHTML(`<div class="customDropdownChild" id="${element.id}">${$(element).html()}</div>`);
            }
            
            static buildDropdownTemplate(id) {
                return $.parseHTML(`<div class="customDropdown" id="${id}">
                        <div class="customDropdownArrow"></div>
                        <div class="customDropdownInput"></div>
                        <div class="customDropdownContainer" tabindex="-1"></div>
                    </div>`);
            }
            
            static fromPlaceholder(element, callback) {
                const id = element.id;
                const selected = null;
                
                const options = $(element).children();
                options.each((i) => {
                    if ($(options[i]).hasClass("selected")) {
                        selected = options[i].id;
                    }
                });
                
                element.className = "customDropdown";
                
                return new CustomDropdown(id, callback, options, selected);
            }
            
            static _init() {
                CustomDropdown._UP_ARROW = "▲";
                CustomDropdown._DOWN_ARROW = "▼";
            }
        }
    
        this.JoystickController = class JoystickController {
            
            constructor(element, onChange, onClick) {
                this.element = element;
                this.grip = $(element).find(".joystickGrip")[0];
                
                this.xOffset = 0;
                this.yOffset = 0;
                this.xStart = 0;
                this.yStart = 0;
                this.maxRadius = 32;
                this.inUse = false;
                this.touchId = null;
                this.onJoystickChange = onChange;
                this.onJoystickClick = onClick;
                this.angle = 0;
                this.strength = 0;
                this.direction = [0, 0];

                const ptr = this;                                
                $(element).on('touchstart', (e) => { ptr.onTouchStart(e) });
				$(element).on('touchend', (e) => { ptr.onTouchEnd(e) });
				$(element).on('touchcancel', (e) => { ptr.onTouchCancel(e) });
				$(element).on('touchmove', (e) => { ptr.onTouchMove(e) });
                $(element).on('click', (e) => { ptr.onClick(e) });
            }
            isActive() {
                return this.touchId != null && this.inUse;
            }
            onTouchStart(evt) {
                if (this.inUse || this.touchId != null) return;
                
                const touch = evt.originalEvent.changedTouches[0];
                
                this.xStart = touch.clientX;
                this.yStart = touch.clientY;
                this.inUse = true;
                this.touchId = touch.identifier;
                evt.stopImmediatePropagation();
            }
            onTouchEnd(evt) {
                if (evt.originalEvent.changedTouches[0].identifier != this.touchId) return;
                
                this.onJoystickEndMove();
                evt.stopImmediatePropagation();
            }
            onTouchCancel(evt) {
                if (evt.originalEvent.changedTouches[0].identifier != this.touchId) return;
                
                this.onJoystickEndMove();
                evt.stopImmediatePropagation();
            }
            onTouchMove(evt) {
                if (evt.originalEvent.changedTouches[0].identifier != this.touchId) return;
                const touch = evt.originalEvent.changedTouches[0];
                const x = touch.clientX;
                const y = touch.clientY;
                
                const angle = Minecraft.util.getAngle(this.xStart, this.xStart, x, y);
                const distance = vec2.distance([this.xStart, this.yStart], [x, y]);
                const offset = [x - this.xStart, y - this.yStart];
                vec2.normalize(this.direction, offset);
                
                if (distance > this.maxRadius) {
                    this.xOffset = this.direction[0] * this.maxRadius;
                    this.yOffset = this.direction[1] * this.maxRadius;
                }
                else {
                    this.xOffset = offset[0];
                    this.yOffset = offset[1];
                }
                
                this.angle = angle;
                this.strength = Math.min(distance / this.maxRadius, 1);
                
                const left = this.xOffset;
                const top = this.yOffset;
                
                $(this.grip).css("left", `${left}px`);
                $(this.grip).css("top", `${top}px`);
                
                // $(this.grip).css("background-color", "green");
                if (this.onJoystickChange) this.onJoystickChange();
                
                evt.stopImmediatePropagation();
                evt.preventDefault();
            }
            onJoystickEndMove() {
                this.inUse = false;
                this.touchId = null;
                
                this.xOffset = 0;
                this.yOffset = 0;
                
                this.direction = [0,0];
                
                $(this.grip).css("left", 0);
                $(this.grip).css("top", 0);
            }
            onClick(evt) {
                
                // $(this.grip).css("background-color", "blue");
                if (this.onJoystickClick) this.onJoystickClick();
            }
            
        }

        this.CubicalMenu = class CubicalMenu {
            constructor(callback, items = null, root = true, contextMenu = false, container = null, fixedOpen = false) {
                this.id = CubicalMenu._NEXT_ID++;
                
                this.menuItems = [];
                this.isRoot = root;
                this.callback = callback;
                this.isContextMenu = contextMenu;
                this.parent = null;
                this.menuElement = null;
                this.activeItem = null;
                this.isOpen = false;
                this.isFixedOpen = fixedOpen;
                this.direction = this.isFixedOpen ? "Row" : "Column";
                this.container = container != null ? container : document.createElement('div');                
                this.container.id = `cmc${this.id}`;
                this.container.className = 'cubicalMenuContainer ' + this.container.className;
                
                if (items != null) this.addItems(items);
            }
            
            build() {				
                let menuInner = "";

                const menuId = this.id;
                const dirText = this.direction == "Row" ? " row" : "";                
                const menuElement = $(`<div class="cubicalMenu${dirText}" id="${menuId}"></div>`);
                
				for (var i = 0; i < this.menuItems.length; i++) {				
					if (this.menuItems[i] === '---') {
                        menuElement.append(`<div class="cubicalMenuSeparator"></div>`);
                    }
                    else {
                        const menuItem = this.menuItems[i].buildElement();
                        menuElement.append(menuItem);
                    }
				}
                
                this.menuElement = menuElement;
                $(this.container).html(this.menuElement);
                
                const p = this;
				$(`#${menuId}.cubicalMenu`).mouseout(function(e) {
					if (p.isSubmenuOpen() || p.isFixedOpen) return;
                    
                    p.setActiveItem(null);
					e.stopPropagation();
					return false;
				});
                
				$(`#${menuId}.cubicalMenu .cubicalMenuOption`).click(function(e) {
                    const id = parseInt(this.id);
                    const menuItem = p.getMenuItem(id);
                    
                    if (menuItem.subMenu == null) {
                        p.onOptionClick(this, e);
                        e.stopPropagation();
                        return false;
                    }
				});

				$(`#${menuId}.cubicalMenu .cubicalMenuOption`).mousedown(function(e) {
                    const id = parseInt(this.id);
                    const menuItem = p.getMenuItem(id);
                    
                    if (menuItem.subMenu != null) {
                        p.onOptionClick(this, e);
                    }
                    
                    e.stopPropagation();
                    return false;
				});
                
				$(`#${menuId}.cubicalMenu .cubicalMenuOption`).mousemove(function(e) {
					p.onMouseMove(this, e);
					e.stopPropagation();
					return false;
				});
                
                const separatorFn = (e) => {
                    e.stopImmediatePropagation();
                    return false;
                };
                
				$(`.cubicalMenu .cubicalMenuSeparator`).click(separatorFn).mousedown(separatorFn);
            }
            
            setParent(item) {
                this.parent = item;
            }
            
            getContainer() {
                return this.container;
            }
            
            addItem(item) {
                if (item === '---') {
                    this.menuItems.push(item);
                    return;
                }
                else if (!(item instanceof _cubical.UI.CubicalMenuOption)) {
                    item = new _cubical.UI.CubicalMenuOption(item);
                }
                
                item.setParent(this);
                this.menuItems.push(item);
                
                return this;
            }

            addItems(items) {
                for (const index in items) {
                  this.addItem(items[index]);
                }
                
                return this;
            }
            
            show(x = 0, y = 0) {
				if (!this.menuElement) this.build();
                this.updateMenuOptions();
                
                $(this.menuElement).css("left", 0).css("top", 0).show();
                
                // TODO: This still needs to be fixed to work properely for diff menu types
                
                // Move the menu around depending on the opening location, size and type (context vs menu)
                const rect = this.menuElement[0].getBoundingClientRect();
                if (x + rect.width > Game.canvas.width) {
                    x -= rect.width;
                }

                if (y + rect.height > Game.canvas.height) {
                    y -= rect.height;
                }
                
                $(this.menuElement).css("left", x + "px").css("top", y + "px").focus();
                this.isOpen = true;
                
                if (this.isRoot || (this.parent.parent.isRoot && this.parent.parent.isFixedOpen)) {
                    this.toggleInputCatcher(true);
                }
            }
            
            toggleInputCatcher(state) {
                $('.menuInputCatcher').remove();
                
                if (state) {
                    const inputCatcher = `<div class="menuInputCatcher" tabindex="-1"></div>`;
                    
                    if (this.isRoot) this.menuElement.before(inputCatcher);
                    else if (this.parent.parent.isRoot && this.parent.parent.isFixedOpen) this.parent.parent.menuElement.before(inputCatcher);
                    
                    $('.menuInputCatcher').focus();
                    this.updateListeners(true);
                }
            }
            
            onOptionClick(element, e) {
                const id = parseInt(element.id);
                const menuItem = this.getMenuItem(id);
                
                if (this.isFixedOpen && this.activeItem == menuItem) {
                    this.setActiveItem(null);
                }
                else {
                    this.setActiveItem(menuItem);
                    
                    if (menuItem.subMenu) this.openSubmenu(menuItem);
                    else {                        
                        if (menuItem.isDisabled) return;
                        
                        const shouldFinish = !menuItem.onClick();
                        if (shouldFinish) this.onFinish(menuItem);
                        
                        // console.log(`Selected option menu ${menuItem.getValue()}`);                    
                    }
                }
            }
            
            onMouseMove(element, e) {
                const id = parseInt(element.id);
                const menuItem = this.getMenuItem(id);
                
                if (!this.isFixedOpen || (this.isFixedOpen && this.activeItem != null)) {
                    if (this.activeItem != menuItem) {
                        this.setActiveItem(menuItem);
                    }
                }
            }
            
            setActiveItem(item) {
                if (this.activeItem == item) return;
                
                $(`#${this.id}.cubicalMenu div > .cubicalMenuOption.selected`).removeClass('selected');
                
                if (this.isSubmenuOpen()) this.closeSubmenus();
                this.activeItem = item;
                
                if (item != null) {
                    const itemId = item.id
                    $(`#${this.id}.cubicalMenu div > #${itemId}.cubicalMenuOption`).addClass('selected');
                
                    if (this.activeItem.subMenu) this.openSubmenu(this.activeItem);
                    
                    if (this.isRoot) {
                        this.updateListeners(true);
                    }
                }
            }
            
            onFinish(item) {
                if (this.callback) this.callback(item);
                if (item.stayOpen) this.updateMenuOptions();
                else this.close(true);
            }
            
            close(closeAll = false) {
                this.closeSubmenus();
                
                if (!this.isFixedOpen) {
                    $(this.menuElement).hide();
                }
                
                this.isOpen = false
                this.setActiveItem(null);
                
                if (closeAll && !this.isRoot) {
                    this.parent.parent.close(true);
                }
                
                if (this.isRoot) {
                    this.updateListeners(false);
                }
                
                if (this.isRoot || (this.parent.parent.isRoot && this.parent.parent.isFixedOpen)) {
                    this.toggleInputCatcher(false);
                }
            }
            
            openSubmenu(item) {
                if (item.subMenu instanceof _cubical.UI.CubicalMenu) {                    
                    
                    let parentOption = $(`.cubicalMenu #${item.id}.cubicalMenuOption`);
                    const rect = parentOption[0].getBoundingClientRect();
                    const useBottomOffset = parentOption.parent().parent().hasClass("row");
                    
                    if (!item.subMenu.container.parentNode) {
                        let container = $(`#cmc${item.subMenu.id}.cubicalMenuContainer`);
                        item.subMenu.container = container[0];
                    }
                
                    // Add 1px for outline
                    let x, y;
                    if (useBottomOffset) {
                        x = rect.left;
                        y = rect.bottom + 1;
                    }
                    else {
                        x = rect.right + 1;
                        y = rect.top;
                    }
                    
                    item.subMenu.show(x, y);
                }
            }
            
            updateListeners(state = true) {
                const p = this;

                if (state) {
                    
                    $("body").off('mousedown', ".menuInputCatcher");
                    $("body").off('keydown', ".menuInputCatcher");
                    
                    this.mouseDownListener = function(evt) {
                        p.mx = evt.clientX;
                        p.my = evt.clientY;
                        
                        const topElement = $(document.elementFromPoint(p.mx, p.my));
                        const isMenuElement = topElement.hasClass("cubicalMenu") || topElement.hasClass("cubicalMenuOption") || topElement.hasClass("cubicalMenuSeparator");
                        let isFromSameMenu = false;
                        
                        if (isMenuElement) {
                            
                        }
                        
                        if (!isMenuElement || (isMenuElement && !isFromSameMenu)) {
                            evt.stopImmediatePropagation();
                            evt.preventDefault();
                            p.close(true);

                            return false;
                        }
                    };

                    this.keyDownListener = function(evt) {
                        if (evt.keyCode == 27) {
                            evt.stopImmediatePropagation();
                            evt.preventDefault();
                            p.close(true);
                        }
                    };
                    
                    $("body").on('mousedown', ".menuInputCatcher", this.mouseDownListener);
                    $("body").on('keydown', ".menuInputCatcher", this.keyDownListener);
                }
                else {
                    $("body").off('mousedown', ".menuInputCatcher");
                    $("body").off('keydown', ".menuInputCatcher");
                }
            }
            
            isSubmenuOpen() {
                return (this.activeItem instanceof _cubical.UI.CubicalMenuOption
                    && this.activeItem.subMenu instanceof _cubical.UI.CubicalMenu);
            }
            
            closeSubmenus() {
                for (const index in this.menuItems) {
                    const menuItem = this.menuItems[index];
                    
                    if (menuItem instanceof _cubical.UI.CubicalMenuOption && menuItem.subMenu instanceof _cubical.UI.CubicalMenu) {
                        if (menuItem.subMenu.isOpen) {
                            menuItem.subMenu.close();
                        }
                    }
                }
            }
            
            getMenuItem(id) {
                const items = this.menuItems;
                for (const index in items) {
                    if (items[index].id == id) return items[index];
                }
                
                return null;
            }
            
            getMenuItemFromOptionId(id) {
                const items = this.menuItems;
                for (const index in items) {
                    if (items[index].optionId == id) return items[index];
                }
                
                return null;
            }

            updateMenuOptions() {
				for (var i = 0; i < this.menuItems.length; i++) {				
					if (this.menuItems[i] !== '---') {
                        this.menuItems[i].onUpdate();
                    }
				}
            }

            static getMenuById(id) {
                const menu = $(`#${id}.cubicalMenu`);
                return menu.length > 0 ? menu[0] : null;
            }

            static _init() {
                CubicalMenu._NEXT_ID = 0;
                CubicalMenu._LEFT_ARROW = "◄";
                CubicalMenu._RIGHT_ARROW = "►";
                CubicalMenu._UP_ARROW = "▲";
                CubicalMenu._DOWN_ARROW = "▼";
            }            
        }
        
        this.CubicalMenuOption = class CubicalMenuOption {
            constructor(val, optionId = null, subMenu = null, props = {}) {
                this.id = CubicalMenuOption._NEXT_ID++;
                this.value = val;
                if (subMenu) this.setSubMenu(subMenu); 
                this.parent = null;
                this.element = null;
                this.container = document.createElement('div'); 
                this.container.id = `cmoc${this.id}`;
                this.container.className = 'cubicalMenuOptionContainer';
                this.optionId = optionId ? optionId : val;
                
                this.isDisabled = props.disabled === true;
                this.isChecked = props.checked === true;
                this.disableClickClose = (props.disableClickClose === true || this.isDisabled);
                this.callback = props.callback ? props.callback : null;
                this.onUpdateLabel = props.onUpdateLabel ? props.onUpdateLabel : null;
                this.onUpdateDisabledState = props.onUpdateDisabledState ? props.onUpdateDisabledState : null;
                this.onUpdateCheckedState = props.onUpdateCheckedState ? props.onUpdateCheckedState : null;
                this.checkbox = props.checkbox === true;
                this.stayOpen = props.stayOpen === true || (props.checkbox === true && props.stayOpen !== false);
            }
            
            buildElement(parent = null) {
                if (parent) this.setParent(parent); 

                const labelElement = `<div class="cubicalMenuLabel">${this.value}</div>`;

                let element = '';
                if (!this.parent.isFixedOpen) {
                    element += `<div class="cubicalMenuIcon ${this.optionId}"></div>`;
                }
                
                if (this.subMenu != null) {
                    element += `<div class="cubicalMenuExpandIcon"></div><div id="cmc${this.subMenu.id}" class="cubicalMenuContainer"></div>`;
                }
                
                this.element = $(`<div class="cubicalMenuOption" id="${this.id}">${labelElement}${element}</div>`);
                $(this.container).html(this.element);
                
                return this.container;
            }
            
            onClick() {
                if (this.callback) {
                    const p = this;
                    const cb = this.callback.bind(p);
                    const retVal = cb(p);
                    return (retVal === true);
                }
                
                return false;
            }
            
            getValue() {
                return this.value;
            }
            
            getContainer() {
                return this.container;
            }
            
            onUpdate() {
                this.updateLabel();
                this.updateDisabledState();  
                this.updateCheckedState();                
            }
            
            updateLabel() {
                if (!this.onUpdateLabel) return;
                
                const labelText = this.onUpdateLabel();
                this.setLabelText(labelText);
            }
            
            updateDisabledState() {
                if (!this.onUpdateDisabledState) return;
                
                const state = this.onUpdateDisabledState();
                this.setDisabledState(state);
            }
            
            updateCheckedState() {
                if (!this.onUpdateCheckedState) return;
                
                const state = this.onUpdateCheckedState();
                this.setCheckedState(state);
            }
            
            setLabelText(text) {
                if (!this.element) return;
                
                this.element.find(".cubicalMenuLabel").html(text);
            }
            
            setDisabledState(state) {
                this.isDisabled = state;
                
                if (!this.element) return;
                
                if (state) this.element.addClass("disabled");
                else this.element.removeClass("disabled");
            }
            
            setCheckedState(state) {
                this.isChecked = state;
                
                if (!this.element) return;
                
                if (state) {
                    this.element.addClass("checked").removeClass("unchecked");
                }
                else {
                    this.element.addClass("unchecked").removeClass("checked");
                }
            }

            setParent(menu) {
                this.parent = menu;
            }
            
            setSubMenu(menu) {
                this.subMenu = menu;
                this.subMenu.parent = this;
            }
            
            static _init() {
                CubicalMenuOption._NEXT_ID = 0;
            }
        }
    
        this.AdManager = class AdManager {
            constructor(workspaceElement) {
                this.workspaceElement = workspaceElement;
                this.rightContainerElement = null;
                this.bottomContainerElement = null;
                this.isReady = false;
                this.isActive = true;
                this.firstAdDelayTime = 10 * 1000;
                this.defaultAdIntervalTime = 3 * 60 * 1000;
                this.adDisplayTime = 18 * 1000;
                this.adRefreshTime = 6 * 1000;
                this.totalAdsServed = 0;
                this.lastWorkspsaceWidth = 0;
                this.lastWorkspsaceHeight = 0;
                
                this.startTime = new Date().getTime();
                this.lastAdTime = -1;
                this.nextAdTime = -1;
                this.updateTime = -1;
                this.refreshTime = -1;
                
                this.isCurrentlyDisplayingAd = false;
                this.currentAdStartTime = -1;
                this.currentAdStopTime = -1;
                this.currentAdElement = null;
                this.currentAdContainer = null;
                this.currentAdPosition = '';
                
                AdManager.setInstance(this);
                
                requestAnimationFrame(AdManager.boundUpdate);
            }
            initialize() {
                this.rightContainerElement = this.constructor.createContainerElement("right");
                this.bottomContainerElement = this.constructor.createContainerElement("bottom");
                
                this.workspaceElement.parentElement.appendChild(this.rightContainerElement);
                this.workspaceElement.parentElement.appendChild(this.bottomContainerElement);
                
                this.isReady = true;
            }
            update() {
                if (AdManager.hasAdBlock) return;
                if (!this.isReady) this.initialize();
                
                const now = new Date().getTime();
                if (this.updateTime < now && !this.isActive) return;              
                
                if (this.nextAdTime === -1) this.nextAdTime = now + this.firstAdDelayTime;
                
                if (this.isCurrentlyDisplayingAd) {
                    if (now >= this.currentAdStopTime) this.stopAd();
                    else this.updateAd();                    
                }
                else {
                    if (now < this.updateTime) {
                        this.updateAd()
                    }
                    else if (now > this.nextAdTime) {
                        this.startAd();
                    }
                }
                
                requestAnimationFrame(AdManager.boundUpdate);
            }
            startAd() {
                const now = new Date().getTime();
                
                this.isCurrentlyDisplayingAd = true;
                this.currentAdStartTime = now;
                this.currentAdStopTime = now + this.adDisplayTime;
                this.currentAdRefreshTime = now + this.adRefreshTime;
                
                this.showAd();
            }
            stopAd() {
                this.isCurrentlyDisplayingAd = false;
                
                const now = new Date().getTime();
                this.lastAdTime = now;
                this.nextAdTime = now + this.defaultAdIntervalTime;
                this.updateTime = now + 2000;
                
                this.hideAd();
            }
            showAd() {
                this.createAd('bottom');
                
                this.setAdEdgeSize(this.currentAdPosition, -1);
            }
            hideAd() {
                this.setAdEdgeSize(this.currentAdPosition, 0);
                var container = this.currentAdContainer;
                
                setTimeout(() => {
                    container.innerHTML = '';
                }, 1000);
            }
            updateAd() {
                const now = new Date().getTime();
               
                if (now > this.currentAdRefreshTime && now < this.currentAdStopTime) {
                    this.currentAdRefreshTime = now + this.adRefreshTime;
                    this.currentAdContainer.innerHTML = '';
                    this.createAd('bottom');
                }
            }
            createAd(side) {
                
                const elementList = [];
                let adElement, containerElement;
                
                if (side == 'bottom') {
                    containerElement = this.bottomContainerElement;
                    containerElement.style.transform = 'translateY(0px)';
                    
                    const containerWidth = this.workspaceElement.clientWidth;
                    let adName;
                    let totalAds = 1;
                    
                    if (containerWidth > 970 * 2) {
                        adName = 'bottom_970x90';
                        totalAds = 2;
                    }
                    else if (containerWidth > 728 * 2) {
                        adName = 'bottom_728x90';
                        totalAds = 2;
                    }
                    else if (containerWidth > 970) {
                        adName = 'bottom_970x90';
                    }
                    else if (containerWidth > 400 * 2) {
                        adName = 'bottom_468x90';
                        totalAds = 2;
                    }
                    else if (containerWidth > 728) {
                        adName = 'bottom_728x90';
                    }
                    else if (containerWidth > 468) {
                        adName = 'bottom_468x90';
                    }
                    else {
                        adName = 'bottom_300x100';
                    }
                    
                    for (let i = 0; i < totalAds; i++) {
                        adElement = this.constructor.createNamedAdElement(adName);
                        elementList.push(adElement);
                    }
                }
                else if (side === 'right') {
                    adElement = this.constructor.createRightAdElement();
                    elementList.push(adElement);
                    
                    containerElement = this.rightContainerElement;
                    containerElement.style.transform = 'translateX(0px)';
                }
                
                this.currentAdElement = adElement;
                this.currentAdContainer = containerElement;
                this.currentAdPosition = side;
                
                for (let i = 0; i < elementList.length; i++) {
                    this.currentAdContainer.appendChild(elementList[i]);
                    this.totalAdsServed++;
                }
            }
            setAdEdgeSize(side, offset) {
                
                if (side === 'bottom') {
                    let opposite = offset === -1 ? 0 : 90;
                    offset = offset === -1 ? 90 : 0;
                    
                    this.currentAdContainer.style.transition = 'transform 1s ease 0s;';
                    this.currentAdContainer.style.transform = `translateY(${opposite}px)`;
                    this.workspaceElement.style.transition = 'bottom 1s ease 0s';
                    this.workspaceElement.style.bottom = `${offset}px`;
                }
                else if (side === 'right') {
                    let opposite = offset === -1 ? 0 : 150;
                    offset = offset === -1 ? 150 : 0;
                    
                    this.currentAdContainer.style.transition = 'transform 1s ease 0s;';
                    this.currentAdContainer.style.transform = `translateX(${opposite}px)`;
                    this.workspaceElement.style.transition = 'right 1s ease 0s;';
                    this.workspaceElement.style.right = `${offset}px`;
                }
            }
        
            static async testAdBlock() {
                const cssStyle = 'position: fixed; display: block; left: 0; top: 0; width: 300px; height: 50px; transform: translateY(-100px)';
                const body = document.getElementsByTagName('body')[0];
                const testAd = this.createAdElement(this.adList['bottom_300x100'].id, cssStyle);
                body.appendChild(testAd);
                
                const testPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        const adBlocked = (testAd.childNodes[0].clientWidth == 0 || testAd.childNodes[0].clientHeight == 0);
                        testAd.remove();
                        resolve(adBlocked);
                    }, 3000);
                })
                
                return await testPromise;
            }
            static createContainerElement(side) {
                const element = document.createElement('div');
                element.className = `googleAdContainer ${side}`;
                
                return element;
            }
            static setInstance(instance) {
                this.instance = instance;
                this.boundUpdate = instance.update.bind(instance);
                
                this.testAdBlock().then((result) => {
                    this.hasAdBlock = result;
                });
            }
            static getInstance() {
                return this.instance;
            }
            static createNamedAdElement(adName) {
                
                const adInfo = this.adList[adName];
                if (!adInfo) throw new Error(`Unable to find ad element with name "${adName}"`);

                const cssStyle = `display:inline-block;width:${adInfo.width}px;height:${adInfo.height}px`;
                const adElement = this.createAdElement(adInfo.id, cssStyle);
                
                return adElement;
            }
            static createAdElement(adSlotId, cssStyle) {

                const adContainer = document.createElement('div');
                adContainer.className = 'editorAdContainer';

                // Create and append the ad container
                const adIns = document.createElement('ins');
                adIns.className = 'adsbygoogle';
                adIns.style.cssText = cssStyle;
                adIns.setAttribute('data-ad-client', 'ca-pub-7913661168021418');
                adIns.setAttribute('data-ad-slot', adSlotId);
                adContainer.appendChild(adIns);

                // Create and append the Google Ads script
                const adScript = document.createElement('script');
                adScript.async = true;
                adScript.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7913661168021418';
                adScript.setAttribute('crossorigin', 'anonymous');
                adContainer.appendChild(adScript);

                // Initialize the ad
                adScript.onload = function() {
                    (adsbygoogle = window.adsbygoogle || []).push({});
                };
                
                return adContainer;
            }
            static _init() {
                this.instance = null;
                this.boundUpdate = null;
                this.hasAdBlock = false;
                
                this.adList = {
                    'bottom_728x90': {width: 728, height: 90, id: 2948504378},
                    'bottom_970x90': {width: 970, height: 90, id: 4672649584},
                    'bottom_468x90': {width: 468, height: 90, id: 2046486245},
                    'bottom_300x50': {width: 300, height: 50, id: 8548315411},
                    'bottom_300x100': {width: 300, height: 100, id: 8715103858}
                }
            }
        }

    });
    
    // Add class statics by checking all the group objects and running _init on any classes within
    (function(root) {
        const initGroupClasses = (groupObj) => {
            for (let key in groupObj) {
                const obj = groupObj[key];
                if (typeof obj !== "object" && typeof obj !== "function") continue;
                
                if (obj._group === true) {
                    initGroupClasses(obj);
                }
                else if (typeof obj._init === "function") {
                    obj._init();
                }
            }
        };
        
        initGroupClasses(root);
    })(this);
});

_window.Minecraft = {};

Minecraft.util = {
	color: {
		changeHue(rgb, degree) {
			var hsl = this.rgbToHSL(rgb);
			hsl.h += degree;
			if (hsl.h > 360) {
				hsl.h -= 360;
			} else if (hsl.h < 0) {
				hsl.h += 360;
			}
			return this.hslToRGB(hsl);
		},

		// exepcts a string and returns an object
		rgbToHSL(rgb) {
			// strip the leading # if it's there
			rgb = rgb.replace(/^\s*#|\s*$/g, '');

			// convert 3 char codes --> 6, e.g. `E0F` --> `EE00FF`
			if (rgb.length == 3) {
				rgb = rgb.replace(/(.)/g, '$1$1');
			}

			var r = parseInt(rgb.substr(0, 2), 16) / 255,
			g = parseInt(rgb.substr(2, 2), 16) / 255,
			b = parseInt(rgb.substr(4, 2), 16) / 255,
			cMax = Math.max(r, g, b),
			cMin = Math.min(r, g, b),
			delta = cMax - cMin,
			l = (cMax + cMin) / 2,
			h = 0,
			s = 0;

			if (delta == 0) {
				h = 0;
			} else if (cMax == r) {
				h = 60 * (((g - b) / delta) % 6);
			} else if (cMax == g) {
				h = 60 * (((b - r) / delta) + 2);
			} else {
				h = 60 * (((r - g) / delta) + 4);
			}

			if (delta == 0) {
				s = 0;
			} else {
				s = (delta / (1 - Math.abs(2 * l - 1)))
			}

			return {
				h : h,
				s : s,
				l : l
			}
		},

		// expects an object and returns a string
		hslToRGB(hsl) {
			var h = hsl.h,
			s = hsl.s,
			l = hsl.l,
			c = (1 - Math.abs(2 * l - 1)) * s,
			x = c * (1 - Math.abs((h / 60) % 2 - 1)),
			m = l - c / 2,
			r,
			g,
			b;

			if (h < 60) {
				r = c;
				g = x;
				b = 0;
			} else if (h < 120) {
				r = x;
				g = c;
				b = 0;
			} else if (h < 180) {
				r = 0;
				g = c;
				b = x;
			} else if (h < 240) {
				r = 0;
				g = x;
				b = c;
			} else if (h < 300) {
				r = x;
				g = 0;
				b = c;
			} else {
				r = c;
				g = 0;
				b = x;
			}

			r = this.normalize_rgb_value(r, m);
			g = this.normalize_rgb_value(g, m);
			b = this.normalize_rgb_value(b, m);

			return this.rgbToHex(r, g, b);
		},

		normalize_rgb_value(color, m) {
			color = Math.floor((color + m) * 255);
			if (color < 0) {
				color = 0;
			}
			return color;
		},

		rgbToHex(r, g, b) {
			return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
		}
	},
	hexToByte(val) {
		return parseInt(val, 16);
	},
	byteToHex(val) {
		var hex = Math.floor(val).toString(16);
		return (hex.length == 1 ? "0" + hex : hex);	
	},	
	hexStrToByteArr(hexStr) {

		var bArray = new Uint8Array(hexStr.length / 2);
		for (var i = 0; i < bArray.length; i++) {
			bArray[i] = this.hexToByte(hexStr[i*2] + hexStr[i*2+1]);
		}
		return bArray;
	
	},
	byteArrToHexStr(byteArr) {
		var hexStr = "";

		for (var i = 0; i < byteArr.length; i++) {
			hexStr += this.byteToHex(byteArr[i]);
		}
		return hexStr;
	},
	byteArrToStr(byteArr) {
		var str = "";

		for (var i = 0; i < byteArr.length; i++) {
			str += String.fromCharCode(Math.floor(byteArr[i]));
		}
		return str;
	},
	byteArrToBase64(byteArr) {
		let binary = '';
		const len = byteArr.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(byteArr[i]);
		}
		return _window.btoa(binary);
	},
	strToByteArr(hexStr) {
		var bArray = new Uint8Array(hexStr.length);
		for (var i = 0; i < hexStr.length; i++) {
			bArray[i] = hexStr.charCodeAt(i);
		}
		return bArray;
	},
	base64ToBlob(dataURI, mimetype) {
		var byteString = atob(dataURI.split(',')[1]);
		var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0]

		var ab = new ArrayBuffer(byteString.length);
		var ia = new Uint8Array(ab);
		for (var i = 0; i < byteString.length; i++) {
			ia[i] = byteString.charCodeAt(i);
		}

		var bb = new Blob([ab], {type:mimetype});
		return bb;
	},
	strToHex(str) {
		var hex = '';
		for(var i = 0;i<str.length;i++) {
			hex += ''+ str.charCodeAt(i).toString(16);
		}
		return hex;			
	},
	numToShortHex(val) {
		var hex = this.byteToHex(val);
		var cnt = 4- hex.length;
		for (var i = 0; i < cnt; i++) hex = "0" + hex;
		
		return hex;
	},
	numToIntHex(val) {
		var hex = this.byteToHex(val);
		var cnt = 8- hex.length;
		for (var i = 0; i < cnt; i++) hex = "0" + hex;
		
		return hex;	
	},
	longToBytes(val) {
		var bytes = new Uint8Array(8);
		for ( var i = 0; i < bytes.length; i ++ ) {
			var b = val & 0xff;
			bytes [i] = b;
			val = (val - b) / 256 ;
		}
		return bytes;
	},
	bytesToLong(bytes) {
		var ret = 0;
		for (var i = bytes.length - 1; i >= 0; i--) {
			ret = (ret * 256) + bytes[i];
		}
		return ret;
	},
	gzipCompress(byteArr) {
        return pako.gzip(byteArr);
	},
	gzipDecompress(byteArr) {
        return pako.ungzip(byteArr);
	},
	saveBlob(blob, fileName, isURL = false) {
		// modified from
		// http://stackoverflow.com/questions/19327749/javascript-blob-filename-without-link
		
		var a = document.createElement("a");
		a.style.display = "none";
		document.body.appendChild(a);

		var url;
		if (!isURL) url = _window.URL.createObjectURL(blob);
		else url = blob;
		
		a.href = url;
		a.download = fileName;
		a.click();
		_window.URL.revokeObjectURL(url);

	},
	objectToByteArr(obj, zip) {
		var dataStr = JSON.stringify(obj);
		var dataBytes = this.strToByteArr(dataStr);
		
		if (!zip) return dataBytes;
		return this.gzipCompress(dataBytes);
	},
	byteArrToObject(bytes, unzip) {
		
		if (unzip) bytes = this.gzipDecompress(bytes);
		var dataStr = this.byteArrToStr(bytes);
		return JSON.parse(dataStr);
	},
	copyObject(obj) {
		return JSON.parse(JSON.stringify(obj));
	},
	copyStringToClipboard(str) {
	   const element = document.createElement('input');

	   element.value = str;
	   element.setAttribute('type', 'text');
	   element.style = {position: 'absolute', left: '-9999px'};
	   document.body.appendChild(element);
	   element.select();

	   document.execCommand('copy');
	   document.body.removeChild(element);
	},
	getClipboardText() {
	   return navigator.clipboard.readText();
	},
	setClipboardText(text) {
       navigator.clipboard.writeText(text);
	},
    loadFont(name, url) {
		if (!name) name = "Tahoma";		
		var newStyle = document.createElement('style');
		
		if (url) {
			newStyle.appendChild(document.createTextNode("\
			@font-face {\
				font-family: '" + name + "';\
				src: url('" + url + "') format(yourFontFormat);\
			}\
			"));
		}
		else {
			newStyle.appendChild(document.createTextNode("\
			@font-face {\
				font-family: '" + name + "';\
				src: '" + name + "';\
			}\
			"));
		}		

		document.head.appendChild(newStyle);	
	},
	parseBlock(str) {
		str = String(str).replace(".", ":");
		
		var cpos = str.indexOf(":");
		
		if (cpos === -1) {
			if (isNaN(parseInt(str)) === false) {
				return {id: parseInt(str), data: 0};
			}
			else {
                return Minecraft.Blocks.getBlockFromName(str);
			}
		}
		var blockId = parseInt(str.slice(0, cpos));
		var blockData = parseInt(str.slice(cpos+1));					

		if (isNaN(blockData)) blockData = 0;
		if (isNaN(blockId)) return null;
		if (blockId < 0 || blockData < 0) return null;
		
		return {id: blockId, data: blockData};
	},
	parseVector(blockStr) {

		blockStr = blockStr.replace(/["'\(\)]/g, "");
		var pos = blockStr.indexOf(",", 0);
		var pos2 = blockStr.indexOf(",", pos+1);
		
		var dx = Math.floor(blockStr.slice(0, pos));
		var dy = Math.floor(blockStr.slice(pos+1, pos2));
		var dz = Math.floor(blockStr.slice(pos2+1));
		var vec = {};
		vec.x = dx;
		vec.y = dy;
		vec.z = dz;
		
		return vec;;
	},
	blockToStr(block, forceData) {
		return String(block.id + ((block.data > 0 || forceData == true) ? (":" + block.data) : ""));
	},
	lengthSq(x,y,z) {
		return ((x * x) + (y * y) + (z * z));
	},
	rotateVec(origin, vec, angle) {
		var s = Math.sin(angle * (Math.PI/180));
		var c = Math.cos(angle * (Math.PI/180));
		
		return {
			x: (((vec.x - origin.x) * c - (vec.y - origin.y) * s) + origin.x),
			y: (((vec.x - origin.x) * s + (vec.y - origin.y) * c) + origin.y)
		};
	},
    getAngle(ax, ay, bx, by) {
        const mag = Math.sqrt(ax * ax + ay * ay) * Math.sqrt(bx * bx + by * by);
        const cos = mag && ((ax * bx + ay * by) / mag);
        return Math.acos(Math.min(Math.max(cos, -1), 1));
    },
	getDistance(ax,ay,az,bx,by,bz) {
		return (Math.sqrt(
			((ax-bx)*(ax-bx)) + 
			((ay-by)*(ay-by)) +
			((az-bz)*(az-bz))
		));
	},
	intNoise(seed) {
		// from http://freespace.virgin.net/hugo.elias/models/m_perlin.htm
		// returns floating point numbers between -1.0 and 1.0.
		seed = (seed<<13) ^ seed;
		return ( 1.0 - ( (seed * (seed * seed * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);    
	},
	cropImage(img, x, y, width, height) {
		return new Promise((resolve, reject) => {
            if (!(img instanceof Image)) {
                reject("invalid image");
                return;
            }
            
            const cvs = document.createElement('canvas');			
            const ctx = cvs.getContext("2d");
            
            cvs.width = width;
            cvs.height = height;
            ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
            
            // var imgData = ctx.getImageData(0,0,img.width,img.height).data;
            
            const croppedImg = new Image();
            croppedImg.src = cvs.toDataURL("image/png");
            
            croppedImg.onload = () => {
                resolve(croppedImg);
            }
        });
    },
    scaleImage(img, scale) {
		
		var cvs = document.createElement('canvas');			
		var ctx = cvs.getContext("2d");
		
		cvs.width = img.width;
		cvs.height = img.height;
		ctx.drawImage(img,0,0,img.width,img.height);
		
		var imgData = ctx.getImageData(0,0,img.width,img.height).data;

		cvs.width = img.width * scale;
		cvs.height = img.height * scale;

		if(scale > 1) {
			//hard way to upscale image without blur
			for (var x = 0; x < img.width; ++x) {
				for (var y = 0 ; y < img.height; ++y) {
					var i = (y * img.width + x) * 4;
					var r = imgData[i];
					var g = imgData[i + 1];
					var b = imgData[i + 2];
					var a = imgData[i + 3];
					ctx.fillStyle = "rgba(" + r + ", " + g + ", " + b + ", " + (a / 255) + ")";
					ctx.fillRect(x * scale, y * scale, scale, scale);
				}
			}
		}
		else {
			ctx.drawImage(img,0,0,img.width,img.height,0,0,img.width*scale, img.height*scale);
		}

		var scaledImg = new Image();
		scaledImg.src = cvs.toDataURL("image/png");
		return scaledImg;
		
	},
    generateTilesetMipmaps(img, size, levels = -1) {
        return new Promise((resolve, reject) => {
            const imgSize = img.width;

            const xTotal = imgSize / size;
            const yTotal = imgSize / size;

            const cvs = [];
            const ctx = [];
            const imgs = [];

            for (let i = 0; i <= levels; i++) {

                const cWidth = img.width / Math.pow(2, i);
                const cHeight = img.height / Math.pow(2, i);

                cvs[i] = new OffscreenCanvas(cWidth, cHeight);			
                ctx[i] = cvs[i].getContext("2d");
                imgs[i] = new Image();
            }

            ctx[0].drawImage(img,0,0,img.width,img.height);

            let tx,ty,sx,sy,sh,sw,ii,scale, lastScale;

            for (let x = 0; x < xTotal; x++) {
                tx = x * size;
                
                for (let y = 0; y < yTotal; y++) {
                    ty = y * size;
                    
                    for (let i = 0; i <= levels; i++) {
                        ii = Math.pow(2, i);
                        scale = 1 / ii;
                        lastScale = 1 / Math.pow(2, i-1);
                        sh = sw = size / ii;
                        sx = tx * scale;
                        sy = ty * scale;

                        if (i == 0) ctx[i].drawImage(img,tx,ty,size,size,sx,sy,sw,sh);
                        else {
                            ctx[i].drawImage(cvs[i-1],tx*lastScale,ty*lastScale,size*lastScale,size*lastScale,sx,sy,sw,sh);
                        }
                    }
                }
            }

            let returnCount = 0;
            const images = [];

            const sizes = {};
            let levelSize = imgSize;
            for (let i = 0; i <= levels; i++) {
                sizes[`${levelSize}`] = i;
                levelSize *= .5;
            }

            for (let i = 0; i <= levels; i++) {

                cvs[i].convertToBlob().then(function(blob) {
                    const objurl = window.URL.createObjectURL(blob);                  
                    const img = new Image();
                    
                    img.onload = function() {
                        returnCount++;
                        
                        const size = img.width;
                        images[sizes[size]] = img;
                        
                        if (returnCount == levels + 1) {
                            resolve(images);
                        }
                    }
                    
                    img.src = objurl;
                });
            }
        });
    },
    
    loadParams(params, defParams) {
		var par = {};
		params = typeof params === 'undefined' ? {} : params;
		for (var i in defParams) par[i] = typeof params[i] === 'undefined' ? defParams[i] : params[i];
		return par;
	},
	rangeSize(par) {
		var range = typeof par.range === 'undefined' ? 0 : parseInt(par.range);
		range = range < 0 ? (Math.abs(par.range) * .01 * par.size) : par.range;
		
		var size = typeof par.size === 'undefined' ? 10 : parseInt(par.size);
		return parseInt(size + (range * Math.random()));
	},
	getRandomXZVec() {

		var rngVec;
		var rng = Math.random();

		if (rng > 0 && rng < .25) rngVec = [1,0,0];
		else if (rng >= .25 && rng < .5) rngVec = [-1,0,0];
		else if (rng >= .5 && rng < .75) rngVec = [0,0,1];
		else if (rng >= .75 && rng < 1) rngVec = [0,0,-1];
		
		return rngVec;
	},
	getRandomXZSide(vec) {

		var rngVec;
		var rng = Math.random();
		var rngB = Math.random();
		
		if(vec[0] == 0) rngVec = (rng > 0 && rng < .5) ? [rngB,0,0] : [-(rngB),0,0];
		else rngVec = (rng > 0 && rng < .5) ? [0,0,rngB] : [0,0,-(rngB)];

		return rngVec;
	},		
	getRandomColor() {
		//
		
		var clr = [];			
		var ri = Math.floor(Math.random() * 256);			
		var rc = Math.floor(Math.random() * 6);
		
		if (rc == 0) clr = [255,0,ri];
		else if (rc == 1) clr = [255,ri,0];
		else if (rc == 2) clr = [0,255,ri];
		else if (rc == 3) clr = [ri,255,0];
		else if (rc == 4) clr = [0,ri,255];
		else if (rc == 5) clr = [ri,0,255];			
		
		return clr;
		
	},
	rgbStringtoArray(clrStr, shrink) {
		var clrArr = clrStr.split("(")[1].split(")")[0].split(",");
		clrArr[0] = parseInt(clrArr[0]) / (shrink ? 256 : 1);
		clrArr[1] = parseInt(clrArr[1]) / (shrink ? 256 : 1);
		clrArr[2] = parseInt(clrArr[2]) / (shrink ? 256 : 1);
		clrArr[3] = 1;
		return clrArr;
	},

	lerp(a, b, t) {
		return a + (b - a) * t;
	},
	slerp(a, b, t) {
		return this.lerp(a, b, this.getSlerpRatio(t));
	},
	getSlerpRatio(t) {
		return (Math.sin(t * Math.PI - Math.PI / 2) + 1) / 2;
	},
	createGUID() {
		return (
			'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			let r = Math.random() * 16 | 0,
			v = c == 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		}));
	},
	createTextImage(args) {
		
		args = {
			text: args.text || "Lorem ipsum dolor sit amet, consectetur adipiscing elit. \nDonec vitae placerat lectus. Curabitur nisi mi, laoreet pulvinar\n est quis, finibus imperdiet risus. Donec maximus tempus dolor,\n mollis ultrices lectus efficitur a. Donec nisi nisi, \nvehicula at consequat non, iaculis eu metus. \n\nPellentesque ut nunc nec augue finibus hendrerit et a tortor. \nQuisque eget magna consectetur turpis euismod maximus viverra a sapien",
			size: args.size || 32,
			font: args.font || "Open Sans",
			align: args.align || "center",
			spacing: args.spacing || 1,
			threshold: args.threshold || 64,
			texture: args.texture || true,
			padding: args.padding || 12,
            sign: args.sign || false,
            lockHeight: args.lockHeight || -1
		};
	
		
		var textArr = String(args.text).split("\n");
		var lineCnt = textArr.length;
		
		var cvs = document.createElement('canvas');
		var ctx = cvs.getContext("2d");
		
		ctx.font = args.size + 'pt ' + args.font;	
		ctx.textAlign = args.align;
		ctx.textBaseline = 'top'; 
	
		
		var lineSpaceMod = .75;
		
		var padding = Math.floor(args.size * .5);
		var width = cvs.width = Math.floor(ctx.measureText(args.text).width + padding*2);
		
		var lineSpacing = parseInt((args.size + args.size) * args.spacing * lineSpaceMod) ;
		
		var heightGap = 0;
		var offsetGap = 0;
		
		while (heightGap < 10) {
	
			var height = cvs.height = ((lineSpacing + 4) * lineCnt) + offsetGap;

			ctx.font = args.size + 'pt ' + args.font;	
			ctx.textAlign = args.align;
			ctx.textBaseline = 'top';
            ctx.translate(.5, .5);            
            
            if (!args.sign) {
                ctx.imageSmoothingEnabled = true;
                
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#000'; 
                ctx.shadowOffsetX = 5;
                ctx.shadowOffsetY = 5;
                
                ctx.strokeStyle = '#000';
                ctx.fillStyle = '#fff';
                ctx.globalAlpha = 1;
            }
            else {
                ctx.fillStyle = '#000';
                ctx.globalAlpha = 1;
            }
			
			var txtPos = args.align == 'left' ? 0 : (args.align == 'center' ? width/2 : width);
			
			// create text for each line
			for (var i = 0; i < lineCnt; i++) {
				if (!args.sign) ctx.strokeText(textArr[i], txtPos, i * lineSpacing);
				ctx.fillText(textArr[i], txtPos, i * lineSpacing);
			}
			
			var imageData = ctx.getImageData(0, 0, width, height);
			
			var minX = -1,
				minY = -1,
				maxX = -1,
				maxY = -1,
				minWidth = -1,
				minHeight = -1;
			
			for (var x = 0; x < width; x++) {
				for (var y = height-1; y >= 0; y--) {
					if ((imageData.data[((width * y) + x) * 4 + 3]) > args.threshold) {
						if (minX == -1 || x < minX) minX = x;
						if (minY == -1 || y < minY) minY = y;
						if (maxX == -1 || x > maxX) maxX = x;
						if (maxY == -1 || y > maxY) maxY = y;
					}
				}
			}	
			
			minWidth = maxX - minX;
			minHeight = args.lockHeight == -1 ? maxY - minY : args.lockHeight;
			
			offsetGap += 25;
			heightGap = height - maxY;
		}
		
		imageData = ctx.getImageData(minX, minY, minWidth+2, minHeight+2);

		width = cvs.width = minWidth + 4 + (args.padding * 2);
		height = cvs.height = minHeight + 4 + (args.padding * 2);
		
		ctx.globalAlpha = 1;
		ctx.putImageData(imageData,4 + args.padding,4 + args.padding);

        if (!args.sign) {
            ctx.fillStyle = '#000';
            ctx.strokeStyle = '#000';
            ctx.strokeRect(2,2,width-3, height-3);
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(1,1,width-3, height-3);
            
            ctx.globalAlpha = .5;
            ctx.globalCompositeOperation = "destination-over"; // next operations drawn behind what is already there
            ctx.fillRect(0,0,width-2, height-2);
        }
		
		if (args.texture) {
			
			var texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cvs);
			
            if (args.sign) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			}
            
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			
			return {texture, width, height};
		}
		else {
			imageData = ctx.getImageData(0,0, width, height);
			return imageData;
		}
	},

	getPlaneIntersection(startPos, dirPos, planePos) {
		let scaleX = 1;
		let scaleY = 1;
		let scaleZ = 1;

		if (planePos[0] != null) scaleX = (startPos[0] - planePos[0]) / -dirPos[0];
		else if (planePos[1] != null) scaleY = (startPos[1] - planePos[1]) / -dirPos[1];
		else if (planePos[2] != null) scaleZ = (startPos[2] - planePos[2]) / -dirPos[2];

		let m = [-dirPos[0] * scaleX, -dirPos[1] * scaleY, -dirPos[2] * scaleZ];
		return [startPos[0] - m[0], startPos[1] - m[1], startPos[2] - m[2]];
	},
	rayTrace(shape,x,y,z,dx,dy,dz,maxDistance = 250) {

		const sz = shape.getSize();        
		let boxes, hit, xi, yi, zi, id, data;
		let pos = [x, y, z];
		let count = 0;
        const directionDistance = Minecraft.util.getDistance(x,y,z, pos[0], pos[1], pos[2]);
        const maxDistanceCount = Math.floor(maxDistance / directionDistance) + 1;
        
		while (count < maxDistanceCount && count < 5000) {
			
			count++

			if (count == 1) hit = [[x, y, z], [0,0,0]];
			else hit = this.getNextBoxIntersection(pos[0], pos[1], pos[2], dx, dy, dz);
			
			pos = hit[0];
			
			xi = Math.floor(pos[0]) - (hit[1][0] > 0 ? 1 : 0);
			yi = Math.floor(pos[1]) - (hit[1][1] > 0 ? 1 : 0);
			zi = Math.floor(pos[2]) - (hit[1][2] > 0 ? 1 : 0);
            
            // Hacky way of allowing the player to set blocks off of the y = 0 plane
			if (yi == -1 && xi >= 0 && xi < sz.x && zi >= 0 && zi < sz.z) {
                id = 1;
                data = 8;
            }
            else {
                id = shape.getBlockId(xi, yi, zi);
                if (!(id > 0)) continue;
            
                data = shape.getBlockData(xi, yi, zi);
            }
            
            let boxHit = null;
            let boxData = null;
            let distance = 0;
			
			boxes = Minecraft.Blocks.getBoundingBox(xi, yi, zi, id, data);
			for (let j = 0 ; j < boxes.length; j++) {
				
				boxHit = this.getRayBoxCollision(boxes[j], pos[0], pos[1], pos[2], dx, dy, dz);
				if (boxHit != null) {
                    
                    distance = Minecraft.util.getDistance(x, y, z, boxHit[0][0], boxHit[0][1], boxHit[0][2]);
                    if (boxData == null || distance < boxData.distance) {
                    
                        boxData = {
                            blockPos: [xi, yi, zi],
                            startPos: [x, y, z],
                            endPos: boxHit[0],
                            facePos: boxHit[2],
                            normal: boxHit[1], 
                            blockId: id,
                            blockData: data, 
                            boxId: j,
                            distance: distance
                        };
                    }
                }
			}
            
            if (boxData != null) {
                return boxData;
            }
		}

		return null;
	},
	getNextBoxIntersection(x, y, z, dx, dy, dz) {
		// current position and direction
		var sx, sy, sz;
		
		if (dx == 0) sx = 10;
		else if (dx > 0) sx = (Math.floor(x) + 1 - x) / dx;
		else if (dx < 0) sx = (Math.floor(-x) + 1 + x) / -dx;
		
		if (dy == 0) sy = 10;
		else if (dy >= 0) sy = (Math.floor(y) + 1 - y) / dy;
		else if (dy < 0) sy = (Math.floor(-y) + 1 + y) / -dy;

		if (dz == 0) sz = 10;
		else if (dz >= 0) sz = (Math.floor(z) + 1 - z) / dz;
		else if (dz < 0) sz = (Math.floor(-z) + 1 + z) / -dz;
		
		var min = Math.min(sx, Math.min(sy , sz));
		var hitVec = [x + min * dx, y + min * dy, z + min * dz];

		var normal;		
		if(dx >= 0 && min == sx) normal = [-1,0,0];
		else if(dx < 0 && min == sx) normal = [1,0,0];
		else if(dy >= 0 && min == sy) normal = [0,-1,0];
		else if(dy < 0 && min == sy) normal = [0,1,0];
		else if(dz >= 0 && min == sz) normal = [0,0,-1];
		else if(dz < 0 && min == sz) normal = [0,0,1];
		
		return [hitVec, normal];
	},
	getRayBoxCollision(box, x, y, z, dx, dy, dz) {
		var sx, sy, sz;
		var pos, scale, face;
	
		if (dx >= 0) {
			scale = (box[0] - x) / dx;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[1] >= box[1] && pos[1] <= box[4] && pos[2] >= box[2] && pos[2] <= box[5]) {
				face = [(box[4] - pos[1]) /  (box[4] - box[1]),  (box[5] - pos[2]) /  (box[5] - box[2])];
				return [pos, [-1, 0, 0], face];
			}
		}
		else if (dx < 0) {
			scale = (x - box[3]) / -dx;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[1] >= box[1] && pos[1] <= box[4] && pos[2] >= box[2] && pos[2] <= box[5]) {
				face = [(box[4] - pos[1]) /  (box[4] - box[1]),  (box[5] - pos[2]) /  (box[5] - box[2])];
				return [pos, [1, 0, 0], face];
			}
		}
		
		if (dy >= 0) {
			scale = (box[1] - y) / dy;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[0] >= box[0] && pos[0] <= box[3] && pos[2] >= box[2] && pos[2] <= box[5]) {
				face = [(box[3] - pos[0]) /  (box[3] - box[0]),  (box[5] - pos[2]) /  (box[5] - box[2])];
				return [pos, [0, -1, 0], face];
			}
		}
		else if (dy < 0) {
			scale =  (y - box[4]) / -dy;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[0] >= box[0] && pos[0] <= box[3] && pos[2] >= box[2] && pos[2] <= box[5]) {
				face = [(box[3] - pos[0]) /  (box[3] - box[0]),  (box[5] - pos[2]) /  (box[5] - box[2])];
				return [pos, [0, 1, 0], face];
			}
		}

		if (dz >= 0) {
			scale = (box[2] - z) / dz;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[0] >= box[0] && pos[0] <= box[3] && pos[1] >= box[1] && pos[1] <= box[4]) {
				face = [(box[3] - pos[0]) /  (box[3] - box[0]),  (box[4] - pos[1]) /  (box[4] - box[1])];
				return [pos, [0, 0, -1], face];
			}
		}
		else if (dz < 0) {
			scale =  (z - box[5]) / -dz;
			pos = [x + scale * dx, y + scale * dy, z + scale * dz];
			if (pos[0] >= box[0] && pos[0] <= box[3] && pos[1] >= box[1] && pos[1] <= box[4]) {
				face = [(box[3] - pos[0]) /  (box[3] - box[0]),  (box[4] - pos[1]) /  (box[4] - box[1])];
				return [pos, [0, 0, 1], face];
			}
			
		}
		return null;
	},
	isPointInBoundingBox(x1, y1, x2, y2, px, py) {
		
		var left, top, right, bottom; // Bounding Box For Line Segment
		
		if (x1 < x2) {
			left = x1;
			right = x2;
		}
		else {
			left = x2;
			right = x1;
		}
		
		if (y1 < y2) {
			top = y1;
			bottom = y2;
		}
		else {
			top = y1;
			bottom = y2;
		}

		if ((px + 0.01) >= left && (px - 0.01) <= right && (py + 0.01) >= top && (py - 0.01) <= bottom) {
			return 1;
		}
		
		return 0;
	},
    buildPathTraceImage(maxCycles = 1) {
        return new Promise((resolve, reject) => {

            const width = gl.canvas.width;
            const height = gl.canvas.height;

            const cvs = new OffscreenCanvas(width, height);			
            const ctx = cvs.getContext("2d");

            const sch = Game.getShape();

            const buffer = new ArrayBuffer(width * height * 4);
            const pixels = new Uint8ClampedArray(buffer);

            for (var cycle = 0; cycle < maxCycles; cycle++) {

                var index = 0;
                for (var y = 0; y < height; y++) {
                    for (var x = 0; x < width; x++) {

                        const rngX = Math.random() - .5;
                        const rngY = Math.random() - .5;

                        var out = Game.camera.unprojectPoint(x + .5 + rngX, y + .5 + rngY);
                        const pos = out[0];
                        var dir = [
                            out[1][0] - out[0][0],
                            out[1][1] - out[0][1],
                            out[1][2] - out[0][2]
                        ];
                        vec3.normalize(dir, dir);

                        var color = Minecraft.util.pathTraceBlock(sch, ...pos, ...dir, 300, 3, 0);

                        if (cycle == 0) {
                            pixels[index++] = color[0];
                            pixels[index++] = color[1];
                            pixels[index++] = color[2];
                            pixels[index++] = color[3];
                        }
                        else {
                            pixels[index++] = Math.floor((pixels[index - 1] + color[0]) * .5);
                            pixels[index++] = Math.floor((pixels[index - 1] + color[1]) * .5);
                            pixels[index++] = Math.floor((pixels[index - 1] + color[2]) * .5);
                            pixels[index++] = Math.floor((pixels[index - 1] + color[3]) * .5);
                        }
                    }
                }
            }

            var newImageData = new ImageData(pixels, width, height);
            ctx.putImageData(newImageData, 0, 0);
            
            cvs.convertToBlob().then(function(bData) {
                const blob = bData;
                const objurl = window.URL.createObjectURL(blob);
                const img = new Image();
                img.src = objurl;
                img.onload = function() {
                    resolve(img);
                }
            });
        });
        
    },
    pathTraceBlock(shape, x, y, z, dx, dy, dz, maxDistance = 250, maxDepth = 4, currentDepth = 0) {

		var sz = shape.getSize();
        var lightPos = [44.5, 80, 38.5];
		var boxHit, boxes, hit, xi,yi,zi,bl;
		
		var curDistance = 0;
		var pos = [x, y, z];
		var count = 0;
        var wasInside = false;
        
		while (curDistance < maxDistance && count < 500) {
			
			count++
			curDistance = Minecraft.util.getDistance(x,y,z, pos[0], pos[1], pos[2]);
			if (count == 1) hit = [[x, y, z], [0,0,0]];
			else hit = this.getNextBoxIntersection(pos[0], pos[1], pos[2], dx, dy, dz);
			
			pos = hit[0];
		
			xi = Math.floor(pos[0]) - (hit[1][0] > 0 ? 1 : 0);
			yi = Math.floor(pos[1]) - (hit[1][1] > 0 ? 1 : 0);
			zi = Math.floor(pos[2]) - (hit[1][2] > 0 ? 1 : 0);
			
			if (xi < 0 || xi >= sz.x || yi < 0 || yi >= sz.y || zi < 0 || zi >= sz.z) {
                if (wasInside) break;
                continue;
            }
            
            wasInside = true;
			
			bl = shape.getBlock(xi, yi, zi);
			if (!(bl.id > 0)) continue;

			boxes = Minecraft.Blocks.getBoundingBox(xi,yi,zi,bl.id,bl.data);
			for (var j = 0 ; j < boxes.length; j++) {
				
				boxHit = this.getRayBoxCollision(boxes[j], pos[0], pos[1], pos[2], dx, dy, dz);
				if(boxHit == null) continue;

                // We hit something
                
                var inShadow = true;
                
                if (currentDepth == 0) {
                    var dir = vec3.create();
                    vec3.subtract(dir, lightPos, boxHit[0]);
                    vec3.normalize(dir, dir);	
                    
                    var lightColor = this.pathTraceBlock(shape, ...boxHit[0], ...dir, 300, maxDepth, ++currentDepth);
                    
                    if (lightColor[0] == 255 && lightColor[3] == 0) {
                        inShadow = false;
                    }
                }

                const newColor = Minecraft.Blocks.getBlockColor(bl.id, bl.data);
                var color = [newColor[0], newColor[1], newColor[2], 255];  

                if (inShadow) {
                    color[0] = Math.floor(color[0] * .4);
                    color[1] = Math.floor(color[1] * .4);
                    color[2] = Math.floor(color[2] * .4);
                }

                if (boxHit[1][0] != 0) {
                    color[0] = Math.floor(color[0] * .7);
                    color[1] = Math.floor(color[1] * .7);
                    color[2] = Math.floor(color[2] * .7);
                }
                else if (boxHit[1][2] != 0) {
                    color[0] = Math.floor(color[0] * .85);
                    color[1] = Math.floor(color[1] * .85);
                    color[2] = Math.floor(color[2] * .85);
                }
                else if (boxHit[1][1] < 0) {
                    color[0] = Math.floor(color[0] * .5);
                    color[1] = Math.floor(color[1] * .5);
                    color[2] = Math.floor(color[2] * .5);
                }
                else if (boxHit[1][1] > 0) {
                    color[0] = Math.floor(color[0] * .95);
                    color[1] = Math.floor(color[1] * .95);
                    color[2] = Math.floor(color[2] * .95);
                }
                
				return color;
			}            
		}

		return [255, 0, 0, 0];
	},
    getLineIntersection(l1x1, l1y1, l1x2, l1y2, l2x1, l2y1, l2x2, l2y2) {

		var dx = l1x2 - l1x1;
		var dy = l1y2 - l1y1;

		var m1 = dy / dx;
		var c1 = l1y1 - m1 * l1x1;

		dx = l2x2 - l2x1;
		dy = l2y2 - l2y1;

		var m2 = dy / dx;
		var c2 = l2y1 - m2 * l2x1;

		if ((m1 - m2) == 0) return null;
		else {
			intersectionX = (c2 - c1) / (m1 - m2);
			intersectionY = m1 * intersection_X + c1;
			return [intersectionX, intersectionY];
		}
	},
	getLineSegmentIntersection(l1x1, l1y1, l1x2, l1y2, l2x1, l2y1, l2x2, l2y2) {

		// http://www.softwareandfinance.com/Visual_CPP/VCPP_Intersection_Two_line_Segments_EndPoints.html

		var dx = l1x2 - l1x1;
		var dy = l1y2 - l1y1;

		var m1 = dy / dx;
		var c1 = l1y1 - m1 * l1x1;

		dx = l2x2 - l2x1;
		dy = l2y2 - l2y1;

		var m2 = dy / dx;
		var c2 = l2y1 - m2 * l2x1;

		if ((m1 - m2) == 0) return null;
		else {
			intersection_X = (c2 - c1) / (m1 - m2);
			intersection_Y = m1 * intersection_X + c1;
		}
		
		if (this.IsPointInBoundingBox(l1x1, l1y1, l1x2, l1y2, intersection_X, intersection_Y) == 1 &&
			this.IsPointInBoundingBox(l2x1, l2y1, l2x2, l2y2,  intersection_X, intersection_Y) == 1) {
			return [intersectionX, intersectionY];
		}
		else return null;
	},
	getIdentityMatrix() {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    },
    isUsingMobileDevice() {
        var isMobileDevice = false; //initiate as false
        if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent) 
            || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0,4))) {
            isMobileDevice = true;
        }
        
        return isMobileDevice;
    },
    getUniqueName(name, nameArray) {
        let dupIndex;
        let startName = name;
        let nameInc = 1;
 
        while(true) {
            dupIndex = nameArray.indexOf(name);
            
            if (dupIndex == -1) return name;
            
            name = startName + "-" + nameInc++;
        }
    },
    snapValue(value, interval) {
        const mod = value % interval;
        if (mod == 0) return value;

        value -= mod;
        if (mod * 2 >= interval) value += interval;
        else if (mod * 2 < -interval) value -= interval;

        return value;
    },
    getDeltaTimeText(msTime) {

        const secs = msTime / 1000;
        if (secs <= 60) {
            return `~${secs.toFixed(0)} secs`;
        }
        
        const mins = secs / 60;
        if (mins <= 60) {
            return `~${mins.toFixed(0)} mins`;
        }

        const hours = mins / 60;
        if (hours <= 24) {
            return `~${hours.toFixed(0)} hours`;
        }

        const days = hours / 24;
        if (days <= 14) {
            return `~${days.toFixed(1)} days`;
        }
        
        const weeks = days / 7;
        if (weeks <= 8) {
            return `~${weeks.toFixed(1)} weeks`;
        }

        const months = days / 30;
        if (months <= 12) {
            return `~${months.toFixed(1)} months`;
        }

        const years = days / 365;
        return `~${years.toFixed(1)} years`;
    }
}; 

Minecraft.Blocks = {

	alphaBlocks: [
		0,6,8,9,10,11,20,26,27,28,29,30,31,32,33,34,36,37,38,39,40,50,51,52,55,59,
		64,65,66,69,71,75,76,78,79,81,83,90,92,93,94,95,96,101,102,
		104,105,106,111,115,116,117,118,119,122,127,132,138,140,
		141,142,144,145,149,150,151,154,157,160,165,166,167,171,175,176,177,178,
		193,194,195,196,197,209,212,207,198,217,253
	],
	specialBlocks: [	 // blocks that are not standard cubes
		6,26,27,28,30,31,32,34,37,38,39,40,44,50,51,53,54,55,59,60,63,64,65,66,67,68,69,70,71,
		72,75,76,77,81,83,85,92,93,94,96,101,102,104,105,106,107,108,109,111,113,114,115,116,
		117,118,119,120,122,126,127,128,130,131,132,134,135,136,139,140,141,142,143,144,145,
		146,147,148,149,150,151,154,156,157,163,164,167,171,175,176,177,178,180,182,183,184,
		185,186,187,188,189,190,191,192,193,194,195,196,197,198,203,205,207,208,217,254
	],		
	nonSolidBlocks: [
		0,6,8,9,10,11,27,28,30,31,32,37,38,39,40,50,51,55,59,63,65,66,68,69,70,72,
		75,76,77,83,90,92,104,105,106,115,119,127,132,140,141,142,143,144,
		147,148,151,157,175,176,177,198,207,209,217,253
	],
	
	blockColors: {
		0: [198,234,254],	//air
		1: [120,120,120],	//stone
		2: [0,145,0],		//grass
		3: [138,102,55],	//dirt
		4: [125,125,125],	//cobblestone
		5: [185,133,83],	//wood planks
		6: [0,210,0],		//saplings
		7: [60,60,60],		//bedrock
		8: [0,0,255],		//water (flowing]
		9: [0,0,235],		//water (stationary]
		10: [255,155,102],	//lava (flowing]
		11: [255,129,61],	//lava (stationary]	
		12: [228,216,174],	//sand
		13: [142,115,108],	//gravel
		14: [245,232,73],	//gold ore
		15: [211,179,160],	//iron ore
		16: [61,61,61],		//coal ore
		17: [86,70,43],		//wood
		18: [0,104,0],		//leaves
		19: [230,220,50],	//sponge
		20: [235,235,235],	//glass
		21: [40,85,135],	//lapis lazuli ore
		22: [30,60,150],	//lapis lazuli block
		23: [120,120,120],	//dispenser
		24: [226,206,140],	//sandstone
		25: [150,90,60],	//noteblock
		26: [180,35,35],	//bed
		27: [240,195,40],	//powered rail
		28: [150,0,0],		//detector rail
		29: [100,170,100],	//sticky piston
		30: [235,235,235],	//cobweb
		31: [0,160,0],		//long grass
		32: [224,162,64],	//shrub
		33: [185,133,83],	//piston
		34: [185,133,83],	//piston head
		36: [185,133,83],	//piston extension
		37: [255,248,56],	//yellow flower
		38: [225,0,0],		//red rose
		39: [168,125,99],	//brown mushroom
		40: [186,27,27],	//red mushroom			
		41: [255, 215, 0], 	//gold block
		42: [135,135,135],	//iron block
		43: [190,190,190],	//double stone slab
		44: [165,165,165],	//step
		45: [139,77,60],	//brick
		47: [160,153,19],	//bookshelf
		49: [17,14,25],		//obsidian
		50: [255,248,56],	//torch
		52: [27,42,53],		//monster spawner
		53: [185,133,83],	//wood stairs
		54: [170,110,30],	//chest
		55: [170,0,0],		//redstone wire
		58: [141,114,73], 	//crafting table
		59: [205,222,61],	//wheat crops
		61: [51,51,51],		//furnace
		62: [71,71,71],		//burning furnace
		63: [189,138,89],	//post sign
		64: [95,69,43],		//wood door
		65: [185,133,83],	//ladder
		66: [164,164,164],	//rail
		67: [125,125,125],	//cobblestone stairs
		68: [185,133,83],	//wall sign
		69: [120,120,120],	//lever
		70: [120,120,120],	//stone pressure plate
		71: [135,135,135],	//iron door
		72: [189,138,89],	//wooden pressure plate
		75: [140,0,0],		//redstone torch off
		76: [175,0,0],		//redstone torch on
		77: [180,180,180],	//stone button		
		78: [230,255,255],	//snow layer
		79: [151,225,255],	//ice
		81: [76,150, 24],	//cactus
		82: [150,150,180],	//clay
		83: [89,255, 89],	//reed
		84: [165,120,73],	//jukebox
		85: [185,133,83],	//wood fence
		86: [204,130,26],	//Pumpkin
		88: [178,112,65],	//soul sand
		89: [220, 190, 140],	//glowstone
		92: [247,193,238],	//cake
		93: [140,0,0],		//redstone repeater off
		94: [175,0,0],		//redstone repeater on
		96: [185,133,83],	//trapdoor
		97: [180,180,180],	//stone monster egg
		98: [106,106,106],	//stone brick
		99: [168,125,99],	//large brown mushroom
		100: [186,27,27],	//large red mushroom		
		102: [158,255,243],	//glass pane
		103: [161,166,38],	//melon
		106: [0,150,0],		//vines
		109: [106,106,106],	//stone brick stairs
		110: [100,90,100],	//mycelium
		111: [96,188,30],	//lily pad
		128: [226,206,140],	//sandstone stairs
		134: [185,133,83],	//spruce wood stairs
		137: [182,118,78],	//command block
		139: [90,90,90],	//cobblestone wall
		141: [205,222,61],	//carrot crops
		142: [205,222,61],	//potato crops
		149: [140,0,0],		//redstone comparator inactive
		155: [235,233,227],	//quartz block
		161: [67,132,21],	//dark oak leaves

		'168:0': [112,176,154],	//prismarine
		'168:1': [81,150,132],	//prismarine bricks
		'168:2': [64,96,72],		//dark prismarine
		'169:0': [179,219,208],	//sea lantern
	
		'38:1': [28,128,186],	//Poppy
		'38:2': [141,85,186],	//Poppy
		'38:3': [207,207,158],	//Poppy
		'38:4': [156,41,14],	//Poppy
		'38:5': [166,89,24],		//Poppy
		'38:6': [180,180,180],	//Poppy
		'38:7': [173,140,173],	//Poppy
		'38:8': [255,250,155],	//daisy flower
		'175:8': [0,200,0],		//double tall grass and flowers top		

		'35:0':  [215, 215, 215], // White
		'35:1': [255, 100, 0], 	// Orange
		'35:2': [200, 0, 200], 	// Magenta
		'35:3': [87, 132, 223], 	// Light blue
		'35:4': [164,154,37], 	// Yellow
		'35:5': [0, 255, 0], 	// Green
		'35:6': [255, 180, 200], // Pink
		'35:7': [72, 72, 72],	// Gray
		'35:8': [173, 173, 173], // Light grey
		'35:9': [0, 100, 160], 	// Cyan
		'35:10': [120, 0, 200], 	// Purple
		'35:11': [40,49,122], 	// Blue
		'35:12': [100, 60, 0], 	// Brown
		'35:13': [48,63,24], 	// Cactus green
		'35:14': [123, 43, 40], 	// Red
		'35:15': [25, 25, 25],	// Black
		
		'95:0':  [254, 254, 254], 	// White - Glass colors
		'95:1': [114, 65, 28], 		// Orange
		'95:2': [200, 0, 200], 		// Magenta
		'95:3': [87, 132, 223], 		// Light blue
		'95:4': [255, 255, 0], 		// Yellow
		'95:5': [0, 255, 0], 		// Green
		'95:6': [255, 180, 200], 	// Pink
		'95:7': [72, 72, 72],		// Gray
		'95:8': [173, 173, 173], 	// Light grey
		'95:9': [0, 100, 160], 		// Cyan
		'95:10': [120, 0, 200], 		// Purple
		'95:11': [0, 0, 175], 		// Blue
		'95:12': [100, 60, 0], 		// Brown
		'95:13': [48, 160, 0], 		// Cactus green
		'95:14': [78, 36, 26], 		// Red
		'95:15': [0, 0, 0], 			// Black

		'160:0':  [254, 254, 254], 	// White - Glass colors
		'160:1': [114, 65, 28], 		// Orange
		'160:2': [200, 0, 200], 		// Magenta
		'160:3': [87, 132, 223], 	// Light blue
		'160:4': [255, 255, 0], 		// Yellow
		'160:5': [0, 255, 0], 		// Green
		'160:6': [255, 180, 200], 	// Pink
		'160:7': [72, 72, 72],		// Gray
		'160:8': [173, 173, 173], 	// Light grey
		'160:9': [0, 100, 160], 		// Cyan
		'160:10': [120, 0, 200], 	// Purple
		'160:11': [0, 0, 175], 		// Blue
		'160:12': [100, 60, 0], 		// Brown
		'160:13': [48, 160, 0], 		// Cactus green
		'160:14': [255, 0, 0], 		// Red
		'160:15': [0, 0, 0], 		// Black				
	
		'171:0':  [254, 254, 254], 	// White
		'171:1': [255, 100, 0], 		// Orange
		'171:2': [200, 0, 200], 		// Magenta
		'171:3': [87, 132, 223], 	// Light blue
		'171:4': [255, 255, 0], 		// Yellow
		'171:5': [0, 255, 0], 		// Green
		'171:6': [255, 180, 200],	 // Pink
		'171:7': [72, 72, 72],		// Gray
		'171:8': [173, 173, 173],	 // Light grey
		'171:9': [0, 100, 160], 		// Cyan
		'171:10': [120, 0, 200], 	// Purple
		'171:11': [0, 0, 175], 		// Blue
		'171:12': [100, 60, 0], 		// Brown
		'171:13': [48, 160, 0], 		// Cactus green
		'171:14': [123, 43, 40], 	// Red
		'171:15': [25, 25, 25], 		// Black	
		
		'175:1': [249, 228, 0], 		// Sunflower
	},		
	blockTextures: {
		0:0,
		1:1,
		2:40,
		3:2,
		4:16,
		5:4,
		6:6,
		7:17,
		8:17,
		9:17,
		10:175,
		11:175,
		12:160,
		13:19,
		14:32,
		15:33,
		16:34,
		17:20,
		18:68,
		19:48,
		20:49,
		21:18,
		22:96,
		23:46,
		24:144,
		25:74,
		26:134,
		27:192,
		28:176,
		29:106,
		30:11,
		31:39,
		32:55,
		33:108,
		34:107,
		35:80,
		36:237,
		37:13,
		38:194,
		39:29,
		40:28,
		41:23,
		42:22,
		43:5,
		44:5,
		45:7,
		46:8,
		47:35,
		48:36,
		49:37,
		50:80,
		51:15,
		52:65,
		53:4,
		54:26,
		55:165,
		56:50,
		57:24,
		58:60,
		59:95,
		60:47,
		61:44,
		62:61,
		63:180,
		64:97,
		65:83,
		66:128,
		67:16,
		68:239,
		69:96,
		70:1,
		71:98,
		72:4,
		73:51,
		74:51,
		75:115,
		76:99,
		77:1,
		78:66,
		79:67,
		80:66,
		81:69,
		82:64,
		83:73,
		84:74,
		85:4,
		86:118,
		87:103,
		88:104,
		89:105,
		90:14,
		91:120,
		92:121,
		93:131,
		94:147,
		95:224,
		96:84,
		97:1,
		98:98,
		99:126,
		100:125,
		101:85,
		102:49,
		103:136,
		104:60,
		105:60,
		106:143,
		107:4,
		108:7,
		109:98,
		110:78,
		111:76,
		112:11,
		113:11,
		114:11,
		115:59,
		116:166,
		117:157,
		118:154,
		119:30,
		120:121,
		121:122,
		122:156,
		123:132,
		124:133,
		125:4,
		126:4,
		127:61,
		128:144,
		129:79,
		130:104,
		131:133,
		132:116,
		133:97,
		134:52,
		135:53,
		136:54,
		137:114,
		138:117,
		139:16,
		140:72,
		141:77,
		142:78,
		143:4,
		144:125,
		145:136,
		146:102,
		147:23,
		148:22,
		149:141,			
		150:142,
		151:119,
		152:130,
		153:146,
		154:126,
		155:148,
		156:148,
		157:178,
		158:127,
		159:240,
		160:224,
		161:68,
		162:72,
		163:55,
		164:56,
		165:204,
		166:153,
		167:86,
		168:153,
		169:58,
		170:65,
		171:208,
		172:49,
		173:76,
		174:111,
		176:137,
		177:137,
		178:203,
		179:145,	
		180:145,
		181:145,
		182:145,
		183:52,
		184:53,
		185:54,
		186:56,
		187:55,
		188:52,
		189:53,
		190:54,
		191:56,
		192:55,
		193:129,
		194:130,
		195:160,
		196:161,
		197:162,
        198:62,
        199:164,
        200:165,
        201:178,
        202:179,
        203:178,
        204:178,
        205:178,
        206:182,
        207:46,
        208:195,
        209:30,
        210:196,
        211:197,
        212:74,
        213:198,
        214:199,
        215:212,
        216:213,
        217:75,
        218:214,
        219:194,
        220:194,
        221:194,
        222:194,
        223:194,
        224:194,
        225:194,
        226:194,
        227:194,
        228:194,
        229:194,
        230:194,
        231:194,
        232:194,
        233:194,
        234:194,
        
        235:168,
        236:169,
        237:170,
        238:171,
        239:172,
        240:173,
        241:174,
        242:175,
        243:184,
        244:185,
        245:186,
        246:187,
        247:188,
        248:189,
        249:190,
        250:191,

        255:162,
        
		'1:0':1,
		'1:1':12,
		'1:2':28,
		'1:3':13,
		'1:4':29,
		'1:5':14,
		'1:6':30,
		
		'3:0':2,
		'3:1':15,
		'3:2':31,
		
		'5:0':4,
		'5:1':52,
		'5:2':53,
		'5:3':54,
		'5:4':55,
		'5:5':56,
		'5:6':57,
		
		'6:0':6,
		'6:1':22,
		'6:2':38,
		'6:3':54,
		'6:4':7,
		'6:5':23,
		
		'12:0':160,
		'12:1':49,			
		
		'17:0':138,
		'17:1':139,
		'17:2':140,
		'17:3':141,

		'18:0':68,
		'18:1':69,
		'18:2':70,
		'18:3':71,
		
		'19:0':123,
		'19:1':124,
		
		'24:0':144,
		'24:1':112,
		'24:2':128,

		'31:0':55,
		'31:1':39,
		'31:2':56,

		'35:0': 80,
		'35:1': 81,
		'35:2': 82,
		'35:3': 83,
		'35:4': 84,
		'35:5': 85,
		'35:6': 86,
		'35:7': 87,
		'35:8': 88,
		'35:9': 89,
		'35:10': 90,
		'35:11': 91,
		'35:12': 92,
		'35:13': 93,
		'35:14': 94,
		'35:15': 95,
		
		'38:0': 194,	
		'38:1': 195,	
		'38:2': 196,	
		'38:3': 197,	
		'38:4': 198,	
		'38:5': 199,	
		'38:6': 200,	
		'38:7': 201,	
		'38:8': 202,	

		'43:0': 5,
		'43:1': 144,
		'43:2': 4,
		'43:3': 16,			
		'43:4': 7,
		'43:5': 98,
		'43:6': 11,
		'43:7': 80,

		'44:0': 5,
		'44:1': 144,
		'44:2': 4,
		'44:3': 16,			
		'44:4': 7,
		'44:5': 98,
		'44:6': 11,
		'44:7': 148,
		'44:8': 5,
		'44:9': 144,
		'44:10': 4,
		'44:11': 16,			
		'44:12': 7,
		'44:13': 98,
		'44:14': 11,
		'44:15': 148,			
		
        '55:0': 164,
		
        '60:0': 47,
		'60:7': 63,
		
		'64:0': 97,
		'64:8': 81,
		'64:9': 81,
		'64:10': 81,
		'64:11': 81,
        
		'71:0': 98,
		'71:8': 82,
		'71:9': 82,
		'71:10': 82,
		'71:11': 82,
		
		'95:0': 224,
		'95:1': 238,
		'95:2': 236,
		'95:3': 234,
		'95:4': 232,
		'95:5': 230,
		'95:6': 228,
		'95:7': 226 ,
		'95:8': 239,
		'95:9': 237,
		'95:10': 235,
		'95:11': 233,
		'95:12': 231,
		'95:13': 229,
		'95:14': 227,
		'95:15': 225,

		'97:0': 1,
		'97:1': 16,
		'97:2': 98,
		'97:3': 100,
		'97:4': 101,
		'97:5': 99,
		
		'98:0': 98,
		'98:1': 100,
		'98:2': 101,
		'98:3': 99,
		
		'125:0':4,
		'125:1':52,
		'125:2':53,
		'125:3':54,
		'125:4':55,
		'125:5':56,
		'125:6':57,

		'126:0':4,
		'126:1':52,
		'126:2':53,
		'126:3':54,
		'126:4':55,
		'126:5':56,
		'126:6':57,
		'126:7':80,			
		'126:8':4,
		'126:9':52,
		'126:10':53,
		'126:11':54,
		'126:12':55,
		'126:13':56,
		'126:14':57,			
		'126:15':80,
		
		'139:0':16,
		'139:1':36,			

		'155:0':148,
		'155:1':149,
		'155:2':150,
        
		// Default stained clay
		// '159:0': 224,
		// '159:1': 225,
		// '159:2': 226,
		// '159:3': 227,
		// '159:4': 228,
		// '159:5': 229,
		// '159:6': 230,
		// '159:7': 231,
		// '159:8': 232,
		// '159:9': 233,
		// '159:10': 234,
		// '159:11': 235,
		// '159:12': 236,
		// '159:13': 237,
		// '159:14': 238,
		// '159:15': 239,
		
		'159:0': 240,
		'159:1': 241,
		'159:2': 242,
		'159:3': 243,
		'159:4': 244,
		'159:5': 245,
		'159:6': 246,
		'159:7': 247,
		'159:8': 248,
		'159:9': 249,
		'159:10': 250,
		'159:11': 251,
		'159:12': 252,
		'159:13': 253,
		'159:14': 254,
		'159:15': 255,				
		
		'160:0': 224,
		'160:1': 238,
		'160:2': 236,
		'160:3': 234,
		'160:4': 232,
		'160:5': 230,
		'160:6': 228,
		'160:7': 226 ,
		'160:8': 239,
		'160:9': 237,
		'160:10': 235,
		'160:11': 233,
		'160:12': 231,
		'160:13': 229,
		'160:14': 227,
		'160:15': 225,
		
		'161:0': 68,
		'161:1': 68,

		'162:0': 142,
		'162:1': 143,			
		
		'168:0': 41,
		'168:1': 42,
		'168:2': 57,
		'168:3': 58,
		
		'171:0': 208,
		'171:1': 209,
		'171:2': 210,
		'171:3': 211,
		'171:4': 212,
		'171:5': 213,
		'171:6': 214,
		'171:7': 215,
		'171:8': 216,
		'171:9': 217,
		'171:10': 218,
		'171:11': 219,
		'171:12': 220,
		'171:13': 221,
		'171:14': 222,
		'171:15': 223,

		'175:0': 184,
		'175:1': 185,
		'175:2': 186,
		'175:3': 187,
		'175:4': 188,
		'175:5': 189,
		
		'179:0': 145,
		'179:1': 113,
		'179:2': 129,			
		
		'193:0': 129,
		'193:8': 113,
		'193:9': 113,
		'193:10': 113,
		'193:11': 113,

		'194:0': 130,
		'194:8': 114,
		'194:9': 114,
		'194:10': 114,
		'194:11': 114,	

		'195:0': 160,
		'195:8': 144,
		'195:9': 144,
		'195:10': 144,
		'195:11': 144,	

		'196:0': 161,
		'196:8': 145,
		'196:9': 145,
		'196:10': 145,
		'196:11': 145,	

		'197:0': 162,
		'197:8': 146,
		'197:9': 146,
		'197:10': 146,
		'197:11': 146,
        
        '200:0': 165,
		'200:1': 165,
        '200:2': 165,
        '200:3': 165,
        '200:4': 165,
		'200:5': 181,

        '251:0': 200,
        '251:1': 201,
        '251:2': 202,
        '251:3': 203,
        '251:4': 204,
        '251:5': 205,
        '251:6': 206,
        '251:7': 207,
        '251:8': 216,
        '251:9': 217,
        '251:10': 218,
        '251:11': 219,
        '251:12': 220,
        '251:13': 221,
        '251:14': 222,
        '251:15': 223,

        '252:0': 200,
        '252:1': 201,
        '252:2': 202,
        '252:3': 203,
        '252:4': 204,
        '252:5': 205,
        '252:6': 206,
        '252:7': 207,
        '252:8': 216,
        '252:9': 217,
        '252:10': 218,
        '252:11': 219,
        '252:12': 220,
        '252:13': 221,
        '252:14': 222,
        '252:15': 223,

        '253:0': 1,
        '253:1': 2,

		'254:0': 224,
		'254:1': 225,
		'254:2': 226,
		'254:3': 227,
		'254:4': 228,
		'254:5': 229,
		'254:6': 230,
		'254:7': 231,
		'254:8': 232,
		'254:9': 233,
		'254:10': 234,
		'254:11': 235,	
		
	},
	blockIdNames: [
        'air',
        'stone',
        'grass',
        'dirt',
        'cobblestone',
        'planks',
        'sapling',
        'bedrock',
        'flowing_water',
        'water',
        'flowing_lava',
        'lava',
        'sand',
        'gravel',
        'gold_ore',
        'iron_ore',
        'coal_ore',
        'log',
        'leaves',
        'sponge',
        'glass',
        'lapis_ore',
        'lapis_block',
        'dispenser',
        'sandstone',
        'noteblock',
        'bed',
        'golden_rail',
        'detector_rail',
        'sticky_piston',
        'web',
        'tallgrass',
        'deadbush',
        'piston',
        'piston_head',
        'wool',
        null,
        'yellow_flower',
        'red_flower',
        'brown_mushroom',
        'red_mushroom',
        'gold_block',
        'iron_block',
        'double_stone_slab',
        'stone_slab',
        'brick_block',
        'tnt',
        'bookshelf',
        'mossy_cobblestone',
        'obsidian',
        'torch',
        'fire',
        'mob_spawner',
        'oak_stairs',
        'chest',
        'redstone_wire',
        'diamond_ore',
        'diamond_block',
        'crafting_table',
        'wheat',
        'farmland',
        'furnace',
        'lit_furnace',
        'standing_sign',
        'wooden_door',
        'ladder',
        'rail',
        'stone_stairs',
        'wall_sign',
        'lever',
        'stone_pressure_plate',
        'iron_door',
        'wooden_pressure_plate',
        'redstone_ore',
        'lit_redstone_ore',
        'off - unlit_redstone_torch',
        'on - redstone_torch',
        'stone_button',
        'snow_layer',
        'ice',
        'snow',
        'cactus',
        'clay',
        'reeds',
        'jukebox',
        'fence',
        'pumpkin',
        'netherrack',
        'soul_sand',
        'glowstone',
        'portal',
        'lit_pumpkin',
        'cake',
        'off - unpowered_repeater',
        'on - powered_repeater',
        'stained_glass',
        'trapdoor',
        'monster_egg',
        'stonebrick',
        'brown_mushroom_block',
        'red_mushroom_block',
        'iron_bars',
        'glass_pane',
        'melon_block',
        'pumpkin_stem',
        'melon_stem',
        'vine',
        'fence_gate',
        'brick_stairs',
        'stone_brick_stairs',
        'mycelium',
        'waterlily',
        'nether_brick',
        'nether_brick_fence',
        'nether_brick_stairs',
        'nether_wart',
        'enchanting_table',
        'brewing_stand',
        'cauldron',
        'end_portal',
        'end_portal_frame',
        'end_stone',
        'dragon_egg',
        'inactive - redstone_lamp',
        'active - lit_redstone_lamp',
        'double_wooden_slab',
        'wooden_slab',
        'cocoa',
        'sandstone_stairs',
        'emerald_ore',
        'ender_chest',
        'tripwire_hook',
        'tripwire_hook',
        'emerald_block',
        'spruce_stairs',
        'birch_stairs',
        'jungle_stairs',
        'command_block',
        'beacon',
        'cobblestone_wall',
        'flower_pot',
        'carrots',
        'potatoes',
        'wooden_button',
        'skull',
        'anvil',
        'trapped_chest',
        'light - light_weighted_pressure_plate',
        'heavy - heavy_weighted_pressure_plate',
        'inactive - unpowered_comparator',
        'active - powered_comparator',
        'daylight_detector',
        'redstone_block',
        'quartz_ore',
        'hopper',
        'quartz_block',
        'quartz_stairs',
        'activator_rail',
        'dropper',
        'stained_hardened_clay',
        'stained_glass_pane',
        'leaves2',
        'log2',
        'acacia_stairs',
        'dark_oak_stairs',
        'slime',
        'barrier',
        'iron_trapdoor',
        'prismarine',
        'sea_lantern',
        'hay_block',
        'carpet',
        'hardened_clay',
        'coal_block',
        'packed_ice',
        'double_plant',
        'standing_banner',
        'wall_banner',
        'daylight_detector_inverted',
        'red_sandstone',
        'red_sandstone_stairs',
        'double_stone_slab2',
        'stone_slab2',
        'spruce_fence_gate',
        'birch_fence_gate',
        'jungle_fence_gate',
        'dark_oak_fence_gate',
        'acacia_fence_gate',
        'spruce_fence',
        'birch_fence',
        'jungle_fence',
        'dark_oak_fence',
        'acacia_fence',
        'spruce_door',
        'birch_door',
        'jungle_door',
        'acacia_door',
        'dark_oak_door',
        'end_rod',
        'chorus_plant',
        'chorus_flower',
        'purpur_block',
        'purpur_pillar',
        'purpur_stairs',
        'purpur_double_slab',
        'purpur_slab',
        'end_bricks',
        'beetroots',
        'grass_path',
        'end_gateway',
        'repeating_command_block',
        'chain_command_block',
        'frosted_ice',
        'magma',
        'nether_wart_block',
        'red_nether_brick',
        'bone_block',
        'structure_void',
        'observer',
        'white_shulker_box',
        'orange_shulker_box',
        'magenta_shulker_box',
        'light_blue_shulker_box',
        'yellow_shulker_box',
        'lime_shulker_box',
        'pink_shulker_box',
        'gray_shulker_box',
        'silver_shulker_box',
        'cyan_shulker_box',
        'purple_shulker_box',
        'blue_shulker_box',
        'brown_shulker_box',
        'green_shulker_box',
        'red_shulker_box',
        'black_shulker_box',
        'white_glazed_terracotta',
        'orange_glazed_terracotta',
        'magenta_glazed_terracotta',
        'light_blue_glazed_terracotta',
        'yellow_glazed_terracotta',
        'lime_glazed_terracotta',
        'pink_glazed_terracotta',
        'gray_glazed_terracotta',
        'light_gray_glazed_terracotta',
        'cyan_glazed_terracotta',
        'purple_glazed_terracotta',
        'blue_glazed_terracotta',
        'brown_glazed_terracotta',
        'green_glazed_terracotta',
        'red_glazed_terracotta',
        'black_glazed_terracotta',
        'concrete',
        'concrete_powder',
        'unknown_block',
        'minesweeper_block',
        'structure_block',
        'iron_shovel',
        'iron_pickaxe',
        'iron_axe',
        'flint_and_steel',
        'apple',
        'bow',
        'arrow',
        'coal',
        'diamond',
        'iron_ingot',
        'gold_ingot',
        'iron_sword',
        'wooden_sword',
        'wooden_shovel',
        'wooden_pickaxe',
        'wooden_axe',
        'stone_sword',
        'stone_shovel',
        'stone_pickaxe',
        'stone_axe',
        'diamond_sword',
        'diamond_shovel',
        'diamond_pickaxe',
        'diamond_axe',
        'stick',
        'bowl',
        'mushroom_stew',
        'golden_sword',
        'golden_shovel',
        'golden_pickaxe',
        'golden_axe',
        'string',
        'feather',
        'gunpowder',
        'wooden_hoe',
        'stone_hoe',
        'iron_hoe',
        'diamond_hoe',
        'golden_hoe',
        'wheat_seeds',
        'wheat',
        'bread',
        'leather_helmet',
        'leather_chestplate',
        'leather_leggings',
        'leather_boots',
        'chainmail_helmet',
        'chainmail_chestplate',
        'chainmail_leggings',
        'chainmail_boots',
        'iron_helmet',
        'iron_chestplate',
        'iron_leggings',
        'iron_boots',
        'diamond_helmet',
        'diamond_chestplate',
        'diamond_leggings',
        'diamond_boots',
        'golden_helmet',
        'golden_chestplate',
        'golden_leggings',
        'golden_boots',
        'flint',
        'porkchop',
        'cooked_porkchop',
        'painting',
        'golden_apple',
        'sign',
        'wooden_door',
        'bucket',
        'water_bucket',
        'lava_bucket',
        'minecart',
        'saddle',
        'iron_door',
        'redstone',
        'snowball',
        'boat',
        'leather',
        'milk_bucket',
        'brick',
        'clay_ball',
        'reeds',
        'paper',
        'book',
        'slime_ball',
        'chest_minecart',
        'furnace_minecart',
        'egg',
        'compass',
        'fishing_rod',
        'clock',
        'glowstone_dust',
        'fish',
        'cooked_fish',
        'dye',
        'bone',
        'sugar',
        'cake',
        'bed',
        'repeater',
        'cookie',
        'filled_map',
        'shears',
        'melon',
        'pumpkin_seeds',
        'melon_seeds',
        'beef',
        'cooked_beef',
        'chicken',
        'cooked_chicken',
        'rotten_flesh',
        'ender_pearl',
        'blaze_rod',
        'ghast_tear',
        'gold_nugget',
        'nether_wart',
        'potion',
        'glass_bottle',
        'spider_eye',
        'fermented_spider_eye',
        'blaze_powder',
        'magma_cream',
        'brewing_stand',
        'cauldron',
        'ender_eye',
        'speckled_melon',
        'spawn_egg',
        'experience_bottle',
        'fire_charge',
        'writable_book',
        'written_book',
        'emerald',
        'item_frame',
        'flower_pot',
        'carrot',
        'potato',
        'baked_potato',
        'poisonous_potato',
        'map',
        'golden_carrot',
        'skull',
        'carrot_on_a_stick',
        'nether_star',
        'pumpkin_pie',
        'fireworks',
        'firework_charge',
        'enchanted_book',
        'comparator',
        'netherbrick',
        'quartz',
        'tnt_minecart',
        'hopper_minecart',
        'prismarine_shard',
        'prismarine_crystals',
        'rabbit',
        'cooked_rabbit',
        'rabbit_stew',
        'rabbit_foot',
        'rabbit_hide',
        'armor_stand',
        'iron_horse_armor',
        'golden_horse_armor',
        'diamond_horse_armor',
        'lead',
        'name_tag',
        'command_block_minecart',
        'mutton',
        'cooked_mutton',
        'banner',
        'end_crystal',
        'spruce_door',
        'birch_door',
        'jungle_door',
        'acacia_door',
        'dark_oak_door',
        'chorus_fruit',
        'popped_chorus_fruit',
        'beetroot',
        'beetroot_seeds',
        'beetroot_soup',
        'dragon_breath',
        'splash_potion',
        'spectral_arrow',
        'tipped_arrow',
        'lingering_potion',
        'shield',
        'elytra',
        'spruce_boat',
        'birch_boat',
        'jungle_boat',
        'acacia_boat',
        'dark_oak_boat',
        'totem_of_undying',
        'shulker_shell',
        'iron_nugget',
        'knowledge_book'
	],
	blockIdNamesExtended: {
        '0:0': 'air',
        '1:0': 'stone',
        '1:1': 'granite',
        '1:2': 'polished_granite',
        '1:3': 'diorite',
        '1:4': 'polished_diorite',
        '1:5': 'andesite',
        '1:6': 'polished_andesite',
        '2:0': 'grass',
        '3:0': 'dirt',
        '3:1': 'coarse_dirt',
        '3:2': 'podzol',
        '4:0': 'cobblestone',
        '5:0': 'oak_planks',
        '5:1': 'spruce_planks',
        '5:2': 'birch_planks',
        '5:3': 'jungle_planks',
        '5:4': 'acacia_planks',
        '5:5': 'dark_oak_Planks',
        '6:0': 'oak_sapling',
        '6:1': 'spruce_sapling',
        '6:2': 'birch_sapling',
        '6:3': 'jungle_sapling',
        '6:4': 'acacia_sapling',
        '6:5': 'dark_oak_sapling',
        '7:0': 'bedrock',
        '8:0': 'flowing_water',
        '9:0': 'still_water',
        '10:0': 'flowing_lava',
        '11:0': 'still_lava',
        '12:0': 'sand',
        '12:1': 'red_sand',
        '13:0': 'gravel',
        '14:0': 'gold_ore',
        '15:0': 'iron_ore',
        '16:0': 'coal_ore',
        '17:0': 'oak_log',
        '17:1': 'spruce_log',
        '17:2': 'birch_log',
        '17:3': 'jungle_log',
        '18:0': 'oak_leaves',
        '18:1': 'spruce_leaves',
        '18:2': 'birch_leaves',
        '18:3': 'jungle_leaves',
        '35:0': 'white_wool',
        '35:1': 'orange_wool',
        '35:2': 'magenta_wool',
        '35:3': 'light_blue_wool',
        '35:4': 'yellow_wool',
        '35:5': 'lime_wool',
        '35:6': 'pink_wool',
        '35:7': 'gray_wool',
        '35:8': 'light_gray_wool',
        '35:9': 'cyan_wool',
        '35:10': 'purple_wool',
        '35:11': 'blue_wool',
        '35:12': 'brown_wool',
        '35:13': 'green_wool',
        '35:14': 'red_wool',
        '35:15': 'black_wool',
    },
	blockNames: {
        '0': 'Air',
        '1': 'Stone',
        '1:1': 'Granite',
        '1:2': 'Polished Granite',
        '1:3': 'Diorite',
        '1:4': 'Polished Diorite',
        '1:5': 'Andesite',
        '1:6': 'Polished Andesite',
        '2': 'Grass',
        '3': 'Dirt',
        '3:1': 'Coarse Dirt',
        '3:2': 'Podzol',
        '4': 'Cobblestone',
        '5': 'Oak Wood Plank',
        '5:1': 'Spruce Wood Plank',
        '5:2': 'Birch Wood Plank',
        '5:3': 'Jungle Wood Plank',
        '5:4': 'Acacia Wood Plank',
        '5:5': 'Dark Oak Wood Plank',
        '6': 'Oak Sapling',
        '6:1': 'Spruce Sapling',
        '6:2': 'Birch Sapling',
        '6:3': 'Jungle Sapling',
        '6:4': 'Acacia Sapling',
        '6:5': 'Dark Oak Sapling',
        '7': 'Bedrock',
        '8': 'Flowing Water',
        '9': 'Still Water',
        '10': 'Flowing Lava',
        '11': 'Still Lava',
        '12': 'Sand',
        '12:1': 'Red Sand',
        '13': 'Gravel',
        '14': 'Gold Ore',
        '15': 'Iron Ore',
        '16': 'Coal Ore',
        '17': 'Oak Wood',
        '17:1': 'Spruce Wood',
        '17:2': 'Birch Wood',
        '17:3': 'Jungle Wood',
        '18': 'Oak Leaves',
        '18:1': 'Spruce Leaves',
        '18:2': 'Birch Leaves',
        '18:3': 'Jungle Leaves',
        '19': 'Sponge',
        '19:1': 'Wet Sponge',
        '20': 'Glass',
        '21': 'Lapis Lazuli Ore',
        '22': 'Lapis Lazuli Block',
        '23': 'Dispenser',
        '24': 'Sandstone',
        '24:1': 'Chiseled Sandstone',
        '24:2': 'Smooth Sandstone',
        '25': 'Note Block',
        '26': 'Bed',
        '27': 'Powered Rail',
        '28': 'Detector Rail',
        '29': 'Sticky Piston',
        '30': 'Cobweb',
        '31': 'Dead Shrub',
        '31:1': 'Grass',
        '31:2': 'Fern',
        '32': 'Dead Bush',
        '33': 'Piston',
        '34': 'Piston Head',
        '35': 'White Wool',
        '35:1': 'Orange Wool',
        '35:2': 'Magenta Wool',
        '35:3': 'Light Blue Wool',
        '35:4': 'Yellow Wool',
        '35:5': 'Lime Wool',
        '35:6': 'Pink Wool',
        '35:7': 'Gray Wool',
        '35:8': 'Light Gray Wool',
        '35:9': 'Cyan Wool',
        '35:10': 'Purple Wool',
        '35:11': 'Blue Wool',
        '35:12': 'Brown Wool',
        '35:13': 'Green Wool',
        '35:14': 'Red Wool',
        '35:15': 'Black Wool',
        '37': 'Dandelion',
        '38': 'Poppy',
        '38:1': 'Blue Orchid',
        '38:2': 'Allium',
        '38:3': 'Azure Bluet',
        '38:4': 'Red Tulip',
        '38:5': 'Orange Tulip',
        '38:6': 'White Tulip',
        '38:7': 'Pink Tulip',
        '38:8': 'Oxeye Daisy',
        '39': 'Brown Mushroom',
        '40': 'Red Mushroom',
        '41': 'Gold Block',
        '42': 'Iron Block',
        '43': 'Double Stone Slab',
        '43:1': 'Double Sandstone Slab',
        '43:2': 'Double Wooden Slab',
        '43:3': 'Double Cobblestone Slab',
        '43:4': 'Double Brick Slab',
        '43:5': 'Double Stone Brick Slab',
        '43:6': 'Double Nether Brick Slab',
        '43:7': 'Double Quartz Slab',
        '44': 'Stone Slab',
        '44:1': 'Sandstone Slab',
        '44:2': 'Wooden Slab',
        '44:3': 'Cobblestone Slab',
        '44:4': 'Brick Slab',
        '44:5': 'Stone Brick Slab',
        '44:6': 'Nether Brick Slab',
        '44:7': 'Quartz Slab',
        '45': 'Bricks',
        '46': 'TNT',
        '47': 'Bookshelf',
        '48': 'Moss Stone',
        '49': 'Obsidian',
        '50': 'Torch',
        '51': 'Fire',
        '52': 'Monster Spawner',
        '53': 'Oak Wood Stairs',
        '54': 'Chest',
        '55': 'Redstone Wire',
        '56': 'Diamond Ore',
        '57': 'Diamond Block',
        '58': 'Crafting Table',
        '59': 'Wheat Crops',
        '60': 'Farmland',
        '61': 'Furnace',
        '62': 'Burning Furnace',
        '63': 'Standing Sign Block',
        '64': 'Oak Door Block',
        '65': 'Ladder',
        '66': 'Rail',
        '67': 'Cobblestone Stairs',
        '68': 'Wall-mounted Sign Block',
        '69': 'Lever',
        '70': 'Stone Pressure Plate',
        '71': 'Iron Door Block',
        '72': 'Wooden Pressure Plate',
        '73': 'Redstone Ore',
        '74': 'Glowing Redstone Ore',
        '75': 'Redstone Torch ',
        '76': 'Redstone Torch ',
        '77': 'Stone Button',
        '78': 'Snow',
        '79': 'Ice',
        '80': 'Snow Block',
        '81': 'Cactus',
        '82': 'Clay',
        '83': 'Sugar Canes',
        '84': 'Jukebox',
        '85': 'Oak Fence',
        '86': 'Pumpkin',
        '87': 'Netherrack',
        '88': 'Soul Sand',
        '89': 'Glowstone',
        '90': 'Nether Portal',
        '91': 'Jack o\'Lantern',
        '92': 'Cake Block',
        '93': 'Redstone Repeater Block ',
        '94': 'Redstone Repeater Block ',
        '95': 'White Stained Glass',
        '95:1': 'Orange Stained Glass',
        '95:2': 'Magenta Stained Glass',
        '95:3': 'Light Blue Stained Glass',
        '95:4': 'Yellow Stained Glass',
        '95:5': 'Lime Stained Glass',
        '95:6': 'Pink Stained Glass',
        '95:7': 'Gray Stained Glass',
        '95:8': 'Light Gray Stained Glass',
        '95:9': 'Cyan Stained Glass',
        '95:10': 'Purple Stained Glass',
        '95:11': 'Blue Stained Glass',
        '95:12': 'Brown Stained Glass',
        '95:13': 'Green Stained Glass',
        '95:14': 'Red Stained Glass',
        '95:15': 'Black Stained Glass',
        '96': 'Wooden Trapdoor',
        '97': 'Stone Monster Egg',
        '97:1': 'Cobblestone Monster Egg',
        '97:2': 'Stone Brick Monster Egg',
        '97:3': 'Mossy Stone Brick Monster Egg',
        '97:4': 'Cracked Stone Brick Monster Egg',
        '97:5': 'Chiseled Stone Brick Monster Egg',
        '98': 'Stone Bricks',
        '98:1': 'Mossy Stone Bricks',
        '98:2': 'Cracked Stone Bricks',
        '98:3': 'Chiseled Stone Bricks',
        '99': 'Brown Mushroom Block',
        '100': 'Red Mushroom Block',
        '101': 'Iron Bars',
        '102': 'Glass Pane',
        '103': 'Melon Block',
        '104': 'Pumpkin Stem',
        '105': 'Melon Stem',
        '106': 'Vines',
        '107': 'Oak Fence Gate',
        '108': 'Brick Stairs',
        '109': 'Stone Brick Stairs',
        '110': 'Mycelium',
        '111': 'Lily Pad',
        '112': 'Nether Brick',
        '113': 'Nether Brick Fence',
        '114': 'Nether Brick Stairs',
        '115': 'Nether Wart',
        '116': 'Enchantment Table',
        '117': 'Brewing Stand',
        '118': 'Cauldron',
        '119': 'End Portal',
        '120': 'End Portal Frame',
        '121': 'End Stone',
        '122': 'Dragon Egg',
        '123': 'Redstone Lamp ',
        '124': 'Redstone Lamp ',
        '125': 'Double Oak Wood Slab',
        '125:1': 'Double Spruce Wood Slab',
        '125:2': 'Double Birch Wood Slab',
        '125:3': 'Double Jungle Wood Slab',
        '125:4': 'Double Acacia Wood Slab',
        '125:5': 'Double Dark Oak Wood Slab',
        '126': 'Oak Wood Slab',
        '126:1': 'Spruce Wood Slab',
        '126:2': 'Birch Wood Slab',
        '126:3': 'Jungle Wood Slab',
        '126:4': 'Acacia Wood Slab',
        '126:5': 'Dark Oak Wood Slab',
        '127': 'Cocoa',
        '128': 'Sandstone Stairs',
        '129': 'Emerald Ore',
        '130': 'Ender Chest',
        '131': 'Tripwire Hook',
        '132': 'Tripwire',
        '133': 'Emerald Block',
        '134': 'Spruce Wood Stairs',
        '135': 'Birch Wood Stairs',
        '136': 'Jungle Wood Stairs',
        '137': 'Command Block',
        '138': 'Beacon',
        '139': 'Cobblestone Wall',
        '139:1': 'Mossy Cobblestone Wall',
        '140': 'Flower Pot',
        '141': 'Carrots',
        '142': 'Potatoes',
        '143': 'Wooden Button',
        '144': 'Mob Head',
        '145': 'Anvil',
        '146': 'Trapped Chest',
        '147': 'Weighted Pressure Plate ',
        '148': 'Weighted Pressure Plate ',
        '149': 'Redstone Comparator ',
        '150': 'Redstone Comparator ',
        '151': 'Daylight Sensor',
        '152': 'Redstone Block',
        '153': 'Nether Quartz Ore',
        '154': 'Hopper',
        '155': 'Quartz Block',
        '155:1': 'Chiseled Quartz Block',
        '155:2': 'Pillar Quartz Block',
        '156': 'Quartz Stairs',
        '157': 'Activator Rail',
        '158': 'Dropper',
        '159': 'White Hardened Clay',
        '159:1': 'Orange Hardened Clay',
        '159:2': 'Magenta Hardened Clay',
        '159:3': 'Light Blue Hardened Clay',
        '159:4': 'Yellow Hardened Clay',
        '159:5': 'Lime Hardened Clay',
        '159:6': 'Pink Hardened Clay',
        '159:7': 'Gray Hardened Clay',
        '159:8': 'Light Gray Hardened Clay',
        '159:9': 'Cyan Hardened Clay',
        '159:10': 'Purple Hardened Clay',
        '159:11': 'Blue Hardened Clay',
        '159:12': 'Brown Hardened Clay',
        '159:13': 'Green Hardened Clay',
        '159:14': 'Red Hardened Clay',
        '159:15': 'Black Hardened Clay',
        '160': 'White Stained Glass Pane',
        '160:1': 'Orange Stained Glass Pane',
        '160:2': 'Magenta Stained Glass Pane',
        '160:3': 'Light Blue Stained Glass Pane',
        '160:4': 'Yellow Stained Glass Pane',
        '160:5': 'Lime Stained Glass Pane',
        '160:6': 'Pink Stained Glass Pane',
        '160:7': 'Gray Stained Glass Pane',
        '160:8': 'Light Gray Stained Glass Pane',
        '160:9': 'Cyan Stained Glass Pane',
        '160:10': 'Purple Stained Glass Pane',
        '160:11': 'Blue Stained Glass Pane',
        '160:12': 'Brown Stained Glass Pane',
        '160:13': 'Green Stained Glass Pane',
        '160:14': 'Red Stained Glass Pane',
        '160:15': 'Black Stained Glass Pane',
        '161': 'Acacia Leaves',
        '161:1': 'Dark Oak Leaves',
        '162': 'Acacia Wood',
        '162:1': 'Dark Oak Wood',
        '163': 'Acacia Wood Stairs',
        '164': 'Dark Oak Wood Stairs',
        '165': 'Slime Block',
        '166': 'Barrier',
        '167': 'Iron Trapdoor',
        '168': 'Prismarine',
        '168:1': 'Prismarine Bricks',
        '168:2': 'Dark Prismarine',
        '169': 'Sea Lantern',
        '170': 'Hay Bale',
        '171': 'White Carpet',
        '171:1': 'Orange Carpet',
        '171:2': 'Magenta Carpet',
        '171:3': 'Light Blue Carpet',
        '171:4': 'Yellow Carpet',
        '171:5': 'Lime Carpet',
        '171:6': 'Pink Carpet',
        '171:7': 'Gray Carpet',
        '171:8': 'Light Gray Carpet',
        '171:9': 'Cyan Carpet',
        '171:10': 'Purple Carpet',
        '171:11': 'Blue Carpet',
        '171:12': 'Brown Carpet',
        '171:13': 'Green Carpet',
        '171:14': 'Red Carpet',
        '171:15': 'Black Carpet',
        '172': 'Hardened Clay',
        '173': 'Block of Coal',
        '174': 'Packed Ice',
        '175': 'Sunflower',
        '175:1': 'Lilac',
        '175:2': 'Double Tallgrass',
        '175:3': 'Large Fern',
        '175:4': 'Rose Bush',
        '175:5': 'Peony',
        '176': 'Free-standing Banner',
        '177': 'Wall-mounted Banner',
        '178': 'Inverted Daylight Sensor',
        '179': 'Red Sandstone',
        '179:1': 'Chiseled Red Sandstone',
        '179:2': 'Smooth Red Sandstone',
        '180': 'Red Sandstone Stairs',
        '181': 'Double Red Sandstone Slab',
        '182': 'Red Sandstone Slab',
        '183': 'Spruce Fence Gate',
        '184': 'Birch Fence Gate',
        '185': 'Jungle Fence Gate',
        '186': 'Dark Oak Fence Gate',
        '187': 'Acacia Fence Gate',
        '188': 'Spruce Fence',
        '189': 'Birch Fence',
        '190': 'Jungle Fence',
        '191': 'Dark Oak Fence',
        '192': 'Acacia Fence',
        '193': 'Spruce Door Block',
        '194': 'Birch Door Block',
        '195': 'Jungle Door Block',
        '196': 'Acacia Door Block',
        '197': 'Dark Oak Door Block',
        '198': 'End Rod',
        '199': 'Chorus Plant',
        '200': 'Chorus Flower',
        '201': 'Purpur Block',
        '202': 'Purpur Pillar',
        '203': 'Purpur Stairs',
        '204': 'Purpur Double Slab',
        '205': 'Purpur Slab',
        '206': 'End Stone Bricks',
        '207': 'Beetroot Block',
        '208': 'Grass Path',
        '209': 'End Gateway',
        '210': 'Repeating Command Block',
        '211': 'Chain Command Block',
        '212': 'Frosted Ice',
        '213': 'Magma Block',
        '214': 'Nether Wart Block',
        '215': 'Red Nether Brick',
        '216': 'Bone Block',
        '217': 'Structure Void',
        '218': 'Observer',
        '219': 'White Shulker Box',
        '220': 'Orange Shulker Box',
        '221': 'Magenta Shulker Box',
        '222': 'Light Blue Shulker Box',
        '223': 'Yellow Shulker Box',
        '224': 'Lime Shulker Box',
        '225': 'Pink Shulker Box',
        '226': 'Gray Shulker Box',
        '227': 'Light Gray Shulker Box',
        '228': 'Cyan Shulker Box',
        '229': 'Purple Shulker Box',
        '230': 'Blue Shulker Box',
        '231': 'Brown Shulker Box',
        '232': 'Green Shulker Box',
        '233': 'Red Shulker Box',
        '234': 'Black Shulker Box',
        '235': 'White Glazed Terracotta',
        '236': 'Orange Glazed Terracotta',
        '237': 'Magenta Glazed Terracotta',
        '238': 'Light Blue Glazed Terracotta',
        '239': 'Yellow Glazed Terracotta',
        '240': 'Lime Glazed Terracotta',
        '241': 'Pink Glazed Terracotta',
        '242': 'Gray Glazed Terracotta',
        '243': 'Light Gray Glazed Terracotta',
        '244': 'Cyan Glazed Terracotta',
        '245': 'Purple Glazed Terracotta',
        '246': 'Blue Glazed Terracotta',
        '247': 'Brown Glazed Terracotta',
        '248': 'Green Glazed Terracotta',
        '249': 'Red Glazed Terracotta',
        '250': 'Black Glazed Terracotta',
        '251': 'White Concrete',
        '251:1': 'Orange Concrete',
        '251:2': 'Magenta Concrete',
        '251:3': 'Light Blue Concrete',
        '251:4': 'Yellow Concrete',
        '251:5': 'Lime Concrete',
        '251:6': 'Pink Concrete',
        '251:7': 'Gray Concrete',
        '251:8': 'Light Gray Concrete',
        '251:9': 'Cyan Concrete',
        '251:10': 'Purple Concrete',
        '251:11': 'Blue Concrete',
        '251:12': 'Brown Concrete',
        '251:13': 'Green Concrete',
        '251:14': 'Red Concrete',
        '251:15': 'Black Concrete',
        '252': 'White Concrete Powder',
        '252:1': 'Orange Concrete Powder',
        '252:2': 'Magenta Concrete Powder',
        '252:3': 'Light Blue Concrete Powder',
        '252:4': 'Yellow Concrete Powder',
        '252:5': 'Lime Concrete Powder',
        '252:6': 'Pink Concrete Powder',
        '252:7': 'Gray Concrete Powder',
        '252:8': 'Light Gray Concrete Powder',
        '252:9': 'Cyan Concrete Powder',
        '252:10': 'Purple Concrete Powder',
        '252:11': 'Blue Concrete Powder',
        '252:12': 'Brown Concrete Powder',
        '252:13': 'Green Concrete Powder',
        '252:14': 'Red Concrete Powder',
        '252:15': 'Black Concrete Powder',
        '255': 'Structure Block',
        '256': 'Iron Shovel',
        '257': 'Iron Pickaxe',
        '258': 'Iron Axe',
        '259': 'Flint and Steel',
        '260': 'Apple',
        '261': 'Bow',
        '262': 'Arrow',
        '263': 'Coal',
        '263:1': 'Charcoal',
        '264': 'Diamond',
        '265': 'Iron Ingot',
        '266': 'Gold Ingot',
        '267': 'Iron Sword',
        '268': 'Wooden Sword',
        '269': 'Wooden Shovel',
        '270': 'Wooden Pickaxe',
        '271': 'Wooden Axe',
        '272': 'Stone Sword',
        '273': 'Stone Shovel',
        '274': 'Stone Pickaxe',
        '275': 'Stone Axe',
        '276': 'Diamond Sword',
        '277': 'Diamond Shovel',
        '278': 'Diamond Pickaxe',
        '279': 'Diamond Axe',
        '280': 'Stick',
        '281': 'Bowl',
        '282': 'Mushroom Stew',
        '283': 'Golden Sword',
        '284': 'Golden Shovel',
        '285': 'Golden Pickaxe',
        '286': 'Golden Axe',
        '287': 'String',
        '288': 'Feather',
        '289': 'Gunpowder',
        '290': 'Wooden Hoe',
        '291': 'Stone Hoe',
        '292': 'Iron Hoe',
        '293': 'Diamond Hoe',
        '294': 'Golden Hoe',
        '295': 'Wheat Seeds',
        '296': 'Wheat',
        '297': 'Bread',
        '298': 'Leather Helmet',
        '299': 'Leather Tunic',
        '300': 'Leather Pants',
        '301': 'Leather Boots',
        '302': 'Chainmail Helmet',
        '303': 'Chainmail Chestplate',
        '304': 'Chainmail Leggings',
        '305': 'Chainmail Boots',
        '306': 'Iron Helmet',
        '307': 'Iron Chestplate',
        '308': 'Iron Leggings',
        '309': 'Iron Boots',
        '310': 'Diamond Helmet',
        '311': 'Diamond Chestplate',
        '312': 'Diamond Leggings',
        '313': 'Diamond Boots',
        '314': 'Golden Helmet',
        '315': 'Golden Chestplate',
        '316': 'Golden Leggings',
        '317': 'Golden Boots',
        '318': 'Flint',
        '319': 'Raw Porkchop',
        '320': 'Cooked Porkchop',
        '321': 'Painting',
        '322': 'Golden Apple',
        '322:1': 'Enchanted Golden Apple',
        '323': 'Sign',
        '324': 'Oak Door',
        '325': 'Bucket',
        '326': 'Water Bucket',
        '327': 'Lava Bucket',
        '328': 'Minecart',
        '329': 'Saddle',
        '330': 'Iron Door',
        '331': 'Redstone',
        '332': 'Snowball',
        '333': 'Oak Boat',
        '334': 'Leather',
        '335': 'Milk Bucket',
        '336': 'Brick',
        '337': 'Clay',
        '338': 'Sugar Canes',
        '339': 'Paper',
        '340': 'Book',
        '341': 'Slimeball',
        '342': 'Minecart with Chest',
        '343': 'Minecart with Furnace',
        '344': 'Egg',
        '345': 'Compass',
        '346': 'Fishing Rod',
        '347': 'Clock',
        '348': 'Glowstone Dust',
        '349': 'Raw Fish',
        '349:1': 'Raw Salmon',
        '349:2': 'Clownfish',
        '349:3': 'Pufferfish',
        '350': 'Cooked Fish',
        '350:1': 'Cooked Salmon',
        '351': 'Ink Sack',
        '351:1': 'Rose Red',
        '351:2': 'Cactus Green',
        '351:3': 'Coco Beans',
        '351:4': 'Lapis Lazuli',
        '351:5': 'Purple Dye',
        '351:6': 'Cyan Dye',
        '351:7': 'Light Gray Dye',
        '351:8': 'Gray Dye',
        '351:9': 'Pink Dye',
        '351:10': 'Lime Dye',
        '351:11': 'Dandelion Yellow',
        '351:12': 'Light Blue Dye',
        '351:13': 'Magenta Dye',
        '351:14': 'Orange Dye',
        '351:15': 'Bone Meal',
        '352': 'Bone',
        '353': 'Sugar',
        '354': 'Cake',
        '355': 'Bed',
        '356': 'Redstone Repeater',
        '357': 'Cookie',
        '358': 'Map',
        '359': 'Shears',
        '360': 'Melon',
        '361': 'Pumpkin Seeds',
        '362': 'Melon Seeds',
        '363': 'Raw Beef',
        '364': 'Steak',
        '365': 'Raw Chicken',
        '366': 'Cooked Chicken',
        '367': 'Rotten Flesh',
        '368': 'Ender Pearl',
        '369': 'Blaze Rod',
        '370': 'Ghast Tear',
        '371': 'Gold Nugget',
        '372': 'Nether Wart',
        '373': 'Potion',
        '374': 'Glass Bottle',
        '375': 'Spider Eye',
        '376': 'Fermented Spider Eye',
        '377': 'Blaze Powder',
        '378': 'Magma Cream',
        '379': 'Brewing Stand',
        '380': 'Cauldron',
        '381': 'Eye of Ender',
        '382': 'Glistering Melon',
        '383:4': 'Spawn Elder Guardian',
        '383:5': 'Spawn Wither Skeleton',
        '383:6': 'Spawn Stray',
        '383:23': 'Spawn Husk',
        '383:27': 'Spawn Zombie Villager',
        '383:28': 'Spawn Skeleton Horse',
        '383:29': 'Spawn Zombie Horse',
        '383:31': 'Spawn Donkey',
        '383:32': 'Spawn Mule',
        '383:34': 'Spawn Evoker',
        '383:35': 'Spawn Vex',
        '383:36': 'Spawn Vindicator',
        '383:50': 'Spawn Creeper',
        '383:51': 'Spawn Skeleton',
        '383:52': 'Spawn Spider',
        '383:54': 'Spawn Zombie',
        '383:55': 'Spawn Slime',
        '383:56': 'Spawn Ghast',
        '383:57': 'Spawn Zombie Pigman',
        '383:58': 'Spawn Enderman',
        '383:59': 'Spawn Cave Spider',
        '383:60': 'Spawn Silverfish',
        '383:61': 'Spawn Blaze',
        '383:62': 'Spawn Magma Cube',
        '383:65': 'Spawn Bat',
        '383:66': 'Spawn Witch',
        '383:67': 'Spawn Endermite',
        '383:68': 'Spawn Guardian',
        '383:69': 'Spawn Shulker',
        '383:90': 'Spawn Pig',
        '383:91': 'Spawn Sheep',
        '383:92': 'Spawn Cow',
        '383:93': 'Spawn Chicken',
        '383:94': 'Spawn Squid',
        '383:95': 'Spawn Wolf',
        '383:96': 'Spawn Mooshroom',
        '383:98': 'Spawn Ocelot',
        '383:100': 'Spawn Horse',
        '383:101': 'Spawn Rabbit',
        '383:102': 'Spawn Polar Bear',
        '383:103': 'Spawn Llama',
        '383:105': 'Spawn Parrot',
        '383:120': 'Spawn Villager',
        '384': 'Bottle o\' Enchanting',
        '385': 'Fire Charge',
        '386': 'Book and Quill',
        '387': 'Written Book',
        '388': 'Emerald',
        '389': 'Item Frame',
        '390': 'Flower Pot',
        '391': 'Carrot',
        '392': 'Potato',
        '393': 'Baked Potato',
        '394': 'Poisonous Potato',
        '395': 'Empty Map',
        '396': 'Golden Carrot',
        '397': 'Mob Head ',
        '397:1': 'Mob Head ',
        '397:2': 'Mob Head ',
        '397:3': 'Mob Head ',
        '397:4': 'Mob Head ',
        '397:5': 'Mob Head ',
        '398': 'Carrot on a Stick',
        '399': 'Nether Star',
        '400': 'Pumpkin Pie',
        '401': 'Firework Rocket',
        '402': 'Firework Star',
        '403': 'Enchanted Book',
        '404': 'Redstone Comparator',
        '405': 'Nether Brick',
        '406': 'Nether Quartz',
        '407': 'Minecart with TNT',
        '408': 'Minecart with Hopper',
        '409': 'Prismarine Shard',
        '410': 'Prismarine Crystals',
        '411': 'Raw Rabbit',
        '412': 'Cooked Rabbit',
        '413': 'Rabbit Stew',
        '414': 'Rabbit\'s Foot',
        '415': 'Rabbit Hide',
        '416': 'Armor Stand',
        '417': 'Iron Horse Armor',
        '418': 'Golden Horse Armor',
        '419': 'Diamond Horse Armor',
        '420': 'Lead',
        '421': 'Name Tag',
        '422': 'Minecart with Command Block',
        '423': 'Raw Mutton',
        '424': 'Cooked Mutton',
        '425': 'Banner',
        '426': 'End Crystal',
        '427': 'Spruce Door',
        '428': 'Birch Door',
        '429': 'Jungle Door',
        '430': 'Acacia Door',
        '431': 'Dark Oak Door',
        '432': 'Chorus Fruit',
        '433': 'Popped Chorus Fruit',
        '434': 'Beetroot',
        '435': 'Beetroot Seeds',
        '436': 'Beetroot Soup',
        '437': 'Dragon\'s Breath',
        '438': 'Splash Potion',
        '439': 'Spectral Arrow',
        '440': 'Tipped Arrow',
        '441': 'Lingering Potion',
        '442': 'Shield',
        '443': 'Elytra',
        '444': 'Spruce Boat',
        '445': 'Birch Boat',
        '446': 'Jungle Boat',
        '447': 'Acacia Boat',
        '448': 'Dark Oak Boat',
        '449': 'Totem of Undying',
        '450': 'Shulker Shell',
        '452': 'Iron Nugget',
        '453': 'Knowledge Book',
        '2256': '13 Disc',
        '2257': 'Cat Disc',
        '2258': 'Blocks Disc',
        '2259': 'Chirp Disc',
        '2260': 'Far Disc',
        '2261': 'Mall Disc',
        '2262': 'Mellohi Disc',
        '2263': 'Stal Disc',
        '2264': 'Strad Disc',
        '2265': 'Ward Disc',
        '2266': '11 Disc',
        '2267': 'Wait Disc'
	},
	blockProperties: {
		"0:0" : {},
		"1:0" : {
			"variant" : "stone"
		},
		"1:1" : {
			"variant" : "granite"
		},
		"1:2" : {
			"variant" : "smooth_granite"
		},
		"1:3" : {
			"variant" : "diorite"
		},
		"1:4" : {
			"variant" : "smooth_diorite"
		},
		"1:5" : {
			"variant" : "andesite"
		},
		"1:6" : {
			"variant" : "smooth_andesite"
		},
		"2:0" : {
			"snowy" : "false"
		},
		"3:0" : {
			"variant" : "dirt",
			"snowy" : "false"
		},
		"3:1" : {
			"variant" : "coarse_dirt",
			"snowy" : "false"
		},
		"3:2" : {
			"variant" : "podzol",
			"snowy" : "false"
		},
		"4:0" : {},
		"5:0" : {
			"variant" : "oak"
		},
		"5:1" : {
			"variant" : "spruce"
		},
		"5:2" : {
			"variant" : "birch"
		},
		"5:3" : {
			"variant" : "jungle"
		},
		"5:4" : {
			"variant" : "acacia"
		},
		"5:5" : {
			"variant" : "dark_oak"
		},
		"6:8" : {
			"type" : "oak",
			"stage" : "1"
		},
		"6:9" : {
			"type" : "spruce",
			"stage" : "1"
		},
		"6:10" : {
			"type" : "birch",
			"stage" : "1"
		},
		"6:11" : {
			"type" : "jungle",
			"stage" : "1"
		},
		"6:12" : {
			"type" : "acacia",
			"stage" : "1"
		},
		"6:13" : {
			"type" : "dark_oak",
			"stage" : "1"
		},
		"7:0" : {},
		"8:0" : {
			"level" : "0"
		},
		"8:1" : {
			"level" : "1"
		},
		"8:2" : {
			"level" : "2"
		},
		"8:3" : {
			"level" : "3"
		},
		"8:4" : {
			"level" : "4"
		},
		"8:5" : {
			"level" : "5"
		},
		"8:6" : {
			"level" : "6"
		},
		"8:7" : {
			"level" : "7"
		},
		"8:8" : {
			"level" : "8"
		},
		"8:9" : {
			"level" : "9"
		},
		"8:10" : {
			"level" : "10"
		},
		"8:11" : {
			"level" : "11"
		},
		"8:12" : {
			"level" : "12"
		},
		"8:13" : {
			"level" : "13"
		},
		"8:14" : {
			"level" : "14"
		},
		"8:15" : {
			"level" : "15"
		},
		"9:0" : {
			"level" : "0"
		},
		"9:1" : {
			"level" : "1"
		},
		"9:2" : {
			"level" : "2"
		},
		"9:3" : {
			"level" : "3"
		},
		"9:4" : {
			"level" : "4"
		},
		"9:5" : {
			"level" : "5"
		},
		"9:6" : {
			"level" : "6"
		},
		"9:7" : {
			"level" : "7"
		},
		"9:8" : {
			"level" : "8"
		},
		"9:9" : {
			"level" : "9"
		},
		"9:10" : {
			"level" : "10"
		},
		"9:11" : {
			"level" : "11"
		},
		"9:12" : {
			"level" : "12"
		},
		"9:13" : {
			"level" : "13"
		},
		"9:14" : {
			"level" : "14"
		},
		"9:15" : {
			"level" : "15"
		},
		"10:0" : {
			"level" : "0"
		},
		"10:1" : {
			"level" : "1"
		},
		"10:2" : {
			"level" : "2"
		},
		"10:3" : {
			"level" : "3"
		},
		"10:4" : {
			"level" : "4"
		},
		"10:5" : {
			"level" : "5"
		},
		"10:6" : {
			"level" : "6"
		},
		"10:7" : {
			"level" : "7"
		},
		"10:8" : {
			"level" : "8"
		},
		"10:9" : {
			"level" : "9"
		},
		"10:10" : {
			"level" : "10"
		},
		"10:11" : {
			"level" : "11"
		},
		"10:12" : {
			"level" : "12"
		},
		"10:13" : {
			"level" : "13"
		},
		"10:14" : {
			"level" : "14"
		},
		"10:15" : {
			"level" : "15"
		},
		"11:0" : {
			"level" : "0"
		},
		"11:1" : {
			"level" : "1"
		},
		"11:2" : {
			"level" : "2"
		},
		"11:3" : {
			"level" : "3"
		},
		"11:4" : {
			"level" : "4"
		},
		"11:5" : {
			"level" : "5"
		},
		"11:6" : {
			"level" : "6"
		},
		"11:7" : {
			"level" : "7"
		},
		"11:8" : {
			"level" : "8"
		},
		"11:9" : {
			"level" : "9"
		},
		"11:10" : {
			"level" : "10"
		},
		"11:11" : {
			"level" : "11"
		},
		"11:12" : {
			"level" : "12"
		},
		"11:13" : {
			"level" : "13"
		},
		"11:14" : {
			"level" : "14"
		},
		"11:15" : {
			"level" : "15"
		},
		"14:0" : {},
		"15:0" : {},
		"16:0" : {},
		"17:0" : {
			"variant" : "oak",
			"axis" : "y"
		},
		"17:1" : {
			"variant" : "spruce",
			"axis" : "y"
		},
		"17:2" : {
			"variant" : "birch",
			"axis" : "y"
		},
		"17:3" : {
			"variant" : "jungle",
			"axis" : "y"
		},
		"17:4" : {
			"variant" : "oak",
			"axis" : "x"
		},
		"17:5" : {
			"variant" : "spruce",
			"axis" : "x"
		},
		"17:6" : {
			"variant" : "birch",
			"axis" : "x"
		},
		"17:7" : {
			"variant" : "jungle",
			"axis" : "x"
		},
		"17:8" : {
			"variant" : "oak",
			"axis" : "z"
		},
		"17:9" : {
			"variant" : "spruce",
			"axis" : "z"
		},
		"17:10" : {
			"variant" : "birch",
			"axis" : "z"
		},
		"17:11" : {
			"variant" : "jungle",
			"axis" : "z"
		},
		"17:12" : {
			"variant" : "oak",
			"axis" : "none"
		},
		"17:13" : {
			"variant" : "spruce",
			"axis" : "none"
		},
		"17:14" : {
			"variant" : "birch",
			"axis" : "none"
		},
		"17:15" : {
			"variant" : "jungle",
			"axis" : "none"
		},
		"18:0" : {
			"variant" : "oak",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"18:1" : {
			"variant" : "spruce",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"18:2" : {
			"variant" : "birch",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"18:3" : {
			"variant" : "jungle",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"18:4" : {
			"variant" : "oak",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"18:5" : {
			"variant" : "spruce",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"18:6" : {
			"variant" : "birch",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"18:7" : {
			"variant" : "jungle",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"18:8" : {
			"variant" : "oak",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"18:9" : {
			"variant" : "spruce",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"18:10" : {
			"variant" : "birch",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"18:11" : {
			"variant" : "jungle",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"18:12" : {
			"variant" : "oak",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"18:13" : {
			"variant" : "spruce",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"18:14" : {
			"variant" : "birch",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"18:15" : {
			"variant" : "jungle",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"19:0" : {
			"wet" : "false"
		},
		"19:1" : {
			"wet" : "true"
		},
		"20:0" : {},
		"21:0" : {},
		"22:0" : {},
		"23:0" : {
			"facing" : "down",
			"triggered" : "false"
		},
		"23:1" : {
			"facing" : "up",
			"triggered" : "false"
		},
		"23:2" : {
			"facing" : "north",
			"triggered" : "false"
		},
		"23:3" : {
			"facing" : "south",
			"triggered" : "false"
		},
		"23:4" : {
			"facing" : "west",
			"triggered" : "false"
		},
		"23:5" : {
			"facing" : "east",
			"triggered" : "false"
		},
		"23:8" : {
			"facing" : "down",
			"triggered" : "true"
		},
		"23:9" : {
			"facing" : "up",
			"triggered" : "true"
		},
		"23:10" : {
			"facing" : "north",
			"triggered" : "true"
		},
		"23:11" : {
			"facing" : "south",
			"triggered" : "true"
		},
		"23:12" : {
			"facing" : "west",
			"triggered" : "true"
		},
		"23:13" : {
			"facing" : "east",
			"triggered" : "true"
		},
		"24:0" : {
			"type" : "sandstone"
		},
		"24:1" : {
			"type" : "chiseled_sandstone"
		},
		"24:2" : {
			"type" : "smooth_sandstone"
		},
		"25:0" : {},
		"26:0" : {
			"facing" : "south",
			"part" : "foot",
			"occupied" : "false"
		},
		"26:1" : {
			"facing" : "west",
			"part" : "foot",
			"occupied" : "false"
		},
		"26:2" : {
			"facing" : "north",
			"part" : "foot",
			"occupied" : "false"
		},
		"26:3" : {
			"facing" : "east",
			"part" : "foot",
			"occupied" : "false"
		},
		"26:8" : {
			"facing" : "south",
			"part" : "head",
			"occupied" : "false"
		},
		"26:9" : {
			"facing" : "west",
			"part" : "head",
			"occupied" : "false"
		},
		"26:10" : {
			"facing" : "north",
			"part" : "head",
			"occupied" : "false"
		},
		"26:11" : {
			"facing" : "east",
			"part" : "head",
			"occupied" : "false"
		},
		"26:12" : {
			"facing" : "south",
			"part" : "head",
			"occupied" : "true"
		},
		"26:13" : {
			"facing" : "west",
			"part" : "head",
			"occupied" : "true"
		},
		"26:14" : {
			"facing" : "north",
			"part" : "head",
			"occupied" : "true"
		},
		"26:15" : {
			"facing" : "east",
			"part" : "head",
			"occupied" : "true"
		},
		"27:0" : {
			"shape" : "north_south",
			"powered" : "false"
		},
		"27:1" : {
			"shape" : "east_west",
			"powered" : "false"
		},
		"27:2" : {
			"shape" : "ascending_east",
			"powered" : "false"
		},
		"27:3" : {
			"shape" : "ascending_west",
			"powered" : "false"
		},
		"27:4" : {
			"shape" : "ascending_north",
			"powered" : "false"
		},
		"27:5" : {
			"shape" : "ascending_south",
			"powered" : "false"
		},
		"27:8" : {
			"shape" : "north_south",
			"powered" : "true"
		},
		"27:9" : {
			"shape" : "east_west",
			"powered" : "true"
		},
		"27:10" : {
			"shape" : "ascending_east",
			"powered" : "true"
		},
		"27:11" : {
			"shape" : "ascending_west",
			"powered" : "true"
		},
		"27:12" : {
			"shape" : "ascending_north",
			"powered" : "true"
		},
		"27:13" : {
			"shape" : "ascending_south",
			"powered" : "true"
		},
		"28:0" : {
			"shape" : "north_south",
			"powered" : "false"
		},
		"28:1" : {
			"shape" : "east_west",
			"powered" : "false"
		},
		"28:2" : {
			"shape" : "ascending_east",
			"powered" : "false"
		},
		"28:3" : {
			"shape" : "ascending_west",
			"powered" : "false"
		},
		"28:4" : {
			"shape" : "ascending_north",
			"powered" : "false"
		},
		"28:5" : {
			"shape" : "ascending_south",
			"powered" : "false"
		},
		"28:8" : {
			"shape" : "north_south",
			"powered" : "true"
		},
		"28:9" : {
			"shape" : "east_west",
			"powered" : "true"
		},
		"28:10" : {
			"shape" : "ascending_east",
			"powered" : "true"
		},
		"28:11" : {
			"shape" : "ascending_west",
			"powered" : "true"
		},
		"28:12" : {
			"shape" : "ascending_north",
			"powered" : "true"
		},
		"28:13" : {
			"shape" : "ascending_south",
			"powered" : "true"
		},
		"29:0" : {
			"facing" : "down",
			"extended" : "false"
		},
		"29:1" : {
			"facing" : "up",
			"extended" : "false"
		},
		"29:2" : {
			"facing" : "north",
			"extended" : "false"
		},
		"29:3" : {
			"facing" : "south",
			"extended" : "false"
		},
		"29:4" : {
			"facing" : "west",
			"extended" : "false"
		},
		"29:5" : {
			"facing" : "east",
			"extended" : "false"
		},
		"29:8" : {
			"facing" : "down",
			"extended" : "true"
		},
		"29:9" : {
			"facing" : "up",
			"extended" : "true"
		},
		"29:10" : {
			"facing" : "north",
			"extended" : "true"
		},
		"29:11" : {
			"facing" : "south",
			"extended" : "true"
		},
		"29:12" : {
			"facing" : "west",
			"extended" : "true"
		},
		"29:13" : {
			"facing" : "east",
			"extended" : "true"
		},
		"30:0" : {},
		"31:0" : {
			"type" : "dead_bush"
		},
		"31:1" : {
			"type" : "tall_grass"
		},
		"31:2" : {
			"type" : "fern"
		},
		"32:0" : {},
		"33:0" : {
			"facing" : "down",
			"extended" : "false"
		},
		"33:1" : {
			"facing" : "up",
			"extended" : "false"
		},
		"33:2" : {
			"facing" : "north",
			"extended" : "false"
		},
		"33:3" : {
			"facing" : "south",
			"extended" : "false"
		},
		"33:4" : {
			"facing" : "west",
			"extended" : "false"
		},
		"33:5" : {
			"facing" : "east",
			"extended" : "false"
		},
		"33:8" : {
			"facing" : "down",
			"extended" : "true"
		},
		"33:9" : {
			"facing" : "up",
			"extended" : "true"
		},
		"33:10" : {
			"facing" : "north",
			"extended" : "true"
		},
		"33:11" : {
			"facing" : "south",
			"extended" : "true"
		},
		"33:12" : {
			"facing" : "west",
			"extended" : "true"
		},
		"33:13" : {
			"facing" : "east",
			"extended" : "true"
		},
		"34:0" : {
			"facing" : "down",
			"short" : "false",
			"type" : "normal"
		},
		"34:1" : {
			"facing" : "up",
			"short" : "false",
			"type" : "normal"
		},
		"34:2" : {
			"facing" : "north",
			"short" : "false",
			"type" : "normal"
		},
		"34:3" : {
			"facing" : "south",
			"short" : "false",
			"type" : "normal"
		},
		"34:4" : {
			"facing" : "west",
			"short" : "false",
			"type" : "normal"
		},
		"34:5" : {
			"facing" : "east",
			"short" : "false",
			"type" : "normal"
		},
		"34:8" : {
			"facing" : "down",
			"short" : "false",
			"type" : "sticky"
		},
		"34:9" : {
			"facing" : "up",
			"short" : "false",
			"type" : "sticky"
		},
		"34:10" : {
			"facing" : "north",
			"short" : "false",
			"type" : "sticky"
		},
		"34:11" : {
			"facing" : "south",
			"short" : "false",
			"type" : "sticky"
		},
		"34:12" : {
			"facing" : "west",
			"short" : "false",
			"type" : "sticky"
		},
		"34:13" : {
			"facing" : "east",
			"short" : "false",
			"type" : "sticky"
		},
		"35:0" : {
			"color" : "white"
		},
		"35:1" : {
			"color" : "orange"
		},
		"35:2" : {
			"color" : "magenta"
		},
		"35:3" : {
			"color" : "light_blue"
		},
		"35:4" : {
			"color" : "yellow"
		},
		"35:5" : {
			"color" : "lime"
		},
		"35:6" : {
			"color" : "pink"
		},
		"35:7" : {
			"color" : "gray"
		},
		"35:8" : {
			"color" : "silver"
		},
		"35:9" : {
			"color" : "cyan"
		},
		"35:10" : {
			"color" : "purple"
		},
		"35:11" : {
			"color" : "blue"
		},
		"35:12" : {
			"color" : "brown"
		},
		"35:13" : {
			"color" : "green"
		},
		"35:14" : {
			"color" : "red"
		},
		"35:15" : {
			"color" : "black"
		},
		"36:0" : {
			"facing" : "down",
			"type" : "normal"
		},
		"36:1" : {
			"facing" : "up",
			"type" : "normal"
		},
		"36:2" : {
			"facing" : "north",
			"type" : "normal"
		},
		"36:3" : {
			"facing" : "south",
			"type" : "normal"
		},
		"36:4" : {
			"facing" : "west",
			"type" : "normal"
		},
		"36:5" : {
			"facing" : "east",
			"type" : "normal"
		},
		"36:8" : {
			"facing" : "down",
			"type" : "sticky"
		},
		"36:9" : {
			"facing" : "up",
			"type" : "sticky"
		},
		"36:10" : {
			"facing" : "north",
			"type" : "sticky"
		},
		"36:11" : {
			"facing" : "south",
			"type" : "sticky"
		},
		"36:12" : {
			"facing" : "west",
			"type" : "sticky"
		},
		"36:13" : {
			"facing" : "east",
			"type" : "sticky"
		},
		"37:0" : {
			"type" : "dandelion"
		},
		"38:0" : {
			"type" : "poppy"
		},
		"38:1" : {
			"type" : "blue_orchid"
		},
		"38:2" : {
			"type" : "allium"
		},
		"38:3" : {
			"type" : "houstonia"
		},
		"38:4" : {
			"type" : "red_tulip"
		},
		"38:5" : {
			"type" : "orange_tulip"
		},
		"38:6" : {
			"type" : "white_tulip"
		},
		"38:7" : {
			"type" : "pink_tulip"
		},
		"38:8" : {
			"type" : "oxeye_daisy"
		},
		"39:0" : {},
		"40:0" : {},
		"41:0" : {},
		"42:0" : {},
		"43:0" : {
			"variant" : "stone",
			"seamless" : "false"
		},
		"43:1" : {
			"variant" : "sandstone",
			"seamless" : "false"
		},
		"43:2" : {
			"variant" : "wood_old",
			"seamless" : "false"
		},
		"43:3" : {
			"variant" : "cobblestone",
			"seamless" : "false"
		},
		"43:4" : {
			"variant" : "brick",
			"seamless" : "false"
		},
		"43:5" : {
			"variant" : "stone_brick",
			"seamless" : "false"
		},
		"43:6" : {
			"variant" : "nether_brick",
			"seamless" : "false"
		},
		"43:7" : {
			"variant" : "quartz",
			"seamless" : "false"
		},
		"43:8" : {
			"variant" : "stone",
			"seamless" : "true"
		},
		"43:9" : {
			"variant" : "sandstone",
			"seamless" : "true"
		},
		"43:10" : {
			"variant" : "wood_old",
			"seamless" : "true"
		},
		"43:11" : {
			"variant" : "cobblestone",
			"seamless" : "true"
		},
		"43:12" : {
			"variant" : "brick",
			"seamless" : "true"
		},
		"43:13" : {
			"variant" : "stone_brick",
			"seamless" : "true"
		},
		"43:14" : {
			"variant" : "nether_brick",
			"seamless" : "true"
		},
		"43:15" : {
			"variant" : "quartz",
			"seamless" : "true"
		},
		"44:0" : {
			"variant" : "stone",
			"half" : "bottom"
		},
		"44:1" : {
			"variant" : "sandstone",
			"half" : "bottom"
		},
		"44:2" : {
			"variant" : "wood_old",
			"half" : "bottom"
		},
		"44:3" : {
			"variant" : "cobblestone",
			"half" : "bottom"
		},
		"44:4" : {
			"variant" : "brick",
			"half" : "bottom"
		},
		"44:5" : {
			"variant" : "stone_brick",
			"half" : "bottom"
		},
		"44:6" : {
			"variant" : "nether_brick",
			"half" : "bottom"
		},
		"44:7" : {
			"variant" : "quartz",
			"half" : "bottom"
		},
		"44:8" : {
			"variant" : "stone",
			"half" : "top"
		},
		"44:9" : {
			"variant" : "sandstone",
			"half" : "top"
		},
		"44:10" : {
			"variant" : "wood_old",
			"half" : "top"
		},
		"44:11" : {
			"variant" : "cobblestone",
			"half" : "top"
		},
		"44:12" : {
			"variant" : "brick",
			"half" : "top"
		},
		"44:13" : {
			"variant" : "stone_brick",
			"half" : "top"
		},
		"44:14" : {
			"variant" : "nether_brick",
			"half" : "top"
		},
		"44:15" : {
			"variant" : "quartz",
			"half" : "top"
		},
		"45:0" : {},
		"46:0" : {
			"explode" : "false"
		},
		"46:1" : {
			"explode" : "true"
		},
		"47:0" : {},
		"48:0" : {},
		"49:0" : {},
		"50:1" : {
			"facing" : "east"
		},
		"50:2" : {
			"facing" : "west"
		},
		"50:3" : {
			"facing" : "south"
		},
		"50:4" : {
			"facing" : "north"
		},
		"50:5" : {
			"facing" : "up"
		},
		"51:0" : {
			"north" : "false",
			"west" : "false",
			"age" : "0",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:1" : {
			"north" : "false",
			"west" : "false",
			"age" : "1",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:2" : {
			"north" : "false",
			"west" : "false",
			"age" : "2",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:3" : {
			"north" : "false",
			"west" : "false",
			"age" : "3",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:4" : {
			"north" : "false",
			"west" : "false",
			"age" : "4",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:5" : {
			"north" : "false",
			"west" : "false",
			"age" : "5",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:6" : {
			"north" : "false",
			"west" : "false",
			"age" : "6",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:7" : {
			"north" : "false",
			"west" : "false",
			"age" : "7",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:8" : {
			"north" : "false",
			"west" : "false",
			"age" : "8",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:9" : {
			"north" : "false",
			"west" : "false",
			"age" : "9",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:10" : {
			"north" : "false",
			"west" : "false",
			"age" : "10",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:11" : {
			"north" : "false",
			"west" : "false",
			"age" : "11",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:12" : {
			"north" : "false",
			"west" : "false",
			"age" : "12",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:13" : {
			"north" : "false",
			"west" : "false",
			"age" : "13",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:14" : {
			"north" : "false",
			"west" : "false",
			"age" : "14",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"51:15" : {
			"north" : "false",
			"west" : "false",
			"age" : "15",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"52:0" : {},
		"53:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"53:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"53:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"53:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"53:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"53:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"53:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"53:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"54:2" : {
			"facing" : "north"
		},
		"54:3" : {
			"facing" : "south"
		},
		"54:4" : {
			"facing" : "west"
		},
		"54:5" : {
			"facing" : "east"
		},
		"55:0" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "0"
		},
		"55:1" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "1"
		},
		"55:2" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "2"
		},
		"55:3" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "3"
		},
		"55:4" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "4"
		},
		"55:5" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "5"
		},
		"55:6" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "6"
		},
		"55:7" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "7"
		},
		"55:8" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "8"
		},
		"55:9" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "9"
		},
		"55:10" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "10"
		},
		"55:11" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "11"
		},
		"55:12" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "12"
		},
		"55:13" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "13"
		},
		"55:14" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "14"
		},
		"55:15" : {
			"west" : "none",
			"east" : "none",
			"north" : "none",
			"south" : "none",
			"power" : "15"
		},
		"56:0" : {},
		"57:0" : {},
		"58:0" : {},
		"59:0" : {
			"age" : "0"
		},
		"59:1" : {
			"age" : "1"
		},
		"59:2" : {
			"age" : "2"
		},
		"59:3" : {
			"age" : "3"
		},
		"59:4" : {
			"age" : "4"
		},
		"59:5" : {
			"age" : "5"
		},
		"59:6" : {
			"age" : "6"
		},
		"59:7" : {
			"age" : "7"
		},
		"60:0" : {
			"moisture" : "0"
		},
		"60:1" : {
			"moisture" : "1"
		},
		"60:2" : {
			"moisture" : "2"
		},
		"60:3" : {
			"moisture" : "3"
		},
		"60:4" : {
			"moisture" : "4"
		},
		"60:5" : {
			"moisture" : "5"
		},
		"60:6" : {
			"moisture" : "6"
		},
		"60:7" : {
			"moisture" : "7"
		},
		"61:2" : {
			"facing" : "north"
		},
		"61:3" : {
			"facing" : "south"
		},
		"61:4" : {
			"facing" : "west"
		},
		"61:5" : {
			"facing" : "east"
		},
		"62:2" : {
			"facing" : "north"
		},
		"62:3" : {
			"facing" : "south"
		},
		"62:4" : {
			"facing" : "west"
		},
		"62:5" : {
			"facing" : "east"
		},
		"63:0" : {
			"rotation" : "0"
		},
		"63:1" : {
			"rotation" : "1"
		},
		"63:2" : {
			"rotation" : "2"
		},
		"63:3" : {
			"rotation" : "3"
		},
		"63:4" : {
			"rotation" : "4"
		},
		"63:5" : {
			"rotation" : "5"
		},
		"63:6" : {
			"rotation" : "6"
		},
		"63:7" : {
			"rotation" : "7"
		},
		"63:8" : {
			"rotation" : "8"
		},
		"63:9" : {
			"rotation" : "9"
		},
		"63:10" : {
			"rotation" : "10"
		},
		"63:11" : {
			"rotation" : "11"
		},
		"63:12" : {
			"rotation" : "12"
		},
		"63:13" : {
			"rotation" : "13"
		},
		"63:14" : {
			"rotation" : "14"
		},
		"63:15" : {
			"rotation" : "15"
		},
		"64:0" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"64:1" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"64:2" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"64:3" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"64:4" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"64:5" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"64:6" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"64:7" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"64:8" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"64:9" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"64:10" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"64:11" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"65:2" : {
			"facing" : "north"
		},
		"65:3" : {
			"facing" : "south"
		},
		"65:4" : {
			"facing" : "west"
		},
		"65:5" : {
			"facing" : "east"
		},
		"67:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"67:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"67:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"67:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"67:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"67:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"67:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"67:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"68:2" : {
			"facing" : "north"
		},
		"68:3" : {
			"facing" : "south"
		},
		"69:0" : {
			"facing" : "down_x",
			"powered" : "false"
		},
		"69:1" : {
			"facing" : "east",
			"powered" : "false"
		},
		"69:2" : {
			"facing" : "west",
			"powered" : "false"
		},
		"69:3" : {
			"facing" : "south",
			"powered" : "false"
		},
		"69:4" : {
			"facing" : "north",
			"powered" : "false"
		},
		"69:5" : {
			"facing" : "up_z",
			"powered" : "false"
		},
		"69:6" : {
			"facing" : "up_x",
			"powered" : "false"
		},
		"69:7" : {
			"facing" : "down_z",
			"powered" : "false"
		},
		"69:8" : {
			"facing" : "down_x",
			"powered" : "true"
		},
		"69:9" : {
			"facing" : "east",
			"powered" : "true"
		},
		"69:10" : {
			"facing" : "west",
			"powered" : "true"
		},
		"69:11" : {
			"facing" : "south",
			"powered" : "true"
		},
		"69:12" : {
			"facing" : "north",
			"powered" : "true"
		},
		"69:13" : {
			"facing" : "up_z",
			"powered" : "true"
		},
		"69:14" : {
			"facing" : "up_x",
			"powered" : "true"
		},
		"69:15" : {
			"facing" : "down_z",
			"powered" : "true"
		},
		"71:0" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"71:1" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"71:2" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"71:3" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"71:4" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"71:5" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"71:6" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"71:7" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"71:8" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"71:9" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"71:10" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"71:11" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"72:0" : {
			"powered" : "false",
		},
		"72:1" : {
			"powered" : "true",
		},
		"73:0" : {},
		"74:0" : {},
		"79:0" : {},
		"80:0" : {},
		"82:0" : {},
		"84:0" : {
			"has_record" : "false"
		},
		"84:1" : {
			"has_record" : "true"
		},
		"85:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"86:0" : {
			"facing" : "south"
		},
		"86:1" : {
			"facing" : "west"
		},
		"86:2" : {
			"facing" : "north"
		},
		"86:3" : {
			"facing" : "east"
		},
		"87:0" : {},
		"88:0" : {},
		"89:0" : {},
		"90:1" : {
			"axis" : "x"
		},
		"90:2" : {
			"axis" : "z"
		},
		"91:0" : {
			"facing" : "south"
		},
		"91:1" : {
			"facing" : "west"
		},
		"91:2" : {
			"facing" : "north"
		},
		"91:3" : {
			"facing" : "east"
		},
		"92:0" : {
			"bites" : "0"
		},
		"92:1" : {
			"bites" : "1"
		},
		"92:2" : {
			"bites" : "2"
		},
		"92:3" : {
			"bites" : "3"
		},
		"92:4" : {
			"bites" : "4"
		},
		"92:5" : {
			"bites" : "5"
		},
		"92:6" : {
			"bites" : "6"
		},
		"93:0" : {
			"delay" : "1",
			"facing" : "south",
			"locked" : "false"
		},
		"93:1" : {
			"delay" : "1",
			"facing" : "west",
			"locked" : "false"
		},
		"93:2" : {
			"delay" : "1",
			"facing" : "north",
			"locked" : "false"
		},
		"93:3" : {
			"delay" : "1",
			"facing" : "east",
			"locked" : "false"
		},
		"93:4" : {
			"delay" : "2",
			"facing" : "south",
			"locked" : "false"
		},
		"93:5" : {
			"delay" : "2",
			"facing" : "west",
			"locked" : "false"
		},
		"93:6" : {
			"delay" : "2",
			"facing" : "north",
			"locked" : "false"
		},
		"93:7" : {
			"delay" : "2",
			"facing" : "east",
			"locked" : "false"
		},
		"93:8" : {
			"delay" : "3",
			"facing" : "south",
			"locked" : "false"
		},
		"93:9" : {
			"delay" : "3",
			"facing" : "west",
			"locked" : "false"
		},
		"93:10" : {
			"delay" : "3",
			"facing" : "north",
			"locked" : "false"
		},
		"93:11" : {
			"delay" : "3",
			"facing" : "east",
			"locked" : "false"
		},
		"93:12" : {
			"delay" : "4",
			"facing" : "south",
			"locked" : "false"
		},
		"93:13" : {
			"delay" : "4",
			"facing" : "west",
			"locked" : "false"
		},
		"93:14" : {
			"delay" : "4",
			"facing" : "north",
			"locked" : "false"
		},
		"93:15" : {
			"delay" : "4",
			"facing" : "east",
			"locked" : "false"
		},
		"94:0" : {
			"delay" : "1",
			"facing" : "south",
			"locked" : "false"
		},
		"94:1" : {
			"delay" : "1",
			"facing" : "west",
			"locked" : "false"
		},
		"94:2" : {
			"delay" : "1",
			"facing" : "north",
			"locked" : "false"
		},
		"94:3" : {
			"delay" : "1",
			"facing" : "east",
			"locked" : "false"
		},
		"94:4" : {
			"delay" : "2",
			"facing" : "south",
			"locked" : "false"
		},
		"94:5" : {
			"delay" : "2",
			"facing" : "west",
			"locked" : "false"
		},
		"94:6" : {
			"delay" : "2",
			"facing" : "north",
			"locked" : "false"
		},
		"94:7" : {
			"delay" : "2",
			"facing" : "east",
			"locked" : "false"
		},
		"94:8" : {
			"delay" : "3",
			"facing" : "south",
			"locked" : "false"
		},
		"94:9" : {
			"delay" : "3",
			"facing" : "west",
			"locked" : "false"
		},
		"94:10" : {
			"delay" : "3",
			"facing" : "north",
			"locked" : "false"
		},
		"94:11" : {
			"delay" : "3",
			"facing" : "east",
			"locked" : "false"
		},
		"94:12" : {
			"delay" : "4",
			"facing" : "south",
			"locked" : "false"
		},
		"94:13" : {
			"delay" : "4",
			"facing" : "west",
			"locked" : "false"
		},
		"94:14" : {
			"delay" : "4",
			"facing" : "north",
			"locked" : "false"
		},
		"94:15" : {
			"delay" : "4",
			"facing" : "east",
			"locked" : "false"
		},
		"95:0" : {
			"color" : "white"
		},
		"95:1" : {
			"color" : "orange"
		},
		"95:2" : {
			"color" : "magenta"
		},
		"95:3" : {
			"color" : "light_blue"
		},
		"95:4" : {
			"color" : "yellow"
		},
		"95:5" : {
			"color" : "lime"
		},
		"95:6" : {
			"color" : "pink"
		},
		"95:7" : {
			"color" : "gray"
		},
		"95:8" : {
			"color" : "silver"
		},
		"95:9" : {
			"color" : "cyan"
		},
		"95:10" : {
			"color" : "purple"
		},
		"95:11" : {
			"color" : "blue"
		},
		"95:12" : {
			"color" : "brown"
		},
		"95:13" : {
			"color" : "green"
		},
		"95:14" : {
			"color" : "red"
		},
		"95:15" : {
			"color" : "black"
		},
		"96:0" : {
			"facing" : "north",
			"open" : "false",
			"half" : "bottom"
		},
		"96:1" : {
			"facing" : "south",
			"open" : "false",
			"half" : "bottom"
		},
		"96:2" : {
			"facing" : "west",
			"open" : "false",
			"half" : "bottom"
		},
		"96:3" : {
			"facing" : "east",
			"open" : "false",
			"half" : "bottom"
		},
		"96:4" : {
			"facing" : "north",
			"open" : "true",
			"half" : "bottom"
		},
		"96:5" : {
			"facing" : "south",
			"open" : "true",
			"half" : "bottom"
		},
		"96:6" : {
			"facing" : "west",
			"open" : "true",
			"half" : "bottom"
		},
		"96:7" : {
			"facing" : "east",
			"open" : "true",
			"half" : "bottom"
		},
		"96:8" : {
			"facing" : "north",
			"open" : "false",
			"half" : "top"
		},
		"96:9" : {
			"facing" : "south",
			"open" : "false",
			"half" : "top"
		},
		"96:10" : {
			"facing" : "west",
			"open" : "false",
			"half" : "top"
		},
		"96:11" : {
			"facing" : "east",
			"open" : "false",
			"half" : "top"
		},
		"96:12" : {
			"facing" : "north",
			"open" : "true",
			"half" : "top"
		},
		"96:13" : {
			"facing" : "south",
			"open" : "true",
			"half" : "top"
		},
		"96:14" : {
			"facing" : "west",
			"open" : "true",
			"half" : "top"
		},
		"96:15" : {
			"facing" : "east",
			"open" : "true",
			"half" : "top"
		},
		"97:0" : {
			"variant" : "stone"
		},
		"97:1" : {
			"variant" : "cobblestone"
		},
		"97:2" : {
			"variant" : "stone_brick"
		},
		"97:3" : {
			"variant" : "mossy_brick"
		},
		"97:4" : {
			"variant" : "cracked_brick"
		},
		"97:5" : {
			"variant" : "chiseled_brick"
		},
		"98:0" : {
			"variant" : "stonebrick"
		},
		"98:1" : {
			"variant" : "mossy_stonebrick"
		},
		"98:2" : {
			"variant" : "cracked_stonebrick"
		},
		"98:3" : {
			"variant" : "chiseled_stonebrick"
		},
		"99:0" : {
			"variant" : "all_inside"
		},
		"99:1" : {
			"variant" : "north_west"
		},
		"99:2" : {
			"variant" : "north"
		},
		"99:3" : {
			"variant" : "north_east"
		},
		"99:4" : {
			"variant" : "west"
		},
		"99:5" : {
			"variant" : "center"
		},
		"99:6" : {
			"variant" : "east"
		},
		"99:7" : {
			"variant" : "south_west"
		},
		"99:8" : {
			"variant" : "south"
		},
		"99:9" : {
			"variant" : "south_east"
		},
		"99:10" : {
			"variant" : "stem"
		},
		"99:14" : {
			"variant" : "all_outside"
		},
		"99:15" : {
			"variant" : "all_stem"
		},
		"100:0" : {
			"variant" : "all_inside"
		},
		"100:1" : {
			"variant" : "north_west"
		},
		"100:2" : {
			"variant" : "north"
		},
		"100:3" : {
			"variant" : "north_east"
		},
		"100:4" : {
			"variant" : "west"
		},
		"100:5" : {
			"variant" : "center"
		},
		"100:6" : {
			"variant" : "east"
		},
		"100:7" : {
			"variant" : "south_west"
		},
		"100:8" : {
			"variant" : "south"
		},
		"100:9" : {
			"variant" : "south_east"
		},
		"100:10" : {
			"variant" : "stem"
		},
		"100:14" : {
			"variant" : "all_outside"
		},
		"100:15" : {
			"variant" : "all_stem"
		},
		"101:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"102:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"103:0" : {},
		"104:0" : {
			"facing" : "up",
			"age" : "0"
		},
		"104:1" : {
			"facing" : "up",
			"age" : "1"
		},
		"104:2" : {
			"facing" : "up",
			"age" : "2"
		},
		"104:3" : {
			"facing" : "up",
			"age" : "3"
		},
		"104:4" : {
			"facing" : "up",
			"age" : "4"
		},
		"104:5" : {
			"facing" : "up",
			"age" : "5"
		},
		"104:6" : {
			"facing" : "up",
			"age" : "6"
		},
		"104:7" : {
			"facing" : "up",
			"age" : "7"
		},
		"105:0" : {
			"facing" : "up",
			"age" : "0"
		},
		"105:1" : {
			"facing" : "up",
			"age" : "1"
		},
		"105:2" : {
			"facing" : "up",
			"age" : "2"
		},
		"105:3" : {
			"facing" : "up",
			"age" : "3"
		},
		"105:4" : {
			"facing" : "up",
			"age" : "4"
		},
		"105:5" : {
			"facing" : "up",
			"age" : "5"
		},
		"105:6" : {
			"facing" : "up",
			"age" : "6"
		},
		"105:7" : {
			"facing" : "up",
			"age" : "7"
		},
		"106:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"up" : "false",
			"south" : "false"
		},
		"106:1" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"up" : "false",
			"south" : "true"
		},
		"106:2" : {
			"west" : "true",
			"east" : "false",
			"north" : "false",
			"up" : "false",
			"south" : "false"
		},
		"106:3" : {
			"west" : "true",
			"east" : "false",
			"north" : "false",
			"up" : "false",
			"south" : "true"
		},
		"106:4" : {
			"west" : "false",
			"east" : "false",
			"north" : "true",
			"up" : "false",
			"south" : "false"
		},
		"106:5" : {
			"west" : "false",
			"east" : "false",
			"north" : "true",
			"up" : "false",
			"south" : "true"
		},
		"106:6" : {
			"west" : "true",
			"east" : "false",
			"north" : "true",
			"up" : "false",
			"south" : "false"
		},
		"106:7" : {
			"west" : "true",
			"east" : "false",
			"north" : "true",
			"up" : "false",
			"south" : "true"
		},
		"106:8" : {
			"west" : "false",
			"east" : "true",
			"north" : "false",
			"up" : "false",
			"south" : "false"
		},
		"106:9" : {
			"west" : "false",
			"east" : "true",
			"north" : "false",
			"up" : "false",
			"south" : "true"
		},
		"106:10" : {
			"west" : "true",
			"east" : "true",
			"north" : "false",
			"up" : "false",
			"south" : "false"
		},
		"106:11" : {
			"west" : "true",
			"east" : "true",
			"north" : "false",
			"up" : "false",
			"south" : "true"
		},
		"106:12" : {
			"west" : "false",
			"east" : "true",
			"north" : "true",
			"up" : "false",
			"south" : "false"
		},
		"106:13" : {
			"west" : "false",
			"east" : "true",
			"north" : "true",
			"up" : "false",
			"south" : "true"
		},
		"106:14" : {
			"west" : "true",
			"east" : "true",
			"north" : "true",
			"up" : "false",
			"south" : "false"
		},
		"106:15" : {
			"west" : "true",
			"east" : "true",
			"north" : "true",
			"up" : "false",
			"south" : "true"
		},
		"107:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"107:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"107:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"107:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"107:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"107:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"107:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"107:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"107:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"107:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"107:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"107:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"107:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"107:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"107:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"107:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"108:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"108:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"108:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"108:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"108:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"108:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"108:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"108:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"109:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"109:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"109:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"109:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"109:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"109:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"109:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"109:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"110:0" : {
			"snowy" : "false"
		},
		"111:0" : {},
		"112:0" : {},
		"113:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"114:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"114:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"114:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"114:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"114:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"114:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"114:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"114:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"115:0" : {
			"age" : "0"
		},
		"115:1" : {
			"age" : "1"
		},
		"115:2" : {
			"age" : "2"
		},
		"115:3" : {
			"age" : "3"
		},
		"116:0" : {},
		"117:0" : {
			"has_bottle_2" : "false",
			"has_bottle_0" : "false",
			"has_bottle_1" : "false"
		},
		"117:1" : {
			"has_bottle_2" : "false",
			"has_bottle_0" : "true",
			"has_bottle_1" : "false"
		},
		"117:2" : {
			"has_bottle_2" : "false",
			"has_bottle_0" : "false",
			"has_bottle_1" : "true"
		},
		"117:3" : {
			"has_bottle_2" : "false",
			"has_bottle_0" : "true",
			"has_bottle_1" : "true"
		},
		"117:4" : {
			"has_bottle_2" : "true",
			"has_bottle_0" : "false",
			"has_bottle_1" : "false"
		},
		"117:5" : {
			"has_bottle_2" : "true",
			"has_bottle_0" : "true",
			"has_bottle_1" : "false"
		},
		"117:6" : {
			"has_bottle_2" : "true",
			"has_bottle_0" : "false",
			"has_bottle_1" : "true"
		},
		"117:7" : {
			"has_bottle_2" : "true",
			"has_bottle_0" : "true",
			"has_bottle_1" : "true"
		},
		"118:0" : {
			"level" : "0"
		},
		"118:1" : {
			"level" : "1"
		},
		"118:2" : {
			"level" : "2"
		},
		"118:3" : {
			"level" : "3"
		},
		"119:0" : {},
		"120:0" : {
			"facing" : "south",
			"eye" : "false"
		},
		"120:1" : {
			"facing" : "west",
			"eye" : "false"
		},
		"120:2" : {
			"facing" : "north",
			"eye" : "false"
		},
		"120:3" : {
			"facing" : "east",
			"eye" : "false"
		},
		"120:4" : {
			"facing" : "south",
			"eye" : "true"
		},
		"120:5" : {
			"facing" : "west",
			"eye" : "true"
		},
		"120:6" : {
			"facing" : "north",
			"eye" : "true"
		},
		"120:7" : {
			"facing" : "east",
			"eye" : "true"
		},
		"121:0" : {},
		"122:0" : {},
		"123:0" : {},
		"124:0" : {},
		"125:0" : {
			"variant" : "oak"
		},
		"125:1" : {
			"variant" : "spruce"
		},
		"125:2" : {
			"variant" : "birch"
		},
		"125:3" : {
			"variant" : "jungle"
		},
		"125:4" : {
			"variant" : "acacia"
		},
		"125:5" : {
			"variant" : "dark_oak"
		},
		"126:0" : {
			"variant" : "oak",
			"half" : "bottom"
		},
		"126:1" : {
			"variant" : "spruce",
			"half" : "bottom"
		},
		"126:2" : {
			"variant" : "birch",
			"half" : "bottom"
		},
		"126:3" : {
			"variant" : "jungle",
			"half" : "bottom"
		},
		"126:4" : {
			"variant" : "acacia",
			"half" : "bottom"
		},
		"126:5" : {
			"variant" : "dark_oak",
			"half" : "bottom"
		},
		"126:8" : {
			"variant" : "oak",
			"half" : "top"
		},
		"126:9" : {
			"variant" : "spruce",
			"half" : "top"
		},
		"126:10" : {
			"variant" : "birch",
			"half" : "top"
		},
		"126:11" : {
			"variant" : "jungle",
			"half" : "top"
		},
		"126:12" : {
			"variant" : "acacia",
			"half" : "top"
		},
		"126:13" : {
			"variant" : "dark_oak",
			"half" : "top"
		},
		"127:0" : {
			"facing" : "south",
			"age" : "0"
		},
		"127:1" : {
			"facing" : "west",
			"age" : "0"
		},
		"127:2" : {
			"facing" : "north",
			"age" : "0"
		},
		"127:3" : {
			"facing" : "east",
			"age" : "0"
		},
		"127:4" : {
			"facing" : "south",
			"age" : "1"
		},
		"127:5" : {
			"facing" : "west",
			"age" : "1"
		},
		"127:6" : {
			"facing" : "north",
			"age" : "1"
		},
		"127:7" : {
			"facing" : "east",
			"age" : "1"
		},
		"127:8" : {
			"facing" : "south",
			"age" : "2"
		},
		"127:9" : {
			"facing" : "west",
			"age" : "2"
		},
		"127:10" : {
			"facing" : "north",
			"age" : "2"
		},
		"127:11" : {
			"facing" : "east",
			"age" : "2"
		},
		"128:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"128:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"128:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"128:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"128:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"128:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"128:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"128:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"129:0" : {},
		"130:2" : {
			"facing" : "north"
		},
		"130:3" : {
			"facing" : "south"
		},
		"130:4" : {
			"facing" : "west"
		},
		"130:5" : {
			"facing" : "east"
		},
		"131:0" : {
			"facing" : "south",
			"attached" : "false",
			"powered" : "false"
		},
		"131:1" : {
			"facing" : "west",
			"attached" : "false",
			"powered" : "false"
		},
		"131:2" : {
			"facing" : "north",
			"attached" : "false",
			"powered" : "false"
		},
		"131:3" : {
			"facing" : "east",
			"attached" : "false",
			"powered" : "false"
		},
		"131:4" : {
			"facing" : "south",
			"attached" : "true",
			"powered" : "false"
		},
		"131:5" : {
			"facing" : "west",
			"attached" : "true",
			"powered" : "false"
		},
		"131:6" : {
			"facing" : "north",
			"attached" : "true",
			"powered" : "false"
		},
		"131:7" : {
			"facing" : "east",
			"attached" : "true",
			"powered" : "false"
		},
		"131:8" : {
			"facing" : "south",
			"attached" : "false",
			"powered" : "true"
		},
		"131:9" : {
			"facing" : "west",
			"attached" : "false",
			"powered" : "true"
		},
		"131:10" : {
			"facing" : "north",
			"attached" : "false",
			"powered" : "true"
		},
		"131:11" : {
			"facing" : "east",
			"attached" : "false",
			"powered" : "true"
		},
		"131:12" : {
			"facing" : "south",
			"attached" : "true",
			"powered" : "true"
		},
		"131:13" : {
			"facing" : "west",
			"attached" : "true",
			"powered" : "true"
		},
		"131:14" : {
			"facing" : "north",
			"attached" : "true",
			"powered" : "true"
		},
		"131:15" : {
			"facing" : "east",
			"attached" : "true",
			"powered" : "true"
		},
		"132:14" : {
			"north" : "false",
			"powered" : "false",
			"west" : "false",
			"attached" : "false",
			"east" : "false",
			"disarmed" : "false",
			"south" : "false"
		},
		"132:13" : {
			"north" : "false",
			"powered" : "true",
			"west" : "false",
			"attached" : "true",
			"east" : "false",
			"disarmed" : "true",
			"south" : "false"
		},
		"133:0" : {},
		"134:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"134:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"134:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"134:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"134:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"134:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"134:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"134:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"135:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"135:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"135:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"135:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"135:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"135:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"135:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"135:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"136:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"136:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"136:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"136:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"136:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"136:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"136:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"136:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"137:0" : {
			"facing" : "down",
			"conditional" : "false"
		},
		"137:1" : {
			"facing" : "up",
			"conditional" : "false"
		},
		"137:2" : {
			"facing" : "north",
			"conditional" : "false"
		},
		"137:3" : {
			"facing" : "south",
			"conditional" : "false"
		},
		"137:4" : {
			"facing" : "west",
			"conditional" : "false"
		},
		"137:5" : {
			"facing" : "east",
			"conditional" : "false"
		},
		"137:8" : {
			"facing" : "down",
			"conditional" : "true"
		},
		"137:9" : {
			"facing" : "up",
			"conditional" : "true"
		},
		"137:10" : {
			"facing" : "north",
			"conditional" : "true"
		},
		"137:11" : {
			"facing" : "south",
			"conditional" : "true"
		},
		"137:12" : {
			"facing" : "west",
			"conditional" : "true"
		},
		"137:13" : {
			"facing" : "east",
			"conditional" : "true"
		},
		"138:0" : {},
		"139:0" : {
			"north" : "false",
			"west" : "false",
			"variant" : "cobblestone",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"139:1" : {
			"north" : "false",
			"west" : "false",
			"variant" : "mossy_cobblestone",
			"up" : "false",
			"east" : "false",
			"south" : "false"
		},
		"141:0" : {
			"age" : "0"
		},
		"141:1" : {
			"age" : "1"
		},
		"141:2" : {
			"age" : "2"
		},
		"141:3" : {
			"age" : "3"
		},
		"141:4" : {
			"age" : "4"
		},
		"141:5" : {
			"age" : "5"
		},
		"141:6" : {
			"age" : "6"
		},
		"141:7" : {
			"age" : "7"
		},
		"144:0" : {
			"facing" : "down",
			"nodrop" : "false"
		},
		"144:1" : {
			"facing" : "up",
			"nodrop" : "false"
		},
		"144:2" : {
			"facing" : "north",
			"nodrop" : "false"
		},
		"144:3" : {
			"facing" : "south",
			"nodrop" : "false"
		},
		"144:4" : {
			"facing" : "west",
			"nodrop" : "false"
		},
		"144:5" : {
			"facing" : "east",
			"nodrop" : "false"
		},
		"144:8" : {
			"facing" : "down",
			"nodrop" : "true"
		},
		"144:9" : {
			"facing" : "up",
			"nodrop" : "true"
		},
		"144:10" : {
			"facing" : "north",
			"nodrop" : "true"
		},
		"144:11" : {
			"facing" : "south",
			"nodrop" : "true"
		},
		"144:12" : {
			"facing" : "west",
			"nodrop" : "true"
		},
		"144:13" : {
			"facing" : "east",
			"nodrop" : "true"
		},
		"146:2" : {
			"facing" : "north"
		},
		"146:3" : {
			"facing" : "south"
		},
		"146:4" : {
			"facing" : "west"
		},
		"146:5" : {
			"facing" : "east"
		},
		"151:0" : {
			"power" : "0"
		},
		"151:1" : {
			"power" : "1"
		},
		"151:2" : {
			"power" : "2"
		},
		"151:3" : {
			"power" : "3"
		},
		"151:4" : {
			"power" : "4"
		},
		"151:5" : {
			"power" : "5"
		},
		"151:6" : {
			"power" : "6"
		},
		"151:7" : {
			"power" : "7"
		},
		"151:8" : {
			"power" : "8"
		},
		"151:9" : {
			"power" : "9"
		},
		"151:10" : {
			"power" : "10"
		},
		"151:11" : {
			"power" : "11"
		},
		"151:12" : {
			"power" : "12"
		},
		"151:13" : {
			"power" : "13"
		},
		"151:14" : {
			"power" : "14"
		},
		"151:15" : {
			"power" : "15"
		},
		"152:0" : {},
		"153:0" : {},
		"154:0" : {
			"facing" : "down",
			"enabled" : "false"
		},
		"154:10" : {
			"facing" : "north",
			"enabled" : "true"
		},
		"154:11" : {
			"facing" : "south",
			"enabled" : "true"
		},
		"154:12" : {
			"facing" : "west",
			"enabled" : "true"
		},
		"154:13" : {
			"facing" : "east",
			"enabled" : "true"
		},
		"154:8" : {
			"facing" : "down",
			"enabled" : "true"
		},
		"155:0" : {
			"variant" : "default"
		},
		"155:1" : {
			"variant" : "chiseled"
		},
		"155:2" : {
			"variant" : "lines_y"
		},
		"155:3" : {
			"variant" : "lines_x"
		},
		"155:4" : {
			"variant" : "lines_z"
		},
		"156:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"156:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"156:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"156:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"156:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"156:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"156:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"156:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"157:0" : {
			"shape" : "north_south",
			"powered" : "false"
		},
		"157:1" : {
			"shape" : "east_west",
			"powered" : "false"
		},
		"157:2" : {
			"shape" : "ascending_east",
			"powered" : "false"
		},
		"157:3" : {
			"shape" : "ascending_west",
			"powered" : "false"
		},
		"157:4" : {
			"shape" : "ascending_north",
			"powered" : "false"
		},
		"157:5" : {
			"shape" : "ascending_south",
			"powered" : "false"
		},
		"157:8" : {
			"shape" : "north_south",
			"powered" : "true"
		},
		"157:9" : {
			"shape" : "east_west",
			"powered" : "true"
		},
		"157:10" : {
			"shape" : "ascending_east",
			"powered" : "true"
		},
		"157:11" : {
			"shape" : "ascending_west",
			"powered" : "true"
		},
		"157:12" : {
			"shape" : "ascending_north",
			"powered" : "true"
		},
		"157:13" : {
			"shape" : "ascending_south",
			"powered" : "true"
		},
		"158:0" : {
			"facing" : "down",
			"triggered" : "false"
		},
		"158:1" : {
			"facing" : "up",
			"triggered" : "false"
		},
		"158:2" : {
			"facing" : "north",
			"triggered" : "false"
		},
		"158:3" : {
			"facing" : "south",
			"triggered" : "false"
		},
		"158:4" : {
			"facing" : "west",
			"triggered" : "false"
		},
		"158:5" : {
			"facing" : "east",
			"triggered" : "false"
		},
		"158:8" : {
			"facing" : "down",
			"triggered" : "true"
		},
		"158:9" : {
			"facing" : "up",
			"triggered" : "true"
		},
		"158:10" : {
			"facing" : "north",
			"triggered" : "true"
		},
		"158:11" : {
			"facing" : "south",
			"triggered" : "true"
		},
		"158:12" : {
			"facing" : "west",
			"triggered" : "true"
		},
		"158:13" : {
			"facing" : "east",
			"triggered" : "true"
		},
		"159:0" : {
			"color" : "white"
		},
		"159:1" : {
			"color" : "orange"
		},
		"159:2" : {
			"color" : "magenta"
		},
		"159:3" : {
			"color" : "light_blue"
		},
		"159:4" : {
			"color" : "yellow"
		},
		"159:5" : {
			"color" : "lime"
		},
		"159:6" : {
			"color" : "pink"
		},
		"159:7" : {
			"color" : "gray"
		},
		"159:8" : {
			"color" : "silver"
		},
		"159:9" : {
			"color" : "cyan"
		},
		"159:10" : {
			"color" : "purple"
		},
		"159:11" : {
			"color" : "blue"
		},
		"159:12" : {
			"color" : "brown"
		},
		"159:13" : {
			"color" : "green"
		},
		"159:14" : {
			"color" : "red"
		},
		"159:15" : {
			"color" : "black"
		},
		"160:0" : {
			"color" : "white",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:1" : {
			"color" : "orange",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:2" : {
			"color" : "magenta",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:3" : {
			"color" : "light_blue",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:4" : {
			"color" : "yellow",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:5" : {
			"color" : "lime",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:6" : {
			"color" : "pink",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:7" : {
			"color" : "gray",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:8" : {
			"color" : "silver",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:9" : {
			"color" : "cyan",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:10" : {
			"color" : "purple",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:11" : {
			"color" : "blue",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:12" : {
			"color" : "brown",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:13" : {
			"color" : "green",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:14" : {
			"color" : "red",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"160:15" : {
			"color" : "black",
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"161:0" : {
			"variant" : "acacia",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"161:1" : {
			"variant" : "dark_oak",
			"check_decay" : "false",
			"decayable" : "true"
		},
		"161:4" : {
			"variant" : "acacia",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"161:5" : {
			"variant" : "dark_oak",
			"check_decay" : "false",
			"decayable" : "false"
		},
		"161:8" : {
			"variant" : "acacia",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"161:9" : {
			"variant" : "dark_oak",
			"check_decay" : "true",
			"decayable" : "true"
		},
		"161:12" : {
			"variant" : "acacia",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"161:13" : {
			"variant" : "dark_oak",
			"check_decay" : "true",
			"decayable" : "false"
		},
		"162:0" : {
			"variant" : "acacia",
			"axis" : "y"
		},
		"162:1" : {
			"variant" : "dark_oak",
			"axis" : "y"
		},
		"162:4" : {
			"variant" : "acacia",
			"axis" : "x"
		},
		"162:5" : {
			"variant" : "dark_oak",
			"axis" : "x"
		},
		"162:8" : {
			"variant" : "acacia",
			"axis" : "z"
		},
		"162:9" : {
			"variant" : "dark_oak",
			"axis" : "z"
		},
		"162:12" : {
			"variant" : "acacia",
			"axis" : "none"
		},
		"162:13" : {
			"variant" : "dark_oak",
			"axis" : "none"
		},
		"163:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"163:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"163:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"163:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"163:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"163:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"163:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"163:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"164:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"164:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"164:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"164:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"164:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"164:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"164:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"164:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"165:0" : {},
		"166:0" : {},
		"167:0" : {
			"facing" : "north",
			"open" : "false",
			"half" : "bottom"
		},
		"167:1" : {
			"facing" : "south",
			"open" : "false",
			"half" : "bottom"
		},
		"167:2" : {
			"facing" : "west",
			"open" : "false",
			"half" : "bottom"
		},
		"167:3" : {
			"facing" : "east",
			"open" : "false",
			"half" : "bottom"
		},
		"167:4" : {
			"facing" : "north",
			"open" : "true",
			"half" : "bottom"
		},
		"167:5" : {
			"facing" : "south",
			"open" : "true",
			"half" : "bottom"
		},
		"167:6" : {
			"facing" : "west",
			"open" : "true",
			"half" : "bottom"
		},
		"167:7" : {
			"facing" : "east",
			"open" : "true",
			"half" : "bottom"
		},
		"167:8" : {
			"facing" : "north",
			"open" : "false",
			"half" : "top"
		},
		"167:9" : {
			"facing" : "south",
			"open" : "false",
			"half" : "top"
		},
		"167:10" : {
			"facing" : "west",
			"open" : "false",
			"half" : "top"
		},
		"167:11" : {
			"facing" : "east",
			"open" : "false",
			"half" : "top"
		},
		"167:12" : {
			"facing" : "north",
			"open" : "true",
			"half" : "top"
		},
		"167:13" : {
			"facing" : "south",
			"open" : "true",
			"half" : "top"
		},
		"167:14" : {
			"facing" : "west",
			"open" : "true",
			"half" : "top"
		},
		"167:15" : {
			"facing" : "east",
			"open" : "true",
			"half" : "top"
		},
		"168:0" : {
			"variant" : "prismarine"
		},
		"168:1" : {
			"variant" : "prismarine_bricks"
		},
		"168:2" : {
			"variant" : "dark_prismarine"
		},
		"169:0" : {},
		"170:0" : {
			"axis" : "y"
		},
		"170:4" : {
			"axis" : "x"
		},
		"170:8" : {
			"axis" : "z"
		},
		"171:0" : {
			"color" : "white"
		},
		"171:1" : {
			"color" : "orange"
		},
		"171:2" : {
			"color" : "magenta"
		},
		"171:3" : {
			"color" : "light_blue"
		},
		"171:4" : {
			"color" : "yellow"
		},
		"171:5" : {
			"color" : "lime"
		},
		"171:6" : {
			"color" : "pink"
		},
		"171:7" : {
			"color" : "gray"
		},
		"171:8" : {
			"color" : "silver"
		},
		"171:9" : {
			"color" : "cyan"
		},
		"171:10" : {
			"color" : "purple"
		},
		"171:11" : {
			"color" : "blue"
		},
		"171:12" : {
			"color" : "brown"
		},
		"171:13" : {
			"color" : "green"
		},
		"171:14" : {
			"color" : "red"
		},
		"171:15" : {
			"color" : "black"
		},
		"172:0" : {},
		"173:0" : {},
		"174:0" : {},
		"175:11" : {
			"facing" : "north",
			"variant" : "sunflower",
			"half" : "lower"
		},
		"175:1" : {
			"facing" : "north",
			"variant" : "syringa",
			"half" : "lower"
		},
		"175:2" : {
			"facing" : "north",
			"variant" : "double_grass",
			"half" : "lower"
		},
		"175:3" : {
			"facing" : "north",
			"variant" : "double_fern",
			"half" : "lower"
		},
		"175:4" : {
			"facing" : "north",
			"variant" : "double_rose",
			"half" : "lower"
		},
		"175:5" : {
			"facing" : "north",
			"variant" : "paeonia",
			"half" : "lower"
		},
		"175:8" : {
			"facing" : "north",
			"variant" : "sunflower",
			"half" : "upper"
		},
		"176:0" : {
			"rotation" : "0"
		},
		"176:1" : {
			"rotation" : "1"
		},
		"176:2" : {
			"rotation" : "2"
		},
		"176:3" : {
			"rotation" : "3"
		},
		"176:4" : {
			"rotation" : "4"
		},
		"176:5" : {
			"rotation" : "5"
		},
		"176:6" : {
			"rotation" : "6"
		},
		"176:7" : {
			"rotation" : "7"
		},
		"176:8" : {
			"rotation" : "8"
		},
		"176:9" : {
			"rotation" : "9"
		},
		"176:10" : {
			"rotation" : "10"
		},
		"176:11" : {
			"rotation" : "11"
		},
		"176:12" : {
			"rotation" : "12"
		},
		"176:13" : {
			"rotation" : "13"
		},
		"176:14" : {
			"rotation" : "14"
		},
		"176:15" : {
			"rotation" : "15"
		},
		"177:2" : {
			"facing" : "north"
		},
		"177:3" : {
			"facing" : "south"
		},
		"177:4" : {
			"facing" : "west"
		},
		"177:5" : {
			"facing" : "east"
		},
		"178:0" : {
			"power" : "0"
		},
		"178:1" : {
			"power" : "1"
		},
		"178:2" : {
			"power" : "2"
		},
		"178:3" : {
			"power" : "3"
		},
		"178:4" : {
			"power" : "4"
		},
		"178:5" : {
			"power" : "5"
		},
		"178:6" : {
			"power" : "6"
		},
		"178:7" : {
			"power" : "7"
		},
		"178:8" : {
			"power" : "8"
		},
		"178:9" : {
			"power" : "9"
		},
		"178:10" : {
			"power" : "10"
		},
		"178:11" : {
			"power" : "11"
		},
		"178:12" : {
			"power" : "12"
		},
		"178:13" : {
			"power" : "13"
		},
		"178:14" : {
			"power" : "14"
		},
		"178:15" : {
			"power" : "15"
		},
		"179:0" : {
			"type" : "red_sandstone"
		},
		"179:1" : {
			"type" : "chiseled_red_sandstone"
		},
		"179:2" : {
			"type" : "smooth_red_sandstone"
		},
		"180:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"180:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"180:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"180:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"180:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"180:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"180:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"180:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"181:0" : {
			"variant" : "red_sandstone",
			"seamless" : "false"
		},
		"181:8" : {
			"variant" : "red_sandstone",
			"seamless" : "true"
		},
		"182:0" : {
			"variant" : "red_sandstone",
			"half" : "bottom"
		},
		"182:8" : {
			"variant" : "red_sandstone",
			"half" : "top"
		},
		"183:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"183:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"183:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"183:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"183:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"183:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"183:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"183:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"183:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"183:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"183:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"183:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"183:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"183:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"183:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"183:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"184:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"184:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"184:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"184:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"184:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"184:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"184:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"184:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"184:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"184:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"184:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"184:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"184:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"184:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"184:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"184:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"185:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"185:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"185:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"185:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"185:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"185:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"185:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"185:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"185:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"185:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"185:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"185:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"185:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"185:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"185:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"185:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"186:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"186:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"186:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"186:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"186:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"186:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"186:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"186:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"186:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"186:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"186:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"186:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"186:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"186:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"186:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"186:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"187:0" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"187:1" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"187:2" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"187:3" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "false"
		},
		"187:4" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"187:5" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"187:6" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"187:7" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "false"
		},
		"187:8" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"187:9" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"187:10" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"187:11" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "false",
			"powered" : "true"
		},
		"187:12" : {
			"facing" : "south",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"187:13" : {
			"facing" : "west",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"187:14" : {
			"facing" : "north",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"187:15" : {
			"facing" : "east",
			"in_wall" : "false",
			"open" : "true",
			"powered" : "true"
		},
		"188:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"189:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"190:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"191:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"192:0" : {
			"west" : "false",
			"east" : "false",
			"north" : "false",
			"south" : "false"
		},
		"193:0" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"193:1" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"193:2" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"193:3" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"193:4" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"193:5" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"193:6" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"193:7" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"193:8" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"193:9" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"193:10" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"193:11" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"195:0" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"195:1" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"195:2" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"195:3" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"195:4" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"195:5" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"195:6" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"195:7" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"195:8" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"195:9" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"195:10" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"195:11" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"197:0" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"197:1" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"197:2" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"197:3" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "lower"
		},
		"197:4" : {
			"facing" : "east",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"197:5" : {
			"facing" : "south",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"197:6" : {
			"facing" : "west",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"197:7" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "true",
			"half" : "lower"
		},
		"197:8" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"197:9" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "false",
			"open" : "false",
			"half" : "upper"
		},
		"197:10" : {
			"facing" : "north",
			"hinge" : "left",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"197:11" : {
			"facing" : "north",
			"hinge" : "right",
			"powered" : "true",
			"open" : "false",
			"half" : "upper"
		},
		"198:0" : {
			"facing" : "down"
		},
		"198:1" : {
			"facing" : "up"
		},
		"198:2" : {
			"facing" : "north"
		},
		"198:3" : {
			"facing" : "south"
		},
		"198:4" : {
			"facing" : "west"
		},
		"198:5" : {
			"facing" : "east"
		},
		"199:0" : {
			"north" : "false",
			"west" : "false",
			"up" : "false",
			"down" : "false",
			"east" : "false",
			"south" : "false"
		},
		"200:0" : {
			"age" : "0"
		},
		"200:1" : {
			"age" : "1"
		},
		"200:2" : {
			"age" : "2"
		},
		"200:3" : {
			"age" : "3"
		},
		"200:4" : {
			"age" : "4"
		},
		"200:5" : {
			"age" : "5"
		},
		"201:0" : {},
		"202:0" : {
			"axis" : "y"
		},
		"202:4" : {
			"axis" : "x"
		},
		"202:8" : {
			"axis" : "z"
		},
		"203:0" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "bottom"
		},
		"203:1" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "bottom"
		},
		"203:2" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "bottom"
		},
		"203:3" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "bottom"
		},
		"203:4" : {
			"facing" : "east",
			"shape" : "straight",
			"half" : "top"
		},
		"203:5" : {
			"facing" : "west",
			"shape" : "straight",
			"half" : "top"
		},
		"203:6" : {
			"facing" : "south",
			"shape" : "straight",
			"half" : "top"
		},
		"203:7" : {
			"facing" : "north",
			"shape" : "straight",
			"half" : "top"
		},
		"204:0" : {
			"variant" : "default"
		},
		"205:0" : {
			"variant" : "default",
			"half" : "bottom"
		},
		"205:8" : {
			"variant" : "default",
			"half" : "top"
		},
		"206:0" : {},
		"208:0" : {},
		"209:0" : {},
		"210:0" : {
			"facing" : "down",
			"conditional" : "false"
		},
		"210:1" : {
			"facing" : "up",
			"conditional" : "false"
		},
		"210:2" : {
			"facing" : "north",
			"conditional" : "false"
		},
		"210:3" : {
			"facing" : "south",
			"conditional" : "false"
		},
		"210:4" : {
			"facing" : "west",
			"conditional" : "false"
		},
		"210:5" : {
			"facing" : "east",
			"conditional" : "false"
		},
		"210:8" : {
			"facing" : "down",
			"conditional" : "true"
		},
		"210:9" : {
			"facing" : "up",
			"conditional" : "true"
		},
		"210:10" : {
			"facing" : "north",
			"conditional" : "true"
		},
		"210:11" : {
			"facing" : "south",
			"conditional" : "true"
		},
		"210:12" : {
			"facing" : "west",
			"conditional" : "true"
		},
		"210:13" : {
			"facing" : "east",
			"conditional" : "true"
		},
		"211:0" : {
			"facing" : "down",
			"conditional" : "false"
		},
		"211:1" : {
			"facing" : "up",
			"conditional" : "false"
		},
		"211:2" : {
			"facing" : "north",
			"conditional" : "false"
		},
		"211:3" : {
			"facing" : "south",
			"conditional" : "false"
		},
		"211:4" : {
			"facing" : "west",
			"conditional" : "false"
		},
		"211:5" : {
			"facing" : "east",
			"conditional" : "false"
		},
		"211:8" : {
			"facing" : "down",
			"conditional" : "true"
		},
		"211:9" : {
			"facing" : "up",
			"conditional" : "true"
		},
		"211:10" : {
			"facing" : "north",
			"conditional" : "true"
		},
		"211:11" : {
			"facing" : "south",
			"conditional" : "true"
		},
		"211:12" : {
			"facing" : "west",
			"conditional" : "true"
		},
		"211:13" : {
			"facing" : "east",
			"conditional" : "true"
		},
		"212:0" : {
			"age" : "0"
		},
		"212:1" : {
			"age" : "1"
		},
		"212:2" : {
			"age" : "2"
		},
		"212:3" : {
			"age" : "3"
		},
		"213:0" : {},
		"214:0" : {},
		"215:0" : {},
		"216:0" : {
			"axis" : "y"
		},
		"216:4" : {
			"axis" : "x"
		},
		"216:8" : {
			"axis" : "z"
		},
		"217:0" : {},
		"255:0" : {
			"mode" : "save"
		},
		"255:1" : {
			"mode" : "load"
		},
		"255:2" : {
			"mode" : "corner"
		},
		"255:3" : {
			"mode" : "data"
		}
	},
	blockIcons: {
        '0': 0,
        '1': 1,
        '1:1': 2,
        '1:2': 3,
        '1:3': 4,
        '1:4': 5,
        '1:5': 6,
        '1:6': 7,
        '2': 8,
        '3': 9,
        '3:1': 10,
        '3:2': 11,
        '4': 12,
        '5': 13,
        '5:1': 14,
        '5:2': 15,
        '5:3': 16,
        '5:4': 17,
        '5:5': 18,
        '6': 19,
        '6:1': 20,
        '6:2': 21,
        '6:3': 22,
        '6:4': 23,
        '6:5': 24,
        '7': 25,
        '8': 26,
        '9': 27,
        '10': 28,
        '11': 29,
        '12': 30,
        '12:1': 31,
        '13': 32,
        '14': 33,
        '15': 34,
        '16': 35,
        '17': 36,
        '17:1': 37,
        '17:2': 38,
        '17:3': 39,
        '18': 40,
        '18:1': 41,
        '18:2': 42,
        '18:3': 43,
        '19': 44,
        '19:1': 45,
        '20': 46,
        '21': 47,
        '22': 48,
        '23': 49,
        '24': 50,
        '24:1': 51,
        '24:2': 52,
        '25': 53,
        '26': 54,
        '27': 55,
        '28': 56,
        '29': 57,
        '30': 58,
        '31': 59,
        '31:1': 60,
        '31:2': 61,
        '32': 62,
        '33': 63,
        '34': 64,
        '35': 65,
        '35:1': 66,
        '35:2': 67,
        '35:3': 68,
        '35:4': 69,
        '35:5': 70,
        '35:6': 71,
        '35:7': 72,
        '35:8': 73,
        '35:9': 74,
        '35:10': 75,
        '35:11': 76,
        '35:12': 77,
        '35:13': 78,
        '35:14': 79,
        '35:15': 80,
        '37': 81,
        '38': 82,
        '38:1': 83,
        '38:2': 84,
        '38:3': 85,
        '38:4': 86,
        '38:5': 87,
        '38:6': 88,
        '38:7': 89,
        '38:8': 90,
        '39': 91,
        '40': 92,
        '41': 93,
        '42': 94,
        '43': 95,
        '43:1': 96,
        '43:2': 97,
        '43:3': 98,
        '43:4': 99,
        '43:5': 100,
        '43:6': 101,
        '43:7': 102,
        '44': 103,
        '44:1': 104,
        '44:2': 105,
        '44:3': 106,
        '44:4': 107,
        '44:5': 108,
        '44:6': 109,
        '44:7': 110,
        '45': 111,
        '46': 112,
        '47': 113,
        '48': 114,
        '49': 115,
        '50': 116,
        '51': 117,
        '52': 118,
        '53': 119,
        '54': 120,
        '55': 121,
        '56': 122,
        '57': 123,
        '58': 124,
        '59': 125,
        '60': 126,
        '61': 127,
        '62': 128,
        '63': 129,
        '64': 130,
        '65': 131,
        '66': 132,
        '67': 133,
        '68': 134,
        '69': 135,
        '70': 136,
        '71': 137,
        '72': 138,
        '73': 139,
        '74': 140,
        '75': 141,
        '76': 142,
        '77': 143,
        '78': 144,
        '79': 145,
        '80': 146,
        '81': 147,
        '82': 148,
        '83': 149,
        '84': 150,
        '85': 151,
        '86': 152,
        '87': 153,
        '88': 154,
        '89': 155,
        '90': 156,
        '91': 157,
        '92': 158,
        '93': 159,
        '94': 160,
        '95': 161,
        '95:1': 162,
        '95:2': 163,
        '95:3': 164,
        '95:4': 165,
        '95:5': 166,
        '95:6': 167,
        '95:7': 168,
        '95:8': 169,
        '95:9': 170,
        '95:10': 171,
        '95:11': 172,
        '95:12': 173,
        '95:13': 174,
        '95:14': 175,
        '95:15': 176,
        '96': 177,
        '97': 178,
        '97:1': 179,
        '97:2': 180,
        '97:3': 181,
        '97:4': 182,
        '97:5': 183,
        '98': 184,
        '98:1': 185,
        '98:2': 186,
        '98:3': 187,
        '99': 188,
        '100': 189,
        '101': 190,
        '102': 191,
        '103': 192,
        '104': 193,
        '105': 194,
        '106': 195,
        '107': 196,
        '108': 197,
        '109': 198,
        '110': 199,
        '111': 200,
        '112': 201,
        '113': 202,
        '114': 203,
        '115': 204,
        '116': 205,
        '117': 206,
        '118': 207,
        '119': 208,
        '120': 209,
        '121': 210,
        '122': 211,
        '123': 212,
        '124': 213,
        '125': 214,
        '125:1': 215,
        '125:2': 216,
        '125:3': 217,
        '125:4': 218,
        '125:5': 219,
        '126': 220,
        '126:1': 221,
        '126:2': 222,
        '126:3': 223,
        '126:4': 224,
        '126:5': 225,
        '127': 226,
        '128': 227,
        '129': 228,
        '130': 229,
        '131': 230,
        '132': 231,
        '133': 232,
        '134': 233,
        '135': 234,
        '136': 235,
        '137': 236,
        '138': 237,
        '139': 238,
        '139:1': 239,
        '140': 240,
        '141': 241,
        '142': 242,
        '143': 243,
        '144': 244,
        '145': 245,
        '146': 246,
        '147': 247,
        '148': 248,
        '149': 249,
        '150': 250,
        '151': 251,
        '152': 252,
        '153': 253,
        '154': 254,
        '155': 255,
        '155:1': 256,
        '155:2': 257,
        '156': 258,
        '157': 259,
        '158': 260,
        '159': 261,
        '159:1': 262,
        '159:2': 263,
        '159:3': 264,
        '159:4': 265,
        '159:5': 266,
        '159:6': 267,
        '159:7': 268,
        '159:8': 269,
        '159:9': 270,
        '159:10': 271,
        '159:11': 272,
        '159:12': 273,
        '159:13': 274,
        '159:14': 275,
        '159:15': 276,
        '160': 277,
        '160:1': 278,
        '160:2': 279,
        '160:3': 280,
        '160:4': 281,
        '160:5': 282,
        '160:6': 283,
        '160:7': 284,
        '160:8': 285,
        '160:9': 286,
        '160:10': 287,
        '160:11': 288,
        '160:12': 289,
        '160:13': 290,
        '160:14': 291,
        '160:15': 292,
        '161': 293,
        '161:1': 294,
        '162': 295,
        '162:1': 296,
        '163': 297,
        '164': 298,
        '165': 299,
        '166': 300,
        '167': 301,
        '168': 302,
        '168:1': 303,
        '168:2': 304,
        '169': 305,
        '170': 306,
        '171': 307,
        '171:1': 308,
        '171:2': 309,
        '171:3': 310,
        '171:4': 311,
        '171:5': 312,
        '171:6': 313,
        '171:7': 314,
        '171:8': 315,
        '171:9': 316,
        '171:10': 317,
        '171:11': 318,
        '171:12': 319,
        '171:13': 320,
        '171:14': 321,
        '171:15': 322,
        '172': 323,
        '173': 324,
        '174': 325,
        '175': 326,
        '175:1': 327,
        '175:2': 328,
        '175:3': 329,
        '175:4': 330,
        '175:5': 331,
        '176': 332,
        '177': 333,
        '178': 334,
        '179': 335,
        '179:1': 336,
        '179:2': 337,
        '180': 338,
        '181': 339,
        '182': 340,
        '183': 341,
        '184': 342,
        '185': 343,
        '186': 344,
        '187': 345,
        '188': 346,
        '189': 347,
        '190': 348,
        '191': 349,
        '192': 350,
        '193': 351,
        '194': 352,
        '195': 353,
        '196': 354,
        '197': 355,
        '198': 356,
        '199': 357,
        '200': 358,
        '201': 359,
        '202': 360,
        '203': 361,
        '204': 362,
        '205': 363,
        '206': 364,
        '207': 365,
        '208': 366,
        '209': 367,
        '210': 368,
        '211': 369,
        '212': 370,
        '213': 371,
        '214': 372,
        '215': 373,
        '216': 374,
        '217': 375,
        '218': 376,
        '219': 377,
        '220': 378,
        '221': 379,
        '222': 380,
        '223': 381,
        '224': 382,
        '225': 383,
        '226': 384,
        '227': 385,
        '228': 386,
        '229': 387,
        '230': 388,
        '231': 389,
        '232': 390,
        '233': 391,
        '234': 392,
        '235': 393,
        '236': 394,
        '237': 395,
        '238': 396,
        '239': 397,
        '240': 398,
        '241': 399,
        '242': 400,
        '243': 401,
        '244': 402,
        '245': 403,
        '246': 404,
        '247': 405,
        '248': 406,
        '249': 407,
        '250': 408,
        '251': 409,
        '251:1': 410,
        '251:2': 411,
        '251:3': 412,
        '251:4': 413,
        '251:5': 414,
        '251:6': 415,
        '251:7': 416,
        '251:8': 417,
        '251:9': 418,
        '251:10': 419,
        '251:11': 420,
        '251:12': 421,
        '251:13': 422,
        '251:14': 423,
        '251:15': 424,
        '252': 425,
        '252:1': 426,
        '252:2': 427,
        '252:3': 428,
        '252:4': 429,
        '252:5': 430,
        '252:6': 431,
        '252:7': 432,
        '252:8': 433,
        '252:9': 434,
        '252:10': 435,
        '252:11': 436,
        '252:12': 437,
        '252:13': 438,
        '252:14': 439,
        '252:15': 440,
        '255': 441,
        '256': 442,
        '257': 443,
        '258': 444,
        '259': 445,
        '260': 446,
        '261': 447,
        '262': 448,
        '263': 449,
        '263:1': 450,
        '264': 451,
        '265': 452,
        '266': 453,
        '267': 454,
        '268': 455,
        '269': 456,
        '270': 457,
        '271': 458,
        '272': 459,
        '273': 460,
        '274': 461,
        '275': 462,
        '276': 463,
        '277': 464,
        '278': 465,
        '279': 466,
        '280': 467,
        '281': 468,
        '282': 469,
        '283': 470,
        '284': 471,
        '285': 472,
        '286': 473,
        '287': 474,
        '288': 475,
        '289': 476,
        '290': 477,
        '291': 478,
        '292': 479,
        '293': 480,
        '294': 481,
        '295': 482,
        '296': 483,
        '297': 484,
        '298': 485,
        '299': 486,
        '300': 487,
        '301': 488,
        '302': 489,
        '303': 490,
        '304': 491,
        '305': 492,
        '306': 493,
        '307': 494,
        '308': 495,
        '309': 496,
        '310': 497,
        '311': 498,
        '312': 499,
        '313': 500,
        '314': 501,
        '315': 502,
        '316': 503,
        '317': 504,
        '318': 505,
        '319': 506,
        '320': 507,
        '321': 508,
        '322': 509,
        '322:1': 510,
        '323': 511,
        '324': 512,
        '325': 513,
        '326': 514,
        '327': 515,
        '328': 516,
        '329': 517,
        '330': 518,
        '331': 519,
        '332': 520,
        '333': 521,
        '334': 522,
        '335': 523,
        '336': 524,
        '337': 525,
        '338': 526,
        '339': 527,
        '340': 528,
        '341': 529,
        '342': 530,
        '343': 531,
        '344': 532,
        '345': 533,
        '346': 534,
        '347': 535,
        '348': 536,
        '349': 537,
        '349:1': 538,
        '349:2': 539,
        '349:3': 540,
        '350': 541,
        '350:1': 542,
        '351': 543,
        '351:1': 544,
        '351:2': 545,
        '351:3': 546,
        '351:4': 547,
        '351:5': 548,
        '351:6': 549,
        '351:7': 550,
        '351:8': 551,
        '351:9': 552,
        '351:10': 553,
        '351:11': 554,
        '351:12': 555,
        '351:13': 556,
        '351:14': 557,
        '351:15': 558,
        '352': 559,
        '353': 560,
        '354': 561,
        '355': 562,
        '356': 563,
        '357': 564,
        '358': 565,
        '359': 566,
        '360': 567,
        '361': 568,
        '362': 569,
        '363': 570,
        '364': 571,
        '365': 572,
        '366': 573,
        '367': 574,
        '368': 575,
        '369': 576,
        '370': 577,
        '371': 578,
        '372': 579,
        '373': 580,
        '374': 581,
        '375': 582,
        '376': 583,
        '377': 584,
        '378': 585,
        '379': 586,
        '380': 587,
        '381': 588,
        '382': 589,
        '383:4': 590,
        '383:5': 591,
        '383:6': 592,
        '383:23': 593,
        '383:27': 594,
        '383:28': 595,
        '383:29': 596,
        '383:31': 597,
        '383:32': 598,
        '383:34': 599,
        '383:35': 600,
        '383:36': 601,
        '383:50': 602,
        '383:51': 603,
        '383:52': 604,
        '383:54': 605,
        '383:55': 606,
        '383:56': 607,
        '383:57': 608,
        '383:58': 609,
        '383:59': 610,
        '383:60': 611,
        '383:61': 612,
        '383:62': 613,
        '383:65': 614,
        '383:66': 615,
        '383:67': 616,
        '383:68': 617,
        '383:69': 618,
        '383:90': 619,
        '383:91': 620,
        '383:92': 621,
        '383:93': 622,
        '383:94': 623,
        '383:95': 624,
        '383:96': 625,
        '383:98': 626,
        '383:100': 627,
        '383:101': 628,
        '383:102': 629,
        '383:103': 630,
        '383:105': 631,
        '383:120': 632,
        '384': 633,
        '385': 634,
        '386': 635,
        '387': 636,
        '388': 637,
        '389': 638,
        '390': 639,
        '391': 640,
        '392': 641,
        '393': 642,
        '394': 643,
        '395': 644,
        '396': 645,
        '397': 646,
        '397:1': 647,
        '397:2': 648,
        '397:3': 649,
        '397:4': 650,
        '397:5': 651,
        '398': 652,
        '399': 653,
        '400': 654,
        '401': 655,
        '402': 656,
        '403': 657,
        '404': 658,
        '405': 659,
        '406': 660,
        '407': 661,
        '408': 662,
        '409': 663,
        '410': 664,
        '411': 665,
        '412': 666,
        '413': 667,
        '414': 668,
        '415': 669,
        '416': 670,
        '417': 671,
        '418': 672,
        '419': 673,
        '420': 674,
        '421': 675,
        '422': 676,
        '423': 677,
        '424': 678,
        '425': 679,
        '426': 680,
        '427': 681,
        '428': 682,
        '429': 683,
        '430': 684,
        '431': 685,
        '432': 686,
        '433': 687,
        '434': 688,
        '435': 689,
        '436': 690,
        '437': 691,
        '438': 692,
        '439': 693,
        '440': 694,
        '441': 695,
        '442': 696,
        '443': 697,
        '444': 698,
        '445': 699,
        '446': 700,
        '447': 701,
        '448': 702,
        '449': 703,
        '450': 704,
        '452': 705,
        '453': 706,
        '2256': 707,
        '2257': 708,
        '2258': 709,
        '2259': 710,
        '2260': 711,
        '2261': 712,
        '2262': 713,
        '2263': 714,
        '2264': 715,
        '2265': 716,
        '2266': 717,
        '2267': 718
    },
	blockModels: {
		0: 'Air',
        8: 'Liquid',
		9: 'Liquid',
        10: 'Liquid',
		11: 'Liquid',
		44: 'Slab',
		126: 'Slab',
		182: 'Slab',
        205: 'Slab',
		63: 'Sign',
        68: 'Sign',
		171: 'Carpet',
		70: 'PressurePlate',
		72: 'PressurePlate',
		147: 'PressurePlate',
		148: 'PressurePlate',
		2: 'Grass',
		65: 'Ladder',
		106: 'Vine',
		85: 'Fence',
		113: 'Fence',
		188: 'Fence',
		189: 'Fence',
		190: 'Fence',
		191: 'Fence',
		192: 'Fence',
		139: 'Wall',
		50: 'Torch',
		75: 'Torch',
		76: 'Torch',			
		86: 'Pumpkin',
		53: 'Stairs',
		67: 'Stairs',
		108: 'Stairs',
		53: 'Stairs',
		109: 'Stairs',
		114: 'Stairs',
		128: 'Stairs',
		134: 'Stairs',
		135: 'Stairs',
		136: 'Stairs',
		156: 'Stairs',
		163: 'Stairs',
		164: 'Stairs',
		180: 'Stairs',
        203: 'Stairs',
		24: 'Sandstone',
		43: 'DoubleSlab',
		125: 'DoubleSlab',
		181: 'DoubleSlab',
		96: 'TrapDoor',
		167: 'TrapDoor',
		111: 'LilyPad',
		27: 'Rail',
		28: 'Rail',
		66: 'Rail',
		157: 'Rail',
		55: 'RedstoneWire',
		78: 'GroundFlat',
		93: 'RedstoneRepeater',
		94: 'RedstoneRepeater',
		149: 'RedstoneComparator',
		150: 'RedstoneComparator',
		30: 'CenterCross',
		39: 'CenterCross',
		40: 'CenterCross',
		51: 'CenterCross',
		59: 'CenterCross',
		69: 'CenterCross',
		83: 'CenterCross',
		104: 'CenterCross',
		105: 'CenterCross',
		115: 'CenterCross',
		117: 'CenterCross',
		122: 'CenterCross',
		127: 'CenterCross',
		140: 'CenterCross',
		141: 'CenterCross',
		142: 'CenterCross',
		144: 'CenterCross',
		145: 'CenterCross',
        207: 'CenterCross',
		6: 'OffsetCross',
		31: 'OffsetCross',
		32: 'OffsetCross',
		37: 'OffsetCross',
		38: 'OffsetCross',
		58: 'CraftingTable',
		23: 'StoneDevice',
		158: 'StoneDevice',
        218: 'StoneDevice',
		61: 'Furnace',
		62: 'Furnace',
		54: 'Chest',
		130: 'Chest',
		146: 'Chest',
		103: 'Melon',
		47: 'Bookshelf',
		175: 'DoublePlant',
		101: 'GlassPane',        
		102: 'GlassPane',
		160: 'GlassPane',
		77: 'Button',
		143: 'Button',
		64: 'Door',
		71: 'Door',
        193: 'Door',
        194: 'Door',
        195: 'Door',
        196: 'Door',
        197: 'Door',
		254: 'Minesweeper',
        235: 'Terracotta',
        236: 'Terracotta',
        237: 'Terracotta',
        238: 'Terracotta',
        239: 'Terracotta',
        240: 'Terracotta',
        241: 'Terracotta',
        242: 'Terracotta',
        243: 'Terracotta',
        244: 'Terracotta',
        245: 'Terracotta',
        246: 'Terracotta',
        247: 'Terracotta',
        248: 'Terracotta',
        249: 'Terracotta',
        250: 'Terracotta',
        253: 'Air',
        17: 'WoodLog',
        162: 'WoodLog',
        26: 'Bed',
        78: 'Snow',
        29: 'Piston',
        33: 'Piston',
        34: 'PistonHead',
        36: 'Empty',
        46: 'TNT',
        208: 'TallDirt',
        60: 'TallDirt',
        90: 'Portal',
        26: 'Bed',
        107: 'FenceGate',
        183: 'FenceGate',
        184: 'FenceGate',
        185: 'FenceGate',
        186: 'FenceGate',
        187: 'FenceGate',
        81: 'Cactus',
        88: 'SoulSand',
        
	},
	blockBounds: {
		// names are the same as the block models
		"Block": [0,0,0,1,1,1],
		"Slab": [0,0,0,1,.5,1],
		"Stairs": [[0,0,0,1,.5,1], [.5,.5,0,1,1,1] ],
		"Ladder": [0,0,0,1,1,.1],
		"Fence": [.374,0,.374,.626,1.5,.626],
		"LilyPad": [0,0,0,1,.0625,1], 
		"GroundFlat": [0,0,0,1,.0625,1], 
		"Carpet": [0,0,0,1,.0625,1],
		"Torch": [.375,0,.375,.625,.625,.625], 
		"PressurePlate": [0.0625,0,0.0625,0.9375,.0625,0.9375], 
		"Rail": [0,0,0,1,.125,1],
		"CenterCross": [.125,0,.125,.875,.75,.875],
		"OffsetCross": [.125,0,.125,.875,.75,.875],
		"SmallPlant": [.25,0,.25,.75,.75,.75],
		"LongGrass": [.125,0,.125,.875,.875,.875],
		"TrapDoor": [0,0,0,1,.1875,1],
		"Door": [0,0,0,1,1,.1875],
		"Minesweeper": [0,0,0,1,1,1],
        "RedstoneWire": [0,0,0,1,.0625,1],
        "RedstoneDevice": [0,0,0,1,.125,1],
        "RedstoneRepeater": [0,0,0,1,.125,1],
        "RedstoneComparator": [0,0,0,1,.125,1],
        "Bed": [0,0,0,1,.5625,1],
        "TallDirt": [0,0,0,1,.9375,1],
        "Bed": [0,0,0,1,0.5625,1],
        "Cactus": [0.0625,0,0.0625,.9375,1,.9375],
        "SoulSand": [0,0,0,1,0.875,1],
	},
    blockRotations: {
		53: 'Stairs',
		67: 'Stairs',
		108: 'Stairs',
		109: 'Stairs',
		114: 'Stairs',
		128: 'Stairs',
		134: 'Stairs',
		135: 'Stairs',
		136: 'Stairs',
		156: 'Stairs',
		163: 'Stairs',
		164: 'Stairs',
		180: 'Stairs',
        203: 'Stairs',
        27: 'Rails',
        28: 'Rails',
        66: 'Rails',
        157: 'Rails',
        61: 'Furnace',
        62: 'Furnace',
        50: 'Torch',
        75: 'Torch',
        76: 'Torch',

    },
    blockRotationSets: {
        "Stairs": [[0,2,1,3], [4,6,5,7], [8,10,9,11], [12,14,13,15]],
        "Rails": [[0,1], [2,5,3,4]],
        "Furnace": [[4,2,5,3]],
        "Torch": [[1,3,2,4]],
    },
    blockMovementModifiers: [
        8,9,10,11,30,65,79,88,174,212
    ],
    blockTickUpdates: {
        2: 'Grass',
        106: 'Vine',
    },

	blockUse: {
        '64': 'Door',
        '71': 'Door',
        '193': 'Door',
        '194': 'Door',
        '195': 'Door',
        '196': 'Door',
        '197': 'Door',
        '75': 'RedstoneTorch',
        '76': 'RedstoneTorch',
        '77': 'Button',
        '143': 'Button',
        '96': 'Trapdoor',
        '167': 'Trapdoor',
        '93': 'RedstoneRepeater',
        '94': 'RedstoneRepeater',
        '149': 'RedstoneComparator',
        '150': 'RedstoneComparator',
        '107': 'FenceGate',
        '183': 'FenceGate',
        '184': 'FenceGate',
        '185': 'FenceGate',
        '186': 'FenceGate',
        '187': 'FenceGate',
    },
	blockChange: {
        '64': 'Door',
        '71': 'Door',
        '193': 'Door',
        '194': 'Door',
        '195': 'Door',
        '196': 'Door',
        '197': 'Door',
        '175': 'DoublePlant',
        '26': 'Bed',
    },

	blockOnUse: {
		'Door': function(shape, x, y, z) {
			const id = shape.getBlockId(x, y, z);
            let data = shape.getBlockData(x, y, z);

			if (data > 7 ) {
				data = shape.getBlockData(x, --y, z);			
			}
            
            data += (data < 4 ? 4 : -4);
			shape.setBlock(x, y, z, id, data, true);
		},
		'RedstoneTorch': function(shape, x, y, z) {
            const blockId = shape.getBlockId(x, y, z);
            const blockData = shape.getBlockData(x, y, z);
			shape.setBlock(x, y, z, blockId == 75 ? 76 : 75, blockData, true);
		},
		'Button': function(shape, x, y, z) {	// Button On/Off
			const blockId = shape.getBlockId(x, y, z);
            var data = shape.getBlockData(x, y, z);
			if (data <= 5 ) data += 8;
			else data -= 8;
			shape.setBlock(x, y, z, blockId, data, true);				
		},
		'Trapdoor': function(shape, x, y, z) {	// Trapdoor open close
			const blockId = shape.getBlockId(x, y, z);
            var data = shape.getBlockData(x, y, z);
			if ((data >= 4 && data < 8) || data >= 12) data -= 4;
			else data += 4
			shape.setBlock(x, y, z, blockId, data, true);				
		},
		'RedstoneRepeater': function(shape, x, y, z) {
            const blockId = shape.getBlockId(x, y, z);
            const blockData = shape.getBlockData(x, y, z);
            const newData = (blockData + 4) > 15 ? blockData - 12 : blockData + 4;
			shape.setBlock(x, y, z, blockId, newData, true);
		},
		'RedstoneComparator': function(shape, x, y, z) {
            const blockId = shape.getBlockId(x, y, z);
            const blockData = shape.getBlockData(x, y, z);
            let newData = blockData;
            if (blockData < 8) {
                newData += blockData < 4 ? 4 : -4;
            }
            else {
                newData += blockData < 12 ? 4 : -4;
            }

			shape.setBlock(x, y, z, blockId, newData, true);
		},
		'FenceGate': function(shape, x, y, z) {
            const bi = shape.getBlockId(x, y, z);
            const bd = shape.getBlockData(x, y, z);
            let newData = bd;

            const dataMod = bd % 8;
            if (dataMod < 4) {
                const yaw = Game.player.yaw;
                const offset = bd < 8 ? 0 : 8;

                if (dataMod == 0 || dataMod == 2) {
                    newData = offset + ((yaw > 90 && yaw < 270) ? 4 : 6);
                }
                else {
                    newData = offset + ((yaw > 0 && yaw < 180) ? 5 : 7);
                }
            }
            else {
                newData = bd - 4;
            }
            
			shape.setBlock(x, y, z, bi, newData, true);
		},

	},
	blockOnChange: {
		'DoublePlant': function(shape, x, y, z, id, data, isBreaking = false) {
            if (isBreaking) {
                shape.setBlock(x, y + (data == 10 ? -1 : 1), z, 0, 0);
            }
            else {
                if (data < 10) shape.setBlock(x, y + 1, z, id, 10);
            }
        },
		'Door': function(shape, x, y, z, id, data, isBreaking = false) {
            if (isBreaking) {
                shape.setBlock(x, y + (data > 7 ? -1 : 1), z, 0, 0);
            }
            else {
                if (data < 8) {
                    const dataMod = data % 4;
                    let sideBlock;
                    
                    switch(dataMod) {
                        case 0: sideBlock = shape.getBlock(x, y + 1, z - 1); break;
                        case 1: sideBlock = shape.getBlock(x + 1, y + 1, z); break;
                        case 2: sideBlock = shape.getBlock(x, y + 1, z + 1); break;
                        case 3: sideBlock = shape.getBlock(x - 1, y + 1, z); break;
                    }
                    
                    return shape.setBlock(x, y + 1, z, id, (sideBlock.id == id && sideBlock.data == 8) ? 9 : 8);
                }
            }
        },
		'Bed': function(shape, x, y, z, id, data, isBreaking = false) {
            if (isBreaking) {                
                let offset = [0,0,0];
                let matchData = (data >= 0 && data < 4) ? data + 8 : ((data >= 8 && data < 12) ? data - 8 : -1);
                if (matchData == -1) return;
                
                switch(data) {
                    case 0: offset = [0, 0, 1]; break;
                    case 1: offset = [-1, 0, 0]; break;
                    case 2: offset = [0, 0, -1]; break;
                    case 3: offset = [1, 0, 0]; break;
                    case 8: offset = [0, 0, -1]; break;
                    case 9: offset = [1, 0, 0]; break;
                    case 10: offset = [0, 0, 1]; break;
                    case 11: offset = [-1, 0, 0]; break;
                }
                
                const sidePos = [x + offset[0], y + offset[1], z + offset[2]];
                let sideBlock = shape.getBlock(...sidePos);
                if (sideBlock.id == id && sideBlock.data == matchData) {
                    return shape.setBlock(...sidePos, 0, 0);
                }
            }
            else {
                if ((data > 3 && data < 8) || data > 11) return;
                
                let offset = [];
                switch(data) {
                    case 0: offset = [0, 0, 1]; break;
                    case 1: offset = [-1, 0, 0]; break;
                    case 2: offset = [0, 0, -1]; break;
                    case 3: offset = [1, 0, 0]; break;
                    case 8: offset = [0, 0, -1]; break;
                    case 9: offset = [1, 0, 0]; break;
                    case 10: offset = [0, 0, 1]; break;
                    case 11: offset = [-1, 0, 0]; break;
                }
                
                const sidePos = [x + offset[0], y + offset[1], z + offset[2]];
                const sideBlockId = shape.getBlockId(...sidePos)
                
                if (sideBlockId == 0) {
                    let sideData = (data >= 0 && data < 4) ? data + 8 : ((data >= 8 && data < 12) ? data - 8 : -1);
                    
                    if (sideData == -1) return;
                    return shape.setBlock(...sidePos, id, sideData);
                }
            }
        },
        
    },
	blockPlacement: {
        64: 'Door',
        71: 'Door',
        193: 'Door',
        194: 'Door',
        195: 'Door',
        196: 'Door',
        197: 'Door',
        44: 'Slabs',
        126: 'Slabs',
        53: 'Stairs',
        67: 'Stairs',
        108: 'Stairs',
        109: 'Stairs',
        114: 'Stairs',
        128: 'Stairs',
        134: 'Stairs',
        135: 'Stairs',
        136: 'Stairs',
        156: 'Stairs',
        163: 'Stairs',
        164: 'Stairs',
        180: 'Stairs',
        61: 'Furnace',
        62: 'Furnace',
        158: 'Furnace',
        106: 'Vine',
        93: 'RedstoneDevice',
        94: 'RedstoneDevice',
        149: 'RedstoneDevice',
        150: 'RedstoneDevice',
        50: 'Torch',
        75: 'Torch',
        76: 'Torch',
        63: 'Sign',
        68: 'Sign',
        96: 'Trapdoor',
        167: 'Trapdoor',
        17: 'WoodLog',
        162: 'WoodLog',
        78: 'Snow',
        29: 'Piston',
        33: 'Piston',
        34: 'PistonHead',
        90: 'Portal',
        26: 'Bed',
        65: 'Ladder',
        107: 'FenceGate',
        183: 'FenceGate',
        184: 'FenceGate',
        185: 'FenceGate',
        186: 'FenceGate',
        187: 'FenceGate',
        54: 'Chest',
        130: 'Chest',
        146: 'Chest',
    },
    blockNameConvert: {
        "cave_air": "air",
        "grass_block": "grass",
        
        "diorite": [1,3],
        "granite": [1,1],
        "andesite": [1,5],
        
        "grass": [31, 1],
        "coarse_dirt": [3, 1],
        "podzol": [3, 2],
        
        "oak_log": [17, 0],
        "spruce_log": [17, 1],
        "birch_log": [17, 2],
        "jungle_log": [17, 3],
        "acacia_log": [162, 0],
        "dark_oak_log": [162, 1],
        
        "oak_leaves": [18, 0],
        "spruce_leaves": [18, 1],
        "birch_leaves": [18, 2],
        "jungle_leaves": [18, 3],
        "acacia_leaves": [161, 0],
        "dark_oak_leaves": [161, 1],        
        
        "oak_planks": [5,0],
        "spruce_planks": [5,1],
        "birch_planks": [5,2],
        "jungle_planks": [5,3],
        "acacia_planks": [5, 4],
        "dark_oak_planks": [5, 5],
        
        "oak_stairs": [53, 0],
        "cobblestone_stairs": [67, 0],
        "brick_stairs": [108, 0],
        "stone_brick_stairs": [109, 0],
        "nether_brick_stairs": [114, 0],
        "sandstone_stairs": [128, 0],
        "spruce_stairs": [134, 0],
        "birch_stairs": [135, 0],
        "jungle_stairs": [136, 0],
        "acacia_stairs": [163, 0],
        "dark_oak_stairs": [164, 0],
        "quartz_stairs": [156, 0],
        "red_sandstone_stairs": [180, 0],
        "purpur_stairs": [203, 0],
        
        "oak_slab": [126, 0],
        "smooth_stone_slab": [44, 0],
        "cobblestone_slab": [44, 3],
        "brick_slab": [44, 4],
        "stone_brick_slab": [44, 5],
        "nether_brick_slab": [44, 6],
        "sandstone_slab": [44, 1],
        "spruce_slab": [126, 1],
        "birch_slab": [126, 2],
        "jungle_slab": [126, 3],
        "acacia_slab": [126, 4],
        "dark_oak_slab": [126, 5],
        "quartz_slab": [44, 7],
        "red_sandstone_slab": [182, 0],
        "purpur_slab": [205, 0],
        
        "infested_stone": [97,0],
        "infested_cobblestone": [97,1],
        "infested_stone_bricks": [97,2],
        "infested_mossy_stone_bricks": [97,3],
        "infested_cracked_stone_bricks": [97,4],
        "infested_chiseled_stone_bricks": [97,5],
        
        "oak_fence": [85,0],
        "cobweb": [30,0],
        "wall_torch": [50,0],
        "dead_bush": [32,0],
        "seagrass": [18,3],
        "tall_seagrass": [18,3],
        "tall_grass": [18,3],
        "azure_bluet": [38,3],
        "oxeye_daisy": [38,8],
        "dandelion": [37,0],
        "cornflower": [38,8],
        "sugar_cane": [83,0],
        "spawner": [52,0],
        "poppy": [38,0],
        "rose_bush": [175,4],
        "peony": [175,5],
        "terracotta": [1,0],
        "lime_bed": [26,0],
        "potted_cactus": [140,0],
        "smooth_sandstone": [24,2],
        "cut_sandstone": [24,1],
        "chiseled_sandstone": [24,1],
        "smooth_sandstone_stairs": [128,0],
        "jungle_trapdoor": [96,0],
        "composter": [1,0],
        "white_wool": [35,0],
        "orange_terracotta": [1,0],
        "blue_terracotta": [1,0],
        "lily_of_the_valley": [38,1],
        "kelp_plant": [18,3],
        "kelp": [18,3],
        "orange_tulip": [38,5],
        "red_tulip": [38,4],
        "allium": [1,0],
        "pink_tulip": [38,7],
        "white_tulip": [38,6],
        "lilac": [175, 1],
        "mushroom_stem": [99,0],
        "blue_orchid": [38,1],
        "lily_pad": [111,0]
    },
    
	getBlockColor(id, data) {
		if (typeof this.blockColors[id + ":" + data] !== 'undefined') {
			return this.blockColors[id + ":" + data];
		}
		else if (typeof this.blockColors[id] !== 'undefined') {
			return this.blockColors[id];
		}
		else {
			return null;
		}
	},
	getBlockName(id, data) {
		data = data >= 0 ? data : 0;
		if (typeof this.blockNames[id + ":" + data] !== 'undefined') {
			return this.blockNames[id + ":" + data];
		}
		else if (typeof this.blockNames[id] !== 'undefined') {
			return this.blockNames[id];
		}
		else {
			return null;
		}
	},
	getBlockIdName(id, data) {
		data = data >= 0 ? data : 0;
		if (typeof this.blockIdNamesExtended[id + ":" + data] !== 'undefined') {
			return this.blockIdNamesExtended[id + ":" + data];
		}
		else if (typeof this.blockIdNames[id] !== 'undefined') {
			return this.blockIdNames[id];
		}
		else {
			return null;
		}
	},
	getBlockProperties(id, data) {
		data = data >= 0 ? data : 0;
		if (typeof this.blockProperties[id + ":" + data] !== 'undefined') {
			return this.blockProperties[id + ":" + data];
		}
		else {
			return null;
		}
	},

	getBlockTextureCoords(id, data) {
		var tIndex = 237; // The blank index in the texture image
		if (typeof this.blockTextures[id + ":" + data] !== 'undefined') {
			tIndex = this.blockTextures[id + ":" + data];
		}
		else if (typeof this.blockTextures[id] !== 'undefined') {
			tIndex = this.blockTextures[id];
		}
		return this.getTextureOffsetFromIndex(tIndex);
	},
	getBlockIconCoords(id, data) {
		var tIndex = 1;
		if (typeof this.blockIcons[id + ":" + data] !== 'undefined') {
			tIndex = this.blockIcons[id + ":" + data];
		}
		else if (typeof this.blockIcons[id] !== 'undefined') {
			tIndex = this.blockIcons[id];
		}
		return this.getIconOffsetFromIndex(tIndex);
	},		
	getBlockFromState(base, properties) {
		
		var blockId = -1;
		var blockData = -1;
		
		if(base.indexOf("minecraft:") > -1) base = base.split("minecraft:")[1];
		if (this.blockNameConvert[base]) base = this.blockNameConvert[base];
        if (Array.isArray(base)) return base;
        
		for(var i in this.blockIdNames) {
			if (this.blockIdNames[i] == base) {
				blockId = parseInt(i);
				break;
			}
		}
		
		if (blockId == -1) {
			// console.log("Couldn't find block for id: " + base);
			return null;
		}
		if (blockId == 0) return [0, 0];
		if(properties == null || properties == "null" || properties == "" || properties == "none") {
			return [blockId, 0];
		}
		
		var testProp;
		var stopProp = false;
		for(var i = 0; i < 16; i++) {
			testProp = this.blockProperties[blockId + ":" + i];
			stopProp = false;
			if (typeof testProp !== 'undefined') {
				for(var j in properties) {
					if(typeof testProp[j] === 'undefined' || properties[j] != testProp[j]) {
						stopProp = true;
						break;
					}
				}
				if(stopProp) continue;
				
				blockData = i;
				break;
			}
		}

		if (blockData == -1) {
			// console.log("Couldn't find %s (%s) with block properties: %O", base, blockId,  properties);
			return [blockId, 0];
		}
		
		return [blockId, blockData];
		
	},
	getBlockFromName(name) {
        
        let blocks = this.blockIdNamesExtended;
        name = String(name).replace(" ", "_").toLowerCase().trim();       
        
        for (let j = 0; j < 2; j++) {
            if (j == 1) blocks = this.blockIdNames;
        
            let block;
            for (const index in blocks) {
                block = blocks[index];

                if (block == name) {
                    if (j == 0) {
                        const idArray = index.split(":");
                        const id = parseInt(idArray[0]);
                        const data = parseInt(idArray[1]);
                        
                        return {id, data};
                    }
                    else {
                        return {id: index, data: 0};
                    }
                }
            }
        }
        
        return null;
    },
    getTextureOffsetFromIndex(tIndex) {	
		
		var col = tIndex % 16;
		var row = (tIndex-col) / 16;
		var pxInc = 1/256;
		
		col *= 1;
		row *= 1;			
		var ax = (col * 16) * pxInc;
		var ay = (row * 16) * pxInc;
		
		var bx = ax + 16 * pxInc;
		var by = ay + 16 * pxInc;

		
		var tOff = [
			ax,
			ay,
			bx,
			by
		];
		
		return tOff;
	},
	getIconOffsetFromIndex(tIndex) {	
		var row = Math.floor(tIndex / 32);
		var col = Math.floor(tIndex % 32);
		
		var tOff = [col * 32, row * 32];
		
		return tOff;
	},
	getBlockImage(id, data) {
	
		var cvs = document.createElement('canvas');			
		var ctx = cvs.getContext("2d");
		
		var off = this.getBlockTextureCoords(id, data); 
		var leftSide = off[0] * 256;
		var topSide = off[1] * 256;
		
		var scale = 10;
		cvs.width = cvs.height = 16;	
		
		if (!this.isAlphaBlock(id)) ctx.drawImage(Game.webgl.textureShader.textureImg,leftSide,topSide,16,16,0,0,16,16);
		else ctx.drawImage(Game.webgl.alphaShader.textureImg,leftSide,topSide,16,16,0,0,16,16);
		
		var blockImg = new Image();
		blockImg.src = cvs.toDataURL("image/png");
		cvs = ctx = null;

		return blockImg;			
	},
	getBlockIcon(id, data) {
	
		var cvs = document.createElement('canvas');			
		var ctx = cvs.getContext("2d");
		var off = this.getBlockIconCoords(id, data); 

		cvs.width = cvs.height = 32;	
		ctx.drawImage(Game.webgl.textureShader.iconImg,off[0],off[1],32,32,0,0,32,32);
		
		var blockImg = new Image();
		blockImg.src = cvs.toDataURL("image/png");
		cvs = ctx = null;

		return blockImg;			
	},
	getBlockModel(id, data) {
		if (typeof this.blockModels[id] !== 'undefined') {
			return this.blockModels[id];
		}
		else {
			return 'Block';
		}
	},
	getBoundingBox(x,y,z,id,data,forMovementCollision = false) {

        const getId = Game.getShape().getBlockId.bind(Game.getShape());

		function plantNoise(seed) {
			var x = Math.sin(seed++) * 10000;
			return x - Math.floor(x);
		}		
		var model = this.getBlockModel(id,data);
		if (model == "OffsetCross" && (id >= 37 && id <= 40)) model = "SmallPlant";
		else if (model == "OffsetCross" && (id == 31 || id == 32)) model = "LongGrass";

		//var bounds = typeof this.blockBounds[model] !== 'undefined' ? this.blockBounds[model] : this.blockBounds["Block"];
		
		var boxList = typeof this.blockBounds[model] !== 'undefined' ? this.blockBounds[model] : this.blockBounds["Block"];
		if(boxList.length == 6) boxList = [boxList]; // make an array of boxes
		
		var bb, ba = [];
		for (var j = 0 ; j < boxList.length; j++) {
		
			ba[j] = [
				boxList[j][0] + x,
				boxList[j][1] + y,
				boxList[j][2] + z,
				boxList[j][3] + x,
				boxList[j][4] + y,
				boxList[j][5] + z
			];
			bb = ba[j];
		
			if (model == "Slab") {
				if (data >= 8) {
					bb[1]+=.5,bb[4]+=.5;
				}				
			}
			else if (model == "Torch") {
                switch(data) {
                    case 1: bb[0]-=.375; bb[3]-=.375; break;
                    case 2: bb[0]+=.375; bb[3]+=.375; break;
                    case 3: bb[2]-=.375; bb[5]-=.375; break;
                    case 4: bb[2]+=.375; bb[5]+=.375; break;
                }
                
                if (data > 0 && data < 5) {
                    bb[1]+=.125; bb[4]+=.125; break;
                }
			}
			else if (model == "OffsetCross" || model == "SmallPlant" || model == "LongGrass") {
				var sa = [[.125, .125],[.125, -.125],[-.125, -.125],[-.125, .125]];
				var r = Math.floor(plantNoise(x*z) * 4);
				bb[0]+=sa[r][0],bb[3]+=sa[r][0];
				bb[2]+=sa[r][1],bb[5]+=sa[r][1];			
			}
			else if (model == "Sign") {
				
                if (id == 63) {
                    const gap = .25;
                    const gapB = .5;
                    bb[0]=x+gap, bb[3]=bb[0]+gapB;
                    bb[1]=y, bb[4]=y+1;
                    bb[2]=z+gap, bb[5]=bb[2]+gapB;
                }
                else if (id == 68) {               
                    const gapB = 1/24;
                    
                    if (data == 3) { //z-
                    
                        bb[0]=x,bb[3]=x+1;
                        bb[1]=y+gapB*6,bb[4]=y+gapB*18;
                        bb[2]=z+gapB/2,bb[5]=bb[2]+gapB*2;
                    }
                    if (data == 2) { //z+

                        bb[0]=x,bb[3]=x+1;
                        bb[1]=y+gapB*6,bb[4]=y+gapB*18;		
                        bb[2]=z+(1-gapB*2.5),bb[5]=bb[2]+(gapB*2);
                    }
                    if (data == 4) { //x+
                    
                        bb[0]=x+(1-gapB*2.5),bb[3]=bb[0]+(gapB*2);
                        bb[1]=y+gapB*6,bb[4]=y+gapB*18;		
                        bb[2]=z,bb[5]=z+1;
                    }
                    if (data == 5) { //x-				
                        bb[0]=x+(gapB*.5),bb[3]=bb[0]+(gapB*2.5);
                        bb[1]=y+gapB*6,bb[4]=y+gapB*18;		
                        bb[2]=z,bb[5]=z+1;
                    }
                }
			}
			else if (model == "Ladder" || model =="Vine") {
				
				var gapB = 1/16 * 1.5;
				
				if(model == "Vine") {
					if(data == 2) data = 5;
					else if(data == 4) data = 3;
					else if(data == 1) data = 2;
					else if(data == 8) data = 4;
				}
				
				if (data == 3) { //z-
				
					bb[0]=x,bb[3]=x+1;
					bb[1]=y,bb[4]=y+1;
					bb[2]=z,bb[5]=bb[2]+gapB;
				}
				if (data == 2) { //z+

					bb[0]=x,bb[3]=x+1;
					bb[1]=y,bb[4]=y+1;		
					bb[2]=z+1-gapB,bb[5]=bb[2]+gapB;
				}
				if (data == 4) { //x+
				
					bb[0]=x+1-gapB,bb[3]=bb[0]+gapB;
					bb[1]=y,bb[4]=y+1;		
					bb[2]=z,bb[5]=z+1;
				}
				if (data == 5) { //x-
				
					bb[0]=x,bb[3]=bb[0]+gapB;
					bb[1]=y,bb[4]=y+1;		
					bb[2]=z,bb[5]=z+1;
				}
			}
			else if (model == "Stairs") {
				if (j > 0) {
					if (data == 1 || data == 5) {
						bb[0]-=.5, bb[3]-=.5;
					}
					else if (data == 2 || data == 6) {
						bb[0]-=.5, bb[2]+=.5;
					}
					else if (data == 3 || data == 7) {
						bb[0]-=.5, bb[5]-=.5;
					}
					
					if (data >= 4) {
						bb[1]-=.5,bb[4]-=.5;
					}
				}
				else {
					if (data >= 4) {
						bb[1]+=.5,bb[4]+=.5;
					}
				}
			}
			else if (model == "TrapDoor") {
				const low = 3 * .0625;
				const high = 13 * .0625;
				
				if (data >= 8 && data < 12) {
                    bb[1]=high+y,bb[4]=1+y;
				}
				else if ((data >= 4 && data < 8) || data >= 12) {
					bb[1]=0+y,bb[4]=1+y;
					
                    if (data == 4 || data == 12) {
						bb[0]=0+x, bb[2]=high+z;
						bb[3]=1+x, bb[5]=1+z;
					}
					else if (data == 5 || data == 13) {
						bb[0]=0+x, bb[2]=0+z;
						bb[3]=1+x, bb[5]=low+z;
					}
					else if (data == 6 || data == 14) {
						bb[0]=high+x, bb[2]=0+z;
						bb[3]=1+x, bb[5]=1+z;
					}
					else if (data == 7 || data == 15) {
						bb[0]=0+x, bb[2]=0+z;
						bb[3]=low+x, bb[5]=1+z;
					}
				}
			}
			else if (model == "Button") {
				var gap = .0625;
				var yb0 = 6 * gap;
				var yt0 = yb0 + 4 * gap;
				var l0 = 5 * gap, r0 = l0+6*gap;
				var f0 = 0, b0 = f0+2*gap;

				if (data == 1 || data == 9 || data == 2 || data == 10) { // x- and x+
					bb[1]=y+yb0,bb[4]=y+yt0;
					bb[2]=z+l0,bb[5]=z+r0;
					if(data == 2 || data == 10) {
						bb[0]=x+1-b0,bb[3]=x+1;
					}
					else {
						bb[0]=x,bb[3]=x+b0;
					}
				}
				if (data == 0 || data == 8 || data == 5 || data == 13) { // y- and y+
					bb[0]=x+l0,bb[3]=x+r0;
					bb[2]=z+yb0,bb[5]=z+yt0;
					if(data == 5 || data == 13) {
						bb[1]=y,bb[4]=y+b0;
					}
					else {
						bb[1]=y+1-b0,bb[4]=y+1;
					}
				}
				if (data == 3 || data == 11 || data == 4 || data == 12) { // z- and z+
					bb[0]=x+l0,bb[3]=x+r0;
					bb[1]=y+yb0,bb[4]=y+yt0;
					if(data == 4 || data == 12) {
						bb[2]=z+1-b0,bb[5]=z+1;
					}
					else {
						bb[2]=z,bb[5]=z+b0;
					}
				}
			}
			else if (model == "Door") {
				let bbd, abd;
				if (data > 7) {
					bbd = Game.getShape().getBlockData(x, y - 1, z);
				}
                else  {
                    abd = Game.getShape().getBlockData(x, y + 1, z);   
                }
			
				var low = 3 * .0625;
				var high = 13 * .0625;

				bb[1]=0+y,bb[4]=1+y;
				if ((data == 1) || (bbd == 1 && (data == 8 || data == 9))
                    || ((data == 6 && abd == 9) || (bbd == 6 && data == 9))
                    || ((data == 4 && abd == 8) || (bbd == 4 && data == 8))) { // z- 

				}
				else if (data == 3 || (bbd == 3 && (data == 8 || data == 9))
                    || ((data == 6 && abd == 8) || (bbd == 6 && data == 8))
                    || ((data == 4 && abd == 9) || (bbd == 4 && data == 9))) { // z+
					
                    bb[2]+=high, bb[5]+=high;
				}
				else if ((data == 0 || (bbd == 0 && (data == 8 || data == 9)))
                    || ((data == 7 && abd == 8) || (bbd == 7 && data == 8))
                    || ((data == 5 && abd == 9) || (bbd == 5 && data == 9))) { // x- 
					
                    bb[0]=0+x, bb[2]=0+z;
					bb[3]=low+x, bb[5]=1+z;
				}
				else if ((data == 2 || (bbd == 2 && (data == 8 || data == 9)))
                    || ((data == 7 && abd == 9) || (bbd == 7 && data == 9))
                    || ((data == 5 && abd == 8) || (bbd == 5 && data == 8))) { // x+
					
                    bb[0]=high+x, bb[2]=0+z;
					bb[3]=1+x, bb[5]=1+z;
				}
			}
			else if (model == "GlassPane") {
                const width = .125;
                const length = .5625;
                const gap = (1 - width) * .5;
                const gapWidth = gap + width;

                const glassBlocks = [20,95,101,102,139,160];
                const specialIndex = Minecraft.Blocks.specialBlocks.indexOf.bind(Minecraft.Blocks.specialBlocks);
                const alphaIndex = Minecraft.Blocks.alphaBlocks.indexOf.bind(Minecraft.Blocks.alphaBlocks);

                const canAttach = (id) => {
                    return glassBlocks.indexOf(id) > -1 || !(specialIndex(id) > -1 || alphaIndex(id) > -1);
                }
                
                const boxes = [];
				
                let bid = 0;
                
                const xm = ((bid = getId(x - 1, y, z)) == id) || canAttach(bid);
                const xp = ((bid = getId(x + 1, y, z)) == id) || canAttach(bid);
                const zm = ((bid = getId(x, y, z - 1)) == id) || canAttach(bid);
                const zp = ((bid = getId(x, y, z + 1)) == id) || canAttach(bid);

                
                if (xm && xp) {
                    boxes.push([x, y, z + gap, x + 1, y + 1, z + gapWidth]);
                }
                else if (xm) {
                    boxes.push([x, y, z + gap, x + length, y + 1, z + gapWidth]);
                }
                else if (xp) {
                    boxes.push([x + (1-length), y, z + gap, x + 1, y + 1, z + gapWidth]);
                }
                
                if (zm && zp) {
                    boxes.push([x + gap, y, z, x + gapWidth, y + 1, z + 1]);
                }
                else if (zm) {
                    boxes.push([x + gap, y, z, x + gapWidth, y + 1, z + length]);
                }
                else if (zp) {
                    boxes.push([x + gap, y, z + 1 - length, x + gapWidth, y + 1, z + 1]);
                }               
                
                if (!xm && !xp && !zm && !zp) {
                    boxes.push([x, y, z + gap, x + 1, y + 1, z + gapWidth]);
                    boxes.push([x + gap, y, z, x + gapWidth, y + 1, z + 1]);
                }
                
                return boxes;
			}
			else if (model == "Fence") {
                const width = .25;
                const length = .625;
                const gap = (1 - width) * .5;
                const gapWidth = gap + width;

                const fenceBlocks = [85,107,113,183,184,185,186,187,188,189,190,191,192];
                const leaveBlocks = [18,161];

                const specialIndex = Minecraft.Blocks.specialBlocks.indexOf.bind(Minecraft.Blocks.specialBlocks);
                const alphaIndex = Minecraft.Blocks.alphaBlocks.indexOf.bind(Minecraft.Blocks.alphaBlocks);

                const canAttach = (id) => {
                    return fenceBlocks.indexOf(id) > -1 || (!(specialIndex(id) > -1 || alphaIndex(id) > -1) && leaveBlocks.indexOf(id) == -1);
                }
                
                const boxes = [];
				
                let bid = 0;
                
                const xm = ((bid = getId(x - 1, y, z)) == id) || canAttach(bid);
                const xp = ((bid = getId(x + 1, y, z)) == id) || canAttach(bid);
                const zm = ((bid = getId(x, y, z - 1)) == id) || canAttach(bid);
                const zp = ((bid = getId(x, y, z + 1)) == id) || canAttach(bid);

                const ypp = y + (forMovementCollision ? 1.5 : 1);
                
                if (xm && xp) {
                    boxes.push([x, y, z + gap, x + 1, ypp, z + gapWidth]);
                }
                else if (xm) {
                    boxes.push([x, y, z + gap, x + length, ypp, z + gapWidth]);
                }
                else if (xp) {
                    boxes.push([x + (1-length), y, z + gap, x + 1, ypp, z + gapWidth]);
                }
                
                if (zm && zp) {
                    boxes.push([x + gap, y, z, x + gapWidth, ypp, z + 1]);
                }
                else if (zm) {
                    boxes.push([x + gap, y, z, x + gapWidth, ypp, z + length]);
                }
                else if (zp) {
                    boxes.push([x + gap, y, z + 1 - length, x + gapWidth, ypp, z + 1]);
                }               
                
                if (!xm && !xp && !zm && !zp) {
                    boxes.push([x + gap, y, z + gap, x + gapWidth, ypp, z + gapWidth]);
                }
                
                return boxes;
			}
			else if (model == "Wall") {
                
                const boxes = [];
                const center = .25;
                const centerGap = .75;
                const side = .3125;
                const sideGap = .6875;
                const sideLength = .25;
            
                const wallBlocks = [20,95,102,139,160];			
                const specialIndex = Minecraft.Blocks.specialBlocks.indexOf.bind(Minecraft.Blocks.specialBlocks);
                const alphaIndex = Minecraft.Blocks.alphaBlocks.indexOf.bind(Minecraft.Blocks.alphaBlocks);

                const canAttach = (id) => {
                    return wallBlocks.indexOf(id) > -1 || !(specialIndex(id) > -1 || alphaIndex(id) > -1);
                }
                
                const blxm = getId(x - 1, y, z);
                const blxp = getId(x + 1, y, z);
                const blzm = getId(x, y, z - 1);
                const blzp = getId(x, y, z + 1);
                const yy = y + (forMovementCollision ? 1.5 : .875);
                const yyy = y + (forMovementCollision ? 1.5 : 1);
                

                const sides = [];
                sides[0] = (canAttach(blxm) || wallBlocks.indexOf(blxm) !== -1);
                sides[1] = (canAttach(blxp) || wallBlocks.indexOf(blxp) !== -1);
                sides[2] = (canAttach(blzm) || wallBlocks.indexOf(blzm) !== -1);
                sides[3] = (canAttach(blzp) || wallBlocks.indexOf(blzp) !== -1);
                
                let drawCenter = false;
                
                if ((sides[0] && sides[2]) || (sides[1] && sides[2])) drawCenter = true;
                if ((sides[0] && sides[3]) || (sides[1] && sides[3])) drawCenter = true;
                if (!sides[0] && !sides[1] && !sides[2] && !sides[3]) drawCenter = true;
                if (sides[0] + sides[1] + sides[2] + sides[3] <= 1) drawCenter = true;
                
                /////////////////////////////// center post
                if (drawCenter) {
                    boxes.push([x + center, y, z + center, x + centerGap, yyy, z + centerGap]);
                }
                
                if (sides[0] && sides[1]) {
                    boxes.push([x, y, z + side, x + 1, yy, z + sideGap]);
                }
                else if (sides[0]) { ////////////////////////////// X- top post
                    boxes.push([x, y, z + side, x + sideLength, yy, z + sideGap]);
                }
                else if (sides[1]) { ////////////////////////////// X+ top post
                    boxes.push([x + (1 - sideLength), y, z + side, x + 1, yy, z + sideGap]);
                }
                
                if (sides[2] && sides[3]) {
                    boxes.push([x + side, y, z, x + sideGap, yy, z + 1]);
                }
                else if (sides[2]) { ////////////////////////////// Z- top post
                    boxes.push([x + side, y, z, x + sideGap, yy, z + sideLength]);
                }
                else if (sides[3]) { ////////////////////////////// Z+ top post
                    boxes.push([x + side, y, z + (1 - sideLength), x + sideGap, yy, z + 1]);
                }
                
                return boxes;
            }
			else if (model == "Snow") {
                const side = .125 * ((data % 8) + 1);
                const offset = (1 - side) - (forMovementCollision ? -.125 : 0);
                bb[4] -= offset;
            }
            else if (model == "Minesweeper") {

				if (data <= 8) {
					bb[4] = bb[1] + .5;
				}
				else if (data == 10) {
					bb[4] = bb[1] + 1;
				}
				else {
					bb[4] = bb[1] +.875;
				}
			}
            else if (model == "Piston") {
                if (data > 7) {
                    const gap = .25;
                    
                    switch(data % 8) {
                        case 0: bb[1] +=gap; break;
                        case 1: bb[4] -=gap; break;
                        case 2: bb[2] +=gap; break;
                        case 3: bb[5] -=gap; break;
                        case 4: bb[0] +=gap; break;
                        case 5: bb[3] -=gap; break;
                    }  
                }
			}
            else if (model == "PistonHead") {
                const center = [x + .375, y + .375, z + .375, x + .625, y + .625, z + .625];
                
                const gap = .75;
                const gapB = .125;
                const gapC = .25;
                const gapD = .625;
                switch(data % 8) {
                    case 0: bb[4] -=gap; center[1] -= gapB; center[4] += gapD; break;
                    case 1: bb[1] +=gap; center[1] -= gapD; center[4] += gapB; break;
                    case 2: bb[5] -=gap; center[2] -= gapB; center[5] += gapD; break;
                    case 3: bb[2] +=gap; center[2] -= gapD; center[5] += gapB; break;
                    case 4: bb[3] -=gap; center[0] -= gapB; center[3] += gapD; break;
                    case 5: bb[0] +=gap; center[0] -= gapD; center[3] += gapB; break;
                }
                
                ba.push(center);
			}
            else if (model == "Liquid") {
                const heightArray = [.9, .8, .7, .6, .5, .4, .3, .2, .1, 0];
                const height = heightArray[data % 8];
                
                bb[4] = bb[1] + height;
			}
            else if (model == "Portal") {
                if (data == 1) {
                    bb[2] += .375;
                    bb[5] -= .375;
                }
                else if (data == 2) {
                    bb[0] += .375;
                    bb[3] -= .375;
                }
			}
            else if (model == "FenceGate") {
                const oddMod = data % 2;
                
                if (oddMod == 0) {
                    bb[2] += .375;
                    bb[5] -= .375;
                }
                else {
                    bb[0] += .375;
                    bb[3] -= .375;
                }
                
                const isClosed = data % 8 < 4;
                
                if (isClosed && forMovementCollision) {
                    bb[4] += .5;
                }
                else if (!isClosed && forMovementCollision) {
                    bb[4] -= 1;
                }
			}
            else if (model == "SoulSand") {
                if (!forMovementCollision) {
                    bb[4] += .125;
                }
			}
		}
		
		return ba;
	},		
	getPlacementBlock(shape, x, y, z, id, meta, direction, normal, bottom = true, player) {       
        const placementType = typeof this.blockPlacement[id] !== 'undefined' ? this.blockPlacement[id] : null;
        if (placementType == null) return [id, meta];

        switch(placementType) {
            case 'Stairs': {
                if (meta != 0) return [id, meta];
                if (normal[1] == 0) { // we hit the side of a block
                    if (bottom) {
                        if (normal[0] == 1) return [id, 1];
                        else if (normal[0] == -1) return [id, 0];
                        else if (normal[2] == 1) return [id, 3];
                        else if (normal[2] == -1) return [id, 2];
                    }
                    else {
                        if (normal[0] == 1) return [id, 5];
                        else if (normal[0] == -1) return [id, 4];
                        else if (normal[2] == 1) return [id, 7];
                        else if (normal[2] == -1) return [id, 6];
                    }
                }
                else {
                    if (normal[1] == 1) {
                        if (direction[0] == 1) return [id, 0];
                        else if (direction[0] == -1) return [id, 1];
                        else if (direction[2] == 1) return [id, 2];
                        else if (direction[2] == -1) return [id, 3];
                    }
                    else {
                        if (direction[0] == 1) return [id, 4];
                        else if (direction[0] == -1) return [id, 5];
                        else if (direction[2] == 1) return [id, 6];
                        else if (direction[2] == -1) return [id, 7];
                    }                    
                }
                
                return [id, meta];
            }
            case 'Slabs': {
                meta %= 8;
                if (normal[1] == 0) {
                    if (bottom) return [id, meta];
                    else return [id, meta + 8];
                }
                else {
                    if (normal[1] == 1) return [id, meta];
                    else return [id, meta + 8];             
                }
                
                return [id, meta];
            }
            case 'Furnace': {
                if (meta != 0) return [id, meta];
                if (direction[0] == 1) return [id, 4];
                else if (direction[0] == -1) return [id, 5];
                else if (direction[2] == 1) return [id, 2];
                else if (direction[2] == -1) return [id, 3];
                return [id, meta]; 
            }
            case 'Vine': {
                if (normal[0] == 1) return [id, 2];
                else if (normal[0] == -1) return [id, 8];
                else if (normal[2] == 1) return [id, 4];
                else if (normal[2] == -1) return [id, 1];
                return [id, meta];
            }
            case 'RedstoneDevice': {
                if (direction[0] == 1) return [id, 1];
                else if (direction[0] == -1) return [id, 3];
                else if (direction[2] == 1) return [id, 2];
                else if (direction[2] == -1) return [id, 0];
                return [id, meta];
            }
            case 'Torch': {
                if (normal[0] == 1) return [id, 1];
                else if (normal[0] == -1) return [id, 2];
                else if (normal[2] == 1) return [id, 3];
                else if (normal[2] == -1) return [id, 4];
                return [id, 5];
            }
            case 'Door': {
                if (direction[0] == 1) return [id, 0];
                else if (direction[0] == -1) return [id, 2];
                else if (direction[2] == 1) return [id, 1];
                else if (direction[2] == -1) return [id, 3];
                return [id, meta];
            }
            case 'Trapdoor': {
                if (normal[1] == 0) {
                    let baseData;
                    if (normal[0] == 1) baseData = 3;
                    else if (normal[0] == -1) baseData = 2;
                    else if (normal[2] == 1) baseData = 1;
                    else if (normal[2] == -1) baseData = 0;
                    
                    if (!bottom) baseData += 8;
                    return [id, baseData];
                }
                else {
                    let baseData;
                    if (direction[0] == 1) baseData = 2;
                    else if (direction[0] == -1) baseData = 3;
                    else if (direction[2] == 1) baseData = 0;
                    else if (direction[2] == -1) baseData = 1;
                    
                    if (normal[1] == 1) {
                        return [id, baseData];
                    }
                    else if (normal[1] == -1 || !bottom) {
                        return [id, baseData + 8];
                    }
                    else if (bottom) {
                        return [id, baseData];
                    }
                }

                return [id, meta];
            }
            case 'Sign': {
                if (normal[1] == 0) {
                    id = 68;
                    if (normal[0] == 1) return [id, 5];
                    else if (normal[0] == -1) return [id, 4];
                    else if (normal[2] == 1) return [id, 3];
                    else if (normal[2] == -1) return [id, 2];
                    return [id, meta];                    
                }
                else {
                    id = 63;
                    const yaw = player.yaw;
                    const snapInterval = 360 / 16;
                    const yawSnap = Minecraft.util.snapValue(yaw, snapInterval);
                    
                    let yawIndex = (yawSnap / snapInterval) % 16;
                    yawIndex = yawIndex == 0 ? 0 : 16 - yawIndex;
                    return [id, yawIndex];
                }
                break;
            }
            case 'WoodLog': {
                if (meta < 12) {
                    const metaBase = meta % 4;

                    if (normal[0] != 0) {
                        return [id, metaBase + 4];                 
                    }
                    else if (normal[1] != 0) {
                        return [id, metaBase];                 
                    }
                    else if (normal[2] != 0) {
                        return [id, metaBase + 8];                 
                    }
                }
                break;
            }
            case 'Snow': {
                if (normal[1] == 1) {
                    if (shape.getBlockId(x,y-1,z) == id) {
                       
                        let currentHeight = shape.getBlockData(x,y-1,z);
                        meta = currentHeight >= 7 ? 0 : currentHeight+1;
                        
                        return [id, meta, x, y - 1, z];
                    }
                }
                
                return [id, meta];
            }
            case 'Piston': {
                const extended = meta > 7;
                let baseData = 0;
                
                if (player.pitch <= -45) {
                    baseData = 1;
                }
                else if (player.pitch >= 45) {
                    baseData = 0;
                }
                else {
                    if (direction[0] == 1) baseData = 4;
                    if (direction[0] == -1) baseData = 5;
                    if (direction[2] == 1) baseData = 2;
                    if (direction[2] == -1) baseData = 3;                    
                }
                
                if (extended) baseData += 8;
                return [id, baseData];
            }
            case 'PistonHead': {
                const sticky = meta > 7;
                let baseData = 0;
                
                if (player.pitch <= -45) {
                    baseData = 1;
                }
                else if (player.pitch >= 45) {
                    baseData = 0;
                }
                else {
                    if (direction[0] == 1) baseData = 4;
                    if (direction[0] == -1) baseData = 5;
                    if (direction[2] == 1) baseData = 2;
                    if (direction[2] == -1) baseData = 3;                    
                }
                
                if (sticky) baseData += 8;
                return [id, baseData];
            }
            case 'Portal': {
                const sticky = meta > 7;
                let baseData = 0;
                
                if (normal[0] != 0) {
                    baseData = 2
                }
                else if (normal[2] != 0) {
                    baseData = 1
                }
                else {
                    if (direction[0] != 0) baseData = 2;
                    if (direction[2] != 0) baseData = 1;                 
                }
                
                return [id, baseData];
            }
            case 'Bed': {
                let baseData = 0;
                if (direction[0] == 1) {
                    baseData = 3
                }
                else if (direction[0] == -1) {
                    baseData = 1
                }
                else if (direction[2] == 1) {
                    baseData = 0
                }
                else if (direction[2] == -1) {
                    baseData = 2
                }                
                return [id, baseData];
            }
            case 'Ladder': {
                // Special logic at the end for stacking ladders up and down
                
                let baseData = 0;
                if (normal[1] != 0) {
                    if (direction[0] == 1) {
                        baseData = 4
                    }
                    else if (direction[0] == -1) {
                        baseData = 5
                    }
                    else if (direction[2] == 1) {
                        baseData = 2
                    }
                    else if (direction[2] == -1) {
                        baseData = 3
                    }
                }
                else {
                    let offset = [];
                    if (normal[0] == -1) {
                        baseData = 4
                        offset = [1,0,0];
                    }
                    else if (normal[0] == 1) {
                        baseData = 5
                        offset = [-1,0,0];
                    }
                    else if (normal[2] == -1) {
                        baseData = 2
                        offset = [0,0,1];
                    }
                    else if (normal[2] == 1) {
                        baseData = 3
                        offset = [0,0,-1];
                    }
                    
                    const anchorPos = [x + offset[0], y + offset[1], z + offset[2]];
                    const attachBlock = shape.getBlock(...anchorPos);
                    
                    // Special logic for building with ladders enabling them to stack
                    // up or down when placing on another and looking in that direction
                    if (attachBlock.id == id && attachBlock.data == baseData) {
                        const dir = [0, player.pitch >= 0 ? 1 : -1, 0];
                        
                        // Move in that direction till we find the end, then see if 
                        // we are able to put a block in the next open position
                        let nextPos = [anchorPos[0] + dir[0], anchorPos[1] + dir[1], anchorPos[2] + dir[2]];
                        let nextMatches = true;
                        let lastBlock = null;
                        let count = 0;
                        
                        while (nextMatches) {
                            
                            const nextBlock = shape.getBlock(...nextPos);
                            if (!nextBlock || nextBlock.id != id || nextBlock.data != baseData) {
                                nextMatches = false;
                            }
                            else {
                                nextPos[1] += dir[1];
                            }
                            
                            if (++count >= 255) return [id, baseData];
                        }
                        
                        // We found the end, now check if its open and has a non-air suppport behind it
                        const nextBlock = shape.getBlock(...nextPos);
                        if (nextBlock.id == 0) {
                            const nextAnchorPos = [nextPos[0] + offset[0], nextPos[1] + offset[1], nextPos[2] + offset[2]]
                            const nextAnchorBlock = shape.getBlock(...nextAnchorPos);
                            
                            if (nextAnchorBlock && nextAnchorBlock.id != 0) {
                                // Add a new ladder there if it has a non-air supporting block behind it
                                return [id, baseData, ...nextPos];
                            }
                        }
                        
                        return null;
                    }
                    
                    
                }
                return [id, baseData];
            }
            case 'FenceGate': {
                let baseData = 0;
                switch(true) {
                    case (direction[0] == -1): baseData = 1; break;
                    case (direction[0] == 1): baseData = 3; break;
                    case (direction[2] == -1): baseData = 2; break;
                    case (direction[2] == 1): baseData = 0; break;
                }
                
                return [id, baseData];
            }
            case 'Chest': {
                let baseData = 2;
                switch(true) {
                    case (direction[0] == -1): baseData = 5; break;
                    case (direction[0] == 1): baseData = 4; break;
                    case (direction[2] == -1): baseData = 3; break;
                    case (direction[2] == 1): baseData = 2; break;
                }
                
                return [id, baseData];
            }

        }
        
        return [id, meta];
    },
    getRotatedBlockData(id, data, angle) {
        
        const rotationSet = this.blockRotations[id];
        if (!rotationSet) return data;
        
        const rotationSetData = this.blockRotationSets[rotationSet];
        let rotationData = null;
        let currentIndex = -1;
        let setCount = 0;
        
        for (let i = 0; i < rotationSetData.length; i++) {
            rotationData = rotationSetData[i];
            currentIndex = rotationData.indexOf(data);
            if (currentIndex > -1) {
                setCount = rotationData.length;
                break;
            }
        }
        
        if (currentIndex < 0) return data;
        
        angle %= 360;
        if (angle < 0) angle += 360;
        
        const increment = angle / 90;
        const endIndex = (currentIndex + increment) % setCount;
        
        return rotationData[endIndex];
    },
    
	isAlphaBlock(id) {
		return (this.alphaBlocks.indexOf(id) !== -1);
	},
	isSolidBlock(id) {
		return (this.nonSolidBlocks.indexOf(id) == -1);
	},
	isUseableBlock(id) {
		return typeof this.blockUse[id] !== 'undefined';
	},
    isChangeSensitiveBlock(id) {
        return typeof this.blockChange[id] !== 'undefined';
    },
    isMovementModifierBlock(id) {
        return typeof this.blockMovementModifiers.indexOf(id) > -1;
    },

	useBlock(id, shape, x, y, z) {
		if (this.isUseableBlock(id)) {
            const useActionId = this.blockUse[id];
			this.blockOnUse[useActionId](shape, x, y, z);
		}
	},
	changeBlock(shape, x, y, z, id, data, isBreaking = false) {
		if (this.isChangeSensitiveBlock(id)) {
            const changeId = this.blockChange[id];
			this.blockOnChange[changeId](shape, x, y, z, id, data, isBreaking);
		}
	},
    onBlockUpdateTick(shape, x, y, z, id, data) {
        const updateType = this.blockTickUpdates[id];
        if (!updateType) return;
        
        const rngVal = Math.random();
        
        switch(updateType) {
            case "Grass":
                const rng = Math.floor(rngVal * 36);
                
                let pos = [];
                switch(rng % 12) {
                    case 0: pos = [-1, -1, 0]; break;
                    case 1: pos = [1, -1, 0]; break;
                    case 2: pos = [0, -1, -1]; break;
                    case 3: pos = [0, -1, 1]; break;
                    
                    case 4: pos = [-1, 0, 0]; break;
                    case 5: pos = [1, 0, 0]; break;
                    case 6: pos = [0, 0, -1]; break;
                    case 7: pos = [0, 0, 1]; break;
                    
                    case 8: pos = [-1, 1, 0]; break;
                    case 9: pos = [1, 1, 0]; break;
                    case 10: pos = [0, 1, -1]; break;
                    case 11: pos = [0, 1, 1]; break;
                }
                
                pos = [x + pos[0], y + pos[1], z + pos[2]];
                if (shape.getBlockId(...pos) == 3) {
                    if (shape.getBlockId(pos[0], pos[1] + 1, pos[2]) == 0) {
                        shape.setBlock(...pos, id, 0);
                    }
                }                
                break;
                
            case "Vine":                
                if (rngVal > .75) {
                    if (shape.getBlockId(x, y - 1, z) == 0) {
                        shape.setBlock(x, y - 1, z, id, data);
                    }
                }
              
                break;
        }
    },

	loadColors(img, alpha = false) {
		
		var cvs = document.createElement('canvas');
		cvs.width = img.width;
		cvs.height = img.height;
		var ctx = cvs.getContext('2d');
		ctx.drawImage(img, 0, 0, img.width, img.height);
		
		if (!alpha) this.reverseColorList = [];
		
		var d, tc, px, py;
		
		for (var i = 1; i < 256; i++) {
			for (var j = 0; j < 16; j++) {
				if ((!alpha && !this.isAlphaBlock(i)) || alpha && this.isAlphaBlock(i)) {
					// if (this.getBlockColor(i, j) == null) {
						tc = this.getBlockTextureCoords(i, j);
						
						px = tc[0] * 16;
						py = tc[1] * 16;
						d = ctx.getImageData(px, py, 1, 1).data;
						
						if (!alpha) {
							if (this.specialBlocks.indexOf(i) == -1) {
								
								var match = false;
								for (var k = 0; k < this.reverseColorList.length; k++) {
									var tClr = this.reverseColorList[k].clr;
									if (tClr[0] == d[0] && tClr[1] == d[1] && tClr[2] == d[2]) {
										match = true;
										break;
									}
								}
								
								if (!match) this.reverseColorList.push({id: i + ":" + j , clr: [d[0], d[1], d[2]]});
							}
							
						}
						
						this.blockColors[i + ":" + j] = [d[0], d[1], d[2]];
						
					// }   
					
				}
			
			}
		}		
		
	},
	getClosestColorBlock(clrA) {
		
		var diff, clrB;
		var closeIndex = null, closeVal = null;
		
		for (var i = 0; i < this.reverseColorList.length; i++) {
			
			clrB = this.reverseColorList[i].clr;
			diff = Math.pow(clrB[0]-clrA[0], 2) + Math.pow(clrB[1]-clrA[1], 2) + Math.pow(clrB[2]-clrA[2], 2);
			if (closeVal == null || diff < closeVal) {
				closeVal = diff;
				closeIndex = i;
			}
		}
		
		return closeIndex == null ? null : this.reverseColorList[closeIndex];
		
	},
	
};

Minecraft.Shapes = {
	
	base: {
		

	
	},
	
	tree: {
		leafClump(params) {
		
			var par = Minecraft.util.loadParams(params, {
				shape: null,
				vec: new Cubical.Lib.Vector3(0,0,0),
				size: 6,
				mat: [18,0],
				hollow: 0,
				density: .9,
				yLimit: 4,
			});
			
			var shp = par.shape == null ? new Cubical.Lib.TreeLeafNode() : par.shape;
			var size = parseInt(par.size);
			if (size % 2 == 0) size++;
			var halfSize = size / 2;
			var yLimit = par.yLimit;
			
			var cyclerFun = function(x,y,z,d) {
				var pos = new Cubical.Lib.Vector3(x, y, z);
				
				var adjY = (pos.y - (par.vec.y - halfSize));
				if ((adjY < yLimit) || (adjY > (size) + yLimit)) return;
		
				if (yLimit < 0) {
					if (Math.abs(yLimit) > halfSize) {
						pos.addSelf(0,Math.abs(yLimit)-halfSize+1,0);
					}else {
						pos.addSelf(0,-(yLimit + halfSize)+1,0);
					}
				}
				if (yLimit > 0) {
					if (Math.abs(yLimit) > halfSize) {
						pos.addSelf(0,-(yLimit-halfSize),0);
					}else {
						pos.addSelf(0,(halfSize - yLimit),0);
					}
				}
				if (yLimit == 0) {
					pos.addSelf(0, halfSize+1, 0);
				}
				
				shp.add(x,y,z,par.mat[0], par.mat[1]);
			};
			
			var cycler = new Cubical.Lib.SphereIterator(cyclerFun, par.size);
			cycler.run(par.vec);

			return shp;
		
		},
		leafSphere(params) {

			var par = Minecraft.util.loadParams(params, {
				shape: null,
				vec: new Cubical.Lib.Vector3(0,0,0),
				size: 6,
				mat: [18,4],
				hollow: 0,
				density: 1,
				yLimit:4,
			});

			var shp = par.shape == null ? new Cubical.Lib.TreeLeafNode() : par.shape;
			var vec = par.vec;
			var hollow = parseInt(par.hollow);
			var size = parseInt(par.size);
			
			if (size % 2 == 0) size++;
			var halfSize = size / 2;
			var yLimit = par.yLimit > 0 ? size - par.yLimit: -(size - Math.abs(par.yLimit));
			
			var cyclerFun = function(x,y,z,d) {
				var pos = new Cubical.Lib.Vector3(x, y, z);
				
				if ((hollow != 0) && (d <= (halfSize - hollow))) return;
				var diff = halfSize - (halfSize * par.density);
				var pctIn = (1-((d-(halfSize * par.density)) / diff));
		
				if ((pctIn < Math.random()) && (par.density != 1)) return;
				
				var adjY = (pos.y - (vec.y - halfSize));
				if ((adjY < yLimit) || (adjY > (size) + yLimit)) return;
		
				if (yLimit < 0) {
					if (Math.abs(yLimit) > halfSize) {
						pos.addSelf(0,Math.abs(yLimit)-halfSize+1,0);
					}else {
						pos.addSelf(0,-(yLimit + halfSize)+1,0);
					}
				}
				if (yLimit > 0) {
					if (Math.abs(yLimit) > halfSize) {
						pos.addSelf(0,-(yLimit-halfSize),0);
					}else {
						pos.addSelf(0,(halfSize - yLimit),0);
					}
				}
				if (yLimit == 0) {
					pos.addSelf(0, halfSize+1, 0);
				}
				
				pos.addSelf(0,-.5,0);
				shp.add(pos.x, Math.floor(pos.y), pos.z, par.mat[0], par.mat[1]);
			};
			
			var cycler = new Cubical.Lib.SphereIterator(cyclerFun, par.size);
			cycler.run(par.vec);

			return shp;
		},			
		small(params) {

			var par = Minecraft.util.loadParams(params, {
				shape: new Cubical.Lib.VoxelShape(),
				vec: [0,0,0],
				size: 6,
				wood: [17,0],
				leaf: [18,4],
				clump: false,
				range: -1,
				invert: 1
			});
			
			var size = Minecraft.util.rangeSize(par);
			var shp = par.shape;
			var leaf;	
			
			for (var y = 1; y <= size; y++) {
				shp.add(par.vec[0], par.vec[1]+(y*par.invert), par.vec[2], par.wood[0], par.wood[1]);
			}

			if (par.clump === true) leaf = Minecraft.Shapes.tree.leafClump({size: 6, mat: par.leaf});
			else leaf = Minecraft.Shapes.tree.leafSphere({size: size, mat:par.leaf, hollow: 0, density:.9, yLimit:3*par.invert+(size*.1)});
			
			leaf.placeIntoShape(shp, par.vec[0], par.vec[1] + size, par.vec[2]);
			
			return shp;
		},
		rainforest(params) {
			
			var par = Minecraft.util.loadParams(params, {
				shape: new Cubical.Lib.VoxelShape(),
				vec: [0,0,0],
				size: 16,
				range: -1,
				wood: [17,0],
				leaf: [18,4],
				clump: false,
				invert: 1,
				branchSize:	.1,
				branchLimit: .7,
				branchProb:	.5,
				leafSize: 10
			});
			
			var shp = par.shape;
			var leaf;
			
			if(par.range === -1) par.range = par.size*.3;
			var size = par.size+Math.floor(Math.random() * par.range);

			var vec = new Cubical.Lib.Vector3(...par.vec);
			var vecb = new Cubical.Lib.Vector3(0,0,0);

			for (var y = 1; y <= size; y++) {
				
				if (par.branchLimit  === -1 || y > par.branchLimit*size) {
					if(Math.random() >= (1 - par.branchProb)) {
						
						var randDir = Minecraft.util.getRandomXZVec();
						var sideDir = Minecraft.util.getRandomXZSide(randDir);
						var branchLength = Math.ceil((size*par.branchSize) + (Math.random()*(size * par.branchSize)));
						for (var b = 1; b <= branchLength; b++) {
							vecb = vec.add(randDir[0] * b, parseInt((y * par.invert) + (b / 2 * par.invert)), randDir[2] * b);
							vecb = vecb.add(parseInt(sideDir[0] * (b / 2)), 0, parseInt(sideDir[2] * b / 2));
							shp.add(vecb.x,vecb.y,vecb.z,par.wood[0], par.wood[1]);
						}

						var bVec = vecb.add(0, 1, 0);
						shp.add(vecb.x, vecb.y, vecb.z, par.wood[0], par.wood[1]);
						
						if (par.clump === true) leaf = Minecraft.Shapes.tree.leafClump({size:par.leafSize/2+1, mat: par.leaf});
						else leaf = Minecraft.Shapes.tree.leafSphere({size:par.leafSize, yLimit: 2*par.invert, density:.95, hollow:0, mat:par.leaf});
						
						leaf.placeIntoShape(shp, ...vecb.addPos(0, par.invert, 0));
					}
				}
				
				var trVec = vec.add(0,y*par.invert,0);
				shp.add(trVec.x,trVec.y,trVec.z,par.wood[0], par.wood[1]);
			}
			
			if (par.clump) leaf = Minecraft.Shapes.tree.leafClump({size: 6, mat: par.leaf});
			else leaf = Minecraft.Shapes.tree.leafSphere({size:par.leafSize*size*.1, yLimit: 3*par.invert, density: .95, hollow:0, mat: par.leaf});
			leaf.placeIntoShape(shp, ...vec.addPos(0, size*par.invert, 0));
			
			return shp;
		},		
		palmTree(params) { //TODO: Finish this, create static palm leaf shape

			var par = Minecraft.util.loadParams(params, {
				shape:  new Cubical.Lib.VoxelShape(),
				vec: [0,0,0],
				size: 16,
				range: -1,
				wood: [17,0],
				leaf: [18,4],
				clump: false,
				invert: 1,
				branchSize:	.1,
				branchLimit: .7,
				branchProb:	.5,
				leafSize: 10
			});
			
			var shp = par.shape;
		
			var randDir = Minecraft.util.getRandomXZVec();
			var sideDir = Minecraft.util.getRandomXZSide(randDir);
			var vec = new Cubical.Lib.Vector3(par.vec[0], par.vec[1], par.vec[2]);
			var setVec = vec.clone();
			
			for (var y = 0; y < par.size; y++) {
				setVec = vec.add(randDir[0] * y * .5, (y + 1)* par.invert, randDir[2] * y * .5);
				setVec.addSelf(sideDir[0] * y * .5, 0, sideDir[2] * y * .5);
				
				setVec.x = parseInt(setVec.x);
				setVec.y = parseInt(setVec.y);
				setVec.z = parseInt(setVec.z);
				
				shp.add(setVec.x, setVec.y, setVec.z, par.wood[0], par.wood[1]);
			}
			
			shp.add(setVec.x, setVec.y+1, setVec.z, par.wood[0], par.wood[1]);
			shp.insertShape(Minecraft.Shapes.internal.palmLeaf(), setVec.x, setVec.y+1, setVec.z);
			
			return shp;

		},
		mediumTree(params) {
			var par = Minecraft.util.loadParams(params, {
				shape: new Cubical.Lib.VoxelShape(),
				vec: new Cubical.Lib.Vector3(),
				size: 15,
				wood: [17, 0],
				leaf: [18, 4],
				clump: false,
				invert: 1,
				range: -50,
				branchSize:	.8,
				leafSize: 7
			});
			
			var shp = par.shape;
			var size = par.size;

			var scl = .1;
			var leaf;
			
			var newPnt = par.vec;
			for (var y = 1; y <= size; y++)	 {
				
				var randDir = Minecraft.util.getRandomXZVec();
				var sideDir = Minecraft.util.getRandomXZSide(randDir);
				var branchLength = Math.min((size*par.branchSize*.3) + (Math.random()*(size*par.branchSize)), 8);

				for(var branch = 1; branch < branchLength; branch++) {
					newPnt = par.vec.add(randDir[0]*branch, parseInt((y*par.invert)+(branch/2*par.invert)), randDir[2]*branch);
					newPnt = newPnt.add(parseInt(sideDir[0]*(branch/2)), 0, parseInt(sideDir[2]*(branch/2)));
					shp.add(newPnt.x, newPnt.y, newPnt.z, par.wood[0], par.wood[1]);
				}
				
				shp.add(...par.vec.addPos(0,y*par.invert,0), par.wood[0], par.wood[1]);
				
				if (par.clump === true) leaf = Minecraft.Shapes.tree.leafClump({size: 6, mat: par.leaf});
				else leaf = Minecraft.Shapes.tree.leafSphere({size:par.leafSize, yLimit: 3*par.invert, density: .9, hollow:0, mat: par.leaf});

				leaf.placeIntoShape(shp, ...newPnt.addPos(0,2 * par.invert,0));

				shp.add(...newPnt.addPos(0,1 * par.invert,0), par.wood[0], par.wood[1]);
			}
			// builder.Shapes.Tree.SmallTrunk({size: (size/y)*size*.5, height: size, vec: par.vec, mat: par.wood});

			if (par.clump === true) leaf = Minecraft.Shapes.tree.leafClump({size: 6, mat: par.leaf});
			else leaf = Minecraft.Shapes.tree.leafSphere({size:8, yLimit: 4*par.invert, density: .8, hollow:0, mat: par.leaf});			
			
			leaf.placeIntoShape(shp, ...par.vec.addPos(0,size*par.invert,0));
			
			return shp;
		},

	},
	
	internal: {
		data: {
			palmLeaf: "eyJtaW4iOlstMywtMSwtM10sIm1heCI6WzMsMSwzXSwiZGF0YSI6Wy0zLC0xLDAsMTgsMCwtMiwwLDAsMTgsMCwtMSwwLC0xLDE4LDAsLTEsMCwwLDE4LDAsLTEsMCwxLDE4LDAsMCwtMSwtMywxOCwwLDAsLTEsMywxOCwwLDAsMCwtMiwxOCwwLDAsMCwtMSwxOCwwLDAsMCwwLDE4LDAsMCwwLDEsMTgsMCwwLDAsMiwxOCwwLDAsMSwwLDE4LDAsMSwwLC0xLDE4LDAsMSwwLDAsMTgsMCwxLDAsMSwxOCwwLDIsMCwwLDE4LDAsMywtMSwwLDE4LDBdfQ==",
		},
		
		palmLeaf() {
			if (this._palmLeaf) return this._palmLeaf;
			
			this._palmLeaf = new Cubical.Lib.VoxelShape().fromBase64(this.data.palmLeaf);
			return this._palmLeaf;
		},
	}
};

