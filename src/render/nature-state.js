// Adaptador visual do contrato {t:'nat', now, w:{k,f,wind}} do servidor do Claude.
// Não escolhe clima/grupos; só suaviza decisões recebidas. Sem fetch, timer ou serviço.
export const NATURE = {active:false,wind:[.8,.5],rain:0,fog:0,cover:.52,lastRain:-Infinity,now:0,received:0,kind:'limpo'};
const profiles={limpo:[0,0,.3],nublado:[0,.1,.7],neblina:[0,.85,.6],garoa:[.25,.25,.8],chuva:[.65,.35,.92],tempestade:[1,.5,1],temporal:[1,.65,1]};
export function acceptNature(message,now=performance.now()/1000) {
  if(message.t==='welcome'||message.t==='offline') {NATURE.active=false;NATURE.lastRain=-Infinity;return;}
  if(message.t!=='nat'||!message.w) return;
  const w=message.w,p=profiles[w.k];
  if(!p||!Array.isArray(w.wind)||w.wind.length!==2||w.wind.some(v=>!Number.isFinite(v)||Math.abs(v)>40)) return;
  NATURE.active=true;NATURE.kind=w.k;NATURE.wind=[...w.wind];[NATURE.rain,NATURE.fog,NATURE.cover]=p;
  NATURE.now=Number.isFinite(message.now)?message.now:0;NATURE.received=now;
  if(NATURE.rain>0) NATURE.lastRain=now;
}
export function natureClock(fallback,now=performance.now()/1000) {
  return NATURE.active ? NATURE.now+now-NATURE.received : fallback;
}
