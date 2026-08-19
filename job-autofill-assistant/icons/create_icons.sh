#!/bin/bash
# 创建占位图标（使用 ImageMagick）
for size in 16 48 128; do
  convert -size ${size}x${size} xc:none -gravity center \
    -fill '#667eea' -draw "circle $(($size/2)),$(($size/2)) $(($size/2)),$(($size/4))" \
    -fill white -font Arial-Bold -pointsize $(($size/3)) \
    -annotate +0+0 '秋' icon${size}.png 2>/dev/null || \
  echo "跳过图标生成 (需要 ImageMagick)"
done
