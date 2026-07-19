import type { LibheifModule } from "libheif-js/wasm-bundle";

// High quality, not lossless: a lossless PNG of a decoded photo can run
// several times the size of an equivalent JPEG for negligible perceptual
// gain, and that blob is what ends up held in memory, in IndexedDB on save,
// and re-decoded on every depth/normal re-run.
const CONVERTED_QUALITY = 0.95;

// Lazily and dynamically imported: this bundles a real libheif WASM build
// (~6MB unpacked). A static top-level import would pull that into the main
// app chunk for every user, even the overwhelming majority who never upload
// a HEIC file — this way it's only fetched the first time someone actually
// does. (heic2any was tried first — it bundles its own libheif WASM frozen
// since ~2023, which rejected some real-world HEIC files with "ERR_LIBHEIF
// format not supported"; libheif-js is actively maintained and gets a
// current libheif core instead.)
let libheifPromise: Promise<LibheifModule> | null = null;

function loadLibheif(): Promise<LibheifModule> {
	if (!libheifPromise) {
		libheifPromise = (async () => {
			const mod = await import("libheif-js/wasm-bundle");
			const exported = mod.default;
			return "then" in exported ? await exported : exported;
		})();
	}
	return libheifPromise;
}

export async function convertHeicToJpeg(file: File): Promise<Blob> {
	const libheif = await loadLibheif();
	const decoder = new libheif.HeifDecoder();
	const buffer = new Uint8Array(await file.arrayBuffer());
	const images = decoder.decode(buffer);
	if (images.length === 0) {
		throw new Error("This HEIC file doesn't contain a readable image.");
	}

	// HEIC containers can hold multiple images (e.g. Live Photos embed an
	// auxiliary frame) — the first is the primary photo.
	const image = images[0];
	const width = image.get_width();
	const height = image.get_height();

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create a canvas context to decode the HEIC image.");
	}
	const imageData = context.createImageData(width, height);

	await new Promise<void>((resolve, reject) => {
		image.display(imageData, (displayData) => {
			if (!displayData) {
				reject(new Error("libheif couldn't render the decoded HEIC image."));
				return;
			}
			resolve();
		});
	});
	context.putImageData(imageData, 0, 0);

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error("Could not encode the decoded HEIC image."));
					return;
				}
				resolve(blob);
			},
			"image/jpeg",
			CONVERTED_QUALITY,
		);
	});
}
