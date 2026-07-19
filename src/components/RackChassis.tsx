import type { ReactNode } from "react";
import "./RackChassis.css";

type RackChassisProps = {
	children: ReactNode;
};

export function RackChassis({ children }: RackChassisProps) {
	return (
		<div className="rack-chassis">
			<span className="rivet rivet-tl" aria-hidden="true" />
			<span className="rivet rivet-tr" aria-hidden="true" />
			<span className="rivet rivet-bl" aria-hidden="true" />
			<span className="rivet rivet-br" aria-hidden="true" />
			{children}
		</div>
	);
}
