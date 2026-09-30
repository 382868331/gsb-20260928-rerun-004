from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from animation_core import (
    ConsolidationError,
    action_is_current,
    consolidate_layers,
    default_project,
    evaluate_world,
    export_action,
    load_project,
    sample_local,
    save_project,
    validate_project,
)


BASE_DIR = Path(__file__).resolve().parent
PROJECT_PATH = BASE_DIR / "data" / "project.json"


class AnimationHandler(BaseHTTPRequestHandler):
    server_version = "AnimationDesk/0.1"

    def end_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.end_json({"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/project":
            self.end_json({"project": load_project(PROJECT_PATH), "errors": []})
            return
        if parsed.path == "/api/evaluate":
            try:
                query = parse_qs(parsed.query)
                time = float(query.get("time", ["0"])[0])
                action_id = query.get("action_id", [None])[0]
                project = load_project(PROJECT_PATH)
                errors = validate_project(project)
                if errors:
                    self.end_json({"errors": errors}, HTTPStatus.BAD_REQUEST)
                else:
                    self.end_json({"time": time, "local": sample_local(project, time, action_id), "world": evaluate_world(project, time, action_id)})
            except ValueError:
                self.end_json({"errors": ["time 必须是数字"]}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/export":
            try:
                query = parse_qs(parsed.query)
                fps = float(query.get("fps", ["24"])[0])
                action_id = query.get("action_id", [None])[0]
                project = load_project(PROJECT_PATH)
                errors = validate_project(project)
                if errors:
                    self.end_json({"errors": errors}, HTTPStatus.BAD_REQUEST)
                else:
                    self.end_json(export_action(project, fps, action_id))
            except ValueError as exc:
                self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
            return
        self.end_json({"errors": ["接口不存在"]}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/consolidate":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                project = load_project(PROJECT_PATH)
                next_project, action, notices = consolidate_layers(
                    project,
                    float(payload.get("start")),
                    float(payload.get("end")),
                    payload.get("bones"),
                    name=payload.get("name", "整理动作"),
                    fps=float(payload.get("fps", 24.0)),
                    action_id=payload.get("action_id"),
                )
                save_project(PROJECT_PATH, next_project)
                self.end_json({
                    "ok": True,
                    "project": next_project,
                    "action": action,
                    "notices": notices,
                    "stale": not action_is_current(next_project, action),
                    "errors": [],
                })
            except ConsolidationError as exc:
                self.end_json({"errors": exc.errors}, HTTPStatus.BAD_REQUEST)
            except (TypeError, ValueError, json.JSONDecodeError, UnicodeDecodeError):
                self.end_json({"errors": ["整理参数无效：需要 start/end 数字和 bones 骨骼数组"]}, HTTPStatus.BAD_REQUEST)
            except OSError as exc:
                self.end_json({"errors": [f"保存失败：{exc}"]}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if parsed.path != "/api/project":
            self.end_json({"errors": ["接口不存在"]}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            project = json.loads(self.rfile.read(length).decode("utf-8"))
            errors = validate_project(project)
            if errors:
                self.end_json({"errors": errors}, HTTPStatus.BAD_REQUEST)
                return
            save_project(PROJECT_PATH, project)
            self.end_json({"ok": True, "project": project, "errors": []})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.end_json({"errors": ["请求体不是有效 JSON"]}, HTTPStatus.BAD_REQUEST)
        except OSError as exc:
            self.end_json({"errors": [f"保存失败：{exc}"]}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def log_message(self, fmt, *args):
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()
    if args.reset or not PROJECT_PATH.exists():
        PROJECT_PATH.parent.mkdir(parents=True, exist_ok=True)
        save_project(PROJECT_PATH, default_project())
    server = ThreadingHTTPServer((args.host, args.port), AnimationHandler)
    print(f"Animation backend listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
