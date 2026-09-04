# 宠物卡通母版与 SCAIL-2 固定动作 POC

这个目录同时保存 ComfyUI 工作流和已经标准化的驱动视频，不包含大模型权重。模型仍在 OneThingAI 的 SCAIL-2 实例中，没有下载到 Mac。

## 照片到统一卡通母版

这一步不再使用浏览器滤镜。项目已经借用 Comfy-Org 官方的 Qwen-Image-Edit-2511 Int8 模板，并保存三份文件：

- `Qwen-Image-Edit-2511-Int8-OFFICIAL.json`：官方原版，只用于追溯和对照，不修改。
- `Pet-Avatar-Master-Qwen2511-Int8.json`：在官方模板上做的最小宠物改造版。
- `Pet-Avatar-Master-Qwen2511-Int8-API.json`：从成功运行的 ComfyUI 画布直接导出，供网页服务端调用 `/prompt`。

官方来源：

- 工作流：<https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_edit_2511_int8.json>
- ComfyUI 教程：<https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511>
- Qwen 官方模型说明：<https://huggingface.co/Qwen/Qwen-Image-Edit-2511>

原版文件 SHA-256：

```text
f69153d857a3e7ad374c4b79775fa2d8d99361135806a5ecf7106f2e41cd2336
```

本次取自上游 commit `e3d92b9aae04644bc4e419de1676c233c168b9e5`，以后即使官方 `main` 更新，也能核对当时使用的具体版本。

改造版沿用官方核心节点和连线，只做了以下改动：

1. `image1` 放用户照片并作为 VAE 初始 latent，当前占位文件为 `pet-source-photo.png`。宠物身份、身体轮廓、毛长和构图都以它为准。
2. `image2` 只放卡通材质、灯光和暖白背景参考，当前占位文件为 `gray-cat-idle.png`；不得复制参考动物的脸型、毛长或身体结构。
3. 正负提示词会先检查用户照片中的年龄感、脸型、眼色、毛长、毛量、颈毛、耳饰毛、腿腹饰毛和尾巴轮廓，再只改变渲染材质与背景。
4. 输出前缀改为 `pet_avatar/pet_avatar_master_qwen2511_int8`。
5. 网页快速预览启用官方 Lightning 4 步路径（CFG 1）；种子固定为 `2026082601`，方便复现和对比。40 步只能作为用户确认母版后的异步精修候选，不能放在同步等待链路。

官方模板需要以下模型文件：

- `models/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors`
- `models/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors`
- `models/vae/qwen_image_vae.safetensors`
- `models/loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`，快速预览必须启用。

手动恢复和验收顺序：

1. 在 ComfyUI 导入 `Pet-Avatar-Master-Qwen2511-Int8.json`。
2. `image1` 选择用户原始宠物照片；如果有清晰脸部近照，可手动接到已预留的 `image3`。
3. `image2` 选择固定卡通材质参考。它只提供材质、灯光和背景，不能当宠物身体模板。
4. POC 先只生成一个候选给用户对照；正式版再扩展为多候选，不要在用户点击前偷偷烧额度。
5. 四个动作都从这张已确认母版独立分叉，不能把上一个动作的结果继续喂给下一个动作。

可视 JSON 不等于后端 `/prompt` 所需的 API JSON。网页代码只使用已导出的 API 版，并在提交前断言关键节点的 ID、`class_type` 和标题，防止以后工作流改动后悄悄把用户图接错。

当前状态：40 步旧版 `../public/assets/generated/pet-avatar-orange-longhair-qwen2511-v1.png` 已因“长毛变短毛”判定不通过。新的 4 步版 `../public/assets/generated/pet-avatar-orange-longhair-qwen2511-v2-fast4.png` 已用同一张原图真实跑通：长毛颈胸鬃毛、耳饰毛、蓬松轮廓和绿色眼睛明显改善，但脸仍偏圆，原图不可见的完整尾巴属于模型推断。因此网页必须继续让用户选“像”或“不像”，不能默认通过。

本次实测分段耗时：确认开机到 GPU 运行约 22 秒；到 ComfyUI 可访问约 12 分 54 秒；两张输入顺序上传 11.2 秒；空队列下 Lightning 4 步执行 41.1 秒；确认开机到图片完成约 14 分 50 秒。这个结果否决了“收到用户请求才启动实例”的产品架构。正式链路必须使用常驻热 worker、预置固定参考图和异步高清/动作队列。

