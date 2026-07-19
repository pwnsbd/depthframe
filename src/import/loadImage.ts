import { extractDngPreview } from "./dngPreview";
import { convertHeicToJpeg } from "./heicConvert";

// Formats the browser can decode natively via createImageBitmap/<img> — no
// conversion needed.
const NATIVE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export type LoadedImage = {
	objectUrl: string;
	bitmap: ImageBitmap;
	// The normalized (always browser-decodable) file — for HEIC/DNG this is a
	// converted/extracted file, not the raw upload. Callers should use this,
	// not the File originally passed to loadImageFile, for anything
	// downstream (re-running depth/normal, saving the project, etc.) so
	// those paths never have to know HEIC/DNG exist.
	file: File;
	name: string;
	type: string;
	size: number;
	width: number;
	height: number;
};

const DECODE_ERROR = "Couldn't read that file as an image. It may be corrupted or damaged.";
const UNSUPPORTED_ERROR = "Unsupported file type. Use PNG, JPG, JPEG, WebP, HEIC, or DNG.";

function getExtension(filename: string): string {
	const match = /\.([a-z0-9]+)$/i.exec(filename);
	return match ? match[1].toLowerCase() : "";
}

function withExtension(filename: string, newExtension: string): string {
	const base = filename.replace(/\.[a-z0-9]+$/i, "");
	return `${base}.${newExtension}`;
}

type SniffedFormat = "native" | "heic" | "dng" | "unknown";

const ISOBMFF_HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

// Reads the actual byte signature instead of trusting the filename/MIME —
// both lie in practice on Windows. In particular, iCloud for Windows and
// some sync tools silently convert HEIC to JPEG on copy while keeping the
// original .heic filename; routing that file into heic2any anyway makes it
// correctly reject with "already browser readable", which is a real failure
// this app should just route around instead of surfacing as an error.
async function sniffFormat(file: File): Promise<SniffedFormat> {
	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const hex = (start: number, end: number) =>
		Array.from(head.slice(start, end))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));

	if (hex(0, 3) === "ffd8ff") return "native"; // JPEG
	if (hex(0, 4) === "89504e47") return "native"; // PNG
	if (hex(0, 4) === "47494638") return "native"; // GIF
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "native";
	if (ascii(4, 8) === "ftyp" && ISOBMFF_HEIC_BRANDS.has(ascii(8, 12))) return "heic";
	if (hex(0, 4) === "49492a00" || hex(0, 4) === "4d4d002a") return "dng"; // TIFF byte-order marker + magic 42 — DNG is TIFF-based

	return "unknown";
}

async function normalizeImageFile(file: File): Promise<File> {
	const sniffed = await sniffFormat(file);
	const extension = getExtension(file.name);
	// Byte signature is authoritative when conclusive; the extension is only
	// a fallback for the (rare) case sniffFormat can't identify the format
	// from its first 16 bytes.
	const format: SniffedFormat =
		sniffed !== "unknown"
			? sniffed
			: extension === "heic" || extension === "heif"
				? "heic"
				: extension === "dng"
					? "dng"
					: "unknown";

	if (format === "heic") {
		let converted: Blob;
		try {
			converted = await convertHeicToJpeg(file);
		} catch (error) {
			// Swallowing this into DECODE_ERROR made real heic2any failures
			// indistinguishable from a corrupt file — log the real reason.
			// libheif's WASM layer throws plain objects/strings, not Error
			// instances, so `instanceof Error` alone misses most of its
			// failures — this pulls a usable message out of any shape.
			console.error("HEIC conversion failed:", error, JSON.stringify(error));
			const detail =
				error instanceof Error
					? error.message
					: typeof error === "string"
						? error
						: error && typeof error === "object" && "message" in error && typeof error.message === "string"
							? error.message
							: null;
			throw new Error(detail ? `Couldn't convert that HEIC file: ${detail}` : DECODE_ERROR);
		}
		return new File([converted], withExtension(file.name, "jpg"), { type: "image/jpeg" });
	}

	if (format === "dng") {
		const preview = await extractDngPreview(file);
		return new File([preview], withExtension(file.name, "jpg"), { type: "image/jpeg" });
	}

	if (format === "native" || NATIVE_TYPES.has(file.type)) {
		return file;
	}

	throw new Error(UNSUPPORTED_ERROR);
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
	const normalized = await normalizeImageFile(file);

	// Two independent decodes: one bitmap is transferred into the worker
	// (transferring hands over ownership), the other backs the on-screen
	// object URL used as the color texture.
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(normalized);
	} catch {
		throw new Error(DECODE_ERROR);
	}

	if (bitmap.width === 0 || bitmap.height === 0) {
		bitmap.close();
		throw new Error(DECODE_ERROR);
	}

	const objectUrl = URL.createObjectURL(normalized);

	return {
		objectUrl,
		bitmap,
		file: normalized,
		name: normalized.name,
		type: normalized.type,
		size: normalized.size,
		width: bitmap.width,
		height: bitmap.height,
	};
}

export async function cloneBitmapForWorker(file: File): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(file);
	} catch {
		throw new Error(DECODE_ERROR);
	}
}
