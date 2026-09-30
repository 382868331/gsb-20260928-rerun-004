# 角色动画制作台

React 负责编辑、画布和播放；Python 负责动画计算、工程校验、JSON 存储与动作导出。

## 功能

- 内置简单人形骨架，通过父子层级做前向运动学求值。
- 任意时间拖动预览，姿态按时间线性插值，角度使用 ±180° 最短路径跨越 0°/360°。
- 关键姿态支持跳转、移动时间、复制和撤销。
- 支持动作分层：每层拥有独立关键帧、作用骨骼、权重、时间范围与淡入淡出；层在局部姿态空间按权重覆盖所选骨骼后再做父子旋转求值，未选父骨骼含义保持明确（层只改所选骨骼的局部变换，子骨骼继续随父级世界旋转累积）。
- 层关键帧可单独选择、移动和编辑；时间窗边界配合淡入淡出保证叠加/切换动作不跳姿，保存重开后逐帧预览与导出共用同一求值结果。
- 动作层支持权重过渡关键帧（平滑/线性缓动）；求值无状态，可在过渡中途正反向拖动并重复播放。
- 可按时间范围与骨骼范围把多层叠加结果「整理」为可继续编辑的新动作（自适应分段烘焙，最大角度误差 0.05°）：原分层工程完整保留，范围外的动作与骨骼不受影响；遇到缺失骨骼或不兼容动作时返回全部原因且不提交半份结果。
- 每个整理动作记录源工程指纹（骨架+基础关键帧+动作层），撤销整理、修改底层关键帧后重新整理、保存重开都能区分源动作与新动作版本，源变更时旧动作标记为版本过期。
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
- `POST /api/consolidate`：按 `{start,end,bones,name,fps}` 整理多层动作为新动作并原子保存；失败返回全部错误，不改工程。
- `GET /api/evaluate` 与 `/api/export` 支持 `action_id` 参数，按指定整理动作覆盖求值。
