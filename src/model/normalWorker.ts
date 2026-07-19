/// <reference lib="webworker" />

import { AutoModelForDepthEstimation, AutoProcessor, RawImage, type PreTrainedModel, type Processor } from "@huggingface/transformers";
import { NORMAL_MODEL } from "./modelRegistry";

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

type NormalTensor = {
	dims: number[];
	data: ArrayLike<number>;
};

let modelPromise: Promise<PreTrainedModel> | null = null;
let processorPromise: Promise<Processor> | null = null;

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

function reportProgress(event: ProgressPayload) {
	const progress = normalizeProgress(event);
	post({
		type: "progress",
		status: event.status ?? "progress",
		progress: progress ?? 0,
	});
}

function loadModel() {
	if (!modelPromise) {
		modelPromise = AutoModelForDepthEstimation.from_pretrained(NORMAL_MODEL.id, {
			// onnx-community/metric3d-vit-small only ships onnx/model.onnx (fp32,
			// ~150MB) and onnx/model_fp16.onnx (~76MB) — no quantized ("q8")
			// variant exists, so requesting q8 404s on model_quantized.onnx.
			// fp16 was tried next (smaller download) but ONNX Runtime Web fails
			// to create a session for it — a LayerNormFusion graph-optimization
			// pass references a node arg that doesn't survive fp16 casting
			// ("GetIndexFromName ... was false"), a model/runtime-level
			// incompatibility, not something fixable from the call site. fp32 is
			// the only remaining option this repo actually ships.
			dtype: "fp32",
			progress_callback: reportProgress,
		});
	}
	return modelPromise;
}

function loadProcessor() {
	if (!processorPromise) {
		processorPromise = AutoProcessor.from_pretrained(NORMAL_MODEL.id, {
			progress_callback: reportProgress,
		});
	}
	return processorPromise;
}

// Squeezes a leading batch dim of size 1 (models are called with a single
// image, but ONNX output shapes usually keep the batch axis) and asserts the
// remaining shape has exactly `expectedRank` dims.
function squeezeBatch(dims: number[], expectedRank: number): number[] {
	const squeezed = dims.length === expectedRank + 1 && dims[0] === 1 ? dims.slice(1) : dims;
	if (squeezed.length !== expectedRank) {
		throw new Error(`Unexpected tensor shape [${dims.join(", ")}], expected rank ${expectedRank} (optionally batched).`);
	}
	return squeezed;
}

// predicted_normal is documented as roughly [1, 3, H, W] or [3, H, W]
// (channels-first, per HF image-tensor convention) — this reads the actual
// dims off the tensor at runtime rather than assuming, per the brief's
// instruction to verify empirically rather than hard-code.
function decodeNormalTensor(tensor: NormalTensor): { width: number; height: number; data: ArrayLike<number> } {
	const [channels, height, width] = squeezeBatch(tensor.dims, 3);
	if (channels !== 3) {
		throw new Error(`Expected predicted_normal to have 3 channels, got shape [${tensor.dims.join(", ")}].`);
	}
	return { width, height, data: tensor.data };
}

function decodeConfidenceTensor(tensor: NormalTensor, width: number, height: number): ArrayLike<number> {
	let dims = tensor.dims;
	// Confidence is single-channel — squeeze a leading batch dim and/or a
	// leading channel dim of size 1, in either order.
	if (dims.length === 4 && dims[0] === 1) {
		dims = dims.slice(1);
	}
	if (dims.length === 3 && dims[0] === 1) {
		dims = dims.slice(1);
	}
	if (dims.length !== 2 || dims[0] !== height || dims[1] !== width) {
		throw new Error(`Unexpected normal_confidence shape [${tensor.dims.join(", ")}] for a ${width}x${height} normal map.`);
	}
	return tensor.data;
}

async function handleRun(message: RunMessage) {
	try {
		const [model, processor] = await Promise.all([loadModel(), loadProcessor()]);
		post({ type: "model-ready" });

		const canvas = new OffscreenCanvas(message.imageBitmap.width, message.imageBitmap.height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Could not create an offscreen canvas context.");
		}
		context.drawImage(message.imageBitmap, 0, 0);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const rawImage = await RawImage.fromBlob(blob);

		const inputs = await processor(rawImage);
		const output = (await model(inputs)) as unknown as {
			predicted_normal: NormalTensor;
			normal_confidence: NormalTensor;
		};

		const { width, height, data: normalData } = decodeNormalTensor(output.predicted_normal);
		const confidenceData = decodeConfidenceTensor(output.normal_confidence, width, height);

		// Channels-first layout: channel c, pixel i is at data[c * width * height + i].
		const pixelCount = width * height;
		const rgba = new Uint8ClampedArray(pixelCount * 4);
		for (let index = 0; index < pixelCount; index += 1) {
			const nx = normalData[index];
			const ny = normalData[pixelCount + index];
			const nz = normalData[2 * pixelCount + index];
			const confidence = confidenceData[index];

			rgba[index * 4] = (nx * 0.5 + 0.5) * 255;
			rgba[index * 4 + 1] = (ny * 0.5 + 0.5) * 255;
			rgba[index * 4 + 2] = (nz * 0.5 + 0.5) * 255;
			rgba[index * 4 + 3] = confidence * 255;
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
