import { Timestamp, GeoPoint, Firestore, DocumentReference } from 'firebase-admin/firestore';

/**
 * Typed-wrapper JSON serializer for Firestore-native values (Technical Architecture §5.2).
 *
 * `JSON.stringify` cannot represent Firestore-native types (Timestamp, GeoPoint,
 * DocumentReference, Bytes). This module encodes them into a small, self-describing
 * `{ "__type": ... }` wrapper convention so that an export -> import cycle is lossless.
 *
 * The `__type` key is reserved. A literal user map that legitimately contains a `__type` key is
 * escaped on encode (wrapped as `{ "__escaped": true, value: {...} }`) and unwrapped on decode so
 * it cannot be mistaken for a typed wrapper. `undefined` is stripped (consistent with
 * `stripUndefinedDeep` in src/services/persistence/model.ts and `ignoreUndefinedProperties`).
 */

export const TYPE_KEY = '__type';
export const ESCAPE_KEY = '__escaped';

export type EncodedValue =
  | null
  | number
  | string
  | boolean
  | EncodedValue[]
  | { [key: string]: EncodedValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isTimestamp(value: any): value is Timestamp {
  return value instanceof Timestamp ||
    (value && typeof value.toDate === 'function' && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number');
}

function isGeoPoint(value: any): value is GeoPoint {
  return value instanceof GeoPoint ||
    (value && value.constructor && value.constructor.name === 'GeoPoint' &&
      typeof value.latitude === 'number' && typeof value.longitude === 'number');
}

function isDocumentReference(value: any): value is DocumentReference {
  return value instanceof DocumentReference ||
    (value && typeof value.path === 'string' && value.firestore && typeof value.id === 'string' && typeof value.collection === 'function');
}

function isBytes(value: any): value is Uint8Array {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

/**
 * Recursively encode a Firestore value (a document's `data()` or any nested value) into the typed
 * JSON wrapper convention. Returns `undefined` for `undefined` input so callers can strip it.
 */
export function encodeValue(value: unknown): EncodedValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (isTimestamp(value)) {
    return { [TYPE_KEY]: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value instanceof Date) {
    return { [TYPE_KEY]: 'timestamp', value: value.toISOString() };
  }
  if (isGeoPoint(value)) {
    return { [TYPE_KEY]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (isDocumentReference(value)) {
    return { [TYPE_KEY]: 'ref', path: value.path };
  }
  if (isBytes(value)) {
    return { [TYPE_KEY]: 'bytes', value: Buffer.from(value).toString('base64') };
  }

  if (Array.isArray(value)) {
    return value.map((v) => {
      const encoded = encodeValue(v);
      // Firestore arrays cannot contain undefined; treat as null to preserve positions.
      return encoded === undefined ? null : encoded;
    });
  }

  if (isPlainObject(value)) {
    // A literal user map that contains a reserved key (`__type` or `__escaped`) would be
    // indistinguishable from a typed/escaped wrapper, so wrap it explicitly:
    //   { "__escaped": true, "value": { ...encoded entries... } }
    const needsEscape = Object.prototype.hasOwnProperty.call(value, TYPE_KEY) ||
      Object.prototype.hasOwnProperty.call(value, ESCAPE_KEY);
    const inner: Record<string, EncodedValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const encoded = encodeValue(v);
      if (encoded !== undefined) inner[k] = encoded;
    }
    return needsEscape ? { [ESCAPE_KEY]: true, value: inner } : inner;
  }

  // Primitive number/string/boolean.
  return value as EncodedValue;
}

/**
 * Recursively decode a typed-wrapper JSON value back into a Firestore-native value.
 * A Firestore instance is required to reconstruct DocumentReferences (`db.doc(path)`).
 */
export function decodeValue(value: EncodedValue | undefined, db?: Firestore): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value.map((v) => decodeValue(v, db));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, EncodedValue>;

    // Escaped literal map: unwrap and decode its inner contents (which may contain a real __type key).
    if (obj[ESCAPE_KEY] === true && isPlainObject(obj.value)) {
      const inner = obj.value as Record<string, EncodedValue>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inner)) out[k] = decodeValue(v, db);
      return out;
    }

    const type = obj[TYPE_KEY];
    if (typeof type === 'string') {
      switch (type) {
        case 'timestamp':
          return Timestamp.fromDate(new Date(String(obj.value)));
        case 'geopoint':
          return new GeoPoint(Number(obj.latitude), Number(obj.longitude));
        case 'ref':
          if (!db) throw new Error(`Cannot decode DocumentReference '${String(obj.path)}' without a Firestore instance`);
          return db.doc(String(obj.path));
        case 'bytes':
          return Buffer.from(String(obj.value), 'base64');
        default:
          throw new Error(`Unknown encoded __type: '${type}'`);
      }
    }

    // Ordinary nested map.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decodeValue(v, db);
    return out;
  }

  return value;
}

/**
 * Encode a whole document's data map. Always returns a plain object (never undefined).
 */
export function encodeDocumentData(data: Record<string, unknown>): Record<string, EncodedValue> {
  const encoded = encodeValue(data);
  return (encoded && typeof encoded === 'object' && !Array.isArray(encoded))
    ? (encoded as Record<string, EncodedValue>)
    : {};
}

/**
 * Decode a whole document's data map back into Firestore-native values.
 */
export function decodeDocumentData(data: Record<string, EncodedValue>, db?: Firestore): Record<string, unknown> {
  return decodeValue(data, db) as Record<string, unknown>;
}
