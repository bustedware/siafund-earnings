import requests, json, pymongo, bson, datetime, time, sched, traceback, os, sys
from datetime import timezone
from datetime import datetime, timezone
from dateutil.parser import parse
from bson.decimal128 import Decimal128
from decimal import Decimal
from threading import Thread

startBlock = sys.argv[1]
endBlock = sys.argv[2]

last_sf = 0
n_siafunds = 10000

daoclient = pymongo.MongoClient(os.getenv("mdbconnstr"))
def getsiafundclaimatblock(block):
    result = requests.get(f"http://{os.getenv("siahost")}/api/consensus/checkpoint/{block}", auth=("", os.getenv("apipwd"))).json()
    timestamp = parse(result['block']['timestamp']).astimezone(timezone.utc)
    return Decimal(result['state']['siafundTaxRevenue']), timestamp

for blockHeight in range(startBlock, endBlock):
    sf, timestamp = getsiafundclaimatblock(blockHeight)
    delta = (sf - last_sf) / n_siafunds
    last_sf = sf
    print(f"[{blockHeight}] - [{timestamp}] - [{sf}] - [{delta}]")
    daoclient["crypto"]["sia"].insert_one({
        "amount": Decimal128(delta),
        "total": Decimal128(sf),
        "timestamp": timestamp,
        "height": blockHeight,
    })