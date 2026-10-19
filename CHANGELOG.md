# Changelog

## [1.5.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.4.2...v1.5.0) (2026-10-16)


### Features

* **sync:** count Grok Bot separately and discover Codex rollouts ([9bbf6ed](https://github.com/HansKristoffer/tokenmaxxing/commit/9bbf6ed562ef68e81603ff47a6bb6da4c098bc35))
* **web:** XP bar on the player card, and three levels before Singularity ([2791fad](https://github.com/HansKristoffer/tokenmaxxing/commit/2791fad166e9b04223d73dbaf6711f71f0428404))
* **web:** XP bar on the player card, and three levels before Singularity ([251964b](https://github.com/HansKristoffer/tokenmaxxing/commit/251964b26d683f1f2e59d7d8986c1cef602de203))

## [1.4.2](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.4.1...v1.4.2) (2026-10-05)


### Bug Fixes

* **bots:** show bot lines only as speech bubbles, not in chat ([#44](https://github.com/HansKristoffer/tokenmaxxing/issues/44)) ([7d5d1b2](https://github.com/HansKristoffer/tokenmaxxing/commit/7d5d1b23070c807a8ea876dd2bdb4e159710b1e5))
* **sync:** count missed usage and PRs, show today per source in the menu bar ([#46](https://github.com/HansKristoffer/tokenmaxxing/issues/46)) ([c80846a](https://github.com/HansKristoffer/tokenmaxxing/commit/c80846ae8084cc3bdc5477481342347f2440a6b3))

## [1.4.1](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.4.0...v1.4.1) (2026-10-03)


### Bug Fixes

* **usage:** resume excluded event cleanup in background ([b6331ba](https://github.com/HansKristoffer/tokenmaxxing/commit/b6331ba3b147b62d4d7fae71e13a5fe4c5207ab4))
* **usage:** resume excluded event cleanup in background ([67b9ab8](https://github.com/HansKristoffer/tokenmaxxing/commit/67b9ab8d0e5cc0ab21d2ac90539827e36c079e7c))

## [1.4.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.3.3...v1.4.0) (2026-10-02)


### Features

* **bots:** add town bot routines and contextual dialogue ([230031e](https://github.com/HansKristoffer/tokenmaxxing/commit/230031e72c1facfbe7ad59ea78c279d177c14a08))
* **bots:** add wandering town characters ([104e6b4](https://github.com/HansKristoffer/tokenmaxxing/commit/104e6b406420ab5c5a3823ba2682f7f786d89ff9))
* **bots:** add wandering town characters ([844a12f](https://github.com/HansKristoffer/tokenmaxxing/commit/844a12fa9b2ca370e0418c5bd0b217b3416dd310))
* **shop:** add a panda pet ([53ee954](https://github.com/HansKristoffer/tokenmaxxing/commit/53ee9546f7601d79d8159e5d4243dd86f01cc5c7))
* **shop:** add a panda pet ([de37df5](https://github.com/HansKristoffer/tokenmaxxing/commit/de37df56ee973e05f4984cbe402e1deb5fd0f803))


### Bug Fixes

* exclude Grok default and CUA bot usage ([a1a3467](https://github.com/HansKristoffer/tokenmaxxing/commit/a1a346764e2010a45eaa5c2cb3212fa647c327e6))
* fall back to historical Cursor API costs for unmatched models ([1d9b0ec](https://github.com/HansKristoffer/tokenmaxxing/commit/1d9b0ec3353eff3aad97b2c8ca431def845451dd))
* match reasoning effort variants to base model prices ([0a2551e](https://github.com/HansKristoffer/tokenmaxxing/commit/0a2551e99c727654250e8e0502facde99e667e4f))
* preserve reported Cursor costs in usage totals ([d56ba77](https://github.com/HansKristoffer/tokenmaxxing/commit/d56ba77b4f6287da8f4e0562e2979f8b6944ff29))
* price Cursor Composer and Grok with published fallback rates ([f60ab29](https://github.com/HansKristoffer/tokenmaxxing/commit/f60ab29e464a85242f80ac9a4cc30d2955e6cb9d))
* stream Cursor history backfills in larger pages ([3709f4c](https://github.com/HansKristoffer/tokenmaxxing/commit/3709f4c444798de1f7e0cfb2849eb11d0b3472f6))
* sync actual Cursor dashboard token usage ([d93ab3e](https://github.com/HansKristoffer/tokenmaxxing/commit/d93ab3e18a5547ee050467a3ad9975daf401925c))
* sync Cursor dashboard usage with consistent token pricing ([c35b460](https://github.com/HansKristoffer/tokenmaxxing/commit/c35b46070a2110baeaac3310cfa423e8b3431386))
* use shared Cursor pricing and exclude background automation ([bfcf895](https://github.com/HansKristoffer/tokenmaxxing/commit/bfcf8957850676ebae3dc621270c3242cf05f219))

## [1.3.3](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.3.2...v1.3.3) (2026-10-01)


### Bug Fixes

* **connect:** prevent match state proxy errors ([e553e7f](https://github.com/HansKristoffer/tokenmaxxing/commit/e553e7fda7fee2883094d9591b97f954409b7479))
* **connect:** prevent match state proxy errors ([5d6df84](https://github.com/HansKristoffer/tokenmaxxing/commit/5d6df84f75b566cbf65a13733c563f4e7885bcf3))
* **tunnel:** prevent token sync overload during match updates ([4ba46d5](https://github.com/HansKristoffer/tokenmaxxing/commit/4ba46d5967982d4648f73975e9d594557ccf88ee))
* **tunnel:** prevent token sync overload during match updates ([4cc5a7a](https://github.com/HansKristoffer/tokenmaxxing/commit/4cc5a7af611f11c913aa0420ba6c6dc38e519208))

## [1.3.2](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.3.1...v1.3.2) (2026-09-30)


### Bug Fixes

* **tunnel:** finish matches saved as over after restart ([7d99a82](https://github.com/HansKristoffer/tokenmaxxing/commit/7d99a82b5050055aa7c723b9a10136f654ef55cc))
* **tunnel:** finish matches saved as over after restart ([1a2e9fc](https://github.com/HansKristoffer/tokenmaxxing/commit/1a2e9fccd6c62ba3602b8a0012f3e364d288610b))

## [1.3.1](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.3.0...v1.3.1) (2026-09-30)


### Bug Fixes

* **hosts:** keep token syncs working through player delays ([f061709](https://github.com/HansKristoffer/tokenmaxxing/commit/f061709ae9c56b29c78277468e4434f1eda035f4))
* **hosts:** keep token syncs working through player delays ([72ba106](https://github.com/HansKristoffer/tokenmaxxing/commit/72ba1062aebd5eea26c7cf7f7078441c5d47c1dd))
* **usage:** coalesce token sync and battle updates ([d30d76a](https://github.com/HansKristoffer/tokenmaxxing/commit/d30d76a44dc8ca3d58867999fb65aa39c0c6c794))
* **usage:** keep token totals synced through retries ([b4f8a63](https://github.com/HansKristoffer/tokenmaxxing/commit/b4f8a63ea32869142d6b6331b9c593b147e0555c))
* **usage:** keep token totals synced through retries ([d84bd32](https://github.com/HansKristoffer/tokenmaxxing/commit/d84bd3248832792992f0cea44e742d955f4a036c))

## [1.3.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.2.0...v1.3.0) (2026-09-30)


### Features

* **admin:** add authenticated game management dashboard ([c3bbe4b](https://github.com/HansKristoffer/tokenmaxxing/commit/c3bbe4bc0486658bbbd2898972a4ca05e711ca1d))
* **admin:** add authenticated game management dashboard ([ab8280d](https://github.com/HansKristoffer/tokenmaxxing/commit/ab8280daf9531e142ee4c0400c90d20431f4141e))
* **connect:** link computers to sync usage across devices ([4b04d01](https://github.com/HansKristoffer/tokenmaxxing/commit/4b04d01d14db754f5342e605128b0a9be7e2159e))
* **connect:** link computers to sync usage across devices ([6706314](https://github.com/HansKristoffer/tokenmaxxing/commit/6706314c0cd08c8834686c7bc01d298d996db5dd))

## [1.2.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.1.0...v1.2.0) (2026-09-29)


### Features

* **coffee:** add stackable coffee and avatar shaking ([c247e82](https://github.com/HansKristoffer/tokenmaxxing/commit/c247e82bd7e6e1ad134b574d87f238866de7025b))
* **coffee:** add stackable coffee and avatar shaking ([6183610](https://github.com/HansKristoffer/tokenmaxxing/commit/6183610f878b1cf0cc2b272559d01354e4009bb4))
* **coins:** count earnings from signup day ([3f2f186](https://github.com/HansKristoffer/tokenmaxxing/commit/3f2f18608f49ad639d325412df8de8cae0397401))
* **coins:** count earnings from signup day ([06f2d04](https://github.com/HansKristoffer/tokenmaxxing/commit/06f2d04d3adedb64f585bb8a2a8e8c4cdb18dd33))
* **desktop:** open game links in the system browser ([7823cda](https://github.com/HansKristoffer/tokenmaxxing/commit/7823cda659a18960ad498b825150b54edbb846b6))
* **web:** add match chat, jumping, and sharper company logos ([7c6d13c](https://github.com/HansKristoffer/tokenmaxxing/commit/7c6d13c4e8e11087f69fb9e7dba88643fecf85cf))
* **web:** add match chat, jumping, and sharper logos ([a7d0e43](https://github.com/HansKristoffer/tokenmaxxing/commit/a7d0e4326499163bc2c732d8e695c398b53534a3))
* **world:** keep idle players present in town ([51e8026](https://github.com/HansKristoffer/tokenmaxxing/commit/51e8026509e1e1bef54b01e2b9aac7e37b421be5))
* **world:** keep idle players present in town ([23a8681](https://github.com/HansKristoffer/tokenmaxxing/commit/23a86810c6861e4b54e73944c95597b7a692428d))


### Bug Fixes

* **web:** keep the desktop link handler type-safe ([f56e0cf](https://github.com/HansKristoffer/tokenmaxxing/commit/f56e0cf7d76a0d4831a297bd3214bd2784f80039))

## [1.1.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.0.2...v1.1.0) (2026-09-29)


### Features

* **desktop:** move sign-in into the game window ([3a417bd](https://github.com/HansKristoffer/tokenmaxxing/commit/3a417bde1e881bcd82c824d021d799ef823a0f94))
* **desktop:** move sign-in into the game window ([34a8d74](https://github.com/HansKristoffer/tokenmaxxing/commit/34a8d74eebe3dd78ff8f49a4625a819c21067f19))


### Bug Fixes

* **server:** let the app and browsers through to the game in production ([5dd720b](https://github.com/HansKristoffer/tokenmaxxing/commit/5dd720bd1ac20e418ce551b41827984571e02a27))
* **server:** let the app and browsers through to the game in production ([a576838](https://github.com/HansKristoffer/tokenmaxxing/commit/a57683869491b6d6eb5a49dd89ef3a64abf6d9f9))

## [1.0.2](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.0.1...v1.0.2) (2026-09-29)


### Bug Fixes

* **desktop:** no more freeze from the menu, and opening the app opens the game ([13dfabe](https://github.com/HansKristoffer/tokenmaxxing/commit/13dfabe0257769c83cb8530ab73cd9e186884d1a))
* **desktop:** no more freeze from the menu, and opening the app opens the game ([0f62bf1](https://github.com/HansKristoffer/tokenmaxxing/commit/0f62bf1481ac0dede119a6690f524050db333827))

## [1.0.1](https://github.com/HansKristoffer/tokenmaxxing/compare/v1.0.0...v1.0.1) (2026-09-29)


### Bug Fixes

* **desktop:** save the signing identity with its letters intact ([e997f33](https://github.com/HansKristoffer/tokenmaxxing/commit/e997f339d5f2f00c9fb32fdd1445193c7629cd85))
* **desktop:** save the signing identity with its letters intact ([7350ab4](https://github.com/HansKristoffer/tokenmaxxing/commit/7350ab408df6ba35aedce69551c1341726dd989b))

## [1.0.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.5.0...v1.0.0) (2026-09-29)


### ⚠ BREAKING CHANGES

* the menu bar app is now the Tauri desktop app, with the game in its own window.
* **app:** the menu bar app is just an Open world button
* a new backend with no migration. Accounts and groups are not carried over: people sign up again from the updated app, which re-syncs their full history from local logs. The 0.4 app can't talk to this server.

### Features

* a marketing site at the root, and the game at /play ([3a766f3](https://github.com/HansKristoffer/tokenmaxxing/commit/3a766f3f333b7174c4462d01926b0e10092915e3))
* a page for every company, like a player's card ([a578e69](https://github.com/HansKristoffer/tokenmaxxing/commit/a578e69e43c1e1f1fce41b4f8d18afe2d9507211))
* a pixel-art app icon, a tiny world struck by lightning ([3122a97](https://github.com/HansKristoffer/tokenmaxxing/commit/3122a97317077610cf41b0d42f7b2dd4e219771a))
* apply to join a company, and the owner accepts or declines ([6803c18](https://github.com/HansKristoffer/tokenmaxxing/commit/6803c18364f35da7e7b5007958eb74500671f691))
* **app:** the menu bar app is just an Open world button ([5656d64](https://github.com/HansKristoffer/tokenmaxxing/commit/5656d645946b3d4b2e2ffcf46681d4d900e03a7a))
* **app:** trim the menu bar to a mini leaderboard and Open world ([508c9e1](https://github.com/HansKristoffer/tokenmaxxing/commit/508c9e1d167821cca8253a0f61e5014b979871b5))
* **core:** the game interface, payouts, and Ship, Pivot, Raise ([a50d5c1](https://github.com/HansKristoffer/tokenmaxxing/commit/a50d5c16871d1f066b42f6d91a68a1730e001518))
* **desktop:** a Tauri app that is the menu bar app and the game window ([c42964c](https://github.com/HansKristoffer/tokenmaxxing/commit/c42964cf2392007c273c7d57b65cb6af1d5e37d2))
* **desktop:** the app updates itself, and says so in the game ([d28803f](https://github.com/HansKristoffer/tokenmaxxing/commit/d28803f7b75e1b2b57bf514bf93c7f21b2ca52f9))
* Due Diligence, Liar's Dice for 2–6 players ([1d3c32a](https://github.com/HansKristoffer/tokenmaxxing/commit/1d3c32a1cb4deeaf9d955b9645e92271e9b88550))
* game stats on player cards and a Games tab on the leaderboard ([0f0bbe3](https://github.com/HansKristoffer/tokenmaxxing/commit/0f0bbe3edb18184bc37f13fcb83b55fcd4f68b71))
* **helper:** today's count and the battle standing, for the menu bar ([dcd40b1](https://github.com/HansKristoffer/tokenmaxxing/commit/dcd40b1ddea079ebfd2ee961fdcb3c1befa3a714))
* Hype Cycle, a crash game for 2–8 players ([3ceea61](https://github.com/HansKristoffer/tokenmaxxing/commit/3ceea611d516c249b6b9c69aa1942ae5f3393e1e))
* rank the leaderboard by agent hours ([7829b2a](https://github.com/HansKristoffer/tokenmaxxing/commit/7829b2a19659f8b39703d26c61791bf1e0c9c8dc))
* rebuild the backend on Rivet actors for one shared pixel world ([6755884](https://github.com/HansKristoffer/tokenmaxxing/commit/6755884f027eaf78537b21d96682eb9207a94986))
* **release:** the website's Download button fetches the installer itself ([83d4273](https://github.com/HansKristoffer/tokenmaxxing/commit/83d427322b2bed8944dc17ea513cdacd7adf89fc))
* **server:** a coin ledger for stakes, bets and payouts ([e164cd9](https://github.com/HansKristoffer/tokenmaxxing/commit/e164cd9795d15fb672f7790b280718be7926bf0a))
* **server:** tables, matches and games gathering in town ([e2aa7f2](https://github.com/HansKristoffer/tokenmaxxing/commit/e2aa7f2cdfed65d0849c8fa3ca3097b67026c269))
* ship the Tauri desktop app instead of the Swift menu bar app ([52b8de9](https://github.com/HansKristoffer/tokenmaxxing/commit/52b8de9fa042e401811e302d5d89c43f82292fe4))
* the town grows where new companies choose to build ([78412b0](https://github.com/HansKristoffer/tokenmaxxing/commit/78412b032fda120660a4b2dd5d5867be7094cd40))
* Tokenmaxxing, burn the most real tokens in the time you agreed ([2c1471b](https://github.com/HansKristoffer/tokenmaxxing/commit/2c1471b64774a9dead45682fcbff5305816200c7))
* **web:** a games box under the leaderboard ([5475574](https://github.com/HansKristoffer/tokenmaxxing/commit/5475574e697ce476e7061609c6cedc0671d2139b))
* **web:** a nicer leaderboard with a podium ([e84b1ab](https://github.com/HansKristoffer/tokenmaxxing/commit/e84b1ab10b4874197aac63feb93edfcf8ec34b56))
* **web:** quick replies above the chat, and emoji bursts ([b02d7a8](https://github.com/HansKristoffer/tokenmaxxing/commit/b02d7a8b68e6b20d94c202f6f8dc318a7dd678b2))
* **web:** the arcade, the match panel, and games at tables in town ([61cfc36](https://github.com/HansKristoffer/tokenmaxxing/commit/61cfc36947e8885eb3462ff695270a56afde7242))
* **web:** the world client: town, houses, chat, leaderboard and shop ([c9ebaae](https://github.com/HansKristoffer/tokenmaxxing/commit/c9ebaaee9869acd78f01895b47bfa8f9b1e64e44))
* **web:** tidier HUD, smooth zoom, and @-invites like chat mentions ([6948e30](https://github.com/HansKristoffer/tokenmaxxing/commit/6948e3034f9a9e18a133cfc67fc18da113910529))
* **web:** who's online in the room, from the chat header ([4786a91](https://github.com/HansKristoffer/tokenmaxxing/commit/4786a9134abb877d6b768daf33271fb8ac907df1))


### Bug Fixes

* release blockers from the cleanup plan ([d7acdbe](https://github.com/HansKristoffer/tokenmaxxing/commit/d7acdbe81e07224178d85f927d89e201593d3b29))
* **server:** a dropped websocket can't take the server down ([57cec46](https://github.com/HansKristoffer/tokenmaxxing/commit/57cec46fa7429dabac99f5791e244cfb8d87c182))
* **web:** clicking the minimap walks to the tile you clicked ([f775e49](https://github.com/HansKristoffer/tokenmaxxing/commit/f775e49b27511a4ca770612b6e4739f1c54aeab3))


### Performance Improvements

* **web:** less work per frame in the world ([266ba59](https://github.com/HansKristoffer/tokenmaxxing/commit/266ba59e4f973a5cb9dd1d2a919cb357e593319f))

## [0.5.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.4.0...v0.5.0) (2026-09-29)


### Features

* **chat:** improve chat layout and reactions ([bc5ab1b](https://github.com/HansKristoffer/tokenmaxxing/commit/bc5ab1b992ac982d7846efcc2d3507b092092c74))
* **chat:** improve timeline message interactions ([8c24c73](https://github.com/HansKristoffer/tokenmaxxing/commit/8c24c73b0c14bb677c60dfb96ea20d6a0b18bac1))

## [0.4.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.3.0...v0.4.0) (2026-09-28)


### Features

* **chat:** add daily leaderboard races and group timelines ([da1dfc5](https://github.com/HansKristoffer/tokenmaxxing/commit/da1dfc5649b4409423047ec12a94b21d3baf5b86))
* **chat:** add daily leaderboard races and group timelines ([bede680](https://github.com/HansKristoffer/tokenmaxxing/commit/bede6800478c5ada094b861c6c3ec4a3adda4978))
* **github:** track pull requests on leaderboards ([e962e6c](https://github.com/HansKristoffer/tokenmaxxing/commit/e962e6cbbe0d184f470b2cfe2de85ee1e4175969))
* **github:** track pull requests on leaderboards ([55a60ed](https://github.com/HansKristoffer/tokenmaxxing/commit/55a60edb464e19d73ca1fae4dced62a656e80f8d))

## [0.3.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.2.1...v0.3.0) (2026-09-23)


### Features

* **bar:** resize settings window and link to GitHub ([613af87](https://github.com/HansKristoffer/tokenmaxxing/commit/613af879b1506fdb662a5947dd57ef530b7d682c))
* **bar:** resize settings window and link to GitHub ([918aa28](https://github.com/HansKristoffer/tokenmaxxing/commit/918aa2835496223ba11db88c72611b9e87ae2c38))
* **cli:** let users rename accounts and groups ([882a6be](https://github.com/HansKristoffer/tokenmaxxing/commit/882a6be11daeb7a456f7ab95d53542f5847e3280))
* **cli:** let users rename accounts and groups ([746132e](https://github.com/HansKristoffer/tokenmaxxing/commit/746132ed5c42477d0e2c0756a758efb47ba251c6))
* **web:** let a group owner remove members from the dashboard ([#4](https://github.com/HansKristoffer/tokenmaxxing/issues/4)) ([3076f04](https://github.com/HansKristoffer/tokenmaxxing/commit/3076f04b49c3c73baab3696cf102d731360408b4))

## [0.2.1](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.2.0...v0.2.1) (2026-09-23)


### Bug Fixes

* relaunch the updated app by path and isolate dev builds ([1a2a900](https://github.com/HansKristoffer/tokenmaxxing/commit/1a2a9005276f08a785d38bc4643906e6cecb10e8))

## [0.2.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.1.0...v0.2.0) (2026-09-23)


### Features

* show available updates and upgrade in place ([82ef972](https://github.com/HansKristoffer/tokenmaxxing/commit/82ef972c86a7122e6cd5efddfe00e3871e45e13d))


### Bug Fixes

* resize the menu bar popover when its content changes ([5ce59e6](https://github.com/HansKristoffer/tokenmaxxing/commit/5ce59e6bb9adcf498ab9a0f3556cef1a47c32901))

## [0.1.0](https://github.com/HansKristoffer/tokenmaxxing/compare/v0.1.0...v0.1.0) (2026-09-23)


### Features

* app icon and first release ([a1f6b2e](https://github.com/HansKristoffer/tokenmaxxing/commit/a1f6b2e7f13f8be945dcad9dd34a139e24ae7d2b))
