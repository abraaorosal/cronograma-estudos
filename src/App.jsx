import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAM_DATE, START_DATE, TOTAL_PLAN_HOURS, phaseDescriptions, reviewIntervals, studyPlan, subjectMeta } from './studyPlan';
import { createCloudVault, loadCloudState, normalizeSyncKey, saveCloudState } from './sync';

const STORAGE_KEY = 'oab48-study-state-v3';
const SYNC_KEY = 'oab48-sync-config-v1';

const freshState = () => ({
  version: 3,
  dayProgress: {},
  reviewQueue: [],
  errors: [],
  simulations: [],
  updatedAt: new Date().toISOString(),
});

const parse = (v, f) => { try { return v ? JSON.parse(v) : f; } catch { return f; } };
const utc = d => new Date(d + 'T12:00:00Z');
const addDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayFortaleza = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
const fmt = (d, short = false) => new Intl.DateTimeFormat('pt-BR', short ? { day: '2-digit', month: 'short', timeZone: 'UTC' } : { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' }).format(utc(d));
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const pc = (a,b) => b > 0 ? Math.round(a / b * 100) : 0;

function Pill({children, tone='slate'}) {
  const m = {
    gold:'border-amber-300/20 bg-amber-300/10 text-amber-200',
    green:'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
    red:'border-rose-300/20 bg-rose-300/10 text-rose-200',
    blue:'border-sky-300/20 bg-sky-300/10 text-sky-200',
    slate:'border-white/10 bg-white/[.04] text-slate-400'
  };
  return <span className={'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide ' + m[tone]}>{children}</span>;
}

function Progress({value}) {
  return <div className="h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-all" style={{width: Math.max(0,Math.min(100,value)) + '%'}} /></div>;
}

function Card({children, className=''}) {
  return <div className={'premium-card ' + className}>{children}</div>;
}

function App() {
  const [view,setView] = useState('today');
  const [state,setState] = useState(() => parse(localStorage.getItem(STORAGE_KEY), freshState()));
  const [syncCfg,setSyncCfg] = useState(() => parse(localStorage.getItem(SYNC_KEY), {syncKey:'',pin:'',remember:true}));
  const [syncOpen,setSyncOpen] = useState(false);
  const [syncMode,setSyncMode] = useState(syncCfg.syncKey ? 'connect' : 'create');
  const [syncKey,setSyncKey] = useState(syncCfg.syncKey || '');
  const [pin,setPin] = useState(syncCfg.pin || '');
  const [remember,setRemember] = useState(syncCfg.remember !== false);
  const [syncStatus,setSyncStatus] = useState(syncCfg.syncKey ? 'local' : 'off');
  const [syncMsg,setSyncMsg] = useState('');
  const [search,setSearch] = useState('');
  const [phase,setPhase] = useState('all');
  const [errorForm,setErrorForm] = useState({subject:'Ética/OAB',topic:'',myError:'',correctRule:'',basis:'',trigger:''});
  const [simForm,setSimForm] = useState({title:'',date:todayFortaleza(),score:'',total:'80',notes:''});
  const saveTimer = useRef(null);
  const loaded = useRef(false);

  const today = todayFortaleza();
  const todayPlan = studyPlan.find(x => x.date === today);
  const nextPlan = todayPlan || studyPlan.find(x => x.date >= today) || studyPlan[studyPlan.length-1];
  const daysToExam = Math.max(0,Math.ceil((utc(EXAM_DATE)-utc(today))/86400000));

  const mutate = fn => setState(prev => ({...fn(prev),updatedAt:new Date().toISOString()}));

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state]);
  useEffect(() => localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)), [syncCfg]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    if (!syncCfg.syncKey || !syncCfg.pin) return;
    setSyncStatus('syncing');
    loadCloudState(syncCfg.syncKey,syncCfg.pin).then(({state:remote}) => {
      if (remote && (remote.updatedAt || '') > (state.updatedAt || '')) setState(remote);
      setSyncStatus('synced');
    }).catch(() => setSyncStatus('local'));
  }, []);

  useEffect(() => {
    if (!syncCfg.syncKey || !syncCfg.pin) return;
    clearTimeout(saveTimer.current);
    setSyncStatus('pending');
    saveTimer.current = setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        await saveCloudState(syncCfg.syncKey,state,syncCfg.pin);
        setSyncStatus('synced');
      } catch { setSyncStatus('local'); }
    },20000);
    return () => clearTimeout(saveTimer.current);
  },[state,syncCfg.syncKey,syncCfg.pin]);

  const bp = (date,index) => state.dayProgress?.[date]?.blocks?.[index] || {};

  const updateBlock = (date,index,patch) => mutate(prev => {
    const day = prev.dayProgress[date] || {blocks:[{},{}]};
    const blocks = [...(day.blocks || [{},{}])];
    blocks[index] = {...(blocks[index] || {}),...patch};
    return {...prev,dayProgress:{...prev.dayProgress,[date]:{...day,blocks}}};
  });

  const toggleBlock = (date,index) => mutate(prev => {
    const plan = studyPlan.find(x => x.date === date);
    const block = plan?.blocks[index];
    const day = prev.dayProgress[date] || {blocks:[{},{}]};
    const blocks = [...(day.blocks || [{},{}])];
    const complete = !blocks[index]?.completed;
    blocks[index] = {...(blocks[index]||{}),completed:complete,completedAt:complete?new Date().toISOString():null,minutes:blocks[index]?.minutes || (complete?40:'')};
    const sourceId = date + '-' + index;
    let queue = [...(prev.reviewQueue || [])];
    if (complete && block) {
      const ids = new Set(queue.map(r => r.id));
      reviewIntervals.forEach(interval => {
        const id = sourceId + '-d' + interval;
        if (!ids.has(id)) queue.push({id,sourceId,sourceDate:date,dueDate:addDays(date,interval),interval,subject:block.subject,topic:block.topic,done:false,attempts:0});
      });
    } else {
      queue = queue.filter(r => r.sourceId !== sourceId || r.done);
    }
    return {...prev,dayProgress:{...prev.dayProgress,[date]:{...day,blocks}},reviewQueue:queue};
  });

  const reviewAction = (id,ok) => mutate(prev => ({
    ...prev,
    reviewQueue: prev.reviewQueue.map(r => r.id !== id ? r : ok
      ? {...r,done:true,result:'remembered',completedAt:new Date().toISOString()}
      : {...r,dueDate:addDays(today,2),result:'again',attempts:(r.attempts||0)+1})
  }));

  const due = useMemo(() => (state.reviewQueue||[]).filter(r => !r.done && r.dueDate <= today).sort((a,b) => a.dueDate.localeCompare(b.dueDate)),[state.reviewQueue,today]);
  const upcoming = useMemo(() => (state.reviewQueue||[]).filter(r => !r.done && r.dueDate > today).sort((a,b) => a.dueDate.localeCompare(b.dueDate)),[state.reviewQueue,today]);

  const stats = useMemo(() => {
    let questions=0,correct=0,minutes=0,blocks=0;
    const subjects={};
    studyPlan.forEach(day => day.blocks.forEach((b,i) => {
      const p = state.dayProgress?.[day.date]?.blocks?.[i] || {};
      const q=n(p.qDone), c=n(p.qCorrect), m=n(p.minutes);
      questions+=q; correct+=c; minutes+=m; if(p.completed) blocks++;
      if(!subjects[b.subject]) subjects[b.subject]={questions:0,correct:0,blocks:0,done:0};
      subjects[b.subject].questions+=q; subjects[b.subject].correct+=c; subjects[b.subject].blocks++; if(p.completed) subjects[b.subject].done++;
    }));
    return {questions,correct,minutes,blocks,subjects};
  },[state.dayProgress]);

  const planPct = pc(stats.blocks,studyPlan.length*2);
  const accuracy = pc(stats.correct,stats.questions);
  const hours = (stats.minutes/60).toFixed(1);

  const rows = useMemo(() => Object.entries(subjectMeta)
    .filter(([name]) => !['Misto','Simulado'].includes(name))
    .map(([name,meta]) => {
      const s=stats.subjects[name]||{questions:0,correct:0,blocks:0,done:0};
      return {name,...meta,...s,acc:pc(s.correct,s.questions),donePct:pc(s.done,s.blocks)};
    }).sort((a,b)=>b.historical-a.historical),[stats.subjects]);

  const filtered = useMemo(() => studyPlan.filter(day => {
    const q=search.toLowerCase().trim();
    const text=(day.phase+' '+day.blocks.map(b=>b.subject+' '+b.topic+' '+b.law).join(' ')).toLowerCase();
    return (!q || text.includes(q)) && (phase==='all' || day.phase===phase);
  }),[search,phase]);

  const addError = () => {
    if(!errorForm.topic.trim() || !errorForm.correctRule.trim()) return;
    mutate(prev => ({...prev,errors:[{id:crypto.randomUUID(),...errorForm,mastered:false,createdAt:new Date().toISOString()},...(prev.errors||[])]}));
    setErrorForm({subject:'Ética/OAB',topic:'',myError:'',correctRule:'',basis:'',trigger:''});
  };

  const addSim = () => {
    if(!simForm.title.trim() || n(simForm.total)<=0) return;
    mutate(prev => ({...prev,simulations:[...(prev.simulations||[]),{id:crypto.randomUUID(),...simForm,score:n(simForm.score),total:n(simForm.total)}]}));
    setSimForm({title:'',date:today,score:'',total:'80',notes:''});
  };

  const doCreateSync = async () => {
    setSyncMsg('');
    try {
      if(pin.length<6) throw new Error('Use um PIN com pelo menos 6 caracteres.');
      const key=await createCloudVault(state,pin);
      setSyncKey(key);
      setSyncCfg({syncKey:key,pin:remember?pin:'',remember});
      if(!remember) sessionStorage.setItem('oab48-session-pin',pin);
      setSyncStatus('synced');
      setSyncMode('connect');
      setSyncMsg('Cofre criado. Copie a chave e guarde junto com o PIN.');
    } catch(e) { setSyncMsg(e.message || 'Falha na sincronização.'); }
  };

  const doConnect = async () => {
    setSyncMsg('');
    try {
      const key=normalizeSyncKey(syncKey);
      if(!key || pin.length<6) throw new Error('Informe chave e PIN válidos.');
      const {state:remote}=await loadCloudState(key,pin);
      setState(remote);
      setSyncCfg({syncKey:key,pin:remember?pin:'',remember});
      if(!remember) sessionStorage.setItem('oab48-session-pin',pin);
      setSyncStatus('synced');
      setSyncOpen(false);
    } catch(e) { setSyncMsg(e.message || 'Não foi possível restaurar.'); }
  };

  const manualSave = async () => {
    const p=syncCfg.pin || sessionStorage.getItem('oab48-session-pin') || pin;
    if(!syncCfg.syncKey || !p) { setSyncOpen(true); return; }
    try { setSyncStatus('syncing'); await saveCloudState(syncCfg.syncKey,state,p); setSyncStatus('synced'); } catch { setSyncStatus('local'); }
  };

  const nav = [
    ['today','Hoje','⌂'],['schedule','Cronograma','▦'],['reviews','Revisões','↻'],
    ['performance','Desempenho','▥'],['errors','Caderno de erros','▤'],['simulations','Simulados','◎']
  ];

  const Block = ({block,index,date}) => {
    const p=bp(date,index), q=n(p.qDone), c=n(p.qCorrect), a=q?pc(c,q):null;
    const meta=subjectMeta[block.subject] || subjectMeta.Misto;
    return <Card className={'p-4 sm:p-5 ' + (p.completed?'ring-1 ring-emerald-300/20':'')}>
      <div className="flex items-start gap-3">
        <div className="mt-1 h-12 w-1 rounded-full" style={{background:meta.color}} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={meta.priority==='A+'?'gold':meta.priority==='A'?'blue':'slate'}>{meta.priority}</Pill>
            <span className="text-sm font-semibold text-white">{block.subject}</span>
            <span className="text-xs text-slate-600">Bloco {index===0?'A':'B'} · 40 min</span>
          </div>
          <h3 className="mt-2 text-[15px] font-medium leading-snug text-slate-100">{block.topic}</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{block.law}</p>
          <p className="mt-1 text-[11px] text-slate-600">{block.mode}{block.questions?' · meta '+block.questions+' questões':''}</p>
        </div>
        <button onClick={()=>toggleBlock(date,index)} className={'h-10 w-10 shrink-0 rounded-xl border text-lg transition ' + (p.completed?'border-emerald-300/20 bg-emerald-300/10 text-emerald-300':'border-white/10 text-slate-600 hover:text-white')}>✓</button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="field-mini"><span>Questões</span><input inputMode="numeric" value={p.qDone??''} onChange={e=>updateBlock(date,index,{qDone:e.target.value})} placeholder={block.questions||'0'} /></label>
        <label className="field-mini"><span>Acertos</span><input inputMode="numeric" value={p.qCorrect??''} onChange={e=>updateBlock(date,index,{qCorrect:e.target.value})} placeholder="0" /></label>
        <label className="field-mini"><span>Minutos</span><input inputMode="numeric" value={p.minutes??''} onChange={e=>updateBlock(date,index,{minutes:e.target.value})} placeholder="40" /></label>
        <div className="field-mini"><span>Precisão</span><div className={'mt-1 text-sm font-semibold '+(a===null?'text-slate-600':a>=75?'text-emerald-300':a>=60?'text-amber-300':'text-rose-300')}>{a===null?'—':a+'%'}</div></div>
      </div>
      <input className="input-premium mt-3" value={p.note??''} onChange={e=>updateBlock(date,index,{note:e.target.value})} placeholder="Nota rápida: o que merece voltar?" maxLength={240} />
    </Card>;
  };

  const Review = ({r}) => <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
    <div className="flex items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Pill tone={r.dueDate<today?'red':'blue'}>{r.dueDate<today?'ATRASADA':'D+'+r.interval}</Pill><span className="text-xs text-slate-600">{fmt(r.dueDate,true)}</span></div><div className="mt-2 text-sm font-semibold text-white">{r.subject}</div><div className="mt-1 text-xs leading-relaxed text-slate-500">{r.topic}</div></div>
      <div className="flex gap-2"><button onClick={()=>reviewAction(r.id,false)} className="icon-action text-amber-300" title="Errei: rever em 48h">↺</button><button onClick={()=>reviewAction(r.id,true)} className="icon-action text-emerald-300" title="Lembrei">✓</button></div>
    </div>
  </div>;

  return <div className="min-h-screen bg-[#070B13] text-slate-200">
    <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_15%_0%,rgba(245,193,86,.08),transparent_30%),radial-gradient(circle_at_90%_20%,rgba(70,110,170,.08),transparent_25%)]" />
    <div className="relative mx-auto flex min-h-screen max-w-[1600px]">
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-white/[.07] bg-[#090E18]/90 p-5 lg:flex">
        <div className="flex items-center gap-3 px-2 py-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-600 font-black text-[#171109]">48</div><div><div className="text-sm font-bold text-white">OAB 48</div><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Plano de aprovação</div></div></div>
        <div className="mt-7 space-y-1">{nav.map(([id,label,ico])=><button key={id} onClick={()=>setView(id)} className={'nav-button '+(view===id?'nav-button-active':'')}><span className="w-5 text-center">{ico}</span>{label}</button>)}</div>
        <div className="mt-auto space-y-3">
          <Card className="p-4"><div className="flex justify-between text-xs"><span className="text-slate-500">Plano executado</span><span className="font-semibold text-amber-300">{planPct}%</span></div><div className="mt-3"><Progress value={planPct}/></div><div className="mt-2 text-[11px] text-slate-600">{stats.blocks} de {studyPlan.length*2} blocos</div></Card>
          <button onClick={()=>setSyncOpen(true)} className="w-full rounded-2xl border border-white/[.08] bg-white/[.025] p-3 text-left"><div className="text-xs font-semibold text-slate-300">☁ Sincronização</div><div className="mt-1 text-[10px] text-slate-600">{syncStatus==='synced'?'nuvem atualizada':syncStatus==='syncing'?'sincronizando…':syncCfg.syncKey?'cache local + nuvem':'configurar entre navegadores'}</div></button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-24 lg:pb-8">
        <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#070B13]/85 backdrop-blur-xl"><div className="flex h-16 items-center justify-between px-4 sm:px-7 lg:px-9"><div className="lg:hidden flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-amber-400 font-black text-[#171109]">48</div><b>OAB 48</b></div><div className="hidden lg:block text-xs text-slate-500">1ª fase · 10 jan 2027 · 2h/dia</div><div className="flex items-center gap-2"><Pill tone="gold">{daysToExam} dias</Pill><button onClick={manualSave} className="btn-secondary hidden sm:inline-flex">☁ Salvar nuvem</button></div></div></header>

        <div className="mx-auto max-w-[1180px] p-4 sm:p-7 lg:p-9">
          {view==='today' && <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Execução diária</p><h1 className="page-title">{todayPlan?'Seu estudo de hoje':today<START_DATE?'Começamos amanhã':'Próximo bloco do plano'}</h1><p className="mt-2 text-sm text-slate-500">{todayPlan?fmt(today):'Próxima sessão: '+fmt(nextPlan.date)} · 2 horas líquidas</p></div><Pill tone="gold">{nextPlan.phase.toUpperCase()}</Pill></div>
            <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Card className="p-5"><div className="eyebrow">Progresso</div><div className="mt-2 text-2xl font-semibold text-white">{planPct}%</div><div className="mt-3"><Progress value={planPct}/></div></Card>
              <Card className="p-5"><div className="eyebrow">Horas</div><div className="mt-2 text-2xl font-semibold text-white">{hours}h</div><div className="mt-1 text-xs text-slate-600">de {TOTAL_PLAN_HOURS}h</div></Card>
              <Card className="p-5"><div className="eyebrow">Questões</div><div className="mt-2 text-2xl font-semibold text-white">{stats.questions}</div><div className="mt-1 text-xs text-slate-600">{accuracy}% de acerto</div></Card>
              <Card className="p-5"><div className="eyebrow">Revisões</div><div className="mt-2 text-2xl font-semibold text-white">{due.length}</div><div className="mt-1 text-xs text-slate-600">vencidas hoje</div></Card>
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <Card className="p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">00:00–00:20</div><div className="section-title">Revisão ativa</div></div><Pill tone={due.length?'red':'green'}>{due.length?due.length+' pendentes':'EM DIA'}</Pill></div><p className="mt-2 text-xs leading-relaxed text-slate-500">Tente recuperar antes de consultar. Priorize no máximo quatro revisões; se errar, o item volta em 48h.</p><div className="mt-4 grid gap-2">{due.slice(0,4).map(r=><Review key={r.id} r={r}/>)}{!due.length&&<div className="empty-state">Sem revisão vencida. Faça recuperação mental do último encontro.</div>}</div></Card>
                <div><div className="mb-2 flex justify-between px-1"><span className="eyebrow">00:20–01:00</span><span className="text-[11px] text-slate-600">40 min</span></div><Block block={nextPlan.blocks[0]} index={0} date={nextPlan.date}/></div>
                <div className="flex items-center gap-3 px-3"><div className="h-px flex-1 bg-white/[.06]"/><span className="text-[10px] uppercase tracking-[.18em] text-slate-700">01:00–01:05 · pausa</span><div className="h-px flex-1 bg-white/[.06]"/></div>
                <div><div className="mb-2 flex justify-between px-1"><span className="eyebrow">01:05–01:45</span><span className="text-[11px] text-slate-600">40 min</span></div><Block block={nextPlan.blocks[1]} index={1} date={nextPlan.date}/></div>
                <Card className="p-5"><div className="eyebrow">01:45–02:00</div><div className="section-title">Correção + caderno de erros</div><p className="mt-2 text-xs leading-relaxed text-slate-500">Corrija os itens errados e registre no máximo três aprendizados realmente úteis. Nada de produzir resumo paralelo.</p><button onClick={()=>setView('errors')} className="btn-secondary mt-4">Abrir caderno de erros →</button></Card>
              </div>
              <div className="space-y-4"><Card className="p-5"><div className="eyebrow">Fase atual</div><div className="mt-2 text-lg font-semibold text-white">{nextPlan.phase}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{phaseDescriptions[nextPlan.phase]}</p>{nextPlan.note&&<div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-3 text-xs text-amber-100/70">{nextPlan.note}</div>}</Card><Card className="p-5"><div className="eyebrow">Regra de desempenho</div><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><span className="text-rose-300">Abaixo de 60%</span><span className="text-slate-600">rever em 48h</span></div><div className="flex justify-between"><span className="text-amber-300">60–74%</span><span className="text-slate-600">manter ciclo</span></div><div className="flex justify-between"><span className="text-emerald-300">75%+</span><span className="text-slate-600">avançar</span></div></div></Card></div>
            </div>
          </>}

          {view==='schedule' && <>
            <div><p className="eyebrow">109 dias · 218 horas</p><h1 className="page-title">Cronograma completo</h1><p className="mt-2 text-sm text-slate-500">O roteiro diário já decide o que estudar. Você só executa.</p></div>
            <Card className="mt-6 flex flex-col gap-3 p-4 md:flex-row"><input className="input-premium flex-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar matéria, assunto ou dispositivo…"/><select className="input-premium md:w-64" value={phase} onChange={e=>setPhase(e.target.value)}><option value="all">Todas as fases</option>{Object.keys(phaseDescriptions).map(p=><option key={p} value={p}>{p}</option>)}</select></Card>
            <div className="mt-4 space-y-3">{filtered.map(day=>{const done=day.blocks.every((_,i)=>bp(day.date,i).completed);return <Card key={day.date} className={'p-4 sm:p-5 '+(day.date===today?'ring-1 ring-amber-300/25':'')}><div className="flex flex-col gap-4 lg:flex-row"><div className="lg:w-40 shrink-0"><div className={'text-sm font-semibold '+(day.date===today?'text-amber-300':'text-white')}>{fmt(day.date,true)}</div><div className="mt-1 text-[11px] capitalize text-slate-600">{fmt(day.date).split(',')[0]}</div><div className="mt-2"><Pill tone={done?'green':day.date===today?'gold':'slate'}>{done?'CONCLUÍDO':day.phase}</Pill></div></div><div className="grid flex-1 gap-3 md:grid-cols-2">{day.blocks.map((b,i)=><div key={i} className={'rounded-xl border p-3 '+(bp(day.date,i).completed?'border-emerald-300/15 bg-emerald-300/[.03]':'border-white/[.06] bg-white/[.02]')}><div className="flex justify-between gap-2"><span className="text-xs font-semibold text-slate-300">{b.subject}</span><span className="text-[10px] text-slate-700">{b.questions?b.questions+'q':b.mode}</span></div><div className="mt-1 text-xs leading-relaxed text-slate-500">{b.topic}</div></div>)}</div></div></Card>})}</div>
          </>}

          {view==='reviews' && <>
            <div><p className="eyebrow">D+1 · D+3 · D+7 · D+14 · D+30</p><h1 className="page-title">Fila de revisões</h1><p className="mt-2 text-sm text-slate-500">A fila nasce automaticamente quando um bloco é concluído.</p></div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card className="p-5"><div className="flex justify-between"><div className="section-title">Vencidas / hoje</div><Pill tone={due.length?'red':'green'}>{due.length}</Pill></div><div className="mt-4 space-y-2">{due.map(r=><Review key={r.id} r={r}/>)}{!due.length&&<div className="empty-state">Fila em dia.</div>}</div></Card><Card className="p-5"><div className="section-title">Próximas</div><div className="mt-4 space-y-2">{upcoming.slice(0,30).map(r=><Review key={r.id} r={r}/>)}{!upcoming.length&&<div className="empty-state">Conclua blocos para gerar o calendário espaçado.</div>}</div></Card></div>
          </>}

          {view==='performance' && <>
            <div><p className="eyebrow">Matriz OAB 38–47 + seus dados</p><h1 className="page-title">Desempenho</h1><p className="mt-2 text-sm text-slate-500">O peso histórico orienta prioridade; seu percentual de acerto mostra onde intervir.</p></div>
            <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4"><Card className="p-5"><div className="eyebrow">Acerto geral</div><div className="mt-2 text-2xl font-semibold text-white">{accuracy}%</div></Card><Card className="p-5"><div className="eyebrow">Questões</div><div className="mt-2 text-2xl font-semibold text-white">{stats.questions}</div></Card><Card className="p-5"><div className="eyebrow">Horas</div><div className="mt-2 text-2xl font-semibold text-white">{hours}h</div></Card><Card className="p-5"><div className="eyebrow">Blocos</div><div className="mt-2 text-2xl font-semibold text-white">{stats.blocks}</div></Card></div>
            <Card className="mt-5 overflow-hidden"><div className="border-b border-white/[.06] p-5"><div className="section-title">Matriz por disciplina</div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[10px] uppercase tracking-[.14em] text-slate-600"><th className="px-5 py-3">Disciplina</th><th className="px-3 py-3">Prior.</th><th className="px-3 py-3">Peso hist.</th><th className="px-3 py-3">Questões</th><th className="px-3 py-3">Acerto</th><th className="min-w-[180px] px-5 py-3">Execução</th></tr></thead><tbody>{rows.map(r=><tr key={r.name} className="border-t border-white/[.05]"><td className="px-5 py-3.5 font-medium text-slate-200">{r.name}</td><td className="px-3 py-3.5"><Pill tone={r.priority==='A+'?'gold':r.priority==='A'?'blue':'slate'}>{r.priority}</Pill></td><td className="px-3 py-3.5 text-slate-500">{r.historical.toFixed(1)}</td><td className="px-3 py-3.5 text-slate-500">{r.questions}</td><td className={'px-3 py-3.5 font-semibold '+(!r.questions?'text-slate-700':r.acc>=75?'text-emerald-300':r.acc>=60?'text-amber-300':'text-rose-300')}>{r.questions?r.acc+'%':'—'}</td><td className="px-5 py-3.5"><div className="flex items-center gap-2"><div className="flex-1"><Progress value={r.donePct}/></div><span className="w-9 text-right text-xs text-slate-600">{r.donePct}%</span></div></td></tr>)}</tbody></table></div></Card>
          </>}

          {view==='errors' && <>
            <div><p className="eyebrow">Memória de falhas</p><h1 className="page-title">Caderno de erros</h1><p className="mt-2 text-sm text-slate-500">Pouco texto, alto valor de recuperação.</p></div>
            <Card className="mt-6 p-5"><div className="grid gap-3 md:grid-cols-2"><select className="input-premium" value={errorForm.subject} onChange={e=>setErrorForm({...errorForm,subject:e.target.value})}>{Object.keys(subjectMeta).filter(s=>!['Misto','Simulado'].includes(s)).map(s=><option key={s}>{s}</option>)}</select><input className="input-premium" placeholder="Assunto" value={errorForm.topic} onChange={e=>setErrorForm({...errorForm,topic:e.target.value})}/><textarea className="input-premium min-h-20" placeholder="Meu erro" value={errorForm.myError} onChange={e=>setErrorForm({...errorForm,myError:e.target.value})}/><textarea className="input-premium min-h-20" placeholder="Regra correta" value={errorForm.correctRule} onChange={e=>setErrorForm({...errorForm,correctRule:e.target.value})}/><input className="input-premium" placeholder="Fundamento (artigo, súmula, lei)" value={errorForm.basis} onChange={e=>setErrorForm({...errorForm,basis:e.target.value})}/><input className="input-premium" placeholder="Palavra-gatilho" value={errorForm.trigger} onChange={e=>setErrorForm({...errorForm,trigger:e.target.value})}/></div><button onClick={addError} className="btn-primary mt-4">+ Salvar aprendizado</button></Card>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">{(state.errors||[]).map(e=><Card key={e.id} className={'p-5 '+(e.mastered?'opacity-55':'')}><div className="flex justify-between gap-3"><div><Pill tone={e.mastered?'green':'red'}>{e.mastered?'DOMINADO':'REVISAR'}</Pill><div className="mt-2 text-sm font-semibold text-white">{e.subject} · {e.topic}</div></div><div className="flex gap-2"><button className="icon-action text-emerald-300" onClick={()=>mutate(prev=>({...prev,errors:prev.errors.map(x=>x.id===e.id?{...x,mastered:!x.mastered}:x)}))}>✓</button><button className="icon-action text-rose-300" onClick={()=>mutate(prev=>({...prev,errors:prev.errors.filter(x=>x.id!==e.id)}))}>×</button></div></div>{e.myError&&<p className="mt-3 text-xs text-slate-500"><span className="text-slate-700">Meu erro:</span> {e.myError}</p>}<div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.025] p-3"><div className="text-[10px] uppercase tracking-[.14em] text-amber-300/70">Regra correta</div><div className="mt-1 text-sm leading-relaxed text-slate-300">{e.correctRule}</div></div><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-600">{e.basis&&<span>§ {e.basis}</span>}{e.trigger&&<span>⚡ {e.trigger}</span>}</div></Card>)}{!(state.errors||[]).length&&<div className="empty-state lg:col-span-2">Ainda não há erros registrados. Isso é esperado no início.</div>}</div>
          </>}

          {view==='simulations' && <>
            <div><p className="eyebrow">Meta operacional: 50+/80</p><h1 className="page-title">Simulados</h1><p className="mt-2 text-sm text-slate-500">O corte oficial é 40/80; treinamos acima dele para criar margem.</p></div>
            <Card className="mt-6 p-5"><div className="grid gap-3 md:grid-cols-5"><input className="input-premium md:col-span-2" placeholder="Nome do simulado" value={simForm.title} onChange={e=>setSimForm({...simForm,title:e.target.value})}/><input type="date" className="input-premium" value={simForm.date} onChange={e=>setSimForm({...simForm,date:e.target.value})}/><input className="input-premium" inputMode="numeric" placeholder="Acertos" value={simForm.score} onChange={e=>setSimForm({...simForm,score:e.target.value})}/><input className="input-premium" inputMode="numeric" placeholder="Total" value={simForm.total} onChange={e=>setSimForm({...simForm,total:e.target.value})}/><textarea className="input-premium min-h-20 md:col-span-5" placeholder="Diagnóstico do simulado" value={simForm.notes} onChange={e=>setSimForm({...simForm,notes:e.target.value})}/></div><button onClick={addSim} className="btn-primary mt-4">+ Registrar resultado</button></Card>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(state.simulations||[]).slice().reverse().map(s=>{const score=Math.round(n(s.score)*80/n(s.total));return <Card key={s.id} className="p-5"><div className="flex justify-between"><div><div className="text-sm font-semibold text-white">{s.title}</div><div className="mt-1 text-xs text-slate-600">{fmt(s.date,true)}</div></div><div className={'text-2xl font-semibold '+(score>=50?'text-emerald-300':score>=40?'text-amber-300':'text-rose-300')}>{score}<span className="text-xs text-slate-600">/80</span></div></div><div className="mt-4"><Progress value={score/80*100}/></div>{s.notes&&<p className="mt-3 text-xs leading-relaxed text-slate-500">{s.notes}</p>}</Card>})}{!(state.simulations||[]).length&&<div className="empty-state md:col-span-2 xl:col-span-3">OAB 46 e OAB 47 estão preservados no cronograma para a reta final.</div>}</div>
          </>}
        </div>
      </main>
    </div>

    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-white/[.08] bg-[#090E18]/95 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">{nav.map(([id,label,ico])=><button key={id} onClick={()=>setView(id)} className={'mobile-nav '+(view===id?'text-amber-300':'text-slate-600')}><span className="text-base">{ico}</span><span>{label==='Caderno de erros'?'Erros':label}</span></button>)}</nav>

    {syncOpen&&<div className="fixed inset-0 z-50 grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center" onMouseDown={e=>e.target===e.currentTarget&&setSyncOpen(false)}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0B1120] p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex justify-between gap-4"><div><div className="eyebrow !text-amber-300">🔒 Sincronização criptografada</div><h2 className="mt-2 text-2xl font-semibold text-white">Seu progresso em qualquer navegador</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">O navegador cifra seus registros antes de enviá-los ao cofre remoto. Para restaurar, você precisa da chave e do mesmo PIN.</p></div><button onClick={()=>setSyncOpen(false)} className="icon-action">×</button></div><div className="mt-5 flex gap-2"><button className={'tab-pill '+(syncMode==='create'?'tab-pill-active':'')} onClick={()=>setSyncMode('create')}>Criar cofre</button><button className={'tab-pill '+(syncMode==='connect'?'tab-pill-active':'')} onClick={()=>setSyncMode('connect')}>Conectar existente</button></div>{syncMode==='create'?<div className="mt-5 space-y-3"><input type="password" className="input-premium" value={pin} onChange={e=>setPin(e.target.value)} placeholder="Crie um PIN de pelo menos 6 caracteres"/>{syncCfg.syncKey&&<div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[.04] p-3"><div className="text-xs font-semibold text-emerald-300">Chave atual</div><code className="mt-2 block break-all text-[11px] text-slate-400">{syncCfg.syncKey}</code><button className="btn-secondary mt-3" onClick={()=>navigator.clipboard.writeText(syncCfg.syncKey)}>Copiar chave</button></div>}<label className="flex gap-2 text-xs text-slate-500"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> lembrar PIN neste navegador</label><button className="btn-primary w-full" onClick={doCreateSync}>Criar e sincronizar</button></div>:<div className="mt-5 space-y-3"><textarea className="input-premium min-h-20 font-mono text-xs" value={syncKey} onChange={e=>setSyncKey(e.target.value)} placeholder="Cole a chave de sincronização"/><input type="password" className="input-premium" value={pin} onChange={e=>setPin(e.target.value)} placeholder="PIN"/><label className="flex gap-2 text-xs text-slate-500"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> lembrar PIN neste navegador</label><button className="btn-primary w-full" onClick={doConnect}>Restaurar progresso</button></div>}{syncMsg&&<div className="mt-4 rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs text-slate-400">{syncMsg}</div>}</div></div>}
  </div>;
}

export default App;
