import os, json, re, base64, requests
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

ENDPOINT        = "https://psacodesprint2025.azure-api.net"
DEPLOYMENT_ID   = "gpt-4.1-mini"
API_VERSION     = "2025-01-01-preview"
API_KEY         = "ae8ca593ce0e4bf983cd8730fbc15df4"

RESPONSES_URL = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/responses?api-version={API_VERSION}"
CHAT_URL      = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/chat/completions?api-version={API_VERSION}"
HEADERS       = {"Content-Type": "application/json", "api-key": API_KEY}

# If you already have these mappings, reuse them.
CATEGORY_TO_LOGS: Dict[str, List[str]] = {
    "CNTR": ["container_service.log"],
    "VS":   ["vessel_registry_service.log", "vessel_advice_service.log", "berth_application_service.log"],
    "EA":   ["api_event_service.log", "edi_adivce_service.log"],  
}

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

# ---------- PROMPT ----------
XREF_PROMPT = """\
You are a log correlation assistant.

You will receive:
- An INCIDENT REPORT (may be text or PDF content).
- Several LOG FILES (raw text contents), each labeled by file name.

Goal: Determine if the incident report REFERs TO (or is ABOUT) events that are present in ANY of the log files.

Definition of "refers to":
- The incident contains specific identifiers or phrases (e.g., container numbers, vessel names, EDI refs like REF-IFT-0007, IMO numbers, correlation IDs), timestamps, event types (e.g., GATE_IN, LOAD, DISCHARGE), or error strings that appear in a log.
- Or, the incident narrative clearly describes an event that is explicitly captured in a log (even if the exact ID is implied but not repeated verbatim).
- This is not just topic similarity; it must be a plausible operational instance match.

Output STRICT JSON ONLY with this exact shape:
{
  "refers_to_logs": true | false,
  "signals": ["list", "of", "key", "tokens", "from", "report", "or", "logs"],
  "matched_logs": [
    {
      "file": "file_name.log",
      "confidence": 0.0,
      "reasons": ["short", "bullets"]
    }
  ]
}

Rules:
- If no logs plausibly match, set "refers_to_logs": false and return empty matched_logs.
- "confidence" is 0.0–1.0.
- Keep reasons brief.
- No extra prose outside the JSON.
"""

def cross_reference_with_openai_text_only(
    incident_report: str,
    log_paths: List[Path],
    max_chars_per_log: int = 400000
) -> Dict[str, Any]:
    """
    Ask OpenAI to decide if the incident report (text) refers to any of the provided logs.
    Sends incident text + each log file content (capped) via the Responses API; falls back to chat if needed.
    Returns JSON: {refers_to_logs: bool, signals: [...], matched_logs: [{file, confidence, reasons}...]}
    """
    # Build input content
    contents = [{"type": "input_text", "text": XREF_PROMPT}]
    contents.append({"type": "input_text", "text": f"INCIDENT REPORT (text):\n{incident_report[:200000]}"})

    # Attach logs as files (capped)
    for p in log_paths:
        # print("p exist or not: ", p)
        if not p.exists():
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read(max_chars_per_log)
            data_b64 = base64.b64encode(txt.encode("utf-8")).decode("utf-8")
        except Exception:
            # last-resort raw bytes
            data_b64 = _b64(p)
        contents.append({"type": "input_text", "text": f"LOG FILE: {p.name}"})
        contents.append({"type": "input_file", "mime_type": "text/plain", "data": data_b64})

    # Try Responses API first
    body = {
        "model": DEPLOYMENT_ID,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "input": [{"role": "user", "content": contents}],
    }
    r = requests.post(RESPONSES_URL, headers=HEADERS, data=json.dumps(body), timeout=240)
    if r.status_code == 200:
        data = r.json()
        text = data.get("output_text") or ""
        if not text:
            parts = (data.get("output", {}) or {}).get("content", [])
            text = "".join(p.get("text","") for p in parts if p.get("type") in ("output_text","text"))
        return _force_json(text)

    # Fallback: chat/completions with concatenated text
    logs_concat = []
    for p in log_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    logs_concat.append(f"\n\n===== {p.name} =====\n" + f.read(max_chars_per_log))
            except Exception:
                pass
    chat_body = {
        "model": DEPLOYMENT_ID,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You are a precise cross-referencer. Output strict JSON only."},
            {"role": "user", "content": XREF_PROMPT},
            {"role": "user", "content": f"INCIDENT REPORT:\n{incident_report[:200000]}"},
            {"role": "user", "content": "LOG FILES:\n" + "\n".join(logs_concat)[:400000]},
        ],
    }
    rc = requests.post(CHAT_URL, headers=HEADERS, data=json.dumps(chat_body), timeout=240)
    rc.raise_for_status()
    resp = rc.json()
    content = resp["choices"][0]["message"]["content"]
    return _force_json(content)


def fetch_related_logs_with_openai_verdict(
    category: str,
    incident_report_text: str,
    base_dir: Path,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Returns:
      - verdict (bool): True if the incident refers to any system logs
      - matched_files (List[str]): list of log file names that match
      - raw (Dict): raw JSON from the model
    """
    log_files = [base_dir / f for f in CATEGORY_TO_LOGS.get(category, [])]
    result = cross_reference_with_openai_text_only(
        incident_report=incident_report_text,
        log_paths=log_files
    )
    matched = [m.get("file") for m in result.get("matched_logs", []) if m.get("file")]
    verdict = bool(result.get("refers_to_logs")) and len(matched) > 0
    return verdict, matched, result