可复用提示词及本次长毛实测提示词保存在 `prompts/pet-avatar-fast-preview.md`。Lightning CFG 为 1 时不能把保真责任押在负向提示词上，毛长、脸龄、眼色等 P0 特征必须写进正向提示词。

API 工作流的关键绑定：

- 节点 `196`：用户原始宠物照片，也是 `image1` 与初始 latent。
- 节点 `41`：`image2` 的卡通材质、灯光和背景参考图。
- 节点 `170:168`：快速预览开关，网页路径必须为 `true`，对应 Lightning 4 步、CFG 1。
- 节点 `170:169`：采样器，每个任务由服务端写入新 seed。
- 节点 `195`：最终图片输出。

## 四套可恢复工作流

- `SCAIL-2-Int8-Pet-POC-idle.json`：眨眼和尾尖轻摆的待机循环。
- `SCAIL-2-Int8-Pet-POC-lick.json`：抬爪、舔爪、放爪并回到中性坐姿。
- `SCAIL-2-Int8-Pet-POC-eat.json`：低头吃一小块猫粮后抬头；仅供本次演示。
- `SCAIL-2-Int8-Pet-POC-head-pet.json`：抬头闭眼享受摸头，再回到中性坐姿。

四份 JSON 各自使用不同的工作流 UUID，避免在 ComfyUI 中被识别成同一份文件而互相覆盖。旧的基准文件和布偶猫测试文件仍保留作对照，不再作为本次四动作 POC 的入口。

## 可复用中文动作模板

舔爪、待机、喂食和摸头已保存为程序可编译的中文模板，不把橘猫或任何用户写死：

- `SCAIL-2-Int8-Pet-POC-lick-cn-template-v1.json`：可视工作流，节点 30、213、202 使用明确占位字段。
- `SCAIL-2-Int8-Pet-POC-lick-cn-template-v1-API.json`：48 节点后端模板，可由服务端直接编译后提交 `/prompt`。
- `SCAIL-2-Int8-Pet-POC-idle-cn-template-v1.json`：待机可视模板，使用独立 UUID，Base 启用、Extend 保持禁用。
- `SCAIL-2-Int8-Pet-POC-idle-cn-template-v1-API.json`：从已成功的 48 节点舔爪 API 基线派生，只换驱动、动作段和输出前缀。
- `SCAIL-2-Int8-Pet-POC-feed-cn-template-v1.json` 与 `SCAIL-2-Int8-Pet-POC-feed-cn-template-v1-API.json`：自包含猫碗喂食模板，使用已验收的 `cat-feed-bowl-driver-seedance-v1.mp4`，固定 `replace_mode = true`。
- `SCAIL-2-Int8-Pet-POC-head-pet-cn-template-v1-API.json`：橘猫首次真实 GPU 验证时使用的 48 节点历史模板，保留用于复现该产物。
- `SCAIL-2-Int8-Pet-POC-head-pet-cn-template-v2.json` 与 `SCAIL-2-Int8-Pet-POC-head-pet-cn-template-v2-API.json`：后续用户复用的摸头模板，明确约束视频和网页都不出现人手、手臂、手指、手形图标或“轻点摸头”引导文字。
- `prompts/pet-action-templates-cn.md`：给人阅读的母版约束、动作说明和调度规则。真正的编译输入以版本化 JSON 模板为准，避免 Markdown 和脚本两份提示词漂移却被误当成同一个源。

运行时只允许程序替换 `__PET_AVATAR_IMAGE__`、`__PET_ID__`、`{{PET_PROFILE_CN}}`和 `{{TAIL_SAFE_SCREEN_SIDE_CN}}`；舔爪额外使用固定驱动定义的活动前爪。提示词档案从上传照片自动提取一次并缓存，四个动作共同复用；不得为每位用户人工重写整段提示词。

模板派生与具体宠物编译由同一个本地脚本完成，提交前会拒绝任何未解析占位符：

