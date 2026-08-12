function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});}
function safeUrl(u){u=String(u==null?'':u);return /^https?:\/\//i.test(u)?u:'#';}
'use strict';
// ══ SUPABASE CONFIG ══
const SB_CONFIG={
  url:'https://jyufcedgprierjmqsxpa.supabase.co',
  key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5dWZjZWRncHJpZXJqbXFzeHBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMzQyMTQsImV4cCI6MjA4ODYxMDIxNH0.088t4cMF80f0mXMJONZDX8bZPeDymGzT4yjzX3fn0CI'
};
const SB_URL=SB_CONFIG.url;
const SB_KEY=SB_CONFIG.key;
const SB_H={'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY};
function getSbH(){ return {'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+(_sbSession||SB_KEY)}; }

// ══ SECURITY: LOGIN RATE LIMITER ══
const LOGIN_RATE={maxAttempts:5,lockoutMs:60000,attempts:0,lockedUntil:0};
function canAttemptLogin(){
  if(Date.now()<LOGIN_RATE.lockedUntil){
    const secs=Math.ceil((LOGIN_RATE.lockedUntil-Date.now())/1000);
    toast('حاول بعد '+secs+' ثانية','warn');
    return false;
  }
  return true;
}
function recordFailedLogin(){
  LOGIN_RATE.attempts++;
  if(LOGIN_RATE.attempts>=LOGIN_RATE.maxAttempts){
    LOGIN_RATE.lockedUntil=Date.now()+LOGIN_RATE.lockoutMs;
    LOGIN_RATE.attempts=0;
    toast('تم قفل الدخول لمدة دقيقة','err');
  }
}
function resetLoginAttempts(){LOGIN_RATE.attempts=0;LOGIN_RATE.lockedUntil=0;}
// ══ SMART SYNC ══
let _pendingDeletes = [];

async function sbFetch(url, opts={}, retries=3, timeoutMs=10000){
  for(let attempt=1; attempt<=retries; attempt++){
    const ctrl = new AbortController();
    const tid = setTimeout(()=>ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {...opts, signal: ctrl.signal});
      clearTimeout(tid);
      return r;
    } catch(e) {
      clearTimeout(tid);
      if(attempt === retries) throw e;
      await new Promise(res=>setTimeout(res, attempt * 1000));
    }
  }
}

async function sbLoad(){
  try{
    const r=await sbFetch(SB_URL+'/rest/v1/cases?select=id,data&order=id.asc',{method:'GET',headers:SB_H},2,8000);
    if(!r.ok)return false;
    const rows=await r.json();
    if(!Array.isArray(rows))return false;
    if(rows.length===0)return'empty';
    cases=rows.map(x=>x.data);
    return true;
  }catch(e){return false;}
}

function sanitizeCase(c){
  const safe = {};
  const allowed = ['id','company','type','lawyer','status','currency','amountIQD','amountUSD',
    'deficiency','defCompleted','notes','holdReason','stage','date','addedAt','attachUrl','attachName','log','comments','wadeaChecks',
    'tasisDone','wadeaLinkedId','tasisLinkedId','wadeaCertDate','wadeaShareholderType','wadeaDeadline','wadeaDone',
    'workflowStage','workflowDates','certNo','certDate','amountIncludes',
    'wadeaStep1','wadeaStep1Date','wadeaStep2','wadeaStep2Date','wadeaStep3','wadeaStep3Date','wadeaBarcodeUrl','wadeaBarcodeName'];
  for(const k of allowed){
    const v = c[k];
    if(v === undefined) continue;
    if(k === 'log' || k === 'comments' || k === 'workflowDates' || k === 'amountIncludes'){
      try { safe[k] = JSON.parse(JSON.stringify(v||(k==='amountIncludes'?[]:{}))); } catch(e){ safe[k]=(k==='amountIncludes'?[]:{}); }
    } else {
      safe[k] = (typeof v === 'string'||typeof v === 'number'||typeof v === 'boolean'||v===null) ? v : String(v||'');
    }
  }
  safe.amountIQD = parseFloat(safe.amountIQD)||0;
  safe.amountUSD = parseFloat(safe.amountUSD)||0;
  safe.id = safe.id||Date.now();
  safe.addedAt = safe.addedAt||Date.now();
  return safe;
}

async function sbSave(){
  try {
    if(cases.length > 0){
      const rows = cases.map(c=>({id:c.id, data:sanitizeCase(c), updated_at: new Date().toISOString()}));
      const r = await sbFetch(SB_URL+'/rest/v1/cases',{
        method:'POST',
        headers:{...SB_H,'Prefer':'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(rows)
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
    }
    if(_pendingDeletes.length > 0){
      const ids = _pendingDeletes.join(',');
      await sbFetch(SB_URL+'/rest/v1/cases?id=in.('+ids+')',{method:'DELETE', headers:SB_H});
      _pendingDeletes = [];
    }
  } catch(e){ console.error('sbSave error', e); throw e; }
}

async function sbDeleteCase(id){
  try { await sbFetch(SB_URL+'/rest/v1/cases?id=eq.'+id,{method:'DELETE',headers:SB_H}); } catch(e){}
}

async function sbSaveMeta(key, data){
  try{
    await sbFetch(SB_URL+'/rest/v1/meta',{
      method:'POST',
      headers:{...SB_H,'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({id:key, data:data, updated_at:new Date().toISOString()})
    });
  }catch(e){}
}
async function sbLoadMeta(key){
  try{
    const r=await sbFetch(SB_URL+'/rest/v1/meta?id=eq.'+key+'&select=data',{method:'GET',headers:SB_H},2,6000);
    if(!r.ok)return null;
    const rows=await r.json();
    return (rows&&rows[0])?rows[0].data:null;
  }catch(e){return null;}
}

function showSyncStatus(s){
  const el=document.getElementById('syncStatus');
  if(!el)return;
  if(s==='saving')el.innerHTML='<span style="color:var(--text3)">جاري الحفظ...</span>';
  else if(s==='saved')el.innerHTML='<span style="color:var(--green)">محفوظ</span>';
  else if(s==='error')el.innerHTML='<span style="color:var(--red)">بلا إنترنت</span>';
  else if(s==='loading')el.innerHTML='<span style="color:var(--text3)">تحميل...</span>';
  else el.innerHTML='';
}

function showSkeleton(containerId, rows){
  const c = document.getElementById(containerId);
  if(!c) return;
  rows = rows || 5;
  let h = '';
  for(let i=0;i<rows;i++){
    h += '<div class="skeleton-row">';
    h += '<div class="skeleton skeleton-cell" style="animation-delay:'+(i*0.08)+'s"></div>';
    h += '<div class="skeleton skeleton-cell narrow" style="animation-delay:'+(i*0.08+0.04)+'s"></div>';
    h += '<div class="skeleton skeleton-cell medium" style="animation-delay:'+(i*0.08+0.08)+'s"></div>';
    h += '<div class="skeleton skeleton-cell narrow" style="animation-delay:'+(i*0.08+0.12)+'s"></div>';
    h += '</div>';
  }
  c.innerHTML = h;
}

let saveTimer=null;
async function saveData(){
  try{localStorage.setItem(SK_D,JSON.stringify(cases.map(sanitizeCase)));}catch(e){}
  showSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    try{
      await sbSave();
      showSyncStatus('saved');
      setTimeout(()=>showSyncStatus(''),3000);
    }catch(e){
      showSyncStatus('error');
      setTimeout(async()=>{
        try{ await sbSave(); showSyncStatus('saved'); setTimeout(()=>showSyncStatus(''),3000); }catch(_){}
      }, 5000);
    }
  },800);
}
async function saveCfg(){
  try{localStorage.setItem(SK_S,JSON.stringify(settings));}catch(e){}
  // ═ حفظ الإعدادات بالسيرفر — await عشان نضمن الحفظ قبل أي شيء ═
  await sbSaveMeta('settings', settings);
}
// ══ DEFAULTS ══
const DEFAULT_LAWYERS=['منتظر','مروه','علي'];
const DEFAULT_TYPES=['تأسيس شركة','تصديق اوليات الشركة','زيادة رأس المال','اضافة نشاط','حفظ الحسابات الختامية','منح كتب تأييد للشركات','إطلاق وديعة','نقل مقر الشركات المحدودة','استمرار تعيين','بيع اسهم','تجديد شهادة تأسيس','تعديل نشاط الشركة'];
const DEFAULT_DEPTS=['قسم المحدودة','قسم المراقب','قسم التوثيق','الموظف المختص'];
const SK_D='lexdesk_cases_v3',SK_S='lexdesk_settings_v3',SK_USER='lexdesk_user',SK_NOTIFS='lexdesk_notifs',SK_THEME='lexdesk_theme';
const SEED=[{id:1,company:'كهرمانة',type:'تأسيس شركة',lawyer:'منتظر',status:'قيد المعالجة',currency:'IQD',amountIQD:6600000,amountUSD:0,deficiency:'',notes:'',holdReason:'',stage:'',date:'',addedAt:1},{id:2,company:'الضوء القادم',type:'تأسيس شركة',lawyer:'مروه',status:'قيد المعالجة',currency:'IQD',amountIQD:6600000,amountUSD:0,deficiency:'',notes:'',holdReason:'',stage:'',date:'',addedAt:2},{id:3,company:'سحر الالوان',type:'تأسيس شركة',lawyer:'علي',status:'قيد المعالجة',currency:'IQD',amountIQD:6600000,amountUSD:0,deficiency:'',notes:'',holdReason:'',stage:'',date:'',addedAt:3}];
const LAWYER_COLORS=['#F0A500','#3B7EFF','#00C48C','#FF4D6A','#9B6DFF','#FF8C42'];
const STATUS_MAP={'قيد المعالجة':'s-active','منجزة':'s-done','معلقة':'s-hold','مراجعة':'s-pending','ناقصة':'s-def'};
let cases=[],settings={},editingId=null,currentView='list',importRows=[],_lastAddedId=null;
let _undoCase=null,_undoEl=null,_undoTimer=null;
const fmt=n=>(Math.round(n||0)).toLocaleString('en-US');
const parseAmt=s=>parseFloat((s||'').replace(/,/g,''))||0;

// ══ LOAD ══
async function loadAll(){
  // ═ سريع: حمّل اللوكال فوراً ═
  let localSettings={};
  try{const s=localStorage.getItem(SK_S);localSettings=s?JSON.parse(s):{};}catch(e){localSettings={};}
  settings=localSettings;
  settings.officeName=settings.officeName||'المحامي منتظر الخزرجي';
  settings.defCurrency=settings.defCurrency||'IQD';
  settings.lawyers=settings.lawyers||[...DEFAULT_LAWYERS];
  settings.types=settings.types||[...DEFAULT_TYPES];
  settings.depts=settings.depts||[...DEFAULT_DEPTS];
  let hasLocal=false;
  try{const d=localStorage.getItem(SK_D);if(d){cases=JSON.parse(d);hasLocal=true;}}catch(e){}
  // ═ السيرفر بالخلفية ═
  showSyncStatus('loading');
  if(!hasLocal)showSkeleton('casesBody',5);
  const loaded=await sbLoad();
  if(loaded===true){showSyncStatus('saved');setTimeout(()=>showSyncStatus(''),2000);}
  else if(loaded==='empty'){if(!hasLocal)cases=[];showSyncStatus('saved');setTimeout(()=>showSyncStatus(''),2000);}
  else{
    if(hasLocal){showSyncStatus('saved');setTimeout(()=>showSyncStatus(''),2000);}
    else{showSyncStatus('error');cases=SEED.map(c=>({...c}));saveData();}
  }
  // ═ إعدادات السيرفر بالخلفية (موحدة بين الأجهزة) ═
  try{
    const cloudSettings=await sbLoadMeta('settings');
    if(cloudSettings&&typeof cloudSettings==='object'){
      settings={...settings,...cloudSettings};
      try{localStorage.setItem(SK_S,JSON.stringify(settings));}catch(e){}
    }
  }catch(e){}
}

// ══ THEME ══
function initTheme(){
  const t=localStorage.getItem(SK_THEME)||'dark';
  if(t==='light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  updateThemeBtn(t);
}
function toggleTheme(){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  if(isLight){
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(SK_THEME,'dark');
    updateThemeBtn('dark');
  } else {
    document.documentElement.setAttribute('data-theme','light');
    localStorage.setItem(SK_THEME,'light');
    updateThemeBtn('light');
  }
}
function updateThemeBtn(t){
  const sunSVG='<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const moonSVG='<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const html = t==='light' ? sunSVG : moonSVG;
  const icon=document.getElementById('sbThemeIcon');
  if(icon) icon.innerHTML=html;
  const mobIcon=document.getElementById('mobThemeIcon');
  if(mobIcon) mobIcon.innerHTML=html;
}

// ══ SECURITY: PASSWORD HASHING ══
async function hashPassword(pass){
  const enc=new TextEncoder();
  const data=enc.encode(pass+'_LexDesk_Salt_2025');
  const buf=await crypto.subtle.digest('SHA-256',data);
  const arr=Array.from(new Uint8Array(buf));
  return arr.map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ══ SECURITY: SESSION ══
const SESSION_DURATION_MS=8*60*60*1000;
function setSecureSession(user,role){
  const session={user,role,exp:Date.now()+SESSION_DURATION_MS};
  try{sessionStorage.setItem(SK_USER,JSON.stringify(session));}catch(e){}
}
function getSecureSession(){
  try{
    const raw=sessionStorage.getItem(SK_USER);
    if(!raw)return null;
    const session=JSON.parse(raw);
    if(!session||!session.exp||Date.now()>session.exp){sessionStorage.removeItem(SK_USER);return null;}
    return session;
  }catch(e){return null;}
}
function clearSecureSession(){try{sessionStorage.removeItem(SK_USER);}catch(e){}}

// ══ PASSWORD INIT ══
async function initPasswords(){
  let changed = false;
  if(!settings.adminPassHash){settings.adminPassHash=await hashPassword('1234');settings.mustChangeAdminPass=true;changed=true;}
  if(!settings.userPassHash){settings.userPassHash=await hashPassword('0000');settings.mustChangeUserPass=true;changed=true;}
  if(settings.adminPass){settings.adminPassHash=await hashPassword(settings.adminPass);delete settings.adminPass;changed=true;}
  if(settings.userPass){settings.userPassHash=await hashPassword(settings.userPass);delete settings.userPass;changed=true;}
  if(changed) saveCfg(); // يحفظ بالسيرفر + اللوكال
}

// ══ إعادة تعيين كلمة المرور للافتراضي ══
async function resetPassword(){
  // تأكيد مزدوج
  const sure = confirm('هل تريد إعادة تعيين كلمة المرور؟\n\nكلمة مرور الأدمن: 1234\nكلمة مرور المستخدم: 0000');
  if(!sure) return;
  settings.adminPassHash = await hashPassword('1234');
  settings.userPassHash = await hashPassword('0000');
  settings.mustChangeAdminPass = true;
  settings.mustChangeUserPass = true;
  saveCfg();
  toast('تم إعادة التعيين — أدمن: 1234 / مستخدم: 0000','ok');
}

// ══ AUTH ══
// ══ SUPABASE AUTH ══
let currentUser = null;   // email
let currentUserName = ''; // display name
let currentRole = null;   // 'admin' | 'user'
let _sbSession = null;    // supabase session token

// ─ Sign Up ─
async function doSignUp(){
  if(!canAttemptLogin())return;
  const email = (document.getElementById('emailInp').value||'').trim();
  const pass  = (document.getElementById('passInp').value||'').trim();
  const name  = (document.getElementById('nameInp').value||'').trim();
  if(!email||!pass||!name){ toast('أكمل جميع الحقول','warn'); return; }
  if(pass.length < 6){ toast('كلمة المرور 6 أحرف على الأقل','warn'); return; }
  setLoginLoading(true);
  try{
    const r = await sbFetch(SB_URL+'/auth/v1/signup',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY},
      body: JSON.stringify({ email, password:pass, data:{ full_name:name, role:'user' } })
    });
    const d = await r.json();
    // Show exact error from Supabase
    if(d.error){
      const msg = d.error.message||d.msg||JSON.stringify(d.error);
      toast('خطأ: '+msg,'err');
      setLoginLoading(false);
      return;
    }
    // If email confirmation required
    if(d.user && !d.session){
      toast('✓ تم إنشاء الحساب — راجع إيميلك للتأكيد ثم سجّل دخول','ok');
      switchLoginMode('login');
    } else if(d.access_token){
      // Auto-login if no confirmation required
      _sbSession = d.access_token;
      const meta = d.user?.user_metadata||{};
      currentUser     = d.user.email;
      currentUserName = meta.full_name||name;
      currentRole     = meta.role==='admin'?'admin':'user';
      try{ localStorage.setItem('lexdesk_sb_session', JSON.stringify({
        token:d.access_token, refresh:d.refresh_token,
        user:currentUser, name:currentUserName, role:currentRole,
        expires: Date.now()+(d.expires_in||3600)*1000
      }));}catch(e){}
      toast('✓ أهلاً '+currentUserName,'ok');
      showApp();
    } else {
      // Unknown response - show it
      toast('رد غير متوقع: '+JSON.stringify(d).substring(0,100),'warn');
    }
  } catch(e){ toast('خطأ في الاتصال: '+e.message,'err'); }
  setLoginLoading(false);
}

// ─ Sign In ─
async function doLogin(){
  try {
  if(!canAttemptLogin())return;
  const emailEl = document.getElementById('emailInp');
  const passEl  = document.getElementById('passInp');
  if(!emailEl||!passEl){ toast('خطأ: الحقول غير موجودة','err'); return; }
  const email = (emailEl.value||'').trim();
  const pass  = (passEl.value||'').trim();
  if(!email||!pass){ toast('أدخل الإيميل وكلمة المرور','warn'); return; }
  setLoginLoading(true);
  try{
    const r = await sbFetch(SB_URL+'/auth/v1/token?grant_type=password',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY},
      body: JSON.stringify({ email, password:pass })
    });
    const d = await r.json();
    if(d.error || !d.access_token){
      recordFailedLogin();
      const errEl = document.getElementById('passErr');
      if(errEl){ errEl.textContent = 'الإيميل أو كلمة المرور غلط'; errEl.classList.add('show'); }
      const b = document.querySelector('.login-box');
      if(b){ b.style.animation='none'; b.offsetHeight; b.style.animation='shake .4s'; }
      setLoginLoading(false);
      return;
    }
    resetLoginAttempts();
    _sbSession = d.access_token;
    const meta = d.user?.user_metadata || {};
    currentUser     = d.user.email;
    currentUserName = meta.full_name || email.split('@')[0];
    currentRole     = meta.role === 'admin' ? 'admin' : 'user';
    const sessExp = Date.now()+(d.expires_in||3600)*1000;
    try{ localStorage.setItem('lexdesk_sb_session', JSON.stringify({
      token: d.access_token, refresh: d.refresh_token,
      user: currentUser, name: currentUserName, role: currentRole, expires: sessExp
    })); }catch(e){}
    scheduleSessionRefresh(sessExp);
    SFX.play('login');
    document.getElementById('passErr')?.classList.remove('show');
    showApp();
  } catch(e){ toast('خطأ في الاتصال','err'); }
  setLoginLoading(false);
  } catch(fatalErr){ toast('خطأ: '+fatalErr.message,'err'); setLoginLoading(false); }
}

// ─ Forgot Password ─
async function doForgotPass(){
  const email = (document.getElementById('emailInp').value||'').trim();
  if(!email){ toast('أدخل إيميلك أولاً','warn'); return; }
  setLoginLoading(true);
  try{
    await sbFetch(SB_URL+'/auth/v1/recover',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY},
      body: JSON.stringify({ email })
    });
    toast('✓ تم إرسال رابط إعادة التعيين على إيميلك','ok');
  } catch(e){ toast('خطأ','err'); }
  setLoginLoading(false);
}

// ─ Restore session on load ─
// ─ تجديد الجلسة تلقائياً 5 دقائق قبل انتهائها ─
let _sessionRefreshTimer=null;
function scheduleSessionRefresh(expiresAt){
  if(_sessionRefreshTimer)clearTimeout(_sessionRefreshTimer);
  const delay=Math.max(expiresAt-Date.now()-5*60*1000,10000);
  _sessionRefreshTimer=setTimeout(async()=>{
    try{
      const saved=JSON.parse(localStorage.getItem('lexdesk_sb_session')||'null');
      if(!saved?.refresh)return;
      const r=await sbFetch(SB_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY},body:JSON.stringify({refresh_token:saved.refresh})});
      const d=await r.json();
      if(d.access_token){
        _sbSession=d.access_token;
        const newExp=Date.now()+(d.expires_in||3600)*1000;
        try{localStorage.setItem('lexdesk_sb_session',JSON.stringify({...saved,token:d.access_token,refresh:d.refresh_token||saved.refresh,expires:newExp}));}catch(e){}
        scheduleSessionRefresh(newExp);
      }
    }catch(e){}
  },delay);
}

async function restoreSbSession(){
  try{
    const saved=JSON.parse(localStorage.getItem('lexdesk_sb_session')||'null');
    if(!saved)return false;
    // الجلسة لسا صالحة
    if(Date.now()<=saved.expires-60000){
      _sbSession=saved.token;currentUser=saved.user;currentUserName=saved.name;currentRole=saved.role;
      scheduleSessionRefresh(saved.expires);
      return true;
    }
    // جدّد تلقائياً
    if(saved.refresh){
      const r=await sbFetch(SB_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY},body:JSON.stringify({refresh_token:saved.refresh})});
      const d=await r.json();
      if(d.access_token){
        _sbSession=d.access_token;
        const meta=d.user?.user_metadata||{};
        currentUser=d.user.email;currentUserName=meta.full_name||currentUser.split('@')[0];currentRole=meta.role==='admin'?'admin':'user';
        const newExp=Date.now()+(d.expires_in||3600)*1000;
        try{localStorage.setItem('lexdesk_sb_session',JSON.stringify({token:d.access_token,refresh:d.refresh_token||saved.refresh,user:currentUser,name:currentUserName,role:currentRole,expires:newExp}));}catch(e){}
        scheduleSessionRefresh(newExp);
        return true;
      }
    }
    return false;
  }catch(e){return false;}
}

// ─ Logout ─
function logout(){
  currentUser=null; currentUserName=''; currentRole=null; _sbSession=null;
  if(_sessionRefreshTimer){clearTimeout(_sessionRefreshTimer);_sessionRefreshTimer=null;}
  try{ localStorage.removeItem('lexdesk_sb_session'); }catch(e){}
  document.getElementById('emailInp').value='';
  document.getElementById('passInp').value='';
  document.getElementById('passErr')?.classList.remove('show');
  document.getElementById('loginScreen').style.display='grid';
  document.getElementById('appWrap').style.display='none';
  const mn=document.getElementById('mobNav');if(mn)mn.style.display='none';
  const fw=document.getElementById('fabWrap');if(fw)fw.style.display='none';
  switchLoginMode('login');
}

// ─ Switch login/signup modes ─
function switchLoginMode(mode){
  // Always login mode - no public signup
  const btn = document.getElementById('loginSubmitBtn');
  const nameRow = document.getElementById('nameRow');
  const switchBtn = document.getElementById('switchModeBtn');
  const forgotBtn = document.getElementById('forgotBtn');
  const errEl = document.getElementById('passErr');
  if(btn){ btn.textContent='دخول ←'; btn.onclick=doLogin; }
  if(nameRow) nameRow.style.display='none';
  if(switchBtn) switchBtn.style.display='none';
  if(forgotBtn) forgotBtn.style.display='block';
  if(errEl) errEl.classList.remove('show');
}

function setLoginLoading(on){
  const btn = document.getElementById('loginSubmitBtn');
  if(!btn)return;
  btn.disabled = on;
  btn.style.opacity = on ? '.6' : '1';
}

function isAdmin(){return currentRole==='admin';}

function applyRoleUI(){
  const sbSet=document.getElementById('sbSettings');if(sbSet)sbSet.style.display=isAdmin()?'flex':'none';
  const mnSet=document.getElementById('mnSet');if(mnSet)mnSet.style.display=isAdmin()?'flex':'none';
  const sbReports=document.getElementById('sbReports');if(sbReports)sbReports.style.display=isAdmin()?'flex':'none';
  const mnReports=document.getElementById('mnReports');if(mnReports)mnReports.style.display=isAdmin()?'flex':'none';
  document.querySelectorAll('[onclick="exportExcel()"]').forEach(b=>b.style.display=isAdmin()?'flex':'none');
  document.querySelectorAll('[onclick="window.print()"]').forEach(b=>b.style.display=isAdmin()?'flex':'none');
}
function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appWrap').style.display='flex';
  const mn=document.getElementById('mobNav');if(mn)mn.style.display=window.innerWidth<=768?'flex':'none';
  if(window.innerWidth<=768)currentView='cards';
  const up=document.getElementById('userPill');if(up)up.style.display='flex';
  const nb=document.getElementById('notifBell');if(nb)nb.style.display='flex';
  const rb=document.getElementById('remBell');if(rb)rb.style.display='flex';
  const mb=document.getElementById('mobThemeBtn');if(mb)mb.style.display='flex';
  const fab=document.getElementById('fabWrap');if(fab)fab.style.display='flex';
  const sui=document.getElementById('sbUserInfo');if(sui)sui.style.display='flex';
  const _displayName = currentUserName || (isAdmin()?'أدمن':'مستخدم');
  const _initials = _displayName.trim()[0]||'م';
  const suav=document.getElementById('sbUserAv');if(suav)suav.textContent=_initials;
  const sun=document.getElementById('sbUserName');if(sun)sun.textContent=_displayName;
  const upn=document.getElementById('userPillName');if(upn)upn.textContent=_displayName;
  const uav=document.querySelector('.user-av');if(uav)uav.textContent=_initials;
  // ─ تحديث زر المستخدم بالموبايل ─
  const mnAv=document.getElementById('mnUserAv');if(mnAv)mnAv.textContent=_initials;
  const mnMnAv=document.getElementById('mobMenuAv');if(mnMnAv)mnMnAv.textContent=_initials;
  const mnMnName=document.getElementById('mobMenuName');if(mnMnName)mnMnName.textContent=_displayName;
  const mnMnRole=document.getElementById('mobMenuRole');if(mnMnRole)mnMnRole.textContent=isAdmin()?'مدير النظام':'مستخدم';
  const officeName=settings.officeName||'المحامي منتظر الخزرجي';
  const tb=document.getElementById('officeTitle');if(tb)tb.textContent=officeName;
  const ls=document.getElementById('loginOfficeSub');if(ls)ls.textContent=officeName;
  const sl=document.getElementById('sbLogoText');if(sl)sl.textContent=officeName;
  document.title=officeName;
  populateAllDropdowns();applyRoleUI();render();updateStats();
  loadNotifs().then(()=>{renderNotifBadge();renderNotifList();});
  loadReminders().then(()=>{renderRemBadge();renderRemList();});
  loadTasks().then(()=>{renderTaskAlerts();buildTasksPage();});
  toast('أهلاً بك','ok');
  updateUsersTabVisibility();
}

