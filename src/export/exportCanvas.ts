// Static PNG snapshot and looping MP4 export. The caller (App.tsx) captures
// from ExportStage's offscreen, native-resolution canvas — not the live,
// on-screen one, which is sized to the app window and has nothing to do with
// the source photo's actual resolution. Video reuses DepthPlane's existing
// idle-drift system for motion (via the forceIdleDrift/exportLoopDurationMs
// props) rather than any new camera/animation logic here — this module only
// owns capturing/encoding/downloading whatever canvas it's handed.
//
// captureStream + MediaRecorder can only produce WebM (VP8/VP9) in-browser —
// there's no native path to H.264/MP4. Instagram and most mobile apps don't
// reliably accept WebM, so the WebM capture is transcoded to MP4 with
// ffmpeg.wasm before download. The ffmpeg-core files are self-hosted under
// public/ffmpeg/ (rather than fetched from a CDN) to match the app's
// local-first philosophy — the core is ~32MB, so it's loaded lazily on first
// export and cached for the session, not bundled or loaded eagerly.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// Exported so the App can feed the same duration to DepthPlane as its
// exportLoopDurationMs — the captured clip's length and the drift's loop
// period must match exactly for the loop to seam cleanly.
export const VIDEO_EXPORT_DURATION_MS = 3000;
const VIDEO_EXPORT_FPS = 30;

// The browser default bitrate (commonly ~2.5Mbps regardless of resolution)
// visibly compresses a full 1920-edge capture — this is generous enough to
// keep the intermediate WebM near-transparent quality-wise, so the H.264
// re-encode below is the only lossy step that actually matters.
const VIDEO_BITS_PER_SECOND = 20_000_000;

// Leaving the codec unpinned (bare "video/webm") lets the browser choose —
// on hardware with AV1 encode support, Chrome can pick AV1, which this
// ffmpeg-core build fails to decode ("Missing Sequence Header"). VP9/VP8 are
// what ffmpeg reliably decodes, so an explicit codec is requested and the
// first one the browser actually supports is used, in preference order.
const VIDEO_MIME_TYPE_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

function pickVideoMimeType(): string | undefined {
	return VIDEO_MIME_TYPE_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

// Loop-quality note: DepthPlane's forceIdleDrift + exportLoopDurationMs
// together anchor the periodic drift to t=0 at the moment recording is
// requested, but smoothedMouse (the lerp-smoothed value actually driving
// uMouse) starts from wherever the pointer last was and needs a short
// settle time to converge onto the periodic drift's steady-state path.
// Waiting this long after forcing idle drift, before starting the actual
// MediaRecorder capture, keeps that transient out of the captured window so
// the loop seam lines up in both position and velocity.
export const VIDEO_EXPORT_PREROLL_MS = 1200;

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function exportCanvasAsImage(canvas: HTMLCanvasElement): Promise<void> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Could not capture the canvas as an image."));
				return;
			}
			triggerDownload(blob, `depthframe-export-${Date.now()}.png`);
			resolve();
		}, "image/png");
	});
}

function recordCanvasAsWebm(canvas: HTMLCanvasElement, durationMs: number): Promise<Blob> {
	const mimeType = pickVideoMimeType();
	if (!mimeType) {
		return Promise.reject(new Error("This browser can't record WebM video."));
	}

	const stream = canvas.captureStream(VIDEO_EXPORT_FPS);
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
	const chunks: BlobPart[] = [];

	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) {
			chunks.push(event.data);
		}
	};

	const stopped = new Promise<void>((resolve, reject) => {
		recorder.onstop = () => resolve();
		recorder.onerror = () => reject(new Error("Recording failed."));
	});

	return (async () => {
		try {
			recorder.start();
			await new Promise((resolve) => setTimeout(resolve, durationMs));
			recorder.stop();
			await stopped;
		} finally {
			// Otherwise the capture session (and its implicit hold on the canvas)
			// stays alive indefinitely after export finishes.
			for (const track of stream.getTracks()) {
				track.stop();
			}
		}
		return new Blob(chunks, { type: mimeType });
	})();
}

// Lazily created and cached: loading the ~32MB core is only worth paying for
// once an export actually happens, and only once per session thereafter.
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

