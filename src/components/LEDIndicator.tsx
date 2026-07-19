import "./LEDIndicator.css";

type LEDIndicatorProps = {
	on: boolean;
	color?: "success" | "amber" | "error";
	label?: string;
};

export function LEDIndicator({ on, color = "success", label }: LEDIndicatorProps) {
	return (
		<span className="led-indicator">
			<span className={`led-dot led-${color}${on ? " on" : ""}`} aria-hidden="true" />
			{label ? <span className="led-label">{label}</span> : null}
		</span>
	);
}