function showMobUserMenu(){
  const menu=document.getElementById('mobUserMenu');
  if(!menu)return;
  const isOpen=menu.style.display==='block';
  menu.style.display=isOpen?'none':'block';
  if(!isOpen){
    // أغلق لما تضغط خارجه
    setTimeout(()=>document.addEventListener('click',_closeMobMenuOutside,{once:true}),10);
  }
}
function _closeMobMenuOutside(e){
  const menu=document.getElementById('mobUserMenu');
  const btn=document.getElementById('mnUser');
  if(menu&&!menu.contains(e.target)&&btn&&!btn.contains(e.target)){menu.style.display='none';}
}
function closeMobUserMenu(){
  const menu=document.getElementById('mobUserMenu');
  if(menu)menu.style.display='none';
}

function toggleFab(){
  const a=document.getElementById('fabActions');const btn=document.getElementById('fabMainBtn');
  if(!a||!btn)return;
  const open=a.style.display==='flex';
  a.style.display=open?'none':'flex';
  btn.innerHTML=open
    ?'<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    :'<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}

// ══ NOTIFICATIONS ══
let notifications=[];
async function loadNotifs(){
  const cloud = await sbLoadMeta('notifications');
  if(cloud && Array.isArray(cloud)) notifications=cloud;
  else { try{notifications=JSON.parse(localStorage.getItem(SK_NOTIFS)||'[]');}catch(e){notifications=[];} }
  renderNotifBadge(); renderNotifList();
}
function saveNotifs(){
  const data = notifications.slice(0,50);
  try{localStorage.setItem(SK_NOTIFS,JSON.stringify(data));}catch(e){}
  sbSaveMeta('notifications', data);
}
function addNotif(type,msg){
  if(settings.notifEnabled===false)return;
  const n={id:Date.now(),type,msg,time:new Date().toISOString(),read:false};
  notifications.unshift(n);saveNotifs();renderNotifBadge();renderNotifList();
  sendPushNotif(msg);SFX.play('notif');
}
async function sendPushNotif(msg){if(!('Notification'in window)||Notification.permission!=='granted'||settings.notifEnabled===false)return;try{new Notification('LexDesk',{body:msg,dir:'rtl',lang:'ar'});}catch(e){}}
function renderNotifBadge(){const u=notifications.filter(n=>!n.read).length;const b=document.getElementById('notifBadge');if(!b)return;b.textContent=u>9?'9+':u;b.classList.toggle('show',u>0);}
function renderNotifList(){
  const l=document.getElementById('notifList');if(!l)return;
  if(!notifications.length){l.innerHTML='<div class="notif-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.25;display:block;margin:0 auto 8px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>لا توجد إشعارات</div>';return;}
  const NOTIF_ICONS={new:{svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',bg:'var(--green-g)',color:'var(--green)'},hold:{svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',bg:'var(--red-g)',color:'var(--red)'},edit:{svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',bg:'var(--blue-g)',color:'var(--blue2)'}};
  l.innerHTML=notifications.map(n=>{const icon=NOTIF_ICONS[n.type]||NOTIF_ICONS.edit;const t=new Date(n.time);const ts=t.toLocaleDateString('ar-IQ',{month:'short',day:'numeric'})+' '+t.toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});return'<div class="notif-item'+(n.read?'':' unread')+'" onclick="markRead('+n.id+')"><div class="ni-ico" style="background:'+icon.bg+';color:'+icon.color+'">'+icon.svg+'</div><div><div class="ni-txt">'+esc(n.msg)+'</div><div class="ni-time">'+ts+'</div></div></div>';}).join('');
}
function markRead(id){const n=notifications.find(x=>x.id===id);if(n)n.read=true;saveNotifs();renderNotifBadge();renderNotifList();}
function clearNotifs(){notifications=[];saveNotifs();renderNotifBadge();renderNotifList();toggleNotifPanel();}
function toggleNotifPanel(){const p=document.getElementById('notifPanel');p.classList.toggle('open');if(p.classList.contains('open'))setTimeout(()=>{notifications.forEach(n=>n.read=true);saveNotifs();renderNotifBadge();renderNotifList();},1500);}
async function requestNotifPermission(){if(!('Notification'in window)){toast('متصفحك لا يدعم الإشعارات','err');return false;}if(Notification.permission==='granted')return true;if(Notification.permission==='denied'){toast('الإشعارات محظورة — فعّلها من إعدادات المتصفح','err');return false;}const r=await Notification.requestPermission();return r==='granted';}
async function toggleNotifSetting(){
  const on=settings.notifEnabled!==false;
  if(!on){const g=await requestNotifPermission();if(!g){updateNotifUI(false);return;}settings.notifEnabled=true;toast('الإشعارات مفعّلة','ok');setTimeout(()=>sendPushNotif('LexDesk — الإشعارات شغالة'),500);}
  else{settings.notifEnabled=false;toast('الإشعارات موقفة','warn');}
  saveCfg();updateNotifUI(settings.notifEnabled!==false);
}
function updateNotifUI(on){
  const btn=document.getElementById('notifToggle');if(btn)btn.classList.toggle('on',on);
  const pl=document.getElementById('notifPermLbl');if(!pl)return;
  const p=('Notification'in window)?Notification.permission:'unsupported';
  if(p==='granted')pl.textContent='المتصفح سمح بالإشعارات';
  else if(p==='denied')pl.textContent='محظورة — غيّر من إعدادات المتصفح';
  else if(p==='default')pl.textContent='لم تُطلب الإذن بعد';
  else pl.textContent='غير مدعومة في هذا المتصفح';
}
// ══ BULK ACTIONS STATE (declared here — used in render/renderRow below) ══
let selectedCases = [];

// ══ TABLE ROW DELEGATION ══
document.addEventListener('DOMContentLoaded', ()=>{
  const body = document.getElementById('casesBody');
  if(!body) return;
  body.addEventListener('click', e=>{
    if(e.target.closest('.acts-cell'))    return;
    if(e.target.closest('.status-badge')) return;
    if(e.target.closest('.stage-chip'))   return;
    if(e.target.closest('.bulk-cb-cell')) return;  // ★ bulk checkbox cell
    if(e.target.closest('.bulk-cb'))      return;  // ★ bulk checkbox itself
    if(e.target.closest('.company-link')) return;  // ★ client-profile link
    if(e.target.closest('a'))             return;
    const row = e.target.closest('tr.case-row');
    if(!row) return;
    const id = Number(row.dataset.id);
    if(id) openDetail(id);
  });
});

function render(){
  renderWadeaAlerts();
  const pgWadea=document.getElementById('pageWadea');
  if(pgWadea&&pgWadea.style.display!=='none')buildWadeaPage();
  const q=(document.getElementById('searchInp').value||'').trim().toLowerCase();
  const ft=document.getElementById('filterType').value;
  const fl=document.getElementById('filterLawyer').value;
  const fs=document.getElementById('filterStatus').value;
  const fil=cases.filter(c=>{
    if(q&&!c.company.toLowerCase().includes(q)&&!(c.notes||'').toLowerCase().includes(q))return false;
    if(ft&&c.type!==ft)return false;if(fl&&c.lawyer!==fl)return false;if(fs&&c.status!==fs)return false;
    return true;
  });
  const body=document.getElementById('casesBody');
  document.getElementById('caseCount').textContent=fil.length;
  if(!fil.length){body.innerHTML='<div class="empty-state"><div class="empty-ico"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><div class="empty-txt">لا توجد معاملات مطابقة</div><div class="empty-sub">جرّب تغيير الفلاتر أو أضف معاملة جديدة</div><button class="empty-btn" onclick="openForm(null)">＋ إضافة معاملة</button></div>';updateStats();return;}
  if(currentView==='kanban'){body.innerHTML=buildKanban(fil);updateStats();initKanbanDrag();return;}
  if(currentView==='cards')body.innerHTML='<div class="cards-grid">'+fil.map(renderCard).join('')+'</div>';
  else body.innerHTML='<div class="tbl-wrap"><table><thead><tr>'
    +'<th style="width:34px;padding-right:14px"><input type="checkbox" class="bulk-cb-all" onclick="toggleSelectAll(this)" title="تحديد الكل"></th>'
    +'<th>الشركة</th><th>المحامي</th><th>المبلغ</th><th>الحالة</th><th>نوع المعاملة</th><th>وين واصلة</th><th></th><th></th>'
    +'</tr></thead><tbody>'+fil.map(renderRow).join('')+'</tbody></table></div>';
  // restore selections
  if(selectedCases.length){
    selectedCases.forEach(id=>{const cb=document.querySelector('.bulk-cb[data-id="'+id+'"]');if(cb){cb.checked=true;cb.closest('tr')?.classList.add('selected');}});
  }
  updateStats();
}

function statusClass(s){return STATUS_MAP[s]||'s-pending';}

function renderRow(c){
  const lci=settings.lawyers.indexOf(c.lawyer);const lc=LAWYER_COLORS[lci%LAWYER_COLORS.length];
  const amt=c.currency==='USD'?'<span class="amt usd">$'+fmt(c.amountUSD)+'</span>':'<span class="amt iqd">'+fmt(c.amountIQD)+' د.ع</span>';
  const stg=c.stage?'<span class="stage-chip" onclick="openStageDrop(event,'+c.id+')">'+c.stage+'</span>':'<span class="stage-chip" onclick="openStageDrop(event,'+c.id+')" style="color:var(--text3)">—</span>';
  let statusHtml='<span class="status-badge '+statusClass(c.status)+'" onclick="openStatusDrop(event,'+c.id+')">'+c.status+'</span>';
  if(c.status==='معلقة'&&c.holdReason)statusHtml+='<div style="font-size:10px;color:var(--text3);margin-top:3px">'+esc(c.holdReason)+'</div>';
  const attachHtml=c.attachUrl?'<a href="'+safeUrl(c.attachUrl)+'" target="_blank" class="attach-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> فتح</a>':'<span style="color:var(--text3);font-size:11px">—</span>';
  const isSelected=selectedCases.includes(c.id);
  return '<tr class="case-row'+(isSelected?' selected':'')+'" data-id="'+c.id+'" style="cursor:pointer'+(c.wadeaDone?';opacity:.6':'')+'">'
  +'<td class="bulk-cb-cell" onclick="event.stopPropagation()"><input type="checkbox" class="bulk-cb" data-id="'+c.id+'"'+(isSelected?' checked':'')+' onclick="event.stopPropagation();toggleSelect('+c.id+')" /></td>'
  +'<td><div class="td-company" style="'+(c.wadeaDone?'text-decoration:line-through;color:var(--text3)':'')+'"><span class="company-link" onclick="event.stopPropagation();openClientProfile(\''+c.company.replace(/'/g,"\\'")+'\')" style="cursor:pointer">'+esc(c.company)+'</span></div>'
  +(c.tasisDone&&c.type===WADEA_TYPE?'<div style="display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:10px;background:var(--gold-g);color:var(--gold);padding:2px 8px;border-radius:6px;font-weight:700">✓ اكتمل التأسيس</div>':'')
  +(c.wadeaDone?'<div style="display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:10px;background:var(--green-g);color:var(--green);padding:2px 8px;border-radius:6px;font-weight:700">✓ أُكملت الوديعة</div>':'')
  +(c.type===WADEA_TYPE&&c.tasisLinkedId?'<div style="display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:10px;background:var(--gold-g);color:var(--gold);padding:2px 8px;border-radius:6px;cursor:pointer;font-weight:700" onclick="event.stopPropagation();openDetail('+c.tasisLinkedId+')">↑ من تأسيس</div>':'')
  +(c.notes?'<div class="td-notes">'+esc(c.notes)+'</div>':'')
  +'</td><td><div class="td-lawyer"><div class="lawyer-dot" style="background:'+lc+'"></div>'+c.lawyer+'</div></td><td class="td-amount">'+amt+'</td><td>'+statusHtml+'</td><td><span class="type-chip">'+c.type+'</span></td><td>'+stg+'</td><td>'+attachHtml+'</td><td class="acts-cell"><div class="row-acts"><button class="act-btn" onclick="event.stopPropagation();openForm('+c.id+')" title="تعديل"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="act-btn del" onclick="event.stopPropagation();askDel('+c.id+')" title="حذف"><svg class="del-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div></td></tr>';
}

function renderCard(c){
  const lci=settings.lawyers.indexOf(c.lawyer);const lc=LAWYER_COLORS[lci%LAWYER_COLORS.length];
  const amt=c.currency==='USD'?'$'+fmt(c.amountUSD):fmt(c.amountIQD)+' د.ع';
  return '<div class="case-card" data-id="'+c.id+'" style="'+(c.wadeaDone?'opacity:.65':'')+'">'+'<div class="cc-clickarea" onclick="openDetail('+c.id+')" style="cursor:pointer"><div class="cc-top"><div><div class="cc-name" style="'+(c.wadeaDone?'text-decoration:line-through;color:var(--text3)':'')+'">'+esc(c.company)+'</div>'+(c.tasisDone&&c.type===WADEA_TYPE?'<div style="font-size:10px;color:var(--gold);font-weight:700;margin-top:2px">✓ اكتمل التأسيس</div>':'')+(c.wadeaDone?'<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:2px">✓ أُكملت الوديعة</div>':'')+(c.type===WADEA_TYPE&&c.tasisLinkedId?'<div style="font-size:10px;color:var(--gold);font-weight:700;margin-top:2px">↑ من تأسيس</div>':'')+'<div style="margin-top:4px"><span class="type-chip">'+c.type+'</span></div></div><span class="status-badge '+statusClass(c.status)+'" onclick="event.stopPropagation();openStatusDrop(event,'+c.id+')">'+c.status+'</span></div><div class="cc-meta"><div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600"><div class="lawyer-dot" style="background:'+lc+'"></div>'+c.lawyer+'</div></div><div class="cc-amt">'+amt+'</div></div><div class="cc-foot">'+(c.stage?'<span class="stage-chip">'+c.stage+'</span>':'<span></span>')+(c.attachUrl?'<a href="'+safeUrl(c.attachUrl)+'" target="_blank" class="attach-badge" style="margin-right:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></a>':'')+'<div style="display:flex;gap:4px"><button class="act-btn" title="تعديل" onclick="openForm('+c.id+')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="act-btn del" title="حذف" onclick="askDel('+c.id+')"><svg class="del-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div></div></div>';
}
// ══ STATS ══
function updateStats(){
  const totalIQD=cases.reduce((s,c)=>s+(c.amountIQD||0),0);
  const totalUSD=cases.reduce((s,c)=>s+(c.amountUSD||0),0);
  const defCount=cases.filter(c=>c.deficiency||c.status==='ناقصة').length;
  const pendingCount=cases.filter(c=>c.status==='قيد المعالجة').length;
  const total=cases.length;
  const _sc=document.getElementById('statCases');if(_sc)countUp(_sc, total, '', '', 800);
  const _spd=document.getElementById('statPending');if(_spd)countUp(_spd, pendingCount, '', '', 700);
  const _scl=document.getElementById('statClients');if(_scl)countUp(_scl, total, '', '', 800);
  const _av=document.getElementById('areaChartVal');
  if(_av){countUp(_av, totalIQD, '', '', 900);setTimeout(()=>{const el=document.getElementById('areaChartVal');if(el)el.innerHTML=fmt(totalIQD)+' <span>د.ع</span>';},950);}
  const _ac=document.getElementById('areaChartChange');
  if(_ac){const pct=total>0?Math.round((pendingCount/total)*100):0;_ac.innerHTML='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>+'+pct+'%';_ac.style.color=pct>0?'var(--green)':'var(--text3)';}
  updateDashDonut(total, pendingCount, defCount);
  const rpProg=document.getElementById('rpProgList');
  if(rpProg){const maxL=Math.max(...settings.lawyers.map(l=>cases.filter(c=>c.lawyer===l).length),1);rpProg.innerHTML=settings.lawyers.map((l,i)=>{const n=cases.filter(c=>c.lawyer===l).length;const col=LAWYER_COLORS[i%LAWYER_COLORS.length];return '<div class="rp-prog-item"><div class="rp-prog-top"><span class="rp-prog-lbl" style="color:'+col+'"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>'+l+'</span><span class="rp-prog-num">'+n+'</span></div><div class="rp-prog-bar"><div class="rp-prog-fill" style="background:'+col+';width:'+n/maxL*100+'%"></div></div></div>';}).join('');}
  const rpLog=document.getElementById('rpLogList');
  if(rpLog){const recent=[...cases].sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)).slice(0,5);const statusIcos={'قيد المعالجة':{bg:'var(--gold-g)',c:'var(--gold)',ico:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},'منجزة':{bg:'var(--green-g)',c:'var(--green)',ico:'<polyline points="20 6 9 17 4 12"/>'},'معلقة':{bg:'var(--red-g)',c:'var(--red)',ico:'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'},'مراجعة':{bg:'var(--blue-g)',c:'var(--blue2)',ico:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'},'ناقصة':{bg:'var(--purple-g)',c:'var(--purple)',ico:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'}};rpLog.innerHTML=recent.map(c=>{const si=statusIcos[c.status]||statusIcos['مراجعة'];const amt=c.currency==='USD'?'$'+fmt(c.amountUSD):fmt(c.amountIQD)+' د.ع';return '<div class="rp-log-item" onclick="openDetail('+c.id+')" style="cursor:pointer"><div class="rp-log-ico" style="background:'+si.bg+';color:'+si.c+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+si.ico+'</svg></div><div class="rp-log-main"><div class="rp-log-name">'+esc(c.company)+'</div><div class="rp-log-sub">'+c.lawyer+' • <span class="status-badge '+statusClass(c.status)+'" style="font-size:9px;padding:1px 5px">'+c.status+'</span></div></div><div class="rp-log-amt">'+amt+'</div></div>';}).join('')||'<div class="rp-empty">لا توجد معاملات بعد</div>';}
  buildAreaSparkline();
  if(document.getElementById('pageCharts').classList.contains('active'))buildCharts();
}

let donutDashChart=null;
function updateDashDonut(total, pending, def){
  const done=cases.filter(c=>c.status==='منجزة').length;const hold=cases.filter(c=>c.status==='معلقة').length;const review=cases.filter(c=>c.status==='مراجعة').length;
  const data=[pending,done,hold,def||review];const sum=data.reduce((a,b)=>a+b,0)||1;
  const cv=document.getElementById('donutCenterVal');if(cv)cv.innerHTML=total+'<span>معاملة</span>';
  const pct=n=>Math.round(n/sum*100)+'%';
  const da=document.getElementById('dlegActive');if(da)da.textContent=pct(pending);
  const dd=document.getElementById('dlegDone');if(dd)dd.textContent=pct(done);
  const dh=document.getElementById('dlegHold');if(dh)dh.textContent=pct(hold);
  const df=document.getElementById('dlegDef');if(df)df.textContent=pct(def);
  const ctx=document.getElementById('chartDonutDash');if(!ctx)return;
  if(donutDashChart)donutDashChart.destroy();
  donutDashChart=new Chart(ctx,{type:'doughnut',data:{labels:['قيد المعالجة','منجزة','معلقة','ناقصة'],datasets:[{data:data.map(d=>d||0),backgroundColor:['rgba(245,166,35,.85)','rgba(34,211,160,.85)','rgba(255,85,114,.85)','rgba(155,109,255,.85)'],borderColor:['#F5A623','#22D3A0','#FF5572','#9B6DFF'],borderWidth:2,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:true,cutout:'72%',plugins:{legend:{display:false},tooltip:{rtl:true}},animation:{duration:700}}});
}

let areaSparkChart=null;
function buildAreaSparkline(){
  const ctx=document.getElementById('chartAreaMain');if(!ctx)return;
  const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const now=new Date();const labels=[];const data=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);labels.push(months[d.getMonth()]);const monthCases=cases.filter(c=>{const ca=new Date(c.addedAt||0);return ca.getFullYear()===d.getFullYear()&&ca.getMonth()===d.getMonth();});data.push(monthCases.reduce((s,c)=>s+(c.amountIQD||0),0));}
  if(data[data.length-1]===0&&cases.length>0)data[data.length-1]=cases.reduce((s,c)=>s+(c.amountIQD||0),0);
  if(areaSparkChart)areaSparkChart.destroy();
  areaSparkChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{data,borderColor:'#F5A623',borderWidth:2.5,pointRadius:data.map((_,i)=>i===data.length-1?5:0),pointBackgroundColor:'#F5A623',fill:true,backgroundColor:(context)=>{const chart=context.chart;const{ctx:c,chartArea}=chart;if(!chartArea)return'transparent';const gradient=c.createLinearGradient(0,chartArea.top,0,chartArea.bottom);gradient.addColorStop(0,'rgba(245,166,35,.35)');gradient.addColorStop(1,'rgba(245,166,35,.02)');return gradient;},tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{rtl:true,mode:'index',intersect:false}},scales:{x:{display:false},y:{display:false}},animation:{duration:600}}});
}

let chartInstances={};
function buildCharts(){
  Chart.defaults.color=document.documentElement.getAttribute('data-theme')!=='light'?'rgba(255,255,255,.5)':'rgba(0,0,0,.4)';
  Chart.defaults.borderColor=document.documentElement.getAttribute('data-theme')!=='light'?'rgba(255,255,255,.07)':'rgba(0,0,0,.07)';
  const statuses=['قيد المعالجة','منجزة','معلقة','مراجعة','ناقصة'];
  buildChart('chartStatus','doughnut',statuses,statuses.map(s=>cases.filter(c=>c.status===s).length),['#F0A500','#00C48C','#FF4D6A','#F0A500','#9B6DFF']);
  buildChart('chartLawyers','bar',settings.lawyers,settings.lawyers.map(l=>cases.filter(c=>c.lawyer===l).length),LAWYER_COLORS);
  const typesMap={};cases.forEach(c=>{typesMap[c.type]=(typesMap[c.type]||0)+1;});const tKeys=Object.keys(typesMap).sort((a,b)=>typesMap[b]-typesMap[a]).slice(0,6);
  buildChart('chartTypes','bar',tKeys,tKeys.map(k=>typesMap[k]),['#3B7EFF','#00C48C','#F0A500','#FF4D6A','#9B6DFF','#FF8C42']);
  buildChart('chartAmounts','bar',settings.lawyers,settings.lawyers.map(l=>cases.filter(c=>c.lawyer===l).reduce((s,c2)=>s+(c2.amountIQD||0),0)),LAWYER_COLORS);
}
function buildChart(id,type,labels,data,colors){
  const ctx=document.getElementById(id);if(!ctx)return;
  if(chartInstances[id])chartInstances[id].destroy();
  chartInstances[id]=new Chart(ctx,{type,data:{labels,datasets:[{data,backgroundColor:colors.map(c=>c+'99'),borderColor:colors,borderWidth:2,borderRadius:type==='bar'?6:0,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:type==='doughnut'?'bottom':'top',labels:{boxWidth:10,padding:12,font:{size:11}}}},scales:type==='bar'?{x:{grid:{display:false}},y:{grid:{color:Chart.defaults.borderColor}}}:{}}});
}
// ══ INLINE DROPDOWNS ══
function openStatusDrop(e,id){
  e.stopPropagation();closeAllDrops();
  const opts=['قيد المعالجة','منجزة','معلقة','مراجعة','ناقصة'];
  const d=document.createElement('div');d.className='fl-drop';d.id='flDrop';
  d.innerHTML=opts.map(o=>'<div class="fl-drop-item" onclick="setStatus('+id+',\''+o+'\')"><span class="status-badge '+statusClass(o)+'">'+o+'</span></div>').join('');
  document.body.appendChild(d);const r=e.target.getBoundingClientRect();d.style.top=(r.bottom+4)+'px';d.style.right=(window.innerWidth-r.right)+'px';
}
function setStatus(id,val){const c=cases.find(x=>x.id===id);if(!c)return;const old=c.status;c.status=val;if(val==='معلقة'&&old!=='معلقة'){const reason=prompt('سبب التعليق (اختياري):');if(reason!==null)c.holdReason=reason;addNotif('hold','معاملة معلقة: '+c.company);}else if(val!=='معلقة')c.holdReason='';saveData();render();closeAllDrops();toast('تم التحديث','ok');}
function openStageDrop(e,id){
  e.stopPropagation();closeAllDrops();
  const depts=[...settings.depts,'أخرى'];
  const d=document.createElement('div');d.className='fl-drop';d.id='flDrop';
  d.innerHTML=depts.map(o=>'<div class="fl-drop-item" onclick="setStage('+id+',\''+o+'\')">'+o+'</div>').join('');
  document.body.appendChild(d);const r=e.target.getBoundingClientRect();d.style.top=(r.bottom+4)+'px';d.style.right=(window.innerWidth-r.right)+'px';
}
function setStage(id,val){if(val==='أخرى'){const v=prompt('اكتب المرحلة:');if(v)setStage(id,v.trim());closeAllDrops();return;}const c=cases.find(x=>x.id===id);if(!c)return;c.stage=val;saveData();render();closeAllDrops();toast('تم التحديث','ok');}
function closeAllDrops(){const d=document.getElementById('flDrop');if(d)d.remove();}

