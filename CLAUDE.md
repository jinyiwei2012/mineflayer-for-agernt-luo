# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

- `npm test` — run lint + mocha tests (full suite)
- `npm run mocha_test` — run mocha tests without lint
- `npm run mocha_test -- -g <version>` — run tests for a specific MC version, e.g. `-g "1.21.11v"`
- `npm run mocha_test -- -g <test_name>` — run a specific test by name (e.g. `-g "bed"`, `-g "useChests"`, `-g "rayTrace"`)
- `npm run lint` — run standard + standard-markdown linter
- `npm run fix` — auto-fix lint issues
- Tests use mocha with `--exit` flag. Internal tests (`test/internalTest.js`) spin up an offline minecraft-protocol server and run per-version. External tests (`test/externalTest.js`) run against real servers.

## Architecture

Mineflayer is a Node.js library for creating Minecraft bots. It is built around a **plugin-based architecture**:

- **Entry point**: `index.js` → `lib/loader.js` — `createBot()` creates an EventEmitter `bot`, loads plugins, and connects via `minecraft-protocol`
- **Plugin system**: `lib/plugin_loader.js` — plugins are functions `(bot, options) => void`. Internal plugins are always loaded unless explicitly disabled via `options.plugins`
- **Internal plugins** (`lib/plugins/`): ~40 plugins each handling a domain — `game.js`, `chat.js`, `blocks.js`, `entities.js`, `physics.js`, `inventory.js`, `digging.js`, `craft.js`, `chest.js`, `health.js`, etc. Every plugin exports `inject(bot, options)` which attaches properties/events to the bot object
- **Prismarine modules**: Heavy use of external libraries (minecraft-protocol, prismarine-block, prismarine-chunk, prismarine-physics, prismarine-world, vec3, etc.) — each provides a versioned data layer
- **Version support**: `lib/version.js` defines `testedVersions` (1.8.8 through 1.21.11). Version-specific behavior is handled via `bot.supportFeature(feature)` and `bot.registry`
- **TypeScript types**: `index.d.ts` provides full type definitions. Validated by `tsconfig.json` (strictNullChecks)
- **Internal tests** (`test/internalTest.js`): Create a fake offline server per version using `minecraft-protocol`'s `createServer`, send synthetic packets, and assert bot responses. Each version gets its own `describe` block
- **External tests** (`test/externalTest.js`): Reference tests in `test/externalTests/` that connect to actual Minecraft servers
- **Utility modules**: `lib/conversions.js` (yaw/pitch), `lib/math.js`, `lib/promise_utils.js` (once, sleep, createTask), `lib/location.js`

## Key Patterns

- Each plugin mutates `bot` by adding methods and event listeners on `bot._client` (the protocol client)
- Bot emits events (e.g., `'chat'`, `'spawn'`, `'kicked'`) defined in `BotEvents` interface
- `bot.registry` (prismarine-registry) provides version-specific data like blocks, items, recipes, biomes
- Version gating: use `bot.supportFeature('featureName')` rather than string-comparing versions
- `Vec3` from `vec3` is used for all 3D positional math
- The `options` object passed to `createBot` is forwarded to all plugins
