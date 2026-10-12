const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(now='2026-10-10T12:15:00Z') {
  let Card, Editor, timers=0;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return +new Date(now);}}
  const context={Date:Clock,HTMLElement:class{attachShadow(){this.shadowRoot={appendChild(){}};}},
    document:{createElement:()=>({innerHTML:''}),addEventListener(){},removeEventListener(){},hidden:false},
    customElements:{get(){},define(n,c){if(n==='elpris-mini-card') Card=c; if(n==='elpris-mini-card-editor') Editor=c;}},window:{},console:{info(){}},
    setInterval(){timers++;return timers;},clearInterval(){timers--;}};
  vm.runInNewContext(fs.readFileSync('elpris-mini-card.js','utf8'),context);
  const card=new Card(); card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:6});
  return {card,Editor,timers:()=>timers};
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
  assert.ok(css.includes('ha-card{min-height:'));
  const cardCss=css.slice(css.indexOf('ha-card{'),css.indexOf('}',css.indexOf('ha-card{'))+1);
  assert.ok(!cardCss.includes('background:'));
  assert.ok(!cardCss.includes('background-color:'));
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
  assert.ok(card._root.innerHTML.includes('11/10</text>'));
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

test('chooses the cheapest fully covered contiguous appliance duration',()=>{
  process.env.TZ='UTC';
  const {card}=setup('2026-10-10T12:15:00Z');
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:2,hours_forward:6,
    appliances:[{name:'Opvaskemaskine',icon:'mdi:dishwasher',duration:120,color:'#008877'}]});
  card.hass=state([
    {start:'2026-10-10T12:00:00Z',value:4},
    {start:'2026-10-10T13:00:00Z',value:3},
    {start:'2026-10-10T14:00:00Z',value:1},
    {start:'2026-10-10T15:00:00Z',value:1},
    {start:'2026-10-10T16:00:00Z',value:4},
    {start:'2026-10-10T17:00:00Z',value:5}
  ]);
  assert.ok(card._root.innerHTML.includes('Opvaskemaskine'));
  assert.ok(card._root.innerHTML.includes('mdi:dishwasher'));
  assert.ok(card._root.innerHTML.includes('14:00–16:00'));
  assert.ok(card._root.innerHTML.includes('#008877'));
  assert.ok(card.getGridOptions().rows>2);
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_forward:6,show_legend:false,
    appliances:[{name:'Opvaskemaskine',duration:120,color:'#008877'}]});
  assert.ok(!card._root.innerHTML.includes('class="ep-legend"'));
  assert.equal(card.getGridOptions().rows,2);
});
test('does not invent a cheap period across a price gap',()=>{
  const {card}=setup();
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_forward:6,
    appliances:[{name:'Tørretumbler',duration:120,color:'#00ff00'}]});
  card.hass=state([
    {start:'2026-10-10T12:00:00Z',end:'2026-10-10T13:00:00Z',value:1},
    {start:'2026-10-10T15:00:00Z',end:'2026-10-10T16:00:00Z',value:1}
  ]);
  assert.ok(card._root.innerHTML.includes('Ingen sammenhængende periode'));
});
test('renders two independently colored EV schedules and updates on schedule change',()=>{
  process.env.TZ='UTC';
  const {card}=setup();
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_forward:6,
    ev_schedules:[
      {name:'Citroën',entity:'sensor.ev_a',icon:'mdi:car-electric',color:'#0066ff'},
      {name:'MG',entity:'sensor.ev_b',icon:'mdi:car-electric-outline',color:'#ff6600'}
    ]});
  const prices=[{start:'2026-10-10T12:00:00Z',value:2},{start:'2026-10-10T13:00:00Z',value:3}];
  const states=chargingA=>({states:{
    ...state(prices).states,
    'sensor.ev_a':{attributes:{charging_schedule:chargingA}},
    'sensor.ev_b':{attributes:{charging_schedule:[
      {start:'2026-10-10T13:00:00Z',value:0},
      {start:'2026-10-10T14:00:00Z',value:1},
      {start:'2026-10-10T15:00:00Z',value:0}
    ]}}
  }});
  card.hass=states([{start:'2026-10-10T12:00:00Z',value:1},{start:'2026-10-10T14:00:00Z',value:0}]);
  assert.ok(card._root.innerHTML.includes('Citroën'));
  assert.ok(card._root.innerHTML.includes('MG'));
  assert.ok(card._root.innerHTML.includes('#0066ff'));
  assert.ok(card._root.innerHTML.includes('#ff6600'));
  assert.ok(card._root.innerHTML.includes('14:00–15:00'));
  card.hass=states([{start:'2026-10-10T12:00:00Z',value:0},{start:'2026-10-10T14:00:00Z',value:0}]);
  assert.ok(card._root.innerHTML.includes('Ingen ladeplan'));
});

