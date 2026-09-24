"""Independent Chromium regression cases. Real app DOM; controlled API/GPS/map fixtures.
Worker's no-referrer header is included. This does not certify iOS, actual GPS or D1.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import base64,json,os,re,time,unittest
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
ART=Path(os.environ.get('TEST_ARTIFACTS',ROOT/'test-artifacts'))/'browser'
REAL_MAP=os.environ.get('TRAVELMAP_REAL_MAP')=='1'
if REAL_MAP:ART=ART.parent/'real-map'
ART.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def end_headers(self):
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
GPS='''window.__gpsEvents=[];window.__gpsMode='ok';
const pos=()=>({coords:{latitude:35,longitude:134,accuracy:10},timestamp:Date.now()});
const get=(ok,bad,options)=>{window.__gpsEvents.push({event:'request',options});setTimeout(()=>{
 const mode=window.__gpsMode;if(mode==='late')return;
 if(mode!=='ok'){const code={denied:1,unavailable:2,timeout:3}[mode];window.__gpsEvents.push({event:'error',code});bad({code,message:'synthetic '+mode});}
 else{window.__gpsEvents.push({event:'success'});ok(pos());}},10);};
Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:get,watchPosition:(ok,bad,options)=>{get(ok,bad,options);return 1;},clearWatch:()=>{}}});'''
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGPUSHFjgAEmBiSAmwMAKeoA2qTeoJgAAAAASUVORK5CYII=')
class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'cloudflare/public')))
        Thread(target=cls.server.serve_forever,daemon=True).start();cls.origin=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();opts={'headless':True,'args':['--no-sandbox']}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):opts['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
        if REAL_MAP:opts['args']+=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
        cls.browser=cls.pw.chromium.launch(**opts)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.posts=[];self.edits=[];self.samples=[];self.commands=[];self.errors=[];self.leases={};self.held=[];self.upload_mode='ok';self.create_mode='ok';self.owner='test-owner'
        self.muted={'muted'};self.read_cursors={'friend':1,'read':6};self.read_posts=[];self.authenticated=True;self.viewer_delay=0;self.viewer_failure=False
        today=time.strftime('%Y-%m-%d',time.gmtime())
        def pub(id,author,seq,date=today,lat=35.3,lng=134.3):
            return {'id':id,'author':author,'author_name':author,'date':date,'at':None,'latitude':lat,'longitude':lng,'place_name':id,'category_name':'観光','memo':'公開 '+id,'photos':[],'publication_seq':seq}
        self.public_entries=[pub('old','friend',1,'2020-01-01'),pub('public-one','friend',2),pub('public-two','friend',3,lat=35.4,lng=134.4),pub('other-one','other',4,lat=35.6,lng=134.6),pub('read-one','read',5),pub('muted-one','muted',6),pub('my-public','test',7)]
        self.ctx=self.browser.new_context(viewport={'width':390,'height':844})
        self.ctx.add_init_script(GPS);self.ctx.tracing.start(screenshots=True,snapshots=True)
        self.ctx.route('**/api/**',self.api)
        if not REAL_MAP:self.ctx.route('**/vendor/maplibre-gl.mjs',lambda r:r.fulfill(content_type='text/javascript',body=(ROOT/'cloudflare/tests/fake-map.mjs').read_text()))
        self.ctx.route('https://tiles.openfreemap.org/**',lambda r:r.fulfill(content_type='application/json',body='{"version":8,"sources":{},"layers":[]}'))
        self.page=self.ctx.new_page();self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.set_default_timeout(8000)
    def tearDown(self):
        folder=ART/self._testMethodName;folder.mkdir(exist_ok=True)
        try:
            state=self.page.evaluate("({url:location.pathname,referrer:document.referrer,phase:document.querySelector('.auto-location-state')?.textContent,gps:window.__gpsEvents})")
            state.update(activity_posts=len(self.posts),location_posts=len(self.samples),commands=self.commands,errors=self.errors,reads=self.read_posts,muted=sorted(self.muted))
            (folder/'state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2))
            self.page.screenshot(path=str(folder/'screen.png'))
            self.ctx.tracing.stop(path=str(folder/'trace.zip'))
        finally:self.ctx.close()
        self.assertEqual(self.errors,[])
    def api(self,route):
        path=urlparse(route.request.url).path;method=route.request.method;body=route.request.post_data_json if method=='POST' and 'json' in route.request.headers.get('content-type','') else None
        today=time.strftime('%Y-%m-%d',time.gmtime());now=int(time.time()*1000)
        user={'handle':'test','display_name':'テスト','email':'fixture@example.invalid'}
        categories=[{'id':f'cat-{i}','name':n,'active':True,'kind':'activity'} for i,n in enumerate(['食費','その他','移動','交通費','観光費','温泉'])]+[{'id':'expense','name':'食費','active':True,'kind':'expense'}]
        status=200;data={}
        if path=='/api/public/session':data={'user':user if self.authenticated else None,'authenticated':self.authenticated}
        elif path=='/api/public/entries':data={'entries':self.public_entries}
        elif path=='/api/private/viewer-feed':
            if self.viewer_failure:status=503;data={'error':'人物情報を一時的に利用できません'}
            else:data={'version':1,'self':'test','muted':sorted(self.muted),'entries':[{**e,'unread':e['publication_seq']>self.read_cursors.get(e['author'],0)} for e in self.public_entries if e['author']!='test' and e['author'] not in self.muted]}
        elif path=='/api/private/mutes':
            if method=='POST':
                if body['muted']:self.muted.add(body['handle'])
                else:self.muted.discard(body['handle'])
                data=body
            else:data={'users':[{'handle':name,'display_name':name,'muted':name in self.muted} for name in ['friend','other','read','muted']]}
        elif path=='/api/private/read-cursor':
            self.read_posts.append(body);entry=next((e for e in self.public_entries if e['id']==body['entry_id']),None)
            if not entry or entry['author'] in self.muted:status=404;data={'error':'記録が見つかりません'}
            else:
                author=entry['author'];self.read_cursors[author]=max(entry['publication_seq'],self.read_cursors.get(author,0));data={'saved':True,'author':author,'last_seen_seq':self.read_cursors[author]}
        elif path=='/api/private/bootstrap':data={'user':user,'settings':{'map_visible':True,'publish_default':False},'categories':categories,'trips':[]}
        elif re.fullmatch(r'/api/private/activities/[^/]+',path) and method=='POST':
            self.edits.append({'path':path,'body':body});data={'saved':True}
        elif path=='/api/private/activities' and method=='POST':
            self.posts.append({'body':body,'key':route.request.headers.get('idempotency-key')});data={'id':'11111111-1111-4111-8111-111111111111'}
            if self.create_mode=='lost':self.create_mode='ok';route.abort('failed');return
        elif path=='/api/private/activities':data={'activities':[{'id':'a','latitude':35,'longitude':134,'occurred_at':today+'T00:00:00Z','observed_place_name':'出発地点','memo':'出発のメモ','category_name':'観光費','category_id':'cat-4','rating':4},{'id':'b','latitude':35.1,'longitude':134.1,'occurred_at':today+'T00:10:00Z','observed_place_name':'到着地点','memo':'到着のメモ','category_name':'観光費','category_id':'cat-4','rating':5}],'next_offset':None}
        elif path=='/api/private/transactions':data={'transactions':[],'next_offset':None}
        elif path=='/api/private/summary':data={'expense_jpy':0,'income_jpy':0,'refund_jpy':0,'unconverted_count':0,'estimated_count':0}
        elif path=='/api/private/footprints':data={'visitors':[],'unread':False}
        elif path=='/api/private/location-capture':
            command=body['command'];self.commands.append(command);key=body['client_id'];lease=self.leases.get(key)
            if command=='start':self.leases[key]={**body,'expires_at':now+90000};data={'owner':self.owner,'expires_at':now+90000}
            elif command=='prepare':
                if lease:lease.update(token=body['token'],destination=body['destination'],next_at=body['next_at'],handoff_expires_at=now+15000)
                data={'owner':self.owner,'expires_at':now+15000,'next_at':body['next_at']}
            elif command=='claim':
                if not lease or lease.get('token')!=body['token'] or lease.get('handoff_expires_at',0)<now:status=409;data={'error':'期限切れ'}
                else:lease.update(capture_id=body['capture_id'],page_id=body['page_id']);data={'owner':self.owner,'expires_at':now+90000,'next_at':lease['next_at']}
            elif command=='stop':
                if lease and lease['capture_id']==body['capture_id'] and lease['page_id']==body['page_id']:self.leases.pop(key,None)
                data={'stopped':True}
            else:data={'owner':self.owner,'expires_at':now+90000}
        elif path=='/api/private/location-samples' and method=='POST':self.samples.append(body);data={'id':body['id'],'saved':True}
        elif path=='/api/private/location-samples':data={'samples':[],'next_cursor':None}
        elif path=='/api/private/attachments' and method=='POST':
            if self.upload_mode=='hold':self.held.append(route);return
            if self.upload_mode=='fail':self.upload_mode='ok';status=503;data={'error':'synthetic unavailable'}
            else:data={'id':'22222222-2222-4222-8222-222222222222'}
        elif path.startswith('/api/private/attachments'):data={'attachments':[]}
        route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
    def recording(self,path='/admin/start/'):
        self.page.goto(self.origin+path);self.page.get_by_role('switch',name='自動位置記録 OFF').click()
        expect(self.page.locator('.auto-location-state')).to_contain_text('記録中');self.assertEqual(len(self.samples),1)
    def form(self):
        self.page.goto(self.origin+'/admin/record/');expect(self.page.locator('#quick-cats button')).to_have_count(4)
        self.page.locator('#place').fill('試験タイトル');self.page.locator('#quick-cats button').first.click()
    def photo(self):self.page.locator('#photo').set_input_files({'name':'fixture.png','mimeType':'image/png','buffer':PNG});expect(self.page.locator('#previews img')).to_have_count(1)
    def test_input_flow(self):
        p=self.page;self.form();p.locator('#place').focus()
        p.locator('#place').evaluate("e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))")
        self.assertEqual(p.evaluate('document.activeElement.id'),'place');p.locator('#place').press('Enter')
        self.assertTrue(p.evaluate("document.activeElement.closest('#quick-cats')!==null"))
        p.locator('#more').click();p.locator('#sheet-list button').first.click();self.assertTrue(p.evaluate("document.activeElement.closest('#rating')!==null"))
        p.locator('#rating button').nth(3).click();self.assertEqual(p.evaluate('document.activeElement.id'),'photo-open')
        p.locator('#photo-skip').click();p.locator('#memo').fill('一行目');p.locator('#memo').press('Enter');p.locator('#memo').type('二行目')
        self.assertIn('\n',p.locator('#memo').input_value());p.locator('#memo-done').click();self.assertEqual(len(self.posts),0)
        p.locator('#amount').fill('0');p.locator('#save').click();expect(p.locator('#place')).to_have_value('')
        self.assertEqual(self.posts[0]['body']['transaction']['amount_minor'],0)
    def test_photo_save_race_and_off_remains_available(self):
        self.recording('/admin/record/');p=self.page;p.locator('#quick-cats button').first.click();self.photo();self.upload_mode='hold'
        p.locator('#save').click();expect(p.locator('#save')).to_be_disabled();expect(p.locator('#photo-open')).to_be_disabled()
        p.evaluate("document.querySelector('#quick').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        self.assertEqual(len(self.posts),1)
        p.get_by_role('switch',name='自動位置記録 ON').click();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_enabled()
        self.assertTrue(self.held);self.held.pop().fulfill(content_type='application/json',body='{"id":"photo"}')
        expect(p.locator('#save')).to_be_enabled();self.assertEqual(len(self.posts),1)
    def test_unknown_response_and_attachment_retry(self):
        self.form();self.photo();self.create_mode='lost';p=self.page;p.locator('#save').click()
        expect(p.locator('#save')).to_have_text('同じ内容で再試行');self.upload_mode='fail';p.locator('#save').click()
        expect(p.locator('#save')).to_have_text('写真・公開を再試行');self.assertEqual(self.posts[0],self.posts[1]);p.locator('#save').click()
        expect(p.locator('#place')).to_have_value('');self.assertEqual(len(self.posts),2)
    def test_no_referrer_link_handoff(self):
        self.recording();p=self.page;expect(p.locator('#status-form')).to_have_count(0)
        p.get_by_role('link',name=re.compile('くわしく')).click();expect(p.locator('.auto-location-state')).to_contain_text('記録中')
        self.assertEqual(p.evaluate('document.referrer'),'');self.assertEqual(len(self.samples),1);self.assertIn('claim',self.commands)
        p.get_by_role('switch',name='自動位置記録 ON').click();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_visible()
    def test_actual_map_record_button_handoff(self):
        self.recording('/');p=self.page;p.get_by_role('button',name='記録する',exact=True).click()
        expect(p.locator('.auto-location-state')).to_contain_text('記録中');self.assertTrue(p.url.endswith('/admin/start/'))
        self.assertEqual(p.evaluate('document.referrer'),'');self.assertEqual(len(self.samples),1);self.assertIn('prepare',self.commands)
    def test_back_restore_does_not_restart(self):
        self.recording();p=self.page;p.get_by_role('link',name=re.compile('くわしく')).click();expect(p.locator('.auto-location-state')).to_contain_text('記録中')
        p.go_back();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_visible();self.assertEqual(len(self.samples),1)
        p.get_by_role('link',name=re.compile('くわしく')).click();self.assertTrue(p.url.endswith('/admin/record/'))
    def test_gps_errors_are_observable(self):
        for mode in ['denied','unavailable','timeout']:
            self.page.goto(self.origin+'/admin/start/');self.page.evaluate('m=>window.__gpsMode=m',mode)
            self.page.get_by_role('switch',name='自動位置記録 OFF').click()
            expect(self.page.locator('.auto-location-state')).to_contain_text('許可' if mode=='denied' else '取得できません')
        self.assertEqual(len(self.samples),0)
    def test_map_card_and_seek_while_playing(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible()
        p.wait_for_function('!window.__tmMap.isStyleLoaded || window.__tmMap.isStyleLoaded()')
        p.get_by_role('button',name=re.compile('^最新 ')).click();expect(p.locator('.tm-record-card h2')).to_have_text('到着地点')
        self.assertFalse(p.evaluate("document.querySelector('.map-stage').classList.contains('pane-open')"))
        p.locator('.replay-play').click();expect(p.locator('.replay-speed')).to_be_visible();p.locator('.replay-play').click()
        self.assertEqual(p.evaluate('__tm.player.state().author'),'friend');self.assertEqual(p.evaluate('__tm.player.state().total'),2)
        p.locator('.replay-speed').click();self.assertEqual(p.evaluate('__tm.player.state().speed'),1.5)
        p.locator('.replay-speed').click();self.assertEqual(p.evaluate('__tm.player.state().speed'),2)
        expect(p.locator('.replay-speed')).to_have_text('2.0×')
        p.locator('.replay-progress').evaluate("e=>{e.value=e.max;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(p.evaluate('__tm.player.state().index'),1);self.assertFalse(p.evaluate('__tm.player.state().playing'))
        self.assertLessEqual(p.locator('.replay-control.active').bounding_box()['height'],60)
        expect(p.locator('.tm-record-card h2')).to_have_text('public-two')
        p.locator('.maplibregl-popup-close-button').click();expect(p.locator('.tm-record-card')).to_have_count(0)
        p.get_by_role('button',name='再生を終了',exact=True).click();self.assertFalse(p.evaluate('__tm.player.active()'))
    def test_social_navigation_and_settings(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible()
        self.assertEqual(p.locator('.map-rail button[aria-controls]').evaluate_all("nodes=>nodes.map(n=>n.getAttribute('aria-label'))"),['プロフィール','記録する','設定'])
        expect(p.locator('.me-button,.friends-toggle,.route-overview,.maplibregl-ctrl-zoom-in')).to_have_count(0)
        expect(p.locator('.auto-location button')).to_have_count(1)
        p.get_by_role('button',name='プロフィール',exact=True).click();expect(p.locator('#view-profile #me-name')).to_have_text('テスト');expect(p.locator('#view-profile #money-panel')).to_be_visible()
        p.get_by_role('button',name='パネルを閉じる').click();p.get_by_role('button',name='設定',exact=True).click()
        expect(p.locator('#settings-dialog')).to_be_visible();expect(p.locator('#map-style-settings .basemap-control')).to_be_visible();expect(p.locator('#settings-dialog #profile-form')).to_have_count(0)
        p.locator('#map-style-settings button',has_text='Bright').click();p.wait_for_function("document.body.dataset.basemap==='bright'")
        p.get_by_role('button',name='設定を閉じる',exact=True).click()
    def test_stories_mute_selection_and_unread(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible()
        expect(p.locator('.story-person')).to_have_count(3);expect(p.locator('.story-person.unread')).to_have_count(2)
        p.locator('.story-person[data-handle="friend"]').click();self.assertEqual(p.evaluate('__tm.viewerState.state().selectedUser'),'friend')
        expect(p.locator('.story-person.unread')).to_have_count(2);expect(p.locator('.story-person[data-handle="muted"],.story-person[data-handle="test"]')).to_have_count(0)
        p.get_by_role('button',name='設定',exact=True).click();p.get_by_role('checkbox',name='friendをミュート',exact=True).check()
        expect(p.locator('.story-person[data-handle="friend"]')).to_have_count(0);self.assertEqual(p.evaluate('__tm.viewerState.state().selectedUser'),None)
        p.get_by_role('button',name='設定を閉じる',exact=True).click();expect(p.locator('.friend-marker[data-handle="friend"]')).to_have_count(0)
        p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()');self.assertEqual(p.evaluate('__tm.player.state().author'),'other')
        p.get_by_role('button',name='再生を終了',exact=True).click()
        p.get_by_role('button',name='設定',exact=True).click();p.get_by_role('checkbox',name='friendをミュート',exact=True).uncheck();expect(p.locator('.story-person[data-handle="friend"]')).to_have_count(1)
    def test_selected_period_and_read_callback(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible();p.locator('.story-person[data-handle="friend"]').click()
        p.locator('.period-chip').select_option('7');p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()')
        self.assertEqual(p.evaluate('__tm.player.state().total'),2);expect(p.locator('.tm-record-card h2')).to_have_text('public-one')
        p.wait_for_timeout(750);self.assertTrue(any(r['entry_id']=='public-one' for r in self.read_posts));p.get_by_role('button',name='再生を終了',exact=True).click()
        p.locator('.period-chip').select_option('all');p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()');self.assertEqual(p.evaluate('__tm.player.state().total'),3)
    def test_hidden_pause_and_snapshot(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible();p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()')
        # Deterministic visibility event, not an iPhone screen-lock certification.
        p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        before=len(self.read_posts);index=p.evaluate('__tm.player.state().index');p.wait_for_timeout(3000)
        self.assertEqual(len(self.read_posts),before);self.assertEqual(p.evaluate('__tm.player.state().index'),index);self.assertFalse(p.evaluate('__tm.player.state().playing'))
        self.public_entries.append({**self.public_entries[1],'id':'new-later','publication_seq':8})
        p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        p.wait_for_timeout(700);self.assertFalse(p.evaluate('__tm.player.state().playing'));self.assertEqual(p.evaluate('__tm.player.state().total'),2)
    def test_public_detail_period_picker_and_anonymous(self):
        p=self.page;self.authenticated=False;p.goto(self.origin+'/');expect(p.locator('.stories-strip')).to_be_visible()
        expect(p.locator('.auto-location')).to_have_count(0);p.locator('.period-chip').select_option('custom')
        p.locator('input[aria-label="期間の開始日"]').fill('2020-01-01');p.locator('input[aria-label="期間の終了日"]').fill('2026-09-20');p.get_by_role('button',name='この期間を表示').click()
        self.assertEqual(p.evaluate('__tm.viewerState.state().period.preset'),'custom');p.locator('.story-person[data-handle="friend"]').click();p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()')
        p.locator('.tm-record-card').get_by_role('button',name='詳細を見る').click();expect(p.locator('.record-detail')).to_be_visible();self.assertFalse(p.evaluate('__tm.player.active()'))
    def test_failed_viewer_response_is_observable(self):
        self.viewer_failure=True;p=self.page;p.goto(self.origin+'/');expect(p.locator('.data-warning')).to_be_visible();expect(p.locator('.replay-play')).to_be_disabled();self.assertEqual(self.read_posts,[])
    def test_compact_controls_at_mobile_widths(self):
        p=self.page
        for width,height in [(320,568),(375,667),(390,844)]:
            p.set_viewport_size({'width':width,'height':height});p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible()
            for selector in ['.period-chip','.auto-location [role="switch"]']:
                self.assertTrue(p.locator(selector).evaluate("e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}"),selector)
            p.locator('.replay-play').click();p.wait_for_function('__tm.player.active()');p.locator('.replay-play').click()
            bar=p.locator('.replay-control.active').bounding_box();self.assertLessEqual(bar['height'],60);self.assertGreaterEqual(bar['x'],0);self.assertLessEqual(bar['x']+bar['width'],width)
            for selector in ['.replay-speed','.replay-stop','.replay-progress']:
                self.assertTrue(p.locator(selector).evaluate("e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}"),selector)
            p.get_by_role('button',name='再生を終了',exact=True).click()
    def test_self_shared_url_stays_public_only(self):
        p=self.page;p.goto(self.origin+'/?play=test');p.wait_for_function('__tm.player.active()')
        self.assertEqual(p.evaluate('__tm.player.state().total'),1)
        self.assertEqual(p.evaluate('__tm.player.state().step.id'),'my-public')
        p.wait_for_timeout(700);self.assertEqual(self.read_posts,[])
        expect(p.locator('.tm-record-card h2')).to_have_text('my-public')
    def test_obscured_card_is_not_marked_read(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.stories-strip')).to_be_visible()
        p.evaluate("{const overlay=document.createElement('div');overlay.id='test-cover';Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'99999',background:'white'});document.body.append(overlay);}")
        p.evaluate('__tm.playback.play()');p.wait_for_function('__tm.player.active()');p.wait_for_timeout(700)
        self.assertEqual(self.read_posts,[])
        p.evaluate("document.querySelector('#test-cover').remove();__tm.player.pause();__tm.player.resume();")
        p.wait_for_timeout(900);self.assertGreater(len(self.read_posts),0)
    def test_play_during_profile_bootstrap(self):
        # Deliberately interleave private-panel startup and the first Play fetch.
        # No forced clicks or longer global timeout: reproduce the cancellation.
        p=self.page;activities=[];feeds=[];feed_calls=[]
        def hold(route):
            path=urlparse(route.request.url).path
            if path=='/api/private/activities':activities.append(route);return
            if path=='/api/private/viewer-feed':
                feed_calls.append(route.request.url)
                if len(feed_calls)==2:feeds.append(route);return
            self.api(route)
        p.route('**/api/**',hold);p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        for _ in range(100):
            if activities:break
            p.wait_for_timeout(20)
        self.assertTrue(activities)
        p.evaluate('void __tm.playback.play()')
        for _ in range(100):
            if feeds:break
            p.wait_for_timeout(20)
        self.assertTrue(feeds)
        self.api(activities.pop())
        expect(p.locator('.auto-location')).to_be_visible()
        self.assertEqual(len(feed_calls),2,'Private startup must not replace the pending Play feed')
        self.api(feeds.pop());p.wait_for_function('__tm.player.active()')
        self.assertEqual(p.evaluate('__tm.player.state().author'),'friend')
    def test_tab_return_reuses_a_recent_feed_but_actions_still_refresh(self):
        # Returning to the tab used to re-read the whole feed every time, which was the
        # largest share of D1 reads in normal use.
        p=self.page;feed_calls=[]
        def count(route):
            if urlparse(route.request.url).path in ('/api/private/viewer-feed','/api/public/entries'):
                feed_calls.append(route.request.url)
            self.api(route)
        p.route('**/api/**',count);p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function('__tm.everyone.count()>0')
        after_load=len(feed_calls)
        self.assertGreater(after_load,0,'the first load must read the feed')
        for _ in range(3):
            p.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            p.wait_for_timeout(250)
        self.assertEqual(len(feed_calls),after_load,'a recent feed must be reused on tab return')
        # An explicit action must still re-read, and so must a return once the feed is stale.
        p.evaluate('void __tm.everyone.reload()')
        p.wait_for_timeout(400)
        self.assertEqual(len(feed_calls),after_load+1,'an explicit reload must always re-read')
        p.evaluate("void __tm.everyone.reload({maxAge:0})")
        p.wait_for_timeout(400)
        self.assertEqual(len(feed_calls),after_load+2,'a stale feed must be re-read on return')

    def test_quick_add_form_locates_on_open_without_a_button_press(self):
        # The record screen already located automatically; the map's quick add form did not,
        # so a missed button press saved a record with no coordinates.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("!!document.querySelector('#activity-form [name=latitude]')")
        self.assertEqual(p.input_value('#activity-form [name=latitude]'),'','closed form must not measure')
        p.evaluate("__tm.shell.open('add')")
        p.wait_for_function("document.querySelector('#activity-form [name=latitude]').value!==''")
        p.evaluate("document.querySelector('#add-forms details').open=true")
        self.assertEqual(p.input_value('#activity-form [name=latitude]'),'35')
        self.assertEqual(p.input_value('#activity-form [name=longitude]'),'134')
        expect(p.locator('#locate-state')).to_contain_text('位置 ±')
        # A hand-typed coordinate must survive; GPS must not overwrite it.
        p.fill('#activity-form [name=latitude]','12.5')
        expect(p.locator('#locate-state')).to_contain_text('手で入れた位置')
        p.evaluate("navigator.geolocation.watchPosition&&document.dispatchEvent(new Event('visibilitychange'))")
        p.wait_for_timeout(200)
        self.assertEqual(p.input_value('#activity-form [name=latitude]'),'12.5')
        # Pressing the button explicitly hands control back to GPS.
        p.click('#locate')
        p.wait_for_function("document.querySelector('#activity-form [name=latitude]').value==='35'")
        self.assertEqual(p.input_value('#activity-form [name=latitude]'),'35')

    def test_quick_add_form_reports_a_failed_fix_and_stops_when_closed(self):
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.evaluate("window.__gpsMode='denied'")
        p.evaluate("__tm.shell.open('add')")
        expect(p.locator('#locate-state')).to_contain_text('位置を取得できません')
        self.assertEqual(p.input_value('#activity-form [name=latitude]'),'','a failed fix must not invent coordinates')
        p.evaluate("window.__gpsMode='ok';window.__gpsEvents.length=0;__tm.shell.hide()")
        p.wait_for_timeout(300)
        self.assertEqual(p.evaluate('window.__gpsEvents.length'),0,'a closed form must not keep measuring')

    def open_own_edit(self,index=0):
        p=self.page
        p.evaluate("__tm.shell.open('profile')")
        p.wait_for_function("document.querySelectorAll('#activities > details').length>0")
        p.evaluate("""(i)=>{
          const entry=[...document.querySelectorAll('#activities > details')][i];
          entry.open=true;entry.querySelector('details').open=true;
        }""",index)
        p.wait_for_function("!!document.querySelector('#activities [type=number][step=any]')")

    def first_lat(self):
        return self.page.evaluate("document.querySelector('#activities [type=number][step=any]').value")

    def record(self,index=0):
        return self.page.locator('#activities > details').nth(index)

    def reopen_panel(self,index=0):
        # 位置の調整が終われば shell が自分で戻すので、待つだけでよい。
        expect(self.record(index).get_by_role('button',name='保存する')).to_be_visible()

    def test_a_records_pin_is_grabbable_only_while_editing_that_record(self):
        # Moving a point used to mean typing coordinates or centring the map first.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.assertEqual(p.locator('.edit-pin').count(),0,'a record is not grabbable until asked')
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        # 調整中は地図だけになるので、別の記録に移るにはまず調整を終える。
        p.get_by_role('button',name='やめる').click()
        expect(p.locator('.edit-pin')).to_have_count(0)
        expect(self.record().get_by_role('button',name='保存する')).to_be_visible()
        # 2件目を掴んでも、ピンは常に1本。
        self.open_own_edit(1)
        self.record(1).get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        expect(p.locator('.edit-bar')).to_have_count(1)
        # 編集そのものを閉じれば、ピンもバーも離れる。
        p.get_by_role('button',name='やめる').click()
        p.evaluate("[...document.querySelectorAll('#activities > details')][1].querySelector('details').open=false")
        expect(p.locator('.edit-pin')).to_have_count(0)
        expect(p.locator('.edit-bar')).to_have_count(0)

    def test_reverting_a_moved_position_restores_the_stored_one(self):
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.assertEqual(self.first_lat(),'35')
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        p.evaluate("document.querySelector('#activities [type=number][step=any]').value='10.5'")
        p.get_by_role('button',name='やめる').click()
        self.assertEqual(self.first_lat(),'35','cancelling must restore the stored position')
        expect(p.locator('.edit-pin')).to_have_count(0)
        expect(p.locator('.edit-bar')).to_have_count(0)

    @unittest.skipUnless(REAL_MAP,'dragging needs the real MapLibre marker')
    def test_dragging_the_pin_updates_the_coordinate_fields(self):
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        before=self.first_lat()
        p.wait_for_timeout(800)
        box=p.locator('.edit-pin').bounding_box()
        p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        p.mouse.down();p.mouse.move(box['x']+140,box['y']+110,steps=10);p.mouse.up()
        p.wait_for_function("document.querySelector('#activities [type=number][step=any]').value!==%s"%json.dumps(before))
        self.assertNotEqual(self.first_lat(),before,'dragging must update the coordinate field')

    def test_confirming_from_the_map_saves_without_reopening_the_panel(self):
        # The save button lives in a panel that narrow screens close, so confirming
        # has to be reachable from the map itself.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-bar')).to_be_visible()
        self.assertEqual(p.evaluate("!!document.querySelector('.map-stage.map-only')"),True,
                         'adjusting takes the whole map, so the bar must carry the confirm')
        self.assertEqual(p.evaluate("!!document.querySelector('.pane-open')"),False,
                         'and the panel steps aside while the pin is being moved')
        p.evaluate("document.querySelector('#activities [type=number][step=any]').value='36.5'")
        p.get_by_role('button',name='この位置で確定').click()
        p.wait_for_function('window.__edits===undefined||true')
        for _ in range(100):
            if self.edits:break
            p.wait_for_timeout(20)
        self.assertTrue(self.edits,'confirming must save')
        self.assertEqual(self.edits[-1]['path'],'/api/private/activities/a')
        self.assertEqual(self.edits[-1]['body']['latitude'],36.5)
        expect(p.locator('.edit-pin')).to_have_count(0)
        expect(p.locator('.edit-bar')).to_have_count(0)

    def test_the_confirm_bar_does_not_land_on_another_control(self):
        # The bar shares a row with the playback control and sits above the bottom rail.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-bar')).to_be_visible()
        expect(p.locator('.replay-control')).to_be_hidden()
        overlap=p.evaluate("""()=>{
          const bar=document.querySelector('.edit-bar').getBoundingClientRect();
          const hit=[...document.querySelectorAll('.map-rail,.replay-control,.map-fit')]
            .map(e=>e.getBoundingClientRect())
            .filter(r=>r.width&&r.height&&!(r.right<=bar.left||r.left>=bar.right||r.bottom<=bar.top||r.top>=bar.bottom));
          return hit.length;
        }""")
        self.assertEqual(overlap,0,'the confirm bar must not sit on the navigation or another control')
        for name in ('この位置で確定','やめる'):
            button=p.get_by_role('button',name=name)
            box=button.bounding_box()
            top=p.evaluate("(b)=>{const e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return e&&e.textContent.trim();}",box)
            self.assertEqual(top,name,f'{name} must be the element actually under the finger')
        # Stopping restores the playback control.
        p.get_by_role('button',name='やめる').click()
        expect(p.locator('.replay-control')).to_be_visible()

    def test_tapping_a_point_zooms_to_it_like_editing_does(self):
        # Editing eased to the point; tapping one left the view where it was.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        result=p.evaluate("""()=>{
          const e=__tm.viewerState.state().entries.find(x=>x.latitude!=null);
          const before=__tm.everyone.mapZoom();
          __tm.everyone.showEntry(e);
          return {before,target:[e.longitude,e.latitude]};
        }""")
        p.wait_for_timeout(900)
        after=p.evaluate("({zoom:__tm.everyone.mapZoom(),centre:__tm.everyone.mapCentre()})")
        self.assertLess(result['before'],14,'the fixture must start zoomed out, or this proves nothing')
        self.assertGreaterEqual(after['zoom'],14,'tapping must zoom in to the point')
        self.assertAlmostEqual(after['centre'][0],result['target'][0],places=2)
        self.assertAlmostEqual(after['centre'][1],result['target'][1],places=2)

    def test_confirming_keeps_the_view_on_the_point(self):
        # Saving refreshes the feed, which refits the map to every record. After
        # confirming a position the view jumped away from the point just placed.
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-bar')).to_be_visible()
        p.wait_for_timeout(600)
        focused=p.evaluate("({zoom:__tm.everyone.mapZoom(),centre:__tm.everyone.mapCentre()})")
        self.assertGreaterEqual(focused['zoom'],14)
        p.get_by_role('button',name='この位置で確定').click()
        for _ in range(100):
            if self.edits:break
            p.wait_for_timeout(20)
        self.assertTrue(self.edits,'confirming must save')
        p.wait_for_timeout(1200)
        after=p.evaluate("({zoom:__tm.everyone.mapZoom(),centre:__tm.everyone.mapCentre()})")
        self.assertGreaterEqual(after['zoom'],14,'confirming must not zoom back out')
        self.assertAlmostEqual(after['centre'][0],focused['centre'][0],places=2,msg='the view must stay on the point')
        self.assertAlmostEqual(after['centre'][1],focused['centre'][1],places=2)

    # --- UI改修前の安全網。構造ではなく「守りたい事実」を押さえる ---

    def moves(self):
        """偽の地図に「どこへ寄せろと指示されたか」を尋ねる。実物では見た目を再現できないため。"""
        return self.page.evaluate("window.__tmMap.moves.map(m=>({kind:m.kind,center:m.center,zoom:m.zoom,padding:m.padding}))")

    def test_tapping_a_point_asks_the_map_to_move_to_it(self):
        if REAL_MAP: self.skipTest('偽の地図だけが指示を記録する')
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        target=p.evaluate("""()=>{
          const e=__tm.viewerState.state().entries.find(x=>x.latitude!=null);
          window.__tmMap.moves.length=0;
          __tm.everyone.showEntry(e);
          return [e.longitude,e.latitude];
        }""")
        p.wait_for_timeout(700)
        asked=[m for m in self.moves() if m['center']]
        self.assertTrue(asked,'tapping must ask the map to move')
        last=asked[-1]
        self.assertAlmostEqual(last['center'][0],target[0],places=4)
        self.assertAlmostEqual(last['center'][1],target[1],places=4)
        self.assertGreaterEqual(last['zoom'],14,'and to zoom in, not merely recentre')

    def test_muting_in_the_browser_removes_an_author_everywhere(self):
        """サーバーが送ってきた相手をブラウザ側でミュートしても、表示・名簿・再生から消える。
        フィクスチャは既にミュート済みを送らないので、ここは画面側の除外だけを試す。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        def picture():
            return p.evaluate("""async()=>{
              const {playbackQueue}=await import('/viewer-state.js');
              const s=__tm.viewerState.state();
              return {authors:s.users.map(u=>u.handle),entries:s.entries.map(e=>e.author),
                      queue:playbackQueue(s).map(g=>g.user.handle),
                      strip:[...document.querySelectorAll('.story-person[data-handle]')].map(n=>n.dataset.handle)};
            }""")
        before=picture()
        self.assertIn('friend',before['authors'],'the fixture must deliver this author')
        self.assertIn('friend',before['strip'])
        p.evaluate("__tm.viewerState.setMuted('friend',true)")
        p.wait_for_timeout(300)
        after=picture()
        for where in ('authors','entries','queue','strip'):
            self.assertNotIn('friend',after[where],f'a muted author must leave {where}')
        self.assertNotIn('test',after['queue'],'and the viewer never plays their own records')

    def test_the_server_never_sends_a_muted_author(self):
        """画面側を直しても、送られてこない相手は出ない。サーバー側の除外を別に押さえる。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        feed=p.evaluate("fetch('/api/private/viewer-feed',{cache:'no-store'}).then(r=>r.json())")
        self.assertIn('muted',feed['muted'],'the fixture must start with a muted author')
        self.assertNotIn('muted',[e['author'] for e in feed['entries']],
                         'the feed must not carry a muted author at all')
        self.assertNotIn('test',[e['author'] for e in feed['entries']],
                         'nor the viewer themselves')

    def test_travel_mode_is_changed_in_one_place_only(self):
        """公開範囲を左右する設定なので、変えられる場所が増えると事故になる。
        記録の開始画面は今どちらかを示すだけにし、切替は設定に寄せた。"""
        p=self.page
        p.goto(self.origin+'/admin/start/')
        expect(p.locator('#visible-label')).to_be_visible()
        self.assertEqual(p.locator('#visible').count(),0,
                         'the start screen must not offer a travel-mode switch')
        wrote=[c for c in self.commands if c.get('path')=='/api/private/settings']
        p.click('#visible-label')
        p.wait_for_timeout(300)
        self.assertEqual([c for c in self.commands if c.get('path')=='/api/private/settings'],wrote,
                         'and tapping the label must not change anything')
        # 設定側は従来どおり切り替えられる。
        p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.evaluate("__tm.shell.button('settings').click()")
        expect(p.locator('#settings-dialog #map-visible')).to_be_visible()

    def test_trips_are_managed_in_one_panel(self):
        """旅の入口は作る・期間でまとめる・一覧の3つに散っていた。ひとつの「旅」に集約する。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.evaluate("__tm.shell.open('profile')")
        expect(p.locator('#trip-panel')).to_be_attached()
        inside=p.evaluate("""()=>{
          const panel=document.querySelector('#trip-panel');
          const has=id=>!!panel.querySelector('#'+id);
          return {form:has('trip-form'),assign:has('assign-form'),cards:has('trip-cards'),
                  category:has('category-form'),
                  summary:panel.querySelector('summary').textContent.trim()};
        }""")
        self.assertTrue(inside['form'],'旅を作る')
        self.assertTrue(inside['assign'],'期間でまとめる')
        self.assertTrue(inside['cards'],'旅の一覧')
        self.assertFalse(inside['category'],'分類は旅ではないので同居させない')
        self.assertEqual(inside['summary'],'旅')
        # 分類は別の入れ物に残る。
        self.assertTrue(p.evaluate("!!document.querySelector('#category-form')"),'分類の追加は残す')
        self.assertFalse(p.evaluate("!!document.querySelector('#trip-panel #category-form')"))

    def test_the_two_period_controls_say_what_they_filter(self):
        """地図の期間と収支の月は別物で、連動しない。同じ「期間」に見えるのが混乱の元だった。
        統合はできない(片方は相対期間、片方は暦月)ので、何に効くかを名乗らせる。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.assertEqual(p.get_attribute('.period-chip','aria-label'),'表示する期間',
                         'the map chip filters what the map shows')
        p.evaluate("__tm.shell.open('profile')")
        labels=p.evaluate("""()=>({
          month:document.querySelector('label:has(>#month)')?.textContent.replace(/\s+/g,''),
          trip:document.querySelector('label:has(>#trip-filter)')?.textContent.split('すべて')[0].replace(/\s+/g,'')
        })""")
        self.assertIn('集計する月',labels['month'],'the money month must name its subject')
        self.assertIn('記録と収支',labels['trip'],'the trip filter must name both subjects')
        # 月を変えても地図の期間は動かない。連動していないことを固定しておく。
        before=p.evaluate("__tm.viewerState.state().period.preset")
        p.evaluate("document.querySelector('#money-panel').open=true")
        p.fill('#month','2026-01')
        p.wait_for_timeout(400)
        self.assertEqual(p.evaluate("__tm.viewerState.state().period.preset"),before,
                         'the money month must not silently move the map period')

    def test_adjusting_a_position_takes_the_whole_map_and_gives_it_back(self):
        """パネルの下にピンが入る余地をなくす。終われば元の編集画面へ自分で戻る。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        self.assertFalse(p.evaluate("!!document.querySelector('.map-stage.map-only')"))
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        during=p.evaluate("""({
          mapOnly:!!document.querySelector('.map-stage.map-only'),
          paneOpen:!!document.querySelector('.map-stage.pane-open'),
          rail:getComputedStyle(document.querySelector('.map-rail')).visibility
        })""")
        self.assertTrue(during['mapOnly'],'the map must take the screen')
        self.assertFalse(during['paneOpen'],'the panel steps aside rather than staying over the pin')
        self.assertEqual(during['rail'],'hidden','and the navigation with it')
        # 手で開き直さなくても編集へ帰る。
        p.get_by_role('button',name='やめる').click()
        expect(self.record().get_by_role('button',name='保存する')).to_be_visible()
        after=p.evaluate("""({
          mapOnly:!!document.querySelector('.map-stage.map-only'),
          paneOpen:!!document.querySelector('.map-stage.pane-open')
        })""")
        self.assertFalse(after['mapOnly'],'the map gives the screen back')
        self.assertTrue(after['paneOpen'],'and the edit panel returns on its own')

    def test_closing_a_view_goes_all_the_way_back_to_the_map(self):
        """見出しの「‹ 戻る」だけが一段戻る。閉じるは地図まで戻す。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.evaluate("__tm.shell.open('profile')")
        expect(p.locator('.drawer-back')).to_be_hidden()
        p.evaluate("""()=>{
          const node=document.createElement('p');node.textContent='ふかい画面';
          __tm.shell.view('probe',node,'ふかい画面',{back:()=>__tm.shell.open('profile')});
        }""")
        expect(p.locator('.drawer-back')).to_be_visible()
        p.get_by_role('button',name='前の画面へ戻る').click()
        expect(p.locator('#view-profile')).to_be_visible()
        expect(p.locator('.drawer-back')).to_be_hidden()
        p.get_by_role('button',name='パネルを閉じる').click()
        self.assertFalse(p.evaluate("!!document.querySelector('.map-stage.pane-open')"),
                         'closing returns to the map, it does not step back one level')

    def test_another_persons_record_shows_who_wrote_it_and_leads_to_them(self):
        """他人の記録は日時・場所・メモだけだった。誰の記録かも、そこから人物へ行く道も無かった。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        p.evaluate("""()=>{
          const e=__tm.viewerState.state().entries.find(x=>x.author!=='test');
          window.__entry=e;__tm.everyone.detail(e);
        }""")
        expect(p.locator('.record-detail')).to_be_visible()
        shown=p.evaluate("""()=>{
          const d=document.querySelector('.record-detail');
          return {author:d.querySelector('.detail-author-name')?.textContent,
                  category:d.querySelector('.eyebrow')?.textContent,
                  play:!!d.querySelector('.detail-play'),
                  authorClickable:!d.querySelector('.detail-author').disabled};
        }""")
        self.assertEqual(shown['author'],p.evaluate("window.__entry.author_name"),'the author must be named')
        self.assertEqual(shown['category'],p.evaluate("window.__entry.category_name"))
        self.assertTrue(shown['authorClickable'],'and lead to that person')
        self.assertTrue(shown['play'],'with a way to play their records')

    def test_a_pin_and_the_list_reach_the_same_record_screen(self):
        """自分の記録の編集はプロフィールの4階層目にあり、地図のピンから直接行けなかった。
        どちらの入口からも、同じ1件だけの画面に着く。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("document.querySelectorAll('#activities > details').length>0")
        # 一覧から
        p.evaluate("__tm.shell.open('profile')")
        self.record().locator('summary').first.click()
        self.record().get_by_role('button',name='記録を開く').click()
        expect(p.locator('.record-detail.own')).to_be_visible()
        from_list=p.evaluate("document.querySelector('.record-detail.own h2').textContent")
        self.assertTrue(p.evaluate("!!document.querySelector('.drawer-back')&&!document.querySelector('.drawer-back').hidden"),
                        'and it can step back to where it came from')
        # 地図のピンから。ピンは route に登録した開き方を呼ぶので、そこを叩く。
        p.get_by_role('button',name='パネルを閉じる').click()
        expect(p.locator('.record-detail.own')).to_be_hidden()
        # track() が地図へ渡す点には、その記録を開く関数が入っている。ピンが押されたときに呼ばれるもの。
        opened=p.evaluate("""()=>{
          const point=__tm.route.track().points.find(pt=>pt.kind==='record'&&pt.openDetail);
          if(!point)return false;
          point.openDetail();return true;
        }""")
        self.assertTrue(opened,'a record pin must carry a way to open that record')
        expect(p.locator('.record-detail.own')).to_be_visible()
        self.assertEqual(p.evaluate("document.querySelector('.record-detail.own h2').textContent"),from_list,
                         'the pin must land on the same screen as the list')
        shown=p.evaluate("""()=>{
          const d=document.querySelector('.record-detail.own');
          return {badge:d.querySelector('.badge')?.textContent,
                  edit:!!d.querySelector('.detail-edit'),
                  facts:[...d.querySelectorAll('.detail-fact .label')].map(n=>n.textContent)};
        }""")
        self.assertTrue(shown['edit'],'the record screen carries its own edit')
        self.assertIn('緯度・経度',shown['facts'],'and states where it is')
        self.assertTrue(shown['badge'],'and whether it is published')

    def test_adjusting_a_position_does_not_throw_away_the_open_record(self):
        """位置の調整はパネルを閉じるのではなく退けるだけ。戻り先を覚えているので、
        やめれば同じ記録の編集に帰る。閉じるボタンなら地図まで戻る。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        self.open_own_edit()
        title=p.evaluate("document.querySelector('.drawer-heading h1').textContent")
        self.record().get_by_role('button',name='地図で位置を調整').click()
        expect(p.locator('.edit-pin')).to_have_count(1)
        self.assertFalse(p.evaluate("!!document.querySelector('.map-stage.pane-open')"),
                         'the panel steps aside')
        p.get_by_role('button',name='やめる').click()
        expect(p.locator('.map-stage.pane-open')).to_be_attached()
        self.assertEqual(p.evaluate("document.querySelector('.drawer-heading h1').textContent"),title,
                         'and comes back to the same place, not to a different screen')

    def test_nothing_in_a_record_screen_sits_on_top_of_anything_else(self):
        """新しい画面のCSSを書き忘れ、再生ボタンが日時に重なっていた。
        中身が縦に積まれ、どれも他と重ならないことを見る。"""
        p=self.page;p.goto(self.origin+'/')
        expect(p.locator('.stories-strip')).to_be_visible()
        p.wait_for_function("__tm.everyone.count()>0")
        # 本番で崩れたのは、場所名もメモも無い「移動」の記録。中身が短いほど横に回り込む。
        p.evaluate("""()=>{
          const base=__tm.viewerState.state().entries.find(x=>x.author!=='test');
          __tm.everyone.detail({...base,place_name:null,memo:'',category_name:'移動'});
        }""")
        expect(p.locator('.record-detail')).to_be_visible()
        rows=p.evaluate("""()=>[...document.querySelectorAll('.record-detail > *')]
          .map(n=>({name:(n.className||n.tagName).toString(),r:n.getBoundingClientRect()}))
          .filter(x=>x.r.width&&x.r.height)
          .map(x=>({name:x.name,top:x.r.top,bottom:x.r.bottom,left:x.r.left,right:x.r.right}))""")
        self.assertGreater(len(rows),3,'the screen must actually have content')
        # 積まれているなら、次の要素は前の要素より下から始まる。横に並ぶと崩れとして現れる。
        for before,after in zip(rows,rows[1:]):
            self.assertGreaterEqual(after['top'],before['bottom'],
                                    f"{after['name']} must sit below {before['name']}, not beside it")
        # 押せるものは実際に指が届く位置にある。
        for name in ('この人の記録を再生',):
            button=p.get_by_role('button',name=name)
            button.scroll_into_view_if_needed()
            box=button.bounding_box()
            reachable=p.evaluate("""(b)=>{
              const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
              return !!hit&&!!hit.closest('button')&&hit.closest('button').textContent.trim()===b.name;
            }""",{**box,'name':name})
            if not reachable:
                cover=p.evaluate("(b)=>{const e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return e?(e.className||e.tagName)+'|'+e.textContent.trim().slice(0,30):'none';}",box)
                self.fail(f'{name} must be reachable, but {cover} is on top')

if __name__=='__main__':unittest.main(verbosity=2)
