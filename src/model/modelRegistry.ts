export type ModelDefinition = {
	key: string;
	id: string;
	displayName: string;
	task: "depth-estimation";
};

export const DEPTH_MODEL: ModelDefinition = {
	key: "depthAnythingV2Small",
	id: "onnx-community/depth-anything-v2-small",
	displayName: "Depth Anything V2 Small",
	task: "depth-estimation",
};

// A second, independent model used only for lighting (its per-pixel surface
// normals replace the Sobel-derived approximation in lighting.ts). Depth
// Anything above remains the sole source of depth/parallax — this is purely
// additive and never touches depthModelManager.ts/depthWorker.ts.
export const NORMAL_MODEL: ModelDefinition = {
	key: "metric3dVitSmallNormal",
	id: "onnx-community/metric3d-vit-small",
	displayName: "Metric3D v2 (ViT-Small) — Surface Normals",
	task: "depth-estimation", // filed under this pipeline tag on the Hub even though we only use its normal head
};
