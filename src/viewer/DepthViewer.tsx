import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type { Texture } from "three";
import { DepthPlane } from "./DepthPlane";

type DepthViewerProps = {
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
	forceIdleDrift?: boolean;
	// When set (only during video export), DepthPlane switches to a periodic
	// drift with this period so the exported clip loops seamlessly.
	exportLoopDurationMs?: number;
	// See DepthPlane's fillFrame doc — set by the offscreen export renderer,
	// never by the live viewer.
	fillFrame?: boolean;
	// The live viewer clamps to [1, 1.8] so a retina display doesn't cost
	// more fill-rate than it's worth for an on-screen preview. The offscreen
	// export renderer instead wants exactly 1: its canvas is already sized
	// in real output pixels, so any multiplier would blow past the
	// requested export resolution unpredictably depending on the viewing
	// device's DPR.
	pixelRatio?: number | [number, number];
	// Export needs the raw <canvas> element (toBlob/captureStream), which
	// lives inside R3F's <Canvas> — onCreated is the standard way out.
	onCanvasReady?: (canvas: HTMLCanvasElement) => void;
	// Fires once the first real frame has been committed — for the live
	// viewer this is immediate and unused, but the offscreen export renderer
	// needs to know the (Suspense-gated) image texture has actually finished
	// loading before it's safe to start capturing.
	onFirstFrame?: () => void;
};

// Placed as a sibling of DepthPlane inside the same Suspense boundary (not
// beside <Canvas> itself) so its useFrame only starts firing once Suspense
// actually un-suspends — i.e. once the image texture has loaded — rather
// than on the very first render of an empty scene.
function FirstFrameSignal({ onReady }: { onReady: () => void }) {
	const fired = useRef(false);
	useFrame(() => {
		if (!fired.current) {
			fired.current = true;
			onReady();
		}
	});
	return null;
}

export function DepthViewer({
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
	forceIdleDrift,
	exportLoopDurationMs,
	fillFrame,
	pixelRatio = [1, 1.8],
	onCanvasReady,
	onFirstFrame,
}: DepthViewerProps) {
	return (
		<Canvas
			camera={{ position: [0, 0, 3.2], fov: 34 }}
			dpr={pixelRatio}
			gl={{ preserveDrawingBuffer: true }}
			onCreated={(state) => onCanvasReady?.(state.gl.domElement)}
		>
			<color attach="background" args={["#17171A"]} />
			<Suspense fallback={null}>
				<DepthPlane
					imageUrl={imageUrl}
					depthTexture={depthTexture}
					maskTexture={maskTexture}
					lightingTexture={lightingTexture}
					depthStrength={depthStrength}
					parallaxStrength={parallaxStrength}
					invertDepth={invertDepth}
					smoothing={smoothing}
					maxBlurLod={maxBlurLod}
					hazeStrength={hazeStrength}
					lightingStrength={lightingStrength}
					colorOverrideTexture={colorOverrideTexture}
					forceIdleDrift={forceIdleDrift}
					exportLoopDurationMs={exportLoopDurationMs}
					fillFrame={fillFrame}
				/>
				{onFirstFrame ? <FirstFrameSignal onReady={onFirstFrame} /> : null}
			</Suspense>
		</Canvas>
	);
}