// ══ FORM ══
let selLawyer='',selStatus='قيد المعالجة',selCur='IQD',selDept='';
const WADEA_TYPE='إطلاق وديعة';
const AMT_INC_ITEMS=['هوية ضريبية','هوية مستورد','كتاب مستشار قانوني','كتاب محاسب','كتاب مصرف','هوية اتحاد مقاولين','هوية غرفة تجارة'];
let selAmtInc=[];
function buildAmtIncGrid(){
  document.getElementById('amtIncGrid').innerHTML=AMT_INC_ITEMS.map((it,i)=>{
    const on=selAmtInc.includes(it);
    return '<div class="amt-inc-item'+(on?' on':'')+'" onclick="toggleAmtInc('+i+')"><span class="bx"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>'+it+'</div>';
  }).join('');
}
function toggleAmtInc(i){
  const it=AMT_INC_ITEMS[i];
  const p=selAmtInc.indexOf(it);
  if(p===-1)selAmtInc.push(it);else selAmtInc.splice(p,1);
  buildAmtIncGrid();
}

const WADEA_ITEMS=['كتاب مشاور','كتاب محاسب','أرسلت على النظام'];
const TASIS_TYPE='تأسيس شركة';

function addLog(c,type,msg,user){
  if(!c.log)c.log=[];
  c.log.push({id:Date.now(),type,msg,user:user||currentUser||'الأدمن',time:new Date().toISOString()});
}

// ══ TASIS → WADEA CONVERSION ══
function openConvertToWadea(id){
  const c=cases.find(x=>x.id===id);if(!c||c.type!==TASIS_TYPE)return;
  // Set company name in modal
  document.getElementById('cvCompanyName').textContent=c.company;
  document.getElementById('cvCertDate').value='';
  document.getElementById('cvShareType').value='single';
  document.getElementById('cvDeadlineInfo').textContent='';
  // Reset checkboxes
  ['cv1','cv2','cv3'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
  ['cvcheck1','cvcheck2','cvcheck3'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('checked');});
  // Store source id
  document.getElementById('cvOverlay').dataset.sourceId=id;
  document.getElementById('cvOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('cvOverlay').classList.add('open'),10);
  // Auto calc deadline when date changes
  document.getElementById('cvCertDate').oninput=calcCvDeadline;
  document.getElementById('cvShareType').onchange=calcCvDeadline;
}

// المهلة القانونية الرسمية لإطلاق الوديعة (حسب تعليمات مسجل الشركات)
const WADEA_GRACE_SINGLE=37;   // مساهم واحد: من تاريخ الشهادة
const WADEA_GRACE_MULTI=55;    // أكثر من مساهم: من تاريخ الشهادة
const WADEA_MULTI_WAIT=15;     // أكثر من مساهم: لا يُرسل قبل مرور هذي المدة
const WADEA_FINE_PER_DAY=50000;
const WADEA_FINE_CAP=5154000;

function calcWadeaFine(daysLate){
  if(daysLate<=0)return 0;
  return Math.min(daysLate*WADEA_FINE_PER_DAY,WADEA_FINE_CAP);
}

// ══ تنبيهات مهلة إطلاق الوديعة (اللوحة الرئيسية) ══
function getWadeaDismissed(){
  try{return JSON.parse(localStorage.getItem('lexdesk_wadea_dismissed')||'{}');}catch(e){return {};}
}
function dismissWadeaAlert(id,key,ev){
  if(ev)ev.stopPropagation();
  const d=getWadeaDismissed();
  d[id]=key;
  localStorage.setItem('lexdesk_wadea_dismissed',JSON.stringify(d));
  renderWadeaAlerts();
}
function renderWadeaAlerts(){
  const box=document.getElementById('wadeaAlerts');
  const today=new Date();today.setHours(0,0,0,0);
  const dismissed=getWadeaDismissed();
  const items=[];let lateCount=0;
  cases.forEach(c=>{
    if(c.type!==WADEA_TYPE||!c.wadeaDeadline||c.wadeaDone)return;
    const deadline=new Date(c.wadeaDeadline);
    const diff=Math.round((deadline-today)/(1000*60*60*24));
    if(diff<0)lateCount++;
    if(diff<=7){ // متأخرة أو باقي أسبوع فأقل
      const fine=diff<0?calcWadeaFine(Math.abs(diff)):0;
      const key='d'+diff;
      if(dismissed[c.id]===key)return;
      items.push({c,diff,fine,key});
    }
  });
  // بادج الشريط الجانبي + قائمة الموبايل
  const badge=document.getElementById('sbWadeaBadge');
  const mBadge=document.getElementById('mnWadeaBadge');
  if(badge){
    if(lateCount>0){badge.style.display='flex';badge.textContent=lateCount;}
    else badge.style.display='none';
  }
  if(mBadge){
    if(lateCount>0){mBadge.style.display='flex';mBadge.textContent=lateCount;}
    else mBadge.style.display='none';
  }
  if(!box)return;
  if(!items.length){box.style.display='none';box.innerHTML='';return;}
  items.sort((a,b)=>a.diff-b.diff);
  box.style.display='flex';box.className='wadea-alert-wrap';
  box.innerHTML=items.map(it=>{
    const late=it.diff<0;
    const msg=late?('متأخرة '+Math.abs(it.diff)+' يوم — الغرامة: '+it.fine.toLocaleString()+' د.ع'):('باقي '+it.diff+' يوم على انتهاء المهلة');
    return '<div class="wadea-alert '+(late?'late':'soon')+'" onclick="openDetail('+it.c.id+')">'
      +'<div class="ic">'+(late?'⚠':'⏰')+'</div>'
      +'<div class="tx"><div class="tn">'+esc(it.c.company)+'</div><div class="ts">'+msg+'</div></div>'
      +(late?'<div class="fine">'+it.fine.toLocaleString()+' د.ع</div>':'')
      +'<button class="wadea-alert-x" title="إخفاء" onclick="dismissWadeaAlert('+it.c.id+',\''+it.key+'\',event)">✕</button>'
      +'</div>';
  }).join('');
}

// ══ صفحة إطلاق وديعة (شريط جانبي) ══
const WADEA_STEP_NAMES=['أُرسلت على النظام','كتاب المشاور مكتمل','كتاب المحاسب مكتمل','رفع باركود / QR الشركة'];

function wadeaStepsDone(c){
  let n=0;
  if(c.wadeaStep1)n++;
  if(c.wadeaStep2)n++;
  if(c.wadeaStep3)n++;
  if(c.wadeaBarcodeUrl)n++;
  return n;
}

function buildWadeaPage(){
  const body=document.getElementById('wadeaBody');if(!body)return;
  const today=new Date();today.setHours(0,0,0,0);
  const list=cases.filter(c=>c.type===WADEA_TYPE&&c.wadeaDeadline&&!c.wadeaDone).map(c=>{
    const deadline=new Date(c.wadeaDeadline);
    const diff=Math.round((deadline-today)/(1000*60*60*24));
    const fine=diff<0?calcWadeaFine(Math.abs(diff)):0;
    let earlyDiff=null;
    if(c.wadeaShareholderType==='multi'&&c.wadeaCertDate){
      const canSendFrom=new Date(c.wadeaCertDate);canSendFrom.setDate(canSendFrom.getDate()+WADEA_MULTI_WAIT);
      const d=Math.round((canSendFrom-today)/(1000*60*60*24));
      if(d>0)earlyDiff=d;
    }
    return {c,diff,fine,earlyDiff,done:wadeaStepsDone(c)};
  }).sort((a,b)=>a.diff-b.diff);

  if(!list.length){
    body.innerHTML='<div class="wadea-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h12M6 22h12M6 2c0 5 4 6 6 10 2-4 6-5 6-10M6 22c0-5 4-6 6-10"/></svg><div>لا توجد شركات بانتظار إطلاق الوديعة حالياً</div></div>';
    return;
  }

  body.innerHTML='<div class="wadea-hd"><div class="wadea-hd-t">إدارة إطلاق الوديعة والمحطات الأربع الإلزامية</div><div class="wadea-hd-sub">'+list.length+' ودائع متابعة</div></div>'
    +'<div class="wadea-kanban">'+list.map(it=>wadeaCardHtml(it)).join('')+'</div>';
}

function wadeaCardHtml(it){
  const c=it.c;
  const deadlineStr=new Date(c.wadeaDeadline).toLocaleDateString('ar-IQ',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/\//g,'/');
  const submitStr=c.wadeaCertDate?new Date(c.wadeaCertDate).toLocaleDateString('ar-IQ',{year:'numeric',month:'2-digit',day:'2-digit'}):'';
  const allDone3=c.wadeaStep1&&c.wadeaStep2&&c.wadeaStep3;
  const barcodeDone=!!c.wadeaBarcodeUrl;

  // ── الخطوة 1: الإرسال على النظام (مع تنبيه المنع المبكر) ──
  let step1Html='<div class="wf4-step"><div class="wf4-hd"><span class="wf4-badge '+(c.wadeaStep1?'done':'wait')+'">'+(c.wadeaStep1?'مكتملة':'في الانتظار')+'</span><span class="wf4-name">'+(c.wadeaStep1?'<svg class="wf4-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg> ':'')+'أُرسلت على النظام</span><span class="wf4-num">1</span></div>';
  if(it.earlyDiff&&!c.wadeaStep1){
    step1Html+='<div class="wf4-warn">⚠ شركة شركاء متعدّدين: يتطلّب الانتظار '+it.earlyDiff+' يوماً إضافياً من تاريخ الشهادة للإرسال على النظام.</div>';
  }
  if(!c.wadeaStep1){
    step1Html+='<button class="wf4-btn" '+(it.earlyDiff?'disabled title="لا يمكن الإرسال قبل انتهاء المهلة"':'')+' onclick="wadeaStepDone('+c.id+',1)">✓ تأكيد الإكمال</button>';
  }
  step1Html+='</div>';

  // ── الخطوة 2: كتاب المشاور ──
  let step2Html='<div class="wf4-step"><div class="wf4-hd"><span class="wf4-badge '+(c.wadeaStep2?'done':'wait')+'">'+(c.wadeaStep2?'مكتملة':'في الانتظار')+'</span><span class="wf4-name">'+(c.wadeaStep2?'<svg class="wf4-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg> ':'')+'كتاب المشاور مكتمل</span><span class="wf4-num">2</span></div>'
    +(!c.wadeaStep2?'<button class="wf4-btn" onclick="wadeaStepDone('+c.id+',2)">✓ تأكيد الإكمال</button>':'')
    +'</div>';

  // ── الخطوة 3: كتاب المحاسب ──
  let step3Html='<div class="wf4-step"><div class="wf4-hd"><span class="wf4-badge '+(c.wadeaStep3?'done':'wait')+'">'+(c.wadeaStep3?'مكتملة':'في الانتظار')+'</span><span class="wf4-name">'+(c.wadeaStep3?'<svg class="wf4-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg> ':'')+'كتاب المحاسب مكتمل</span><span class="wf4-num">3</span></div>'
    +(!c.wadeaStep3?'<button class="wf4-btn" onclick="wadeaStepDone('+c.id+',3)">✓ تأكيد الإكمال</button>':'')
    +'</div>';

  // ── الخطوة 4: رفع باركود/QR ──
  let step4Html='<div class="wf4-step"><div class="wf4-hd"><span class="wf4-badge '+(barcodeDone?'done':'wait')+'">'+(barcodeDone?'مكتملة':'في الانتظار')+'</span><span class="wf4-name">'+(barcodeDone?'<svg class="wf4-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg> ':'')+'رفع باركود / QR الشركة</span><span class="wf4-num">4</span></div>';
  if(barcodeDone){
    step4Html+='<a class="wf4-file-link" href="'+safeUrl(c.wadeaBarcodeUrl)+'" target="_blank" rel="noopener">📎 '+esc(c.wadeaBarcodeName||'الملف المرفوع')+'</a>';
  }else{
    step4Html+='<div class="wf4-upload"><div class="wf4-upload-lbl">اختر صورة الباركود/QR الخاصة بالشركة للرفع:</div><input type="file" accept="image/*" id="wf4File_'+c.id+'" onchange="wadeaUploadBarcode('+c.id+',this)"></div>';
  }
  step4Html+='</div>';

  // ── صندوق الحالة النهائية (لو 3 خطوات مكتملة وبانتظار الباركود بس) ──
  let doneBox='';
  if(allDone3&&!barcodeDone){
    doneBox='<div class="wf4-success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>'
      +'<div><b>أُرسلت على النظام (بانتظار رفع الباركود لإكمال الإطلاق)</b>'
      +'<div class="wf4-success-sub">توقّف احتساب الغرامة — يرجى رفع باركود الشركة لاستكمال الإطلاق النهائي.</div></div></div>';
  }

  // ── تذييل: أيام متبقية / مكتملة ──
  let footer='';
  if(barcodeDone){
    footer='<div class="wf4-foot done"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> اكتمل الإطلاق</div>';
  }else{
    const late=it.diff<0;
    footer='<div class="wf4-foot '+(late?'late':it.diff<=7?'soon':'')+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> '
      +(late?'متأخرة '+Math.abs(it.diff)+' يوم':it.diff+' يوم متبقٍ')
      +'<span class="wf4-foot-date">تنتهي المهلة بتاريخ '+deadlineStr+'</span></div>';
  }

  return '<div class="wadea-card">'
    +'<div class="wadea-card-hd">'
      +'<span class="wadea-card-badge">'+it.done+'/4 محطات</span>'
      +'<img class="wadea-card-logo" src="logo.png" alt="شعار">'
      +'<div class="wadea-card-name">'+esc(c.company)+'</div>'
      +(submitStr?'<div class="wadea-card-sub">أُطلقت بتاريخ '+submitStr+'</div>':'')
      +'<button class="wadea-card-ic" title="فتح المعاملة" onclick="closeDetail();openDetail('+c.id+')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/></svg></button>'
    +'</div>'
    +'<div class="wadea-card-body">'+step1Html+step2Html+step3Html+step4Html+doneBox+'</div>'
    +footer
    +'</div>';
}

function wadeaStepDone(id,step){
  const c=cases.find(x=>x.id===id);if(!c)return;
  const dateStr=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
  c['wadeaStep'+step]=true;
  c['wadeaStep'+step+'Date']=dateStr;
  addLog(c,'edit','إطلاق الوديعة: '+WADEA_STEP_NAMES[step-1],currentUser||'الأدمن');
  saveData();
  buildWadeaPage();
  renderWadeaAlerts();
}

async function wadeaUploadBarcode(id,inp){
  const file=inp.files[0];if(!file)return;
  if(file.size>10*1024*1024){toast('الملف أكبر من 10MB','err');return;}
  const c=cases.find(x=>x.id===id);if(!c)return;
  toast('جاري رفع الملف...','ok');
  const url=await uploadAttachment(file,c.company);
  if(!url)return;
  c.wadeaBarcodeUrl=url;
  c.wadeaBarcodeName=file.name;
  addLog(c,'edit','إطلاق الوديعة: '+WADEA_STEP_NAMES[3],currentUser||'الأدمن');
  saveData();
  buildWadeaPage();
  renderWadeaAlerts();
  toast('✓ تم رفع الباركود','ok');
}

function calcCvDeadline(){
  const d=document.getElementById('cvCertDate')?.value||'';
  const t=document.getElementById('cvShareType')?.value||'single';
  const el=document.getElementById('cvDeadlineInfo');
  if(!el)return;
  if(!d){el.innerHTML='';return;}
  const isMulti=t==='multi';
  const days=isMulti?WADEA_GRACE_MULTI:WADEA_GRACE_SINGLE;
  const certDate=new Date(d);
  const deadline=new Date(certDate);deadline.setDate(deadline.getDate()+days);
  const canSendFrom=new Date(certDate);
  if(isMulti)canSendFrom.setDate(canSendFrom.getDate()+WADEA_MULTI_WAIT);
  const today=new Date();today.setHours(0,0,0,0);
  const diffDeadline=Math.round((deadline-today)/(1000*60*60*24));
  const diffCanSend=Math.round((canSendFrom-today)/(1000*60*60*24));
  const deadlineStr=deadline.toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
  const fine=diffDeadline<0?calcWadeaFine(Math.abs(diffDeadline)):0;
  let html='';
  // تنبيه المهلة القبل-إرسال لحالة تعدد المساهمين
  if(isMulti&&diffCanSend>0){
    html+='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:var(--orange-g);border:1px solid rgba(251,146,60,.3);margin-bottom:8px"><span style="font-size:16px">⏳</span><div><div style="font-size:12.5px;font-weight:700;color:var(--orange)">هذه الشركة فيها أكثر من مساهم — لا تُرسل على النظام إلا بعد مرور '+WADEA_MULTI_WAIT+' يوم من تاريخ الشهادة</div><div style="font-size:11px;color:var(--text2)">باقي '+diffCanSend+' يوم لحين يصير بالإمكان الإرسال (تاريخ الإرسال المسموح: '+canSendFrom.toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'})+')</div></div></div>';
  }
  let color='var(--green)';let icon='✓';let msg='';
  if(diffDeadline<0){color='var(--red)';icon='⚠';msg='متأخرة '+Math.abs(diffDeadline)+' يوم — غرامة مستحقّة';}
  else if(diffDeadline<=7){color='var(--red)';icon='⚠';msg='باقي '+diffDeadline+' يوم فقط!';}
  else if(diffDeadline<=14){color='var(--orange)';icon='⏰';msg='باقي '+diffDeadline+' يوم';}
  else{icon='✓';msg='باقي '+diffDeadline+' يوم';}
  html+='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:'+(diffDeadline<0?'var(--red-g)':diffDeadline<=14?'var(--orange-g)':'var(--green-g)')+';border:1px solid '+(diffDeadline<0?'rgba(255,85,114,.3)':diffDeadline<=14?'rgba(251,146,60,.3)':'rgba(34,211,160,.3)')+'"><span style="font-size:16px">'+icon+'</span><div><div style="font-size:12px;font-weight:700;color:'+color+'">الموعد النهائي: '+deadlineStr+'</div><div style="font-size:11px;color:var(--text2)">'+days+' يوم من تاريخ الشهادة • '+msg+(fine>0?' • الغرامة حتى اليوم: '+fine.toLocaleString()+' د.ع':'')+'</div></div></div>';
  el.innerHTML=html;
}

function toggleCvWadea(n){
  const cb=document.getElementById('cv'+n);if(cb)cb.checked=!cb.checked;
  const chk=document.getElementById('cvcheck'+n);if(chk)chk.classList.toggle('checked',cb.checked);
}

function confirmConvert(){
  const overlay=document.getElementById('cvOverlay');
  if(!overlay)return;
  const sourceId=Number(overlay.dataset.sourceId);
  const certDate=document.getElementById('cvCertDate')?.value||'';
  const shareType=document.getElementById('cvShareType')?.value||'single';
  if(!certDate){toast('أدخل تاريخ الشهادة','err');return;}
  const src=cases.find(x=>x.id===sourceId);if(!src)return;
  // Calc deadline (المهلة الرسمية: 37 يوم لمساهم واحد، 55 يوم لأكثر من مساهم)
  const days=shareType==='multi'?WADEA_GRACE_MULTI:WADEA_GRACE_SINGLE;
  const certDateObj=new Date(certDate);
  const deadline=new Date(certDateObj);deadline.setDate(deadline.getDate()+days);
  // Get checks
  const checks=WADEA_ITEMS.filter((_,i)=>{const cb=document.getElementById('cv'+(i+1));return cb&&cb.checked;}).join('، ');
  // ── تحويل نفس المعاملة (لا ننشئ معاملة جديدة) ──
  src.type=WADEA_TYPE;
  src.tasisDone=true;
  src.date=certDate;
  src.wadeaChecks=checks;
  src.wadeaCertDate=certDate;
  src.wadeaShareholderType=shareType;
  src.wadeaDeadline=deadline.toISOString();
  src.status='قيد المعالجة';
  addLog(src,'edit','تم تحويل المعاملة من تأسيس شركة إلى إطلاق وديعة',currentUser||'الأدمن');
  saveData();render();
  closeCvOverlay();
  SFX.play('save');
  toast('✓ تم تحويل معاملة '+src.company+' لإطلاق وديعة','ok');
  setTimeout(()=>openDetail(sourceId),300);
}

function closeCvOverlay(){
  const ov=document.getElementById('cvOverlay');
  ov.classList.remove('open');
  setTimeout(()=>{ov.style.display='none';},200);
}

// ══════════════ تتبّع سير العمل (تأسيس شركة) ══════════════
const WF_STEPS=['الإرسال على النظام','موافقة غرفة التجارة','موافقة اتحاد الغرف','إصدار كتاب مصرف','عمل إضبارة الشركة','الموظف المختص','رفع القرار للتوقيع','إصدار شهادة التأسيس'];
let wfCaseId=null;
let wfPhase='flow'; // flow → cert

function faNum(n){return String(n).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);}

