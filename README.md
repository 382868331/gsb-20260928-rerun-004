# 角色动画制作台

React 负责编辑、画布和播放；Python 负责动画计算、工程校验、JSON 存储与动作导出。

## 功能

- 内置简单人形骨架，通过父子层级做前向运动学求值。
- 任意时间拖动预览，姿态按时间线性插值，角度使用 ±180° 最短路径跨越 0°/360°。
- 关键姿态支持跳转、移动时间、复制和撤销。
- 保存前检查缺失父骨骼、重复根节点、自引用、层级循环、缺失骨骼姿态和时间越界等冲突。
- 动作分层：基础层保留全身（如走路），叠加层只影响选中的作用骨骼；每层有独立权重、时间范围、淡入淡出和各自可编辑的关键帧。
- 叠加在局部空间进行：层姿态减去其参考姿态得到平移/旋转增量（旋转走 ±180° 最短路径），乘以当前权重后加到基础层，再统一做父子 FK。父骨骼不在作用范围时保持基础层数值，子骨骼随其世界旋转，最终姿态无歧义。
- 层在时间范围边界权重为 0，线性淡入淡出保证中途启用/切换动作不跳姿；层状态随工程 JSON 保存，重新打开后逐帧预览与导出走同一套求值。
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
