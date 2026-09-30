import { price } from "@corpus/lib";

export const CURRENCY = "USD";

export function quote(quantity) {
  return { amount: price(quantity), currency: CURRENCY };
}
