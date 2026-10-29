import assert from 'node:assert/strict';
import {crc32,deflateRawSync,inflateRawSync} from 'node:zlib';

const cleanName=name=>typeof name==='string'&&name.length>0&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes('\0')&&!name.split('/').some(part=>part==='..'||part==='.'||part==='')&&name.length<65536;

/** A deterministic ZIP32 writer. Entries contain regular-file bytes only. */
export function makeZip(entries){
 assert.ok(entries.length<65535,'Too many ZIP entries');const local=[],central=[],names=new Set();let offset=0;
 for(const entry of [...entries].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  assert.ok(cleanName(entry.name),'Unsafe ZIP entry name');assert.ok(!names.has(entry.name),'Duplicate ZIP entry');names.add(entry.name);
  const name=Buffer.from(entry.name),data=Buffer.from(entry.data),packed=deflateRawSync(data,{level:9}),crc=crc32(data);assert.ok(data.length<0xffffffff&&packed.length<0xffffffff&&offset<0xffffffff,'ZIP32 size limit');
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,packed);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(0x0314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(packed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE((0o100644<<16)>>>0,38);directory.writeUInt32LE(offset,42);central.push(directory,name);offset+=header.length+name.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);assert.ok(offset+directory.length<0xffffffff,'ZIP32 archive size limit');end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}

export function verifyZip(zip,entries){
 const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+10),entries.length);assert.equal(zip.readUInt16LE(end+20),0);const expected=new Map(entries.map(e=>[e.name,Buffer.from(e.data)]));let position=zip.readUInt32LE(end+16);
 for(let i=0;i<entries.length;i++){
  assert.equal(zip.readUInt32LE(position),0x02014b50);const size=zip.readUInt32LE(position+20),rawSize=zip.readUInt32LE(position+24),nameLength=zip.readUInt16LE(position+28),extraLength=zip.readUInt16LE(position+30),commentLength=zip.readUInt16LE(position+32),offset=zip.readUInt32LE(position+42),name=zip.subarray(position+46,position+46+nameLength).toString();assert.ok(expected.has(name),'Unexpected ZIP file');assert.equal(zip.readUInt32LE(offset),0x04034b50);assert.equal(zip.readUInt16LE(offset+8),8);
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28),data=inflateRawSync(zip.subarray(start,start+size));assert.equal(data.length,rawSize);assert.equal(crc32(data),zip.readUInt32LE(position+16));assert.ok(data.equals(expected.get(name)),'ZIP data changed');expected.delete(name);position+=46+nameLength+extraLength+commentLength;
 }
 assert.equal(position,end);assert.equal(expected.size,0);return true;
}

