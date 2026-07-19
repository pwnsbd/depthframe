import { useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
	Color,
	DoubleSide,
	GLSL3,
	LinearFilter,
	LinearMipmapLinearFilter,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	type Texture,
} from "three";
import { depthFragmentShader, depthVertexShader } from "./depthShader";

// Not exposed as knobs — the focus point itself is set by clicking, and the
// range/falloff/color are fixed tuning rather than user-facing controls.
const FOCUS_RANGE = 0.05;
const FOCUS_FALLOFF = 0.2;
const HAZE_COLOR = new Color(0.55, 0.58, 0.62);

// Click-to-focus visual cue: an amber ring that appears at the clicked point
// and expands while fading out, so the interaction is discoverable — nothing
// otherwise suggests the photo itself is clickable.
const FOCUS_MARKER_DURATION_SECONDS = 0.6;

// Idle drift: after IDLE_DELAY_MS of no real pointer movement, uMouse's
// source blends from the real cursor over to a slow synthetic wander instead
// of freezing at its last value, and blends back the instant real input
// resumes — both transitions take TRANSITION_MS.
const IDLE_DELAY_MS = 1800;
const TRANSITION_MS = 900;
const POINTER_MOVE_EPSILON = 0.001;

// Two sine waves per axis at deliberately mismatched, non-round frequencies —
// a single clean sine reads as obviously mechanical; two summed at
// incommensurate frequencies never exactly repeats on a timescale a viewer
// would notice, so it reads as organic drift instead of a loop.
// Amplitude tuned up after the first pass read as too weak — the original
// 0.35/0.15 (x) and 0.25/0.1 (y) coefficients kept drift's peak swing at
// roughly half the real pointer's full ±1 range, which barely registered at
// typical depthStrength/parallaxStrength values.
function computeDrift(t: number): Vector2 {
	const x = Math.sin(t * 0.00015) * 0.65 + Math.sin(t * 0.00037) * 0.3;
	const y = Math.cos(t * 0.00011) * 0.5 + Math.sin(t * 0.00029) * 0.2;
	return new Vector2(x, y);
}

// Export-only variant: computeDrift is deliberately non-periodic (the whole
// point is that it never obviously repeats during normal live viewing), so
// reusing it verbatim for a looping export would show a visible jump where
// the clip seams back to its start. This produces the same "two mismatched
// sine waves" organic character, but with frequencies restricted to small
// integer harmonics of the loop's fundamental (2π / periodMs) — so position
// AND velocity are identical at t=0 and t=periodMs, and the clip can be
// played back-to-back with no seam. Different harmonics per axis (1,3 vs
// 2,5) keep the path from reading as a simple repeating ellipse.
function computeLoopableDrift(elapsedMs: number, periodMs: number): Vector2 {
	const angle = (elapsedMs / periodMs) * Math.PI * 2;
	const x = Math.sin(angle) * 0.65 + Math.sin(angle * 3) * 0.3;
	const y = Math.cos(angle * 2) * 0.5 + Math.sin(angle * 5) * 0.2;
	return new Vector2(x, y);
}

type DepthPlaneProps = {
	imageUrl: string;
	depthTexture: Texture;
	maskTexture: Texture;
	lightingTexture: Texture;
	depthStrength: number;
	parallaxStrength: number;
	invertDepth: boolean;
	smoothing: number;
	maxBlurLod: number;
	hazeStrength: number;
	lightingStrength: number;
	colorOverrideTexture?: Texture | null;
	// Export video reuses this system: forcing it true jumps idle-drift active
	// immediately instead of waiting IDLE_DELAY_MS, and locks it there for the
	// duration by ignoring real pointer movement, so the captured clip is
	// clean, uninterrupted drift motion regardless of what the cursor does.
	forceIdleDrift?: boolean;
	// When set (only during video export), switches from the live, never-
	// repeating drift to the periodic variant above, with the period matching
	// the exported clip's duration so it loops seamlessly.
	exportLoopDurationMs?: number;
	// The live viewer fits the plane within 92% of the viewport with a
	// 6.4-unit cap, because the on-screen canvas's aspect ratio is whatever
	// the window happens to be — unrelated to the photo's own aspect ratio.
	// The offscreen export renderer's canvas is instead created at exactly
	// the photo's own aspect ratio, so filling the viewport edge-to-edge
	// (no margin, no cap) reproduces the full frame with no letterboxing.
	fillFrame?: boolean;
};

