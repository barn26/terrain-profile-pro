/* drone.js — планувальник зв'язку з дроном: антена + політ у секторі. Підтягується з nogps.js */
(function(){
var $=function(i){return document.getElementById(i);};
var toast=function(t){ if(window.__toast) window.__toast(t); else alert(t); };
var num=function(id,d){ var v=parseFloat(String($(id).value).replace(",",".")); return isFinite(v)?v:d; };
var COL={ok:"#65ffb3",warn:"#ffd166",bad:"#ff6b7a"}, M=20, layer=null;
var mil=function(a){ return Math.round(a*6000/360); };

function radius(){ var c=$("ngDist")?Number($("ngDist").value):0; return c>0?Math.min(c,100000):(Number($("distance").value)||1000); }

/* стан кожної точки променя: ok — Френель вільна ≥60%, warn — слабшає, bad — затінок */
function evalRay(pts,hA,H,f){
  var o=[];
  for(var i=1;i<pts.length;i++){
    var r=computeRadioLink(pts.slice(0,i+1),hA,H,f).minRatio;
    o.push(r>=.6?"ok":(r>=0?"warn":"bad"));
  }
  return o;
}
/* мінімальна висота дрона (над землею), за якої в точці i зв'язок знову стійкий */
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

/* чисте ядро: rays=[{az,pts:[{distance,elevation,lat,lon}]}] */
function analyze(rays,hA,H,f,R,c){
  rays.forEach(function(r){
    r.st=evalRay(r.pts,hA,H,f);
    var g=0; while(g<r.st.length&&r.st[g]==="ok") g++;
    r.good=g; r.iBad=r.st.indexOf("bad"); r.reach=R*g/M;
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
  var risks=[];
  rays.forEach(function(r){
    if(r.iBad>=0) risks.push({az:r.az,d:R*(r.iBad+1)/M,need:needH(r.pts,r.iBad+1,hA,H,f),idx:r.iBad+1,ray:r});
  });
  risks.sort(function(a,b){ return a.d-b.d; });
  return {best:best,tilt:tilt,cands:cands,rec:rec,risks:risks,base:cands[0].c};
}
window.__droneAnalyze=analyze;

function refreshInfo(){
  var e=$("dnSecInfo"); if(!e) return;
  e.textContent=currentBearing==null?"Напрямок не задано.":("Центр сектора: "+currentBearing.toFixed(1)+"° ("+mil(currentBearing)+" т) · радіус: "+formatDistance(radius())+(currentLat==null?" · місце не задано":""));
}

async function go(){
  if(currentLat==null){ toast("Спочатку задайте своє місце (GPS або вручну)."); return; }
  if(currentBearing==null){ toast("Задайте напрямок сектора (азимут)."); return; }
  var W=Math.max(10,Math.min(180,num("dnW",60))), hA=num("dnAnt",3), H=num("dnH",100), f=Number($("dnF").value), R=radius(), c=currentBearing;
  var nr=Math.max(3,Math.min(7,Math.round(W/10)+1)), st=$("dnStatus");
  var rays=[], flat=[];
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
    var a=analyze(rays,hA,H,f,R,c);
    render(a,rays,{W:W,hA:hA,H:H,f:f,R:R,c:c});
    st.textContent="Готово. Маркери й кольорові промені показано на карті.";
  }catch(e){ console.error(e); st.textContent="Не вдалося отримати висоти (потрібен інтернет). Спробуйте ще раз."; }
  $("dnGo").disabled=false;
}

function render(a,rays,P){
  var b=a.best, bm=mil(b.az), t=a.tilt, rec=a.rec, base=a.base;
  var tiltTxt=(t.avg>=0?"+":"")+t.avg.toFixed(1)+"° "+(t.avg>=0?"↑ вгору":"↓ вниз");
  var heightTxt=rec.h>P.hA?("підняти до <b>"+rec.h+" м</b> (+"+(rec.h-P.hA)+" м): стійкий зв'язок "+base.ok+"% → "+rec.c.ok+"%, затінок "+base.bad+"% → "+rec.c.bad+"%"):("поточна <b>"+P.hA+" м</b> достатня (піднімання майже нічого не дає)");
  var row=a.cands.map(function(x){ return x.h+" м: "+x.c.ok+"% / "+x.c.bad+"%"; }).join(" · ");
  var weak=base.ok<60?"<br>⚠️ Сектор погано прикритий рельєфом. Якщо підняти антену неможливо — перенесіть її на найвище місце поруч (гребінь, узвишшя).":"";
  $("dnAntRes").innerHTML=
    "<b>📡 Антена</b><br>• Азимут: <b>"+b.az.toFixed(0)+"° ("+bm+" т)</b> — найкращий напрямок; центр сектора "+P.c.toFixed(0)+"°.<br>"+
    "• Нахил: <b>"+tiltTxt+"</b> (діапазон "+t.min.toFixed(1)+"…"+t.max.toFixed(1)+"°).<br>"+
    "• Висота: "+heightTxt+".<br>"+
    "<span class=\"note\">Покриття «стійкий / затінок» за висотою антени: "+row+"</span>"+weak;

  var f="<b>🚁 Політ</b><br>• Найстабільніший напрямок: <b>"+b.az.toFixed(0)+"° ("+bm+" т)</b> — стійкий зв'язок до <b>"+formatDistance(Math.max(b.reach,0))+"</b>"+(b.reach>=P.R?" (весь радіус)":"")+".<br>";
  var reaches=rays.map(function(r){ return r.reach; });
  f+="• По сектору стійкий зв'язок: від "+formatDistance(Math.min.apply(null,reaches))+" до "+formatDistance(Math.max.apply(null,reaches))+".<br>";
  if(a.risks.length){
    f+="• <b>Обережно</b> (втрата зв'язку за рельєфом):<br>";
    a.risks.slice(0,4).forEach(function(r){
      f+="&nbsp;&nbsp;⚠ аз "+r.az.toFixed(0)+"° · "+formatDistance(r.d)+": "+(r.need?"тримайте ≥ <b>"+r.need+" м</b> над землею":"навіть на +250 м зв'язок не гарантований — не заходьте за цей гребінь")+"<br>";
    });
    f+="• Порада: летіть по зеленому променю, перед жовтими/червоними ділянками набирайте висоту, не ховайтесь за гребені й пагорби.";
  }else f+="• Затінених ділянок у секторі на цій висоті не виявлено — летіть будь-яким напрямком усередині сектора.";
  f+="<br><span class=\"note\">Оцінка по рельєфу SRTM (≈90 м) без будівель і лісу, дрон на сталій висоті над землею. Реальний зв'язок залежить ще від потужності, чутливості й завад — тримайте запас.</span>";
  $("dnFlightRes").innerHTML=f;

  if(layer) layer.clearLayers(); else layer=L.layerGroup().addTo(map);
  layer.addLayer(L.polygon(makeSector(currentLat,currentLon,P.c,P.W/2,P.R),{color:"#35d7ff",weight:1,dashArray:"4 4",fillOpacity:.04,interactive:false}));
  rays.forEach(function(r){
    var isBest=r===b;
    r.st.forEach(function(s,i){
      layer.addLayer(L.polyline([[r.pts[i].lat,r.pts[i].lon],[r.pts[i+1].lat,r.pts[i+1].lon]],{color:COL[s],weight:isBest?5:3,opacity:.9,interactive:false}));
    });
    var iw=r.st.findIndex(function(s){ return s!=="ok"; });
    if(iw>=0&&r.iBad!==iw){
      var q=r.pts[iw+1];
      layer.addLayer(L.circleMarker([q.lat,q.lon],{radius:5,color:"#06131f",weight:1,fillColor:COL.warn,fillOpacity:1}).bindTooltip("Зв'язок слабшає · "+formatDistance(r.pts[iw+1].distance)+" · аз "+r.az.toFixed(0)+"°"));
    }
  });
  a.risks.forEach(function(r){
    var q=r.ray.pts[r.idx];
    layer.addLayer(L.circleMarker([q.lat,q.lon],{radius:8,color:"#06131f",weight:2,fillColor:COL.bad,fillOpacity:1})
      .bindTooltip("⚠ Втрата зв'язку · "+formatDistance(r.d)+" · аз "+r.az.toFixed(0)+"°<br>"+(r.need?"Потрібно ≥ "+r.need+" м над землею":"Не гарантовано навіть на +250 м"),{permanent:false}));
  });
  var q=b.pts[b.pts.length-1];
  layer.addLayer(L.circleMarker([b.pts[Math.max(1,b.good)].lat,b.pts[Math.max(1,b.good)].lon],{radius:7,color:"#06131f",weight:2,fillColor:"#35d7ff",fillOpacity:1}).bindTooltip("Кінець стійкого зв'язку на найкращому напрямку"));
  window.__droneBounds=L.latLngBounds(rays.reduce(function(acc,r){ return acc.concat(r.pts.map(function(p){ return [p.lat,p.lon]; })); },[[currentLat,currentLon]]));
}

function build(){
  document.querySelector("nav").insertAdjacentHTML("beforeend","<button onclick=\"showTab('droneTab',this)\">🚁 Дрон</button>");
  var lab="flex:1;flex-direction:column;align-items:stretch";
  document.querySelector("#mapTab").parentElement.insertAdjacentHTML("beforeend",
    '<div id="droneTab" class="hidden"><div class="section"><h3>🚁 Зв\'язок з дроном: антена та маршрут</h3>'+
    '<p class="note">Сектор — це ваша точка + напрямок (азимут) + радіус + ширина. Задайте напрямок і радіус тапом по карті або в лівій панелі.</p>'+
    '<div class="row"><button class="secondary full" id="dnSec">🎯 Сектор по карті (напрямок + радіус)</button></div>'+
    '<div class="note" id="dnSecInfo" style="margin-bottom:5px"></div>'+
    '<div class="row"><label style="'+lab+'">Ширина сектора, °<input id="dnW" type="number" value="60" min="10" max="180" step="5"></label>'+
    '<label style="'+lab+'">Антена над землею, м<input id="dnAnt" type="number" value="3" step="0.5"></label></div>'+
    '<div class="row"><label style="'+lab+'">Дрон над землею, м<input id="dnH" type="number" value="100" step="10"></label>'+
    '<label style="'+lab+'">Частота<select id="dnF"><option value="0.433">433 МГц</option><option value="0.868">868/915 МГц</option><option value="1.2">1.2 ГГц</option><option value="2.4" selected>2.4 ГГц</option><option value="5.8">5.8 ГГц</option></select></label></div>'+
    '<button class="primary full" id="dnGo">🚁 Проаналізувати сектор</button><div class="note" id="dnStatus" style="margin-top:5px"></div></div>'+
    '<div class="section"><div class="note" id="dnAntRes" style="line-height:1.55">Результат по антені з\'явиться тут.</div></div>'+
    '<div class="section"><div class="note" id="dnFlightRes" style="line-height:1.55">Поради по польоту з\'являться тут.</div>'+
    '<button class="secondary full" id="dnMap" style="margin-top:6px">🗺️ Показати на карті</button>'+
    '<div class="note" style="margin-top:5px">🟢 стійкий зв\'язок · 🟡 слабшає · 🔴 затінок рельєфом · ⚠ місце, де зв\'язок обривається.</div></div></div>');
  $("dnSec").onclick=function(){ window.__droneFromSec=true; setPointMode("AZ"); };
  $("dnGo").onclick=go;
  $("dnMap").onclick=function(){
    showTab("mapTab",document.querySelector("nav button:nth-child(1)"));
    if(window.__droneBounds) setTimeout(function(){ map.fitBounds(window.__droneBounds,{padding:[20,20]}); },150);
  };
  var _st=window.showTab;
  window.showTab=function(id,btn){
    if(id==="droneTab"){ _st("mapTab",btn); $("mapTab").classList.add("hidden"); $("droneTab").classList.remove("hidden"); refreshInfo(); }
    else{ $("droneTab").classList.add("hidden"); _st(id,btn); }
  };
}
if(typeof window.showTab==="function") build();
})();
