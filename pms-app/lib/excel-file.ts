/** File metadata is untrusted, including names from previous uploaded versions. */
export function excelFile(name='project.xlsm'){
 let decoded=name;try{decoded=decodeURIComponent(name);}catch{}
 const clean=decoded.replace(/[\r\n\x00-\x1f\x7f]/g,'').split(/[\\/]/).at(-1)||'project.xlsm';
 if(!/\.(xlsx|xlsm)$/i.test(clean))return null;
 const macro=/\.xlsm$/i.test(clean);
 return {name:clean,encoded:encodeURIComponent(clean),extension:macro?'xlsm':'xlsx',type:macro?'application/vnd.ms-excel.sheet.macroEnabled.12':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
}
