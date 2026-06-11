# Pixel Deck

Pixel Deck 是一个像素风格的桌面快捷面板。它像一个迷你 Stream Deck：提供 5×3 按键网格，每个按键都是一块带扫描线的小屏幕，可以绑定应用、文件、网页，也可以显示天气、系统状态和时间等组件。

## 特性

- 5×3 像素按键面板
- 支持多页按钮
- 支持拖入应用、快捷方式、文件和网页
- 自动提取应用或快捷方式图标
- 图标像素化程度可调
- 天气、系统状态、时间等组件按钮
- 内置屏保动画
- 支持用户自行添加本地屏保视频
- 屏保像素化程度可独立调整
- 托盘运行和开机启动选项

## 下载

最新版本可以在 GitHub Release 下载：

- [Windows x64 便携版 exe](https://github.com/sparklecatta-lang/Pixel-Deck/releases/download/v1.0.1/Pixel-Deck-1.0.1-Windows-x64.exe)
- [macOS x64 zip](https://github.com/sparklecatta-lang/Pixel-Deck/releases/download/v1.0.1/Pixel-Deck-1.0.1-macOS-x64.zip)

也可以查看完整发布页：

- [Pixel Deck Releases](https://github.com/sparklecatta-lang/Pixel-Deck/releases)

## 隐私与开源范围

这个仓库只包含 Pixel Deck 的应用源码、公共字体/音效/logo 和代码实现的内置屏保。

不会包含：

- 用户自己添加的屏保视频
- 用户自己的按钮面板配置
- 本地生成的屏保视频、截图、预览图
- 本地调试脚本和临时产物

用户配置保存在系统用户数据目录中，不在仓库内。添加到应用里的自定义屏保视频也会复制到用户数据目录，而不是源码目录。

## 开发运行

需要 Node.js。

```bash
npm install
npm start
```

## 构建

运行语法检查：

```bash
npm run check
```

构建 Windows 版：

```bash
npm run build:win
```

构建 macOS zip 包：

```bash
npm run build:mac
```

同时构建两个平台：

```bash
npm run build
```

构建产物会输出到 `release/`。

## 屏保视频尺寸

Pixel Deck 的屏保视频不是普通全屏视频，而是铺到 5×3 按键网格上，再裁切到每个按键内显示。

推荐视频尺寸：

```text
1000 × 587
```

制作规则：

- 画布左上角就是 1 号按键区域的左上角。
- 不要把说明文字、模板边框、编号或辅助线导进最终视频。
- 按键之间的缝隙不会显示视频内容。
- 程序会在播放时叠加像素化和扫描线效果。

## 许可证

MIT
