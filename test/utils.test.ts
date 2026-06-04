import { describe, it, expect } from 'vitest';
import { SaltIdsHelper } from '../src/utils';

describe('SaltIdsHelper', () => {
  const SALT_LEN = 4;
  const SALT_LEN_3 = 3;

  describe('encode', () => {
    it('should encode positive id: sign(id) * (abs(id) * 10^saltLen + salt)', () => {
      expect(SaltIdsHelper.encode(5, 1234, SALT_LEN)).toBe(51234);
      expect(SaltIdsHelper.encode(50, 1234, SALT_LEN)).toBe(501234);
      expect(SaltIdsHelper.encode(1, 582, SALT_LEN_3)).toBe(1582);
      expect(SaltIdsHelper.encode(99, 0, SALT_LEN)).toBe(990000);
    });

    it('should encode negative id preserving sign', () => {
      expect(SaltIdsHelper.encode(-5, 1234, SALT_LEN)).toBe(-51234);
      expect(SaltIdsHelper.encode(-50, 1234, SALT_LEN)).toBe(-501234);
      expect(SaltIdsHelper.encode(-1, 582, SALT_LEN_3)).toBe(-1582);
    });

    it('should encode with salt=0 (minimum salt)', () => {
      expect(SaltIdsHelper.encode(5, 0, SALT_LEN)).toBe(50000);
      expect(SaltIdsHelper.encode(1, 0, SALT_LEN_3)).toBe(1000);
    });

    it('should encode with maximum salt (10^saltLen - 1)', () => {
      expect(SaltIdsHelper.encode(5, 9999, SALT_LEN)).toBe(59999);
      expect(SaltIdsHelper.encode(1, 999, SALT_LEN_3)).toBe(1999);
    });

    it('should encode id=0 without ambiguity: encode(0,salt,len) = salt', () => {
      expect(SaltIdsHelper.encode(0, 1234, SALT_LEN)).toBe(1234);
      expect(SaltIdsHelper.encode(0, 0, SALT_LEN)).toBe(0);
      expect(SaltIdsHelper.encode(0, 999, SALT_LEN_3)).toBe(999);
    });

    it('should throw if salt is negative', () => {
      expect(() => SaltIdsHelper.encode(5, -1, SALT_LEN)).toThrow();
    });

    it('should throw if salt >= 10^saltLen', () => {
      expect(() => SaltIdsHelper.encode(5, 10000, SALT_LEN)).toThrow();
      expect(() => SaltIdsHelper.encode(5, 1000, SALT_LEN_3)).toThrow();
    });

    it('should return NaN for non-integer realId', () => {
      expect(SaltIdsHelper.encode(1.5, 1234, SALT_LEN)).toBeNaN();
      expect(SaltIdsHelper.encode(NaN, 1234, SALT_LEN)).toBeNaN();
      expect(SaltIdsHelper.encode(Infinity, 1234, SALT_LEN)).toBeNaN();
    });

    it('should return NaN for non-integer salt', () => {
      expect(SaltIdsHelper.encode(5, 1.5, SALT_LEN)).toBeNaN();
      expect(SaltIdsHelper.encode(5, NaN, SALT_LEN)).toBeNaN();
    });
  });

  describe('decode', () => {
    it('should decode positive saltid via pure arithmetic: salt = abs(pid) % 10^saltLen, id = floor(abs(pid) / 10^saltLen)', () => {
      expect(SaltIdsHelper.decode(51234, SALT_LEN)).toEqual({ id: 5, salt: 1234 });
      expect(SaltIdsHelper.decode(501234, SALT_LEN)).toEqual({ id: 50, salt: 1234 });
      expect(SaltIdsHelper.decode(1582, SALT_LEN_3)).toEqual({ id: 1, salt: 582 });
    });

    it('should decode negative saltid preserving sign', () => {
      expect(SaltIdsHelper.decode(-51234, SALT_LEN)).toEqual({ id: -5, salt: 1234 });
      expect(SaltIdsHelper.decode(-501234, SALT_LEN)).toEqual({ id: -50, salt: 1234 });
    });

    it('should decode saltid with salt=0', () => {
      expect(SaltIdsHelper.decode(50000, SALT_LEN)).toEqual({ id: 5, salt: 0 });
      expect(SaltIdsHelper.decode(1000, SALT_LEN_3)).toEqual({ id: 1, salt: 0 });
    });

    it('should decode saltid with maximum salt', () => {
      expect(SaltIdsHelper.decode(59999, SALT_LEN)).toEqual({ id: 5, salt: 9999 });
    });

    it('should decode id=0 saltid: decode(1234,4) = {id:0, salt:1234}', () => {
      expect(SaltIdsHelper.decode(1234, SALT_LEN)).toEqual({ id: 0, salt: 1234 });
      expect(SaltIdsHelper.decode(999, SALT_LEN_3)).toEqual({ id: 0, salt: 999 });
    });

    it('should decode 0 as {id:0, salt:0}', () => {
      expect(SaltIdsHelper.decode(0, SALT_LEN)).toEqual({ id: 0, salt: 0 });
    });

    it('should return {} for invalid negative saltIds (abs < 10^saltLen)', () => {
      // [-9999, -1] with saltLen=4 are invalid: encode(0, salt, 4) is always >= 0
      expect(SaltIdsHelper.decode(-1, SALT_LEN)).toEqual({});
      expect(SaltIdsHelper.decode(-9999, SALT_LEN)).toEqual({});
      expect(SaltIdsHelper.decode(-5000, SALT_LEN)).toEqual({});
      expect(SaltIdsHelper.decode(-1, SALT_LEN_3)).toEqual({});
      expect(SaltIdsHelper.decode(-999, SALT_LEN_3)).toEqual({});
    });

    it('should return {} for non-integer pid', () => {
      expect(SaltIdsHelper.decode(1.5, SALT_LEN)).toEqual({});
      expect(SaltIdsHelper.decode(NaN, SALT_LEN)).toEqual({});
      expect(SaltIdsHelper.decode(Infinity, SALT_LEN)).toEqual({});
    });
  });

  describe('round-trip: encode → decode', () => {
    it('should preserve original id and salt for all valid combinations', () => {
      const cases = [
        { id: 0, salt: 0, saltLen: 4 },
        { id: 0, salt: 1234, saltLen: 4 },
        { id: 1, salt: 0, saltLen: 4 },
        { id: 1, salt: 9999, saltLen: 4 },
        { id: 42, salt: 5678, saltLen: 4 },
        { id: -42, salt: 5678, saltLen: 4 },
        { id: 999, salt: 123, saltLen: 3 },
        { id: -999, salt: 0, saltLen: 3 },
        { id: 1, salt: 999, saltLen: 3 },
        { id: 12345, salt: 0, saltLen: 4 },
        { id: 12345, salt: 9999, saltLen: 4 },
      ];
      for (const { id, salt, saltLen } of cases) {
        const encoded = SaltIdsHelper.encode(id, salt, saltLen);
        const decoded = SaltIdsHelper.decode(encoded, saltLen);
        expect(decoded).toEqual({ id, salt });
      }
    });
  });

  describe('isPotentialSaltId', () => {
    it('should return true for valid saltIds', () => {
      expect(SaltIdsHelper.isPotentialSaltId(0, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(1, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(9999, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(10000, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(51234, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(-51234, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(0, SALT_LEN_3)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(999, SALT_LEN_3)).toBe(true);
    });

    it('should return false for invalid negative range [-9999, -1] when saltLen=4', () => {
      // These values cannot be produced by encode: encode(0, salt, 4) is always >= 0
      // decode(-1, 4) would give {id:0, salt:1} colliding with decode(1, 4)
      expect(SaltIdsHelper.isPotentialSaltId(-1, SALT_LEN)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(-9999, SALT_LEN)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(-5000, SALT_LEN)).toBe(false);
    });

    it('should return false for invalid negative range [-999, -1] when saltLen=3', () => {
      expect(SaltIdsHelper.isPotentialSaltId(-1, SALT_LEN_3)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(-999, SALT_LEN_3)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(-500, SALT_LEN_3)).toBe(false);
    });

    it('should return true for valid negative saltIds (abs >= 10^saltLen)', () => {
      expect(SaltIdsHelper.isPotentialSaltId(-10000, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(-51234, SALT_LEN)).toBe(true);
      expect(SaltIdsHelper.isPotentialSaltId(-1000, SALT_LEN_3)).toBe(true);
    });

    it('should return false for non-integer inputs', () => {
      expect(SaltIdsHelper.isPotentialSaltId(1.5, SALT_LEN)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(NaN, SALT_LEN)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(Infinity, SALT_LEN)).toBe(false);
      expect(SaltIdsHelper.isPotentialSaltId(-Infinity, SALT_LEN)).toBe(false);
    });
  });

  describe('generateSalt', () => {
    it('should generate salt in range [0, 10^saltLen - 1]', () => {
      for (let i = 0; i < 200; i++) {
        const salt = SaltIdsHelper.generateSalt(SALT_LEN);
        expect(salt).toBeGreaterThanOrEqual(0);
        expect(salt).toBeLessThanOrEqual(9999);
      }
    });

    it('should generate salt in range [0, 999] for saltLen=3', () => {
      for (let i = 0; i < 200; i++) {
        const salt = SaltIdsHelper.generateSalt(SALT_LEN_3);
        expect(salt).toBeGreaterThanOrEqual(0);
        expect(salt).toBeLessThanOrEqual(999);
      }
    });

    it('should produce diverse values including 0 (statistical check)', () => {
            const salts = new Set<number>();
            for (let i = 0; i < 5000; i++) {
                salts.add(SaltIdsHelper.generateSalt(SALT_LEN_3));
            }
            expect(salts.size).toBeGreaterThan(100);
            expect(salts.has(0)).toBe(true);
        });
  });
});
