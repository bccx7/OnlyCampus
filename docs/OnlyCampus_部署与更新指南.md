# OnlyCampus 部署与更新指南

本文供柏承辰、韩佳杞、赵庆浩协作时使用。开发在各自电脑完成，代码通过 GitHub 协作，Azure 服务器只负责部署已验证的版本。

## 1. 当前部署环境与状态

- 仓库：https://github.com/bccx7/OnlyCampus
- 服务器：Azure Korea Central，Ubuntu 24.04，约 1GiB 内存，已配置 2GB Swap。
- 服务器项目目录：`/home/azureuser/OnlyCampus`。
- 前端发布目录：`/var/www/onlycampus`；构建输出为项目内 `dist/`。
- 后端：systemd 服务 `onlycampus`，端口 3000；Nginx 转发 `/api/`，并提供前端及 Vue 路由回退。
- 当前 Node 路径：`/home/azureuser/.nvm/versions/node/v22.23.4/bin/node`。升级 Node 后必须同步修改 systemd 的 `ExecStart`。
- 已人工确认公网 HTTP 首页、文章及刷新正常；公开评论接口正常，新初始化数据库没有本地电脑上的评论。
- Azure DNS 标签已由部署者设置，最终完整域名以控制台为准；HTTPS 申请、自动续期和登录互动尚待验收，不能据本文认定已经完成。

下文命令在服务器的 Ubuntu SSH 终端执行，不是在本机 PowerShell 执行。提示符 `azureuser@onlycampus:~/OnlyCampus$` 不需要输入。

## 2. 三人协作与发布原则

1. 在个人分支开发，先本地验证，再通过 PR 合并到团队约定的部署分支；避免三人同时操作服务器发布。
2. 每次指定一位发布者，确认部署分支、提交号、数据库迁移和新增环境变量。服务器不要直接开发、提交密钥或使用 `git reset --hard` 强行覆盖异常状态。
3. 发布前记录当前提交号，并备份前端文件；有数据库变更时另外备份数据库。
4. 更新代码后不用重建虚拟机、重新配置 Nginx或重新申请证书。只有域名、代理规则等变化才需要调整 Nginx。
5. 以下是手动部署流程，尚未配置 GitHub Actions 自动部署。

## 3. 常规更新流程

### 发布前记录和备份

```bash
cd ~/OnlyCampus
git status --short
git branch --show-current
git rev-parse HEAD
```

保存当前提交号用于回滚。若工作区有非预期改动，先查明原因，不要继续拉取或覆盖。确认当前分支就是本次部署分支。

备份当前前端，路径中的时间戳用于区分版本：

```bash
release_stamp=$(date +%Y%m%d-%H%M%S)
sudo mkdir -p /var/backups/onlycampus
sudo cp -a /var/www/onlycampus "/var/backups/onlycampus/frontend-$release_stamp"
```

### 拉取与构建

以下命令逐条执行，任何一步失败就停止，不要继续发布：

```bash
git pull --ff-only
npm ci
node --check backend/server.js
npm run build
```

`git pull --ff-only` 有分歧时会拒绝更新，交由组员先解决分支状态。`npm ci` 使用已提交的锁文件；不要在服务器随意升级 npm 或执行 `npm audit fix --force`。构建成功只说明产物生成成功，不代表业务已验收。

若本次包含环境变量或数据库结构变化，先完成第 4、5 节的对应步骤，再发布。涉及破坏性数据库变更时必须安排维护窗口，不能让旧后端继续使用不兼容的新结构。

### 发布并重启

```bash
sudo cp -r dist/. /var/www/onlycampus/
sudo chmod -R a+rX /var/www/onlycampus
sudo systemctl restart onlycampus
sudo systemctl is-active onlycampus
curl -fsS http://127.0.0.1:3000/api/home
```

服务应为 `active`，API 应返回正常 JSON。复制时保留旧的带哈希静态资源，避免已打开页面立即请求不到旧资源；后续清理前先确认没有引用。此复制方式不是原子发布，正式扩大使用前可改为版本目录加软链接切换。

只有修改了 Nginx 配置时才执行：

```bash
sudo nginx -t
```

检查成功后再执行 `sudo systemctl reload nginx`。普通页面和接口更新不需要重启 Nginx。

## 4. 数据库变更与用户数据

