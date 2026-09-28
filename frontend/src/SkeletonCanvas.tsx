import { useMemo } from "react";
import type { Bone, Project } from "./animation";
import { evaluateWorld } from "./animation";

type Props = {
  project: Project;
  time: number;
  selectedBoneId: string;
  onSelectBone: (boneId: string) => void;
};

export function SkeletonCanvas({ project, time, selectedBoneId, onSelectBone }: Props) {
  const world = useMemo(() => evaluateWorld(project, time), [project, time]);
  const projectPoint = (x: number, y: number) => ({ x: 260 + x, y: 185 + y });

  return (
    <svg className="skeleton-canvas" viewBox="0 0 520 370" role="img" aria-label="角色骨架预览">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.22" />
        </filter>
      </defs>
      <line x1="70" y1="292" x2="450" y2="292" className="ground" />
      <g filter="url(#shadow)">
        {project.skeleton.bones.map((bone: Bone) => {
          const end = projectPoint(world[bone.id].x, world[bone.id].y);
          const parent = bone.parent ? projectPoint(world[bone.parent].x, world[bone.parent].y) : end;
          const selected = bone.id === selectedBoneId;
          return (
            <g key={bone.id} className="bone-group" onClick={() => onSelectBone(bone.id)}>
              <line
                x1={parent.x}
                y1={parent.y}
                x2={end.x}
                y2={end.y}
                className={selected ? "bone selected" : "bone"}
              />
              <circle cx={end.x} cy={end.y} r={bone.parent === null ? 8 : 5.5} className={selected ? "joint selected" : "joint"} />
              {bone.id === "head" && <circle cx={end.x} cy={end.y - 7} r={17} className="head" />}
              <title>{bone.name}</title>
            </g>
          );
        })}
      </g>
      <text x="18" y="30" className="readout">t = {time.toFixed(3)}s</text>
    </svg>
  );
}
