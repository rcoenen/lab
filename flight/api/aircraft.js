export default async function handler(req,res) {
  const origin=req.headers.origin;
  if(origin==='https://rcoenen.github.io') res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Cache-Control','public, max-age=5, s-maxage=15, stale-while-revalidate=15');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  try{
    const upstream=await fetch('https://api.adsb.lol/v2/hex/4cabd3',{headers:{'User-Agent':'EI100FlightDashboard/1.0 (noncommercial aircraft status)'} ,signal:AbortSignal.timeout(8000)});
    if(!upstream.ok)return res.status(503).json({status:'upstream_error',code:upstream.status,received_at:new Date().toISOString()});
    const data=await upstream.json();
    const x=(data.ac||[]).find(a=>String(a.hex||'').toLowerCase()==='4cabd3');
    const now=Date.now();
    if(!x || !Number.isFinite(x.lat) || !Number.isFinite(x.lon)) return res.status(200).json({status:'not_detected',received_at:new Date(now).toISOString(),aircraft:null});
    const observed_at=new Date(now-1000*(Number.isFinite(x.seen)?Math.min(300,Math.max(0,x.seen)):0)).toISOString();
    return res.status(200).json({status:'live',received_at:new Date(now).toISOString(),observed_at,aircraft:{hex:'4cabd3',registration:x.r||'EI-LRG',flight:(x.flight||'').trim(),lat:x.lat,lon:x.lon,alt_baro_ft:typeof x.alt_baro==='number'?x.alt_baro:null,ground_speed_kt:typeof x.gs==='number'?x.gs:null,track_deg:typeof x.track==='number'?x.track:null,vert_rate_fpm:typeof x.baro_rate==='number'?x.baro_rate:null},source:'adsb.lol'});
  }catch(e){return res.status(503).json({status:'error',message:'ADS-B upstream temporarily unavailable',received_at:new Date().toISOString()});}
}