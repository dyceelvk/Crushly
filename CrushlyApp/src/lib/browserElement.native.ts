/** Browser camera/video components are never rendered on native. */
export function browserElement(..._args: unknown[]): never {
  throw new Error('Browser-only media component cannot be rendered on Android or iOS.');
}
