import { useEffect, useRef, useState } from "react";
import "./styles/tokens.css";
import "./App.css";
import { RackChassis } from "./components/RackChassis";
import { RackHeader } from "./components/RackHeader";
import { ScreenBezel } from "./components/ScreenBezel";
import { RackUnitRow } from "./components/RackUnitRow";
import { KnobControl } from "./components/KnobControl";
import { SmallKnobControl } from "./components/SmallKnobControl";
import { HardwareButton } from "./components/HardwareButton";
import { SignalBridge } from "./components/SignalBridge";
import { DepthViewer } from "./viewer/DepthViewer";
import { createNeutralMaskTexture } from "./viewer/depthTexture";
import { ExportStage } from "./export/ExportStage";
import {
	exportCanvasAsImage,
	exportCanvasAsVideo,
	VIDEO_EXPORT_DURATION_MS,
	VIDEO_EXPORT_PREROLL_MS,
	type VideoExportStage,
} from "./export/exportCanvas";
import { computeExportDimensions, MAX_IMAGE_EXPORT_EDGE, MAX_VIDEO_EXPORT_EDGE } from "./export/exportDimensions";
import { useAppStore } from "./store/useAppStore";

// Segmentation has been removed. uMask in depthShader.ts is designed to be a
// no-op when fed a flat/neutral texture, so rather than ripping the uniform
// out of the shader/DepthPlane/DepthViewer prop chain, this constant is
// passed in its place everywhere a real segmentationTexture used to be
// computed.
const NEUTRAL_MASK_TEXTURE = createNeutralMaskTexture();

