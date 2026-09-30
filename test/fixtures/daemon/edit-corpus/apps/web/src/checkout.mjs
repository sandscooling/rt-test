import { price } from "@corpus/lib";
import { quote } from "@corpus/backend";
import { label } from "@corpus/ui";

export function checkout(quantity) {
  return {
    label: label(quantity),
    quote: quote(quantity),
    total: price(quantity),
  };
}
