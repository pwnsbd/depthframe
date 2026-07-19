import { create } from "zustand";
import { cloneBitmapForWorker, loadImageFile } from "../import/loadImage";
import {
	cancelDepth,
	DepthCancelledError,
	getModelState,
	runDepth,
	subscribeModelState,
	type ModelState,
} from "../model/depthModelManager";
import {
	cancelNormal,
	getModelState as getNormalModelState,
	NormalCancelledError,
	runNormal,
	subscribeModelState as subscribeNormalModelState,
	type ModelState as NormalModelState,
} from "../model/normalModelManager";
import {
	loadProject as loadProjectFromDb,
	saveProject as saveProjectToDb,
} from "../persistence/projectStore";
import {
	createDepthTextureFromBuffer,
	createNeutralDepthTexture,
	createNeutralLightingTexture,
} from "../viewer/depthTexture";
import { deriveLightingTexture, deriveLightingTextureFromNormals } from "../viewer/lighting";
import type { Texture } from "three";

export type DepthRunStatus = "idle" | "running" | "done" | "error";

type ImageMetadata = {
	name: string;
	width: number;
	height: number;
	size: number;
};

type AppState = {
	imageUrl: string | null;
	imageFile: File | null;
	imageMetadata: ImageMetadata | null;
	imageError: string | null;

	depthTexture: Texture;
	depthBuffer: { width: number; height: number; buffer: ArrayBuffer } | null;
	depthRunStatus: DepthRunStatus;
	depthError: string | null;

	lightingTexture: Texture;
	lightingReady: boolean;
	debugPreview: "none" | "lighting";

	// Model-based surface normals are a second, independent AI pipeline
	// (see modelRegistry.ts's NORMAL_MODEL) used only to improve lighting —
	// they never feed depth/parallax. normalBuffer holds the raw RGBA-encoded
	// normal+confidence result so it can be persisted and re-decoded without
	// re-running the model; lightingTexture/lightingSource track which of the
	// two lighting sources (Sobel-derived vs. model normals) is currently on
	// screen.
	normalBuffer: { width: number; height: number; buffer: ArrayBuffer } | null;
	normalRunStatus: DepthRunStatus;
	normalError: string | null;
	normalModel: NormalModelState;
	lightingSource: "derived" | "model";

	model: ModelState;

	depthStrength: number;
	parallaxStrength: number;
	smoothing: number;
	invertDepth: boolean;

	// Sensational-mode post-processing. Neither is an AI pipeline stage, so
	// neither gets a run status — both are continuous rendering properties,
	// same as parallaxStrength. (Idle drift has no separate amplitude knob —
	// it feeds the same uMouse → uParallaxStrength pipeline as real pointer
	// input, so parallaxStrength already scales both uniformly; the "Motion"
	// knob is just parallaxStrength under a name that reflects that.)
	maxBlurLod: number;
	hazeStrength: number;
	// Scales uLightingStrength in the shader — the ±8% shading swing that
	// deriveLightingTexture/deriveLightingTextureFromNormals produce. 1 is
	// the original fixed swing this knob replaced; 0 is a true no-op.
	lightingStrength: number;

	projectMessage: { type: "success" | "error"; text: string } | null;

	importImage: (file: File) => Promise<void>;
	runDepthForCurrentImage: () => Promise<void>;
	cancelDepthRun: () => void;
	runNormalLightingForCurrentImage: () => Promise<void>;
	cancelNormalRun: () => void;
	setDebugPreview: (mode: "none" | "lighting") => void;
	saveProject: () => Promise<void>;
	loadProject: () => Promise<void>;
	setDepthStrength: (value: number) => void;
	setParallaxStrength: (value: number) => void;
	setInvertDepth: (value: boolean) => void;
	setMaxBlurLod: (value: number) => void;
	setHazeStrength: (value: number) => void;
	setLightingStrength: (value: number) => void;
};

