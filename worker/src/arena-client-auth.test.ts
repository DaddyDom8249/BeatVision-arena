import test from 'node:test';
import assert from 'node:assert/strict';
import validated from './arena-validated-entry.ts';
import direct from './arena-entry.ts';

const secret = 'unit-test-gateway-token';
function request(path:string,bearer?:string) {
  return new Request('https://arena.example'+path,{
    method:'POST',
    headers:{'Content-Type':'application/json',...(bearer?{'Authorization':bearer}:{})},
    body:JSON.stringify({contract_version:'1.1',operation:'sceneImages',payload:{
      storyboard:{scenes:[{scene:1,startTime:0,endTime:3,direction:'A person walks'}]},world:{},style:'test'
    }})
  });
}
for(const [name,handler] of [['outer Worker',validated],['inner provider handler',direct]] as const) {
  for(const route of ['/v1/client/image/scene','/v1/client/image/reference-continuation']){
    for(const variant of ['absent','wrong','missing-secret'] as const){
      test(name+' blocks '+route+' with '+variant+' credentials before provider IO',async()=>{
        const originalFetch=globalThis.fetch;
        let calls=0;
        globalThis.fetch=async()=>{calls++;throw Error('Unexpected provider fetch');};
        try{
          const bearer=variant==='absent'?undefined:variant==='wrong'?'Bearer wrong-key':'Bearer test';
          const config=variant==='missing-secret'?{PIXAZO_API_KEY:'fake'}:{GATEWAY_TOKEN:secret,PIXAZO_API_KEY:'fake'};
          const response=await handler.fetch(request(route,bearer),config,{} as any);
          assert.equal(response.status,variant==='missing-secret'?503:401);
          assert.equal((await response.json()).ok,false);
          assert.equal(calls,0);
        }finally{globalThis.fetch=originalFetch;}
      });
    }
  }
}
test('spoofed client IP cannot bypass legacy provider authorization',async()=>{
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('Unauthorized provider request');};
  try{
    const r=request('/v1/client/image/scene');
    r.headers.set('CF-Connecting-IP','2.3.4.5');
    r.headers.set('X-Forwarded-For','7.8.9.10');
    const response=await validated.fetch(r,{GATEWAY_TOKEN:secret,PIXAZO_API_KEY:'fake'},{} as any);
    assert.equal(response.status,401);
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
});
