
import { describe, it, expect } from 'vitest';
import { SaltIdsHelper } from '../src/utils';

describe('SaltIdsHelper', () => {
    const SALT_LEN = 4;

    it('should encode positive numbers correctly', () => {
        // salt=1234, id=5 -> 12345
        // salt has length 4. id has length 1.
        // Logic: 1234 * 10^1 + 5 = 12340 + 5 = 12345
        expect(SaltIdsHelper.encode(5, 1234, SALT_LEN)).toBe(12345);

        // salt=1234, id=50 -> 123450
        expect(SaltIdsHelper.encode(50, 1234, SALT_LEN)).toBe(123450);
    });

    it('should encode negative numbers correctly', () => {
        // salt=1234, id=-5 -> -12345
        expect(SaltIdsHelper.encode(-5, 1234, SALT_LEN)).toBe(-12345);

        // salt=1234, id=-50 -> -123450
        expect(SaltIdsHelper.encode(-50, 1234, SALT_LEN)).toBe(-123450);
    });

    it('should decode positive numbers correctly', () => {
        // 12345 (saltLen=4) -> salt=1234, id=5
        // 12345 has 5 digits. 5-4 = 1 digit for ID.
        const res1 = SaltIdsHelper.decode(12345, SALT_LEN);
        expect(res1).toEqual({ id: 5, salt: 1234 });

        // 123450 -> salt=1234, id=50
        const res2 = SaltIdsHelper.decode(123450, SALT_LEN);
        expect(res2).toEqual({ id: 50, salt: 1234 });
    });

    it('should decode negative numbers correctly', () => {
        // -12345 -> salt=1234, id=-5
        const res1 = SaltIdsHelper.decode(-12345, SALT_LEN);
        expect(res1).toEqual({ id: -5, salt: 1234 });

        // -123450 -> salt=1234, id=-50
        const res2 = SaltIdsHelper.decode(-123450, SALT_LEN);
        expect(res2).toEqual({ id: -50, salt: 1234 });
    });

    it('should handle zero correctly', () => {
        // id=0, salt=1234 -> 12340
        expect(SaltIdsHelper.encode(0, 1234, SALT_LEN)).toBe(12340);
        expect(SaltIdsHelper.decode(12340, SALT_LEN)).toEqual({ id: 0, salt: 1234 });
    });
});
