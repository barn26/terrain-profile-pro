/* nogps.js — режим без GPS, ручна точка/азимут/радіус, виправлення, PWA.
   Підключається ОДНИМ рядком у <head> index.html: <script src="nogps.js"></script> */
(function(){
var $=function(i){return document.getElementById(i);};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){}return null;}
var gpsBlocked=ls("terrainGpsBlocked")!=="0";          /* за замовчуванням GPS ЗАБЛОКОВАНО */
var posSrc=null, phoneB=null, ring=null, installEv=null, tt=null;
var manualAz=parseFloat(ls("terrainManualAz")); if(!isFinite(manualAz)) manualAz=null;
var HS="https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}";

/* ---------- 1. Жорстка блокада геолокації (до будь-якого коду сторінки) ---------- */
var geo=navigator.geolocation;
if(geo){
  var gcp=geo.getCurrentPosition.bind(geo), gwp=geo.watchPosition.bind(geo);
  geo.getCurrentPosition=function(ok,err,o){ if(gpsBlocked){ if(err) err({code:1,message:"GPS заблоковано"}); return; } return gcp(ok,err,o); };
  geo.watchPosition=function(ok,err,o){ if(gpsBlocked){ if(err) err({code:1,message:"GPS заблоковано"}); return null; } return gwp(ok,err,o); };
}

