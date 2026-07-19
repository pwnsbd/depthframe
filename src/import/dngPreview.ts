// DNG is a TIFF-based RAW format. Rather than demosaicing the raw sensor
// data (a much heavier problem — real color science, no mature lightweight
// browser library), this extracts the embedded preview JPEG that DNG files
// almost always carry alongside the raw data specifically for fast-preview
// use cases like this one. It walks the TIFF IFD chain (IFD0, its linked
// IFDs, and any SubIFDs) looking for every IFD with a JPEG payload, and
// returns the largest one by pixel area.

const TAG_NEW_SUBFILE_TYPE = 0x00fe;
const TAG_IMAGE_WIDTH = 0x0100;
const TAG_IMAGE_LENGTH = 0x0101;
const TAG_COMPRESSION = 0x0103;
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_SUB_IFDS = 0x014a;
const TAG_JPEG_INTERCHANGE_FORMAT = 0x0201;
const TAG_JPEG_INTERCHANGE_FORMAT_LENGTH = 0x0202;

// TIFF field type -> byte size, indexed by the type ID (1-based; index 0 unused).
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

const JPEG_SOI = 0xffd8;

type IfdEntry = { tag: number; type: number; count: number; valueOffset: number };

type Candidate = {
	width: number;
	height: number;
	bytes: () => Uint8Array | null;
};

class TiffReader {
	private view: DataView;
	private littleEndian: boolean;
	private buffer: ArrayBuffer;

	constructor(buffer: ArrayBuffer) {
		this.buffer = buffer;
		this.view = new DataView(buffer);
		const marker = this.view.getUint16(0, false);
		if (marker === 0x4949) {
			this.littleEndian = true;
		} else if (marker === 0x4d4d) {
			this.littleEndian = false;
		} else {
			throw new Error("Not a TIFF/DNG file (bad byte-order marker).");
		}
		const magic = this.view.getUint16(2, this.littleEndian);
		if (magic !== 42) {
			throw new Error("Not a TIFF/DNG file (bad magic number).");
		}
	}

	get firstIfdOffset(): number {
		return this.view.getUint32(4, this.littleEndian);
	}

	private u16(offset: number): number {
		return this.view.getUint16(offset, this.littleEndian);
	}

	private u32(offset: number): number {
		return this.view.getUint32(offset, this.littleEndian);
	}

	// Reads all values of an IFD entry, following the offset if the values
	// don't fit inline in the 4-byte valueOffset field.
	readValues(entry: IfdEntry): number[] {
		const typeSize = TYPE_SIZES[entry.type] ?? 1;
		// parseIfd already resolved valueOffset to the actual byte position the
		// values live at — inline within the entry itself, or via the pointer,
		// depending on whether they fit in 4 bytes.
		const base = entry.valueOffset;
		const values: number[] = [];
		for (let i = 0; i < entry.count; i += 1) {
			const at = base + i * typeSize;
			switch (entry.type) {
				case 1: // BYTE
				case 6: // SBYTE
				case 7: // UNDEFINED
					values.push(this.view.getUint8(at));
					break;
				case 3: // SHORT
					values.push(this.u16(at));
					break;
				case 8: // SSHORT
					values.push(this.view.getInt16(at, this.littleEndian));
					break;
				case 4: // LONG
					values.push(this.u32(at));
					break;
				case 9: // SLONG
					values.push(this.view.getInt32(at, this.littleEndian));
					break;
				default:
					values.push(0);
					break;
			}
		}
		return values;
	}

	// Parses one IFD at `offset`, returning its entries and the offset of the
	// next IFD in the chain (0 if this is the last one).
	parseIfd(offset: number): { entries: Map<number, IfdEntry>; nextOffset: number } {
		const entryCount = this.u16(offset);
		const entries = new Map<number, IfdEntry>();
		for (let i = 0; i < entryCount; i += 1) {
			const entryOffset = offset + 2 + i * 12;
			const tag = this.u16(entryOffset);
			const type = this.u16(entryOffset + 2);
			const count = this.u32(entryOffset + 4);
			const typeSize = TYPE_SIZES[type] ?? 1;
			const totalSize = typeSize * count;
			// Inline values live at the valueOffset field's own position;
			// out-of-line values live wherever that field points.
			const valueOffset = totalSize <= 4 ? entryOffset + 8 : this.u32(entryOffset + 8);
			entries.set(tag, { tag, type, count, valueOffset });
		}
		const nextOffset = this.u32(offset + 2 + entryCount * 12);
		return { entries, nextOffset };
	}

