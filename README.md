# 美食抽签 · 部署仓库

这个仓库只包含网站静态文件（`site/`）和 GitHub Pages 自动部署工作流。

推送到 `main` 分支后，Actions 会自动发布到：

```
https://<你的用户名>.github.io/<仓库名>/
```

如果 Pages 没有自动开启：

1. 进入仓库的 Settings → Pages。
2. Build and deployment → Source 选择「GitHub Actions」。
3. 回到 Actions，重新运行 `Deploy to GitHub Pages` 工作流。

网站数据保存在访客浏览器本地，不会写回仓库。
