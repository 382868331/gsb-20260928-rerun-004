# 角色动画制作台

React 负责编辑、画布和播放；Python 负责动画计算、工程校验、JSON 存储与动作导出。

## 功能

- 内置简单人形骨架，通过父子层级做前向运动学求值。
- 任意时间拖动预览，姿态按时间线性插值，角度使用 ±180° 最短路径跨越 0°/360°。
- 关键姿态支持跳转、移动时间、复制和撤销。
- 支持动作分层：每层拥有独立关键帧、作用骨骼、权重、时间范围与淡入淡出；层在局部姿态空间按权重覆盖所选骨骼后再做父子旋转求值，未选父骨骼含义保持明确（层只改所选骨骼的局部变换，子骨骼继续随父级世界旋转累积）。
- 层关键帧可单独选择、移动和编辑；时间窗边界配合淡入淡出保证叠加/切换动作不跳姿，保存重开后逐帧预览与导出共用同一求值结果。
- 支持把多层动作按时间范围 + 骨骼范围「整理」成可继续编辑的新动作：按 60fps 逐帧烘焙合成姿态，整理片段播放与原工程一致，范围以外内容和源分层工程均不改动；整理前会报告缺失骨骼、部分覆盖的不兼容层和范围内权重过渡，任一问题都直接放弃，不会提交半份结果。
- 动作层支持权重关键帧，可在淡入淡出过程中任意时刻平滑过渡，并支持过渡中途正/反向反复调整。
- 源工程（`version`）与每个整理动作（`source` 溯源：来源动作 id、源版本、时间/骨骼范围、fps、生成时间）分开保存；撤销整理、修改底层关键帧后重新整理、保存重开都能区分源动作与新动作的版本。
- 播放支持重复循环与单次播放。
- 保存前检查缺失父骨骼、重复根节点、自引用、层级循环、缺失骨骼姿态和时间越界等冲突。
- Python 工程原子写入 `backend/data/project.json`。
- 导出按固定 FPS 生成每帧的局部姿态和世界姿态，前端保存时会与 Python 导出结果比对。

## 启动

```bash
cd backend
python server.py --reset --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

打开 Vite 输出的本地地址（默认 `http://127.0.0.1:5173`）。Vite 已把 `/api` 代理到 Python 服务。

## 测试与构建

```bash
cd backend
python -m unittest discover -s tests -v
python -m py_compile server.py animation_core.py

cd ../frontend
npm test
npm run build
```

## HTTP API

- `GET /api/project`：读取工程，不存在时初始化内置角色。
- `POST /api/project`：校验并保存工程。
- `GET /api/evaluate?time=0.63`：获取指定时刻的局部姿态和世界姿态。
- `GET /api/export?fps=24`：导出逐帧动作数据。
- `POST /api/bake`：按 `{project, range_start, range_end, bones, name}` 原子整理新动作；存在缺失骨骼或不兼容内容时返回错误且不修改工程。
