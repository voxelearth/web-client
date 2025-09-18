'use strict';

(function() {
	class NbtDocument {
		constructor(data) {
			this.data = new Uint8Array(0);
			this.offset = 0;
			
			if (data) this.parse(data);
			else this.root = new Nbt.CompoundTag("Schematic");
			this.root.setRoot(true);
		}
		parse(data, callback) {
			while (this.isCompressed(data)) {
                data = pako.ungzip(data)
			}
		
			this.data = data;
			
			const root = NbtDocument.parseData(this.data, this.offset);
			this.root = root;
			this.root.setRoot(true);
			
			if (callback) callback();
		}
		write() {
			const newSize = this.root.update();
			this.buffer = new ArrayBuffer(newSize);
			this.data = new Uint8Array(this.buffer);
			this.offset = 0;
			this.root.writeId(this);
			this.root.writeName(this);
			this.root.write(this);
		}
		isCompressed(data) {
			return data[0] === 0x1f && data[1] === 0x8b;
		}
		getRoot() {
			return this.root;
		}
		update(){
			return this.root.update();
		}
        toJson() {
            const obj = {};
            
            if (this.root instanceof Nbt.CompoundTag) {
                obj[this.root.getName()] = this.root.toJson();
            }
            
            return obj;
        }
        equals(other) {
            if (!(this.root instanceof NbtTag)
                || !(other.root instanceof NbtTag)) return false;
            
            return this.root.equals(other.root);
        }
        clone() {
            return new NbtDocument(this.data.slice());
        }
		static parseData(data, offset) {
			const id = data[offset++];
			const tag = new (NbtTagTypes[id])();

			const dv = new DataView(data.buffer, offset, 2);
			const nameSize = dv.getInt16(0);
			offset += 2;

			tag.name = String.fromCharCode.apply(null, new Uint8Array(data.buffer.slice(offset, offset += nameSize)));
			tag.read(data, offset);
			tag.size += (nameSize + 3);
			return tag;
		}
    }
	class NbtTag {
		constructor(name = "", value = null) {
			this.name = name;
            this.value = null;
			this.size = 0;
			this.tagId = "None";
            
            if (value != null) this.setValue(value);
		}
		read(data, offset) {
			
		}
		write(nbt) {
			this.writeId(nbt);
			this.writeName(nbt)
		}
		writeId(nbt) {
            nbt.data[nbt.offset++] = this.id();
		}
		writeName(nbt) {
            const name = this.name;
			nbt.data[nbt.offset++] = name.length >>> 8;
            nbt.data[nbt.offset++] = name.length & 0xFF;
			
			for (let i = 0; i < name.length; i++) {
                nbt.data[nbt.offset++] = name.charCodeAt(i);
			}
		}
		byteSize() {
			return 0;
		}
		id() {
			return -1;
		}
		getName() {
			return this.name;
		}
		getSize() {
			return this.size;
		}
		update() {
			this.size = this.byteSize() + (this.name.length > 0 ? this.name.length + 3 : 0);
			return this.size;
		}
		getChildCount() {
			return -1;
		}
		getValue() {
			return this.value;
		}
		getTagId() {
			return this.tagId;
		}
		setValue(val) {
			this.value = val;
			return this;
		}
		setName(name) {
			this.name = name;
			return this;
		}
        toJson() {
            return this.value;
        }
        equals(other) {
            if (!(other instanceof NbtTag)
                || this.id() != other.id()
                || this.name != other.name
                || this.getChildCount() != other.getChildCount()) {
                    return false;
                }
            
            return true;
        }
        clone() {
            const tagId = this.id();
			const clone = new (NbtTagTypes[tagId])();
            clone.setName(this.name);
            // clone.setValue(this.value);
            
            return clone;
        }
	}
	class EndTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.size = 1; 
			this.tagId = "TAG_End";
		}
		read(data, offset) {
			
		}
		write(nbt) {
			
		}
		byteSize() {
			return 0;
		}
        clone() {
            return new EndTag();
        }
		id() { return 0; }
	}
	class ByteTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Byte";
		}
		read(data, offset) {
			this.value = data[offset];
			this.size = this.byteSize();
		}
		write(nbt) {
            nbt.data[nbt.offset++] = this.value; // DataView.setInt8
		}
		byteSize() {
			return 1;
		}
		setValue(value){
			this.value = Math.min(Math.max(parseInt(value) || 0, 0), 255);
			return this;
		}
        toJson() {
            return this.value;
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }
        clone() {
            const clone = super.clone();
            clone.value = this.value;
            
            return clone;
        }
		id() { return 1; }
	}
	class ShortTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Short";
		}
		read(data, offset) {
			var dv = new DataView(data.buffer, offset, 2);
			this.value = dv.getInt16(0);
			this.size = this.byteSize();
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 2).setInt16(0, this.value);
			nbt.offset+=2;
		}
		setValue(value){
			this.value = parseInt(value) || 0;
			return this;
		}
		byteSize() { return 2; }
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }		
        clone() {
            const clone = super.clone();
            clone.value = this.value;
            
            return clone;
        }
		id() { return 2; }
	}
	class IntTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Int";
		}		
		read(data, offset) {
			var dv = new DataView(data.buffer, offset, 4);
			this.value = dv.getInt32(0);
			this.size = this.byteSize();
		}
		setValue(value){
			this.value = parseInt(value) || 0;
			return this;
		}
        write(nbt) {
            let val = this.value;
            nbt.data[nbt.offset + 3] = val & 0xff; // DataView.setInt32
            nbt.data[nbt.offset + 2] = (val >>= 8) & 0xff;
            nbt.data[nbt.offset + 1] = (val >>= 8) & 0xff;
            nbt.data[nbt.offset + 0] = (val >>= 8) & 0xff;
            nbt.offset += 4;
		}
		byteSize() {
			return 4;
		}
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }		
        clone() {
            const clone = super.clone();
            clone.value = this.value;
            
            return clone;
        }
		id() { return 3; }		
	}
	class LongTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Long";
		}		
		read(data, offset) {
			var dv = new DataView(data.buffer, offset, 8);
			this.value = [dv.getInt32(0), dv.getInt32(4)];
			this.size = this.byteSize();
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.value[0]);
			nbt.offset+=4;
			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.value[1]);
			nbt.offset+=4;
		}
		setValue(value){
			this.value = parseInt(value) || 0;
			return this;
		}
		byteSize() {
            return 8;
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value[0] == other.value[0] && this.value[1] == other.value[1];
        }
        clone() {
            const clone = super.clone();
			clone.value = this.value.slice();
            
            return clone;
        }
		id() { return 4; }
	}
	class FloatTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Float";
		}		
		read(data, offset) {
			var dv = new DataView(data.buffer, offset, 4);
			this.value = dv.getFloat32(0);
			this.size = this.byteSize();
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 4).setFloat32(0, this.value);
			nbt.offset+=4;
		}
		setValue(value){
			this.value = parseFloat(value) || 0;
			return this;
		}
		byteSize() { return 4; }
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }		
        clone() {
            const clone = super.clone();
            clone.value = this.value;
            
            return clone;
        }
		id() { return 5; }
	}
	class DoubleTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Double";
		}		
		read(data, offset) {
			var dv = new DataView(data.buffer, offset, 8);
			this.value = dv.getFloat64(0);
			this.size = this.byteSize();
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 8).setFloat64(0, this.value);
			nbt.offset+=8;
		}
		setValue(value){
			this.value = parseFloat(value) || 0;
			return this;
		}
		byteSize() { return 8; }
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }		
        clone() {
            const clone = super.clone();
            clone.value = this.value;
            
            return clone;
        }
		id() { return 6; }
	}
	class ByteArrayTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Byte_Array";
		}		
		read(data, offset) {
			var arraySize = (new DataView(data.buffer, offset, 4)).getInt32(0);

			this.value = new Uint8Array(data.buffer.slice(offset + 4, offset + 4 + arraySize));
			this.size = arraySize + 4;
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.value.length);
			nbt.offset += 4;
			
            nbt.data.set(this.value, nbt.offset);
			nbt.offset += this.value.length;
		}
		getChildren() {
			return this.value;
		}
		getChildCount() {
			return this.value.length;
		}
		byteSize() {
			return -1;
		}
		update(){
			let size = this.getValue().length + 4;
			if(this.name.length > 0) size += this.name.length + 3;
			this.size = size;
			
            return this.size;
		}
        toJson() {
            return this.value.slice();
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            const children = this.getChildren();
            const otherChildren = other.getChildren();
            
            for (let i = 0; i < children.length; i++) {
                if (children[i] !== otherChildren[i]) return false;
            }

            return true;
        }
        clone() {
            const clone = super.clone();
            clone.value = this.value.slice();
            
            return clone;
        }
		id() { return 7; }
	}
	class StringTag extends NbtTag {
		constructor(name, value = "") {
			super(name, value);
			this.tagId = "TAG_String";
		}		
		read(data, offset) {

			var dv = new DataView(data.buffer, offset, 2);
			var stringSize = dv.getInt16(0);
			offset += 2;

			this.value = stringSize == 0 ? "" : String.fromCharCode.apply(null, new Uint8Array(data.buffer.slice(offset, offset + stringSize)));
			this.size = stringSize + 2;
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 2).setInt16(0, this.value.length);
			nbt.offset+=2;
			var view = new DataView(nbt.buffer, nbt.offset, this.value.length);
			for (var i = 0; i < this.value.length; i++) {
				view.setInt8(i, this.value.charCodeAt(i));
			}
			nbt.offset += this.value.length;
		}
		byteSize() {
			return -1;
		}
		setValue(value){
			this.value = String(value) || "";
			return this;
		}
		update(){
			var size = this.getValue().length + 2;
			if(this.name.length > 0) size += this.name.length + 3;
			this.size = size;
			return this.size;
		}
        equals(other) {
            if (!super.equals(other)) return false;
            
            return this.value == other.value;
        }		
        clone() {
            const clone = super.clone();
            clone.value = this.value.slice();
            
            return clone;
        }
		id() { return 8; }
	}
	class ListTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.listType = 0;
			this.children = [];
			this.tagId = "TAG_List";
		}
		read(data, offset) {

			var dv = new DataView(data.buffer, offset, 1);
			this.listType = dv.getInt8(0);
			offset += 1;
			
			dv = new DataView(data.buffer, offset, 4);
			var arraySize = dv.getInt32(0);
			offset += 4;
			this.size += 5;

			let id = this.listType;
			
			for (var i = 0; i < arraySize; i++) {
				let tag = new (NbtTagTypes[id])();
				tag.read(data, offset);
				offset += tag.getSize();
				this.size += tag.getSize();
				this.addChild(tag);
			}
			
		}
		addChild(child) {
			if(this.children.length == 0 && this.listType == 0) {
				this.listType = child.id();
			}
			this.children.push(child);
			return child;
		}
		getChildCount() {
			return this.children.length;
		}
		getChildren() {
			return this.children;
		}
		getChildValue(id) {
			return typeof this.children[id] === 'undefined' ? null : this.children[id].getValue();
		}
		getValue() {
			return this.getChildren();
		}
        setListType(typeId) {
			this.listType = typeId; 
		}
		write(nbt) {
            nbt.data[nbt.offset++] = this.listType; // DataView.setInt8

			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.children.length);
			nbt.offset+=4;
			for (var i = 0; i < this.children.length; i++) {
				this.children[i].write(nbt);
			}
		}
		byteSize() {
			return -1;
		}
		update(){
			let size = 5;
			
			for (let i = 0; i < this.children.length; i++) {
				size += this.children[i].update();
			}
			if(this.name.length > 0) size += this.name.length + 3;
			this.size = size;
			return this.size;
		}
		clear(){
			this.children = [];
		}
        toJson() {
            const children = this.getChildren();
            const array = new Array(children.length);
            
            for (let i = 0; i < children.length; i++) {
                array[i] = children[i].toJson();
            }
            
            return array;
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            const children = this.getChildren();
            const otherChildren = other.getChildren();
            
            for (let i = 0; i < children.length; i++) {
                if (!children[i].equals(otherChildren[i])) {
                    return false;
                }
            }

            return true;
        }
        clone() {
            const clone = super.clone();
            const children = this.getChildren();
            
            for (let i = 0; i < children.length; i++) {
                clone.addChild(children[i].clone());
            }
            
            return clone;
        }
		id() { return 9; }
	}
	class CompoundTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.children = {};
			this.tagId = "TAG_Compound";
			this.root = false;
		}
		read(data, offset) {

			while(true) {
				var offsetBase = offset;
				let id = data[offset++];
				let tag = new (NbtTagTypes[id])();
				if(tag instanceof EndTag) {
					this.size += tag.getSize();
					break;
				}
				
				var dv = new DataView(data.buffer, offset, 2);
				var nameSize = dv.getInt16(0);
				offset += 2;

				tag.name = String.fromCharCode.apply(null, new Uint8Array(data.buffer.slice(offset, offset + nameSize)));
				offset += nameSize;
				tag.read(data, offset);
				tag.size += (nameSize + 3);
				
				offset = offsetBase + tag.getSize();
				this.size += tag.getSize();
				this.addChild(tag);
			}
			
		}
		write(nbt) {
			for (let i in this.children) {
                const child = this.children[i];
				child.writeId(nbt);
				child.writeName(nbt);
				child.write(nbt);
			}
            
            nbt.offset++; // Increment offset but leave 0 for end tag
		}
		byteSize() {
			return -1;
		}
		getChildren() {
			return this.children;
		}
		getChildCount() {
			var cnt = 0;
			for (var i in this.children) cnt++;
			return cnt;
		}	
		addChild(child) {
			this.children[child.name] = child;
			return child;
		}
		getChild(name) {
			return this.children[name];
		}
		getChildValue(name) {
			return typeof this.children[name] === 'undefined' ? null : this.children[name].getValue();
		}
		getValue() {
			return this.getChildren();
		}
		setRoot(isRoot) {
			this.root = isRoot ? true : false;
			return this;
		}
		isRoot() {
			return this.root;
		}
		update(){
			var size = 1;
			var childSize = 0;
			for (var i in this.children) {
				childSize = this.children[i].update();
				size += childSize;
			}
			if(this.name.length > 0 || this.isRoot()) size += this.name.length + 3;
			this.size = size;
			return this.size;
		}
		clear() {
			this.children = {};
		}
        equals(other) {
            if (!super.equals(other)) return false;
            
            const children = this.getChildren();
            const otherChildren = other.getChildren();
            
            for (let c in children) {
                if (!children[c].equals(otherChildren[c])) {
                    return false;
                }
            }

            return true;
        }
        clone() {
            const clone = super.clone();
            clone.isRoot = this.isRoot;
            
            const children = this.getChildren();
            
            for (let c in children) {
                clone.addChild(children[c].clone());
            }
            
            return clone;
        }
		id() { return 10; }
		toString() {
			var cnt = 0;
			for (var i in this.children) cnt++;
			return "Compound [" + cnt + "]";
		}
        toJson() {
            const obj = {};
            const children = this.getChildren();
            
            for (let c in children) {
                obj[c] = children[c].toJson();
            }
            
            return obj;
        }
	}
	class IntArrayTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Int_Array";
		}
		read(data, offset) {

			var dv = new DataView(data.buffer, offset, 4);
			const elements = dv.getInt32(0);
            var arraySize = elements * 4;
			offset += 4;
            
            this.value = new Int32Array(elements);
            var view = new DataView(data.buffer, offset, arraySize);
            
            for (let i = 0; i < elements; i++) {
                this.value[i] = view.getInt32(i * 4);
            } 

			// this.value = new Int32Array(data.buffer.slice(offset, offset + arraySize));
			this.size = arraySize + 4;
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.value.length);
			nbt.offset+=4;

            const view = new DataView(nbt.buffer, nbt.offset, this.value.length * 4);
            
            for (let i = 0; i < this.value.length; i++) {
                view.setInt32(i * 4, this.value[i]);
            }           
            
			// (new Uint8Array(nbt.buffer, nbt.offset, this.value.length * 4)).set(this.value, 0);
			nbt.offset+=this.value.length * 4;
		}
		getChildCount() {
			return this.value.length;
		}
		getChildren() {
			return this.value;
		}
		byteSize() {
			return -1;
		}
		update(){
			var size = this.getValue().length * 4 + 4;
			if (this.name.length > 0) size += this.name.length + 3;
			this.size = size;
			return this.size;
		}
        toJson() {
            return this.value.slice();
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            const children = this.getChildren();
            const otherChildren = other.getChildren();
            
            for (let i = 0; i < children.length; i++) {
                if (children[i] != otherChildren[i]) {
                    return false;
                }
            }

            return true;
        }
        clone() {
            const clone = super.clone();
            clone.value = this.value.slice();
            
            return clone;
        }
		id() { return 11; }
	}
	class LongArrayTag extends NbtTag {
		constructor(name, value) {
			super(name, value);
			this.tagId = "TAG_Long_Array";
		}
		read(data, offset) {
			const totalItems = new DataView(data.buffer, offset, 4).getInt32(0);
            const arraySize = totalItems * 8;
			offset += 4;

			this.value = new BigUint64Array(data.buffer.slice(offset, offset + arraySize));
			this.size = arraySize + 4;
		}
		write(nbt) {
			new DataView(nbt.buffer, nbt.offset, 4).setInt32(0, this.value.length);
			nbt.offset+=4;
			
            const view = new DataView(nbt.buffer, nbt.offset, this.value.length * 8);
            for (let i = 0; i < this.value.length; i++) {
                view.setBigUint64(i * 8, this.value[i], true);
            }

			nbt.offset+=this.value.length * 8;
		}
		getChildCount() {
			return this.value.length;
		}
		getChildren() {
			return this.value;
		}
		byteSize() {
			return -1;
		}
		update(){
			var size = this.getValue().length * 8 + 4;
			if(this.name.length > 0) size += this.name.length + 3;
			this.size = size;
			return this.size;
		}
        toJson() {
            return this.value.slice();
        }
        equals(other) {
            if (!super.equals(other)) return false;
            
            const children = this.getChildren();
            const otherChildren = other.getChildren();
            
            for (let i = 0; i < children.length; i++) {
                if (children[i] != otherChildren[i]) {
                    return false;
                }
            }

            return true;
        }
        clone() {
            const clone = super.clone();
            clone.value = this.value.slice();
            
            return clone;
        }  
		id() { return 12; }
	}
	
	const NbtTagTypes = [
		EndTag,
		ByteTag,
		ShortTag,
		IntTag,
		LongTag,
		FloatTag,
		DoubleTag,
		ByteArrayTag,
		StringTag,
		ListTag,
		CompoundTag,
		IntArrayTag,
        LongArrayTag
	];
	const Nbt = {
		NbtDocument,
		NbtTag,
		EndTag,
		ByteTag,
		ShortTag,
		IntTag,
		LongTag,
		FloatTag,
		DoubleTag,
		ByteArrayTag,
		StringTag,
		ListTag,
		CompoundTag,	
		IntArrayTag,
        LongArrayTag
	};

	self.Nbt = Nbt;
})();