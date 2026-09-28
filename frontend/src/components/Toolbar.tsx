import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { api } from "../lib/api";
import type { ProjectData } from "../types";

export function Toolbar() {
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setTime = useEditor((s) => s.setTime);
  const time = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => s.duration);
  const keyframes = useEditor((s) => s.keyframes);
  const skeleton = useEditor((s) => s.skeleton);
  const projectName = useEditor((s) => s.projectName);
  const dirty = useEditor((s) => s.dirty);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const markSaved = useEditor((s) => s.markSaved);
  const setToast = useEditor((s) => s.setToast);
  const setProject = useEditor((s) => s.setProject);
  const setDuration = useEditor((s) => s.setDuration);
  const [busy, setBusy] = useState<string | null>(null);
  const rafRef = useRef<number>(0);

  const total = duration ?? Math.max(1, ...keyframes.map((k) => k.time), 1);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = useEditor.getState().currentTime + dt;
      if (t >= total) {
        setTime(0);
      } else {
        setTime(t);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, total, setTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying(!useEditor.getState().playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setPlaying]);

  const buildProject = (): ProjectData => ({
    format: "animstudio.project.v1",
    name: projectName,
    skeleton,
    clip: { duration, keyframes },
  });

  const save = async () => {
    setBusy("save");
    try {
      await api.save(buildProject());
      markSaved();
      setToast(`已保存工程 ${projectName}（${keyframes.length} 个关键帧）`);
    } catch (err) {
      setToast(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    setBusy("load");
    try {
      const p = await api.load(projectName);
      setProject(p);
      setToast(`已加载工程 ${projectName}`);
    } catch (err) {
      setToast(`加载失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportAction = async () => {
    setBusy("export");
    try {
      await api.save(buildProject());
      const data = await api.exportAction(projectName, 30);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}.action.json`;
      a.click();
      URL.revokeObjectURL(url);
      setToast("已导出动作数据（30fps）");
    } catch (err) {
      setToast(`导出失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <header className="toolbar">
      <strong className="app-title">角色动画制作台</strong>
      <button onClick={() => setPlaying(!playing)} title="空格键">
        {playing ? "⏸ 暂停" : "▶ 播放"}
      </button>
      <button onClick={() => { setPlaying(false); setTime(0); }}>⏹ 回到开头</button>
      <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶ 撤销</button>
      <button onClick={redo} disabled={!canRedo} title="Ctrl+Y">↷ 重做</button>
      <label className="duration">
        时长(s)
        <input
          type="number"
          min={0}
          step={0.1}
          value={duration ?? ""}
          onChange={(e) => setDuration(e.target.value === "" ? null : Number(e.target.value))}
        />
      </label>
      <span className="spacer" />
      <span className="project-name">工程：{projectName}{dirty ? " ●" : ""}</span>
      <button onClick={save} disabled={busy !== null}>{busy === "save" ? "保存中…" : "保存"}</button>
      <button onClick={load} disabled={busy !== null}>载入</button>
      <button className="primary" onClick={exportAction} disabled={busy !== null}>
        {busy === "export" ? "导出中…" : "导出动作"}
      </button>
    </header>
  );
}
