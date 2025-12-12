/**
 * Prevents number input values from changing when scrolling with trackpad/mouse wheel
 * while the input is focused. This is a common issue on macOS where scrolling over
 * a focused number input changes its value unintentionally.
 * 
 * Usage:
 * <input
 *   type="number"
 *   onWheel={preventScrollWheelChange}
 *   ...
 * />
 */
export const preventScrollWheelChange = (
  e: React.WheelEvent<HTMLInputElement>
): void => {
  if (document.activeElement === e.currentTarget) {
    e.currentTarget.blur();
  }
};


