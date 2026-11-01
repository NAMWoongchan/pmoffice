import MarkdownIt from './vendor/markdown-it.mjs'
const markdown=new MarkdownIt({html:false,breaks:true,linkify:false,typographer:false})
// Descriptions may contain links, but never load remote images automatically.
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'')
const linkOpen=markdown.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options))
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return linkOpen(tokens,index,options,env,self)}
export const renderProjectMarkdown=value=>markdown.render(String(value||''))
