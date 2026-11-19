# MethodsDesk 研究方法工具箱

MethodsDesk 提供浏览器端运行的研究设计工具。网页源码位于 `index.html` 和 `assets/`。计算验算用例位于 `tests/`。方法与部署说明分别位于 `docs/methods.md` 和 `docs/deploy.md`。

本地检查使用 `node --test tests/*.test.mjs`。运行 `python3 -m http.server 8765 --bind 127.0.0.1` 后可在浏览器打开 `http://127.0.0.1:8765/`。网站使用相对资源地址，可在 GitHub Pages 项目子路径和自定义域名根路径运行。
