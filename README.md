# 角色动画制作台（关键姿态编辑与播放）

React 前端负责编辑/播放交互，Python（FastAPI）负责插值、FK 计算与工程存储；
前后端共享同一套数学约定，逐时刻求值与导出的动作数据严格一致（见一致性测试）。
动作混合留待后续迭代。

## 目录

- `backend/animstudio/` —— 骨架与结构校验（`skeleton.py`）、前向运动学（`fk.py`）、
  关键帧/最短角度插值（`animation.py`）、自带火柴人（`characters.py`）、
  动作导出（`export.py`）、工程 JSON 存储（`project.py`）、HTTP API（`api.py`）
- `frontend/src/` —— `lib/anim.ts` 是与后端等价的 TS 求值实现；
  `store.ts` 用 zustand 管理编辑状态与撤销栈；
  组件包含 SVG 视口、时间轴、骨架层级/检查器、工具栏
- `backend/tests`、`frontend/test` —— 两侧测试与跨语言一致性夹具

## 运行

```bash
# 后端（工程文件默认存到 backend/data/，可用 ANIMSTUDIO_STORE 覆盖）
cd backend && pip install -r requirements.txt
python -m uvicorn animstudio.api:app --host 127.0.0.1 --port 8000

# 前端
cd frontend && npm install && npm run dev
```

前端默认访问 `http://127.0.0.1:8000`，可用 `VITE_API_BASE` 覆盖。

## 操作

- 视口点击骨骼选中，用按钮（±0.1）调整姿态，增量写入当前时刻关键帧
- 时间轴：拖动关键帧移动、双击复制到播放头、右键删除；点击轨道任意处逐时刻求值
- `Ctrl/⌘+Z` 撤销、`Ctrl/⌘+Y`（或 Ctrl+Shift+Z）重做，空格播放
- 右侧面板可改父骨骼/长度/静止旋转；缺父、环、重复 id、自引用等冲突会直接列出
- 保存把工程原子写入后端 JSON；导出按帧率采样为 `animstudio.action.v1` 动作数据

## 关键约定

- 姿态只存每根骨骼相对静止姿态的**旋转增量（弧度）**，平移/挂点属于骨架；
  播放父骨骼转动时子骨骼由 FK 自动跟随
- 角度插值走最短有向弧（`shortest_delta` 归一到 `(-π, π]`），跨 0/2π 起点不绕远
- 首帧之前/末帧之后钳制到端姿态；关键帧之间线性插值
- 导出每一帧都由 `evaluate_pose → evaluate_world` 生成，因此
  **播放画面 = 任意时刻求值 = 导出动作数据**（pytest 与 vitest 双向校验）

## 测试

```bash
cd backend && python -m pytest                                   # 22 个
cd frontend && npx vitest run && npx tsc --noEmit               # 7 个 + 类型检查
```

重新生成跨语言一致性夹具：

```bash
cd backend && python tests/generate_fixture.py > ../frontend/test/fixture.json
```
