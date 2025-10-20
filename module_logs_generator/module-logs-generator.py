import os
import re
import csv
import json
import base64
import argparse
from pathlib import Path
from typing import Dict, List, Any
import requests
from module_logs_generator.logs import fetch_related_logs_with_openai_verdict
from module_logs_generator.ai_engine.rag_setup import RAG_chunk_data_producer



ENDPOINT        = "https://psacodesprint2025.azure-api.net"
DEPLOYMENT_ID   = "gpt-4.1-mini"
API_VERSION     = "2025-01-01-preview"
API_KEY         = "ae8ca593ce0e4bf983cd8730fbc15df4"

url = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/chat/completions?api-version={API_VERSION}"
HEADERS  = {
    "Content-Type": "application/json",
    "api-key": API_KEY,
}

BASE_DIR = Path(__file__).resolve().parent
PDF_PATH_DEFAULT = BASE_DIR / "Test Cases.pdf"
LOG_DIR     = BASE_DIR / "Application Logs"

# Map categories to the logs you uploaded
CATEGORY_TO_LOGS: Dict[str, List[str]] = {
    "CNTR": ["container_service.log"],
    "VS":   ["vessel_registry_service.log", "vessel_advice_service.log", "berth_application_service.log"],
    "EA":   ["api_event_service.log", "edi_adivce_service.log"],  # (name preserved as provided)
}

# Category-level hints to surface the most relevant lines
HINTS: Dict[str, List[str]] = {
    "CNTR": [r"\bcontainer\b", r"\bcntr[_-]?no\b", r"\bstatus\b",
             r"\bgate[_ -]?in\b", r"\bgate[_ -]?out\b", r"\bload(ed|ing)?\b", r"\bdischarge(d|ing)?\b"],
    "VS":   [r"\bvessel\b", r"\bIMO\b", r"\bvessel[_ -]?advice\b", r"\bberth\b", r"\bsystem[_ -]?vessel[_ -]?name\b"],
    "EA":   [r"\bEDI\b", r"\bCOPARN\b", r"\bCOARRI\b", r"\bCODECO\b", r"\bIFTMIN\b", r"\bIFTMCS\b",
             r"\bapi[-_\s]?event\b", r"\bhttp\b", r"\bcorrelation\b"],
}

# The prompt the model sees
EXTRACTION_PROMPT = """\
You are given a PDF of product support test cases.

Extract each distinct test case and output STRICT JSON ONLY:

{
  "cases": [
    {
      "id": "TC-01",
      "title": "short title (3–10 words)",
      "summary": "1–3 sentences: scenario/goal + expected behavior",
      "signals": ["concrete keywords like container numbers, EDI types, 'berth', 'advice', 'gate in', 'load', 'discharge', etc."],
      "category": "CNTR|VS|EA",
      "rationale": "a RAG-style search query or embedding prompt combining the incident description, category context, and key signals — written as a natural question or statement that can be used to retrieve related incidents, fixes, or procedures from historical data or the knowledge base"
    }
  ]
}

Category rules:
- CNTR (Container Services): mentions containers/cntr_no, yard, gate-in/out, load/discharge, status/size/hazard.
- VS (Vessel-related): mentions vessel/IMO, berth/berthing, vessel advice, system_vessel_name, flag state, port program.
- EA (EDI/API Services): mentions EDI types (COPARN/COARRI/CODECO/IFTMIN/IFTMCS), API events, HTTP status/payload, correlation_id.

No prose outside the JSON object.
"""


# --------------------------------------------------------------------------------------
# Azure OpenAI call (requests, no SDK) — sends PDF as input_file (base64)
# --------------------------------------------------------------------------------------
def _b64(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def _force_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}\s*$", text)
        if not m:
            raise
        return json.loads(m.group(0))

