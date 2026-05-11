"""
Simple Code Flow Agent

Scans Python files in the project, builds a lightweight call graph,
and detects simple issues like unimplemented functions (bodies with
`pass` or TODO markers). This agent is intentionally conservative:
it reports findings and suggestions but does not modify source files.
"""
import ast
import os
from typing import Dict, List, Any


class CodeFlowAgent:
    EXCLUDED_DIRS = {
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".qodo",
        ".ruff_cache",
        ".venv",
        "__pycache__",
        "backend/venv",
        "node_modules",
        "venv",
    }

    def __init__(self, root: str):
        self.root = os.path.abspath(root)

    def should_skip_dir(self, dirpath: str) -> bool:
        rel_path = os.path.relpath(dirpath, self.root).replace("\\", "/")
        return rel_path in self.EXCLUDED_DIRS or os.path.basename(dirpath) in self.EXCLUDED_DIRS

    def scan_python_files(self) -> List[str]:
        py_files = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [
                dirname
                for dirname in dirnames
                if not self.should_skip_dir(os.path.join(dirpath, dirname))
            ]
            for fn in filenames:
                if fn.endswith(".py"):
                    py_files.append(os.path.join(dirpath, fn))
        return py_files

    def analyze_file(self, path: str) -> Dict[str, Any]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                source = f.read()
        except (OSError, UnicodeDecodeError) as e:
            return {
                "path": path,
                "functions": {},
                "issues": [{"type": "file_read_error", "message": str(e)}],
                "top_level_todos": []
            }

        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError as e:
            return {
                "path": path,
                "functions": {},
                "issues": [{"type": "syntax_error", "message": str(e)}],
                "top_level_todos": []
            }

        issues: List[Dict[str, Any]] = []
        functions: Dict[str, Dict[str, Any]] = {}

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = node.name
                lineno = getattr(node, 'lineno', None)
                # Detect unimplemented functions (single Pass) or TODO in docstring/body
                body_nodes = node.body
                is_unimplemented = False
                has_todo = False

                if len(body_nodes) == 0:
                    is_unimplemented = True

                for b in body_nodes:
                    if isinstance(b, ast.Pass):
                        is_unimplemented = True
                    if isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and isinstance(b.value.value, str):
                        if "TODO" in b.value.value or "todo" in b.value.value.lower():
                            has_todo = True

                # Collect calls made inside the function
                calls = set()
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call):
                        func = sub.func
                        if isinstance(func, ast.Name):
                            calls.add(func.id)
                        elif isinstance(func, ast.Attribute):
                            # attribute: obj.method -> record method name
                            calls.add(func.attr)

                functions[name] = {
                    "lineno": lineno,
                    "unimplemented": is_unimplemented,
                    "has_todo": has_todo,
                    "calls": sorted(list(calls))
                }

                if is_unimplemented or has_todo:
                    issues.append({
                        "type": "unimplemented_function" if is_unimplemented else "todo_in_function",
                        "function": name,
                        "lineno": lineno,
                        "has_todo": has_todo,
                        "suggestion": "Implement function body or add proper stub like `raise NotImplementedError()`"
                    })

        # Simple file-level checks: top-level TODOs
        top_todos: List[int] = []
        for node in tree.body:
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                if "TODO" in node.value.value or "todo" in node.value.value.lower():
                    top_todos.append(getattr(node, 'lineno', None))

        result: Dict[str, Any] = {
            "path": path,
            "functions": functions,
            "issues": issues,
            "top_level_todos": top_todos
        }

        return result

    def analyze_project(self) -> Dict[str, Any]:
        files = self.scan_python_files()
        report: Dict[str, Any] = {"files": [], "summary": {"files_scanned": len(files), "issues_found": 0}}

        for f in files:
            analysis = self.analyze_file(f)
            report["summary"]["issues_found"] += len(analysis.get("issues", []))
            report["files"].append(analysis)

        return report


if __name__ == "__main__":
    import json
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    agent = CodeFlowAgent(root=root)
    r = agent.analyze_project()
    print(json.dumps(r, indent=2))
