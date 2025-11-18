// Deno-friendly test/assert shim to replace node:test + node:assert.
import {
  assert as assertOk,
  assertEquals,
  assertMatch,
  assertStrictEquals,
  assertThrows
} from 'https://deno.land/std/assert/mod.ts';

export const assert = {
  ok: assertOk,
  equal: assertStrictEquals,
  deepEqual: assertEquals,
  match: assertMatch,
  throws: assertThrows
};

export function test(name, fn) {
  Deno.test(name, async (_t) => {
    const cleanups = [];
    const ctx = {
      after(cb) {
        cleanups.push(cb);
      }
    };
    try {
      const result = fn(ctx);
      if (result && typeof result.then === 'function') {
        await result;
      }
    } finally {
      for (const cb of cleanups.reverse()) {
        await cb();
      }
    }
  });
}
