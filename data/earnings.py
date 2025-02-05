import requests, json, pymongo, bson, datetime, time, sched, traceback, os
from datetime import datetime
from bson.decimal128 import Decimal128
from decimal import Decimal
from threading import Thread

last_sf = 0
snapshot_interval = 5 #minute(s)
n_siafunds = 10000

# H     hasting 0.000000000000000000000001 SC   10^-24 SC
# pS    pico    0.000000000001             SC   10^-12 SC
# nS    nano    0.000000001                SC   10^-9 SC
# μS    micro   0.000001                   SC   10^-6 SC
# mS    milli   0.001                      SC   10^-3 SC
# SC    Siacoin 1                          SC   10^1 SC
# KS    kilo    1000                       SC   10^3 SC
# MS    mega    1000000                    SC   10^6 SC
# GS    giga    1000000000                 SC   10^9 SC
# TS    tera    1000000000000              SC   10^12 SC

daoclient = pymongo.MongoClient(os.getenv("mdbconnstr"))
def getsiafundclaim():
    result = requests.get("http://"+os.getenv("siahost")+"/api/consensus/tipstate", auth=("", os.getenv("apipwd"))).json()
    sf_claim_balance = Decimal(result['siafundPool'])
    return sf_claim_balance

while True:
    main_ts_start = time.time()
    try:
        sf = getsiafundclaim()
        if last_sf == 0:
            last_sf = sf
            print("first: [" + str(datetime.now()) + "] [" + str(last_sf) + "]")
        else:
            delta = (sf - last_sf) / n_siafunds
            last_sf = sf
            print("delta: [" + str(datetime.now()) + "] [" + str(last_sf) + "] [" + str(delta) + "]")
            daoclient["crypto"]["sia"].insert_one({
                "amount": Decimal128(delta),
                "timestamp": datetime.now()
            })
    except Exception:
        print("an error occurred")
        traceback.print_exc()
    time_to_sleep = (snapshot_interval*60) - (time.time() - main_ts_start)
    if time_to_sleep > 0:
        time.sleep(time_to_sleep)
    else:
        print("cpu is exhausted. collection interval might be too frequent")
        time.sleep(60)