export const useAppStore = create<AppState>((set, get) => {
	subscribeModelState((model) => set({ model }));
	subscribeNormalModelState((normalModel) => set({ normalModel }));

	return {
		imageUrl: null,
		imageFile: null,
		imageMetadata: null,
		imageError: null,

		depthTexture: createNeutralDepthTexture(),
		depthBuffer: null,
		depthRunStatus: "idle",
		depthError: null,

		lightingTexture: createNeutralLightingTexture(),
		lightingReady: false,
		debugPreview: "none",

		normalBuffer: null,
		normalRunStatus: "idle",
		normalError: null,
		normalModel: getNormalModelState(),
		lightingSource: "derived",

		model: getModelState(),

		depthStrength: 0.07,
		parallaxStrength: 0.06,
		smoothing: 0.12,
		invertDepth: false,

		maxBlurLod: 5,
		hazeStrength: 0.45,
		lightingStrength: 1,

		projectMessage: null,

		importImage: async (file: File) => {
			try {
				const loaded = await loadImageFile(file);
				loaded.bitmap.close();

				// A normal-estimation run for the previous image may still be in
				// flight (it runs in the background after depth succeeds) — without
				// cancelling it, its result would land after this reset and
				// overwrite the new image's state with stale data.
				cancelNormal();

				set({
					imageUrl: loaded.objectUrl,
					imageFile: loaded.file,
					imageMetadata: {
						name: loaded.name,
						width: loaded.width,
						height: loaded.height,
						size: loaded.size,
					},
					imageError: null,
					depthTexture: createNeutralDepthTexture(),
					depthBuffer: null,
					depthRunStatus: "idle",
					depthError: null,
					lightingTexture: createNeutralLightingTexture(),
					lightingReady: false,
					debugPreview: "none",
					normalBuffer: null,
					normalRunStatus: "idle",
					normalError: null,
					lightingSource: "derived",
				});
			} catch (error) {
				set({
					imageError: error instanceof Error ? error.message : "Could not load that image.",
				});
			}
		},

		runDepthForCurrentImage: async () => {
			const { imageFile } = get();
			if (!imageFile) {
				return;
			}

			set({ depthRunStatus: "running", depthError: null });

			try {
				const bitmap = await cloneBitmapForWorker(imageFile);
				const result = await runDepth(bitmap);
				const texture = createDepthTextureFromBuffer(result.width, result.height, result.buffer);
				// UNIT-03 has no model and no trigger of its own — it derives
				// automatically from whatever depth result just came back. This is
				// deliberately the fast Sobel approximation, not the (much slower,
				// still-loading-on-first-use) normal model — it's what keeps the
				// app responsive: the user sees lighting immediately, and
				// runNormalLightingForCurrentImage() upgrades it in the background
				// once the normal model finishes.
				const lightingTexture = deriveLightingTexture(result.width, result.height, result.buffer);
				set({
					depthTexture: texture,
					depthBuffer: { width: result.width, height: result.height, buffer: result.buffer },
					depthRunStatus: "done",
					lightingTexture,
					lightingReady: true,
					lightingSource: "derived",
				});
			} catch (error) {
				if (error instanceof DepthCancelledError) {
					return;
				}
				set({
					depthRunStatus: "error",
					depthError: error instanceof Error ? error.message : "Depth generation failed.",
				});
			}
		},

		cancelDepthRun: () => {
			cancelDepth();
			set({ depthRunStatus: "idle", depthError: null });
		},

		runNormalLightingForCurrentImage: async () => {
			const { imageFile } = get();
			if (!imageFile) return;

			set({ normalRunStatus: "running", normalError: null });
			try {
				const bitmap = await cloneBitmapForWorker(imageFile); // fresh bitmap — the depth worker already consumed its own via transfer
				const result = await runNormal(bitmap);
				const lightingTexture = deriveLightingTextureFromNormals(result.width, result.height, result.buffer);
				set({
					normalBuffer: { width: result.width, height: result.height, buffer: result.buffer },
					normalRunStatus: "done",
					lightingTexture,
					lightingSource: "model",
				});
			} catch (error) {
				if (error instanceof NormalCancelledError) return;
				// This pipeline fails silently by design (the Sobel fallback stays
				// up either way), which makes a real failure indistinguishable from
				// "still loading" without this — log it so it's visible in devtools.
				console.error("Normal estimation failed:", error);
				// Deliberately don't touch lightingTexture/lightingReady here — the
				// Sobel-derived fallback from runDepthForCurrentImage stays on screen.
				set({
					normalRunStatus: "error",
					normalError: error instanceof Error ? error.message : "Normal estimation failed.",
				});
			}
		},

		cancelNormalRun: () => {
			cancelNormal();
			set({ normalRunStatus: "idle", normalError: null });
		},

		setDebugPreview: (mode) => set({ debugPreview: mode }),

		saveProject: async () => {
			const {
				imageFile,
				imageMetadata,
				depthBuffer,
				normalBuffer,
				depthStrength,
				parallaxStrength,
				invertDepth,
				smoothing,
				lightingStrength,
			} = get();
			if (!imageFile || !imageMetadata || !depthBuffer) {
				set({ projectMessage: { type: "error", text: "Run depth on an image before saving." } });
				return;
			}
			try {
				await saveProjectToDb({
					imageBlob: imageFile,
					imageName: imageMetadata.name,
					imageWidth: imageMetadata.width,
					imageHeight: imageMetadata.height,
					depthBuffer: depthBuffer.buffer,
					depthWidth: depthBuffer.width,
					depthHeight: depthBuffer.height,
					depthStrength,
					parallaxStrength,
					invertDepth,
					smoothing,
					lightingStrength,
					normal: normalBuffer
						? { buffer: normalBuffer.buffer, width: normalBuffer.width, height: normalBuffer.height }
						: undefined,
					savedAt: Date.now(),
				});
				set({ projectMessage: { type: "success", text: "Project saved." } });
			} catch (error) {
				set({
					projectMessage: {
						type: "error",
						text: error instanceof Error ? error.message : "Could not save the project.",
					},
				});
			}
		},

		loadProject: async () => {
			try {
				const saved = await loadProjectFromDb();
				if (!saved) {
					set({ projectMessage: { type: "error", text: "No saved project found." } });
					return;
				}

				const imageFile = new File([saved.imageBlob], saved.imageName, { type: saved.imageBlob.type });
				const imageUrl = URL.createObjectURL(saved.imageBlob);
				const depthTexture = createDepthTextureFromBuffer(saved.depthWidth, saved.depthHeight, saved.depthBuffer);

				// Older saves predate the normal model and have no `normal` field —
				// that's not an error, it just means falling back to the same
				// Sobel-derived lighting used before this feature existed.
				const normalBuffer = saved.normal ? { width: saved.normal.width, height: saved.normal.height, buffer: saved.normal.buffer } : null;
				const lightingTexture = normalBuffer
					? deriveLightingTextureFromNormals(normalBuffer.width, normalBuffer.height, normalBuffer.buffer)
					: deriveLightingTexture(saved.depthWidth, saved.depthHeight, saved.depthBuffer);

				set({
					imageUrl,
					imageFile,
					imageMetadata: {
						name: saved.imageName,
						width: saved.imageWidth,
						height: saved.imageHeight,
						size: saved.imageBlob.size,
					},
					imageError: null,
					depthTexture,
					depthBuffer: { width: saved.depthWidth, height: saved.depthHeight, buffer: saved.depthBuffer },
					depthRunStatus: "done",
					depthError: null,
					normalBuffer,
					normalRunStatus: normalBuffer ? "done" : "idle",
					normalError: null,
					lightingTexture,
					lightingReady: true,
					lightingSource: normalBuffer ? "model" : "derived",
					depthStrength: saved.depthStrength,
					parallaxStrength: saved.parallaxStrength,
					invertDepth: saved.invertDepth,
					smoothing: saved.smoothing,
					// Older saves predate this knob — default to 1 (the fixed swing
					// they always rendered with) so they look the same as before.
					lightingStrength: saved.lightingStrength ?? 1,
					debugPreview: "none",
					projectMessage: { type: "success", text: "Project loaded." },
				});
			} catch (error) {
				set({
					projectMessage: {
						type: "error",
						text: error instanceof Error ? error.message : "Could not load the saved project.",
					},
				});
			}
		},

		setDepthStrength: (value) => set({ depthStrength: value }),
		setParallaxStrength: (value) => set({ parallaxStrength: value }),
		setInvertDepth: (value) => set({ invertDepth: value }),
		setMaxBlurLod: (value) => set({ maxBlurLod: value }),
		setHazeStrength: (value) => set({ hazeStrength: value }),
		setLightingStrength: (value) => set({ lightingStrength: value }),
	};
});
