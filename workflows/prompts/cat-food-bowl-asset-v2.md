# 3D 猫粮碗前景资产 v2

## 最终生成提示词

```text
Create a production-ready isolated compositing asset, using the attached cat frame only to match its soft polished 3D-animation rendering, low frontal camera and white-studio lighting. Do not reproduce the cat.

Exactly one low, wide, shallow oval ceramic cat-food bowl, front-facing, camera slightly above the rim. The bowl is made for a cat approaching from directly behind: thin low rear rim, clearly visible food surface, very shallow front wall. Fill it with 18–24 SMALL irregular dry-cat-food kibble pieces in natural brown shades. The kibble must look small relative to the bowl, not like rocks or large balls.

Bowl: matte warm ivory ceramic with one thin muted olive-sage rim. No symbol, no decoration. Refined animated-film 3D material, soft realistic shading, clean silhouette, no flat-vector or sticker look. No floor mat and no cast shadow.

CUTOUT REQUIREMENT: a perfectly uniform, saturated pure blue #0000FF background must fill the entire canvas edge to edge. No checkerboard, no gradient, no texture, no horizon, no floor, no shadow on the background. Leave generous pure-blue empty margin around the whole bowl for clean chroma keying.

No cat, no paw, no hand, no plate beneath, no logo, no paw-print icon, no text, no extra object, no white rectangle.
```

## 固化处理

- 风格参考帧只提供猫的光线、机位和 3D 材质，不把猫写进碗资产。
- 蓝幕输出在本机通过 `despill + colorkey` 转为真正的 RGBA，不把生成图中的蓝底带进网页。
- 最终文件固定为 `../../public/assets/pet-bowl-feed-3d-v2.png`，1000 × 240。
- 网页按舞台高度把宽度约束在 105–138 px；在 576 × 768 离线验收片中固定按 250 × 60、x=163、y=710 合成。此时碗后沿约在 y=718、粮面中心约在 y=737，匹配闭嘴下唇 y≈718 和伸舌最低 y≈751 的真实轨迹。
- 旧的扁平碗 `pet-bowl-feed-v1.svg/png` 只保留追溯，不再接入页面。
