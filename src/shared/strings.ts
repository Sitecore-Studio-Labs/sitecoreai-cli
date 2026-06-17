/**
 * Linear character trims that replace ReDoS-prone anchored regex trims
 * (`/X+$/`, `/^X+|X+$/g`). Those are O(n²): with no start anchor the engine
 * retries the run at every position (CodeQL js/polynomial-redos). These scan
 * the string once. `ch` must be a single character.
 */

/** Remove every trailing occurrence of `ch`. */
export const trimEndChar = (value: string, ch: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === ch) end--;
  return end === value.length ? value : value.slice(0, end);
};

/** Remove every leading and trailing occurrence of `ch`. */
export const trimEdgeChar = (value: string, ch: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ch) start++;
  while (end > start && value[end - 1] === ch) end--;
  return start === 0 && end === value.length ? value : value.slice(start, end);
};
