import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderArticle(markdown='') {
  const headings=[],counts=new Map(),renderer=new marked.Renderer();
  renderer.html=()=>'';
  renderer.heading=function({tokens,depth}) {
    const text=tokens.map(token=>token.text||'').join('');
    const key=text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-')||'section';
    const count=(counts.get(key)||0)+1;counts.set(key,count);
    const id=`h-${key}-${count}`;
    if(depth===2||depth===3) headings.push({id,text,depth});
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`;
  };
  const html=sanitizeHtml(marked.parse(markdown,{renderer}),{
    allowedTags:sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes:{...sanitizeHtml.defaults.allowedAttributes,h2:['id'],h3:['id'],img:['src','alt']},
    allowedSchemes:['http','https','mailto']
  });
  return {html,headings};
}
