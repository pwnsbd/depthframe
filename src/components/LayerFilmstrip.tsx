import { useEffect, useRef } from "react";
import type { Texture } from "three";
import { LEDIndicator } from "./LEDIndicator";
import "./LayerFilmstrip.css";

export type FilmstripLayer = {
	id: string;
	label: string;
	ready: boolean;
	texture: Texture;
};

type LayerFilmstripProps = {
	layers: FilmstripLayer[];
};

// CanvasTexture.image *is* the backing <canvas> — moving that node into the
// DOM directly shows the real pixels with no re-encode/toDataURL cost. The
// canvas isn't attached anywhere else (the texture helpers create it
// detached, purely as a GPU upload source), so relocating it here is safe
// and doesn't affect its use as a shader uniform elsewhere.
function LayerPreview({ texture }: { texture: Texture }) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		const canvas = texture.image as HTMLCanvasElement | undefined;
		if (!container || !canvas) {
			return;
		}

		canvas.classList.add("layer-preview-canvas");
		container.appendChild(canvas);

		return () => {
			canvas.classList.remove("layer-preview-canvas");
			if (canvas.parentNode === container) {
				container.removeChild(canvas);
			}
		};
	}, [texture]);

	return <div className="layer-preview" ref={containerRef} />;
}

export function LayerFilmstrip({ layers }: LayerFilmstripProps) {
	return (
		<div className="layer-filmstrip">
			{layers.map((layer) => (
				<div key={layer.id} className={`layer-tile${layer.ready ? "" : " layer-tile--empty"}`}>
					<div className="layer-tile-header">
						<LEDIndicator on={layer.ready} />
						<span className="layer-tile-label">{layer.label}</span>
					</div>
					<LayerPreview texture={layer.texture} />
				</div>
			))}
		</div>
	);
}
