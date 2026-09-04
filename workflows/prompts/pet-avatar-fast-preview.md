# 宠物卡通母版快速预览提示词

## 输入角色

- `Image 1`：用户宠物原图，也是被编辑的底图和初始 latent。宠物身份、身体轮廓、毛长、脸型、眼色、花纹和照片中真实可见的构图全部以它为准。
- `Image 2`：只提供柔和 3D 材质、暖白背景和灯光。不得复制参考动物的脸、毛长、身体结构、眼色、毛色或年龄感。

## 通用正向模板

```text
Image 1 is the sole pet identity, anatomy, coat, proportion, and composition source, and is the image being transformed. First inspect Image 1 carefully. Preserve the exact visible pet: species, mature or young age impression, face and head shape, ear shape and ear furnishings, eye color, muzzle proportions, body proportions, coat-length category, fur density, fur volume and outer silhouette, every visible coat color and unique marking, neck ruff, cheek fur, leg and belly feathering, tail shape and fluffiness, and collar. Never shorten, clip, flatten, smooth, or simplify fur that is visibly long or fluffy in Image 1. Image 2 is style-only: borrow only its polished soft 3D animated-film material, clean warm-white studio background, soft lighting, and clean rendering. Never copy Image 2's animal identity, anatomy, head shape, coat length, body proportions, eye color, colors, markings, or age. Output exactly one full-body pet centered and seated naturally, with both ears, all paws, and the complete tail inside the frame. Change only rendering style and background; do not redesign the pet or add accessories not clearly present in Image 1.
```

## 2026-08-26 成年橘色长毛猫实测正向提示词

```text
Image 1 is the only identity, anatomy, coat, age, proportion, pose, and composition source. Transform the exact adult cat in Image 1 into a polished soft 3D animated-film character. Preserve without simplification: its mature narrow face and muzzle; green eyes; pointed ears with long inner-ear furnishings and ear-tip tufts; exact orange-and-cream tabby colors and visible markings; extremely dense, long, shaggy layered coat; wide fluffy cheek fur; the large neck and chest ruff forming a visible mane; long feathering on the belly, legs and paws; and a long full plume tail. The silhouette must remain unmistakably long-haired and shaggy around the cheeks, neck, chest, ears, belly, legs, paws and tail. Do not turn this adult cat into a round-faced kitten. Image 2 is style-only: borrow only its soft 3D material, warm-white studio background, lighting, and clean rendering. Never copy Image 2's short coat, round head, yellow eyes, anatomy, body proportions, colors, markings, or age. Remove the real-world background. Output exactly one full-body seated cat centered in frame, with both ears, all paws and the complete plume tail visible. Change only rendering style and background; do not redesign the pet.
```

## 负向提示词

```text
wrong pet identity, short-haired coat, smooth compact fur, British Shorthair, round kitten face, baby cat, yellow or amber eyes, missing neck ruff, missing chest mane, missing ear furnishings, missing ear-tip tufts, thin tail, copied anatomy from Image 2, changed markings, extra limbs, cropped ears, cropped paws, cropped tail, multiple animals, text, logo, watermark
```

官方 Lightning 4 步路径使用 CFG 1。Diffusers 的 Qwen Image Edit Plus 实现明确说明，在 `true_cfg_scale <= 1` 时负向提示词不会参与真实 CFG，因此不能指望上面这段负向词修复关键身份特征。上线时应先把照片分析成结构化字段，例如 `fur_length`、`neck_ruff`、`ear_tufts`、`eye_color`、`face_age`、`face_shape`、`tail_visibility`，把置信度不足或原图不可见的特征交给用户确认，再把确认值写入正向提示词。

## 动作安全母版固定补充

下面约束必须追加到所有猫狗母版正向提示词，并由工作流固定 3:4 latent/画布共同保证，不能依靠运营人员逐张修图：

```text
Output exactly one full-body pet on a fixed 3:4 portrait canvas in the canonical motion-safe pose. Both front legs and both front paws must be fully visible, clearly separated, and resting on the floor. Keep clear empty floor directly in front of the paws. Place exactly one tail compactly on the floor behind and along one rear flank; the tail must not cross, touch, cover, or sit in front of either front leg or front paw. Keep both ears and all paws inside the frame.
```

动作安全姿势不是人工逐张补救步骤。正式服务必须让每只宠物第一次生成母版时就露出双前爪，并把尾巴放在身体侧后方。当前 `pet-avatar-orange-longhair-motion-safe-v3.png` 只用于验证这个目标格式。

官方参考：

- <https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_edit_2511_int8.json>
- <https://github.com/QwenLM/Qwen-Image/blob/main/src/examples/tools/prompt_utils.py>
- <https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit_plus.py>
- <https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning>
