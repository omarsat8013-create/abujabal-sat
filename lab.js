/* ================= مختبر السوفت (firmware lab) ================= */
/* Loaded after the main script. Uses $, esc, toast, downloadBlob, openModal, currentPath, render. */
const LAB = {
  buf:null, orig:null, name:'', type:'', typeLabel:'',
  ops:[], errors:[], media:[], headerLock:64, unlocked:false,
  page:0, pageSize:256,
  sql:null, sqlDb:null, sqlTables:[], sqlTable:'', sqlCols:[], sqlRows:[], sqlOffset:0, sqlLimit:200, sqlSearch:''
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
  LAB.sqlDb=null; LAB.sqlTables=[]; LAB.sqlTable=''; LAB.sqlRows=[]; LAB.sqlOffset=0; LAB.sqlSearch='';
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
    if(LAB.sqlSearch&&tcols.length){
      const q=LAB.sqlSearch.replace(/'/g,"''");
      where=' WHERE '+tcols.map(c=>'"'+c.name+'" LIKE \'%'+q+'%\'').join(' OR ');
    }
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
function viewLab(){
  if(!LAB.buf){
    return '<div class="narrow">'
    +'<div class="card"><h2>مختبر السوفت <span class="sub">تعديل آمن على ملفات السوفت والقنوات — مع نسخة أصلية محفوظة وفحص بعد كل خطوة</span></h2>'
    +'<div class="field"><label>اختار ملف السوفت أو ملف القنوات (.bin / .abs / .db / .rom)</label>'
    +'<input type="file" id="labFile"></div>'
    +'<div class="labnote"><b>إزاي بيحمي الملف؟</b><br>'
    +'١. النسخة الأصلية بتفضل محفوظة، وزر "استعادة الأصل" بيرجعك في أي لحظة.<br>'
    +'٢. بعد كل تعديل بيحصل فحص تلقائي: ثبات الحجم، سلامة الهيدر (أول ٦٤ بايت مقفولين)، بصمة نوع الملف، وإعادة حساب CRC32.<br>'
    +'٣. أي خطأ بيظهر في لوحة الأخطاء مع زر تراجع فوري، وفي قواعد البيانات التعديل الفاشل بيتراجع عن نفسه تلقائياً.<br>'
    +'٤. التعديل المباشر على الجداول (تغيير أسماء القنوات وخلافه) متاح فقط لملفات SQLite الحقيقية. باقي الأنواع ليها أدوات عامة آمنة: عرض hex، استبدال نصوص بنفس الطول، واستبدال صور مدمجة بنفس الحجم أو أصغر. الأنواع غير المعروفة تفضل قراءة-فقط مع الأدوات العامة دي بس.</div>'
    +'</div></div>';
  }
  let h='<div class="narrow">';
  h+='<div class="card"><h2>'+esc(LAB.name)+' <span class="sub">'+esc(LAB.typeLabel)+'</span></h2>'
    +'<div class="kv"><span>الحجم</span><b>'+labFmt(LAB.buf.length)+'</b></div>'
    +'<div class="kv"><span>CRC32 الأصل</span><b dir="ltr">'+labCRC32(LAB.orig)+'</b></div>'
    +'<div class="kv"><span>CRC32 الحالي</span><b dir="ltr">'+labCRC32(labCur())+'</b></div>'
    +'<div class="kv"><span>عدد التعديلات</span><b>'+LAB.ops.length+'</b></div>'
    +'<div class="kv"><span>صور مدمجة مكتشفة</span><b>'+LAB.media.length+'</b></div>'
    +'<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
    +'<button type="button" class="btn sm" id="labNew">فتح ملف تاني</button>'
    +'<button type="button" class="btn sm btn-sec" id="labUndo"'+(LAB.ops.length?'':' disabled')+'>تراجع عن آخر تعديل</button>'
    +'<button type="button" class="btn sm btn-danger" id="labRestore">استعادة الأصل</button>'
    +'</div></div>';
  h+='<div class="card"><h2>لوحة الفحص والأخطاء</h2><div class="labops" id="labErrs">'
    +(LAB.errors.length?LAB.errors.map(e=>'<div class="'+(e.level==='err'?'operr':e.level==='warn'?'opwarn':'opok')+'">'+esc(e.msg)+'</div>').join(''):'<div class="opok">كل الفحوصات سليمة</div>')
    +'</div></div>';
  h+='<div class="card"><h2>سجل العمليات</h2><div class="labops">'
    +(LAB.ops.length?LAB.ops.map((o,i)=>'<div>'+(i+1)+'. '+esc(o.desc)+' <span style="color:var(--mut)">'+esc(o.at)+'</span></div>').join(''):'<div style="color:var(--mut)">لسه مفيش تعديلات</div>')
    +'</div></div>';
  if(LAB.type==='sqlite'&&LAB.sqlDb){
    h+='<div class="card"><h2>محرر قاعدة البيانات (القوائم والقنوات)</h2>'
      +'<div class="field"><label>الجدول</label><select id="labTable">'
      +LAB.sqlTables.map(t=>'<option value="'+esc(t)+'"'+(t===LAB.sqlTable?' selected':'')+'>'+esc(t)+' ('+labSqlTableCount(t)+' سطر)</option>').join('')
      +'</select></div>'
      +'<div class="field"><label>بحث في النصوص</label><input type="text" id="labSearch" value="'+esc(LAB.sqlSearch)+'" placeholder="اكتب جزء من اسم القناة..."></div>'
      +'<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
      +'<button type="button" class="btn sm" id="labSearchGo">بحث</button>'
      +'<button type="button" class="btn sm btn-sec" id="labPrevPage"'+(LAB.sqlOffset>0?'':' disabled')+'>السابق</button>'
      +'<button type="button" class="btn sm btn-sec" id="labNextPage"'+(LAB.sqlRows.length>=LAB.sqlLimit?'':' disabled')+'>التالي</button>'
      +'<span style="align-self:center;font-size:12px;color:var(--mut)">سطور '+(LAB.sqlOffset+1)+' - '+(LAB.sqlOffset+LAB.sqlRows.length)+'</span></div>'
      +'<div class="labops" style="max-height:340px">'
      +labSqlRowsHtml()
      +'</div>'
      +'<h2 style="margin-top:14px">عمليات سريعة على القنوات</h2>'
      +'<div class="field"><label>بحث واستبدال في كل الأسماء</label><div style="display:flex;gap:8px;flex-wrap:wrap">'
      +'<input type="text" id="labQOld" placeholder="النص القديم" style="flex:1;min-width:120px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
      +'<input type="text" id="labQNew" placeholder="النص الجديد" style="flex:1;min-width:120px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
      +'<button type="button" class="btn sm" id="labQDoReplace">استبدال الكل</button></div></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
      +'<input type="text" id="labQFilter" placeholder="احذف قنوات فيها نص..." style="flex:1;min-width:140px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
      +'<button type="button" class="btn sm btn-danger" id="labQDoFilter">حذف بالفلتر</button>'
      +'<button type="button" class="btn sm btn-sec" id="labQDoDups">حذف المكرر (نفس الاسم)</button>'
      +'</div>'
      +'<p class="labnote">كل عملية بتتسجل في السجل وبييجي بعدها فحص سلامة تلقائي، والتراجع بيرجعها.</p></div>';
  }
  h+='<div class="card"><h2>تعديل ID / نصوص داخل الملف <span class="sub">استبدال بنفس الطول بالظبط — مناسب لتغيير ID السوفت أو اسم موديل ظاهر</span></h2>'
    +'<div class="field"><label>النص القديم (زي ما هو في الملف)</label><input type="text" id="labOldStr" dir="ltr" placeholder="GX6605S-..."></div>'
    +'<div class="field"><label>النص الجديد (نفس عدد الحروف)</label><input type="text" id="labNewStr" dir="ltr"></div>'
    +'<div class="field"><label>الترميز</label><select id="labEnc"><option value="ascii">ASCII (حرف = بايت)</option><option value="utf16">UTF-16LE (حرف = بايتين)</option></select></div>'
    +'<button type="button" class="btn btn-gold" id="labDoReplace">استبدال في كل الأماكن</button></div>'
    +'<div class="card"><h2>مغيّر ID السوفت (من ملف لملف) <span class="sub">بيقارن بايتات الـ ID بين ملفين ويكتب ID الملف المانح في ملفك — زي ما بيتعمل عشان جهاز يقبل سوفت محوّل</span></h2>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<div class="field" style="flex:1;min-width:120px"><label>إزاحة الـ ID (hex)</label><input type="text" id="labIdOff" dir="ltr" value="0000000C"></div>'
    +'<div class="field"><label>الطول</label><select id="labIdLen"><option value="4" selected>4 بايت</option><option value="2">2 بايت</option><option value="8">8 بايت</option><option value="16">16 بايت</option></select></div>'
    +'</div>'
    +'<div class="field"><label>الملف المانح (اللي هناخد منه الـ ID)</label><input type="file" id="labIdDonor"></div>'
    +'<div id="labIdPreview"></div>'
    +'<button type="button" class="btn btn-primary" id="labIdApply" disabled>تطبيق الـ ID على ملفي</button></div>';
  if(LAB.media.length){
    h+='<div class="card"><h2>الصور المدمجة ('+LAB.media.length+') <span class="sub">استخراج أو استبدال — الجديدة لازم نفس الحجم أو أصغر</span></h2>'
      +LAB.media.map((m,i)=>'<div class="mediaitem"><span>'+m.kind+' @ '+labHex(m.off)+' ('+labFmt(m.len)+')</span><span>'
      +'<button type="button" class="btn sm" data-labext="'+i+'">استخراج</button> '
      +'<button type="button" class="btn sm btn-sec" data-labrep="'+i+'">استبدال</button></span></div>').join('')
      +'<input type="file" id="labImgFile" accept="image/*" style="display:none"></div>';
  }
  h+='<div class="card"><h2>عارض Hex <span class="sub">قراءة فقط — '+(LAB.page+1)+' / '+labPages()+' صفحة</span></h2>'
    +'<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'
    +'<button type="button" class="btn sm btn-sec" id="labHxPrev"'+(LAB.page>0?'':' disabled')+'>السابق</button>'
    +'<button type="button" class="btn sm btn-sec" id="labHxNext"'+(LAB.page<labPages()-1?'':' disabled')+'>التالي</button>'
    +'<input type="text" id="labHxGoto" dir="ltr" placeholder="عنوان hex زي 0001A000" style="width:160px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
    +'<button type="button" class="btn sm" id="labHxGo">روح</button>'
    +(LAB.unlocked
      ?'<button type="button" class="btn sm btn-danger" id="labLock">قفل الهيدر تاني</button>'
      :'<button type="button" class="btn sm btn-ghost" id="labUnlock">فك قفل الهيدر (خطر)</button>')
    +'</div>'
    +'<div class="hexview">'+labHexPage()+'</div></div>';
  h+='<div class="card"><h2>تعديل بايتات متقدم <span class="sub">للخبراء — اكتب العنوان والبايتات hex</span></h2>'
    +'<div class="field"><label>العنوان (hex)</label><input type="text" id="labPatchOff" dir="ltr" placeholder="0001A000"></div>'
    +'<div class="field"><label>البايتات الجديدة (hex)</label><input type="text" id="labPatchBytes" dir="ltr" placeholder="48 65 6C 6C 6F"></div>'
    +'<button type="button" class="btn btn-sec" id="labDoPatch">تطبيق التعديل</button></div>';
  h+='<div class="card"><h2>محوّل الصور إلى فيديو M2V <span class="sub">يحوّل مجموعة صور لفيديو MPEG-2 (.m2v) جوه المتصفح — بدون سيرفر</span></h2>'
    +'<div class="field"><label>الصور (بالترتيب)</label><input type="file" id="m2vFiles" accept="image/*" multiple></div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<select id="m2vRes" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px"><option value="720x576" selected>720×576 (SD)</option><option value="720x480">720×480 (NTSC)</option><option value="1280x720">1280×720 (HD)</option><option value="1920x1080">1920×1080 (Full HD)</option></select>'
    +'<select id="m2vFps" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px"><option value="25" selected>25 fps</option><option value="30">30 fps</option></select>'
    +'<input type="text" id="m2vSecs" value="3" style="width:90px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px" title="ثواني لكل صورة">'
    +'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<button type="button" class="btn sm btn-sec" id="m2vPrev">معاينة</button>'
    +'<button type="button" class="btn sm btn-gold" id="m2vGo">تحويل وتحميل .m2v</button></div>'
    +'<img id="m2vPrevImg" style="display:none;max-width:100%;border-radius:10px;border:1px solid var(--line2);margin-bottom:8px">'
    +'<div class="labops" id="m2vLog" style="max-height:140px"><div style="color:var(--mut)">اختار الصور واضغط تحويل. أول مرة بيحمل محرك التحويل من النت.</div></div></div>';
  h+='<div class="card"><h2>لودر السيريال (تجريبي) <span class="sub">فلاشة/دامب عن طريق منفذ COM من المتصفح — Web Serial</span></h2>'
    +'<p class="labnote" style="color:var(--gold,#fbbf24)">تنبيه صريح: ده اتصال سيريال خام (إرسال/استقبال) شغال من المتصفح، لكن بروتوكول اللودر الكامل بتاع GX/Sunplus <b>لم يُختبر على جهاز حقيقي بعد</b>. استخدمه للتجربة بس، وماتعتمدش عليه في فلاشة جهاز عميل.</p>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<select id="serBaud" style="background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
    +['9600','38400','57600','115200','230400','460800','921600'].map(b=>'<option value="'+b+'"'+(b==='115200'?' selected':'')+'>'+b+'</option>').join('')
    +'</select>'
    +(SER.port
      ?'<button type="button" class="btn sm btn-danger" id="serDisc">فصل</button><span id="serStatus" style="align-self:center;font-size:12px;color:var(--mut)">استقبال: '+SER.rx.toLocaleString('en-US')+' بايت</span>'
      :'<button type="button" class="btn sm btn-primary" id="serConn">اتصال بالمنفذ</button>')
    +'<button type="button" class="btn sm btn-sec" id="serSave"'+(SER.rx?'':' disabled')+'>حفظ المستقبَل + SHA-256</button>'
    +'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
    +'<input type="text" id="serHex" dir="ltr" placeholder="بايتات hex للإرسال زي A5 5A 00 01" style="flex:1;min-width:200px;background:#0b1425;border:1px solid var(--line2);border-radius:8px;padding:6px 10px">'
    +'<button type="button" class="btn sm" id="serSend"'+(SER.port?'':' disabled')+'>إرسال</button></div>'
    +'<div class="labops hexview" id="serLog" style="max-height:180px;white-space:pre-wrap">'
    +(SER.log.length?SER.log.map(l=>'<div class="'+l.cls+'">['+l.t+'] '+esc(l.msg)+'</div>').join(''):'<div style="color:var(--mut)">اللوج فاضي — اتصل بالمنفذ عشان تبدأ</div>')
    +'</div></div>';
  h+='<div class="card"><h2>الحفظ</h2><div style="display:flex;gap:8px;flex-wrap:wrap">'
    +'<button type="button" class="btn btn-primary" id="labSave">تحميل الملف المعدّل</button>'
    +'<button type="button" class="btn btn-sec" id="labSaveOrig">تحميل النسخة الأصلية</button>'
    +'<button type="button" class="btn btn-ghost" id="labSaveReport">تحميل تقرير التعديل</button>'
    +'</div><p class="labnote" style="margin-top:10px">الملف المعدّل بينزل باسم فيه _modified. جرّبه الأول على نسخة، وخلي الأصل عندك دايماً.</p></div>';
  h+='</div>';
  return h;
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
    return '<div class="chrow"><span style="color:var(--mut);font-size:12px">'+label+'</span>'+cells+'</div>';
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
  const ff=FFmpeg.createFFmpeg({ log:false, corePath:'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });
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
