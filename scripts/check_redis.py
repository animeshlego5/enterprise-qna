import asyncio
import os
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

async def check():
    r = aioredis.from_url(os.getenv("REDIS_URL"), decode_responses=True)
    stream_key = os.getenv("REDIS_STREAM_KEY", "jobs")
    group = os.getenv("REDIS_CONSUMER_GROUP", "qna-workers")

    # Stream length
    length = await r.xlen(stream_key)
    print(f"Stream '{stream_key}' length: {length}")

    # Recent entries
    entries = await r.xrange(stream_key, count=5)
    print(f"Recent entries ({len(entries)}):")
    for e in entries:
        print(f"  id={e[0]} data={dict(list(e[1].items())[:3])}")

    # Consumer group info
    try:
        groups = await r.xinfo_groups(stream_key)
        for g in groups:
            print(f"Group: {g}")
    except Exception as ex:
        print(f"Group info error: {ex}")

    # Pending messages
    try:
        pending = await r.xpending(stream_key, group)
        print(f"Pending: {pending}")
    except Exception as ex:
        print(f"Pending check error: {ex}")

    await r.aclose()

asyncio.run(check())
