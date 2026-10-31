const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const segment = (a,b) => { const start=src.indexOf(a); assert.ok(start>=0,a); const end=src.indexOf(b,start); assert.ok(end>start,b); return src.slice(start,end); };
const handlerStart = src.indexOf('  type PendingProcessType');
const requestSource = fs.readFileSync(path.join(__dirname, '../src/utils/requests.ts'), 'utf8');
const extract = requestSource.slice(requestSource.indexOf('export const isPendingRequestItem ='),requestSource.indexOf('export const extractPendingRequests =')).replaceAll('export const', 'const');
const handlers = src.slice(handlerStart, src.indexOf('  const handleApproveRequest =',handlerStart));
const program = ts.transpile(extract + handlers + ';globalThis.api={extractAllPendingRequests,handleApprovePendingItem,handleSetNormalPendingItem,handleRejectPendingItem};',{target:ts.ScriptTarget.ES2022});
function setup(schedule, opts={}) {
 let store = {'2026-10': { schedule: structuredClone(schedule), history: [], untouched: 'keep' }};
 const initial = structuredClone(store), errors=[], successes=[];
 let queue=Promise.resolve(), writes=0;
 class FieldPath { constructor(...segments){this.segments=segments;} }
 const context = {
  MEMBERS:[], db:{}, editorName:'tester', isReadOnly:false,
  getDaysInMonth:(y,m)=>new Date(y,m+1,0).getDate(),
  useRef:value=>({current:value}), FieldPath,
  doc:(_db,_collection,key)=>key, serverTimestamp:()=>0,
  cleanFirestorePayload:x=>JSON.parse(JSON.stringify(x)),
  setSaveError:x=>errors.push(x), triggerSaveOk:x=>successes.push(x),
  setAllData:()=>{throw Error('Unexpected optimistic local update');},
  console:{error:()=>{}},
  runTransaction:(_db, callback)=>{
   const job=queue.then(async()=>{
    if(opts.fail) throw Error('simulated save failure');
    let next=structuredClone(store);
    const result=await callback({
     get:async key=>({exists:()=>!!next[key], data:()=>structuredClone(next[key])}),
     update:(key,...args)=>{
      writes++;
      if(args.length===1) {
       for(const [field,value] of Object.entries(args[0])) {
        const keys=field.split('.'); let obj=next[key]; for(const k of keys.slice(0,-1)) obj=obj[k]??={};
        obj[keys.at(-1)]=structuredClone(value);
       }
      } else {
       for(let i=0;i<args.length;i+=2) {
        const keys=args[i] instanceof FieldPath ? args[i].segments : args[i].split('.');
        let obj=next[key]; for(const k of keys.slice(0,-1)) obj=obj[k]??={};
        obj[keys.at(-1)]=structuredClone(args[i+1]);
       }
      }
     }
    });
    store=next; return result;
   });
   queue=job.catch(()=>{});return job;
  }
 };
 vm.createContext(context);vm.runInContext(program,context);
 return {api:context.api,context,errors,successes,initial,store:()=>store,writes:()=>writes,requests:()=>context.api.extractAllPendingRequests(store)};
}
const pending=(detail='')=>({type:'pending',detail,requestId:Math.random().toString(),requestedAt:'2026-09-13T00:00:00Z'});
(async()=>{
 let count=0;
 async function check(name,fn){await fn();console.log('PASS '+name);count++;}
 await check('bulk approval preserves both days and both history entries',async()=>{
  const x=setup({A:[pending(),pending()]}); await Promise.all(x.requests().map(x.api.handleApprovePendingItem));
  assert.deepEqual(x.store()['2026-10'].schedule.A.slice(0,2).map(i=>i.type),['request','request']);
  assert.equal(x.store()['2026-10'].history.length,2);
 });
 await check('bulk approval preserves different members and unrelated data',async()=>{
  const x=setup({A:[pending()],B:[pending()],C:[{type:'event',detail:'untouched'}]});
  await Promise.all(x.requests().map(x.api.handleApprovePendingItem));
  assert.equal(x.store()['2026-10'].schedule.A[0].type,'request');assert.equal(x.store()['2026-10'].schedule.B[0].type,'request');
  assert.deepEqual(x.store()['2026-10'].schedule.C,x.initial['2026-10'].schedule.C);assert.equal(x.store()['2026-10'].untouched,'keep');
 });
 for(const [fn,type] of [['handleApprovePendingItem','request'],['handleSetNormalPendingItem','normal'],['handleRejectPendingItem','rest']]) {
  await check(fn+' resolves detail-based pending and saves target-month history',async()=>{
   const x=setup({A:[pending('希望休申請')]});await x.api[fn](x.requests()[0]);
   assert.equal(x.requests().length,0);assert.equal(x.store()['2026-10'].schedule.A[0].type,type);
   assert.equal(x.store()['2026-10'].history[0].to,type);assert.equal(x.store()['2026-9'],undefined);
  });
  await check(fn+' reports failed save without changing state',async()=>{
   const x=setup({A:[pending()]},{fail:true});await x.api[fn](x.requests()[0]);
   assert.deepEqual(x.store(),x.initial);assert.equal(x.successes.length,0);assert.ok(x.errors.some(Boolean));
  });
 }
 await check('stale request identity cannot approve a replacement request',async()=>{
  const x=setup({A:[pending()]});const req=x.requests()[0];req.requestId='old-id';
  await x.api.handleApprovePendingItem(req);assert.deepEqual(x.store(),x.initial);assert.ok(x.errors.some(Boolean));
 });
 await check('repeat click commits only once',async()=>{
  const x=setup({A:[pending()]});const req=x.requests()[0];await Promise.all([x.api.handleApprovePendingItem(req),x.api.handleApprovePendingItem(req)]);
  assert.equal(x.writes(),1);assert.equal(x.store()['2026-10'].history.length,1);
 });
 await check('legacy numeric-key schedule can be processed',async()=>{
  const x=setup({A:{0:pending()}});await x.api.handleApprovePendingItem(x.requests()[0]);assert.equal(x.store()['2026-10'].schedule.A[0].type,'request');
 });
 await check('legacy untyped detail supported; explicit resolved types excluded',async()=>{
  const x=setup({A:[{detail:'希望休申請'},{type:'申請',detail:''},{type:'request',detail:'希望休申請'},{type:'rest',detail:'希望休申請'}]});
  assert.equal(x.requests().length,2);
 });

 for (const month of [0,11]) {
  await check('calendar boundary '+(month+1)+' and one-based history day',async()=>{
   const x=setup({A:[pending()]});const data=x.store()['2026-10'];delete x.store()['2026-10'];x.store()['2026-'+(month+1)]=data;
   await x.api.handleApprovePendingItem(x.requests()[0]);
   assert.equal(data.schedule.A[0].type,'pending'); // original snapshot not mutated
   const saved=x.store()['2026-'+(month+1)];
   assert.equal(saved.schedule.A.length,31);assert.equal(saved.history[0].day,1);
   assert.equal(typeof saved.history[0].at,'string');assert.ok(Number.isFinite(Date.parse(saved.history[0].at)));
  });
 }
 await check('history remains newest-first and bounded to 300',async()=>{
  const x=setup({A:[pending()]});
  x.store()['2026-10'].history=Array.from({length:300},(_,i)=>({at:'old-'+i}));
  await x.api.handleApprovePendingItem(x.requests()[0]);const h=x.store()['2026-10'].history;
  assert.equal(h.length,300);assert.equal(h[0].to,'request');assert.equal(h[1].at,'old-0');assert.equal(h.at(-1).at,'old-298');
 });
 await check('member names containing dots are literal fields',async()=>{
  const x=setup({'A.B':[pending()]});await x.api.handleApprovePendingItem(x.requests()[0]);
  assert.equal(x.store()['2026-10'].schedule['A.B'][0].type,'request');assert.equal(x.store()['2026-10'].schedule.A,undefined);
 });
 await check('legacy request without metadata is actionable',async()=>{
  const x=setup({A:[{type:'pending',detail:'希望休申請'}]});await x.api.handleApprovePendingItem(x.requests()[0]);
  assert.equal(x.store()['2026-10'].schedule.A[0].type,'request');
 });
 await check('a resolved stale request cannot be processed twice',async()=>{
  const x=setup({A:[pending()]});const req=x.requests()[0];await x.api.handleApprovePendingItem(req);
  await x.api.handleRejectPendingItem(req);assert.equal(x.store()['2026-10'].schedule.A[0].type,'request');
  assert.equal(x.store()['2026-10'].history.length,1);assert.ok(x.errors.some(Boolean));
 });

 await check('later success cannot hide an earlier batch failure',async()=>{
  const opts={fail:true};const x=setup({A:[pending(),pending()]},opts);const requests=x.requests();
  await x.api.handleApprovePendingItem(requests[0]);opts.fail=false;await x.api.handleApprovePendingItem(requests[1]);
  assert.ok(x.errors.at(-1));assert.equal(x.store()['2026-10'].schedule.A[0].type,'pending');
  assert.equal(x.store()['2026-10'].schedule.A[1].type,'request');
 });
 console.log(count+' tests passed (mock transaction; no production access)');
})().catch(e=>{console.error(e);process.exitCode=1;});
