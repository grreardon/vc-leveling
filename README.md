# vc-leveling

A Discord bot that awards XP for time spent in voice chat rather than for messages sent.

Most leveling bots are message-driven: a user types, a handler fires, XP goes up. That model is reactive and cheap, because work only happens when someone does something. Voice XP is a different shape of problem. Nothing emits an event for "still sitting in the call," so the bot has to maintain its own picture of who is currently in voice and repeatedly answer "who has earned XP since I last checked?" on a clock. Nearly every design decision here follows from that one difference.

## The tick

The bot holds an in-memory `Set` of the user IDs currently earning XP, kept in sync by the `voiceChannelJoin`, `voiceChannelLeave`, and `voiceStateUpdate` gateway events. Once a minute it walks that set and grants each member a random 10-26 XP.

Keeping the roster as a set is what makes the loop scale. The per-tick cost is proportional to the number of people actually sitting in voice, not to the size of the guild, so a 10,000-member server with four people in a call does four units of work per minute. Joins and leaves are O(1) against the set.

## Why the cache is load-bearing

That once-a-minute tick is exactly what makes the naive storage design fall over. For N users in voice it means N database reads and N database writes every single minute, indefinitely, for a workload that is almost entirely "increment a number nobody is going to look at."

So the two stores have different jobs. MongoDB owns the durable record. Redis owns the working copy, and XP accrual runs against Redis alone. Mongo is written only when a user actually crosses a level, which is the only moment the durable state changes in a way anyone would notice. Reads are read-through: a cache miss falls back to Mongo, backfills Redis, and every subsequent tick for that user is served out of cache. In steady state the accrual loop generates close to zero database traffic.

Level thresholds follow a quadratic curve, `5 × level² + 50 × level + 100`, so level-ups get rarer the higher a user climbs and the Mongo write rate falls off along with them. The cache is not a bolted-on optimization; without it the write volume is the whole system.

## A deliberately small gateway footprint

The bot runs on [eris](https://github.com/abalabahaha/eris) rather than discord.js, and the client is configured to be as cheap as possible to hold open:

- 19 gateway events are explicitly disabled, including `PRESENCE_UPDATE`, `TYPING_START`, and the whole `CHANNEL_*`, `GUILD_ROLE_*`, and `GUILD_MEMBER_*` families
- Intents narrowed to just `guilds`, `guildVoiceStates`, and `guildMessages`
- `messageLimit: 0`, disabling the message cache outright
- `restMode: true`

A long-running gateway process pays for everything it subscribes to, in bandwidth on the socket and in memory it then holds onto for the life of the process. This bot needs voice state and a single text command. `PRESENCE_UPDATE` alone, in an active guild, is a firehose of events it would deserialize and immediately throw away. Turning them off at the gateway means they are never sent in the first place.

## Rewards

Levels can be mapped to Discord roles in config. When a user crosses a mapped threshold the bot grants the role, resolving the member from the local cache and falling back to a REST fetch only on a miss, then DMs them a congratulations. `!level` replies inline with the caller's current level and XP.

---

Written in 2021, when I was 15.

MIT licensed.
