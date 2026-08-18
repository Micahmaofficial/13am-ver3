# CMS 后台方案选型记录

> 记录日期：2026-08-18  
> 后续调用关键词：CMS、后台、Decap CMS、可视化编辑、内容管理

---

## 一、用户决策画像

| 维度 | 要求 |
|---|---|
| 使用人数 | 仅主理人一人 |
| 改动频率 | 每月几次（低频） |
| 成本 | 零成本优先 |
| 端侧 | 不需要手机端，PC 即可 |
| 核心诉求 | 换图片、加新闻等操作走可视化后台，减轻代码操作负担 |

---

## 二、当前可替换内容清单

| 类别 | 内容 | 存储位置 | 当前是否易替换 |
|---|---|---|---|
| A. 数据文件 | news.json（新闻）、products.json（产品） | 本地 JSON 文件 | 改文件即可 |
| B. HTML 硬编码文案 | 主理人寄语、品牌标语、ABOUT 三板块文案、CONTACT 文案 | index.html 内联 | 需改 HTML |
| C. 占位配置 | 社交链接 URL、联系邮箱 | HTML 内联 | 需改 HTML |
| D. 媒体资源 | 产品图、作品图、视频、logo | `/assets` 目录 | 需替换文件 |
| E. 用户数据 | 注册用户、昵称/头像/地区 | Supabase `auth.users` + `user_metadata` | 已在云端 |
| F. 交易数据 | 购物车、到货预留、CONTACT 消息 | Supabase / localStorage（消息目前只在本地） | 部分上云 |

---

## 三、五种方案对比

### 方案 1：维持现状（改文件 + Git 推送）

- 操作方式：直接改 news.json / products.json / HTML，commit 到 GitHub 自动部署
- 适合：内容更新频率极低、主理人本人能操作代码
- 优点：零成本、零开发、有 Git 版本追溯
- 缺点：非技术人员无法使用、手机端不方便、改文案要翻 HTML
- 评分：成本 ✅ / 易用 ❌ / 可扩展 ⭐

### 方案 2：Git-based CMS（Decap CMS / Static CMS）— 轻量推荐

- 操作方式：安装 Decap CMS，提供 `/admin` 网页后台，编辑后自动提交回 GitHub
- 覆盖能力：A（news/products）、B 部分文案、C 配置、D 媒体上传
- 优点：免费、有可视化表单、保留 Git 版本、非技术人员可用
- 缺点：需配置 GitHub OAuth；无法管理 Supabase 动态数据（E/F）
- 评分：成本 ✅ / 易用 ✅ / 可扩展 ⭐⭐⭐

### 方案 3：Headless CMS（Sanity / Strapi / Directus）— 中量级

- 操作方式：用第三方 CMS 建模，前端改成从 CMS API 拉数据
- 覆盖能力：A/B/C/D 全覆盖
- 优点：专业后台、富文本编辑、图片处理强、支持多人协作
- 缺点：需迁移现有 JSON 数据、改前端 fetch 逻辑、可能产生月费（Sanity 免费档可用）、多一个数据源
- 评分：成本 ⭐ / 易用 ✅ / 可扩展 ⭐⭐⭐⭐⭐

### 方案 4：基于 Supabase 自建后台 — 复用现有基建

- 操作方式：把 news/products/文案建成 Supabase 表，前端改从表查；管理用 Supabase Studio 或自建简单 admin 页
- 覆盖能力：A/B/C 全部 + E/F（动态数据统一）
- 优点：数据集中在一个地方、复用现有 Supabase、无额外月费
- 缺点：Supabase Studio 对非技术人员不友好；自建 admin 页开发成本中等
- 评分：成本 ✅ / 易用 ⭐ / 可扩展 ⭐⭐⭐⭐

### 方案 5：自建全栈 Admin — 最重

- 操作方式：独立后台系统 + API + 权限体系
- 优点：完全可控、可深度定制
- 缺点：开发成本最高、需要长期维护
- 适合：长期品牌化运营、有持续开发资源
- 评分：成本 ❌ / 易用 ✅ / 可扩展 ⭐⭐⭐⭐⭐

---

## 四、最终选型：方案 2 — Decap CMS

### 匹配度

| 用户需求 | Decap CMS 满足方式 |
|---|---|
| 只一人改 | 单用户模式即可，无需配权限 |
| 每月几次（低频） | 完全够用，不浪费 |
| 零成本 | 开源免费，无月费 |
| 不需要手机端 | 后台是 PC 网页，正合适 |
| 换图片可视化 | 后台自带图片上传组件，自动 commit 到仓库 |
| 加新闻可视化 | 表单式编辑 news.json，不用碰代码 |
| 轻松 | 浏览器打开 `/admin`，所见即所得 |

### 工作原理

```
后台改内容 → 自动 commit 到 GitHub 仓库 → 现有部署流程不变
```

### 唯一需要配置的点：GitHub OAuth

Decap CMS 编辑后要替用户 commit 到 GitHub，必须走 OAuth 授权。免费方案三选一（优先推荐 Netlify Identity）：

1. **Netlify Identity**（推荐）：把站点加到 Netlify（即使域名不动），开启 Identity，免费，约 5 分钟
2. **Cloudflare Workers 自建 proxy**：免费额度够用，但需写几十行脚本
3. **社区现成 proxy**：如 `decap-oauth-proxy`，一键部署到 Vercel

### 过渡备选（如嫌 OAuth 麻烦）

先用 GitHub 网页直接编辑 news.json：登录 GitHub → 进仓库 → 点 news.json → Edit → Commit。优点零配置，缺点非可视化、传图片麻烦。适合临时过渡，等觉得烦了再上 Decap。

---

## 五、落地步骤概览

1. 在仓库根目录新增 `admin/` 目录，放 `index.html`（Decap CMS 入口）和 `config.yml`（配置）
2. 在 `config.yml` 里建模声明：
   - news 集合 → 对应 `news.json`，字段：date / title / summary / content / pinned
   - products 集合 → 对应 `products.json`
   - media 文件夹 → 指向 `/assets`
   - （可选）site_settings 集合 → 管理社交链接、联系邮箱等 C 类配置
3. 配置 GitHub OAuth（推荐 Netlify Identity）
4. 访问 `域名/admin`，用 GitHub 账号登录，开始可视化编辑

---

## 六、按阶段推荐组合

| 阶段 | 建议方案 | 说明 |
|---|---|---|
| 阶段一：现在～首发 | 方案 1 + 方案 4 局部 | news/products 继续 JSON；用户/购物车/到货预留走 Supabase；CONTACT 消息迁到 Supabase 表统一管理 |
| 阶段二：上线后需协作/减轻操作 | 加方案 2 Decap CMS | 给 `/admin` 可视化后台，伙伴可改新闻、产品、文案、传图；动态数据继续 Supabase Studio |
| 阶段三：内容增长、需专业运营 | 迁方案 3 Sanity | news/products/文案全迁 Sanity，前端改 API；动态交易数据留 Supabase |
