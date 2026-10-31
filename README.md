# OnlyCampus 阅读发现与互动模块

项目仓库：[github.com/bccx7/OnlyCampus](https://github.com/bccx7/OnlyCampus)；完整方案见 [开发文档](docs/OnlyCampus_详细开发文档.md)。

界面采用统一三栏导航：探索、文章详情、收藏和个人主页均在中栏切换。探索页展示搜索条与热搜榜，右栏隐藏重复搜索条。搜索历史保存在当前浏览器中，可逐条删除或清空；热搜通过 `search_terms` 表累计关键词搜索请求次数，目前不做独立用户去重。拉取本次修改后需执行 `npm run db:init` 创建新增表。

柏承辰负责的课程项目模块。包含 Vue 阅读界面、Express API、MySQL 数据结构、演示数据，以及仅供开发使用的测试登录。当前还需要与韩佳杞的文章及专栏服务、赵庆浩的账号和通知服务联调；不是完整的博客管理系统。

## 启动

需要 Node.js 22+、npm 和 MySQL 8。复制 `.env.example` 为 `.env`，填写本机数据库连接和随机 Session 密钥。然后运行：

```powershell
npm install
npm run db:init
npm run dev
```

访问 Vite 显示的本地地址。初始化脚本创建数据库和缺失表，并使用 `INSERT IGNORE` 导入演示数据；不要对已有正式数据库执行种子脚本。数据库用户必须具备创建数据库及建表权限。`npm run build` 构建前端。

本机使用用户目录中的 MySQL 8.4 ZIP 版，当前由进程运行，不会随 Windows 自动启动。重启电脑后，在 PowerShell 运行以下命令（仅适用于本机本次安装路径）：

```powershell
$base = "$env:LOCALAPPDATA/OnlyCampus/mysql"
Start-Process -FilePath "$base/mysql-8.4.13-winx64/bin/mysqld.exe" -ArgumentList @('--no-defaults', "--basedir=$base/mysql-8.4.13-winx64", "--datadir=$base/data", '--bind-address=127.0.0.1', '--port=3306', '--mysqlx=0') -WindowStyle Hidden
```

仅当 MySQL 没有运行时执行；等待启动后运行 `npm run dev`。本机生成的数据库密码保存在被 Git 忽略的 `.env` 中，不能提交或分享。其他成员应配置自己的数据库和凭据。`npm test` 要求开发服务器和种子数据已运行，会创建一条软删除的测试评论及相关通知。

开发环境账号 `author`、`reader`，密码均为 `campus123`。`/api/dev/login` 和 `/api/dev/logout` 仅在 `NODE_ENV` 不为 `production` 时启用，正式环境必须由赵庆浩的真实账号服务替换。数据库会话保存在 sessions 表。生产部署还须配置 HTTPS、同源代理、可靠的 Session 密钥、迁移与权限，并完成安全审查；本模块不应直接作为生产成品部署。

## 数据和接口交接

公开阅读：`GET /api/home`、`GET /api/articles`、`GET /api/articles/:id`、`GET /api/users/:id/profile`、`GET /api/users/:id/series`、`GET /api/taxonomy`。

互动：`GET/POST /api/articles/:id/comments`、`DELETE /api/comments/:id`、`PUT/DELETE /api/articles/:id/favorite`、`GET /api/me/favorites`。写请求先获取 `/api/auth/csrf`，然后传入 `X-CSRF-Token`。标准响应为 `{code,message,data}`。

文章、用户、分类、标签、专栏结构是最小联调版本，不覆盖完整开发文档中的其他字段。韩佳杞接管文章和专栏模型及服务，赵庆浩接管账号、Session 和通知服务；集成时须合并数据库迁移、保留公开状态过滤和资源归属校验。评论通知目前直接写入共享通知表，和评论位于同一事务；团队应将此处替换为赵庆浩提供的事务内通知服务。

阅读页已提供目录跟随高亮、移动端目录抽屉、专栏上一篇/下一篇及评论分页，作者主页提供文章分页。专栏详情仍由韩佳杞负责；正式账号和通知功能仍由赵庆浩负责联调，不要将当前版本视为完整系统。
