# Read Visualization

一个用于整理和可视化个人阅读痕迹的 React 应用。它可以从微信读书网关或 Obsidian 笔记导入阅读数据，并把书籍、划线、分类、年度阅读人格和思想聚类呈现在可交互的画布中。

## 功能

- 微信读书数据导入：拉取阅读统计、书架笔记、划线和书籍封面。
- Obsidian 笔记导入：从本地 Markdown 阅读笔记生成同一套可视化视图。
- 无限画布：拖拽、缩放、查看书籍卡片、分类关系和阅读轨迹。
- 年度阅读人格：根据书籍与划线生成年度 MBTI、年度问题、视觉人格和说明文本。
- 多模型分析配置：支持兼容 OpenAI Responses、Chat Completions、Anthropic Messages、DeepSeek、Kimi、火山方舟等接口格式。
- 本地缓存：阅读数据、分析结果和连接配置保存在浏览器本地。

## 技术栈

- React 19
- TypeScript
- Vite
- Express
- Tailwind CSS
- Motion
- Lucide React

## 本地运行

```bash
npm install
npm run dev
```

默认服务地址为 `http://localhost:3000`。

## 环境变量

服务端 Gemini 分析能力会读取：

```bash
GEMINI_API_KEY=""
```

本项目不会在仓库中保存真实 API Key。请把真实密钥放在本地 `.env.local`、部署平台的环境变量，或在应用设置面板中手动填写。

## 常用命令

```bash
npm run dev      # 启动开发服务
npm run build    # 构建前端和服务端产物
npm run start    # 运行构建后的服务
npm run lint     # TypeScript 类型检查
```

## 敏感信息说明

- `.env*` 默认被忽略，只有 `.env.example` 会进入版本库。
- `dist/`、`node_modules/`、日志文件和系统文件不会进入版本库。
- 微信读书网关 Token、第三方模型 API Key 等信息只应保存在本地浏览器或私有环境变量中。
