import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from '../src/components/Markdown';
test('Markdown blocks active HTML, script URLs, remote-image tracking and preserves code', () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        '<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n![tracking](https://example.test/track)\n\n```js\nconst value = 1;\n```'
      }
    />,
  );
  assert.doesNotMatch(html, /<script|href="javascript:|<img/i);
  assert.match(html, /<pre>/);
  assert.match(html, /const/);
});
