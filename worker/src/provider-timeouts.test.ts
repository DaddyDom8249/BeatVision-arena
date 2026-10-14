// Regression: every Pixazo/Shotstack provider fetch must carry an abort signal
// so a hung provider cannot hold the Worker until the platform limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['shotstack-gateway.ts', 'pixazo-media-gateway-fixed.ts', 'arena-entry.ts']) {
  test(`${file}: provider fetch calls are bounded by AbortSignal.timeout`, async () => {
    const src = await readFile(new URL('./' + file, import.meta.url), 'utf8');
    const calls = [...src.matchAll(/await fetch\((`\$\{(?:BASE|STATUS)\}[^`]*`|signed)/g)];
    assert.ok(calls.length > 0, 'expected provider fetch calls');
    for (const m of calls) {
      const window = src.slice(m.index!, m.index! + 700);
      assert.match(window, /signal\s*:/, `unbounded provider fetch in ${file}: ${m[0]}`);
    }
  });
}

test('shotstack assemble errors do not return raw provider bodies', async () => {
  const src = await readFile(new URL('./shotstack-gateway.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /provider_response:providerResponse/);
  assert.doesNotMatch(src, /error:msg\.slice\(0,2000\)/);
});