/* ---------- 2. PWA + referrer (OSM-плитки не віддаються без Referer) ---------- */
var m=document.querySelector('meta[name="referrer"]'); if(m) m.content="origin";
[["manifest","manifest.webmanifest"],["apple-touch-icon","icon-192.png"]].forEach(function(a){
  var l=document.createElement("link"); l.rel=a[0]; l.href=a[1]; document.head.appendChild(l);
});
if("serviceWorker" in navigator) window.addEventListener("load",function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
window.addEventListener("beforeinstallprompt",function(e){ e.preventDefault(); installEv=e; var b=$("ngInstall"); if(b) b.classList.remove("hidden"); });

var st=document.createElement("style");
st.textContent=".mode{grid-template-columns:1fr 1fr 1fr!important}button:disabled{opacity:.45;cursor:not-allowed}"+
".toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);max-width:90vw;background:rgba(5,16,26,.96);border:1px solid #24546b;border-radius:9px;padding:9px 12px;font-size:12px;z-index:9000;opacity:0;pointer-events:none;transition:opacity .2s;color:#e8f4ff}.toast.show{opacity:1}";
document.head.appendChild(st);

/* ---------- утиліти ---------- */
function toast(t){ var e=$("ngToast"); if(!e){ e=document.createElement("div"); e.id="ngToast"; e.className="toast"; document.body.appendChild(e); }
  e.textContent=t; e.classList.add("show"); clearTimeout(tt); tt=setTimeout(function(){ e.classList.remove("show"); },3800); }

/* "49.1234, 31.5678" | "49,1234 31,5678" | "49°07'24"N 31°27'20"E" */
function parseCoords(str){
  var s=String(str||"").trim(), lat, lon, t;
  if(!s) return null;
  if(!/[°º′″'"NSEWnsew]/.test(s)){
    t=s.match(/-?\d+(?:[.,]\d+)?/g);
    if(!t||t.length!==2) return null;
    lat=parseFloat(t[0].replace(",",".")); lon=parseFloat(t[1].replace(",","."));
  }else{
    t=s.match(/\d+(?:[.,]\d+)?/g);
    if(!t||t.length%2||t.length>6) return null;
    var h=t.length/2, conv=function(a){ return a.reduce(function(acc,v,i){ return acc+parseFloat(v.replace(",","."))/Math.pow(60,i); },0); };
    lat=conv(t.slice(0,h)); lon=conv(t.slice(h));
    var up=s.toUpperCase(); if(up.indexOf("S")>=0) lat=-lat; if(up.indexOf("W")>=0) lon=-lon;
  }
  if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
  return {lat:lat,lon:lon};
}
window.__parseCoords=parseCoords;

function dist(){ var i=$("ngDist"), c=i?Number(i.value):0; if(c>0) return Math.min(c,100000); return Number($("distance").value)||1000; }

function ringUpdate(){
  if(!map) return;
  if(currentLat==null||bearingSource==="ab"){ if(ring){ map.removeLayer(ring); ring=null; } return; }
  var r=dist();
  if(ring){ ring.setLatLng([currentLat,currentLon]); ring.setRadius(r); }
  else ring=L.circle([currentLat,currentLon],{radius:r,color:"#65ffb3",weight:1,opacity:.55,dashArray:"4 6",fill:false,interactive:false}).addTo(map);
  updateDirectionGraphic();
}

function setPos(lat,lon,center,skipSave){
  currentLat=lat; currentLon=lon; currentAccuracy=null; currentGpsAltitude=null; posSrc="manual";
  $("lat").textContent=lat.toFixed(6); $("lon").textContent=lon.toFixed(6);
  $("accuracy").textContent="ручна"; $("gpsAlt").textContent="—";
  if(gpsBlocked) setGpsStatus("заблоковано · ручна точка","warn");
  if(accuracyCircle&&map){ map.removeLayer(accuracyCircle); accuracyCircle=null; }
  updateUserMarker();
  if(center&&map) map.setView([lat,lon],Math.max(map.getZoom(),14));
  $("ngCoords").value=lat.toFixed(6)+", "+lon.toFixed(6);
  if(!skipSave) ls("terrainManualPos",JSON.stringify({lat:lat,lon:lon}));
  ringUpdate();
}
function setAz(deg){
  manualAz=normalizeBearing(deg); ls("terrainManualAz",String(manualAz));
  $("ngAz").value=$("ngUnit").value==="mil"?Math.round(manualAz*6000/360):manualAz.toFixed(1);
}
function readAz(){
  var v=parseFloat(String($("ngAz").value).replace(",","."));
  if(!isFinite(v)) return;
  manualAz=normalizeBearing($("ngUnit").value==="mil"?v*360/6000:v); ls("terrainManualAz",String(manualAz));
  if(bearingSource==="manual"){ currentBearing=manualAz; updateCompassUI(); ringUpdate(); }
}
function place(k,ll){
  if(k==="ME"){ setPos(ll.lat,ll.lng,false); toast("Ваше місце: "+ll.lat.toFixed(5)+", "+ll.lng.toFixed(5)); return; }
  if(currentLat==null){ toast("Спочатку задайте своє місце."); return; }
  var d=getDistance(currentLat,currentLon,ll.lat,ll.lng);
  $("ngDist").value=Math.round(d);
  setAz(getBearing(currentLat,currentLon,ll.lat,ll.lng));
  setDirectionMode("manual");
  toast("Азимут "+manualAz.toFixed(1)+"° · дальність "+formatDistance(d));
}
function applyBlockUI(){
  var b=$("ngBlock"), n=$("ngNote"), fix=document.querySelector('button[onclick="startGPS()"]'), live=$("gpsLiveBtn");
  if(gpsBlocked){
    b.className="danger full"; b.textContent="🚫 GPS ЗАБЛОКОВАНО — натисніть, щоб дозволити";
    n.textContent="Застосунок не звертається до геолокації. Задайте місце вручну: координати, тап по карті або центр карти.";
    if(gpsWatch!==null&&navigator.geolocation){ navigator.geolocation.clearWatch(gpsWatch); gpsWatch=null; }
    gpsLive=false; live.textContent="GPS LIVE: ВИМК."; live.classList.remove("primary");
    setGpsStatus("заблоковано","warn");
  }else{
    b.className="secondary full"; b.textContent="🛰️ GPS ДОЗВОЛЕНО — натисніть, щоб заблокувати";
    n.textContent="GPS вмикається тільки кнопкою «Моє місце».";
    if(posSrc!=="gps") setGpsStatus("не визначено","warn");
  }
  if(fix) fix.disabled=gpsBlocked; live.disabled=gpsBlocked;
}

/* ---------- 3. Вбудовування інтерфейсу ---------- */
function injectUI(){
  var sec=document.querySelector(".left .section"); /* «Моє положення» */
  sec.querySelector("h3").insertAdjacentHTML("afterend",
    '<div class="row"><button class="danger full" id="ngBlock"></button></div><div class="note" id="ngNote" style="margin-bottom:5px"></div>'+
    '<div class="row"><input id="ngCoords" placeholder="Координати: 49.1234, 31.5678"><button class="primary" id="ngCoordsOk">OK</button></div>'+
    '<div class="row"><button class="secondary full" id="ngTap">🎯 Точка на карті</button><button class="secondary full" id="ngCenter">⌖ Центр карти</button></div>');
  $("ngBlock").onclick=function(){ gpsBlocked=!gpsBlocked; ls("terrainGpsBlocked",gpsBlocked?"1":"0"); applyBlockUI(); };
  $("ngCoordsOk").onclick=function(){ var p=parseCoords($("ngCoords").value); if(!p){ toast("Не розпізнано. Приклад: 49.1234, 31.5678 або 49°07'24\"N 31°27'20\"E"); return; } setPos(p.lat,p.lon,true); };
  $("ngCoords").addEventListener("keydown",function(e){ if(e.key==="Enter") $("ngCoordsOk").click(); });
  $("ngTap").onclick=function(){ setPointMode("ME"); };
  $("ngCenter").onclick=function(){ var c=map.getCenter(); setPos(c.lat,c.lng,false); toast("Місце = центр карти"); };

  $("abMode").insertAdjacentHTML("afterend",'<button id="manualMode">🎚 Азимут</button>');
  $("manualMode").onclick=function(){ setDirectionMode("manual"); };
  document.querySelector('button[onclick="enableCompass()"]').insertAdjacentHTML("beforebegin",
    '<div id="ngAzBox" class="hidden"><div class="row"><input id="ngAz" type="text" inputmode="decimal" placeholder="Азимут"><select id="ngUnit"><option value="deg">градуси 0–360</option><option value="mil">тисячні 0–6000</option></select></div>'+
    '<button class="secondary full" id="ngAzMap" style="margin-bottom:5px">🎯 Азимут і дальність тапом по карті</button></div>');
  $("ngAz").addEventListener("input",readAz);
  $("ngUnit").onchange=function(){ if(manualAz!=null) setAz(manualAz); };
  $("ngAzMap").onclick=function(){ setPointMode("AZ"); };

  var pts=$("points"); pts.add(new Option("81 точка","81")); pts.add(new Option("100 точок","100"));
  var calc=document.querySelector('button[onclick="calculateProfile()"]');
  calc.insertAdjacentHTML("beforebegin",'<div class="row"><input id="ngDist" type="number" min="10" step="10" placeholder="Або своя дистанція (радіус), м"></div>');
  $("ngDist").addEventListener("input",ringUpdate); $("distance").addEventListener("change",ringUpdate);

  $("networkTab").querySelector(".section").insertAdjacentHTML("beforeend",
    '<p class="note"><b>📲 Встановлення:</b> Android/Chrome — кнопка «⬇ Встановити» зверху або меню ⋮ → «Встановити». iPhone — Safari → «Поділитись» → «На початковий екран».</p>'+
    '<p class="note"><b>🔒 Що йде в мережу:</b> завантаження плиток карти (раніше переглянуті області беруться з кешу), запити висот (Open-Meteo / OpenTopoData — координати точок профілю), Overpass (вишки/інфраструктура, лише за кнопкою) та Nominatim (пошук місця). Геолокація пристрою не використовується, поки GPS заблоковано.</p>');
  $("savedList").insertAdjacentHTML("afterend",'<button class="danger full" id="ngWipe" style="margin-top:8px">🧹 Стерти всі дані застосунку</button>');
  $("ngWipe").onclick=function(){
    if(!confirm("Стерти розрахунки, ручну точку, калібровку й кеш карт на цьому пристрої?")) return;
    try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
    (window.caches?caches.keys().then(function(k){ return Promise.all(k.map(function(x){ return caches.delete(x); })); }):Promise.resolve()).then(function(){ location.reload(); });
  };
  document.querySelector(".status").insertAdjacentHTML("beforeend",'<button class="secondary hidden" id="ngInstall" style="padding:3px 7px;min-height:24px;font-size:10px">⬇ Встановити</button>');
  if(installEv) $("ngInstall").classList.remove("hidden");
  $("ngInstall").onclick=function(){ if(!installEv) return; installEv.prompt(); installEv=null; $("ngInstall").classList.add("hidden"); };

  /* вишки: без автоматичних мережевих запитів */
  antennasEnabled=false; $("antennaBtn").textContent="📡 Пошук по карті: ВИМК."; $("antennaStatus").textContent="Вимкнено (без зайвих запитів). Увімкніть кнопкою вище.";
}

/* ---------- 4. Перевизначення функцій оригіналу ---------- */
function overrides(){
  var _sg=window.startGPS, _tl=window.toggleGPSLive, _gs=window.gpsSuccess, _calc=window.calculateProfile,
      _usd=window.useScanDirection, _rs=window.restoreSaved, _ua=window.useAB, _init=window.initApp;

  window.startGPS=function(){ if(gpsBlocked){ toast("GPS заблоковано. Задайте місце вручну або дозвольте GPS."); return; } _sg(); };
  window.toggleGPSLive=function(){ if(gpsBlocked){ toast("GPS заблоковано."); return; } _tl(); };
  window.gpsSuccess=function(p){ if(gpsBlocked) return; posSrc="gps"; _gs(p); ringUpdate(); };

  window.setPointMode=function(p){
    placingPoint=p;
    toast({A:"Торкніться карти — точка A.",B:"Торкніться карти — точка B.",ME:"Торкніться карти — це буде ваше місце.",AZ:"Торкніться карти — азимут і дальність від вашого місця."}[p]||"Торкніться карти.");
    try{ showTab("mapTab",document.querySelector("nav button:nth-child(1)")); }catch(e){}
  };

  window.updateUserMarker=function(){
    if(!map||currentLat==null||currentLon==null) return;
    var ll=[currentLat,currentLon], man=posSrc==="manual", col=man?"#ffb347":"#35d7ff";
    if(!userMarker) userMarker=L.circleMarker(ll,{radius:7,weight:2,fillOpacity:.9}).addTo(map); else userMarker.setLatLng(ll);
    userMarker.setStyle({color:col,fillColor:col});
    if(!man){
      if(!accuracyCircle) accuracyCircle=L.circle(ll,{radius:currentAccuracy||20,color:"#35d7ff",weight:1,opacity:.3,fillOpacity:.04}).addTo(map);
      else accuracyCircle.setLatLng(ll).setRadius(currentAccuracy||20);
    }
    if(!map._gpsCentered){ map.setView(ll,15); map._gpsCentered=true; }
  };

  /* Компас більше не перемикає режим на «телефон» і не затирає азимут/A→B */
  window.handleOrientation=function(e){
    if(typeof e.beta==="number"&&isFinite(e.beta)){ rangeLastBeta=e.beta; updateRangefinderAngleHud(); }
    var h=null;
    if(typeof e.webkitCompassHeading==="number"&&isFinite(e.webkitCompassHeading)){
      h=e.webkitCompassHeading;
      if(typeof e.webkitCompassAccuracy==="number"&&isFinite(e.webkitCompassAccuracy)&&e.webkitCompassAccuracy>=0) compassAccuracy=e.webkitCompassAccuracy;
    }else if(typeof e.alpha==="number") h=360-e.alpha;
    if(h==null||!isFinite(h)) return;
    var sc=applyScreenCorrection(normalizeBearing(h)); rawHeading=sc; h=applyCalibration(sc);
    if(!headingInitialized){ stableHeading=h; headingInitialized=true; }
    else{
      var d=shortestAngleDifference(stableHeading,h);
      if(Math.abs(d)>=COMPASS_DEADBAND) stableHeading=normalizeBearing(stableHeading+d*COMPASS_SMOOTHING);
    }
    phoneB=stableHeading;
    if(bearingSource==="phone"){ currentBearing=stableHeading; updateDirectionGraphic(); }
    updateCompassUI();
  };
  window.updateCompassUI=function(){
    var f=function(id,t){ var x=$(id); if(x) x.textContent=t; };
    if(phoneB!=null){
      var p=Math.round(phoneB*10)/10;
      f("compassValue",p.toFixed(1)+"°"); f("compassDirection",bearingName(Math.round(phoneB)));
      f("compassAccuracy",compassAccuracy!=null?"±"+compassAccuracy.toFixed(1)+"°":"—");
      var ar=$("compassArrow"); if(ar) ar.style.transform="rotate("+p+"deg)";
      f("compassBadge","🧭 "+p.toFixed(1)+"°");
    }
    if(currentBearing!=null){
      var b=Math.round(currentBearing*10)/10;
      f("bearing",b.toFixed(1)+"°"); f("bearingText",bearingName(Math.round(currentBearing)));
      f("hudBearing",b.toFixed(1)+"° · "+Math.round(b*6000/360)+" т"); f("hudDirection",bearingName(Math.round(currentBearing)));
    }
    updateMapRotation();
  };

  window.setDirectionMode=function(mode){
    bearingSource=mode;
    ["phone","ab","manual"].forEach(function(k){ var el=$(k+"Mode"); if(el) el.classList.toggle("active",k===mode); });
    $("ngAzBox").classList.toggle("hidden",mode!=="manual");
    var t=$("modeText");
    if(mode==="phone"){ t.textContent="🧭 Напрямок з компаса телефона (компас не потребує GPS)."; if(phoneB!=null) currentBearing=phoneB; }
    else if(mode==="manual"){
      t.textContent="🎚 Азимут задається вручну (градуси/тисячні) або тапом по карті. Ні GPS, ні компас не потрібні.";
      if(manualAz==null&&currentBearing!=null) setAz(currentBearing);
      if(manualAz!=null) currentBearing=manualAz;
    }else t.textContent="📍 Напрямок і дальність — між точками A (TX) та B (RX).";
    ringUpdate(); updateCompassUI();
  };
  window.updateDirectionGraphic=function(){
    if(!map||currentLat==null||currentBearing==null||bearingSource==="ab") return;
    var d=dist(), end=destination(currentLat,currentLon,currentBearing,d), pts=[[currentLat,currentLon],[end.lat,end.lon]];
    if(!directionLine) directionLine=L.polyline(pts,{color:"#35d7ff",weight:3,opacity:.92}).addTo(map);
    else{ directionLine.setLatLngs(pts); directionLine.setStyle({color:"#35d7ff"}); }
    var sp=makeSector(currentLat,currentLon,currentBearing,12,d);
    if(!directionSector) directionSector=L.polygon(sp,{color:"#35d7ff",weight:1,opacity:.3,fillColor:"#35d7ff",fillOpacity:.07}).addTo(map);
    else directionSector.setLatLngs(sp);
  };
  window.useAB=function(){ _ua(); if(pointA&&pointB) setDirectionMode("ab"); };

  /* ручний азимут + своя дистанція підставляються у оригінальний розрахунок */
  window.calculateProfile=function(){
    var src=bearingSource, cb=currentBearing, sel=$("distance"), prev=sel.value, o=null, c=Number($("ngDist").value);
    if(src==="manual"){
      if(manualAz==null){ toast("Введіть азимут."); return; }
      bearingSource="phone"; currentBearing=manualAz;
    }
    if(c>0&&src!=="ab"){ c=Math.min(c,100000); o=new Option(c+" м",String(c)); sel.add(o); sel.value=String(c); }
    var r; try{ r=_calc(); }finally{
      bearingSource=src; currentBearing=cb;
      if(o){ sel.remove(o.index); sel.value=prev; }
    }
    return r;
  };
  window.useScanDirection=function(b){
    _usd(b);
    var r=lastScan&&lastScan.results.find(function(x){ return Math.abs(x.bearing-b)<.01; });
    if(r){ setAz(r.bearing); setDirectionMode("manual"); }
  };
  window.restoreSaved=function(i){
    var s=null; try{ s=JSON.parse(ls("terrainSaved54")||"[]")[i]; }catch(e){}
    _rs(i);
    if(s){ posSrc="manual"; setAz(s.bearing); setDirectionMode("manual"); }
  };

  /* Скан 360°: ліміт API — 100 координат на запит, шматки послідовно */
  window.getElevationsBatched=async function(points){
    var out=[];
    for(var i=0;i<points.length;i+=100) out=out.concat(await getElevations(points.slice(i,i+100)));
    return out;
  };

  window.initApp=function(){
    if(map) return;
    _init();
    if(hillshadeLayer){ hillshadeLayer.setUrl(HS); hillshadeLayer.options.maxNativeZoom=16; } /* старий tiles.wmflabs.org не працює */
    map.on("click",function(e){
      if(placingPoint!=="ME"&&placingPoint!=="AZ") return;
      var ll=e.latlng; if(mapRotationDeg){ var c=correctedLatLngFromEvent(e.originalEvent); if(c) ll=c; }
      var k=placingPoint; placingPoint=null; place(k,ll);
    });
    var s=null; try{ s=JSON.parse(ls("terrainManualPos")||"null"); }catch(x){}
    if(s&&isFinite(s.lat)&&isFinite(s.lon)&&currentLat==null) setPos(s.lat,s.lon,true,true);
    if(manualAz!=null) setAz(manualAz);
    ringUpdate();
  };
}

function boot(){ injectUI(); overrides(); applyBlockUI(); }
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
