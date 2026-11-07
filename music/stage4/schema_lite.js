// schema_lite.js - dependency-free JSON Schema checker for the keyword subset the timeline
// contract uses: type, const, enum, required, properties, additionalProperties:false,
// items, minimum, maximum, pattern, format:date-time. Unknown keywords -> error (so a
// contract change can't be silently ignored). Cross-checked against python jsonschema in tests.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070
const KNOWN = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'required', 'properties',
  'additionalProperties', 'items', 'minimum', 'maximum', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems', '$defs', '$ref']);
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function typeOk(t, v) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: throw new Error('schema_lite: unsupported type ' + t);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function schemaErrors(schema, value, root = schema, path = '') {
  const err = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) err.push(`${path || '/'}: schema_lite does not support keyword "${k}"`);
  if (schema.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref); if (!m || !root.$defs || !root.$defs[m[1]]) return [`${path}: unresolvable $ref ${schema.$ref}`];
    return err.concat(schemaErrors(root.$defs[m[1]], value, root, path));
  }
  if (schema.type !== undefined) {
    const ts = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!ts.some(t => typeOk(t, value))) { err.push(`${path || '/'}: expected ${ts.join('|')}`); return err; }
  }
  if ('const' in schema && !eq(schema.const, value)) err.push(`${path || '/'}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(e => eq(e, value))) err.push(`${path || '/'}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) err.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) err.push(`${path}: "${value}" does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && !DT.test(value)) err.push(`${path}: not an RFC 3339 date-time`);
    if (schema.minLength !== undefined && value.length < schema.minLength) err.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => err.push(...schemaErrors(schema.items, v, root, `${path}/${i}`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) if (!(r in value)) err.push(`${path || '/'}: missing required "${r}"`);
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (k in props) err.push(...schemaErrors(props[k], value[k], root, `${path}/${k}`));
      else if (schema.additionalProperties === false) err.push(`${path || '/'}: unexpected property "${k}"`);
    }
  }
  return err;
}
