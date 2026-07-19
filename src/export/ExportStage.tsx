import type { Texture } from "three";
import { DepthViewer } from "../viewer/DepthViewer";

// Mounted off-screen (never shown to the user) only while an export is in
// progress, at the export's target resolution rather than whatever the
// live, on-screen canvas happens to be — the live viewer's canvas is sized
// to fit the app's window, which has nothing to do with the source photo's
// actual resolution, so capturing straight from it caps every export at
// well under the photo's real quality. This renders the identical shader/
// scene at up to the photo's native resolution instead.
//
// Positioned far off-screen (not display:none/visibility:hidden) so the
// browser keeps actually painting it — some engines throttle or skip
// rendering for display:none elements, which would starve captureStream of
// frames during video export.
type ExportStageProps = {
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
	width: number;
	height: number;
	forceIdleDrift?: boolean;
	exportLoopDurationMs?: number;
	onCanvasReady: (canvas: HTMLCanvasElement) => void;
	onFirstFrame: () => void;
};

export function ExportStage({ width, height, onCanvasReady, onFirstFrame, ...viewerProps }: ExportStageProps) {
	return (
		<div style={{ position: "fixed", top: 0, left: -999999, width, height, pointerEvents: "none" }} aria-hidden="true">
			<DepthViewer {...viewerProps} fillFrame pixelRatio={1} onCanvasReady={onCanvasReady} onFirstFrame={onFirstFrame} />
		</div>
	);
}
