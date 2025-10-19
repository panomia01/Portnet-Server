# app/main.py
import os, json, tempfile, importlib.util
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ==== CONFIG ====

BASE_DIR = Path(__file__).resolve().parent                      # where your files are
LOGS_BASE = BASE_DIR / "module_logs_generator" / "Application Logs"                                 # logs sit in /mnt/data per your upload
MODULE_FILE = BASE_DIR / "module_logs_generator" / "module-logs-generator.py"    # note the hyphens in filename
LOGS_PY     = BASE_DIR / "module_logs_generator" / "logs.py"                     # contains fetch_related_logs_with_openai_verdict
AI_ENGINE     = BASE_DIR / "module_logs_generator" / "ai_engine" / "rag_setup.py"  

# Azure OpenAI creds (set these as env vars in prod)
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://psacodesprint2025.azure-api.net")
os.environ.setdefault("AZURE_OPENAI_API_KEY",   "ae8ca593ce0e4bf983cd8730fbc15df4")
# =================

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://your-frontend.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _import_module_from_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# Load your existing modules (no renaming required)
mlg = _import_module_from_path("module_logs_generator", MODULE_FILE)
logs_mod = _import_module_from_path("logs_mod", LOGS_PY)
ai_engine_mod = _import_module_from_path("rag_setup", AI_ENGINE)

def _case_to_text(case: Dict[str, Any]) -> str:
    """Flatten a case dict to a text snippet for log correlation."""
    parts: List[str] = []
    for k in ("id", "title", "summary", "signals", "steps", "expected", "actual"):
        v = case.get(k)
        if v:
            if isinstance(v, list): parts.append(", ".join(map(str, v)))
            else: parts.append(str(v))
    return "\n".join(parts)

@app.post("/pipeline/import-pdf")
async def import_pdf(file: UploadFile = File(...)):

    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(400, "Please upload a PDF.")

    # Save the upload to a temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        data = await file.read()
        if len(data) > 15 * 1024 * 1024:
            raise HTTPException(413, "File too large (max 15MB).")
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        print("start of process")
        # Use the extractor function already defined in module-logs-generator.py
        # It expects a file path; returns {"cases":[...], ...}
        # tmp_path = BASE_DIR / "module_/logs_generator" / "Test Cases.pdf"
        payload = mlg.extract_cases_with_openai(tmp_path)
        cases = payload.get("cases", [])
        if not cases:
            raise HTTPException(422, "No test cases detected in PDF.")

        results = []
        for c in cases:
            category = (c.get("category") or "").strip().upper()
            incident_text = _case_to_text(c)

            # Run correlation using your logs.py helper (it maps filenames internally)
            verdict, matched_files, raw = logs_mod.fetch_related_logs_with_openai_verdict(
                category=category,
                incident_report_text=c.get("title"),
                base_dir=LOGS_BASE,
            )

            results.append({
                "case": c,
                "refers_to_logs": verdict,
                "matched_log_files": matched_files,
                "raw_model_decision": raw,  # keep for debugging; you can omit in prod
            })

            # TODO: will need you to return the correct thing and append to results
            results.append(ai_engine_mod.RAG_chunk_data_producer(c.get("title")) )

        # Optional: save CSV/JSON like the CLI did
        # mlg.save_json(cases, Path("testcase_module_mapping.json"))
        # mlg.save_csv(cases, Path("testcase_module_mapping.csv"))

        return {"ok": True, "count": len(results), "results": results}

    except Exception as e:
        raise HTTPException(500, f"Pipeline error: {e}")
    finally:
        try: tmp_path.unlink()
        except: pass