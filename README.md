# OnlyCampus 阅读发现与互动模块

评论与个人主页更新：个人主页提供帖子、回复、专栏三个标签；“回复”查询本人在公开帖子下的可见评论及楼内回复。内容页已移除目录入口，仅呈现标题和完整正文。楼内回复以白底缩进显示，多于1条默认折叠；可回复任意可见回复，开头显示实际被回复人的昵称。新增 `comments.reply_to_id` 保存直接回复对象，`parent_id` 继续保存顶层评论，避免无限嵌套。已有开发数据库需执行 `npm run db:init`，脚本会检查并补列，也会补充演示数据，请勿对正式数据库直接运行。

项目仓库：[github.com/bccx7/OnlyCampus](https://github.com/bccx7/OnlyCampus)；完整方案见 [开发文档](docs/OnlyCampus_详细开发文档.md)。

前端协作必读：[界面与交互开发指南](docs/OnlyCampus_界面与交互开发指南.md)。固定三栏、搜索、返回、个人页、评论折叠及视觉标准以此为准，新模块接入前应先核对其中的验收清单。

界面采用统一三栏导航：探索、文章详情、收藏和个人主页均在中栏切换。探索页展示搜索条与热搜榜，右栏隐藏重复搜索条。搜索历史保存在当前浏览器中，可逐条删除或清空；热搜通过 `search_terms` 表累计关键词搜索请求次数，目前不做独立用户去重。拉取本次修改后需执行 `npm run db:init` 创建新增表。

柏承辰负责的课程项目模块。包含 Vue 阅读界面、Express API、MySQL 数据结构、演示数据，以及仅允许普通用户登录的账号入口。当前还需要与韩佳杞的文章及专栏服务、赵庆浩的账号管理和通知服务联调；不是完整的博客管理系统。

2026年11月1日更新：收藏和评论操作不再重载整页，写操作带提交中保护；快速路由切换时忽略过期请求结果。Markdown 标题使用行内渲染并测试重复锚点及危险链接过滤，目录功能已按最新要求取消。个人主页增加公开文章、专栏数量、回复记录与本人收藏入口；评论展示时间，仅有可见回复的不可见父评论保留占位。`npm test` 当前包含3项 Markdown 单元测试、1项来源导航测试和2组真实数据库集成回归。

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

开发数据库演示账号 `author`、`reader` 的密码均为 `campus123`，由种子脚本生成，不能作为公网正式凭据。页面使用 `POST /api/auth/login`、`POST /api/auth/logout` 和 `GET /api/auth/me`；仅允许ACTIVE状态的USER账号登录，管理员入口、注册、找回密码及账号管理不在此次实现范围。原 `/api/dev/login`、`/api/dev/logout` 已移除。登录前获取CSRF令牌，成功后使用返回的新令牌；会话保存在MySQL并通过HttpOnly Cookie关联，退出后服务端撤销会话。当前登录限流按进程内IP统计，每15分钟最多20次尝试，包含成功和失败；重启会清空，多实例部署需改共享存储限流。生产环境启用Secure Cookie，现按一层可信反向代理配置；部署环境必须与此匹配。公网发布仍需完成前端静态资源托管、正式账号准备和环境配置。

## 数据和接口交接

公开阅读：`GET /api/home`、`GET /api/articles`、`GET /api/articles/:id`、`GET /api/users/:id/profile`、`GET /api/users/:id/series`、`GET /api/taxonomy`。

互动：`GET/POST /api/articles/:id/comments`、`DELETE /api/comments/:id`、`PUT/DELETE /api/articles/:id/favorite`、`GET /api/me/favorites`。写请求先获取 `/api/auth/csrf`，然后传入 `X-CSRF-Token`。标准响应为 `{code,message,data}`。

文章、用户、分类、标签、专栏结构是最小联调版本，不覆盖完整开发文档中的其他字段。韩佳杞接管文章和专栏模型及服务，赵庆浩接管账号、Session 和通知服务；集成时须合并数据库迁移、保留公开状态过滤和资源归属校验。评论通知目前直接写入共享通知表，和评论位于同一事务；团队应将此处替换为赵庆浩提供的事务内通知服务。

阅读页提供标题、完整正文、专栏上一篇/下一篇、收藏及评论分页；目录已取消。作者主页提供帖子与回复分页。专栏详情仍由韩佳杞负责；账号管理、管理员登录和通知功能仍由赵庆浩负责联调，不要将当前版本视为完整系统。
