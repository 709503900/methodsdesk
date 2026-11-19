# 网站部署

发布仓库为 [709503900/methodsdesk](https://github.com/709503900/methodsdesk)。GitHub Pages 的来源为 `main` 分支根目录，发布无需构建步骤。更新前运行 `node --test tests/*.test.mjs` 并在浏览器检查各工具页。

主站使用 [methodsdesk.dpdns.org](https://methodsdesk.dpdns.org/)。仓库根目录的 `CNAME` 记录 GitHub Pages 绑定的自定义域名。GitHub Pages 已验证域名所有权。DigitalPlat 原生 DNS 保留 GitHub 生成的 TXT 记录，根域的四条 A 记录指向 GitHub Pages。域名迁移或更新后检查权威 DNS、证书和 HTTP 跳转，再测试页面计算。 [GitHub Pages 域名说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

本地浏览器检查覆盖 320、390、768 和 1440 像素的视口宽度。五个工具分别检查了输入、提交和输出。问卷测试也核对了样本量到发放量的传递。数字输入与主要按钮在四个宽度的可见高度均至少为 44 像素。