```bash
npm run pet:workflow -- build-template idle
npm run pet:workflow -- compile idle workflows/profiles/orange-longhair-test-v1.json workflows/compiled/orange-longhair-test-v1-cat-idle-v1-API.json
npm run pet:workflow -- compile-batch workflows/profiles/orange-longhair-test-v1.json workflows/compiled/batches/orange-longhair-all-actions-v4
```

`compile-batch` 始终生成恰好四个分支的独立清单，并编译待机、舔爪、喂食和摸头四份真实工作流。当前待机是 `POC 可用`，舔爪、喂食和摸头都已经验收，四个分支都可进入调度器。清单还保存母版、profile、模板、驱动、工作流、模型和 seed 信息，安全元数据不会塞进 Comfy API JSON 顶层被误当成节点。

已保存的最新橘猫四动作清单是 `compiled/batches/orange-longhair-all-actions-v4/orange_longhair_test_v1-pet-actions-batch-v1.json`。它的 `mode` 为 `plan_only`、`billingStarted` 为 `false`，表示编译命令本身只生成可分发的工作流和绑定，不会自动发送 GPU 请求。清单必须绑定母版 SHA-256，同时固定两次确定性 seed、`pet-video-v2` 后处理合同和 `pet-video-qa-v2` 验收合同；“已编译”不等于“已启动计费”，更不等于“已发布”。

已编译的橘猫待机 API 工作流保存在 `compiled/orange-longhair-test-v1-cat-idle-v1-API.json`，并已于 2026-08-27 真实提交 GPU 验证。任务 `5c4fc6f2-f13c-450e-b20f-32912f6e793d` 执行成功且节点错误为零，输出 `../public/assets/generated/cat-idle-orange-longhair-scail2-cn-v1.mp4`，纯执行约 202.8 秒。成片保住橘猫身份、长毛、绿眼、双前爪和闭环坐姿，但尾巴中段摆动幅度大于“尾尖轻微摆动”的产品约束，需人工验收后才能冻结为正式待机模板。

橘猫喂食 API 工作流保存在 `compiled/orange-longhair-test-v1-cat-feed-v1-API.json`。该分支已使用 `drivers/cat-feed-bowl-driver-seedance-v1.mp4` 完成一次真实 GPU 运行；历史原片为 `../public/assets/generated/cat-feed-orange-longhair-scail2-cn-v1.mp4`，规格为 H.264、yuv420p、576 × 768、16 fps、81 帧、5.0625 秒，SHA-256 为 `173ef1f86bf31909607401b25b2231d12519fa264610a0f66b7ca5e936d0d82b`。原始运行产物归档在 `validation/orange-longhair-feed-run-v1/cat-feed-orange-longhair-scail2-cn-raw-v1.mp4`，SHA-256 为 `954f191d225c0c652f8dc6d0b3b1e9981a0c0d9555132bf52f60fd89600a818a`。它通过了动作内容验收，但没有通过后来新增的严格首尾发布门禁，所以不能把这段历史记录误读成正式无缝资产。

橘猫摸头 API 工作流保存在 `compiled/orange-longhair-test-v1-cat-head-pet-v1-API.json`。任务 `6545ac85-4b72-4f37-8951-6619cb7e9a98` 在空队列上执行成功，输出 `../public/assets/generated/cat-head-pet-orange-longhair-scail2-cn-v1.mp4`，规格为 H.264、yuv420p、576 × 768、16 fps、81 帧、5.0625 秒，SHA-256 为 `bb57b1ee8ec22e3135d5006cb58eb430756ef7708b92847c8cf0832b7abbd48c`。全部 81 帧均无人手、手臂、舌头和额外肢体，抬头、闭眼、重新睁眼和回到中性坐姿完整。原片与待机背景一致，没有后期调色；运行、哈希和接缝指标见 `validation/orange-longhair-head-pet-run-v1/manifest.json`。

2026-08-26 的首个通用模板实测使用动作安全橘猫母版 `../public/assets/generated/pet-avatar-orange-longhair-motion-safe-v3.png`。任务 `e79f9798-e719-4df3-bed2-743a5c511cd1` 在空队列、同一 RTX 4090 上执行约 207.3 秒，成功输出 `../public/assets/generated/cat-lick-paw-orange-longhair-scail2-cn-v1.mp4`。成片为 H.264、576 × 768、16 fps、81 帧、5.0625 秒；抽帧检查中尾巴保持贴地，抬爪、舔舐、放爪和首尾中性姿势完整，未再出现上一版的尾爪融合。

