---
title: [踩坑记录] DirectX 无法使用 Map 取得纹理数据.md
published: 2025-04-05
slug: '20250405205300'
description: ''
image: ''
tags: []
category: ''
draft: false 
lang: ''
---

如果你需要对纹理调用 Map 方法, BindFlag 必须不能是非 0 值(被 Map 的纹理不能参与渲染), CPUAccessFlag 必须与你调用 Map 传入的 MapType 匹配.

假设你需要读取一个不满足以上条件的纹理, 你需要创建一个新的纹理, 通过 CopySubresource 将数据拷贝到新纹理中, 再 Map 这个新纹理, 然后读取.

参考资料: https://www.cnblogs.com/wickedpriest/p/13568190.html