function openWorkflow(id){
  id=Number(id);const c=cases.find(x=>x.id===id);if(!c)return;
  wfCaseId=id;wfPhase=c.workflowStage>=WF_STEPS.length?'done':'flow';
  document.getElementById('wfCoName').textContent=c.company||'—';
  document.getElementById('wfOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('wfOverlay').classList.add('open'),10);
  renderWorkflow();
}
function closeWorkflow(){
  const ov=document.getElementById('wfOverlay');
  ov.classList.remove('open');
  setTimeout(()=>{ov.style.display='none';},200);
}
function renderWorkflow(){
  const c=cases.find(x=>x.id===wfCaseId);if(!c)return;
  const cur=typeof c.workflowStage==='number'?c.workflowStage:0;
  const dates=c.workflowDates||{};
  const box=document.getElementById('wfSteps');
  box.innerHTML=WF_STEPS.map((n,i)=>{
    const st=i<cur?'done':i===cur?'current':'wait';
    const meta=i<cur?('<svg class="wf-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg> '+(dates[i]||'مكتملة')):i===cur?'◷ جاري التنفيذ':'في الانتظار';
    const dotContent=i<cur?'✓':i===cur?'<span class="wf-spinner"></span>':faNum(i+1);
    return '<div class="wf-step '+st+'" style="animation-delay:'+(i*55)+'ms"><span class="wf-line"></span><div class="wf-dot">'+dotContent+'</div><div class="wf-stb"><div class="wf-stn">'+n+'</div><div class="wf-stm">'+meta+'</div></div></div>';
  }).join('');
  const pc=Math.round(Math.min(cur,WF_STEPS.length)/WF_STEPS.length*100);
  document.getElementById('wfPct').textContent=faNum(pc)+'%';
  setTimeout(()=>document.getElementById('wfPfill').style.width=pc+'%',60);
  document.getElementById('wfCurName').textContent=cur<WF_STEPS.length?WF_STEPS[cur]:'مكتملة ✓';
  document.getElementById('wfNxName').textContent=cur+1<WF_STEPS.length?WF_STEPS[cur+1]:(cur<WF_STEPS.length?'—':'إطلاق الوديعة');
  renderWorkflowAct();
}
function renderWorkflowAct(){
  const c=cases.find(x=>x.id===wfCaseId);if(!c)return;
  const cur=typeof c.workflowStage==='number'?c.workflowStage:0;
  const a=document.getElementById('wfAct');
  if(wfPhase==='flow'){
    if(cur<WF_STEPS.length-1){
      a.innerHTML='<button class="wf-btn wf-btn-em" onclick="advanceWorkflow()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg> إكمال «'+esc(WF_STEPS[cur])+'»</button>';
    } else if(cur<WF_STEPS.length){
      a.innerHTML='<button class="wf-btn wf-btn-gold" onclick="wfPhase=\'cert\';renderWorkflowAct()">إتمام إصدار شهادة التأسيس</button>';
    } else {
      a.innerHTML='<button class="wf-btn wf-btn-em" onclick="closeWorkflow();openConvertToWadea(wfCaseId)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> التحويل لإطلاق الوديعة</button>';
    }
  } else if(wfPhase==='cert'){
    a.innerHTML='<div class="wf-cert"><h4>◆ بيانات شهادة التأسيس</h4>'
      +'<div class="wf-fld"><label>رقم الشهادة</label><input id="wfCertNo" placeholder="مثال: 12345" value="'+esc(c.certNo||'')+'"></div>'
      +'<div class="wf-fld"><label>تاريخ الشهادة</label><input id="wfCertDate" type="date" value="'+(c.certDate||'')+'"></div>'
      +'<button class="wf-btn wf-btn-gold" onclick="confirmWorkflowCert()">موافق — إتمام التأسيس</button></div>';
  }
}
function advanceWorkflow(){
  const c=cases.find(x=>x.id===wfCaseId);if(!c)return;
  const cur=typeof c.workflowStage==='number'?c.workflowStage:0;
  const dots=document.querySelectorAll('#wfSteps .wf-dot');
  if(dots[cur])dots[cur].classList.add('pop');
  if(!c.workflowDates)c.workflowDates={};
  c.workflowDates[cur]=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
  c.workflowStage=cur+1;
  addLog(c,'edit','سير العمل: إكمال «'+WF_STEPS[cur]+'»',currentUser||'الأدمن');
  saveData();
  setTimeout(()=>renderWorkflow(),260);
}
function confirmWorkflowCert(){
  const c=cases.find(x=>x.id===wfCaseId);if(!c)return;
  const no=document.getElementById('wfCertNo')?.value?.trim()||'';
  const date=document.getElementById('wfCertDate')?.value||'';
  if(!no){toast('أدخل رقم الشهادة','err');return;}
  if(!date){toast('أدخل تاريخ الشهادة','err');return;}
  c.certNo=no;c.certDate=date;
  if(!c.workflowDates)c.workflowDates={};
  c.workflowDates[WF_STEPS.length-1]=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
  c.workflowStage=WF_STEPS.length;
  addLog(c,'edit','صدرت شهادة التأسيس رقم '+no,currentUser||'الأدمن');
  saveData();render();
  wfPhase='flow';
  toast('✓ تم تسجيل بيانات الشهادة','ok');
  renderWorkflow();
}


function openForm(id){
  editingId=id;document.getElementById('formTitle').textContent=id?'تعديل المعاملة':'معاملة جديدة';
  const c=id?cases.find(x=>x.id===id):{};
  document.getElementById('fCompany').value=c.company||'';document.getElementById('fDate').value=c.date||'';
  document.getElementById('fDef').value=c.deficiency||'';document.getElementById('fNotes').value=c.notes||'';
  pendingAttachFile=null;pendingAttachUrl=c.attachUrl||'';
  document.getElementById('attachFile').value='';document.getElementById('attachPreview').style.display='none';document.getElementById('attachPreview').innerHTML='';
  const cur=document.getElementById('attachCurrent');
  if(c.attachUrl){cur.style.display='block';cur.innerHTML='<div class="attach-preview"><svg class="attach-preview-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg><span class="attach-preview-name">'+esc(c.attachName||'مرفق موجود')+'</span><a href="'+safeUrl(c.attachUrl)+'" target="_blank" style="font-size:11px;color:var(--green);font-weight:700;text-decoration:none">فتح</a><button class="attach-del" onclick="removeAttach()">✕</button></div>';document.getElementById('attachZone').style.display='none';}
  else{cur.style.display='none';cur.innerHTML='';document.getElementById('attachZone').style.display='block';}
  document.getElementById('fHoldReason').value=c.holdReason||'';
  document.getElementById('fAmount').value=c.currency==='USD'?(c.amountUSD||''):(c.amountIQD||'');
  selAmtInc=Array.isArray(c.amountIncludes)?c.amountIncludes.slice():[];
  buildAmtIncGrid();
  ['errCompany','errType','errLawyer'].forEach(e=>document.getElementById(e).classList.remove('show'));
  selLawyer=c.lawyer||'';selStatus=c.status||'قيد المعالجة';selCur=c.currency||settings.defCurrency||'IQD';selDept=c.stage||'';
  buildLawyerSel();buildStatusOpts();buildDeptOpts();setCur(selCur);populateFormTypes();
  document.getElementById('fType').value=c.type||'';
  document.getElementById('fAmountLbl').textContent=(c.type||'')===TASIS_TYPE?'المبلغ المستلم':'المبلغ';
  document.getElementById('holdRow').style.display=selStatus==='معلقة'?'block':'none';
  document.getElementById('stageRow').style.display=(selStatus!=='منجزة'&&selStatus!=='معلقة')?'block':'none';
  const isWadea=(c.type||'')===WADEA_TYPE;document.getElementById('wadeaRow').style.display=isWadea?'block':'none';setWadeaChecks(isWadea?(c.wadeaChecks||''):'');
  // Show complete wadea button for existing wadea cases
  const completeRow=document.getElementById('wadeaCompleteRow');
  if(completeRow){
    const alreadyDone=id&&c.wadeaDone;
    completeRow.style.display=(isWadea&&id&&!alreadyDone)?'block':'none';
  }
  // Show "تحويل لإطلاق وديعة" button for tasis cases not yet converted
  const cvBtn=document.getElementById('formConvertBtn');
  if(cvBtn){
    const isTasis=(c.type||'')=== TASIS_TYPE;
    const alreadyConverted=id&&(c.tasisDone||c.wadeaLinkedId);
    cvBtn.style.display=(isTasis&&id&&!alreadyConverted)?'flex':'none';
  }
  openOverlay('formOverlay');
}
function buildLawyerSel(){document.getElementById('lawyerSel').innerHTML=settings.lawyers.map((l,i)=>'<div class="lawyer-opt'+(l===selLawyer?' sel':'')+'" onclick="pickLawyer(\''+l+'\')"><div style="width:10px;height:10px;border-radius:50%;background:'+LAWYER_COLORS[i%LAWYER_COLORS.length]+'"></div>'+l+'</div>').join('');}
function pickLawyer(n){selLawyer=n;buildLawyerSel();}
function buildStatusOpts(){
  const opts=[{v:'قيد المعالجة',c:'#F0A500',bg:'var(--gold-g)'},{v:'منجزة',c:'#00C48C',bg:'var(--green-g)'},{v:'معلقة',c:'#FF4D6A',bg:'var(--red-g)'},{v:'مراجعة',c:'#F0A500',bg:'var(--gold-g)'},{v:'ناقصة',c:'#9B6DFF',bg:'var(--purple-g)'}];
  document.getElementById('statusOpts').innerHTML=opts.map(o=>{const sel=o.v===selStatus;return '<div class="status-opt'+(sel?' sel':'')+'" style="'+(sel?'border-color:'+o.c+';background:'+o.bg+';color:'+o.c:'')+'" onclick="pickStatus(\''+o.v+'\')">'+o.v+'</div>';}).join('');
}
function pickStatus(v){selStatus=v;document.getElementById('holdRow').style.display=v==='معلقة'?'block':'none';document.getElementById('stageRow').style.display=(v!=='منجزة'&&v!=='معلقة')?'block':'none';buildStatusOpts();}
function buildDeptOpts(){const opts=[...settings.depts,'أخرى'];document.getElementById('deptOpts').innerHTML=opts.map(o=>'<div class="dept-opt'+(o===selDept?' sel':'')+'" onclick="pickDept(\''+o+'\')">'+o+'</div>').join('');document.getElementById('fStageOther').style.display=selDept==='أخرى'?'block':'none';}
function pickDept(n){selDept=n;buildDeptOpts();}
function setCur(c){selCur=c;document.getElementById('ctIQD').classList.toggle('active',c==='IQD');document.getElementById('ctUSD').classList.toggle('active',c==='USD');}
function populateFormTypes(){const s=document.getElementById('fType');const v=s.value;s.innerHTML='<option value="">— اختر النوع</option>'+settings.types.map(t=>'<option>'+t+'</option>').join('');s.value=v;s.onchange=onTypeChange;}
function onTypeChange(){
  const t=document.getElementById('fType').value;
  document.getElementById('fAmountLbl').textContent=t===TASIS_TYPE?'المبلغ المستلم':'المبلغ';
  document.getElementById('wadeaRow').style.display=t===WADEA_TYPE?'block':'none';
  // Show complete button only when editing an existing wadea case not yet completed
  const completeRow=document.getElementById('wadeaCompleteRow');
  if(completeRow){
    const src=editingId?cases.find(x=>x.id===editingId):null;
    const alreadyDone=src&&src.wadeaDone;
    completeRow.style.display=(t===WADEA_TYPE&&editingId&&!alreadyDone)?'block':'none';
  }
  // Show convert button only when editing a tasis case that's not yet converted
  const cvBtn=document.getElementById('formConvertBtn');
  if(cvBtn){
    const isTasis=t===TASIS_TYPE;
    const src=editingId?cases.find(x=>x.id===editingId):null;
    const alreadyConverted=src&&(src.tasisDone||src.wadeaLinkedId);
    cvBtn.style.display=(isTasis&&editingId&&!alreadyConverted)?'flex':'none';
  }
}

function formConvertToWadea(){
  if(!editingId)return;
  // Save first, then convert
  saveCase();
  setTimeout(()=>openConvertToWadea(editingId),200);
}

function completeWadea(){
  if(!editingId)return;
  const c=cases.find(x=>x.id===editingId);
  if(!c||c.type!==WADEA_TYPE)return;
  // Save current form data first
  saveCase();
  // Mark as done
  setTimeout(()=>{
    const updated=cases.find(x=>x.id===editingId);
    if(!updated)return;
    updated.wadeaDone=true;
    updated.status='منجزة';
    addLog(updated,'edit','أُكملت معاملة إطلاق الوديعة',currentUser||'الأدمن');
    saveData();render();
    toast('✓ أُكملت معاملة إطلاق الوديعة','ok');
  },300);
}
function toggleWadea(n){const cb=document.getElementById('wc'+n);cb.checked=!cb.checked;document.getElementById('wcheck'+n).classList.toggle('checked',cb.checked);}
function setWadeaChecks(val){const checked=(val||'').split(',').map(s=>s.trim()).filter(Boolean);WADEA_ITEMS.forEach((item,i)=>{const n=i+1;const cb=document.getElementById('wc'+n);const lbl=document.getElementById('wcheck'+n);if(!cb||!lbl)return;const isChecked=checked.includes(item);cb.checked=isChecked;lbl.classList.toggle('checked',isChecked);});}
function getWadeaValue(){return WADEA_ITEMS.filter((_,i)=>{const cb=document.getElementById('wc'+(i+1));return cb&&cb.checked;}).join('، ');}
function closeForm(){closeOverlay('formOverlay');}

async function saveCase(){
  const company=document.getElementById('fCompany').value.trim();const type=document.getElementById('fType').value;let ok=true;
  if(!company){document.getElementById('errCompany').classList.add('show');ok=false;}else document.getElementById('errCompany').classList.remove('show');
  if(!type){document.getElementById('errType').classList.add('show');ok=false;}else document.getElementById('errType').classList.remove('show');
  if(!selLawyer){document.getElementById('errLawyer').classList.add('show');ok=false;}else document.getElementById('errLawyer').classList.remove('show');
  if(!ok)return;
  const rawAmt=parseAmt(document.getElementById('fAmount').value);
  const stageVal=selDept==='أخرى'?(document.getElementById('fStageOther').value.trim()||'أخرى'):selDept;
  const data={company,type,lawyer:selLawyer,status:selStatus,currency:selCur,amountIQD:selCur==='IQD'?rawAmt:0,amountUSD:selCur==='USD'?rawAmt:0,deficiency:document.getElementById('fDef').value.trim(),notes:document.getElementById('fNotes').value.trim(),holdReason:selStatus==='معلقة'?document.getElementById('fHoldReason').value.trim():'',stage:stageVal,date:document.getElementById('fDate').value,attachUrl:pendingAttachUrl||'',attachName:pendingAttachFile?pendingAttachFile.name:(editingId?(cases.find(x=>x.id===editingId)||{}).attachName||'':''),wadeaChecks:type===WADEA_TYPE?getWadeaValue():'',amountIncludes:selAmtInc.slice()};
  if(editingId){const idx=cases.findIndex(c=>c.id===editingId);if(idx!==-1){const old=cases[idx];const logEntry={id:Date.now(),type:'edit',msg:'تم تعديل المعاملة',user:currentUser||'الأدمن',time:new Date().toISOString()};if(old.status!==data.status)logEntry.msg='تغيير الحالة: '+old.status+' → '+data.status;cases[idx]={...old,...data,log:[...(old.log||[]),logEntry],comments:old.comments||[]};if(old.status!=='معلقة'&&data.status==='معلقة')addNotif('hold','معاملة معلقة: '+data.company);else addNotif('edit','تعديل: '+data.company);}toast('تم التعديل','ok');}
  else{const newCase={id:Date.now(),addedAt:Date.now(),...data,log:[{id:Date.now(),type:'new',msg:'تمت إضافة المعاملة',user:currentUser||'الأدمن',time:new Date().toISOString()}],comments:[]};cases.push(newCase);_lastAddedId=newCase.id;addNotif('new','معاملة جديدة: '+data.company+' — '+data.lawyer);SFX.play('add');toast('تمت الإضافة','ok');}
  if(pendingAttachFile){const url=await uploadAttachment(pendingAttachFile, data.company);if(url){data.attachUrl=url;data.attachName=pendingAttachFile.name;if(editingId){const idx=cases.findIndex(c=>c.id===editingId);if(idx!==-1)cases[idx]={...cases[idx],...data};}else cases[cases.length-1]={...cases[cases.length-1],...data};}}
  saveData();render();closeForm();SFX.play('save');
  if(_lastAddedId){
    const _hid=_lastAddedId;_lastAddedId=null;
    setTimeout(()=>{
      const _hel=document.querySelector('[data-id="'+_hid+'"]');
      if(_hel){_hel.classList.add('row-new');setTimeout(()=>_hel&&_hel.classList.remove('row-new'),1900);}
    },80);
  }
}
// ══ DELETE WITH UNDO ══
function askDel(id){
  const c=cases.find(x=>x.id===id);if(!c)return;
  const det=document.getElementById('detailOverlay');
  if(det&&(det.style.display!=='none'&&det.style.display!=''))closeDetail();
  // Immediately remove from UI
  cases=cases.filter(x=>x.id!==id);
  render();
  SFX.play('delete');
  // Cancel any previous undo timer
  if(_undoTimer){
    clearTimeout(_undoTimer);
    if(_undoCase){sbDeleteCase(_undoCase.id);saveData();}
    if(_undoEl){const _pe=_undoEl;_undoEl=null;_pe.style.opacity='0';_pe.style.transform='translateY(8px)';_pe.style.transition='all .25s';setTimeout(()=>_pe.remove(),280);}
  }
  _undoCase=c;
  // Show undo toast
  const wrap=document.getElementById('toastWrap');
  const div=document.createElement('div');
  div.className='toast-undo';
  div.innerHTML='<div class="toast-undo-icon"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></div>'
    +'<span class="toast-undo-text">حُذف "'+c.company+'"</span>'
    +'<button class="toast-undo-btn" onclick="undoDelete()">تراجع</button>'
    +'<div class="toast-undo-bar"></div>';
  wrap.appendChild(div);
  _undoEl=div;
  // After 5 seconds, permanently delete
  _undoTimer=setTimeout(async()=>{
    if(!_undoCase||_undoCase.id!==id)return;
    const _dc=_undoCase;_undoCase=null;_undoTimer=null;
    sbDeleteCase(_dc.id);
    if(_dc.attachUrl){try{const path=_dc.attachUrl.split('/object/public/'+SB_BUCKET+'/')[1];if(path)await fetch(SB_URL+'/storage/v1/object/'+SB_BUCKET+'/'+path,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});}catch(e){}}
    saveData();
    if(_undoEl){const e=_undoEl;_undoEl=null;e.style.opacity='0';e.style.transform='translateY(8px)';e.style.transition='all .3s';setTimeout(()=>e.remove(),310);}
  },5000);
}
function askClearAll(){
  if(!isAdmin()){toast('هذه الخاصية للأدمن فقط','err');return;}
  document.getElementById('confirmTitle').textContent='مسح كل البيانات';
  document.getElementById('confirmSub').textContent='سيتم حذف جميع المعاملات نهائياً!';
  document.getElementById('confirmBtn').onclick=async()=>{for(const c of cases){if(c.attachUrl){try{const path=c.attachUrl.split('/object/public/'+SB_BUCKET+'/')[1];if(path)await fetch(SB_URL+'/storage/v1/object/'+SB_BUCKET+'/'+path,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});}catch(e){}}}try{await fetch(SB_URL+'/rest/v1/cases',{method:'DELETE',headers:{...SB_H,'Prefer':'return=minimal'}});}catch(e){}cases=[];localStorage.setItem(SK_D,JSON.stringify(cases));render();closeOverlay('confirmOverlay');toast('تم مسح جميع البيانات','err');};
  openOverlay('confirmOverlay');
}

// ══ VIEW / PAGES ══
function setView(v){
  currentView=v;
  document.getElementById('vtList').classList.toggle('active',v==='list');
  document.getElementById('vtCards').classList.toggle('active',v==='cards');
  const vk=document.getElementById('vtKanban');if(vk)vk.classList.toggle('active',v==='kanban');
  clearSelection();
  render();
}
function goPage(p){
  if((p==='reports'||p==='settings')&&!isAdmin()){toast('هذه الصفحة للأدمن فقط','err');return;}
  ['dash','charts','reports','tools','settings','deficiency','wadea','tasks'].forEach(x=>{const pg=document.getElementById('page'+x.charAt(0).toUpperCase()+x.slice(1));if(pg){pg.classList.toggle('active',x===p);pg.style.display=(x===p)?'flex':'none';}const sbMap={dash:'sbDash',charts:'sbCharts',reports:'sbReports',tools:'sbTools',settings:'sbSettings',deficiency:'sbDeficiency',wadea:'sbWadea',tasks:'sbTasks'};const sb=document.getElementById(sbMap[x]);if(sb)sb.classList.toggle('active',x===p);});
  if(p==='settings')loadSettingsPage();if(p==='charts')setTimeout(buildCharts,100);if(p==='reports')setTimeout(buildReports,50);if(p==='deficiency')setTimeout(buildDeficiencyPage,50);if(p==='wadea')setTimeout(buildWadeaPage,50);if(p==='tasks')setTimeout(buildTasksPage,50);
}
function mobGoPage(p){goPage(p);document.querySelectorAll('.mob-nav-btn').forEach(b=>{if(b.id!=='mnAddCenter')b.classList.remove('active');});const map={dash:'mnDash',charts:'mnCharts',settings:'mnUser',tools:'mnTools'};if(map[p]){const el=document.getElementById(map[p]);if(el)el.classList.add('active');}}

// ══ SETTINGS ══
function switchSetTab(tab){document.querySelectorAll('.set-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));document.querySelectorAll('.set-tab-content').forEach(c=>c.classList.remove('active'));const el=document.getElementById('setTab_'+tab);if(el)el.classList.add('active');}
function loadSettingsPage(){
  if(!isAdmin()){goPage('dash');toast('الإعدادات للأدمن فقط','err');return;}
  document.getElementById('setOfficeName').value=settings.officeName;document.getElementById('setDefCur').value=settings.defCurrency;
  renderTags('lawyerTags',settings.lawyers,'lawyer');renderTags('typeTags',settings.types,'type');renderTags('deptTags',settings.depts,'dept');
  updateNotifUI(settings.notifEnabled!==false);
  if(tab==='users') loadUsersList();
}
function renderTags(elId,arr,kind){document.getElementById(elId).innerHTML=arr.map((t,i)=>'<div class="tag">'+t+'<button class="tag-del" onclick="removeItem(\''+kind+'\','+i+')">✕</button></div>').join('');}
function removeItem(kind,i){if(!isAdmin())return;const map={lawyer:'lawyers',type:'types',dept:'depts'};const key=map[kind];if(!key)return;if(kind==='lawyer'&&cases.some(c=>c.lawyer===settings[key][i])){toast('المحامي عنده معاملات','err');return;}if(kind==='type'&&cases.some(c=>c.type===settings[key][i])){toast('النوع مستخدم','err');return;}settings[key].splice(i,1);saveCfg();loadSettingsPage();populateAllDropdowns();toast('تم الحذف','ok');}
function addLawyer(){if(!isAdmin())return;const inp=document.getElementById('newLawyerInp');if(!inp)return;const v=inp.value.trim();if(!v)return;settings.lawyers.push(v);saveCfg();inp.value='';loadSettingsPage();populateAllDropdowns();}
function addType(){if(!isAdmin())return;const inp=document.getElementById('newTypeInp');if(!inp)return;const v=inp.value.trim();if(!v)return;settings.types.push(v);saveCfg();inp.value='';loadSettingsPage();populateAllDropdowns();}
function addDept(){if(!isAdmin())return;const inp=document.getElementById('newDeptInp');if(!inp)return;const v=inp.value.trim();if(!v)return;settings.depts.push(v);saveCfg();inp.value='';loadSettingsPage();}
async function saveOfficeSettings(){
  if(!isAdmin())return;
  const nameInp=document.getElementById('setOfficeName');if(nameInp)settings.officeName=nameInp.value.trim()||'المحامي منتظر الخزرجي';
  const curInp=document.getElementById('setDefCur');if(curInp)settings.defCurrency=curInp.value;
  const errEl=document.getElementById('passChangeErr');if(errEl)errEl.classList.remove('show');
  const oldP=document.getElementById('oldPass')?.value||'';const newP=document.getElementById('newPass')?.value||'';const newP2=document.getElementById('newPass2')?.value||'';
  if(oldP||newP||newP2){const oldHash=await hashPassword(oldP);if(oldHash!==settings.adminPassHash){if(errEl){errEl.textContent='كلمة مرور الأدمن الحالية غلط';errEl.classList.add('show');}return;}if(newP.length<6){if(errEl){errEl.textContent='لازم 6 أحرف على الأقل';errEl.classList.add('show');}return;}if(newP!==newP2){if(errEl){errEl.textContent='كلمتا المرور غير متطابقتان';errEl.classList.add('show');}return;}settings.adminPassHash=await hashPassword(newP);settings.mustChangeAdminPass=false;if(document.getElementById('oldPass'))document.getElementById('oldPass').value='';if(document.getElementById('newPass'))document.getElementById('newPass').value='';if(document.getElementById('newPass2'))document.getElementById('newPass2').value='';toast('تم تغيير كلمة مرور الأدمن','ok');}
  const oldU=document.getElementById('oldUserPass')?.value||'';const newU=document.getElementById('newUserPass')?.value||'';const newU2=document.getElementById('newUserPass2')?.value||'';
  if(oldU||newU||newU2){const oldUHash=await hashPassword(oldU);if(oldUHash!==settings.userPassHash){if(errEl){errEl.textContent='كلمة مرور المستخدم الحالية غلط';errEl.classList.add('show');}return;}if(newU.length<6){if(errEl){errEl.textContent='لازم 6 أحرف على الأقل';errEl.classList.add('show');}return;}if(newU!==newU2){if(errEl){errEl.textContent='كلمتا المرور غير متطابقتان';errEl.classList.add('show');}return;}settings.userPassHash=await hashPassword(newU);settings.mustChangeUserPass=false;if(document.getElementById('oldUserPass'))document.getElementById('oldUserPass').value='';if(document.getElementById('newUserPass'))document.getElementById('newUserPass').value='';if(document.getElementById('newUserPass2'))document.getElementById('newUserPass2').value='';toast('تم تغيير كلمة مرور المستخدم','ok');}
  showSyncStatus('saving');
  await saveCfg();
  showSyncStatus('saved');
  setTimeout(()=>showSyncStatus(''),2000);
  document.getElementById('officeTitle').textContent=settings.officeName;
  document.title=settings.officeName;
  const sl=document.getElementById('sbLogoText');if(sl)sl.textContent=settings.officeName;
  toast('✓ تم حفظ الإعدادات على جميع الأجهزة','ok');
}
function populateAllDropdowns(){const ft=document.getElementById('filterType');const fl=document.getElementById('filterLawyer');const vt=ft.value,vl=fl.value;ft.innerHTML='<option value="">كل الأنواع</option>'+settings.types.map(t=>'<option>'+t+'</option>').join('');fl.innerHTML='<option value="">كل المحامين</option>'+settings.lawyers.map(l=>'<option>'+l+'</option>').join('');ft.value=vt;fl.value=vl;populateMobFilters();}

// ══ OVERLAYS ══
function openOverlay(id){document.getElementById(id).classList.add('open');}
function closeOverlay(id){
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.add('closing');
  setTimeout(()=>{el.classList.remove('open');el.classList.remove('closing');},230);
}
// ══ TOAST ══
let toastTimer;
const TOAST_ICONS={ok:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',err:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',warn:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',info:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'};
function toast(msg,type){const wrap=document.getElementById('toastWrap');if(!wrap)return;const t=type||'info';const div=document.createElement('div');div.className='toast toast-'+(t==='err'?'err':t==='ok'?'ok':'warn');div.innerHTML=(TOAST_ICONS[t]||TOAST_ICONS.info)+'<span>'+esc(msg)+'</span>';wrap.appendChild(div);setTimeout(()=>{div.style.opacity='0';div.style.transform='translateY(8px)';div.style.transition='all .3s';setTimeout(()=>div.remove(),300);},3200);}

// ══ EXPORT ══
function exportExcel(){if(!cases.length){toast('لا توجد بيانات للتصدير','err');return;}const ws=XLSX.utils.json_to_sheet(cases.map(c=>({'الشركة':c.company,'النوع':c.type,'المحامي':c.lawyer,'الحالة':c.status,'المبلغ IQD':c.amountIQD,'المبلغ USD':c.amountUSD,'النواقص':c.deficiency,'الملاحظات':c.notes,'المرحلة':c.stage,'التاريخ':c.date})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'المعاملات');XLSX.writeFile(wb,'LexDesk_'+new Date().toLocaleDateString('en')+'.xlsx');toast('تم التصدير','ok');}
function backupJSON(){const b={cases,settings,exportedAt:new Date().toISOString()};const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(b,null,2));a.download='LexDesk_backup_'+Date.now()+'.json';a.click();toast('تم حفظ النسخة الاحتياطية','ok');}
function openImport(){openOverlay('importOverlay');}
function openRestore(){openOverlay('restoreOverlay');}
function handleDrop(e){e.preventDefault();document.getElementById('dropZone').classList.remove('drag');const f=e.dataTransfer.files[0];if(f)processImportFile(f);}
function handleImportFile(inp){if(inp.files[0])processImportFile(inp.files[0]);}
function processImportFile(f){const r=new FileReader();r.onload=e=>{const wb=XLSX.read(e.target.result,{type:'binary'});const ws=wb.Sheets[wb.SheetNames[0]];const raw=XLSX.utils.sheet_to_json(ws);importRows=raw.map((r,i)=>({id:Date.now()+i,company:r['الشركة']||r['company']||'',type:r['النوع']||r['type']||settings.types[0],lawyer:r['المحامي']||r['lawyer']||settings.lawyers[0],status:r['الحالة']||r['status']||'قيد المعالجة',currency:'IQD',amountIQD:parseFloat(r['المبلغ IQD']||r['amountIQD']||0),amountUSD:parseFloat(r['المبلغ USD']||r['amountUSD']||0),deficiency:r['النواقص']||'',notes:r['الملاحظات']||'',stage:r['المرحلة']||'',date:r['التاريخ']||'',addedAt:Date.now()+i,holdReason:''}));document.getElementById('importPreview').textContent='تم قراءة '+importRows.length+' سجل';};r.readAsBinaryString(f);}
function confirmImport(){if(!importRows.length){toast('اختر ملف أولاً','err');return;}cases=[...cases,...importRows];saveData();render();closeOverlay('importOverlay');toast('تم استيراد '+importRows.length+' سجل','ok');importRows=[];}
function handleJSONRestore(inp){if(!inp.files[0])return;const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(d.cases)cases=d.cases;if(d.settings){settings={...settings,...d.settings};saveCfg();populateAllDropdowns();}saveData();render();closeOverlay('restoreOverlay');toast('تمت الاستعادة بنجاح','ok');}catch(err){toast('خطأ في ملف JSON','err');}};r.readAsText(inp.files[0]);}

