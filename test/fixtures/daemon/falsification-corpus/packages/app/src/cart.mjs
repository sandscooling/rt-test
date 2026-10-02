import { discounted } from "@falsification-corpus/lib";

export function total(prices) {
  let sum = 0;
  for (const price of prices) sum += discounted(price);
  return sum;
}

export function receipt(prices) {
  return `Total: ${total(prices)}`;
}