对应的输入视频位于 `drivers/`：

- `cat-idle-driver-poc-v1.mp4`
- `cat-lick-paw-driver-poc-v1.mp4`
- `cat-eat-driver-poc-v1.mp4`
- `cat-feed-bowl-driver-seedance-v1.mp4`
- `cat-head-pet-driver-poc-v1.mp4`

灰猫参考图保存在 `../public/assets/gray-cat-idle.png`。JSON 只记录服务器文件名，不会把视频或参考图嵌入文件，所以迁移到新实例时三类文件必须一起保留。

## 生成参数与发布参数

- SCAIL 原片输出：576 × 768、16 fps、81 帧、约 5.06 秒。它只是 GPU 生成合同，不是网页发布合同。
- 网页发布输出：H.264 Main Profile、Level 3.1、零 B 帧、最长 30 帧 GOP、8 Mbps VBV、yuv420p、576 × 768、30 fps、152 帧、无音轨；第 0、1、150、151 帧必须来自同一张已确认母版。
- Base 节点 213 启用；Extend 节点 262 禁用。
- 首段保存节点 202 启用；拼接和最终保存节点 269–271 禁用。
- 待机、舔爪和摸头使用 `replace_mode = false`；自包含猫碗喂食必须使用 `replace_mode = true`，以替换被跟踪的猫同时保留驱动中的猫碗、猫粮和背景。种子 `112358`，SAM3 目标为 `cat / cat`。
- 模型、LoRA、VAE、CLIP、姿态强度和五帧重叠参数保持不变。

每套工作流只允许替换参考宠物图、与宠物外观一致的提示词、SAM3 物种词和输出前缀。动作驱动、尺寸、帧数及采样参数不要交给终端用户自由修改。

## 下次打开的恢复步骤

1. 在 ComfyUI 的工作流侧栏寻找上述四个完整名称，不要停留在 `Unsaved Workflow` 空白标签。
2. 如果实例侧列表为空，直接导入本目录对应的 JSON。
3. 若加载节点提示文件缺失，把 `drivers/` 中对应 MP4 和 `../public/assets/gray-cat-idle.png` 重新上传一次。
4. 运行前检查节点 155、30、213、202，分别确认驱动视频、参考图、动作提示词和输出前缀。
5. 确认只有 Base 与首段保存处于启用状态，再提交任务。

## POC 与正式版边界

待机、舔爪和摸头驱动都包含“中性姿势 → 动作 → 回到中性姿势”的闭环。已验收的喂食驱动也是闭环，但它还固定了“无碗中性姿势 → 浅米白色低矮陶瓷碗与多粒棕色干粮入场 → 嘴部真实进入碗内进食 → 抬头复位 → 猫碗退场”的完整场景时序。

所有正式驱动都应满足：首尾是同一个中性坐姿；前后各保留短暂静止；镜头、构图、白色背景和宠物尺度不变；除动作必需物体外不出现其它人物、文字或水印。

## Web 接入

照片母版接口在 `../app/api/pet-avatar/jobs/`：

1. `POST /api/pet-avatar/jobs` 重新验图、把版本化的固定风格图和用户图都上传 ComfyUI、填入 API 工作流并提交 `/prompt`。前端携带幂等键，重试只会返回原任务。
2. `GET /api/pet-avatar/jobs/:jobId` 查 `/history/:promptId` 并返回真实任务状态。
3. `GET /api/pet-avatar/jobs/:jobId/image` 只根据服务端记录的可信输出参数代理 `/view`，不接受浏览器任意文件路径。
4. `POST /api/pet-avatar/jobs/:jobId/confirm` 记录用户通过或退回。
5. `GET/POST /api/pet-avatar/jobs/:jobId/actions` 返回或幂等创建与确认母版绑定的四分支计划；当前只有 `plan_only` 模式，该接口不会调用 ComfyUI `/prompt`。

