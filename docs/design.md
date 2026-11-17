# 时茄 Xitomatl 视觉方案

## 设计方法

Logo 概念使用 `imagegen` 技能生成，再重绘为无外链的 SVG，以确保小尺寸显示清晰。界面以静态任务表为主；抽取页采用可跳过的动画，并尊重系统的“减少动态效果”设置。首版同时提供暖番茄、森林绿和墨色主题，供使用者直接切换。

这套界面决定参考了 [WCAG 2.2](https://www.w3.org/TR/WCAG22/)、[Apple 动效指南](https://developer.apple.com/design/human-interface-guidelines/motion)和 [NN/g 可用性原则](https://www.nngroup.com/articles/ten-usability-heuristics/)。文字与背景、控件状态、键盘焦点和交互目标均应在最终界面中复核。

## Logo 候选

| 方向 | 概念 | 应用资产 | 色彩 |
| --- | --- | --- | --- |
| A 暖番茄 | [原始概念图](../design/logo-a-imagegen-concept.png) | [纯色 SVG](../public/logo-a.svg) | 番茄红 `#AD3E34`、深墨 `#252B28`。 |
| C 森林绿 | [原始概念图](../design/logo-c-imagegen-concept.png) | [纯色 SVG](../public/logo-c.svg) | 森林绿 `#205F52`、番茄红点缀 `#AD3B32`。 |

默认暂用 A：番茄和时针的双重含义更容易从图形直接读出。C 可在“设置”中选择。最终品牌方向可根据使用反馈调整；两份原始生成图留作设计溯源。

### 图像生成提示词

- A：`Use case: logo-brand. Asset: app icon for Xitomatl/时茄. Original minimal tomato-and-clock fusion mark; warm tomato silhouette as round clock body; two simple clock hands; small crossing leaf/stem subtly suggests X. Vector-friendly flat mark, centered with generous transparent padding; dominant #AD3E34, deep ink #252B28 only if needed, max two colors. No text/letters/numerals, gradients, shadows, 3D, mockup, border, watermark; true transparency; readable at 24px; no tiny seeds/details.`
- C：`Use case: logo-brand. Asset: app icon for Xitomatl/时茄. Original minimal clock-and-tomato fusion mark; forest-green circular clock face with tomato calyx at top and two broad hands; quiet, focused. Vector-friendly flat mark, centered with generous transparent padding; dominant #205F52, #AD3B32 only as small accent, max two colors. No text/letters/numerals, gradients, shadows, 3D, mockup, border, watermark; true transparency; readable at 24px; no tiny details.`

## 界面层次

1. **任务表：**首屏展示登记入口、近期任务、截止日期提醒和直接开始按钮。SOP 步骤按需展开，避免长列表的视觉负担。
2. **随机抽取：**转盘中的每个扇区直接标注真实候选任务，扇区角度与权重成比例，转动后由顶部指针指向结果；不再使用没有任务内容的装饰转盘。扭蛋机把任务名称放进每颗扭蛋，抽中任务在出口展示。两种外观共用抽取逻辑并显示完整候选名称和概率，可跳过动画、重新抽取或自选；较长名称在图形中简写，在候选列表中完整显示。
3. **专注：**任务标题、`HH:MM:SS` 数字钟和 SOP 步骤同时可见。结束操作保持分离，倒计时到时不自动完成任务。
4. **每日总结：**展示真实记录，用中性语言描述未完成任务与休息，不生成单一“效率分数”。

## 色彩与可读性

| 主题 | 主色 | 页面底色 | 正文 |
| --- | --- | --- | --- |
| 暖番茄 | `#AD3E34` | `#FBF7F0` | `#252B28` |
| 森林绿 | `#205F52` | `#F6F9F5` | `#22332C` |
| 墨色 | `#252B28` | `#F4F3F0` | `#252B28` |

状态不只靠颜色传达：截止日期、计时结束、当前筛选与已完成步骤均附带文字或图形变化。正式发布前需在实际渲染结果中核验对比度、键盘可达性和窄屏布局。

## 任务抽取界面预览

2026 年 11 月 17 日使用独立示例任务验证：[任务转盘](screenshots/task-wheel.png)、[任务扭蛋机](screenshots/task-capsules.png)、[窄窗口扭蛋机](screenshots/task-capsules-narrow.png)。
