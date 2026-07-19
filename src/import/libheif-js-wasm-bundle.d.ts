// libheif-js ships a comprehensive .d.ts, but it's generated from the raw
// Emscripten C bindings (_heif_image_handle_get_width, etc.), not the
// higher-level HeifDecoder/HeifImage JS wrapper the README's usage sample
// documents — and there's no `exports`/`types` mapping for the
// "libheif-js/wasm-bundle" subpath at all. This declares only the small
// slice of that wrapper API this app actually calls.
declare module "libheif-js/wasm-bundle" {
	export type LibheifImage = {
		get_width(): number;
		get_height(): number;
		display(imageData: ImageData, callback: (displayData: ImageData | null) => void): void;
	};

	export type LibheifModule = {
		HeifDecoder: new () => {
			decode(buffer: Uint8Array): LibheifImage[];
		};
	};

	// wasm-bundle's own export is an Emscripten MODULARIZE factory already
	// invoked once (see wasm-bundle.js: `module.exports = require(...)()`),
	// which resolves asynchronously — so the default export is the module
	// itself OR a promise of it, depending on load timing.
	const libheifModule: LibheifModule | Promise<LibheifModule>;
	export default libheifModule;
}
