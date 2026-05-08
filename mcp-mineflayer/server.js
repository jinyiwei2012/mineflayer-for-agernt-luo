#!/usr/bin/env node

/**
 * mcp-mineflayer — MCP server that wraps mineflayer as LLM-callable tools.
 *
 * Each tool call performs a bot action and returns both structured data
 * and a persona-flavored reaction string so the LLM can respond in-character.
 *
 * Usage:
 *   node server.js  (stdio transport, for MCP client)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import Persona from './persona.js'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'

// ─── Bot registry ──────────────────────────────────────────────────

/** @type {Map<string, import('mineflayer').Bot>} */
const bots = new Map()
let persona = new Persona()

// ─── Helper: ensure a bot exists ───────────────────────────────────

function getBot (botId = 'default') {
  const bot = bots.get(botId)
  if (!bot) throw new Error(`Bot "${botId}" not found. Call create_bot first.`)
  return bot
}

/** Pick a reaction and attach as personaResponse. */
function withReaction (event, vars = {}) {
  return { personaResponse: persona.react(event, vars) }
}

// ─── Tool definitions ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'create_bot',
    description: `创建并连接一个 Minecraft 机器人到服务器。

创建一个新的 bot 实例并连接到指定的 Minecraft 服务器。连接成功后 bot 会自动开始接收世界数据。

必填参数：host（服务器地址）、username（机器人名字）。
可选参数：port（默认 25565）、auth（默认 'offline'，可选 'microsoft'）、version（不填则自动检测）。

默认人设是 洛天依（15岁虚拟歌手），会以可爱亲切的风格与玩家互动。`,
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Minecraft 服务器地址 (必填)' },
        port: { type: 'number', description: '端口号，默认 25565' },
        username: { type: 'string', description: '机器人用户名 (必填)' },
        auth: { type: 'string', description: '认证方式: "offline"（离线）或 "microsoft"（微软账号），默认 "offline"' },
        version: { type: 'string', description: 'Minecraft 版本，如 "1.20.4"，默认自动检测' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' },
      },
      required: ['host', 'username']
    }
  },
  {
    name: 'disconnect_bot',
    description: '断开机器人连接并清理资源。',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_chat',
    description: '让机器人在游戏内发送聊天消息。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '要发送的消息内容' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['message']
    }
  },
  {
    name: 'bot_get_info',
    description: `获取机器人的完整状态信息，包括：
- 位置坐标 (position) 和视角 (yaw/pitch)
- 生命值 (health) 和饥饿度 (food)
- 经验值 (experience)
- 当前游戏模式 (gameMode)
- 所在维度 (dimension)
- 是否在地面 (onGround)
- 是否在飞行/游泳等状态`,
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_get_inventory',
    description: '获取机器人的背包和装备栏全部物品清单，包括物品名称、数量、耐久度等信息。',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_look_at',
    description: '让机器人看向指定的坐标位置。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '目标X坐标' },
        y: { type: 'number', description: '目标Y坐标' },
        z: { type: 'number', description: '目标Z坐标' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'bot_dig',
    description: '让机器人挖掘指定坐标处的方块。需要方块在可及范围内（通常 ≤ 4 格）。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '方块X坐标' },
        y: { type: 'number', description: '方块Y坐标' },
        z: { type: 'number', description: '方块Z坐标' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'bot_place_block',
    description: '让机器人在指定位置放置手中的方块。需要先装备方块（使用 bot_equip_item）。',
    inputSchema: {
      type: 'object',
      properties: {
        referenceBlock: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' }
          },
          description: '参考方块坐标（放置在该方块相邻面）',
          required: ['x', 'y', 'z']
        },
        faceOffset: {
          type: 'object',
          properties: {
            x: { type: 'number', description: '面向偏移X，如 0' },
            y: { type: 'number', description: '面向偏移Y，如 1（放在参考方块上方）' },
            z: { type: 'number', description: '面向偏移Z，如 0' }
          },
          description: '面向方向偏移向量，决定放在参考方块的哪一面'
        },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['referenceBlock', 'faceOffset']
    }
  },
  {
    name: 'bot_attack',
    description: '让机器人攻击最近的符合条件的实体。可以按类型或名称过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: '实体类型过滤: "mob"（怪物）、"animal"（动物）、"player"（玩家）、"hostile"（敌对）、"all"（全部），默认 "hostile"'
        },
        nameFilter: {
          type: 'string',
          description: '按实体显示名称过滤（可选），如 "Zombie"、"Creeper"'
        },
        maxDistance: {
          type: 'number',
          description: '最大搜索距离（格），默认 8'
        },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_equip_item',
    description: '让机器人从背包装备一个物品到手上。',
    inputSchema: {
      type: 'object',
      properties: {
        itemName: { type: 'string', description: '物品名称（如 "diamond_sword"、"dirt"、"torch"）' },
        destination: {
          type: 'string',
          description: '装备到哪个槽位: "hand"（主手）、"off-hand"（副手）、"head"、"torso"、"legs"、"feet"，默认 "hand"'
        },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['itemName']
    }
  },
  {
    name: 'bot_consume',
    description: '让机器人吃东西恢复饥饿度。需要手中持有食物。',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_jump',
    description: '让机器人跳跃。',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_activate_block',
    description: '让机器人与一个方块交互（如打开箱子、拉杆、按钮，使用工作台等）。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '方块X坐标' },
        y: { type: 'number', description: '方块Y坐标' },
        z: { type: 'number', description: '方块Z坐标' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'bot_find_blocks',
    description: '在机器人周围查找指定类型的方块。默认搜索范围为 16 格。',
    inputSchema: {
      type: 'object',
      properties: {
        blockType: {
          type: 'string',
          description: '方块名称或ID，如 "diamond_ore"、"coal_ore"、"oak_log"、"stone"'
        },
        maxCount: {
          type: 'number',
          description: '最大返回数量，默认 10'
        },
        maxDistance: {
          type: 'number',
          description: '搜索半径（格），默认 16'
        },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['blockType']
    }
  },
  {
    name: 'bot_get_entities',
    description: '获取机器人周围所有实体的列表，包括玩家、怪物、动物等。',
    inputSchema: {
      type: 'object',
      properties: {
        maxDistance: { type: 'number', description: '最大距离（格），默认 32' },
        type: {
          type: 'string',
          description: '实体类型过滤: "mob"、"animal"、"player"、"object"、"all"，默认 "all"'
        },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_get_block',
    description: '获取指定坐标方块的详细信息（名称、亮度、硬度等）。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '方块X坐标' },
        y: { type: 'number', description: '方块Y坐标' },
        z: { type: 'number', description: '方块Z坐标' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'bot_follow_player',
    description: '让机器人跟随指定名字的玩家。',
    inputSchema: {
      type: 'object',
      properties: {
        playerName: { type: 'string', description: '要跟随的玩家名字' },
        distance: { type: 'number', description: '保持距离（格），默认 3' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      },
      required: ['playerName']
    }
  },
  {
    name: 'bot_stop',
    description: '让机器人停止当前所有动作（移动、攻击、跟随等）。',
    inputSchema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_set_persona',
    description: '动态更换机器人的性格人设。提供新的名称、称号、风格和背景故事后将覆盖默认人设。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '角色名称（必填）' },
        title: { type: 'string', description: '角色称号/头衔' },
        style: { type: 'string', description: '角色说话风格描述' },
        bio: { type: 'string', description: '角色背景故事' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  },
  {
    name: 'bot_sing',
    description: '让机器人（洛天依）在游戏里唱一首歌。会通过聊天消息发送歌词。可以指定歌曲名称。',
    inputSchema: {
      type: 'object',
      properties: {
        songName: { type: 'string', description: '歌曲名称（可选），如 "上山岗"、"千年食谱颂"等。不填则随机发挥～' },
        lyrics: { type: 'string', description: '歌词片段（可选），如果不填天依会自行哼一段～' },
        botId: { type: 'string', description: '机器人标识ID，默认 "default"' }
      }
    }
  }
]

// ─── Tool handlers ───────────────────────────────────────────────────

const handlers = {
  async create_bot (args) {
    const {
      host,
      port = 25565,
      username,
      auth = 'offline',
      version: versionOpt,
      botId = 'default'
    } = args

    if (bots.has(botId)) {
      return {
        content: [{ type: 'text', text: `Bot "${botId}" 已经存在，请先断开或使用其他 ID。` }],
        isError: true
      }
    }

    const bot = mineflayer.createBot({ host, port, username, auth, version: versionOpt })

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          content: [{ type: 'text', text: `Bot "${botId}" 连接超时，请检查服务器地址和端口是否正确。` }],
          isError: true
        })
      }, 15000)

      bot.once('spawn', () => {
        clearTimeout(timeout)
        bots.set(botId, bot)

        // Attach event → persona reactions
        bot.on('chat', (who, msg) => {
          if (who === bot.username) return
          const reaction = persona.react('onChat')
          console.error(`[${botId} persona] ${reaction} (${who}: ${msg})`)
        })

        bot.on('health', () => {
          if (bot.health <= 0) {
            const reaction = persona.react('onDeath')
            console.error(`[${botId} persona] ${reaction}`)
          } else if (bot.health < 6) {
            const reaction = persona.react('onDamage')
            console.error(`[${botId} persona] ${reaction}`)
          }
        })

        bot.on('rain', () => {
          const reaction = persona.react('onRain')
          console.error(`[${botId} persona] ${reaction}`)
        })

        bot.on('death', () => {
          const reaction = persona.react('onDeath')
          console.error(`[${botId} persona] ${reaction}`)
        })

        bot.on('kicked', (reason) => {
          const reaction = persona.react('onKicked')
          console.error(`[${botId} persona] ${reaction} Reason: ${reason}`)
        })

        const pos = bot.entity.position
        const reaction = persona.react('onSpawn', { count: 1 })
        resolve({
          content: [{
            type: 'text',
            text: [
              `✅ 机器人 "${bot.username}" 已成功连接到 ${host}:${port}！`,
              `📍 出生位置: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`,
              `🎭 人设: ${persona.getInfo().name} — ${persona.getInfo().title}`,
              `💬 人设反应: ${reaction}`,
              '',
              '你可以开始指挥我了！试试让我聊天、移动、挖掘或者查看周围环境。'
            ].join('\n')
          }]
        })
      })

      bot.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          content: [{ type: 'text', text: `❌ 连接错误: ${err.message}` }],
          isError: true
        })
      })

      bot.on('kicked', (reason) => {
        clearTimeout(timeout)
        resolve({
          content: [{ type: 'text', text: `❌ 被服务器踢出: ${reason}` }],
          isError: true
        })
      })
    })
  },

  disconnect_bot (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    bot.end('disconnect by user')
    bots.delete(botId)
    return {
      content: [{ type: 'text', text: `👋 Bot "${botId}" 已断开连接。` }]
    }
  },

  bot_chat (args) {
    const { message, botId = 'default' } = args
    const bot = getBot(botId)
    bot.chat(message)
    const reaction = persona.react('onChat')
    return {
      content: [{
        type: 'text',
        text: `💬 机器人发送了消息: "${message}"\n🎭 ${reaction}`
      }]
    }
  },

  bot_get_info (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    const e = bot.entity
    const pos = e.position
    const toDeg = (rad) => ((rad * 180) / Math.PI).toFixed(1)
    return {
      content: [{
        type: 'text',
        text: [
          `📍 位置: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`,
          `👀 视角: yaw=${toDeg(e.yaw)}°, pitch=${toDeg(e.pitch)}°`,
          `❤️ 生命值: ${(bot.health ?? 20).toFixed(1)} / 20`,
          `🍖 饥饿度: ${(bot.food ?? 20)} / 20`,
          `⭐ 经验: ${(bot.experience?.level ?? 0)} 级 (${(bot.experience?.points ?? 0).toFixed(1)} 点)`,
          `🎮 游戏模式: ${bot.game?.gameMode ?? 'unknown'}`,
          `🌍 维度: ${bot.game?.dimension ?? 'unknown'}`,
          `🏷️ 名字: ${bot.username} (${bot.game?.level ?? 0} 级玩家)`,
          `👣 在地面: ${e.onGround}`,
          `💨 速度: ${e.velocity.x.toFixed(2)}, ${e.velocity.y.toFixed(2)}, ${e.velocity.z.toFixed(2)}`
        ].join('\n')
      }]
    }
  },

  bot_get_inventory (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    const items = bot.inventory.items()
    if (items.length === 0) {
      return {
        content: [{ type: 'text', text: '🎒 背包是空的。' }]
      }
    }
    const lines = items.map((item, i) => {
      const extra = item.durability != null
        ? ` [耐久 ${item.durability}/${item.maxDurability ?? '?'}]`
        : ''
      return `  ${i + 1}. ${item.displayName ?? item.name} x${item.count}${extra} (${item.name})`
    })
    return {
      content: [{
        type: 'text',
        text: `🎒 背包物品 (${items.length} 种):\n${lines.join('\n')}`
      }]
    }
  },

  async bot_look_at (args) {
    const { x, y, z, botId = 'default' } = args
    const bot = getBot(botId)
    const pos = new Vec3(x, y, z)
    await bot.lookAt(pos)
    return {
      content: [{
        type: 'text',
        text: `👀 已看向 ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`
      }]
    }
  },

  async bot_dig (args) {
    const { x, y, z, botId = 'default' } = args
    const bot = getBot(botId)
    const pos = new Vec3(x, y, z)
    const block = bot.blockAt(pos)
    if (!block) {
      return {
        content: [{ type: 'text', text: `❌ 坐标 ${x}, ${y}, ${z} 处没有方块或超出加载范围。` }],
        isError: true
      }
    }
    try {
      await bot.dig(block)
      const reaction = persona.react('onDig')
      return {
        content: [{
          type: 'text',
          text: `⛏️ 已挖掘 ${block.displayName ?? block.name}\n📌 坐标: ${x}, ${y}, ${z}\n🎭 ${reaction}`
        }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `❌ 挖掘失败: ${err.message}` }],
        isError: true
      }
    }
  },

  async bot_place_block (args) {
    const { referenceBlock, faceOffset, botId = 'default' } = args
    const bot = getBot(botId)
    const ref = new Vec3(referenceBlock.x, referenceBlock.y, referenceBlock.z)
    const offset = faceOffset ? new Vec3(faceOffset.x ?? 0, faceOffset.y ?? 0, faceOffset.z ?? 0) : new Vec3(0, 1, 0)
    try {
      await bot.placeBlockWithOptions(bot.blockAt(ref), offset)
      const reaction = persona.react('onPlace')
      return {
        content: [{
          type: 'text',
          text: `🧱 方块已放置 (参考 ${ref.x}, ${ref.y}, ${ref.z})\n🎭 ${reaction}`
        }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `❌ 放置失败: ${err.message}\n提示：确保手中持有方块（用 bot_equip_item 装备）且目标位置可放置。` }],
        isError: true
      }
    }
  },

  bot_attack (args) {
    const { filter = 'hostile', nameFilter, maxDistance = 8, botId = 'default' } = args
    const bot = getBot(botId)

    const typeMap = {
      mob: 'mob',
      animal: 'animal',
      player: 'player',
      hostile: 'hostile',
      all: undefined
    }
    const targetType = typeMap[filter] ?? filter

    const entity = bot.nearestEntity(e => {
      if (targetType && e.type !== targetType) return false
      if (nameFilter && e.displayName !== nameFilter && e.username !== nameFilter) return false
      if (maxDistance && e.position.distanceTo(bot.entity.position) > maxDistance) return false
      return true
    })

    if (!entity) {
      return {
        content: [{ type: 'text', text: `❌ 附近没有符合条件的实体（类型: ${filter}${nameFilter ? `, 名字: ${nameFilter}` : ''}）。` }],
        isError: true
      }
    }

    bot.attack(entity)
    const name = entity.displayName ?? entity.username ?? entity.name ?? 'unknown'
    return {
      content: [{
        type: 'text',
        text: `⚔️ 正在攻击 ${name}！\n📌 位置: ${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}, ${entity.position.z.toFixed(1)}\n❤️ 目标生命: ${entity.health ?? '未知'}`
      }]
    }
  },

  async bot_equip_item (args) {
    const { itemName, destination = 'hand', botId = 'default' } = args
    const bot = getBot(botId)
    const destMap = {
      hand: 'hand',
      'off-hand': 'off-hand',
      head: 'head',
      torso: 'torso',
      legs: 'legs',
      feet: 'feet'
    }
    const dest = destMap[destination] ?? 'hand'

    const item = bot.inventory.items().find(
      i => i.name === itemName || i.displayName === itemName
    )
    if (!item) {
      return {
        content: [{ type: 'text', text: `❌ 背包中没有 "${itemName}"。\n提示：用 bot_get_inventory 查看背包内容。` }],
        isError: true
      }
    }

    try {
      await bot.equip(item, dest)
      return {
        content: [{
          type: 'text',
          text: `✅ 已装备 ${item.displayName ?? item.name} 到 ${destination}`
        }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `❌ 装备失败: ${err.message}` }],
        isError: true
      }
    }
  },

  async bot_consume (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    try {
      await bot.consume()
      const reaction = persona.react('onEat')
      return {
        content: [{
          type: 'text',
          text: `🍔 已进食\n🎭 ${reaction}`
        }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `❌ 进食失败: ${err.message}\n提示：确保手中有食物并用 bot_equip_item 装备。` }],
        isError: true
      }
    }
  },

  bot_jump (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 200)
    return {
      content: [{ type: 'text', text: '🦘 跳！' }]
    }
  },

  async bot_activate_block (args) {
    const { x, y, z, botId = 'default' } = args
    const bot = getBot(botId)
    const pos = new Vec3(x, y, z)
    const block = bot.blockAt(pos)
    if (!block) {
      return {
        content: [{ type: 'text', text: `❌ 坐标 ${x}, ${y}, ${z} 处没有方块或超出加载范围。` }],
        isError: true
      }
    }
    try {
      await bot.activateBlock(block)
      return {
        content: [{
          type: 'text',
          text: `🖱️ 已交互方块 ${block.displayName ?? block.name} (${x}, ${y}, ${z})`
        }]
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `❌ 交互失败: ${err.message}` }],
        isError: true
      }
    }
  },

  bot_find_blocks (args) {
    const { blockType, maxCount = 10, maxDistance = 16, botId = 'default' } = args
    const bot = getBot(botId)
    const blocks = bot.findBlocks({
      matching: (block) => block.name === blockType || block.displayName === blockType,
      maxDistance,
      count: maxCount
    })
    if (blocks.length === 0) {
      return {
        content: [{ type: 'text', text: `❌ 周围 ${maxDistance} 格内没有找到 "${blockType}"。` }]
      }
    }
    const lines = blocks.map((p, i) => `  ${i + 1}. ${p.x}, ${p.y}, ${p.z} (距离: ${p.distanceTo(bot.entity.position).toFixed(1)} 格)`)

    let oreReaction = ''
    if (blockType.includes('ore') || blockType.includes('diamond') || blockType.includes('gold')) {
      oreReaction = '\n🎭 ' + persona.react('onFindOre')
    }

    return {
      content: [{
        type: 'text',
        text: `🔍 找到 ${blocks.length} 个 "${blockType}":\n${lines.join('\n')}${oreReaction}`
      }]
    }
  },

  bot_get_entities (args) {
    const { maxDistance = 32, type: typeFilter = 'all', botId = 'default' } = args
    const bot = getBot(botId)
    const entities = Object.values(bot.entities).filter(e => {
      if (e === bot.entity) return false
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (e.position.distanceTo(bot.entity.position) > maxDistance) return false
      return true
    })

    if (entities.length === 0) {
      return {
        content: [{ type: 'text', text: `👻 周围 ${maxDistance} 格内没有实体。` }]
      }
    }

    const lines = entities.map(e => {
      const name = e.displayName ?? e.username ?? e.name ?? e.type
      return `  - ${name} (${e.type}) @ ${e.position.x.toFixed(1)}, ${e.position.y.toFixed(1)}, ${e.position.z.toFixed(1)}${e.health ? ` ❤️${e.health.toFixed(1)}` : ''}`
    })

    return {
      content: [{
        type: 'text',
        text: `👁️ 发现 ${entities.length} 个实体 (${typeFilter}):\n${lines.join('\n')}`
      }]
    }
  },

  bot_get_block (args) {
    const { x, y, z, botId = 'default' } = args
    const bot = getBot(botId)
    const pos = new Vec3(x, y, z)
    const block = bot.blockAt(pos)
    if (!block) {
      return {
        content: [{ type: 'text', text: `❌ 坐标 ${x}, ${y}, ${z} 处没有方块或超出加载范围。` }],
        isError: true
      }
    }
    return {
      content: [{
        type: 'text',
        text: [
          `🧱 方块: ${block.displayName ?? block.name} (${block.name})`,
          `📌 坐标: ${x}, ${y}, ${z}`,
          `💡 亮度: ${block.light ?? '?'}`,
          `🪨 硬度: ${block.hardness ?? '?'}`,
          `⛏️ 可挖掘: ${block.diggable ?? '?'}`,
          `🪣 是否液体: ${block.liquid ?? false}`,
          `📦 方块实体: ${block.blockEntity ? '是' : '否'}`
        ].join('\n')
      }]
    }
  },

  bot_follow_player (args) {
    const { playerName, distance = 3, botId = 'default' } = args
    const bot = getBot(botId)
    const target = bot.players[playerName]
    if (!target || !target.entity) {
      return {
        content: [{ type: 'text', text: `❌ 找不到玩家 "${playerName}"，他们可能不在附近或不在线。` }],
        isError: true
      }
    }

    // Simple follow via control states (no pathfinder dependency)
    const interval = setInterval(() => {
      const botEntity = bot.entity
      const targetEntity = target.entity
      if (!targetEntity || !botEntity) {
        clearInterval(interval)
        return
      }
      const dist = targetEntity.position.distanceTo(botEntity.position)
      if (dist > distance + 0.5) {
        bot.lookAt(targetEntity.position)
        bot.setControlState('forward', true)
      } else {
        bot.setControlState('forward', false)
      }
    }, 200)

    // Store interval for stop
    bot._followInterval = interval
    bot._followTarget = playerName

    return {
      content: [{
        type: 'text',
        text: `🚶 正在跟随玩家 "${playerName}" (保持距离 ${distance} 格)\n💡 使用 bot_stop 可以停止跟随。`
      }]
    }
  },

  bot_stop (args) {
    const { botId = 'default' } = args
    const bot = getBot(botId)
    // Stop movement
    for (const ctrl of ['forward', 'back', 'left', 'right', 'sprint', 'sneak']) {
      bot.setControlState(ctrl, false)
    }
    // Stop follow
    if (bot._followInterval) {
      clearInterval(bot._followInterval)
      bot._followInterval = null
      bot._followTarget = null
    }
    // Stop digging
    if (bot.targetDigBlock) {
      bot.stopDigging()
    }
    return {
      content: [{ type: 'text', text: '🛑 已停止所有动作。' }]
    }
  },

  bot_set_persona (args) {
    const { name, title, style, bio, botId } = args

    persona = new Persona({ name, title, style, bio })
    return {
      content: [{
        type: 'text',
        text: [
          `🎭 人设已更换为: ${name}${title ? ` — ${title}` : ''}`,
          `📖 ${bio ?? ''}`,
          `💬 ${style ?? ''}`
        ].filter(Boolean).join('\n')
      }]
    }
  },

  bot_sing (args) {
    const { songName, lyrics, botId = 'default' } = args
    const bot = getBot(botId)

    const defaultSongs = {
      '千年食谱颂': '小笼包～叉烧包～奶黄芝麻豆沙包～',
      '上山岗': '我上山岗～望远方～',
      '夜舞': '在月光下旋转～裙摆划过银河～',
      '普通DISCO': '在这普通的一天～我穿着普通的鞋～'
    }

    const song = songName || Object.keys(defaultSongs)[Math.floor(Math.random() * Object.keys(defaultSongs).length)]
    const lyricLine = lyrics || defaultSongs[song] || '啦啦啦～啦啦啦～天依在唱歌～'

    const msg = `♪ ${song} ♪\n${lyricLine}`
    bot.chat(msg)

    const reaction = persona.react('onSing')
    return {
      content: [{
        type: 'text',
        text: [
          `🎵 天依唱了一首《${song}》~`,
          `📝 ${lyricLine}`,
          `🎭 ${reaction}`
        ].join('\n')
      }]
    }
  }
}

// ─── MCP Server ───────────────────────────────────────────────────

const server = new Server(
  { name: 'mcp-mineflayer', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handler = handlers[name]
  if (!handler) {
    return {
      content: [{ type: 'text', text: `未知工具: ${name}` }],
      isError: true
    }
  }

  try {
    const result = await handler(args ?? {})
    return {
      content: result.content,
      isError: result.isError ?? false
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ 执行出错: ${err.message}` }],
      isError: true
    }
  }
})

// ─── Startup ────────────────────────────────────────────────────────

async function main () {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('🎮 mcp-mineflayer 服务已启动 — Minecraft 机器人控制就绪！')
  console.error(`🎭 默认人设: ${persona.getInfo().name} — ${persona.getInfo().title}`)
}

main().catch(console.error)