function loadFfmpeg(): Promise<FFmpeg> {
	if (ffmpegLoadPromise) {
		return ffmpegLoadPromise;
	}
	ffmpegLoadPromise = (async () => {
		const ffmpeg = new FFmpeg();
		const baseURL = `${import.meta.env.BASE_URL}ffmpeg`;
		try {
			await ffmpeg.load({
				coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
				wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
			});
		} catch (error) {
			// A failed load must not stick around as the cached promise — every
			// future export would instantly replay the same rejection forever,
			// even after whatever caused it (e.g. a bad core file) is fixed.
			ffmpegLoadPromise = null;
			throw error;
		}
		ffmpegInstance = ffmpeg;
		return ffmpeg;
	})();
	return ffmpegLoadPromise;
}

async function transcodeWebmToMp4(webmBlob: Blob): Promise<Blob> {
	const ffmpeg = ffmpegInstance ?? (await loadFfmpeg());

	// ffmpeg.exec() only rejects on a fatal/aborted run — a normal command
	// failure (bad codec, bad args, unreadable input) just sets a non-zero
	// return code while leaving a truncated/empty output file behind, which
	// looks like success unless the code is checked explicitly. Capturing the
	// log lines is what makes a failure here diagnosable instead of just a
	// silently broken download.
	const logLines: string[] = [];
	const logListener = ({ message }: { message: string }) => {
		logLines.push(message);
	};
	ffmpeg.on("log", logListener);

	const inputName = "input.webm";
	const outputName = "output.mp4";
	await ffmpeg.writeFile(inputName, await fetchFile(webmBlob));
	try {
		// yuv420p is required for broad compatibility (Instagram, iOS, most
		// mobile players reject other pixel formats even inside a valid H.264
		// stream), but yuv420p's chroma subsampling requires even width and
		// height — canvas dimensions depend on the source photo's aspect
		// ratio and are frequently odd (e.g. 1058x835), which libx264 refuses
		// outright ("height not divisible by 2"). The scale filter floors
		// each dimension to the nearest even number, trimming at most 1px
		// off one edge — imperceptible, versus padding which would add a
		// visible black sliver. -movflags +faststart moves the moov atom to
		// the front so the file is playable/seekable before it's fully
		// downloaded.
		//
		// -crf 18 is visually near-lossless (libx264's own default is 23 —
		// noticeably softer). -preset slow spends more effort per bit for
		// better quality at that CRF; ffmpeg.wasm is single-threaded WASM, so
		// veryslow would push a few seconds of 1080p footage well past what's
		// reasonable to make someone wait for in a browser tab.
		const returnCode = await ffmpeg.exec([
			"-i",
			inputName,
			"-vf",
			"scale=trunc(iw/2)*2:trunc(ih/2)*2",
			"-c:v",
			"libx264",
			"-preset",
			"slow",
			"-crf",
			"18",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			outputName,
		]);
		if (returnCode !== 0) {
			const tail = logLines.slice(-8).join("\n");
			throw new Error(`ffmpeg exited with code ${returnCode}${tail ? `:\n${tail}` : "."}`);
		}
		const data = await ffmpeg.readFile(outputName);
		// readFile's Uint8Array is typed over ArrayBufferLike (it could in
		// principle be backed by a SharedArrayBuffer), which Blob's constructor
		// doesn't accept — copying into a fresh Uint8Array gives it a plain
		// ArrayBuffer.
		const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
		if (bytes.byteLength === 0) {
			const tail = logLines.slice(-8).join("\n");
			throw new Error(`ffmpeg produced an empty file${tail ? `:\n${tail}` : "."}`);
		}
		return new Blob([bytes], { type: "video/mp4" });
	} finally {
		ffmpeg.off("log", logListener);
		await ffmpeg.deleteFile(inputName).catch(() => {});
		await ffmpeg.deleteFile(outputName).catch(() => {});
	}
}

// "preparing" (the pre-roll settle delay) is driven by the caller, not this
// module, but is part of the same stage sequence the UI displays.
export type VideoExportStage = "preparing" | "recording" | "encoding";

export async function exportCanvasAsVideo(
	canvas: HTMLCanvasElement,
	onStageChange?: (stage: VideoExportStage) => void,
): Promise<void> {
	onStageChange?.("recording");
	const webmBlob = await recordCanvasAsWebm(canvas, VIDEO_EXPORT_DURATION_MS);

	onStageChange?.("encoding");
	const mp4Blob = await transcodeWebmToMp4(webmBlob);

	triggerDownload(mp4Blob, `depthframe-export-${Date.now()}.mp4`);
}