	slice(offset: number, length: number): Uint8Array | null {
		if (offset < 0 || length <= 0 || offset + length > this.buffer.byteLength) {
			return null;
		}
		return new Uint8Array(this.buffer, offset, length);
	}
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
	return bytes.length > 2 && ((bytes[0] << 8) | bytes[1]) === JPEG_SOI;
}

function collectCandidate(reader: TiffReader, entries: Map<number, IfdEntry>): Candidate | null {
	const width = entries.has(TAG_IMAGE_WIDTH) ? reader.readValues(entries.get(TAG_IMAGE_WIDTH)!)[0] : 0;
	const height = entries.has(TAG_IMAGE_LENGTH) ? reader.readValues(entries.get(TAG_IMAGE_LENGTH)!)[0] : 0;

	const jpegOffsetEntry = entries.get(TAG_JPEG_INTERCHANGE_FORMAT);
	const jpegLengthEntry = entries.get(TAG_JPEG_INTERCHANGE_FORMAT_LENGTH);
	if (jpegOffsetEntry && jpegLengthEntry) {
		const offset = reader.readValues(jpegOffsetEntry)[0];
		const length = reader.readValues(jpegLengthEntry)[0];
		return {
			width,
			height,
			bytes: () => reader.slice(offset, length),
		};
	}

	// New-style JPEG storage: compressed data lives in strips instead of the
	// old JPEGInterchangeFormat tag pair. Compression 6/7 both show up in the
	// wild for DNG preview IFDs.
	const compression = entries.has(TAG_COMPRESSION) ? reader.readValues(entries.get(TAG_COMPRESSION)!)[0] : 0;
	const stripOffsetsEntry = entries.get(TAG_STRIP_OFFSETS);
	const stripByteCountsEntry = entries.get(TAG_STRIP_BYTE_COUNTS);
	if ((compression === 6 || compression === 7) && stripOffsetsEntry && stripByteCountsEntry) {
		const offsets = reader.readValues(stripOffsetsEntry);
		const lengths = reader.readValues(stripByteCountsEntry);
		return {
			width,
			height,
			bytes: () => {
				if (offsets.length === 1) {
					return reader.slice(offsets[0], lengths[0]);
				}
				const parts = offsets.map((offset, i) => reader.slice(offset, lengths[i]));
				if (parts.some((part) => part === null)) return null;
				const total = lengths.reduce((sum, len) => sum + len, 0);
				const merged = new Uint8Array(total);
				let cursor = 0;
				for (const part of parts) {
					merged.set(part!, cursor);
					cursor += part!.length;
				}
				return merged;
			},
		};
	}

	return null;
}

export async function extractDngPreview(file: File): Promise<Blob> {
	const buffer = await file.arrayBuffer();
	const reader = new TiffReader(buffer);

	const visited = new Set<number>();
	const queue: number[] = [reader.firstIfdOffset];
	const candidates: Candidate[] = [];

	while (queue.length > 0) {
		const offset = queue.shift()!;
		if (offset === 0 || visited.has(offset) || offset >= buffer.byteLength) continue;
		visited.add(offset);

		const { entries, nextOffset } = reader.parseIfd(offset);

		const newSubfileType = entries.has(TAG_NEW_SUBFILE_TYPE) ? reader.readValues(entries.get(TAG_NEW_SUBFILE_TYPE)!)[0] : 0;
		// NewSubfileType 0 = main image. For a raw sensor IFD that's the CFA
		// mosaic (no JPEG payload, so collectCandidate naturally returns null
		// for it anyway) — for a thumbnail/preview IFD it's fine either way,
		// so no need to filter on this beyond documenting intent.
		void newSubfileType;

		const candidate = collectCandidate(reader, entries);
		if (candidate) {
			candidates.push(candidate);
		}

		if (nextOffset) queue.push(nextOffset);
		const subIfdsEntry = entries.get(TAG_SUB_IFDS);
		if (subIfdsEntry) {
			for (const subOffset of reader.readValues(subIfdsEntry)) {
				queue.push(subOffset);
			}
		}
	}

	candidates.sort((a, b) => b.width * b.height - a.width * a.height);
	for (const candidate of candidates) {
		const bytes = candidate.bytes();
		if (bytes && looksLikeJpeg(bytes)) {
			// bytes is a view over the file's ArrayBuffer, but TS types
			// Uint8Array.buffer as ArrayBufferLike (which includes
			// SharedArrayBuffer) — Blob wants a plain ArrayBuffer, so copy.
			return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
		}
	}

	throw new Error("This DNG doesn't have a usable embedded preview image.");
}