export function DepthPlane({
	imageUrl,
	depthTexture,
	maskTexture,
	lightingTexture,
	depthStrength,
	parallaxStrength,
	invertDepth,
	smoothing,
	maxBlurLod,
	hazeStrength,
	lightingStrength,
	colorOverrideTexture,
	forceIdleDrift = false,
	exportLoopDurationMs,
	fillFrame = false,
}: DepthPlaneProps) {
	const loadedImageTexture = useLoader(TextureLoader, imageUrl);
	const imageTexture = colorOverrideTexture ?? loadedImageTexture;
	const { viewport, pointer } = useThree();
	const smoothedMouse = useRef(new Vector2(0, 0));
	const lastInputTime = useRef(performance.now());
	const previousPointer = useRef(new Vector2());

	// Jumping lastInputTime into the past makes the very next frame's idleFor
	// calculation already exceed IDLE_DELAY_MS + TRANSITION_MS, so drift is at
	// full strength immediately rather than easing in over TRANSITION_MS.
	// driftStartTime anchors t=0 of the loopable drift to the moment export
	// activates it, independent of wall-clock time.
	const driftStartTime = useRef<number | null>(null);
	useEffect(() => {
		if (forceIdleDrift) {
			lastInputTime.current = performance.now() - (IDLE_DELAY_MS + TRANSITION_MS + 1);
			driftStartTime.current = performance.now();
		} else {
			driftStartTime.current = null;
		}
	}, [forceIdleDrift]);

	const markerRef = useRef<Mesh>(null);
	const markerStartTime = useRef<number | null>(null);
	const markerMaterial = useMemo(
		() => new MeshBasicMaterial({ color: "#e8b85c", transparent: true, opacity: 0, side: DoubleSide }),
		[],
	);

	const aspect = loadedImageTexture.image ? loadedImageTexture.image.width / loadedImageTexture.image.height : 1.5;
	let planeWidth: number;
	let planeHeight: number;
	if (fillFrame) {
		planeWidth = viewport.width;
		planeHeight = viewport.height;
	} else {
		const maxWidth = Math.min(viewport.width * 0.92, 6.4);
		const maxHeight = viewport.height * 0.92;
		planeWidth = maxWidth;
		planeHeight = planeWidth / aspect;
		if (planeHeight > maxHeight) {
			planeHeight = maxHeight;
			planeWidth = planeHeight * aspect;
		}
	}

	const material = useMemo(() => {
		const maskImage = maskTexture.image as { width?: number; height?: number } | undefined;
		const maskWidth = maskImage?.width || 2;
		const maskHeight = maskImage?.height || 2;

		// textureLod's mip-based DOF blur needs real mipmaps on the photo
		// texture. Three.js defaults already enable this for a standard
		// TextureLoader texture, but set it explicitly since it's load-bearing
		// for this feature rather than incidental. WebGL2 (three.js's default
		// context since r150+) generates mipmaps for non-power-of-two images
		// like an arbitrary photo; WebGL1 could not.
		loadedImageTexture.generateMipmaps = true;
		loadedImageTexture.minFilter = LinearMipmapLinearFilter;
		loadedImageTexture.magFilter = LinearFilter;
		loadedImageTexture.needsUpdate = true;

		return new ShaderMaterial({
			glslVersion: GLSL3,
			uniforms: {
				uImage: { value: imageTexture },
				uDepth: { value: depthTexture },
				uMask: { value: maskTexture },
				uMaskTexelSize: { value: new Vector2(1 / maskWidth, 1 / maskHeight) },
				uLighting: { value: lightingTexture },
				uMouse: { value: new Vector2(0, 0) },
				uDepthStrength: { value: depthStrength },
				uParallaxStrength: { value: parallaxStrength },
				uInvert: { value: invertDepth ? 1 : 0 },
				uFocusActive: { value: 0 },
				uFocusDepth: { value: 0.5 },
				uFocusRange: { value: FOCUS_RANGE },
				uFocusFalloff: { value: FOCUS_FALLOFF },
				uMaxBlurLod: { value: maxBlurLod },
				uHazeColor: { value: HAZE_COLOR },
				uHazeStrength: { value: hazeStrength },
				uLightingStrength: { value: lightingStrength },
			},
			vertexShader: depthVertexShader,
			fragmentShader: depthFragmentShader,
		});
		// Texture identity changes when a new image/depth/mask/lighting is
		// loaded; depthStrength/invert are updated per-frame below instead of
		// rebuilding the material every time a knob turns. Clicking to focus
		// resets naturally since a new image means a fresh material (uFocusActive
		// starts at 0 again).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imageTexture, depthTexture, maskTexture, lightingTexture, loadedImageTexture]);

	useFrame(() => {
		if (!forceIdleDrift && pointer.distanceTo(previousPointer.current) > POINTER_MOVE_EPSILON) {
			lastInputTime.current = performance.now();
			previousPointer.current.copy(pointer);
		}

		const idleFor = performance.now() - lastInputTime.current;
		const driftAmount = MathUtils.smoothstep(idleFor, IDLE_DELAY_MS, IDLE_DELAY_MS + TRANSITION_MS);
		const drift =
			exportLoopDurationMs && driftStartTime.current !== null
				? computeLoopableDrift(performance.now() - driftStartTime.current, exportLoopDurationMs)
				: computeDrift(performance.now());
		const target = new Vector2().lerpVectors(pointer, drift, driftAmount);

		smoothedMouse.current.x = MathUtils.lerp(smoothedMouse.current.x, target.x, smoothing);
		smoothedMouse.current.y = MathUtils.lerp(smoothedMouse.current.y, target.y, smoothing);
		material.uniforms.uMouse.value.copy(smoothedMouse.current);
		material.uniforms.uDepthStrength.value = depthStrength;
		material.uniforms.uParallaxStrength.value = parallaxStrength;
		material.uniforms.uInvert.value = invertDepth ? 1 : 0;
		material.uniforms.uMaxBlurLod.value = maxBlurLod;
		material.uniforms.uHazeStrength.value = hazeStrength;
		material.uniforms.uLightingStrength.value = lightingStrength;

		if (markerStartTime.current !== null && markerRef.current) {
			const elapsed = (performance.now() - markerStartTime.current) / 1000;
			if (elapsed >= FOCUS_MARKER_DURATION_SECONDS) {
				markerMaterial.opacity = 0;
				markerStartTime.current = null;
			} else {
				const t = elapsed / FOCUS_MARKER_DURATION_SECONDS;
				markerMaterial.opacity = 1 - t;
				markerRef.current.scale.setScalar(1 + t * 1.5);
			}
		}
	});

	function handleClick(event: ThreeEvent<MouseEvent>) {
		if (!event.uv) {
			return;
		}
		const canvas = depthTexture.image as HTMLCanvasElement | undefined;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) {
			return;
		}

		// Shader UV has v=0 at the bottom (standard GL convention); canvas
		// pixel rows go top-down, hence the (1 - uv.y) flip.
		const pixelX = Math.min(canvas.width - 1, Math.max(0, Math.floor(event.uv.x * canvas.width)));
		const pixelY = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - event.uv.y) * canvas.height)));
		const rawDepth = context.getImageData(pixelX, pixelY, 1, 1).data[0] / 255;
		const focusDepth = invertDepth ? 1 - rawDepth : rawDepth;

		material.uniforms.uFocusDepth.value = focusDepth;
		material.uniforms.uFocusActive.value = 1;

		if (markerRef.current) {
			markerRef.current.position.set((event.uv.x - 0.5) * planeWidth, (event.uv.y - 0.5) * planeHeight, 0.01);
			markerRef.current.scale.setScalar(1);
		}
		markerStartTime.current = performance.now();
	}

	return (
		<>
			<mesh material={material} onClick={handleClick}>
				<planeGeometry args={[planeWidth, planeHeight, 1, 1]} />
			</mesh>
			<mesh ref={markerRef} material={markerMaterial}>
				<ringGeometry args={[0.1, 0.14, 32]} />
			</mesh>
		</>
	);
}
