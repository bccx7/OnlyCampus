import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderArticle} from '../frontend/src/articleMarkdown.js';

test('duplicate and formatted headings produce unique anchors and valid inline markup',()=>{
  const {html,headings}=renderArticle('## 同名标题\n正文\n## 同名标题\n### **重点**与[链接](https://example.com)');
  assert.equal(headings.length,3);
  assert.equal(new Set(headings.map(h=>h.id)).size,3);
  assert.ok(html.includes('<strong>重点</strong>'));
  assert.ok(!/<h[23][^>]*><p>/.test(html));
});
test('raw scripts, image handlers and unsafe Markdown links cannot execute',()=>{
  const {html}=renderArticle('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n![图片](https://example.com/a.png)');
  assert.ok(!/javascript:|onerror|<script/i.test(html));
  assert.ok(html.includes('https://example.com/a.png'));
});
test('short text and headings absent remain readable',()=>{
  const result=renderArticle('一篇短文。');assert.equal(result.headings.length,0);assert.ok(result.html.includes('一篇短文。'));
});
