const DB_NAME = "depthframe";
const DB_VERSION = 1;
const STORE_NAME = "project";
const RECORD_KEY = "current";

export type SavedProject = {
	imageBlob: Blob;
	imageName: string;
	imageWidth: number;
	imageHeight: number;
	depthBuffer: ArrayBuffer;
	depthWidth: number;
	depthHeight: number;
	depthStrength: number;
	parallaxStrength: number;
	invertDepth: boolean;
	smoothing: number;
	// Optional because older saves predate this knob — the store defaults it
	// to 1 (the fixed swing they always rendered with) when absent.
	lightingStrength?: number;
	// The Sobel-derived lighting texture isn't stored — it's a pure function
	// of depthBuffer, so it's re-derived on load instead of persisting a
	// redundant copy. Model-based surface normals are NOT a function of
	// depthBuffer (a separate model produces them), so unlike lighting they
	// are persisted here — `normal` is optional because older saves predate
	// the normal model and simply fall back to the Sobel path on load.
	normal?: { buffer: ArrayBuffer; width: number; height: number };
	//
	// Older saved projects may still have a `segmentation` field on the
	// stored object (segmentation has since been removed) — that field is
	// simply ignored on load rather than causing an error; IndexedDB doesn't
	// enforce a schema, so no migration step is needed.
	savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Could not open the local project database."));
	});
}

export async function saveProject(project: SavedProject): Promise<void> {
	const db = await openDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).put(project, RECORD_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error("Could not save the project."));
		});
	} finally {
		db.close();
	}
}

export async function loadProject(): Promise<SavedProject | null> {
	const db = await openDb();
	try {
		return await new Promise<SavedProject | null>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
			request.onsuccess = () => resolve((request.result as SavedProject | undefined) ?? null);
			request.onerror = () => reject(request.error ?? new Error("Could not load the saved project."));
		});
	} finally {
		db.close();
	}
}