- GitHub 只同步代码，不同步 MySQL 数据。本地文章、评论、收藏不会随 `git pull` 自动上传；确需迁移时单独设计导出、导入和冲突处理流程。
- `npm run db:init` 是开发初始化及种子脚本，会补充演示数据；不能当作线上每次更新的迁移命令，更不能删除数据库重新初始化。
- 结构变化应提交独立、编号的迁移 SQL，写明前置版本、执行顺序、验证方式和回退方案。目前还没有统一自动迁移器，需要发布者按该版本说明执行并记录结果。
- 先在本地数据库验证迁移，再备份线上库。普通页面或接口更新没有结构变化时，无需执行 SQL。
- 应尽量使用兼容旧版本的增量迁移；删除列、重命名或不可逆转换须单独安排。应用代码回滚不等于数据库自动回滚。

数据库备份示例（会提示输入数据库密码，不要把密码直接写入命令）：

```bash
umask 077
mkdir -p ~/onlycampus-db-backups
mysqldump -h 127.0.0.1 -u onlycampus -p --single-transaction --no-tablespaces onlycampus > ~/onlycampus-db-backups/onlycampus-$(date +%Y%m%d-%H%M%S).sql
```

确认命令成功退出、备份文件有效后再迁移；备份包含用户数据，不要提交 GitHub。恢复数据库会覆盖或改变线上数据，应单独确认恢复范围及维护时间，不能作为一般故障的第一步。

## 5. 环境变量、登录和 HTTPS

- 每位成员维护各自的 `.env`；线上 `.env` 位于服务器项目目录，不提交 GitHub，不截图分享密码或完整内容。
- 新增配置时同步更新 `.env.example` 的占位项及用途说明，发布者单独填写线上值，再重启后端。
- systemd 已设置 `NODE_ENV=production`、`PORT=3000`；dotenv 默认不会覆盖已有进程环境，因此仅修改 `.env` 中的这两项不会覆盖服务配置。
- 生产 `SESSION_SECRET` 至少 32 个字符，使用随机值。更换后既有登录会话可能失效，组员需要重新登录。
- 生产 Cookie 带 `Secure`，必须使用 HTTPS 地址登录。不要以关闭 `Secure` 或切回开发模式作为公网登录解决方案。
- Nginx 应正确传递 `X-Forwarded-Proto`，并与当前一层可信代理的 `trust proxy` 设置一致；增加 CDN 或多级代理时重新验证代理信任及客户端 IP。
- 使用 Azure 完整 DNS 名称申请证书后，通过 HTTPS 地址验收，运行 `sudo /snap/bin/certbot renew --dry-run` 检查续期。未验证成功前不能将 HTTPS 标记为完成。
- 种子账号是开发演示凭据，不作为公网正式账号长期使用；正式使用前由账号模块负责人接管并更换默认密码。

## 6. 发布后验收

- 首页、搜索、文章、作者页和收藏入口正常；文章及个人页直接刷新不出现 Nginx 404。
- HTTPS 无证书警告；登录后刷新仍保持登录，退出后会话失效。
- 评论读取、发表评论、回复、本人删除和收藏正常，权限拒绝符合预期；新数据库没有评论属于空数据，不应直接判断为接口损坏。
- 至少检查手机和桌面布局、返回帖子流、分页、空状态及接口失败提示。
- 数据库迁移后重点回归受影响模块，不以构建成功或服务 `active` 代替业务测试。

## 7. 故障排查与回滚

```bash
sudo systemctl status onlycampus --no-pager
sudo journalctl -u onlycampus -n 50 --no-pager
sudo nginx -t
sudo tail -n 50 /var/log/nginx/error.log
systemctl is-active mysql nginx
free -h
df -h /
```

排查日志后再修复，分享日志前去掉密码、Cookie 和用户私人数据。1GiB 内存较小，Swap 只能缓冲内存压力；构建或服务被终止时先检查内存，不要反复重启掩盖原因。

回滚时由发布者使用发布前记录的提交号建立回滚版本，重新安装对应依赖、构建并发布，同时恢复匹配的前端备份。不要盲目重置工作区或覆盖数据库。若迁移不兼容，按该迁移专门的恢复方案执行。

## 8. 发布记录

每次发布记录：日期、发布者、部署分支与提交号、上一个可用提交号、数据库备份位置、迁移编号、新增环境变量名称（不含值）、验收结果和遗留问题。前端备份与数据库备份确认不再需要后定期清理，避免磁盘占满。
