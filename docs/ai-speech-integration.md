# Sonemory AI 语音接入与选型

版本：1.0（2026-08-15）

## 结论

Sonemory 不应把某一家云平台 SDK 或密钥直接写进前端。v0.4 使用一个稳定的 **Sonemory Speech Gateway Protocol v1**：浏览器只认识统一的 TTS/STT 端点，网关负责适配 OpenAI、Azure、腾讯云、讯飞、ElevenLabs 或本地开源模型。

推荐首轮同时验证三条线：

1. **Azure AI Speech**：最适合英语陪学能力验证，TTS、STT、SSML、自定义词表和发音评估在一个产品体系内；发音评估仍需用儿童样本单独校准，不能直接作为知识对错依据。
2. **sherpa-onnx 自托管网关**：本地优先基线，统一覆盖 ASR、TTS、VAD 和降噪，适合未来桌面伴侣或家庭局域网服务。
3. **FunASR / SenseVoice 自托管网关**：优先验证中文、英文混合以及中国大陆设备环境；项目已有 OpenAI 兼容转写服务，适合快速做 STT 对照实验。

OpenAI、ElevenLabs、腾讯云和讯飞可作为第二批云端对照。不要凭平台宣传选择最终方案；应以 Sonemory 的儿童短词与短语数据集衡量正确接受率、错误接受率和延迟。

## v0.4 接入方式

学习设置中可以分别选择：

- **语音播放**：浏览器内置 TTS，或 AI / 自托管语音网关；
- **语音识别**：浏览器设备端/默认服务，或 AI / 自托管语音网关。

因此可以先仅替换 TTS，提升单词发音清晰度，同时继续让识别留在设备端。启用 AI 网关识别时，家长必须明确确认作答音频会发送到所配置的服务。

安全边界：

- 云平台长期密钥必须放在网关服务端，不应放入静态网页或提交到仓库；
- 网页中的临时 Bearer Token 只保存在当前页面内存，不写入 `localStorage`；
- 远程端点必须使用 HTTPS，HTTP 只允许 `localhost`、`127.0.0.1` 和 `[::1]`；
- 网关需要限制请求体大小、允许的来源、调用频率和上游模型，并记录不含原始音频的诊断指标；
- 云端语音合成应在产品中明确提示用户听到的是 AI 生成语音；
- 儿童录音的同意、保留、删除、跨境和第三方处理条款必须逐个平台审查。

## Speech Gateway Protocol v1

### TTS

请求：

```http
POST /tts
Content-Type: application/json
X-Sonemory-Speech-Protocol: 1
Authorization: Bearer <optional-session-token>
```

```json
{
  "text": "run low on something",
  "language": "en-US",
  "rate": 0.92,
  "pitch": 1,
  "voice": "teacher",
  "model": "provider-model-id"
}
```

响应可以直接返回 `audio/mpeg`、`audio/wav`、`audio/ogg` 等音频；也可以返回：

```json
{ "audioBase64": "...", "mimeType": "audio/mpeg" }
```

### STT

请求为 `multipart/form-data`：

| 字段 | 含义 |
|---|---|
| `audio` | 浏览器录制的 WebM/Opus 或 Ogg/Opus 短音频 |
| `language` | BCP-47 语言代码，例如 `en-US` |
| `model` | 可选的上游模型 ID |
| `phrases` | JSON 字符串；当前目标词、别名和语音指令，最多 48 项 |

响应：

```json
{
  "transcript": "run low on something",
  "confidence": 0.91,
  "alternatives": [
    { "transcript": "run low", "confidence": 0.77 }
  ]
}
```

网关也可返回 `text` 替代 `transcript`，候选项也可使用 `text`。前端录音会请求回声消除、降噪和自动增益，并在检测到说话结束约 850ms 后停止；不支持音量分析的浏览器会在超时上限停止。

## 云平台候选

