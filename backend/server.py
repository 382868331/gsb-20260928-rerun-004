from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from animation_core import (
    bake_action,
    default_project,
    evaluate_world,
    export_action,
    load_project,
    apply_rework,
    revert_rework,
    rework_analysis,
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
                time = float(parse_qs(parsed.query).get("time", ["0"])[0])
                project = load_project(PROJECT_PATH)
                errors = validate_project(project)
                if errors:
                    self.end_json({"errors": errors}, HTTPStatus.BAD_REQUEST)
                else:
                    self.end_json({"time": time, "local": sample_local(project, time), "world": evaluate_world(project, time)})
            except ValueError:
                self.end_json({"errors": ["time 必须是数字"]}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/export":
            try:
                fps = float(parse_qs(parsed.query).get("fps", ["24"])[0])
                project = load_project(PROJECT_PATH)
                errors = validate_project(project)
                if errors:
                    self.end_json({"errors": errors}, HTTPStatus.BAD_REQUEST)
                else:
                    self.end_json(export_action(project, fps))
            except ValueError as exc:
                self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
            return
        self.end_json({"errors": ["接口不存在"]}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if parsed.path == "/api/bake":
                try:
                    action = bake_action(
                        payload["project"],
                        float(payload["range_start"]),
                        float(payload["range_end"]),
                        list(payload.get("bones", [])),
                        str(payload.get("name", "")),
                        payload.get("action_id"),
                    )
                    self.end_json({"ok": True, "action": action})
                except (KeyError, TypeError, ValueError) as exc:
                    self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
                return
            if parsed.path == "/api/rework/analyze":
                try:
                    result = rework_analysis(payload["project"], str(payload["action_id"]))
                    self.end_json({"ok": True, **result})
                except (KeyError, TypeError, ValueError) as exc:
                    self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
                return
            if parsed.path == "/api/rework/apply":
                try:
                    result = apply_rework(
                        payload["project"],
                        str(payload["action_id"]),
                        list(payload["segment_ids"]) if payload.get("segment_ids") is not None else None,
                        payload.get("decisions") if isinstance(payload.get("decisions"), dict) else None,
                    )
                    self.end_json({"ok": True, **result})
                except (KeyError, TypeError, ValueError) as exc:
                    self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
                return
            if parsed.path == "/api/rework/revert":
                try:
                    result = revert_rework(payload["project"], str(payload["action_id"]), str(payload["repair_id"]))
                    self.end_json({"ok": True, **result})
                except (KeyError, TypeError, ValueError) as exc:
                    self.end_json({"errors": [str(exc)]}, HTTPStatus.BAD_REQUEST)
                return
            if parsed.path != "/api/project":
                self.end_json({"errors": ["接口不存在"]}, HTTPStatus.NOT_FOUND)
                return
            project = payload
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
