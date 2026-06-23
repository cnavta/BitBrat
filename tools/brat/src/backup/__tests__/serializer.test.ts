import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import {
  encodeValue,
  decodeValue,
  encodeDocumentData,
  decodeDocumentData,
  TYPE_KEY,
  ESCAPE_KEY,
} from '../serializer';

/**
 * Minimal fake Firestore that only supports `.doc(path)` so DocumentReference values can be
 * reconstructed on decode without a live connection / emulator. The returned object duck-types
 * as a DocumentReference for the encoder (path/firestore/id/collection).
 */
function makeFakeDb(): any {
  const db: any = {
    doc: (path: string) => ({
      path,
      id: path.split('/').pop(),
      firestore: db,
      collection: () => ({}),
    }),
  };
  return db;
}

describe('typed value serializer round-trip (Gate G1)', () => {
  const db = makeFakeDb();

  it('round-trips a Timestamp losslessly', () => {
    const ts = Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));
    const encoded = encodeValue(ts) as any;
    expect(encoded).toEqual({ [TYPE_KEY]: 'timestamp', value: '2026-01-01T00:00:00.000Z' });
    const decoded = decodeValue(encoded, db) as Timestamp;
    expect(decoded).toBeInstanceOf(Timestamp);
    expect(decoded.toDate().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('round-trips a Date as a timestamp', () => {
    const d = new Date('2025-06-15T12:30:00.000Z');
    const decoded = decodeValue(encodeValue(d) as any, db) as Timestamp;
    expect(decoded).toBeInstanceOf(Timestamp);
    expect(decoded.toDate().toISOString()).toBe('2025-06-15T12:30:00.000Z');
  });

  it('round-trips a GeoPoint losslessly', () => {
    const gp = new GeoPoint(37.422, -122.084);
    const encoded = encodeValue(gp) as any;
    expect(encoded).toEqual({ [TYPE_KEY]: 'geopoint', latitude: 37.422, longitude: -122.084 });
    const decoded = decodeValue(encoded, db) as GeoPoint;
    expect(decoded).toBeInstanceOf(GeoPoint);
    expect(decoded.latitude).toBe(37.422);
    expect(decoded.longitude).toBe(-122.084);
  });

  it('round-trips a DocumentReference via its path', () => {
    const ref = db.doc('users/abc');
    const encoded = encodeValue(ref) as any;
    expect(encoded).toEqual({ [TYPE_KEY]: 'ref', path: 'users/abc' });
    const decoded = decodeValue(encoded, db) as any;
    expect(decoded.path).toBe('users/abc');
  });

  it('throws decoding a ref without a Firestore instance', () => {
    expect(() => decodeValue({ [TYPE_KEY]: 'ref', path: 'users/abc' } as any)).toThrow();
  });

  it('round-trips Bytes (Buffer) via base64', () => {
    const bytes = Buffer.from('hello world', 'utf8');
    const encoded = encodeValue(bytes) as any;
    expect(encoded[TYPE_KEY]).toBe('bytes');
    const decoded = decodeValue(encoded, db) as Buffer;
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect(decoded.toString('utf8')).toBe('hello world');
  });

  it('round-trips nested maps and arrays preserving primitives', () => {
    const data = {
      name: 'vip-greeting',
      enabled: true,
      count: 42,
      ratio: 3.14,
      nothing: null,
      tags: ['a', 'b', 'c'],
      createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
      nested: {
        location: new GeoPoint(1, 2),
        list: [{ k: 1 }, { k: 2, when: new Date('2024-01-01T00:00:00.000Z') }],
      },
    };
    const encoded = encodeDocumentData(data);
    const decoded = decodeDocumentData(encoded, db) as any;

    expect(decoded.name).toBe('vip-greeting');
    expect(decoded.enabled).toBe(true);
    expect(decoded.count).toBe(42);
    expect(decoded.ratio).toBe(3.14);
    expect(decoded.nothing).toBeNull();
    expect(decoded.tags).toEqual(['a', 'b', 'c']);
    expect(decoded.createdAt).toBeInstanceOf(Timestamp);
    expect(decoded.nested.location).toBeInstanceOf(GeoPoint);
    expect(decoded.nested.list[1].when).toBeInstanceOf(Timestamp);
    expect((decoded.nested.list[1].when as Timestamp).toDate().toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('strips undefined keys (consistent with stripUndefinedDeep)', () => {
    const data = { a: 1, b: undefined, c: { d: undefined, e: 'x' } };
    const encoded = encodeDocumentData(data as any);
    expect(encoded).toEqual({ a: 1, c: { e: 'x' } });
    expect(Object.prototype.hasOwnProperty.call(encoded, 'b')).toBe(false);
  });

  it('escapes a literal user map containing a reserved __type key', () => {
    const data = { meta: { [TYPE_KEY]: 'not-a-real-type', payload: 'literal' } };
    const encoded = encodeDocumentData(data);
    // The inner literal map must be wrapped so it is not mistaken for a typed value.
    expect((encoded.meta as any)[ESCAPE_KEY]).toBe(true);
    const decoded = decodeDocumentData(encoded, db) as any;
    expect(decoded.meta).toEqual({ [TYPE_KEY]: 'not-a-real-type', payload: 'literal' });
  });

  it('escapes a literal user map containing a reserved __escaped key', () => {
    const data = { meta: { [ESCAPE_KEY]: true, value: 'literal' } };
    const encoded = encodeDocumentData(data);
    const decoded = decodeDocumentData(encoded, db) as any;
    expect(decoded.meta).toEqual({ [ESCAPE_KEY]: true, value: 'literal' });
  });

  it('round-trips through JSON.stringify/parse (the on-disk envelope path)', () => {
    const data = {
      createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
      ref: db.doc('configs/routingRules/rules/rule-1'),
      blob: Buffer.from([1, 2, 3, 4]),
      nested: { geo: new GeoPoint(10, 20), arr: [1, 'two', false, null] },
    };
    const json = JSON.stringify(encodeDocumentData(data));
    const decoded = decodeDocumentData(JSON.parse(json), db) as any;
    expect(decoded.createdAt).toBeInstanceOf(Timestamp);
    expect(decoded.ref.path).toBe('configs/routingRules/rules/rule-1');
    expect(Buffer.isBuffer(decoded.blob)).toBe(true);
    expect(Array.from(decoded.blob as Buffer)).toEqual([1, 2, 3, 4]);
    expect(decoded.nested.geo).toBeInstanceOf(GeoPoint);
    expect(decoded.nested.arr).toEqual([1, 'two', false, null]);
  });
});
