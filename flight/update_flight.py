#!/usr/bin/env python3
"""Refresh EI100 aircraft telemetry via the free public adsb.lol API.

Stops querying after the November 6-7, 2026 flight. If the aircraft is not
visible, preserve the previous known position and mark the status stale.
"""
import datetime as dt
import json
import pathlib
import urllib.request

HEX = "4cabd3"
FILE = pathlib.Path("flight/data/flight.json")
END = dt.datetime(2026, 11, 7, 7, 0, tzinfo=dt.timezone.utc)
START = dt.datetime(2026, 11, 6, 23, 0, tzinfo=dt.timezone.utc)
now = dt.datetime.now(dt.timezone.utc)
def stamp(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")
if START <= now <= END:
    old=json.loads(FILE.read_text())
    output={**old, "fetched_at": stamp(now)}
    try:
        req=urllib.request.Request(
            "https://api.adsb.lol/v2/hex/"+HEX,
            headers={"User-Agent":"EI100-Dashboard/1.0 (personal noncommercial)"},
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            data=json.load(response)
        aircraft=next((a for a in data.get("ac",[]) if a.get("hex","").lower()==HEX),None)
        if aircraft and isinstance(aircraft.get("lat"),(int,float)) and isinstance(aircraft.get("lon"),(int,float)):
            output["aircraft"]={
                "hex":HEX, "flight":str(aircraft.get("flight","")).strip(),
                "registration":aircraft.get("r","EI-LRG"),
                "type":aircraft.get("t","A21N"),
                "lat":aircraft["lat"],"lon":aircraft["lon"],
                "alt_baro_ft":aircraft.get("alt_baro") if isinstance(aircraft.get("alt_baro"),(int,float)) else None,
                "ground_speed_kt":aircraft.get("gs"), "track_deg":aircraft.get("track"),
                "vert_rate_fpm":aircraft.get("baro_rate",aircraft.get("geom_rate"))
            }
            seen=aircraft.get("seen",0)
            observed=now-dt.timedelta(seconds=seen if isinstance(seen,(int,float)) and 0<=seen<300 else 0)
            output["observed_at"]=stamp(observed)
            output["status"]="live"
            output["source"]="adsb.lol public ADS-B API"
            print("Updated",output["aircraft"]["flight"],output["aircraft"]["lat"],output["aircraft"]["lon"])
        else:
            output["status"]="not_detected"
            print("Aircraft out of receiver coverage")
    except Exception as exc:
        output["status"]="error"
        print("ADS-B fetch error:",str(exc))
    FILE.write_text(json.dumps(output,indent=2)+"\n")
else:
    print("Outside Nov 6–7 flight window; archived dashboard, no API request.")
