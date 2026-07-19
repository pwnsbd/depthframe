import { useCallback, useRef } from "react";
import "./SmallKnobControl.css";

type SmallKnobControlProps = {
	label: string;
	value: number;
	min?: number;
	max?: number;
	onChange: (value: number) => void;
	disabled?: boolean;
};

const MIN_ANGLE = -130;
const MAX_ANGLE = 130;

// A compact variant of KnobControl for continuous, always-idle properties
// (nothing to run/cancel) — same turn-to-adjust drag/keyboard interaction,
// just a smaller dial with no state ring or trigger.
export function SmallKnobControl({ label, value, min = 0, max = 1, onChange, disabled = false }: SmallKnobControlProps) {
	const dragStart = useRef<{ y: number; value: number } | null>(null);

	const normalized = (value - min) / (max - min);
	const angle = MIN_ANGLE + normalized * (MAX_ANGLE - MIN_ANGLE);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (disabled) return;
			(event.target as HTMLElement).setPointerCapture(event.pointerId);
			dragStart.current = { y: event.clientY, value };
		},
		[disabled, value],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragStart.current || disabled) return;
			const deltaY = dragStart.current.y - event.clientY;
			const range = max - min;
			const nextValue = Math.min(max, Math.max(min, dragStart.current.value + (deltaY / 140) * range));
			onChange(nextValue);
		},
		[disabled, max, min, onChange],
	);

	const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		(event.target as HTMLElement).releasePointerCapture(event.pointerId);
		dragStart.current = null;
	}, []);

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
				default:
					break;
			}
		},
		[disabled, max, min, onChange, value],
	);

	return (
		<div className={`small-knob-control${disabled ? " disabled" : ""}`}>
			<div
				className="small-knob-face"
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
				<span className="small-knob-indicator" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
			</div>
			<p className="small-knob-title">{label}</p>
		</div>
	);
}
