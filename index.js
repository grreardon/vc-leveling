const { Client } = require("eris")
const { token, prefix, db, levels, guildID } = require("./config.json")
const redis = require("ioredis")
const mongoose = require("mongoose")

const client = new Client(token, {
  allowedMentions: {
    user: true,
    everyone: false,
    roles: false,
    repliedUser: true,
  },
  disableEvents: {
    CHANNEL_CREATE: true,
    CHANNEL_DELETE: true,
    CHANNEL_UPDATE: true,
    GUILD_BAN_ADD: true,
    GUILD_BAN_REMOVE: true,
    GUILD_DELETE: true,
    GUILD_MEMBER_ADD: true,
    GUILD_MEMBER_REMOVE: true,
    GUILD_MEMBER_UPDATE: true,
    GUILD_ROLE_CREATE: true,
    GUILD_ROLE_DELETE: true,
    GUILD_ROLE_UPDATE: true,
    GUILD_UPDATE: true,
    MESSAGE_DELETE: true,
    MESSAGE_DELETE_BULK: true,
    MESSAGE_UPDATE: true,
    PRESENCE_UPDATE: true,
    TYPING_START: true,
    USER_UPDATE: true,
  },
  intents: ["guildVoiceStates", "guildMessages", "guilds"],
  messageLimit: 0,
  restMode: true,
})
mongoose
  .connect(db, {
    useNewUrlParser: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
    useCreateIndex: true,
  })
  .then(() => {
    console.log(`Logged into MongoDB`)
  })
  .catch(console.error)

const cache = new redis()
const inVc = new Set()
const schem = new mongoose.Schema(
  {
    _id: { required: true, type: String },
    level: { required: true, type: Number, default: 0 },
    exp: { required: true, type: Number, default: 0 },
  },
  {
    strict: true,
    versionKey: false,
  }
)

const schema = mongoose.model("user", schem)

//getting rid of all keys in cache, comment it out if you dont want it to happen, data is more prone to be synced with database
cache.flushall()

client.on("ready", () => console.log("bot online"))

client.on("messageCreate", async message => {
  if (!message.content.startsWith(prefix)) return
  const args = message.content.slice(prefix.length).trim().split(/ +/g)
  const command = args.shift()?.toLowerCase()
  if (command === "level") {
    const data = await getUser(message.author.id)
    if (!data) return

    message.channel
      .createMessage({
        content: `You are level **${data.level ?? 0}** with **${
          data.exp ?? 0
        }** exp`,
        messageReferenceID: message.id,
      })
      .catch(() => {})
  }
})

client.on("voiceChannelJoin", member => {
  inVc.add(member.id)
})

client.on("voiceChannelLeave", member => {
  inVc.delete(member.id)
})

client.on("voiceStateUpdate", (member, oldState) => {
  //prettier-ignore
  if(oldState.deaf || oldState.mute || oldState.selfMute || oldState.selfDeaf) {
        inVc.add(member.id)
    } else if(!oldState.deaf || !oldState.mute || !oldState.selfMute || !oldState.selfDeaf) {
        inVc.delete(member.id)
    }
})

const createUser = async user => {
  await schema
    .create({
      _id: user,
      level: 0,
      exp: 0,
    })
    .catch(() => {})

  cache
    .set(
      user,
      JSON.stringify({
        _id: user,
        level: 0,
        exp: 0,
      })
    )
    .catch(() => {})
}

const getUser = async user => {
  return new Promise(async resolve => {
    const fromCache = await cache.get(user).catch(() => {})
    if (!fromCache || fromCache == null) {
      const fromDB = await schema.find({ _id: user }).lean()
      if (!fromDB.length) {
        createUser(user)
        resolve({
          _id: user,
          level: 0,
          exp: 0,
        })
      } else {
        cache.set(user, JSON.stringify(fromDB[0]))
        resolve(fromDB[0])
      }
    } else {
      resolve(JSON.parse(fromCache))
    }
  })
}
const updateUser = async (user, data) => {
  schema
    .findOneAndUpdate(
      {
        _id: user,
      },
      {
        $inc: data,
        $set: {
          exp: 0
          }
      },
      {
        upsert: true,
        new: true,
      }
    )
    .lean()
    .then(dat => {
      cache.set(user, JSON.stringify(dat)).catch(() => {})
      client
        .getDMChannel(user)
        .catch(() => {})
        .then(channel =>
          channel
            .createMessage(
              `Congrats, you have reached **VC Level ${dat?.level ?? 0}!**`
            )
            .catch(() => {})
        )
    })
}

const updateExp = async user => {
  const data = await getUser(user)
  const randomAmount = Math.round(Math.random() * 16) + 10
  const amt = data.exp + randomAmount
  if (amt > 5 * (data.level ** 2) + 50 * data.level + 100 - data.exp) {
    updateUser(user, {
      level: 1,
    })

    if (levels[data.level + 1]) {
      try {
        const guild = await client.guilds.get(guildID)
        ;(guild.members.get(user) || (await guild.getRESTMember(user))).addRole(
          levels[data.level + 1]
        )
      } catch {
        //errors dont matter in 2021
      }
    }
  } else {
    //prettier-ignore
    cache.set(user, JSON.stringify({
      level: data.level,
      exp: amt,
    }))
  }
}

setInterval(() => {
  for (let user of inVc) {
    updateExp(user)
  }
}, 60000)

client.connect()
