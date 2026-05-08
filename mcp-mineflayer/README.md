# mcp-mineflayer

将 Mineflayer 打包成 MCP (Model Context Protocol) 工具，让 LLM（如 Claude）可以直接通过 tool call 控制 Minecraft 机器人。

**默认人设：洛天依** —— 15 岁的虚拟歌手，在 Minecraft 世界里冒险、唱歌、吃灌汤包！

## 快速开始

```bash
# 在 mcp-mineflayer 目录下安装依赖
cd mcp-mineflayer
npm install

# 启动服务（stdio 模式，给 MCP 客户端用）
node server.js
```

## 作为 Claude Code 的 MCP 服务使用

在 Claude Code 的 MCP 配置文件（`~/.claude/settings.json` 或项目 `.claude/settings.local.json`）中添加：

```json
{
  "mcpServers": {
    "mineflayer": {
      "command": "node",
      "args": ["C:/mineflayer/mcp-mineflayer/server.js"]
    }
  }
}
```

启动后，Claude 会自动加载工具，你只需要用自然语言指挥天依即可。

## 工具清单（共 20 个）

### 连接管理
| 工具 | 说明 |
|------|------|
| `create_bot` | 创建机器人并连接到 Minecraft 服务器 |
| `disconnect_bot` | 断开机器人连接 |

### 基础操作
| 工具 | 说明 |
|------|------|
| `bot_chat` | 发送聊天消息 |
| `bot_get_info` | 获取位置、血量、饱食度等完整状态 |
| `bot_get_inventory` | 查看背包物品 |
| `bot_jump` | 跳跃 |

### 移动与视角
| 工具 | 说明 |
|------|------|
| `bot_look_at` | 看向指定坐标 |
| `bot_follow_player` | 跟随指定玩家 |
| `bot_stop` | 停止所有动作（移动/跟随/挖掘） |

### 交互与操作
| 工具 | 说明 |
|------|------|
| `bot_dig` | 挖掘方块 |
| `bot_place_block` | 放置手中方块 |
| `bot_activate_block` | 与方块交互（箱子、拉杆等） |
| `bot_attack` | 攻击最近实体 |
| `bot_equip_item` | 装备物品到手上 |
| `bot_consume` | 吃东西恢复饱食度 |

### 世界感知
| 工具 | 说明 |
|------|------|
| `bot_get_block` | 查询方块详细信息 |
| `bot_find_blocks` | 搜索周围指定方块 |
| `bot_get_entities` | 列出附近实体 |

### 人设 & 特色
| 工具 | 说明 |
|------|------|
| `bot_set_persona` | 动态切换机器人的性格人设 |
| `bot_sing` | 让洛天依在游戏里唱歌～ |

## 人设系统

默认人设是 **洛天依**，信息加载自 `C:\Agent-Luotianyi-server\agent\persona\` 下的三个文件：
- `luotianyi_persona.json` — 角色名称、人设、说话风格
- `persona.json` — 详细背景、性格、互动风格、常用表情
- `static_variables.json` — 静态人设特征、回复要求、回复格式

### 通过工具动态切人设

```json
{
  "name": "建筑大师",
  "title": "现代建筑风格倡导者",
  "style": "说话文艺，喜欢用建筑术语比喻",
  "bio": "一个专注于现代建筑的玩家"
}
```

### 通过三文件目录切人设

```json
{
  "personaDir": "C:/Agent-Luotianyi-server/agent/persona"
}
```

### 事件反应

人设会在以下场景自动触发反应（显示在 stderr 日志中）：
- 出生、死亡、受伤、被踢出
- 收到聊天消息
- 下雨、夜晚
- 挖掘、放置、合成、进食
- 发现矿物
- 唱歌（洛天依独有）

## 调用示例

```
// 天依，去服务器看看！
create_bot({ host: "localhost", username: "Luotianyi" })

// 你现在感觉怎么样？
bot_get_info()

// 周围安全吗？
bot_get_entities({ type: "mob" })

// 天依唱首歌吧～
bot_sing({ songName: "千年食谱颂" })
```
