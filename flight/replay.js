/* EI100 telemetry interpolation and replay. All inferred positions are labeled. */
(() => {
  const $ = id => document.getElementById(id);
  const FLIGHT_START = Date.parse("2026-11-06T23:00:00Z");
  const FLIGHT_END = Date.parse("2026-11-07T08:30:00Z");
  const MAX_PROJECTION_MIN = 15;
  const LOCAL_KEY = "ei100-received-positions-v1";
  const css = document.createElement("style");
  css.textContent = ".replaybox{margin:16px 0;background:#102e3d;border:1px solid #386479;border-radius:14px;padding:17px}.replay-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.replay-head b{font-size:17px}.replay-head small{display:block;line-height:1.5}.replay-status{color:#a5e6ca;font-size:12px;font-weight:700}.replay-controls{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px}.replay-controls button{background:#22475a;color:#e8f6fa;border:1px solid #487487;border-radius:8px;padding:9px 12px;cursor:pointer}.replay-controls button.active{background:#236b50;border-color:#66dba1}.replay-controls button:disabled{opacity:.4}.replaybox input[type=range]{width:100%;accent-color:#55e4a0;margin:15px 0}.replay-foot{font-size:12px;color:#acc5d0;line-height:1.55}.replay-measure{display:flex;justify-content:space-between;gap:10px}.replay-measure span{color:#b5d9e9;font-size:12px}.replay-legend{font-size:11px;color:#a8c5cf;margin-top:8px}.replay-legend .dot{display:inline-block;background:#f9cb66;height:8px;width:8px;border-radius:50%;margin:0 5px 0 9px}";
  document.head.append(css);
  const section=document.createElement("section");
  section.className="replaybox";section.id="replaybox";
  section.innerHTML='<div class="replay-head"><div><div class="eyebrow">FLIGHT TRACK & REPLAY</div><b>Actual reports vs estimated position</b><small>Showing timestamps and uncertainty, never simulated data as telemetry.</small></div><div class="replay-status" id="ageLabel">Loading…</div></div>'+
    '<div class="replay-controls"><button id="backLive" class="active">● Live / latest</button><button id="playReplay" disabled>▶ Play track</button><button id="saveReplay">↓ Save JSON</button></div>'+
    '<input type="range" id="replaySlider" min="0" max="1000" value="0" disabled aria-label="Scrub the recorded flight track">'+
    '<div class="replay-measure"><span id="replayClock">No flight data loaded</span><span id="replayCount">0 reports</span></div>'+
    '<div class="replay-foot" id="replayDetails">Waiting for actual ADS-B records.</div>'+
    '<div class="replay-legend">● Green: last observed position <span class="dot"></span> Amber: inferred between observations / short-term projection. Data gaps are not filled with fake reports.</div>';
  document.querySelector(".progress").insertAdjacentElement("afterend",section);

  let points=[],latest=null,isReplay=false,isPlaying=false,replayTime=null,previousFrame=0;
  let actualMarker=null,previewMarker=null,pathLayer=null;
  const time = s => Date.parse(s);
  const valid = p => p && Number.isFinite(time(p.t)) && typeof p.lat==="number" && typeof p.lon==="number";
  function fmt(ms){return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false,month:"short",day:"numeric"}).format(new Date(ms))+" NY";}
  function merge(items){
    if(!Array.isArray(items))return;
    const keys=new Map(points.map(p=>[p.t,p]));
    for(const p of items){
      if(!valid(p))continue;
      const t=time(p.t);
      if(t<FLIGHT_START||t>FLIGHT_END)continue;
      keys.set(new Date(t).toISOString(),{...p,t:new Date(t).toISOString()});
    }
    points=[...keys.values()].sort((a,b)=>time(a.t)-time(b.t)).slice(-2400);
    try{localStorage.setItem(LOCAL_KEY,JSON.stringify(points));}catch(e){}
    $("replayCount").textContent=points.length+" report"+(points.length===1?"":"s");
    $("playReplay").disabled=points.length<2;
    $("replaySlider").disabled=points.length<2;
    drawHistory();
  }
  function drawHistory(){
    if(!window.L||!map||points.length<2)return;
    if(pathLayer)map.removeLayer(pathLayer);
    const lines=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],delta=(time(b.t)-time(a.t))/60000;
      lines.push(L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{color:delta>8?"#f3ad5d":"#53dfaf",weight:3,opacity:delta>8?.5:.85,dashArray:delta>8?"5 9":null}));
    }
    pathLayer=L.layerGroup(lines).addTo(map);
  }
  function moveMarker(p,mode){
    if(!map||!window.L)return;
    const ll=[p.lat,p.lon];
    if(!previewMarker){
      previewMarker=L.circleMarker(ll,{radius:9,weight:3,color:"#fff",fillColor:"#fac55d",fillOpacity:.95}).addTo(map);
    } else previewMarker.setLatLng(ll);
    if(mode==="replay")map.panTo(ll,{animate:true,duration:.3});
  }
  function actualPosition(p){
    if(!map||!window.L||!p)return;
    const ll=[p.lat,p.lon];
    if(!actualMarker)actualMarker=L.circleMarker(ll,{radius:6,color:"#6cffb1",fillColor:"#239b68",weight:2,fillOpacity:1}).addTo(map);
    else actualMarker.setLatLng(ll);
  }
  function project(p,minutes){
    // Great-circle destination from most recent observed lat/lon,
    // current reported heading and *ground* speed. This is dead reckoning,
    // not a real position or a guarantee of the route ahead.
    const gs=p.ground_speed_kt,heading=p.track_deg;
    if(typeof gs!=="number"||typeof heading!=="number"||minutes<0||minutes>MAX_PROJECTION_MIN)return null;
    const θ=heading*Math.PI/180,φ1=p.lat*Math.PI/180,λ1=p.lon*Math.PI/180;
    const d=(gs*1.852*minutes/60)/6371.0088;
    const φ2=Math.asin(Math.sin(φ1)*Math.cos(d)+Math.cos(φ1)*Math.sin(d)*Math.cos(θ));
    const λ2=λ1+Math.atan2(Math.sin(θ)*Math.sin(d)*Math.cos(φ1),Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
    return {...p,lat:φ2*180/Math.PI,lon:((λ2*180/Math.PI+540)%360)-180,estimated:true};
  }
  function interp(a,b,t){
    const proportion=(t-time(a.t))/(time(b.t)-time(a.t));
    if(proportion<=0)return a;if(proportion>=1)return b;
    return {lat:a.lat+(b.lat-a.lat)*proportion,lon:a.lon+(b.lon-a.lon)*proportion,
      alt_baro_ft:(typeof a.alt_baro_ft==="number"&&typeof b.alt_baro_ft==="number")?a.alt_baro_ft+(b.alt_baro_ft-a.alt_baro_ft)*proportion:null,
      ground_speed_kt:(typeof a.ground_speed_kt==="number"&&typeof b.ground_speed_kt==="number")?a.ground_speed_kt+(b.ground_speed_kt-a.ground_speed_kt)*proportion:null,
      estimated:true};
  }
  function insertSnapshot(v){
    if(!v||!v.aircraft||typeof v.aircraft.lat!=="number"||typeof v.aircraft.lon!=="number")return;
    const p={...v.aircraft,t:v.observed_at};
    if(valid(p)){merge([p]);latest=points[points.length-1];}
  }
  function secondsOld(){return latest?(Date.now()-time(latest.t))/1000:Infinity;}
  function ageText(sec){if(!Number.isFinite(sec))return "unknown";if(sec<0)return "clock mismatch";return sec<60?Math.floor(sec)+" sec":Math.floor(sec/60)+" min";}
  function renderLive(){
    if(isReplay)return;
    if(!latest){$("ageLabel").textContent="No ADS-B report";$("replayDetails").textContent="No verified position is available.";return;}
    let age=Math.max(0,secondsOld()),minutes=age/60,estimate=project(latest,minutes);
    $("ageLabel").textContent="Last REAL position "+ageText(age)+" old";
    actualPosition(latest);
    if(estimate && age>=1){
      moveMarker(estimate,"live");
      // Move the main icon as well, but label it as estimated, never live ADS-B.
      if(typeof locMarker!=="undefined"&&locMarker)locMarker.setLatLng([estimate.lat,estimate.lon]);
      $("status").textContent="ESTIMATED (+"+Math.floor(minutes)+" min)";
      $("replayClock").textContent="Predicted from "+fmt(time(latest.t));
      $("replayDetails").textContent="Position projected forward "+minutes.toFixed(1)+" minutes from reported groundspeed "+Math.round(latest.ground_speed_kt)+" kt and heading "+Math.round(latest.track_deg)+"°. Actual position last received "+ageText(age)+" ago. Prediction may differ from real route.";
      const remaining=km([estimate.lat,estimate.lon],b),done=km(a,[estimate.lat,estimate.lon]),pct=100*done/(done+remaining);
      $("progressBar").style.width=pct.toFixed(1)+"%";$("percent").textContent=Math.round(pct)+"% est.";
    }else{
      if(previewMarker){map.removeLayer(previewMarker);previewMarker=null;}
      if(typeof locMarker!=="undefined"&&locMarker)locMarker.setLatLng([latest.lat,latest.lon]);
      $("status").textContent=age<60?"ACTUAL ADS-B":"POSITION STALE";
      $("replayClock").textContent="Last observed "+fmt(time(latest.t));
      $("replayDetails").textContent=minutes>MAX_PROJECTION_MIN
        ?"No more extrapolation: last report is "+ageText(age)+" old. The aircraft may have turned, climbed or changed speed. Map shows last confirmed position, not where the flight is now."
        :"Showing confirmed aircraft telemetry. Estimated marker appears only while projecting up to 15 minutes.";
    }
  }
  function replayAt(t){
    if(points.length<2)return;
    t=Math.min(time(points[points.length-1].t),Math.max(time(points[0].t),t));
    replayTime=t;
    const end=time(points[points.length-1].t),start=time(points[0].t);
    $("replaySlider").value=1000*(t-start)/(end-start);
    let idx=points.findIndex(p=>time(p.t)>=t);
    if(idx<0)idx=points.length-1;
    let p=points[idx],isBetween=false,gap=0;
    if(idx>0&&t<time(points[idx].t)){const prev=points[idx-1];gap=(time(p.t)-time(prev.t))/60000;p=interp(prev,p,t);isBetween=true;}
    moveMarker(p,"replay");
    const phrase=isBetween?"Interpolated between observations":"Actual ADS-B observation";
    $("replayClock").textContent=fmt(t)+" · "+phrase;
    $("replayDetails").textContent=phrase+". "+(isBetween?"Observed gap "+Math.round(gap)+" min. This position was not actually measured. ":"")+(typeof p.alt_baro_ft==="number"?"Altitude ~"+Math.round(p.alt_baro_ft)+" ft. ":"")+(typeof p.ground_speed_kt==="number"?"Speed ~"+Math.round(p.ground_speed_kt)+" kt.":"");
  }
  function mode(replay){
    isReplay=replay;$("backLive").classList.toggle("active",!replay);$("playReplay").classList.toggle("active",replay);
    if(!replay){isPlaying=false;$("playReplay").textContent="▶ Play track";if(previewMarker){map.removeLayer(previewMarker);previewMarker=null;}renderLive();}
    else if(points.length>=2)replayAt(replayTime||time(points[0].t));
  }
  $("backLive").onclick=()=>mode(false);
  $("replaySlider").oninput=e=>{isPlaying=false;$("playReplay").textContent="▶ Play track";mode(true);const first=time(points[0].t),last=time(points[points.length-1].t);replayAt(first+(last-first)*(+e.target.value)/1000)};
  $("playReplay").onclick=()=>{
    if(points.length<2)return;
    if(isPlaying){isPlaying=false;$("playReplay").textContent="▶ Play track";return;}
    if(!isReplay||replayTime>=time(points[points.length-1].t))replayTime=time(points[0].t);
    mode(true);isPlaying=true;previousFrame=0;$("playReplay").textContent="❚❚ Pause";
    requestAnimationFrame(tick);
  };
  function tick(t){
    if(!isPlaying)return;
    if(!previousFrame)previousFrame=t;
    const elapsed=Math.min(200,t-previousFrame);previousFrame=t;
    // Playback 1 minute of history per 1 second.
    const next=replayTime+elapsed*60;
    if(next>=time(points[points.length-1].t)){replayAt(time(points[points.length-1].t));isPlaying=false;$("playReplay").textContent="▶ Replay";return;}
    replayAt(next);requestAnimationFrame(tick);
  }
  $("saveReplay").onclick=()=>{
    const blob=new Blob([JSON.stringify({flight:"EI100",registration:"EI-LRG",hex:"4cabd3",points,notes:"Only points are actual telemetry. Interpolated replay positions are estimates."},null,2)],{type:"application/json"});
    let url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="ei100-flight-replay.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
  async function fetchData(){
    try{
      const r=await fetch("data/flight.json?ts="+Date.now(),{cache:"no-store"});
      if(r.ok)insertSnapshot(await r.json());
    }catch(e){}
    renderLive();
  }
  async function boot(){
    try{merge(JSON.parse(localStorage.getItem(LOCAL_KEY)||"[]"));}catch(e){}
    try{
      const r=await fetch("data/history.json?ts="+Date.now(),{cache:"no-store"});
      if(r.ok){const v=await r.json();merge(v.points);}
    }catch(e){}
    await fetchData();
    if(points.length>1){$("replaySlider").value=0;}
  }
  window.EI100={ingest:insertSnapshot,points:()=>points};
  boot();setInterval(fetchData,30000);setInterval(renderLive,3000);
})();
