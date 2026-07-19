import type { ReactNode } from "react";
import { LEDIndicator } from "./LEDIndicator";
import "./RackUnitRow.css";

type RackUnitRowProps = {
	unitId: string;
	name: string;
	active: boolean;
	ledOn?: boolean;
	ledColor?: "success" | "amber" | "error";
	children?: ReactNode;
};

export function RackUnitRow({ unitId, name, active, ledOn = false, ledColor, children }: RackUnitRowProps) {
	return (
		<div className={`rack-unit-row${active ? "" : " empty"}`}>
			<div className="rack-unit-title">
				<LEDIndicator on={ledOn} color={ledColor} />
				<b>{unitId}</b>
				<span>{name}</span>
			</div>
			{active ? children : <div className="empty-slot">EMPTY SLOT</div>}
		</div>
	);
}
