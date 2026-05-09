import * as assert from 'node:assert';
import { redactSecrets } from '../../src/util/logger';

suite('logger — secret redaction', () => {
  test('redacts canonical secret keys in JSON', () => {
    const input = JSON.stringify({
      authorization: 'Bearer abc123',
      api_key: 'sk-foobar',
      apiKey: 'k_abc',
      token: 'plaintext',
      Password: 'hunter2',
      secret: 'shh',
      bearer: 'xxx',
      keepMe: 'visible',
    });
    const out = redactSecrets(input);
    assert.match(out, /"authorization"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"api_key"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"token"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"Password"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"secret"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"bearer"\s*:\s*"\[redacted\]"/i);
    assert.match(out, /"keepMe":"visible"/);
  });

  test('redacts inline Authorization: Bearer headers in free-form strings', () => {
    const input = 'GET /flows HTTP/1.1\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y\n';
    const out = redactSecrets(input);
    assert.ok(/Bearer \[redacted\]/i.test(out), `expected Bearer redaction, got: ${out}`);
  });

  test('redacts unwrapped sk- tokens', () => {
    const input = 'failed: sk-1234567890abcdefghij invalid';
    const out = redactSecrets(input);
    assert.match(out, /sk-\[redacted\]/);
  });

  test('non-secret values pass through untouched', () => {
    const input = JSON.stringify({ flowId: 'abc', nodeCount: 5 });
    assert.equal(redactSecrets(input), input);
  });
});
