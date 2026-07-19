import { CanvasTexture } from "three";

// How strongly depth slope bends the fake surface normal before lighting it.
const SLOPE_SCALE = 4;

function normalize(vector: [number, number, number]): [number, number, number] {
	const [x, y, z] = vector;
	const length = Math.sqrt(x * x + y * y + z * z) || 1;
	return [x / length, y / length, z / length];
}

const LIGHT_DIRECTION = normalize([0.45, 0.55, 0.7]);

// Reads the depth buffer produced by depthWorker.ts (R === G === B === depth,
// 0..255) and derives a pseudo surface-lighting map: a 3x3 Sobel estimates
// local slope, which is treated as a fake surface normal and lit from a
// fixed direction — the same trick as a normal map, but computed directly
// from the depth image instead of authored by hand.
export function deriveLightingTexture(width: number, height: number, depthBuffer: ArrayBuffer): CanvasTexture {
	const depth = new Uint8ClampedArray(depthBuffer);
	const lighting = new Uint8ClampedArray(width * height * 4);

	const sample = (x: number, y: number): number => {
		const clampedX = Math.min(width - 1, Math.max(0, x));
		const clampedY = Math.min(height - 1, Math.max(0, y));
		return depth[(clampedY * width + clampedX) * 4] / 255;
	};

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const topLeft = sample(x - 1, y - 1);
			const top = sample(x, y - 1);
			const topRight = sample(x + 1, y - 1);
			const left = sample(x - 1, y);
			const right = sample(x + 1, y);
			const bottomLeft = sample(x - 1, y + 1);
			const bottom = sample(x, y + 1);
			const bottomRight = sample(x + 1, y + 1);

			const gx = topRight + 2 * right + bottomRight - topLeft - 2 * left - bottomLeft;
			const gy = bottomLeft + 2 * bottom + bottomRight - topLeft - 2 * top - topRight;

			const normal = normalize([-gx * SLOPE_SCALE, -gy * SLOPE_SCALE, 1]);
			const shade = Math.max(
				0,
				normal[0] * LIGHT_DIRECTION[0] + normal[1] * LIGHT_DIRECTION[1] + normal[2] * LIGHT_DIRECTION[2],
			);

			const value = Math.round(shade * 255);
			const index = (y * width + x) * 4;
			lighting[index] = value;
			lighting[index + 1] = value;
			lighting[index + 2] = value;
			lighting[index + 3] = 255;
		}
	}

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create a canvas context for the lighting texture.");
	}
	context.putImageData(new ImageData(lighting, width, height), 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.needsUpdate = true;
	return texture;
}

// Reads the RGBA-encoded normal buffer produced by normalWorker.ts
// (R/G/B = nx/ny/nz packed as channel*0.5+0.5, A = confidence, all 0..255)
// and lights the real per-pixel surface normal against the same
// LIGHT_DIRECTION deriveLightingTexture uses — a drop-in replacement for the
// Sobel approximation with byte-for-byte identical output shape, so nothing
// downstream (DepthPlane, the shader, DepthViewer) needs to change.
export function deriveLightingTextureFromNormals(width: number, height: number, normalBuffer: ArrayBuffer): CanvasTexture {
	const normals = new Uint8ClampedArray(normalBuffer);
	const lighting = new Uint8ClampedArray(width * height * 4);

	for (let index = 0; index < width * height; index += 1) {
		const base = index * 4;
		const nx = (normals[base] / 255) * 2 - 1;
		const ny = (normals[base + 1] / 255) * 2 - 1;
		const nz = (normals[base + 2] / 255) * 2 - 1;

		// Re-normalize: the 8-bit round trip through the RGBA buffer drifts
		// unit vectors slightly off length 1.
		const normal = normalize([nx, ny, nz]);
		const shade = Math.max(
			0,
			normal[0] * LIGHT_DIRECTION[0] + normal[1] * LIGHT_DIRECTION[1] + normal[2] * LIGHT_DIRECTION[2],
		);

		const value = Math.round(shade * 255);
		lighting[base] = value;
		lighting[base + 1] = value;
		lighting[base + 2] = value;
		lighting[base + 3] = 255;
	}

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create a canvas context for the lighting texture.");
	}
	context.putImageData(new ImageData(lighting, width, height), 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.needsUpdate = true;
	return texture;
}
