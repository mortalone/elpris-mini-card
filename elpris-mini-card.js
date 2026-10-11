/* Elpris Mini Card v0.1.1 — MIT — no external dependencies */
(() => {
  'use strict';
  const VERSION = '0.1.1';
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
      const c=this._config={entity:config.entity, attribute:config.attribute || 'raw_two_days', mode:config.mode || 'day',
        height:number(config.height,110,80,500), hours_back:number(config.hours_back,1,0,48), hours_forward:number(config.hours_forward,6,1,48),
        cheap_count:Math.floor(number(config.cheap_count,2,0,24)), show_now:config.show_now!==false, show_cheap:config.show_cheap!==false,
        show_header:config.show_header!==false, show_yaxis:config.show_yaxis!==false, decimals:Math.floor(number(config.decimals,2,0,6)),
        unit:config.unit, value_multiplier:number(config.value_multiplier,1,0.000001,1000000), line_width:number(config.line_width,3,1,10),
        now_color:config.now_color || '#ff80ab', cheap_color:config.cheap_color || '#64b5f6', color_threshold:config.color_threshold || DEFAULT_COLORS};
      if (!Array.isArray(c.color_threshold) || !c.color_threshold.length || c.color_threshold.some(p=>!Number.isFinite(Number(p.value)) || typeof p.color!=='string')) throw new Error('color_threshold kræver value og color.');
      c.color_threshold=c.color_threshold.map(p=>({value:Number(p.value),color:p.color})).sort((a,b)=>a.value-b.value);
      this._signature=null; this._state=null;
      if (this._hass) this.hass=this._hass; else this._render();
    }
    set hass(hass) {
      this._hass=hass; if (!this._config) return;
      const state=hass.states[this._config.entity];
      if (state===this._state) return;
      this._state=state;
      const raw=state?.attributes?.[this._config.attribute];
      const signature=JSON.stringify([raw,state?.attributes?.unit_of_measurement]);
      if (signature===this._signature) return;
      this._signature=signature; this._data=parse(raw,this._config.value_multiplier); this._render();
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
    getCardSize() {return this._config ? Math.ceil(this._config.height/50) : 2;}
    getGridOptions() {return {columns:12, rows:2, min_rows:2};}
    static getStubConfig() {return {entity:'sensor.ev_smart_charging_charging',attribute:'raw_two_days',height:110};}
    _render() {
      const c=this._config; if (!c) return;
      const w=this._width, h=c.height, now=Date.now();
      const midnight=new Date(now); midnight.setHours(0,0,0,0);
      const tomorrow=new Date(midnight); tomorrow.setDate(tomorrow.getDate()+1);
      const start=c.mode==='day' ? +midnight : now-c.hours_back*3600000;
      const end=c.mode==='day' ? +tomorrow : now+c.hours_forward*3600000;
      const current=this._data.find(p=>p.t<=now && p.end>now);
      const visible=this._data.filter(p=>p.end>start && p.t<end);
      this._style.textContent=`:host{display:block}ha-card{height:${h}px;box-sizing:border-box;overflow:hidden;padding:0;background:var(--kitchen-card-background,var(--ha-card-background,var(--card-background-color,rgba(250,246,235,.68))))}svg{display:block;width:100%;height:100%;background:transparent;font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}.empty{height:100%;display:flex;align-items:center;justify-content:center;font:12px Arial;color:var(--secondary-text-color,#aaa)}`;
      if (!visible.length) {this._root.innerHTML='<div class="empty">Ingen prisdata i den valgte periode</div>'; return;}
      const left=c.show_yaxis?30:10, right=w-10, top=c.show_header?32:12, bottom=h-23;
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
      for(let t=c.mode==='day'?start:Math.ceil(start/tickStep)*tickStep;t<=end;t+=tickStep) {
        const xx=x(t); const date=new Date(t);
        const label=String(date.getHours()).padStart(2,'0')+(c.mode==='rolling'?':'+String(date.getMinutes()).padStart(2,'0'):'');
        elements+=`<line x1="${xx}" y1="${bottom}" x2="${xx}" y2="${bottom+4}" stroke="var(--secondary-text-color,#aaa)"/><text x="${xx}" y="${h-6}" text-anchor="middle" fill="var(--secondary-text-color,#aaa)" font-size="9">${label}</text>`;
      }
      const cheap=visible.filter(p=>p.end>now).sort((a,b)=>a.value-b.value || a.t-b.t).slice(0,c.cheap_count);
      if(c.show_cheap) for(const p of cheap) {const a=x(Math.max(start,now,p.t)), b=x(Math.min(end,p.end)); elements+=`<rect x="${a}" y="${top}" width="${Math.max(0,b-a)}" height="${bottom-top}" fill="${esc(c.cheap_color)}" opacity=".10"/><line x1="${a}" y1="${bottom}" x2="${b}" y2="${bottom}" stroke="${esc(c.cheap_color)}" stroke-width="3"/>`;}
      elements+=paths.map(d=>`<path d="${d}" fill="none" stroke="url(#${this._id})" stroke-width="${c.line_width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      if(c.show_now && now>=start && now<=end) {
        const xx=x(now), labelX=Math.max(left,Math.min(right-21,xx-10));
        elements+=`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${bottom}" stroke="${esc(c.now_color)}" stroke-width="1" stroke-dasharray="3 3"/><rect x="${labelX}" y="${top-2}" width="21" height="14" rx="2" fill="${esc(c.now_color)}"/><text x="${labelX+10.5}" y="${top+8}" text-anchor="middle" fill="#171717" font-size="9">Nu</text>`;
      }
      this._root.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Elpriser. ${current?'Aktuelt '+esc(priceFormat(current.value,c.decimals))+' '+esc(unit):'Aktuel pris mangler'}. Blå felter viser billigste tilgængelige intervaller."><defs><linearGradient id="${this._id}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${y(gradientLow)}" y2="${y(gradientHigh)}">${gradient}</linearGradient></defs>${elements}</svg>`;
    }
  }
  if (!customElements.get('elpris-mini-card')) customElements.define('elpris-mini-card',ElprisMiniCard);
  window.customCards=window.customCards || [];
  if (!window.customCards.some(c=>c.type==='elpris-mini-card')) window.customCards.push({type:'elpris-mini-card',name:'Elpris Mini Card',description:'Let elprisgraf med direkte sensordata, Nu og billigste intervaller.'});
  console.info(`Elpris Mini Card ${VERSION}`);
})();
