# 网站部署

发布仓库为 [709503900/methodsdesk](https://github.com/709503900/methodsdesk)。GitHub Pages 的来源为 `main` 分支根目录，发布无需构建步骤。更新前运行 `node --test tests/*.test.mjs` 并在浏览器检查各工具页。

主站使用 [methodsdesk.red.edu.kg](https://methodsdesk.red.edu.kg/)。仓库根目录的 `CNAME` 记录 GitHub Pages 绑定的自定义域名。Cloudflare 的 `methodsdesk` CNAME 为仅 DNS，指向 `709503900.github.io`。GitHub Pages 用子域名专用的 TXT 记录验证了所有权。根域 `red.edu.kg` 仍用于论坛跳转。域名迁移或更新后检查权威 DNS、证书和 HTTP 跳转，再测试页面计算。 [GitHub Pages 域名说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

本地浏览器检查覆盖 320、390、768 和 1440 像素的视口宽度。五个工具分别检查了输入、提交和输出。问卷测试也核对了样本量到发放量的传递。数字输入与主要按钮在四个宽度的可见高度均至少为 44 像素。