test('visual editor can add appliances and update per-device configuration without external JS',()=>{
  const {Editor}=setup();
  assert.equal(typeof Editor,'function');
  const editor=Object.create(Editor.prototype);
  editor._config={entity:'sensor.price',appliances:[],ev_schedules:[]};
  editor._save=function(c){this._config=c;};
  editor._click({target:{closest:()=>({dataset:{add:'appliance'}})}});
  assert.equal(editor._config.appliances.length,1);
  editor._changed({target:{dataset:{kind:'appliance',index:'0',key:'duration'},value:'180'}});
  assert.equal(editor._config.appliances[0].duration,180);
  editor._click({target:{closest:()=>({dataset:{add:'ev'}})}});
  assert.equal(editor._config.ev_schedules[0].attribute,'charging_schedule');
  editor._changed({target:{dataset:{kind:'ev',index:'0',key:'entity'},value:'sensor.ev_b'}});
  assert.equal(editor._config.ev_schedules[0].entity,'sensor.ev_b');
  editor._changed({target:{dataset:{key:'show_legend'},type:'checkbox',checked:false}});
  assert.equal(editor._config.show_legend,false);
  editor._click({target:{closest:()=>({dataset:{remove:'appliance',index:'0'}})}});
  assert.equal(editor._config.appliances.length,0);
});

test('legend placement defaults to bottom and accepts top and inline modes',()=>{
  process.env.TZ='UTC';
  const {card}=setup('2026-10-10T12:15:00Z');
  const prices=[
    {start:'2026-10-10T12:00:00Z',value:4},
    {start:'2026-10-10T13:00:00Z',value:3},
    {start:'2026-10-10T14:00:00Z',value:1},
    {start:'2026-10-10T15:00:00Z',value:1},
    {start:'2026-10-10T16:00:00Z',value:4},
    {start:'2026-10-10T17:00:00Z',value:5}
  ];
  const config={entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:6,
    appliances:[{name:'Opvaskemaskine',icon:'mdi:dishwasher',color:'#008577',duration:120}]};
  card.setConfig(config);
  card.hass=state(prices);
  assert.equal(card._config.legend_position,'bottom');
  assert.ok(card._root.innerHTML.includes('class="ep-legend"'));
  assert.ok(card._root.innerHTML.includes('Opvaskemaskine</span>'));
  const bottomHeight=card._totalHeight;
  card.setConfig({...config,legend_position:'top'});
  assert.ok(card._root.innerHTML.includes('class="ep-top"'));
  assert.ok(card._root.innerHTML.includes('class="ep-top-item"'));
  assert.ok(card._root.innerHTML.includes('14–16'));
  assert.ok(card._root.innerHTML.includes('style="--ep-color:#008577"'));
  assert.ok(!card._root.innerHTML.includes('class="ep-legend"'));
  assert.ok(!card._root.innerHTML.includes('class="ep-tag"'));
  assert.ok(card._totalHeight<bottomHeight);
  card.setConfig({...config,legend_position:'inline'});
  assert.ok(card._root.innerHTML.includes('class="ep-tag"'));
  assert.ok(card._root.innerHTML.includes('14–16'));
  assert.ok(card._root.innerHTML.includes('mdi:dishwasher'));
  assert.ok(!card._root.innerHTML.includes('class="ep-top"'));
  assert.ok(!card._root.innerHTML.includes('class="ep-legend"'));
  assert.equal(card._totalHeight,132);
  assert.ok(card._root.innerHTML.includes('height="132"') || card._root.innerHTML.includes('viewBox="0 0 480 132"'));
  // The annotation is in its own 22px strip ABOVE the plotting area (top=54).
  const markerStyle=card._root.innerHTML.match(/class="ep-tag"[^>]*style="[^"]*top:([\d.]+)px/);
  assert.ok(markerStyle);
  assert.ok(Number(markerStyle[1])<54 && Number(markerStyle[1])+16<=54);
  card.setConfig({...config,legend_position:'header'});
  assert.equal(card._totalHeight,110);
  assert.ok(card._root.innerHTML.includes('class="ep-header-legend"'));
  assert.ok(card._root.innerHTML.includes('class="ep-top-items"'));
  assert.ok(!card._root.innerHTML.includes('class="ep-tag"'));
  assert.ok(!card._root.innerHTML.includes('class="ep-legend"'));
  card.setConfig({...config,legend_position:'invalid'});
  assert.equal(card._config.legend_position,'bottom');
  card.setConfig({...config,legend_position:'inline',show_legend:false});
  assert.ok(!card._root.innerHTML.includes('class="ep-tag"'));
});
test('top legend gives EVs color-coded icons and abbreviates next-day intervals',()=>{
  process.env.TZ='UTC';
  const {card}=setup('2026-10-10T12:15:00Z');
  card.setConfig({entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:36,legend_position:'top',
    ev_schedules:[{name:'Citroën',entity:'sensor.car',color:'#3366cc',icon:'mdi:car-electric'}]});
  card.hass={states:{
    ...state([{start:'2026-10-10T12:00:00Z',value:3},{start:'2026-10-10T13:00:00Z',value:3},{start:'2026-10-10T14:00:00Z',value:3}]).states,
    'sensor.car':{attributes:{charging_schedule:[
      {start:'2026-10-11T04:00:00Z',value:1},
      {start:'2026-10-11T08:00:00Z',value:0}
    ]}}
  }};
  const html=card._root.innerHTML;
  assert.ok(html.includes('mdi:car-electric'));
  assert.ok(html.includes('style="--ep-color:#3366cc"'));
  assert.ok(html.includes('11/04–08'));
  assert.ok(html.includes('title="Citroën:'));
});
test('visual editor offers four legend positions',()=>{
  const {Editor}=setup();
  const editor=Object.create(Editor.prototype);
  editor._config={entity:'sensor.price',legend_position:'top',appliances:[],ev_schedules:[]};
  let html='';
  editor.shadowRoot={set innerHTML(v){html=v;},get innerHTML(){return html;}};
  editor._render();
  assert.ok(html.includes('data-key="legend_position"'));
  assert.ok(html.includes('value="top" selected'));
  assert.ok(html.includes('value="inline"'));
  assert.ok(html.includes('value="header"'));
  editor._save=function(c){this._config=c;this._render();};
  editor._changed({target:{dataset:{key:'legend_position'},type:'select-one',value:'inline'}});
  assert.equal(editor._config.legend_position,'inline');
});

