import { useState, type DragEvent, type ReactNode } from "react";
import { LayerFilmstrip, type FilmstripLayer } from "./LayerFilmstrip";
import "./ScreenBezel.css";

type ScreenBezelProps = {
	children?: ReactNode;
	hasImage: boolean;
	caption?: { name: string; dimensions: string };
	onDropFile?: (file: File) => void;
	disabled?: boolean;
	layers: FilmstripLayer[];
};

export function ScreenBezel({ children, hasImage, caption, onDropFile, disabled, layers }: ScreenBezelProps) {
	const [isDragOver, setIsDragOver] = useState(false);

	function handleDragOver(event: DragEvent<HTMLDivElement>) {
		if (disabled || !onDropFile) return;
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragOver(true);
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>) {
		if (event.currentTarget.contains(event.relatedTarget as Node)) return;
		setIsDragOver(false);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		setIsDragOver(false);
		if (disabled || !onDropFile) return;
		event.preventDefault();
		const file = event.dataTransfer.files?.[0];
		if (file) {
			onDropFile(file);
		}
	}

	return (
		<div className="screen-bezel">
			<div
				className={`screen${isDragOver ? " screen--drag-active" : ""}`}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				{hasImage ? (
					children
				) : (
					<div className="no-signal">
						<span className="no-signal-static" aria-hidden="true" />
						<span className="no-signal-text">
							{isDragOver ? "[ RELEASE TO IMPORT ]" : "[ NO SIGNAL — IMPORT OR DROP IMAGE ]"}
						</span>
					</div>
				)}
				{isDragOver ? <div className="screen-drop-overlay" aria-hidden="true" /> : null}
				<LayerFilmstrip layers={layers} />
			</div>
			<div className="screen-caption">
				<span>{caption?.name ?? "—"}</span>
				<span>{caption?.dimensions ?? ""}</span>
			</div>
		</div>
	);
}
