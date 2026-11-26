/* ================= مختبر السوفت (firmware lab) ================= */
/* Loaded after the main script. Uses $, esc, toast, downloadBlob, openModal, currentPath, render. */
const LAB = {
  buf:null, orig:null, name:'', type:'', typeLabel:'',
  ops:[], errors:[], media:[], headerLock:64, unlocked:false,
  page:0, pageSize:256,
  sql:null, sqlDb:null, sqlTables:[], sqlTable:'', sqlCols:[], sqlRows:[], sqlOffset:0, sqlLimit:200, sqlSearch:'', favOnly:false
};
const LAB_TYPES = {
  sqlite:  'قاعدة بيانات SQLite (ملف قنوات/سوفت .db)',
  gx6605:  'سوفت GX6605 / National Chip (.bin)',
  ali:     'سوفت Ali (.abs)',
  trumandb:'قاعدة بيانات قنوات TRUMAN (.bin ترفع بالUSB)',
  bin:     'ملف ثنائي غير معروف'
};
function labCRC32(u8){
  let t=labCRC32.t;
  if(!t){ t=labCRC32.t=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?(0xEDB88320^(c>>>1)):c>>>1; t[n]=c>>>0; } }
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c=t[(c^u8[i])&0xFF]^(c>>>8);
  return ((c^0xFFFFFFFF)>>>0).toString(16).toUpperCase().padStart(8,'0');
}
function labDetect(u8){
  let head='';
  for(let i=0;i<Math.min(16,u8.length);i++) head+=String.fromCharCode(u8[i]);
  if(head.indexOf('SQLite format 3')===0) return 'sqlite';
  let s='';
  const lim=Math.min(u8.length,2*1024*1024);
  for(let i=0;i<lim;i+=4096){
    let chunk='';
    for(let j=i;j<Math.min(i+4096,lim);j++){ const b=u8[j]; chunk+=(b>=32&&b<127)?String.fromCharCode(b):' '; }
    s+=chunk;
  }
  if(s.indexOf('*^_^*DB')>=0) return 'trumandb';
  if(s.indexOf('chipid=0x6605')>=0||s.indexOf('GxLoader')>=0) return 'gx6605';
  if(s.indexOf('ALIOSDRSC')>=0) return 'ali';
  return 'bin';
}
function labScanMedia(u8){
  const out=[];
  for(let i=0;i<u8.length-4;i++){
    if(u8[i]===0xFF&&u8[i+1]===0xD8&&u8[i+2]===0xFF){
      let end=-1;
      for(let j=i+3;j<u8.length-1;j++){ if(u8[j]===0xFF&&u8[j+1]===0xD9){ end=j+2; break; } }
      if(end>0&&end-i>=200){ out.push({kind:'JPEG',off:i,len:end-i}); i=end-1; }
    }else if(u8[i]===0x89&&u8[i+1]===0x50&&u8[i+2]===0x4E&&u8[i+3]===0x47&&u8[i+4]===0x0D&&u8[i+5]===0x0A&&u8[i+6]===0x1A&&u8[i+7]===0x0A){
      let end=-1;
      for(let j=i+8;j<u8.length-8;j++){
        if(u8[j]===0x49&&u8[j+1]===0x45&&u8[j+2]===0x4E&&u8[j+3]===0x44&&u8[j+4]===0xAE&&u8[j+5]===0x42&&u8[j+6]===0x60&&u8[j+7]===0x82){ end=j+8; break; }
      }
      if(end>0){ out.push({kind:'PNG',off:i,len:end-i}); i=end-1; }
    }else if(u8[i]===0x42&&u8[i+1]===0x4D&&i+6<u8.length){
      const sz=u8[i+2]|(u8[i+3]<<8)|(u8[i+4]<<16)|(u8[i+5]<<24);
      if(sz>=200&&i+sz<=u8.length){ out.push({kind:'BMP',off:i,len:sz}); i+=sz-1; }
    }
  }
  return out;
}
function labCur(){ if(LAB.sqlDb){ try{ return LAB.sqlDb.export(); }catch(e){} } return LAB.buf; }
function labFmt(n){ return n.toLocaleString('en-US')+' بايت'; }
function labHex(n){ return '0x'+n.toString(16).toUpperCase().padStart(8,'0'); }
function labPushOp(desc, inverse){ LAB.ops.push({desc, inverse, at:new Date().toLocaleTimeString('ar-EG')}); }
function labAddErr(level,msg,fix){ LAB.errors.push({level,msg,fix}); }
function labReset(){
  LAB.buf=null; LAB.orig=null; LAB.name=''; LAB.type=''; LAB.ops=[]; LAB.errors=[]; LAB.media=[];
  LAB.page=0; LAB.unlocked=false;
  if(LAB.sqlDb){ try{LAB.sqlDb.close();}catch(e){} }
  LAB.sqlDb=null; LAB.sqlTables=[]; LAB.sqlTable=''; LAB.sqlRows=[]; LAB.sqlOffset=0; LAB.sqlSearch=''; LAB.favOnly=false; LAB.grpView=null; LAB.arabize=null; LAB.selection=new Set(); LAB.selAnchor=null;
}
async function labLoadFile(file){
  labReset();
  const u8=new Uint8Array(await file.arrayBuffer());
  LAB.orig=u8; LAB.buf=u8.slice(); LAB.name=file.name;
  LAB.type=labDetect(u8); LAB.typeLabel=LAB_TYPES[LAB.type]||LAB_TYPES.bin;
  LAB.media=(LAB.type==='sqlite')?[]:labScanMedia(LAB.buf);
  labAddErr('ok','تم فتح الملف. النسخة الأصلية محفوظة في الذاكرة ويمكن استرجاعها في أي وقت قبل التحميل.',null);
  if(LAB.type==='sqlite'){ await labSqlOpen(); }
  else if(LAB.type==='trumandb'||LAB.type==='bin'){
    labAddErr('warn','هذا النوع '+(LAB.type==='trumandb'?'(TRUMAN DB)':'')+' بنيته الداخلية غير موثقة عندنا، لذلك التعديل المتاح عليه هو الأدوات العامة فقط (عرض hex، استبدال نصوص بنفس الطول، استبدال صور) مع الفحص بعد كل خطوة. مفيش تعديل جداول مباشر عليه.',null);
  }
  if(LAB.type==='gx6605'||LAB.type==='ali'){
    labAddErr('warn','تنبيه مهم: سوفت الأجهزة داخلياً ليه checksums خاصة بالشركة مش موثقة عندنا. البرنامج بيعيد حساب CRC32 للملف كله ويتأكد إن البنية الأساسية سليمة، لكن الجهاز ممكن يرفض سوفت معدّل لو الشركة بتتحقق بطريقة إضافية. جرّب على نسخة وخلي عندك الأصل دائماً.',null);
  }
  render();
}
function labChecks(){
  if(!LAB.buf) return;
  const errs=[];
  if(LAB.buf.length!==LAB.orig.length) errs.push({level:'err',msg:'حجم الملف اتغير! ده خطر جداً. استخدم "استعادة الأصل" فوراً.',fix:'restore'});
  if(!LAB.unlocked){
    for(let i=0;i<Math.min(LAB.headerLock,LAB.buf.length);i++){
      if(LAB.buf[i]!==LAB.orig[i]){ errs.push({level:'err',msg:'أول '+LAB.headerLock+' بايت (الهيدر) اتعدلت والهيدر مقفول. استبدل أو تراجع عن العملية المخالفة.',fix:'undo'}); break; }
    }
  }
  const t2=labDetect(LAB.buf);
  if(t2!==LAB.type&&!(t2==='bin'&&LAB.type==='trumandb')) errs.push({level:'err',msg:'بصمة نوع الملف اتغيرت بعد التعديل ('+LAB.type+' ← '+t2+'). غالباً حصل تلف في البداية.',fix:'undo'});
  if(LAB.sqlDb){
    try{
      const r=LAB.sqlDb.exec('PRAGMA integrity_check');
      const v=r[0]&&r[0].values[0]&&r[0].values[0][0];
      if(v!=='ok') errs.push({level:'err',msg:'فحص سلامة قاعدة البيانات فشل: '+v,fix:'undo'});
    }catch(e){ errs.push({level:'err',msg:'قاعدة البيانات لم تعد تقرأ: '+e.message,fix:'undo'}); }
  }
  errs.push({level:'ok',msg:'CRC32 الحالي: '+labCRC32(labCur())+' (الأصل: '+labCRC32(LAB.orig)+')',fix:'static'});
  LAB.errors=errs;
}
/* ---------- editing operations ---------- */
function labStrToBytes(s, enc){
  const out=[];
  if(enc==='utf16'){ for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); out.push(c&0xFF,(c>>8)&0xFF); } }
  else { for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); out.push(c<256?c:0x3F); } }
  return out;
}
function labFindAll(buf, pat){
  const offs=[]; const n=pat.length; if(!n) return offs;
  outer: for(let i=0;i<=buf.length-n;i++){
    for(let j=0;j<n;j++) if(buf[i+j]!==pat[j]) continue outer;
    offs.push(i); if(offs.length>=5000) break;
  }
  return offs;
}
function labReplaceString(search, repl, enc){
  if(!LAB.buf) return;
  if(!search){ toast('اكتب النص القديم الأول'); return; }
  const a=labStrToBytes(search,enc), b=labStrToBytes(repl,enc);
  if(a.length!==b.length){ toast('النص الجديد لازم يكون نفس طول القديم بالظبط ('+a.length+' بايت)'); return; }
  const offs=labFindAll(LAB.buf,a);
  if(!offs.length){ toast('النص القديم مش موجود في الملف'); return; }
  const inv=[];
  for(const off of offs){
    inv.push({off, old:Array.from(LAB.buf.slice(off,off+a.length))});
    for(let j=0;j<b.length;j++) LAB.buf[off+j]=b[j];
  }
  labPushOp('استبدال نص "'+search+'" ← "'+repl+'" في '+offs.length+' مكان', {kind:'patches', patches:inv});
  labChecks(); render();
  toast('تم الاستبدال في '+offs.length+' مكان');
}
function labPatchBytes(offHex, hexStr){
  if(!LAB.buf) return;
  const off=parseInt(offHex,16);
  if(isNaN(off)||off<0||off>=LAB.buf.length){ toast('العنوان غير صحيح'); return; }
  const clean=hexStr.replace(/[^0-9a-fA-F]/g,'');
  if(!clean.length||clean.length%2){ toast('اكتب البايتات hex صحيحة (زوج أرقام لكل بايت)'); return; }
  const bytes=[]; for(let i=0;i<clean.length;i+=2) bytes.push(parseInt(clean.substr(i,2),16));
  if(off+bytes.length>LAB.buf.length){ toast('البايتات تعدّت نهاية الملف'); return; }
  const inv=[{off, old:Array.from(LAB.buf.slice(off,off+bytes.length))}];
  for(let j=0;j<bytes.length;j++) LAB.buf[off+j]=bytes[j];
  labPushOp('تعديل '+bytes.length+' بايت عند '+labHex(off), {kind:'patches', patches:inv});
  labChecks(); render();
  toast('تم التعديل');
}
async function labReplaceImage(idx, file){
  if(!LAB.buf) return;
  const m=LAB.media[idx]; if(!m) return;
  const u8=new Uint8Array(await file.arrayBuffer());
  if(u8.length>m.len){
    labChecks();
    LAB.errors.push({level:'err',msg:'الصورة الجديدة ('+u8.length+' بايت) أكبر من الأصلية ('+m.len+' بايت). صغّرها أو اضغطها وجرّب تاني.',fix:null});
    render(); toast('الصورة الجديدة أكبر من الأصلية'); return;
  }
  const inv=[{off:m.off, old:Array.from(LAB.buf.slice(m.off,m.off+u8.length))}];
  LAB.buf.set(u8,m.off);
  labPushOp('استبدال صورة '+m.kind+' عند '+labHex(m.off)+' (الجديدة '+u8.length+' بايت داخل مساحة '+m.len+')',{kind:'patches',patches:inv});
  labChecks(); render();
  toast('تم استبدال الصورة');
}
function labUndo(){
  const op=LAB.ops.pop();
  if(!op){ toast('مفيش عمليات للتراجع عنها'); return; }
  if(op.inverse&&op.inverse.kind==='patches'){
    for(const p of op.inverse.patches) for(let j=0;j<p.old.length;j++) LAB.buf[p.off+j]=p.old[j];
  }
  labChecks(); render();
  toast('تم التراجع عن: '+op.desc);
}
function labRestore(){
  if(!LAB.orig) return;
  LAB.buf=LAB.orig.slice(); LAB.ops=[]; LAB.unlocked=false;
  if(LAB.type==='sqlite'){ labSqlOpen().then(()=>{ labChecks(); render(); }); }
  else { labChecks(); render(); }
  toast('تمت استعادة النسخة الأصلية');
}
function labDownloadModified(){
  if(!LAB.buf) return;
  const u8=labCur();
  const dot=LAB.name.lastIndexOf('.');
  const base=dot>0?LAB.name.slice(0,dot):LAB.name, ext=dot>0?LAB.name.slice(dot):'';
  downloadBlob(new Blob([u8]), base+'_modified'+ext);
  toast('تم تحميل الملف المعدّل');
}
function labDownloadOriginal(){
  if(!LAB.orig) return;
  downloadBlob(new Blob([LAB.orig]), LAB.name);
}
function labDownloadReport(){
  if(!LAB.buf) return;
  const lines=[];
  lines.push('تقرير تعديل — مختبر السوفت | ابوجبل سات');
  lines.push('التاريخ: '+new Date().toLocaleString('ar-EG'));
  lines.push('الملف: '+LAB.name);
  lines.push('النوع: '+LAB.typeLabel);
  lines.push('الحجم: '+labFmt(LAB.orig.length)+' (لم يتغير: '+(LAB.buf.length===LAB.orig.length?'نعم':'لا')+')');
  lines.push('CRC32 الأصل: '+labCRC32(LAB.orig));
  lines.push('CRC32 المعدّل: '+labCRC32(labCur()));
  lines.push('');
  lines.push('العمليات ('+LAB.ops.length+'):');
  LAB.ops.forEach((o,i)=>lines.push((i+1)+'. ['+o.at+'] '+o.desc));
  lines.push('');
  lines.push('الفحوصات الحالية:');
  LAB.errors.forEach(e=>lines.push((e.level==='err'?'[خطأ] ':e.level==='warn'?'[تنبيه] ':'[سليم] ')+e.msg));
  downloadBlob(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),'تقرير-تعديل.txt');
}
/* ---------- SQLite channel-db editor ---------- */
async function labSqlInit(){
  if(LAB.sql) return LAB.sql;
  LAB.sql=await initSqlJs({ locateFile: f => 'vendor/'+f });
  return LAB.sql;
}
async function labSqlOpen(){
  try{
    await labSqlInit();
    if(LAB.sqlDb){ try{LAB.sqlDb.close();}catch(e){} }
    LAB.sqlDb=new LAB.sql.Database(LAB.buf);
    const r=LAB.sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    LAB.sqlTables=(r[0]?r[0].values.map(v=>v[0]):[]);
    LAB.sqlTable=LAB.sqlTables.indexOf('srv_table')>=0?'srv_table':(LAB.sqlTables[0]||'');
    labSqlLoadRows();
    labAddErr('ok','قاعدة البيانات اتفتحت: '+LAB.sqlTables.length+' جدول. التعديل المباشر متاح على خلايا النصوص (زي أسماء القنوات) مع فحص سلامة بعد كل تعديل.',null);
  }catch(e){
    LAB.sqlDb=null;
    labAddErr('err','فشل فتح قاعدة SQLite: '+e.message,null);
  }
}
function labSqlTableCount(t){
  try{ const r=LAB.sqlDb.exec('SELECT COUNT(*) FROM "'+t+'"'); return r[0].values[0][0]; }catch(e){ return '?'; }
}
function labSqlLoadRows(){
  LAB.sqlCols=[]; LAB.sqlRows=[];
  if(!LAB.sqlDb||!LAB.sqlTable) return;
  try{
    const info=LAB.sqlDb.exec('PRAGMA table_info("'+LAB.sqlTable+'")');
    LAB.sqlCols=info[0].values.map(v=>({name:v[1], type:String(v[2]||'').toUpperCase()}));
    const tcols=LAB.sqlCols.filter(c=>c.type.indexOf('CHAR')>=0||c.type.indexOf('TEXT')>=0);
    let where='';
    const conds=[];
    if(LAB.sqlSearch&&tcols.length){
      const q=LAB.sqlSearch.replace(/'/g,"''");
      conds.push('('+tcols.map(c=>'"'+c.name+'" LIKE \'%'+q+'%\'').join(' OR ')+')');
    }
    if(LAB.favOnly&&labHasFavCol()) conds.push('favor=1');
    if(LAB.grpView&&LAB.sqlCols.some(c=>/^db_id$/i.test(c.name))) conds.push('db_id IN (SELECT db_srv_id FROM grp_map_table WHERE db_grp_id='+LAB.grpView+')');
    if(conds.length) where=' WHERE '+conds.join(' AND ');
    const r=LAB.sqlDb.exec('SELECT rowid,* FROM "'+LAB.sqlTable+'"'+where+' LIMIT '+LAB.sqlLimit+' OFFSET '+LAB.sqlOffset);
    if(r[0]){
      const colnames=r[0].columns;
      LAB.sqlRows=r[0].values.map(row=>{
        const o={rowid:row[0]};
        for(let i=1;i<colnames.length;i++) o[colnames[i]]=row[i];
        return o;
      });
    }
  }catch(e){ labAddErr('err','فشل قراءة الجدول: '+e.message,null); }
}
function labSqlEditCell(rowid, col, oldVal, newVal){
  if(!LAB.sqlDb) return;
  if(newVal===oldVal) return;
  if(newVal.length>120){ toast('النص طويل جداً (الحد 120 حرف)'); return; }
  try{
    LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=? WHERE rowid=?',[newVal,rowid]);
    labPushOp('تعديل خلية في "'+LAB.sqlTable+'.'+col+'" (سطر '+rowid+'): "'+oldVal+'" ← "'+newVal+'"',
      {kind:'sql', sql:'UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=? WHERE rowid=?', params:[oldVal,rowid]});
    const r=LAB.sqlDb.exec('PRAGMA integrity_check');
    const v=r[0]&&r[0].values[0]&&r[0].values[0][0];
    if(v!=='ok'){
      labAddErr('err','فحص السلامة فشل بعد التعديل — تم التراجع تلقائياً.',null);
      try{ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=? WHERE rowid=?',[oldVal,rowid]); }catch(e2){}
      LAB.ops.pop();
      toast('فشل فحص السلامة، رجّعنا القيمة الأصلية تلقائياً');
    }else{
      toast('تم التعديل وفحص السلامة سليم');
    }
  }catch(e){ toast('فشل التعديل: '+e.message); }
  labChecks(); render();
}
/* ---------- hex viewer ---------- */
function labHexPage(){
  if(!LAB.buf) return '';
  const start=LAB.page*LAB.pageSize, end=Math.min(start+LAB.pageSize, LAB.buf.length);
  let out='';
  for(let i=start;i<end;i+=16){
    let hx='',as='';
    for(let j=i;j<Math.min(i+16,end);j++){
      const b=LAB.buf[j];
      hx+=b.toString(16).toUpperCase().padStart(2,'0')+' ';
      as+=(b>=32&&b<127)?String.fromCharCode(b):'.';
    }
    out+='<span class="of">'+labHex(i)+'</span>  '+hx.padEnd(48,' ')+' <span class="as">'+as.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span>\n';
  }
  return out;
}
function labPages(){ return LAB.buf?Math.ceil(LAB.buf.length/LAB.pageSize):0; }
/* ---------- view ---------- */
function labToolHead(cls, ico, title, sub){
  return '<div class="toolhead '+cls+'"><div class="tico">'+ico+'</div><h2>'+title+'<span class="sub">'+sub+'</span></h2></div>';
}
function viewLab(){
  if(!LAB.buf){
    return '<div class="narrow">'
    +'<div class="labbanner"><div class="bico">🧪</div><div><h2>مختبر السوفت</h2><p>تعديل آمن على ملفات السوفت والقنوات — نسخة أصلية محفوظة، وفحص بعد كل خطوة</p></div></div>'
    +'<div class="toolcard t-teal">'+labToolHead('t-teal','📂','فتح ملف','اختار ملف السوفت أو ملف القنوات (.bin / .abs / .db / .rom)')
    +'<div class="toolbody"><div class="field"><input type="file" id="labFile"></div>'
    +'<div class="labnote"><b>إزاي بيحمي الملف؟</b><br>'
    +'١. النسخة الأصلية بتفضل محفوظة، وزر "استعادة الأصل" بيرجعك في أي لحظة.<br>'
    +'٢. بعد كل تعديل بيحصل فحص تلقائي: ثبات الحجم، سلامة الهيدر (أول ٦٤ بايت مقفولين)، بصمة نوع الملف، وإعادة حساب CRC32.<br>'
    +'٣. أي خطأ بيظهر في لوحة الفحص مع تراجع فوري، والتعديل الفاشل على قواعد البيانات بيتراجع عن نفسه تلقائياً.<br>'
    +'٤. التعديل الجدولي المباشر متاح لملفات SQLite الحقيقية. باقي الأنواع ليها أدوات عامة آمنة، والأنواع غير المعروفة قراءة-فقط بالأدوات العامة.</div>'
    +'</div></div></div>';
  }
  const errs=LAB.errors.filter(e=>e.level==='err').length, warns=LAB.errors.filter(e=>e.level==='warn').length;
  let side='<div class="labside">'
    +'<div class="card"><h2>'+esc(LAB.name)+' <span class="sub">'+esc(LAB.typeLabel)+'</span></h2>'
    +'<div class="kv"><span>الحجم</span><b>'+labFmt(LAB.buf.length)+'</b></div>'
    +'<div class="kv"><span>CRC32 الأصل</span><b dir="ltr">'+labCRC32(LAB.orig)+'</b></div>'
    +'<div class="kv"><span>CRC32 الحالي</span><b dir="ltr">'+labCRC32(labCur())+'</b></div>'
    +'<div class="kv"><span>عدد التعديلات</span><b>'+LAB.ops.length+'</b></div>'
    +'<div class="kv"><span>صور مدمجة</span><b>'+LAB.media.length+'</b></div></div>'
    +'<div class="card"><h2>إجراءات الملف</h2><div class="btnrow" style="flex-direction:column;align-items:stretch">'
    +'<button type="button" class="btn btn-primary big" id="labSave">⬇ تحميل الملف المعدّل</button>'
    +'<button type="button" class="btn btn-sec" id="labSaveOrig">تحميل النسخة الأصلية</button>'
    +'<button type="button" class="btn btn-ghost" id="labSaveReport">تقرير التعديل</button>'
    +'<button type="button" class="btn btn-sec" id="labUndo"'+(LAB.ops.length?'':' disabled')+'>↩ تراجع عن آخر تعديل</button>'
    +'<button type="button" class="btn btn-danger" id="labRestore">♻ استعادة الأصل</button>'
    +'<button type="button" class="btn btn-ghost" id="labNew">فتح ملف تاني</button>'
    +'</div></div></div>';
  let main='<div class="labmain">';
  if(LAB.type==='sqlite'&&LAB.sqlDb){
    main+='<div class="toolcard t-purple">'+labToolHead('t-purple','📋','محرر قاعدة البيانات','القوائم والقنوات — تعديل مباشر مع فحص سلامة بعد كل خطوة')
      +'<div class="toolbody">'
      +'<div class="field"><label>الجدول</label><select id="labTable">'
      +LAB.sqlTables.map(t=>'<option value="'+esc(t)+'"'+(t===LAB.sqlTable?' selected':'')+'>'+esc(t)+' ('+labSqlTableCount(t)+' سطر)</option>').join('')
      +'</select></div>'
      +'<div class="field"><label>بحث في النصوص</label><input type="text" id="labSearch" value="'+esc(LAB.sqlSearch)+'" placeholder="اكتب جزء من اسم القناة..."></div>'
      +'<div class="btnrow" style="margin-bottom:8px">'
      +'<button type="button" class="btn sm btn-primary" id="labSearchGo">بحث</button>'
      +'<button type="button" class="btn sm btn-sec" id="labPrevPage"'+(LAB.sqlOffset>0?'':' disabled')+'>السابق</button>'
      +'<button type="button" class="btn sm btn-sec" id="labNextPage"'+(LAB.sqlRows.length>=LAB.sqlLimit?'':' disabled')+'>التالي</button>'
      +(labHasFavCol()?'<button type="button" class="btn sm '+(LAB.favOnly?'btn-gold':'btn-ghost')+'" id="labFavOnly">★ المفضلة بس</button>':'')
      +(labHasChanNum()?'<button type="button" class="btn sm btn-ghost" id="labRenumber" title="إعادة ترقيم الكل من ١ للنهاية">🔢 إعادة ترقيم</button>':'')
      +'<span style="align-self:center;font-size:12px;color:var(--mut)">سطور '+(LAB.sqlOffset+1)+' - '+(LAB.sqlOffset+LAB.sqlRows.length)+'</span></div>'
      +(labHasChanNum()?'<div class="btnrow" style="margin-bottom:8px;background:#0b1425;border:1px solid var(--line2);border-radius:10px;padding:8px">'
      +'<span style="align-self:center;font-size:12px;color:var(--gold)">محدد: '+(LAB.selection?LAB.selection.size:0)+'</span>'
      +'<button type="button" class="btn sm btn-ghost" id="selVisible">تحديد الظاهر</button>'
      +'<button type="button" class="btn sm btn-ghost" id="selClear">إلغاء التحديد</button>'
      +'<input type="text" id="selMoveTo" dir="ltr" placeholder="رقم الموضع" style="width:90px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 8px">'
      +'<button type="button" class="btn sm btn-primary" id="selMove">نقل المحدد</button>'
      +(LAB.sqlTables.indexOf('grp_table')>=0?'<button type="button" class="btn sm btn-gold" id="selToGrp">إضافة المحدد لجروب</button>':'')
      +'<span style="align-self:center;font-size:11px;color:var(--mut)">Shift+ضغطة على مربع التحديد = تحديد نطاق</span></div>':'')
      +'<div class="labops" style="max-height:340px">'+labSqlRowsHtml()+'</div>'
      +'</div></div>'
      +'<div class="toolcard t-gold">'+labToolHead('t-gold','⚡','عمليات سريعة على القنوات','تنظيف الأسماء، استبدال جماعي، حذف مكرر — كلها بتتسجل وليها تراجع')
      +'<div class="toolbody">'
      +'<div class="field"><label>بحث واستبدال في كل الأسماء</label><div class="btnrow">'
      +'<input type="text" id="labQOld" placeholder="النص القديم" style="flex:1;min-width:120px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<input type="text" id="labQNew" placeholder="النص الجديد" style="flex:1;min-width:120px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<button type="button" class="btn btn-gold" id="labQDoReplace">استبدال الكل</button></div></div>'
      +'<div class="btnrow">'
      +'<input type="text" id="labQFilter" placeholder="احذف قنوات فيها نص..." style="flex:1;min-width:140px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<button type="button" class="btn btn-danger" id="labQDoFilter">حذف بالفلتر</button>'
      +'<button type="button" class="btn btn-sec" id="labQDoDups">حذف المكرر (نفس الاسم)</button>'
      +'<button type="button" class="btn btn-sec" id="labQCleanTat">تنظيف التطويل (ـ)</button>'
      +(labHasFavCol()?'<button type="button" class="btn btn-sec" id="labFavAll">★ تفضيل الكل</button><button type="button" class="btn btn-ghost" id="labFavClear">تفريغ المفضلة</button>':'')
      +'<button type="button" class="btn btn-primary" id="labArzScan">🌐 تعريب الأسماء الإنجليزية</button>'
      +'</div>'
      +(LAB.arabize?arzPreviewHtml():'')
      +'</div></div>';
  }
  if(LAB.type==='sqlite'&&LAB.sqlDb&&LAB.sqlTables.indexOf('ts_table')>=0&&LAB.sqlTables.indexOf('sat_para_table')>=0){
    main+='<div class="toolcard t-orange">'+labToolHead('t-orange','📡','إضافة تردد وقناة جديدة','ضيف تردد على قمر موجود، وبعدين ضيف عليه قنوات — بتحقق من القيم وتراجع')
      +'<div class="toolbody">'
      +'<h2 style="font-size:14px;margin-bottom:8px">١) تردد جديد</h2>'
      +'<div class="btnrow" style="margin-bottom:8px">'
      +'<select id="dbSat" style="flex:1;min-width:120px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="">📚 قاعدة الترددات المدمجة: اختر قمر…</option></select>'
      +'<select id="dbTp" style="flex:1;min-width:150px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="">اختر التردد…</option></select>'
      +'<button type="button" class="btn sm btn-sec" id="dbFill">تعبئة الحقول</button></div>'
      +'<div style="font-size:11px;color:var(--mut);margin-bottom:8px">قاعدة مدمجة لأهم الأقمار (نايل سات، بدر، هوت بيرد…) من ملف قنوات حقيقي — راجع التردد قبل الإضافة.</div>'
      +'<div class="field"><label>القمر</label><select id="tpSat">'+labSatOptions()+'</select></div>'
      +'<div class="btnrow" style="margin-bottom:8px">'
      +'<input type="text" id="tpFreq" dir="ltr" placeholder="التردد MHz زي 10719" style="flex:1;min-width:110px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<select id="tpPol" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="0">أفقي H (0)</option><option value="1">رأسي V (1)</option></select>'
      +'<input type="text" id="tpSr" dir="ltr" placeholder="الترميز زي 27500" style="flex:1;min-width:100px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<button type="button" class="btn btn-primary" id="tpAdd">إضافة التردد</button></div>'
      +'<h2 style="font-size:14px;margin:10px 0 8px">٢) قناة على تردد</h2>'
      +'<div class="field"><label>التردد</label><select id="chTs">'+labTsOptions()+'</select></div>'
      +'<div class="btnrow">'
      +'<input type="text" id="chName" placeholder="اسم القناة" style="flex:2;min-width:130px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<input type="text" id="chSid" dir="ltr" placeholder="SID" style="width:80px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<select id="chType" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="1">تلفزيون</option><option value="2">إذاعة</option></select>'
      +'<button type="button" class="btn btn-gold" id="chAdd">إضافة القناة</button></div>'
      +'</div></div>';
  }
  if(LAB.type==='sqlite'&&LAB.sqlDb&&LAB.sqlTables.indexOf('grp_table')>=0){
    const grps=labGrpList();
    main+='<div class="toolcard t-gold">'+labToolHead('t-gold','🗂','الباقات (الجروبات)','مجموعات قنوات مخصصة زي FAV — إنشاء وتسمية وملء من القنوات الظاهرة')
      +'<div class="toolbody">'
      +'<div class="field"><label>الجروب</label><select id="grpSel">'
      +grps.map(g=>'<option value="'+g.id+'"'+(LAB.grpView===g.id?' selected':'')+'>'+esc(g.name)+' ('+g.count+')</option>').join('')
      +'</select></div>'
      +'<div class="btnrow" style="margin-bottom:8px">'
      +'<button type="button" class="btn sm btn-primary" id="grpView">عرض قنوات الجروب</button>'
      +(LAB.grpView?'<button type="button" class="btn sm btn-ghost" id="grpExit">خروج من عرض الجروب</button>':'')
      +'<button type="button" class="btn sm btn-sec" id="grpAddVisible">إضافة القنوات الظاهرة للجروب</button>'
      +'<button type="button" class="btn sm btn-ghost" id="grpRename">إعادة تسمية</button>'
      +'<button type="button" class="btn sm btn-danger" id="grpDel">حذف الجروب</button></div>'
      +'<div class="btnrow"><input type="text" id="grpNewName" placeholder="اسم جروب جديد زي SPORTS" style="flex:1;min-width:140px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
      +'<button type="button" class="btn btn-gold" id="grpAdd">إنشاء جروب</button></div>'
      +'</div></div>';
  }
  if(LAB.type==='sqlite'&&LAB.sqlDb&&LAB.sqlTables.indexOf('srv_table')>=0){
    main+='<div class="toolcard t-purple">'+labToolHead('t-purple','⚖️','مقارنة ملفين','قارن ملف القنوات المفتوح بملف تاني — القنوات المضافة والمحذوفة والمتغيرة — قراءة فقط، مابيعدّلش حاجة')
      +'<div class="toolbody">'
      +'<div class="field"><label>الملف التاني (قاعدة قنوات SQLite)</label><input type="file" id="cmpFile"></div>'
      +'<button type="button" class="btn btn-primary" id="cmpRun">قارن الملفين</button>'
      +'<div id="cmpOut" style="margin-top:10px"></div>'
      +'</div></div>';
  }
  main+='<div class="toolcard t-teal">'+labToolHead('t-teal','🔄','تحويل واستيراد صيغ القنوات','تحويل موثّق بس — اللي نقدر نقراه ونتحقق منه كامل. الصيغ المغلقة بنرفضها بدل التخمين، حفاظًا على الأجهزة')
    +'<div class="toolbody">'+labConvBody()+'</div></div>';
  main+='<div class="toolcard t-blue">'+labToolHead('t-blue','🆔','مغيّر ID السوفت (من ملف لملف)','بيكتب ID الملف المانح في ملفك — زي ما بيتعمل عشان جهاز يقبل سوفت محوّل')
    +'<div class="toolbody">'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<div class="field" style="flex:1;min-width:120px"><label>إزاحة الـ ID (hex)</label><input type="text" id="labIdOff" dir="ltr" value="0000000C"></div>'
    +'<div class="field"><label>الطول</label><select id="labIdLen"><option value="4" selected>4 بايت</option><option value="2">2 بايت</option><option value="8">8 بايت</option><option value="16">16 بايت</option></select></div>'
    +'</div>'
    +'<div class="field"><label>الملف المانح (اللي هناخد منه الـ ID)</label><input type="file" id="labIdDonor"></div>'
    +'<div id="labIdPreview"></div>'
    +'<button type="button" class="btn btn-primary big" id="labIdApply" disabled>تطبيق الـ ID على ملفي</button></div></div>'
    +'<div class="toolcard t-teal">'+labToolHead('t-teal','✏️','تعديل نصوص داخل الملف','استبدال بنفس الطول بالظبط — مناسب لاسم موديل أو نص ظاهر')
    +'<div class="toolbody">'
    +'<div class="field"><label>النص القديم (زي ما هو في الملف)</label><input type="text" id="labOldStr" dir="ltr" placeholder="GX6605S-..."></div>'
    +'<div class="field"><label>النص الجديد (نفس عدد الحروف)</label><input type="text" id="labNewStr" dir="ltr"></div>'
    +'<div class="field"><label>الترميز</label><select id="labEnc"><option value="ascii">ASCII (حرف = بايت)</option><option value="utf16">UTF-16LE (حرف = بايتين)</option></select></div>'
    +'<button type="button" class="btn btn-gold big" id="labDoReplace">استبدال في كل الأماكن</button></div></div>';
  if(LAB.media.length){
    main+='<div class="toolcard t-orange">'+labToolHead('t-orange','🖼','الصور المدمجة ('+LAB.media.length+')','استخراج أو استبدال — الجديدة لازم نفس الحجم أو أصغر')
      +'<div class="toolbody">'
      +LAB.media.map((m,i)=>'<div class="mediaitem"><span>'+m.kind+' @ '+labHex(m.off)+' ('+labFmt(m.len)+')</span><span>'
      +'<button type="button" class="btn sm btn-sec" data-labext="'+i+'">استخراج</button> '
      +'<button type="button" class="btn sm btn-primary" data-labrep="'+i+'">استبدال</button></span></div>').join('')
      +'<input type="file" id="labImgFile" accept="image/*" style="display:none"></div></div>';
  }
  main+='<div class="toolcard t-purple">'+labToolHead('t-purple','🎬','محوّل الصور إلى فيديو M2V','يحوّل مجموعة صور لفيديو MPEG-2 (.m2v) جوه المتصفح — بدون سيرفر')
    +'<div class="toolbody">'
    +'<div class="field"><label>الصور (بالترتيب)</label><input type="file" id="m2vFiles" accept="image/*" multiple></div>'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<select id="m2vRes" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="720x576" selected>720×576 (SD)</option><option value="720x480">720×480 (NTSC)</option><option value="1280x720">1280×720 (HD)</option><option value="1920x1080">1920×1080 (Full HD)</option></select>'
    +'<select id="m2vFps" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px"><option value="25" selected>25 fps</option><option value="30">30 fps</option></select>'
    +'<input type="text" id="m2vSecs" value="3" style="width:90px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px" title="ثواني لكل صورة">'
    +'</div>'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<button type="button" class="btn btn-sec" id="m2vPrev">▶ معاينة</button>'
    +'<button type="button" class="btn btn-gold big" id="m2vGo">تحويل وتحميل .m2v</button></div>'
    +'<img id="m2vPrevImg" style="display:none;max-width:100%;border-radius:10px;border:1px solid var(--line2);margin-bottom:8px">'
    +'<div class="labops" id="m2vLog" style="max-height:140px"><div style="color:var(--mut)">اختار الصور واضغط تحويل. أول مرة بيحمل محرك التحويل من النت (~25MB).</div></div></div></div>'
    +'<div class="toolcard t-blue">'+labToolHead('t-blue','🔌','لودر السيريال (تجريبي)','فلاشة/دامب عن طريق منفذ COM من المتصفح — Web Serial')
    +'<div class="toolbody">'
    +'<p class="labnote" style="color:#fbbf24">تنبيه صريح: ده اتصال سيريال خام (إرسال/استقبال) شغال من المتصفح، لكن بروتوكول اللودر الكامل بتاع GX/Sunplus <b>لم يُختبر على جهاز حقيقي بعد</b>. استخدمه للتجربة بس، وماتعتمدش عليه في فلاشة جهاز عميل.</p>'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<select id="serBaud" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
    +['9600','38400','57600','115200','230400','460800','921600'].map(b=>'<option value="'+b+'"'+(b==='115200'?' selected':'')+'>'+b+'</option>').join('')
    +'</select>'
    +(SER.port
      ?'<button type="button" class="btn btn-danger" id="serDisc">فصل</button><span id="serStatus" style="align-self:center;font-size:12px;color:var(--mut)">استقبال: '+SER.rx.toLocaleString('en-US')+' بايت</span>'
      :'<button type="button" class="btn btn-primary" id="serConn">اتصال بالمنفذ</button>')
    +'<button type="button" class="btn btn-sec" id="serSave"'+(SER.rx?'':' disabled')+'>حفظ المستقبَل + SHA-256</button>'
    +'</div>'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<input type="text" id="serHex" dir="ltr" placeholder="بايتات hex للإرسال زي A5 5A 00 01" style="flex:1;min-width:200px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:8px 10px">'
    +'<button type="button" class="btn btn-sec" id="serSend"'+(SER.port?'':' disabled')+'>إرسال</button></div>'
    +'<div class="labops hexview" id="serLog" style="max-height:180px;white-space:pre-wrap">'
    +(SER.log.length?SER.log.map(l=>'<div class="'+l.cls+'">['+l.t+'] '+esc(l.msg)+'</div>').join(''):'<div style="color:var(--mut)">اللوج فاضي — اتصل بالمنفذ عشان تبدأ</div>')
    +'</div></div></div>'
    +'<div class="toolcard t-teal">'+labToolHead('t-teal','🔬','عارض Hex','قراءة فقط — '+(LAB.page+1)+' / '+labPages()+' صفحة')
    +'<div class="toolbody">'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<button type="button" class="btn sm btn-sec" id="labHxPrev"'+(LAB.page>0?'':' disabled')+'>السابق</button>'
    +'<button type="button" class="btn sm btn-sec" id="labHxNext"'+(LAB.page<labPages()-1?'':' disabled')+'>التالي</button>'
    +'<input type="text" id="labHxGoto" dir="ltr" placeholder="عنوان hex زي 0001A000" style="width:160px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
    +'<button type="button" class="btn sm btn-primary" id="labHxGo">روح</button>'
    +(LAB.unlocked
      ?'<button type="button" class="btn sm btn-danger" id="labLock">قفل الهيدر تاني</button>'
      :'<button type="button" class="btn sm btn-ghost" id="labUnlock">فك قفل الهيدر (خطر)</button>')
    +'</div>'
    +'<div class="hexview">'+labHexPage()+'</div></div></div>'
    +'<div class="toolcard t-red">'+labToolHead('t-red','🧬','تعديل بايتات متقدم','للخبراء — اكتب العنوان والبايتات hex')
    +'<div class="toolbody">'
    +'<div class="field"><label>العنوان (hex)</label><input type="text" id="labPatchOff" dir="ltr" placeholder="0001A000"></div>'
    +'<div class="field"><label>البايتات الجديدة (hex)</label><input type="text" id="labPatchBytes" dir="ltr" placeholder="48 65 6C 6C 6F"></div>'
    +'<button type="button" class="btn btn-sec" id="labDoPatch">تطبيق التعديل</button></div></div>';
  main+='</div>';
  const lastOp=LAB.ops.length?LAB.ops[LAB.ops.length-1].desc:'مفيش تعديلات لسه';
  const status='<div class="labstatus">'
    +'<span><span class="dot" style="background:'+(errs?'#f87171':warns?'#fbbf24':'#34d399')+'"></span>'+(errs?errs+' خطأ':warns?warns+' تنبيه':'الفحص سليم')+'</span>'
    +'<span style="color:var(--mut)">آخر عملية: '+esc(lastOp)+'</span>'
    +'<span dir="ltr" style="color:var(--mut)">CRC '+labCRC32(labCur())+'</span>'
    +'</div>';
  return '<div class="narrow">'
    +'<div class="labbanner"><div class="bico">🧪</div><div><h2>مختبر السوفت</h2><p>تعديل آمن — أصل محفوظ، تراجع، وفحص بعد كل خطوة</p></div></div>'
    +'<div class="card" style="margin-bottom:14px"><h2 style="font-size:15px">لوحة الفحص والأخطاء</h2><div class="labops" id="labErrs">'
    +(LAB.errors.length?LAB.errors.map(e=>'<div class="'+(e.level==='err'?'operr':e.level==='warn'?'opwarn':'opok')+'">'+esc(e.msg)+'</div>').join(''):'<div class="opok">كل الفحوصات سليمة</div>')
    +'</div></div>'
    +'<div class="labgrid2">'+side+main+'</div>'
    +status+'</div>';
}

function labSqlRowsHtml(){
  if(!LAB.sqlRows.length) return '<div style="color:var(--mut)">لا توجد سطور</div>';
  const tcols=LAB.sqlCols.filter(c=>c.type.indexOf('CHAR')>=0||c.type.indexOf('TEXT')>=0).map(c=>c.name);
  const idcols=LAB.sqlCols.filter(c=>/id|no$/i.test(c.name)&&c.type.indexOf('CHAR')<0&&c.type.indexOf('TEXT')<0).map(c=>c.name);
  return LAB.sqlRows.map(r=>{
    const label=idcols.map(c=>esc(String(r[c]??''))).join(' · ');
    let cells='';
    for(const c of tcols.slice(0,2)){
      cells+='<input type="text" value="'+esc(String(r[c]??''))+'" data-rowid="'+r.rowid+'" data-col="'+esc(c)+'" data-old="'+esc(String(r[c]??''))+'">';
    }
    const favBtn=labHasFavCol()?'<button type="button" class="btn sm '+(r.favor?'btn-gold':'btn-ghost')+'" data-fav="'+r.rowid+'" data-favcur="'+(r.favor?1:0)+'">'+(r.favor?'★':'☆')+'</button>':'';
    const dragBtn=(labHasChanNum()&&!LAB.grpView)?'<span class="btn sm btn-ghost" draggable="true" data-dragrow="'+r.rowid+'" style="cursor:grab;user-select:none">⋮⋮</span>':'';
    const grpBtn=LAB.grpView?'<button type="button" class="btn sm btn-danger" data-grprm="'+(r.db_id??r.rowid)+'">✕</button>':'';
    const selBox='<input type="checkbox" data-sel="'+r.rowid+'"'+(LAB.selection&&LAB.selection.has(r.rowid)?' checked':'')+' style="width:16px;height:16px;accent-color:var(--teal);cursor:pointer">';
    const infoBtn='<button type="button" class="btn sm btn-ghost" data-info="'+r.rowid+'" title="تفاصيل تقنية">ⓘ</button>';
    const mvBtns=(labHasChanNum()&&!LAB.grpView)?'<span style="display:flex;flex-direction:column;gap:2px"><button type="button" class="btn sm btn-ghost" data-mv="'+r.rowid+'" data-dir="-1" title="طلّع خطوة" style="padding:0 7px;line-height:1.1">▲</button><button type="button" class="btn sm btn-ghost" data-mv="'+r.rowid+'" data-dir="1" title="نزّل خطوة" style="padding:0 7px;line-height:1.1">▼</button></span>':'';
    return '<div class="chrow" data-row="'+r.rowid+'" style="grid-template-columns:auto auto 52px 1fr auto auto auto auto auto">'+selBox+dragBtn+'<span style="color:var(--mut);font-size:12px">'+label+'</span>'+cells+favBtn+infoBtn+mvBtns+grpBtn+'</div>';
  }).join('');
}
/* ---------- bindings ---------- */
function bindLab(){
  const f=$('#labFile');
  if(f) f.addEventListener('change',()=>{ if(f.files[0]) labLoadFile(f.files[0]); });
  const on=(id,fn)=>{ const el=$(id); if(el) el.addEventListener('click',fn); };
  on('#labNew',()=>{ labReset(); render(); });
  on('#labUndo',labUndo);
  on('#labRestore',()=>{ openModal('استعادة النسخة الأصلية','<p>هتلغي كل التعديلات ('+LAB.ops.length+') وترجع للأصل. متأكد؟</p>','نعم، استعادة الأصل',()=>{ labRestore(); }); });
  on('#labDoReplace',()=>{
    labReplaceString($('#labOldStr').value, $('#labNewStr').value, $('#labEnc').value);
  });
  const idOff=$('#labIdOff'), idLen=$('#labIdLen');
  if(idOff) idOff.addEventListener('change',labIdSyncOpts);
  if(idLen) idLen.addEventListener('change',labIdSyncOpts);
  const donor=$('#labIdDonor');
  if(donor) donor.addEventListener('change',async()=>{
    if(donor.files[0]){ LABID.donor=new Uint8Array(await donor.files[0].arrayBuffer()); LABID.donorName=donor.files[0].name; labIdSyncOpts(); }
  });
  on('#labIdApply',labIdApply);
  labIdRenderPreview();
  on('#labQDoReplace',()=>{
    const nm=(LAB.sqlCols.find(c=>/name/i.test(c.name))||LAB.sqlCols.find(c=>c.type.indexOf('CHAR')>=0||c.type.indexOf('TEXT')>=0));
    if(nm) labQReplace(nm.name, $('#labQOld').value, $('#labQNew').value);
  });
  on('#labQDoDups',labQDeleteDups);
  on('#labFavOnly',()=>{ LAB.favOnly=!LAB.favOnly; LAB.sqlOffset=0; labSqlLoadRows(); render(); });
  on('#labFavAll',()=>labFavBulk(1));
  on('#labFavClear',()=>labFavBulk(0));
  document.querySelectorAll('[data-fav]').forEach(b=>b.addEventListener('click',()=>labFavToggle(+b.dataset.fav, +b.dataset.favcur)));
  document.querySelectorAll('[data-info]').forEach(b=>b.addEventListener('click',()=>labShowInfo(+b.dataset.info)));
  document.querySelectorAll('[data-mv]').forEach(b=>b.addEventListener('click',()=>labMoveStep(+b.dataset.mv, +b.dataset.dir)));
  on('#labRenumber',labRenumberAll);
  on('#grpAdd',()=>labGrpAdd($('#grpNewName').value));
  on('#grpRename',()=>{ const id=+$('#grpSel').value; const n=$('#grpNewName').value.trim()||prompt('الاسم الجديد:'); if(n) labGrpRename(id,n); });
  on('#grpDel',()=>labGrpDel(+$('#grpSel').value));
  on('#grpView',()=>{ LAB.grpView=+$('#grpSel').value; LAB.sqlTable='srv_table'; LAB.sqlOffset=0; labSqlLoadRows(); render(); });
  on('#grpExit',()=>{ LAB.grpView=null; LAB.sqlOffset=0; labSqlLoadRows(); render(); });
  on('#grpAddVisible',()=>labGrpAddVisible(+$('#grpSel').value));
  document.querySelectorAll('[data-grprm]').forEach(b=>b.addEventListener('click',()=>labGrpRemoveMember(LAB.grpView, +b.dataset.grprm)));
  document.querySelectorAll('[data-sel]').forEach(cb=>{
    cb.addEventListener('click',e=>{
      e.stopPropagation();
      const rid=+cb.dataset.sel;
      if(e.shiftKey&&LAB.selAnchor!=null&&LAB.selAnchor!==rid){
        const order=LAB.sqlRows.map(r=>r.rowid);
        const a=order.indexOf(LAB.selAnchor), b=order.indexOf(rid);
        if(a>=0&&b>=0){
          const lo=Math.min(a,b), hi=Math.max(a,b);
          for(let i=lo;i<=hi;i++) LAB.selection.add(order[i]);
          render(); return;
        }
      }
      if(cb.checked) LAB.selection.add(rid); else LAB.selection.delete(rid);
      LAB.selAnchor=rid;
      render();
    });
  });
  on('#selVisible',()=>{ LAB.sqlRows.forEach(r=>LAB.selection.add(r.rowid)); render(); });
  on('#selClear',()=>{ LAB.selection=new Set(); LAB.selAnchor=null; render(); });
  on('#selMove',()=>labMoveSelected($('#selMoveTo').value));
  on('#selToGrp',()=>{
    const grps=labGrpList();
    if(!grps.length){ toast('مفيش جروبات — اعمل جروب الأول من كرت الباقات'); return; }
    const names=grps.map((g,i)=>(i+1)+') '+g.name+' ('+g.count+')').join('\n');
    const pick=prompt('اختار رقم الجروب:\n'+names);
    const gi=parseInt(pick,10);
    if(gi>=1&&gi<=grps.length) labGrpAddRows(grps[gi-1].id, Array.from(LAB.selection||[]));
  });
  let dragId=null;
  document.querySelectorAll('[data-dragrow]').forEach(h=>{
    h.addEventListener('dragstart',e=>{ dragId=+h.dataset.dragrow; e.dataTransfer.effectAllowed='move'; });
  });
  document.querySelectorAll('.chrow[data-row]').forEach(row=>{
    row.addEventListener('dragover',e=>{ e.preventDefault(); row.style.borderTop='2px solid var(--teal)'; });
    row.addEventListener('dragleave',()=>{ row.style.borderTop=''; });
    row.addEventListener('drop',e=>{ e.preventDefault(); row.style.borderTop=''; if(dragId) labMoveRow(dragId, +row.dataset.row); dragId=null; });
  });
  on('#dbFill',()=>{
    const si=+($('#dbSat')&&$('#dbSat').value), ti=+($('#dbTp')&&$('#dbTp').value);
    if(!(LAB.satdb&&LAB.satdb.sats[si]&&LAB.satdb.sats[si].tps[ti])) return;
    const tp=LAB.satdb.sats[si].tps[ti];
    $('#tpFreq').value=String(tp[0]); $('#tpSr').value=String(tp[1]); $('#tpPol').value=(tp[2]==='H'?'0':'1');
    toast('اتملت الحقول: '+tp[0]+' '+tp[2]+' '+tp[1]+' — راجع واضغط إضافة التردد');
  });
  (()=>{ const el=$('#dbSat'); if(el) el.addEventListener('change',async e=>{
    const tpSel=$('#dbTp'); tpSel.innerHTML='<option value="">اختر التردد…</option>';
    if(e.target.value==='') return;
    if(!LAB.satdb){ try{ LAB.satdb=await (await fetch('satdb.json')).json(); }catch(err){ toast('مش قادر أحمّل قاعدة الترددات'); return; } }
    const sat=LAB.satdb.sats[+e.target.value];
    tpSel.innerHTML='<option value="">اختر التردد…</option>'+sat.tps.map((t,i)=>'<option value="'+i+'">'+t[0]+' '+t[2]+' '+t[1]+'</option>').join('');
  }); })();
  (async()=>{ const dbSat=$('#dbSat'); if(!dbSat) return; try{ if(!LAB.satdb) LAB.satdb=await (await fetch('satdb.json')).json(); dbSat.innerHTML='<option value="">📚 قاعدة الترددات المدمجة: اختر قمر…</option>'+LAB.satdb.sats.map((st,i)=>'<option value="'+i+'">'+esc(st.name)+' ('+st.tps.length+')</option>').join(''); }catch(e){} })();
  on('#cmpRun',labCompareFiles);
  on('#expJson',labExpJson);
  on('#expCsv',labExpCsv);
  on('#impRun',labImportRun);
  on('#labArzScan',arzScan);
  on('#arzAll',()=>arzSetAll(true));
  on('#arzNone',()=>arzSetAll(false));
  on('#arzApply',arzApply);
  on('#arzCancel',()=>{ LAB.arabize=null; render(); });
  document.querySelectorAll('[data-arz]').forEach(b=>b.addEventListener('click',()=>arzToggle(+b.dataset.arz)));
  on('#tpAdd',()=>{ labTpAdd(+$('#tpSat').value, $('#tpFreq').value, +$('#tpPol').value, $('#tpSr').value); });
  on('#chAdd',()=>{ labChAdd(+$('#chTs').value, $('#chName').value, $('#chSid').value, +$('#chType').value); });
  on('#labQCleanTat',()=>{
    const nm=(LAB.sqlCols.find(c=>/name/i.test(c.name))||LAB.sqlCols.find(c=>c.type.indexOf('CHAR')>=0||c.type.indexOf('TEXT')>=0));
    if(nm) labQReplace(nm.name,'ـ','');
  });
  on('#labQDoFilter',()=>{
    const nm=(LAB.sqlCols.find(c=>/name/i.test(c.name))||LAB.sqlCols.find(c=>c.type.indexOf('CHAR')>=0||c.type.indexOf('TEXT')>=0));
    if(nm) labQDeleteFilter(nm.name, $('#labQFilter').value.trim());
  });
  const m2vF=$('#m2vFiles');
  if(m2vF) m2vF.addEventListener('change',()=>{ M2V.imgs=Array.from(m2vF.files||[]); m2vLog('اتختار '+M2V.imgs.length+' صورة','opok'); });
  on('#m2vPrev',m2vPreview);
  on('#m2vGo',m2vConvert);
  on('#serConn',serConnect);
  on('#serDisc',serDisconnect);
  on('#serSend',()=>{ serSendHex($('#serHex').value); });
  on('#serSave',serSaveDump);
  on('#labDoPatch',()=>{ labPatchBytes($('#labPatchOff').value, $('#labPatchBytes').value); });
  on('#labHxPrev',()=>{ if(LAB.page>0){ LAB.page--; render(); } });
  on('#labHxNext',()=>{ if(LAB.page<labPages()-1){ LAB.page++; render(); } });
  on('#labHxGo',()=>{
    const off=parseInt($('#labHxGoto').value,16);
    if(!isNaN(off)&&off>=0){ LAB.page=Math.min(Math.floor(off/LAB.pageSize),labPages()-1); render(); }
    else toast('العنوان غير صحيح');
  });
  on('#labUnlock',()=>{
    openModal('فك قفل الهيدر','<p>أول ٦٤ بايت في الملف بتبقى مقفولة حماية من التلف. فك القفل يسمح بالتعديل فيها — خطوة خطيرة وممكن تبوظ الملف. متأكد؟</p>','نعم، فك القفل',()=>{ LAB.unlocked=true; labChecks(); render(); });
  });
  on('#labLock',()=>{ LAB.unlocked=false; labChecks(); render(); });
  on('#labSave',labDownloadModified);
  on('#labSaveOrig',labDownloadOriginal);
  on('#labSaveReport',labDownloadReport);
  document.querySelectorAll('[data-labext]').forEach(b=>b.addEventListener('click',()=>{
    const m=LAB.media[+b.dataset.labext];
    const ext=m.kind==='JPEG'?'jpg':m.kind.toLowerCase();
    downloadBlob(new Blob([LAB.buf.slice(m.off,m.off+m.len)]),'img_'+labHex(m.off)+'.'+ext);
  }));
  let repIdx=-1;
  const imgInp=$('#labImgFile');
  document.querySelectorAll('[data-labrep]').forEach(b=>b.addEventListener('click',()=>{
    repIdx=+b.dataset.labrep; if(imgInp){ imgInp.value=''; imgInp.click(); }
  }));
  if(imgInp) imgInp.addEventListener('change',()=>{ if(imgInp.files[0]&&repIdx>=0) labReplaceImage(repIdx,imgInp.files[0]); });
  const tbl=$('#labTable');
  if(tbl) tbl.addEventListener('change',()=>{ LAB.sqlTable=tbl.value; LAB.sqlOffset=0; labSqlLoadRows(); render(); });
  on('#labSearchGo',()=>{ LAB.sqlSearch=$('#labSearch').value.trim(); LAB.sqlOffset=0; labSqlLoadRows(); render(); });
  const sInp=$('#labSearch');
  if(sInp) sInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); LAB.sqlSearch=sInp.value.trim(); LAB.sqlOffset=0; labSqlLoadRows(); render(); } });
  on('#labPrevPage',()=>{ if(LAB.sqlOffset>0){ LAB.sqlOffset=Math.max(0,LAB.sqlOffset-LAB.sqlLimit); labSqlLoadRows(); render(); } });
  on('#labNextPage',()=>{ if(LAB.sqlRows.length>=LAB.sqlLimit){ LAB.sqlOffset+=LAB.sqlLimit; labSqlLoadRows(); render(); } });
  document.querySelectorAll('.chrow input[data-rowid]').forEach(inp=>{
    inp.addEventListener('change',()=>{
      labSqlEditCell(+inp.dataset.rowid, inp.dataset.col, inp.dataset.old, inp.value);
    });
  });
}
/* ---------- sql undo support ---------- */
const _labUndoOrig=labUndo;
labUndo=function(){
  const op=LAB.ops[LAB.ops.length-1];
  if(op&&op.inverse&&op.inverse.kind==='sql'){
    LAB.ops.pop();
    try{ LAB.sqlDb.run(op.inverse.sql, op.inverse.params); }catch(e){}
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  if(op&&op.inverse&&op.inverse.kind==='sqlbulk'){
    LAB.ops.pop();
    try{ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+op.inverse.col+'"=REPLACE("'+op.inverse.col+'", ?, ?)',[op.inverse.from,op.inverse.to]); }catch(e){}
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  if(op&&op.inverse&&op.inverse.kind==='sqlarabize'){
    LAB.ops.pop();
    try{ for(const c of op.inverse.changes) LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+op.inverse.col+'"=? WHERE rowid=?',[c.old,c.rowid]); }catch(e){}
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  if(op&&op.inverse&&op.inverse.kind==='sqlexec'){
    LAB.ops.pop();
    try{ for(const st of op.inverse.stmts) LAB.sqlDb.run(st[0], st[1]); }catch(e){ toast('خطأ في التراجع: '+e.message); }
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  if(op&&op.inverse&&op.inverse.kind==='sqldelrows'){
    LAB.ops.pop();
    try{ for(const id of op.inverse.ids) LAB.sqlDb.run('DELETE FROM "'+op.inverse.table+'" WHERE db_id=?',[id]); }catch(e){}
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  if(op&&op.inverse&&op.inverse.kind==='sqlrestore'){
    LAB.ops.pop();
    try{
      LAB.sqlDb.run('DELETE FROM "'+op.inverse.table+'"');
      const cols=(op.inverse.cols&&op.inverse.cols.length?op.inverse.cols.slice():[]);
      if(!cols.length&&op.inverse.rows.length){ toast('لا يمكن التراجع: نسخة الأعمدة ناقصة'); labSqlLoadRows(); labChecks(); render(); return; }
      if(cols.length){
        const colIdx=cols.map(c=>c);
        for(const row of op.inverse.rows){
          const vals=cols.map(c=>row[colIdx.indexOf(c)]);
          LAB.sqlDb.run('INSERT INTO "'+op.inverse.table+'" ('+cols.map(c=>c==='rowid'?'rowid':'"'+c+'"').join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')', vals);
        }
      }
    }catch(e){ toast('فشل التراجع: '+e.message); }
    labSqlLoadRows(); labChecks(); render();
    toast('تم التراجع عن: '+op.desc);
    return;
  }
  _labUndoOrig();
};
/* ---------- ID changer (compare two bins) ---------- */
const LABID={donor:null, donorName:'', off:0x0C, len:4};
function labIdRead(u8,off,len){ if(!u8||off+len>u8.length) return null; return Array.from(u8.slice(off,off+len)); }
function labIdHex(b){ return b?b.map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' '):'—'; }
function labIdApply(){
  if(!LAB.buf||!LABID.donor) return;
  const off=LABID.off, len=LABID.len;
  const nb=labIdRead(LABID.donor,off,len);
  if(!nb){ toast('الإزاحة خارج حجم الملف المانح'); return; }
  if(off+len>LAB.buf.length){ toast('الإزاحة خارج حجم الملف الحالي'); return; }
  const old=Array.from(LAB.buf.slice(off,off+len));
  for(let j=0;j<len;j++) LAB.buf[off+j]=nb[j];
  labPushOp('تغيير ID عند '+labHex(off)+' ('+len+' بايت): '+labIdHex(old)+' ← '+labIdHex(nb)+' من "'+LABID.donorName+'"',
    {kind:'patches',patches:[{off,old}]});
  labChecks(); render();
  toast('تم تغيير الـ ID');
}
/* ---------- channel studio quick ops (SQLite) ---------- */
function labQReplace(col, oldS, newS){
  if(!LAB.sqlDb||!oldS) return;
  try{
    const before=LAB.sqlDb.exec('SELECT COUNT(*) FROM "'+LAB.sqlTable+'"')[0].values[0][0];
    LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=REPLACE("'+col+'", ?, ?)',[oldS,newS]);
    const ch=LAB.sqlDb.exec('SELECT changes()')[0].values[0][0];
    labPushOp('استبدال جماعي في "'+LAB.sqlTable+'.'+col+'": "'+oldS+'" ← "'+newS+'" ('+ch+' سطر)', {kind:'sqlbulk', col, from:newS, to:oldS});
    const v=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
    if(v!=='ok'){ labAddErr('err','فحص السلامة فشل بعد الاستبدال الجماعي',null); }
    toast('اتعدل '+ch+' سطر من '+before);
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
function labQDeleteDups(){
  if(!LAB.sqlDb) return;
  try{
    const cols=LAB.sqlCols.map(c=>'"'+c.name+'"').join(',');
    const before=LAB.sqlDb.exec('SELECT COUNT(*) FROM "'+LAB.sqlTable+'"')[0].values[0][0];
    const nm=LAB.sqlCols.find(c=>/name/i.test(c.name));
    if(!nm){ toast('مفيش عمود اسم في الجدول ده'); return; }
    const backup=LAB.sqlDb.exec('SELECT rowid,'+cols+' FROM "'+LAB.sqlTable+'"');
    LAB.sqlDb.run('DELETE FROM "'+LAB.sqlTable+'" WHERE rowid NOT IN (SELECT MIN(rowid) FROM "'+LAB.sqlTable+'" GROUP BY "'+nm.name+'")');
    const after=LAB.sqlDb.exec('SELECT COUNT(*) FROM "'+LAB.sqlTable+'"')[0].values[0][0];
    const removed=before-after;
    if(removed<=0){ toast('مفيش تكرارات'); labChecks(); render(); return; }
    labPushOp('حذف '+removed+' قناة مكررة (نفس الاسم) من "'+LAB.sqlTable+'"', {kind:'sqlrestore', rows:backup[0]?backup[0].values:[], table:LAB.sqlTable, cols:backup[0]?backup[0].columns:null});
    const v=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
    if(v!=='ok') labAddErr('err','فحص السلامة فشل بعد حذف المكرر',null);
    toast('اتحذف '+removed+' مكرر');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
function labQDeleteFilter(col, txt){
  if(!LAB.sqlDb||!txt) return;
  openModal('حذف قنوات','<p>هيتم حذف كل قناة الـ "'+esc(col)+'" فيها "'+esc(txt)+'" من جدول "'+esc(LAB.sqlTable)+'". متأكد؟</p>','نعم، احذف',()=>{
    try{
      const backup=LAB.sqlDb.exec('SELECT rowid,* FROM "'+LAB.sqlTable+'"');
      LAB.sqlDb.run('DELETE FROM "'+LAB.sqlTable+'" WHERE "'+col+'" LIKE ?',['%'+txt+'%']);
      const ch=LAB.sqlDb.exec('SELECT changes()')[0].values[0][0];
      labPushOp('حذف '+ch+' سطر من "'+LAB.sqlTable+'" حيث "'+col+'" فيه "'+txt+'"', {kind:'sqlrestore', rows:backup[0]?backup[0].values:[], table:LAB.sqlTable, cols:backup[0]?backup[0].columns:null});
      toast('اتحذف '+ch+' سطر');
    }catch(e){ toast('فشل: '+e.message); }
    labSqlLoadRows(); labChecks(); render();
  });
}
/* ---------- ID changer helpers ---------- */
function labIdSyncOpts(){
  const o=$('#labIdOff'); if(o){ const v=parseInt(o.value,16); if(!isNaN(v)&&v>=0) LABID.off=v; }
  const l=$('#labIdLen'); if(l) LABID.len=+l.value;
  labIdRenderPreview();
}
function labIdRenderPreview(){
  const el=$('#labIdPreview'); if(!el) return;
  const mine=labIdRead(LAB.buf,LABID.off,LABID.len);
  const donor=LABID.donor?labIdRead(LABID.donor,LABID.off,LABID.len):null;
  el.innerHTML='<div class="kv"><span>ID ملفي الحالي</span><b dir="ltr">'+labIdHex(mine)+'</b></div>'
    +(LABID.donor?'<div class="kv"><span>ID الملف المانح ('+esc(LABID.donorName)+')</span><b dir="ltr">'+labIdHex(donor)+'</b></div>':'<div class="labnote">اختار الملف المانح عشان تشوف المعاينة.</div>');
  const b=$('#labIdApply'); if(b) b.disabled=!(LABID.donor&&donor&&mine);
}
/* ---------- serial loader (experimental, Web Serial) ---------- */
const SER={port:null, reader:null, reading:false, log:[], rx:0, rxBuf:[]};
function serLog(msg, cls){
  SER.log.push({t:new Date().toLocaleTimeString('ar-EG'), msg, cls:cls||''});
  if(SER.log.length>400) SER.log.shift();
  const el=$('#serLog');
  if(el){ el.innerHTML=SER.log.map(l=>'<div class="'+l.cls+'">['+l.t+'] '+esc(l.msg)+'</div>').join(''); el.scrollTop=el.scrollHeight; }
}
async function serConnect(){
  if(!('serial' in navigator)){ toast('المتصفح ده مش بيدعم Web Serial — جرّب Chrome/Edge على الكمبيوتر'); return; }
  try{
    SER.port=await navigator.serial.requestPort();
    const baud=+($('#serBaud')?$('#serBaud').value:115200);
    await SER.port.open({baudRate:baud});
    serLog('اتفتح المنفذ على '+baud+' baud','opok');
    render();
    serReadLoop();
  }catch(e){ serLog('فشل الاتصال: '+e.message,'operr'); }
}
async function serReadLoop(){
  SER.reading=true; SER.rx=0; SER.rxBuf=[];
  while(SER.port&&SER.port.readable&&SER.reading){
    SER.reader=SER.port.readable.getReader();
    try{
      while(true){
        const {value,done}=await SER.reader.read();
        if(done) break;
        if(value){ SER.rx+=value.length; SER.rxBuf.push(value); const st=$('#serStatus'); if(st) st.textContent='استقبال: '+SER.rx.toLocaleString('en-US')+' بايت'; }
      }
    }catch(e){ serLog('خطأ قراءة: '+e.message,'operr'); }
    finally{ SER.reader.releaseLock(); }
  }
}
async function serDisconnect(){
  SER.reading=false;
  if(SER.reader){ try{ await SER.reader.cancel(); }catch(e){} }
  if(SER.port){ try{ await SER.port.close(); }catch(e){} }
  SER.port=null; serLog('اتقفل المنفذ','opwarn'); render();
}
async function serSendHex(hexStr){
  if(!SER.port){ toast('اتصل بالمنفذ الأول'); return; }
  const clean=hexStr.replace(/[^0-9a-fA-F]/g,'');
  if(!clean.length||clean.length%2){ toast('اكتب بايتات hex صحيحة'); return; }
  const bytes=new Uint8Array(clean.length/2);
  for(let i=0;i<clean.length;i+=2) bytes[i/2]=parseInt(clean.substr(i,2),16);
  try{
    const w=SER.port.writable.getWriter();
    await w.write(bytes); w.releaseLock();
    serLog('أرسلنا '+bytes.length+' بايت: '+clean.toUpperCase().match(/.{1,2}/g).join(' '),'opok');
  }catch(e){ serLog('فشل الإرسال: '+e.message,'operr'); }
}
function serCollected(){
  let n=0; for(const c of SER.rxBuf) n+=c.length;
  const out=new Uint8Array(n); let p=0;
  for(const c of SER.rxBuf){ out.set(c,p); p+=c.length; }
  return out;
}
async function serSaveDump(){
  const data=serCollected();
  if(!data.length){ toast('مفيش بيانات مستقبلة'); return; }
  const hash=await crypto.subtle.digest('SHA-256',data);
  const hex=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  downloadBlob(new Blob([data]),'serial-dump-'+data.length+'.bin');
  serLog('اتحفظ dump بحجم '+data.length+' بايت — SHA-256: '+hex,'opok');
}
/* ---------- images -> m2v converter (ffmpeg.wasm, lazy CDN load) ---------- */
const M2V={imgs:[], ff:null, busy:false, previewTimer:null, previewIdx:0};
function m2vLog(msg, cls){
  const el=$('#m2vLog');
  if(el){ el.innerHTML+='<div class="'+(cls||'')+'">'+esc(msg)+'</div>'; el.scrollTop=el.scrollHeight; }
}
async function m2vLoadFF(){
  if(M2V.ff) return M2V.ff;
  if(!window.FFmpeg){
    m2vLog('بنحمّل محرك التحويل (ffmpeg.wasm ~25MB أول مرة بس)...');
    await new Promise((res,rej)=>{
      const sc=document.createElement('script');
      sc.src='https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
      sc.onload=res; sc.onerror=()=>rej(new Error('فشل تحميل ffmpeg — محتاج نت'));
      document.head.appendChild(sc);
    });
  }
  const ff=FFmpeg.createFFmpeg({ log:false, mainName:'main', corePath:'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js' });
  await ff.load();
  M2V.ff=ff;
  return ff;
}
function m2vPreview(){
  const img=$('#m2vPrevImg');
  if(!img||!M2V.imgs.length) return;
  if(M2V.previewTimer){ clearInterval(M2V.previewTimer); M2V.previewTimer=null; img.style.display='none'; return; }
  const secs=+($('#m2vSecs')?$('#m2vSecs').value:3)||3;
  img.style.display='block'; M2V.previewIdx=0;
  const show=()=>{ img.src=URL.createObjectURL(M2V.imgs[M2V.previewIdx % M2V.imgs.length]); M2V.previewIdx++; };
  show(); M2V.previewTimer=setInterval(show, Math.min(secs,5)*1000);
}
async function m2vConvert(){
  if(M2V.busy) return;
  if(!M2V.imgs.length){ toast('اختار صور الأول'); return; }
  M2V.busy=true;
  try{
    const res=$('#m2vRes').value.split('x'), W=+res[0], H=+res[1];
    const fps=+$('#m2vFps').value||25;
    const secs=+$('#m2vSecs').value||3;
    m2vLog('بنجهز '+M2V.imgs.length+' صورة...');
    const ff=await m2vLoadFF();
    for(let i=0;i<M2V.imgs.length;i++){
      const data=new Uint8Array(await M2V.imgs[i].arrayBuffer());
      ff.FS('writeFile','img'+String(i).padStart(3,'0')+'.jpg', data);
    }
    m2vLog('بيتحول... (W×H='+W+'×'+H+', '+fps+'fps, '+secs+' ثانية لكل صورة)');
    await ff.run('-framerate','1/'+secs,'-i','img%03d.jpg','-vf','scale='+W+':'+H+':force_original_aspect_ratio=decrease,pad='+W+':'+H+':(ow-iw)/2:(oh-ih)/2','-r',String(fps),'-c:v','mpeg2video','-q:v','4','out.m2v');
    const out=ff.FS('readFile','out.m2v');
    downloadBlob(new Blob([out.buffer],{type:'video/MP2V'}),'images-'+M2V.imgs.length+'pic.m2v');
    m2vLog('تم! الحجم '+out.length.toLocaleString('en-US')+' بايت — نزل الملف','opok');
    for(let i=0;i<M2V.imgs.length;i++){ try{ff.FS('unlink','img'+String(i).padStart(3,'0')+'.jpg');}catch(e){} }
    try{ff.FS('unlink','out.m2v');}catch(e){}
  }catch(e){
    m2vLog('فشل التحويل: '+e.message,'operr');
  }
  M2V.busy=false;
}
/* ---------- arabize channel names (offline dictionary + transliteration) ---------- */
const ARZ={
  names:{
    'AL JAZEERA':'الجزيرة','ALJAZEERA':'الجزيرة','AL ARABIYA':'العربية','ALARABIYA':'العربية',
    'AL HADATH':'الحدث','ALHADATH':'الحدث','SKY NEWS ARABIA':'سكاي نيوز عربية','BBC ARABIC':'بي بي سي عربية',
    'FRANCE 24':'فرانس 24','FRANCE24':'فرانس 24','AL HURRA':'الحرة','ALHURRA':'الحرة',
    'RT ARABIC':'روسيا اليوم','RUSSIA TODAY':'روسيا اليوم','TRT ARABIC':'تي آر تي عربية','CGTN ARABIC':'سي جي تي إن عربية',
    'MBC':'إم بي سي','MBC 1':'إم بي سي 1','MBC 2':'إم بي سي 2','MBC 3':'إم بي سي 3','MBC 4':'إم بي سي 4',
    'MBC DRAMA':'إم بي سي دراما','MBC ACTION':'إم بي سي أكشن','MBC BOLLYWOOD':'إم بي سي بوليوود',
    'ROTANA':'روتانا','ROTANA CINEMA':'روتانا سينما','ROTANA KHALIJIAH':'روتانا خليجية','ROTANA MUSIC':'روتانا موسيقى','ROTANA DRAMA':'روتانا دراما','ROTANA CLASSIC':'روتانا كلاسيك',
    'BEIN SPORTS':'بي إن سبورتس','BEIN':'بي إن','BEIN MOVIES':'بي إن أفلام','OSN':'أو إس إن',
    'DUBAI TV':'دبي','DUBAI':'دبي','ABU DHABI':'أبوظبي','AL EMARAT':'الإمارات','SHARJAH TV':'الشارقة','SAUDI TV':'السعودية','AL SAUDIYA':'السعودية','KSA':'السعودية',
    'KUWAIT TV':'الكويت','OMAN TV':'عُمان','BAHRAIN TV':'البحرين','QATAR TV':'قطر','JORDAN TV':'الأردن','PALESTINE TV':'فلسطين','IRAQ TV':'العراق','SYRIA TV':'سوريا','AL AOULA':'الأولى','2M':'دوزيم',
    'NILE SPORT':'النيل للرياضة','NILE NEWS':'النيل للأخبار','NILE DRAMA':'النيل دراما','NILE CINEMA':'النيل سينما','NILE COMEDY':'النيل كوميدي','NILE LIFE':'النيل لايف','NILE TV':'النيل',
    'ONTV':'أون تي في','ON TV':'أون تي في','ON DRAMA':'أون دراما','ON SPORT':'أون سبورت','DMC':'دي إم سي','DMC DRAMA':'دي إم سي دراما','CBC':'سي بي سي','CBC DRAMA':'سي بي سي دراما','CBC SOFRA':'سي بي سي سفرة',
    'SADA EL BALAD':'صدى البلد','SADAH EL BALAD':'صدى البلد','AL HAYAT':'الحياة','ALHAYAT':'الحياة','AL KAHERA WAL NAS':'القاهرة والناس','AL QAHERA':'القاهرة','TEBA':'طيبة','AL TANIA':'الثانية','AL OULA':'الأولى',
    'AL RAHMA':'الرحمة','AL MAJD':'المجد','AL MAJD QURAN':'المجد قرآن','IQRA':'اقرأ','IQRAA':'اقرأ','AL RESALAH':'الرسالة','AL NAS':'الناس','AL HAFIZ':'الحافظ','AL FATH':'الفتح','AL SIRA':'السيرة','MAJD':'المجد',
    'AL WATAN':'الوطن','MEHWAR':'المحور','AL MEHWAR':'المحور','TEN TV':'تن','AL AHRAM':'الأهرام','MASR':'مصر','AL MASRY':'المصري','ZEE AFLAM':'زي أفلام','ZEE ALWAN':'زي ألوان',
    'PANORAMA DRAMA':'بانوراما دراما','PANORAMA':'بانوراما','MAZZIKA':'مزيكا','MELODY':'ميلودي','4SHABAB':'فور شباب','FREE TV':'فري تي في','CAIRO DRAMA':'القاهرة دراما','CAIRO CINEMA':'القاهرة سينما','TIME DRAMA':'تايم دراما','CINEMA PRO':'سينما برو',
    'TOYOR AL JANNAH':'طيور الجنة','TOYOR BABY':'طيور بيبي','MAJID KIDS':'ماجد للأطفال','BARAEM':'براعم','SPACETOON':'سبيستون','CARTOON NETWORK':'كرتون نتورك','CN ARABIA':'كرتون نتورك بالعربية','MBC 3':'إم بي سي 3','GULLI':'جولي','DISNEY':'ديزني','NICKELODEON':'نيكلوديون','JIMJAM':'جيم جام','DUCK TV':'داك تي في','BABY TV':'بيبي تي في',
    'ARABS GOT TALENT':'العرب جوت تالنت','AL ARAB':'العرب','AL MAYADEEN':'الميادين','AL MANAR':'المنار','AL ETEJAH':'الاتجاه','AL GHAD':'الغد','AL GHAD MUSHARAK':'الغد مشارك','AL ARABI':'العربي','ASHARQ NEWS':'الشرق للأخبار','ASHARQ':'الشرق',
    'ALGERIA TV':'الجزائر','TUNISIA TV':'تونس','NESSMA':'نسيبة','HANNIBAL':'حنبعل','ATTESSIA':'التاسعة','LIBYA TV':'ليبيا','AL AAN':'الآن','LBC':'إل بي سي','MTV LEBANON':'إم تي في لبنان','FUTURE TV':'المستقبل','NBN':'إن بي إن','TELE LUMIERE':'تيلي لوميير','NOUR SAT':'نور سات'
  },
  words:{
    'SAUDI':'السعودية','SAUDIA':'السعودية','CH':'قناة','FOR':'لـ','KAREEM':'الكريم','KARIM':'الكريم','SHARJAH':'الشارقة','QATAR':'قطر','MAJD3':'المجد 3','KSA':'السعودية','ALMAJD':'المجد','HOLY':'المبارك','MADINA':'المدينة','MAKKAH':'مكة','MECCA':'مكة','AZHAR':'الأزهر','ZAD':'زاد','WESAL':'وصال','HEKMA':'حكمة','SEHA':'صحة','SCHOOL':'مدرسة','EDUCATION':'تعليم','UNIVERSITY':'جامعة','KING':'الملك','ROYAL':'الملكي',    'NEWS':'نيوز','SPORT':'سبورت','SPORTS':'سبورت','MOVIE':'موفي','MOVIES':'موفيز','CINEMA':'سينما','MUSIC':'ميوزيك',
    'KIDS':'كيدز','BABY':'بيبي','DRAMA':'دراما','SERIES':'مسلسلات','COMEDY':'كوميدي','ACTION':'أكشن','CLASSIC':'كلاسيك',
    'WORLD':'وورلد','INTERNATIONAL':'إنترناشيونال','NATIONAL':'ناشيونال','GENERAL':'عامة','PUBLIC':'العامة','EDUCATIONAL':'تعليمية','CULTURE':'ثقافة','CULTURAL':'ثقافية','DOCUMENTARY':'وثائقية','DOCU':'دوكيو',
    'QURAN':'قرآن','KORAN':'قرآن','SUNNAH':'سنة','SUNNA':'سنة','ISLAMIC':'إسلامية','RELIGIOUS':'دينية','FATWA':'فتوى',
    'TV':'تلفزيون','SAT':'سات','CHANNEL':'قناة','RADIO':'إذاعة','FM':'إف إم','LIVE':'لايف','PLUS':'بلس','MAX':'ماكس','PRIME':'برايم','TOP':'توب','STAR':'ستار','STARS':'ستارز','MEDIA':'ميديا','NETWORK':'نتورك','BROADCAST':'بث',
    'ARABIA':'أرابيا','ARAB':'عرب','GULF':'الخليج','AFRICA':'أفريقيا','EUROPE':'أوروبا','AMERICA':'أمريكا','ASIA':'آسيا','ORIENT':'الشرق','EAST':'إيست','WEST':'ويست','NORTH':'نورث','SOUTH':'ساوث',
    'ONE':'1','TWO':'2','THREE':'3','FOUR':'4','FIVE':'5','SIX':'6','SEVEN':'7','EIGHT':'8','NINE':'9','TEN':'10',
    'AL':'ال','EL':'ال','BIN':'بن','BEN':'بن','ABU':'أبو','IBN':'ابن','NOOR':'نور','NOUR':'نور','NILE':'النيل','MISR':'مصر','EGYPT':'مصر','CAIRO':'القاهرة','ALEX':'الإسكندرية'
  }
};
function arzTransliterate(w){
  const map=[['sch','ش'],['tch','تش'],['sh','ش'],['ch','تش'],['th','ث'],['kh','خ'],['gh','غ'],['dh','ذ'],['ph','ف'],['aa','ا'],['ee','ي'],['oo','و'],['ou','و'],['ai','اي'],['ay','اي'],['ie','ي'],['qu','كو'],['ck','ك'],
  ['a','ا'],['b','ب'],['c','ك'],['d','د'],['e','ي'],['f','ف'],['g','ج'],['h','ه'],['i','ي'],['j','ج'],['k','ك'],['l','ل'],['m','م'],['n','ن'],['o','و'],['p','ب'],['q','ك'],['r','ر'],['s','س'],['t','ت'],['u','و'],['v','ف'],['w','و'],['x','كس'],['y','ي'],['z','ز']];
  let s=w.toLowerCase(), out='';
  while(s.length){
    let m=null;
    for(const pair of map){ if(s.startsWith(pair[0])){ m=pair; break; } }
    if(m){ out+=m[1]; s=s.slice(m[0].length); } else { s=s.slice(1); }
  }
  return out||w;
}
function arzTranslate(name){
  const clean=name.trim().replace(/[._]+/g,' ').replace(/\s+/g,' ');
  const upper=clean.toUpperCase();
  if(ARZ.names[upper]) return {text:ARZ.names[upper], conf:100, method:'name'};
  const compact=upper.replace(/\s/g,'');
  if(ARZ.names[compact]) return {text:ARZ.names[compact], conf:100, method:'name'};
  const toks=upper.split(/[\s\-\/\+]+/).filter(t=>t&&t!=='HD'&&t!=='SD'&&t!=='FHD'&&t!=='UHD');
  const suffix=(/\bU?F?HD\b/.test(upper)||/\bHD\b/.test(upper))?' HD':'';
  if(!toks.length) return {text:'', conf:0, method:'none'};
  let hit=0, parts=[];
  for(const t of toks){
    if(ARZ.words[t]){ parts.push(ARZ.words[t]); hit++; }
    else if(ARZ.names[t]){ parts.push(ARZ.names[t]); hit++; }
    else if(/^\d+$/.test(t)){ parts.push(t); hit++; }
    else parts.push(arzTransliterate(t));
  }
  const conf=Math.round(100*hit/toks.length);
  return {text:parts.join(' ')+suffix, conf, method:conf===100?'words':'mixed'};
}
function arzIsLatin(name){ const t=(name||'').trim(); return /[A-Za-z]/.test(t) && !/[\u0600-\u06FF]/.test(t); }
/* ---------- arabize apply + transponder/channel add ---------- */
LAB.arabize=null;
function arzScan(){
  if(!LAB.sqlDb) return;
  const nm=LAB.sqlCols.find(c=>/name/i.test(c.name));
  if(!nm){ toast('مفيش عمود اسم في الجدول ده'); return; }
  const r=LAB.sqlDb.exec('SELECT rowid, "'+nm.name+'" FROM "'+LAB.sqlTable+'"');
  const list=[];
  if(r[0]) for(const row of r[0].values){
    const old=String(row[1]||'');
    if(!arzIsLatin(old)) continue;
    const tr=arzTranslate(old);
    if(!tr.text||tr.text===old) continue;
    list.push({rowid:row[0], old, nw:tr.text, conf:tr.conf, sel:tr.conf>=60});
  }
  LAB.arabize={col:nm.name, list};
  if(!list.length){ toast('مفيش أسماء إنجليزية محتاجة تعريب في الجدول ده'); LAB.arabize=null; }
  render();
}
function arzToggle(i){ if(LAB.arabize&&LAB.arabize.list[i]) LAB.arabize.list[i].sel=!LAB.arabize.list[i].sel; render(); }
function arzSetAll(v){ if(LAB.arabize) LAB.arabize.list.forEach(r=>r.sel=v); render(); }
function arzApply(){
  if(!LAB.arabize||!LAB.sqlDb) return;
  const sel=LAB.arabize.list.filter(r=>r.sel);
  if(!sel.length){ toast('اختار قناة واحدة على الأقل'); return; }
  const col=LAB.arabize.col;
  const changes=[];
  try{
    for(const r of sel){
      LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=? WHERE rowid=?',[r.nw,r.rowid]);
      changes.push({rowid:r.rowid, old:r.old});
    }
    const v=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
    if(v!=='ok'){
      for(const c of changes) try{ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET "'+col+'"=? WHERE rowid=?',[c.old,c.rowid]); }catch(e){}
      toast('فشل فحص السلامة — التعريب اتراجع تلقائياً');
      LAB.arabize=null; labSqlLoadRows(); labChecks(); render(); return;
    }
    labPushOp('تعريب '+sel.length+' اسم قناة في "'+LAB.sqlTable+'.'+col+'"', {kind:'sqlarabize', col, changes});
    toast('اتعرّب '+sel.length+' اسم');
  }catch(e){ toast('فشل: '+e.message); }
  LAB.arabize=null; labSqlLoadRows(); labChecks(); render();
}
function labTpAdd(satId, freqMhz, pol, srKsym){
  if(!LAB.sqlDb) return;
  const f=parseFloat(freqMhz), sr=parseInt(srKsym,10);
  if(!(f>=3000&&f<=15000)){ toast('التردد لازم يكون بين 3000 و 15000 ميجاهرتز'); return; }
  if(!(sr>=1000&&sr<=45000)){ toast('معدل الترميز لازم يكون بين 1000 و 45000'); return; }
  try{
    const has=LAB.sqlDb.exec('SELECT COUNT(*) FROM ts_table WHERE freq='+Math.round(f*1000)+' AND db_sat_para_id='+satId)[0].values[0][0];
    if(has>0){ toast('التردد ده موجود بالفعل على القمر ده'); return; }
    const mx=LAB.sqlDb.exec('SELECT MAX(db_id), MAX(ts_id) FROM ts_table')[0].values[0];
    const nid=(mx[0]||0)+1, nts=(mx[1]||0)+1;
    LAB.sqlDb.run('INSERT INTO ts_table (db_id, src, db_net_id, ts_id, freq, symb, db_sat_para_id, polar) VALUES (?,3,1,?,?,?,?,?)',
      [nid, nts, Math.round(f*1000), sr*1000, satId, pol]);
    labPushOp('إضافة تردد جديد: '+f+' MHz / SR '+sr+' على قمر #'+satId+' (ts id '+nid+')',
      {kind:'sqldelrows', table:'ts_table', ids:[nid]});
    const v=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
    if(v!=='ok'){ LAB.sqlDb.run('DELETE FROM ts_table WHERE db_id=?',[nid]); LAB.ops.pop(); toast('فشل فحص السلامة — اتراجع'); }
    else toast('اتضاف التردد');
  }catch(e){ toast('فشل: '+e.message); }
  labChecks(); render();
}
function labChAdd(tsDbId, name, sid, stype){
  if(!LAB.sqlDb) return;
  name=(name||'').trim();
  if(!name){ toast('اكتب اسم القناة'); return; }
  const s=parseInt(sid,10);
  if(!(s>0&&s<65536)){ toast('رقم الخدمة (SID) لازم يكون بين 1 و 65535'); return; }
  try{
    const ts=LAB.sqlDb.exec('SELECT db_sat_para_id FROM ts_table WHERE db_id='+tsDbId);
    if(!ts[0]||!ts[0].values.length){ toast('التردد مش موجود'); return; }
    const satId=ts[0].values[0][0];
    const dup=LAB.sqlDb.exec('SELECT COUNT(*) FROM srv_table WHERE service_id='+s+' AND db_ts_id='+tsDbId)[0].values[0][0];
    if(dup>0){ toast('فيه قناة بنفس الـ SID على التردد ده'); return; }
    const mx=LAB.sqlDb.exec('SELECT MAX(db_id), MAX(chan_num) FROM srv_table')[0].values[0];
    const nid=(mx[0]||0)+1, nch=(mx[1]||0)+1;
    LAB.sqlDb.run('INSERT INTO srv_table (db_id, src, db_net_id, db_ts_id, name, service_id, service_type, running_status, volume, chan_num, db_sat_para_id, provider_name) VALUES (?,3,1,?,?,?,?,4,50,?,?,?)',
      [nid, tsDbId, name, s, stype, nch, satId, '']);
    labPushOp('إضافة قناة "'+name+'" (SID '+s+') على تردد #'+tsDbId,
      {kind:'sqldelrows', table:'srv_table', ids:[nid]});
    const v=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
    if(v!=='ok'){ LAB.sqlDb.run('DELETE FROM srv_table WHERE db_id=?',[nid]); LAB.ops.pop(); toast('فشل فحص السلامة — اتراجع'); }
    else toast('اتضافت القناة');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
/* ---------- arabize preview + tp/channel option builders ---------- */
function arzPreviewHtml(){
  const list=LAB.arabize.list;
  const hi=list.filter(r=>r.conf>=60).length, lo=list.length-hi;
  let h='<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">'
    +'<p class="labnote">اتلاقى '+list.length+' اسم إنجليزي: '+hi+' بثقة كويسة (متعلم عليهم ✓)'+(lo?' و '+lo+' بثقة منخفضة (مش متعلم عليهم — راجعهم بنفسك قبل ما تختارهم)':'')+'.</p>'
    +'<div class="btnrow" style="margin-bottom:8px">'
    +'<button type="button" class="btn sm btn-sec" id="arzAll">تحديد الكل</button>'
    +'<button type="button" class="btn sm btn-ghost" id="arzNone">إلغاء الكل</button>'
    +'<button type="button" class="btn sm btn-primary" id="arzApply">تطبيق المحدد</button>'
    +'<button type="button" class="btn sm btn-ghost" id="arzCancel">إلغاء</button></div>'
    +'<div class="labops" style="max-height:300px">';
  list.forEach((r,i)=>{
    const badge=r.conf>=100?'🟢':r.conf>=60?'🟡':'🔴';
    h+='<div class="chrow" style="grid-template-columns:auto 1fr 1fr auto">'
      +'<span>'+badge+'</span>'
      +'<span dir="ltr" style="font-size:12.5px;text-align:left;overflow:hidden;text-overflow:ellipsis">'+esc(r.old)+'</span>'
      +'<span style="font-size:12.5px">'+esc(r.nw)+'</span>'
      +'<button type="button" class="btn sm '+(r.sel?'btn-primary':'btn-ghost')+'" data-arz="'+i+'">'+(r.sel?'عربي':'إنجليزي')+'</button></div>';
  });
  h+='</div></div>';
  return h;
}
function labSatOptions(){
  try{
    const r=LAB.sqlDb.exec('SELECT p.db_id, p.sat_name FROM sat_para_table p ORDER BY (SELECT COUNT(*) FROM srv_table s WHERE s.db_sat_para_id=p.db_id) DESC, p.sat_name');
    if(!r[0]) return '';
    return r[0].values.map(v=>'<option value="'+v[0]+'">'+esc(String(v[1]||('قمر '+v[0])))+'</option>').join('');
  }catch(e){ return ''; }
}
function labTsOptions(){
  try{
    const r=LAB.sqlDb.exec('SELECT t.db_id, t.freq, t.polar, t.symb, s.sat_name FROM ts_table t LEFT JOIN sat_para_table s ON s.db_id=t.db_sat_para_id ORDER BY t.freq LIMIT 400');
    if(!r[0]) return '';
    return r[0].values.map(v=>'<option value="'+v[0]+'">'+(v[1]/1000)+' '+(v[2]?'V':'H')+' '+(v[3]/1000)+' — '+esc(String(v[4]||''))+'</option>').join('');
  }catch(e){ return ''; }
}
/* ---------- favorites ---------- */
function labHasFavCol(){ return LAB.sqlCols.some(c=>/^favor$/i.test(c.name)); }
function labFavToggle(rowid, cur){
  if(!LAB.sqlDb) return;
  const nv=cur?0:1;
  try{
    LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET favor=? WHERE rowid=?',[nv,rowid]);
    labPushOp((nv?'إضافة لـ':'إزالة من')+' المفضلة (سطر '+rowid+')',
      {kind:'sql', sql:'UPDATE "'+LAB.sqlTable+'" SET favor=? WHERE rowid=?', params:[cur,rowid]});
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
function labFavBulk(setVal){
  if(!LAB.sqlDb) return;
  try{
    const before=LAB.sqlDb.exec('SELECT rowid, favor FROM "'+LAB.sqlTable+'" WHERE favor='+(setVal?0:1));
    const rows=before[0]?before[0].values:[];
    if(!rows.length){ toast(setVal?'مفيش قناة بره المفضلة':'المفضلة فاضية أصلاً'); return; }
    LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET favor=?',[setVal]);
    labPushOp((setVal?'إضافة كل القنوات للمفضلة':'تفريغ المفضلة')+' ('+rows.length+' سطر)',
      {kind:'sqlarabize', col:'favor', changes:rows.map(r=>({rowid:r[0], old:r[1]}))});
    toast('تم');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
/* ---------- drag reorder + renumber ---------- */
LAB.grpView=null;
function labHasChanNum(){ return LAB.sqlCols.some(c=>/^chan_num$/i.test(c.name)); }
function labMoveRow(dragRowid, targetRowid){
  if(!LAB.sqlDb) return;
  if(!labHasChanNum()){ toast('الجدول ده مفيهوش ترقيم قنوات'); return; }
  if(LAB.sqlSearch||LAB.favOnly||LAB.grpView){ toast('الترتيب بالسحب شغال في العرض الكامل بس — امسح البحث والفلاتر الأول'); return; }
  if(dragRowid===targetRowid) return;
  try{
    const r=LAB.sqlDb.exec('SELECT rowid FROM "'+LAB.sqlTable+'" ORDER BY chan_num, rowid');
    const ids=r[0].values.map(v=>v[0]);
    const from=ids.indexOf(dragRowid), to=ids.indexOf(targetRowid);
    if(from<0||to<0) return;
    ids.splice(to,0,ids.splice(from,1)[0]);
    const lo=Math.min(from,to), hi=Math.max(from,to);
    const changes=[];
    for(let i=lo;i<=hi;i++){
      const old=LAB.sqlDb.exec('SELECT chan_num FROM "'+LAB.sqlTable+'" WHERE rowid='+ids[i])[0].values[0][0];
      const nw=i+1;
      if(old!==nw){ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET chan_num=? WHERE rowid=?',[nw,ids[i]]); changes.push({rowid:ids[i], old}); }
    }
    if(changes.length) labPushOp('نقل قناة من رقم '+(from+1)+' لرقم '+(to+1)+' ('+changes.length+' إعادة ترقيم)',{kind:'sqlarabize', col:'chan_num', changes});
    toast('تم النقل');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
/* ---------- mobile step move (▲▼) ---------- */
function labMoveStep(rowid, dir){
  if(!LAB.sqlDb||!labHasChanNum()) return;
  if(LAB.sqlSearch||LAB.favOnly||LAB.grpView){ toast('الأسهم شغالة في العرض الكامل بس — امسح البحث والفلاتر الأول'); return; }
  try{
    const r=LAB.sqlDb.exec('SELECT rowid FROM "'+LAB.sqlTable+'" ORDER BY chan_num, rowid');
    const ids=r[0].values.map(v=>v[0]);
    const i=ids.indexOf(rowid), j=i+dir;
    if(i<0) return;
    if(j<0||j>=ids.length){ toast(dir<0?'دي أول قناة في القائمة':'دي آخر قناة في القائمة'); return; }
    ids.splice(j,0,ids.splice(i,1)[0]);
    const lo=Math.min(i,j), hi=Math.max(i,j);
    const changes=[];
    for(let k=lo;k<=hi;k++){
      const old=LAB.sqlDb.exec('SELECT chan_num FROM "'+LAB.sqlTable+'" WHERE rowid='+ids[k])[0].values[0][0];
      const nw=k+1;
      if(old!==nw){ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET chan_num=? WHERE rowid=?',[nw,ids[k]]); changes.push({rowid:ids[k], old}); }
    }
    if(changes.length) labPushOp('نقل قناة خطوة '+(dir<0?'لفوق':'لتحت')+' ('+changes.length+' إعادة ترقيم)',{kind:'sqlarabize', col:'chan_num', changes});
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
/* ---------- channel technical details panel + experimental picons ---------- */
LAB.piconIdx=null; LAB.piconIdxState='idle';
const PICONS_RAW='https://raw.githubusercontent.com/picons/picons/master/build-source/';
async function labPiconLoadIndex(){
  if(LAB.piconIdx) return LAB.piconIdx;
  if(LAB.piconIdxState==='loading') return null;
  LAB.piconIdxState='loading';
  try{
    const resp=await fetch(PICONS_RAW+'utf8snp.index');
    if(!resp.ok) throw new Error('http '+resp.status);
    const txt=await resp.text();
    const map={};
    txt.split('\n').forEach(l=>{
      const eq=l.indexOf('=');
      if(eq>0) map[l.slice(0,eq).trim()]=l.slice(eq+1).trim();
    });
    LAB.piconIdx=map;
    LAB.piconIdxState='ok';
  }catch(e){ LAB.piconIdx={}; LAB.piconIdxState='fail'; }
  return LAB.piconIdx;
}
function labPiconNorm(name){
  return String(name||'').toLowerCase().trim().replace(/[<>:"\/\\|?*]/g,'').replace(/\s+/g,' ').replace(/\.+$/,'').trim();
}
function labPiconCandidates(name){
  const idx=LAB.piconIdx||{};
  const n=labPiconNorm(name);
  if(!n) return {logo:null, urls:[]};
  const keys=[n];
  if(/\shd$/.test(n)) keys.push(n.replace(/\shd$/,''));
  else keys.push(n+' hd');
  let logo=null;
  for(const k of keys){ if(idx[k]){ logo=idx[k]; break; } }
  if(!logo) return {logo:null, urls:[]};
  const base=PICONS_RAW+'logos/'+logo;
  return {logo, urls:[base+'.default.png', base+'.default.svg', base+'.light.png', base+'.light.svg']};
}
function labPiconProbe(urls){
  return new Promise(res=>{
    let i=0;
    const tryNext=()=>{
      if(i>=urls.length){ res(null); return; }
      const u=urls[i++];
      const img=new Image();
      img.onload=()=>res(u);
      img.onerror=tryNext;
      img.src=u;
    };
    tryNext();
  });
}
async function labPiconShow(name, boxId){
  const box=document.getElementById(boxId);
  if(!box) return;
  box.innerHTML='<span style="color:var(--mut);font-size:12px">بيجهّز فهرس الشعارات…</span>';
  const idx=await labPiconLoadIndex();
  if(!document.getElementById(boxId)) return;
  if(LAB.piconIdxState==='fail'){ box.innerHTML='<span style="color:var(--mut);font-size:12px">مش قادر أحمّل فهرس الشعارات (محتاج نت).</span>'; return; }
  const c=labPiconCandidates(name);
  if(!c.logo){ box.innerHTML='<span style="color:var(--mut);font-size:12px">مفيش شعار متطابق مع الاسم ده في الفهرس.</span>'; return; }
  box.innerHTML='<span style="color:var(--mut);font-size:12px">بيدوّر على الشعار…</span>';
  const url=await labPiconProbe(c.urls);
  if(!document.getElementById(boxId)) return;
  if(!url){ box.innerHTML='<span style="color:var(--mut);font-size:12px">الفهرس عارف القناة ('+esc(c.logo)+') بس ملف الشعار مش متاح.</span>'; return; }
  box.innerHTML='<img src="'+url+'" alt="شعار" style="max-height:64px;max-width:180px;background:#fff;border-radius:8px;padding:6px">'
    +'<div class="btnrow" style="margin-top:6px"><button type="button" class="btn sm btn-sec" id="piconDl">تحميل الشعار</button></div>';
  const dl=document.getElementById('piconDl');
  if(dl) dl.addEventListener('click',async()=>{
    try{
      const b=await (await fetch(url)).blob();
      const ext=url.slice(url.lastIndexOf('.')+1);
      downloadBlob(b, c.logo+'.'+ext);
    }catch(e){ toast('فشل تحميل الشعار'); }
  });
}
function labShowInfo(rowid){
  if(!LAB.sqlDb){ toast('افتح ملف SQLite الأول'); return; }
  let srv;
  try{
    const r=LAB.sqlDb.exec('SELECT * FROM "'+LAB.sqlTable+'" WHERE rowid='+rowid);
    if(!r[0]||!r[0].values.length){ toast('السطر مش موجود'); return; }
    srv={}; r[0].columns.forEach((c,i)=>srv[c]=r[0].values[0][i]);
  }catch(e){ toast('فشل: '+e.message); return; }
  const SR_LABELS={db_id:'المعرف الداخلي',service_id:'رقم الخدمة (SID)',name:'اسم القناة',chan_num:'رقم القناة في القائمة',service_type:'النوع',favor:'مفضلة',db_ts_id:'معرف التردد',db_sat_para_id:'معرف القمر',lcn:'LCN',casys_flag:'علامة التشفير',v_pid:'PID الفيديو',a_pid:'PID الصوت',pmt_pid:'PID الـ PMT',pcr_pid:'PCR PID',provider:'المزود',lock:'قفل',skip:'تخطي'};
  let h='<div id="piconBox" style="margin-bottom:10px;min-height:30px"></div>';
  h+='<div class="labnote" style="margin-bottom:6px">الشعار أعلاه تجريبي: بيدوّر بالاسم في مستودع picons العام، وممكن يكون غلط أو مش موجود — معاينة بس، مش بيتخزن في الملف.</div>';
  h+='<table style="width:100%;border-collapse:collapse;font-size:13px">';
  Object.keys(srv).forEach(c=>{
    let v=srv[c];
    let lbl=SR_LABELS[c.toLowerCase()]||c;
    if(c==='service_type') v=(v===1?'1 — قناة TV':v===2?'2 — إذاعة':String(v));
    if(c==='favor') v=(v?'نعم ★':'لا');
    h+='<tr><td style="padding:4px 6px;color:var(--mut);border-bottom:1px solid var(--line);white-space:nowrap">'+esc(lbl)+'</td>'
      +'<td style="padding:4px 6px;border-bottom:1px solid var(--line);word-break:break-all" dir="auto">'+esc(String(v==null?'':v))+'</td></tr>';
  });
  h+='</table>';
  // التردد والقمر
  try{
    const ts=LAB.sqlDb.exec('SELECT t.freq, t.polar, t.symb, t.ts_id, s.sat_name FROM ts_table t LEFT JOIN sat_para_table s ON s.db_id=t.db_sat_para_id WHERE t.db_id=?',[srv.db_ts_id]);
    if(ts[0]&&ts[0].values.length){
      const t=ts[0].values[0];
      h+='<h3 style="margin:12px 0 4px;font-size:14px">التردد</h3><table style="width:100%;border-collapse:collapse;font-size:13px">'
        +'<tr><td style="padding:4px 6px;color:var(--mut);border-bottom:1px solid var(--line)">التردد</td><td style="padding:4px 6px;border-bottom:1px solid var(--line)" dir="ltr">'+(t[0]/1000)+' MHz '+(t[1]?'V':'H')+'</td></tr>'
        +'<tr><td style="padding:4px 6px;color:var(--mut);border-bottom:1px solid var(--line)">معدل الترميز</td><td style="padding:4px 6px;border-bottom:1px solid var(--line)" dir="ltr">'+(t[2]/1000)+'</td></tr>'
        +'<tr><td style="padding:4px 6px;color:var(--mut);border-bottom:1px solid var(--line)">TS ID</td><td style="padding:4px 6px;border-bottom:1px solid var(--line)" dir="ltr">'+t[3]+'</td></tr>'
        +'<tr><td style="padding:4px 6px;color:var(--mut)">القمر</td><td style="padding:4px 6px">'+esc(String(t[4]||''))+'</td></tr></table>';
    }
  }catch(e){}
  // الجروبات اللي القناة فيها
  try{
    const gr=LAB.sqlDb.exec('SELECT g.name FROM grp_table g JOIN grp_map_table m ON m.db_grp_id=g.db_id WHERE m.db_srv_id=?',[srv.db_id]);
    if(gr[0]&&gr[0].values.length){
      h+='<h3 style="margin:12px 0 4px;font-size:14px">الباقات</h3><div style="font-size:13px">'+gr[0].values.map(v=>esc(String(v[0]))).join(' · ')+'</div>';
    }
  }catch(e){}
  openModal('تفاصيل القناة: '+esc(String(srv.name||'')), h, null, null);
  labPiconShow(String(srv.name||''), 'piconBox');
}
function labMoveSelected(targetPos){
  if(!LAB.sqlDb||!labHasChanNum()) return;
  const sel=LAB.selection;
  if(!sel||!sel.size){ toast('حدد قنوات الأول بمربعات التحديد'); return; }
  targetPos=parseInt(targetPos,10);
  if(!targetPos||targetPos<1){ toast('اكتب رقم الموضع المطلوب'); return; }
  if(LAB.sqlSearch||LAB.favOnly||LAB.grpView){ toast('النقل بالمجموعة شغال في العرض الكامل بس — امسح البحث والفلاتر الأول'); return; }
  try{
    const r=LAB.sqlDb.exec('SELECT rowid FROM "'+LAB.sqlTable+'" ORDER BY chan_num, rowid');
    const ids=r[0].values.map(v=>v[0]);
    const total=ids.length;
    if(targetPos>total) targetPos=total;
    const moving=ids.filter(id=>sel.has(id));
    if(!moving.length){ toast('التحديد مش في الجدول ده'); return; }
    const rest=ids.filter(id=>!sel.has(id));
    // في الترقيم الجديد، أول قناة في المجموعة تاخد رقم الموضع المطلوب بالظبط
    const at=Math.max(0,Math.min(rest.length, targetPos-1));
    const merged=rest.slice(0,at).concat(moving, rest.slice(at));
    const changes=[];
    merged.forEach((id,i)=>{
      const old=LAB.sqlDb.exec('SELECT chan_num FROM "'+LAB.sqlTable+'" WHERE rowid='+id)[0].values[0][0];
      const nw=i+1;
      if(old!==nw){ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET chan_num=? WHERE rowid=?',[nw,id]); changes.push({rowid:id, old}); }
    });
    if(changes.length) labPushOp('نقل '+moving.length+' قناة للموضع '+targetPos+' ('+changes.length+' إعادة ترقيم)',{kind:'sqlarabize', col:'chan_num', changes});
    LAB.selection=new Set();
    toast('اتنقل '+moving.length+' قناة');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}
function labGrpAddRows(grpId, rowids){
  if(!LAB.sqlDb||!grpId||!rowids||!rowids.length){ toast('مفيش قنوات محددة'); return; }
  try{
    const exists=LAB.sqlDb.exec('SELECT COUNT(*) FROM grp_table WHERE db_id=?',[grpId])[0].values[0][0];
    if(!exists){ toast('الجروب مش موجود'); return; }
    const idsToDel=[];
    let added=0, dup=0;
    const maxId=LAB.sqlDb.exec('SELECT COALESCE(MAX(db_id),0) FROM grp_map_table')[0].values[0][0];
    let nid=maxId;
    rowids.forEach(rid=>{
      const srv=LAB.sqlDb.exec('SELECT db_id FROM srv_table WHERE rowid='+rid);
      if(!srv.length||!srv[0].values.length) return;
      const srvId=srv[0].values[0][0];
      const isDup=LAB.sqlDb.exec('SELECT COUNT(*) FROM grp_map_table WHERE db_grp_id=? AND db_srv_id=?',[grpId,srvId])[0].values[0][0];
      if(isDup){ dup++; return; }
      nid++;
      LAB.sqlDb.run('INSERT INTO grp_map_table (db_id, db_srv_id, db_grp_id, service_type) VALUES (?,?,?,1)',[nid,srvId,grpId]);
      idsToDel.push(nid); added++;
    });
    if(added) labPushOp('إضافة '+added+' قناة للجروب'+(dup?' ('+dup+' موجودين أصلاً)':''),{kind:'sqldelrows', table:'grp_map_table', ids:idsToDel});
    toast('اتضاف '+added+(dup?'، '+dup+' كانوا موجودين':''));
  }catch(e){ toast('فشل: '+e.message); }
  labChecks(); render();
}
function labRenumberAll(){
  if(!LAB.sqlDb||!labHasChanNum()) return;
  openModal('إعادة ترقيم شاملة','<p>هيتم إعادة ترقيم كل القنوات من ١ للنهاية حسب الترتيب الحالي. الأرقام القديمة هتتغير كلها (مع تراجع متاح). متأكد؟</p>','نعم، رقّم',()=>{
    try{
      const r=LAB.sqlDb.exec('SELECT rowid, chan_num FROM "'+LAB.sqlTable+'" ORDER BY chan_num, rowid');
      const changes=[];
      r[0].values.forEach((row,i)=>{
        const nw=i+1;
        if(row[1]!==nw){ LAB.sqlDb.run('UPDATE "'+LAB.sqlTable+'" SET chan_num=? WHERE rowid=?',[nw,row[0]]); changes.push({rowid:row[0], old:row[1]}); }
      });
      if(changes.length){ labPushOp('إعادة ترقيم شاملة ('+changes.length+' قناة)',{kind:'sqlarabize', col:'chan_num', changes}); toast('اترقّم '+changes.length); }
      else toast('الترقيم مظبوط أصلاً');
    }catch(e){ toast('فشل: '+e.message); }
    labSqlLoadRows(); labChecks(); render();
  });
}
/* ---------- groups / bouquets ---------- */
function labGrpList(){
  if(!LAB.sqlDb||LAB.sqlTables.indexOf('grp_table')<0) return [];
  try{
    const r=LAB.sqlDb.exec('SELECT g.db_id, g.name, (SELECT COUNT(*) FROM grp_map_table m WHERE m.db_grp_id=g.db_id) FROM grp_table g ORDER BY g.db_id');
    return r[0]?r[0].values.map(v=>({id:v[0], name:String(v[1]||''), count:v[2]})):[];
  }catch(e){ return []; }
}
function labGrpAdd(name){
  name=(name||'').trim();
  if(!name){ toast('اكتب اسم الجروب'); return; }
  try{
    const dup=LAB.sqlDb.exec('SELECT COUNT(*) FROM grp_table WHERE name=?',[name])[0].values[0][0];
    if(dup){ toast('فيه جروب بنفس الاسم'); return; }
    const nid=LAB.sqlDb.exec('SELECT MAX(db_id) FROM grp_table')[0].values[0][0]+1;
    LAB.sqlDb.run('INSERT INTO grp_table (db_id, name, grp_reserveInt1) VALUES (?,?,1)',[nid,name]);
    labPushOp('إنشاء جروب "'+name+'"',{kind:'sqldelrows', table:'grp_table', ids:[nid]});
    toast('اتعمل الجروب');
  }catch(e){ toast('فشل: '+e.message); }
  labChecks(); render();
}
function labGrpRename(id, name){
  name=(name||'').trim(); if(!name) return;
  try{
    const old=LAB.sqlDb.exec('SELECT name FROM grp_table WHERE db_id=?',[id])[0].values[0][0];
    LAB.sqlDb.run('UPDATE grp_table SET name=? WHERE db_id=?',[name,id]);
    labPushOp('إعادة تسمية جروب "'+old+'" ← "'+name+'"',{kind:'sql', sql:'UPDATE grp_table SET name=? WHERE db_id=?', params:[old,id]});
    toast('تم');
  }catch(e){ toast('فشل: '+e.message); }
  labChecks(); render();
}
function labGrpDel(id){
  const g=labGrpList().find(x=>x.id===id);
  openModal('حذف جروب','<p>هيتم حذف جروب "'+esc(g?g.name:id)+'" وكل القنوات المسجلة فيه (القنوات نفسها مش هتتمسح من الملف). متأكد؟</p>','نعم، احذف',()=>{
    try{
      const gRow=LAB.sqlDb.exec('SELECT * FROM grp_table WHERE db_id=?',[id])[0];
      const mRows=LAB.sqlDb.exec('SELECT * FROM grp_map_table WHERE db_grp_id=?',[id])[0];
      const undo=[];
      LAB.sqlDb.run('DELETE FROM grp_map_table WHERE db_grp_id=?',[id]);
      LAB.sqlDb.run('DELETE FROM grp_table WHERE db_id=?',[id]);
      if(gRow&&gRow.values.length){ const v=gRow.values[0]; undo.push(['INSERT INTO grp_table VALUES ('+v.map(()=>'?').join(',')+')', Array.from(v)]); }
      if(mRows) for(const v of mRows.values) undo.push(['INSERT INTO grp_map_table VALUES ('+v.map(()=>'?').join(',')+')', Array.from(v)]);
      labPushOp('حذف جروب "'+(g?g.name:id)+'"',{kind:'sqlexec', stmts:undo.reverse()});
      toast('اتحذف');
    }catch(e){ toast('فشل: '+e.message); }
    labChecks(); render();
  });
}
function labGrpAddVisible(grpId){
  if(!LAB.sqlRows.length){ toast('مفيش قنوات ظاهرة'); return; }
  try{
    let added=0; const ids=[];
    for(const r of LAB.sqlRows){
      const ex=LAB.sqlDb.exec('SELECT COUNT(*) FROM grp_map_table WHERE db_grp_id=? AND db_srv_id=?',[grpId, r.db_id??r.rowid])[0].values[0][0];
      if(ex) continue;
      const nid=LAB.sqlDb.exec('SELECT COALESCE(MAX(db_id),0)+1 FROM grp_map_table')[0].values[0][0];
      LAB.sqlDb.run('INSERT INTO grp_map_table (db_id, db_srv_id, db_grp_id, service_type) VALUES (?,?,?,?)',[nid, r.db_id??r.rowid, grpId, r.service_type||1]);
      ids.push(nid); added++;
    }
    if(added) labPushOp('إضافة '+added+' قناة للجروب #'+grpId,{kind:'sqldelrows', table:'grp_map_table', ids});
    toast(added?'اتضاف '+added+' قناة':'كل الظاهر موجود في الجروب أصلاً');
  }catch(e){ toast('فشل: '+e.message); }
  labChecks(); render();
}
function labGrpRemoveMember(grpId, srvDbId){
  try{
    const row=LAB.sqlDb.exec('SELECT * FROM grp_map_table WHERE db_grp_id=? AND db_srv_id=?',[grpId,srvDbId])[0];
    LAB.sqlDb.run('DELETE FROM grp_map_table WHERE db_grp_id=? AND db_srv_id=?',[grpId,srvDbId]);
    const undo=row&&row.values.length?[['INSERT INTO grp_map_table VALUES ('+row.values[0].map(()=>'?').join(',')+')', Array.from(row.values[0])]]:[];
    labPushOp('إزالة قناة من الجروب #'+grpId,{kind:'sqlexec', stmts:undo});
    toast('اتشالت من الجروب');
  }catch(e){ toast('فشل: '+e.message); }
  labSqlLoadRows(); labChecks(); render();
}

// ===== Channel format conversion (validated only) =====
function labConvBody(){
  if(!LAB.type) return '<p style="color:var(--mut)">افتح ملف الأول.</p>';
  const canSql=LAB.type==='sqlite'&&LAB.sqlDb&&LAB.sqlTables.indexOf('srv_table')>=0&&LAB.sqlTables.indexOf('ts_table')>=0;
  if(canSql){
    let h='<div style="font-size:12px;color:var(--mut);margin-bottom:10px">الملف المفتوح قاعدة قنوات SQLite مفهومة بالكامل — التحويلات المتاحة:</div>'
      +'<div class="btnrow" style="margin-bottom:10px">'
      +'<button type="button" class="btn btn-primary" id="expJson">تصدير JSON (صيغة ابوجبل سات)</button>'
      +'<button type="button" class="btn btn-primary" id="expCsv">تصدير CSV</button></div>'
      +'<h2 style="font-size:14px;margin:10px 0 6px">استيراد قنوات من JSON / CSV</h2>'
      +'<div style="font-size:12px;color:var(--mut);margin-bottom:8px">كل صف بيتحقق قبل الإدخال: اسم غير فاضي، تردد 3000–15000 MHz، ترميز 1000–45000، استقطاب H أو V. الصف الناقص أو الغلط بيترفض وبيظهر سببه — مفيش تخمين ولا قيم افتراضية. الناتج متحقق منه هيكليًا (فحص سلامة القاعدة)، <b>ومش مُختبر على جهاز حقيقي</b>.</div>'
      +'<div class="field"><label>القمر اللي تتسجل عليه القنوات</label><select id="impSat">'+labSatOptions()+'</select></div>'
      +'<div class="field"><label>ملف الاستيراد (.json / .csv)</label><input type="file" id="impFile" accept=".json,.csv"></div>'
      +'<button type="button" class="btn btn-gold" id="impRun">تحقق واستورد</button>'
      +'<div id="impOut" style="margin-top:10px"></div>';
    return h;
  }
  const names={trumandb:'صيغة DB(^o^) الثنائية (ترومان / مونتاج / أجهزة مشابهة)',gx6605:'صيغة GX6605 الثنائية',ali:'صيغة ALi الثنائية',bin:'صيغة ثنائية غير معروفة'};
  return '<div style="border:1px solid var(--danger);border-radius:10px;padding:12px;font-size:13px">'
    +'⛔ '+(names[LAB.type]||names.bin)+' — بنيتها الداخلية <b>غير موثقة بالكامل</b> عندنا. التحويل منها أو ليها غير متاح، لأن أي تخمين في ملف بيترفع على جهاز ممكن يعطّله. '
    +'التحويل المتاح حاليًا: قواعد SQLite المفهومة (زي ملفات بي أوت كيو) ← JSON / CSV والعكس بالاستيراد مع تحقق كامل. '
    +'لو عندك ملف من النوع ده وعايز دعمه: ابعتهولنا مع أي توثيق لموديله، وهنحلله الأول ونشوف هل نقدر نقراه كامل بثقة قبل ما ندعمه.</div>';
}
function labDl(filename, content, mime){
  const blob=new Blob([content],{type:mime||'application/octet-stream'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
}
function labExpJson(){
  if(!LAB.sqlDb) return;
  try{
    const sats=LAB.sqlDb.exec('SELECT db_id, sat_name FROM sat_para_table ORDER BY db_id')[0];
    const tps=LAB.sqlDb.exec('SELECT db_id, db_sat_para_id, freq, symb, polar FROM ts_table ORDER BY db_id')[0];
    const srvs=LAB.sqlDb.exec('SELECT db_id, name, service_id, service_type, chan_num, db_ts_id, db_sat_para_id FROM srv_table ORDER BY chan_num, db_id')[0];
    const satList=(sats?sats.values:[]).map(v=>({id:'sat'+v[0], name:String(v[1]||''), pos:''}));
    const tpList=(tps?tps.values:[]).map(v=>({id:'tp'+v[0], satId:'sat'+v[1], freq:String(Math.round(v[2]/1000)), sr:String(Math.round(v[3]/1000)), pol:(+v[4]===0?'H':'V'), prov:''}));
    const chList=(srvs?srvs.values:[]).map((v,i)=>({id:'c'+v[0], satId:'sat'+v[6], tpId:'tp'+v[5], no:+v[4]||i+1, name:String(v[1]||''), type:(+v[3]===2?'Radio':'TV'), cat:'', sid:+v[2]||0, pid:0, pmt:0, wide:false, fav:false}));
    const out={sats:satList, tps:tpList, chs:chList, fileName:'تصدير من '+(LAB.name||'ملف قنوات')+' — ابوجبل سات (متحقق هيكليًا، غير مُختبر على جهاز)', dirty:false};
    labDl((LAB.name||'channels')+'.json', JSON.stringify(out,null,1), 'application/json');
    toast('اتصدّر '+chList.length+' قناة');
  }catch(e){ toast('فشل التصدير: '+e.message); }
}
function labExpCsv(){
  if(!LAB.sqlDb) return;
  try{
    const rows=LAB.sqlDb.exec('SELECT s.name, s.service_type, t.freq, t.polar, t.symb, s.service_id, p.sat_name FROM srv_table s JOIN ts_table t ON t.db_id=s.db_ts_id JOIN sat_para_table p ON p.db_id=s.db_sat_para_id ORDER BY s.chan_num, s.db_id')[0];
    let csv='\uFEFF"الرقم","الاسم","النوع","التردد","الاستقطاب","الترميز","SID","القمر"\n';
    (rows?rows.values:[]).forEach((v,i)=>{
      const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
      csv+=[i+1,q(v[0]),(+v[1]===2?'Radio':'TV'),Math.round(v[2]/1000),(+v[3]===0?'H':'V'),Math.round(v[4]/1000),v[5],q(v[6])].join(',')+'\n';
    });
    labDl((LAB.name||'channels')+'.csv', csv, 'text/csv;charset=utf-8');
    toast('اتصدّر '+(rows?rows.values.length:0)+' قناة');
  }catch(e){ toast('فشل التصدير: '+e.message); }
}
function labParseCsvText(text){
  // CSV parser يدعم الاقتباس
  const rows=[]; let cur=[''], inQ=false, field=0, cell='';
  const push=()=>{ cur[field++]=cell; cell=''; };
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else inQ=false; }
      else cell+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===',') push();
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; push(); rows.push(cur); cur=['']; field=0; }
      else cell+=c;
    }
  }
  if(cell!==''||field>0){ push(); rows.push(cur); }
  return rows.filter(r=>r.length>1||String(r[0]).trim()!=='');
}
async function labImportRun(){
  const f=$('#impFile')&&$('#impFile').files[0];
  const out=$('#impOut');
  if(!f){ toast('اختر ملف الاستيراد الأول'); return; }
  const satId=+$('#impSat').value;
  out.innerHTML='<p style="color:var(--mut)">جاري التحقق…</p>';
  let items=[]; // {name,type,sid,freq,pol,sr}
  const skipped=[];
  try{
    const text=new TextDecoder('utf-8').decode(await f.arrayBuffer());
    if(/\.json$/i.test(f.name)){
      const d=JSON.parse(text);
      if(!d||!Array.isArray(d.chs)||!Array.isArray(d.tps)){ out.innerHTML='<p style="color:var(--danger)">ملف JSON مش بصيغة ابوجبل سات المعروفة (محتاج chs و tps).</p>'; return; }
      const tpMap={}; d.tps.forEach(t=>{ tpMap[t.id]=t; });
      d.chs.forEach((c,idx)=>{
        const tp=tpMap[c.tpId]||{};
        items.push({row:idx+1, name:String(c.name||'').trim(), type:(String(c.type||'').toLowerCase().indexOf('rad')>=0?2:1), sid:+c.sid||0, freq:String(tp.freq||''), pol:String(tp.pol||''), sr:String(tp.sr||'')});
      });
    }else{
      const rows=labParseCsvText(text);
      if(!rows.length){ out.innerHTML='<p style="color:var(--danger)">الملف فاضي أو مش CSV مفهوم.</p>'; return; }
      const head=rows[0].map(h=>String(h).replace(/[\uFEFF"\s]/g,''));
      const col=(...ns)=>head.findIndex(h=>ns.some(n=>h.indexOf(n)>=0));
      const cName=col('الاسم','name'), cFreq=col('التردد','freq'), cPol=col('الاستقطاب','pol'), cSr=col('الترميز','sr'), cType=col('النوع','type'), cSid=col('SID','sid');
      if(cName<0||cFreq<0){ out.innerHTML='<p style="color:var(--danger)">أعمدة مطلوبة مش موجودة: الاسم والتردد. الأعمدة المقبولة: الاسم، التردد، الاستقطاب، الترميز، النوع، SID.</p>'; return; }
      rows.slice(1).forEach((r,idx)=>{
        const g=i=>i>=0?String(r[i]||'').replace(/"/g,'').trim():'';
        items.push({row:idx+2, name:g(cName), type:(g(cType).toLowerCase().indexOf('rad')>=0?2:1), sid:parseInt(g(cSid),10)||0, freq:g(cFreq), pol:g(cPol), sr:g(cSr)});
      });
    }
  }catch(e){ out.innerHTML='<p style="color:var(--danger)">فشل قراءة الملف: '+esc(e.message)+'</p>'; return; }
  // تحقق صارم — مفيش قيم افتراضية
  const valid=[];
  items.forEach(it=>{
    const errs=[];
    if(!it.name) errs.push('اسم فاضي');
    if(it.name.length>100) errs.push('اسم أطول من 100 حرف');
    const fr=parseFloat(it.freq);
    if(!(fr>=3000&&fr<=15000)) errs.push('تردد "'+it.freq+'" مش في النطاق 3000–15000 MHz');
    const sr=parseInt(it.sr,10);
    if(!(sr>=1000&&sr<=45000)) errs.push('ترميز "'+it.sr+'" مش في النطاق 1000–45000');
    const pl=String(it.pol||'').trim().toUpperCase();
    let pol=-1;
    if(pl==='H'||pl==='0') pol=0; else if(pl==='V'||pl==='1') pol=1;
    if(pol<0) errs.push('استقطاب "'+it.pol+'" مش مفهوم (لازم H أو V)');
    if(it.sid&&!(it.sid>0&&it.sid<65536)) errs.push('SID "'+it.sid+'" خارج النطاق');
    if(errs.length) skipped.push({row:it.row, name:it.name||'(بدون اسم)', why:errs.join('، ')});
    else valid.push({name:it.name, type:it.type, sid:it.sid, freq:Math.round(fr*1000), pol, sr:sr*1000});
  });
  if(!valid.length){ out.innerHTML='<p style="color:var(--danger)">كل الصفوف اترفضت ('+skipped.length+'). أول سبب: '+esc(skipped[0]?skipped[0].why:'—')+'</p>'; return; }
  // الإدخال
  const addedSrv=[], addedTs=[], dups=[];
  try{
    let mxSrv=LAB.sqlDb.exec('SELECT COALESCE(MAX(db_id),0), COALESCE(MAX(chan_num),0), COALESCE(MAX(service_id),0) FROM srv_table')[0].values[0];
    let nid=mxSrv[0], nch=mxSrv[1], autoSid=mxSrv[2];
    let mxTs=LAB.sqlDb.exec('SELECT COALESCE(MAX(db_id),0), COALESCE(MAX(ts_id),0) FROM ts_table')[0].values[0];
    let nTsId=mxTs[0], nTs=mxTs[1];
    const tsCache={};
    const findTs=freq=>{
      if(tsCache[freq]!=null) return tsCache[freq];
      const r=LAB.sqlDb.exec('SELECT db_id FROM ts_table WHERE freq=? AND db_sat_para_id=?',[freq,satId]);
      if(r.length&&r[0].values.length){ tsCache[freq]=r[0].values[0][0]; return tsCache[freq]; }
      return null;
    };
    for(const v of valid){
      let tsId=findTs(v.freq);
      if(tsId==null){
        nTsId++; nTs++;
        LAB.sqlDb.run('INSERT INTO ts_table (db_id, src, db_net_id, ts_id, freq, symb, db_sat_para_id, polar) VALUES (?,3,1,?,?,?,?,?)',[nTsId,nTs,v.freq,v.sr,satId,v.pol]);
        addedTs.push(nTsId); tsCache[v.freq]=nTsId; tsId=nTsId;
      }
      let sid=v.sid;
      if(!sid){ sid=++autoSid; }
      const dup=LAB.sqlDb.exec('SELECT COUNT(*) FROM srv_table WHERE service_id=? AND db_ts_id=?',[sid,tsId])[0].values[0][0];
      if(dup>0){ dups.push(v.name+' (SID '+sid+')'); continue; }
      nid++; nch++;
      LAB.sqlDb.run('INSERT INTO srv_table (db_id, src, db_net_id, db_ts_id, name, service_id, service_type, running_status, volume, chan_num, db_sat_para_id, provider_name) VALUES (?,3,1,?,?,?,?,4,50,?,?,?)',
        [nid, tsId, v.name, sid, v.type, nch, satId, '']);
      addedSrv.push(nid);
    }
  }catch(e){ out.innerHTML='<p style="color:var(--danger)">فشل أثناء الإدخال: '+esc(e.message)+' — راجع بالتراجع</p>'; labSqlLoadRows(); labChecks(); render(); return; }
  // فحص السلامة — لو فشل نرجع كل حاجة
  const ic=LAB.sqlDb.exec('PRAGMA integrity_check')[0].values[0][0];
  if(ic!=='ok'){
    try{
      if(addedSrv.length) LAB.sqlDb.run('DELETE FROM srv_table WHERE db_id IN ('+addedSrv.join(',')+')');
      if(addedTs.length) LAB.sqlDb.run('DELETE FROM ts_table WHERE db_id IN ('+addedTs.join(',')+')');
    }catch(e){}
    out.innerHTML='<p style="color:var(--danger)">فحص سلامة القاعدة فشل بعد الإدخال — اتراجع كل حاجة تلقائيًا. الملف الأصلي سليم.</p>';
    labSqlLoadRows(); labChecks(); render(); return;
  }
  if(addedSrv.length||addedTs.length){
    const stmts=[];
    if(addedSrv.length) stmts.push(['DELETE FROM srv_table WHERE db_id IN ('+addedSrv.join(',')+')',[]]);
    if(addedTs.length) stmts.push(['DELETE FROM ts_table WHERE db_id IN ('+addedTs.join(',')+')',[]]);
    labPushOp('استيراد '+addedSrv.length+' قناة من '+f.name+' ('+addedTs.length+' تردد جديد)',{kind:'sqlexec', stmts});
  }
  let h='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:8px">'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--teal)">'+addedSrv.length+'</b><br>قناة اتضافت</div>'
    +'<div class="toolbody" style="text-align:center"><b>'+addedTs.length+'</b><br>تردد جديد</div>'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--gold)">'+dups.length+'</b><br>مكرر (اتخطّى)</div>'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--danger)">'+skipped.length+'</b><br>مرفوض بالتحقق</div></div>'
    +'<p style="font-size:12px;color:var(--mut)">فحص السلامة: سليم ✓ — الناتج متحقق هيكليًا، غير مُختبر على جهاز. فيه تراجع كامل من زرار التراجع.</p>';
  if(dups.length) h+='<p style="font-size:12px;color:var(--gold)">مكرر: '+esc(dups.slice(0,10).join('، '))+(dups.length>10?'…':'')+'</p>';
  if(skipped.length) h+='<div style="max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12px">'+skipped.slice(0,30).map(x=>'<div>صف '+x.row+': '+esc(x.name)+' — '+esc(x.why)+'</div>').join('')+(skipped.length>30?'<div>… و'+(skipped.length-30)+' تانيين</div>':'')+'</div>';
  out.innerHTML=h;
  labSqlLoadRows(); labChecks(); render();
  // رجّع النتيجة ظاهرة بعد الريندر
  const out2=$('#impOut'); if(out2) out2.innerHTML=h;
}
// ===== Compare two channel files (read-only) =====
async function labCompareFiles(){
  const f=$('#cmpFile')&&$('#cmpFile').files[0];
  const out=$('#cmpOut');
  if(!f){ toast('اختر الملف التاني الأول'); return; }
  out.innerHTML='<p style="color:var(--mut)">جاري المقارنة…</p>';
  let db2;
  try{
    const SQL=LAB.sql||await initSqlJs({locateFile:f=>'vendor/'+f});
    const buf=new Uint8Array(await f.arrayBuffer());
    db2=new SQL.Database(buf);
    db2.exec('SELECT 1 FROM srv_table LIMIT 1');
  }catch(e){ out.innerHTML='<p style="color:var(--danger)">الملف التاني مش قاعدة قنوات SQLite معروفة: '+esc(e.message)+'</p>'; return; }
  const dump=db=>{
    const m=new Map();
    const r=db.exec('SELECT service_id, name, chan_num, db_ts_id FROM srv_table');
    if(r.length) r[0].values.forEach(v=>{
      const sid=+v[0]; if(!sid) return;
      if(!m.has(sid)) m.set(sid,{name:String(v[1]||''), num:+v[2]||0, ts:+v[3]||0});
    });
    return m;
  };
  const A=dump(LAB.sqlDb), B=dump(db2);
  const added=[], removed=[], renamed=[], moved=[];
  for(const [sid,b] of B){
    if(!A.has(sid)) added.push({sid, name:b.name, num:b.num});
    else{
      const a=A.get(sid);
      if(a.name!==b.name) renamed.push({sid, from:a.name, to:b.name, num:b.num});
      if(a.num!==b.num) moved.push({sid, name:b.name, from:a.num, to:b.num});
    }
  }
  for(const [sid,a] of A) if(!B.has(sid)) removed.push({sid, name:a.name, num:a.num});
  const row=(t,c)=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:13px"><span style="color:'+c+'">'+t+'</span></div>';
  let h='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px">'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--teal)">'+added.length+'</b><br>قناة مضافة</div>'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--danger)">'+removed.length+'</b><br>قناة محذوفة</div>'
    +'<div class="toolbody" style="text-align:center"><b style="color:var(--gold)">'+renamed.length+'</b><br>اتغير اسمها</div>'
    +'<div class="toolbody" style="text-align:center"><b>'+moved.length+'</b><br>اتغير رقمها</div></div>';
  const list=(arr,fmt,c,max)=>arr.slice(0,max||30).map(x=>row(fmt(x),c)).join('')+(arr.length>(max||30)?'<p style="color:var(--mut);font-size:12px">… و '+(arr.length-(max||30))+' تانية في التقرير الكامل</p>':'');
  if(added.length) h+='<h3 style="font-size:13px;color:var(--teal);margin:8px 0 4px">مضافة في الملف التاني</h3>'+list(added,x=>esc(x.name)+' (SID '+x.sid+' · #'+x.num+')','var(--teal)');
  if(removed.length) h+='<h3 style="font-size:13px;color:var(--danger);margin:8px 0 4px">موجودة هنا ومش في التاني</h3>'+list(removed,x=>esc(x.name)+' (SID '+x.sid+' · #'+x.num+')','var(--danger)');
  if(renamed.length) h+='<h3 style="font-size:13px;color:var(--gold);margin:8px 0 4px">اتغير اسمها</h3>'+list(renamed,x=>esc(x.from)+' ← '+esc(x.to)+' (SID '+x.sid+')','var(--gold)');
  if(moved.length) h+='<h3 style="font-size:13px;margin:8px 0 4px">اتغير رقمها</h3>'+list(moved,x=>esc(x.name)+': '+x.from+' ← '+x.to,'var(--txt)');
  if(!added.length&&!removed.length&&!renamed.length&&!moved.length) h+='<p style="color:var(--teal)">الملفين متطابقين في القنوات (نفس الـ SIDs والأسماء والأرقام).</p>';
  h+='<button type="button" class="btn btn-gold" id="cmpDl" style="margin-top:10px">تحميل التقرير الكامل (.txt)</button>';
  out.innerHTML=h;
  $('#cmpDl').addEventListener('click',()=>{
    let t='تقرير مقارنة ملفي قنوات — رسيفر برو\n';
    t+='الملف الحالي: '+(LAB.name||'')+'\nالملف التاني: '+f.name+'\n\n';
    t+='== مضافة في الملف التاني ('+added.length+') ==\n'+added.map(x=>'+ '+x.name+' (SID '+x.sid+' · #'+x.num+')').join('\n')+'\n\n';
    t+='== محذوفة من الملف التاني ('+removed.length+') ==\n'+removed.map(x=>'- '+x.name+' (SID '+x.sid+' · #'+x.num+')').join('\n')+'\n\n';
    t+='== اتغير اسمها ('+renamed.length+') ==\n'+renamed.map(x=>'~ '+x.from+' -> '+x.to+' (SID '+x.sid+')').join('\n')+'\n\n';
    t+='== اتغير رقمها ('+moved.length+') ==\n'+moved.map(x=>'# '+x.name+': '+x.from+' -> '+x.to).join('\n')+'\n';
    const blob=new Blob([t],{type:'text/plain;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='compare-report.txt'; a.click();
  });
}
