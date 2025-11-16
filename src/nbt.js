// Minimal browser NBT writer (uncompressed). Supports the tag types this app emits.
// API: export function writeUncompressed(payload)
// payload shape:
// { type: 'compound', name: string, value: { key: {type:.., value:..}, ... } }
// Supported types: 'end','byte','short','int','string','byte[]','int[]','byteArray','intArray','list','compound'

const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  Byte_Array: 7,
  String: 8,
  List: 9,
  Compound: 10,
  Int_Array: 11,
  Long_Array: 12,
};

const enc = new TextEncoder();

class ByteWriter {
  constructor(initial = 1 << 16) {
    this.buffer = new Uint8Array(initial);
    this.length = 0;
  }
  ensure(extra) {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let next = this.buffer.length || 1024;
    while (next < needed) next <<= 1;
    const nb = new Uint8Array(next);
    nb.set(this.buffer, 0);
    this.buffer = nb;
  }
  pushByte(v) {
    this.ensure(1);
    this.buffer[this.length++] = v & 0xFF;
  }
  pushI16(v) {
    this.ensure(2);
    v = (v << 16 >> 16);
    this.buffer[this.length++] = (v >>> 8) & 0xFF;
    this.buffer[this.length++] = v & 0xFF;
  }
  pushI32(v) {
    this.ensure(4);
    v = v | 0;
    this.buffer[this.length++] = (v >>> 24) & 0xFF;
    this.buffer[this.length++] = (v >>> 16) & 0xFF;
    this.buffer[this.length++] = (v >>> 8) & 0xFF;
    this.buffer[this.length++] = v & 0xFF;
  }
  pushBytes(arr = []) {
    if (!arr.length) return;
    this.ensure(arr.length);
    this.buffer.set(arr, this.length);
    this.length += arr.length;
  }
  toUint8Array() {
    return this.buffer.slice(0, this.length);
  }
}

function pushU8(buf, v){ buf.pushByte(v); }
function pushI16(buf, v){ buf.pushI16(v); }
function pushI32(buf, v){ buf.pushI32(v); }
function pushStr(buf, s){ const b = enc.encode(s); pushI16(buf, b.length); buf.pushBytes(b); }

function writeTagPayload(buf, type, value){
  switch(type){
    case TAG.Byte:    pushU8(buf, (value|0) & 0xFF); break;
    case TAG.Short:   pushI16(buf, value|0); break;
    case TAG.Int:     pushI32(buf, value|0); break;
    case TAG.String:  pushStr(buf, String(value)); break;
    case TAG.Byte_Array: {
      const arr = value instanceof Uint8Array ? value : new Uint8Array(value);
      pushI32(buf, arr.length);
      buf.pushBytes(arr);
      break;
    }
    case TAG.Int_Array: {
      const arr = value; // assume Int32Array or number[]
      const len = arr.length|0; pushI32(buf, len);
      for (let i=0;i<len;i++) pushI32(buf, arr[i]|0);
      break;
    }
    case TAG.List: {
      const childTypeName = value.type; // 'int','compound','end', etc
      const childType = typeNameToId(childTypeName);
      const arr = value.value || [];
      pushU8(buf, childType);
      pushI32(buf, arr.length|0);
      for (let i=0;i<arr.length;i++) {
        const item = arr[i];
        writeUnnamedTag(buf, childType, item);
      }
      break;
    }
    case TAG.Compound: {
      const obj = value;
      for (const k of Object.keys(obj)){
        const v = obj[k];
        const t = typeNameToId(v.type);
        pushU8(buf, t);
        pushStr(buf, k);
        writeTagPayload(buf, t, v.value);
      }
      // TAG_End
      pushU8(buf, TAG.End);
      break;
    }
    default:
      throw new Error(`Unsupported NBT tag type id ${type}`);
  }
}

function writeUnnamedTag(buf, type, item){
  // item is a primitive value or a structured object depending on type
  if (type === TAG.Compound){
    // item should be an object of the shape { key: {type, value}, ... }
    writeTagPayload(buf, TAG.Compound, item);
  } else if (type === TAG.List){
    writeTagPayload(buf, TAG.List, item);
  } else if (type === TAG.String){
    writeTagPayload(buf, TAG.String, item);
  } else if (type === TAG.Byte_Array){
    writeTagPayload(buf, TAG.Byte_Array, item);
  } else if (type === TAG.Int_Array){
    writeTagPayload(buf, TAG.Int_Array, item);
  } else if (type === TAG.Int){
    writeTagPayload(buf, TAG.Int, item);
  } else if (type === TAG.Short){
    writeTagPayload(buf, TAG.Short, item);
  } else if (type === TAG.Byte){
    writeTagPayload(buf, TAG.Byte, item);
  } else {
    throw new Error(`Unsupported list child type ${type}`);
  }
}

function typeNameToId(name){
  switch(name){
    case 'end': return TAG.End;
    case 'byte': return TAG.Byte;
    case 'short': return TAG.Short;
    case 'int': return TAG.Int;
    case 'string': return TAG.String;
  case 'byte[]':
  case 'byteArray': return TAG.Byte_Array;
  case 'int[]':
  case 'intArray': return TAG.Int_Array;
    case 'list': return TAG.List;
    case 'compound': return TAG.Compound;
    default: throw new Error(`Unsupported NBT type name '${name}'`);
  }
}

export function writeUncompressed(payload){
  if (!payload || payload.type !== 'compound') throw new Error('Root must be a compound');
  const buf = new ByteWriter();
  // Root tag header: type + name + payload
  pushU8(buf, TAG.Compound);
  pushStr(buf, payload.name || '');
  writeTagPayload(buf, TAG.Compound, payload.value || {});
  return buf.toUint8Array();
}

export async function write(payload){
  // Optional compressed writer using CompressionStream if available
  const raw = writeUncompressed(payload);
  if (typeof CompressionStream !== 'undefined'){
    const cs = new CompressionStream('gzip');
    const blob = new Blob([raw]);
    const stream = blob.stream().pipeThrough(cs);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }
  // Fallback to uncompressed
  return raw;
}