function App() {
	const {
		imageUrl,
		imageMetadata,
		imageError,
		depthTexture,
		depthRunStatus,
		depthError,
		lightingTexture,
		lightingReady,
		lightingSource,
		normalRunStatus,
		normalError,
		debugPreview,
		model,
		depthStrength,
		parallaxStrength,
		invertDepth,
		smoothing,
		maxBlurLod,
		hazeStrength,
		lightingStrength,
		projectMessage,
		importImage,
		runDepthForCurrentImage,
		cancelDepthRun,
		runNormalLightingForCurrentImage,
		cancelNormalRun,
		setDebugPreview,
		saveProject,
		loadProject,
		setDepthStrength,
		setParallaxStrength,
		setMaxBlurLod,
		setHazeStrength,
		setLightingStrength,
	} = useAppStore();

	const hasImage = Boolean(imageUrl);
	const modelBusy = model.status === "downloading" || model.status === "loading";
	const modelLabel =
		model.status === "downloading"
			? `DOWNLOADING ${model.progress}%`
			: model.status === "loading"
				? "LOADING MODEL"
				: model.status === "error"
					? "MODEL ERROR"
					: model.status === "ready"
						? "MODEL READY"
						: "MODEL IDLE";

	const knobState =
		depthRunStatus === "running" ? "running" : depthRunStatus === "error" ? "error" : depthRunStatus === "done" ? "done" : "idle";
	const knobStatusText =
		depthRunStatus === "running"
			? "generating…"
			: depthRunStatus === "done"
				? `value ${depthStrength.toFixed(2)} · press to re-run`
				: depthRunStatus === "error"
					? (depthError ?? "failed · press to retry")
					: "turn to set · press to run";

	// Drag adjusts lightingStrength (like every other knob); press still
	// triggers/re-triggers the normal-estimation model, same as Depth's knob
	// combines drag-to-adjust with press-to-run.
	const lightingKnobStatusText =
		normalRunStatus === "running"
			? "loading…"
			: normalRunStatus === "done"
				? `value ${lightingStrength.toFixed(2)} · press to re-run`
				: normalRunStatus === "error"
					? (normalError ?? "failed · press to retry")
					: "turn to set · press to run";

	const signalActive = depthRunStatus === "running" || modelBusy;
	const signalLevel = modelBusy ? model.progress : depthRunStatus === "running" ? 60 : 0;

	const knobColumnRef = useRef<HTMLDivElement>(null);
	const [isKnobColumnScrollable, setIsKnobColumnScrollable] = useState(false);

	const [forceIdleDrift, setForceIdleDrift] = useState(false);
	const [videoExportStage, setVideoExportStage] = useState<VideoExportStage | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const isExportingVideo = videoExportStage !== null;

	const canExport = hasImage && depthRunStatus === "done";

	// The live, on-screen canvas is sized to fit the app window — nothing to
	// do with the source photo's actual resolution — so capturing exports
	// straight from it caps every export at well under the photo's real
	// quality. ExportStage instead renders the identical scene off-screen at
	// (up to) the photo's native resolution, mounted only for the duration
	// of one export. mountExportStage resolves once that offscreen canvas
	// has both been created AND rendered a real frame (the image texture is
	// Suspense-gated, so "created" alone doesn't mean there's anything in it
	// yet); the refs exist because those two signals arrive via callback
	// props, not directly from this function's own call stack.
	type ExportStageState = { width: number; height: number; forceIdleDrift: boolean; exportLoopDurationMs?: number };
	const [exportStage, setExportStage] = useState<ExportStageState | null>(null);
	const exportStageCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const exportStageReadyRef = useRef<{ resolve: (canvas: HTMLCanvasElement) => void; reject: (error: Error) => void } | null>(
		null,
	);

	function mountExportStage(state: ExportStageState): Promise<HTMLCanvasElement> {
		return new Promise((resolve, reject) => {
			exportStageCanvasRef.current = null;
			const timeoutId = setTimeout(() => {
				exportStageReadyRef.current = null;
				// Distinguishes "the offscreen <Canvas> itself never mounted/got a
				// WebGL context" from "it mounted fine but the Suspense-gated
				// texture load never resolved" — this whole mechanism has never
				// actually been exercised in a real browser (only tsc/build
				// verified so far), so if this fires again, this is the context
				// needed to root-cause it instead of guessing blind.
				const stage = exportStageCanvasRef.current ? "canvas created, but no frame ever rendered (texture load stalled?)" : "canvas was never created (onCreated never fired)";
				console.error("Export stage timed out.", {
					stage,
					requestedSize: `${state.width}x${state.height}`,
					userAgent: navigator.userAgent,
				});
				reject(new Error("Timed out preparing the export render — try again."));
			}, 20000);
			exportStageReadyRef.current = {
				resolve: (canvas) => {
					clearTimeout(timeoutId);
					resolve(canvas);
				},
				reject: (error) => {
					clearTimeout(timeoutId);
					reject(error);
				},
			};
			setExportStage(state);
		});
	}

	function unmountExportStage() {
		setExportStage(null);
		exportStageCanvasRef.current = null;
		exportStageReadyRef.current = null;
	}

	// ffmpeg.wasm runs in a Web Worker and rejects failures with a plain
	// string (e.toString() on the worker side), not an Error instance — so
	// `error instanceof Error` alone silently loses the real reason and falls
	// through to a generic message.
	function describeExportError(error: unknown, fallback: string): string {
		console.error(error);
		if (typeof error === "string") {
			return error;
		}
		return error instanceof Error ? error.message : fallback;
	}

	async function handleExportImage() {
		if (!imageMetadata) {
			return;
		}
		setExportError(null);
		try {
			const { width, height } = computeExportDimensions(imageMetadata.width, imageMetadata.height, MAX_IMAGE_EXPORT_EDGE);
			const canvas = await mountExportStage({ width, height, forceIdleDrift: false });
			await exportCanvasAsImage(canvas);
		} catch (error) {
			setExportError(describeExportError(error, "Could not export the image."));
		} finally {
			unmountExportStage();
		}
	}

	async function handleExportVideo() {
		if (!imageMetadata || isExportingVideo) {
			return;
		}
		setExportError(null);
		setForceIdleDrift(true); // keeps the on-screen preview showing the same drift motion being captured
		setVideoExportStage("preparing");
		try {
			const { width, height } = computeExportDimensions(imageMetadata.width, imageMetadata.height, MAX_VIDEO_EXPORT_EDGE);
			const canvas = await mountExportStage({
				width,
				height,
				forceIdleDrift: true,
				exportLoopDurationMs: VIDEO_EXPORT_DURATION_MS,
			});
			// Gives smoothedMouse time to settle onto the periodic drift's
			// steady-state path before the loop-sensitive capture window starts —
			// see VIDEO_EXPORT_PREROLL_MS's comment in exportCanvas.ts.
			await new Promise((resolve) => setTimeout(resolve, VIDEO_EXPORT_PREROLL_MS));
			await exportCanvasAsVideo(canvas, setVideoExportStage);
		} catch (error) {
			setExportError(describeExportError(error, "Could not export the video."));
		} finally {
			setForceIdleDrift(false);
			setVideoExportStage(null);
			unmountExportStage();
		}
	}

	useEffect(() => {
		const element = knobColumnRef.current;
		if (!element) {
			return;
		}

		const checkOverflow = () => {
			setIsKnobColumnScrollable(element.scrollHeight > element.clientHeight);
		};

		checkOverflow();

		const observer = new ResizeObserver(checkOverflow);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// A small array so a fourth unit (e.g. a future compositor stage) is a
	// one-line addition here, not a rewrite of ScreenBezel/LayerFilmstrip.
	const filmstripLayers = [
		{ id: "depth", label: "DEPTH", ready: depthRunStatus === "done", texture: depthTexture },
		{ id: "lighting", label: "LIGHTING", ready: lightingReady, texture: lightingTexture },
	];

	return (
		<div className="app-root">
			<RackChassis>
				<RackHeader
					modelReady={model.status === "ready"}
					modelBusy={modelBusy}
					modelLabel={modelLabel}
					onImport={(file) => void importImage(file)}
					onSave={() => void saveProject()}
					onLoad={() => void loadProject()}
					canSave={depthRunStatus === "done"}
					disabled={depthRunStatus === "running"}
				/>

				<div className="rack-body">
					<ScreenBezel
						hasImage={hasImage}
						caption={
							imageMetadata
								? { name: imageMetadata.name, dimensions: `${imageMetadata.width}×${imageMetadata.height}` }
								: undefined
						}
						onDropFile={(file) => void importImage(file)}
						disabled={depthRunStatus === "running"}
						layers={filmstripLayers}
					>
						{imageUrl ? (
							<DepthViewer
								imageUrl={imageUrl}
								depthTexture={depthTexture}
								maskTexture={NEUTRAL_MASK_TEXTURE}
								lightingTexture={lightingTexture}
								depthStrength={depthStrength}
								parallaxStrength={parallaxStrength}
								invertDepth={invertDepth}
								smoothing={smoothing}
								maxBlurLod={maxBlurLod}
								hazeStrength={hazeStrength}
								lightingStrength={lightingStrength}
								colorOverrideTexture={debugPreview === "lighting" ? lightingTexture : null}
								forceIdleDrift={forceIdleDrift}
								exportLoopDurationMs={isExportingVideo ? VIDEO_EXPORT_DURATION_MS : undefined}
							/>
						) : null}
					</ScreenBezel>

					{imageUrl && exportStage ? (
						<ExportStage
							imageUrl={imageUrl}
							depthTexture={depthTexture}
							maskTexture={NEUTRAL_MASK_TEXTURE}
							lightingTexture={lightingTexture}
							depthStrength={depthStrength}
							parallaxStrength={parallaxStrength}
							invertDepth={invertDepth}
							smoothing={smoothing}
							maxBlurLod={maxBlurLod}
							hazeStrength={hazeStrength}
							lightingStrength={lightingStrength}
							width={exportStage.width}
							height={exportStage.height}
							forceIdleDrift={exportStage.forceIdleDrift}
							exportLoopDurationMs={exportStage.exportLoopDurationMs}
							onCanvasReady={(canvas) => {
								exportStageCanvasRef.current = canvas;
							}}
							onFirstFrame={() => {
								const pending = exportStageReadyRef.current;
								if (pending && exportStageCanvasRef.current) {
									exportStageReadyRef.current = null; // guard against a second frame re-resolving/erroring
									pending.resolve(exportStageCanvasRef.current);
								} else {
									// Should be unreachable — onCreated (which sets the canvas
									// ref) always fires before the first useFrame in the same
									// <Canvas> — but if it ever isn't, this would otherwise
									// silently do nothing and wait out the full timeout with no
									// clue why.
									console.error("ExportStage's onFirstFrame fired without a ready canvas ref.", {
										hasPending: pending !== null,
										hasCanvas: exportStageCanvasRef.current !== null,
									});
								}
							}}
						/>
					) : null}

					<div className={`knob-column-wrapper${isKnobColumnScrollable ? " is-scrollable" : ""}`}>
						<div className="knob-column" ref={knobColumnRef}>
						<RackUnitRow unitId="UNIT-01" name="DEPTH" active ledOn={depthRunStatus === "done"}>
							<KnobControl
								label="Depth"
								value={depthStrength}
								min={0.02}
								max={0.1}
								state={knobState}
								statusText={knobStatusText}
								onChange={setDepthStrength}
								onTrigger={() => {
									void (async () => {
										await runDepthForCurrentImage();
										// Fire-and-forget: the normal model is slower to load than
										// depth, so this runs in the background and upgrades
										// lighting in place once it finishes — it must not delay
										// or block the depth result above.
										void runNormalLightingForCurrentImage();
									})();
								}}
								onCancel={cancelDepthRun}
								disabled={!hasImage || depthRunStatus === "running"}
							/>
						</RackUnitRow>

						<RackUnitRow
							unitId="UNIT-03"
							name="LIGHTING"
							active
							ledOn={depthRunStatus === "done"}
							ledColor={lightingSource === "model" ? "success" : "amber"}
						>
							<KnobControl
								label="Lighting"
								value={lightingStrength}
								min={0}
								max={2}
								state={normalRunStatus}
								statusText={lightingKnobStatusText}
								onChange={setLightingStrength}
								onTrigger={() => void runNormalLightingForCurrentImage()}
								onCancel={cancelNormalRun}
								disabled={depthRunStatus !== "done" || normalRunStatus === "running"}
							/>
							<button
								type="button"
								className="text-link-button"
								onClick={() => setDebugPreview(debugPreview === "lighting" ? "none" : "lighting")}
								disabled={depthRunStatus !== "done"}
							>
								{debugPreview === "lighting" ? "Hide lighting preview" : "Preview lighting"}
							</button>
						</RackUnitRow>

						<RackUnitRow unitId="FX" name="LOOK" active ledOn={hasImage}>
							<div className="small-knob-row">
								<SmallKnobControl
									label="Motion"
									value={parallaxStrength}
									min={0.02}
									max={0.15}
									onChange={setParallaxStrength}
									disabled={!hasImage}
								/>
								<SmallKnobControl label="Haze" value={hazeStrength} min={0} max={1} onChange={setHazeStrength} disabled={!hasImage} />
								<SmallKnobControl label="Focus" value={maxBlurLod} min={0} max={8} onChange={setMaxBlurLod} disabled={!hasImage} />
							</div>
						</RackUnitRow>

						<RackUnitRow unitId="UNIT-04" name="EXPORT" active ledOn={isExportingVideo}>
							<div className="export-row">
								<HardwareButton onClick={() => void handleExportImage()} disabled={!canExport}>
									Export Image
								</HardwareButton>
								<HardwareButton onClick={() => void handleExportVideo()} disabled={!canExport || isExportingVideo}>
									{videoExportStage === "preparing"
										? "Preparing…"
										: videoExportStage === "recording"
											? "Recording…"
											: videoExportStage === "encoding"
												? "Encoding…"
												: "Export Video (MP4)"}
								</HardwareButton>
							</div>
						</RackUnitRow>
						</div>
					</div>
				</div>

				<SignalBridge level={signalLevel} active={signalActive} />

				{imageError ? <p className="inline-error">{imageError}</p> : null}
				{exportError ? <p className="inline-error">{exportError}</p> : null}
				{normalError ? <p className="inline-error">AI lighting: {normalError}</p> : null}
				{projectMessage ? (
					<p className={projectMessage.type === "success" ? "inline-success" : "inline-error"}>{projectMessage.text}</p>
				) : null}
			</RackChassis>
		</div>
	);
}

export default App;
