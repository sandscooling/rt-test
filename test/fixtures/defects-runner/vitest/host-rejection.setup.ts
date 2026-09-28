export default function setup(): void {
  void Promise.reject(new Error("host boom"));
}