def extract_cases_with_openai(pdf_path: Path) -> dict:
    """
    Primary path: Azure OpenAI Responses API with input_file (PDF).
    Fallback: local text extraction sent to chat if Responses isn't enabled.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    # ---- Responses API payload with input_file (PDF as base64) ----
    body = {
        "model": DEPLOYMENT_ID,      # harmless; routing via deployment in URL
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": EXTRACTION_PROMPT},
                {
                    "type": "input_file",
                    "mime_type": "application/pdf",
                    "data": _b64(pdf_path)
                }
            ]
        }]
    }

    r = requests.post(url, headers=HEADERS, data=json.dumps(body), timeout=180)
    if r.status_code == 200:
        data = r.json()
        # Responses API returns a convenience string at top-level sometimes:
        # prefer the flattened output text if present
        content_text = data.get("output_text")
        if not content_text:
            # or assemble from content parts
            parts = (data.get("output", {}) or {}).get("content", [])
            content_text = "".join(p.get("text","") for p in parts if p.get("type") in ("output_text","text"))
        parsed = _force_json(content_text)
        if "cases" not in parsed or not isinstance(parsed["cases"], list):
            raise ValueError("Extractor did not return a 'cases' array.")
        return parsed

    # ---------------- Fallback path (if 400/404 etc.) ----------------
    # If your gateway doesn’t enable Responses yet, we’ll extract text locally and
    # send that as plain text to chat/completions (no file upload).
    # (Uses pdfminer.six if available; otherwise PyPDF2.)
    try:
        try:
            from pdfminer.high_level import extract_text as _pdf_text
            pdf_text = _pdf_text(str(pdf_path))
        except Exception:
            from PyPDF2 import PdfReader
            pdf_text = "\n".join((p.extract_text() or "") for p in PdfReader(str(pdf_path)).pages)
    except Exception as e:
        raise RuntimeError(f"Responses API not available (status {r.status_code}), and PDF local extraction failed: {e}\nBody: {r.text}")

    # call chat/completions with the extracted text
    CHAT_URL = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/chat/completions?api-version={API_VERSION}"
    chat_body = {
        "model": DEPLOYMENT_ID,
        "temperature": 0.0, 
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You are a precise extractor that outputs strict JSON only."},
            {"role": "user", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": pdf_text[:200000]}  # hard cap to avoid token overflow
        ]
    }
    rc = requests.post(CHAT_URL, headers=HEADERS, data=json.dumps(chat_body), timeout=180)
    rc.raise_for_status()
    data = rc.json()
    content = data["choices"][0]["message"]["content"]
    parsed = _force_json(content)
    if "cases" not in parsed or not isinstance(parsed["cases"], list):
        raise ValueError("Extractor did not return a 'cases' array.")
    return parsed

def extract_cases_from_text(input_text: str) -> dict:
    """
    Extract structured cases directly from a text string using Azure OpenAI.
    (Bypasses PDF extraction entirely.)
    """
    CHAT_URL = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/chat/completions?api-version={API_VERSION}"

    chat_body = {
        "model": DEPLOYMENT_ID,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You are a precise extractor that outputs strict JSON only."},
            {"role": "user", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": input_text[:200000]}  # truncate to prevent token overflow
        ]
    }

    response = requests.post(CHAT_URL, headers=HEADERS, data=json.dumps(chat_body), timeout=180)
    response.raise_for_status()

    data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = _force_json(content)

    if "cases" not in parsed or not isinstance(parsed["cases"], list):
        raise ValueError("Extractor did not return a 'cases' array.")

    return parsed



# --------------------------------------------------------------------------------------
# Log search (category hints + dynamic signals)
# --------------------------------------------------------------------------------------
def compile_hint_regexes(category: str, signals: List[str]) -> List[re.Pattern]:
    regs: List[re.Pattern] = [re.compile(h, re.I) for h in HINTS.get(category, [])]
    # Add short signal tokens that look like IDs/refs (e.g., CMAU..., REF-..., IFTMIN, COPARN, etc.)
    for s in signals or []:
        if isinstance(s, str) and 1 < len(s) <= 64 and re.search(r"[A-Z]{3,}\w*\d+|REF-|IFT|COPARN|CODECO|COARRI|IMO|MV", s, re.I):
            regs.append(re.compile(re.escape(s), re.I))
    return regs


def fetch_related_logs(category: str, signals: List[str], base_dir: Path, max_lines: int) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for fname in CATEGORY_TO_LOGS.get(category, []):
        path = base_dir / fname
        matches: List[str] = []
        if path.exists():
            regs = compile_hint_regexes(category, signals)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if any(r.search(line) for r in regs):
                        matches.append(line.rstrip("\n"))
                        if len(matches) >= max_lines:
                            break
        out[fname] = matches
    return out


# --------------------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------------------
def save_json(cases: List[Dict[str, Any]], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=2)


def save_csv(cases: List[Dict[str, Any]], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for c in cases:
        rows.append({
            "id": c.get("id", ""),
            "title": c.get("title", ""),
            "category": c.get("category", ""),
            "signals": "; ".join(c.get("signals") or []),
            "summary": c.get("summary", ""),
            "rationale": c.get("rationale", ""),
            "log_files": "; ".join(CATEGORY_TO_LOGS.get(c.get("category", ""), [])),
            "rag_suggestion": c.get("rag_suggestion", ""),
            "rag_sources": "; ".join(c.get("rag_sources", [])),
        })
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                                ["id", "title", "category", "signals", "summary", "rationale", "log_files"])
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


def print_case(i: int, case: Dict[str, Any]) -> None:
    print("\n" + "=" * 100)
    print(f"Case {i}: {case.get('id', f'TC-{i}')}  |  Category: {case.get('category', '')}")
    print(f"Title   : {case.get('title', '')}")
    # print(f"Summary : {case.get('summary', '')}")
    # print(f"Signals : {case.get('signals', [])}")
    # print(f"Why     : {case.get('rationale', '')}")


def print_log_hits(log_hits: Dict[str, List[str]], max_preview: int = 40) -> None:
    for log_name, lines in log_hits.items():
        print(f"\n[{log_name}] — {len(lines)} matched line(s)")
        for ln in lines[:max_preview]:
            print(ln)


# --------------------------------------------------------------------------------------
# Main CLI
# --------------------------------------------------------------------------------------
def main():

    MAX_LINES = 200 
    pdf_path = PDF_PATH_DEFAULT
    log_dir  = LOG_DIR

    # 1) Extract cases via Azure OpenAI
    payload = extract_cases_with_openai(pdf_path)
    cases = payload.get("cases", [])
    print(f"Found {len(cases)} case(s) in {pdf_path}.")
    

    # 2) For each case, fetch logs and print
    for i, c in enumerate(cases, 1):
        print_case(i, c)
        # log_hits = fetch_related_logs(c.get("category", ""), c.get("signals") or [], log_dir, MAX_LINES)
        incident_txt = "IFTMIN failed for REF-IFT-0007; segment missing during parse; correlation corr-0007"
        # print("LOG DIRECTORY ", LOG_DIR)
        verdict, files, details = fetch_related_logs_with_openai_verdict(
            category=c.get("category", ""),
            incident_report_text=c.get("title"),
            base_dir=log_dir,
        )
        # print_log_hits(log_hits)
        # print("rationale is ->", c.get("rationale"))
        # print("Refers to logs? ->", verdict)
        print("Matched logs   ->", files)
        # print("Details        ->", json.dumps(details, indent=2))

        # RAG solution
        rag_result = RAG_chunk_data_producer(c.get("title"))
        c["rag_suggestion"] = rag_result["rag_suggestion"]
        c["rag_sources"] = rag_result["sources"]


    save_json(cases, Path("testcase_module_mapping.json"))
    save_csv(cases, Path("testcase_module_mapping.csv"))



if __name__ == "__main__":
    main()
