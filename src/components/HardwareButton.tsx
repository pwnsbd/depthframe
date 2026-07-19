import type { ButtonHTMLAttributes } from "react";
import "./HardwareButton.css";

type HardwareButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function HardwareButton({ className = "", ...props }: HardwareButtonProps) {
	return <button className={`hardware-button ${className}`.trim()} type="button" {...props} />;
}