对已成功试验的那张橘猫原图，本地 POC 按原图 SHA-256 找到已生成的动作安全母版，再要求该母版实际哈希必须等于 `7aa1e9dcb9b3db7e2c83f5bbca6068185a68ec3fc9feb91d0c9ba1e1668e11db` 才允许复用已有待机、舔爪、喂食和摸头四条视频。这两层绑定防止用户确认 A 图却播放 B 图生成的动作。其他新照片仍需服务端配置稳定、受保护的 ComfyUI worker；OneThingAI 的临时浏览器反代不能直接当生产 API。

验收后的输出视频放在 `../public/assets/generated/`，由 `app/page.tsx` 播放。浏览器点击只播放已经生成的 MP4，不会再次调用 ComfyUI。

## 自动收尾、验收与发布

SCAIL 当前原始输出仍锁定为 16 fps、81 帧。四卡运行器下载完四条原片后，会自动调用 `pet-video-finalizer`，执行：

1. 在桥接前检查原始第 0 帧和末帧。全画面 SSIM 必须至少 `0.90`，主体区域至少 `0.86`；并分别检查全画面与主体区域全部 151 组相邻帧，拒绝中央宠物或边缘尾巴、猫碗、背景的闪屏、跳变和冻结。
2. 只有整批恰好一个 `SOURCE_SEAM_MISMATCH` 时可使用第二个 seed，且只重跑该分支一次；多分支同时失败触发保险丝。该资格写入 `run-record.json`，进程重启也不会重置或多花一次额度。
3. 使用固定光流参数统一到 30 fps、152 帧，并让第 0、1、150、151 帧严格回到同一确认母版；前后桥接各 10 帧。编码固定为 H.264 Main Profile、Level 3.1、零 B 帧、最长 30 帧 GOP和 8 Mbps VBV 上限。
4. 检查编码、Profile、Level、B 帧、关键帧间隔、色彩格式、尺寸、帧率、帧数、PTS 最大间隔、完整解码、四个锚点 SSIM，以及成片全画面和主体区域各 151 组相邻帧。
5. 四条全过才用一次目录重命名同时公开四个文件，再原子写入 `published` 批次清单。任一条失败时，整个批次保持 `rejected`，前端不能只注册其中三条。

手动复现单条严格收尾：

```bash
npm run pet:finalize -- \
  --raw ../public/assets/generated/input.mp4 \
  --anchor ../public/assets/generated/confirmed-master.png \
  --out ../public/assets/generated/output-anchor30.mp4
```

运行器会在任何 GPU 请求之前检查完整 ffmpeg/ffprobe 及 `blend`、`minterpolate`、`ssim`、`tpad` 过滤器。生产镜像必须包含这两个二进制文件，或设置 `PET_FFMPEG_BIN` 与 `PET_FFPROBE_BIN`。旧的 `smooth:video` 和 `close:seam` 只保留用于复现历史实验，不得再作为运营人员逐宠物手调的发布流程。

现有橘猫 `anchor30-poc-v2` 四条资产使用同一母版统一到 30 fps、152 帧，供当前页面演示。由于它们的历史原片没有通过上述源片门禁，注册状态是 `POC_SOURCE_GATE_BYPASSED` / `poc_salvage`，不是 `published`。这条标记不能在正式四卡自动发布器中关闭。

## 猫碗路线状态

后期叠加猫碗路线已经验收失败并冻结。即使把画面拆成“完整碗与粮面 → 舌头 → 前排猫粮和碗沿”三层，原始无碗动作仍没有围绕碗口形成正确的头部距离、舌头落点和遮挡关系，结果看起来是在碗外舔。网页小灰演示现已改用端到端生成的自包含 Seedance 喂食成片 `cat-feed-trework-seedance-poc-v1.mp4`；`build-feed-bowl-preview.sh`、`pet-bowl-feed-3d-v2.png` 和对应 MP4 只作为失败样本保留，不得接回主流程。

新的 `cat_feed_v1` 正式路线已把这些条件放进驱动与 SCAIL 生成的同一条链路，不再依赖网页猫碗层。网页播放该自包含成片时不得叠加 DOM 猫碗，也不得套用只对小灰示例生效的 `.demoFeedVideo` 缩放和颜色滤镜。详细失败记录见 `prompts/cat-feed-bowl-transition-v1.md`；历史素材提示词见 `prompts/cat-food-bowl-asset-v2.md`。
