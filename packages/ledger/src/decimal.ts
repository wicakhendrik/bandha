import Decimal from "decimal.js";

// Dedicated constructor so global Decimal config never leaks into other code.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

export function dec(value: string | Dec): Dec {
  if (typeof value === "number") {
    throw new Error("Floating-point numbers are not allowed for money; pass a string");
  }
  return new D(value);
}
