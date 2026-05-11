from backend.agent import CodeFlowAgent


def test_agent_skips_virtualenvs_and_detects_async_functions(tmp_path):
    app_dir = tmp_path / "backend"
    venv_dir = app_dir / "venv"
    app_dir.mkdir()
    venv_dir.mkdir()

    (app_dir / "main.py").write_text("async def health_check():\n    return {'ok': True}\n", encoding="utf-8")
    (venv_dir / "ignored.py").write_text("def ignored():\n    pass\n", encoding="utf-8")

    report = CodeFlowAgent(root=str(tmp_path)).analyze_project()

    assert report["summary"]["files_scanned"] == 1
    assert report["summary"]["issues_found"] == 0
    assert "health_check" in report["files"][0]["functions"]
