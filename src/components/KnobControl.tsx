import { useCallback, useRef, useState } from "react";
import "./KnobControl.css";

export type KnobState = "idle" | "running" | "done" | "error";

type KnobControlProps = {
	label: string;
	value: number; // 0..1
	min?: number;
	max?: number;
	state: KnobState;
	statusText: string;
	onChange: (value: number) => void;
	onTrigger?: () => void;
	onCancel?: () => void;
	disabled?: boolean;
};

const MIN_ANGLE = -130;
const MAX_ANGLE = 130;

export function KnobControl({
	label,
	value,
	min = 0,
	max = 1,
	state,
	statusText,
	onChange,
	onTrigger,
	onCancel,
	disabled = false,
}: KnobControlProps) {
	const [isDragging, setIsDragging] = useState(false);
	const dragStart = useRef<{ y: number; value: number } | null>(null);

	const normalized = (value - min) / (max - min);
	const angle = MIN_ANGLE + normalized * (MAX_ANGLE - MIN_ANGLE);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (disabled) return;
			(event.target as HTMLElement).setPointerCapture(event.pointerId);
			dragStart.current = { y: event.clientY, value };
			setIsDragging(false);
		},
		[disabled, value],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragStart.current || disabled) return;
			const deltaY = dragStart.current.y - event.clientY;
			if (Math.abs(deltaY) > 3) {
				setIsDragging(true);
			}
			const range = max - min;
			const nextValue = Math.min(max, Math.max(min, dragStart.current.value + (deltaY / 140) * range));
			onChange(nextValue);
		},
		[disabled, max, min, onChange],
	);

	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			(event.target as HTMLElement).releasePointerCapture(event.pointerId);
			const wasDragging = isDragging;
			dragStart.current = null;
			setIsDragging(false);
			if (!wasDragging && !disabled) {
				onTrigger?.();
			}
		},
		[disabled, isDragging, onTrigger],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (disabled) return;
			const step = (max - min) / 100;
			switch (event.key) {
				case "ArrowUp":
				case "ArrowRight":
					event.preventDefault();
					onChange(Math.min(max, value + step));
					break;
				case "ArrowDown":
				case "ArrowLeft":
					event.preventDefault();
					onChange(Math.max(min, value - step));
					break;
				case "Enter":
				case " ":
					event.preventDefault();
					onTrigger?.();
					break;
				default:
					break;
			}
		},
		[disabled, max, min, onChange, onTrigger, value],
	);

	const isDimmed = disabled && state !== "running";

	return (
		<div className={`knob-control${isDimmed ? " disabled" : ""}`}>
			<div className={`knob-ring knob-ring-${state}`}>
				<div
					className="knob-face"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onKeyDown={handleKeyDown}
					role="slider"
					aria-label={label}
					aria-valuemin={min}
					aria-valuemax={max}
					aria-valuenow={value}
					tabIndex={disabled ? -1 : 0}
				>
					<span className="knob-indicator" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
				</div>
			</div>
			<p className="knob-title">{label}</p>
			<p className="knob-status">{statusText}</p>
			{state === "running" && onCancel ? (
				<button type="button" className="knob-cancel" onClick={onCancel}>
					Cancel
				</button>
			) : null}
		</div>
	);
}
