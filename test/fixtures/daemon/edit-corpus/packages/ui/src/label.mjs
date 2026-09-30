import { price } from "@corpus/lib/pricing";

export const LABEL_PREFIX = "Total";

export function label(quantity) {
  return `${LABEL_PREFIX}: ${price(quantity)}`;
}
