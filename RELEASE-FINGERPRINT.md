# 发布资产指纹

这份清单记录当前 POC 展示资产的 SHA-256 内容指纹。下载仓库后，可以用下面的命令重新计算并对照，确认文件内容没有被替换：

```bash
shasum -a 256 <文件路径>
```

## 已确认展示资产

```text
16a13bb7de2259668211d6e0f8863c68f49501f44e953593df152c5ed10bd1f1  public/assets/generated/cat-idle-scail2-poc-smooth30-v1.mp4
beaff4d8dcbb11d721967c0d3e2c9fded47a278a6cad25cd6f3505d1277280c5  public/assets/generated/cat-lick-paw-scail2-complete-poc-smooth30-seam-v3.mp4
34ce02792b6da10a5ab2ca82efaa259e6a6c94ad6de3b994b90f3f5e2c785554  public/assets/generated/cat-feed-trework-seedance-poc-v1.mp4
e54fbd28d57b70fc8a2c8e662aca44d25b655d08dace6a62ad9b0254589128c9  public/assets/generated/cat-head-pet-scail2-poc-smooth30-seam-v4.mp4
7aa1e9dcb9b3db7e2c83f5bbca6068185a68ec3fc9feb91d0c9ba1e1668e11db  public/assets/generated/pet-avatar-orange-longhair-motion-safe-v3.png
303bfdaf7f9ae448b235261b37dc41ea8176ff85da47e7b356ddef0d7c659c12  public/geo/05-product-demo.mp4
ef1b54cf838445de3330b937358ec7fa8af5df7b5244a71ce1d318687cf66454  public/og.png
```

这不是加密签名，也不包含 ComfyUI 地址、Cookie、Token 或用户照片；正式上线时仍应使用受保护的发布流程和密钥管理。
