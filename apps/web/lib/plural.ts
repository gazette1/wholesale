/** "1 delivery", "2 deliveries". Safe to import from client components. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
