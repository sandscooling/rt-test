export function discounted(price) {
  return price * 0.9;
}

export function rate() {
  return 0.9;
}

export function label(price) {
  return `${price.toFixed(2)} USD`;
}
