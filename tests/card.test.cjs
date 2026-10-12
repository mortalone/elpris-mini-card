const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(now='2026-10-10T12:15:00Z') {
  let Card, timers=0;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return +new Date(now);}}
  const context={Date:Clock,HTMLElement:class{attachShadow(){this.shadowRoot={appendChild(){}};}},
    document:{createElement:()=>({innerHTML:''}),addEventListener(){},removeEventListener(){},hidden:false},
    customElements:{get(){},define(n,c){Card=c;}},window:{},console:{info(){}},
    setInterval(){timers++;return timers;},clearInterval(){timers--;}};
  vm.runInNewContext(fs.readFileSync('elpris-mini-card.js','utf8'),context);
  const card=new Card(); card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:6});
  return {card,timers:()=>timers};
}
const state=raw=>({states:{'sensor.price':{attributes:{raw_two_days:raw,unit_of_measurement:'kr/kWh'}}}});
test('sorts raw data, handles duplicate starts, negative prices and missing values',()=>{
  const {card}=setup(); card.hass=state([
    {start:'2026-10-10T13:00:00Z',value:3},{start:'2026-10-10T12:00:00Z',value:1},
    {start:'2026-10-10T12:00:00Z',value:-0.5},{start:'invalid',value:2},
    {start:'2026-10-10T14:00:00Z',value:null}]);
  assert.equal(card._data.length,2); assert.equal(card._data[0].value,-0.5);
  assert.match(card._root.innerHTML,/-0,50/); assert.doesNotMatch(card._root.innerHTML,/NaN|Infinity/);
});
test('no redraw for unrelated entity updates or unchanged price attributes',()=>{
  const {card}=setup(); const data=[{start:'2026-10-10T12:00:00Z',value:1.5}];
  card.hass=state(data); let renders=0; card._render=()=>renders++;
  card.hass=state(data); assert.equal(renders,0);
  card.hass=state([{...data[0],value:2}]); assert.equal(renders,1);
});
test('does not carry stale current price across a missing data interval',()=>{
  const {card}=setup(); card.hass=state([{start:'2026-10-10T11:00:00Z',end:'2026-10-10T11:30:00Z',value:2},
    {start:'2026-10-10T13:00:00Z',value:4}]);
  assert.match(card._root.innerHTML,/Aktuel pris mangler/);
  assert.equal((card._root.innerHTML.match(/<path /g)||[]).length,2);
});
test('timer cleans up on detach; escaped unit cannot create SVG nodes',()=>{
  const {card,timers}=setup(); card.setConfig({entity:'sensor.price',unit:'<script>alert(1)</script>'});
  card.hass=state([{start:'2026-10-10T12:00:00Z',value:2}]);
  assert.doesNotMatch(card._root.innerHTML,/<script>/); card.connectedCallback();
  assert.equal(timers(),1); card.disconnectedCallback(); assert.equal(timers(),0);
});
test('local day spans respect daylight saving transitions',()=>{
  process.env.TZ='Europe/Copenhagen';
  for(const now of ['2026-03-29T12:00:00Z','2026-10-25T12:00:00Z']) {
    const {card}=setup(now); card.setConfig({entity:'sensor.price',mode:'day'});
    card.hass=state([{start:now,value:2}]);
    assert.match(card._root.innerHTML,/<svg/); assert.doesNotMatch(card._root.innerHTML,/NaN/);
  }
});

test('native ha-card owns the background and CSS survives graph updates',()=>{
  const {card}=setup();
  const css=card._style.textContent;
  assert.ok(css.includes('ha-card{height:'));
  assert.ok(!css.includes('background:'));
  assert.ok(!css.includes('background-color:'));
  assert.ok(!css.includes('rgba(250,246,235'));
  card.hass=state([{start:'2026-10-10T12:00:00Z',value:2}]);
  card._render();
  assert.equal(card._style.textContent,css);
  assert.ok(!card._root.innerHTML.includes('Theme variables (host)'));
});

test('automatic forward window includes tomorrow and tracks sensor updates',()=>{
  const {card}=setup('2026-10-10T12:15:00Z');
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:2,hours_forward:'auto'});
  const now=Date.parse('2026-10-10T12:15:00Z');
  const prices=[
    {start:'2026-10-10T10:00:00Z',end:'2026-10-10T11:00:00Z',value:2.1},
    {start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z',value:3.2},
    {start:'2026-10-11T22:00:00Z',end:'2026-10-11T23:00:00Z',value:0.9}
  ];
  card.hass=state(prices);
  assert.equal(card._getTimeWindow(now).start,now-2*3600000);
  assert.equal(card._getTimeWindow(now).end,Date.parse('2026-10-11T23:00:00Z'));
  assert.match(card._root.innerHTML,/<svg/);
  card.hass=state([...prices,{start:'2026-10-11T23:00:00Z',end:'2026-10-12T00:00:00Z',value:1.1}]);
  assert.equal(card._getTimeWindow(now).end,Date.parse('2026-10-12T00:00:00Z'));
});
test('fixed rolling horizon and calendar day behavior remain available',()=>{
  const {card}=setup();
  const now=Date.parse('2026-10-10T12:15:00Z');
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:3,hours_forward:6});
  assert.equal(card._getTimeWindow(now).start,now-3*3600000);
  assert.equal(card._getTimeWindow(now).end,now+6*3600000);
  card.setConfig({entity:'sensor.price',mode:'day'});
  const day=card._getTimeWindow(now);
  assert.equal(day.end-day.start,24*3600000);
});
test('auto mode does not extend horizon from stale prices',()=>{
  const {card}=setup();
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:'auto'});
  card.hass=state([{start:'2026-10-09T12:00:00Z',end:'2026-10-09T13:00:00Z',value:5}]);
  const now=Date.parse('2026-10-10T12:15:00Z');
  assert.equal(card._getTimeWindow(now).end,now+3600000);
  assert.match(card._root.innerHTML,/Ingen prisdata/);
});
