import { CanvasTexture } from "three";

function createFlatTexture(rgb: string): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 2;
	canvas.height = 2;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = rgb;
		context.fillRect(0, 0, 2, 2);
	}
	const texture = new CanvasTexture(canvas);
	texture.needsUpdate = true;
	return texture;
}

// A uniform mid-gray texture. Since the shader offsets by (depth - 0.5),
// a flat 0.5 depth produces zero offset everywhere — a safe, correct
// "no depth yet" default rather than a special-cased branch in the shader.
export function createNeutralDepthTexture(): CanvasTexture {
	return createFlatTexture("rgb(128, 128, 128)");
}

// A uniform white texture — "fully foreground everywhere" — so a project
// that hasn't run segmentation yet has a mask that's a no-op in the shader.
export function createNeutralMaskTexture(): CanvasTexture {
	return createFlatTexture("rgb(255, 255, 255)");
}

// Flat mid-gray again: mix(0.92, 1.08, 0.5) == 1.0, a no-op lighting
// multiplier for a project that hasn't derived lighting yet.
export function createNeutralLightingTexture(): CanvasTexture {
	return createFlatTexture("rgb(128, 128, 128)");
}

export function createDepthTextureFromBuffer(width: number, height: number, buffer: ArrayBuffer): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create a canvas context for the depth texture.");
	}
	const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
	context.putImageData(imageData, 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.needsUpdate = true;
	return texture;
}
