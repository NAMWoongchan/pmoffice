import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),fromVitepress=createRequire(require.resolve('vitepress')),fromVite=createRequire(fromVitepress.resolve('vite'));
const postcss=fromVite('postcss');
export function scopeEbookCss(source){
 const root=postcss.parse(source),scope='.pmoffice-ebook-service';
 root.walkRules(rule=>{
  for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&/keyframes$/i.test(parent.name))return;
  rule.selectors=rule.selectors.map(selector=>selector===':root'||selector==='body'||selector==='html'?scope:`${scope} ${selector}`);
 });
 return root.toString();
}
