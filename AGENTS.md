# Sonemory 项目交接文档

最后更新：2026-08-15  
当前产品版本：v0.5.0  
代码基线：`75dba7f`（`origin/main`、标签 `v0.5.0`）  
仓库：[yezi5yue/Sonemory](https://github.com/yezi5yue/Sonemory)

本文件同时是后续 AI agent 的工作入口。接手任务时先阅读本文件，再按任务类型阅读文末列出的专题文档。不要在不了解既有产品、内容版权和双许可边界的情况下重做架构或引入依赖。

## 1. 项目定位与已确认决策

Sonemory（读音：`so-NEM-uh-ree`）是本地优先、音频优先、轻屏幕的语音陪学与记忆训练项目，品牌副标为“声声入忆”，英文口号为 “Listen. Practice. Remember.”。

已确认且应保持的产品方向：

1. 前期以儿童可以独立完成的无屏/少屏语音跟学跟练为主；“无屏优先”不等于网页可以锁屏持续运行。
2. 第一阶段聚焦英语单词和词组的自然发音、释义、词性、拼读、跟读、回忆、纠错和延迟重测。
3. 后续可扩展到语文、数学、科学、历史、地理等适合听觉学习和主动回忆的知识点，不应把核心状态机永久绑定到英语字段。
4. 教材教辅内容以用户有权使用的官方来源为准。项目不默认提供、抓取、镜像或推断教材正文与词表。
5. 家长负责课程、资料、来源和学习设置；学生主要选择学习范围并通过听说完成学习。
6. 默认本地存储、无需注册、默认不上传或保存原始录音。AI 识别只有在家长确认数据边界后才能启用。
7. 语音识别失败不等于孩子答错，必须分别统计并避免打击学习积极性。
8. 暂停必须立即中断正在播放或识别的当前步骤，并保存可恢复的会话。

品牌历史：早期仓库和原型名为 OpenRecall；正式名称已确定为 Sonemory。`openrecall` Git remote 只用于旧仓库归档，除非用户明确要求，否则不要向它推送，也不要恢复 OpenRecall 品牌。

## 2. 许可证、品牌与内容红线

许可证模式已经确定为 **AGPL-3.0-only + 单独商业授权 + CLA**：

- 社区代码按 `AGPL-3.0-only` 发布。
- 不希望承担 AGPL 义务的闭源商业使用需要另行签署商业授权。
- 外部贡献者必须接受适用的个人或组织 CLA，项目所有者需要保留再许可和商业许可所需权利。
- Sonemory 名称、Logo、音频标识和品牌资产不随 AGPL 自动授权，受 `TRADEMARKS.md` 约束。
- 用户导入的教材、词表、音频和学习记录不会因为进入应用而自动变成 AGPL 内容，其权利仍由原始内容决定。

任何 agent 都不得：

- 把受版权保护的教材或付费教辅内容提交到仓库；
- 擅自把许可证改成 MIT、Apache、BUSL 或其他模式；
- 把云平台长期密钥、儿童录音或真实学习数据提交到仓库；
- 仅因某组件“可开源使用”就认定它可进入未来的闭源商业版本；
- 引入 SDK、模型、权重、声音、字体或数据集而不更新 `THIRD_PARTY_NOTICES.md` 并核查商业再许可权。

法律专题先读：`LICENSING.md`、`COMMERCIAL-LICENSE.md`、`CLA.md`、`TRADEMARKS.md`、`docs/licensing-strategy.md`、`docs/cla-operations.md`。

## 3. 当前功能基线

### v0.1–v0.3

- 建立英语单词的音频学习状态机和本地学习记录。
- 修复粘贴内容中的 CSV/竖线混合格式；词组允许不填词性。
- `sth`、`sb` 等词典记号在播报和答案判断时展开为完整英语。
- 增加网页和语音立即暂停。
- 建立“大类 → 子类 → 课程 → 内容资料”本地资料库和旧数据迁移。
- 学生端按层级选择课程；点击课程后在同一控件内输入名称搜索，可跨分类定位。

### v0.4

- 可分别把语音播放和识别切换到 Sonemory Speech Gateway Protocol v1。
- 网关支持临时 Bearer Token；长期密钥应保存在网关服务端，令牌不写入 `localStorage`。
- 远程网关必须使用 HTTPS；HTTP 仅允许 localhost、127.0.0.1 和 `[::1]`。
- 录音请求回声消除、降噪、自动增益和单声道，并使用轻量 VAD 提前结束静音。
- 推荐优先验证 Azure AI Speech、sherpa-onnx、FunASR；OpenAI、腾讯云、讯飞、ElevenLabs 作为对照或补充。前端不硬编码平台和模型。

### v0.5

- “导入新资料”按大类、子类、课程三级联动确认归属。
- 课程可以编辑名称、说明、大类和子类；资料编辑时可以移动所属课程。
- 支持 CSV、XLSX、粘贴内容、格式校验和前五项预览。
- 提供 `templates/sonemory-import-template.csv` 和 `.xlsx` 模板。
- XLSX 在浏览器本地解压，仅读取第一个工作表；限制 10 MB、10,000 条，不支持旧版 `.xls`。
- 资料可以导出 CSV，资料卡显示已练习和待巩固数量。
- 学生可以按资料的 `unit` 字段选择本次范围；会话快照记录 Unit，暂停恢复不会进入其他范围。

最近一次验证结果：35 个 Node 测试全部通过；静态检查覆盖 37 个必需文件；浏览器实测通过 XLSX 上传、三级归属、预览、保存、课程编辑、Unit 选择和进度概览，控制台无报错。

## 4. 技术架构

项目是无构建步骤的静态 PWA，没有第三方包管理器运行时依赖：

```text
CSV / XLSX
    ↓
本地解析、预览、字段校验
    ↓
大类 → 子类 → 课程 → 内容资料 → Unit 范围
                                      ↓
浏览器/AI 语音识别 → 学习状态机 → 浏览器/AI 语音合成
                         ↓
                会话、掌握度、学习历史
```

核心文件：

| 文件 | 职责 |
|---|---|
| `index.html` | 学生学习、资料管理、学习设置、学习记录四个视图 |
| `src/app.js` | DOM 协调、资料管理、学习控制器、语音流程、导入预览 |
| `src/content.js` | CSV/竖线解析、资料标准化、来源和重复项校验、资料更新合并 |
| `src/importers.js` | CSV 文件读取、XLSX ZIP/XML 解析、文件大小和解压大小限制 |
| `src/engine.js` | 确定性学习队列、答案判断、延迟重试、统计和会话快照 |
| `src/notation.js` | 词典缩写、括号形式、拼读和可接受答案展开 |
| `src/speech.js` | 浏览器 TTS/STT、设备端语言包、AI 网关、录音与 VAD |
| `src/storage.js` | 本地存储、四级资料模型、选择、迁移、会话、历史、进度 |
| `service-worker.js` | 离线缓存和版本更新 |
| `server.mjs` | 零依赖本地静态服务器 |
| `tests/*.test.js` | 内容、导入、状态机、记号、语音、存储测试 |
| `scripts/check.mjs` | 文件、语法、版本、许可证、PWA 静态一致性检查 |

## 5. 数据模型和兼容性

`sonemory.library.v3` 包含：

- `categories[]`：`id`、`name`、时间字段；
- `subcategories[]`：必须引用合法 `categoryId`；
- `courses[]`：必须同时引用匹配的 `categoryId` 和 `subcategoryId`；
- `packs[]`：必须引用合法 `courseId`，包含来源元数据和学习项。

学习项字段：

```text
word, meaning, partOfSpeech, unit, chunks, aliases, note, locale
```

其中 `word`、`meaning` 必填；词组可不填 `partOfSpeech`；`chunks` 和 `aliases` 使用 `|` 或中文分号拆分；空 Unit 归入“未分组”。

其他存储键：

- `sonemory.selection.v1`：当前大类、子类、课程和资料；
- `sonemory.settings.v2`：学习节奏、浏览器/AI 语音设置；
- `sonemory.session.v1`：暂停会话、资料 ID、Unit、引擎快照；
- `sonemory.history.v1`：最近 30 次完成记录；
- `sonemory.progress.v1`：按资料 ID 保存 `nextOffset` 和逐项 mastery。

兼容性要求：

- v0.2 课程迁移到“未分类 / 默认分类”；更早的单资料迁移到“默认课程”。
- 编辑资料时保持资料 ID；同名学习项保持原 ID，避免丢失已有掌握度。
- 不要无迁移方案地修改现有 storage key 或 schema。

已知设计限制：`nextOffset` 当前按资料保存，不是按 Unit 分开保存；切换 Unit 后会把同一个 offset 对新范围取模。若改为按 Unit 保存，需要兼容旧进度和全部内容范围。

## 6. 语音边界

默认模式使用浏览器能力。Web Speech 的准确度、是否联网和语言包行为取决于浏览器、系统、设备、儿童音色和环境，不要在产品文案中承诺“完全离线”或固定准确率。

AI 网关统一协议：

- TTS：`POST` JSON，返回音频或 Base64 JSON；
- STT：`POST multipart/form-data`，上传短音频以及 language、model、phrases；
- 请求头：`X-Sonemory-Speech-Protocol: 1`；
- 启用 AI STT 前必须有家长确认；默认不保存原始录音。

发音评估分数不能直接等同于知识对错，尤其需要用儿童、非母语口音和噪声样本校准。主要验收指标是正确回答拒绝率、错误回答接受率、目标词前五候选命中率、指令识别率和 P50/P95 延迟。

## 7. 本地开发和验证

正常环境：

```bash
npm start
npm test
npm run check
```

访问 `http://127.0.0.1:4173/?v=0.5.0`。修改静态资源后要更新版本查询参数和 Service Worker 缓存名，否则可能看到旧缓存。

当前用户的 Windows 环境曾出现 `git`、`npm` 不在 PATH。Codex 桌面环境可直接使用捆绑运行时：

```powershell
$node = 'C:\Users\administered\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$git = 'C:\Users\administered\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'

& $node server.mjs
& $node --test
& $node scripts/check.mjs
& $git status --short
```

任何功能变更至少执行：

1. `node --test`；
2. `node scripts/check.mjs`；
3. `git diff --check`；
4. UI 改动使用真实浏览器重新加载后验证 DOM、关键交互和控制台；
5. 文件导入改动用仓库内 CSV 和 XLSX 模板做真实选择、预览和保存测试；
6. XLSX 模板变更需要检查两个工作表的值和可视化布局。

浏览器验收会修改该浏览器的 localStorage。当前浏览器里可能仍有“验收大类 0815”“Sonemory 层级检索验收课”和“v0.5 XLSX 验收资料”等测试数据；它们不在仓库中。不要把浏览器数据当成种子数据，也不要未经用户同意清除其本地资料。

## 8. 版本与发布流程

当前开发分支是 `codex/sonemory-mvp`，生产远程是 `origin/main`。保持 `codex/` 分支前缀；不要 force push。

发布新版本时同步更新：

1. `package.json` 的版本；
2. `index.html` 的 CSS/JS `?v=` 和页脚源码标签；
3. `src/*.js` 内部模块导入的 `?v=`；
4. `service-worker.js` 的缓存名和资产版本；
5. README 中的缓存升级 URL 和路线图；
6. `THIRD_PARTY_NOTICES.md` 的 reviewed version；
7. 新增关键文件时更新 `scripts/check.mjs`；
8. 完成自动测试和浏览器验收后提交，创建注释标签并推送 `HEAD:main` 与标签。

`scripts/check.mjs` 会检查多数版本不一致，但不能代替实际页面验收。发布历史：

- `v0.1.0–v0.1.2`：基础学习闭环和许可治理；
- `v0.2.0`：课程资料库和本地语音设置；
- `v0.3.0`：大类/子类层级；
- `v0.4.0`：课程内嵌搜索和 AI 语音网关；
- `v0.5.0`：三级导入归属、CSV/XLSX、模板、Unit 学习。

## 9. 已评估的产品缺口

按当前优先级：

### P0

1. 完整资料库、设置、进度的一键本地备份与恢复，包含 schemaVersion、导入预检和冲突处理。
2. 家长端逐词掌握度和错误原因明细，区分答错、识别失败和提示使用。
3. 浏览器识别失败时的纯语音恢复路径，包括重试、麦克风自检和临时切换为只听跟读。

### P1

1. 多孩子本地档案：资料共享，设置和进度按学习者隔离。
2. 可解释的间隔复习、到期时间和熟练度模型。
3. Excel 列名映射、重复项处理策略和导入差异摘要。
4. 从英语 `word/meaning` 演进为跨学科 `prompt/answer/explanation`，同时保持旧资料兼容。

### P2

1. 本地回收站与可恢复删除。
2. 可选择、端到端加密且默认关闭的跨设备同步。

不要在一个版本同时完成多学习者、通用内容模型和同步；这些都会改变存储结构，应分别设计迁移、回滚和测试。

## 10. 后续 agent 接手清单

开始工作前：

1. 运行 `git status --short`，保留用户已有改动；
2. 阅读 `README.md`、本文件和与任务直接相关的专题文档；
3. 运行当前测试建立基线；
4. 检查任务是否影响内容版权、儿童隐私、许可证或浏览器存储迁移；
5. 对用户没有明确指定的产品细节做最小、可逆、与既有方向一致的假设。

完成工作前：

1. 补充与风险相称的自动测试；
2. UI/音频/文件流程做实际页面验收；
3. 更新架构、使用说明、第三方台账和本交接文档中受影响的部分；
4. 明确说明未解决的限制，不把实验性能力描述为已验证效果；
5. 推送前确认目标是 `origin` 的 Sonemory 仓库，而不是 `openrecall` 旧远程。

## 11. 专题文档索引

- `README.md`：用户入口、当前能力和路线图；
- `docs/architecture.md`：模块、数据和隐私架构；
- `docs/learning-design.md`：学习流程和记忆设计；
- `docs/content-import.md`：CSV/XLSX 格式、层级归属和管理流程；
- `docs/product-gap-review.md`：学生/家长缺口与优先级；
- `docs/speech-roadmap.md`：设备端语音路线；
- `docs/ai-speech-integration.md`：AI 网关协议、平台选型和验收指标；
- `docs/licensing-strategy.md`：AGPL、商业授权和 CLA 的影响；
- `SECURITY.md`：安全和儿童隐私报告边界；
- `THIRD_PARTY_NOTICES.md`：依赖、模型、素材准入台账。
