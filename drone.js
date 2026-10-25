/* drone.js — вкладка «🚁 Дрон»: зв'язок антена–дрон у секторі, радіогоризонт, зони ризику, поради. */
(function(){
var $=function(i){return document.getElementById(i);};
var toast=function(t){ if(window.__toast) window.__toast(t); else alert(t); };
var num=function(id,d){ var v=parseFloat(String($(id).value).replace(",",".")); return isFinite(v)?v:d; };
var COL={ok:"#65ffb3",warn:"#ffd166",bad:"#ff6b7a"}, M=20, layer=null, last=null;
var mil=function(a){ return Math.round(a*6000/360); };
var fd=function(d){ return d<1000?Math.round(d)+" м":(d/1000).toFixed(1)+" км"; };

/* ---------- ядро розрахунку ---------- */
function evalRay(pts,hA,H,f){
  var o=[];
  for(var i=1;i<pts.length;i++){
    var r=computeRadioLink(pts.slice(0,i+1),hA,H,f).minRatio;
    o.push(r>=.6?"ok":(r>=0?"warn":"bad"));
  }
  return o;
}
function needH(pts,i,hA,H,f){
  var c=[H+25,H+50,H+100,H+150,H+250];
  for(var k=0;k<c.length;k++) if(computeRadioLink(pts.slice(0,i+1),hA,c[k],f).minRatio>=.6) return c[k];
  return null;
}
function cov(rays,hA,H,f){
  var ok=0,bad=0,n=0;
  rays.forEach(function(r){ evalRay(r.pts,hA,H,f).forEach(function(s){ n++; if(s==="ok") ok++; else if(s==="bad") bad++; }); });
  return {ok:Math.round(100*ok/n),bad:Math.round(100*bad/n)};
}
function segments(r,R,hA,H,f){
  var out=[],cur=null;
  r.st.forEach(function(s,j){
    if(s==="ok"){ cur=null; return; }
    var n=needH(r.pts,j+1,hA,H,f), d=R*(j+1)/M;
    if(!cur){ cur={from:d,to:d,bad:false,need:H,hard:false,idx:j+1,az:r.az,ray:r}; out.push(cur); }
    cur.to=d; if(s==="bad") cur.bad=true;
    if(n===null) cur.hard=true; else if(n>cur.need) cur.need=n;
  });
  out.forEach(function(g){ g.toEnd=g.to>=R-1e-6; });
  return out;
}
/* радіогоризонт, K=4/3: d(км)=4.12·(√h1+√h2) */
function horizon(hA,H,R){
  var k=R/1000/4.12, sA=Math.sqrt(hA), sH=Math.sqrt(H);
  return {d:4.12*(sA+sH)*1000, needDrone:k>sA?Math.pow(k-sA,2):0, needMast:k>sH?Math.pow(k-sH,2):0};
}
function analyze(rays,hA,H,f,R,c){
  rays.forEach(function(r){
    r.st=evalRay(r.pts,hA,H,f);
    var g=0; while(g<r.st.length&&r.st[g]==="ok") g++;
    r.good=g; r.iBad=r.st.indexOf("bad"); r.reach=R*g/M; r.segs=segments(r,R,hA,H,f);
  });
  var best=rays.reduce(function(a,b){
    return (b.reach>a.reach||(b.reach===a.reach&&Math.abs(b.az-c)<Math.abs(a.az-c)))?b:a;
  });
  var n=Math.max(1,best.good), angs=[];
  for(var i=1;i<=n;i++) angs.push(Math.atan2(best.pts[i].elevation+H-(best.pts[0].elevation+hA),R*i/M)*180/Math.PI);
  var tilt={avg:angs.reduce(function(a,b){return a+b;},0)/angs.length,min:Math.min.apply(null,angs),max:Math.max.apply(null,angs)};
  var cands=[hA,hA+2,hA+5,hA+10,hA+20].map(function(h){ return {h:h,c:cov(rays,h,H,f)}; });
  var mx=Math.max.apply(null,cands.map(function(x){ return x.c.ok; }));
  var rec=cands.filter(function(x){ return x.c.ok>=mx-2; })[0];
  var segs=[]; rays.forEach(function(r){ segs=segs.concat(r.segs); });
  segs.sort(function(a,b){ return (b.hard-a.hard)||(a.from-b.from); });
  var base=cands[0].c, v=(base.bad<=5&&base.ok>=85)?"good":(base.bad<=25?"warn":"bad");
  return {rays:rays,best:best,tilt:tilt,cands:cands,rec:rec,segs:segs,base:base,verdict:v,hor:horizon(hA,H,R)};
}
window.__droneAnalyze=analyze;

/* ---------- поля вкладки ---------- */
function pull(){
  if(currentBearing!=null) $("dnAz").value=$("dnUnit").value==="mil"?mil(currentBearing):currentBearing.toFixed(1);
  var c=$("ngDist")?Number($("ngDist").value):0;
  if(c>0) $("dnRk").value=(c/1000).toFixed(2).replace(/\.?0+$/,"");
}
function refresh(){
  if(window.__droneJustSet){ window.__droneJustSet=false; pull(); }
  else if(!$("dnAz").value&&currentBearing!=null) pull();
  $("dnPosInfo").textContent=currentLat==null?"Місце антени не задано.":("Антена: "+currentLat.toFixed(5)+", "+currentLon.toFixed(5));
}

async function go(){
  if(currentLat==null){ toast("Спочатку задайте місце антени."); return; }
  var azv=parseFloat(String($("dnAz").value).replace(",","."));
  if(!isFinite(azv)){ toast("Введіть азимут сектора або натисніть «Сектор по карті»."); return; }
  var c=normalizeBearing($("dnUnit").value==="mil"?azv*360/6000:azv);
  var R=Math.max(200,Math.min(100000,num("dnRk",3)*1000)), W=Math.max(10,Math.min(180,num("dnW",60)));
  var hA=num("dnAnt",3), H=num("dnH",100), f=Number($("dnF").value), st=$("dnStatus");
  var nr=Math.max(3,Math.min(7,Math.round(W/10)+1)), rays=[], flat=[];
  for(var k=0;k<nr;k++){
    var az=normalizeBearing(c-W/2+W*k/(nr-1)), pts=[];
    for(var i=0;i<=M;i++){ var d=R*i/M, p=destination(currentLat,currentLon,az,d); pts.push({distance:d,lat:p.lat,lon:p.lon}); }
    rays.push({az:az,pts:pts}); flat=flat.concat(pts);
  }
  st.textContent="Отримую висоти ("+flat.length+" точок)…"; $("dnGo").disabled=true;
  try{
    var el=await getElevationsBatched(flat), j=0;
    rays.forEach(function(r){ r.pts=r.pts.map(function(p){ return Object.assign({},p,{elevation:Number(el[j++])}); }); });
    if(rays.some(function(r){ return r.pts.some(function(p){ return !isFinite(p.elevation); }); })) throw new Error("elev");
    var a=analyze(rays,hA,H,f,R,c); a.P={W:W,hA:hA,H:H,f:f,R:R,c:c};
    last=a; render(a); st.textContent="Готово. Результат нижче, промені й маркери — на карті.";
  }catch(e){ console.error(e); st.textContent="Не вдалося отримати висоти (потрібен інтернет). Спробуйте ще раз."; }
  $("dnGo").disabled=false;
}

/* ---------- виведення ---------- */
function render(a){
  var P=a.P, b=a.best, t=a.tilt, rec=a.rec, base=a.base, hor=a.hor;
  var V={good:["#65ffb3","🟢 ЗВ'ЯЗОК ДОБРИЙ"],warn:["#ffd166","🟡 Є РИЗИКИ ВТРАТИ ЗВ'ЯЗКУ"],bad:["#ff6b7a","🔴 ЗВ'ЯЗОК ПОГАНИЙ — є зони втрати"]}[a.verdict];
  $("dnVerdict").innerHTML='<div style="border:2px solid '+V[0]+';border-radius:9px;padding:9px;color:'+V[0]+';font-weight:800;font-size:14px">'+V[1]+
    '<div style="font-weight:500;font-size:11px;color:#e8f4ff;margin-top:3px">Стійкий зв\'язок у <b>'+base.ok+'%</b> сектора, затінок рельєфом у <b>'+base.bad+'%</b> (антена '+P.hA+' м, дрон '+P.H+' м над землею).</div></div>';

  var hn=hor.needDrone>0?("дрон ≥ <b>"+Math.ceil(hor.needDrone)+" м</b>"):"дрон будь-якої висоти";
  var mn=hor.needMast>0?("щогла ≥ <b>"+Math.ceil(hor.needMast)+" м</b>"):"щогла будь-якої висоти";
  $("dnHorizon").innerHTML="<b>📐 Радіогоризонт</b> (над рівниною, без рельєфу)<br>• Антена "+P.hA+" м + дрон "+P.H+" м → горизонт <b>"+fd(hor.d)+"</b>"+(hor.d<P.R?" ⚠ <b>менший за ваш радіус "+fd(P.R)+"</b>: за горизонтом зв'язку не буде.":" — радіус "+fd(P.R)+" у межах горизонту.")+
    "<br>• Щоб дістати до "+fd(P.R)+": "+hn+" (за наявної щогли) або "+mn+" (за наявної висоти дрона).<br><span class=\"note\">Реальна дальність по рельєфу — нижче; на практиці зона Френеля зменшує її ще.</span>";

  var tiltTxt=(t.avg>=0?"+":"")+t.avg.toFixed(1)+"° "+(t.avg>=0?"↑ вгору":"↓ вниз");
  var mast=rec.h>P.hA?("підняти щоглу до <b>"+rec.h+" м (+"+(rec.h-P.hA)+" м)</b>: стійкий зв'язок "+base.ok+"% → "+rec.c.ok+"%, затінок "+base.bad+"% → "+rec.c.bad+"%"):("поточна <b>"+P.hA+" м</b> достатня, піднімання майже нічого не дає");
  $("dnAntRes").innerHTML="<b>📡 Антена</b><br>• Повернути на азимут <b>"+b.az.toFixed(0)+"° ("+mil(b.az)+" т)</b> — найкращий напрямок (центр сектора "+P.c.toFixed(0)+"°).<br>"+
    "• Нахил по висоті: <b>"+tiltTxt+"</b> (діапазон "+t.min.toFixed(1)+"…"+t.max.toFixed(1)+"°).<br>• Щогла: "+mast+".<br>"+
    "<span class=\"note\">Висота щогли: стійкий% / затінок% — "+a.cands.map(function(x){ return x.h+" м: "+x.c.ok+"/"+x.c.bad; }).join(" · ")+"</span>"+
    (base.ok<60?"<br>⚠️ Сектор погано прикритий рельєфом. Якщо щоглу не підняти — перенесіть антену на найвище місце поруч (гребінь, узвишшя).":"");

  var f="<b>🚁 Політ</b><br>• Найстабільніший напрямок: <b>"+b.az.toFixed(0)+"° ("+mil(b.az)+" т)</b>, стійко до <b>"+fd(b.reach)+"</b>"+(b.reach>=P.R?" (весь радіус)":"")+".<br>";
  var rs=a.rays.map(function(r){ return r.reach; });
  f+="• По сектору стійкий зв'язок: від "+fd(Math.min.apply(null,rs))+" до "+fd(Math.max.apply(null,rs))+".<br>";
  if(a.segs.length){
    f+="• <b>Де бути обережним:</b><br>";
    a.segs.slice(0,8).forEach(function(g){
      var ic=g.hard?"🚫 НЕ ЗАЛІТАТИ":(g.bad?"🔴":"🟡");
      f+="&nbsp;&nbsp;"+ic+" аз "+g.az.toFixed(0)+"° ("+mil(g.az)+" т) · "+fd(g.from)+(g.to>g.from?"–"+fd(g.to):"")+": "+
        (g.hard?"зв'язок не втримати навіть на +250 м — обліт":"набрати ≥ <b>"+g.need+" м</b> над землею (+"+(g.need-P.H)+" м)")+
        (g.toEnd?"; далі до кінця радіуса нестабільно":"; далі зв'язок відновлюється")+"<br>";
    });
    if(a.segs.length>8) f+="&nbsp;&nbsp;…і ще "+(a.segs.length-8)+" (див. карту).<br>";
    f+="• Порада: перед жовтими/червоними ділянками набирайте висоту заздалегідь; зелений промінь — найбезпечніший.";
  }else f+="• Зон втрати зв'язку в секторі на цій висоті немає — можна летіти будь-яким напрямком усередині сектора.";
  f+="<br><span class=\"note\">Рельєф SRTM (≈90 м), без будівель і лісу; дрон на сталій висоті над землею. Потужність і завади не враховані — тримайте запас.</span>";
  $("dnFlightRes").innerHTML=f;

  var sel=$("dnRay"); sel.innerHTML=a.rays.map(function(r,i){ return '<option value="'+i+'"'+(r===b?" selected":"")+'>аз '+r.az.toFixed(0)+'° ('+mil(r.az)+' т)'+(r===b?" — найкращий":"")+'</option>'; }).join("");
  chart(); drawMap(a);
}

function chart(){
  if(!last) return;
  var a=last, P=a.P, r=a.rays[Number($("dnRay").value)||0], R=P.R, W=1000, Hh=250, pad=26;
  var gr=r.pts.map(function(p){ return p.elevation; });
  var yMin=Math.min.apply(null,gr), yMax=Math.max(Math.max.apply(null,gr)+P.H,gr[0]+P.hA), rng=Math.max(10,yMax-yMin);
  var X=function(d){ return pad+(W-2*pad)*d/R; }, Y=function(e){ return Hh-pad-(Hh-2*pad)*(e-yMin)/rng; };
  var s='', t=r.pts.map(function(p,i){ return (i?"L":"M")+X(p.distance).toFixed(0)+" "+Y(p.elevation).toFixed(0); }).join(" ");
  s+='<path d="'+t+' L'+X(R)+' '+(Hh-pad)+' L'+X(0)+' '+(Hh-pad)+' Z" fill="rgba(53,215,255,.14)" stroke="#35d7ff" stroke-width="2"/>';
  r.st.forEach(function(c,j){
    s+='<line x1="'+X(r.pts[j].distance).toFixed(0)+'" y1="'+Y(r.pts[j].elevation+P.H).toFixed(0)+'" x2="'+X(r.pts[j+1].distance).toFixed(0)+'" y2="'+Y(r.pts[j+1].elevation+P.H).toFixed(0)+'" stroke="'+COL[c]+'" stroke-width="5" stroke-linecap="round"/>';
  });
  var ay=Y(gr[0]+P.hA);
  if(r.iBad>=0){ var q=r.pts[r.iBad+1]; s+='<line x1="'+X(0)+'" y1="'+ay.toFixed(0)+'" x2="'+X(q.distance).toFixed(0)+'" y2="'+Y(q.elevation+P.H).toFixed(0)+'" stroke="'+COL.bad+'" stroke-width="1.5" stroke-dasharray="5 4"/>'; }
  s+='<line x1="'+X(0)+'" y1="'+Y(gr[0]).toFixed(0)+'" x2="'+X(0)+'" y2="'+ay.toFixed(0)+'" stroke="#fff" stroke-width="4"/><circle cx="'+X(0)+'" cy="'+ay.toFixed(0)+'" r="6" fill="#fff"/>';
  if(a.hor.d<=R){ var hx=X(a.hor.d).toFixed(0); s+='<line x1="'+hx+'" y1="10" x2="'+hx+'" y2="'+(Hh-pad)+'" stroke="#b3a2ff" stroke-width="1.5" stroke-dasharray="3 4"/><text x="'+hx+'" y="20" fill="#b3a2ff" font-size="14" text-anchor="middle">радіогоризонт '+fd(a.hor.d)+'</text>'; }
  for(var k=0;k<=4;k++){ var d=R*k/4; s+='<text x="'+X(d).toFixed(0)+'" y="'+(Hh-6)+'" fill="#8faabd" font-size="13" text-anchor="'+(k===0?"start":(k===4?"end":"middle"))+'">'+fd(d)+'</text>'; }
  $("dnSvg").innerHTML=s;
}

function drawMap(a){
  var P=a.P;
  if(layer) layer.clearLayers(); else layer=L.layerGroup().addTo(map);
  layer.addLayer(L.polygon(makeSector(currentLat,currentLon,P.c,P.W/2,P.R),{color:"#35d7ff",weight:1,dashArray:"4 4",fillOpacity:.04,interactive:false}));
  a.rays.forEach(function(r){
    r.st.forEach(function(s,i){
      layer.addLayer(L.polyline([[r.pts[i].lat,r.pts[i].lon],[r.pts[i+1].lat,r.pts[i+1].lon]],{color:COL[s],weight:r===a.best?5:3,opacity:.9,interactive:false}));
    });
  });
  a.segs.forEach(function(g){
    var q=g.ray.pts[g.idx];
    layer.addLayer(L.circleMarker([q.lat,q.lon],{radius:g.hard?9:7,color:"#06131f",weight:2,fillColor:g.hard?"#b00020":(g.bad?COL.bad:COL.warn),fillOpacity:1})
      .bindTooltip((g.hard?"🚫 НЕ ЗАЛІТАТИ":"⚠ Втрата зв'язку")+" · "+fd(g.from)+" · аз "+g.az.toFixed(0)+"°<br>"+(g.hard?"Не втримати навіть на +250 м":"Потрібно ≥ "+g.need+" м над землею")));
  });
  var bi=Math.max(1,a.best.good), bq=a.best.pts[bi];
  layer.addLayer(L.circleMarker([bq.lat,bq.lon],{radius:7,color:"#06131f",weight:2,fillColor:"#35d7ff",fillOpacity:1}).bindTooltip("Кінець стійкого зв'язку на найкращому напрямку"));
  window.__droneBounds=L.latLngBounds(a.rays.reduce(function(acc,r){ return acc.concat(r.pts.map(function(p){ return [p.lat,p.lon]; })); },[[currentLat,currentLon]]));
}

/* ---------- інтерфейс ---------- */
function build(){
  document.querySelector("nav").insertAdjacentHTML("beforeend","<button onclick=\"showTab('droneTab',this)\">🚁 Дрон</button>");
  var lab="flex:1;flex-direction:column;align-items:stretch";
  document.querySelector("#mapTab").parentElement.insertAdjacentHTML("beforeend",
    '<div id="droneTab" class="hidden"><div class="section"><h3>🚁 Зв\'язок антена ↔ дрон</h3>'+
    '<p class="note"><b>Як:</b> 1) місце антени → 2) сектор (напрямок, радіус, ширина) → 3) висоти й частота → «Проаналізувати». Усе, що потрібно, — у цій вкладці.</p>'+
    '<div class="row"><input id="dnPos" placeholder="Місце антени: 49.1234, 31.5678"><button class="primary" id="dnPosOk">OK</button></div>'+
    '<div class="row"><button class="secondary full" id="dnPosTap">🎯 На карті</button><button class="secondary full" id="dnPosCtr">⌖ Центр карти</button><button class="secondary full" id="dnPosGps">📍 GPS</button></div>'+
    '<div class="note" id="dnPosInfo" style="margin-bottom:6px"></div>'+
    '<div class="row"><label style="'+lab+'">Азимут сектора<input id="dnAz" type="text" inputmode="decimal"></label><label style="'+lab+'">Одиниці<select id="dnUnit"><option value="deg">градуси</option><option value="mil">тисячні</option></select></label></div>'+
    '<div class="row"><label style="'+lab+'">Радіус, км<input id="dnRk" type="number" value="3" step="0.5" min="0.2"></label><label style="'+lab+'">Ширина сектора, °<input id="dnW" type="number" value="60" min="10" max="180" step="5"></label></div>'+
    '<div class="row"><button class="secondary full" id="dnSec">🎯 Сектор по карті (напрямок + радіус)</button></div>'+
    '<div class="row"><label style="'+lab+'">Щогла (антена над землею), м<input id="dnAnt" type="number" value="3" step="0.5"></label><label style="'+lab+'">Дрон над землею, м<input id="dnH" type="number" value="100" step="10"></label></div>'+
    '<div class="row"><label style="'+lab+'">Частота<select id="dnF"><option value="0.433">433 МГц</option><option value="0.868">868/915 МГц</option><option value="1.2">1.2 ГГц</option><option value="2.4" selected>2.4 ГГц</option><option value="5.8">5.8 ГГц</option></select></label></div>'+
    '<button class="primary full" id="dnGo">🚁 Проаналізувати сектор</button><div class="note" id="dnStatus" style="margin-top:5px"></div></div>'+
    '<div class="section" id="dnVerdict" style="border:none;padding:0;background:none"></div>'+
    '<div class="section"><div class="note" id="dnHorizon" style="line-height:1.55">Радіогоризонт з\'явиться після аналізу.</div></div>'+
    '<div class="section"><div class="note" id="dnAntRes" style="line-height:1.55">Поради по антені з\'являться тут.</div></div>'+
    '<div class="section"><div class="note" id="dnFlightRes" style="line-height:1.55">Поради по польоту з\'являться тут.</div>'+
    '<button class="secondary full" id="dnMap" style="margin-top:6px">🗺️ Показати на карті</button></div>'+
    '<div class="section"><h3>📈 Профіль променя</h3><div class="row"><select id="dnRay"></select></div>'+
    '<svg id="dnSvg" viewBox="0 0 1000 250" style="width:100%;display:block;background:#06131f;border:1px solid #18384b;border-radius:8px"></svg>'+
    '<div class="note" style="margin-top:5px">Блакитне — рельєф; білий стовп — щогла; лінія польоту дрона: 🟢 стійко · 🟡 слабшає · 🔴 затінок; червоний пунктир — перекритий напрямок; фіолетовий — радіогоризонт.</div></div></div>');
  $("dnPosOk").onclick=function(){ var p=window.__parseCoords($("dnPos").value); if(!p){ toast("Не розпізнано координати. Приклад: 49.1234, 31.5678"); return; } window.__setPos(p.lat,p.lon,true); refresh(); };
  $("dnPos").addEventListener("keydown",function(e){ if(e.key==="Enter") $("dnPosOk").click(); });
  $("dnPosTap").onclick=function(){ window.__droneFromPos=true; setPointMode("ME"); };
  $("dnPosCtr").onclick=function(){ var c=map.getCenter(); window.__setPos(c.lat,c.lng,false); refresh(); toast("Місце антени = центр карти"); };
  $("dnPosGps").onclick=function(){ startGPS(); setTimeout(refresh,3000); };
  $("dnSec").onclick=function(){ window.__droneFromSec=true; setPointMode("AZ"); };
  $("dnUnit").onchange=function(){ var v=parseFloat(String($("dnAz").value).replace(",",".")); if(isFinite(v)) $("dnAz").value=this.value==="mil"?mil(v):(v*360/6000).toFixed(1); };
  $("dnGo").onclick=go; $("dnRay").onchange=chart;
  $("dnMap").onclick=function(){
    showTab("mapTab",document.querySelector("nav button:nth-child(1)"));
    if(window.__droneBounds) setTimeout(function(){ map.fitBounds(window.__droneBounds,{padding:[20,20]}); },150);
  };
  var _st=window.showTab;
  window.showTab=function(id,btn){
    if(id==="droneTab"){ _st("mapTab",btn); $("mapTab").classList.add("hidden"); $("droneTab").classList.remove("hidden"); refresh(); }
    else{ $("droneTab").classList.add("hidden"); _st(id,btn); }
  };
}
if(typeof window.showTab==="function") build();
})();
