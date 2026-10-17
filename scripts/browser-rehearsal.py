# Optional macOS browser rehearsal. Use only an isolated, empty in-memory demo on port 4181.
# No third-party Python packages; Chrome DevTools protocol over a local socket.
import subprocess,tempfile,time,json,urllib.request,socket,struct,os,base64,signal
profile=tempfile.mkdtemp(prefix='relay-browser-')
log=open('/tmp/relay-browser-chrome.log','w')
p=subprocess.Popen([os.environ.get('RELAY_BROWSER_PATH','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),'--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port=0','--window-size=1440,1000','http://127.0.0.1:4181/demo'],stdout=log,stderr=log,start_new_session=True)
try:
 for _ in range(100):
  if os.path.exists(profile+'/DevToolsActivePort'):break
  time.sleep(.1)
 port=open(profile+'/DevToolsActivePort').read().splitlines()[0]
 tabs=json.load(urllib.request.urlopen('http://127.0.0.1:'+port+'/json'))
 url=next(t['webSocketDebuggerUrl'] for t in tabs if t['type']=='page')
 from urllib.parse import urlsplit
 u=urlsplit(url);s=socket.create_connection((u.hostname,u.port),timeout=10)
 key=base64.b64encode(os.urandom(16)).decode();s.sendall(f'GET {u.path} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
 head=b''
 while b'\r\n\r\n' not in head:head+=s.recv(1)
 assert b'101' in head,head
 def exact(n):
  data=b''
  while len(data)<n:data+=s.recv(n-len(data))
  return data
 def send(data):
  b=json.dumps(data).encode();mask=os.urandom(4);n=len(b);header=bytes([129,128|n]) if n<126 else bytes([129,254])+struct.pack('!H',n) if n<65536 else bytes([129,255])+struct.pack('!Q',n)
  s.sendall(header+mask+bytes(v^mask[i%4] for i,v in enumerate(b)))
 def recv():
  h=exact(2);n=h[1]&127
  if n==126:n=struct.unpack('!H',exact(2))[0]
  if n==127:n=struct.unpack('!Q',exact(8))[0]
  mask=exact(4) if h[1]&128 else None
  b=exact(n)
  if mask:b=bytes(v^mask[i%4] for i,v in enumerate(b))
  return json.loads(b)
 seq=0
 def call(method,params={}):
  global seq
  seq+=1;send({'id':seq,'method':method,'params':params})
  while True:
   r=recv()
   if r.get('id')==seq:
    if r.get('error'):raise Exception(r['error'])
    return r['result']
 def js(code):
  r=call('Runtime.evaluate',{'expression':code,'returnByValue':True,'awaitPromise':True})
  if r.get('exceptionDetails'):raise Exception(r['exceptionDetails'])
  return r.get('result',{}).get('value')
 def wait(expr,timeout=12):
  end=time.time()+timeout
  while time.time()<end:
   if js(expr):return
   time.sleep(.15)
  raise Exception('Timed out: '+expr+'\n'+str(js('document.body.innerText.slice(-2500)')))
 def click(text,selector='button'):
  js(f"(()=>{{const e=[...document.querySelectorAll({json.dumps(selector)})].find(e=>e.textContent.trim()==={json.dumps(text)});if(!e)throw Error('Missing button');e.click();}})()")
 def screenshot(path):
  data=call('Page.captureScreenshot',{'format':'png'})['data'];open(path,'wb').write(base64.b64decode(data))

 def identity(value,team):
  js(f"(()=>{{const e=document.querySelector('[aria-label=\"Team identity\"]');e.value={json.dumps(value)};e.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")
  wait(f"document.querySelector('.section-heading h2')?.textContent==='Your {team} agent' && document.querySelector('.section-heading p')?.textContent.includes('authorized sources') && !document.querySelector('.suggestions button').disabled")
 def ack():js("document.querySelector('.review-card .check input').click()")
 wait("document.querySelector('.section-heading p')?.textContent.includes('3 authorized sources')")
 click('Enterprise rate limits ↗')
 wait("document.querySelector('.status')?.textContent.includes('Verified citations')")
 assert js("['5,000','per API key','2x for 10 seconds','429','Retry-After'].every(s=>document.querySelector('.answer-text').textContent.includes(s))")
 assert js("document.querySelectorAll('.citation-list .citation').length===2")
 js("document.querySelector('.citation-list .citation').click()")
 wait("document.querySelector('.source-detail blockquote')?.textContent.includes('5,000')")
 screenshot('/tmp/relay-handoff-answer.png')
 click('On-prem launch date ↗');wait("!!document.querySelector('.escalation-card')")
 assert js("document.querySelector('.escalation-card').textContent.includes('NOT SENT')")
 js("document.querySelector('.escalation-card input').click()")
 click('Send to Engineering →');wait("document.querySelector('.escalation-card').textContent.includes('SENT TO ENGINEERING')")
 identity('demo-engineer','Engineering');wait("!!document.querySelector('.review-card')")
 assert js("document.querySelector('.review-card textarea').value.includes('[DATE]')")
 click('Use no-commitment wording');click('Save revision')
 wait("!document.querySelector('.approve-button')?.disabled && false || !document.querySelector('.review-card .check input').disabled")
 ack();click('Approve exact text');wait("document.querySelector('.review-state').textContent==='approved'")
 js("document.querySelector('.review-card textarea').focus();document.querySelector('.review-card textarea').select()")
 text='On-prem support is being evaluated. No launch date or availability is committed. Scope remains under review.'
 call('Input.insertText',{'text':text})
 assert js("document.querySelector('.release-button').disabled")
 click('Save revision');wait("document.querySelector('.review-state').textContent==='staged'")
 ack();click('Approve exact text');wait("document.querySelector('.review-state').textContent==='approved'")
 ack();click('Release to Sales →');wait("document.querySelector('.review-state').textContent==='released'")
 assert js("document.querySelector('.artifact p').textContent==="+json.dumps(text))
 screenshot('/tmp/relay-handoff-review.png')
 identity('demo-sales','Sales');click('On-prem launch date ↗')
 wait("document.querySelector('.status')?.textContent.includes('Verified citations')")
 assert js("document.querySelector('.answer-text').textContent==="+json.dumps(text))
 assert js("!document.body.textContent.includes('CANARY-ENG') && !document.body.textContent.includes('CANARY-INFRA')")
 click('Security');click('Run all 8 scenarios →')
 wait("[...document.querySelectorAll('.scenario-run')].filter(e=>e.textContent==='✓ Pass').length===8",timeout=25)
 screenshot('/tmp/relay-handoff-security.png')
 click('Try an extraction ↗');wait("document.querySelector('.status')?.textContent.includes('Request declined')")
 assert js("!document.querySelector('.answer-text').textContent.includes('CANARY-')")
 identity('demo-infra','Infrastructure');click('Review')
 wait("document.querySelector('.access-notice').textContent.includes('no release authority')")
 assert js("!document.body.textContent.includes('ENG-ROADMAP') && !document.body.textContent.includes('SALES-NOTE')")
 identity('demo-sales','Sales');click('Enterprise rate limits ↗')
 wait("document.querySelector('.status')?.textContent.includes('Verified citations')")
 call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
 time.sleep(.4);screenshot('/tmp/relay-handoff-mobile.png')
 assert js("document.documentElement.scrollWidth<=window.innerWidth")
 click('↻ Reset demo');click('Reset demo');wait("!document.querySelector('.modal-shade')")
 assert js("document.querySelectorAll('.artifact').length===0")
 click('On-prem launch date ↗');wait("document.querySelector('.status')?.textContent.includes('Needs escalation')")
 print(json.dumps({'browser':'Chrome headless','rateLimitAnswerAndCitations':True,'explicitEscalation':True,'engineeringReview':True,'editInvalidatesApproval':True,'exactReleaseAndSalesFollowup':True,'eightSecurityScenarios':'8 passed','extractionDeclined':True,'infrastructureReadOnly':True,'mobileOverflow':False,'resetRestoresInitialFlow':True}))
finally:
 os.killpg(p.pid,signal.SIGTERM)
 try:p.wait(timeout=5)
 except:os.killpg(p.pid,signal.SIGKILL)
 log.close()
