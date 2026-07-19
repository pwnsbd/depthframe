import type { ChangeEvent } from "react";
import { LEDIndicator } from "./LEDIndicator";
import "./RackHeader.css";

type RackHeaderProps = {
	modelReady: boolean;
	modelBusy: boolean;
	modelLabel: string;
	onImport: (file: File) => void;
	onSave: () => void;
	onLoad: () => void;
	canSave: boolean;
	disabled: boolean;
};

export function RackHeader({ modelReady, modelBusy, modelLabel, onImport, onSave, onLoad, canSave, disabled }: RackHeaderProps) {
	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (file) {
			onImport(file);
		}
		event.target.value = "";
	}

	return (
		<div className="rack-header">
			<div className="rack-brand">
				DEPTHFRAME <b>UNIT-01</b>
			</div>
			<div className="rack-header-right">
				<input
					id="image-upload"
					type="file"
					// MIME types are unreliable for HEIC/DNG on Windows (often blank or
					// generic), so extensions are listed alongside them — the OS file
					// picker matches on whichever signal it has.
					accept="image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif,.heic,.heif,.dng"
					className="visually-hidden"
					disabled={disabled}
					onChange={handleChange}
				/>
				<label htmlFor="image-upload" className={`import-label${disabled ? " disabled" : ""}`}>
					IMPORT IMAGE
				</label>
				<button
					type="button"
					className={`import-label${disabled || !canSave ? " disabled" : ""}`}
					onClick={onSave}
					disabled={disabled || !canSave}
				>
					SAVE
				</button>
				<button type="button" className={`import-label${disabled ? " disabled" : ""}`} onClick={onLoad} disabled={disabled}>
					LOAD
				</button>
				<LEDIndicator on={modelReady} color={modelBusy ? "amber" : "success"} label={modelLabel} />
			</div>
		</div>
	);
}
