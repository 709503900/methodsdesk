# 网站部署

发布仓库为 [709503900/methodsdesk](https://github.com/709503900/methodsdesk)。GitHub Pages 的来源为 `main` 分支根目录，发布无需构建步骤。更新前运行 `node --test tests/*.test.mjs` 并在浏览器检查各工具页。

项目默认地址为 `https://709503900.github.io/methodsdesk/`，目标自定义域名为 `methodsdesk.dpdns.org`。自定义域名通过 GitHub Pages 添加。域名所有权用 GitHub 生成的 TXT 记录验证。DNS 在该域名实际委派的服务商配置。绑定后核查现场 DNS、HTTPS 和页面计算。 [GitHub Pages 域名说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
