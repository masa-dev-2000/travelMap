"""Read-only PR8 diagnostics. Changes only ephemeral test copies, never app sources.
Runs the original browser smoke with native Chromium Geolocation instrumentation.
"""
from pathlib import Path
import hashlib,json,os,subprocess,sys

ROOT=Path(__file__).resolve().parents[2]
TESTS=ROOT/'cloudflare/tests'
ARTIFACTS=ROOT/'test-artifacts/root-cause'
ARTIFACTS.mkdir(parents=True,exist_ok=True)
source=(TESTS/'browser-smoke.py').read_text()
expected={'auto-location.js':'9a3d07488d6e9531be5eff37c12e1912ba6e13bf','location-capture.js':'5ef4c6133052fc5a02a002e41b8facdfb8336552','record-display.js':'288399346a0256f1b29f17ebe3a3ce9aac5afc33'}
for name,sha in expected.items():
    b=(ROOT/'cloudflare/public'/name).read_bytes()
    actual=hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
    assert actual==sha,(name,actual)

instrument=r'''(() => {
  window.__gps=[];window.__states=[];window.__errors=[];
  window.addEventListener('error',e=>__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
  const geo=navigator.geolocation;
  if(geo)for(const name of ['watchPosition','getCurrentPosition']){
    const native=geo[name].bind(geo);
    geo[name]=(ok,fail,options)=>{
      const requested=Date.now();__gps.push({kind:name,requested,options,visibility:document.visibilityState});
      return native(p=>{__gps.push({kind:name+' success',requested,now:Date.now(),timestamp:p.timestamp,age:Date.now()-p.timestamp,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy});ok(p);},e=>{__gps.push({kind:name+' error',requested,now:Date.now(),code:e.code,message:e.message});fail?.(e);},options);
    };
  }
  document.addEventListener('DOMContentLoaded',()=>{
    let last='';new MutationObserver(()=>{const text=document.querySelector('.auto-location-state')?.textContent;if(text&&text!==last){__states.push({at:Date.now(),text});last=text;}}).observe(document.body,{childList:true,subtree:true,characterData:true});
  });
})();'''

def replace_once(text,old,new):
    assert text.count(old)==1,('anchor missing/not unique',old,text.count(old))
    return text.replace(old,new,1)

out=[]
for name,fresh,headers in [('baseline',False,False),('fresh-native-fix',True,False),('fresh-native-fix-real-referrer-policy',True,True)]:
    code=source
    if headers:
        code=replace_once(code,'class Quiet(SimpleHTTPRequestHandler):\n','class Quiet(SimpleHTTPRequestHandler):\n    def end_headers(self):\n        self.send_header("Referrer-Policy","no-referrer")\n        super().end_headers()\n')
    code=replace_once(code,'    page=context.new_page();page.on',f'    context.add_init_script({instrument!r})\n    page=context.new_page();page.on')
    if fresh:
        old='    page.wait_for_function("document.querySelector(\'.auto-location-state\').textContent.startsWith(\'記録中\')")'
        extra='    page.wait_for_function("window.__gps.some(e=>e.kind===\'getCurrentPosition\')",timeout=5000)\n    context.set_geolocation({"latitude":35.0001,"longitude":134.0001,"accuracy":10})\n'
        code=replace_once(code,old,extra+old)
    first=code.index("    page.goto(origin+'/admin/record/')")
    end=code.index('    browser.close()',first)
    original=code[first:end]
    capture='''    def snapshot(result):
        state=page.evaluate("({url:location.href,referrer:document.referrer,visibility:document.visibilityState,gps:window.__gps,states:window.__states,jsErrors:window.__errors,current:document.querySelector('.auto-location-state')?.textContent,switchState:document.querySelector('.auto-location [role=switch]')?.getAttribute('aria-checked'),handoff:sessionStorage.getItem('travelmap.location.handoff')})")
        state.update(result=result,browser=browser.version,activity_posts=activity_posts,location_posts=location_posts,page_errors=errors)
        (artifacts/'diagnostic.json').write_text(json.dumps(state,ensure_ascii=False,indent=2))
        print('DIAGNOSTIC '+json.dumps(state,ensure_ascii=False),flush=True)
        page.screenshot(path=str(artifacts/'last-screen.png'),full_page=True)
    try:
'''
    code=code[:first]+capture+'\n'.join('    '+line if line else '' for line in original.split('\n'))+'''    except Exception as error:
        snapshot(type(error).__name__+': '+str(error))
        raise
    else:
        snapshot('PASS')
'''+code[end:]
    path=TESTS/('_diagnostic_'+name+'.py');compile(code,str(path),'exec');path.write_text(code)
    dest=ARTIFACTS/name;dest.mkdir(exist_ok=True)
    env={**os.environ,'TEST_ARTIFACTS':str(dest)}
    print('BEGIN '+name,flush=True)
    try:
        proc=subprocess.run([sys.executable,str(path)],capture_output=True,text=True,env=env,timeout=100)
        (dest/'stdout.log').write_text(proc.stdout);(dest/'stderr.log').write_text(proc.stderr)
        print(proc.stdout,flush=True);print(proc.stderr[-7000:],flush=True)
        result={'case':name,'returncode':proc.returncode}
    except subprocess.TimeoutExpired as error:
        result={'case':name,'timeout':100};print(result,flush=True)
    path.unlink(missing_ok=True)
    if (dest/'diagnostic.json').exists():result['diagnostic']=json.loads((dest/'diagnostic.json').read_text())
    out.append(result)
(ARTIFACTS/'summary.json').write_text(json.dumps({'source_blobs':expected,'cases':out},ensure_ascii=False,indent=2))
print('ROOT_CAUSE_SUMMARY '+json.dumps(out,ensure_ascii=False),flush=True)
