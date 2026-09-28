import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { Viewport } from "./components/Viewport";
import { Timeline } from "./components/Timeline";
import { HierarchyPanel } from "./components/HierarchyPanel";
import { useEditor } from "./store";

export default function App() {
  const toast = useEditor((s) => s.toast);
  const setToast = useEditor((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast, setToast]);

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <section className="center">
          <Viewport />
          <Timeline />
        </section>
        <HierarchyPanel />
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