test('separate top and header legends are right aligned and their height is bounded',()=>{
  process.env.TZ='UTC';
  const {card}=setup('2026-10-10T12:15:00Z');
  const config={entity:'sensor.price',legend_position:'top',mode:'rolling',hours_forward:6,
    appliances:[{name:'Vaskemaskine',icon:'mdi:washing-machine',duration:60,color:'#2266bb'}]};
  card.setConfig(config);
  card.hass=state([{start:'2026-10-10T12:00:00Z',value:4},{start:'2026-10-10T13:00:00Z',value:1},{start:'2026-10-10T14:00:00Z',value:4}]);
  assert.ok(card._style.textContent.includes('justify-content:flex-end'));
  assert.ok(card._root.innerHTML.includes('class="ep-top"'));
  assert.equal(card._totalHeight,139);
  card.setConfig({...config,legend_position:'header'});
  assert.ok(card._root.innerHTML.includes('class="ep-header-legend"'));
  assert.ok(card._root.innerHTML.includes('style="left:'));
  assert.equal(card._totalHeight,110);
  card._width=240; card._render();
  assert.ok(card._root.innerHTML.includes('class="ep-header-legend"'));
});

test('dishwasher can show time until cheapest start without changing other appliance intervals',()=>{
  process.env.TZ='UTC';
  const prices=[
    {start:'2026-10-10T12:00:00Z',value:4},
    {start:'2026-10-10T13:00:00Z',value:3},
    {start:'2026-10-10T14:00:00Z',value:1},
    {start:'2026-10-10T15:00:00Z',value:1},
    {start:'2026-10-10T16:00:00Z',value:4},
    {start:'2026-10-10T17:00:00Z',value:5}
  ];
  const configs={
    entity:'sensor.price',mode:'rolling',hours_back:1,hours_forward:6,legend_position:'bottom',
    appliances:[
      {name:'Opvaskemaskine',duration:120,icon:'mdi:dishwasher',color:'#008577',time_display:'countdown'},
      {name:'Tørretumbler',duration:120,icon:'mdi:tumble-dryer',color:'#d07a27',time_display:'interval'}
    ]
  };
  const {card}=setup('2026-10-10T12:15:00Z');
  card.setConfig(configs);card.hass=state(prices);
  assert.ok(card._root.innerHTML.includes('Om 1 t 45 min'));
  assert.ok(card._root.innerHTML.includes('14:00–16:00'));
  assert.ok(card._root.innerHTML.includes('title="Opvaskemaskine: Om 1 t 45 min (14:00–16:00)"'));
  card.setConfig({...configs,legend_position:'header'});
  assert.ok(card._root.innerHTML.includes('om 1t45m'));
  assert.ok(card._root.innerHTML.includes('14–16'));
  card.setConfig({...configs,legend_position:'inline'});
  assert.ok(card._root.innerHTML.includes('om 1t45m'));
  assert.ok(card._root.innerHTML.includes('class="ep-tag"'));
  const {card:later}=setup('2026-10-10T12:16:00Z');
  later.setConfig(configs);later.hass=state(prices);
  assert.ok(later._root.innerHTML.includes('Om 1 t 44 min'));
  const {card:now}=setup('2026-10-10T14:00:00Z');
  now.setConfig(configs);now.hass=state(prices);
  assert.ok(now._root.innerHTML.includes('Start nu'));
});
test('EV schedules support an independent countdown, including currently scheduled charging',()=>{
  process.env.TZ='UTC';
  const {card}=setup('2026-10-10T12:15:00Z');
  const config={entity:'sensor.price',mode:'rolling',hours_forward:6,legend_position:'top',
    ev_schedules:[
      {name:'Citroën',entity:'sensor.ev_a',icon:'mdi:car-electric',color:'#3366cc',time_display:'countdown'},
      {name:'MG',entity:'sensor.ev_b',icon:'mdi:car-electric',color:'#aa5533'}
    ]};
  const hass={states:{
    ...state([{start:'2026-10-10T12:00:00Z',value:3},{start:'2026-10-10T13:00:00Z',value:3},{start:'2026-10-10T14:00:00Z',value:3}]).states,
    'sensor.ev_a':{attributes:{charging_schedule:[
      {start:'2026-10-10T14:00:00Z',value:1},
      {start:'2026-10-10T16:00:00Z',value:0}
    ]}},
    'sensor.ev_b':{attributes:{charging_schedule:[
      {start:'2026-10-10T13:00:00Z',value:1},
      {start:'2026-10-10T15:00:00Z',value:0}
    ]}}
  }};
  card.setConfig(config);card.hass=hass;
  assert.ok(card._root.innerHTML.includes('om 1t45m'));
  assert.ok(card._root.innerHTML.includes('13–15'));
  assert.ok(card._root.innerHTML.includes('Citroën: Om 1 t 45 min'));
  const {card:active}=setup('2026-10-10T14:15:00Z');
  active.setConfig(config);active.hass=hass;
  assert.ok(active._root.innerHTML.includes('Planlagt nu'));
});
test('editor stores per-device countdown or interval selection',()=>{
  const {Editor}=setup();
  const editor=Object.create(Editor.prototype);
  editor._config={entity:'sensor.price',appliances:[{name:'Opvaskemaskine',duration:120}],
    ev_schedules:[{name:'MG',entity:'sensor.ev_b'}]};
  let markup='';
  editor.shadowRoot={set innerHTML(s){markup=s;},get innerHTML(){return markup;}};
  editor._save=function(c){this._config=c;this._render();};
  editor._render();
  assert.ok(markup.includes('data-kind="appliance" data-index="0" data-key="time_display"'));
  assert.ok(markup.includes('data-kind="ev" data-index="0" data-key="time_display"'));
  assert.ok(markup.includes('value="interval" selected'));
  editor._changed({target:{dataset:{kind:'appliance',index:'0',key:'time_display'},
    type:'select-one',value:'countdown'}});
  assert.equal(editor._config.appliances[0].time_display,'countdown');
  assert.ok(markup.includes('value="countdown" selected'));
  assert.equal(editor._config.ev_schedules[0].time_display,undefined);
  editor._changed({target:{dataset:{kind:'ev',index:'0',key:'time_display'},
    type:'select-one',value:'interval'}});
  assert.equal(editor._config.ev_schedules[0].time_display,'interval');
});
