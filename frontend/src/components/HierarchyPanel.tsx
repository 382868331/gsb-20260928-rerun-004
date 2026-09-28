import { useEditor } from "../store";
import { orderedIds, validateSkeleton } from "../lib/anim";

export function HierarchyPanel() {
  const skeleton = useEditor((s) => s.skeleton);
  const selected = useEditor((s) => s.selectedBone);
  const selectBone = useEditor((s) => s.selectBone);
  const updateBone = useEditor((s) => s.updateBone);
  const conflicts = validateSkeleton(skeleton);

  if (conflicts.length > 0) {
    return (
      <div className="panel hierarchy">
        <h3>骨架结构冲突</h3>
        <ul className="conflict-list">
          {conflicts.map((c, i) => (
            <li key={i} title={c.type}>
              ⚠ {c.message}
            </li>
          ))}
        </ul>
        <p className="hint">修复父子关系后才能继续播放与导出。</p>
      </div>
    );
  }

  const order = orderedIds(skeleton);
  const byId = new Map(skeleton.bones.map((b) => [b.id, b]));
  const depth = (id: string): number => {
    const b = byId.get(id)!;
    return b.parent === null ? 0 : depth(b.parent) + 1;
  };
  const bone = selected ? byId.get(selected) ?? null : null;

  return (
    <div className="panel hierarchy">
      <h3>骨架层级</h3>
      <ul className="bone-tree">
        {order.map((id) => (
          <li
            key={id}
            className={id === selected ? "active" : ""}
            style={{ paddingLeft: 8 + depth(id) * 14 }}
            onClick={() => selectBone(id)}
          >
            {depth(id) > 0 ? "└ " : "● "}
            {id}
          </li>
        ))}
      </ul>
      {bone && (
        <div className="inspector">
          <h4>{bone.id}</h4>
          <label>
            父骨骼
            <select
              value={bone.parent ?? ""}
              onChange={(e) =>
                updateBone(bone.id, { parent: e.target.value === "" ? null : e.target.value })
              }
            >
              <option value="">（根）</option>
              {skeleton.bones
                .filter((b) => b.id !== bone.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            长度
            <input
              type="number"
              step={0.02}
              min={0}
              value={bone.length}
              onChange={(e) => updateBone(bone.id, { length: Number(e.target.value) })}
            />
          </label>
          <label>
            静止旋转（弧度）
            <input
              type="number"
              step={0.1}
              value={Number(bone.rotation.toFixed(4))}
              onChange={(e) => updateBone(bone.id, { rotation: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
