/// <reference lib="webworker" />

import { pipeline, RawImage, type DepthEstimationPipeline } from "@huggingface/transformers";
import { DEPTH_MODEL } from "./modelRegistry";

type RunMessage = {
	type: "run";
	requestId: number;
	imageBitmap: ImageBitmap;
};

type IncomingMessage = RunMessage;

type ProgressPayload = {
	status?: string;
	progress?: number;
	loaded?: number;
	total?: number;
};

let depthPipelinePromise: Promise<DepthEstimationPipeline> | null = null;

function post(message: unknown, transfer: Transferable[] = []) {
	(self as unknown as Worker).postMessage(message, transfer);
}

function normalizeProgress(event: ProgressPayload): number | null {
	if (typeof event.progress === "number") {
		return Math.max(0, Math.min(100, Math.round(event.progress)));
	}
	if (typeof event.loaded === "number" && typeof event.total === "number" && event.total > 0) {
		return Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
	}
	return null;
}

function loadPipeline() {
	if (!depthPipelinePromise) {
		depthPipelinePromise = pipeline(DEPTH_MODEL.task, DEPTH_MODEL.id, {
			progress_callback: (event: ProgressPayload) => {
				const progress = normalizeProgress(event);
				post({
					type: "progress",
					status: event.status ?? "progress",
					progress: progress ?? 0,
				});
			},
		}) as unknown as Promise<DepthEstimationPipeline>;
	}
	return depthPipelinePromise;
}

async function handleRun(message: RunMessage) {
	try {
		const depthPipeline = await loadPipeline();
		post({ type: "model-ready" });

		const canvas = new OffscreenCanvas(message.imageBitmap.width, message.imageBitmap.height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Could not create an offscreen canvas context.");
		}
		context.drawImage(message.imageBitmap, 0, 0);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const rawImage = await RawImage.fromBlob(blob);

		const output = (await depthPipeline(rawImage)) as { depth: RawImage };
		const { width, height, data: pixels, channels } = output.depth;

		const rgba = new Uint8ClampedArray(width * height * 4);
		for (let index = 0; index < width * height; index += 1) {
			const value = pixels[index * channels];
			rgba[index * 4] = value;
			rgba[index * 4 + 1] = value;
			rgba[index * 4 + 2] = value;
			rgba[index * 4 + 3] = 255;
		}

		post(
			{
				type: "result",
				requestId: message.requestId,
				width,
				height,
				buffer: rgba.buffer,
			},
			[rgba.buffer],
		);
	} catch (error) {
		post({
			type: "error",
			requestId: message.requestId,
			message: error instanceof Error ? error.message : "Unknown worker error.",
		});
	}
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
	if (event.data.type === "run") {
		void handleRun(event.data);
	}
};
