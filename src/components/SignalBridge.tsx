import { useEffect, useRef, useState } from "react";
import "./SignalBridge.css";

type SignalBridgeProps = {
	label?: string;
	level: number; // 0..100
	active: boolean;
};

const BAR_COUNT = 24;

export function SignalBridge({ label = "SIGNAL", level, active }: SignalBridgeProps) {
	const [ambientPhase, setAmbientPhase] = useState(0);
	const frameRef = useRef<number>(0);

	useEffect(() => {
		if (active) return undefined;
		let raf: number;
		const tick = () => {
			setAmbientPhase((phase) => phase + 0.05);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		frameRef.current = raf;
		return () => cancelAnimationFrame(frameRef.current);
	}, [active]);

	const bars = Array.from({ length: BAR_COUNT }, (_, index) => {
		if (active) {
			const distanceFromEdge = Math.min(index, BAR_COUNT - index) / (BAR_COUNT / 2);
			const litThreshold = (level / 100) * BAR_COUNT;
			const isLit = index < litThreshold;
			const height = isLit ? 30 + distanceFromEdge * 70 : 8;
			return { height, lit: isLit, peak: isLit && index === Math.floor(litThreshold) - 1 };
		}
		const ambient = 8 + Math.abs(Math.sin(ambientPhase + index * 0.4)) * 10;
		return { height: ambient, lit: false, peak: false };
	});

	return (
		<div className="signal-bridge">
			<span className="signal-label">{label}</span>
			<div className="signal-bars">
				{bars.map((bar, index) => (
					<div
						key={index}
						className={`signal-bar${bar.lit ? " lit" : ""}${bar.peak ? " peak" : ""}`}
						style={{ height: `${bar.height}%` }}
					/>
				))}
			</div>
			<span className="signal-value">{active ? `${Math.round(level)}%` : "IDLE"}</span>
		</div>
	);
}
