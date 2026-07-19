// Image export: a generous ceiling rather than true native resolution for
// arbitrarily large sources — mainly a guard against exotic/older GPUs'
// MAX_TEXTURE_SIZE limits (commonly 8192, sometimes 4096 on old hardware),
// not a real-world cap for typical consumer photos.
export const MAX_IMAGE_EXPORT_EDGE = 6000;

// Video export: capped much lower than image export. In-browser H.264
// encoding (ffmpeg.wasm, single-threaded WASM) gets impractically slow and
// memory-heavy well before native photo resolution, and social platforms
// (this feature's whole reason to exist) re-encode down to well under 1080p
// on ingest anyway — there's no real quality benefit to feeding it more.
export const MAX_VIDEO_EXPORT_EDGE = 1920;

export type ExportDimensions = { width: number; height: number };

// Scales (nativeWidth, nativeHeight) down to fit within maxEdge on its
// longer side, preserving aspect ratio, and rounds to even numbers on both
// axes — required by libx264 + yuv420p for video, harmless for the lossless
// PNG path. Never upscales past the source's native resolution.
export function computeExportDimensions(nativeWidth: number, nativeHeight: number, maxEdge: number): ExportDimensions {
	const longEdge = Math.max(nativeWidth, nativeHeight);
	const scale = Math.min(1, maxEdge / longEdge);
	const width = Math.max(2, Math.round((nativeWidth * scale) / 2) * 2);
	const height = Math.max(2, Math.round((nativeHeight * scale) / 2) * 2);
	return { width, height };
}
