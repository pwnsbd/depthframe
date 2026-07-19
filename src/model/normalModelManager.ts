export type ModelStatus = "idle" | "downloading" | "loading" | "ready" | "error";

export type ModelState = {
	status: ModelStatus;
	progress: number;
	error: string | null;
};

export type NormalResult = {
	width: number;
	height: number;
	buffer: ArrayBuffer;
};

export class NormalCancelledError extends Error {
	constructor() {
		super("Cancelled");
		this.name = "NormalCancelledError";
	}
}

type Listener = (state: ModelState) => void;

let worker: Worker | null = null;
let state: ModelState = { status: "idle", progress: 0, error: null };
const listeners = new Set<Listener>();

let nextRequestId = 1;
const pending = new Map<number, { resolve: (result: NormalResult) => void; reject: (error: Error) => void }>();

function setState(partial: Partial<ModelState>) {
	state = { ...state, ...partial };
	for (const listener of listeners) {
		listener(state);
	}
}

function getWorker(): Worker {
	if (worker) {
		return worker;
	}

	worker = new Worker(new URL("./normalWorker.ts", import.meta.url), {
		type: "module",
	});

	worker.onmessage = (event: MessageEvent) => {
		const message = event.data as Record<string, unknown>;

		switch (message.type) {
			case "progress": {
				const progress = typeof message.progress === "number" ? message.progress : 0;
				setState({
					status: progress >= 100 ? "loading" : "downloading",
					progress,
					error: null,
				});
				break;
			}
			case "model-ready": {
				setState({ status: "ready", progress: 100, error: null });
				break;
			}
			case "result": {
				const requestId = message.requestId as number;
				const request = pending.get(requestId);
				pending.delete(requestId);
				request?.resolve({
					width: message.width as number,
					height: message.height as number,
					buffer: message.buffer as ArrayBuffer,
				});
				break;
			}
			case "error": {
				const detail = typeof message.message === "string" ? message.message : "Unknown model error.";
				setState({ status: "error", error: detail });
				const requestId = message.requestId as number | undefined;
				if (requestId !== undefined) {
					const request = pending.get(requestId);
					pending.delete(requestId);
					request?.reject(new Error(detail));
				}
				break;
			}
			default:
				break;
		}
	};

	worker.onerror = (event) => {
		setState({ status: "error", error: event.message || "The normal worker crashed." });
	};

	return worker;
}

export function subscribeModelState(listener: Listener): () => void {
	listeners.add(listener);
	listener(state);
	return () => {
		listeners.delete(listener);
	};
}

export function getModelState(): ModelState {
	return state;
}

// Runs surface-normal estimation for one image. The worker keeps the loaded
// model+processor cached across calls, so only the first call in a session
// pays the download/load cost — subsequent calls go straight to inference.
export function runNormal(imageBitmap: ImageBitmap): Promise<NormalResult> {
	const requestId = nextRequestId;
	nextRequestId += 1;

	return new Promise((resolve, reject) => {
		pending.set(requestId, { resolve, reject });
		getWorker().postMessage(
			{ type: "run", requestId, imageBitmap },
			[imageBitmap],
		);
	});
}

// Transformers.js models can't be aborted mid-inference, so the only way to
// actually stop a running request is to kill the worker thread that's
// running it. The next runNormal() call spins up a fresh worker and reloads
// the model (a cache hit in the browser's model cache, not a re-download).
export function cancelNormal(): void {
	if (worker) {
		worker.terminate();
		worker = null;
	}
	for (const request of pending.values()) {
		request.reject(new NormalCancelledError());
	}
	pending.clear();
	setState({ status: "idle", progress: 0, error: null });
}
