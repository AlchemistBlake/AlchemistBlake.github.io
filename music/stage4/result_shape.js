// result_shape.js - browser-safe strict result-shape check for the shared validator (M-041).
// Strict result contract. Accepted: an array whose items are ALL strings, or ALL
// {code: string, msg: string, path?: string} objects (Port's shape; [] = valid).
// Returns a string[] of errors, or null when the shape is not recognised.
export function normalizeResult(r) {
  if (!Array.isArray(r)) return null;
  if (r.every(x => typeof x === 'string')) return r.slice();
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x) && typeof x.code === 'string' && typeof x.msg === 'string'
    && (x.path === undefined || typeof x.path === 'string');
  if (r.every(isObj)) return r.map(x => `${x.code} ${x.path === undefined ? '' : x.path}: ${x.msg}`);
  return null;
}
export const BAD_SHAPE = 'shared validator returned an unrecognised result shape (fail closed)';