| 优先级 | 平台 | 适合点 | 主要限制 |
|---|---|---|---|
| 1 | Azure AI Speech | 神经/HD TTS、SSML 可调语速停顿和发音、自定义词表、STT、专门的发音评估 | 云端成本与区域差异；发音评分必须做儿童偏差验证 |
| 2 | OpenAI Audio / Realtime | TTS 与 GPT-4o Transcribe 接口简洁；可通过提示和上下文改善专有词；适合快速网关原型 | 不提供教育场景专用发音分；模型与可用性会变化，需由网关隔离版本变化 |
| 3 | 腾讯云语音 | 中国大陆网络条件友好；实时/一句话识别支持英语；临时热词适合每题动态传入目标词 | TTS 与 ASR API 需要分别适配；地域、账号和数据条款需核对 |
| 4 | 讯飞开放平台 | 中文、英文和多方言流式识别；动态修正与个性化词表；国内终端生态成熟 | WebSocket 鉴权适合放在网关；英语儿童短词效果仍需自测 |
| 5 | ElevenLabs | TTS 自然度突出；Scribe v2 支持 90+ 语言和 keyterm prompting，实时 STT 延迟低 | 费用和跨境数据处理；缺少专门的教学发音评估 |
| 6 | Google Cloud / AWS | 企业级区域、权限和监控成熟；Google PhraseSet、Amazon Polly Neural/Generative 可分别增强 STT/TTS | 两套产品组合与网关适配量较大；中国大陆网络与合规需单独评估 |

官方资料：

- [OpenAI Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)、[OpenAI File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Azure pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)、[Azure text to speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech)
- [腾讯云语音识别热词](https://cloud.tencent.com/document/product/1093/40996)
- [讯飞语音听写 WebAPI](https://www.xfyun.cn/doc/asr/voicedictation/API.html)、[讯飞在线语音合成](https://www.xfyun.cn/doc/tts/online_tts/tts_description.html)
- [ElevenLabs Speech to Text](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)、[ElevenLabs Text to Speech](https://elevenlabs.io/docs/help-center/product/speech-synthesis/text-to-speech)
- [Google Cloud Speech adaptation](https://cloud.google.com/speech-to-text/docs/adaptation)、[Amazon Polly neural voices](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html)

## 开源与本地项目

| 优先级 | 项目 | 适合点 | 主要限制 |
|---|---|---|---|
| 1 | sherpa-onnx | 同一运行时包含流式/非流式 ASR、TTS、VAD、降噪；支持 Windows、移动端、WASM 与多种模型 | 模型体积和设备性能差异大；代码与每个模型权重的许可证要分别核对 |
| 2 | FunASR | 中文、英文、日文及中文方言模型丰富；含 VAD、热词和流式模型；可启动 OpenAI 兼容 STT 服务 | 高精度大模型通常需要 GPU；工具包 MIT 不代表所有模型都能商业再许可 |
| 3 | whisper.cpp | 生态成熟、部署简单、多语种、量化模型完整，可做离线 STT 基线 | 只有 STT；孤立儿童短词不一定优于带热词的流式模型；大模型资源占用高 |
| 4 | sherpa-onnx 中的 Kokoro/VITS/Piper 等 TTS | 可经同一网关提供本地 TTS，便于逐语言替换声音 | 各模型的声音、权重与训练数据许可不同，不能按运行时代码许可证推断 |

官方项目资料：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、[FunASR](https://github.com/modelscope/FunASR)、[whisper.cpp](https://github.com/ggml-org/whisper.cpp)。

## 验收标准

通用 WER 不能代表 Sonemory 的教学体验。每个候选至少用相同的儿童样本报告：

- 目标词或短语在前五候选中的命中率；
- 正确回答被拒绝率；
- 错误回答被错误接受率，这是最重要的安全护栏；
- “暂停、重复、不会、拼读”等指令识别率；
- 安静、电视背景声、远场、不同设备和非母语口音分组结果；
- 录音结束到最终结果的 P50/P95 延迟；
- TTS 对单词重音、缩写展开、短语连读、清晰度和儿童主观可懂度；
- 每学习 100 个词的估算成本、服务可用性和数据保留边界。

只有当新引擎降低正确回答被拒绝率，同时没有明显提高错误接受率，才应把它升级为推荐默认值。
