// node --experimental-strip-types src/components/editor/markdown-paste.test.mjs
import assert from "node:assert/strict";
import { looksLikeMarkdown, markdownToHtml, inlineMd } from "./markdown-paste.ts";

assert.equal(looksLikeMarkdown("just a sentence, nothing special."), false);
assert.equal(looksLikeMarkdown("price is 5 * 3 = 15"), false);
assert.equal(looksLikeMarkdown("# Heading"), true);
assert.equal(looksLikeMarkdown("- item"), true);
assert.equal(looksLikeMarkdown("1. step"), true);
assert.equal(looksLikeMarkdown("some **bold** text"), true);
assert.equal(looksLikeMarkdown("see [docs](https://x.id/a)"), true);

assert.equal(markdownToHtml("# MD heading"), "<h1>MD heading</h1>");
assert.equal(markdownToHtml("#### deep"), "<h3>deep</h3>");
assert.equal(markdownToHtml("- a\n- b"), "<ul><li><p>a</p></li><li><p>b</p></li></ul>");
assert.equal(markdownToHtml("1. x\n2. y"), "<ol><li><p>x</p></li><li><p>y</p></li></ol>");
assert.equal(markdownToHtml("- [ ] todo\n- [x] done"), '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo</p></li><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>');
assert.equal(markdownToHtml("> quoted"), "<blockquote><p>quoted</p></blockquote>");
assert.equal(markdownToHtml("---"), "<hr>");
assert.equal(markdownToHtml("```js\nconst a = 1 < 2;\n```"), '<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>');
assert.equal(markdownToHtml("line one\nline two\n\nnext"), "<p>line one<br>line two</p><p>next</p>");
assert.equal(inlineMd("**b** *i* `c*d*` ~~s~~ [l](https://a.b)"), '<strong>b</strong> <em>i</em> <code>c*d*</code> <s>s</s> <a href="https://a.b">l</a>');
assert.equal(inlineMd("<script>"), "&lt;script&gt;");
assert.equal(inlineMd("snake_case_name stays"), "snake_case_name stays");
assert.equal(markdownToHtml("# T\n- a\nplain"), "<h1>T</h1><ul><li><p>a</p></li></ul><p>plain</p>");
console.log("markdown-paste: ok");
