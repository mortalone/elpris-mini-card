/* Elpris Mini Card v0.2.5 — MIT — no external dependencies */
(() => {
  'use strict';
  const VERSION = '0.2.5';
  const DEFAULT_COLORS = [
    {value: 1, color: 'cyan'}, {value: 2, color: 'green'},
    {value: 3, color: 'orange'}, {value: 4, color: 'red'},
    {value: 5, color: 'magenta'}, {value: 6, color: 'black'},
  ];
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
  const priceFormat = (v, decimals) => v.toLocaleString('da-DK', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
  function parse(raw, multiplier) {
    if (!Array.isArray(raw)) return [];
    const map = new Map();
    for (const entry of raw) {
      if (!entry || entry.value === null || entry.value === '' || entry.value === undefined) continue;
      const t = new Date(entry.start).getTime(), value = Number(entry.value) * multiplier;
      if (!Number.isFinite(t) || !Number.isFinite(value)) continue;
      const end = entry.end ? new Date(entry.end).getTime() : NaN;
      map.set(t, {t, value, end});
    }
    const data = [...map.values()].sort((a,b) => a.t-b.t);
    const diffs = data.slice(1).map((p,i) => p.t-data[i].t).filter(d => d>0 && d<=3600000).sort((a,b)=>a-b);
    const step = diffs.length ? diffs[Math.floor(diffs.length/2)] : 3600000;
    data.forEach((p,i) => {
      if (!(p.end>p.t)) p.end = Math.min(p.t+step, data[i+1]?.t ?? Infinity);
    });
    return data;
  }
  // Monotone cubic interpolation: smooth without inventing price peaks or dips.
  function curve(points) {
    if (!points.length) return '';
    let path = `M ${points[0].x} ${points[0].y}`;
    if (points.length === 1) return path;
    const slopes = points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x));
    const tangents = points.map((p,i)=> i===0 ? slopes[0] : i===points.length-1 ? slopes[i-1] : slopes[i-1]*slopes[i]<=0 ? 0 : 2/(1/slopes[i-1]+1/slopes[i]));
    for (let i=0;i<slopes.length;i++) {
      const a=points[i], b=points[i+1], dx=(b.x-a.x)/3;
      path += ` C ${a.x+dx} ${a.y+dx*tangents[i]} ${b.x-dx} ${b.y-dx*tangents[i+1]} ${b.x} ${b.y}`;
    }
    return path;
  }

  const MINUTE=60000;
  const toMinutes=(v,def=60)=>Math.max(15,Math.min(720,Math.round(number(v,def,15,720))));
  function closestCheapWindow(prices,now,horizon,durationMinutes) {
    const duration=toMinutes(durationMinutes)*MINUTE;
    const slots=prices.filter(p=>p.end>now && p.t<horizon).sort((a,b)=>a.t-b.t);
    if(!slots.length || horizon-now<duration) return null;
    const candidates=new Set([now]);
    const step=15*MINUTE;
    for(let t=Math.ceil(now/step)*step;t+duration<=horizon;t+=step) candidates.add(t);
    for(const p of slots) if(p.t>=now && p.t+duration<=horizon) candidates.add(p.t);
    let best=null;
    for(const start of candidates) {
      const end=start+duration;
      if(end>horizon) continue;
      let cursor=start,area=0;
      for(const p of slots) {
        if(p.end<=cursor) continue;
        if(p.t>cursor+1000) break; // A missing interval cannot be priced.
        const until=Math.min(end,p.end);
        if(until>cursor) { area+=(until-cursor)*p.value;cursor=until; }
        if(cursor>=end-1000) break;
      }
      if(cursor<end-1000) continue;
      const avg=area/duration;
      if(!best || avg<best.average-0.0000001 || (Math.abs(avg-best.average)<0.0000001 && start<best.start))
        best={start,end,average:avg};
    }
    return best;
  }
  function parseCharging(raw) {
    if(!Array.isArray(raw)) return [];
    const data=raw.map(p=>{
      if(!p || !p.start) return null;
      const t=new Date(p.start).getTime();
      const val=p.value, active=val===true || val==='on' || (val!==null && val!=='' && Number(val)>0);
      return Number.isFinite(t) ? {t,active,end:p.end?new Date(p.end).getTime():NaN} : null;
    }).filter(Boolean).sort((a,b)=>a.t-b.t);
    return data.filter((p,i)=>i===0 || p.t!==data[i-1].t).map((p,i,a)=>({
      t:p.t,end:p.end>p.t?p.end:(a[i+1]?.t ?? p.t+3600000),active:p.active
    })).filter(p=>p.active && p.end>p.t);
  }
  function hhmm(t) { const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function timespan(start,end,now) {
    const date=d=>{const x=new Date(d);return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0');};
    const startDate=date(start),endDate=date(end),today=date(now);
    const first=(startDate===today?'':startDate+' ')+hhmm(start);
    const last=(endDate===startDate?'':endDate+' ')+hhmm(end);
    return first+'–'+last;
  }
  function timeUntilStart(start,now,kind='appliance') {
    if(start<=now) return {full:kind==='ev'?'Planlagt nu':'Start nu',short:'nu'};
    // For manual delayed-start appliances, always round UP to the next half hour.
    // e.g. 6h05 -> 6½ time, 6h35 -> 7 timer. Never understate remaining time.
    const halfHours=Math.ceil((start-now)/(30*MINUTE));
    const hours=Math.floor(halfHours/2),half=halfHours%2===1;
    const amount=half?(hours?hours+'½':'½'):String(hours);
    const suffix=half?'time':hours===1?'time':'timer';
    return {full:'Om '+amount+' '+suffix,short:'om '+amount+' t'};
  }
  function displayedTime(item,start,end,now,kind) {
    const interval=timespan(start,end,now),shortInterval=compactTimespan(start,end,now);
    if(item.time_display==='countdown') {
      const left=timeUntilStart(start,now,kind);
      return {time:left.full,shortTime:left.short,compactTime:left.short.replace(/^om\s+/i,''),tooltip:left.full+' ('+interval+')'};
    }
    return {time:interval,shortTime:shortInterval,compactTime:hoursOnlyTimespan(start,end),tooltip:interval};
  }
  function hoursOnlyTimespan(start,end) {
    // Compact legend omits calendar dates and minutes; full precision stays in tooltip.
    const hour=t=>String(new Date(t).getHours()).padStart(2,'0');
    return hour(start)+'–'+hour(end);
  }
  function compactTimespan(start,end,now) {
    const date=t=>{const d=new Date(t);return String(d.getDate()).padStart(2,'0');};
    const compact=t=>{const d=new Date(t);return d.getMinutes()===0?String(d.getHours()).padStart(2,'0'):hhmm(t);};
    const a=(new Date(start).toDateString()===new Date(now).toDateString()?'':date(start)+'/')+compact(start);
    const b=(new Date(end).toDateString()===new Date(start).toDateString()?'':date(end)+'/')+compact(end);
    return a+'–'+b;
  }
  function inlinePlacements(markers,left,right,labelY,fontSize=10,iconSize=14) {
    const occupied=[];
    const placed=[];
    // The label lane is reserved above the plot. Labels never cover the price line.
    const candidates=[...markers].sort((a,b)=>a.center-b.center);
    for(const marker of candidates) {
      let chosen=null;
      for(const iconOnly of [false,true]) {
        const width=iconOnly?iconSize+6:Math.min(240,iconSize+10+Math.ceil(marker.shortTime.length*fontSize*0.58));
        if(width>right-left) continue;
        const x=Math.max(left,Math.min(right-width,marker.center-width/2));
        if(occupied.some(box=>x<box.right+3 && x+width>box.left-3)) continue;
        chosen={...marker,left:x,top:labelY,width,iconOnly};
        break;
      }
      if(chosen) {occupied.push({left:chosen.left,right:chosen.left+chosen.width});placed.push(chosen);}
    }
    return placed;
  }
  function normalizeItems(items,kind) {
    if(!Array.isArray(items)) return [];
    return items.slice(0,8).map((v,i)=>({
      name:String(v?.name|| (kind==='appliance'?'Apparat ':'Bil ')+(i+1)).slice(0,48),
      icon:String(v?.icon|| (kind==='appliance'?'mdi:clock-outline':'mdi:car-electric')).slice(0,64),
      color:String(v?.color|| (kind==='appliance'?'#4caf50':'#2196f3')).slice(0,32),
      time_display:v?.time_display==='countdown'?'countdown':'interval',
      ...(kind==='appliance'?{duration:toMinutes(v?.duration,120)}:{
        entity:String(v?.entity||'').trim(),attribute:String(v?.attribute||'charging_schedule').trim()
      })
    }));
  }
  class ElprisMiniCard extends HTMLElement {
    constructor() {
      super(); this.attachShadow({mode:'open'}); this._width=480; this._data=[];
      this._style=document.createElement('style'); this.shadowRoot.appendChild(this._style);
      this._root=document.createElement('ha-card'); this.shadowRoot.appendChild(this._root);
      this._id='elpris-'+Math.random().toString(36).slice(2);
    }
    setConfig(config) {
      if (!config?.entity) throw new Error('Elpris Mini Card: entity skal angives.');
      if (config.mode && !['day','rolling'].includes(config.mode)) throw new Error('mode skal være day eller rolling.');
      const c=this._config={
        entity:config.entity, attribute:config.attribute || 'raw_two_days', mode:config.mode || 'day',
        height:number(config.height,110,80,500), hours_back:number(config.hours_back,1,0,48),
        hours_forward:config.hours_forward==='auto' ? 'auto' : number(config.hours_forward,6,1,48),
        cheap_count:Math.floor(number(config.cheap_count,2,0,24)),
        show_now:config.show_now!==false, show_cheap:config.show_cheap!==false,
        show_header:config.show_header!==false, show_yaxis:config.show_yaxis!==false,
        decimals:Math.floor(number(config.decimals,2,0,6)), unit:config.unit,
        value_multiplier:number(config.value_multiplier,1,0.000001,1000000),
        line_width:number(config.line_width,3,1,10), now_color:config.now_color || '#ff80ab',
        cheap_color:config.cheap_color || '#64b5f6', color_threshold:config.color_threshold || DEFAULT_COLORS,
        appliances:normalizeItems(config.appliances,'appliance'),
        ev_schedules:normalizeItems(config.ev_schedules,'ev'),
        show_appliances:config.show_appliances!==false,
        show_charging:config.show_charging!==false,
        show_legend:config.show_legend!==false,
        legend_compact:config.legend_compact===true,
        legend_font_size:number(config.legend_font_size,10,8,24),
        legend_icon_size:number(config.legend_icon_size,14,10,36),
        legend_position:['bottom','top','header','inline'].includes(config.legend_position)?config.legend_position:'bottom'
      };
      if (!Array.isArray(c.color_threshold) || !c.color_threshold.length || c.color_threshold.some(p=>!Number.isFinite(Number(p.value)) || typeof p.color!=='string')) throw new Error('color_threshold kræver value og color.');
      c.color_threshold=c.color_threshold.map(p=>({value:Number(p.value),color:p.color})).sort((a,b)=>a.value-b.value);
      this._signature=null;this._scheduleSignature=null;this._state=null;this._scheduleData=[];
      const layout=this._legendLayout();
      const total=c.height+layout.extra;
      this._totalHeight=total;
      const chartHeight=layout.chartHeight;
      const textPx=c.legend_font_size, iconPx=c.legend_icon_size;
      this._style.textContent=':host{display:block}ha-card{min-height:'+total+'px;box-sizing:border-box;overflow:hidden;padding:0}'+
        'svg{display:block;width:100%;height:'+chartHeight+'px;font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}'+
        '.empty{min-height:'+c.height+'px;display:flex;align-items:center;justify-content:center;font:12px Arial;color:var(--secondary-text-color,#aaa)}'+
        '.ep-legend{padding:5px 11px 7px;display:grid;gap:2px;border-top:1px solid var(--divider-color,transparent);font-size:'+textPx+'px;line-height:1.3;font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif);color:var(--primary-text-color)}'+
        '.ep-item{display:flex;align-items:center;gap:6px;min-height:'+layout.rowHeight+'px;white-space:nowrap;overflow:hidden}'+
        '.ep-icon{width:'+iconPx+'px;height:'+iconPx+'px;--mdc-icon-size:'+iconPx+'px;flex:none}'+
        '.ep-name{max-width:44%;overflow:hidden;text-overflow:ellipsis;font-weight:600}.ep-time{margin-left:auto;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis}'+
        '.ep-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}'+
        '.ep-top{display:flex;align-items:center;justify-content:flex-end;padding:4px 8px;box-sizing:border-box;height:'+layout.topHeight+'px;overflow-x:auto;white-space:nowrap;scrollbar-width:thin}'+
        '.ep-top-items{display:inline-flex;align-items:center;gap:8px;min-width:max-content;margin-left:auto}'+
        '.ep-header-legend{position:absolute;top:4px;right:8px;height:'+layout.headerLegendHeight+'px;display:flex;align-items:center;justify-content:flex-end;overflow-x:auto;scrollbar-width:thin;z-index:1}'+
        '.ep-top-item{display:inline-flex;align-items:center;gap:3px;flex:none;color:var(--secondary-text-color);font-size:'+textPx+'px;line-height:1.25}'+
        '.ep-top-item .ep-icon,.ep-tag .ep-icon{color:var(--ep-color)}'+
        '.ep-chart{position:relative;width:100%;height:'+chartHeight+'px}'+
        '.ep-tag{position:absolute;display:flex;align-items:center;gap:2px;height:'+layout.labelHeight+'px;box-sizing:border-box;padding:0 2px;border:1px solid var(--ha-card-border-color,transparent);border-radius:5px;background:var(--secondary-background-color,var(--card-background-color,transparent));color:var(--primary-text-color);font-size:'+textPx+'px;line-height:1.25;font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif);white-space:nowrap;pointer-events:none;overflow:hidden;z-index:1}';
      if (this._hass) this.hass=this._hass; else this._render();
    }
    _legendLayout() {
      const c=this._config;
      const textHeight=Math.ceil(c.legend_font_size*1.25);
      const tallest=Math.max(c.legend_icon_size,textHeight);
      const rowHeight=Math.max(21,tallest+6);
      const topHeight=Math.max(29,tallest+12);
      const labelHeight=Math.max(16,tallest+4);
      const headerLegendHeight=Math.max(24,tallest+4);
      const n=this._legendCount(), visible=c.show_legend && n>0;
      const inlineBand=visible && c.legend_position==='inline' ? Math.max(22,tallest+8):0;
      const headerExtra=visible && c.legend_position==='header' ?
        Math.max(0,tallest+12-(c.show_header?32:12)):0;
      const extra=!visible?0:c.legend_position==='bottom'?16+n*(rowHeight+2):
        c.legend_position==='top'?topHeight:inlineBand+headerExtra;
      return {rowHeight,topHeight,labelHeight,headerLegendHeight,inlineBand,headerExtra,
        chartHeight:c.height+inlineBand+headerExtra,extra};
    }
    _legendCount() {
      const c=this._config;
      return c?.show_legend ? (c.show_appliances?c.appliances.length:0)+(c.show_charging?c.ev_schedules.length:0) : 0;
    }
    set hass(hass) {
      this._hass=hass; if (!this._config) return;
      const c=this._config;
      const state=hass.states[c.entity];
      const raw=state?.attributes?.[c.attribute];
      const signature=JSON.stringify([raw,state?.attributes?.unit_of_measurement]);
      const plans=c.show_charging?c.ev_schedules.map(ev=>hass.states[ev.entity]?.attributes?.[ev.attribute]):[];
      const scheduleSignature=JSON.stringify(plans);
      if(signature===this._signature && scheduleSignature===this._scheduleSignature) return;
      this._state=state;
      if(signature!==this._signature) {
        this._signature=signature;this._data=parse(raw,c.value_multiplier);
      }
      if(scheduleSignature!==this._scheduleSignature) {
        this._scheduleSignature=scheduleSignature;
        this._scheduleData=plans.map(parseCharging);
      }
      this._render();
    }
    connectedCallback() {
      if (typeof ResizeObserver!=='undefined') {
        this._observer=new ResizeObserver(entries=> {
          const w=Math.round(entries[0].contentRect.width);
          if (w>0 && w!==this._width) {this._width=w; this._render();}
        }); this._observer.observe(this);
      }
      if (!this._timer) this._timer=setInterval(()=> {if (!document.hidden) this._render();},60000);
      this._visibility=()=> {if (!document.hidden) this._render();};
      document.addEventListener('visibilitychange',this._visibility); this._render();
    }
    disconnectedCallback() {
      this._observer?.disconnect(); clearInterval(this._timer); this._timer=null;
      document.removeEventListener('visibilitychange',this._visibility);
    }
    getCardSize() {return this._config ? Math.ceil(this._totalHeight/50) : 2;}
    getGridOptions() {return {columns:12, rows:Math.max(2,Math.ceil((this._totalHeight+8)/64)), min_rows:2};}
    static getConfigElement() {return document.createElement('elpris-mini-card-editor');}
    static getStubConfig() {return {entity:'sensor.ev_smart_charging_charging',attribute:'raw_two_days',mode:'rolling',hours_back:2,hours_forward:'auto',height:110};}
    _getTimeWindow(now) {
      const c=this._config;
      const midnight=new Date(now); midnight.setHours(0,0,0,0);
      const tomorrow=new Date(midnight); tomorrow.setDate(tomorrow.getDate()+1);
      const start=c.mode==='day' ? +midnight : now-c.hours_back*3600000;
      if (c.mode==='day') return {start, end:+tomorrow};
      if (c.hours_forward!=='auto') return {start, end:now+c.hours_forward*3600000};
      // Stop at the last future interval actually supplied by the sensor.
      // Never extrapolate prices; keep a minimum 1 h visible when prices are missing.
      const latest=this._data.reduce((end,p)=>p.end>now ? Math.max(end,p.end) : end,0);
      return {start,end:Math.max(now+3600000,latest)};
    }
    _render() {
      const c=this._config; if (!c) return;
      const layout=this._legendLayout(), inlineBand=layout.inlineBand;
      const w=this._width, h=layout.chartHeight, now=Date.now();
      const {start,end}=this._getTimeWindow(now);
      const current=this._data.find(p=>p.t<=now && p.end>now);
      const visible=this._data.filter(p=>p.end>start && p.t<end);
      if (!visible.length) {this._root.innerHTML='<div class="empty">Ingen prisdata i den valgte periode</div>'; return;}
      const left=c.show_yaxis?30:10, right=w-10, top=(c.show_header?32:12)+inlineBand+layout.headerExtra, bottom=h-23;
      let low=Math.min(0,...visible.map(p=>p.value)), high=Math.max(...visible.map(p=>p.value));
      if (high-low<0.5) {high=low+0.5;} high+=(high-low)*0.08;
      const x=t=>left+(t-start)/(end-start)*(right-left), y=v=>bottom-(v-low)/(high-low)*(bottom-top);
      const paths=[]; let group=[];
      visible.forEach((p,i)=> {
        group.push({x:x(Math.max(start,p.t)),y:y(p.value)});
        const next=visible[i+1];
        if (!next || next.t>p.end+1) {
          if (p.end>p.t) group.push({x:x(Math.min(end,p.end)),y:y(p.value)});
          paths.push(curve(group)); group=[];
        }
      });
      const colors=c.color_threshold;
      const gradientLow=Math.min(low,colors[0].value), gradientHigh=Math.max(high,colors[colors.length-1].value);
      const stops=[{value:gradientLow,color:colors[0].color},...colors,{value:gradientHigh,color:colors[colors.length-1].color}];
      // Threshold colors interpolate vertically, keeping the price/color mapping fixed.
      const gradient=stops.map(p=>`<stop offset="${100*(p.value-gradientLow)/(gradientHigh-gradientLow)}%" stop-color="${esc(p.color)}"/>`).join('');
      const headerColor=current ? ([...colors].reverse().find(p=>p.value<=current.value) || colors[0]).color : 'var(--secondary-text-color,#aaa)';
      const unit=c.unit ?? this._state?.attributes?.unit_of_measurement ?? '';
      let elements='';
      if(c.show_header) elements+=`<text x="18" y="24" fill="${esc(headerColor)}" font-size="23" font-weight="500">${current ? esc(priceFormat(current.value,c.decimals)) : '—'}<tspan fill="var(--secondary-text-color,#aaa)" font-size="11"> ${esc(unit)}</tspan></text>`;
      if(c.show_yaxis) for(let i=0;i<=4;i++) {const v=low+(high-low)*i/4; elements+=`<text x="${left-6}" y="${y(v)+3}" text-anchor="end" fill="var(--secondary-text-color,#aaa)" font-size="9">${esc(priceFormat(v,high-low<2?1:0))}</text>`;}
      elements+=`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="var(--secondary-text-color,#aaa)" stroke-opacity=".6"/>`;
      const tickCount=Math.max(2,Math.min(12,Math.floor((right-left)/36)));
      const tickStep=c.mode==='day'? (w<360?4:2)*3600000 : Math.max(1800000,Math.ceil((end-start)/tickCount/1800000)*1800000);
      // In a multi-day rolling view, mark each local midnight with its date.
      const dayBoundaries=[];
      if(c.mode==='rolling') {
        const d=new Date(start); d.setHours(0,0,0,0); d.setDate(d.getDate()+1);
        while(+d<end) {
          dayBoundaries.push({time:+d,label:`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`});
          d.setDate(d.getDate()+1);
        }
      }
      for(let t=c.mode==='day'?start:Math.ceil(start/tickStep)*tickStep;t<=end;t+=tickStep) {
        const xx=x(t); const date=new Date(t);
        if(dayBoundaries.some(d=>Math.abs(xx-x(d.time))<20)) continue;
        const label=String(date.getHours()).padStart(2,'0')+(c.mode==='rolling'?':'+String(date.getMinutes()).padStart(2,'0'):'');
        elements+=`<line x1="${xx}" y1="${bottom}" x2="${xx}" y2="${bottom+4}" stroke="var(--secondary-text-color,#aaa)"/><text x="${xx}" y="${h-6}" text-anchor="middle" fill="var(--secondary-text-color,#aaa)" font-size="9">${label}</text>`;
      }
      for(const d of dayBoundaries) {
        const xx=x(d.time);
        elements+=`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${bottom}" stroke="var(--secondary-text-color,#aaa)" stroke-opacity=".25" stroke-dasharray="2 3"/><text x="${xx}" y="${h-6}" text-anchor="middle" fill="var(--secondary-text-color,#aaa)" font-size="9">${d.label}</text>`;
      }
      const legend=[];
      const markers=[];
      if(c.show_appliances) c.appliances.forEach((ap,i)=>{
        const chosen=closestCheapWindow(this._data,now,end,ap.duration);
        const display=chosen?displayedTime(ap,chosen.start,chosen.end,now,'appliance'):null;
        if(chosen) {
          const a=Math.max(start,chosen.start),b=Math.min(end,chosen.end);
          if(b>a) {
            elements+='<rect x="'+x(a)+'" y="'+top+'" width="'+(x(b)-x(a))+'" height="'+(bottom-top)+'" fill="'+esc(ap.color)+'" opacity=".065"/>';
            elements+='<line x1="'+x(a)+'" y1="'+(bottom-3-i*3)+'" x2="'+x(b)+'" y2="'+(bottom-3-i*3)+'" stroke="'+esc(ap.color)+'" stroke-width="3" stroke-linecap="round"/>';
            markers.push({item:ap,kind:'appliance',center:(x(a)+x(b))/2,...display,shortTime:c.legend_compact?display.compactTime:display.shortTime,fullTime:display.tooltip});
          }
        }
        legend.push({item:ap,time:display?.time||'Ingen sammenhængende periode',shortTime:display?.shortTime||'—',
          compactTime:display?.compactTime||'—',tooltip:display?.tooltip||'Ingen sammenhængende periode'});
      });
      if(c.show_charging) c.ev_schedules.forEach((ev,i)=>{
        const chunks=(this._scheduleData[i]||[]).filter(p=>p.end>now);
        const grouped=[];
        for(const p of chunks) {
          const last=grouped[grouped.length-1];
          if(last && p.t<=last.end+1000) last.end=Math.max(last.end,p.end);
          else grouped.push({start:p.t,end:p.end});
        }
        for(const p of grouped) {
          const a=Math.max(start,p.start,now),b=Math.min(end,p.end);
          if(b<=a) continue;
          elements+='<rect x="'+x(a)+'" y="'+(top+3+i*8)+'" width="'+(x(b)-x(a))+'" height="5" rx="2" fill="'+esc(ev.color)+'" opacity=".86"/>';
          const display=displayedTime(ev,Math.max(now,p.start),p.end,now,'ev');
          markers.push({item:ev,kind:'ev',center:(x(a)+x(b))/2,...display,shortTime:c.legend_compact?display.compactTime:display.shortTime,fullTime:display.tooltip});
        }
        const first=grouped[0];
        const display=first?displayedTime(ev,Math.max(now,first.start),first.end,now,'ev'):null;
        const more=grouped.length>1?' (+'+(grouped.length-1)+')':'';
        const details=grouped.length>1?' | Øvrige ladeperioder: '+grouped.slice(1).map(p=>timespan(p.start,p.end,now)).join(', '):'';
        legend.push({item:ev,time:display?display.time+more:'Ingen ladeplan',
          shortTime:display?display.shortTime+(grouped.length>1?' +'+(grouped.length-1):''):'—',
          compactTime:display?.compactTime||'—',
          tooltip:display?display.tooltip+details:'Ingen ladeplan'});
      });
      const cheap=visible.filter(p=>p.end>now).sort((a,b)=>a.value-b.value || a.t-b.t).slice(0,c.cheap_count);
      if(c.show_cheap) for(const p of cheap) {const a=x(Math.max(start,now,p.t)), b=x(Math.min(end,p.end)); elements+=`<rect x="${a}" y="${top}" width="${Math.max(0,b-a)}" height="${bottom-top}" fill="${esc(c.cheap_color)}" opacity=".10"/><line x1="${a}" y1="${bottom}" x2="${b}" y2="${bottom}" stroke="${esc(c.cheap_color)}" stroke-width="3"/>`;}
      elements+=paths.map(d=>`<path d="${d}" fill="none" stroke="url(#${this._id})" stroke-width="${c.line_width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      if(c.show_now && now>=start && now<=end) {
        const xx=x(now), labelX=Math.max(left,Math.min(right-21,xx-10));
        elements+=`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${bottom}" stroke="${esc(c.now_color)}" stroke-width="1" stroke-dasharray="3 3"/><rect x="${labelX}" y="${top-2}" width="21" height="14" rx="2" fill="${esc(c.now_color)}"/><text x="${labelX+10.5}" y="${top+8}" text-anchor="middle" fill="#171717" font-size="9">Nu</text>`;
      }
      const legendHtml=c.show_legend && legend.length ?
        '<div class="ep-legend">'+legend.map(({item,time,compactTime,tooltip})=>
          '<div class="ep-item" title="'+esc(item.name+': '+tooltip)+'"><span class="ep-dot" style="background:'+esc(item.color)+'"></span>'+
          '<ha-icon class="ep-icon" icon="'+esc(item.icon)+'"></ha-icon>'+
          '<span class="ep-name">'+esc(item.name)+'</span><span class="ep-time">'+esc(c.legend_compact?compactTime:time)+'</span></div>'
        ).join('')+'</div>' : '';
      const svgHtml=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Elpriser. ${current?'Aktuelt '+esc(priceFormat(current.value,c.decimals))+' '+esc(unit):'Aktuel pris mangler'}. Blå felter viser billigste tilgængelige intervaller."><defs><linearGradient id="${this._id}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${y(gradientLow)}" y2="${y(gradientHigh)}">${gradient}</linearGradient></defs>${elements}</svg>`;
      const position=c.show_legend?c.legend_position:'none';
      const chips=legend.length?legend.map(({item,shortTime,compactTime,tooltip})=>
        '<span class="ep-top-item" title="'+esc(item.name+': '+tooltip)+'" aria-label="'+esc(item.name+': '+tooltip)+'" style="--ep-color:'+esc(item.color)+'">'+
        '<ha-icon class="ep-icon" icon="'+esc(item.icon)+'"></ha-icon><span>'+esc(c.legend_compact?compactTime:shortTime)+'</span></span>'
      ).join(''):'';
      const topHtml=position==='top' && chips?
        '<div class="ep-top"><div class="ep-top-items">'+chips+'</div></div>':'';
      let headerHtml='';
      if(position==='header' && chips) {
        // Reserve sufficient space for the current price and its unit; scroll only the chips if narrow.
        const priceLabel=current?priceFormat(current.value,c.decimals):'—';
        const headerLeft=c.show_header?Math.max(118,Math.min(w-40,24+priceLabel.length*13+String(unit).length*6+14)):12;
        if(w-headerLeft>=26)
          headerHtml='<div class="ep-header-legend" style="left:'+headerLeft+'px"><div class="ep-top-items">'+chips+'</div></div>';
      }
      let annotations='';
      if(position==='inline' && inlineBand) {
        const tags=inlinePlacements(markers,left,right,top-inlineBand+3,c.legend_font_size,c.legend_icon_size);
        annotations=tags.map(tag=>
          '<div class="ep-tag" title="'+esc(tag.item.name+': '+tag.fullTime)+'" aria-label="'+esc(tag.item.name+': '+tag.fullTime)+'" style="left:'+tag.left+'px;top:'+tag.top+'px;width:'+tag.width+'px;--ep-color:'+esc(tag.item.color)+'">'+
          '<ha-icon class="ep-icon" icon="'+esc(tag.item.icon)+'"></ha-icon>'+
          (tag.iconOnly?'':'<span>'+esc(tag.shortTime)+'</span>')+'</div>'
        ).join('');
      }
      this._root.innerHTML=topHtml+'<div class="ep-chart">'+svgHtml+headerHtml+annotations+'</div>'+(position==='bottom'?legendHtml:'');
    }
  }

  class ElprisMiniCardEditor extends HTMLElement {
    constructor() {
      super();this.attachShadow({mode:'open'});
      this.shadowRoot.addEventListener('change',e=>this._changed(e));
      this.shadowRoot.addEventListener('click',e=>this._click(e));
    }
    setConfig(config) {this._config=JSON.parse(JSON.stringify(config||{}));this._render();}
    set hass(hass) {this._hass=hass;}
    _save(c) {
      this._config=c;
      this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:c},bubbles:true,composed:true}));
      this._render();
    }
    _changed(e) {
      const t=e.target, c=JSON.parse(JSON.stringify(this._config||{}));
      const kind=t.dataset.kind, key=t.dataset.key;
      if(kind) {
        const arr=kind==='appliance'?'appliances':'ev_schedules';
        const i=Number(t.dataset.index);
        if(!Array.isArray(c[arr]) || !c[arr][i]) return;
        c[arr][i][key]=key==='duration'?Number(t.value):t.value;
      } else if(key) {
        c[key]=t.type==='checkbox'?t.checked:t.type==='number'?Number(t.value):t.value;
      }
      this._save(c);
    }
    _click(e) {
      const t=e.target.closest('button'),c=JSON.parse(JSON.stringify(this._config||{}));
      if(!t) return;
      if(t.dataset.add) {
        const arr=t.dataset.add==='appliance'?'appliances':'ev_schedules';
        c[arr]=Array.isArray(c[arr])?[...c[arr]]:[];
        if(c[arr].length>=8) return;
        c[arr].push(arr==='appliances'
          ? {name:'Nyt apparat',icon:'mdi:dishwasher',duration:120,color:'#4caf50'}
          : {name:'Ny bil',icon:'mdi:car-electric',color:'#2196f3',entity:'',attribute:'charging_schedule'});
      } else if(t.dataset.remove) {
        const arr=t.dataset.remove==='appliance'?'appliances':'ev_schedules';
        c[arr]=(c[arr]||[]).filter((v,i)=>i!==Number(t.dataset.index));
      } else return;
      this._save(c);
    }
    _input(key,value,label,type='text',extra='') {
      const val=value===undefined || value===null?'':String(value);
      return '<label>'+esc(label)+'<input data-key="'+key+'" type="'+type+'" value="'+esc(val)+'" '+extra+'></label>';
    }
    _bool(key,label,defaultValue=true) {
      const checked=(this._config?.[key]??defaultValue)?'checked':'';
      return '<label class="check"><input type="checkbox" data-key="'+key+'" '+checked+'>'+esc(label)+'</label>';
    }
    _item(item,i,kind) {
      const c=kind==='appliance'?normalizeItems([item],'appliance')[0]:normalizeItems([item],'ev')[0];
      const f=(key,val,label,type='text',extra='')=>
        '<label>'+esc(label)+'<input data-kind="'+kind+'" data-index="'+i+'" data-key="'+key+'" type="'+type+'" value="'+esc(val)+'" '+extra+'></label>';
      return '<div class="item"><div class="item-head"><strong>'+esc(c.name)+'</strong><button type="button" data-remove="'+kind+'" data-index="'+i+'">Fjern</button></div>'+
        f('name',c.name,'Navn')+f('icon',c.icon,'Ikon (mdi:...)')+
        f('color',/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#4caf50','Farve','color')+
        '<label>Vis tidsangivelse<select data-kind="'+kind+'" data-index="'+i+'" data-key="time_display">'+
        '<option value="interval" '+(c.time_display==='interval'?'selected':'')+'>Tidsinterval (04–08)</option>'+
        '<option value="countdown" '+(c.time_display==='countdown'?'selected':'')+'>Tid til start (om 2 t)</option>'+
        '</select></label>'+
        (kind==='appliance'?f('duration',c.duration,'Varighed i minutter','number','min="15" max="720" step="15"'):
          f('entity',c.entity,'Sensor (entity_id)')+f('attribute',c.attribute,'Attribut'))+'</div>';
    }
    _render() {
      if(!this._config) return;
      const c=this._config, appliances=c.appliances||[], ev=c.ev_schedules||[];
      const style='<style>:host{display:block;color:var(--primary-text-color);font:14px var(--paper-font-body1_-_font-family,Arial,sans-serif)}.wrap{display:grid;gap:12px}fieldset{border:1px solid var(--divider-color,#bbb);border-radius:10px;padding:10px;display:grid;gap:8px}legend{font-weight:600;padding:0 5px}label{display:grid;gap:3px;font-size:12px}input,select{box-sizing:border-box;width:100%;padding:7px;border:1px solid var(--divider-color,#bbb);border-radius:6px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222)}label.check{display:flex;align-items:center;gap:9px}label.check input{width:17px;height:17px}button{background:var(--secondary-background-color,#eee);color:var(--primary-text-color,#222);border:1px solid var(--divider-color,#bbb);border-radius:7px;padding:7px 12px;cursor:pointer}.item{border:1px solid var(--divider-color,#bbb);border-radius:8px;padding:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.item-head{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}.hint{color:var(--secondary-text-color);font-size:11px}.wide{grid-column:1/-1}</style>';
      const mode=c.mode||'day',future=c.hours_forward??6;
      this.shadowRoot.innerHTML=style+'<div class="wrap"><fieldset><legend>Elprisgraf</legend>'+
        this._input('entity',c.entity,'Prissensor')+this._input('attribute',c.attribute||'raw_two_days','Pris-attribut')+
        '<label>Visning<select data-key="mode"><option value="day" '+(mode==='day'?'selected':'')+'>Hele døgnet</option><option value="rolling" '+(mode==='rolling'?'selected':'')+'>Rullende tid</option></select></label>'+
        this._input('hours_back',c.hours_back??2,'Timer bagud','number','min="0" max="48" step="1"')+
        this._input('hours_forward',future,'Timer frem (eller auto)')+
        this._input('height',c.height??110,'Grafhøjde, px','number','min="80" max="500"')+
        this._input('legend_font_size',c.legend_font_size??10,'Legend tekststørrelse (px)','number','min="8" max="24" step="1"')+
        this._input('legend_icon_size',c.legend_icon_size??14,'Legend ikonstørrelse (px)','number','min="10" max="36" step="1"')+
        this._bool('show_legend','Vis forklaring / labels')+
        this._bool('legend_compact','Kompakt legend (uden "om", dato, minutter eller +antal)')+
        '<label>Placering af forklaring<select data-key="legend_position">'+
        '<option value="bottom" '+((c.legend_position||'bottom')==='bottom'?'selected':'')+'>Nederst (navn, ikon og tid)</option>'+
        '<option value="top" '+(c.legend_position==='top'?'selected':'')+'>Øverst, højrestillet (egen række)</option>'+
        '<option value="header" '+(c.legend_position==='header'?'selected':'')+'>Øverst, ved pris/enhed til højre</option>'+
        '<option value="inline" '+(c.legend_position==='inline'?'selected':'')+'>Over kurven, ud for markering</option>'+
        '</select></label>'+
        this._bool('show_cheap','Markér billigste enkeltintervaller')+'</fieldset>'+
        '<fieldset><legend>Hvidevarer</legend>'+this._bool('show_appliances','Vis billigste sammenhængende perioder')+
        '<div class="hint">Beregnes med de priser, der faktisk er kendt. Planlægning starter tidligst nu.</div>'+
        appliances.map((v,i)=>this._item(v,i,'appliance')).join('')+
        '<button type="button" data-add="appliance">+ Tilføj apparat</button></fieldset>'+
        '<fieldset><legend>Bilers ladeplaner</legend>'+this._bool('show_charging','Vis opladning')+
        '<div class="hint">Læs charging_schedule direkte fra en sensor pr. bil.</div>'+
        ev.map((v,i)=>this._item(v,i,'ev')).join('')+
        '<button type="button" data-add="ev">+ Tilføj bil</button></fieldset></div>';
    }
  }

  if (!customElements.get('elpris-mini-card-editor')) customElements.define('elpris-mini-card-editor',ElprisMiniCardEditor);
  if (!customElements.get('elpris-mini-card')) customElements.define('elpris-mini-card',ElprisMiniCard);
  window.customCards=window.customCards || [];
  if (!window.customCards.some(c=>c.type==='elpris-mini-card')) window.customCards.push({type:'elpris-mini-card',name:'Elpris Mini Card',description:'Let elprisgraf med direkte sensordata, Nu og billigste intervaller.'});
  console.info(`Elpris Mini Card ${VERSION}`);
})();