// ══ ATTACHMENTS ══
let pendingAttachFile=null;let pendingAttachUrl='';const SB_BUCKET='attachments';
async function uploadAttachment(file,company){try{const ext=file.name.split('.').pop().toLowerCase();const fileName=Date.now()+'_case_'+(Date.now()%100000)+'.'+ext;const res=await fetch(SB_URL+'/storage/v1/object/'+SB_BUCKET+'/'+fileName,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':file.type,'x-upsert':'true'},body:file});if(!res.ok){const err=await res.json().catch(()=>({}));toast('فشل الرفع: '+(err.message||res.status),'err');return'';}toast('تم رفع الملف','ok');return SB_URL+'/storage/v1/object/public/'+SB_BUCKET+'/'+fileName;}catch(e){toast('خطأ في الاتصال','err');return'';}}
async function diagStorage(){toast('جاري الفحص...','info');try{const r=await fetch(SB_URL+'/storage/v1/object/'+SB_BUCKET+'/test_'+Date.now()+'.txt',{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'text/plain','x-upsert':'true'},body:new Blob(['test'],{type:'text/plain'})});if(r.ok)toast('Storage يشتغل','ok');else toast('خطأ: '+r.status,'err');}catch(e){toast('خطأ في الاتصال','err');}}
function handleAttachSelect(inp){const file=inp.files[0];if(!file)return;if(file.size>10*1024*1024){toast('الملف أكبر من 10MB','err');return;}pendingAttachFile=file;const sizeMB=(file.size/1024/1024).toFixed(2);const prev=document.getElementById('attachPreview');prev.style.display='block';prev.innerHTML='<div class="attach-preview"><span class="attach-preview-name">'+file.name+'</span><span class="attach-preview-size">'+sizeMB+' MB</span><button class="attach-del" onclick="clearAttach()">✕</button></div>';}
function clearAttach(){pendingAttachFile=null;document.getElementById('attachFile').value='';document.getElementById('attachPreview').style.display='none';document.getElementById('attachPreview').innerHTML='';}
function removeAttach(){pendingAttachUrl='';document.getElementById('attachCurrent').style.display='none';document.getElementById('attachZone').style.display='block';}
// ══ MOBILE ══
function initMobile(){window.addEventListener('resize',()=>{const mn=document.getElementById('mobNav');if(!mn)return;const loggedIn=document.getElementById('appWrap')&&document.getElementById('appWrap').style.display!=='none';mn.style.display=(window.innerWidth<=768&&loggedIn)?'flex':'none';document.body.style.paddingBottom=window.innerWidth<=768?'68px':'0';});}
function syncMobFilter(type,val){if(type==='type')document.getElementById('filterType').value=val;else if(type==='lawyer')document.getElementById('filterLawyer').value=val;else if(type==='status')document.getElementById('filterStatus').value=val;render();}
function populateMobFilters(){const mt=document.getElementById('mobFilterType');const ml=document.getElementById('mobFilterLawyer');if(!mt||!ml)return;const vt=mt.value,vl=ml.value;mt.innerHTML='<option value="">كل الأنواع</option>'+settings.types.map(t=>'<option>'+t+'</option>').join('');ml.innerHTML='<option value="">كل المحامين</option>'+settings.lawyers.map(l=>'<option>'+l+'</option>').join('');mt.value=vt;ml.value=vl;}

// ══ CASE DETAIL ══
let detailCaseId=null;
function openDetail(id){
  try{id=Number(id);const c=cases.find(x=>x.id===id);if(!c)return;detailCaseId=id;
  const lci=settings.lawyers.indexOf(c.lawyer);const lc=LAWYER_COLORS[lci%LAWYER_COLORS.length];
  document.getElementById('detAvatar').textContent=(c.company||'؟')[0];document.getElementById('detAvatar').style.background='linear-gradient(135deg,'+lc+','+lc+'bb)';
  document.getElementById('detName').textContent=c.company||'—';document.getElementById('detType').textContent=c.type||'—';
  document.getElementById('detDate').textContent=c.date?new Date(c.date).toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'}):'بلا تاريخ';
  const editBtn=document.getElementById('detEditBtn');const newEditBtn=editBtn.cloneNode(true);editBtn.parentNode.replaceChild(newEditBtn,editBtn);newEditBtn.addEventListener('click',()=>{closeDetail();openForm(id);});
  // Show/hide workflow tracker button (تأسيس شركة فقط، قبل التحويل لوديعة)
  const wfBtn=document.getElementById('detWorkflowBtn');
  if(wfBtn){
    wfBtn.style.display=(c.type===TASIS_TYPE&&!c.tasisDone&&!c.wadeaLinkedId)?'flex':'none';
  }
  // Show certificate number/date if recorded
  const certEl=document.getElementById('detCertInfo');
  if(certEl){
    if(c.certNo&&c.certDate){
      certEl.style.display='block';
      const dStr=new Date(c.certDate).toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
      certEl.innerHTML='<div class="detail-section-title">◆ شهادة التأسيس</div>'
        +'<div class="detail-grid" style="margin-top:10px">'
        +'<div class="detail-field"><div class="detail-field-lbl">رقم الشهادة</div><div class="detail-field-val">'+esc(c.certNo)+'</div></div>'
        +'<div class="detail-field"><div class="detail-field-lbl">تاريخ الشهادة</div><div class="detail-field-val">'+dStr+'</div></div>'
        +'</div>';
    } else certEl.style.display='none';
  }
  // Show/hide convert button
  const cvBtn=document.getElementById('detConvertBtn');
  if(cvBtn){
    if(c.type===TASIS_TYPE&&!c.tasisDone&&!c.wadeaLinkedId){
      cvBtn.style.display='flex';
      const newCvBtn=cvBtn.cloneNode(true);cvBtn.parentNode.replaceChild(newCvBtn,cvBtn);
      newCvBtn.addEventListener('click',()=>{closeDetail();openConvertToWadea(id);});
    } else {
      cvBtn.style.display='none';
    }
  }
  // Show tasis done badge & linked wadea
  const tasisBadge=document.getElementById('detTasisBadge');
  if(tasisBadge){
    if(c.tasisDone&&c.type===WADEA_TYPE){
      tasisBadge.style.display='block';
      tasisBadge.innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:var(--gold-g);border:1px solid rgba(245,166,35,.25);margin-bottom:4px">'
        +'<span style="font-size:16px">✓</span>'
        +'<div style="font-size:13px;font-weight:700;color:var(--gold)">اكتمل التأسيس — المعاملة الآن في مرحلة إطلاق الوديعة</div>'
        +'</div>';
    } else tasisBadge.style.display='none';
  }
  // Show wadea deadline countdown for linked wadea cases
  const wadeaDeadlineEl=document.getElementById('detWadeaDeadline');
  if(wadeaDeadlineEl){
    if(c.type===WADEA_TYPE&&c.wadeaDeadline){
      wadeaDeadlineEl.style.display='block';
      const deadline=new Date(c.wadeaDeadline);
      const today=new Date();today.setHours(0,0,0,0);
      const diff=Math.round((deadline-today)/(1000*60*60*24));
      const deadlineStr=deadline.toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
      const isMulti=c.wadeaShareholderType==='multi';
      const days=isMulti?WADEA_GRACE_MULTI:WADEA_GRACE_SINGLE;
      const fine=diff<0?calcWadeaFine(Math.abs(diff)):0;
      let bg,bc,icon,msg;
      if(diff<0){bg='var(--red-g)';bc='rgba(255,85,114,.3)';icon='⚠';msg='متأخرة '+Math.abs(diff)+' يوم!';}
      else if(diff<=7){bg='var(--red-g)';bc='rgba(255,85,114,.3)';icon='⚠';msg='باقي '+diff+' يوم فقط!';}
      else if(diff<=14){bg='var(--orange-g)';bc='rgba(251,146,60,.3)';icon='⏰';msg='باقي '+diff+' يوم';}
      else{bg='var(--green-g)';bc='rgba(34,211,160,.3)';icon='✓';msg='باقي '+diff+' يوم';}
      let earlyBlock='';
      if(isMulti&&c.wadeaCertDate){
        const canSendFrom=new Date(c.wadeaCertDate);canSendFrom.setDate(canSendFrom.getDate()+WADEA_MULTI_WAIT);
        const diffCanSend=Math.round((canSendFrom-today)/(1000*60*60*24));
        if(diffCanSend>0){
          earlyBlock='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px;background:var(--orange-g);border:1px solid rgba(251,146,60,.3);margin-top:8px">'
            +'<span style="font-size:20px">⏳</span>'
            +'<div><div style="font-size:13px;font-weight:800;color:var(--orange)">هذه الشركة فيها أكثر من مساهم — لا تُرسل على النظام إلا بعد '+diffCanSend+' يوم</div>'
            +'<div style="font-size:11px;color:var(--text2)">تاريخ الإرسال المسموح: '+canSendFrom.toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'})+'</div></div></div>';
        }
      }
      wadeaDeadlineEl.innerHTML='<div class="detail-section-title">⏰ مهلة الغرامة</div>'
        +earlyBlock
        +'<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px;background:'+bg+';border:1px solid '+bc+';margin-top:10px">'
        +'<span style="font-size:22px">'+icon+'</span>'
        +'<div><div style="font-size:14px;font-weight:800;color:'+(diff<0?'var(--red)':diff<=7?'var(--red)':diff<=14?'var(--orange)':'var(--green)')+'">'+msg+'</div>'
        +'<div style="font-size:11px;color:var(--text2)">الموعد النهائي: '+deadlineStr+' ('+days+' يوم من تاريخ الشهادة)</div>'
        +(fine>0?'<div style="font-size:12px;font-weight:700;color:var(--red);margin-top:3px">الغرامة المستحقّة: '+fine.toLocaleString()+' د.ع</div>':'')
        +(c.tasisLinkedId?'<div style="font-size:11px;color:var(--text2);cursor:pointer;text-decoration:underline;margin-top:2px" onclick="closeDetail();setTimeout(()=>openDetail('+c.tasisLinkedId+'),150)">↑ معاملة التأسيس الأصلية</div>':'')
        +'</div></div>';
    } else wadeaDeadlineEl.style.display='none';
  }
  document.getElementById('detLawyer').innerHTML='<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:50%;background:'+lc+';display:inline-block"></span>'+c.lawyer+'</span>';
  document.getElementById('detStatus').innerHTML='<span class="status-badge '+statusClass(c.status)+'">'+c.status+'</span>'+(c.holdReason?'<div style="font-size:11px;color:var(--text3);margin-top:4px">'+esc(c.holdReason)+'</div>':'');
  const amt=c.currency==='USD'?'<span style="color:var(--green);font-family:var(--font-d);font-size:18px;font-weight:900">$'+fmt(c.amountUSD)+'</span>':'<span style="color:var(--gold);font-family:var(--font-d);font-size:18px;font-weight:900">'+fmt(c.amountIQD)+' د.ع</span>';
  document.getElementById('detAmount').innerHTML=amt;document.getElementById('detStage').textContent=c.stage||'—';
  const amtIncEl=document.getElementById('detAmtInc');
  if(amtIncEl){
    if(Array.isArray(c.amountIncludes)&&c.amountIncludes.length){
      amtIncEl.style.display='flex';
      amtIncEl.innerHTML=c.amountIncludes.map(t=>'<span class="amt-inc-tag">✓ '+esc(t)+'</span>').join('');
    } else { amtIncEl.style.display='none'; amtIncEl.innerHTML=''; }
  }
  document.getElementById('detDefRow').style.display=c.deficiency?'block':'none';document.getElementById('detDef').textContent=c.deficiency||'—';
  document.getElementById('detNotesRow').style.display=c.notes?'block':'none';document.getElementById('detNotes').textContent=c.notes||'—';
  const attachRow=document.getElementById('detAttachRow');if(c.attachUrl){attachRow.style.display='block';document.getElementById('detAttach').innerHTML='<a href="'+safeUrl(c.attachUrl)+'" target="_blank" style="color:var(--blue2);font-weight:700;text-decoration:none">'+esc(c.attachName||'فتح المرفق')+' ↗</a>';}else attachRow.style.display='none';
  const wadeaDetailRow=document.getElementById('detWadeaRow');
  if(wadeaDetailRow){if(c.type===WADEA_TYPE){wadeaDetailRow.style.display='block';const checked=(c.wadeaChecks||'').split('،').map(s=>s.trim()).filter(Boolean);document.getElementById('detWadeaList').innerHTML=WADEA_ITEMS.map(item=>{const done=checked.includes(item);return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1px solid '+(done?'var(--green)':'var(--border)')+';background:'+(done?'var(--green-g)':'var(--surface)')+';margin-bottom:6px"><span style="font-size:13px;font-weight:600;color:'+(done?'var(--green)':'var(--text2)')+'">'+item+'</span></div>';}).join('');}else wadeaDetailRow.style.display='none';}
  renderDetailComments(c);renderDetailTimeline(c);document.getElementById('commentInp').value='';
  const ov=document.getElementById('detailOverlay');ov.style.display='flex';setTimeout(()=>ov.classList.add('open'),10);
  }catch(err){console.error('openDetail error:',err);}
}
function renderDetailComments(c){const comments=c.comments||[];const el=document.getElementById('detComments');if(!comments.length){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0">لا توجد تعليقات بعد</div>';return;}el.innerHTML=comments.map(cm=>{const t=new Date(cm.time);const ts=t.toLocaleDateString('ar-IQ',{month:'short',day:'numeric'})+' '+t.toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});return '<div class="comment-item"><button class="comment-del" onclick="deleteComment('+cm.id+')" title="حذف">✕</button><div class="comment-txt">'+esc(cm.text)+'</div><div class="comment-meta"><span style="font-weight:700;color:var(--text)">'+esc(cm.user)+'</span><span>•</span><span>'+ts+'</span></div></div>';}).join('');}
function renderDetailTimeline(c){const log=c.log||[];const el=document.getElementById('detTimeline');if(!log.length){el.innerHTML='<div style="font-size:12px;color:var(--text3)">لا يوجد سجل بعد</div>';return;}const dotColors={new:'var(--green)',edit:'var(--gold)',status:'var(--blue2)',comment:'var(--purple)'};el.innerHTML=[...log].reverse().map(l=>{const t=new Date(l.time);const ts=t.toLocaleDateString('ar-IQ',{month:'short',day:'numeric',year:'numeric'})+' '+t.toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});const col=dotColors[l.type]||'var(--gold)';return '<div class="tl-item"><div class="tl-dot" style="border-color:'+col+'"></div><div class="tl-body"><div class="tl-txt">'+esc(l.msg)+'</div><div class="tl-time">'+esc(l.user)+' • '+ts+'</div></div></div>';}).join('');}
function addComment(){const text=(document.getElementById('commentInp').value||'').trim();if(!text)return;const c=cases.find(x=>x.id===detailCaseId);if(!c)return;const cm={id:Date.now(),text,user:currentUser||'الأدمن',time:new Date().toISOString()};if(!c.comments)c.comments=[];c.comments.push(cm);if(!c.log)c.log=[];c.log.push({id:Date.now()+1,type:'comment',msg:'تم إضافة تعليق',user:currentUser||'الأدمن',time:new Date().toISOString()});saveData();renderDetailComments(c);renderDetailTimeline(c);document.getElementById('commentInp').value='';SFX.play('save');}
function deleteComment(cid){const c=cases.find(x=>x.id===detailCaseId);if(!c||!c.comments)return;c.comments=c.comments.filter(x=>x.id!==cid);saveData();renderDetailComments(c);}
// ══ REPORTS ══
let repPeriod='all';
function setRepPeriod(p,btn){repPeriod=p;document.querySelectorAll('.pt').forEach(b=>b.classList.remove('active'));btn.classList.add('active');buildReports();}
function getRepCases(){const now=new Date();return cases.filter(c=>{if(repPeriod==='all')return true;if(!c.date&&!c.addedAt)return true;const d=new Date(c.date||c.addedAt);if(repPeriod==='year')return d.getFullYear()===now.getFullYear();if(repPeriod==='month')return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true;});}
function buildReports(){
  const filtered=getRepCases();const totalIQD=filtered.reduce((s,c)=>s+(c.amountIQD||0),0);const totalUSD=filtered.reduce((s,c)=>s+(c.amountUSD||0),0);const done=filtered.filter(c=>c.status==='منجزة').length;
  const sc=document.getElementById('repSummaryCards');
  if(sc)sc.innerHTML='<div class="stat-card"><div class="stat-top"><div class="stat-ico" style="background:var(--gold-g);color:var(--gold)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="stat-tag" style="background:var(--gold-g);color:var(--gold)">IQD</div></div><div class="stat-val iqd">'+fmt(totalIQD)+'</div><div class="stat-lbl">إجمالي الدينار</div></div><div class="stat-card"><div class="stat-top"><div class="stat-ico" style="background:var(--green-g);color:var(--green)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="stat-tag" style="background:var(--green-g);color:var(--green)">USD</div></div><div class="stat-val" style="color:var(--green)">$'+fmt(totalUSD)+'</div><div class="stat-lbl">إجمالي الدولار</div></div><div class="stat-card"><div class="stat-top"><div class="stat-ico" style="background:var(--blue-g);color:var(--blue2)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="stat-tag" style="background:var(--blue-g);color:var(--blue2)">'+filtered.length+'</div></div><div class="stat-val" style="color:var(--blue2)">'+done+'</div><div class="stat-lbl">معاملات منجزة</div></div>';
  const months={};filtered.forEach(c=>{const d=new Date(c.date||c.addedAt||Date.now());const key=d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');const lbl=d.toLocaleDateString('ar-IQ',{month:'short',year:'numeric'});if(!months[key])months[key]={lbl,iqd:0,usd:0,count:0};months[key].iqd+=(c.amountIQD||0);months[key].usd+=(c.amountUSD||0);months[key].count++;});
  const sortedMonths=Object.entries(months).sort((a,b)=>a[0].localeCompare(b[0]));const maxIQD=Math.max(...sortedMonths.map(([,v])=>v.iqd),1);
  const repM=document.getElementById('repMonthly');if(repM){if(!sortedMonths.length){repM.innerHTML='<div style="text-align:center;color:var(--text3);padding:20px">لا توجد بيانات</div>';return;}repM.innerHTML=sortedMonths.map(([,v])=>'<div class="month-row"><div class="month-lbl">'+v.lbl+'</div><div class="month-bar-wrap"><div class="month-bar-fill" style="background:linear-gradient(90deg,var(--gold),var(--gold2));width:'+Math.max(v.iqd/maxIQD*100,3)+'%">'+(v.iqd>0?'<span>'+v.count+' معاملة</span>':'')+'</div></div><div class="month-amt">'+fmt(v.iqd)+' د.ع</div><div class="month-count">'+(v.usd>0?'$'+fmt(v.usd):'')+'</div></div>').join('');}
  const repL=document.getElementById('repLawyers');if(repL)repL.innerHTML=settings.lawyers.map((l,i)=>{const lCases=filtered.filter(c=>c.lawyer===l);const lIQD=lCases.reduce((s,c)=>s+(c.amountIQD||0),0);const col=LAWYER_COLORS[i%LAWYER_COLORS.length];return '<div class="lawyer-report-row"><div class="lr-av" style="background:'+col+'">'+l[0]+'</div><div class="lr-info"><div class="lr-name">'+l+'</div><div class="lr-stats"><div class="lr-stat">معاملات: <span>'+lCases.length+'</span></div></div></div><div class="lr-amts"><div class="lr-iqd">'+fmt(lIQD)+' د.ع</div></div></div>';}).join('');
  const repS=document.getElementById('repStatuses');if(repS){const sList=['قيد المعالجة','منجزة','معلقة','مراجعة','ناقصة'];const sColors={'قيد المعالجة':'var(--green)','منجزة':'var(--blue2)','معلقة':'var(--red)','مراجعة':'var(--gold)','ناقصة':'var(--purple)'};repS.innerHTML=sList.map(s=>{const n=filtered.filter(c=>c.status===s).length;const pct=filtered.length?Math.round(n/filtered.length*100):0;return '<div class="rep-summary-row"><div class="rep-sum-lbl"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+sColors[s]+';margin-left:6px"></span>'+s+'</div><div style="display:flex;align-items:center;gap:10px"><div class="rep-sum-val">'+n+'</div><div style="font-size:11px;color:var(--text3)">'+pct+'%</div></div></div>';}).join('');}
  const repT=document.getElementById('repTopClients');if(repT){const sorted=[...filtered].sort((a,b)=>(b.amountIQD||0)-(a.amountIQD||0)).slice(0,5);if(!sorted.length){repT.innerHTML='<div style="text-align:center;color:var(--text3);padding:20px">لا توجد بيانات</div>';return;}const maxAmt=Math.max(...sorted.map(c=>c.amountIQD||0),1);repT.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">'+sorted.map((c,i)=>{const pct=Math.max((c.amountIQD||0)/maxAmt*100,4);return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px"><div style="font-size:18px;margin-bottom:6px">'+(i+1)+'</div><div style="font-size:14px;font-weight:700;margin-bottom:4px">'+esc(c.company)+'</div><div style="font-size:11px;color:var(--text2);margin-bottom:8px">'+c.type+'</div><div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:2px"></div></div><div style="font-family:var(--font-d);font-size:16px;font-weight:900;color:var(--gold)">'+fmt(c.amountIQD)+' د.ع</div></div>';}).join('')+'</div>';}
}
function exportReportPDF(){window.print();toast('جاري الطباعة','ok');}

// ══ REMINDERS ══
const SK_REM='lexdesk_reminders';let reminders=[];let selRemCat='عام';let selRemColor='var(--gold)';
const REM_CATS={'عام':{color:'var(--gold)',bg:'var(--gold-g)'},'أوراق':{color:'var(--blue2)',bg:'var(--blue-g)'},'فلوس':{color:'var(--green)',bg:'var(--green-g)'},'موعد':{color:'var(--purple)',bg:'var(--purple-g)'},'عاجل':{color:'var(--red)',bg:'var(--red-g)'}};
async function loadReminders(){const cloud=await sbLoadMeta('reminders');if(cloud&&Array.isArray(cloud))reminders=cloud;else{try{reminders=JSON.parse(localStorage.getItem(SK_REM)||'[]');}catch(e){reminders=[];}}renderRemBadge();renderRemList();}
function saveReminders(){try{localStorage.setItem(SK_REM,JSON.stringify(reminders));}catch(e){}sbSaveMeta('reminders',reminders);}
function renderRemBadge(){const active=reminders.filter(r=>!r.done).length;const b=document.getElementById('remBadge');if(!b)return;b.textContent=active>9?'9+':active;b.classList.toggle('show',active>0);}
function renderRemList(){const el=document.getElementById('remList');if(!el)return;if(!reminders.length){el.innerHTML='<div class="rem-empty">لا توجد تذكيرات</div>';return;}const sorted=[...reminders].sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;return(b.addedAt||0)-(a.addedAt||0);});el.innerHTML=sorted.map(r=>{const c=REM_CATS[r.cat]||REM_CATS['عام'];return '<div class="rem-item'+(r.done?' done':'')+'"><div class="rem-color" style="background:'+c.color+'"></div><div class="rem-body"><div class="rem-text">'+esc(r.text)+'</div><div class="rem-meta"><span class="rem-tag" style="background:'+c.bg+';color:'+c.color+'">'+r.cat+'</span>'+(r.date?'<span class="rem-date">'+r.date+'</span>':'')+'</div></div><div class="rem-acts"><button class="rem-act done-btn" onclick="toggleRemDone('+r.id+')">✓</button><button class="rem-act del" onclick="deleteRem('+r.id+')">✕</button></div></div>';}).join('');}
function toggleRemPanel(){const p=document.getElementById('remPanel');document.getElementById('notifPanel').classList.remove('open');p.classList.toggle('open');}
function openRemForm(){document.getElementById('remForm').style.display='block';document.getElementById('remText').focus();}
function closeRemForm(){document.getElementById('remForm').style.display='none';document.getElementById('remText').value='';document.getElementById('remDate').value='';}
function pickRemCat(el){document.querySelectorAll('.rem-cat-opt').forEach(o=>{o.classList.remove('sel');o.style.background='';o.style.color='';o.style.borderColor='';});el.classList.add('sel');const c=REM_CATS[el.dataset.cat]||REM_CATS['عام'];el.style.background=c.bg;el.style.color=c.color;selRemCat=el.dataset.cat;}
function saveReminder(){const text=(document.getElementById('remText').value||'').trim();if(!text)return;reminders.unshift({id:Date.now(),text,cat:selRemCat,date:document.getElementById('remDate').value||'',done:false,addedAt:Date.now()});saveReminders();renderRemList();renderRemBadge();closeRemForm();SFX.play('add');toast('تم حفظ التذكير','ok');}
function toggleRemDone(id){const r=reminders.find(x=>x.id===id);if(!r)return;r.done=!r.done;saveReminders();renderRemList();renderRemBadge();}
function deleteRem(id){reminders=reminders.filter(x=>x.id!==id);saveReminders();renderRemList();renderRemBadge();toast('تم الحذف','ok');}

// ══ PARTICLES ══
(function(){const canvas=document.getElementById('particles');if(!canvas)return;const ctx=canvas.getContext('2d');let W,H,particles=[];function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;}resize();window.addEventListener('resize',resize);const isDark=()=>document.documentElement.getAttribute('data-theme')!=='light';for(let i=0;i<55;i++)particles.push({x:Math.random()*window.innerWidth,y:Math.random()*window.innerHeight,r:Math.random()*1.5+0.3,dx:(Math.random()-.5)*0.25,dy:(Math.random()-.5)*0.25,o:Math.random()*0.5+0.15});function draw(){ctx.clearRect(0,0,W,H);const color=isDark()?'240,165,0':'11,29,58';particles.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba('+color+','+p.o+')';ctx.fill();p.x+=p.dx;p.y+=p.dy;if(p.x<0||p.x>W)p.dx*=-1;if(p.y<0||p.y>H)p.dy*=-1;});for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){const dx=particles[i].x-particles[j].x;const dy=particles[i].y-particles[j].y;const dist=Math.sqrt(dx*dx+dy*dy);if(dist<120){ctx.beginPath();ctx.moveTo(particles[i].x,particles[i].y);ctx.lineTo(particles[j].x,particles[j].y);ctx.strokeStyle='rgba('+color+','+(0.06*(1-dist/120))+')';ctx.lineWidth=0.5;ctx.stroke();}}requestAnimationFrame(draw);}draw();})();

// ══ SOUND EFFECTS ══
const SFX={_ctx:null,_get(){if(!this._ctx)this._ctx=new(window.AudioContext||window.webkitAudioContext)();return this._ctx;},_tone(freq,dur,vol=0.04,type='sine',fadeIn=0.01){try{const ctx=this._get();const o=ctx.createOscillator();const g=ctx.createGain();const comp=ctx.createDynamicsCompressor();o.type=type;o.frequency.setValueAtTime(freq,ctx.currentTime);g.gain.setValueAtTime(0,ctx.currentTime);g.gain.linearRampToValueAtTime(vol,ctx.currentTime+fadeIn);g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+dur);o.connect(g);g.connect(comp);comp.connect(ctx.destination);o.start(ctx.currentTime);o.stop(ctx.currentTime+dur);}catch(e){}},play(type){try{if(type==='add'){this._tone(880,0.25,0.04);setTimeout(()=>this._tone(1108,0.3,0.03),100);}else if(type==='save')this._tone(1046,0.18,0.03);else if(type==='delete'){try{const c=this._get();const o=c.createOscillator();const g=c.createGain();const comp=c.createDynamicsCompressor();o.type='sine';o.frequency.setValueAtTime(440,c.currentTime);o.frequency.exponentialRampToValueAtTime(220,c.currentTime+0.3);g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(0.04,c.currentTime+0.01);g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.35);o.connect(g);g.connect(comp);comp.connect(c.destination);o.start(c.currentTime);o.stop(c.currentTime+0.35);}catch(e){}}else if(type==='notif')this._tone(1318,0.4,0.03);else if(type==='login'){this._tone(523,0.3,0.03);setTimeout(()=>this._tone(659,0.3,0.03),120);setTimeout(()=>this._tone(784,0.45,0.04),240);}}catch(e){}}};

// ══ COUNT-UP ══
function countUp(el,target,prefix,suffix,duration){if(!el)return;if(target===0){el.textContent=(prefix||'')+'0'+(suffix||'');return;}const startTime=performance.now();function update(now){const elapsed=now-startTime;const progress=Math.min(elapsed/duration,1);const eased=1-Math.pow(1-progress,3);const current=Math.round(target*eased);if(!el)return;el.textContent=(prefix||'')+current.toLocaleString('en-US')+(suffix||'');if(progress<1)requestAnimationFrame(update);else el.textContent=(prefix||'')+target.toLocaleString('en-US')+(suffix||'');}requestAnimationFrame(update);}

// ══ KEYBOARD ══
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    // Close command palette first (highest priority)
    if(document.getElementById('cmdOverlay').classList.contains('open')){closeCmd();return;}
    // Close AI panel
    if(document.getElementById('aiPanel').classList.contains('open')){toggleAI();return;}
    // Close client profile
    const cp=document.getElementById('clientOverlay');if(cp&&cp.classList.contains('open')){closeClientProfile();return;}
    // Default closes
    closeAllDrops();
    closeDetail();
    ['formOverlay','confirmOverlay','importOverlay','restoreOverlay','cvOverlay'].forEach(closeOverlay);
    document.getElementById('notifPanel').classList.remove('open');
    document.getElementById('remPanel').classList.remove('open');
    clearSelection();
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='n'){e.preventDefault();openForm(null);}
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openCmd();}
});
document.addEventListener('click',e=>{closeAllDrops();const panel=document.getElementById('notifPanel');const bell=document.getElementById('notifBell');if(panel&&bell&&!panel.contains(e.target)&&!bell.contains(e.target))panel.classList.remove('open');const rp=document.getElementById('remPanel');const rb=document.getElementById('remBell');if(rp&&rb&&!rp.contains(e.target)&&!rb.contains(e.target))rp.classList.remove('open');});


// ══ USERS MANAGEMENT (Admin only) ══

async function addNewUser(){
  if(!isAdmin()){ toast('صلاحية الأدمن فقط','err'); return; }
  const name  = (document.getElementById('newUserName')?.value||'').trim();
  const email = (document.getElementById('newUserEmail')?.value||'').trim();
  const pass  = (document.getElementById('addUserPass')?.value||'').trim();
  const role  = document.getElementById('newUserRole')?.value||'user';

  if(!name||!email||!pass){ toast('أكمل جميع الحقول','warn'); return; }
  if(pass.length < 6){ toast('كلمة المرور 6 أحرف على الأقل','warn'); return; }

  const btn = document.querySelector('[onclick="addNewUser()"]');
  if(btn){ btn.disabled=true; btn.style.opacity='0.6'; }

  try{
    // Use Supabase Admin API via service role — but we only have anon key
    // So we use the regular signup endpoint (email confirmation disabled)
    const r = await sbFetch(SB_URL+'/auth/v1/signup',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY},
      body: JSON.stringify({
        email, password:pass,
        data:{ full_name:name, role }
      })
    });
    const d = await r.json();

    if(d.error){
      toast('خطأ: '+(d.error.message||d.msg||JSON.stringify(d.error)),'err');
    } else {
      toast('✓ تم إضافة '+name+' بنجاح','ok');
      document.getElementById('newUserName').value='';
      document.getElementById('newUserEmail').value='';
      document.getElementById('addUserPass').value='';
      setTimeout(loadUsersList, 500);
    }
  } catch(e){
    toast('خطأ في الاتصال: '+e.message,'err');
  }

  if(btn){ btn.disabled=false; btn.style.opacity='1'; }
}

async function loadUsersList(){
  const wrap = document.getElementById('usersListWrap');
  if(!wrap) return;
  if(!isAdmin()){ wrap.innerHTML='<div style="color:var(--text3);padding:16px;text-align:center">صلاحية الأدمن فقط</div>'; return; }

  wrap.innerHTML='<div style="text-align:center;color:var(--text3);padding:20px">جاري التحميل...</div>';

  try{
    // Fetch users list using admin endpoint
    const r = await sbFetch(SB_URL+'/auth/v1/admin/users',{
      method:'GET',
      headers:{
        'Content-Type':'application/json',
        'apikey':SB_KEY,
        'Authorization':'Bearer '+(_sbSession||SB_KEY)
      }
    });
    const d = await r.json();

    if(d.error || !d.users){
      // Fallback: show message to check Supabase dashboard
      wrap.innerHTML=`<div style="padding:16px;font-size:13px;color:var(--text2);background:var(--bg3);border-radius:8px;border:0.5px solid var(--border2)">
        <div style="font-weight:700;margin-bottom:8px">⚠ لعرض المستخدمين</div>
        <div>روح Supabase → Authentication → Users لإدارة الحسابات يدوياً</div>
        <div style="margin-top:8px;color:var(--text3)">ملاحظة: عرض القائمة يحتاج Service Role Key</div>
      </div>`;
      return;
    }

    const users = d.users||[];
    if(!users.length){
      wrap.innerHTML='<div style="text-align:center;color:var(--text3);padding:20px">لا يوجد مستخدمون بعد</div>';
      return;
    }

    wrap.innerHTML = users.map(u => {
      const meta = u.user_metadata||{};
      const role = meta.role||'user';
      const name = meta.full_name||u.email.split('@')[0];
      const isAdminUser = role==='admin';
      const created = new Date(u.created_at).toLocaleDateString('ar-IQ');
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border)">
        <div style="width:36px;height:36px;border-radius:50%;background:${isAdminUser?'rgba(245,166,35,.15)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-weight:700;color:${isAdminUser?'var(--gold)':'var(--text2)'};font-size:14px;flex-shrink:0">${name[0]}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${name}</div>
          <div style="font-size:11px;color:var(--text3);direction:ltr;text-align:right">${u.email}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:10px;padding:2px 8px;border-radius:6px;font-weight:700;background:${isAdminUser?'rgba(245,166,35,.15)':'rgba(96,165,250,.12)'};color:${isAdminUser?'var(--gold)':'var(--blue2)'}">${isAdminUser?'أدمن':'مستخدم'}</span>
          <span style="font-size:10px;color:var(--text3)">${created}</span>
        </div>
      </div>`;
    }).join('');

  } catch(e){
    wrap.innerHTML='<div style="color:var(--red);padding:16px">خطأ: '+e.message+'</div>';
  }
}

// Show users tab only for admin
function updateUsersTabVisibility(){
  const tab = document.getElementById('usersTab');
  if(tab) tab.style.display = isAdmin() ? 'flex' : 'none';
}

// ══ DEFICIENCY TRACKER — سجل النواقص ══
// قائمة شركات منفصلة (مو موجودة بالمعاملات)
let standaloneDefCompanies=[];
async function loadStandaloneDef(){
  const cloud=await sbLoadMeta('standaloneDef');
  if(cloud&&Array.isArray(cloud))standaloneDefCompanies=cloud;
  else{try{standaloneDefCompanies=JSON.parse(localStorage.getItem('lexdesk_standalone_def')||'[]');}catch(e){standaloneDefCompanies=[];}}
}
function saveStandaloneDef(){
  try{localStorage.setItem('lexdesk_standalone_def',JSON.stringify(standaloneDefCompanies));}catch(e){}
  sbSaveMeta('standaloneDef',standaloneDefCompanies);
}
function addQuickDefCompany(){
  const nameInp=document.getElementById('defQuickName');
  const itemsInp=document.getElementById('defQuickItems');
  const name=(nameInp.value||'').trim();
  const items=(itemsInp.value||'').trim();
  if(!name){toast('اكتب اسم الشركة','warn');nameInp.focus();return;}
  if(!items){toast('اكتب النواقص','warn');itemsInp.focus();return;}
  standaloneDefCompanies.push({id:Date.now(),company:name,deficiency:items,defCompleted:'',addedAt:Date.now()});
  saveStandaloneDef();
  nameInp.value='';itemsInp.value='';nameInp.focus();
  buildDeficiencyPage();
  toast('تمت إضافة '+name,'ok');
}
function deleteStandaloneCompany(id){
  standaloneDefCompanies=standaloneDefCompanies.filter(x=>x.id!==id);
  saveStandaloneDef();buildDeficiencyPage();toast('تم الحذف','ok');
}
function getAllDefEntries(){
  // دمج: معاملات عندها نواقص + شركات منفصلة
  const fromCases=cases.filter(c=>c.deficiency&&c.deficiency.trim()).map(c=>({...c,source:'case'}));
  const fromStandalone=standaloneDefCompanies.filter(s=>s.deficiency&&s.deficiency.trim()).map(s=>({...s,source:'standalone',type:'—',lawyer:'—'}));
  return [...fromCases,...fromStandalone];
}
function buildDeficiencyPage(){
  const container=document.getElementById('defBody');
  if(!container)return;
  const allDef=getAllDefEntries();
  const statsEl=document.getElementById('defStats');
  if(!allDef.length){
    container.innerHTML='<div class="empty-state"><div class="empty-ico"><svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text2)" stroke-width="1.2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="empty-txt">لا توجد نواقص</div><div class="empty-sub">أضف شركة من الفورم أعلاه أو من فورم المعاملة</div></div>';
    if(statsEl)statsEl.innerHTML='<span style="color:var(--green);font-size:12px">كل المعاملات مكتملة</span>';
    return;
  }
  let totalItems=0,completedItems=0;
  allDef.forEach(c=>{const items=parseDefItems(c);totalItems+=items.length;completedItems+=items.filter(it=>it.done).length;});
  const pendingItems=totalItems-completedItems;
  if(statsEl)statsEl.innerHTML='<span class="def-stat-pill def-stat-pending"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="5"/></svg> '+pendingItems+' ناقص مطلوب</span><span class="def-stat-pill def-stat-done"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> '+completedItems+' مكتمل</span><span class="def-stat-pill" style="background:var(--glass2);color:var(--text2);border:1px solid var(--border)">'+allDef.length+' شركة</span>';
  container.innerHTML=allDef.map(c=>{
    const isStandalone=c.source==='standalone';
    const lci=isStandalone?-1:settings.lawyers.indexOf(c.lawyer);
    const lc=isStandalone?'var(--purple)':LAWYER_COLORS[lci%LAWYER_COLORS.length];
    const items=parseDefItems(c);
    const pendCount=items.filter(it=>!it.done).length;
    const delCompanyBtn=isStandalone?'<button class="def-company-del" onclick="event.stopPropagation();deleteStandaloneCompany('+c.id+')" title="حذف الشركة"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>':'';
    const toggleFn=isStandalone?'toggleStandaloneDefItem':'toggleDefItem';
    const deleteFn=isStandalone?'deleteStandaloneDefItem':'deleteDefItem';
    const addFn=isStandalone?'addStandaloneDefItem':'addDefItem';
    return '<div class="def-company-card" id="defCard_'+c.id+'">'+
      '<div class="def-company-hd">'+
        '<div class="def-company-info">'+
          '<div class="def-av" style="background:'+lc+'">'+c.company[0]+'</div>'+
          '<div><div class="def-company-name">'+esc(c.company)+'</div>'+
          '<div class="def-company-sub">'+(isStandalone?'<span class="type-chip" style="font-size:10px;padding:2px 8px;background:var(--purple-g);color:var(--purple)">شركة مستقلة</span>':'<span class="type-chip" style="font-size:10px;padding:2px 8px">'+c.type+'</span><span style="display:inline-flex;align-items:center;gap:4px"><span class="lawyer-dot" style="background:'+lc+'"></span>'+c.lawyer+'</span>')+'</div></div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span class="def-count-badge'+(pendCount===0?' done':'')+'">'+( pendCount>0?pendCount+' ناقص':'مكتمل')+'</span>'+
          delCompanyBtn+
        '</div>'+
      '</div>'+
      '<div class="def-items-list">'+
        items.map((it,idx)=>
          '<div class="def-item'+(it.done?' completed':'')+'">'+
            '<div class="def-check'+(it.done?' checked':'')+'" onclick="'+toggleFn+'('+c.id+','+idx+')">'+
              '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'+
            '</div>'+
            '<span class="def-item-text" onclick="'+toggleFn+'('+c.id+','+idx+')">'+esc(it.text)+'</span>'+
            '<button class="def-item-del" onclick="event.stopPropagation();'+deleteFn+'('+c.id+','+idx+')" title="حذف">'+
              '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'+
            '</button>'+
          '</div>'
        ).join('')+
        '<div class="def-add-row">'+
          '<input class="def-add-inp" id="defInp_'+c.id+'" placeholder="أضف ناقص جديد..." onkeydown="if(event.key===\'Enter\')'+addFn+'('+c.id+')">'+
          '<button class="def-add-btn" onclick="'+addFn+'('+c.id+')">'+
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function parseDefItems(c){
  const raw=(c.deficiency||'').trim();if(!raw)return[];
  const completedList=(c.defCompleted||'').split('|||').filter(Boolean);
  const parts=raw.split(/[,،|\n]+/).map(s=>s.trim()).filter(Boolean);
  return parts.map(text=>({text,done:completedList.includes(text)}));
}
function toggleDefItem(caseId,itemIdx){
  const c=cases.find(x=>x.id===caseId);if(!c)return;
  const items=parseDefItems(c);if(!items[itemIdx])return;
  const item=items[itemIdx];
  let completedList=(c.defCompleted||'').split('|||').filter(Boolean);
  if(item.done)completedList=completedList.filter(t=>t!==item.text);
  else completedList.push(item.text);
  c.defCompleted=completedList.join('|||');
  saveData();buildDeficiencyPage();
}
function addDefItem(caseId){
  const inp=document.getElementById('defInp_'+caseId);
  if(!inp)return;
  const val=inp.value.trim();
  if(!val){inp.focus();return;}
  const c=cases.find(x=>x.id===caseId);if(!c)return;
  // أضف الناقص الجديد لحقل النواقص
  const existing=(c.deficiency||'').trim();
  c.deficiency=existing?(existing+'، '+val):val;
  saveData();buildDeficiencyPage();
  toast('تم إضافة الناقص','ok');
  // بعد إعادة البناء — ركّز على الإنبوت مرة ثانية
  setTimeout(()=>{const newInp=document.getElementById('defInp_'+caseId);if(newInp)newInp.focus();},100);
}
function deleteDefItem(caseId,itemIdx){
  const c=cases.find(x=>x.id===caseId);if(!c)return;
  const items=parseDefItems(c);if(!items[itemIdx])return;
  const deletedText=items[itemIdx].text;
  const parts=(c.deficiency||'').split(/[,،|\n]+/).map(s=>s.trim()).filter(Boolean);
  parts.splice(itemIdx,1);
  c.deficiency=parts.join('، ');
  if(c.defCompleted){let cl=c.defCompleted.split('|||').filter(Boolean);cl=cl.filter(t=>t!==deletedText);c.defCompleted=cl.join('|||');}
  saveData();buildDeficiencyPage();toast('تم حذف الناقص','ok');
}
// ═ دوال الشركات المستقلة ═
function toggleStandaloneDefItem(id,idx){
  const c=standaloneDefCompanies.find(x=>x.id===id);if(!c)return;
  const items=parseDefItems(c);if(!items[idx])return;
  let cl=(c.defCompleted||'').split('|||').filter(Boolean);
  if(items[idx].done)cl=cl.filter(t=>t!==items[idx].text);
  else cl.push(items[idx].text);
  c.defCompleted=cl.join('|||');
  saveStandaloneDef();buildDeficiencyPage();
}
function addStandaloneDefItem(id){
  const inp=document.getElementById('defInp_'+id);if(!inp)return;
  const val=inp.value.trim();if(!val){inp.focus();return;}
  const c=standaloneDefCompanies.find(x=>x.id===id);if(!c)return;
  const existing=(c.deficiency||'').trim();
  c.deficiency=existing?(existing+'، '+val):val;
  saveStandaloneDef();buildDeficiencyPage();toast('تم إضافة الناقص','ok');
  setTimeout(()=>{const ni=document.getElementById('defInp_'+id);if(ni)ni.focus();},100);
}
function deleteStandaloneDefItem(id,idx){
  const c=standaloneDefCompanies.find(x=>x.id===id);if(!c)return;
  const items=parseDefItems(c);if(!items[idx])return;
  const deletedText=items[idx].text;
  const parts=(c.deficiency||'').split(/[,،|\n]+/).map(s=>s.trim()).filter(Boolean);
  parts.splice(idx,1);
  c.deficiency=parts.join('، ');
  if(c.defCompleted){let cl=c.defCompleted.split('|||').filter(Boolean);cl=cl.filter(t=>t!==deletedText);c.defCompleted=cl.join('|||');}
  // لو ما بقت نواقص — شيل الشركة بالكامل
  if(!c.deficiency.trim()){standaloneDefCompanies=standaloneDefCompanies.filter(x=>x.id!==id);}
  saveStandaloneDef();buildDeficiencyPage();toast('تم حذف الناقص','ok');
}
function printDeficiency(){
  const allDef=getAllDefEntries();
  if(!allDef.length){toast('لا توجد نواقص للطباعة','warn');return;}

  // بناء محتوى الطباعة
  let rows='';
  allDef.forEach(c=>{
    const items=parseDefItems(c);
    const pendCount=items.filter(it=>!it.done).length;
    const sub=c.source==='standalone'?'شركة مستقلة':(c.type+' — '+c.lawyer);
    rows+='<div class="pc"><div class="pn">'+esc(c.company)+
      ' <span class="ps">('+sub+')</span>'+
      ' <span style="color:'+(pendCount>0?'#c62828':'#2e7d32')+'">'+
      (pendCount>0?pendCount+' ناقص':'مكتمل')+'</span></div><ul>';
    items.forEach(it=>{
      rows+='<li class="'+(it.done?'done':'')+'">'+
        '<span class="cb">'+(it.done?'☑':'☐')+'</span>'+
        esc(it.text)+'</li>';
    });
    rows+='</ul></div>';
  });

  // حقن iframe مؤقت
  const old=document.getElementById('__printFrame');
  if(old)old.remove();
  const iframe=document.createElement('iframe');
  iframe.id='__printFrame';
  iframe.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:none;z-index:99999;background:#fff';
  document.body.appendChild(iframe);

  const doc=iframe.contentDocument||iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8">
<title>سجل النواقص — ${settings.officeName||'المحامي منتظر الخزرجي'}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Noto Kufi Arabic',Arial,sans-serif;color:#000;background:#fff;padding:28px 36px;direction:rtl;font-size:14px}
  h1{font-size:20px;font-weight:800;margin-bottom:3px}
  .date{font-size:12px;color:#666;margin-bottom:24px}
  .hdr{text-align:center;border-bottom:2px solid #222;padding-bottom:14px;margin-bottom:24px}
  .pc{margin-bottom:20px;page-break-inside:avoid;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden}
  .pn{font-size:14px;font-weight:700;padding:10px 14px;background:#f5f5f5;border-bottom:1px solid #e0e0e0}
  .ps{font-weight:400;font-size:12px;color:#666}
  ul{list-style:none;padding:6px 0}
  li{padding:7px 14px;font-size:13px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:10px}
  li:last-child{border-bottom:none}
  li.done{color:#999;text-decoration:line-through}
  .cb{font-size:16px;line-height:1;flex-shrink:0}
  .close-btn{position:fixed;top:14px;left:14px;padding:8px 16px;background:#222;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:'Noto Kufi Arabic',Arial,sans-serif;z-index:100}
  @media print{.close-btn{display:none}}
</style>
</head><body>
<button class="close-btn" onclick="try{window.parent?.document?.getElementById('__printFrame')?.remove();}catch(e){}">✕ إغلاق</button>
<div class="hdr">
  <h1>سجل النواقص — ${settings.officeName||'المحامي منتظر الخزرجي'}</h1>
  <div class="date">${new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'})}</div>
</div>
${rows}
</body></html>`);
  doc.close();

  // طباعة بعد تحميل المحتوى
  iframe.onload=()=>{
    setTimeout(()=>{
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    },300);
  };
  // fallback لو onload ما اشتغل
  setTimeout(()=>{
    try{iframe.contentWindow.focus();iframe.contentWindow.print();}catch(e){}
  },800);
}

// ══ INIT ══
(async()=>{
  initTheme();
  await loadAll();
  await loadStandaloneDef();
  const sessionOk = await restoreSbSession();
  if(sessionOk){ showApp(); updateUsersTabVisibility(); }
  else{
    document.getElementById('loginScreen').style.display='grid';
    document.getElementById('appWrap').style.display='none';
    const officeSub=document.getElementById('loginOfficeSub');
    if(officeSub) officeSub.textContent=settings.officeName||'المحامي منتظر الخزرجي';
    switchLoginMode('login');
    setTimeout(()=>{ const e=document.getElementById('emailInp'); if(e)e.focus(); },300);
  }
  initMobile();
})();

// ══════════════════════════════════════
// ★ PREMIUM ENHANCEMENTS v4.1
// ══════════════════════════════════════

// ── Undo Delete ──
function undoDelete(){
  if(!_undoCase)return;
  clearTimeout(_undoTimer);
  const restored=_undoCase;
  _undoCase=null;_undoTimer=null;
  cases.push(restored);
  cases.sort((a,b)=>(a.addedAt||0)-(b.addedAt||0));
  render();
  toast('تم التراجع عن الحذف','ok');
  if(_undoEl){
    const e=_undoEl;_undoEl=null;
    e.style.opacity='0';e.style.transform='translateY(8px)';
    e.style.transition='all .3s';
    setTimeout(()=>e.remove(),310);
  }
}

// ── Close Detail with animation (override) ──
function closeDetail(){
  const ov=document.getElementById('detailOverlay');
  if(!ov||ov.style.display==='none'||ov.style.display==='')return;
  ov.classList.add('closing');
  setTimeout(()=>{
    ov.classList.remove('closing');
    ov.style.display='none';
    if(typeof detailCaseId!=='undefined')detailCaseId=null;
  },250);
}
function closeDetailIfBg(e){
  if(e.target===document.getElementById('detailOverlay'))closeDetail();
}

/* ╔══════════════════════════════════════════════════════════════╗
   ║  ★★★  LexDesk v5.0 — 5 Advanced Features                  ║
   ║  1. Command Palette (Ctrl+K)                                ║
   ║  2. Kanban Board                                            ║
   ║  3. Client Profile                                          ║
   ║  4. Bulk Actions                                            ║
   ║  5. AI Assistant — LexBot                                   ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ══════════════════════════════════════════════
// ★ 1. COMMAND PALETTE
// ══════════════════════════════════════════════
const CMD_ACTIONS = [
  {icon:'➕', label:'إضافة معاملة جديدة',     keys:'ctrl+n', fn:()=>openForm(null)},
  {icon:'📊', label:'التحليلات والرسوم البيانية', keys:'',      fn:()=>goPage('charts')},
  {icon:'📄', label:'التقارير المالية',        keys:'',      fn:()=>goPage('reports')},
  {icon:'🗂️', label:'أدوات الملفات — تحويل وضغط', keys:'',   fn:()=>goPage('tools')},
  {icon:'⚙️', label:'الإعدادات',              keys:'',      fn:()=>goPage('settings')},
  {icon:'🌙', label:'تبديل الوضع (فاتح/داكن)',  keys:'',      fn:()=>toggleTheme()},
  {icon:'📋', label:'تصدير إكسل',             keys:'',      fn:()=>exportExcel()},
  {icon:'🖨️', label:'طباعة',                 keys:'',      fn:()=>window.print()},
  {icon:'🤖', label:'فتح LexBot المساعد الذكي',keys:'',      fn:()=>toggleAI()},
  {icon:'📦', label:'عرض قائمة',             keys:'',      fn:()=>setView('list')},
  {icon:'🃏', label:'عرض البطاقات',           keys:'',      fn:()=>setView('cards')},
  {icon:'📌', label:'عرض Kanban',            keys:'',      fn:()=>setView('kanban')},
];
let cmdIdx=0;

function openCmd(){
  const el=document.getElementById('cmdOverlay');
  el.classList.add('open');
  requestAnimationFrame(()=>document.getElementById('cmdInp').focus());
  handleCmdSearch();
}
function closeCmd(){
  document.getElementById('cmdOverlay').classList.remove('open');
  document.getElementById('cmdInp').value='';
}
function handleCmdSearch(){
  const q=(document.getElementById('cmdInp').value||'').trim();
  const ql=q.toLowerCase();
  const res=document.getElementById('cmdResults');
  cmdIdx=0;
  let html='';
  // Actions
  const acts=CMD_ACTIONS.filter(a=>!q||a.label.includes(q)||a.label.toLowerCase().includes(ql));
  if(acts.length){
    html+='<div class="cmd-section">الإجراءات السريعة</div>';
    acts.slice(0,6).forEach((a,i)=>{
      const ai=CMD_ACTIONS.indexOf(a);
      html+='<div class="cmd-item'+(i===0&&!q?' active':'')+'" onclick="runCmdAction('+ai+')">'
        +'<div class="cmd-item-ico">'+a.icon+'</div>'
        +'<div class="cmd-item-lbl">'+a.label+(a.keys?'<span class="cmd-item-sub"> ('+a.keys+')</span>':'')+'</div>'
        +'<div class="cmd-item-hint">↵</div>'
        +'</div>';
    });
  }
  // Case search
  if(q.length>=1){
    const matched=(typeof cases!=='undefined'?cases:[])
      .filter(c=>c.company.toLowerCase().includes(ql)||c.type.toLowerCase().includes(ql)||(c.lawyer||'').toLowerCase().includes(ql))
      .slice(0,7);
    if(matched.length){
      html+='<div class="cmd-section">المعاملات</div>';
      matched.forEach(c=>{
        const smap={s:'s-pending','قيد المعالجة':'s-active','منجزة':'s-done','معلقة':'s-hold','مراجعة':'s-pending','ناقصة':'s-def'};
        html+='<div class="cmd-item" onclick="closeCmd();setTimeout(()=>openDetail('+c.id+'),120)">'
          +'<div class="cmd-item-ico">📁</div>'
          +'<div class="cmd-item-lbl">'+esc(c.company)+'<span class="cmd-item-sub"> — '+c.type+'</span></div>'
          +'<span class="cmd-item-stat '+(smap[c.status]||'s-pending')+'">'+c.status+'</span>'
          +'</div>';
      });
    }
    // Companies
    const cos=[...new Set((typeof cases!=='undefined'?cases:[]).map(c=>c.company))]
      .filter(co=>co.toLowerCase().includes(ql)).slice(0,4);
    if(cos.length){
      html+='<div class="cmd-section">ملف العميل</div>';
      cos.forEach(co=>{
        html+='<div class="cmd-item" onclick="closeCmd();setTimeout(()=>openClientProfile(\''+co.replace(/'/g,"\\'")+'\'),120)">'
          +'<div class="cmd-item-ico">🏢</div>'
          +'<div class="cmd-item-lbl">'+co+'</div>'
          +'<div class="cmd-item-hint">ملف العميل</div>'
          +'</div>';
      });
    }
  }
  if(!html) html='<div class="cmd-empty">لا نتائج — جرّب كلمة أخرى</div>';
  res.innerHTML=html;
  updateCmdIdx();
}
function runCmdAction(i){
  if(CMD_ACTIONS[i])CMD_ACTIONS[i].fn();
  closeCmd();
}
function handleCmdKey(e){
  const items=document.querySelectorAll('#cmdResults .cmd-item');
  if(e.key==='ArrowDown'){e.preventDefault();cmdIdx=Math.min(cmdIdx+1,items.length-1);updateCmdIdx();}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdIdx=Math.max(cmdIdx-1,0);updateCmdIdx();}
  else if(e.key==='Enter'){e.preventDefault();items[cmdIdx]?.click();}
  else if(e.key==='Escape'){closeCmd();}
}
function updateCmdIdx(){
  document.querySelectorAll('#cmdResults .cmd-item').forEach((el,i)=>el.classList.toggle('active',i===cmdIdx));
  document.querySelector('#cmdResults .cmd-item.active')?.scrollIntoView({block:'nearest'});
}


// ══════════════════════════════════════════════
// ★ 2. KANBAN BOARD
// ══════════════════════════════════════════════
const KANBAN_COLS = ['قيد المعالجة','منجزة','معلقة','مراجعة','ناقصة'];
const KANBAN_COLORS = {
  'قيد المعالجة':'var(--gold)',
  'منجزة':'var(--green)',
  'معلقة':'var(--red)',
  'مراجعة':'var(--blue2)',
  'ناقصة':'var(--purple)',
};
let _dragId=null;

function buildKanban(fil){
  let html='<div class="kanban-board">';
  KANBAN_COLS.forEach(status=>{
    const col=fil.filter(c=>c.status===status);
    const color=KANBAN_COLORS[status]||'var(--text2)';
    html+=`<div class="kanban-col" data-status="${status}">
      <div class="kanban-col-hd" style="border-top:3px solid ${color}">
        <span class="kanban-col-title">${status}</span>
        <span class="kanban-col-count" style="background:${color}20;color:${color}">${col.length}</span>
      </div>
      <div class="kanban-col-body">`;
    col.forEach(c=>{
      const lci=(typeof settings!=='undefined'?settings.lawyers:[]).indexOf(c.lawyer);
      const lc=LAWYER_COLORS[lci%LAWYER_COLORS.length]||'var(--gold)';
      const amt=c.currency==='USD'?'$'+fmt(c.amountUSD||0):fmt(c.amountIQD||0)+' د.ع';
      html+=`<div class="kanban-card" draggable="true" data-id="${c.id}" onclick="openDetail(${c.id})">
        <div class="kc-name">${c.company}</div>
        <div class="kc-type">${c.type}</div>
        <div class="kc-foot">
          <div class="kc-lawyer"><div class="lawyer-dot" style="background:${lc}"></div>${c.lawyer}</div>
          <div class="kc-amt">${amt}</div>
        </div>
        ${c.deficiency||c.status==='ناقصة'?'<span class="kc-flag kc-flag-def">⚠ ناقصة</span>':''}
        ${c.wadeaDone?'<span class="kc-flag kc-flag-done">✓ مكتملة</span>':''}
      </div>`;
    });
    html+=`<button class="kanban-add-btn" onclick="openForm(null);event.stopPropagation()">＋ إضافة معاملة</button>`;
    html+='</div></div>';
  });
  html+='</div>';
  return html;
}

function initKanbanDrag(){
  document.querySelectorAll('.kanban-card').forEach(card=>{
    card.addEventListener('dragstart',e=>{
      _dragId=Number(card.dataset.id);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });
  document.querySelectorAll('.kanban-col').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('dragover');});
    col.addEventListener('dragleave',()=>col.classList.remove('dragover'));
    col.addEventListener('drop',e=>{
      e.preventDefault();
      col.classList.remove('dragover');
      if(!_dragId)return;
      const status=col.dataset.status;
      const c=cases.find(x=>x.id===_dragId);
      if(c&&c.status!==status){
        const old=c.status;
        c.status=status;
        c.log=[...(c.log||[]),{id:Date.now(),type:'edit',msg:'نُقلت من "'+old+'" إلى "'+status+'"',user:(typeof currentUser!=='undefined'?currentUser:'الأدمن'),time:new Date().toISOString()}];
        if(status==='معلقة')addNotif('hold','معاملة معلقة: '+c.company);
        saveData();render();
        toast('✓ نُقلت "'+c.company+'" إلى '+status,'ok');
      }
      _dragId=null;
    });
  });
}


// ══════════════════════════════════════════════
// ★ 3. CLIENT PROFILE
// ══════════════════════════════════════════════
function openClientProfile(company){
  const clientCases=cases.filter(c=>c.company===company);
  if(!clientCases.length){toast('لا توجد معاملات لهذا العميل','warn');return;}
  document.getElementById('clientAvatar').textContent=company.trim().charAt(0)||'ك';
  document.getElementById('clientName').textContent=company;
  document.getElementById('clientMeta').textContent=clientCases.length+' معاملة مسجّلة';
  // Stats
  const total=clientCases.length;
  const done=clientCases.filter(c=>c.status==='منجزة').length;
  const active=clientCases.filter(c=>c.status==='قيد المعالجة').length;
  const totalIQD=clientCases.reduce((s,c)=>s+(c.amountIQD||0),0);
  const totalUSD=clientCases.reduce((s,c)=>s+(c.amountUSD||0),0);
  const amtStr=totalIQD>0?fmt(totalIQD)+' د.ع':'$'+fmt(totalUSD);
  document.getElementById('clientStatsRow').innerHTML=`
    <div class="client-stat">
      <div class="client-stat-val">${total}</div>
      <div class="client-stat-lbl">إجمالي المعاملات</div>
    </div>
    <div class="client-stat">
      <div class="client-stat-val" style="color:var(--green)">${done}</div>
      <div class="client-stat-lbl">منجزة</div>
    </div>
    <div class="client-stat">
      <div class="client-stat-val" style="color:var(--gold)">${active}</div>
      <div class="client-stat-lbl">قيد المعالجة</div>
    </div>
    <div class="client-stat" style="grid-column:1/-1">
      <div class="client-stat-val" style="font-size:17px">${amtStr}</div>
      <div class="client-stat-lbl">إجمالي المبالغ</div>
    </div>`;
  // Cases list
  const STATUS_DOT={'قيد المعالجة':'var(--gold)','منجزة':'var(--green)','معلقة':'var(--red)','مراجعة':'var(--blue2)','ناقصة':'var(--purple)'};
  const sorted=[...clientCases].sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  document.getElementById('clientCasesList').innerHTML=sorted.map((c,i)=>{
    const dotColor=STATUS_DOT[c.status]||'var(--text3)';
    const amt=c.currency==='USD'?'$'+fmt(c.amountUSD||0):fmt(c.amountIQD||0)+' د.ع';
    const dt=c.addedAt?new Date(c.addedAt).toLocaleDateString('ar-IQ',{year:'numeric',month:'short',day:'numeric'}):'—';
    return `<div class="client-case-item" style="animation-delay:${i*0.05}s" onclick="closeClientProfile();setTimeout(()=>openDetail(${c.id}),150)">
      <div class="cci-dot" style="background:${dotColor}"></div>
      <div class="cci-info">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${c.type}</div>
        <div class="cci-lawyer">${c.lawyer} • ${c.status}</div>
      </div>
      <div class="cci-right">
        <div class="cci-amt">${amt}</div>
        <div class="cci-date">${dt}</div>
      </div>
    </div>`;
  }).join('');
  const el=document.getElementById('clientOverlay');
  requestAnimationFrame(()=>el.classList.add('open'));
}
function closeClientProfile(){
  document.getElementById('clientOverlay').classList.remove('open');
}


// ══════════════════════════════════════════════
// ★ 4. BULK ACTIONS
// ══════════════════════════════════════════════

function toggleSelect(id){
  const idx=selectedCases.indexOf(id);
  const row=document.querySelector('tr.case-row[data-id="'+id+'"]');
  if(idx===-1){
    selectedCases.push(id);
    row?.classList.add('selected');
  } else {
    selectedCases.splice(idx,1);
    row?.classList.remove('selected');
  }
  updateBulkBar();
}
function toggleSelectAll(cb){
  const cbs=document.querySelectorAll('.bulk-cb');
  if(cb.checked){
    cbs.forEach(el=>{
      const id=Number(el.dataset.id);
      if(!selectedCases.includes(id))selectedCases.push(id);
      el.checked=true;
      el.closest('tr')?.classList.add('selected');
    });
  } else {
    cbs.forEach(el=>{
      const id=Number(el.dataset.id);
      const idx=selectedCases.indexOf(id);
      if(idx!==-1)selectedCases.splice(idx,1);
      el.checked=false;
      el.closest('tr')?.classList.remove('selected');
    });
  }
  updateBulkBar();
}
function clearSelection(){
  selectedCases=[];
  document.querySelectorAll('tr.case-row.selected').forEach(r=>r.classList.remove('selected'));
  document.querySelectorAll('.bulk-cb').forEach(cb=>cb.checked=false);
  const allCb=document.querySelector('.bulk-cb-all');
  if(allCb)allCb.checked=false;
  updateBulkBar();
}
function updateBulkBar(){
  const bar=document.getElementById('bulkBar');
  const cnt=document.getElementById('bulkCount');
  if(!bar)return;
  if(selectedCases.length>0){
    bar.classList.add('show');
    if(cnt)cnt.textContent=selectedCases.length;
  } else {
    bar.classList.remove('show');
  }
}
function bulkDelete(){
  if(!selectedCases.length)return;
  if(!confirm('هل تريد حذف '+selectedCases.length+' معاملة؟ لا يمكن التراجع عن هذا الإجراء.'))return;
  const toDelete=[...selectedCases];
  cases=cases.filter(c=>!toDelete.includes(c.id));
  toDelete.forEach(id=>sbDeleteCase(id));
  selectedCases=[];
  saveData();render();
  toast('تم حذف '+toDelete.length+' معاملة','warn');
}
function bulkChangeStatus(status){
  if(!status||!selectedCases.length)return;
  const ids=[...selectedCases];
  cases.forEach(c=>{
    if(ids.includes(c.id)){
      const old=c.status;
      c.status=status;
      c.log=[...(c.log||[]),{id:Date.now(),type:'edit',msg:'تغيير جماعي: "'+old+'" → "'+status+'"',user:(typeof currentUser!=='undefined'?currentUser:'الأدمن'),time:new Date().toISOString()}];
    }
  });
  saveData();render();
  toast('تم تغيير حالة '+ids.length+' معاملة إلى "'+status+'"','ok');
}
function bulkExport(){
  if(!selectedCases.length)return;
  const sel=cases.filter(c=>selectedCases.includes(c.id));
  const rows=sel.map(c=>({
    'الشركة':c.company,'المحامي':c.lawyer,'المبلغ (IQD)':c.amountIQD||0,'المبلغ (USD)':c.amountUSD||0,
    'الحالة':c.status,'النوع':c.type,'المرحلة':c.stage||'—','ملاحظات':c.notes||'',
  }));
  if(typeof XLSX==='undefined'){toast('مكتبة Excel غير محملة','err');return;}
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb,'المحدد',ws);
  XLSX.writeFile(wb,'LexDesk_selected_'+new Date().toISOString().slice(0,10)+'.xlsx');
  toast('تم تصدير '+sel.length+' معاملة','ok');
}


// ══════════════════════════════════════════════
// ★ 5. AI ASSISTANT — LexBot
// ══════════════════════════════════════════════
let aiOpen=false;
let aiHistory=[];

function toggleAI(){
  const panel=document.getElementById('aiPanel');
  const fab=document.getElementById('aiFab');
  aiOpen=!aiOpen;
  panel.classList.toggle('open',aiOpen);
  const btn=document.getElementById('aiTopbarBtn');
  if(btn)btn.classList.toggle('active',aiOpen);
  if(aiOpen&&aiHistory.length===0){
    setTimeout(()=>addAIMessage('bot',
      'مرحباً! أنا LexBot مساعدك الذكي في LexDesk 🤖\n\n'
      +'يمكنني تحليل معاملاتك والإجابة على أسئلتك. جرّب إحدى الأسئلة أدناه أو اسألني أي شيء!'
    ),300);
  }
}
function askAI(q){
  document.getElementById('aiInp').value=q;
  sendAIMessage();
}
function sendAIMessage(){
  const inp=document.getElementById('aiInp');
  const msg=(inp.value||'').trim();
  if(!msg)return;
  inp.value='';
  addAIMessage('user',msg);
  aiHistory.push({role:'user',content:msg});
  // Typing indicator
  const typingId='typing_'+Date.now();
  const msgs=document.getElementById('aiMsgs');
  const typing=document.createElement('div');
  typing.className='ai-msg bot';typing.id=typingId;
  typing.innerHTML='<div class="ai-typing"><span></span><span></span><span></span></div>';
  msgs.appendChild(typing);
  msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{
    const t=document.getElementById(typingId);if(t)t.remove();
    const reply=processAIQuery(msg);
    addAIMessage('bot',reply);
    aiHistory.push({role:'assistant',content:reply});
  },600+Math.random()*600);
}
function addAIMessage(role,text){
  const msgs=document.getElementById('aiMsgs');
  if(!msgs)return;
  const div=document.createElement('div');
  div.className='ai-msg '+role;
  const now=new Date().toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});
  div.innerHTML=`<div class="ai-bubble">${text.replace(/\n/g,'<br>')}</div><div class="ai-time">${now}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function processAIQuery(q){
  if(typeof cases==='undefined'||!cases)return 'لا توجد بيانات متاحة حالياً.';
  const ql=q.toLowerCase();
  const all=cases;
  const total=all.length;
  if(!total)return 'لا توجد معاملات مسجّلة في النظام بعد.';

  // إحصائيات عامة
  if(/كم معاملة|عدد المعاملات|إجمالي المعاملات|كم ملف/.test(ql)){
    const byStatus={};
    all.forEach(c=>{byStatus[c.status]=(byStatus[c.status]||0)+1;});
    const lines=Object.entries(byStatus).map(([s,n])=>`• ${s}: ${n} معاملة`).join('\n');
    return `يوجد في النظام حالياً **${total} معاملة** موزعة كالتالي:\n\n${lines}`;
  }

  // المعلقة
  if(/معلقة|معلق/.test(ql)){
    const held=all.filter(c=>c.status==='معلقة');
    if(!held.length)return 'لا توجد معاملات معلقة حالياً — هذا جيد! ✅';
    const list=held.slice(0,8).map(c=>`• ${c.company} — ${c.lawyer}${c.holdReason?' ('+c.holdReason+')':''}`).join('\n');
    return `يوجد **${held.length} معاملة معلقة** حالياً:\n\n${list}${held.length>8?'\n...والمزيد':''}`;
  }

  // قيد المعالجة
  if(/قيد المعالجة|نشطة|جارية/.test(ql)){
    const active=all.filter(c=>c.status==='قيد المعالجة');
    return `يوجد **${active.length} معاملة** قيد المعالجة حالياً من أصل ${total}.`;
  }

  // منجزة
  if(/منجزة|مكتملة|أُنجزت/.test(ql)){
    const done=all.filter(c=>c.status==='منجزة');
    const pct=((done.length/total)*100).toFixed(0);
    return `تم إنجاز **${done.length} معاملة** (${pct}% من الإجمالي). رائع! 🏆`;
  }

  // أفضل محامي
  if(/محامي|محامين|أفضل|أكثر إنتاجاً|أعلى/.test(ql)){
    const byLawyer={};
    all.forEach(c=>{byLawyer[c.lawyer]=(byLawyer[c.lawyer]||0)+1;});
    const sorted=Object.entries(byLawyer).sort((a,b)=>b[1]-a[1]);
    if(!sorted.length)return 'لا توجد بيانات محامين.';
    const top3=sorted.slice(0,3).map(([n,c],i)=>`${i===0?'🥇':i===1?'🥈':'🥉'} ${n}: ${c} معاملة`).join('\n');
    return `أفضل المحامين إنتاجاً:\n\n${top3}\n\nالمحامي الأكثر إنتاجاً هو **${sorted[0][0]}** بـ ${sorted[0][1]} معاملة.`;
  }

  // الإيرادات
  if(/إيرادات|مبالغ|أموال|مالية|IQD|دينار|دولار/.test(ql)){
    const totalIQD=all.reduce((s,c)=>s+(c.amountIQD||0),0);
    const totalUSD=all.reduce((s,c)=>s+(c.amountUSD||0),0);
    const doneIQD=all.filter(c=>c.status==='منجزة').reduce((s,c)=>s+(c.amountIQD||0),0);
    return `💰 **الإيرادات الإجمالية:**\n\n`
      +`• دينار عراقي: ${fmt(totalIQD)} د.ع\n`
      +`• دولار: $${fmt(totalUSD)}\n\n`
      +`📦 المنجزة: ${fmt(doneIQD)} د.ع`;
  }

  // عملاء
  if(/شركة|شركات|عميل|عملاء/.test(ql)){
    const companies=[...new Set(all.map(c=>c.company))];
    const top=Object.entries(
      all.reduce((acc,c)=>{acc[c.company]=(acc[c.company]||0)+1;return acc;},{})
    ).sort((a,b)=>b[1]-a[1]).slice(0,5);
    return `يوجد **${companies.length} شركة/عميل** في النظام.\n\nأكثر العملاء معاملاتٍ:\n`
      +top.map(([co,n])=>`• ${co}: ${n} معاملة`).join('\n');
  }

  // تقرير سريع
  if(/تقرير|ملخص|وضع|overview/.test(ql)){
    const done=all.filter(c=>c.status==='منجزة').length;
    const active=all.filter(c=>c.status==='قيد المعالجة').length;
    const held=all.filter(c=>c.status==='معلقة').length;
    const def=all.filter(c=>c.status==='ناقصة').length;
    const totalIQD=all.reduce((s,c)=>s+(c.amountIQD||0),0);
    const companies=[...new Set(all.map(c=>c.company))].length;
    const byLawyer={};all.forEach(c=>{byLawyer[c.lawyer]=(byLawyer[c.lawyer]||0)+1;});
    const topLawyer=Object.entries(byLawyer).sort((a,b)=>b[1]-a[1])[0];
    return `📋 **تقرير سريع عن مكتبك:**\n\n`
      +`📁 إجمالي المعاملات: **${total}**\n`
      +`✅ منجزة: ${done} | 🔄 نشطة: ${active} | ⏸ معلقة: ${held} | ⚠ ناقصة: ${def}\n\n`
      +`🏢 عدد العملاء: **${companies}**\n`
      +`💰 إجمالي المبالغ: **${fmt(totalIQD)} د.ع**\n`
      +(topLawyer?`🏆 أفضل محامي: **${topLawyer[0]}** (${topLawyer[1]} معاملة)`:'')+'\n\n'
      +(held>3?`⚠️ تنبيه: يوجد ${held} معاملة معلقة تحتاج اهتمامك.`:'✅ الوضع جيد — استمر!');
  }

  // بحث عن شركة
  if(q.length>2){
    const found=all.filter(c=>c.company.includes(q)||c.lawyer.includes(q)||c.type.includes(q));
    if(found.length){
      return `وجدت **${found.length} نتيجة** تتعلق بـ "${q}":\n\n`
        +found.slice(0,6).map(c=>`• ${c.company} — ${c.type} — ${c.status}`).join('\n');
    }
  }

  // Default
  const replies=[
    `الآن يوجد **${total} معاملة** في النظام. هل تريد تفاصيل محددة؟`,
    `يمكنني مساعدتك في:\n• الإحصائيات والتقارير\n• البحث عن معاملة\n• أداء المحامين\n• الإيرادات\n\nماذا تريد أن تعرف؟`,
    `سؤال جيد! جرّب أسئلة مثل:\n• "كم معاملة معلقة؟"\n• "من أفضل محامي؟"\n• "كم إجمالي الإيرادات؟"`,
  ];
  return replies[Math.floor(Math.random()*replies.length)];
}

// ── Company link hover shortcut ──
document.addEventListener('click',e=>{
  const link=e.target.closest('.company-link');
  if(link&&e.shiftKey){
    e.stopPropagation();
    openClientProfile(link.textContent.trim());
  }
});


// ══════════════════════════════════════════════
// ★ 6. FILE TOOLS — Convert & Compress
// ══════════════════════════════════════════════

const _toolDropFiles={};

function fileToDataUrl(file){
  return new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
}

function toolDrop(event,inputId,zoneId){
  event.preventDefault();
  document.getElementById(zoneId).classList.remove('drag');
  _toolDropFiles[inputId]=event.dataTransfer.files;
  const files=_toolDropFiles[inputId];
  if(!files||!files.length)return;
  const lblId=zoneId.replace('Zone','Label');
  const lbl=document.getElementById(lblId);
  if(lbl)lbl.textContent=Array.from(files).map(f=>f.name).join('، ');
  document.getElementById(zoneId).classList.add('has-file');
}

function updateDropLabel(zoneId,inp){
  if(inp.id)delete _toolDropFiles[inp.id];
  const files=inp.files;
  if(!files||!files.length)return;
  const lblId=zoneId.replace('Zone','Label');
  const lbl=document.getElementById(lblId);
  if(lbl)lbl.textContent=Array.from(files).map(f=>f.name).join('، ');
  document.getElementById(zoneId).classList.add('has-file');
}

function getToolFiles(inputId){
  if(_toolDropFiles[inputId]&&_toolDropFiles[inputId].length)return _toolDropFiles[inputId];
  const inp=document.getElementById(inputId);
  return inp?inp.files:null;
}

function toolSetResult(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html;}

function fmtBytes(b){
  if(b<1024)return b+' B';
  if(b<1048576)return (b/1024).toFixed(1)+' KB';
  return (b/1048576).toFixed(2)+' MB';
}

// إعداد PDF.js مع حل مشكلة cross-origin worker
function initPdfJs(){
  const lib=window.pdfjsLib;
  if(!lib)return null;
  if(!lib.GlobalWorkerOptions.workerSrc){
    // نبني blob worker لتجنب قيود cross-origin
    try{
      const ver=lib.version||'2.16.105';
      const src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+ver+'/pdf.worker.min.js';
      const blob=new Blob(['importScripts("'+src+'");'],{type:'text/javascript'});
      lib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(blob);
    }catch(e){
      lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }
  }
  return lib;
}

// تحويل صورة إلى JPEG عبر canvas (يضمن التوافق مع jsPDF)
function imgToJpegDataUrl(img,quality){
  quality=quality||0.92;
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||img.width;
  c.height=img.naturalHeight||img.height;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#ffffff';
  ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(img,0,0);
  return c.toDataURL('image/jpeg',quality);
}

// ── ① صورة → PDF ──
async function imgToPdf(){
  const files=getToolFiles('itpInput');
  if(!files||!files.length){toast('اختر صورة أولاً','err');return;}
  if(!window.jspdf){toast('مكتبة jsPDF لم تكتمل، أعد تحميل الصفحة','err');return;}
  toolSetResult('itpResult','<div class="tool-progress">جاري التحويل...</div>');
  try{
    const {jsPDF}=window.jspdf;
    const size=document.getElementById('itpSize')?.value||'a4';
    const ori=document.getElementById('itpOri')?.value||'p';
    const pdf=new jsPDF(ori,'mm',size);
    const W=pdf.internal.pageSize.getWidth();
    const H=pdf.internal.pageSize.getHeight();
    const mg=8;const maxW=W-mg*2;const maxH=H-mg*2;
    for(let i=0;i<files.length;i++){
      if(i>0)pdf.addPage(size,ori);
      // تحميل الصورة
      const objectUrl=URL.createObjectURL(files[i]);
      const imgEl=new Image();
      imgEl.src=objectUrl;
      await new Promise((res,rej)=>{imgEl.onload=res;imgEl.onerror=rej;});
      // تحويل إلى JPEG عبر canvas لضمان التوافق
      const jpegUrl=imgToJpegDataUrl(imgEl,0.92);
      URL.revokeObjectURL(objectUrl);
      const iw=imgEl.naturalWidth;const ih=imgEl.naturalHeight;
      const ratio=Math.min(maxW/iw,maxH/ih,1);
      const dw=iw*ratio;const dh=ih*ratio;
      const dx=(W-dw)/2;const dy=(H-dh)/2;
      pdf.addImage(jpegUrl,'JPEG',dx,dy,dw,dh);
    }
    pdf.save('lexdesk-images.pdf');
    toolSetResult('itpResult','<div class="tool-ok">✓ تم إنشاء PDF ('+files.length+(files.length===1?' صفحة':' صفحات')+')</div>');
    toast('تم تحويل الصور إلى PDF','ok');
  }catch(e){
    toolSetResult('itpResult','<div class="tool-err">خطأ: '+e.message+'</div>');
    toast('فشل التحويل','err');
  }
}

// ── ② PDF → صورة ──
async function pdfToImg(){
  const files=getToolFiles('ptiInput');
  if(!files||!files.length){toast('اختر ملف PDF أولاً','err');return;}
  const lib=initPdfJs();
  if(!lib){toast('مكتبة PDF.js لم تكتمل، أعد تحميل الصفحة','err');return;}
  toolSetResult('ptiResult','<div class="tool-progress">جاري قراءة PDF...</div>');
  try{
    const scale=parseFloat(document.getElementById('ptiQuality')?.value||'1.5');
    const imgFmt=document.getElementById('ptiFormat')?.value||'jpeg';
    const mimeType='image/'+imgFmt;
    const ab=await files[0].arrayBuffer();
    const loadTask=lib.getDocument({data:new Uint8Array(ab)});
    const pdfDoc=await loadTask.promise;
    const n=pdfDoc.numPages;
    toolSetResult('ptiResult','<div class="tool-progress">تحويل '+n+' صفحة...</div>');
    const links=[];
    for(let i=1;i<=n;i++){
      const page=await pdfDoc.getPage(i);
      const vp=page.getViewport({scale:scale});
      const cv=document.createElement('canvas');
      cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);
      const ctx=cv.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cv.width,cv.height);
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const blob=await new Promise(res=>cv.toBlob(res,mimeType,0.92));
      if(!blob)throw new Error('فشل تحويل الصفحة '+i);
      const url=URL.createObjectURL(blob);
      links.push({url,name:'page_'+String(i).padStart(2,'0')+'.'+imgFmt,num:i,size:blob.size});
    }
    const dlHtml=links.map(l=>'<a class="tool-dl-link" href="'+l.url+'" download="'+l.name+'">⬇ صفحة '+l.num+' ('+fmtBytes(l.size)+')</a>').join('');
    toolSetResult('ptiResult','<div class="tool-ok">✓ تم تحويل '+n+' صفحة</div><div class="tool-dl-row">'+dlHtml+'</div>');
    toast('تم تحويل PDF إلى '+n+' صورة','ok');
  }catch(e){
    toolSetResult('ptiResult','<div class="tool-err">خطأ: '+e.message+'</div>');
    toast('فشل التحويل','err');
  }
}

// ── ③ ضغط الصور ──
async function compressImg(){
  const files=getToolFiles('ciInput');
  if(!files||!files.length){toast('اختر صورة أولاً','err');return;}
  toolSetResult('ciResult','<div class="tool-progress">جاري الضغط...</div>');
  try{
    const quality=parseInt(document.getElementById('ciQuality')?.value||'80')/100;
    const maxW=parseInt(document.getElementById('ciMaxW')?.value||'0')||0;
    const file=files[0];const origSize=file.size;
    const objectUrl=URL.createObjectURL(file);
    const img=new Image();img.src=objectUrl;
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;});
    URL.revokeObjectURL(objectUrl);
    let w=img.naturalWidth;let h=img.naturalHeight;
    if(maxW>0&&w>maxW){const r=maxW/w;w=Math.round(w*r);h=Math.round(h*r);}
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    const blob=await new Promise(res=>cv.toBlob(res,'image/jpeg',quality));
    const saved=Math.max(0,Math.round((1-blob.size/origSize)*100));
    const url=URL.createObjectURL(blob);
    const baseName=file.name.replace(/\.[^.]+$/,'');
    toolSetResult('ciResult',
      '<div class="tool-ok">✓ تم الضغط'+(saved>0?' — وفّرنا '+saved+'%':'')+'</div>'+
      '<div class="tool-size-row"><span>قبل: '+fmtBytes(origSize)+'</span><span>←</span><span>بعد: '+fmtBytes(blob.size)+'</span></div>'+
      '<a class="tool-dl-link" href="'+url+'" download="compressed_'+baseName+'.jpg">⬇ تحميل الصورة المضغوطة</a>'
    );
    toast('تم ضغط الصورة'+(saved>0?' — توفير '+saved+'%':''),'ok');
  }catch(e){
    toolSetResult('ciResult','<div class="tool-err">خطأ: '+e.message+'</div>');
    toast('فشل الضغط','err');
  }
}

// ── ④ ضغط PDF ──
async function compressPdf(){
  const files=getToolFiles('cpInput');
  if(!files||!files.length){toast('اختر ملف PDF أولاً','err');return;}
  const lib=initPdfJs();
  if(!lib){toast('مكتبة PDF.js لم تكتمل، أعد تحميل الصفحة','err');return;}
  if(!window.jspdf){toast('مكتبة jsPDF لم تكتمل، أعد تحميل الصفحة','err');return;}
  toolSetResult('cpResult','<div class="tool-progress">جاري ضغط PDF...</div>');
  try{
    const level=document.getElementById('cpLevel')?.value||'med';
    const scaleMap={high:0.9,med:1.3,low:1.8};
    const qualMap={high:0.50,med:0.68,low:0.85};
    const scale=scaleMap[level];const imgQ=qualMap[level];
    const file=files[0];const origSize=file.size;
    const ab=await file.arrayBuffer();
    const loadTask=lib.getDocument({data:new Uint8Array(ab)});
    const pdfDoc=await loadTask.promise;
    const n=pdfDoc.numPages;
    toolSetResult('cpResult','<div class="tool-progress">ضغط '+n+' صفحة...</div>');
    const {jsPDF}=window.jspdf;
    // تحديد اتجاه الصفحة من الصفحة الأولى
    const firstPage=await pdfDoc.getPage(1);
    const firstVp=firstPage.getViewport({scale:1});
    const ori=firstVp.width>firstVp.height?'l':'p';
    const pdf=new jsPDF(ori,'mm','a4');
    const PW=pdf.internal.pageSize.getWidth();
    const PH=pdf.internal.pageSize.getHeight();
    for(let i=1;i<=n;i++){
      if(i>1)pdf.addPage('a4',ori);
      const page=await pdfDoc.getPage(i);
      const vp=page.getViewport({scale:scale});
      const cv=document.createElement('canvas');
      cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);
      const ctx=cv.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cv.width,cv.height);
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const imgData=cv.toDataURL('image/jpeg',imgQ);
      pdf.addImage(imgData,'JPEG',0,0,PW,PH);
    }
    const pdfBytes=pdf.output('arraybuffer');
    const newSize=pdfBytes.byteLength;
    const saved=Math.max(0,Math.round((1-newSize/origSize)*100));
    const blob=new Blob([pdfBytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    toolSetResult('cpResult',
      '<div class="tool-ok">✓ تم الضغط'+(saved>0?' — وفّرنا '+saved+'%':'')+'</div>'+
      '<div class="tool-size-row"><span>قبل: '+fmtBytes(origSize)+'</span><span>←</span><span>بعد: '+fmtBytes(newSize)+'</span></div>'+
      '<a class="tool-dl-link" href="'+url+'" download="compressed_'+file.name+'">⬇ تحميل PDF المضغوط</a>'
    );
    toast('تم ضغط PDF'+(saved>0?' — توفير '+saved+'%':''),'ok');
  }catch(e){
    toolSetResult('cpResult','<div class="tool-err">خطأ: '+e.message+'</div>');
    toast('فشل ضغط PDF','err');
  }
}

// ── ⑤ دمج ملفات PDF (دمج حقيقي عبر pdf-lib — يحافظ على النص والجودة) ──
async function mergePdfs(){
  const files=getToolFiles('mgInput');
  if(!files||files.length<2){toast('اختر ملفين PDF على الأقل','err');return;}
  if(!window.PDFLib){toast('مكتبة الدمج لم تكتمل، أعد تحميل الصفحة','err');return;}
  toolSetResult('mgResult','<div class="tool-progress">جاري الدمج...</div>');
  try{
    const {PDFDocument}=window.PDFLib;
    const merged=await PDFDocument.create();
    let totalPages=0;
    for(let i=0;i<files.length;i++){
      toolSetResult('mgResult','<div class="tool-progress">دمج '+(i+1)+' / '+files.length+'...</div>');
      const bytes=await files[i].arrayBuffer();
      const src=await PDFDocument.load(bytes,{ignoreEncryption:true});
      const pages=await merged.copyPages(src,src.getPageIndices());
      pages.forEach(p=>merged.addPage(p));
      totalPages+=src.getPageCount();
    }
    const out=await merged.save();
    const blob=new Blob([out],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    toolSetResult('mgResult',
      '<div class="tool-ok">✓ تم الدمج — '+files.length+' ملفات · '+totalPages+' صفحة · '+fmtBytes(out.byteLength)+'</div>'+
      '<a class="tool-dl-link" href="'+url+'" download="lexdesk-merged.pdf">⬇ تحميل الملف المدموج</a>'
    );
    toast('تم دمج ملفات PDF','ok');
  }catch(e){
    toolSetResult('mgResult','<div class="tool-err">خطأ: '+e.message+'</div>');
    toast('فشل الدمج','err');
  }
}

// ── ⑥ محرّر صفحات PDF ──
let pdfEditor = null;

function peDrop(e){
  e.preventDefault();
  const z=document.getElementById('peZone'); if(z)z.classList.remove('drag');
  const f=e.dataTransfer.files&&e.dataTransfer.files[0];
  if(f) peLoad(f);
}

function dataUrlToBytes(dataUrl){
  const bin=atob(dataUrl.split(',')[1]);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return arr;
}

async function peLoad(file){
  if(!file)return;
  if(!/\.pdf$/i.test(file.name)){toast('اختر ملف PDF','err');return;}
  const lib=initPdfJs();
  if(!lib){toast('مكتبة العرض لم تكتمل، أعد التحميل','err');return;}
  toolSetResult('peResult','<div class="tool-progress">جاري فتح الملف...</div>');
  try{
    const ab=await file.arrayBuffer();
    const bytes=new Uint8Array(ab);
    const doc=await lib.getDocument({data:bytes.slice()}).promise;
    const thumbs=[];
    for(let p=1;p<=doc.numPages;p++){
      toolSetResult('peResult','<div class="tool-progress">تحضير الصفحة '+p+' / '+doc.numPages+'...</div>');
      const page=await doc.getPage(p);
      const vp=page.getViewport({scale:0.5});
      const c=document.createElement('canvas');
      c.width=vp.width; c.height=vp.height;
      await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
      thumbs.push(c.toDataURL('image/jpeg',0.7));
    }
    pdfEditor={srcBytes:bytes,pageThumbs:thumbs,order:thumbs.map((_,i)=>({type:'pdf',idx:i}))};
    toolSetResult('peResult','');
    peRender();
    toast('تم فتح '+doc.numPages+' صفحة','ok');
  }catch(e){
    toolSetResult('peResult','<div class="tool-err">تعذّر فتح الملف: '+e.message+'</div>');
  }
}

function peRender(){
  const grid=document.getElementById('peGrid');
  const bar=document.getElementById('peBar');
  if(!pdfEditor||!pdfEditor.order.length){
    grid.style.display='none'; bar.style.display='none'; grid.innerHTML=''; return;
  }
  grid.style.display='grid'; bar.style.display='flex';
  grid.innerHTML=pdfEditor.order.map(function(it,i){
    const src=it.type==='pdf'?pdfEditor.pageThumbs[it.idx]:it.dataUrl;
    const tag=it.type==='img'?'<span class="pe-tag" style="background:rgba(139,92,246,.9);color:#fff">صورة</span>':'';
    return '<div class="pe-thumb">'+
      '<img src="'+src+'" alt="صفحة '+(i+1)+'">'+
      '<span class="pe-num">'+(i+1)+'</span>'+tag+
      '<div class="pe-ctrls">'+
        '<button title="تقديم" onclick="peMove('+i+',-1)">▲</button>'+
        '<button title="تأخير" onclick="peMove('+i+',1)">▼</button>'+
        '<button class="del" title="حذف" onclick="peDel('+i+')">✕</button>'+
      '</div></div>';
  }).join('');
}

function peMove(i,dir){
  const j=i+dir;
  if(!pdfEditor||j<0||j>=pdfEditor.order.length)return;
  const o=pdfEditor.order;
  const tmp=o[i]; o[i]=o[j]; o[j]=tmp;
  peRender();
}

function peDel(i){
  if(!pdfEditor)return;
  pdfEditor.order.splice(i,1);
  peRender();
  if(!pdfEditor.order.length)
    toolSetResult('peResult','<div class="tool-err">حذفت كل الصفحات — أضف صوراً أو افتح ملفاً جديداً.</div>');
}

async function peAddImages(files){
  if(!pdfEditor){toast('افتح ملف PDF أول','err');return;}
  const list=Array.from(files||[]);
  for(const f of list){
    if(!f.type||!f.type.startsWith('image/'))continue;
    try{
      const dataUrl=await new Promise(function(res,rej){
        const img=new Image();
        img.onload=function(){res(imgToJpegDataUrl(img,0.92));};
        img.onerror=rej;
        img.src=URL.createObjectURL(f);
      });
      pdfEditor.order.push({type:'img',dataUrl:dataUrl});
    }catch(e){}
  }
  const inp=document.getElementById('pePicImg'); if(inp)inp.value='';
  peRender();
  toast('انضافت الصور كصفحات','ok');
}

function peReset(){
  pdfEditor=null;
  const inp=document.getElementById('peInput'); if(inp)inp.value='';
  toolSetResult('peResult','');
  peRender();
}

async function peExport(){
  if(!pdfEditor||!pdfEditor.order.length){toast('لا توجد صفحات للتصدير','err');return;}
  if(!window.PDFLib){toast('مكتبة الحفظ لم تكتمل، أعد التحميل','err');return;}
  toolSetResult('peResult','<div class="tool-progress">جاري إنشاء الملف...</div>');
  try{
    const {PDFDocument}=window.PDFLib;
    const out=await PDFDocument.create();
    const src=await PDFDocument.load(pdfEditor.srcBytes.slice(),{ignoreEncryption:true});
    for(const it of pdfEditor.order){
      if(it.type==='pdf'){
        const pages=await out.copyPages(src,[it.idx]);
        out.addPage(pages[0]);
      }else{
        const img=await out.embedJpg(dataUrlToBytes(it.dataUrl));
        const pg=out.addPage([img.width,img.height]);
        pg.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
      }
    }
    const bytes=await out.save();
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    toolSetResult('peResult',
      '<div class="tool-ok">✓ تم — '+pdfEditor.order.length+' صفحة · '+fmtBytes(bytes.byteLength)+'</div>'+
      '<a class="tool-dl-link" href="'+url+'" download="lexdesk-edited.pdf">⬇ تحميل الملف المعدّل</a>');
    toast('تم تصدير الملف','ok');
  }catch(e){
    toolSetResult('peResult','<div class="tool-err">خطأ: '+e.message+'</div>');
  }
}

// ═══════════════════ قسم المهام (Tasks) ═══════════════════
const SK_TASKS='lexdesk_tasks_v1';
let tasks=[];
let editingTaskId=null;
const TASK_COLS=[
  {id:'new',name:'بدء التكليف'},
  {id:'progress',name:'قيد المعالجة'},
  {id:'done',name:'مكتملة'}
];

async function loadTasks(){
  const cloud=await sbLoadMeta('tasks');
  if(cloud&&Array.isArray(cloud))tasks=cloud;
  else{try{tasks=JSON.parse(localStorage.getItem(SK_TASKS)||'[]');}catch(e){tasks=[];}}
}
function saveTasks(){
  try{localStorage.setItem(SK_TASKS,JSON.stringify(tasks));}catch(e){}
  sbSaveMeta('tasks',tasks);
}

function openTaskForm(id){
  editingTaskId=id;
  const t=id?tasks.find(x=>x.id===id):{};
  document.getElementById('taskFormTitle').textContent=id?'تعديل المهمة':'مهمة جديدة';
  document.getElementById('tkCompany').value=t.company||'';
  // الجهة
  const deptSel=document.getElementById('tkDept');
  const knownDepts=['الضمان الاجتماعي','مسجل الشركات','الهيئة العامة للضرائب','الگمارك العامة','غرفة تجارة','اتحاد الغرف','اتحاد المقاولين','إيداع مبلغ للمصرف'];
  if(t.dept&&!knownDepts.includes(t.dept)){deptSel.value='أخرى';document.getElementById('tkDeptOther').style.display='block';document.getElementById('tkDeptOther').value=t.dept;}
  else{deptSel.value=t.dept||'';document.getElementById('tkDeptOther').style.display='none';document.getElementById('tkDeptOther').value='';}
  document.getElementById('tkType').value=t.taskType||'';
  document.getElementById('tkAmount').value=t.amount||'';
  document.getElementById('tkPriority').value=t.priority||'normal';
  document.getElementById('tkAssignDate').value=t.assignDate||new Date().toISOString().slice(0,10);
  document.getElementById('tkDueDate').value=t.dueDate||'';
  document.getElementById('tkNotes').value=t.notes||'';
  // المحامون
  const lw=document.getElementById('tkLawyer');
  lw.innerHTML='<option value="">— بدون</option>'+(settings.lawyers||[]).map(l=>'<option>'+l+'</option>').join('');
  lw.value=t.lawyer||'';
  const ov=document.getElementById('taskOverlay');
  ov.style.display='flex';setTimeout(()=>ov.classList.add('open'),10);
}
function closeTaskForm(){
  const ov=document.getElementById('taskOverlay');
  ov.classList.remove('open');setTimeout(()=>{ov.style.display='none';},200);
  editingTaskId=null;
}
function onTaskDeptChange(){
  const v=document.getElementById('tkDept').value;
  document.getElementById('tkDeptOther').style.display=(v==='أخرى')?'block':'none';
}
function saveTask(){
  const company=document.getElementById('tkCompany').value.trim();
  let dept=document.getElementById('tkDept').value;
  if(dept==='أخرى')dept=document.getElementById('tkDeptOther').value.trim();
  const taskType=document.getElementById('tkType').value.trim();
  if(!company){toast('أدخل اسم الشركة','err');return;}
  if(!dept){toast('اختر جهة المهمة','err');return;}
  if(!taskType){toast('أدخل نوع المهمة','err');return;}
  const data={
    company,dept,taskType,
    amount:parseFloat(document.getElementById('tkAmount').value)||0,
    priority:document.getElementById('tkPriority').value,
    assignDate:document.getElementById('tkAssignDate').value,
    dueDate:document.getElementById('tkDueDate').value,
    lawyer:document.getElementById('tkLawyer').value,
    notes:document.getElementById('tkNotes').value.trim()
  };
  if(editingTaskId){
    const t=tasks.find(x=>x.id===editingTaskId);
    if(t)Object.assign(t,data);
    toast('تم تحديث المهمة','ok');
  }else{
    data.id=Date.now();data.col='new';data.createdAt=new Date().toISOString();
    tasks.push(data);
    toast('تمت إضافة المهمة','ok');
  }
  saveTasks();closeTaskForm();buildTasksPage();renderTaskAlerts();
}
function deleteTask(id,ev){
  if(ev)ev.stopPropagation();
  tasks=tasks.filter(t=>t.id!==id);
  saveTasks();buildTasksPage();renderTaskAlerts();
}
function moveTask(id,col){
  const t=tasks.find(x=>x.id===id);if(!t)return;
  t.col=col;
  saveTasks();buildTasksPage();renderTaskAlerts();
}

function taskDueInfo(t){
  if(!t.dueDate)return null;
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(t.dueDate);
  const diff=Math.round((due-today)/(1000*60*60*24));
  return diff;
}
function taskStepperHtml(t){
  const ci=TASK_COLS.findIndex(c=>c.id===t.col);
  const fullyDone=(t.col==='done');
  return '<div class="task-steps">'+TASK_COLS.map((col,i)=>{
    const isDone=fullyDone||i<ci;
    const isCurrent=!fullyDone&&i===ci;
    const st=isDone?'done':isCurrent?'current':'wait';
    const dotContent=isDone?'✓':isCurrent?'<span class="ts-flicker"></span>':(i+1);
    const html='<div class="task-step '+st+'" title="'+col.name+'" onclick="event.stopPropagation();jumpTaskStage('+t.id+',\''+col.id+'\')"><div class="ts-dot">'+dotContent+'</div><div class="ts-label">'+col.name+'</div></div>';
    if(i===0)return html;
    return '<div class="task-step-line '+((fullyDone||i<=ci)?'done':'')+'"></div>'+html;
  }).join('')+'</div>';
}
function taskCardHtml(t){
  const diff=taskDueInfo(t);
  let dueHtml='';
  if(diff!==null&&t.col!=='done'){
    let cls='ok',txt='';
    if(diff<0){cls='late';txt='متأخرة '+Math.abs(diff)+' يوم';}
    else if(diff===0){cls='soon';txt='مستحقّة اليوم';}
    else if(diff<=3){cls='soon';txt='باقي '+diff+' يوم';}
    else{cls='ok';txt='باقي '+diff+' يوم';}
    dueHtml='<div class="task-card-due '+cls+'"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> '+txt+'</div>';
  }
  const amtHtml=t.amount>0?'<span><span class="task-card-amt">'+t.amount.toLocaleString()+'</span> د.ع</span>':'';
  let actBtn='';
  if(t.col==='new')actBtn='<button class="task-card-btn primary" onclick="moveTask('+t.id+',\'progress\')">بدء المعالجة ←</button>';
  else if(t.col==='progress')actBtn='<button class="task-card-btn primary" onclick="completeTask('+t.id+')">✓ إكمال المهمة</button>';
  else actBtn='<button class="task-card-btn" onclick="moveTask('+t.id+',\'progress\')">↩ إرجاع لقيد المعالجة</button>';
  return '<div class="task-card '+(t.priority==='urgent'?'urgent':'')+(t.col==='done'?' is-done':'')+'" data-id="'+t.id+'">'
    +'<div class="task-card-top"><div class="task-card-co" onclick="openTaskForm('+t.id+')" style="cursor:pointer">'+esc(t.company)+'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;flex:0 0 auto"><span class="task-card-badge '+(t.priority==='urgent'?'urgent':'normal')+'">'+(t.priority==='urgent'?'عاجلة':'عادية')+'</span>'
    +'<button class="act-btn" title="تعديل" onclick="openTaskForm('+t.id+')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
    +'<button class="act-btn del" title="حذف" onclick="deleteTask('+t.id+',event)"><svg class="del-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div></div>'
    +'<div class="task-card-type" onclick="openTaskForm('+t.id+')" style="cursor:pointer">'+esc(t.taskType)+'</div>'
    +'<div class="task-card-meta"><span>🏛 '+esc(t.dept)+'</span>'+(amtHtml?' '+amtHtml:'')+(t.lawyer?' <span>👤 '+esc(t.lawyer)+'</span>':'')+'</div>'
    +dueHtml
    +(t.notes?'<div class="task-card-notes">'+esc(t.notes)+'</div>':'')
    +taskStepperHtml(t)
    +'<div class="task-card-acts">'+actBtn+'</div>'
    +'</div>';
}
function completeTask(id){
  const t=tasks.find(x=>x.id===id);if(!t)return;
  t.col='done';t.completedAt=new Date().toISOString();
  saveTasks();buildTasksPage();renderTaskAlerts();
  toast('✓ اكتملت المهمة','ok');
}
function jumpTaskStage(id,col){
  const t=tasks.find(x=>x.id===id);if(!t||t.col===col)return;
  moveTask(id,col);
}
function buildTasksPage(){
  const body=document.getElementById('tasksBody');if(!body)return;
  const items=tasks.slice().sort((a,b)=>{
    if((a.col==='done')!==(b.col==='done'))return (a.col==='done')?1:-1;
    if((b.priority==='urgent')-(a.priority==='urgent'))return (b.priority==='urgent')-(a.priority==='urgent');
    const da=taskDueInfo(a),db=taskDueInfo(b);
    if(da===null)return 1;if(db===null)return -1;return da-db;
  });
  if(!items.length){
    body.innerHTML='<div class="tasks-grid"><div class="tasks-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><div>لا توجد مهام — اضغط «إضافة مهمة جديدة»</div></div></div>';
    return;
  }
  body.innerHTML='<div class="tasks-grid">'+items.map(taskCardHtml).join('')+'</div>';
}

// تنبيهات المهام (رئيسية) — المستحقّة خلال 3 أيام + المتأخرة
function renderTaskAlerts(){
  const today=new Date();today.setHours(0,0,0,0);
  let count=0;
  tasks.forEach(t=>{
    if(t.col==='done'||!t.dueDate)return;
    const diff=taskDueInfo(t);
    if(diff!==null&&diff<=3)count++;
  });
  const badge=document.getElementById('sbTasksBadge');
  if(badge){if(count>0){badge.style.display='flex';badge.textContent=count;}else badge.style.display='none';}
  const mBadge=document.getElementById('mnTasksBadge');
  if(mBadge){if(count>0){mBadge.style.display='flex';mBadge.textContent=count;}else mBadge.style.display='none';}
}

